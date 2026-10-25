import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createDeliveryArtSourceExecutorClient, createDeliveryArtSourceExecutorServer } from "../src/delivery-art/source-executor.js";
import { assertPrototypeSourceCapture } from "../src/source-authoring/prototype-context.js";
import { createPrototypeSourceAdapter } from "../src/source-authoring/prototype-source-adapter.js";
import { assertPrototypeSourceSession, prototypeSourceSession } from "../src/source-authoring/prototype-session.js";
import { textDigest } from "../src/source-authoring/context-contract.js";
import { assertPrototypeChangeSet } from "../src/source-authoring/prototype-change-set.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const SECRET = "prototype-source-executor-local-test-secret";
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git"); mkdirSync(remote); git(remote, "init", "--bare");
  const repo = path.join(root, "workspace-prototype-studio"); git(root, "clone", remote, repo);
  git(repo, "config", "user.name", "Fixture Owner"); git(repo, "config", "user.email", "owner@example.invalid");
  const files = { "README.md": "Unrelated owner context must stay out.\n", "prototypes/sample/README.md": "Prototype source\n",
    "prototypes/other/private.txt": "Unrelated synthetic source\n", "docs/prototypes/sample/design-profile.md": "# Design\n",
    ".github/workflows/validate.yaml": "# Owner control, not model writable\n", "Makefile": "validate:\n\tgit diff --check\n" };
  for (const [file, value] of Object.entries(files)) { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), value); }
  git(repo, "add", "."); git(repo, "commit", "-m", "Fixture owner baseline"); git(repo, "branch", "-M", "main"); git(repo, "push", "-u", "origin", "main");
  const base = git(repo, "rev-parse", "HEAD");
  const record = { request: { request_id: "prototype-source-request:sample:1", prototype_id: "prototype:sample", objective: "Create a minimal synthetic app." },
    request_digest: canonicalDigest("fixture request"), caller_id: "console", operator_id: "operator:owner",
    binding: { subject: { kind: "prototype", prototype_id: "prototype:sample", registry_ref: "record://prototypes/sample", registry_revision: base,
      source_ref: "repo://workspace-prototype-studio/prototypes/sample", source_revision: base },
      model_source_scope: { source_root: "prototypes/sample", design_profile: "docs/prototypes/sample/design-profile.md" } } };
  const suffix = record.request_digest.slice(7, 31);
  record.binding.source_start = { landing_unit_id: `prototype-authoring-${suffix}`, branch: `feature/prototype-${suffix}`, fetched_base: base };
  record.session = prototypeSourceSession(record);
  const adapter = createPrototypeSourceAdapter({ workspaceRoot: root, agentSourceIdentity: {
    async prepare({ repoRoot }) { git(repoRoot, "config", "user.name", "Agent Gary"); git(repoRoot, "config", "user.email", "327854141+mfshaf7-agent-gary[bot]@users.noreply.github.com"); return { state: "ready" }; },
  } });
  return { root, repo, base, record, adapter, input: { prototype_id: record.request.prototype_id, session: record.session } };
}
function listen(server, socket) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); }); }
function close(server) { return new Promise(resolve => server.close(resolve)); }
function changeSet(f) { return { schema_version: 1, change_set_id: "prototype-change:sample:1", session_id: f.record.session.session_id,
  base_commit: f.base, objective_digest: f.record.session.objective_digest, commit_message: "feat: add synthetic Prototype app source",
  operations: [{ action: "create", path: "prototypes/sample/index.html", content: "<!doctype html><title>Synthetic sample</title>\n", expected_digest: null }] }; }

test("Prototype draft and executor share actual UTF-8 byte bounds rather than accepting a later deterministic denial", t => {
  const f = setup(t); const value = changeSet(f);
  for (const content of ["界".repeat(30_000), "\ud800"]) {
    assert.throws(() => assertPrototypeChangeSet({ ...value, operations: [{ ...value.operations[0], content }] }, f.record.session), { code: "prototype_source_authoring_change_set_scope_denied" });
  }
  const operations = Array.from({ length: 9 }, (_, i) => ({ ...value.operations[0], path: `prototypes/sample/file-${i}.txt`, content: "a".repeat(65_536) }));
  assert.throws(() => assertPrototypeChangeSet({ ...value, operations }, f.record.session), { code: "prototype_source_authoring_change_set_scope_denied" });
  assert.equal(assertPrototypeChangeSet(value, f.record.session), value);
});

test("Prototype session and source scope cannot borrow Delivery identity, another owner, branch or Prototype", t => {
  const f = setup(t); const session = f.record.session;
  assert.equal(Object.hasOwn(session, "delivery_id"), false); assert.equal(Object.hasOwn(session, "work_item_id"), false);
  for (const change of [{ work_item_id: "work-item-42" }, { owner_repo: "other" }, { prototype_id: "prototype:other" },
    { landing_unit: { ...session.landing_unit, branch: "main" } }, { model_source_scope: { ...session.model_source_scope, source_root: "prototypes/other" } }]) {
    assert.throws(() => assertPrototypeSourceSession({ ...session, ...change }, "prototype:sample"), { code: "prototype_source_authoring_source_session_invalid" });
  }
});

test("trusted owner metadata is re-rendered at the executor and never grants model or arbitrary control writes", async t => {
  const f = setup(t); let plans = 0;
  f.record.request.owner_preparation = { kind: "preview-profile", port: 18199, ttl_seconds: 3600, support_profile: "interactive",
    runtime_activation: true, decision_ref: "record://operator-decisions/preview-example" };
  f.record.request_digest = canonicalDigest(f.record.request);
  const suffix = f.record.request_digest.slice(7, 31);
  f.record.binding.source_start = { landing_unit_id: `prototype-authoring-${suffix}`, branch: `feature/prototype-${suffix}`, fetched_base: f.base };
  const session = prototypeSourceSession(f.record), input = { prototype_id: session.prototype_id, session };
  const execute = (command, args, options) => {
    if (command !== "python3") return execFileSync(command, args, options);
    plans++; assert.equal(args[0], path.join(f.repo, "scripts/prototype_authoring.py")); assert.equal(args[3], "plan-preview");
    const request = JSON.parse(readFileSync(args[5], "utf8"));
    assert.equal(request.source_revision, f.base); assert.equal(request.operator.id, f.record.operator_id);
    const body = { schema_version: 1, status: "preparation-only", subject: session.subject, request_digest: canonicalDigest(request), operator: request.operator,
      changes: [{ operation: "write", path: "records/prototype-preview-profiles/sample.yaml", expected_content_digest: null,
        content: `schema_version: 1\nprototype_id: ${session.prototype_id}\n` }],
      authority: { may_apply_source: false, may_invoke_model: false, may_approve_baseline: false, may_activate_runtime: false } };
    return JSON.stringify({ ...body, plan_digest: canonicalDigest(body) });
  };
  const adapter = createPrototypeSourceAdapter({ workspaceRoot: f.root, execute, agentSourceIdentity: {
    async prepare({ repoRoot }) { git(repoRoot, "config", "user.name", "Agent Gary"); git(repoRoot, "config", "user.email", "gary@example.invalid"); return { state: "ready" }; },
  } });
  const draft = adapter.prepareOwner(input);
  assert.equal(draft.model_invoked, false); assert.equal(git(f.repo, "status", "--porcelain"), "");
  assert.throws(() => assertPrototypeChangeSet(draft.change_set, session), { code: "prototype_source_authoring_change_set_scope_denied" });
  const owned = await adapter.ensureOwnedWorktree(input);
  for (const operation of [{ ...draft.change_set.operations[0], content: "caller-substituted profile\n" },
    { ...draft.change_set.operations[0], path: "prototypes.yaml" }, { ...draft.change_set.operations[0], path: "prototypes/sample/index.html" }]) {
    await assert.rejects(async () => adapter.applySourceRealization({ ...input, change_set: { ...draft.change_set, operations: [operation] } }),
      { code: "prototype_source_authoring_owner_change_set_invalid" });
  }
  assert.equal(git(owned.path, "status", "--porcelain"), "");
  const receipt = await adapter.applySourceRealization({ ...input, change_set: draft.change_set });
  assert.equal(git(owned.path, "show", "-s", "--format=%an"), "Agent Gary");
  assert.deepEqual(await adapter.applySourceRealization({ ...input, change_set: draft.change_set }), receipt);
  assert.equal((await adapter.validateSource({ ...input, expected_head: receipt.head_commit })).result, "pass");
  assert.ok(plans >= 5); assert.equal(git(f.repo, "rev-parse", "main"), f.base);
});

test("actual Git Prototype capture excludes siblings/owner controls and accepted writes commit as Gary", async t => {
  const f = setup(t);
  await assert.rejects(f.adapter.captureRealizationContext(f.input), { code: "prototype_source_authoring_worktree_missing" });
  const owned = await f.adapter.ensureOwnedWorktree(f.input);
  const capture = await f.adapter.captureRealizationContext(f.input);
  assertPrototypeSourceCapture(f.record, capture);
  assert.deepEqual(capture.files.map(value => value.path), ["docs/prototypes/sample/design-profile.md", "prototypes/sample/README.md"]);
  assert.equal(JSON.stringify(capture).includes("Unrelated"), false);
  assert.deepEqual(capture.tree.paths, capture.files.map(value => value.path));
  for (const candidate of ["prototypes/other/index.html", "prototypes/sample/.github/workflows/ci.yaml", "prototypes/sample/AGENTS.md", "preview-profiles/sample.yaml", "prototypes.yaml"]) {
    await assert.rejects(async () => f.adapter.applySourceRealization({ ...f.input, change_set: { ...changeSet(f), operations: [{ ...changeSet(f).operations[0], path: candidate }] } }),
      { code: "prototype_source_authoring_change_set_scope_denied" });
  }
  assert.equal(git(owned.path, "status", "--porcelain"), "");
  const receipt = await f.adapter.applySourceRealization({ ...f.input, change_set: changeSet(f) });
  assert.equal(receipt.outcome, "committed"); assert.equal(receipt.base_commit, f.base);
  assert.equal(git(owned.path, "show", "-s", "--format=%an"), "Agent Gary");
  assert.equal(readFileSync(path.join(owned.path, "prototypes/sample/index.html"), "utf8"), changeSet(f).operations[0].content);
  assert.equal(git(f.repo, "rev-parse", "main"), f.base);
  assert.deepEqual(await f.adapter.applySourceRealization({ ...f.input, change_set: changeSet(f) }), receipt);
});

test("typed Prototype executor enforces live lease, recovers actual lost Git acknowledgement and cold-replays exact receipt", async t => {
  const f = setup(t); const socketPath = path.join(f.root, "source.sock"); const resultStoreRoot = path.join(f.root, "results");
  const context = { caller_id: f.record.caller_id, operator_id: f.record.operator_id, prototype_id: f.record.request.prototype_id,
    source_request_id: f.record.request.request_id, session_id: f.record.session.session_id, command_id: "prototype-command:apply:1" };
  let applies = 0; let guards = 0;
  const prototypeSource = { ...f.adapter, async applySourceRealization(input) { applies++; const receipt = await f.adapter.applySourceRealization(input); if (applies === 1) throw new Error("Lost committed acknowledgement"); return receipt; } };
  const adapters = { prototypeSource, lifecycleSource: {}, workSource: {} };
  let server = createDeliveryArtSourceExecutorServer({ executorId: "prototype-test", secret: SECRET, resultStoreRoot, adapters });
  await listen(server, socketPath);
  let client = createDeliveryArtSourceExecutorClient({ executorId: "prototype-test", secret: SECRET, socketPath, requireSourceLease: true });
  const run = operation => client.executor.run(context, operation);
  const leased = operation => client.executor.withSourceLeaseGuard(session => { guards++; assert.equal(session.session_id, f.record.session.session_id); }, () => run(operation));
  try {
    await assert.rejects(run(() => client.prototypeSource.ensureOwnedWorktree(f.input)), { code: "delivery_art_source_lease_required" });
    await leased(() => client.prototypeSource.ensureOwnedWorktree(f.input));
    await assert.rejects(leased(() => client.prototypeSource.applySourceRealization({ ...f.input, change_set: changeSet(f) })), /Lost committed acknowledgement/);
    const recovered = await leased(() => client.prototypeSource.applySourceRealization({ ...f.input, change_set: changeSet(f) }));
    assert.equal(applies, 2); assert.equal(recovered.outcome, "committed");
    await close(server); rmSync(socketPath, { force: true });
    server = createDeliveryArtSourceExecutorServer({ executorId: "prototype-test", secret: SECRET, resultStoreRoot, adapters });
    const coldSocket = path.join(f.root, "cold-source.sock");
    await listen(server, coldSocket);
    client = createDeliveryArtSourceExecutorClient({ executorId: "prototype-test", secret: SECRET, socketPath: coldSocket, requireSourceLease: true });
    assert.deepEqual(await leased(() => client.prototypeSource.applySourceRealization({ ...f.input, change_set: changeSet(f) })), recovered);
    assert.equal(applies, 2); assert.equal(guards, 4);
    await assert.rejects(client.executor.run({ ...context, operator_id: "operator:other" }, () => client.prototypeSource.captureRealizationContext(f.input)),
      { code: "prototype_source_executor_session_mismatch" });
    assert.equal(textDigest(changeSet(f).operations[0].content), textDigest(readFileSync(path.join(f.root, ".worktrees", f.record.session.landing_unit_id, "workspace-prototype-studio", "prototypes/sample/index.html"), "utf8")));
  } finally { await close(server); }
});

test("native Prototype review gate binds owner CI and human head, then squash cleanup proves and retires only exact owned Git resources", async t => {
  const f = setup(t); let approved = false; let checksPass = false; let merged = false; let mergeCommit = null; let approvals = 0;
  const owned = await f.adapter.ensureOwnedWorktree(f.input);
  const receipt = await f.adapter.applySourceRealization({ ...f.input, change_set: changeSet(f) });
  const head = receipt.head_commit; const branch = f.record.session.landing_unit.branch;
  git(owned.path, "push", "origin", branch);
  const url = "https://github.com/example/workspace-prototype-studio/pull/1";
  const execute = (command, args, options) => {
    if (command !== "gh") return execFileSync(command, args, options);
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify([{ number: 1, state: merged ? "MERGED" : "OPEN", isDraft: false,
      url, headRefOid: head, baseRefName: "main", mergeCommit: mergeCommit ? { oid: mergeCommit } : null }]);
    if (args[0] === "api" && args[1].includes("/check-runs?")) return JSON.stringify({ check_runs: [{ id: 1, name: "validate", head_sha: head,
      status: "completed", conclusion: checksPass ? "success" : "failure", app: { slug: "github-actions" } }] });
    if (args[0] === "api" && args[1].endsWith("/reviews")) return approved ? JSON.stringify({ id: 1, commit_id: head, state: "APPROVED", user: { login: "owner" } }) : "";
    if (args[0] === "api" && args[1].endsWith("/pulls/1")) return "gary[bot]";
    if (args[0] === "pr" && args[1] === "review") { approvals++; approved = true; return ""; }
    if (args[0] === "pr" && args[1] === "merge") {
      assert.equal(approved, true); assert.equal(checksPass, true); assert.equal(args.includes(head), true);
      git(f.repo, "merge", "--squash", branch); git(f.repo, "commit", "-m", "Reviewed source squash landing");
      git(f.repo, "push", "origin", "main"); mergeCommit = git(f.repo, "rev-parse", "HEAD"); merged = true; return "";
    }
    throw new Error("Unexpected provider command in bounded review fixture");
  };
  const adapter = createPrototypeSourceAdapter({ workspaceRoot: f.root, execute, agentSourceIdentity: {
    reviewPolicy() { return { repository: "example/workspace-prototype-studio", required_reviewer_id: "owner", source_author_id: "gary[bot]" }; },
    assertHumanMergeAuthority() { return { reviewer_id: "owner" }; },
  } });
  const input = { ...f.input, expected_pull_request: { url, head_commit: head } };
  await assert.rejects(adapter.approvePullRequest(input), { code: "prototype_source_authoring_review_binding_changed" }); assert.equal(approvals, 0);
  checksPass = true;
  const validation = await adapter.validateSource({ ...f.input, expected_head: head });
  assert.equal(validation.command, "make validate"); assert.equal(validation.source_revision, head); assert.equal(validation.base_revision, f.base);
  assert.equal((await adapter.approvePullRequest(input)).review.approved, true);
  assert.equal((await adapter.mergePullRequest(input)).merge_commit, mergeCommit);
  const forged = structuredClone(owned.resources); forged[1].locator.branch = "main";
  await assert.rejects(adapter.retireSourceResources({ ...input, resources: forged }), { code: "prototype_source_authoring_resource_binding_invalid" });
  assert.equal(git(f.repo, "rev-parse", `refs/heads/${branch}`), head);
  const retired = await adapter.retireSourceResources({ ...input, resources: owned.resources });
  assert.equal(retired.complete, true); assert.equal(retired.resources.every(value => value.outcome === "removed"), true);
  assert.throws(() => git(f.repo, "show-ref", "--verify", `refs/heads/${branch}`));
  assert.equal(git(f.repo, "ls-remote", "--heads", "origin", branch), "");
  assert.equal(git(f.repo, "show", "main:prototypes/sample/index.html"), changeSet(f).operations[0].content.trim());
  assert.equal(git(f.repo, "status", "--porcelain"), "");
});

test('operator file-tree/read and draft validation keep the actual Prototype base clean and scoped before Gary apply',async t=>{
  const f=setup(t);await f.adapter.ensureOwnedWorktree(f.input);
  const tree=await f.adapter.captureRealizationContext({...f.input,requested_paths:[],tree_only:true});
  assert.equal(tree.files.length,0);assert.equal(tree.admitted_bytes,0);
  assert.equal(tree.tree.paths.includes('README.md'),false);assert.equal(tree.tree.paths.includes('prototypes/other/private.txt'),false);
  const selected=await f.adapter.captureRealizationContext({...f.input,requested_paths:['prototypes/sample/README.md'],tree_only:false});
  assert.equal(selected.files[0].content,'Prototype source\n');
  const change=changeSet(f);change.operations[0].content='\uFEFF<!doctype html>\r\n<title>你好</title>\r\n';
  const valid=await f.adapter.validateSourceRealization({...f.input,change_set:change});
  assert.equal(valid.valid,true);assert.equal(valid.change_set_digest,canonicalDigest(change));
  const worktree=path.join(f.root,'.worktrees',f.record.session.landing_unit_id,'workspace-prototype-studio');
  assert.equal(git(worktree,'rev-parse','HEAD'),f.base);assert.equal(git(worktree,'status','--porcelain'),'');
  for(const file of ['README.md','prototypes/other/private.txt','prototypes/sample/.env','prototypes/sample/.github/workflows/pwn.yml']){
    await assert.rejects(async()=>f.adapter.validateSourceRealization({...f.input,change_set:{...change,operations:[{...change.operations[0],path:file}]}}));
    await assert.rejects(f.adapter.captureRealizationContext({...f.input,requested_paths:[file]}));
  }
  const replaced={...change,operations:[{action:'replace',path:'prototypes/sample/README.md',content:'changed\r\n',expected_digest:textDigest('wrong base')}]};
  await assert.rejects(f.adapter.validateSourceRealization({...f.input,change_set:replaced}),{code:'delivery_art_source_realization_source_drift'});
  const committed=await f.adapter.applySourceRealization({...f.input,change_set:change});
  assert.equal(committed.outcome,'committed');assert.equal(readFileSync(path.join(worktree,change.operations[0].path),'utf8'),change.operations[0].content);
  assert.match(git(worktree,'show','-s','--format=%an'),/^Agent Gary$/);
  await assert.rejects(f.adapter.validateSourceRealization({...f.input,change_set:change}),{code:'delivery_art_source_realization_source_drift'});
});

test('malformed UTF-8, binary and linked existing source cannot be silently normalized by operator read or draft validation',async t=>{
  const f=setup(t),directory=path.join(f.repo,'prototypes/sample');
  writeFileSync(path.join(directory,'invalid.txt'),Buffer.from([0xc0,0xaf]));writeFileSync(path.join(directory,'binary.txt'),Buffer.from([65,0,66]));
  symlinkSync('../../README.md',path.join(directory,'linked.txt'));symlinkSync('../../absent-target',path.join(directory,'dangling.txt'));writeFileSync(path.join(f.repo,'.gitignore'),'prototypes/sample/ignored/\n');git(f.repo,'add','.');git(f.repo,'commit','-m','Synthetic unsupported source baseline');
  const base=git(f.repo,'rev-parse','HEAD');f.base=base;f.record.binding.subject.source_revision=base;f.record.binding.source_start.fetched_base=base;
  f.record.session=prototypeSourceSession(f.record);f.input.session=f.record.session;await f.adapter.ensureOwnedWorktree(f.input);
  for(const filename of ['invalid.txt','binary.txt','linked.txt','dangling.txt']){
    const path='prototypes/sample/'+filename;
    await assert.rejects(f.adapter.captureRealizationContext({...f.input,requested_paths:[path]}));
    await assert.rejects(async()=>f.adapter.validateSourceRealization({...f.input,change_set:{...changeSet(f),operations:[{action:'replace',path,content:'replacement\n',expected_digest:textDigest('unreadable original')}]}}));
  }
  const worktree=path.join(f.root,'.worktrees',f.record.session.landing_unit_id,'workspace-prototype-studio');
  assert.equal(git(worktree,'rev-parse','HEAD'),base);assert.equal(git(worktree,'status','--porcelain'),'');
  assert.deepEqual(readFileSync(path.join(worktree,'prototypes/sample/invalid.txt')),Buffer.from([0xc0,0xaf]));
  mkdirSync(path.join(worktree,'prototypes/sample/ignored'));writeFileSync(path.join(worktree,'prototypes/sample/ignored/private.txt'),'ignored local dependency text');
  await assert.rejects(f.adapter.captureRealizationContext({...f.input,requested_paths:['prototypes/sample/ignored/private.txt']}));
  await assert.rejects(async()=>f.adapter.validateSourceRealization({...f.input,change_set:{...changeSet(f),operations:[{action:'create',path:'prototypes/sample/ignored/new.txt',content:'must not stage ignored material',expected_digest:null}]}}));
  assert.equal(git(worktree,'status','--porcelain'),'');
});
