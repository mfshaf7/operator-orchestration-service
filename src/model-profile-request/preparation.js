import {assertModelProfileContract,modelProfileDigest,modelProfileRequestError as fail} from './contracts.js';

export function createModelProfilePreparation({service,platform,lifecycleProvider=null,contextBaseUrl,operatorBindings,fetchImpl=globalThis.fetch,clock=()=>new Date()}) {
  const base=new URL(contextBaseUrl);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw fail('preparation_configuration_invalid','The accepted context service is not configured.',503);
  const bind=({callerId,operatorId})=>{if(!operatorBindings[callerId]||operatorBindings[callerId]!==operatorId)throw fail('operator_binding_invalid','The caller is not bound to this operator.',403);};
  async function options(auth){bind(auth);try{return assertModelProfileContract('options.schema.json',await platform.profileRequestOptions({operatorId:auth.operatorId}));}catch{throw fail('workflow_setup_unavailable','Registered workflow setup could not be read. Retry when the owner connection is available.',503);}}
  async function original(auth,input,correlation){
    try{
      const result=await service.get({callerId:auth.callerId,requestId:input.request_id});
      if(result.request.operator_id!==auth.operatorId||result.request.intent!=='create'||result.request.correlation_id!==correlation)throw fail('idempotency_conflict','This original request has different input. Recover it before another submission.',409);
      return result;
    }catch(error){if(error.code==='model_profile_request_not_found')return null;throw error;}
  }
  async function admit(input,auth){
    const content=JSON.stringify({request_id:input.request_id,operator_id:auth.operatorId,workflow_id:input.workflow_id,setup_digest:input.setup_digest,display_name:input.display_name,intended_purpose:input.intended_purpose,requested_environment:input.requested_environment,input_data_classification:input.input_data_classification,operator_justification:input.operator_justification,additional_expectations:input.additional_expectations});
    let value;
    try{
      const response=await fetchImpl(new URL('/v1/context/admissions',base),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({content,source_label:'model-profile-request:'+input.request_id,profile:'developer',budget_tokens:4000}),signal:AbortSignal.timeout(8000)});
      const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.byteLength;if(size>1048576)throw Error('oversized');chunks.push(chunk);}
      value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!response.ok)throw Error('unavailable');
    }catch{throw fail('context_preparation_unavailable','The context service could not prepare this request. No profile request was submitted.',503);}
    if(typeof value.artifact_id!=='string'||!/^artifact-[A-Za-z0-9._-]{1,200}$/.test(value.artifact_id)||!/^sha256:[0-9a-f]{64}$/.test(value.artifact_digest??'')||value.admission_decision?.raw_projection!=='denied'||value.admission_decision?.redaction_safe!==true)throw fail('context_preparation_unverified','The context service did not return a verified safe context reference.',502);
    return {uri:new URL('/v1/context/packets/'+value.artifact_id,base).toString(),digest:value.artifact_digest};
  }
  async function submit({callerId,operatorId,input}){
    const auth={callerId,operatorId};bind(auth);assertModelProfileContract('prepared.schema.json',input);
    const correlation='model-profile-prepared:'+modelProfileDigest(input).slice(7);
    let result=await original(auth,input,correlation);
    if(!result){
    if(input.changes&&!lifecycleProvider)throw fail('lifecycle_not_configured','Operating-policy changes require the commissioned profile lifecycle. No request was created.',503);
      const catalogue=await options(auth),setup=catalogue.workflows.find(row=>row.workflow_id===input.workflow_id);
      if(!setup)throw fail('workflow_setup_missing','This workflow has no recorded profile setup. Refresh the workflow list or complete its integration setup.',409);
      if(setup.setup_digest!==input.setup_digest)throw fail('workflow_setup_changed','The workflow setup changed. Refresh it and review the current settings before submitting.',409);
      if(!setup.environments.includes(input.requested_environment))throw fail('environment_not_available','The selected environment is not available for this workflow.',409);
      const rules=[...new Set([...setup.operational_expectations,...input.additional_expectations])];
      if(rules.length>20)throw fail("expectations_limit","This workflow allows at most 20 operating rules including its registered rules.",400);
      let lifecycleContext=null;
      if(lifecycleProvider){
        const prepared=await lifecycleProvider.prepareModelProfile({request_id:input.request_id,intent:'create',profile_id:input.workflow_id.split('/')[0],environment:input.requested_environment,changes:{...(input.changes??{}),display_name:input.display_name}});
        if(!prepared?.candidate||modelProfileDigest(prepared.profile_setup.registered_callers)!==modelProfileDigest(setup.registered_callers)||prepared.profile_setup.required_output_schema_ref.repo!==setup.output_schema_ref.repo||prepared.profile_setup.required_output_schema_ref.path!==setup.output_schema_ref.path)throw fail('workflow_setup_changed','The authoritative policy setup changed. Refresh and review the workflow.',409);
        lifecycleContext={selection:{request_id:input.request_id,intent:'create',profile_id:input.workflow_id.split('/')[0],environment:input.requested_environment,changes:{...(input.changes??{}),display_name:input.display_name}},candidate:prepared.candidate,candidate_digest:prepared.candidate.candidate_digest,preparation_digest:prepared.preparation_digest,review:{profile_id:prepared.candidate.profile_id,source_version:prepared.candidate.expected_sources.source_version,current_state:prepared.current_state,result_state:prepared.result_state,affected_workflows:prepared.affected_workflows,policy_changes:prepared.policy_changes??[]}};
      }
      const context=await admit(input,auth);
      const request={schema_version:1,request_id:input.request_id,intent:'create',requested_at:clock().toISOString(),operator_id:operatorId,
        profile_intent:{profile_id:null,source:null,display_name:input.display_name,intended_purpose:input.intended_purpose,requesting_owner:setup.requesting_owner,registered_callers:setup.registered_callers,requested_environments:[input.requested_environment],input_data_classification:input.input_data_classification,admitted_context_ref:context,required_output_schema_ref:setup.output_schema_ref,human_approval_required:true,operational_expectations:rules,operator_justification:input.operator_justification},
        delivery_ref:null,correlation_id:correlation,causation_id:null,idempotency_key:input.request_id+':create:v1'};
      try{result=await service.create({...auth,input:request,lifecycleContext});}
      catch(error){if(error.code!=='model_profile_request_idempotency_conflict')throw error;result=await original(auth,input,correlation);if(!result)throw error;}
    }
    if(result.review_state!=='draft')return result;
    try{return await service.command({...auth,requestId:input.request_id,input:{schema_version:1,command_id:input.request_id.replace('model-profile-request:','model-profile-command:')+':submit',request_id:input.request_id,expected_revision:result.revision,action:'submit',operator_id:operatorId,issued_at:clock().toISOString(),reason:null,decision_ref:null,requirements:[],revised_profile_intent:null,idempotency_key:input.request_id+':submit:v1'}});}
    catch(error){if(error.code!=='model_profile_request_revision_conflict'&&error.code!=='model_profile_request_idempotency_conflict')throw error;const current=await original(auth,input,correlation);if(current&&current.review_state!=='draft')return current;throw error;}
  }
  return {options,submit,admit};
}
