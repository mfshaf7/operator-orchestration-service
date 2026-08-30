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
  "../../contracts/repository-lifecycle",
);
const WORKFLOW_ROOT = path.resolve(CONTRACT_ROOT, "../repository-lifecycle-workflow");
const MANIFEST = JSON.parse(readFileSync(path.join(CONTRACT_ROOT, "manifest.json"), "utf8"));
const WORKFLOW_MANIFEST = JSON.parse(
  readFileSync(path.join(WORKFLOW_ROOT, "manifest.json"), "utf8"),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();
  for (const [artifactType, entry] of Object.entries(MANIFEST.schemas)) {
    const bytes = readFileSync(path.join(CONTRACT_ROOT, entry.path));
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`Repository lifecycle contract digest mismatch: ${entry.path}`);
    }
    validators.set(artifactType, ajv.compile(JSON.parse(bytes.toString("utf8"))));
  }
  const workflowEntry = WORKFLOW_MANIFEST.schemas.repository_lifecycle_workflow_result;
  const workflowBytes = readFileSync(path.join(WORKFLOW_ROOT, workflowEntry.path));
  if (sha256(workflowBytes) !== workflowEntry.sha256) {
    throw new Error("Repository lifecycle workflow contract digest mismatch: result.schema.json");
  }
  validators.set(
    "repository_lifecycle_workflow_result",
    ajv.compile(JSON.parse(workflowBytes.toString("utf8"))),
  );
  return validators;
}

const VALIDATORS = loadValidators();

function projection(value) {
  const output = structuredClone(value);
  if (output.integrity) delete output.integrity.content_digest;
  return output;
}

function details(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

export function assertRepositoryLifecycleArtifact(type, value, label) {
  const validate = VALIDATORS.get(type);
  if (!validate || !validate(value)) {
    throw new HttpError(
      400,
      "repository_lifecycle_contract_invalid",
      `${label} does not satisfy the repository lifecycle contract.`,
      validate ? details(validate) : [],
    );
  }
  if (value.integrity && value.integrity.content_digest !== canonicalDigest(projection(value))) {
    throw new HttpError(
      400,
      "repository_lifecycle_integrity_invalid",
      `${label} integrity does not match its canonical content.`,
    );
  }
  return value;
}

export function assertRepositoryLifecycleRequest(value) {
  const request = assertRepositoryLifecycleArtifact(
    "repository_lifecycle_request",
    value,
    "Repository lifecycle request",
  );
  const content = structuredClone(request);
  delete content.request_digest;
  if (request.request_digest !== canonicalDigest(content)) {
    throw new HttpError(
      400,
      "repository_lifecycle_request_digest_invalid",
      "Repository lifecycle request digest does not match its canonical content.",
    );
  }
  return request;
}

export const assertRepositoryLifecycleDecision = (value) =>
  assertRepositoryLifecycleArtifact(
    "repository_lifecycle_decision",
    value,
    "Repository lifecycle decision",
  );
export const assertRepositoryLifecycleReceipt = (value) =>
  assertRepositoryLifecycleArtifact(
    "repository_lifecycle_receipt",
    value,
    "Repository lifecycle receipt",
  );
export const assertRepositoryLifecycleAudit = (value) =>
  assertRepositoryLifecycleArtifact(
    "repository_lifecycle_audit",
    value,
    "Repository lifecycle audit projection",
  );
export const assertRepositoryLifecycleWorkflowResult = (value) =>
  assertRepositoryLifecycleArtifact(
    "repository_lifecycle_workflow_result",
    value,
    "Repository lifecycle workflow result",
  );

export function withRepositoryLifecycleIntegrity(value) {
  const output = structuredClone(value);
  output.integrity = {
    canonicalization: "RFC8785",
    algorithm: "sha256",
    content_digest: "",
  };
  output.integrity.content_digest = canonicalDigest(projection(output));
  return output;
}

export function repositoryLifecycleAuthority() {
  return Object.freeze({
    digest: `sha256:${MANIFEST.authority.sha256}`,
    sourceCommit: MANIFEST.source.commit,
    uri: MANIFEST.authority.uri,
    version: MANIFEST.policy_version,
  });
}

export function repositoryLifecycleRuntimeActivation() {
  return Object.freeze(structuredClone(MANIFEST.runtime_activation));
}

export function lifecycleArtifactReference(uri, artifact) {
  return { uri, digest: artifact.integrity.content_digest };
}
