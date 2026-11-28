import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { captureSavedProjectSource } from "../src/project-runtime/saved-source.js";
import { createProjectRuntimeCommands } from "../src/project-runtime/source-commands.js";
import { createProjectRuntime } from "../src/project-runtime/runtime.js";
import { createDeliveryArtWorkSessionSourceAdapter } from "../src/delivery-art/work-session-cli-adapters.js";
import { createDeliveryArtSourceExecutorClient, createDeliveryArtSourceExecutorServer } from "../src/delivery-art/source-executor.js";
import { createOperatorDraftEditor } from "../src/source-authoring/operator-drafts.js";
import { HttpError } from "../src/errors.js";

const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "project-runtime-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo");
  const snapshotRoot = path.join(root, "snapshots");
  mkdirSync(repository);
  mkdirSync(snapshotRoot);
  const git = (...args) => execFileSync("git", args, {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init");
  git("config", "user.name", "Source test");
  git("config", "user.email", "source-test@example.invalid");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", "/dev/null");
  const write = (name, value) => {
    const file = path.join(repository, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  const binary = Buffer.alloc(1_250_000, 0xc7);
  write("apps/site/index.txt", "\uFEFFbase\r\n");
  write("apps/site/obsolete.txt", "remove\n");
  write("apps/site/assets/image.bin", binary);
  write("packages/theme/style.css", ".card {}\n");
  write("apps/elsewhere/index.txt", "outside\n");
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "Record test source");
    return git("rev-parse", "HEAD");
  };
  const command = {
    repository, snapshotRoot,
    commandId: "project-command:original",
    scope: {
      installation_id: "installation:local", project_custody_ref: "custody:site-v1",
      repository_id: 123, app_root: "apps/site", dependency_paths: ["packages/theme"],
      environment_ref: "dev-integration:local",
    },
    source: { kind: "committed", base_commit: commit(), session_id: "source-session:site" },
    setup: { recipe_id: "node-frontend", configuration_revision: "setup:v3" },
    limits: { max_files: 80, max_bytes: 2_000_000, max_tree_bytes: 36_000 },
  };
  const snapshot = reference => path.join(snapshotRoot, reference.manifest_digest.slice(7));
  return { root, binary, repository, snapshotRoot, git, write, commit, snapshot, command };
}

function savedDraft(input, operations) {
  const changeSet = { schema_version: 1, base_commit: input.source.base_commit,
    session_id: input.source.session_id, operations };
  const revision = "2026-11-26T03:59:00.000Z";
  return { ...input,
    source: { ...input.source, kind: "saved-draft", revision, change_set_digest: canonicalDigest(changeSet) },
    saved: { revision, change_set: changeSet },
  };
}

test("snapshots pinned Git bytes with the exact saved overlay, a large asset, and only admitted dependencies", async t => {
  const f = fixture(t);
  f.write("apps/site/index.txt", "a newer checkout\n");
  f.commit();
  const nextText = "\uFEFFsaved\r\n";
  const command = savedDraft(f.command, [
    { path: "apps/site/index.txt", action: "patch", content: "saved", expected_digest: hash("\uFEFFbase\r\n"),
      patch: { offset_utf16: 1, before: "base" } },
    { path: "apps/site/obsolete.txt", action: "delete", content: null, expected_digest: hash("remove\n") },
    { path: "apps/site/new/components.txt", action: "create", content: "new\n", expected_digest: null },
  ]);
  const reference = await captureSavedProjectSource(command);
  const directory = f.snapshot(reference);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json")));
  assert.equal(canonicalDigest(manifest), reference.manifest_digest);
  assert.deepEqual(manifest.source, command.source);
  assert.deepEqual(manifest.setup, command.setup);
  assert.equal(manifest.command_id, command.commandId);
  assert.deepEqual(manifest.files.map(file => file.path), [
    "apps/site/assets/image.bin", "apps/site/index.txt", "apps/site/new/components.txt", "packages/theme/style.css",
  ]);
  for (const [name, bytes] of Object.entries({
    "apps/site/assets/image.bin": f.binary, "apps/site/index.txt": Buffer.from(nextText),
    "apps/site/new/components.txt": Buffer.from("new\n"),
    "packages/theme/style.css": Buffer.from(".card {}\n"),
  })) {
    const file = manifest.files.find(entry => entry.path === name);
    assert.equal(file.blob_digest, hash(bytes));
    assert.equal(file.size, bytes.length);
    assert.deepEqual(readFileSync(path.join(directory, "blobs", file.blob_digest.slice(7))), bytes);
  }
  assert.deepEqual(await captureSavedProjectSource(command), reference);
  assert.deepEqual(readdirSync(f.snapshotRoot), [reference.manifest_digest.slice(7)]);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(readFileSync(path.join(f.repository, "apps/site/index.txt"), "utf8"), "a newer checkout\n");
});

test("mismatched source, baseline or scope cannot publish a snapshot", async t => {
  const f = fixture(t);
  const valid = savedDraft(f.command, [
    { path: "apps/site/index.txt", action: "replace", content: "new", expected_digest: hash("\uFEFFbase\r\n") },
  ]);
  await assert.rejects(captureSavedProjectSource({ ...valid,
    saved: { ...valid.saved, revision: "another revision" },
  }), { code: "project_source_draft_changed" });
  await assert.rejects(captureSavedProjectSource(savedDraft(f.command, [
    { path: "apps/site/index.txt", action: "replace", content: "new", expected_digest: hash("another base") },
  ])), { code: "project_source_baseline_changed" });
  await assert.rejects(captureSavedProjectSource(savedDraft(f.command, [
    { path: "apps/elsewhere/new.txt", action: "create", content: "not in scope", expected_digest: null },
  ])), { code: "project_source_outside_scope" });
  await assert.rejects(captureSavedProjectSource({ ...f.command,
    limits: { ...f.command.limits, max_bytes: 100 },
  }), { code: "project_source_source_over_limit" });
  assert.deepEqual(readdirSync(f.snapshotRoot), []);
});

test("links, case-folded directory collisions and altered retained blobs cannot be used", async t => {
  const f = fixture(t);
  const reference = await captureSavedProjectSource(f.command);
  const dir = f.snapshot(reference);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json")));
  const blob = manifest.files.find(row => row.path === "apps/site/index.txt").blob_digest.slice(7);
  writeFileSync(path.join(dir, "blobs", blob), "invalid");
  await assert.rejects(captureSavedProjectSource(f.command), { code: "project_source_snapshot_changed" });
  await assert.rejects(captureSavedProjectSource(savedDraft(f.command, [
    { path: "apps/site/Assets/new.txt", action: "create", content: "collision", expected_digest: null },
  ])), { code: "project_source_path_collision" });
  symlinkSync("../elsewhere/index.txt", path.join(f.repository, "apps/site/link"));
  const base_commit = f.commit();
  await assert.rejects(captureSavedProjectSource({ ...f.command, source: { ...f.command.source, base_commit } }),
    { code: "project_source_entry_unsupported" });
  assert.deepEqual(readdirSync(f.snapshotRoot), [reference.manifest_digest.slice(7)]);
});

test("the acknowledged draft traverses the real source executor and survives a lost Platform reply", async t => {
  const f = fixture(t);
  const callerId = "console";
  const operatorId = "operator:example";
  const workItemId = "work-item-42";
  const createdAt = "2026-11-26T03:00:00.000Z";
  const now = "2026-11-26T04:00:00.000Z";
  const session = {
    session_id: f.command.source.session_id, caller_id: callerId, operator: { id: operatorId },
    covered_work_item_ids: [workItemId], owner_repo: "repo", created_at: createdAt,
    landing_unit: { base_commit: f.command.source.base_commit, branch: f.git("branch", "--show-current") },
  };
  const artifacts = new Map();
  let editor = { attempts: [], revision: createdAt };
  const saveDraft = createOperatorDraftEditor({
    enabled: true, sessionFor: () => session, readRecord: () => editor,
    assertIdentity(actual, caller, operator) {
      assert.equal(actual.caller_id, caller);
      assert.equal(actual.operator.id, operator);
    },
    writeRecord(_session, record) { editor = record; },
    withLock: (_session, callback) => callback(),
    putArtifact(_session, name, value) { artifacts.set(name, value); return name; },
    readArtifact: (_session, ref) => artifacts.get(ref),
    validateDraft: async (_session, changeSet) => {
      assert.equal(changeSet.base_commit, f.command.source.base_commit);
    },
    project: record => ({ revision: record.revision }),
    nextRevision: record => new Date(Math.max(Date.parse(now), Date.parse(record.revision) + 1)).toISOString(),
    clock: () => new Date(now),
    error: (code, message, options) => new HttpError(options.statusCode, code, message),
  });
  async function save(id, content, prior = null) {
    return saveDraft({ callerId, operatorId, subjectRef: workItemId, request: {
      schema_version: 1, command_id: id, execution_id: "editor:site", expected_revision: editor.revision,
      expected_change_set_digest: prior, requested_at: now, objective: "Update the project preview.",
      input_origin: "manual", retry_of: null, commit_message: "Update test project",
      operations: [{ path: "apps/site/index.txt", action: "replace", content, expected_digest: hash("\uFEFFbase\r\n") }],
    } });
  }
  const workSource = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot: f.root, projectSnapshotRoot: f.snapshotRoot,
    agentSourceIdentity: { async inspectRepositoryAdmission() { return { state: "ready", repository_id: 123 }; } },
    projectWorkSessionStore: {
      readByAlias: id => id === workItemId ? session : null,
      readArtifact: (_session, ref) => ref === "source-realization.json" ? editor : artifacts.get(ref),
    },
  });
  const socketPath = path.join(f.root, "executor.sock");
  const executorConfig = { executorId: "test-executor", secret: randomBytes(32).toString("hex") };
  const server = createDeliveryArtSourceExecutorServer({ ...executorConfig, adapters: { workSource, lifecycleSource: {} } });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executor = createDeliveryArtSourceExecutorClient({ ...executorConfig, socketPath, requireSourceLease: true });
  let sourceWritesAllowed = true;
  const binding = {
    project_ref: "project:site", subject: { kind: "delivery", ref: workItemId },
    scope: f.command.scope, setup: f.command.setup, limits: f.command.limits,
  };
  const workSessions = {
    async readRealizationSource(input) {
      assert.equal(input.workItemId, workItemId);
      const latest = editor.attempts.at(-1);
      return latest ? { session_id: session.session_id, operator_draft: latest.operator_draft,
        revision: editor.revision, digest: latest.change_set_digest, change_set: latest.change_set } : null;
    },
    async captureProjectRuntimeSource({ selection }) {
      return executor.executor.run({ caller_id: callerId, operator_id: operatorId, work_item_id: workItemId,
        command_id: selection.command_id, session_id: session.session_id }, () =>
        executor.executor.withSourceLeaseGuard(actual => {
          assert.equal(actual.session_id, session.session_id);
          if (!sourceWritesAllowed) throw new HttpError(403, "lease_expired", "The source lease is closed.");
        }, () => executor.workSource.captureProjectRuntimeSource(session, selection)));
    },
    async withAuthorizedProjectSource(input, callback) {
      assert.equal(input.workItemId, workItemId);
      if (!sourceWritesAllowed) throw new HttpError(403, "lease_expired", "The source lease is closed.");
      return callback();
    },
  };
  // The Platform adapter is a transport double for this real-Git broker test.
  // A separate operating rehearsal must prove the production owner adapter.
  const seen = new Map();
  let sends = 0;
  let forcedObservation = null;
  const platform = {
    async submit(command) {
      sends += 1;
      seen.set(command.operation_id, {
        command_id: command.command_id, operation_id: command.operation_id, scope_digest: command.scope_digest,
        configuration_revision: command.setup.configuration_revision, manifest_digest: command.snapshot.manifest_digest,
        state: "ready", observed_at: now, instance_ref: "instance:example", owner_receipt_ref: "receipt:example",
      });
      throw new Error("Owner completed the effect but the reply was lost.");
    },
    async read(command) { return forcedObservation ?? seen.get(command.operation_id) ?? null; },
  };
  let setup = binding.setup;
  const create = () => createProjectRuntimeCommands({
    root: path.join(f.root, "commands"), delivery: workSessions, platform, clock: () => new Date(now),
    readSetup: async () => ({ ...binding, setup }),
  });
  const broker = create();
  const request = { command_id: "runtime:original", project_ref: binding.project_ref,
    expected_revision: 0, source_revision: now, source_digest: hash("not-yet-saved"),
    configuration_revision: binding.setup.configuration_revision,
  };
  await assert.rejects(broker.accept({ callerId, operatorId, request }), { code: "project_runtime_selection_changed" });
  assert.equal(sends, 0);

  const saved = await save("save:original", "the exact saved page\n");
  request.source_revision = saved.revision;
  request.source_digest = editor.attempts.at(-1).change_set_digest;
  const acknowledgement = await broker.accept({ callerId, operatorId, request });
  const commandKey = { callerId, operatorId, commandId: request.command_id };
  assert.equal(broker.read(commandKey).status, "acknowledged");
  assert.equal(sends, 0, "a retained acknowledgement does not dispatch");
  assert.equal(acknowledgement.scope_revision, 1);
  const manifest = JSON.parse(readFileSync(path.join(f.snapshot(acknowledgement.snapshot), "manifest.json")));
  const index = manifest.files.find(file => file.path === "apps/site/index.txt");
  assert.equal(index.blob_digest, hash("the exact saved page\n"));

  setup = { ...binding.setup, configuration_revision: "setup:changed" };
  await assert.rejects(broker.advance(commandKey), { code: "project_runtime_setup_changed" });
  assert.equal(broker.read(commandKey).status, "acknowledged");
  assert.equal(sends, 0);
  setup = binding.setup;
  const afterLoss = await broker.advance(commandKey);
  assert.equal(afterLoss.status, "unknown");
  assert.equal(afterLoss.observation, null);
  assert.equal(sends, 1);
  await save("save:newer", "unsuitable replacement\n", request.source_digest);
  sourceWritesAllowed = false;
  const reopened = create();
  assert.deepEqual(await reopened.accept({ callerId, operatorId, request }), acknowledgement);
  await assert.rejects(reopened.accept({ callerId, operatorId, request: {
    ...request, source_digest: editor.attempts.at(-1).change_set_digest,
  } }), { code: "project_runtime_command_conflict" });
  assert.throws(() => reopened.read({ ...commandKey, operatorId: "other" }), { code: "project_runtime_command_not_found" });
  assert.equal((await reopened.advance(commandKey)).status, "ready");
  assert.equal(sends, 1, "recovery must read the original operation without another dispatch");
  forcedObservation = { ...seen.get(acknowledgement.operation_id), manifest_digest: hash("another snapshot") };
  await assert.rejects(reopened.advance(commandKey), { code: "project_runtime_observation_mismatch" });
  const unconfirmed = reopened.read(commandKey);
  assert.equal(unconfirmed.status, "unknown");
  assert.equal(unconfirmed.observation, null);
  assert.equal(unconfirmed.last_observation.state, "ready");
  assert.equal(sends, 1);
});

test("Prototype composition reads the admitted setup and reconciles one exact saved run", async t => {
  const f = fixture(t);
  const subject = { kind: "prototype", ref: "prototype-request:one" };
  const binding = { project_ref: "project:site", subject, scope: f.command.scope };
  const second = { project_ref: "project:other", subject: { kind: "prototype", ref: "prototype-request:other" },
    scope: { ...binding.scope, project_custody_ref: "custody:other" } };
  const identity = { callerId: "console", operatorId: "operator:a", requestId: subject.ref };
  const selected = savedDraft(f.command, [{ path: "apps/site/index.txt", action: "replace",
    content: "the acknowledged Prototype draft\n", expected_digest: hash("\uFEFFbase\r\n") }]);
  const readySetup = { ...binding, setup: f.command.setup, limits: { max_files: 80, max_bytes: 2_000_000 } };
  let currentSetup = readySetup;
  let effect = null;
  let submissions = 0;
  const runtime = createProjectRuntime({
    root: f.root, rawBindings: JSON.stringify([binding, second]),
    operatorBindings: { console: "operator:a" },
    prototype: {
      read: ({ requestId }) => ({ session_id: selected.source.session_id, request_id: requestId, source_request: {} }),
      draft: () => ({ operator_draft: true, session_id: selected.source.session_id, revision: selected.saved.revision,
        digest: selected.source.change_set_digest, change_set: selected.saved.change_set }),
      captureProjectRuntimeSource: ({ selection }) => captureSavedProjectSource({ ...selected,
        commandId: selection.command_id, scope: selection.scope, source: selection.source,
        setup: selection.setup, limits: selection.limits }),
      withAuthorizedProjectSource: (_input, operation) => operation(),
    },
    provider: {
      readProjectRuntimeSetup: () => currentSetup,
      submitProjectRuntime: async command => {
        submissions++;
        effect = { command_id: command.command_id, operation_id: command.operation_id, scope_digest: command.scope_digest,
          configuration_revision: command.setup.configuration_revision, manifest_digest: command.snapshot.manifest_digest,
          state: "ready", observed_at: "2026-11-28T09:00:00.000Z",
          instance_ref: "instance:site", owner_receipt_ref: "receipt:site" };
        throw new Error("lost response after owner dispatch");
      },
      readProjectRuntime: async () => effect,
    },
  });
  await assert.rejects(runtime.overview({ ...identity, operatorId: "operator:other" }), { code: "project_runtime_operator_forbidden" });
  assert.deepEqual(await runtime.overview(identity), { project_ref: binding.project_ref, setup: f.command.setup,
    revision: 0, records: [], before: null });

  const command = { command_id: "run:prototype-one", expected_revision: 0, source_revision: selected.saved.revision,
    source_digest: selected.source.change_set_digest, configuration_revision: f.command.setup.configuration_revision };
  await assert.rejects(runtime.run({ ...identity, command: { ...command, source_digest: hash("an unsaved buffer") } }),
    { code: "project_runtime_selection_changed" });
  currentSetup = { ...readySetup, scope: second.scope };
  await assert.rejects(runtime.overview(identity), { code: "project_runtime_setup_mismatch" });
  currentSetup = readySetup;
  assert.equal(submissions, 0);

  const first = await runtime.run({ ...identity, command });
  assert.equal(first.status, "unknown");
  assert.equal(first.source_digest, command.source_digest);
  const commandKey = { ...identity, commandId: command.command_id };
  const manifest = JSON.parse(readFileSync(path.join(f.snapshot(first.acknowledgement.snapshot), "manifest.json")));
  assert.equal(manifest.files.find(file => file.path === "apps/site/index.txt").blob_digest,
    hash("the acknowledged Prototype draft\n"));
  await assert.rejects(runtime.reconcile({ ...commandKey, requestId: second.subject.ref }, true),
    { code: "project_runtime_command_not_found" });
  const recovered = await runtime.reconcile(commandKey, true);
  assert.equal(recovered.status, "ready");
  assert.equal(submissions, 1);
  assert.deepEqual((await runtime.overview({ ...identity, limit: 1 })).records, [recovered]);
  assert.deepEqual((await runtime.overview({ ...identity, before: 1 })).records, []);
});
