import { canonicalDigest, canonicalStringify } from "../delivery-art/canonical-json.js";
import { assertSourceCredentialSubject, assertSourceCredentialTimestamp } from "../platform-operation/source-credentials.js";
import { assertLifecycleContextResult, lifecycleContextDigest, textDigest } from "./context-contract.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const REVISION = /^[0-9a-f]{40}$/;
const CHUNK_BYTES = 120_000;

// The scope comes from the retained, canonical owner inspection, never from a
// model or browser-selected path. Apply uses this same predicate as capture.
export function prototypeSourcePathAllowed(value, scope) {
  if (typeof value !== "string" || value.length > 240 || !/^[A-Za-z0-9._/-]+$/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) return false;
  if (value === scope?.design_profile) return true;
  if (!scope?.source_root || !value.startsWith(`${scope.source_root}/`)) return false;
  const parts = value.slice(scope.source_root.length + 1).split("/");
  // App source is writable; owner controls, credentials and automation are not.
  return !parts.some(part => /^(?:\.github|\.gitlab|\.codex|\.claude|node_modules|\.venv)$/i.test(part) ||
    /^(?:agents\.md|claude\.md|\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(part) || /\.(?:pem|p12|pfx|key)$/i.test(part));
}

export function assertPrototypeSourceCapture(record, capture) {
  const { context_digest: digest, ...body } = capture ?? {};
  const session = record.session;
  const scope = record.binding.model_source_scope;
  if (!session || capture?.schema_version !== 1 || capture.session_id !== session.session_id ||
      capture.owner_repo !== "workspace-prototype-studio" || capture.landing_unit_id !== record.binding.source_start.landing_unit_id ||
      !REVISION.test(capture.head_commit ?? "") || capture.clean !== true ||
      !Array.isArray(capture.files) || capture.files.length > 48 ||
      !Array.isArray(capture.tree?.paths) || capture.tree.paths.length > 5000 ||
      capture.tree.paths.some(value => !prototypeSourcePathAllowed(value, scope)) ||
      new Set(capture.files.map(file => file.path)).size !== capture.files.length ||
      capture.files.some(file => !prototypeSourcePathAllowed(file.path, scope) || typeof file.content !== "string" ||
        Buffer.byteLength(file.content) > 65_536 || file.size_bytes !== Buffer.byteLength(file.content) || textDigest(file.content) !== file.content_digest) ||
      capture.admitted_bytes !== capture.files.reduce((sum, file) => sum + file.size_bytes, 0) || capture.admitted_bytes > 256 * 1024 ||
      digest !== textDigest(JSON.stringify(body))) {
    throw prototypeAuthoringError("context_capture_invalid", "Prototype capture must retain the exact private session, source scope, clean head and bounded content digests.", 502);
  }
  return capture;
}

function source({ id, sourceClass, sourceRef, revision, capturedAt, value }) {
  const content = canonicalStringify(value);
  if (Buffer.byteLength(content) > CHUNK_BYTES) throw prototypeAuthoringError("context_oversized", "Prototype context exceeds its bounded projection source size.", 400);
  return { source_id: id, source_class: sourceClass, source_ref: sourceRef, source_revision: revision,
    captured_at: capturedAt, availability: "available", content, content_digest: textDigest(content), unavailable_reason: null };
}

export function buildPrototypeContextRequest({ record, capture, executionId, budgetTokens, capturedAt }) {
  assertPrototypeSourceCapture(record, capture);
  assertSourceCredentialTimestamp(capturedAt, "captured_at");
  if (!ID.test(executionId ?? "") || !Number.isInteger(budgetTokens) || budgetTokens < 1 || budgetTokens > 8000) {
    throw prototypeAuthoringError("context_request_invalid", "Prototype projection requires an exact execution and bounded token budget.", 400);
  }
  const subject = assertSourceCredentialSubject({ ...record.binding.subject, source_revision: capture.head_commit });
  const sources = [source({ id: "prototype-validation", sourceClass: "validation", sourceRef: subject.registry_ref,
    revision: subject.registry_revision, capturedAt, value: {
      subject, source_request_id: record.request.request_id, request_digest: record.request_digest,
      objective: record.request.objective, objective_digest: canonicalDigest(record.request.objective),
      model_source_scope: record.binding.model_source_scope,
      source_context: { context_digest: capture.context_digest, head_commit: capture.head_commit, tree: capture.tree },
      authority: { may_mutate_registry: false, may_approve_baseline: false, may_activate_runtime: false },
    } })];
  // Chunk file payloads to the existing CGG source size, not to a fixed app
  // file count. No unrelated owner repository or fabricated ART source enters.
  let files = [];
  const append = () => {
    if (!files.length) return;
    sources.push(source({ id: `prototype-source-${sources.length}`, sourceClass: "repository", sourceRef: subject.source_ref,
      revision: capture.head_commit, capturedAt, value: { files } }));
    files = [];
  };
  for (const file of capture.files) {
    if (Buffer.byteLength(canonicalStringify({ files: [...files, file] })) > CHUNK_BYTES) append();
    files.push(file);
  }
  append();
  sources.push({ source_id: "prototype-runtime", source_class: "runtime", source_ref: `${subject.source_ref}/runtime`,
    source_revision: null, captured_at: capturedAt, availability: "unavailable", content: null, content_digest: null, unavailable_reason: "not_configured" });
  if (sources.length > 16) throw prototypeAuthoringError("context_oversized", "Prototype capture exceeds the finite CGG source count.", 400);
  const key = canonicalDigest({ request: record.request_digest, session: record.session.session_id, execution: executionId }).slice(7);
  return { schema_version: 1, request_id: `prototype-context:${key}`, correlation_id: executionId, idempotency_key: `prototype-context:${key}`,
    workflow_session_id: record.session.session_id, execution_id: executionId, subject,
    landing_unit_id: record.binding.source_start.landing_unit_id, operator: { id: record.operator_id },
    lifecycle: { operation: "continue", state: "source-work", next_action: "prototype-source-draft-required" },
    requested_at: capturedAt, sources, sources_digest: lifecycleContextDigest(sources), budget_tokens: budgetTokens };
}

export function createPrototypeLifecycleContext({ client, store }) {
  if (typeof client?.project !== "function" || !client.callerId || typeof store?.readArtifact !== "function" || typeof store?.writeArtifact !== "function") {
    throw new TypeError("Prototype context requires the existing commissioned CGG client and private artifact store.");
  }
  return {
    prepare(input) {
      const request = buildPrototypeContextRequest(input);
      // Caller retains this immutable reference in request metadata BEFORE
      // dispatch, so lost acknowledgements replay the exact timestamp/content.
      return store.writeArtifact(input.record.request.request_id, request);
    },
    async project({ record, requestRef }) {
      if (requestRef?.request_id !== record.request.request_id) throw prototypeAuthoringError("context_request_mismatch", "Projection reference belongs to another source request.");
      const request = store.readArtifact(requestRef);
      if (request.workflow_session_id !== record.session?.session_id || request.operator?.id !== record.operator_id ||
          request.subject?.prototype_id !== record.request.prototype_id || request.landing_unit_id !== record.binding.source_start.landing_unit_id ||
          canonicalDigest({ ...request.subject, source_revision: record.binding.subject.source_revision }) !== canonicalDigest(record.binding.subject) ||
          request.sources_digest !== lifecycleContextDigest(request.sources)) {
        throw prototypeAuthoringError("context_request_mismatch", "Retained context request does not belong to this canonical Prototype session.");
      }
      const result = assertLifecycleContextResult(await client.project(request), request, client.callerId,
        message => prototypeAuthoringError("context_response_invalid", message, 502));
      const resultRef = store.writeArtifact(record.request.request_id, result);
      return { result_ref: resultRef, packet_ref: result.packet_ref, artifact_digest: result.artifact_digest,
        redaction_receipt_ref: result.redaction_receipt_ref, projection_receipt_ref: result.projection_receipt_ref,
        captured_at: request.requested_at, source_revision: request.subject.source_revision, content: result.content };
    },
  };
}
