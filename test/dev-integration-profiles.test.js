import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createDevIntegrationProfileService } from "../src/platform-operation/dev-integration-service.js";
import { assertDevIntegrationProfileProjection, devIntegrationRequestIntent } from "../src/platform-operation/dev-integration-contracts.js";

const NOW = "2026-11-02T00:00:00.000Z";
function projection() {
  return { schema_version: 1, source_version: `registry:${"a".repeat(40)}`, observed_at: NOW,
    owner_versions: {}, profiles: [], request_options: { owner_repos: ["owner"], lane_classes: ["integration-devint"],
      runtime_platforms: ["local-k3s"], state_models: ["disposable", "persistent"] },
    page: { offset: 0, limit: 20, total: 0, next_offset: null } };
}
function input(id = "one") {
  const value = { request_id: `devint-request:${id}`, expected_source_version: `registry:${"a".repeat(40)}`,
    request: { profileId: "real-request", ownerRepo: "owner", purpose: "A bounded runtime for integration work.",
      laneClass: "integration-devint", participatingRepos: ["owner"], runtimePlatform: "local-k3s", runtimeStateModel: "disposable",
      dependencies: [], expectedWrites: { classification: "none", targets: [] }, securityTriggers: [], persistence: null,
      replacesProfileId: null }, approval: { decision: "approved", intent_digest: "" } };
  return approve(value);
}
function approve(value) { value.approval.intent_digest = canonicalDigest(devIntegrationRequestIntent(value)); return value; }
function harness(t) {
  const root = mkdtempSync(path.join(tmpdir(), "devint-request-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let owner = projection();
  const events = [], reads = [];
  let externalWrites = 0;
  const create = () => createDevIntegrationProfileService({ root, clock: () => new Date(NOW),
    operatorBindings: { console: "operator:reviewer", other: "operator:other" },
    audit: { emit: event => events.push(event) },
    providerClient: { getDevIntegrationProfiles: async query => {reads.push(query);return owner;} },
    // These foreign adapters deliberately fail if the profile workflow invokes them.
    ideaService: { captureIdea: async () => { externalWrites++;throw new Error("No Proposal is allowed"); } },
    openProjectClient: { captureIdea: async () => {externalWrites++;throw new Error("No OpenProject write is allowed");} },
  });
  return { create, events, reads, root, externalWrites: () => externalWrites, changeOwner: fn => { owner = fn(owner); } };
}

test("a reviewed native request records its own immutable receipt without a Proposal or runtime effect", async t => {
  const h = harness(t), service = h.create();
  const result = await service.submit({ callerId: "console", input: input() });
  assert.equal(result.state, "recorded");
  assert.equal(result.request_ref, "oos://dev-integration/requests/devint-request:one");
  assert.equal(result.operator_id, "operator:reviewer");
  assert.equal(result.receipt.outcome, "request-recorded");
  assert.equal(result.next_action.code, "review-profile-request");
  assert.equal(result.next_action.owner, "owner");
  assert.equal(result.admission.state, "not-checked");
  assert.equal("proposal_ref" in result, false);
  assert.equal(h.externalWrites(), 0);
  assert.equal((await service.listRequests({ callerId: "console" })).requests.length, 1);
  assert.equal((await service.listRequests({ callerId: "other" })).requests.length, 0);
});

test("lost acknowledgement and restart recover the same native request and receipt with one recording event", async t => {
  const h = harness(t);
  const original = await h.create().submit({ callerId: "console", input: input() });
  // The transport may lose this result after fsync; a cold process uses original identity.
  const cold = await h.create().get({ callerId: "console", requestId: original.request_id });
  assert.deepEqual(cold.receipt, original.receipt);
  assert.equal(cold.admission.state, "not-registered");
  h.changeOwner(owner => ({...owner, source_version:`registry:${"b".repeat(40)}`}));
  const replay = await h.create().submit({ callerId: "console", input: input() });
  assert.deepEqual(replay.receipt, original.receipt);
  assert.equal(h.events.length, 1);
  assert.equal(h.externalWrites(), 0);
  assert.equal((await h.create().listRequests({callerId:"console"})).page.total, 1);
});

for (const kind of ["stale", "owner", "actor", "approval", "injected-field", "incomplete-persistence", "conflicting-id"]) {
  test(`request denies ${kind} without recording new intent`, async t => {
    const h = harness(t), service = h.create();
    const value = input(); let callerId = "console";
    if (kind === "stale") value.expected_source_version = `registry:${"b".repeat(40)}`;
    if (kind === "owner") value.request.ownerRepo = "unregistered-owner";
    if (kind === "actor") callerId = "unregistered-caller";
    if (kind === "injected-field") value.request.shell = "id";
    if (kind === "incomplete-persistence") value.request.runtimeStateModel = "persistent";
    if (kind === "conflicting-id") {
      await service.submit({ callerId, input: input() });
      value.request.purpose = "Changed intent under the original identity.";
    }
    approve(value);
    if (kind === "approval") value.approval.intent_digest = `sha256:${"c".repeat(64)}`;
    await assert.rejects(service.submit({ callerId, input: value }));
    assert.equal((await service.listRequests({callerId:"console"})).page.total, kind === "conflicting-id" ? 1 : 0);
    assert.equal(h.externalWrites(), 0);
  });
}

test("caller isolation applies to list, original read and replay", async t => {
  const h = harness(t), service = h.create();
  await service.submit({ callerId: "console", input: input() });
  await assert.rejects(service.get({ callerId: "other", requestId: "devint-request:one" }), error => error.statusCode === 404);
  await assert.rejects(service.submit({callerId:"other",input:input()}), error => error.statusCode === 404);
  assert.deepEqual((await service.listRequests({callerId:"other"})).requests, []);
});

test("request receipt corruption fails closed and an owner outage does not hide the durable request", async t => {
  const h = harness(t), service = h.create();
  const original = await service.submit({callerId:"console",input:input()});
  h.changeOwner(() => null);
  const retained = await service.get({callerId:"console",requestId:original.request_id});
  assert.equal(retained.admission.state,"unavailable");
  assert.deepEqual(retained.receipt,original.receipt);
  const {readdirSync,readFileSync,writeFileSync} = await import("node:fs");
  const callers = path.join(h.root,"profile-requests","by-caller");
  const folder = path.join(callers,readdirSync(callers)[0]);
  const recordPath = path.join(folder,readdirSync(folder)[0]);
  const damaged = JSON.parse(readFileSync(recordPath));damaged.receipt.outcome="profile-admitted";
  writeFileSync(recordPath,JSON.stringify(damaged));
  await assert.rejects(service.get({callerId:"console",requestId:original.request_id}),error=>error.code==="dev_integration_state_invalid");
});

test("history is bounded and does not probe admission for every loaded request", async t => {
  const h = harness(t), service = h.create();
  for(let index=0;index<26;index++)await service.submit({callerId:"console",input:input("row-"+index)});
  const before=h.reads.length;
  const first=await service.listRequests({callerId:"console",limit:20});
  const second=await service.listRequests({callerId:"console",offset:20,limit:20});
  assert.equal(first.requests.length,20);assert.equal(second.requests.length,6);
  assert.equal(first.page.total,26);assert.equal(h.reads.length,before);
});

test("admission readback requires the exact native request reference as well as profile identity",async t=>{
  const h=harness(t), service=h.create();
  const original=await service.submit({callerId:"console",input:input()});
  const profile={profile_id:"real-request",owner_repo:"owner",lifecycle:"active",lane_class:"integration-devint",purpose:"Registered profile",
    participating_repos:["owner"],dependencies:[],request_record_ref:"oos://dev-integration/requests/devint-request:other",
    runtime:{platform:"local-k3s",state_model:"disposable",observation:{state:"unknown",observed_at:null,source_ref:null}},expected_writes:null,persistence:null,
    security_owner:"security-architecture",security_triggers:null,admission_refs:[],source:{ref:"repo://owner/profile.yaml",registry_revision:"a".repeat(40),owner_revision:"b".repeat(40)},
    stage_handoff:{owner_repo:"owner",governed_surface:null,required_checks:[],result:"unknown",check_results:[],smoke_summary_ref:null,session_manifest_ref:null,promotion_report_ref:null},gaps:[]};
  h.changeOwner(owner=>({...owner,profiles:[profile],page:{...owner.page,total:1}}));
  const other=await service.get({callerId:"console",requestId:original.request_id});
  assert.equal(other.admission.state,"different-request");assert.equal(other.admission.lifecycle,null);
  profile.request_record_ref=original.request_ref;
  const admitted=await service.get({callerId:"console",requestId:original.request_id});
  assert.equal(admitted.admission.state,"registered");assert.equal(admitted.admission.lifecycle,"active");
  assert.deepEqual(admitted.receipt,original.receipt);assert.equal(h.externalWrites(),0);
});

test("closed read projection rejects injected owner fields and oversized pages", () => {
  assert.deepEqual(assertDevIntegrationProfileProjection(projection()), projection());
  assert.throws(() => assertDevIntegrationProfileProjection({ ...projection(), raw_credentials: "not-allowed" }));
  assert.throws(() => assertDevIntegrationProfileProjection({ ...projection(), page: { ...projection().page, limit: 1000 } }));
});
