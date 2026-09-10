import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/prototype-maturity/", import.meta.url);
export const prototypeMaturityManifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();

for (const [name, entry] of Object.entries(prototypeMaturityManifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error(`Prototype Maturity bundle integrity failed: ${name}`);
  }
  if (name.endsWith(".schema.json")) {
    validators.set(name, ajv.compile(JSON.parse(bytes)));
  }
}

const artifactShape = {
  "prototype-maturity-request": [
    "prototype-maturity-request.schema.json",
    "request_id",
    "request_digest",
  ],
  "prototype-maturity-packet": [
    "prototype-maturity-packet.schema.json",
    "packet_id",
    "packet_digest",
  ],
  "prototype-maturity-readiness": [
    "prototype-maturity-readiness.schema.json",
    "readiness_id",
    "readiness_digest",
  ],
  "prototype-maturity-decision": [
    "prototype-maturity-decision.schema.json",
    "decision_id",
    "decision_digest",
  ],
  "prototype-maturity-readback": [
    "prototype-maturity-readback.schema.json",
    "readback_id",
    "readback_digest",
  ],
  "prototype-maturity-receipt": [
    "prototype-maturity-receipt.schema.json",
    "receipt_id",
    "receipt_digest",
  ],
  "prototype-maturity-source-result": [
    "prototype-maturity-source-result.schema.json",
    "result_id",
    "result_digest",
  ],
};

export function prototypeMaturityError(code, message, status = 409) {
  return new HttpError(status, `prototype_maturity_${code}`, message);
}

function compareKeys(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function prototypeMaturityStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) {
      throw prototypeMaturityError(
        "invalid_json",
        "Prototype Maturity JSON contains invalid Unicode.",
        400,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(prototypeMaturityStringify).join(",")}]`;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort(compareKeys)
      .map(
        (key) =>
          `${prototypeMaturityStringify(key)}:${prototypeMaturityStringify(value[key])}`,
      )
      .join(",")}}`;
  }
  throw prototypeMaturityError(
    "invalid_json",
    "Prototype Maturity JSON requires lossless integral values and plain objects.",
    400,
  );
}

export function prototypeMaturityDigest(value, field = null) {
  const projection = structuredClone(value);
  if (field) delete projection[field];
  return `sha256:${createHash("sha256")
    .update(prototypeMaturityStringify(projection))
    .digest("hex")}`;
}

export function bindPrototypeMaturity(value, field) {
  return {
    ...structuredClone(value),
    [field]: prototypeMaturityDigest(value, field),
  };
}

export function assertPrototypeMaturityArtifact(value) {
  const shape = artifactShape[value?.artifact_type];
  if (!shape) {
    throw prototypeMaturityError(
      "artifact_type_invalid",
      "Unsupported Prototype Maturity artifact.",
      400,
    );
  }
  const [schema, , digestField] = shape;
  if (!validators.get(schema)?.(value)) {
    throw prototypeMaturityError(
      "contract_invalid",
      `Invalid ${value.artifact_type} artifact.`,
      400,
    );
  }
  if (value[digestField] !== prototypeMaturityDigest(value, digestField)) {
    throw prototypeMaturityError(
      "digest_invalid",
      `Invalid ${value.artifact_type} digest.`,
      400,
    );
  }
  return value;
}

export function prototypeMaturityReference(value) {
  const shape = artifactShape[value?.artifact_type];
  if (!shape) {
    throw prototypeMaturityError(
      "artifact_type_invalid",
      "Unsupported Prototype Maturity artifact.",
      400,
    );
  }
  return { id: value[shape[1]], digest: value[shape[2]] };
}

function same(left, right) {
  return prototypeMaturityDigest(left) === prototypeMaturityDigest(right);
}

export function createPrototypeMaturityEvaluation(input, callerId) {
  const expectedKeys = [
    "authority_revision",
    "execution_ref",
    "packet",
    "request",
    "session_ref",
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !== expectedKeys.join(",")
  ) {
    throw prototypeMaturityError(
      "command_invalid",
      "Supply the request, packet, authority revision, session, and execution references.",
      400,
    );
  }
  const request = assertPrototypeMaturityArtifact(input.request);
  const packet = assertPrototypeMaturityArtifact(input.packet);
  if (request.operator_ref !== callerId) {
    throw prototypeMaturityError(
      "operator_mismatch",
      "The maturity request must belong to the authenticated operator.",
      403,
    );
  }
  if (
    !same(packet.request_ref, prototypeMaturityReference(request)) ||
    packet.prototype_id !== request.prototype_id ||
    packet.transition !== request.transition
  ) {
    throw prototypeMaturityError(
      "artifact_binding_invalid",
      "Prototype Maturity artifacts do not bind the same request.",
    );
  }
  if (
    !/^[0-9a-f]{40}$/.test(input.authority_revision) ||
    request.expected_state.source_revision !== input.authority_revision
  ) {
    throw prototypeMaturityError(
      "authority_mismatch",
      "The request must bind the exact Prototype Studio authority revision.",
    );
  }
  const evaluation = bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "wgcf-prototype-maturity-evaluation",
      evaluation_id: request.request_id.replace(
        /^prototype-maturity-request:/,
        "prototype-maturity-evaluation:",
      ),
      session_ref: input.session_ref,
      execution_ref: input.execution_ref,
      authority_revision: input.authority_revision,
      policy_ref: {
        id: "workspace-governance.prototype-maturity.v1",
        authority_commit: prototypeMaturityManifest.files["prototype-maturity.yaml"].commit,
        digest: `sha256:${prototypeMaturityManifest.files["prototype-maturity.yaml"].sha256}`,
      },
      security_review_ref: {
        repo: prototypeMaturityManifest.security_review.repo,
        commit: prototypeMaturityManifest.security_review.commit,
        path: prototypeMaturityManifest.security_review.path,
        digest: `sha256:${prototypeMaturityManifest.security_review.content_sha256}`,
        decision: prototypeMaturityManifest.security_review.decision,
      },
      request: structuredClone(request),
      packet: structuredClone(packet),
    },
    "evaluation_digest",
  );
  if (!validators.get("evaluation.schema.json")?.(evaluation)) {
    throw prototypeMaturityError(
      "evaluation_invalid",
      "Prototype Maturity evaluation does not satisfy the WGCF contract.",
      400,
    );
  }
  return evaluation;
}

export function createPrototypeMaturityDecision({
  evaluation,
  readiness,
  operatorRef,
  decision,
  blocker,
  sourceBranch,
  decidedAt,
}) {
  return assertPrototypeMaturityArtifact(
    bindPrototypeMaturity(
      {
        schema_version: 1,
        artifact_type: "prototype-maturity-decision",
        decision_id: evaluation.request.request_id.replace(
          /^prototype-maturity-request:/,
          "prototype-maturity-decision:",
        ),
        decided_at: decidedAt,
        request_ref: prototypeMaturityReference(evaluation.request),
        packet_ref: prototypeMaturityReference(evaluation.packet),
        readiness_ref: prototypeMaturityReference(readiness),
        prototype_id: evaluation.request.prototype_id,
        transition: evaluation.request.transition,
        decision,
        operator_ref: operatorRef,
        expected_state: structuredClone(readiness.observed_state),
        source_branch: sourceBranch,
        blocker: blocker ?? null,
        correlation_id: evaluation.request.correlation_id,
        idempotency_key: evaluation.request.idempotency_key,
      },
      "decision_digest",
    ),
  );
}

export function createPrototypeMaturityReceipt({ decision, readback, completedAt }) {
  const outcome = decision.decision.startsWith("block-")
    ? "blocked"
    : decision.decision === "route-closeout"
      ? "routed-closeout"
      : "succeeded";
  const nextAction =
    decision.decision === "promote-candidate"
      ? { code: "baseline-promotion", owner_ref: "workspace-prototype-studio" }
      : decision.decision === "approve-baseline"
        ? { code: "movement-request", owner_ref: "workspace-prototype-studio" }
        : decision.decision === "route-closeout"
          ? { code: "prototype-closeout", owner_ref: "operator-orchestration-service" }
          : { code: "resolve-blocker", owner_ref: decision.blocker.owner_ref };
  return assertPrototypeMaturityArtifact(
    bindPrototypeMaturity(
      {
        schema_version: 1,
        artifact_type: "prototype-maturity-receipt",
        receipt_id: decision.decision_id.replace(
          /^prototype-maturity-decision:/,
          "prototype-maturity-receipt:",
        ),
        completed_at: completedAt,
        request_ref: structuredClone(decision.request_ref),
        packet_ref: structuredClone(decision.packet_ref),
        readiness_ref: structuredClone(decision.readiness_ref),
        decision_ref: prototypeMaturityReference(decision),
        readback_ref: prototypeMaturityReference(readback),
        prototype_id: decision.prototype_id,
        transition: decision.transition,
        decision: decision.decision,
        outcome,
        resulting_lifecycle: readback.observed_lifecycle,
        next_action: nextAction,
        correlation_id: decision.correlation_id,
        idempotency_key: decision.idempotency_key,
      },
      "receipt_digest",
    ),
  );
}

export const prototypeMaturityContractRoot = fileURLToPath(root);
