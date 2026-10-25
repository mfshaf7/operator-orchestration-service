import { readFileSync } from 'node:fs';
const ref=name=>({$ref:`#/components/schemas/${name}`});
const closed=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'};
const digest={type:'string',pattern:'^sha256:[0-9a-f]{64}$'};
const nullable=s=>({oneOf:[s,{type:'null'}]});
const command=JSON.parse(readFileSync(new URL('../contracts/delivery-art-work-session/operator-source-draft.schema.json',import.meta.url),'utf8'));
delete command.$id;delete command.$schema;
function fixRefs(v){if(!v||typeof v!=='object')return;if(typeof v.$ref==='string'&&v.$ref.startsWith('#/$defs/'))v.$ref=`#/components/schemas/OperatorSourceDraftCommand/$defs/${v.$ref.slice(8)}`;for(const c of Object.values(v))fixRefs(c);}
fixRefs(command);
const provenance=closed({origin:{enum:['operator','operator-amended-model']},input_origin:{enum:['manual','import']},operator_id:id,command_id:id,amended_at:{type:'string',format:'date-time'},
  previous_draft_ref:nullable({oneOf:[{type:'string',pattern:'^draft-history-[a-f0-9]{64}\\.json$'},closed({request_id:id,digest})]}),
  previous_draft_digest:nullable(digest),original_model:nullable({type:'object',description:'Original owner-validated model metadata is lineage only; it does not attest operator-edited bytes.'})});
const file=closed({path:{type:'string',maxLength:240},content:{type:'string',maxLength:65536},content_digest:digest,size_bytes:{type:'integer',minimum:0,maximum:65536}});
export const sourceEditorSchemas={
  OperatorSourceDraftCommand:command,
  OperatorSourceDraftProvenance:provenance,
  OperatorSourceDraftRequestSummary:closed({kind:{const:'operator'},command_id:id,execution_id:id,objective:{type:'string',minLength:8,maxLength:16384}}),
  SourceEditorFiles:closed({schema_version:{const:1},session_id:id,owner_repo:{type:'string',minLength:1},landing_unit_id:id,
    head_commit:{type:'string',pattern:'^[a-f0-9]{40}$'},clean:{const:true},
    tree:closed({paths:{type:'array',maxItems:5000,items:{type:'string',maxLength:240}},total_path_count:{type:'integer',minimum:0},truncated:{type:'boolean'}}),
    files:{type:'array',maxItems:48,items:file},admitted_bytes:{type:'integer',minimum:0,maximum:262144},context_digest:digest}),
  DeliveryArtSourceDraft:closed({schema_version:{const:1},workflow_id:{const:'delivery-art-source-draft'},session_id:id,revision:{type:'string',format:'date-time'},digest,
    change_set:ref('PrototypeSourceChangeSet'),accepted:{type:'boolean'},operator_draft:nullable(ref('OperatorSourceDraftProvenance'))}),
};
const bearer={security:[{CallerIdHeader:[],CallerSecretHeader:[]}],tags:['Source Authoring'],
  'x-oos-owner':'operator-orchestration-service','x-oos-primary-caller':'governance-operations-console',
  'x-oos-surface':'operator-facing','x-oos-workflow-family':'source-authoring'};
const AT='2026-10-25T00:00:00Z',SHA='sha256:'+'a'.repeat(64),BASE='a'.repeat(40);
const exampleChange={schema_version:1,change_set_id:'operator-change:sample',session_id:'source-session:sample',base_commit:BASE,objective_digest:SHA,
  commit_message:'feat: update example source',operations:[{action:'create',path:'app/example.js',content:'export const example = true;\n',expected_digest:null}]};
const exampleCommand={schema_version:1,command_id:'save:sample',execution_id:'execution:sample',expected_revision:AT,expected_change_set_digest:null,
  requested_at:AT,objective:'Author a small synthetic example application.',input_origin:'manual',retry_of:null,commit_message:exampleChange.commit_message,operations:exampleChange.operations};
function example(name){
  if(name==='SourceEditorFiles')return{schema_version:1,session_id:'source-session:sample',owner_repo:'example-owner',landing_unit_id:'source-sample',head_commit:BASE,clean:true,
    tree:{paths:['app/example.js'],total_path_count:1,truncated:false},files:[],admitted_bytes:0,context_digest:SHA};
  if(name==='DeliveryArtSourceDraft')return{schema_version:1,workflow_id:'delivery-art-source-draft',session_id:'source-session:sample',revision:AT,digest:SHA,change_set:exampleChange,accepted:false,operator_draft:null};
  const prototype=name==='PrototypeSourceRealization';
  return{schema_version:1,workflow_id:prototype?'prototype-source-realization':'delivery-art-source-realization',session_id:'source-session:sample',
    ...(prototype?{}:{work_item_id:'work-item-42'}),revision:AT,state:'draft-ready',replayed:false,next_action:{code:'source-acceptance-required',authority:'operator-orchestration-service',reason:'Review and accept the exact saved draft.'},
    attempt:{request:{kind:'operator',command_id:'save:sample',execution_id:'execution:sample',objective:exampleCommand.objective},request_id:'save:sample',execution_id:'execution:sample',retry_of:null,state:'draft-ready',requested_at:AT,completed_at:AT,objective_digest:SHA,context:null,model:null,
      change_set:{digest:SHA,change_set_id:exampleChange.change_set_id,commit_message:exampleChange.commit_message,operations:[{action:'create',path:'app/example.js',expected_digest:null,content_digest:SHA}]},source_receipt:null,failure:null}};
}
function responses(name){
  const result={'200':{description:'Caller-bound private source state; inert text only. Documentation examples are not operating evidence.',content:{'application/json':{schema:ref(name),example:example(name)}}}};
  for(const [status,description]of Object.entries({'400':'Invalid bounded source input.','401':'Authentication required.','403':'Caller/operator or owner scope is not authorized.','404':'No retained source draft exists.','409':'Source session/base/revision/digest or lifecycle conflicts.','413':'Existing source/file/wire budget exceeded.','502':'The isolated source owner returned invalid output.','503':'The source owner is unavailable.'}))result[status]={description,content:{'application/json':{schema:ref('ErrorResponse'),example:{error:'source_owner_rejected',message:description,details:null}}}};
  return result;
}
export function sourceEditorPaths(){
  const paths={};
  for(const kind of ['prototype','delivery']){
    const prototype=kind==='prototype',param=prototype?'request_id':'work_item_id';
    const base=prototype?'/v1/prototype-source-requests/{request_id}':'/v1/delivery-work-items/{work_item_id}/work-session/realization';
    const parameters=[{name:param,in:'path',required:true,schema:id},...(!prototype?[{name:'x-oos-operator-id',in:'header',required:true,schema:{type:'string',minLength:1},description:'Accountable operator admitted for this authenticated caller.'}]:[])];
    const prefix=prototype?'prototypeSource':'deliveryArtSource';
    const surface={...bearer,tags:[prototype?'Prototype Source Authoring':'Delivery ART'],'x-oos-workflow-family':prototype?'prototype-source-authoring':'delivery-art-source-realization'};
    paths[base+'/files']={get:{...surface,operationId:prefix+'EditorFiles',summary:'Inspect bounded exact-base source files',
      description:'Reads only this authenticated owner session. With no path selectors return its bounded file tree and no source bytes; select at most48 distinct paths for text. No credential renewal, model invocation or source mutation.',
      parameters:[...parameters,{name:'path',in:'query',required:false,style:'form',explode:true,schema:{type:'array',maxItems:48,uniqueItems:true,items:{type:'string',minLength:1,maxLength:240}}}],responses:responses('SourceEditorFiles')}};
    const properties={realization:ref('OperatorSourceDraftCommand')};
    paths[base+'/draft']={post:{...surface,operationId:prefix+'SaveOperatorDraft',summary:'Save a private operator-authored source draft',
      description:'Retain manual/imported text or an operator amendment of a model proposal. Identity, base, scope, expected revision/digest and original-command replay are owner-bound. Save neither invokes a model nor accepts/applies/commits source; trusted owner preparations remain read-only.',parameters,
      requestBody:{required:true,description:'Exact immutable save command and optimistic source revision/digest. Retain the original command for lost-response recovery.',content:{'application/json':{schema:prototype?ref('OperatorSourceDraftCommand'):closed(properties),example:prototype?exampleCommand:{realization:exampleCommand}}}},responses:responses(prototype?'PrototypeSourceRealization':'DeliveryArtSourceRealizationProjectionV1')}};
    if(!prototype)paths[base+'/draft'].get={...surface,operationId:prefix+'ReadOperatorDraft',summary:'Inspect the exact private retained source draft',description:'Caller-bound inert text for review; this read never accepts, applies or invokes a model.',parameters,responses:responses('DeliveryArtSourceDraft')};
  }
  return paths;
}
export function mergeSourceEditorPaths(paths, kind){for(const [route,part]of Object.entries(sourceEditorPaths())){if((kind === "prototype") !== route.startsWith("/v1/prototype-source-requests"))continue;paths[route]={...(paths[route]??{}),...part};}}
