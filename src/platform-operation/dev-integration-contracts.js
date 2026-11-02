import { HttpError } from "../errors.js";

const invalid = () => { throw new HttpError(400, "dev_integration_intent_invalid", "Review the complete, bounded profile request and its exact approval."); };
const object = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 4096) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const slug = value => text(value, 128) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const list = (value, check = text) => Array.isArray(value) && value.length <= 128 && value.every(entry => check(entry)) && new Set(value).size === value.length;
function exact(value, fields) {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => !(key in value))) invalid();
}

export function normalizeDevIntegrationRequest(value) {
  exact(value, ["request_id", "expected_source_version", "request", "approval"]);
  if (!text(value.request_id, 128) || !/^devint-request:[A-Za-z0-9._:-]+$/.test(value.request_id) ||
      !/^registry:[a-f0-9]{40}$/.test(value.expected_source_version)) invalid();
  exact(value.approval, ["decision", "intent_digest"]);
  if (value.approval.decision !== "approved" || !/^sha256:[a-f0-9]{64}$/.test(value.approval.intent_digest)) invalid();
  const r = value.request;
  exact(r, ["profileId", "ownerRepo", "purpose", "laneClass", "participatingRepos", "runtimePlatform", "runtimeStateModel",
    "dependencies", "expectedWrites", "securityTriggers", "persistence", "replacesProfileId"]);
  if (!slug(r.profileId) || !slug(r.ownerRepo) || !text(r.purpose, 4000) ||
      !["prototype-devint", "integration-devint", "governed-devint"].includes(r.laneClass) ||
      !list(r.participatingRepos, slug) || !r.participatingRepos.includes(r.ownerRepo) ||
      !text(r.runtimePlatform, 128) || !["persistent", "disposable"].includes(r.runtimeStateModel) ||
      !list(r.dependencies, entry => text(entry, 512)) ||
      !list(r.securityTriggers, entry => ["identity", "secrets", "runtime-privilege", "ai-review"].includes(entry)) ||
      (r.replacesProfileId !== null && !slug(r.replacesProfileId))) invalid();
  exact(r.expectedWrites, ["classification", "targets"]);
  if (!["none", "prototype-local", "canonical-backend", "external-sandbox"].includes(r.expectedWrites.classification) ||
      !list(r.expectedWrites.targets, entry => text(entry, 512)) ||
      (r.expectedWrites.classification === "none") !== (r.expectedWrites.targets.length === 0)) invalid();
  if (r.runtimeStateModel === "disposable") {
    if (r.persistence !== null) invalid();
  } else {
    exact(r.persistence, ["justification", "retainedDataScope", "suspendResumeSemantics", "storageRequirement",
      "destructiveResetSemantics", "cutoverPlan", "sharedSmokeMutationMode", "disposableCompanionProfileId"]);
    const p = r.persistence;
    if (![p.justification, p.retainedDataScope, p.suspendResumeSemantics, p.storageRequirement, p.destructiveResetSemantics].every(entry => text(entry, 4000)) ||
        typeof p.cutoverPlan !== "string" || p.cutoverPlan.length > 4000 || (r.replacesProfileId && !p.cutoverPlan.trim()) ||
        p.sharedSmokeMutationMode !== "read-only" || (p.disposableCompanionProfileId !== null && !slug(p.disposableCompanionProfileId))) invalid();
  }
  if (JSON.stringify(value).length > 32768) invalid();
  return structuredClone(value);
}

export function devIntegrationRequestIntent(value) {
  return { request_id: value.request_id, expected_source_version: value.expected_source_version, request: value.request };
}

export function assertDevIntegrationProfileProjection(value) {
  try {
    exact(value, ["schema_version", "source_version", "observed_at", "owner_versions", "profiles", "request_options", "page"]);
    if (value.schema_version !== 1 || !/^registry:[a-f0-9]{40}$/.test(value.source_version) ||
        !Number.isFinite(Date.parse(value.observed_at)) || !object(value.owner_versions) ||
        Object.entries(value.owner_versions).some(([key, revision]) => !slug(key) || (revision !== null && !/^[a-f0-9]{40}$/.test(revision))) ||
        !Array.isArray(value.profiles) || value.profiles.length > 25) invalid();
    exact(value.request_options, ["owner_repos", "lane_classes", "runtime_platforms", "state_models"]);
    for (const entries of Object.values(value.request_options)) if (!list(entries, entry => text(entry, 128))) invalid();
    exact(value.page, ["offset", "limit", "total", "next_offset"]);
    if (!Number.isSafeInteger(value.page.offset) || value.page.offset < 0 || !Number.isSafeInteger(value.page.total) || value.page.total < 0 ||
        !Number.isSafeInteger(value.page.limit) || value.page.limit < 1 || value.page.limit > 25 ||
        (value.page.next_offset !== null && (!Number.isSafeInteger(value.page.next_offset) || value.page.next_offset <= value.page.offset))) invalid();
    const ids = new Set();
    for (const p of value.profiles) {
      exact(p, ["profile_id", "owner_repo", "lifecycle", "lane_class", "purpose", "participating_repos", "dependencies", "request_record_ref",
        "runtime", "expected_writes", "persistence", "security_owner", "security_triggers", "admission_refs", "source", "stage_handoff", "gaps"]);
      if (!slug(p.profile_id) || ids.has(p.profile_id) || !slug(p.owner_repo) ||
          !["active", "proposed", "build-admitted", "suspended", "retired"].includes(p.lifecycle) ||
          !["prototype-devint", "integration-devint", "governed-devint"].includes(p.lane_class)) invalid();
      ids.add(p.profile_id);
      for (const key of ["purpose", "request_record_ref", "security_owner"]) if (p[key] !== null && !text(p[key])) invalid();
      for (const key of ["participating_repos", "dependencies", "admission_refs", "gaps"]) if (!list(p[key])) invalid();
      exact(p.runtime, ["platform", "state_model", "observation"]);
      if ((p.runtime.platform !== null && !text(p.runtime.platform, 128)) || ![null, "persistent", "disposable"].includes(p.runtime.state_model)) invalid();
      exact(p.runtime.observation, ["state", "observed_at", "source_ref"]);
      const observation = p.runtime.observation;
      if (!["unknown", "running", "stopped", "degraded", "failed", "starting", "stopping", "unavailable"].includes(observation.state) ||
          (observation.observed_at !== null && !Number.isFinite(Date.parse(observation.observed_at))) ||
          (observation.source_ref !== null && !text(observation.source_ref))) invalid();
      if (observation.state !== "unknown" && (!observation.observed_at || !observation.source_ref)) invalid();
      if (p.expected_writes !== null) {
        exact(p.expected_writes, ["classification", "targets"]);
        if (!["none", "prototype-local", "canonical-backend", "external-sandbox"].includes(p.expected_writes.classification) || !list(p.expected_writes.targets)) invalid();
      }
      if (p.persistence !== null) {
        exact(p.persistence, ["justification", "retained_data_scope", "suspend_resume_semantics", "storage_size_or_class", "reset_semantics", "cutover_plan"]);
        if (Object.values(p.persistence).some(entry => entry !== null && !text(entry))) invalid();
      }
      if (p.security_triggers !== null && !list(p.security_triggers, entry => ["identity", "secrets", "runtime-privilege", "ai-review"].includes(entry))) invalid();
      exact(p.source, ["ref", "registry_revision", "owner_revision"]);
      if (!text(p.source.ref) || !/^[a-f0-9]{40}$/.test(p.source.registry_revision) ||
          (p.source.owner_revision !== null && !/^[a-f0-9]{40}$/.test(p.source.owner_revision))) invalid();
      exact(p.stage_handoff, ["owner_repo", "governed_surface", "required_checks", "result", "check_results", "smoke_summary_ref", "session_manifest_ref", "promotion_report_ref"]);
      const h = p.stage_handoff;
      for (const key of ["owner_repo", "governed_surface", "smoke_summary_ref", "session_manifest_ref", "promotion_report_ref"]) if (h[key] !== null && !text(h[key])) invalid();
      if (h.result !== "unknown" || !Array.isArray(h.check_results) || h.check_results.length || !Array.isArray(h.required_checks) || h.required_checks.length > 128) invalid();
      for (const check of h.required_checks) { exact(check, ["id", "label"]); if (!text(check.id, 128) || !text(check.label, 1024)) invalid(); }
    }
    return structuredClone(value);
  } catch {
    throw new HttpError(502, "dev_integration_projection_invalid", "The profile owner returned an invalid bounded projection.");
  }
}
