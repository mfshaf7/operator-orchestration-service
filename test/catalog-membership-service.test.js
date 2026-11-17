import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMembershipService, assertMembershipCommand } from "../src/catalog/membership-service.js";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { CatalogUpstreamError } from "../src/catalog/http-client.js";
const caller="governance-operations-console",operator="operator:test",version="sha256:"+"a".repeat(64);
const command=()=>({request_id:"membership-test",operation:"add",principal_id:20,membership_id:null,role_ids:[4],expected_version:null});
function result(input,patch={}) {
  const body={schema_version:1,status:"applied",request_id:input.request_id,caller_id:input.caller_id,operator_id:input.operator_id,
    operation:input.operation,project_id:4,project_identifier:"workspace-delivery-art",principal:{id:20,name:"Synthetic User",kind:"user"},before:null,
    after:{id:20,name:"Synthetic User",kind:"user",membership_id:10,role_ids:[4],role_names:["Member"],version,protected:false,restriction:null},
    applied_at:"2026-11-17T00:00:00Z",replayed:false,request_digest:canonicalDigest(input),...patch};
  return {...body,receipt:{ref:"openproject://delivery-memberships/receipts/"+"b".repeat(64),digest:canonicalDigest({...body,replayed:false})}};
}
test("membership command rejects authority injection, invalid roles and incoherent mutation targets",()=>{
  for(const patch of [{project_id:8},{operator_id:"other"},{role_ids:[]},{role_ids:[4,4]},{role_ids:[-1]},{principal_id:0},
    {operation:"remove"},{membership_id:10},{expected_version:version}])assert.throws(()=>assertMembershipCommand({...command(),...patch}));
  assert.deepEqual(assertMembershipCommand(command()),command());
});
test("service derives accountable identities and verifies receipt/readback",async()=>{
  let accepted;const audit=[];
  const service=createMembershipService({backendClient:{mutateMembership:async input=>{accepted=input;return result(input);}},audit:{emit:event=>audit.push(event)}});
  const outcome=await service.mutate({callerId:caller,operatorId:operator,command:command()});
  assert.equal(accepted.caller_id,caller);assert.equal(accepted.operator_id,operator);
  assert.equal(outcome.after.membership_id,10);assert.equal(audit[0].receipt_ref,outcome.receipt.ref);
});
test("service rejects another operator, altered digest, wrong principal and mismatching applied roles",async()=>{
  for(const patch of [{operator_id:"other"},{request_digest:"sha256:"+"0".repeat(64)},
    {principal:{id:21,name:"Other",kind:"user"}},{after:{role_ids:[5]}}]) {
    const service=createMembershipService({backendClient:{mutateMembership:async input=>result(input,patch)}});
    await assert.rejects(()=>service.mutate({callerId:caller,operatorId:operator,command:command()}),error=>error.code==="membership_readback_invalid");
  }
  const service=createMembershipService({backendClient:{mutateMembership:async input=>({...result(input),receipt:{ref:"wrong",digest:version}})}});
  await assert.rejects(()=>service.mutate({callerId:caller,operatorId:operator,command:command()}));
});
test("exact replay retains its original readback after newer decisions",async()=>{
  const service=createMembershipService({backendClient:{mutateMembership:async input=>result(input,{replayed:true})}});
  assert.equal((await service.mutate({callerId:caller,operatorId:operator,command:command()})).replayed,true);
});
function app(shared=false) {
  const config=loadConfig({CALLER_ALLOWED_IDS:caller,...(shared ? {CALLER_AUTH_SHARED_SECRET:"test-secret"} : {CALLER_AUTH_SECRETS_JSON:JSON.stringify({[caller]:"test-secret"})}),
    OOS_DELIVERY_WORK_SESSION_CALLER_OPERATOR_BINDINGS_JSON:JSON.stringify({[caller]:operator})});
  const calls=[];
  return {calls,app:createApp({config,membershipService:{project:async input=>{calls.push(input);return {ok:true};},mutate:async input=>{calls.push(input);return {ok:true};}}})};
}
async function invoke(app,{method="GET",secret="test-secret",operatorId=operator,body,query=""}={}) {
  const request=Readable.from(body ? [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))] : []);
  Object.assign(request,{method,url:`/v1/delivery-memberships/${method==="GET" ? "projection" : "mutations"}${query}`,headers:{"x-oos-caller-id":caller,"x-oos-caller-secret":secret,"x-oos-operator-id":operatorId,"content-type":"application/json"}});
  let status,raw="";await app(request,{writeHead:code=>status=code,end:body=>raw+=body});return {status,body:JSON.parse(raw)};
}
test("membership HTTP paths enforce caller-specific credentials and configured operator for reads and writes",async()=>{
  const h=app();
  for(const method of ["GET","POST"]){
    assert.equal((await invoke(h.app,{method,secret:"wrong"})).status,401);
    assert.equal((await invoke(h.app,{method,operatorId:"other"})).status,403);
    assert.equal((await invoke(app(true).app,{method})).status,403);
  }
  assert.equal(h.calls.length,0);
  assert.equal((await invoke(h.app)).status,200);
  assert.deepEqual(h.calls[0],{callerId:caller,operatorId:operator,query:{}});
  assert.equal((await invoke(h.app,{method:"POST",body:command()})).status,200);
  assert.equal(h.calls[1].operatorId,operator);
});
test("duplicate query and JSON keys cannot change reviewed authority",async()=>{
  const h=app();
  assert.equal((await invoke(h.app,{query:"?page=1&page=2"})).status,400);
  assert.equal((await invoke(h.app,{method:"POST",body:'{"request_id":"one","request_id":"two"}'})).status,400);
  assert.equal(h.calls.length,0);
});
test("native permission and stale-review errors remain explicit",async()=>{
  for(const [code,statusCode] of [["membership_permission_required",403],["membership_source_changed",409]]) {
    const service=createMembershipService({backendClient:{mutateMembership:async()=>{throw new CatalogUpstreamError(code,"Review the project membership.",{statusCode});}}});
    await assert.rejects(()=>service.mutate({callerId:caller,operatorId:operator,command:command()}),e=>e.code===code&&e.statusCode===statusCode);
  }
});
