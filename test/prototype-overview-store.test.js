import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createPrototypeLandingStore} from "../src/prototype-landing/store.js";
import {createPrototypeMaturityStore} from "../src/prototype-maturity/store.js";
import {prototypeLandingDigest} from "../src/prototype-landing/contracts.js";
import {prototypeMaturityDigest} from "../src/prototype-maturity/contracts.js";
import {createPrototypeLandingService} from "../src/prototype-landing/service.js";
import {createPrototypeMaturityService} from "../src/prototype-maturity/service.js";

for(const [family,createStore,digest] of [["landing",createPrototypeLandingStore,prototypeLandingDigest],["maturity",createPrototypeMaturityStore,prototypeMaturityDigest]])test(`${family} overview reads caller-owned latest metadata beyond the legacy 512-row limit`,async context=>{
 const root=await mkdtemp(path.join(tmpdir(),"prototype-overview-store-"));context.after(()=>rm(root,{recursive:true,force:true}));
 const records={};
 for(let i=0;i<600;i++)records[`record-${i}`]={caller_id:"example",evaluation:{request:{request_id:`request-${i}`,prototype_id:`prototype:sample-${i}`,prototype:{id:`prototype:sample-${i}`},transition:family}},history:[{at:"2026-01-01T00:00:00Z"}]};
 records.foreign={caller_id:"other",evaluation:{request:{request_id:"foreign",prototype_id:"prototype:sample-0",transition:family}},history:[{at:"2026-02-01T00:00:00Z"}]};
 const state={schema_version:1,records,keys:{}};await writeFile(path.join(root,"state.json"),JSON.stringify({...state,digest:digest(state,"digest")}));
 const store=createStore({root});let projected=0;
 const rows=await store.overview("example",record=>{projected++;assert.equal(record.caller_id,"example");return {id:record.evaluation.request.request_id};});
 assert.equal(rows.length,600);assert.equal(projected,600);assert.equal(rows.some(row=>row.id==="foreign"),false);
 await assert.rejects(store.list("example"),/bounded read limit/);
});

for(const [family,factory] of [["landing",createPrototypeLandingService],["maturity",createPrototypeMaturityService]])test(`${family} service refuses foreign or unbound progress before compact projection`,async()=>{
 const service=factory({store:{overview:async(callerId,project)=>project({caller_id:"other"})}});
 await assert.rejects(service.overview({callerId:"example"}),/not found/);
 const unbound=factory({store:{overview:async(callerId,project)=>project({caller_id:callerId,binding_digest:"invalid",evaluation:{request:{}},operator_approval_ref:"approval://example"})}});
 await assert.rejects(unbound.overview({callerId:"example"}),/binding is invalid/);
});
