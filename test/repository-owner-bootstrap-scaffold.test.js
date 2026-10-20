import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { inspectExistingSourceOwnerControls, planSourceOwnerBootstrap, sourceOwnerBootstrapPaths, SOURCE_OWNER_BOOTSTRAP_TEMPLATE } from "../src/repository-owner-bootstrap/scaffold.js";

function input(withCi = false) {
  const owner = "source-scaffold-fixture";
  return { authority: { schema_version: 1, owner_repo: owner, classification: "proposed", inventory_posture: null,
      intake_entry_ref: { id: `repo:${owner}`, version: 1, digest: `sha256:${"a".repeat(64)}` },
      intake_register_digest: `sha256:${"b".repeat(64)}`, owner_purpose: "Public synthetic source-only test purpose.",
      provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: `example-organization/${owner}` },
      source_bootstrap_eligible: true, ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false },
    fetchedBase: "1".repeat(40), profile: { schema_version: 1, profile_id: "fixture-project-evidence-v1", owner_repo: owner,
      commands: [{ id: "project-tests", kind: "tests", name: "Selected project tests; not bootstrap evidence", executable: "node", args: ["app/test.mjs"], fidelity: "pure-unit", conformance_binding: "matching-fidelity", timeout_seconds: 30 },
                 { id: "project-validation", kind: "validations", name: "Selected source diff validation", executable: "git", args: ["diff", "--check", "{{base_commit}}...{{head_commit}}"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 }] },
    applicationMarkers: ["app/package.json"], withCi,
    observedFiles: Object.fromEntries(sourceOwnerBootstrapPaths(withCi).map(name => [name, name === "README.md" ? "# Existing repository purpose\n\nPreserve this actual documentation.\n" : null])) };
}

test("trusted scaffold is deterministic and finite, preserves README, and does not require universal CI or app code", () => {
  const request = input();
  const before = structuredClone(request);
  const plan = planSourceOwnerBootstrap(request);
  assert.deepEqual(request, before);
  assert.deepEqual(plan, planSourceOwnerBootstrap(request));
  assert.equal(plan.template.digest, SOURCE_OWNER_BOOTSTRAP_TEMPLATE.digest);
  const { plan_digest, ...body } = plan;
  assert.equal(canonicalDigest(body), plan_digest);
  assert.equal(plan.model_invoked, false);
  assert.equal(plan.app_import, false);
  assert.equal(plan.runtime_activation, false);
  assert.equal(plan.requires_workflow_permission, false);
  assert.deepEqual(plan.files.map(file => file.path).sort(), sourceOwnerBootstrapPaths(false));
  assert.equal(plan.files.find(file => file.path === "README.md").content, request.observedFiles["README.md"]);
  assert.equal(plan.files.find(file => file.path === "README.md").action, "unchanged");
  assert.ok(plan.files.every(file => !file.path.startsWith("app/") && file.mode === "100644"));
  const unrelated = structuredClone(request);
  unrelated.authority.intake_register_digest = `sha256:${"c".repeat(64)}`;
  assert.deepEqual(planSourceOwnerBootstrap(unrelated), plan, "Unrelated canonical metadata must not invalidate selected owner identity");
});

test("CI is an explicit finite optional file and existing identical controls need no new write purpose", () => {
  const request = input(true);
  const plan = planSourceOwnerBootstrap(request);
  assert.equal(plan.requires_workflow_permission, true);
  assert.ok(plan.files.find(file => file.path === ".github/workflows/validate.yaml").content.includes("contents: read"));
  request.observedFiles = Object.fromEntries(plan.files.map(file => [file.path, file.content]));
  const unchanged = planSourceOwnerBootstrap(request);
  assert.equal(unchanged.source_change_required, false);
  assert.equal(unchanged.requires_workflow_permission, false);
});

test("optional CI selects PRs and existing main pushes, not first review-branch or tag pushes with no previous commit", () => {
  const plan = planSourceOwnerBootstrap(input(true));
  const workflow = parseYaml(plan.files.find(file => file.path === ".github/workflows/validate.yaml").content);
  assert.deepEqual(workflow.on, { pull_request: null, push: { branches: ["main"] } });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const checkout = workflow.jobs.validate.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.ref, "${{ github.event.pull_request.head.sha || github.sha }}");
  const runner = workflow.jobs.validate.steps.find(step => step.run?.startsWith("python3 scripts/validate_owner.py --application-if-present"));
  assert.deepEqual(runner.env, {
    OWNER_EVIDENCE_BASE: "${{ github.event.pull_request.base.sha || github.event.before }}",
    OWNER_EVIDENCE_HEAD: "${{ github.event.pull_request.head.sha || github.sha }}",
  });
  assert.equal(runner.if, undefined, "Selected app validation must not be silently skipped");
});

test("an independently valid existing owner profile and guidance require no template replacement, app proof or dummy PR", () => {
  const request = input();
  const observed = { ...request.observedFiles, "AGENTS.md": "Independent owner guidance; preserve this.\n",
    "contracts/delivery-art-work-session/evidence-profile.json": JSON.stringify(request.profile) };
  const before = structuredClone(observed);
  const ready = inspectExistingSourceOwnerControls({ ownerRepo: request.authority.owner_repo, fetchedBase: request.fetchedBase, observedFiles: observed });
  assert.deepEqual(observed, before);
  assert.equal(ready.source_change_required, false);
  assert.equal(ready.app_acceptance, false);
  assert.equal(ready.inventory_admission, false);
  assert.deepEqual(ready.evidence_profile, request.profile);
  assert.equal(inspectExistingSourceOwnerControls({ ownerRepo: request.authority.owner_repo, fetchedBase: request.fetchedBase, observedFiles: request.observedFiles }), null);
  observed["contracts/delivery-art-work-session/evidence-profile.json"] = "{}";
  assert.throws(() => inspectExistingSourceOwnerControls({ ownerRepo: request.authority.owner_repo, fetchedBase: request.fetchedBase, observedFiles: observed }), /do not overwrite/);
});

test("bootstrap refuses foreign profiles, nonproposed subjects, unsafe markers, unknown source and control overwrites", () => {
  const good = input();
  for (const mutate of [
    value => { value.authority.classification = "admitted"; },
    value => { value.authority.ordinary_source_eligible = true; },
    value => { value.authority.model_writes_allowed = true; },
    value => { value.authority.provider_repository.provider_repository_id = "9007199254740993"; },
    value => { value.authority.provider_repository.full_name = "../private"; },
    value => { value.profile.owner_repo = "another-owner"; },
    value => { value.profile.commands[0].executable = "sh"; },
    value => { value.applicationMarkers = ["../private"]; },
    value => { value.applicationMarkers = [".git/config"]; },
    value => { value.applicationMarkers = ["scripts/validate_owner.py"]; },
    value => { value.applicationMarkers = ["app/main.js", "app/main.js"]; },
    value => { delete value.observedFiles["Makefile"]; },
    value => { value.observedFiles["app/main.js"] = "arbitrary app source"; },
    value => { value.observedFiles["AGENTS.md"] = "Independent owner controls must not be overwritten"; },
  ]) {
    const candidate = structuredClone(good);
    mutate(candidate);
    assert.throws(() => planSourceOwnerBootstrap(candidate));
  }
});

test("generated native owner controls validate without executing absent project tests or claiming app acceptance", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "owner-scaffold-native-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = planSourceOwnerBootstrap(input(true));
  for (const file of plan.files) {
    const target = path.join(directory, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const output = execFileSync("make", ["validate"], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  assert.match(output, /not app acceptance/);
  const application = execFileSync("python3", ["scripts/validate_owner.py", "--application-if-present"], { cwd: directory, encoding: "utf8", timeout: 30000 });
  assert.match(application, /no application tests executed/);
  assert.ok(!(await readdir(directory)).includes("app"));
  const profile = JSON.parse(await readFile(path.join(directory, "contracts/delivery-art-work-session/evidence-profile.json"), "utf8"));
  assert.deepEqual(profile, input().profile);
});

test("bootstrap validation stays distinct from real app evidence and the optional app runner substitutes exact Git commits", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "owner-scaffold-application-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = planSourceOwnerBootstrap(input(true));
  for (const file of plan.files) {
    const target = path.join(directory, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const git = (...args) => execFileSync("git", ["-c", "user.name=Owner Fixture", "-c", "user.email=fixture@example.invalid", ...args],
    { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
  git("init", "--initial-branch=main"); git("add", "."); git("commit", "-m", "fixture: trusted controls only");
  const base = git("rev-parse", "HEAD");
  const workflow = parseYaml(plan.files.find(file => file.path === ".github/workflows/validate.yaml").content);
  const runner = workflow.jobs.validate.steps.find(step => step.run?.startsWith("python3 scripts/validate_owner.py --application-if-present"));
  const workflowRun = (before, after) => execFileSync("bash", ["-eu", "-c", runner.run], { cwd: directory,
    env: { ...process.env, OWNER_EVIDENCE_BASE: before, OWNER_EVIDENCE_HEAD: after },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  assert.match(workflowRun("0".repeat(40), base), /no application tests executed/,
    "Initial main with controls alone must not pretend app evidence exists");
  await mkdir(path.join(directory, "app"));
  await writeFile(path.join(directory, "app/package.json"), '{"private":true}\n');
  await writeFile(path.join(directory, "app/test.mjs"), 'console.log("Actual project test executed");\n');
  git("add", "app"); git("commit", "-m", "fixture: actual project source");
  const head = git("rev-parse", "HEAD");
  const run = args => execFileSync("python3", ["scripts/validate_owner.py", "--application-if-present", ...args],
    { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  assert.throws(() => run([]), /Command failed/, "An app cannot silently receive a guessed diff base");
  assert.match(run(["--base-commit", base, "--head-commit", head]), /Actual project test executed/);
  assert.match(workflowRun(base, head), /Actual project test executed/,
    "The exact generated workflow must execute real app and Git checks for PR base/head and existing-main before/head");
  assert.throws(() => workflowRun("0".repeat(40), head), /Command failed/,
    "Do not substitute a guessed commit for an event without a prior ref; its trigger must be excluded");
  await writeFile(path.join(directory, "app/test.mjs"), 'throw new Error("Actual project test fails");\n');
  assert.match(execFileSync("make", ["validate"], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }), /not app acceptance/);
  assert.throws(() => run(["--base-commit", base, "--head-commit", head]), /Command failed/, "Real app failures cannot be replaced by green bootstrap checks");
});
