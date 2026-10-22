import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "../errors.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { createDeliveryArtWorkSessionSourceAdapter, createConfiguredAgentSourceIdentityAdapter } from "../delivery-art/work-session-cli-adapters.js";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";
import { bootstrapCredentialProjection } from "./credentials.js";
import { assertBootstrapSourceSession, bootstrapSourceChangeSet, bootstrapWorktreeRelativePath } from "./session.js";
import { assertProposedSourceOwnerAuthority, inspectExistingSourceOwnerControls, planSourceOwnerBootstrap, sourceOwnerBootstrapPaths, trustedSourceOwnerValidationFiles } from "./scaffold.js";
import { createCanonicalProposedSourceOwnerReader } from "./authority-reader.js";
import { createPublicBootstrapSourceReader } from "./source-reader.js";

const fail = (code, message) => { throw new HttpError(409, `repository_owner_bootstrap_${code}`, message); };
const environment = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null" };
const PROFILE = "contracts/delivery-art-work-session/evidence-profile.json";

// Only finite trusted controls are executed, in an isolated control snapshot.
// Existing project files and app commands are never executed by bootstrap.
export function createRepositoryOwnerBootstrapSourceAdapter({ workspaceRoot, stateRoot, env = process.env, execute = execFileSync,
  authorityReader = null, publicSourceReader = createPublicBootstrapSourceReader(),
  identityFactory = options => createConfiguredAgentSourceIdentityAdapter({ env, ...options }) }) {
  if (!path.isAbsolute(workspaceRoot ?? "") || !path.isAbsolute(stateRoot ?? "") || realpathSync(workspaceRoot) !== workspaceRoot) {
    throw new TypeError("Bootstrap requires commissioned real absolute workspace and private executor state paths.");
  }
  const files = createPrivateFileTransactions({ root: stateRoot, failure: (code, message) => new HttpError(409, `repository_owner_bootstrap_${code}`, message) });
  const readAuthority = authorityReader ?? createCanonicalProposedSourceOwnerReader({
    authorityRoot: env.OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT?.trim() || path.join(workspaceRoot, "workspace-governance") });
  const git = (root, ...args) => String(execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 2_097_152, stdio: ["ignore", "pipe", "pipe"],
  }));
  function regularCheckoutDirectory(root, providerRepository) {
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || realpathSync(root) !== root ||
        lstatSync(path.join(root, ".git")).isSymbolicLink() || git(root, "rev-parse", "--show-toplevel").trim() !== root ||
        git(root, "remote", "get-url", "origin").trim() !== `git@github.com:${providerRepository.full_name}.git`) {
      fail("checkout_collision", "The canonical owner path is not this exact regular provider-bound checkout; preserve it.");
    }
  }
  function bound(input) {
    const session = assertBootstrapSourceSession(input?.session);
    if (input.owner_repo !== session.owner_repo) fail("subject_mismatch", "Bootstrap source belongs to another repository.");
    bootstrapSourceChangeSet(input.plan, session);
    const authority = readAuthority({ ownerRepo: session.owner_repo, providerRepository: input.plan.provider_repository,
      intakeEntryRef: session.subject.intake_entry_ref });
    const root = path.join(workspaceRoot, session.owner_repo);
    function assertDirectory() {
      regularCheckoutDirectory(root, input.plan.provider_repository);
    }
    function assertPlan(repoRoot) {
      const observedFiles = {};
      for (const file of input.plan.files) {
        const row = git(repoRoot, "ls-tree", session.landing_unit.base_commit, "--", file.path).trim();
        if (!row) { observedFiles[file.path] = null; continue; }
        if (!row.startsWith("100644 blob ")) fail("source_mode_invalid", "The fetched base has a nonregular bootstrap target.");
        observedFiles[file.path] = git(repoRoot, "show", `${session.landing_unit.base_commit}:${file.path}`);
      }
      const profile = JSON.parse(input.plan.files.find(file => file.path === PROFILE).content);
      const rendered = planSourceOwnerBootstrap({ authority, fetchedBase: session.landing_unit.base_commit, profile,
        applicationMarkers: input.plan.application_markers, withCi: input.plan.ci_selected, observedFiles });
      if (canonicalDigest(rendered) !== canonicalDigest(input.plan)) fail("plan_changed", "Actual fetched source and trusted template do not reproduce this exact approved plan.");
    }
    function assertCommittedSource({ repoRoot, headCommit }) {
      assertPlan(repoRoot);
      if (git(repoRoot, "rev-parse", "HEAD").trim() !== headCommit || git(repoRoot, "status", "--porcelain", "--untracked-files=all").trim()) {
        fail("source_changed", "Bootstrap proof requires this exact clean committed source.");
      }
      git(repoRoot, "merge-base", "--is-ancestor", session.landing_unit.base_commit, headCommit);
      const expected = bootstrapSourceChangeSet(input.plan, session).operations;
      const changed = git(repoRoot, "diff", "--name-only", session.landing_unit.base_commit, headCommit).trim().split("\n").filter(Boolean).sort();
      if (canonicalDigest(changed) !== canonicalDigest(expected.map(file => file.path).sort())) fail("source_scope_denied", "Bootstrap cannot publish unrelated or application source.");
      for (const file of expected) {
        const row = git(repoRoot, "ls-tree", headCommit, "--", file.path).trim();
        if (!row.startsWith("100644 blob ") || git(repoRoot, "show", `${headCommit}:${file.path}`) !== file.content) {
          fail("source_scope_denied", "Committed bootstrap bytes and regular modes must exactly match the trusted finite plan.");
        }
      }
    }
    const identity = identityFactory({ credentialPurpose: bootstrapCredentialProjection(session.subject),
      bootstrapBoundary: { session, plan: input.plan, readAuthority, assertCommittedSource } });
    const source = createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot, agentSourceIdentity: identity,
      execFileSyncImpl: execute, worktreeRelativePath: bootstrapWorktreeRelativePath });
    return { session, root, identity, source, assertDirectory, assertPlan, assertCommittedSource,
      ownerRepo: session.owner_repo, sourceRequestId: session.source_request_id,
      assertAuthority: () => identity.sourceIntentBinding({ session }) };
  }
  async function ensureCheckout({ providerRepository, fetchedBase, paths }, binding) {
    return files.withLock(`canonical-checkout:${binding.ownerRepo}`, async () => {
      const slot = path.join(stateRoot, `${canonicalDigest({ owner: binding.ownerRepo }).slice(7)}.json`);
      const ownerBinding = { owner_repo: binding.ownerRepo, provider_repository: providerRepository,
        base_commit: fetchedBase, source_request_id: binding.sourceRequestId };
      let record = files.read(slot, "Bootstrap canonical checkout", { maxBytes: 16_384 });
      const sameBinding = !record || canonicalDigest(record.binding) === canonicalDigest(ownerBinding);
      const reusable = record?.phase === "ready" && record.binding.owner_repo === binding.ownerRepo &&
        canonicalDigest(record.binding.provider_repository) === canonicalDigest(providerRepository) && existsSync(binding.root);
      if (record && !sameBinding && !reusable) {
        fail("checkout_request_pending", "Reconcile the original owned checkout request; do not replace its retained identity.");
      }
      const observed = await publicSourceReader.inspect({ providerRepository: providerRepository, paths });
      if (observed.fetched_base !== fetchedBase || observed.visibility !== "public" || observed.default_branch !== "main") {
        fail("provider_source_changed", "The exact current public provider base changed before checkout; no source publication is authorized.");
      }
      // Provider I/O can outlive an Intake decision. Recheck the native owner
      // immediately before creating or resuming any target checkout.
      binding.assertAuthority();
      if ((!record && existsSync(binding.root)) || (reusable && !sameBinding)) {
        binding.assertDirectory();
        if (git(binding.root, "branch", "--show-current").trim() !== "main" || git(binding.root, "status", "--porcelain", "--untracked-files=all").trim()) fail("checkout_source_changed", "Preserve existing owner branches and dirty source; canonical checkout requires clean main.");
        git(binding.root, "fetch", "origin", "main");
        if (git(binding.root, "rev-parse", "origin/main").trim() !== fetchedBase) fail("provider_source_changed", "Provider main changed while refreshing the existing owner checkout.");
        binding.assertAuthority();
        git(binding.root, "merge", "--ff-only", "origin/main");
        binding.assertPlan(binding.root);
        return;
      }
      if (!record) {
        files.write(slot, { binding: ownerBinding, phase: "reserved", destination_was_absent: true });
        record = { binding: ownerBinding, phase: "reserved", destination_was_absent: true };
      }
      if (!existsSync(binding.root)) mkdirSync(binding.root, { mode: 0o755 });
      const rootInfo = lstatSync(binding.root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== process.getuid()) fail("checkout_collision", "Do not replace an existing or linked owner path.");
      if (readdirSync(binding.root).length === 0) {
        execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--template=", "--single-branch", "--branch", "main", "--",
          `https://github.com/${providerRepository.full_name}.git`, binding.root],
        { env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 262_144, stdio: ["ignore", "pipe", "pipe"] });
        git(binding.root, "remote", "set-url", "origin", `git@github.com:${providerRepository.full_name}.git`);
      } else if (record.phase === "reserved" && existsSync(path.join(binding.root, ".git")) &&
          !lstatSync(path.join(binding.root, ".git")).isSymbolicLink() &&
          git(binding.root, "remote", "get-url", "origin").trim() === `https://github.com/${providerRepository.full_name}.git`) {
        // Recover only this originally absent, retained checkout after a lost
        // clone acknowledgement. Do not erase partial/unique files or borrow a
        // foreign origin. A failed Git recovery remains a visible blocker.
        git(binding.root, "fetch", "origin", "main");
        git(binding.root, "remote", "set-url", "origin", `git@github.com:${providerRepository.full_name}.git`);
      }
      binding.assertDirectory();
      if (git(binding.root, "rev-parse", "origin/main").trim() !== fetchedBase ||
          git(binding.root, "status", "--porcelain", "--untracked-files=all").trim()) fail("checkout_source_changed", "Canonical checkout is dirty or no longer matches the selected provider base; preserve its source.");
      binding.assertPlan(binding.root);
      files.write(slot, { binding: ownerBinding, phase: "ready", destination_was_absent: true });
    });
  }
  const review = async (input, binding) => {
    binding.assertDirectory();
    return binding.source.inspectPullRequest(binding.session);
  };
  async function validate(input, binding) {
    const worktree = await binding.source.resolveWorktree(binding.session);
    if (!worktree || !/^[0-9a-f]{40}$/.test(input.expected_head ?? "")) fail("validation_source_missing", "Validate the exact committed bootstrap head.");
    binding.assertCommittedSource({ repoRoot: worktree, headCommit: input.expected_head });
    let temporary;
    try {
      temporary = mkdtempSync(path.join(tmpdir(), "oos-bootstrap-controls-"));
      for (const file of input.plan.files) {
        const target = path.join(temporary, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, git(worktree, "show", `${input.expected_head}:${file.path}`), { mode: 0o600 });
      }
      for (const [relative, content] of Object.entries(trustedSourceOwnerValidationFiles(binding.session.owner_repo))) {
        const target = path.join(temporary, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content, { mode: 0o600 });
      }
      const output = String(execute("make", ["validate"], { cwd: temporary, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
        encoding: "utf8", timeout: 60_000, maxBuffer: 262_144, stdio: ["ignore", "pipe", "pipe"] }));
      const body = { schema_version: 1, scope: "trusted-owner-controls-only", session_id: binding.session.session_id,
        source_revision: input.expected_head, fetched_base: input.plan.fetched_base, command: "make validate (current trusted validator; isolated exact committed control data)",
        result: "pass", log_digest: canonicalDigest(output), app_acceptance: false, runtime_activation: false };
      return { ...body, receipt_digest: canonicalDigest(body) };
    } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
  }
  async function exactReview(input, binding, approved = false) {
    const current = await review(input, binding);
    if (current.state !== "open" || current.url !== input.expected_pull_request?.url || current.head_commit !== input.expected_pull_request?.head_commit ||
        (approved && current.review?.approved !== true)) fail("review_changed", "The exact Gary PR head and required human review are not ready.");
    binding.identity.assertHumanMergeAuthority({ repoRoot: binding.root, session: binding.session });
    await validate({ ...input, expected_head: current.head_commit }, binding);
    return current;
  }
  return {
    async materializeExistingOwner(input) {
      const preparation = input?.preparation, existing = preparation?.existing_owner_controls;
      const { preparation_digest: digest, ...body } = preparation ?? {};
      if (canonicalDigest(body) !== digest || preparation?.workflow_id !== "repository-owner-bootstrap-preparation" || preparation.plan !== null ||
          !existing || existing.status !== "existing-owner-controls" || existing.source_change_required !== false ||
          input.owner_repo !== existing.owner_repo || !/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/.test(input.bootstrap_request_id ?? "") ||
          preparation.owner_authority?.owner_repo !== input.owner_repo) fail("existing_controls_invalid", "Use the exact retained non-source existing-owner preparation; no bootstrap PR or credential is needed.");
      const providerRepository = preparation.owner_authority.provider_repository, fetchedBase = existing.fetched_base;
      const root = path.join(workspaceRoot, input.owner_repo);
      const assertAuthority = () => {
        const current = assertProposedSourceOwnerAuthority(readAuthority({ ownerRepo: input.owner_repo, providerRepository,
          intakeEntryRef: preparation.owner_authority.intake_entry_ref }));
        if (current.owner_repo !== input.owner_repo || canonicalDigest(current.provider_repository) !== canonicalDigest(providerRepository) ||
            canonicalDigest(current.intake_entry_ref) !== canonicalDigest(preparation.owner_authority.intake_entry_ref)) fail("existing_controls_changed", "Current proposed authority differs from this exact existing-owner preparation.");
        return current;
      };
      assertAuthority();
      const assertPlan = repoRoot => {
        const observedFiles = {};
        for (const name of sourceOwnerBootstrapPaths(true)) {
          const row = git(repoRoot, "ls-tree", fetchedBase, "--", name);
          if (row && !row.startsWith("100644 blob ")) fail("existing_controls_invalid", "Existing owner controls must remain exact regular fetched source.");
          observedFiles[name] = row ? git(repoRoot, "show", `${fetchedBase}:${name}`) : null;
        }
        const ready = inspectExistingSourceOwnerControls({ ownerRepo: input.owner_repo, fetchedBase, observedFiles });
        if (!ready || ready.source_change_required || ready.evidence_profile_digest !== existing.evidence_profile_digest) fail("existing_controls_changed", "The actual existing owner controls changed after operator preparation.");
      };
      await ensureCheckout({ providerRepository, fetchedBase, paths: sourceOwnerBootstrapPaths(true) }, {
        root, ownerRepo: input.owner_repo, sourceRequestId: input.bootstrap_request_id,
        assertAuthority, assertDirectory: () => regularCheckoutDirectory(root, providerRepository), assertPlan,
      });
      const receipt = { schema_version: 1, scope: "existing-owner-checkout-only", owner_repo: input.owner_repo,
        source_request_id: input.bootstrap_request_id, provider_repository: structuredClone(providerRepository),
        canonical_commit: fetchedBase, evidence_profile_digest: existing.evidence_profile_digest,
        source_changed: false, credential_issued: false, review_required: false,
        app_acceptance: false, inventory_admission: false, runtime_activation: false };
      return { ...receipt, receipt_digest: canonicalDigest(receipt) };
    },
    inspectSourceCredentialBinding(input) { const b = bound(input); return b.identity.sourceIntentBinding({ session: b.session }); },
    async ensureOwnedWorktree(input) {
      const b = bound(input); await ensureCheckout({ providerRepository: input.plan.provider_repository,
        fetchedBase: input.plan.fetched_base, paths: input.plan.files.map(file => file.path) }, b);
      b.identity.sourceIntentBinding({ session: b.session });
      return files.withLock(`owned-worktree:${b.session.session_id}`, async () => {
        const slot = path.join(stateRoot, `worktree-${canonicalDigest(b.session.session_id).slice(7)}.json`);
        const binding = { session_digest: canonicalDigest(b.session), plan_digest: input.plan.plan_digest };
        const target = path.join(workspaceRoot, bootstrapWorktreeRelativePath(b.session));
        let record = files.read(slot, "Bootstrap source ownership", { maxBytes: 32_768 });
        if (record && canonicalDigest(record.binding) !== canonicalDigest(binding)) fail("resource_binding_invalid", "Retained source ownership belongs to another immutable bootstrap request.");
        if (record?.phase === "retired") fail("resource_closed", "Retired bootstrap source resources cannot be recreated by the old request.");
        if (record?.phase === "ready") {
          if (!existsSync(target) || git(target, "branch", "--show-current").trim() !== b.session.landing_unit.branch) fail("resource_binding_invalid", "Retained bootstrap worktree is absent or changed; do not recreate closed source resources.");
          return record.owned;
        }
        if (!record) {
          const before = await b.source.inspectResourceOwnership(b.session);
          if (before.path !== null || existsSync(target) || before.resources.some(resource => resource.ownership_provenance === "pre-existing")) {
            fail("resource_collision", "Existing branch, remote or worktree is not proven owned by this request; preserve it.");
          }
          record = { binding, phase: "creating", original_resources_absent: true };
          // Durable pre-effect provenance is essential: a process may die
          // after Git creates a worktree but before OOS receives its receipt.
          files.write(slot, record);
        }
        const owned = await b.source.ensureOwnedWorktree(b.session);
        if (owned.path !== target || git(target, "rev-parse", "HEAD").trim() !== b.session.landing_unit.base_commit ||
            git(target, "status", "--porcelain", "--untracked-files=all").trim()) fail("resource_source_changed", "An interrupted worktree has unique or dirty source; preserve and reconcile it.");
        owned.resources = owned.resources.map(resource => ({ ...resource, ownership_provenance: "session-created", retention_class: "retire-on-terminal-close" }));
        files.write(slot, { ...record, phase: "ready", owned });
        return owned;
      });
    },
    async applySourceRealization(input) {
      const b = bound(input); b.assertDirectory(); b.assertPlan(b.root);
      if (canonicalDigest(input.change_set) !== canonicalDigest(bootstrapSourceChangeSet(input.plan, b.session))) fail("change_set_substitution", "Apply only the exact trusted bootstrap change set.");
      return b.source.applySourceRealization(b.session, input.change_set);
    },
    inspectAgentSource(input) { const b = bound(input); return b.source.inspectAgentSource(b.session); },
    inspectPullRequest(input) { const b = bound(input); return review(input, b); },
    validateSource(input) { const b = bound(input); return validate(input, b); },
    async publishAgentSource(input) {
      const b = bound(input); const worktree = await b.source.resolveWorktree(b.session);
      if (!worktree) fail("source_missing", "Apply and reconcile the exact bootstrap source first.");
      await validate({ ...input, expected_head: git(worktree, "rev-parse", "HEAD").trim() }, b);
      return b.source.publishAgentSource(b.session);
    },
    async approvePullRequest(input) {
      const b = bound(input); const current = await exactReview(input, b);
      execute("gh", ["pr", "review", current.url, "--approve", "--body", `Reviewed exact trusted owner-control head ${current.head_commit}; no app acceptance, admission or runtime activation is implied.`],
        { cwd: b.root, encoding: "utf8", timeout: 60_000, maxBuffer: 262_144, stdio: ["ignore", "pipe", "pipe"] });
      const approved = await review(input, b);
      if (approved.head_commit !== current.head_commit || approved.review?.approved !== true) fail("review_unconfirmed", "Reconcile this same exact-head human review.");
      return approved;
    },
    async mergePullRequest(input) {
      const b = bound(input); const current = await review(input, b);
      if (current.state === "merged" && current.url === input.expected_pull_request?.url && current.head_commit === input.expected_pull_request?.head_commit &&
          /^[0-9a-f]{40}$/.test(current.merge_commit ?? "")) return current;
      return b.source.mergePullRequest(b.session, await exactReview(input, b, true));
    },
    async retirePristineResources(input) {
      const b = bound(input), slot = path.join(stateRoot, `worktree-${canonicalDigest(b.session.session_id).slice(7)}.json`);
      if (!existsSync(b.root)) return { complete: true, source_resources_created: false, canonical_checkout_retained: false };
      b.assertDirectory();
      const record = files.read(slot, "Bootstrap source ownership", { maxBytes: 32_768 });
      if (record && (record.binding?.session_digest !== canonicalDigest(b.session) || record.binding?.plan_digest !== input.plan.plan_digest)) {
        fail("resource_binding_invalid", "Cancellation may retire only this retained bootstrap source intent.");
      }
      let resources = input.resources ?? record?.owned?.resources ?? null;
      if (!resources && record?.phase === "creating" && record.original_resources_absent === true) {
        const observed = await b.source.inspectResourceOwnership(b.session);
        if (observed.path !== null && observed.path !== path.join(workspaceRoot, bootstrapWorktreeRelativePath(b.session))) fail("resource_binding_invalid", "Preserve a worktree outside the exact originally absent destination.");
        resources = observed.resources.map(resource => ({ ...resource, ownership_provenance: "session-created", retention_class: "retire-on-terminal-close" }));
      }
      const proof = await b.source.inspectPristineSession(b.session);
      if (!proof.pristine) fail("source_not_pristine", "Uncertain, committed, dirty or remote source cannot be discarded as an unapplied draft.");
      if (!resources && !proof.worktree_present && !proof.local_branch_head && !proof.remote_branch_head) return {
        complete: true, source_resources_created: false, canonical_checkout_retained: true };
      if (!Array.isArray(resources) || resources.length !== 3 || new Set(resources.map(resource => resource.resource_type)).size !== 3 ||
          resources.some(resource => !["git-worktree", "git-local-branch", "git-remote-branch"].includes(resource.resource_type) ||
            resource.ownership_provenance !== "session-created" || resource.locator?.repo !== b.session.owner_repo ||
            resource.locator?.ownership_marker !== b.session.session_id ||
            (resource.resource_type === "git-worktree" ? resource.locator.workspace_relative_path !== bootstrapWorktreeRelativePath(b.session)
              : resource.locator.branch !== b.session.landing_unit.branch))) fail("resource_binding_invalid", "Cancellation requires the exact proven source resource set.");
      const result = await b.source.retirePristineSession({ resources, session: b.session });
      const complete = result.outcomes.every(outcome => ["removed", "absent"].includes(outcome.outcome));
      if (complete && record) files.write(slot, { ...record, phase: "retired" });
      return { ...result, complete, canonical_checkout_retained: true };
    },
    async retireSourceResources(input) {
      const b = bound(input); const merged = await review(input, b);
      if (merged.state !== "merged" || !/^[0-9a-f]{40}$/.test(merged.merge_commit ?? "") ||
          merged.url !== input.expected_pull_request?.url || merged.head_commit !== input.expected_pull_request?.head_commit) {
        fail("merged_readback_required", "Prove this same owner-bootstrap PR merged before retiring its source resources.");
      }
      const types = ["git-worktree", "git-local-branch", "git-remote-branch"];
      if (!Array.isArray(input.resources) || input.resources.length !== 3 ||
          new Set(input.resources.map(resource => resource.resource_type)).size !== 3 ||
          input.resources.some(resource => !types.includes(resource.resource_type) || resource.locator?.repo !== b.session.owner_repo ||
            resource.locator?.ownership_marker !== b.session.session_id ||
            (resource.resource_type === "git-worktree" ? resource.locator.workspace_relative_path !== bootstrapWorktreeRelativePath(b.session)
              : resource.locator.branch !== b.session.landing_unit.branch) ||
            (resource.resource_type === "git-remote-branch" && resource.locator.remote !== "origin"))) {
        fail("resource_binding_invalid", "Retire only the retained resources of this exact bootstrap session; preserve the durable owner checkout.");
      }
      git(b.root, "fetch", "origin", "main");
      if (git(b.root, "rev-parse", "origin/main").trim() !== merged.merge_commit ||
          git(b.root, "branch", "--show-current").trim() !== "main" || git(b.root, "status", "--porcelain", "--untracked-files=all").trim()) {
        fail("canonical_source_changed", "Canonical owner main is not clean at the exact provider merge; preserve source and reconcile this same request.");
      }
      git(b.root, "merge", "--ff-only", "origin/main");
      b.assertCommittedSource({ repoRoot: b.root, headCommit: merged.merge_commit });
      await b.source.prepareResourceRetirementExecution(b.session);
      const planned = await b.source.planResourceRetirement({ manifest: { resources: input.resources }, pullRequest: merged, session: b.session });
      for (const resource of planned) if (resource.outcome === "eligible") await b.source.retireResource({ resource, pullRequest: merged, session: b.session });
      const resources = await b.source.planResourceRetirement({ manifest: { resources: input.resources }, pullRequest: merged, session: b.session });
      const body = { schema_version: 1, scope: "trusted-owner-controls-only", owner_repo: b.session.owner_repo,
        session_id: b.session.session_id, provider_repository: structuredClone(input.plan.provider_repository),
        canonical_commit: merged.merge_commit, plan_digest: input.plan.plan_digest,
        evidence_profile_digest: input.plan.evidence_profile_digest, app_acceptance: false, inventory_admission: false, runtime_activation: false };
      return { schema_version: 1, session_id: b.session.session_id, pull_request: merged, resources,
        complete: resources.every(resource => resource.outcome === "removed"), readback: { ...body, receipt_digest: canonicalDigest(body) } };
    },
  };
}
