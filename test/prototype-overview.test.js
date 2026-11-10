import test from "node:test";
import assert from "node:assert/strict";
import {readPrototypeOverviewIndex,summarizePrototypeOverview} from "../src/prototype-landing/overview.js";

const revision="a".repeat(40);
test("overview indexes more than 512 documents without reading unrelated retained evidence",async()=>{
  const prototypes=Array.from({length:700},(_,i)=>({id:`sample-${i}`,lifecycle:i%2?"candidate":"exploring"}));
  let reads=0;
  const files=[...prototypes.map(row=>`records/prototype-landings/${row.id}/record.json`),...prototypes.map(row=>`records/delivery-packets/${row.id}.json`)];
  const index=await readPrototypeOverviewIndex({git:async()=>{reads++;throw Error("No detailed evidence should be loaded");},authorityRoot:"unused",revision,registry:{prototypes},files});
  assert.equal(index.records.length,700);assert.equal(reads,0);assert.equal(index.records.every(row=>row.landed),true);
  assert.deepEqual(Object.keys(index.records[0]).sort(),["id","landed","lifecycle"]);
});

test("overview reads each caller-scoped progress index once while returning only complete counts",async()=>{
  const records=Array.from({length:71},(_,i)=>({id:`sample-${i}`,lifecycle:i===70?"graduated":i===0?"baseline-approved":i===1?"candidate":"exploring",landed:true}));
  const calls=[];
  const landing={overview:async args=>{calls.push(args);return [];}};
  const maturity={overview:async args=>{
    calls.push(args);
    const rows=[{prototype_id:"prototype:sample-0",transition:"baseline-promotion",status:"succeeded",receipt:{outcome:"succeeded"},readback:{observed_lifecycle:"baseline-approved"}},
      {prototype_id:"prototype:sample-1",transition:"baseline-promotion",status:"blocked"},
      {prototype_id:"prototype:sample-70",transition:"candidate-promotion",status:"blocked"}];
    return rows.map(row=>({...row,source_accepted:row.status==="succeeded"}));
  }};
  const result=await summarizePrototypeOverview({workflow_id:"prototype-overview-index",authority_revision:revision,records},{callerId:"console-test",landing,maturity});
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.callerId==="console-test"&&Object.keys(call).length===1));
  assert.deepEqual(result.counts,{total:71,exploring:68,candidate:1,baselineApproved:1,graduating:0,graduated:1,retired:0,blocked:1,movementReady:1});
  assert.equal(result.canonical_mutation,false);assert.ok(JSON.stringify(result).length<500);
  assert.equal(JSON.stringify(result).includes("sample-"),false);
});

test("overview cannot substitute an absent coordinator or partial workflow read with zero counts",async()=>{
  const index={workflow_id:"prototype-overview-index",records:[]};
  await assert.rejects(summarizePrototypeOverview(index,{callerId:"a",landing:{},maturity:{}}),/unavailable/);
  index.records.push({id:"sample",lifecycle:"exploring",landed:false});
  await assert.rejects(summarizePrototypeOverview(index,{callerId:"a",landing:{overview:async()=>[]},maturity:{overview:async()=>{throw Error("owner unavailable");}}}),/owner unavailable/);
});
