import {assertModelProfileLifecycleContract,modelProfileDigest,modelProfileRequestError as fail} from './contracts.js';

export function reviewDecision(input,{callerId,operatorId,requestId}) {
  assertModelProfileLifecycleContract('reviewDecisionCommand',input);
  if(!['approve','reject'].includes(input?.action)||input.decision_ref!==null||input.request_id!==requestId||input.operator_id!==operatorId||typeof input.reason!=='string'||!input.reason.trim())throw fail('review_decision_invalid','Choose an explicit review decision and explain it.',400);
  const decision={schema_version:1,artifact_type:'model-profile-review-decision',command_id:input.command_id,request_id:requestId,request_revision:input.expected_revision,caller_id:callerId,operator_id:operatorId,decision:input.action,reason:input.reason,recorded_at:input.issued_at};
  const digest=modelProfileDigest(decision);return{...decision,digest};
}
export function decisionReference(decision){return{uri:'oos://model-profile-requests/'+encodeURIComponent(decision.request_id)+'/decisions/'+encodeURIComponent(decision.digest),digest:decision.digest};}
