import { HttpError } from "../errors.js";

const WORKFLOWS = new Set(["readiness", "promotion", "runtime"]);
const PHASES = new Set(["prepared", "dispatching", "uncertain", "queued", "awaiting-approval", "in-progress", "awaiting-review", "applied", "no-change", "failed", "cancelled"]);
function fail() { throw new HttpError(502, "release_workflow_invalid", "The owner release workflow data is invalid."); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail();
  return value;
}
function text(value, max = 2048, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) fail();
}

export function assertNativeReleaseInput(value, capabilityId) {
  const input=object(value,["workflow_id","values"]);
  if(!WORKFLOWS.has(input.workflow_id)||capabilityId!=="release.openclaw."+input.workflow_id||!input.values||typeof input.values!=="object"||Array.isArray(input.values)||Object.keys(input.values).length>24)fail();
  for(const [key,value]of Object.entries(input.values)){if(!/^[a-z][a-z0-9_:-]{0,149}$/.test(key))fail();text(value,2048,true);}
  return input;
}

export function assertNativeReleaseWorkflow(value, workflowId, sourceVersion) {
  const item = object(value, ["schema_version", "workflow_id", "capability_id", "action", "available", "unavailable_reason", "source_version", "fields"]);
  if (item.schema_version !== 1 || !WORKFLOWS.has(item.workflow_id) || item.workflow_id !== workflowId || item.source_version !== sourceVersion || item.capability_id !== "release.openclaw." + workflowId || item.action !== (workflowId === "runtime" ? "governed-release.change-runtime-lifecycle" : "governed-release.execute-step") || typeof item.available !== "boolean") fail();
  if (item.available ? item.unavailable_reason !== null : typeof item.unavailable_reason !== "string" || !item.unavailable_reason.trim() || item.unavailable_reason.length > 1000) fail();
  if (!Array.isArray(item.fields) || (item.available && item.fields.length < 1) || item.fields.length > 24) fail();
  const ids = new Set();
  for (const raw of item.fields) {
    const field = object(raw, ["id", "label", "description", "kind", "required", "options", "default_value"]);
    text(field.id, 150); text(field.label, 200); text(field.description); text(field.default_value, 2048, true);
    if (!/^[a-z][a-z0-9_:-]*$/.test(field.id) || ids.has(field.id) || typeof field.required !== "boolean" || !["text", "select"].includes(field.kind) || !Array.isArray(field.options) || field.options.length > 8 || (field.kind === "text" ? field.options.length !== 0 : field.options.length === 0)) fail();
    ids.add(field.id);
    const values = new Set();
    for (const raw of field.options) {
      const option = object(raw, ["label", "value"]); text(option.label, 200); text(option.value, 200);
      if (values.has(option.value)) fail(); values.add(option.value);
    }
    if (field.kind === "select" && field.default_value && !values.has(field.default_value)) fail();
  }
  return item;
}

export function assertReleaseWorkflowEvidence(value, action) {
  const item = object(value, ["schema_version", "workflow_id", "phase", "run_id", "run_url", "pull_request_url", "branch", "merge_commit", "desired_state_verified"]);
  if (item.schema_version !== 1 || !WORKFLOWS.has(item.workflow_id) || !PHASES.has(item.phase) || typeof item.desired_state_verified !== "boolean" || item.desired_state_verified !== ["applied", "no-change"].includes(item.phase)) fail();
  if (action !== (item.workflow_id === "runtime" ? "governed-release.change-runtime-lifecycle" : "governed-release.execute-step")) fail();
  if (item.run_id !== null && (!Number.isSafeInteger(item.run_id) || item.run_id < 1)) fail();
  if (item.run_url !== (item.run_id === null ? null : "https://github.com/mfshaf7/platform-engineering/actions/runs/" + item.run_id)) fail();
  if (item.pull_request_url !== null && (typeof item.pull_request_url !== "string" || !/^https:\/\/github\.com\/mfshaf7\/platform-engineering\/pull\/[1-9][0-9]{0,15}$/.test(item.pull_request_url))) fail();
  const prefix = item.workflow_id === "readiness" ? "stage/approve-" : item.workflow_id === "promotion" ? "promote/prod-" : "prod/openclaw-(?:live|traffic-stopped|suspended|quarantined)-";
  if (item.branch !== null && (item.run_id === null || typeof item.branch !== "string" || !new RegExp("^" + prefix + item.run_id + "$" ).test(item.branch))) fail();
  if (item.merge_commit !== null && (typeof item.merge_commit !== "string" || !/^[0-9a-f]{40}$/.test(item.merge_commit))) fail();
  if (item.phase === "applied" && (!item.merge_commit || !item.pull_request_url || !item.branch)) fail();
  if (["queued", "awaiting-approval", "in-progress", "awaiting-review", "applied", "no-change", "cancelled"].includes(item.phase) && item.run_id === null) fail();
  if (item.merge_commit !== null && item.phase !== "applied") fail();
  return item;
}
