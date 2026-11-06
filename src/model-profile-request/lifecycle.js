import {assertModelProfileContract,assertModelProfileLifecycleContract,modelProfileDigest,modelProfileRequestError as fail} from './contracts.js';

const intents=new Set(['create','amend','activate','suspend','retire','exception']);
export function createModelProfileLifecycle({service,provider,preparation,operatorBindings,clock=()=>new Date()}) {
  function bind(auth){if(!operatorBindings[auth.callerId]||operatorBindings[auth.callerId]!==auth.operatorId)throw fail('operator_binding_invalid','This operator is not bound to the authenticated caller.',403);}
  function selector(input){
    if(!input||!intents.has(input.intent)||typeof input.profile_id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.profile_id)||typeof input.request_id!=='string'||!/^model-profile-request:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.request_id)||input.environment!=='dev-integration'||!input.changes||Object.getPrototypeOf(input.changes)!==Object.prototype)throw fail('lifecycle_input_invalid','Choose a profile, its action and supported environment.',400);
    return Object.fromEntries(['request_id','intent','profile_id','environment','changes'].map(key=>[key,input[key]]));
  }
  async function ownerPreparation(auth,input){
    bind(auth);
    const value=await provider.prepareModelProfile(selector(input));
    if(!value?.candidate||value.candidate.candidate_digest!==modelProfileDigest(Object.fromEntries(Object.entries(value.candidate).filter(([key])=>key!=='candidate_digest')))||value.intent!==input.intent||value.profile_id!==input.profile_id||!value.profile_setup||!/^sha256:[0-9a-f]{64}$/.test(value.preparation_digest??''))throw fail('lifecycle_preparation_invalid','The policy owner did not confirm this exact action.',502);
    return value;
  }
  function visible(value){const {candidate,profile_setup,...view}=value;return {...view,source_version:candidate.expected_sources.source_version};}
  async function prepare({callerId,operatorId,input}){assertModelProfileLifecycleContract('selection',input);return visible(await ownerPreparation({callerId,operatorId},input));}
  async function submit({callerId,operatorId,input}){
    const auth={callerId,operatorId};bind(auth);
    assertModelProfileLifecycleContract('submission',input);
    const keys=['request_id','intent','profile_id','environment','changes','preparation_digest','display_name','intended_purpose','input_data_classification','operator_justification'];
    if(!input||Object.keys(input).sort().join(',')!==keys.sort().join(',')||['display_name','intended_purpose','operator_justification'].some(k=>typeof input[k]!=='string'||!input[k].trim()||input[k].length>2000)||!['public','internal','confidential','restricted'].includes(input.input_data_classification))throw fail('lifecycle_submission_invalid','Complete the profile name, purpose, data classification and reason.',400);
    const correlation='model-profile-lifecycle:'+modelProfileDigest(input).slice(7);
    let result;
    try{result=await service.get({callerId,requestId:input.request_id});if(result.request.correlation_id!==correlation)throw fail('idempotency_conflict','This original request has different input.',409);}
    catch(error){if(error.code!=='model_profile_request_not_found')throw error;}
    if(!result){
      const prepared=await ownerPreparation(auth,input);
      if(prepared.preparation_digest!==input.preparation_digest)throw fail('source_changed','Policy changed after inspection. Refresh its impact and review it again.',409);
      if(prepared.can_submit===false)throw fail('no_policy_change','Choose a policy change before submitting an amendment. Current settings were read without changing permission.',409);
      const context=await preparation.admit({...input,workflow_id:input.profile_id,setup_digest:input.preparation_digest,requested_environment:input.environment,additional_expectations:[]},auth);
      const request={schema_version:1,request_id:input.request_id,intent:input.intent,requested_at:clock().toISOString(),operator_id:operatorId,
        profile_intent:{...prepared.profile_setup,display_name:input.display_name,intended_purpose:input.intended_purpose,input_data_classification:input.input_data_classification,admitted_context_ref:context,operator_justification:input.operator_justification},delivery_ref:null,correlation_id:correlation,causation_id:null,idempotency_key:input.request_id+':lifecycle-create'};
      assertModelProfileContract('request.schema.json',request);
      result=await service.create({...auth,input:request,lifecycleContext:{selection:selector(input),candidate:prepared.candidate,candidate_digest:prepared.candidate.candidate_digest,preparation_digest:prepared.preparation_digest,review:{profile_id:prepared.candidate.profile_id,source_version:prepared.candidate.expected_sources.source_version,current_state:prepared.current_state,result_state:prepared.result_state,affected_workflows:prepared.affected_workflows,policy_changes:prepared.policy_changes??[]}}});
    }
    if(result.review_state!=='draft')return result;
    return service.command({...auth,requestId:input.request_id,input:{schema_version:1,command_id:input.request_id+':lifecycle-submit',request_id:input.request_id,expected_revision:result.revision,action:'submit',operator_id:operatorId,issued_at:clock().toISOString(),reason:null,decision_ref:null,requirements:[],revised_profile_intent:null,idempotency_key:input.request_id+':lifecycle-submit'}});
  }
  async function revise({callerId,operatorId,input}){
    const auth={callerId,operatorId};bind(auth);assertModelProfileLifecycleContract('revision',input);
    const original=await service.get({callerId,requestId:input.request_id});
    const handoff=await service.lifecycle({callerId,requestId:input.request_id});
    const fingerprint=modelProfileDigest(input);
    if(original.history.some(event=>event.command_id===input.command_id)){
      if(handoff.context?.revision_input_digest!==fingerprint)throw fail('idempotency_conflict','This revision identity has different input.',409);
      return original;
    }
    if(!['draft','changes-required'].includes(original.review_state)||original.revision!==input.expected_revision)throw fail('revision_conflict','Read the current request before revising its policy.',409);
    const prior=handoff.context?.selection;
    if(!prior||prior.profile_id!==input.profile_id||original.request.intent!==input.intent)throw fail('revision_setup_missing','This request has no matching prepared integration. Keep its history and start a new request from the capability.',409);
    const prepared=await ownerPreparation(auth,input);
    if(prepared.preparation_digest!==input.preparation_digest)throw fail('source_changed','The current policy changed. Check its impact again before saving this revision.',409);
    const context=await preparation.admit({...input,workflow_id:input.profile_id,setup_digest:input.preparation_digest,requested_environment:input.environment,additional_expectations:[]},auth);
    const revised={...prepared.profile_setup,display_name:input.display_name,intended_purpose:input.intended_purpose,input_data_classification:input.input_data_classification,admitted_context_ref:context,operator_justification:input.operator_justification};
    const lifecycleContext={selection:selector(input),revision_input_digest:fingerprint,candidate:prepared.candidate,candidate_digest:prepared.candidate.candidate_digest,preparation_digest:prepared.preparation_digest,review:{profile_id:prepared.candidate.profile_id,source_version:prepared.candidate.expected_sources.source_version,current_state:prepared.current_state,result_state:prepared.result_state,affected_workflows:prepared.affected_workflows,policy_changes:prepared.policy_changes??[]}};
    return service.command({...auth,requestId:input.request_id,lifecycleContext,input:{schema_version:1,command_id:input.command_id,request_id:input.request_id,expected_revision:input.expected_revision,action:'revise',operator_id:operatorId,issued_at:clock().toISOString(),reason:input.operator_justification,decision_ref:null,requirements:[],revised_profile_intent:revised,idempotency_key:input.command_id}});
  }
  async function operation({callerId,operatorId,requestId,input=null}){
    const auth={callerId,operatorId};bind(auth);
    const original=await service.get({callerId,requestId});
    if(original.review_state!=='approved')throw fail('not_approved','Review and approve the request before Platform implementation.',409);
    if(input===null)return provider.inspectModelProfile({request_id:requestId});
    assertModelProfileLifecycleContract('control',input);
    if(!input||Object.keys(input).sort().join(',')!=='action,expected_operation_digest'||!['implement','continue','approve-merge','decline-source','reconcile','restore'].includes(input.action)||input.expected_operation_digest!==null&&!/^sha256:[0-9a-f]{64}$/.test(input.expected_operation_digest))throw fail('operation_invalid','Choose an available action on the original operation.',400);
    return provider.controlModelProfile({request_id:requestId,...input});
  }
  return {prepare,submit,revise,operation};
}
