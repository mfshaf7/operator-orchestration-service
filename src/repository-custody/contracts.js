import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const CONTRACT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/repository-custody",
);

const MANIFEST = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "manifest.json"), "utf8"),
);
const WORKFLOW_CONTRACT_ROOT = path.resolve(CONTRACT_ROOT, "../repository-custody-workflow");
const WORKFLOW_MANIFEST = JSON.parse(
  readFileSync(path.join(WORKFLOW_CONTRACT_ROOT, "manifest.json"), "utf8"),
);

const SCHEMA_BY_ARTIFACT = Object.freeze({
  repository_custody_request: "repository-custody-request.schema.json",
  repository_custody_decision: "repository-custody-decision.schema.json",
  repository_provider_readback: "repository-provider-readback.schema.json",
  repository_custody_receipt: "repository-custody-receipt.schema.json",
});

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function loadSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();
  for (const [artifactType, filename] of Object.entries(SCHEMA_BY_ARTIFACT)) {
    const bytes = readFileSync(path.join(CONTRACT_ROOT, filename));
    const manifestEntry = MANIFEST.schemas[artifactType];
    if (!manifestEntry || manifestEntry.path !== filename || sha256(bytes) !== manifestEntry.sha256) {
      throw new Error(`Repository custody contract digest mismatch: ${filename}`);
    }
    const schema = JSON.parse(bytes.toString("utf8"));
    validators.set(artifactType, ajv.compile(schema));
  }
  const workflowEntry = WORKFLOW_MANIFEST.schemas.repository_custody_workflow_result;
  const workflowBytes = readFileSync(path.join(WORKFLOW_CONTRACT_ROOT, workflowEntry.path));
  if (sha256(workflowBytes) !== workflowEntry.sha256) {
    throw new Error("Repository custody workflow contract digest mismatch: result.schema.json");
  }
  validators.set(
    "repository_custody_workflow_result",
    ajv.compile(JSON.parse(workflowBytes.toString("utf8"))),
  );
  return validators;
}

const VALIDATORS = loadSchemas();

function details(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

function contentProjection(artifact) {
  const projection = structuredClone(artifact);
  if (projection.integrity) delete projection.integrity.content_digest;
  return projection;
}

export function artifactReference(uri, artifact) {
  return { uri, digest: artifact.integrity.content_digest };
}

export function assertRepositoryCustodyArtifact(artifactType, value, label) {
  const validate = VALIDATORS.get(artifactType);
  if (!validate || !validate(value)) {
    throw new HttpError(
      400,
      "repository_custody_contract_invalid",
      `${label} does not satisfy the repository custody contract.`,
      validate ? details(validate) : [],
    );
  }
  if (
    value.integrity &&
    value.integrity.content_digest !== canonicalDigest(contentProjection(value))
  ) {
    throw new HttpError(
      400,
      "repository_custody_integrity_invalid",
      `${label} integrity does not match its canonical content.`,
    );
  }
  return value;
}

export function assertRepositoryCustodyRequest(value) {
  const request = assertRepositoryCustodyArtifact(
    "repository_custody_request",
    value,
    "Repository custody request",
  );
  const projection = structuredClone(request);
  delete projection.request_digest;
  if (request.request_digest !== canonicalDigest(projection)) {
    throw new HttpError(
      400,
      "repository_custody_request_digest_invalid",
      "Repository custody request digest does not match its canonical content.",
    );
  }
  return request;
}

export function assertRepositoryCustodyDecision(value) {
  return assertRepositoryCustodyArtifact(
    "repository_custody_decision",
    value,
    "Repository custody decision",
  );
}

export function assertRepositoryProviderReadback(value) {
  return assertRepositoryCustodyArtifact(
    "repository_provider_readback",
    value,
    "Repository provider readback",
  );
}

export function assertRepositoryCustodyReceipt(value) {
  return assertRepositoryCustodyArtifact(
    "repository_custody_receipt",
    value,
    "Repository custody receipt",
  );
}

export function assertRepositoryCustodyWorkflowResult(value) {
  return assertRepositoryCustodyArtifact(
    "repository_custody_workflow_result",
    value,
    "Repository custody workflow result",
  );
}

export function repositoryCustodyAuthority() {
  return Object.freeze({
    digest: `sha256:${MANIFEST.authority.sha256}`,
    sourceCommit: MANIFEST.source.commit,
    uri: MANIFEST.authority.uri,
    version: "repository-custody/v1",
  });
}

export function repositoryCustodyRuntimeActivation() {
  return Object.freeze(structuredClone(MANIFEST.runtime_activation));
}

export function withArtifactIntegrity(artifact) {
  const output = structuredClone(artifact);
  output.integrity = {
    canonicalization: "RFC8785",
    algorithm: "sha256",
    content_digest: "",
  };
  output.integrity.content_digest = canonicalDigest(contentProjection(output));
  return output;
}
