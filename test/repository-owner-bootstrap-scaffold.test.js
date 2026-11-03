import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { validateDeliveryArtEvidenceProfileCoverage } from "../src/delivery-art/review-evidence-acquisition.js";
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

test("ordinary source scaffold reaches native baseline coverage without requiring an architecture case", async t => {
  const request = input();
  request.profile.commands[0].conformance_binding = "none";
  const plan = planSourceOwnerBootstrap(request);
  const files = Object.fromEntries(plan.files.map(file => [file.path, file.content]));
  const profile = JSON.parse(files["contracts/delivery-art-work-session/evidence-profile.json"]);
  const coverage = value => validateDeliveryArtEvidenceProfileCoverage({ ownerRepo: request.authority.owner_repo,
    profile: value, conformanceCases: [], requiredEvidenceKinds: ["tests", "validations"] });
  assert.doesNotThrow(() => coverage(profile));
  assert.throws(() => coverage(input().profile), { code: "delivery_art_evidence_profile_incomplete" },
    "Case-bound checks must still be inapplicable without accepted cases");
  assert.doesNotThrow(() => validateDeliveryArtEvidenceProfileCoverage({ ownerRepo: request.authority.owner_repo,
    profile: input().profile, conformanceCases: [{ id: "synthetic-scaffold-unit-case", fidelity: "pure-unit" }],
    requiredEvidenceKinds: ["tests", "validations"] }), "Existing conditional profiles retain their exact case/fidelity semantics");
  assert.deepEqual(inspectExistingSourceOwnerControls({ ownerRepo: request.authority.owner_repo,
    fetchedBase: request.fetchedBase, observedFiles: files }).evidence_profile, profile);
  const directory = await mkdtemp(path.join(tmpdir(), "ordinary-owner-scaffold-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  }
  const controls = execFileSync("make", ["validate"], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  assert.match(controls, /not app acceptance/);
  assert.match(execFileSync("python3", ["scripts/validate_owner.py", "--application-if-present"], { cwd: directory,
    encoding: "utf8", timeout: 30000 }), /no application tests executed/);
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
  assert.equal(ready.source_change_required, true, "A valid profile alone does not cover missing mandatory review controls");
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
    value => { value.authority.classification = "out-of-scope"; },
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
    value => { value.observedFiles["AGENTS.md"] = "## Review guidelines\nIncomplete independent policy\n"; },
  ]) {
    const candidate = structuredClone(good);
    mutate(candidate);
    assert.throws(() => planSourceOwnerBootstrap(candidate));
  }
});

test("admitted pre-Inventory repair preserves every existing byte except an exact append-only review section", () => {
  const request = input(true), initial = planSourceOwnerBootstrap(request);
  request.authority.classification = "admitted";
  request.authority.intake_entry_ref.version = 2;
  request.observedFiles = Object.fromEntries(initial.files.map(file => [file.path, file.content]));
  request.observedFiles["AGENTS.md"] = "# Independent owner guidance\nKeep this exact text.\n";
  request.observedFiles["Makefile"] = "validate:\n\t@false # Independent validation must not be overwritten or executed on host\n";
  request.observedFiles[".github/CODEOWNERS"] = null;
  request.observedFiles[".github/pull_request_template.md"] = null;
  const before = structuredClone(request), repair = planSourceOwnerBootstrap(request);
  assert.deepEqual(request, before);
  assert.deepEqual(repair.files.filter(file => file.action !== "unchanged").map(file => [file.path, file.action]), [
    [".github/CODEOWNERS", "create"], [".github/pull_request_template.md", "create"], ["AGENTS.md", "replace"],
  ]);
  assert.ok(repair.files.find(file => file.path === "AGENTS.md").content.startsWith(request.observedFiles["AGENTS.md"]));
  assert.match(repair.files.find(file => file.path === "AGENTS.md").expected_digest, /^sha256:[0-9a-f]{64}$/);
  for (const file of repair.files.filter(file => file.action === "unchanged")) assert.equal(file.content, request.observedFiles[file.path]);
  assert.equal(repair.requires_workflow_permission, false);
  assert.equal(repair.app_import, false);
  const observedFiles = Object.fromEntries(repair.files.map(file => [file.path, file.content]));
  assert.equal(inspectExistingSourceOwnerControls({ ownerRepo: request.authority.owner_repo, fetchedBase: request.fetchedBase, observedFiles }).source_change_required, false);
  assert.equal(planSourceOwnerBootstrap({ ...request, observedFiles }).source_change_required, false);
  for (const path of [".github/CODEOWNERS", ".github/pull_request_template.md"]) {
    const conflicting = structuredClone(request); conflicting.observedFiles[path] = "Independent incomplete policy";
    assert.throws(() => planSourceOwnerBootstrap(conflicting), /explicit owner review/);
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

test('an empty application starts with source controls and no invented app plan or markers',async t=>{
 const request=input();request.profile=null;request.applicationMarkers=[];
 const plan=planSourceOwnerBootstrap(request);
 const profile=JSON.parse(plan.files.find(file=>file.path==='contracts/delivery-art-work-session/evidence-profile.json').content);
 assert.equal(profile.application_verification.mode,'unconfigured');
 assert.ok(profile.commands.every(command=>command.kind==='validations'&&command.scope==='source-controls'));
 assert.deepEqual(plan.application_markers,[]);assert.equal(plan.app_import,false);
 const directory=await mkdtemp(path.join(tmpdir(),'source-controls-only-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const file of plan.files){const target=path.join(directory,file.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content);}
 const output=execFileSync('python3',['scripts/validate_owner.py','--repo-root','.', '--application-if-present'],{cwd:directory,encoding:'utf8',timeout:30000});
 assert.match(output,/Application automation not configured/);assert.doesNotMatch(output,/Actual project test executed/);
});

test('an active owner configures manual verification through a finite source change without a new registration',async t=>{
 const {sourceControlEvidenceProfile}=await import('../src/delivery-art/application-verification.js');
 const {planSourceOwnerVerification}=await import('../src/repository-owner-bootstrap/scaffold.js');
 const {bootstrapSourceSession,bootstrapSourceChangeSet}=await import('../src/repository-owner-bootstrap/session.js');
 const request=input();const oldPlan=planSourceOwnerBootstrap(request);
 const observedFiles=Object.fromEntries(oldPlan.files.map(file=>[file.path,file.content]));
 observedFiles['scripts/validate_owner.py']=(await readFile(new URL('../templates/source-owner-bootstrap/validate_owner.legacy.py.template',import.meta.url),'utf8')).replaceAll('@@OWNER@@',request.authority.owner_repo);
 const authority={...request.authority,classification:'active',inventory_posture:'active',intake_entry_ref:null,
  inventory_entry_ref:{id:`repo:${request.authority.owner_repo}`,version:2,digest:`sha256:${'d'.repeat(64)}`},
  source_bootstrap_eligible:false,verification_setup_eligible:true,ordinary_source_eligible:true};
 const profile=sourceControlEvidenceProfile(authority.owner_repo);
 profile.commands.push(structuredClone(request.profile.commands.find(c=>c.kind==='validations')));
 profile.application_verification={mode:'manual',manual_checks:[{id:'add-task',action:'Add a task in the preview',expected_result:'The task appears in the list'}]};
 const plan=planSourceOwnerVerification({authority,fetchedBase:request.fetchedBase,profile,applicationMarkers:[],withCi:false,observedFiles});
 assert.equal(plan.operation,'configure-verification');assert.equal(plan.intake_entry_ref,null);assert.deepEqual(plan.inventory_entry_ref,authority.inventory_entry_ref);
 const changed=plan.files.filter(file=>file.action!=='unchanged');
 assert.ok(changed.every(file=>['contracts/delivery-art-work-session/evidence-profile.json','contracts/delivery-art-work-session/evidence-profile.schema.json','contracts/delivery-art-work-session/source-bootstrap.json','scripts/validate_owner.py'].includes(file.path)));
 assert.equal(plan.files.find(file=>file.path==='AGENTS.md').action,'unchanged');assert.equal(plan.requires_workflow_permission,false);
 assert.equal(plan.files.find(file=>file.path==='scripts/validate_owner.py').action,'replace');
 const body={schema_version:1,workflow_id:'repository-owner-bootstrap-preparation',operation:'configure-verification',caller_id:'console',operator_id:'operator',
  authorization:'preparation-only',decision_ref:'operator:configure-tests',custody_receipt_digest:`sha256:${'e'.repeat(64)}`,plan};
 const preparation={...body,preparation_digest:canonicalDigest(body)};
 const session=bootstrapSourceSession({requestDigest:`sha256:${'f'.repeat(64)}`,requestId:'verification:active-fixture',callerId:'console',operatorId:'operator',preparation});
 assert.equal(session.subject.intake_entry_ref,null);assert.deepEqual(session.subject.inventory_entry_ref,authority.inventory_entry_ref);
 assert.equal(bootstrapSourceChangeSet(plan,session).operations.length,changed.length);
 const directory=await mkdtemp(path.join(tmpdir(),'active-manual-verification-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const file of plan.files){const target=path.join(directory,file.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content);}
 assert.match(execFileSync('python3',['scripts/validate_owner.py','--repo-root','.', '--application-if-present'],{cwd:directory,encoding:'utf8',timeout:30000}),/no application acceptance/);
 const unsafe=structuredClone(profile);unsafe.commands=unsafe.commands.filter(c=>c.id!=='project-validation');
 assert.throws(()=>planSourceOwnerVerification({authority,fetchedBase:request.fetchedBase,profile:unsafe,applicationMarkers:[],withCi:false,observedFiles}),/Preserve existing owner commands/);
 assert.throws(()=>planSourceOwnerVerification({authority:request.authority,fetchedBase:request.fetchedBase,profile,applicationMarkers:[],withCi:false,observedFiles}),/active source-only/);
});

test("verification setup cannot drop independent runtime or security evidence commands", async () => {
  const {planSourceOwnerVerification}=await import('../src/repository-owner-bootstrap/scaffold.js');
  const initial=input();
  initial.profile.commands.push({id:'runtime-evidence',kind:'runtime_and_live',name:'Existing operating check',executable:'node',args:['tests/browser.mjs'],fidelity:'sandbox-runtime',conformance_binding:'none',timeout_seconds:120});
  const seed=planSourceOwnerBootstrap(initial), observedFiles=Object.fromEntries(seed.files.map(file=>[file.path,file.content]));
  const authority={...initial.authority,classification:'active',inventory_posture:'active',inventory_entry_ref:initial.authority.intake_entry_ref,intake_entry_ref:null,source_bootstrap_eligible:false,verification_setup_eligible:true,ordinary_source_eligible:true};
  const {sourceControlEvidenceProfile}=await import('../src/delivery-art/application-verification.js');
  const profile=sourceControlEvidenceProfile(authority.owner_repo);
  profile.application_verification={mode:'manual',manual_checks:[{id:'actual-check',action:'Use the app',expected_result:'The accepted behavior works'}]};
  profile.commands.push(...initial.profile.commands.filter(command=>command.kind!=='tests'));
  assert.doesNotThrow(()=>planSourceOwnerVerification({...initial,authority,profile,applicationMarkers:[],observedFiles}));
  profile.commands=profile.commands.filter(command=>command.id!=='runtime-evidence');
  assert.throws(()=>planSourceOwnerVerification({...initial,authority,profile,applicationMarkers:[],observedFiles}),/Preserve existing owner commands/);
});
