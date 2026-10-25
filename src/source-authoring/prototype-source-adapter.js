import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "../errors.js";
import { assertSourceCredentialSubject } from "../platform-operation/source-credentials.js";
import { createDeliveryArtWorkSessionSourceAdapter } from "../delivery-art/work-session-cli-adapters.js";
import { assertPrototypeChangeSet } from "./prototype-change-set.js";
import { assertPrototypeSourceSession, prototypeWorktreeRelativePath } from "./prototype-session.js";
import { prototypeSourcePathAllowed } from "./prototype-context.js";
import { textDigest } from "./context-contract.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertPrototypeOwnerChangeSet, prototypeOwnerChangeSet, prototypeOwnerPreparationPath } from "./prototype-owner-preparation.js";
import { prototypeDeliveryOwnerChangeSet, prototypeDeliveryPreparationRequest, prototypeDeliveryPreparationPathAllowed } from "./prototype-delivery-preparation.js";

const REVISION = /^[0-9a-f]{40}$/;
const PROTOTYPE = /^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Canonical record existence/freshness belongs to the broker's Studio reader.
// This executor adapter reads only the exact committed Studio snapshot already
// selected there. It neither trusts browser file coordinates nor mints tokens.
export function createPrototypeSourceAdapter({ workspaceRoot, python = "python3", execute = execFileSync, agentSourceIdentity = null }) {
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) throw new TypeError("An absolute admitted workspace root is required.");
  const owner = path.join(workspaceRoot, "workspace-prototype-studio");
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", PYTHONDONTWRITEBYTECODE: "1" };
  const git = (root, ...args) => String(execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  })).trim();
  const source = createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot, agentSourceIdentity,
    execFileSyncImpl: execute, worktreeRelativePath: prototypeWorktreeRelativePath });
  const session = input => assertPrototypeSourceSession(input?.session, input?.prototype_id);
  function prepareOwner(input) {
    const selected = session(input);
    if (selected.owner_preparation?.kind !== "delivery-packet") prototypeOwnerPreparationPath(selected);
    let temporary;
    try {
      git(owner, "merge-base", "--is-ancestor", selected.subject.source_revision, "refs/remotes/origin/main");
      temporary = mkdtempSync(path.join(tmpdir(), "oos-prototype-prepare-"));
      const snapshot = path.join(temporary, "source");
      execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", owner, snapshot], {
        env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      });
      git(snapshot, "checkout", "--detach", selected.subject.source_revision);
      if (selected.owner_preparation.kind === "delivery-packet") {
        const request = prototypeDeliveryPreparationRequest(selected);
        const requestPath = path.join(temporary, "request.json");
        writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
        const runPacket = args => execute(python, [path.join(owner, "scripts/prototype_delivery_packet.py"), "--repo-root", snapshot, ...args], {
          env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        });
        const emitted = JSON.parse(String(runPacket(["emit", "--request", requestPath])));
        const slug = selected.prototype_id.slice("prototype:".length);
        const packetId = `${slug}-${String(emitted.packet_digest).slice(7)}`;
        const packetPath = `records/delivery-packets/${packetId}.json`;
        if (!["emitted", "replayed"].includes(emitted.status) || !/^sha256:[0-9a-f]{64}$/.test(emitted.packet_digest ?? "") ||
            emitted.packet_ref !== `record://delivery-packets/${packetId}`) throw new Error("Native packet identity is invalid.");
        const checked = JSON.parse(String(runPacket(["validate", "--packet", path.join(snapshot, packetPath)])));
        if (checked.status !== "valid" || checked.packet_ref !== emitted.packet_ref || checked.packet_digest !== emitted.packet_digest) throw new Error("Native packet validation did not retain the emission.");
        const paths = [...git(snapshot, "diff", "--name-only").split("\n"), ...git(snapshot, "ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean).sort();
        if (paths.length !== 2 || !paths.includes("prototypes.yaml") || !paths.includes(packetPath) ||
            paths.some(value => !prototypeDeliveryPreparationPathAllowed(value, selected))) throw new Error("Packet emitter changed unexpected owner files.");
        const operations = paths.map(file => {
          const absolute = path.join(snapshot, file), stat = lstatSync(absolute);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536) throw new Error("Owner file exceeds its native source bound.");
          const content = readFileSync(absolute, "utf8");
          const prior = file === "prototypes.yaml" ? String(execute("git", ["-C", snapshot, "show", `${selected.subject.source_revision}:${file}`], {
            env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
          })) : null;
          return { action: prior === null ? "create" : "replace", path: file, content, expected_digest: prior === null ? null : textDigest(prior) };
        });
        const prepared = prototypeDeliveryOwnerChangeSet({ session: selected, request, operations });
        assertPrototypeOwnerChangeSet(prepared.change_set, selected);
        return prepared;
      }
      const { kind: _kind, decision_ref, ...intent } = selected.owner_preparation;
      const request = { schema_version: 1, prototype_id: selected.prototype_id, source_revision: selected.subject.source_revision,
        operator: { id: selected.operator.id, decision_ref }, ...intent };
      const requestPath = path.join(temporary, "request.json");
      writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
      const output = execute(python, [path.join(owner, "scripts/prototype_authoring.py"), "--repo-root", snapshot,
        "plan-preview", "--request", requestPath], { env, encoding: "utf8", timeout: 30_000,
        maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      const plan = JSON.parse(String(output));
      const changeSet = prototypeOwnerChangeSet(plan, selected);
      if (git(snapshot, "status", "--porcelain", "--untracked-files=normal")) throw new Error("Owner preparation mutated its snapshot.");
      return { change_set: changeSet, plan_digest: plan.plan_digest, request_digest: plan.request_digest,
        authority: "workspace-prototype-studio", model_invoked: false, runtime_activated: false };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      try {
        const ownerFailure = JSON.parse(String(error.stdout));
        if (ownerFailure.status === "rejected" && /^[a-z][a-z0-9_]{0,95}$/.test(ownerFailure.code ?? "")) {
          throw prototypeAuthoringError(`owner_preparation_rejected_${ownerFailure.code}`, "The commissioned Studio owner rejected preparation; resolve its named prerequisite before an explicitly linked retry.");
        }
      } catch (bounded) { if (bounded instanceof HttpError) throw bounded; }
      throw prototypeAuthoringError("owner_preparation_unavailable", "The exact committed source could not be prepared through its commissioned Studio owner control.", 503);
    } finally {
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    }
  }
  const provider = (root, ...args) => String(execute("gh", args, { cwd: root, encoding: "utf8", timeout: 30_000,
    maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })).trim();
  async function inspectPullRequest(input) {
    const selected = session(input); const observed = await source.inspectPullRequest(selected);
    if (observed.state !== "open") return { ...observed, checks: { state: "unavailable", head_commit: observed.head_commit ?? null } };
    const policy = agentSourceIdentity?.reviewPolicy({ session: selected });
    if (!policy?.repository || !REVISION.test(observed.head_commit ?? "")) throw prototypeAuthoringError("review_policy_unavailable", "The canonical Prototype source review policy is unavailable.", 503);
    const runs = JSON.parse(provider(owner, "api", `/repos/${policy.repository}/commits/${observed.head_commit}/check-runs?per_page=100`));
    const validators = runs.check_runs?.filter(run => run.name === "validate" && run.head_sha === observed.head_commit && run.app?.slug === "github-actions") ?? [];
    const latest = validators.sort((left, right) => Number(left.id) - Number(right.id)).at(-1);
    const state = !latest || latest.status !== "completed" ? "pending" : latest.conclusion === "success" ? "pass" : "fail";
    return { ...observed, checks: { state, head_commit: observed.head_commit, required: ["validate"] } };
  }
  async function validateSource(input) {
    const selected = session(input); const worktree = await source.resolveWorktree(selected);
    if (!worktree || !REVISION.test(input.expected_head ?? "") || git(worktree, "rev-parse", "HEAD") !== input.expected_head ||
        git(worktree, "status", "--porcelain", "--untracked-files=normal")) throw prototypeAuthoringError("validation_source_changed", "Validate the exact clean committed Prototype source before review.");
    const changed = git(worktree, "diff", "--name-only", selected.landing_unit.base_commit, input.expected_head).split("\n").filter(Boolean);
    if (selected.owner_preparation) {
      const planned = prepareOwner(input).change_set;
      if (changed.length !== planned.operations.length || planned.operations.some(operation => !changed.includes(operation.path) ||
          textDigest(String(execute("git", ["-C", worktree, "show", `${input.expected_head}:${operation.path}`], {
            env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
          }))) !== textDigest(operation.content))) {
        throw prototypeAuthoringError("owner_change_set_invalid", "Reviewed owner metadata must exactly match the commissioned deterministic plan.");
      }
    } else if (!changed.length || changed.some(value => !prototypeSourcePathAllowed(value, selected.model_source_scope))) throw prototypeAuthoringError("change_set_scope_denied", "Prototype review cannot include owner control or unrelated source changes.");
    git(worktree, "fetch", "origin", "main");
    const base = git(worktree, "rev-parse", "origin/main");
    let output;
    try {
      // Model writes cannot change Makefile, tests or scripts. Run the selected
      // Studio owner's real CI-equivalent command, not an invented app toolchain.
      output = String(execute("make", ["validate"], { cwd: worktree, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
        encoding: "utf8", timeout: 180_000, maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
    } catch { throw prototypeAuthoringError("owner_validation_failed", "The selected Studio native validation failed; no review or merge was authorized."); }
    if (git(worktree, "rev-parse", "HEAD") !== input.expected_head || git(worktree, "status", "--porcelain", "--untracked-files=normal")) throw prototypeAuthoringError("validation_source_changed", "Source changed during owner validation.");
    const receipt = { schema_version: 1, session_id: selected.session_id, source_revision: input.expected_head, base_ref: "origin/main", base_revision: base,
      command: "make validate", result: "pass", log_digest: textDigest(output), changed_files: changed.sort(), recorded_at: new Date().toISOString() };
    return { ...receipt, receipt_digest: canonicalDigest(receipt) };
  }
  async function exactReview(input, { requireApproval = false } = {}) {
    const selected = session(input); const observed = await inspectPullRequest(input);
    if (observed.state !== "open" || observed.head_commit !== input.expected_pull_request?.head_commit ||
        observed.url !== input.expected_pull_request?.url || observed.checks.state !== "pass" ||
        (requireApproval && observed.review?.approved !== true)) throw prototypeAuthoringError("review_binding_changed", "The exact Prototype PR head, owner CI or human approval is not ready.");
    agentSourceIdentity.assertHumanMergeAuthority({ repoRoot: owner, session: selected });
    return { selected, observed };
  }
  return {
    ensureOwnedWorktree(input) { return source.ensureOwnedWorktree(session(input)); },
    inspectAgentSource(input) { return source.inspectAgentSource(session(input)); },
    inspectPullRequest,
    validateSource,
    async approvePullRequest(input) {
      const { observed } = await exactReview(input);
      await validateSource({ ...input, expected_head: observed.head_commit });
      provider(owner, "pr", "review", observed.url, "--approve", "--body", `Reviewed exact Prototype source head ${observed.head_commit}; native Studio validation and exact-head owner CI pass. No baseline or runtime acceptance is implied.`);
      const approved = await inspectPullRequest(input);
      if (approved.head_commit !== observed.head_commit || approved.review?.approved !== true) throw prototypeAuthoringError("review_unconfirmed", "Human review acknowledgement is uncertain; reconcile this same PR head.");
      return approved;
    },
    async mergePullRequest(input) {
      const existing = await inspectPullRequest(input);
      if (existing.state === "merged" && existing.url === input.expected_pull_request?.url && existing.head_commit === input.expected_pull_request?.head_commit && REVISION.test(existing.merge_commit ?? "")) return existing;
      const { selected, observed } = await exactReview(input, { requireApproval: true });
      await validateSource({ ...input, expected_head: observed.head_commit });
      return source.mergePullRequest(selected, observed);
    },
    async retireSourceResources(input) {
      const selected = session(input); const observed = await inspectPullRequest(input);
      if (observed.state !== "merged" || !REVISION.test(observed.merge_commit ?? "") || observed.head_commit !== input.expected_pull_request?.head_commit ||
          observed.url !== input.expected_pull_request?.url) throw prototypeAuthoringError("merged_readback_required", "Prove this same Prototype source PR merged before retiring its resources.");
      const types = ["git-worktree", "git-local-branch", "git-remote-branch"];
      if (!Array.isArray(input.resources) || input.resources.length !== 3 || new Set(input.resources.map(resource => resource.resource_type)).size !== 3 ||
          input.resources.some(resource => !types.includes(resource.resource_type) || resource.locator?.repo !== selected.owner_repo || resource.locator?.ownership_marker !== selected.session_id ||
            (resource.resource_type === "git-worktree" ? resource.locator.workspace_relative_path !== prototypeWorktreeRelativePath(selected)
              : resource.locator.branch !== selected.landing_unit.branch) || (resource.resource_type === "git-remote-branch" && resource.locator.remote !== "origin"))) {
        throw prototypeAuthoringError("resource_binding_invalid", "Only retained resources of this exact Prototype source session can retire.", 400);
      }
      await source.prepareResourceRetirementExecution(selected);
      const planned = await source.planResourceRetirement({ manifest: { resources: input.resources }, pullRequest: observed, session: selected });
      for (const resource of planned) if (resource.outcome === "eligible") await source.retireResource({ resource, pullRequest: observed, session: selected });
      const results = await source.planResourceRetirement({ manifest: { resources: input.resources }, pullRequest: observed, session: selected });
      return { schema_version: 1, session_id: selected.session_id, pull_request: observed, resources: results,
        complete: results.every(resource => resource.outcome === "removed") };
    },
    publishAgentSource(input) { return source.publishAgentSource(session(input)); },
    prepareOwner,
    validateSourceRealization(input) {
      const selected = session(input);
      if (selected.owner_preparation) throw prototypeAuthoringError("owner_change_set_invalid", "Trusted owner preparations remain read-only in the source editor.");
      assertPrototypeChangeSet(input.change_set, selected);
      return source.validateSourceRealization(selected, input.change_set);
    },
    async captureRealizationContext(input) {
      const selected = session(input);
      const explicit = input.requested_paths;
      if (explicit !== undefined && (!Array.isArray(explicit) || explicit.length > 48 ||
          new Set(explicit).size !== explicit.length || explicit.some(value => !prototypeSourcePathAllowed(value, selected.model_source_scope)))) {
        throw prototypeAuthoringError("context_scope_denied", "Read only a bounded set of files from this Prototype's canonical app/design scope.");
      }
      if (input.tree_only !== undefined && typeof input.tree_only !== "boolean") throw prototypeAuthoringError("context_scope_denied", "Use the exact source-tree selector.");
      const worktree = await source.resolveWorktree(selected);
      if (!worktree) throw prototypeAuthoringError("worktree_missing", "Authorize and prepare this Prototype source session before capture.");
      const paths = git(worktree, "ls-files").split("\n").filter(value => prototypeSourcePathAllowed(value, selected.model_source_scope)).sort();
      if (!paths.length && input.tree_only !== true) throw prototypeAuthoringError("source_empty", "The selected Prototype has no readable app or design source.");
      const capture = await source.captureRealizationContext(selected, {
        requestedPaths: explicit ?? paths.slice(0, 48), treeOnly: input.tree_only ?? false,
      });
      // The shared Git reader may inspect owner metadata internally, but only
      // the selected Prototype's file names and bytes may leave this adapter.
      const { context_digest: _digest, ...body } = capture;
      body.tree = { paths: paths.slice(0, 5000), total_path_count: paths.length, truncated: paths.length > 5000 };
      return { ...body, context_digest: textDigest(JSON.stringify(body)) };
    },
    applySourceRealization(input) {
      const selected = session(input); const changeSet = input.change_set;
      // Reuse the existing closed bounded change-set wire. Its session binds
      // the actual Prototype; no Delivery identifier is invented for it.
      if (selected.owner_preparation) {
        assertPrototypeOwnerChangeSet(changeSet, selected);
        if (canonicalDigest(prepareOwner(input).change_set) !== canonicalDigest(changeSet)) {
          throw prototypeAuthoringError("owner_change_set_invalid", "Only the exact native owner plan may be applied or recovered; caller and model replacements are denied.");
        }
      } else assertPrototypeChangeSet(changeSet, selected);
      return source.applySourceRealization(selected, changeSet);
    },
    inspectSourceCredentialBinding(input) {
      if (!input || Object.keys(input).sort().join() !== "branch,fetched_base,landing_unit_id,prototype_id" ||
          typeof input.prototype_id !== "string" || !PROTOTYPE.test(input.prototype_id) || input.prototype_id.length > 256) {
        throw new HttpError(400, "prototype_source_identity_binding_invalid", "Only the canonical Prototype source-start binding is admitted.");
      }
      if (typeof agentSourceIdentity?.sourceIntentBinding !== "function") throw new HttpError(503, "prototype_source_identity_unavailable", "The commissioned Agent source identity adapter is unavailable.");
      return agentSourceIdentity.sourceIntentBinding({ session: {
        owner_repo: "workspace-prototype-studio", landing_unit_id: input.landing_unit_id,
        landing_unit: { branch: input.branch, base_commit: input.fetched_base },
      } });
    },
    inspectCommittedSource(input) {
      if (!input || Array.isArray(input) || Object.keys(input).sort().join() !== "prototype_id,source_revision" ||
          typeof input.prototype_id !== "string" || !PROTOTYPE.test(input.prototype_id) || input.prototype_id.length > 256 ||
          typeof input.source_revision !== "string" || !REVISION.test(input.source_revision)) {
        throw new HttpError(400, "prototype_source_inspection_invalid", "Source inspection requires one actual Prototype identity and exact committed source revision.");
      }
      let temporary = null;
      try {
        // The broker must select a canonical owner-main commit, not an
        // arbitrary branch, object, or browser-selected executable snapshot.
        // Native Landing may have advanced main without moving this commissioned
        // code checkout. Refresh its fixed trusted ref, not the working tree.
        git(owner, "fetch", "origin", "main");
        git(owner, "merge-base", "--is-ancestor", input.source_revision, "refs/remotes/origin/main");
        temporary = mkdtempSync(path.join(tmpdir(), "oos-prototype-inspect-"));
        const snapshot = path.join(temporary, "source");
        execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", owner, snapshot], {
          env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        });
        git(snapshot, "checkout", "--detach", input.source_revision);
        // Execute the commissioned owner control, not code chosen by the
        // requested source revision. Only its --repo-root is the snapshot.
        const output = execute(python, [path.join(owner, "scripts/prototype_authoring.py"), "--repo-root", snapshot,
          "inspect", "--prototype-id", input.prototype_id, "--source-revision", input.source_revision], {
          env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        });
        const result = JSON.parse(String(output));
        const subject = assertSourceCredentialSubject(result.subject);
        if (result.schema_version !== 1 || result.status !== "source-inspected" || subject.kind !== "prototype" ||
            subject.prototype_id !== input.prototype_id || subject.registry_revision !== input.source_revision || subject.source_revision !== input.source_revision ||
            result.authority?.may_apply_source !== false || result.authority?.may_invoke_model !== false ||
            result.authority?.may_approve_baseline !== false || result.authority?.may_activate_runtime !== false ||
            git(snapshot, "status", "--porcelain", "--untracked-files=normal")) {
          throw new Error("Owner inspection did not retain its exact read-only binding.");
        }
        return result;
      } catch (error) {
        if (error instanceof HttpError && error.code === "prototype_source_inspection_invalid") throw error;
        throw new HttpError(503, "prototype_source_inspection_unavailable", "The exact committed Prototype source could not be inspected through its commissioned owner control.");
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
}
