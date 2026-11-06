import test from "node:test";
import assert from "node:assert/strict";
import {createProposalRegisterReader} from "../src/proposal-workflow/register.js";
import {createProposalWorkflowService} from "../src/proposal-workflow/service.js";

function fixture(count=61, changes={}) {
  const calls=[], rows=Array.from({length:count},(_,index)=>({ideaId:`idea-${count-index}`,recordRef:`openproject://work_packages/${count-index}`,createdAt:"2026-11-05T00:00:00Z",title:`Idea ${count-index}`,body:"Useful source",status:"captured",deliveryRef:null,...changes}));
  const client={async listIdeas({limit,offset}){calls.push(["list",offset]);return {items:rows.slice((offset-1)*limit,offset*limit),total:rows.length,limit,offset};},
    async listProposalActivities(){throw new Error("Register opened history");},async getIdea(){throw new Error("Register fetched individual record");},
    async listPrototypeDeliveryApplicationTargets({recordIds}){calls.push(["linked",recordIds]);return recordIds.map(id=>({record_ref:`openproject://work_packages/${id}`,status:"retired"}));}};
  const read=createProposalRegisterReader({openProjectClient:client,projectRecord:row=>({schema_version:1,proposal_id:row.ideaId,record_ref:row.recordRef,title:row.title,body:row.body,updated_at:row.createdAt,record_version:"version-1",projection_state:"current",status:row.status,
    delivery_ref:row.deliveryRef,source:{ingress:row.ingress??"console"},route:null,handoff:{state:"not-requested"}})});
  return {read,rows,calls,client};
}
test("register reads one collection page, no record history, then continues without an inventory ceiling",async()=>{
 const h=fixture(301);let cursor=null,seen=[];
 do{const page=await h.read({cursor});assert.ok(page.records.length<=25);assert.equal(page.source_total,301);assert.ok(page.records.every(row=>row.summaryOnly && !row.history.events.length));seen.push(...page.records.map(row=>row.projection.proposal_id));cursor=page.next_cursor;}while(cursor);
 assert.equal(seen.length,301);assert.equal(new Set(seen).size,301);assert.equal(h.calls.length,13);
});
test("sparse global search remains bounded and gives explicit continuation to matches beyond the first scan",async()=>{
 const h=fixture(151);const page=await h.read({query:"Idea 1"});assert.equal(h.calls.length,1); // IDs151..127 match25 immediately.
 assert.equal(page.records.length,25);
 const sparse=await h.read({query:"Idea 2"});assert.equal(sparse.records.length,0);assert.ok(sparse.next_cursor);
 const rest=await h.read({query:"Idea 2",cursor:sparse.next_cursor});assert.ok(rest.records.some(row=>row.projection.proposal_id==="idea-2"));
});
test("cursor rejects another search/filter and detects an inventory shift instead of dropping or duplicating records",async()=>{
 const h=fixture();const first=await h.read();await assert.rejects(h.read({query:"other",cursor:first.next_cursor}),error=>error.code==="proposal_register_query_invalid");
 h.rows.pop();await assert.rejects(h.read({cursor:first.next_cursor}),error=>error.code==="proposal_register_changed");
});
test("page filters retain downstream retired truth using an exact scoped metadata read",async()=>{
 const h=fixture(2,{status:"accepted",deliveryRef:"openproject://work_packages/901"});const page=await h.read({status:"retired"});assert.equal(page.records.length,2);assert.deepEqual(h.calls,[["list",1],["linked",[901]]]);
});
test("native malformed page metadata fails closed",async()=>{
 const h=fixture();h.client.listIdeas=async()=>({items:[],total:61,limit:25,offset:1});await assert.rejects(h.read(),error=>error.code==="proposal_register_source_invalid");
});
test("production register projector uses canonical summary state without activity scans or invented event receipts",async()=>{
 const h=fixture(1);h.rows[0]={...h.rows[0],lockVersion:1,updatedAt:"2026-11-05T00:00:00Z",source:{surface:"governance-operations-console"},workflowState:null,triageSummary:null,operatorDecisionNotes:null};
 const reader=createProposalWorkflowService({openProjectClient:h.client});const page=await reader.getRegister();assert.equal(page.records[0].projection.status,"captured");assert.equal(page.records[0].projection.last_event_ref,null);assert.equal(page.records[0].summaryOnly,true);assert.deepEqual(h.calls,[["list",1]]);
});
