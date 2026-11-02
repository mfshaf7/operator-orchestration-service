import {readFileSync,writeFileSync} from "node:fs";
import {upsertOpenApiComponent,upsertOpenApiPath} from "./openapi_component_sync_tools.mjs";
import {canonicalDigest} from "../src/delivery-art/canonical-json.js";
const target = new URL("../docs/api/openapi.json",import.meta.url);
const original = readFileSync(target,"utf8");
let source = original;
const ref = name => ({$ref:`#/components/schemas/${name}`});
const text = {type:"string",minLength:1,maxLength:4096};
const slug = {type:"string",pattern:"^[a-z0-9]+(?:-[a-z0-9]+)*$",maxLength:128};
const timestamp = {type:"string",format:"date-time"};
const digest = {type:"string",pattern:"^sha256:[a-f0-9]{64}$"};
const revision = {type:"string",pattern:"^[a-f0-9]{40}$"};
const registry = {type:"string",pattern:"^registry:[a-f0-9]{40}$"};
const nullable = schema => ({oneOf:[schema,{type:"null"}]});
const array = (items,maxItems=128) => ({type:"array",items,maxItems});
const object = properties => ({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const lifecycle = {enum:["proposed","build-admitted","active","suspended","retired"]};
const lane = {enum:["prototype-devint","integration-devint","governed-devint"]};
const models = {enum:["disposable","persistent"]};
const requestId = {type:"string",pattern:"^devint-request:[A-Za-z0-9._:-]+$",maxLength:128};
const sourceRef = {type:"string",minLength:1,maxLength:4096};
const page = object({offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:25},
  total:{type:"integer",minimum:0},next_offset:nullable({type:"integer",minimum:1})});
const persistence = object({justification:text,retainedDataScope:text,suspendResumeSemantics:text,storageRequirement:text,
  destructiveResetSemantics:text,cutoverPlan:{type:"string",maxLength:4000},sharedSmokeMutationMode:{const:"read-only"},disposableCompanionProfileId:nullable(slug)});
const intent = object({profileId:slug,ownerRepo:slug,purpose:{...text,maxLength:4000},laneClass:lane,
  participatingRepos:{...array(slug),minItems:1,uniqueItems:true},runtimePlatform:{...text,maxLength:128},runtimeStateModel:models,
  dependencies:{...array({...text,maxLength:512}),uniqueItems:true},expectedWrites:object({classification:{enum:["none","prototype-local","canonical-backend","external-sandbox"]},targets:{...array({...text,maxLength:512}),uniqueItems:true}}),
  securityTriggers:{...array({enum:["identity","secrets","runtime-privilege","ai-review"]}),uniqueItems:true},persistence:nullable(persistence),replacesProfileId:nullable(slug)});
const request = object({request_id:requestId,expected_source_version:registry,request:ref("DevIntegrationProfileIntent"),approval:object({decision:{const:"approved"},intent_digest:digest})});
const receipt = object({request_ref:sourceRef,request_id:requestId,intent_digest:digest,operator_id:text,recorded_at:timestamp,outcome:{const:"request-recorded"},digest});
const admission = object({state:{enum:["not-checked","unavailable","not-registered","registered","different-request"]},
  lifecycle:nullable(lifecycle),source_version:nullable(registry),observed_at:nullable(timestamp),profile_ref:nullable(sourceRef)});
const record = object({schema_version:{const:1},workflow_id:{const:"dev-integration-profile-request"},request_id:requestId,
  request:ref("DevIntegrationProfileIntent"),expected_source_version:registry,intent_digest:digest,operator_id:text,state:{const:"recorded"},
  created_at:timestamp,updated_at:timestamp,request_ref:sourceRef,receipt:ref("DevIntegrationRecordingReceipt"),admission:ref("DevIntegrationAdmissionReadback"),
  readback:{const:"current"},next_action:object({code:text,owner:text,reason:text})});
const ownerProfile = object({profile_id:slug,owner_repo:slug,lifecycle,lane_class:lane,purpose:nullable(text),participating_repos:array(slug),dependencies:array(text),request_record_ref:nullable(sourceRef),
  runtime:object({platform:nullable(text),state_model:nullable(models),observation:object({state:{enum:["unknown","running","stopped","starting","stopping","degraded","failed","unavailable"]},observed_at:nullable(timestamp),source_ref:nullable(sourceRef)})}),
  expected_writes:nullable(object({classification:{enum:["none","prototype-local","canonical-backend","external-sandbox"]},targets:array(text)})),
  persistence:nullable(object({justification:nullable(text),retained_data_scope:nullable(text),suspend_resume_semantics:nullable(text),storage_size_or_class:nullable(text),reset_semantics:nullable(text),cutover_plan:nullable(text)})),
  security_owner:nullable(text),security_triggers:nullable(array({enum:["identity","secrets","runtime-privilege","ai-review"]})),admission_refs:array(sourceRef),
  source:object({ref:sourceRef,registry_revision:revision,owner_revision:nullable(revision)}),
  stage_handoff:object({owner_repo:nullable(text),governed_surface:nullable(text),required_checks:array(object({id:{...text,maxLength:128},label:{...text,maxLength:1024}})),
    result:{const:"unknown"},check_results:{type:"array",maxItems:0,items:{type:"object",additionalProperties:false}},
    smoke_summary_ref:nullable(sourceRef),session_manifest_ref:nullable(sourceRef),promotion_report_ref:nullable(sourceRef)}),gaps:array(text)});
const projection = object({schema_version:{const:1},source_version:registry,observed_at:timestamp,
  owner_versions:{type:"object",additionalProperties:nullable(revision)},profiles:array(ref("DevIntegrationOwnerProfile"),25),
  request_options:object({owner_repos:array(slug),lane_classes:array(lane),runtime_platforms:array(text),state_models:array(models)}),page:ref("DevIntegrationPage")});
const schemas = {DevIntegrationPage:page,DevIntegrationProfileIntent:intent,DevIntegrationProfileRequest:request,
  DevIntegrationRecordingReceipt:receipt,DevIntegrationAdmissionReadback:admission,DevIntegrationProfileRequestRecord:record,
  DevIntegrationOwnerProfile:ownerProfile,DevIntegrationProfileProjection:projection,
  DevIntegrationProfileRequestList:object({schema_version:{const:1},requests:array(ref("DevIntegrationProfileRequestRecord"),25),page:ref("DevIntegrationPage")})};
for(const [name,schema] of Object.entries(schemas))source=upsertOpenApiComponent(source,name,schema);
const now="2026-11-02T00:00:00.000Z";
const requestExample={request_id:"devint-request:example",expected_source_version:`registry:${"a".repeat(40)}`,
  request:{profileId:"example-runtime",ownerRepo:"platform-engineering",purpose:"An isolated integration runtime.",laneClass:"integration-devint",participatingRepos:["platform-engineering"],runtimePlatform:"local-k3s",runtimeStateModel:"disposable",dependencies:[],expectedWrites:{classification:"none",targets:[]},securityTriggers:[],persistence:null,replacesProfileId:null}};
const intentDigest=canonicalDigest(requestExample);
const claims={request_ref:`oos://dev-integration/requests/${requestExample.request_id}`,request_id:requestExample.request_id,intent_digest:intentDigest,operator_id:"operator:workspace-owner",recorded_at:now,outcome:"request-recorded"};
const recordExample={schema_version:1,workflow_id:"dev-integration-profile-request",...requestExample,intent_digest:intentDigest,operator_id:claims.operator_id,state:"recorded",created_at:now,updated_at:now,
  request_ref:claims.request_ref,receipt:{...claims,digest:canonicalDigest(claims)},admission:{state:"not-checked",lifecycle:null,source_version:null,observed_at:null,profile_ref:null},readback:"current",
  next_action:{code:"review-profile-request",owner:"platform-engineering",reason:"Request recorded for owner review. Admission and runtime launch remain separate."}};
const pageExample={offset:0,limit:20,total:0,next_offset:null};
const projectionExample={schema_version:1,source_version:requestExample.expected_source_version,observed_at:now,owner_versions:{},profiles:[],
  request_options:{owner_repos:["platform-engineering"],lane_classes:["integration-devint"],runtime_platforms:["local-k3s"],state_models:["disposable","persistent"]},page:pageExample};
const parameter=(name,location,schema,required=false)=>({name,in:location,required,schema});
const errors=Object.fromEntries([["400","ValidationError"],["401","UnauthorizedError"],["403","ForbiddenError"],["404","NotFoundError"],["409","ConflictError"]].map(([status,name])=>[status,{$ref:`#/components/responses/${name}`} ]));
const response=(name,example)=>({description:"Bounded owner readback; recording does not grant admission or runtime authority.",content:{"application/json":{schema:ref(name),example}}});
function operation(id,summary,name,example,{body,parameters=[]}={}) {
  return {operationId:id,tags:["Platform Operations"],summary,description:"Authenticated native Dev Integration workflow. Source staged; exact reviewed runtime commissioning is required.",
    security:[{CallerIdHeader:[],CallerSecretHeader:[]}],parameters,
    ...(body?{requestBody:{required:true,description:"Submit the exact reviewed profile intent, stable original request identity and explicit approval. OOS derives actor, time and durable request ownership; this does not admit or launch the profile.",content:{"application/json":{schema:ref("DevIntegrationProfileRequest"),example:{...requestExample,approval:{decision:"approved",intent_digest:intentDigest}}}}}}:{}),
    responses:{[body?"201":"200"]:response(name,example),...errors,"503":{description:"The reviewed integration, source or request store is unavailable.",content:{"application/json":{schema:ref("ErrorResponse"),example:{error:"dev_integration_not_configured",message:"The reviewed profile integration is not enabled.",details:null}}}}},
    "x-oos-owner":"operator-orchestration-service","x-oos-primary-caller":"governance-operations-console","x-oos-surface":"operator-facing","x-oos-workflow-family":"platform-operation"};
}
const pagination=[parameter("offset","query",{type:"integer",minimum:0}),parameter("limit","query",{type:"integer",minimum:1,maximum:25})];
const paths={
  "/v1/dev-integration/profiles":{get:operation("listDevIntegrationProfiles","Read canonical integration profiles without runtime probes","DevIntegrationProfileProjection",projectionExample,{parameters:[...pagination,...["q","owner","lane","lifecycle","profile_id"].map(name=>parameter(name,"query",{type:"string",maxLength:200}))]})},
  "/v1/dev-integration/profiles/{profile_id}":{get:operation("readDevIntegrationProfile","Read one exact owner profile","DevIntegrationProfileProjection",projectionExample,{parameters:[parameter("profile_id","path",slug,true)]})},
  "/v1/dev-integration/requests":{get:operation("listDevIntegrationRequests","Read caller-bound native request history","DevIntegrationProfileRequestList",{schema_version:1,requests:[],page:pageExample},{parameters:pagination}),
    post:operation("recordDevIntegrationRequest","Record or replay one native profile request","DevIntegrationProfileRequestRecord",recordExample,{body:true})},
  "/v1/dev-integration/requests/{request_id}":{get:operation("readDevIntegrationRequest","Recover an original native request and independent admission readback","DevIntegrationProfileRequestRecord",recordExample,{parameters:[parameter("request_id","path",requestId,true)]})},
};
for(const [route,item] of Object.entries(paths))source=upsertOpenApiPath(source,route,item);
if(process.argv.includes("--check")){if(source!==original)throw new Error("Dev Integration OpenAPI is out of sync.");}
else writeFileSync(target,source);
