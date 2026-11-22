import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceRecordReader, createInstanceRecordWriter } from "../src/instance-records/client.js";
import { intakeDigest } from "../src/workspace-intake/contracts.js";
import { instanceId, callerId, target, policy, nativeInput, nativeResult } from "../test-fixtures/instance-records.js";
const config = { baseUrl: "http://127.0.0.1:32199", instanceId, callerId, callerSecret: "a".repeat(32) };
const authority = { kind: "internal-instance-record", instance_id: instanceId };
const rebound = result => {
  result.receipt.record_digest = intakeDigest(result.record);
  result.receipt.receipt_digest = intakeDigest(result.receipt, "receipt_digest");
  return result;
};

test("repository migration carries exact Git provenance and returns only the matching native receipt", async () => {
  const result = nativeResult();
  const original = { ...result.record, record:{id:target.record_id,version:3}, posture:"active" };
  delete original.phase;
  const prepared = { schema_version:1,artifact_type:"legacy-repository-migration-plan",canonical_mutation:false,
    provider_repository:original.provider_repository,proposed_record:{phase:"inventory",...original},
    source: {repository:"workspace-governance",revision:"a".repeat(40),path:"contracts/repos.yaml",
      record_id:target.record_id,record_digest:intakeDigest(original),file_digest:intakeDigest("inventory"),original_envelope:original.record} };
  prepared.plan_digest=intakeDigest(prepared);
  const plan = {...prepared,instance_id:instanceId};
  const operator="operator:test";
  const request={schema_version:1,instance_id:instanceId,record_id:target.record_id,idempotency_key:"migration-1",
    plan_digest:plan.plan_digest,source_revision:"a".repeat(40),cutover_revision:"b".repeat(40),
    operator_acceptance:{state:"accepted",operator_ref:operator,recorded_at:"2026-11-22T00:00:00Z"}};
  result.record={...prepared.proposed_record,record:{...original.record,version:1}};
  Object.assign(result.receipt,{actor:callerId,action:"inventory.migrate-legacy",operator_ref:operator,
    version:1,idempotency_key:request.idempotency_key,readiness_digest:plan.plan_digest,previous:{version:null,digest:null}});
  rebound(result);
  const calls=[];
  const client=createInstanceRecordWriter({...config,fetchImpl:async (url,options)=>{
    calls.push([new URL(url).pathname,options.method]);
    return Response.json(options.method==="GET"?plan:result);
  }});
  assert.deepEqual(await client.prepareLegacyMigration(target.name),plan);
  await assert.rejects(client.acceptLegacyMigration(target.name,request,"operator:foreign"),/authenticated operator/);
  assert.deepEqual(await client.acceptLegacyMigration(target.name,request,operator),result);
  assert.deepEqual(calls.map(([,method])=>method),["GET","POST"]);
  result.receipt.readiness_digest=intakeDigest("different plan");rebound(result);
  await assert.rejects(client.acceptLegacyMigration(target.name,request,operator),/invalid binding/);
});

test("Preparation returns verified internal state or positive legacy proof, never an unavailable-to-legacy fallback", async () => {
  const state = { schema_version: 1, canonical_authority: { ...authority, record_id: target.record_id }, policy_ref: policy,
    expected_state: { record_version: null, record_digest: null }, current: null };
  const make = value => createInstanceRecordReader({ ...config, fetchImpl: async () => Response.json(value) });
  assert.deepEqual(await make(state).prepare(target.name), state);
  const legacy = { schema_version: 1, canonical_authority: { kind: "legacy-git", repo: "workspace-governance", revision: "a".repeat(40) }, record_id: target.record_id };
  assert.deepEqual(await make(legacy).prepare(target.name), legacy);
  for (const change of [v => { v.canonical_authority.instance_id = "installation-b"; }, v => { v.policy_ref.contract_digest = "unverified"; },
    v => { v.expected_state.record_version = 1; }, v => { v.current = nativeResult(); }, v => { v.canonical_authority.kind = "unknown"; }]) {
    const wrong = structuredClone(state); change(wrong); await assert.rejects(make(wrong).prepare(target.name), /invalid binding/);
  }
});

test("Original-outcome lookup is a read-only original-input POST with exact receipt binding", async () => {
  const input = nativeInput(), original = { request: input.request, decision: input.decision, operator_ref: input.operator_ref };
  const result = nativeResult(input), calls = [];
  const client = createInstanceRecordReader({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return Response.json({ schema_version: 1, authority, found: true, ...result });
  } });
  assert.deepEqual(await client.resolve(target.name, original), result);
  assert.ok(calls[0].url.endsWith(`/repositories/${target.name}/intake/readback`));
  assert.deepEqual(JSON.parse(calls[0].body), { schema_version: 1, ...original });
  assert.equal(calls[0].redirect, "error");
  const absent = createInstanceRecordReader({ ...config, fetchImpl: async () => Response.json({ schema_version: 1, authority, found: false, record: null, receipt: null }) });
  assert.equal(await absent.resolve(target.name, original), null);
  for (const change of [v => { v.receipt.operator_ref = "other"; }, v => { v.receipt.idempotency_key = "other"; },
    v => { v.record.record.last_mutation.request_digest = intakeDigest("other"); }]) {
    const wrong = structuredClone(result); change(wrong); rebound(wrong);
    const bad = createInstanceRecordReader({ ...config, fetchImpl: async () => Response.json({ schema_version: 1, authority, found: true, ...wrong }) });
    await assert.rejects(bad.resolve(target.name, original), /invalid binding/);
  }
});

test("Acceptance uses separate write endpoint and validates every reviewed record field after storage", async () => {
  const input = nativeInput(), expected = nativeResult(input), calls = [];
  const make = value => createInstanceRecordWriter({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return Response.json(value);
  } });
  assert.deepEqual(await make(expected).accept(target.name, input), expected);
  assert.ok(calls[0].url.endsWith(`/repositories/${target.name}/intake`));
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(calls[0].body), input);
  for (const change of [v => { v.record.notes = "Substituted purpose"; }, v => { v.receipt.actor = "history-reader"; },
    v => { v.receipt.policy_ref = "governance-policy://other"; }, v => { v.record.phase = "inventory"; },
    v => { v.record.provider_repository.provider_repository_id = "999"; }, v => { v.record.record.source.digest = intakeDigest("another"); }]) {
    const wrong = structuredClone(expected); change(wrong); rebound(wrong);
    await assert.rejects(make(wrong).accept(target.name, input), /invalid binding/);
  }
  const count = calls.length;
  await assert.rejects(make(expected).accept("other-repository", input), /does not bind/);
  assert.equal(calls.length, count);
});

test("Source-authority reads bind the installation, exact record and current policy before selecting a source path", async () => {
  const current = nativeResult(), entry = current.record;
  const proof = { schema_version: 1, owner_repo: target.name, canonical_authority: { ...authority, record_id: target.record_id },
    record_ref: { version: current.receipt.version, digest: current.receipt.record_digest }, policy_ref: policy,
    intake_entry_ref: { id: target.record_id, version: current.receipt.version, digest: current.receipt.record_digest },
    classification: "proposed", inventory_posture: null, provider_repository: entry.provider_repository, owner_purpose: entry.notes,
    validation_behavior: { posture: "covered-by-owner-repo", wgcf_graph_role: "product-runtime-source" },
    source_bootstrap_eligible: true, ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
  const body = { schema_version: 1, canonical_authority: proof.canonical_authority, source_authority: proof };
  const calls = [], make = value => createInstanceRecordReader({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return Response.json(value);
  } });
  assert.deepEqual(await make(body).sourceAuthority(target.name, "bootstrap"), body);
  assert.ok(calls[0].url.endsWith(`/repositories/${target.name}/source-authority?operation=bootstrap`));
  assert.equal(calls[0].method, "GET");
  for (const change of [v => { v.canonical_authority.instance_id = "another-installation"; },
    v => { v.source_authority.record_ref.digest = intakeDigest("substituted-record"); },
    v => { v.source_authority.policy_ref.revision = "unknown"; },
    v => { v.source_authority.model_writes_allowed = true; }]) {
    const wrong = structuredClone(body); change(wrong);
    await assert.rejects(make(wrong).sourceAuthority(target.name, "bootstrap"), /invalid binding/);
  }
  const count = calls.length;
  await assert.rejects(make(body).sourceAuthority(target.name, "arbitrary-command"), /supported/);
  assert.equal(calls.length, count);
});
