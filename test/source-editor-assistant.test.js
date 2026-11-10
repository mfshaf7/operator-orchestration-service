import test from "node:test";
import assert from "node:assert/strict";
import {createEditorAssistant,assertEditorAssistantRequest,assertEditorAssistantOutput,editorContext} from "../src/source-authoring/editor-assistant.js";
const hash="sha256:"+"a".repeat(64),at="2026-11-09T00:00:00.000Z";
const fail=(code,message,{statusCode=409}={})=>Object.assign(Error(message),{code,statusCode});
function fixture({mode="ask",scope=null}={}){
 const state={revision:at,state:"draft-ready",draftDigest:hash,sessionId:"session:example",base:"b".repeat(40),objectiveDigest:hash,operatorId:"operator:example",profileId:scope?"prototype-source-authoring-v1":"source-realization-v1",modelCaller:scope?"operator-orchestration-service/prototype-source-authoring":"operator-orchestration-service/source-realization",workflow:"source-authoring",scope};
 const path=scope?scope.source_root+"/app.ts":"src/app.ts";
 const request={schema_version:1,request_id:"assistant:one",snapshot_id:"snapshot:one",expected_revision:at,expected_change_set_digest:hash,mode,prompt:"Explain this selected file",conversation:[],files:[{path,content:"unsaved operator content",expected_digest:hash}]};
 const artifacts=new Map(),calls=[];
 let source={session_id:state.sessionId,head_commit:state.base,clean:true,tree:{paths:[path],truncated:false},files:[{path,content_digest:hash}],context_digest:hash};
 let context={content:"admitted and redacted",packet_ref:"/v1/context/packets/example",redaction_receipt_ref:"/v1/context/receipts/example",projection_receipt_ref:"/v1/context/lifecycle/projections/example",artifact_digest:hash,budget:{truncated:false}};
 let reply={message:"Explanation",edits:[]},during=()=>{};
 const assist=createEditorAssistant({enabled:true,fail,binding:async()=>({...state}),withLock:(_,operation)=>operation(),readArtifact:(_,key)=>artifacts.get(key)??null,writeArtifact:(_,key,value)=>artifacts.set(key,structuredClone(value)),capture:async()=>source,
  projectContext:async()=>context,gatewayClient:{invoke:async input=>{calls.push(input);during();return{policy_decision:"allow",policy_status:"active",profile_id:state.profileId,decision_id:request.request_id,caller_id:state.modelCaller,invocation_path:"governed-ai-gateway",audit_ref:"audit:one",binding_selection_ref:"binding:one",task:{kind:"source_editor_assistance",contract_ref:"oos.source-editor-assistance.v1",version:"1.0"},generated_at:new Date().toISOString(),output:reply};}}});
 return {state,request,artifacts,calls,run:()=>assist({input:request}),setSource:value=>source=value,get source(){return source;},setContext:value=>context=value,get context(){return context;},setReply:value=>reply=value,setDuring:value=>during=value};
}
for(const scope of [null,{source_root:"prototypes/example",design_profile:"docs/prototypes/example/design-profile.md"}])test(`assistant retains reply, source profile and explicit original replay: ${scope?'Prototype':'Delivery'}`,async()=>{
 const h=fixture({scope}),before=structuredClone(h.state),result=await h.run();assert.equal(result.message,"Explanation");assert.deepEqual(h.state,before);assert.equal(h.calls[0].profile_id,h.state.profileId);assert.equal(h.calls[0].task.kind,"source_editor_assistance");assert.equal(h.calls[0].caller_identity.caller_workflow,h.state.modelCaller.split("/")[1]);assert.equal(h.calls[0].input.model_safe_packet.content,"admitted and redacted");assert.equal((await h.run()).replayed,true);assert.equal(h.calls.length,1);
 h.request.prompt="Different prompt";await assert.rejects(h.run(),{code:"assistant_replay_conflict"});
});
test("questions cannot carry edits; proposals cannot escape selected files",async()=>{
 const h=fixture();h.setReply({message:"Unexpected edit",edits:[{path:h.request.files[0].path,content:"replacement"}]});await assert.rejects(h.run(),{code:"assistant_output_invalid"});
 h.request.mode="edit";h.request.request_id="assistant:two";h.setSource({...h.source,tree:{paths:[h.request.files[0].path,"src/other.ts"],truncated:false}});h.setReply({message:"Out of scope",edits:[{path:"src/other.ts",content:"replacement"}]});await assert.rejects(h.run(),{code:"assistant_output_invalid"});
});
test("source conflicts and applying state stop before context/model dispatch",async()=>{
 for(const mutation of [h=>h.state.revision="2026-11-09T00:00:01Z",h=>h.state.state="apply-unknown",h=>h.state.draftDigest=null]){const h=fixture();mutation(h);await assert.rejects(h.run(),{code:"assistant_source_changed"});assert.equal(h.calls.length,0);}
});
test("new files require proven absence; existing files require actual baseline digest",async()=>{
 const h=fixture();h.request.files[0].expected_digest=null;await assert.rejects(h.run(),{code:"assistant_baseline_changed"});h.setSource({...h.source,tree:{paths:[],truncated:true}});await assert.rejects(h.run(),{code:"assistant_baseline_changed"});
 const i=fixture();i.setSource({...i.source,files:[]});await assert.rejects(i.run(),{code:"assistant_baseline_changed"});assert.equal(i.calls.length,0);
});
test("unsafe, credential and owner-control paths never enter model context",()=>{
 for(const path of ["../other.ts","/tmp/app.ts","src/.env","src/credentials.json","src/.github/workflows/ci.yml","src/AGENTS.md"]){const h=fixture();h.request.files[0].path=path;assert.throws(()=>assertEditorAssistantRequest(h.request,fail),{code:"assistant_input_invalid"});}
});
test("Prototype context cannot include a sibling project",async()=>{
 const h=fixture({scope:{source_root:"prototypes/example",design_profile:"docs/prototypes/example/design-profile.md"}});h.request.files[0].path="prototypes/other/app.ts";await assert.rejects(h.run(),{code:"assistant_scope_denied"});assert.equal(h.calls.length,0);
});
test("truncated CGG admission fails without raw-context fallback",async()=>{
 const h=fixture();h.setContext({...h.context,budget:{truncated:true}});await assert.rejects(h.run(),{code:"assistant_context_unavailable"});assert.equal(h.calls.length,0);
});
test("source changes during inference cannot return a current proposal",async()=>{
 const h=fixture();h.setDuring(()=>h.state.revision="2026-11-09T00:00:02Z");await assert.rejects(h.run(),{code:"assistant_source_changed"});assert.equal([...h.artifacts.values()].filter(row=>row.result).length,0);
});
test("editor context identifies unsaved input and denies action authority",()=>{
 const h=fixture(),context=editorContext(h.request);assert.equal(context.files[0].content,"unsaved operator content");assert.equal(context.files[0].input_origin,"operator-selected-unsaved-buffer");assert.equal(context.authority.may_publish,false);assert.equal(context.authority.may_save,false);
});
test("whole-file proposals and explicit deletion remain inert output",()=>{
 const h=fixture({mode:"edit"});for(const content of ["replacement source",null])assert.equal(assertEditorAssistantOutput({message:"Proposed change",edits:[{path:h.request.files[0].path,content}]},h.request,fail).edits[0].content,content);
});

test("new files can be proposed inside the real source scope without pre-creating empty files",async()=>{
 const h=fixture({mode:"edit",scope:{source_root:"prototypes/example",design_profile:"docs/prototypes/example/design-profile.md"}});
 h.setReply({message:"Add a related component",edits:[{path:"prototypes/example/new.ts",content:"export const value = 1;\n"}]});
 const result=await h.run();assert.deepEqual(result.created_paths,["prototypes/example/new.ts"]);assert.equal(h.state.revision,at);
 const other=fixture({mode:"edit",scope:h.state.scope});other.setReply({message:"Wrong project",edits:[{path:"prototypes/other/new.ts",content:"wrong"}]});await assert.rejects(other.run(),{code:"assistant_output_invalid"});
 const partial=fixture({mode:"edit"});partial.setSource({...partial.source,tree:{...partial.source.tree,truncated:true}});partial.setReply({message:"Unknown target",edits:[{path:"src/new.ts",content:"new"}]});await assert.rejects(partial.run(),{code:"assistant_output_invalid"});
});

test("Delivery projection labels unsaved buffers separately from baseline evidence",async()=>{
 const {buildDeliveryArtLifecycleSources}=await import("../src/delivery-art/lifecycle-context.js");
 const h=fixture();const sources=buildDeliveryArtLifecycleSources({session_id:h.state.sessionId,delivery_id:"delivery-1",session_revision:at,work_item_id:"work-item-1",source:{head_commit:h.state.base},state:"source-work",facts:{}},at,{sourceRealization:{objective:"Explain selected files",objective_digest:hash,repository_context:{...h.source,files:[{path:h.request.files[0].path,content:"baseline text must not be mistaken for unsaved text",content_digest:hash}]},editor_context:editorContext(h.request)}});
 const repository=JSON.parse(sources.find(source=>source.source_class==="repository").content).source_realization_context;
 assert.equal(repository.source_base.context_digest,h.source.context_digest);assert.equal(repository.baseline_files[0].content,undefined);assert.equal(repository.operator_editor_context.files[0].content,"unsaved operator content");assert.equal(repository.clean,undefined);
});
