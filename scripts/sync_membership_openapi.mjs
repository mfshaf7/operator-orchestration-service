import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {upsertOpenApiComponent,upsertOpenApiPath} from "./openapi_component_sync_tools.mjs";
const file=fileURLToPath(new URL("../docs/api/openapi.json",import.meta.url)),original=readFileSync(file,"utf8");
let source=original;
const ref=name=>({$ref:`#/components/schemas/DeliveryMembership${name}V1`});
const id={type:"integer",minimum:1},text={type:"string",minLength:1,maxLength:512},digest={type:"string",pattern:"^sha256:[a-f0-9]{64}$"};
const array=items=>({type:"array",items}),object=properties=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const nullable=schema=>({anyOf:[schema,{type:"null"}]});
const principal={id,name:text,kind:{enum:["user","group","placeholder"]}};
const member={...principal,membership_id:id,role_ids:array(id),role_names:array(text),version:digest,protected:{type:"boolean"},restriction:nullable(text)};
const operation={enum:["add","change","remove"]},project={project_id:id,project_identifier:{const:"workspace-delivery-art"}};
const command=object({request_id:{type:"string",pattern:"^[A-Za-z0-9_.:@-]{1,160}$"},operation,principal_id:id,membership_id:nullable(id),
  role_ids:{...array(id),uniqueItems:true,maxItems:20},expected_version:nullable(digest)});
command.allOf=[{if:{properties:{operation:{const:"add"}}},then:{properties:{membership_id:{type:"null"},expected_version:{type:"null"}}},
  else:{properties:{membership_id:id,expected_version:digest}}},
 {if:{properties:{operation:{const:"remove"}}},then:{properties:{role_ids:{maxItems:0}}},else:{properties:{role_ids:{minItems:1}}}}];
const outcome=object({schema_version:{const:1},status:{const:"applied"},request_id:text,caller_id:text,operator_id:text,operation,...project,
  principal:ref("Principal"),before:nullable(ref("Member")),after:nullable(ref("Member")),applied_at:{type:"string",format:"date-time"},replayed:{type:"boolean"},request_digest:digest,
  receipt:object({ref:{type:"string",pattern:"^openproject://delivery-memberships/receipts/[a-f0-9]{64}$"},digest})});
const projection=object({schema_version:{const:1},...project,project_name:text,members:{...array(ref("Member")),maxItems:100},total:{type:"integer",minimum:0},page:id,page_size:{enum:[25,50,100]},
  candidates:{...array(ref("Principal")),maxItems:100},candidate_total:{type:"integer",minimum:0},roles:array(ref("Role")),recent_outcomes:{...array(ref("Outcome")),maxItems:10}});
for(const [name,schema] of Object.entries({Command:command,Principal:object(principal),Member:object(member),Role:object({id,name:text,can_assign_work:{type:"boolean"},manages_members:{type:"boolean"}}),Outcome:outcome,Projection:projection})) {
 source=upsertOpenApiComponent(source,`DeliveryMembership${name}V1`,schema);
}
const parameters=[{name:"x-oos-operator-id",in:"header",required:true,schema:text}];
const samplePrincipal={id:21,name:"Example developer",kind:"user"};
const sampleMember={...samplePrincipal,membership_id:11,role_ids:[4],role_names:["Member"],version:"sha256:"+"a".repeat(64),protected:false,restriction:null};
const sampleCommand={request_id:"membership-example-1",operation:"add",principal_id:21,membership_id:null,role_ids:[4],expected_version:null};
const sampleOutcome={schema_version:1,status:"applied",request_id:sampleCommand.request_id,caller_id:"governance-operations-console",operator_id:"operator:example",operation:"add",project_id:1,project_identifier:"workspace-delivery-art",
 principal:samplePrincipal,before:null,after:sampleMember,applied_at:"2026-11-17T00:00:00Z",replayed:false,request_digest:"sha256:"+"b".repeat(64),receipt:{ref:"openproject://delivery-memberships/receipts/"+"c".repeat(64),digest:"sha256:"+"d".repeat(64)}};
const samples={Outcome:sampleOutcome,Projection:{schema_version:1,project_id:1,project_identifier:"workspace-delivery-art",project_name:"Example Delivery project",members:[sampleMember],total:1,page:1,page_size:25,candidates:[],candidate_total:0,
 roles:[{id:4,name:"Member",can_assign_work:true,manages_members:false}],recent_outcomes:[]}};
const response=(name,description)=>({description,content:{"application/json":{schema:ref(name),example:samples[name]}}});
const metadata={"x-oos-surface":"operator-facing","x-oos-primary-caller":"governance-operations-console","x-oos-owner":"operator-orchestration-service","x-oos-workflow-family":"delivery-catalog"};
const errors={"400":{description:"Invalid or duplicate request fields."},"401":{description:"Caller authentication required."},"403":{description:"Bound operator, caller-specific identity or project permission denied."},"409":{description:"Stale review, protected/inherited access or conflicting request."},"503":{description:"Membership authority unavailable; recover the same accepted decision."}};
source=upsertOpenApiPath(source,"/v1/delivery-memberships/projection",{get:{operationId:"readDeliveryProjectMembers",summary:"Read Delivery project membership and accountable recent outcomes",tags:["Delivery Catalog"],security:[{CallerIdHeader:[],CallerSecretHeader:[]}],
  ...metadata,description:"Read bounded native Delivery project members, grantable project roles and visible existing-account choices. Requires caller-specific authentication and the configured operator binding. No account or membership is changed.",
  parameters:[...parameters,...["page","page_size","search","candidate_search"].map(name=>({name,in:"query",required:false,schema:name==="page"?id:name==="page_size"?{enum:[25,50,100]}:{type:"string",maxLength:200}}))],
  responses:{"200":response("Projection","Native project members, roles and visible existing-account choices. No mutation."),...errors}}});
source=upsertOpenApiPath(source,"/v1/delivery-memberships/mutations",{post:{operationId:"applyDeliveryProjectMembership",summary:"Apply or recover one explicitly reviewed Delivery membership decision",tags:["Delivery Catalog"],security:[{CallerIdHeader:[],CallerSecretHeader:[]}],parameters,
  ...metadata,description:"Apply an explicit existing-user/group membership decision in the server-selected Delivery project. Native services enforce project-role permissions; stale reviews and protected/inherited access fail closed. Exact request replay recovers its original transactional receipt without reapplying it.",
  requestBody:{required:true,description:"One reviewed add, role-change or removal decision. Project, caller and operator authority are derived server-side. Reuse the complete original command for uncertain-outcome recovery.",content:{"application/json":{schema:ref("Command"),example:sampleCommand}}},responses:{"200":response("Outcome","Native readback and durable receipt; exact replay returns the original outcome."),...errors}}});
if(process.argv.includes("--check")){if(source!==original){console.error("Membership OpenAPI is stale");process.exitCode=1;}else console.log("Membership OpenAPI is current");}
else {writeFileSync(file,source);console.log("Membership OpenAPI synchronized");}
