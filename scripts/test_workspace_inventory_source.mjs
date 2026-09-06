import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInventory,
  bindInventory,
  createInventoryEvaluation,
  inventoryDigest,
  inventoryManifest,
} from "../src/workspace-inventory/contracts.js";
import { createWorkspaceInventorySourceClient } from "../src/workspace-inventory/source-client.js";
import { createWorkspaceInventoryService } from "../src/workspace-inventory/service.js";
import { createWorkspaceInventoryStore } from "../src/workspace-inventory/store.js";
import {
  at,
  caller,
  readinessFixture,
} from "../test-fixtures/workspace-inventory/fixture.js";

async function runCrashWorker(storeRoot, contextPath, providerPath) {
  const context = JSON.parse(await readFile(contextPath, "utf8"));
  const service = createWorkspaceInventoryService({
    store: createWorkspaceInventoryStore({ root: storeRoot }),
    readinessClient: { evaluate: async (evaluation) => readinessFixture(evaluation) },
    sourceClient: {
      async prepare() { return structuredClone(context.preparation); },
      async openReview() {
        await writeFile(providerPath, JSON.stringify({ creations: 1, review: context.open_review }));
        process.exit(91);
      },
    },
    clock: () => new Date(at),
  });
  await service.submit({ callerId: caller, input: context.input });
  await service.advance({ callerId: caller, requestId: context.input.request.request_id });
}

const crashWorkerIndex = process.argv.indexOf("--crash-worker");
if (crashWorkerIndex >= 0) {
  await runCrashWorker(
    path.resolve(process.argv[crashWorkerIndex + 1]),
    path.resolve(process.argv[crashWorkerIndex + 2]),
    path.resolve(process.argv[crashWorkerIndex + 3]),
  );
  process.exit(0);
}

const index = process.argv.indexOf("--authority-root");
if (index < 0) throw new Error("Provide --authority-root for the committed Workspace Governance test source.");
const authority = path.resolve(process.argv[index + 1]);
const root = await mkdtemp(path.join(tmpdir(), "inventory-conformance-"));
const repo = path.join(root, "workspace-governance");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let checks = 0;
function pass(name) {
  checks += 1;
  console.log(`PASS ${name}`);
}

try {
  execFileSync("git", ["clone", "--shared", authority, repo], { stdio: "pipe" });
  const contractBase = inventoryManifest.files["workspace-active-inventory.yaml"].commit;

  const migrationRepo = path.join(root, "migration-proof");
  execFileSync("git", ["clone", "--shared", authority, migrationRepo], { stdio: "pipe" });
  execFileSync("git", ["-C", migrationRepo, "checkout", "-B", "inventory-migration-proof", contractBase], { stdio: "pipe" });
  const legacyRevision = "6fd843eb43405f6bdcc439d23b18e556eca05b26";
  for (const name of ["repos", "products", "components"]) {
    const legacy = execFileSync("git", ["-C", migrationRepo, "show", `${legacyRevision}:contracts/${name}.yaml`]);
    await writeFile(path.join(migrationRepo, "contracts", `${name}.yaml`), legacy);
  }
  const migrationReport = path.join(root, "migration-report.json");
  execFileSync("python3", [
    path.join(migrationRepo, "scripts/workspace_inventory.py"),
    "migrate",
    "--source-ref",
    `git://workspace-governance/${legacyRevision}`,
    "--recorded-at",
    "2026-08-30T18:27:30+08:00",
    "--output",
    migrationReport,
  ], { stdio: "pipe" });
  const migration = JSON.parse(await readFile(migrationReport, "utf8"));
  assert.deepEqual(
    Object.fromEntries(Object.entries(migration.inventories).map(([kind, value]) => [kind, value.status])),
    { repo: "migrated", product: "migrated", component: "migrated" },
  );
  execFileSync("python3", ["-c", `
import pathlib, subprocess, sys, yaml
root = pathlib.Path(sys.argv[1])
legacy = sys.argv[2]
for kind, collection in (("repo", "repos"), ("product", "products"), ("component", "components")):
    before = yaml.safe_load(subprocess.check_output(["git", "-C", str(root), "show", f"{legacy}:contracts/{collection}.yaml"], text=True))
    after = yaml.safe_load((root / "contracts" / f"{collection}.yaml").read_text())
    groups = [collection] + (["retired_repos"] if kind == "repo" else [])
    for group in groups:
        for name, original in before.get(group, {}).items():
            current = after[group][name]
            for field, value in original.items():
                assert current[field] == value, (kind, name, field)
            assert current["record"]["id"] == f"{kind}:{name}"
            assert current["record"]["lineage"]["source"] == "legacy-migration"
            if kind == "product":
                assert current["posture"] == "active"
                assert current["maturity"] == (original["lifecycle"] if original["lifecycle"] in {"platform-integrated", "fully-governed"} else "owner-managed")
            else:
                assert current["posture"] == original["lifecycle"]
`, migrationRepo, legacyRevision], { stdio: "pipe" });
  pass("v1 migration preserves identity, owner fields, lineage source, posture and product maturity");

  git("checkout", "-B", "main", contractBase);
  git("config", "user.name", "Inventory Conformance");
  git("config", "user.email", "inventory@example.invalid");
  const registerPath = path.join(repo, "contracts/intake-register.yaml");
  const admitted = (await readFile(registerPath, "utf8")).replace(
    "  temporal:\n    status: proposed",
    "  temporal:\n    status: admitted",
  );
  assert.notEqual(admitted, await readFile(registerPath, "utf8"));
  await writeFile(registerPath, admitted);
  execFileSync("python3", ["-c", `
import copy, pathlib, sys, yaml
path = pathlib.Path(sys.argv[1])
data = yaml.safe_load(path.read_text())
template = data["components"]["temporal"]
def record(kind, name):
    value = copy.deepcopy(template["record"])
    value["id"] = f"{kind}:{name}"
    value["source"]["ref"] = f"fixture://{kind}/{name}"
    value["decision"]["id"] = f"decision:{kind}:{name}"
    value["decision"]["ref"] = f"fixture://decision/{kind}/{name}"
    value["last_mutation"]["id"] = f"mutation:{kind}:{name}"
    value["last_mutation"]["idempotency_key"] = f"mutation:{kind}:{name}"
    value["last_mutation"]["request_ref"] = f"fixture://request/{kind}/{name}"
    value["last_mutation"]["decision_ref"] = value["decision"]["ref"]
    return value
validation = {
    "posture": "owner-reviewed",
    "wgcf_graph_role": "workspace-inventory-candidate",
    "catalog_refs": [],
    "notes": "Temporary conformance candidate.",
}
data["repos"]["inventory-proof-repo"] = {
    "status": "admitted",
    "decision_source": "operator",
    "owner_route": "workspace-governance",
    "record": record("repo", "inventory-proof-repo"),
    "repo_class": "product-source",
    "requires_security_bindings": True,
    "security_owner": "security-architecture",
    "validation_behavior": validation,
    "notes": "Temporary repository candidate.",
}
data["products"]["inventory-proof-product"] = {
    "status": "admitted",
    "decision_source": "operator",
    "owner_route": "inventory-proof-repo",
    "record": record("product", "inventory-proof-product"),
    "platform_owner": "platform-engineering",
    "security_owner": "security-architecture",
    "runtime_owner": "inventory-proof-repo",
    "source_owners": ["inventory-proof-repo"],
    "intended_endpoint": "future-stage",
    "validation_behavior": validation,
    "notes": "Temporary product candidate.",
}
path.write_text(yaml.safe_dump(data, sort_keys=False))
`, registerPath], { stdio: "pipe" });
  git("add", "contracts/intake-register.yaml");
  git("commit", "-m", "Prepare admitted inventory conformance fixture");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);

  const state = JSON.parse(execFileSync("python3", [
    path.join(repo, "scripts/workspace_inventory.py"),
    "state",
    "--kind",
    "component",
    "--name",
    "temporal",
  ], { encoding: "utf8" }));
  let request = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-request",
    request_id: "inventory-request:temporal-test",
    requested_at: "2026-09-06T11:00:00Z",
    operator_ref: caller,
    correlation_ref: "delivery:890",
    idempotency_key: "inventory-promotion:temporal-test",
    target: state.target,
    intake_entry_ref: {
      id: state.target.record_id,
      version: state.intake_entry_version,
      digest: state.intake_entry_digest,
    },
    expected_state: {
      intake_register_digest: state.intake_register_digest,
      active_inventory_digest: state.active_inventory_digest,
      intake_entry_version: state.intake_entry_version,
      intake_entry_digest: state.intake_entry_digest,
      active_record_version: null,
      active_record_digest: null,
    },
    active_record: { kind: "component", id: state.target.record_id, value: { pending: true } },
    approval_refs: ["approval:operator:inventory-test"],
  }, "request_digest");
  let input = {
    request,
    authority_revision: base,
    session_ref: "session:inventory-test",
    execution_ref: "execution:inventory-test",
  };
  let review = null;
  const provider = {
    async mainRevision() { return git("rev-parse", "main"); },
    async prepareReview(preparation) {
      if (review) return structuredClone(review);
      git("checkout", "-b", preparation.branch, base);
      await writeFile(path.join(repo, "contracts/intake-register.yaml"), preparation.intake_text);
      await writeFile(path.join(repo, preparation.inventory_path), preparation.inventory_text);
      git("add", "contracts/intake-register.yaml", preparation.inventory_path);
      git("commit", "-m", "Reviewed inventory promotion test change");
      review = {
        repository: "workspace-governance",
        number: 1,
        url: "https://example.invalid/pull/1",
        state: "open",
        branch: preparation.branch,
        base_branch: "main",
        base_commit: base,
        head_commit: git("rev-parse", "HEAD"),
        merged: false,
        merge_commit: null,
        human_reviewed: false,
      };
      return structuredClone(review);
    },
    async review() { return structuredClone(review); },
    async findReview() { return structuredClone(review); },
    async verifyPreparedReview(preparation, value) {
      assert.equal(git("show", `${value.head_commit}:contracts/intake-register.yaml`), preparation.intake_text.trim());
      assert.equal(git("show", `${value.head_commit}:${preparation.inventory_path}`), preparation.inventory_text.trim());
    },
    async closeReview() { review.state = "closed"; },
    async readMergedFiles(value, inventoryPath) {
      git("merge-base", "--is-ancestor", value.merge_commit, "main");
      return {
        intakeText: execFileSync("git", ["-C", repo, "show", `${value.merge_commit}:contracts/intake-register.yaml`], { encoding: "utf8" }),
        inventoryText: execFileSync("git", ["-C", repo, "show", `${value.merge_commit}:${inventoryPath}`], { encoding: "utf8" }),
      };
    },
  };
  const sourceClient = createWorkspaceInventorySourceClient({ authorityRoot: repo, provider, clock: () => new Date(at) });
  const registryBefore = await sourceClient.registry();
  assert.deepEqual(
    registryBefore.eligible_promotions.map((entry) => entry.target.kind).sort(),
    ["component", "product", "repo"],
  );
  const candidate = registryBefore.eligible_promotions.find((entry) => entry.target.record_id === "component:temporal");
  assert.ok(candidate);
  assert.equal(candidate.candidate_digest, inventoryDigest(candidate, "candidate_digest"));
  request = bindInventory({
    ...request,
    active_record: candidate.active_record,
    approval_refs: candidate.approval_refs,
  }, "request_digest");
  input = { ...input, request };
  assert.equal(git("status", "--short"), "");
  pass("registry derives typed digest-bound repository, product and component candidates from committed admitted intake");

  const observed = await sourceClient.state({ kind: "component", name: "temporal" });
  assert.equal(observed.authority_revision, base);
  assert.equal(observed.intake_entry_version, 1);
  assert.equal(observed.active_record_version, null);
  assert.equal(git("status", "--short"), "");
  pass("preparation reads committed admitted source without mutation");

  const storeRoot = path.join(root, "state");
  const make = () => createWorkspaceInventoryService({
    store: createWorkspaceInventoryStore({ root: storeRoot }),
    sourceClient,
    readinessClient: {
      evaluate: async (evaluation) => readinessFixture(evaluation),
    },
    clock: () => new Date(at),
  });
  const projectedBefore = await make().registry({ callerId: caller });
  assert.equal(projectedBefore.authority_revision, base);
  assert.equal(projectedBefore.eligible_promotions[0].candidate_digest, candidate.candidate_digest);
  assert.equal(projectedBefore.canonical_mutation, false);
  pass("service projection is caller-auditable, deterministic and non-mutating");

  await make().submit({ callerId: caller, input });
  const prepared = await make().advance({ callerId: caller, requestId: request.request_id });
  assert.equal(prepared.status, "review-required");
  assert.equal(prepared.canonical_mutation, false);
  assert.equal(git("rev-parse", "main"), base);
  const stored = await createWorkspaceInventoryStore({ root: storeRoot }).get(request.request_id);
  assertInventory("mutation", stored.preparation.mutation);
  assertInventory("readback", stored.preparation.readback);
  assertInventory("receipt", stored.preparation.receipt);
  pass("owner command prepares exactly two review-branch files without canonical success");

  const expectedHead = review.head_commit;
  review.head_commit = "a".repeat(40);
  await assert.rejects(make().advance({ callerId: caller, requestId: request.request_id }), /source no longer matches/);
  review.head_commit = expectedHead;
  const recovered = await make().advance({ callerId: caller, requestId: request.request_id });
  assert.equal(recovered.status, "review-required");
  assert.equal(recovered.failure, null);
  pass("changed review head is denied and retry recovers after restart");

  git("checkout", "main");
  git("merge", "--no-ff", review.head_commit, "-m", "Human-reviewed inventory test merge");
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "main"));
  review = {
    ...review,
    merged: true,
    state: "closed",
    merge_commit: git("rev-parse", "main"),
  };
  await assert.rejects(make().advance({ callerId: caller, requestId: request.request_id }), /human review/);
  review.human_reviewed = true;
  const result = await make().advance({ callerId: caller, requestId: request.request_id });
  assert.equal(result.status, "succeeded");
  assert.equal(result.readback.intake_entry_present, false);
  assert.equal(result.readback.active_record.record.id, "component:temporal");
  assert.equal(result.receipt.phase, "merged-authority");
  assert.deepEqual(await make().advance({ callerId: caller, requestId: request.request_id }), result);
  pass("human-reviewed merge yields atomic canonical readback and replay-stable receipt");

  const projectedAfter = await make().registry({ callerId: caller });
  assert.equal(projectedAfter.eligible_promotions.some((entry) => entry.target.record_id === "component:temporal"), false);
  const activeTemporal = projectedAfter.records.find((entry) => entry.id === "component:temporal");
  assert.equal(activeTemporal.lineage.source, "workspace-intake");
  assert.equal(activeTemporal.lineage.intake_entry_version, candidate.intake_entry_ref.version);
  assert.equal(activeTemporal.last_mutation.action, "promote");
  pass("merged promotion atomically replaces intake eligibility with active registry truth");

  const crashStoreRoot = path.join(root, "crash-state");
  const crashContextPath = path.join(root, "crash-context.json");
  const crashProviderPath = path.join(root, "crash-provider.json");
  const openReview = {
    ...result.review,
    state: "open",
    merged: false,
    merge_commit: null,
    human_reviewed: false,
  };
  await writeFile(crashContextPath, JSON.stringify({
    input,
    preparation: stored.preparation,
    open_review: openReview,
    final_readback: result.readback,
  }));
  let crash;
  try {
    execFileSync(process.execPath, [
      fileURLToPath(import.meta.url),
      "--crash-worker",
      crashStoreRoot,
      crashContextPath,
      crashProviderPath,
    ], { stdio: "pipe" });
  } catch (error) {
    crash = error;
  }
  assert.equal(crash?.status, 91);
  const afterCrash = await createWorkspaceInventoryStore({ root: crashStoreRoot }).get(request.request_id);
  assert.equal(afterCrash.status, "preparing");
  assert.ok(afterCrash.preparation);
  assert.equal(JSON.parse(await readFile(crashProviderPath, "utf8")).creations, 1);

  const crashSource = {
    async prepare() { throw new Error("durable preparation must be reused"); },
    async openReview() {
      return JSON.parse(await readFile(crashProviderPath, "utf8")).review;
    },
    async observe() {
      const current = JSON.parse(await readFile(crashProviderPath, "utf8"));
      return current.review.merged
        ? { review: current.review, readback: result.readback }
        : { review: current.review };
    },
  };
  const resume = () => createWorkspaceInventoryService({
    store: createWorkspaceInventoryStore({ root: crashStoreRoot }),
    sourceClient: crashSource,
    readinessClient: { evaluate: async () => { throw new Error("durable readiness must be reused"); } },
    clock: () => new Date(at),
  });
  assert.equal((await resume().advance({ callerId: caller, requestId: request.request_id })).status, "review-required");
  const providerState = JSON.parse(await readFile(crashProviderPath, "utf8"));
  providerState.review = structuredClone(result.review);
  await writeFile(crashProviderPath, JSON.stringify(providerState));
  const crashResult = await resume().advance({ callerId: caller, requestId: request.request_id });
  assert.equal(crashResult.status, "succeeded");
  assert.equal(crashResult.receipt.receipt_digest, result.receipt.receipt_digest);
  assert.equal(JSON.parse(await readFile(crashProviderPath, "utf8")).creations, 1);
  pass("process death after review creation resumes without duplicate review or canonical outcome");

  console.log(`Workspace Inventory real-Git conformance: ${checks} checks passed.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
