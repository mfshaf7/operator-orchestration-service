import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createAgentSourceIdentityAdapter } from "../src/delivery-art/agent-source-identity.js";
import { createRepositoryOwnerBootstrapSourceAdapter } from "../src/repository-owner-bootstrap/source-adapter.js";
import { bootstrapCredentialProjection } from "../src/repository-owner-bootstrap/credentials.js";
import { bootstrapSourceChangeSet, bootstrapSourceSession } from "../src/repository-owner-bootstrap/session.js";
import { inspectExistingSourceOwnerControls, planSourceOwnerBootstrap, sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";

const contract = JSON.parse(readFileSync(new URL("../contracts/delivery-art-work-session/agent-source-identity.json", import.meta.url), "utf8"));
const owner = "native-bootstrap-owner";
const repository = `mfshaf7-workspace/${owner}`;
const nativeGit = (root, ...args) => String(execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 })).trim();

function harness(t, { existingControls = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-native-owner-bootstrap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace"); mkdirSync(workspaceRoot);
  const providerRoot = path.join(root, "public-provider-fixture"); mkdirSync(providerRoot);
  nativeGit(providerRoot, "init", "--initial-branch=main");
  nativeGit(providerRoot, "config", "user.name", "Fixture Repository Owner"); nativeGit(providerRoot, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(providerRoot, "README.md"), "# Existing independently authored project purpose\n");
  mkdirSync(path.join(providerRoot, "scripts"));
  writeFileSync(path.join(providerRoot, "scripts/jsonschema.py"), 'raise RuntimeError("Existing project code must not run in bootstrap validation")\n');
  mkdirSync(path.join(providerRoot, "app"));
  writeFileSync(path.join(providerRoot, "app/main.mjs"), '// Existing app source must remain untouched.\n');
  writeFileSync(path.join(providerRoot, "app/test.mjs"), 'throw new Error("App tests must not be executed or called passing by bootstrap");\n');
  nativeGit(providerRoot, "add", "."); nativeGit(providerRoot, "commit", "-m", "fixture: existing public source");
  let base = nativeGit(providerRoot, "rev-parse", "HEAD");
  const authority = { schema_version: 1, owner_repo: owner, classification: "proposed", inventory_posture: null,
    intake_entry_ref: { id: `repo:${owner}`, version: 1, digest: `sha256:${"a".repeat(64)}` },
    provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: repository },
    owner_purpose: "Synthetic source-only project; no control or runtime authority.",
    source_bootstrap_eligible: true, ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
  const profile = { schema_version: 1, owner_repo: owner, profile_id: "native-bootstrap-selected-profile-v1", commands: [
    { id: "tests", kind: "tests", name: "Actual selected app tests", executable: "node", args: ["app/test.mjs"], fidelity: "pure-unit", conformance_binding: "matching-fidelity", timeout_seconds: 30 },
    { id: "validations", kind: "validations", name: "Actual diff validation", executable: "git", args: ["diff", "--check"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 },
  ] };
  if (existingControls) {
    writeFileSync(path.join(providerRoot, "AGENTS.md"), "Independent existing owner controls; preserve these.\n");
    mkdirSync(path.join(providerRoot, "contracts/delivery-art-work-session"), { recursive: true });
    writeFileSync(path.join(providerRoot, "contracts/delivery-art-work-session/evidence-profile.json"), JSON.stringify(profile));
    nativeGit(providerRoot, "add", "."); nativeGit(providerRoot, "commit", "-m", "fixture: independent existing owner controls");
    base = nativeGit(providerRoot, "rev-parse", "HEAD");
  }
  const observedFiles = Object.fromEntries(sourceOwnerBootstrapPaths(false).map(name => [name,
    existsSync(path.join(providerRoot, name)) ? readFileSync(path.join(providerRoot, name), "utf8") : null]));
  const plan = existingControls ? null : planSourceOwnerBootstrap({ authority, fetchedBase: base, profile, applicationMarkers: ["app/main.mjs"], withCi: false, observedFiles });
  const body = { schema_version: 1, workflow_id: "repository-owner-bootstrap-preparation", caller_id: "console", operator_id: "operator:fixture",
    decision_ref: "operator:fixture-bootstrap", custody_request_id: "custody:fixture", custody_receipt_digest: `sha256:${"b".repeat(64)}`,
    plan, owner_authority: authority, ...(existingControls ? { existing_owner_controls: inspectExistingSourceOwnerControls({ ownerRepo: owner, fetchedBase: base, observedFiles }) } : {}),
    authorization: "preparation-only", credential_issued: false, checkout_created: false, canonical_mutation: false, runtime_activation: false };
  const preparation = { ...body, preparation_digest: canonicalDigest(body) };
  const session = existingControls ? null : bootstrapSourceSession({ requestDigest: `sha256:${"c".repeat(64)}`, requestId: "bootstrap-request:native-fixture",
    callerId: "console", operatorId: "operator:fixture", preparation });
  const input = existingControls ? { owner_repo: owner, bootstrap_request_id: "bootstrap-request:native-fixture", preparation } : { owner_repo: owner, session, plan };
  const credentialRoot = path.join(root, "private-credential-root"); mkdirSync(credentialRoot, { mode: 0o700 }); chmodSync(credentialRoot, 0o700);
  writeFileSync(path.join(credentialRoot, "projection.lock"), "", { mode: 0o600 });
  if (session) {
    const slot = path.join(credentialRoot, "sessions", createHash("sha256").update(session.landing_unit_id).digest("hex").slice(0, 24));
    mkdirSync(slot, { recursive: true, mode: 0o700 });
    const credential = { schema_version: 1, identity_id: contract.identity.identity_id, logical_agent_id: contract.identity.logical_agent_id,
    provider_principal: contract.identity.provider_principal, app_id: contract.identity.app_id, installation_id: 172173010,
    repository, repository_id: 123456789, landing_unit_id: session.landing_unit_id, branch: session.landing_unit.branch,
    fetched_base: base, human_reviewer_id: contract.identity.human_reviewer_id, ...bootstrapCredentialProjection(session.subject),
    token: "synthetic-private-bootstrap-token", token_expires_at: new Date(Date.now() + 3600000).toISOString() };
    writeFileSync(path.join(slot, "credential.json"), JSON.stringify(credential), { mode: 0o600 });
  }
  const calls = { clones: 0, pushes: 0, providerWrites: 0, authority: 0, identityFactories: 0 };
  let loseWorktreeAck = false;
  let pullRequest = null, approvedHead = null, humanReviewer = contract.identity.human_reviewer_id;
  const execute = (executable, argv, options) => {
    const args = [...argv];
    if (executable === "gh") {
      if (args[0] === "pr" && args[1] === "list") return `${JSON.stringify(pullRequest ? [pullRequest] : [])}\n`;
      if (args[0] === "api" && args[1] === "user") return `${humanReviewer}\n`;
      if (args[0] === "api" && args[1] === `/repos/${repository}/pulls/1`) return `${contract.identity.provider_principal}\n`;
      if (args[0] === "api" && args[1] === `/repos/${repository}/pulls/1/reviews`) return approvedHead
        ? `${JSON.stringify({ id: 1, commit_id: approvedHead, state: "APPROVED", user: { login: contract.identity.human_reviewer_id } })}\n` : "";
      if (args[0] === "pr" && args[1] === "review") { assert.equal(humanReviewer, contract.identity.human_reviewer_id); approvedHead = pullRequest.headRefOid; return ""; }
      if (args[0] === "pr" && args[1] === "merge") {
        assert.equal(args.at(-1), pullRequest.headRefOid); assert.equal(approvedHead, pullRequest.headRefOid);
        nativeGit(providerRoot, "merge", "--squash", session.landing_unit.branch);
        nativeGit(providerRoot, "commit", "-m", "fixture: human-reviewed exact bootstrap squash");
        pullRequest.state = "MERGED"; pullRequest.mergeCommit = { oid: nativeGit(providerRoot, "rev-parse", "HEAD") }; return "";
      }
      assert.fail(`Native fixture cannot call an unmodeled real provider CLI: ${args[0]} ${args[1]}`);
    }
    if (executable === "git") {
      const clone = args.indexOf("clone");
      if (clone !== -1) { calls.clones++; args[args.length - 2] = providerRoot; }
      if (args.includes("ls-remote")) { const index = args.indexOf("origin"); if (index !== -1) args[index] = providerRoot; }
      if (args.includes("fetch") && args.includes("origin")) {
        args[args.indexOf("origin")] = providerRoot;
        args[args.indexOf("main")] = "main:refs/remotes/origin/main";
      }
      if (args.includes("push")) {
        calls.pushes++;
        const publicTarget = args.indexOf(`https://github.com/${repository}.git`);
        const index = publicTarget === -1 ? args.indexOf("origin") : publicTarget;
        assert.ok(index !== -1); args[index] = providerRoot;
      }
    }
    const output = execFileSync(executable, args, options);
    if (loseWorktreeAck && executable === "git" && args.includes("worktree") && args.includes("add")) {
      loseWorktreeAck = false;
      throw new Error("Synthetic process loss after native worktree creation");
    }
    return output;
  };
  let eligible = true;
  let providerReadHook = null;
  const readAuthority = () => {
    calls.authority++;
    if (!eligible) throw new Error("Current proposed authority no longer permits bootstrap");
    return structuredClone(authority);
  };
  const response = value => ({ ok: true, async json() { return value; } });
  const fetchImpl = async (url, options = {}) => {
    const route = new URL(url).pathname;
    if (route === "/installation/repositories") return response({ total_count: 1, repositories: [{ id: 123456789, full_name: repository }] });
    if (route === "/user") return response({ login: contract.identity.provider_principal });
    if (route === `/repos/${repository}/git/ref/heads/${session.landing_unit.branch}`) return response({
      object: { sha: nativeGit(providerRoot, "rev-parse", `refs/heads/${session.landing_unit.branch}`) } });
    if (route === `/repos/${repository}/pulls` && !options.method) return response([]);
    if (route === `/repos/${repository}/pulls` && options.method === "GET") return response([]);
    if (route === `/repos/${repository}/pulls` && options.method === "POST") {
      calls.providerWrites++;
      pullRequest = { number: 1, state: "OPEN", isDraft: false, url: `https://github.com/${repository}/pull/1`,
        headRefOid: nativeGit(providerRoot, "rev-parse", `refs/heads/${session.landing_unit.branch}`), baseRefName: "main", mergeCommit: null };
      return response({ number: 1, state: "open", draft: false, html_url: `https://github.com/${repository}/pull/1`,
        user: { login: contract.identity.provider_principal }, base: { ref: "main" },
        head: { sha: nativeGit(providerRoot, "rev-parse", `refs/heads/${session.landing_unit.branch}`) }, requested_reviewers: [] });
    }
    if (route === `/repos/${repository}/pulls/1/requested_reviewers`) { calls.providerWrites++; return response({}); }
    assert.fail(`Unexpected provider route ${route}`);
  };
  const adapter = createRepositoryOwnerBootstrapSourceAdapter({ workspaceRoot, stateRoot: path.join(root, "private-checkout-state"), execute,
    authorityReader: readAuthority,
    publicSourceReader: { async inspect() { providerReadHook?.(); return { fetched_base: base, visibility: "public", default_branch: "main", observed_files: observedFiles }; } },
    identityFactory: options => {
      calls.identityFactories++;
      assert.equal(existingControls, false, "Existing controls must not construct or borrow a source identity");
      return createAgentSourceIdentityAdapter({ ...options, enabled: true, credentialRoot, execFileSyncImpl: execute, fetchImpl });
    },
  });
  return { adapter, input, calls, workspaceRoot, providerRoot, session, plan, readAuthority,
    setEligible(value) { eligible = value; }, setProviderReadHook(value) { providerReadHook = value; },
    setHumanReviewer(value) { humanReviewer = value; }, setApprovedHead(value) { approvedHead = value; },
    loseWorktreeAcknowledgement() { loseWorktreeAck = true; } };
}

test("native bootstrap creates a canonical checkout only after proposed checks, commits finite trusted controls as Gary and publishes only that head", async t => {
  const h = harness(t);
  const identity = await h.adapter.inspectSourceCredentialBinding(h.input);
  assert.equal(identity.installation_id, 172173010);
  assert.equal(existsSync(path.join(h.workspaceRoot, owner)), false, "Identity inspection must not create the target checkout");
  const owned = await h.adapter.ensureOwnedWorktree(h.input);
  assert.equal(h.calls.clones, 1);
  assert.equal(owned.resources.length, 3);
  assert.equal(nativeGit(path.join(h.workspaceRoot, owner), "remote", "get-url", "origin"), `git@github.com:${repository}.git`);
  const source = await h.adapter.applySourceRealization({ ...h.input, change_set: bootstrapSourceChangeSet(h.plan, h.session) });
  assert.equal(source.outcome, "committed");
  assert.match(source.author, /^Agent Gary </);
  const validation = await h.adapter.validateSource({ ...h.input, expected_head: source.head_commit });
  assert.equal(validation.result, "pass");
  assert.equal(validation.scope, "trusted-owner-controls-only"); assert.equal(validation.app_acceptance, false);
  assert.equal(readFileSync(path.join(owned.path, "app/main.mjs"), "utf8"), "// Existing app source must remain untouched.\n");
  const published = await h.adapter.publishAgentSource(h.input);
  assert.equal(published.state, "published"); assert.equal(published.purpose, "trusted-owner-bootstrap");
  assert.equal(published.pushed_head, source.head_commit); assert.equal(h.calls.pushes, 1);
  writeFileSync(path.join(owned.path, "app/arbitrary.mjs"), "// Not in the approved bootstrap plan.\n");
  nativeGit(owned.path, "add", "app/arbitrary.mjs"); nativeGit(owned.path, "commit", "-m", "fixture: unapproved application change");
  await assert.rejects(h.adapter.publishAgentSource(h.input), /unrelated or application source/);
  assert.equal(h.calls.pushes, 1, "No out-of-plan source may reach the provider");
});

test("native bootstrap exact-head human review, squash merge and owned cleanup retain canonical source and deny stale approval", async t => {
  const h = harness(t), owned = await h.adapter.ensureOwnedWorktree(h.input);
  const committed = await h.adapter.applySourceRealization({ ...h.input, change_set: bootstrapSourceChangeSet(h.plan, h.session) });
  const published = await h.adapter.publishAgentSource(h.input);
  const expected_pull_request = { url: published.pull_request.url, head_commit: committed.head_commit };
  const bound = { ...h.input, expected_pull_request, resources: owned.resources };
  h.setHumanReviewer("wrong-fixture-human");
  await assert.rejects(h.adapter.approvePullRequest(bound), /admitted human reviewer identity/);
  h.setHumanReviewer(contract.identity.human_reviewer_id);
  const reviewed = await h.adapter.approvePullRequest(bound); assert.equal(reviewed.review.approved, true);
  h.setApprovedHead("a".repeat(40));
  await assert.rejects(h.adapter.mergePullRequest(bound), /required human review/);
  h.setApprovedHead(committed.head_commit);
  const merged = await h.adapter.mergePullRequest(bound); assert.equal(merged.state, "merged");
  assert.notEqual(merged.merge_commit, committed.head_commit, "Squash proof must not pretend the source head is the merge commit");
  const closed = await h.adapter.retireSourceResources(bound);
  assert.equal(closed.complete, true); assert.equal(closed.readback.scope, "trusted-owner-controls-only");
  assert.equal(closed.readback.canonical_commit, merged.merge_commit); assert.equal(closed.readback.app_acceptance, false);
  const canonical = path.join(h.workspaceRoot, owner);
  assert.equal(nativeGit(canonical, "branch", "--show-current"), "main"); assert.equal(nativeGit(canonical, "status", "--porcelain"), "");
  assert.equal(nativeGit(canonical, "rev-parse", "HEAD"), merged.merge_commit); assert.equal(existsSync(owned.path), false);
  assert.equal(nativeGit(canonical, "branch", "--format=%(refname:short)"), "main");
  assert.equal(nativeGit(h.providerRoot, "branch", "--format=%(refname:short)"), "main");
  assert.deepEqual(await h.adapter.retireSourceResources(bound), closed, "Exact merged cleanup must remain replay-stable");
});

test("current proposed authority loss during provider preflight prevents any target checkout", async t => {
  const h = harness(t);
  h.setProviderReadHook(() => h.setEligible(false));
  await assert.rejects(h.adapter.ensureOwnedWorktree(h.input), /Current proposed/);
  assert.equal(h.calls.clones, 0); assert.equal(h.calls.pushes, 0);
  assert.equal(existsSync(path.join(h.workspaceRoot, owner)), false);
});

test("lost native worktree acknowledgement recovers original durable ownership without another checkout or ambiguous cleanup", async t => {
  const h = harness(t); h.loseWorktreeAcknowledgement();
  await assert.rejects(h.adapter.ensureOwnedWorktree(h.input), /Synthetic process loss after native worktree creation/);
  const recovered = await h.adapter.ensureOwnedWorktree(h.input);
  assert.equal(h.calls.clones, 1);
  assert.equal(recovered.resources.length, 3);
  assert.ok(recovered.resources.every(resource => resource.ownership_provenance === "session-created"));
  assert.deepEqual(await h.adapter.ensureOwnedWorktree(h.input), recovered);
});

test("independently valid owner controls materialize and reuse the exact public canonical checkout with no source identity, branch or PR", async t => {
  const h = harness(t, { existingControls: true });
  const ready = await h.adapter.materializeExistingOwner(h.input);
  assert.equal(ready.scope, "existing-owner-checkout-only"); assert.equal(ready.source_changed, false);
  assert.equal(ready.credential_issued, false); assert.equal(ready.review_required, false); assert.equal(ready.app_acceptance, false);
  assert.equal(h.calls.identityFactories, 0); assert.equal(h.calls.pushes, 0); assert.equal(h.calls.providerWrites, 0);
  const canonical = path.join(h.workspaceRoot, owner);
  assert.equal(nativeGit(canonical, "rev-parse", "HEAD"), ready.canonical_commit);
  assert.equal(nativeGit(canonical, "branch", "--format=%(refname:short)"), "main");
  assert.equal(readFileSync(path.join(canonical, "AGENTS.md"), "utf8"), "Independent existing owner controls; preserve these.\n");
  assert.deepEqual(await h.adapter.materializeExistingOwner(h.input), ready);
  const reopened = await h.adapter.materializeExistingOwner({ ...h.input, bootstrap_request_id: "bootstrap-request:reinspect-existing-owner" });
  assert.equal(reopened.canonical_commit, ready.canonical_commit);
  assert.equal(h.calls.clones, 1); assert.equal(h.calls.identityFactories, 0);
});

test("unapplied native source retirement preserves canonical checkout and cannot resurrect or discard committed work", async t => {
  const h = harness(t), owned = await h.adapter.ensureOwnedWorktree(h.input);
  const retired = await h.adapter.retirePristineResources({ ...h.input, resources: owned.resources });
  assert.equal(retired.complete, true); assert.equal(retired.canonical_checkout_retained, true);
  assert.equal(existsSync(path.join(h.workspaceRoot, owner)), true); assert.equal(existsSync(owned.path), false);
  await assert.rejects(h.adapter.ensureOwnedWorktree(h.input), /Retired bootstrap source resources/);
  const committed = harness(t), resources = await committed.adapter.ensureOwnedWorktree(committed.input);
  await committed.adapter.applySourceRealization({ ...committed.input, change_set: bootstrapSourceChangeSet(committed.plan, committed.session) });
  await assert.rejects(committed.adapter.retirePristineResources({ ...committed.input, resources: resources.resources }), /cannot be discarded/);
  assert.equal(existsSync(resources.path), true, "Unique committed source must be preserved");
});

test("cancelling after a lost worktree acknowledgement retires only the original proven pristine resources without creating another branch", async t => {
  const h = harness(t); h.loseWorktreeAcknowledgement();
  await assert.rejects(h.adapter.ensureOwnedWorktree(h.input), /Synthetic process loss/);
  const result = await h.adapter.retirePristineResources({ ...h.input, resources: null });
  assert.equal(result.complete, true); assert.equal(h.calls.clones, 1);
  assert.equal(nativeGit(path.join(h.workspaceRoot, owner), "branch", "--format=%(refname:short)"), "main");
});
