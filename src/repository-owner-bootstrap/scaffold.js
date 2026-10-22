import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { validateDeliveryArtEvidenceProfile } from "../delivery-art/review-evidence-acquisition.js";
import { HttpError } from "../errors.js";

const ROOT = new URL("../../templates/source-owner-bootstrap/", import.meta.url);
const PROFILE = "contracts/delivery-art-work-session/evidence-profile.json";
const SCHEMA = "contracts/delivery-art-work-session/evidence-profile.schema.json";
const METADATA = "contracts/delivery-art-work-session/source-bootstrap.json";
const CI = ".github/workflows/validate.yaml";
const ASSETS = Object.freeze({ "AGENTS.md": "AGENTS.md.template", "README.md": "README.md.template",
  Makefile: "Makefile.template", ".gitignore": "gitignore.template", "scripts/validate_owner.py": "validate_owner.py.template",
  "tests/test_owner_bootstrap.py": "test_owner_bootstrap.py.template", [CI]: "validate.yaml.template",
  ".github/CODEOWNERS": "CODEOWNERS.template", ".github/pull_request_template.md": "pull_request_template.md.template" });
const reviewGuidelines = readFileSync(new URL("review-guidelines.md.template", ROOT), "utf8");
const schemaText = readFileSync(new URL(`../../${SCHEMA}`, import.meta.url), "utf8");
const assets = Object.fromEntries(Object.entries(ASSETS).map(([target, asset]) => [target, readFileSync(new URL(asset, ROOT), "utf8")]));
export const SOURCE_OWNER_BOOTSTRAP_TEMPLATE = Object.freeze({ id: "source-owner-bootstrap-v1", owner_repo: "operator-orchestration-service",
  digest: canonicalDigest({ id: "source-owner-bootstrap-v1", assets, review_guidelines: reviewGuidelines, evidence_profile_schema: schemaText,
    engine: readFileSync(new URL("./scaffold.js", import.meta.url), "utf8") }) });
export const SOURCE_OWNER_BOOTSTRAP_PATHS = Object.freeze([...Object.keys(ASSETS), PROFILE, SCHEMA, METADATA].sort());
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const fail = message => { throw new HttpError(409, "repository_owner_bootstrap_plan_invalid", message); };
const byteDigest = value => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function ownerProfile(value, owner) {
  const profile = validateDeliveryArtEvidenceProfile(value, owner);
  const kinds = new Set(profile.commands.map(command => command.kind));
  if (!kinds.has("tests") || !kinds.has("validations") ||
      !profile.commands.some(command => command.conformance_binding === "matching-fidelity")) {
    fail("Select real owner tests and validations with the applicable evidence fidelity; bootstrap checks are not app evidence.");
  }
  return profile;
}

function reviewSection(text) {
  return typeof text === "string" ? /^## Review guidelines\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/im.exec(text)?.[1] ?? null : null;
}
function reviewControlsComplete(observedFiles) {
  const section = reviewSection(observedFiles?.["AGENTS.md"]);
  if (section !== null && ["source", "validation", "review", "authority"].some(term => !section.toLowerCase().includes(term))) {
    fail("Existing review guidance is incomplete; preserve independent policy for explicit owner review.");
  }
  const codeowners = observedFiles?.[".github/CODEOWNERS"];
  if (typeof codeowners === "string" && !codeowners.includes("@")) fail("Existing CODEOWNERS needs explicit owner review; do not replace it.");
  const template = observedFiles?.[".github/pull_request_template.md"];
  if (typeof template === "string") {
    if (["## Summary", "## Governance", "## Validation", "## Advisory Review"].some(heading => !template.includes(heading)) ||
        ["optional", "requested", "provider", "scope", "fix-now", "separate-work", "reject-with-reason"].some(term => !template.toLowerCase().includes(term))) {
      fail("Existing PR review template needs explicit owner review; do not replace independent controls.");
    }
  }
  return section !== null && typeof codeowners === "string" && typeof template === "string";
}

// Never execute preserved independent Makefiles, scripts or schema code on the
// host. Only these current trusted bytes run in the isolated control snapshot;
// actual guidance/profile/review files remain the exact committed data inputs.
export function trustedSourceOwnerValidationFiles(owner) {
  return Object.fromEntries(["Makefile", "scripts/validate_owner.py", "tests/test_owner_bootstrap.py"].map(name =>
    [name, assets[name].replaceAll("@@OWNER@@", owner)]).concat([[SCHEMA, schemaText]]));
}

// Existing independently owned controls are not missing scaffolding. Validate
// their actual fetched-base profile and retain them; never force a dummy PR or
// overwrite independent AGENTS/Makefile/CI with this template.
export function inspectExistingSourceOwnerControls({ ownerRepo, fetchedBase, observedFiles }) {
  if (observedFiles?.[PROFILE] === null) return null;
  if (!SHA.test(fetchedBase ?? "") || !/^[a-z0-9][a-z0-9._-]*$/.test(ownerRepo ?? "") ||
      ["AGENTS.md", "README.md", PROFILE].some(name => typeof observedFiles?.[name] !== "string" ||
        !observedFiles[name].trim() || Buffer.byteLength(observedFiles[name]) > 65_536)) {
    fail("An existing owner profile requires its actual bounded guidance and exact fetched source.");
  }
  let profile;
  try { profile = ownerProfile(JSON.parse(observedFiles[PROFILE]), ownerRepo); }
  catch { fail("The existing owner profile is invalid; do not overwrite it with a synthetic bootstrap profile."); }
  return { status: "existing-owner-controls", owner_repo: ownerRepo, fetched_base: fetchedBase,
    evidence_profile: structuredClone(profile), evidence_profile_digest: canonicalDigest(profile),
    source_change_required: !reviewControlsComplete(observedFiles), ci_present: Object.hasOwn(observedFiles, CI) ? observedFiles[CI] !== null : null,
    app_acceptance: false, inventory_admission: false, runtime_activation: false };
}

export function sourceOwnerBootstrapPaths(withCi) {
  if (typeof withCi !== "boolean") fail("Select the optional workflow explicitly.");
  return SOURCE_OWNER_BOOTSTRAP_PATHS.filter(name => name !== CI || withCi);
}

function marker(value) {
  if (typeof value !== "string" || value.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
      value.split("/").some(part => ["", ".", "..", ".git", ".github"].includes(part)) ||
      SOURCE_OWNER_BOOTSTRAP_PATHS.some(control => value === control || value.startsWith(`${control}/`))) {
    fail("Application markers must name bounded project files, not bootstrap controls or Git metadata.");
  }
  return value;
}

// Pure trusted scaffold producer. The broker must obtain authority and observed
// bytes from its verified proposed/custody/provider readers, never from the
// browser. This function does not authorize effects, execute app commands,
// create a checkout, issue a token, admit an owner, or build an application.
export function assertProposedSourceOwnerAuthority(authority) {
  const owner = authority?.owner_repo;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(owner ?? "") || authority.schema_version !== 1 ||
      !["proposed", "admitted"].includes(authority.classification) || authority.inventory_posture !== null ||
      authority.source_bootstrap_eligible !== true || authority.ordinary_source_eligible !== false ||
      authority.model_writes_allowed !== false || authority.canonical_mutation !== false || authority.runtime_activation !== false ||
      authority.intake_entry_ref?.id !== `repo:${owner}` || !DIGEST.test(authority.intake_entry_ref?.digest ?? "") ||
      !Number.isSafeInteger(authority.intake_entry_ref?.version) || authority.intake_entry_ref.version < 1) fail("Current proposed or admitted source-only authority before Inventory is required.");
  const binding = authority.provider_repository;
  if (!binding || Object.keys(binding).sort().join(",") !== "full_name,provider,provider_repository_id" || binding.provider !== "github" ||
      !/^[1-9][0-9]*$/.test(binding.provider_repository_id ?? "") || !Number.isSafeInteger(Number(binding.provider_repository_id)) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(binding.full_name ?? "")) fail("The proposed owner requires its exact bounded provider identity.");
  if (typeof authority.owner_purpose !== "string" || !authority.owner_purpose.trim() || !authority.owner_purpose.isWellFormed() ||
      Buffer.byteLength(authority.owner_purpose) > 8192) fail("The proposed owner purpose must be bounded real metadata.");
  return structuredClone(authority);
}

export function planSourceOwnerBootstrap({ authority, fetchedBase, profile, applicationMarkers, withCi, observedFiles }) {
  assertProposedSourceOwnerAuthority(authority);
  const owner = authority.owner_repo;
  if (!SHA.test(fetchedBase ?? "") || typeof withCi !== "boolean") fail("Select the exact provider base and optional CI intent.");
  if (Buffer.byteLength(JSON.stringify(profile) ?? "") > 32768) fail("Validation profile exceeds the bounded scaffold input.");
  const selectedProfile = ownerProfile(profile, owner);
  const existing = inspectExistingSourceOwnerControls({ ownerRepo: owner, fetchedBase, observedFiles });
  if (existing && canonicalDigest(existing.evidence_profile) !== canonicalDigest(selectedProfile)) fail("Preserve the actual existing owner evidence profile during control repair.");
  if (!Array.isArray(applicationMarkers) || applicationMarkers.length < 1 || applicationMarkers.length > 48) fail("Select the real project's bounded application marker files.");
  const markers = applicationMarkers.map(marker).sort();
  if (new Set(markers).size !== markers.length) fail("Application markers must be unique.");
  const metadata = { schema_version: 1, owner_repo: owner, template: SOURCE_OWNER_BOOTSTRAP_TEMPLATE,
    provider_repository: structuredClone(authority.provider_repository), intake_entry_ref: structuredClone(authority.intake_entry_ref),
    evidence_profile_digest: canonicalDigest(selectedProfile), application_markers: markers,
    app_acceptance: false, inventory_admission: false, runtime_activation: false };
  const wanted = Object.fromEntries(Object.entries(assets).filter(([name]) => name !== CI || withCi).map(([name, text]) =>
    [name, text.replaceAll("@@OWNER@@", owner).replaceAll("@@PURPOSE_JSON@@", JSON.stringify(authority.owner_purpose))]));
  wanted[PROFILE] = `${JSON.stringify(selectedProfile, null, 2)}\n`;
  wanted[SCHEMA] = schemaText;
  wanted[METADATA] = `${JSON.stringify(metadata, null, 2)}\n`;
  wanted["AGENTS.md"] += `\n${reviewGuidelines}`;
  if (!observedFiles || Object.getPrototypeOf(observedFiles) !== Object.prototype ||
      Object.keys(observedFiles).sort().join("\0") !== Object.keys(wanted).sort().join("\0")) {
    fail("Inspect every exact scaffold target at the selected provider base before planning effects.");
  }
  reviewControlsComplete(observedFiles);
  const files = [];
  for (const [path, generated] of Object.entries(wanted).sort(([a], [b]) => a.localeCompare(b))) {
    const before = observedFiles[path];
    if (before !== null && (typeof before !== "string" || Buffer.byteLength(before) > 65_536)) fail("Observed source is not a bounded regular UTF-8 file.");
    // Preserve all independent controls. The only allowed existing-file delta
    // is an exact append of absent review guidance, bound to its original bytes.
    let content = before === null ? generated : before;
    if (path === "AGENTS.md" && before !== null && reviewSection(before) === null) content = `${before}${before.endsWith("\n") ? "\n" : "\n\n"}${reviewGuidelines}`;
    if (Buffer.byteLength(content) > 65_536) fail("Generated owner control exceeds the finite source bound.");
    files.push({ path, action: before === null ? "create" : before === content ? "unchanged" : "replace", mode: "100644", content,
      expected_digest: before === null ? null : byteDigest(before), content_digest: byteDigest(content) });
  }
  const body = { schema_version: 1, workflow_id: "repository-owner-bootstrap-plan", owner_repo: owner,
    provider_repository: structuredClone(authority.provider_repository), intake_entry_ref: structuredClone(authority.intake_entry_ref),
    fetched_base: fetchedBase, template: SOURCE_OWNER_BOOTSTRAP_TEMPLATE, evidence_profile_digest: canonicalDigest(selectedProfile),
    application_markers: markers, ci_selected: withCi,
    requires_workflow_permission: files.some(file => file.path === CI && file.action === "create"),
    source_change_required: files.some(file => file.action !== "unchanged"), files,
    model_invoked: false, app_import: false, canonical_mutation: false, runtime_activation: false };
  return { ...body, plan_digest: canonicalDigest(body) };
}
