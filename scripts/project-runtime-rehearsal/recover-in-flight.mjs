import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const mode = process.argv[2];
const input = JSON.parse(readFileSync(0, "utf8"));
const load = name => import(path.join(input.broker, "src", name));
const { captureSavedProjectSource } = await load("project-runtime/saved-source.js");
const { createSavedProjectRuntimeCommands } = await load("project-runtime/commands.js");
const { createPlatformOperationProviderClient } = await load("platform-operation/provider-client.js");
const { canonicalDigest } = await load("delivery-art/canonical-json.js");

const digest = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const changeSet = { session_id: "proof:saved-workspace", base_commit: input.base, operations: [
  { path: "app/index.html", action: "replace", expected_digest: digest("<main>Old</main>\n"), content: "<main>Verified in-flight recovery</main>\n" },
  { path: "app/remove.txt", action: "delete", expected_digest: digest("Remove this file\n"), content: null },
] };
const saved = { revision: "saved:in-flight-recovery", change_set: changeSet };
const source = { kind: "saved-draft", base_commit: input.base, session_id: changeSet.session_id,
  revision: saved.revision, change_set_digest: canonicalDigest(changeSet) };
const selection = { project_ref: input.scope.project_custody_ref, scope: input.scope,
  subject: {kind:"delivery",ref:"work-item-42"}, setup: input.setup, source };
const base = { callerId: "test:recovery-caller", operatorId: "operator:recovery-test", commandId: "run:real-process-loss" };
const request = { command_id: base.commandId, project_ref: selection.project_ref, expected_revision: 0,
  source_revision: source.revision, source_digest: source.change_set_digest, configuration_revision: input.setup.configuration_revision };
const api = createPlatformOperationProviderClient({ allowHttp: true, baseUrl: input.url,
  callerId: "rehearsal-broker", callerSecret: input.secret });
let submissions = 0;
const candidates = new Map();
const capture = ({ commandId, selection }, draft) => captureSavedProjectSource({
  repository: input.repository, snapshotRoot: input.snapshots, scope: selection.scope,
  source: selection.source, setup: selection.setup, commandId, saved: draft,
  limits: { max_files: 24, max_bytes: 65536, max_tree_bytes: 65536 },
});
const service = createSavedProjectRuntimeCommands({
  root: path.join(input.root, "broker-state"),
  authority: {
    resolve: async ({ request }) => candidates.get(request.command_id)?.selection ?? selection,
    capture: async args => capture(args, candidates.get(args.commandId)?.draft ?? saved),
    withCurrentScope: async (_scope, operation) => operation(),
  },
  platform: {
    async submit(binding) {
      assert.equal(mode, "dispatch", "Recovery must not dispatch a second Run");
      submissions++;
      const receipt = await api.submitProjectRuntime(binding);
      assert.equal(receipt.state, "preparing");
      assert.equal(receipt.operation_id, binding.operation_id);
      assert.equal(receipt.manifest_digest, binding.snapshot.manifest_digest);
      assert.equal(receipt.configuration_revision, input.setup.configuration_revision);
      assert.equal(submissions, 1);
      writeFileSync(path.join(input.root, "owner-receipt.json"), JSON.stringify(receipt), {mode:0o600,flush:true});
      process.kill(process.pid, "SIGKILL");
      throw Error("Broker exit failed");
    },
    read: api.readProjectRuntime,
  },
});
if (mode === "dispatch") {
  const acknowledgement = await service.accept({...base,request});
  assert.equal(service.read(base).status, "acknowledged");
  assert.equal(submissions, 0);
  writeFileSync(path.join(input.root, "broker-receipt.json"), JSON.stringify(acknowledgement), {mode:0o600,flush:true});
  await service.advance(base);
  throw Error("The broker should have stopped after the owner accepted");
}
const original = JSON.parse(readFileSync(path.join(input.root, "broker-receipt.json"), "utf8"));
if (mode === "reject") {
  function readSnapshot(reference) {
    const folder = path.join(input.snapshots, reference.manifest_digest.slice(7));
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    assert.equal(canonicalDigest(manifest), reference.manifest_digest);
    for (const file of manifest.files) {
      const content = readFileSync(path.join(folder, "blobs", file.blob_digest.slice(7)));
      assert.equal(digest(content), file.blob_digest);
      assert.equal(content.length, file.size);
    }
    return { folder, manifest };
  }

  const valid = readSnapshot(original.snapshot).manifest;
  const originalRead = service.read(base);
  assert.equal(originalRead.status, "ready");
  const rejections = {};

  async function expectDenied(label, changedRequest, code) {
    const subject = { ...base, commandId: changedRequest.command_id };
    await assert.rejects(service.accept({ ...subject, request: changedRequest }), { code });
    if (subject.commandId !== base.commandId) {
      assert.throws(() => service.read(subject), { code: "project_runtime_command_not_found" });
      await assert.rejects(service.advance(subject), { code: "project_runtime_command_not_found" });
    }
    rejections[label] = code;
  }

  for (const corrupt of ["missing", "changed"]) {
    const commandId = `run:rejected-${corrupt}-blob`;
    const candidate = await capture({ commandId, selection }, saved);
    const { folder, manifest } = readSnapshot(candidate);
    const file = path.join(folder, "blobs", manifest.files[0].blob_digest.slice(7));
    if (corrupt === "missing") {
      unlinkSync(file);
    } else {
      const modified = readFileSync(file);
      modified[0] ^= 1;
      writeFileSync(file, modified);
    }
    await expectDenied(`${corrupt}Blob`, {
      ...request, command_id: commandId, expected_revision: original.scope_revision,
    }, "project_source_snapshot_changed");
  }

  for (const [label, pathname] of [
    ["outsideAppScope", "private.txt"], ["unapprovedDependency", "unapproved/module.js"],
  ]) {
    const commandId = `run:rejected-${label}`;
    const operation = { path: pathname, action: "replace", content: "Rejected test input\n",
      expected_digest: digest(readFileSync(path.join(input.repository, pathname))) };
    const draft = { revision: `saved:${label}`, change_set: {
      ...changeSet, operations: [...changeSet.operations, operation],
    } };
    const rejectedSource = { ...source, revision: draft.revision, change_set_digest: canonicalDigest(draft.change_set) };
    candidates.set(commandId, { selection: { ...selection, source: rejectedSource }, draft });
    await expectDenied(label, {
      ...request, command_id: commandId, expected_revision: original.scope_revision,
      source_revision: rejectedSource.revision, source_digest: rejectedSource.change_set_digest,
    }, "project_source_outside_scope");
  }

  await expectDenied("changedRevisionReplay", {
    ...request, source_revision: "saved:different-revision",
  }, "project_runtime_command_conflict");
  await expectDenied("changedProjectReplay", {
    ...request, project_ref: "project:different-replay-scope",
  }, "project_runtime_command_conflict");
  assert.deepEqual(readSnapshot(original.snapshot).manifest, valid);
  assert.deepEqual(service.read(base), originalRead);
  assert.equal(submissions, 0);
  console.log(JSON.stringify({ ...rejections, originalSnapshotPreserved: true, rejectedSubmissions: submissions }));
  process.exit(0);
}
assert.deepEqual(await service.accept({...base,request}), original);
assert.equal(service.read(base).status, "unknown");
let observed = await service.advance(base);
assert.equal(observed.status, "preparing");
writeFileSync(path.join(input.root, "recovery-observed.json"), JSON.stringify(observed), {mode:0o600,flush:true});
const deadline = Date.now()+170_000;
while (observed.status !== "ready" && Date.now() < deadline) {
  assert.notEqual(observed.status, "failed");
  await sleep(1100);
  observed = await service.advance(base);
}
assert.equal(observed.status, "ready");
assert.equal(submissions, 0);
assert.deepEqual(observed.acknowledgement, original);
console.log(JSON.stringify({status:observed.status, originalOperation:original.operation_id,
  originalSnapshot:original.snapshot.manifest_digest, instanceRef:observed.observation.instance_ref, submissionsAfterRecovery:submissions}));
