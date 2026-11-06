import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createProposalWorkflowService } from "../src/proposal-workflow/service.js";
import { projectCanonicalSchemaForOpenApi } from "../scripts/orchestration_openapi_schema_tools.mjs";

const caller="governance-operations-console";
const env={CALLER_ALLOWED_IDS:caller,CALLER_AUTH_SECRETS_JSON:JSON.stringify({[caller]:"test-secret"}),
 OPENPROJECT_BASE_URL:"http://backend.invalid",OPENPROJECT_API_TOKEN:"test-token",OPENPROJECT_IDEA_TYPE_ID:"1",
 OPENPROJECT_CAPTURED_STATUS_ID:"1",OPENPROJECT_TRIAGED_STATUS_ID:"2",OPENPROJECT_PARKED_STATUS_ID:"3",OPENPROJECT_ACCEPTED_STATUS_ID:"4",OPENPROJECT_REJECTED_STATUS_ID:"5",
 OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID:"1",OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID:"2",OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID:"57"};
const media="application/vnd.mfshaf7.console-source-projection+json; version=1";
async function invoke(app,url="/v1/proposals/register",secret="test-secret") {
 const request=Readable.from([]);Object.assign(request,{method:"GET",url,headers:{accept:media,"x-oos-caller-id":caller,"x-oos-caller-secret":secret}});
 let status,headers,output="";await app(request,{writeHead(value,meta){status=value;headers=meta;},end(value){output+=value??"";}});
 return {status,headers,body:JSON.parse(output)};
}
function fixture() {
 const reads=[],audits=[],rows=Array.from({length:31},(_,index)=>({ideaId:`idea-${31-index}`,recordRef:`openproject://work_packages/${31-index}`,lockVersion:1,
 title:`Synthetic idea ${31-index}`,body:"Useful context.",status:"captured",createdAt:"2026-11-05T00:00:00Z",updatedAt:"2026-11-05T00:00:00Z",source:{surface:"governance-operations-console"},workflowState:null,triageSummary:null,operatorDecisionNotes:null,deliveryRef:null}));
 const service=createProposalWorkflowService({audit:{emit:event=>audits.push(event)},openProjectClient:{
 async listIdeas({offset,limit}){reads.push({offset,limit});return {items:rows.slice((offset-1)*limit,offset*limit),total:rows.length,offset,limit};},
 async listProposalActivities(){throw new Error("Register read opened history");},async getIdea(){throw new Error("Register read opened an individual record");}}});
 return {app:createApp({config:loadConfig(env),proposalWorkflowService:service}),reads,audits};
}
test("authenticated native register returns bounded source projection and selector-bound continuation",async()=>{
 const h=fixture(),first=await invoke(h.app);
 assert.equal(first.status,200);assert.equal(first.body.artifact_type,"console-source-projection");
 assert.equal(first.body.binding.record_ref,"openproject://projects/workspace-proposals");assert.equal(first.body.binding.source_owner,"workspace-proposals");
 assert.match(first.body.revision.source_revision,/sha256:[a-f0-9]{64}/);assert.equal(first.body.freshness.state,"current");
 assert.equal(first.body.projection.records.length,25);assert.equal(first.body.projection.source_total,31);
 assert.ok(first.body.projection.records.every(row=>row.summaryOnly && row.history.events.length===0));
 const second=await invoke(h.app,`/v1/proposals/register?cursor=${first.body.projection.next_cursor}`);
 assert.equal(second.status,200);assert.equal(second.body.projection.records.length,6);assert.equal(second.body.projection.next_cursor,null);
 assert.notEqual(second.body.binding.source_ref,first.body.binding.source_ref);assert.deepEqual(h.reads,[{offset:1,limit:25},{offset:2,limit:25}]);
 assert.equal(h.audits.length,2);assert.equal(h.audits[0].event_type,"proposal.register.read");assert.equal(h.audits[0].caller.id,caller);
});
test("register rejects caller failure and malformed selectors before any native read",async()=>{
 const h=fixture();assert.equal((await invoke(h.app,undefined,"wrong")).status,401);
 for(const query of ["status=made-up","query=first&query=second","unknown=value","cursor=not-a-cursor","query="+"a".repeat(201)])assert.equal((await invoke(h.app,"/v1/proposals/register?"+query)).status,400);
 assert.deepEqual(h.reads,[]);assert.deepEqual(h.audits,[]);
});
test("OpenAPI projection preserves declared external JSON pointer and fails on unknown schema",()=>{
 const project=ref=>projectCanonicalSchemaForOpenApi({canonicalFilename:"test.schema.json",componentName:"Test",canonicalSchema:{type:"object",properties:{decision:{$ref:ref}}},externalRefMap:{"command.schema.json":"Command"}});
 assert.equal(project("command.schema.json#/$defs/disposition_command").properties.decision.$ref,"#/components/schemas/Command/$defs/disposition_command");
 assert.equal(project("command.schema.json").properties.decision.$ref,"#/components/schemas/Command");
 assert.throws(()=>project("unknown.schema.json#/$defs/disposition_command"),/unsupported canonical schema ref/);
});
