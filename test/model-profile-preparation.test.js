import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{createModelProfilePreparation}from'../src/model-profile-request/preparation.js';import{createModelProfileRequestService}from'../src/model-profile-request/service.js';import{createModelProfileRequestStore}from'../src/model-profile-request/store.js';import{modelProfileDigest}from'../src/model-profile-request/contracts.js';
const auth={callerId:'console',operatorId:'operator:sample'},sha='sha256:'+'a'.repeat(64);
const setup={workflow_id:'planning-v1/planning',label:'Planning',purpose:'planning',requesting_owner:'service',registered_callers:[{caller_id:'service/planning',owner_repo:'service'}],environments:['dev-integration'],output_schema_ref:{repo:'platform-engineering',path:'security/schemas/planning.json',version:sha},operational_expectations:['Use admitted context.','Require human review.'],setup_digest:sha};
const input={schema_version:1,request_id:'model-profile-request:prepared-test',workflow_id:setup.workflow_id,setup_digest:sha,display_name:'Planning support',intended_purpose:'Draft planning suggestions.',requested_environment:'dev-integration',input_data_classification:'internal',operator_justification:'This workflow needs bounded planning assistance.',additional_expectations:[]};
async function fixture(options={}){
 const root=await mkdtemp(join(tmpdir(),'profile-preparation-')),store=createModelProfileRequestStore({root}),calls=[];
 const service=createModelProfileRequestService({store,operatorBindings:{console:auth.operatorId},fulfillmentCallerIds:new Set(['platform']),clock:()=>new Date('2026-01-01T00:00:00Z')});
 const preparation=createModelProfilePreparation({service,operatorBindings:{console:auth.operatorId},contextBaseUrl:'http://context.test',clock:()=>new Date('2026-01-01T00:00:00Z'),platform:{profileRequestOptions:async()=>{if(options.ownerFail)throw Error('owner unavailable');return{schema_version:1,workflows:[setup]};}},fetchImpl:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});if(options.fail)throw Error('offline');return Response.json({artifact_id:'artifact-sample',artifact_digest:sha,admission_decision:{raw_projection:options.raw?'allowed':'denied',redaction_safe:true},raw_artifact_path:'/must-not-leak'});}});
 return{root,service,preparation,calls,close:()=>rm(root,{recursive:true,force:true})};
}
test('workflow setup and admitted context build one native submitted request without granting approval',async()=>{
 const f=await fixture();try{const result=await f.preparation.submit({...auth,input});assert.equal(result.review_state,'submitted');assert.equal(result.fulfillment_state,'not-started');assert.equal(result.profile_lifecycle_changed,false);assert.equal(result.request.profile_intent.admitted_context_ref.uri,'http://context.test/v1/context/packets/artifact-sample');assert.deepEqual(result.request.profile_intent.registered_callers,setup.registered_callers);assert.deepEqual(result.request.profile_intent.required_output_schema_ref,setup.output_schema_ref);assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(result),/must-not-leak/);assert.equal(f.calls[0].url,'http://context.test/v1/context/admissions');assert.equal(result.history.length,2);
 const replay=await f.preparation.submit({...auth,input});assert.deepEqual(replay,result);assert.equal(f.calls.length,1);
 await assert.rejects(f.preparation.submit({...auth,input:{...input,display_name:'Changed intent'}}),error=>error.code==='model_profile_request_idempotency_conflict');assert.equal(f.calls.length,1);
 }finally{await f.close();}
});
test('caller, setup version, workflow and environment are checked before context admission',async()=>{
 const f=await fixture();try{
 for(const value of [{...auth,operatorId:'operator:other',input},{...auth,input:{...input,workflow_id:'unknown/work'}},{...auth,input:{...input,setup_digest:'sha256:'+'b'.repeat(64)}},{...auth,input:{...input,requested_environment:'prod'}},{...auth,input:{...input,registered_callers:[{caller_id:'smuggled',owner_repo:'service'}]}}])await assert.rejects(f.preparation.submit(value));
 assert.equal(f.calls.length,0);assert.equal((await f.service.list({callerId:auth.callerId})).requests.length,0);
 }finally{await f.close();}
});
test('failed or unsafe context admission does not create a profile request',async()=>{
 for(const options of [{fail:true},{raw:true},{ownerFail:true}]){const f=await fixture(options);try{await assert.rejects(f.preparation.submit({...auth,input}));assert.equal((await f.service.list({callerId:auth.callerId})).requests.length,0);}finally{await f.close();}}
});
test('concurrent original submissions retain one native request and history',async()=>{
 const f=await fixture();try{const first=await Promise.allSettled([f.preparation.submit({...auth,input}),f.preparation.submit({...auth,input})]);assert.ok(first.some(x=>x.status==='fulfilled'));const result=await f.preparation.submit({...auth,input});assert.equal(result.history.length,2);assert.equal((await f.service.list({callerId:auth.callerId})).requests.length,1);}finally{await f.close();}
});
test('rules retain native length and total limits before context effects',async()=>{
 const f=await fixture();try{
 await assert.rejects(f.preparation.submit({...auth,input:{...input,additional_expectations:['x'.repeat(501)]}}));
 await assert.rejects(f.preparation.submit({...auth,input:{...input,additional_expectations:Array.from({length:19},(_,i)=>'Rule '+i)}}));assert.equal(f.calls.length,0);
 const result=await f.preparation.submit({...auth,input:{...input,additional_expectations:Array.from({length:18},(_,i)=>'Rule '+i)}});assert.equal(result.request.profile_intent.operational_expectations.length,20);
 }finally{await f.close();}
});
