import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { assertProposalTargetArtifact, bindProposalTarget } from "../src/proposal-target-application/contracts.js";
import { createPrototypeLandingSourceClient } from "../src/prototype-landing/source-client.js";

const execute = promisify(execFile);
const git = async (root, ...args) => (await execute("git", ["-C", root, ...args])).stdout.trim();

function capture() {
  const at = "2026-10-01T00:00:00.000Z";
  const digest = `sha256:${"a".repeat(64)}`;
  const source = { authority: "workspace-proposals", ref: "openproject://work_packages/51", revision: "version-2", digest };
  return {
    schema_version: 2, artifact_type: "proposal-routed-prototype-capture",
    record_ref: "record://prototype-captures/proposal-51", prototype_id: "prototype:proposal-51",
    lifecycle: "exploring", landing_state: "captured",
    application_ref: { id: "proposal-prototype-application:proposal-51:1", digest },
    proposal: { proposal_id: "idea-51", record_ref: source.ref, record_version: source.revision,
      handoff_packet_ref: "proposal-handoff:idea-51:version-2", handoff_packet_digest: digest,
      route: { target: "prototype", source_custody: { classification: "existing-repo", repository_mode: "existing", repository_gate_state: "resolved" } } },
    entry_packet: bindProposalTarget({ schema_version: 1, artifact_type: "prototype-entry-packet",
      entry_id: "prototype-entry:proposal-routed:proposal-51", captured_at: at, ingress_class: "proposal-routed",
      source, suggestions: { name: "Proposal 51 Prototype", objective: null, support_profile: null },
      constraints: [{ code: "proposal-route", detail: "target=prototype" }, { code: "source-custody", detail: "classification=existing-repo;repository_mode=existing;repository_gate_state=resolved" }], requested_by: "operator-orchestration-service" }, "packet_digest"),
    captured_at: at, next_action: "prototype-landing",
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "oos-prototype-records-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Synthetic Test");
  await git(root, "config", "user.email", "test@example.invalid");
  await mkdir(path.join(root, "schemas"));
  await mkdir(path.join(root, "records/prototype-captures/proposal-51"), { recursive: true });
  // Minimal synthetic owner schema; production reads the exact Studio schema.
  const schema = { type: "object", required: ["schema_version", "studio", "prototypes"], properties: { schema_version: { const: 1 }, studio: { type: "object" }, prototypes: { type: "array", items: { type: "object", required: ["id"] } } } };
  await writeFile(path.join(root, "schemas/prototype-registry.schema.json"), JSON.stringify(schema));
  await writeFile(path.join(root, "prototypes.yaml"), "schema_version: 1\nstudio: {}\nprototypes: []\n");
  const captured = capture();
  assertProposalTargetArtifact(captured);
  await writeFile(path.join(root, "records/prototype-captures/proposal-51/record.json"), JSON.stringify(captured));
  await git(root, "add", "."); await git(root, "commit", "-m", "Synthetic owner snapshot");
  const minimumRevision = await git(root, "rev-parse", "HEAD");
  await git(root, "update-ref", "refs/remotes/origin/main", minimumRevision);
  let revision = minimumRevision;
  const client = createPrototypeLandingSourceClient({ authorityRoot: root, minimumRevision, provider: { mainRevision: async () => revision } });
  return { root, client, minimumRevision, async commit() {
    await git(root, "add", "."); await git(root, "commit", "-m", "Synthetic record advancement");
    revision = await git(root, "rev-parse", "HEAD"); return revision;
  } };
}

test("canonical Prototype collection survives cold reconstruction and reads one immutable Git revision without mutation", async (t) => {
  const { root, client, minimumRevision } = await fixture(t);
  const before = await git(root, "status", "--porcelain");
  const first = await client.records();
  assert.equal(first.authority_revision, minimumRevision);
  assert.equal(first.authority_sequence, 1);
  assert.equal(first.captures[0].prototype_id, "prototype:proposal-51");
  assert.equal(first.registry.prototypes.length, 0);
  assert.equal(first.canonical_mutation, false);
  const cold = createPrototypeLandingSourceClient({ authorityRoot: root, minimumRevision, provider: { mainRevision: async () => minimumRevision } });
  assert.deepEqual(await cold.records(), first);
  assert.equal(await git(root, "status", "--porcelain"), before);
});

test("real Git missing/stale authority fails closed, then deployment ref advancement exposes the merged record", async (t) => {
  const { root, client, commit } = await fixture(t);
  await writeFile(path.join(root, "prototypes.yaml"), "schema_version: 1\nstudio: {}\nprototypes:\n  - id: sample-prototype\n");
  const revision = await commit();
  await assert.rejects(client.records(), { code: "prototype_landing_records_unavailable", statusCode: 503 });
  await git(root, "update-ref", "refs/remotes/origin/main", revision);
  assert.equal((await client.records()).registry.prototypes[0].id, "sample-prototype");
  assert.equal((await client.records()).authority_sequence, 2);
  await git(root, "update-ref", "-d", "refs/remotes/origin/main");
  await assert.rejects(client.records(), /canonical Prototype records are unavailable/);
});

test("invalid canonical captures, duplicate identities and non-object documents never become partial success", async (t) => {
  const { root, client, commit } = await fixture(t);
  const recordPath = path.join(root, "records/prototype-captures/proposal-51/record.json");
  const original = await readFile(recordPath, "utf8");
  await writeFile(recordPath, original.replace('"prototype:proposal-51"', '"prototype:proposal-52"'));
  await git(root, "update-ref", "refs/remotes/origin/main", await commit());
  await assert.rejects(client.records(), /canonical Prototype records are unavailable/);
  await writeFile(recordPath, original);
  await writeFile(path.join(root, "prototypes.yaml"), "schema_version: 1\nstudio: {}\nprototypes:\n  - id: same\n  - id: same\n");
  await git(root, "update-ref", "refs/remotes/origin/main", await commit());
  await assert.rejects(client.records(), /canonical Prototype records are unavailable/);
  await writeFile(path.join(root, "prototypes.yaml"), "schema_version: 1\nstudio: {}\nprototypes: []\n");
  await writeFile(recordPath, "null");
  await git(root, "update-ref", "refs/remotes/origin/main", await commit());
  await assert.rejects(client.records(), /canonical Prototype records are unavailable/);
});
