import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  addConsoleSourceProjectionMedia,
  upsertConsoleCompatibleOpenApiPath,
} from "./console_source_authority_openapi_tools.mjs";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const original = readFileSync(openapiPath, "utf8");
let source = original;
const check = process.argv.includes("--check");
const componentNames = {
  "request.schema.json": "ModelProfileRequest",
  "options.schema.json": "ModelProfileRequestOptions",
  "prepared.schema.json": "ModelProfilePreparedRequest",
  "command.schema.json": "ModelProfileRequestCommand",
  "fulfillment.schema.json": "ModelProfileRequestFulfillment",
  "receipt.schema.json": "ModelProfileRequestReceipt",
  "projection.schema.json": "ModelProfileRequestProjection",
  "lifecycle.schema.json": "ModelProfileLifecycle",
};
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function project(value, currentName) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, currentName));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["$schema", "$id"].includes(key))
      .map(([key, entry]) => {
        if (key !== "$ref") return [key, project(entry, currentName)];
        if (entry.startsWith("#/$defs/")) {
          return [key, `#/components/schemas/${currentName}/$defs/${entry.slice(8)}`];
        }
        const [file, suffix] = entry.split("#");
        const target = componentNames[file];
        if (!target) throw new Error(`Unknown model-profile schema reference: ${entry}`);
        return [
          key,
          suffix?.startsWith("/$defs/")
            ? `#/components/schemas/${target}/$defs/${suffix.slice(7)}`
            : `#/components/schemas/${target}`,
        ];
      }),
  );
}

for (const [file, name] of Object.entries(componentNames)) {
  const schema = JSON.parse(readFileSync(
    new URL(`contracts/model-profile-request/${file}`, root),
    "utf8",
  ));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
source = upsertOpenApiComponent(source, "ModelProfileRequestList", {
  type: "object",
  required: ["schema_version", "requests", "next_cursor"],
  additionalProperties: false,
  properties: {
    schema_version: { const: 1 },
    requests: { type: "array", items: ref("ModelProfileRequestProjection") },
    next_cursor: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
});

source = upsertOpenApiComponent(source, "ModelProfileRequestSummaryPage", {
  type:"object",required:["schema_version","requests","next_cursor"],additionalProperties:false,
  properties:{schema_version:{const:1},next_cursor:{oneOf:[{type:"string"},{type:"null"}]},requests:{type:"array",maxItems:100,items:{
    type:"object",additionalProperties:false,required:["request_id","revision","display_name","requested_at","review_state","fulfillment_state","next_action"],
    properties:{request_id:{type:"string"},revision:{type:"integer",minimum:1},display_name:{type:"string",maxLength:160},requested_at:{type:"string",format:"date-time"},review_state:{type:"string",enum:["draft","submitted","under-review","changes-required","approved","rejected","withdrawn"]},fulfillment_state:{type:"string",enum:["not-started","implementing","applied","failed"]},next_action:{type:"string"}}
  }}}
});

const artifact = (name) => ({ uri: `https://example.test/${name}`, digest: `sha256:${"a".repeat(64)}` });
const requestExample = {
  schema_version: 1,
  request_id: "model-profile-request:1203-refinement",
  intent: "create",
  requested_at: "2026-10-09T12:00:00Z",
  operator_id: "operator:mfshaf7",
  profile_intent: {
    profile_id: null,
    source: null,
    display_name: "Bounded refinement assistant",
    intended_purpose: "Produce structured refinement suggestions from admitted context.",
    requesting_owner: "operator-orchestration-service",
    registered_callers: [{ caller_id: "oos-refinement", owner_repo: "operator-orchestration-service" }],
    requested_environments: ["dev-integration"],
    input_data_classification: "internal",
    admitted_context_ref: artifact("context-contract"),
    required_output_schema_ref: { repo: "operator-orchestration-service", path: "contracts/refinement/output.schema.json", version: "v1" },
    human_approval_required: true,
    operational_expectations: ["Fail closed when admitted context is absent."],
    operator_justification: "Needed for the governed refinement workflow.",
  },
  delivery_ref: "openproject://work_packages/1240",
  correlation_id: "delivery-1203",
  causation_id: null,
  idempotency_key: "model-profile-request-1203-refinement-v1",
};
const receiptExample = {
  schema_version: 1,
  receipt_id: "model-profile-receipt:aaaaaaaaaaaaaaaaaaaaaaaa",
  request_id: requestExample.request_id,
  request_revision: 1,
  intent: "create",
  review_state: "draft",
  fulfillment_state: "not-started",
  profile_id: null,
  actor: { caller_id: "governance-operations-console", operator_id: "operator:mfshaf7" },
  routed_owners: { workflow_owner: "operator-orchestration-service", fulfillment_owner: "platform-engineering", security_owner: "security-architecture" },
  delivery_ref: requestExample.delivery_ref,
  source_ref: null,
  prior_receipt_ref: null,
  recorded_at: "2026-10-09T12:00:00Z",
  digest: `sha256:${"b".repeat(64)}`,
};
const historyExample = {
  sequence: 1,
  event_type: "request-created",
  occurred_at: "2026-10-09T12:00:00Z",
  actor_id: "operator:mfshaf7",
  command_id: requestExample.idempotency_key,
  review_state_before: null,
  review_state_after: "draft",
  fulfillment_state_before: null,
  fulfillment_state_after: "not-started",
  summary: "Model-profile request recorded as a draft; no profile lifecycle state changed.",
  receipt_ref: { uri: `oos://model-profile-receipts/${receiptExample.receipt_id}`, digest: receiptExample.digest },
};
const projectionExample = {
  schema_version: 1,
  workflow_id: "model-profile-request",
  request_id: requestExample.request_id,
  revision: 1,
  request: requestExample,
  review_state: "draft",
  fulfillment_state: "not-started",
  requirements: [],
  decision_ref: null,
  fulfillment: null,
  latest_receipt: receiptExample,
  history: [historyExample],
  next_action: "revise-or-submit",
  profile_lifecycle_changed: false,
};
const commandExample = {
  schema_version: 1,
  command_id: "submit-1203-refinement",
  request_id: requestExample.request_id,
  expected_revision: 1,
  action: "submit",
  operator_id: "operator:mfshaf7",
  issued_at: "2026-10-09T12:01:00Z",
  reason: null,
  decision_ref: null,
  requirements: [],
  revised_profile_intent: null,
  idempotency_key: "submit-1203-refinement-v1",
};
const fulfillmentExample = {
  schema_version: 1,
  fulfillment_id: "platform-start-1203-refinement",
  request_id: requestExample.request_id,
  expected_revision: 4,
  state: "implementing",
  actor_id: "platform-engineering",
  recorded_at: "2026-10-09T12:04:00Z",
  source: null,
  receipt_ref: null,
  failure: null,
  idempotency_key: "platform-start-1203-refinement-v1",
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 500, 503].map((status) => [String(status), {
  description: "Bounded validation, authorization, conflict, integrity, or availability failure.",
}]));
const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const metadata = {
  "x-oos-primary-caller": "governance-operations-console",
  security,
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-surface": "model-profile-request",
  "x-oos-workflow-family": "model-profile-request",
  tags: ["Model Profile Requests"],
};
const requestId = { name: "request_id", in: "path", required: true, schema: { type: "string" } };
const response = (description, schema, example) => ({
  description,
  content: { "application/json": { schema, example } },
});
const requestBody = (description, schema, example) => ({
  required: true,
  description,
  content: { "application/json": { schema, example } },
});

const setupExample={workflow_id:"planning-v1/planning",setup_digest:artifact("setup").digest,label:"Planning assistant",purpose:"planning",requesting_owner:"operator-orchestration-service",registered_callers:[{caller_id:"operator-orchestration-service/planning",owner_repo:"operator-orchestration-service"}],environments:["dev-integration"],output_schema_ref:{repo:"platform-engineering",path:"security/schemas/planning.json",version:artifact("schema").digest},operational_expectations:["Use admitted context.","Require human review before activation."]};
const preparedExample={schema_version:1,request_id:"model-profile-request:prepared-example",workflow_id:setupExample.workflow_id,setup_digest:setupExample.setup_digest,display_name:"Planning support",intended_purpose:"Draft planning suggestions.",requested_environment:"dev-integration",input_data_classification:"internal",operator_justification:"This workflow needs bounded planning assistance.",additional_expectations:[]};
source = upsertOpenApiPath(source,"/v1/model-profile-requests/options",{get:{...metadata,"x-oos-primary-caller":"governance-operations-console",parameters:[{name:"x-oos-operator-id",in:"header",required:true,schema:{type:"string"}}],operationId:"modelProfileRequestOptions",summary:"Read registered workflow setup for a profile request",description:"Authenticated current Platform metadata only. Does not admit context, invoke a model, submit or approve a request.",responses:{200:response("Registered workflow choices",ref("ModelProfileRequestOptions"),{schema_version:1,workflows:[setupExample]}),...errors}}});
source = upsertOpenApiPath(source,"/v1/model-profile-requests/submit-prepared",{post:{...metadata,"x-oos-primary-caller":"governance-operations-console",parameters:[{name:"x-oos-operator-id",in:"header",required:true,schema:{type:"string"}}],operationId:"submitPreparedModelProfileRequest",summary:"Prepare and submit a profile request from operator choices",description:"Binds current owner setup and CGG admission, then uses the existing native draft/submit transitions. Exact original identity recovery; no profile activation, approval or model invocation.",requestBody:requestBody("Operator choices only",ref("ModelProfilePreparedRequest"),preparedExample),responses:{202:response("Native submitted request",ref("ModelProfileRequestProjection"),projectionExample),...errors}}});
source = upsertOpenApiPath(source, "/v1/model-profile-requests", {
  post: {
    ...metadata,
    operationId: "createModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Create or replay one governed model-profile request",
    description: "Records operator-authored intent and exact source bindings without selecting a provider or changing Platform profile lifecycle state.",
    parameters: [{ name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } }],
    requestBody: requestBody("Record one exact operator-bound request.", ref("ModelProfileRequest"), requestExample),
    responses: { 201: response("Request recorded.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
  get: {
    ...metadata,
    operationId: "listModelProfileRequests",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "List caller-owned model-profile requests",
    description: "Returns bounded caller-owned projections; it does not expose requests owned by another caller.",
    parameters: [
      { name: "cursor", in: "query", schema: { type: "string" } },
      { name: "view", in: "query", schema: { type: "string", enum: ["full", "summary"], default: "full" }, description: "Summary pages omit request context, receipts and event bodies; select the original request for current mutation evidence." },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
    ],
    responses: { 200: response("Caller-owned request projections or bounded summary page when view=summary.", {oneOf:[ref("ModelProfileRequestList"),ref("ModelProfileRequestSummaryPage")]}, { schema_version: 1, requests: [projectionExample], next_cursor: null }), ...errors },
  },
});

source = upsertConsoleCompatibleOpenApiPath(source, "/v1/model-profile-requests/{request_id}", addConsoleSourceProjectionMedia({
  get: {
    ...metadata,
    operationId: "getModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Read one caller-owned model-profile request",
    description: "Returns current review and fulfillment state, exact next action, immutable receipt coordinates, and an explicit no-lifecycle-mutation marker.",
    parameters: [requestId],
    responses: { 200: response("Current model-profile request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
}, "get"));

source = upsertOpenApiPath(source, "/v1/model-profile-requests/{request_id}/commands", {
  post: {
    ...metadata,
    operationId: "commandModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Apply one revision-bound review command",
    description: "Applies an admitted state transition with exact operator attribution, replay protection, and immutable receipt history.",
    parameters: [requestId, { name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } }],
    requestBody: requestBody("Apply one review command at the exact expected revision.", ref("ModelProfileRequestCommand"), commandExample),
    responses: { 200: response("Updated request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
});

source = upsertOpenApiPath(source, "/v1/model-profile-requests/{request_id}/fulfillment", {
  post: {
    ...metadata,
    operationId: "recordModelProfileRequestFulfillment",
    "x-oos-primary-caller": "platform-engineering",
    summary: "Record one Platform-owned fulfillment update",
    description: "Records implementation evidence from an explicitly admitted Platform caller after approval; it cannot mutate the Platform registry or profile lifecycle itself.",
    parameters: [requestId],
    requestBody: requestBody("Record a revision-bound Platform fulfillment update.", ref("ModelProfileRequestFulfillment"), fulfillmentExample),
    responses: { 200: response("Updated request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
});

const lifecycleRef=name=>({$ref:'#/components/schemas/ModelProfileLifecycle/$defs/'+name});
const operatorHeader={name:'x-oos-operator-id',in:'header',required:true,schema:{type:'string'}};
const lifecycleSelectionExample={request_id:'model-profile-request:policy-change',intent:'suspend',profile_id:'planning-v1',environment:'dev-integration',changes:{}};
const lifecycleExamples={selection:lifecycleSelectionExample,submission:{...lifecycleSelectionExample,preparation_digest:artifact('preparation').digest,display_name:'Planning support',intended_purpose:'Registered planning assistance.',input_data_classification:'internal',operator_justification:'Pause this profile for a policy review.'},reviewDecisionCommand:{...commandExample,action:'approve',reason:'Explicit operator acceptance of the reviewed request.',decision_ref:null}};
lifecycleExamples.revision={...lifecycleExamples.submission,expected_revision:4,command_id:'model-profile-command:policy-revision'};
for(const [path,operationId,summary,inputKind,status] of [
 ['/v1/model-profile-requests/lifecycle/prepare','prepareModelProfileLifecycle','Inspect exact source, policy effect and affected workflows','selection',200],
 ['/v1/model-profile-requests/lifecycle/revise','reviseModelProfileLifecycle','Reprepare and revise the same original policy request','revision',200],
 ['/v1/model-profile-requests/lifecycle/submit','submitModelProfileLifecycle','Submit an owner-prepared profile lifecycle request','submission',202],
 ['/v1/model-profile-requests/{request_id}/review-decisions','recordModelProfileReviewDecision','Atomically record a real explicit review artifact and decision','reviewDecisionCommand',200],
]){
 source=upsertOpenApiPath(source,path,{post:{...metadata,operationId,summary,description:'Explicit authenticated operator action using owner-derived source and policy. No AI invocation or automatic review decision. Lifecycle controls are default off until exact composition acceptance.','x-oos-primary-caller':'governance-operations-console',parameters:[...(path.includes('{request_id}')?[requestId]:[]),operatorHeader],requestBody:requestBody('Exact bounded operator input',lifecycleRef(inputKind),lifecycleExamples[inputKind]),responses:{[status]:response('Owner-confirmed result; approval is separate from source application and running activation.',path.endsWith('/prepare')?{type:'object',required:['preparation_digest','intent','profile_id','source_version','affected_workflows','result_state']}:ref('ModelProfileRequestProjection'),path.endsWith('/prepare')?{preparation_digest:artifact('preparation').digest,intent:'suspend',profile_id:'planning-v1',source_version:'a'.repeat(40),affected_workflows:['service/planning'],result_state:'suspended'}:projectionExample),...errors}}});
}
for(const [suffix,operationId,description] of [
 ['lifecycle','getModelProfileLifecycleContext','Read private owner preparation and Security acceptance. The distinct Platform fulfiller may read only approved requests; other callers remain owner-scoped.'],
 ['decisions/{digest}','getModelProfileDecision','Read an actually stored immutable decision artifact. Owner or approved distinct Platform fulfiller only.'],
])source=upsertOpenApiPath(source,'/v1/model-profile-requests/{request_id}/'+suffix,{get:{...metadata,operationId,summary:description,description,parameters:[requestId,...(suffix.includes('{digest}')?[{name:'digest',in:'path',required:true,schema:{type:'string'}}]:[])],responses:{200:response('Exact retained owner evidence',{type:'object'},suffix==='lifecycle'?{request:projectionExample,context:null,security_acceptance:null}:{artifact_type:'model-profile-review-decision',request_id:requestExample.request_id,decision:'approve',digest:artifact('decision').digest}),...errors}}});
for(const [suffix,component,label] of [['operation','control','Platform implementation'],['security-acceptance','securityAcceptance','Separate explicitly admitted Security acceptance']]){
 source=upsertOpenApiPath(source,'/v1/model-profile-requests/{request_id}/'+suffix,{
  get:{...metadata,operationId:'getModelProfile'+(suffix==='operation'?'Operation':'SecurityStatus'),summary:'Read '+label,description:'Read the original owner state without changing a review decision, source or runtime.',parameters:[requestId,operatorHeader],responses:{200:response('Current original owner state',{type:'object'},{request_id:requestExample.request_id}),...errors}},
  post:{...metadata,operationId:'controlModelProfile'+(suffix==='operation'?'Operation':'SecurityAcceptance'),summary:label,description:'Explicit caller/operator-bound action. Native source/runtime outcomes remain separate. Default off until exact accepted composition.',parameters:[requestId,operatorHeader],requestBody:requestBody('Revision or operation-bound explicit action',lifecycleRef(component),suffix==='operation'?{action:'implement',expected_operation_digest:null}:{command_id:'model-profile-security:example',expected_revision:3,reason:'Explicit acceptance of the exact candidate and source.'}),responses:{200:response('Original action result',{type:'object'},{request_id:requestExample.request_id}),...errors}}
 });
}

if (check) {
  if (source !== original) throw new Error("Model-profile request OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log(`Model-profile request OpenAPI ${check ? "verified" : "synchronized"}.`);
