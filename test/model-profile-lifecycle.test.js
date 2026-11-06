import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModelProfileLifecycle} from '../src/model-profile-request/lifecycle.js';
import {createModelProfileRequestService} from '../src/model-profile-request/service.js';
import {createModelProfileRequestStore} from '../src/model-profile-request/store.js';
import {modelProfileDigest} from '../src/model-profile-request/contracts.js';

const auth={callerId:'console',operatorId:'operator:sample'},hash='sha256:'+'a'.repeat(64),clock=()=>new Date('2026-11-06T00:00:00Z');
const selection={request_id:'model-profile-request:lifecycle',intent:'suspend',profile_id:'planning-v1',environment:'dev-integration',changes:{}};
const ref={uri:'https://example.test/source',digest:hash};
function prepared(input){
 const candidate={intent:input.intent,profile_id:'planning-v1',expected_sources:{registry_digest:hash,access_plane_digest:hash,runtime_assist_digest:hash,source_version:'a'.repeat(40)},target_profile:null,activation_environment:input.intent==='activate'?'dev-integration':null};
 candidate.candidate_digest=modelProfileDigest(candidate);
 return {schema_version:1,profile_id:input.profile_id,intent:input.intent,candidate,preparation_digest:modelProfileDigest({input,candidate}),can_submit:input.intent!=='amend'||Object.keys(input.changes).length>0,current_state:'active',result_state:'suspended',affected_workflows:['service/planning'],security_acceptance_required:['activate','exception'].includes(input.intent),editable_policy:{allowed_data_scope:['Admitted context'],runtime_limits:{max_output_tokens:4000}},impact:'Separate reviewed source and runtime steps.',profile_setup:{profile_id:input.intent==='create'?null:'planning-v1',source:input.intent==='create'?null:{registry_ref:ref,source_version:'a'.repeat(40)},requesting_owner:'service',registered_callers:[{caller_id:'service/planning',owner_repo:'service'}],requested_environments:['dev-integration'],required_output_schema_ref:{repo:'platform-engineering',path:'security/schemas/planning.json',version:hash},human_approval_required:true,operational_expectations:['Use admitted context.']}};
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'profile-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[],state={offline:false},store=createModelProfileRequestStore({root});
 const service=createModelProfileRequestService({store,clock,operatorBindings:{console:auth.operatorId},fulfillmentCallerIds:new Set(['platform'])});
 const provider={prepareModelProfile:async input=>{calls.push('prepare');if(state.offline)throw Error('offline');return prepared(input);},inspectModelProfile:async input=>{calls.push('inspect');return {request_id:input.request_id};},controlModelProfile:async input=>{calls.push(input.action);return input;}};
 const lifecycle=createModelProfileLifecycle({service,clock,provider,operatorBindings:{console:auth.operatorId},preparation:{admit:async()=>{calls.push('admit');return {uri:'https://example.test/admitted-context',digest:hash};}}});
 return {service,lifecycle,calls,state,root};
}
const submission=input=>({...input,preparation_digest:prepared(input).preparation_digest,display_name:'Planning support',intended_purpose:'Support a registered planning workflow.',input_data_classification:'internal',operator_justification:'Pause this profile while its operating rules are reviewed.'});

test('all native intents use owner-bound source, genuine context and native submitted state',async t=>{
 for(const intent of ['create','amend','activate','suspend','retire','exception']){
  const f=await fixture(t),input={...selection,intent,changes:intent==='amend'?{runtime_limits:{max_output_tokens:3000}}:{}};
  const impact=await f.lifecycle.prepare({...auth,input});assert.equal(impact.intent,intent);assert.equal(impact.candidate,undefined);assert.equal(impact.profile_setup,undefined);
  const result=await f.lifecycle.submit({...auth,input:submission(input)});
  assert.equal(result.request.intent,intent);assert.equal(result.review_state,'submitted');assert.equal(result.fulfillment_state,'not-started');assert.equal(result.profile_lifecycle_changed,false);
  assert.equal(result.request.profile_intent.source===null,intent==='create');assert.ok((await f.service.lifecycle({...auth,requestId:input.request_id})).context.candidate);
 }
});
test('original submitted request recovers without contacting an unavailable policy owner or readmitting context',async t=>{
 const f=await fixture(t),input=submission(selection),result=await f.lifecycle.submit({...auth,input});
 f.state.offline=true;const count=f.calls.length;
 assert.deepEqual(await f.lifecycle.submit({...auth,input}),result);assert.equal(f.calls.length,count);
 await assert.rejects(f.lifecycle.submit({...auth,input:{...input,operator_justification:'Different input'}}),e=>e.statusCode===409);
});
test('stale preparation, wrong operator and browser-injected policy never create or dispatch a request',async t=>{
 const f=await fixture(t);
 for(const args of [{...auth,operatorId:'operator:other',input:selection},{...auth,input:{...selection,command:'arbitrary'}},{...auth,input:{...selection,changes:{target_profile:{status:'active'}}}}])await assert.rejects(f.lifecycle.prepare(args));
 await assert.rejects(f.lifecycle.submit({...auth,input:{...submission(selection),preparation_digest:'sha256:'+'b'.repeat(64)}}),e=>e.code==='model_profile_request_source_changed');
 assert.equal(f.calls.includes('admit'),false);assert.equal((await f.service.list({callerId:'console'})).requests.length,0);
});
test('implementation controls require actual owner approval and cannot smuggle caller identity or shell input',async t=>{
 const f=await fixture(t),input=submission(selection),requestId=input.request_id;
 await f.lifecycle.submit({...auth,input});
 await assert.rejects(f.lifecycle.operation({...auth,requestId,input:{action:'implement',expected_operation_digest:null}}),e=>e.statusCode===409);
 const command=(revision,action)=>({schema_version:1,command_id:'command:'+action,request_id:requestId,expected_revision:revision,action,operator_id:auth.operatorId,issued_at:clock().toISOString(),reason:action==='approve'?'Explicit operator review.':null,decision_ref:null,requirements:[],revised_profile_intent:null,idempotency_key:'command:'+action});
 await f.service.command({...auth,requestId,input:command(2,'start-review')});await f.service.recordReview({...auth,requestId,input:command(3,'approve')});
 assert.equal((await f.lifecycle.operation({...auth,requestId,input:{action:'implement',expected_operation_digest:null}})).request_id,requestId);
 await assert.rejects(f.lifecycle.operation({...auth,requestId,input:{action:'implement',expected_operation_digest:null,caller_id:'platform'}}));
 await assert.rejects(f.lifecycle.operation({...auth,requestId,input:{action:'shell',expected_operation_digest:null}}));
});

test('reading unchanged amendment setup cannot submit or suspend a profile',async t=>{
 const f=await fixture(t),input={...selection,intent:'amend',changes:{}};
 const view=await f.lifecycle.prepare({...auth,input});assert.equal(view.can_submit,false);
 await assert.rejects(f.lifecycle.submit({...auth,input:submission(input)}),e=>e.code==='model_profile_request_no_policy_change');
 assert.equal(f.calls.includes('admit'),false);assert.equal((await f.service.list({callerId:'console'})).requests.length,0);
});

test('policy revision refreshes the original candidate and recovers the same command without rereading owners',async t=>{
 const f=await fixture(t),input={...selection,intent:'amend',changes:{runtime_limits:{max_output_tokens:3000}}};
 let result=await f.lifecycle.submit({...auth,input:submission(input)});
 const command=(action,revision,extra={})=>({schema_version:1,command_id:'model-profile-command:'+action,request_id:input.request_id,expected_revision:revision,action,operator_id:auth.operatorId,issued_at:clock().toISOString(),reason:'Review requires a smaller response limit.',decision_ref:null,requirements:[],revised_profile_intent:null,idempotency_key:'model-profile-command:'+action,...extra});
 result=await f.service.command({...auth,requestId:input.request_id,input:command('start-review',result.revision)});
 result=await f.service.command({...auth,requestId:input.request_id,input:command('request-changes',result.revision,{requirements:[{requirement_id:'requirement:smaller',summary:'Reduce response limit',owner_repo:'service',next_action:'Revise operating policy'}]})});
 const changed={...input,changes:{runtime_limits:{max_output_tokens:1000}}};
 const revision={...submission(changed),expected_revision:result.revision,command_id:'model-profile-command:policy-revision'};
 const updated=await f.lifecycle.revise({...auth,input:revision});
 assert.equal(updated.request_id,input.request_id);assert.equal(updated.review_state,'changes-required');assert.equal(updated.revision,result.revision+1);
 const handoff=await f.service.lifecycle({callerId:auth.callerId,requestId:input.request_id});
 assert.deepEqual(handoff.context.selection.changes,changed.changes);assert.equal(handoff.context.revision_input_digest,modelProfileDigest(revision));assert.equal(handoff.security_acceptance,null);
 f.state.offline=true;const reads=f.calls.length;
 assert.deepEqual(await f.lifecycle.revise({...auth,input:revision}),updated);assert.equal(f.calls.length,reads);
 await assert.rejects(f.lifecycle.revise({...auth,input:{...revision,operator_justification:'Different content under original identity'}}),e=>e.statusCode===409);
});
