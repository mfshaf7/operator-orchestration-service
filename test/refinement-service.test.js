import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { cggContextDigest } from "../src/context-wire-digest.js";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  createRefinementService,
  RefinementServiceError,
} from "../src/refinement/service.js";

const timestamp = "2026-08-26T01:00:00.000Z";
const packageRef = "delivery-package:909";
const sourceRef = "openproject://work_packages/909";

test("Refinement archive remains readable without a current packet or authoring handoff",async()=>{
 let packetReads=0;
 const archive=service({sourceAdapter:{async projectPacket(){packetReads++;throw Error("No current handoff");},async readReceiptEvents(){return [];}}});
 const result=await archive.readHistory({packageId:packageRef,sourceRef,correlationId:"archive-read"});
 assert.equal(packetReads,0);assert.deepEqual(result.history,[]);assert.deepEqual(result.records,[]);assert.equal(result.partial,false);assert.equal(result.source_ref,sourceRef);
 await assert.rejects(archive.readHistory({packageId:packageRef,sourceRef:"openproject://work_packages/42"}),/must match/);
});

test("trusted original receipt evidence survives a durable-run outage with explicit partial coverage",async()=>{
 const event={run_id:"original-run",target:{delivery_ref:sourceRef},applied_at:timestamp,applied_by:"original operator",content_digest:`sha256:${"a".repeat(64)}`,source_work_design_receipt_id:"original-design"};
 const archive=service({runAdapter:{async listRuns(){throw Error("Temporal offline");}},sourceAdapter:{async readReceiptEvents(){return [{activityId:123,event}];}}});
 const result=await archive.readHistory({packageId:packageRef,sourceRef});
 assert.equal(result.partial,true);assert.equal(result.records[0].receipt_ref,sourceRef+"/activities/123");assert.equal(result.records[0].digest,event.content_digest);assert.equal(result.records[0].actor,event.applied_by);assert.deepEqual(result.history,[]);
});

function operation() {
  return {
    operation_id: "delivery-package:909-governance",
    kind: "governance",
    label: "Update Initiative Governance",
    detail: "Apply accepted package-level governance values.",
    target: "openproject://work_packages/884",
    oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
    status: "planned",
  };
}

function packet() {
  return {
    schema_version: 1,
    packet_id: `refinement-packet:${packageRef}`,
    packet_revision: `sha256:${"b".repeat(64)}`,
    status: "ready_for_review",
    active_step: "readiness_review",
    source: {
      delivery_id: "delivery-884",
      package_ref: packageRef,
      source_ref: sourceRef,
      source_revision: "version-5",
      source_work_design_receipt_id: "work-design-application:receipt-1",
      tree_snapshot_ref: "tree://work-design/receipt-1",
      finalized_brief_ref: "brief://work-design/receipt-1/final",
    },
    target_tree: {
      id: "884",
      kind: "Epic",
      title: "Refinement runtime",
      description: "",
      draft_body: "",
      remark: "",
      children: [],
    },
    draft_groups: [{
      group_id: "delivery-package:909-governance",
      title: "Initiative Governance",
      summary: "Review package-level metadata.",
      fields: [{
        field_key: "initiative-target-pi",
        backend_field: "target_pi",
        label: "Target PI",
        field_kind: "select",
        required: true,
        status: "complete",
        value: "PI-2026-03",
        allowed_values: ["PI-2026-03", "PI-2026-04"],
        target_node_ids: ["884"],
        target_values: { "884": "PI-2026-03" },
        validation_hint: "Target PI must resolve for every selected initiative.",
        route_binding: {
          operation_kind: "governance",
          oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
          payload_key: "target_pi",
          target: "initiative",
        },
      }],
    }],
    readiness_gates: [{
      gate_id: "delivery-package:909-metadata-review",
      label: "Metadata Review",
      detail: "Every required metadata target has a current value.",
      status: "passed",
    }],
    apply_plan: {
      summary: "Apply reviewed metadata.",
      expected_routes: ["POST /v1/delivery-initiatives/{delivery_id}/governance"],
      operations: [operation()],
    },
    last_saved_at: timestamp,
  };
}

function assistRequest() {
  const value = packet();
  return {
    schema_version: 1,
    request_id: "refinement-assist-1",
    correlation_id: "correlation-1",
    delivery_id: value.source.delivery_id,
    package_ref: value.source.package_ref,
    source_ref: value.source.source_ref,
    source_revision: value.source.source_revision,
    operator: { id: "operator:owner" },
    task: {
      kind: "metadata_advice",
      contract_ref: "oos.delivery-refinement.v1",
      version: "1.0",
    },
    packet: {
      packet_id: value.packet_id,
      packet_revision: value.packet_revision,
      source_work_design_receipt_id: value.source.source_work_design_receipt_id,
    },
    target: {
      field_key: "initiative-target-pi",
      field_label: "Target PI",
      field_kind: "select",
      required: true,
      source_value: "PI-2026-03",
      draft_value: "",
      selected_node_ids: ["884"],
      allowed_values: ["PI-2026-03", "PI-2026-04"],
    },
    operator_prompt: "Check the planning increment.",
  };
}

function applyRequest() {
  const value = packet();
  const acceptedDraft = {
    packet_id: value.packet_id,
    packet_revision: value.packet_revision,
    source_work_design_receipt_id: value.source.source_work_design_receipt_id,
    metadata_values: { target_pi: "PI-2026-04" },
    metadata_resolutions: { target_pi: "accepted" },
    apply_plan: value.apply_plan,
  };
  return {
    schema_version: 1,
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "refinement-apply-key-1",
    delivery_id: value.source.delivery_id,
    package_ref: value.source.package_ref,
    source_ref: value.source.source_ref,
    source_revision: value.source.source_revision,
    operator: { id: "operator:owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:owner",
      note: "Apply reviewed metadata.",
    },
    accepted_draft: {
      ...acceptedDraft,
      draft_digest: canonicalDigest(acceptedDraft),
    },
  };
}

function mixedPlanningRequest() {
  const current=packet();
  current.target_tree.children=["1002","1003"].map(id=>({id,kind:"Feature",title:`Feature ${id}`,description:"",draft_body:"",remark:"",children:[]}));
  const route="POST /v1/delivery-initiatives/{delivery_id}/plan/apply";
  current.apply_plan.expected_routes.push(route);
  current.apply_plan.operations.push({operation_id:"planning",kind:"plan_apply",label:"Plan reviewed scope",detail:"Preserve future backlog",target:"Reviewed ART planning scope",oos_route:route,status:"planned"});
  const fields=[];
  for(const [id,required] of [["1002",true],["1003",false]])for(const key of ["target_pi","iteration"]){
    fields.push({field_key:`work-${key}-${id}`,backend_field:key,label:key,field_kind:"short_text",required,status:"complete",value:required?(key==="target_pi"?"PI-2026-03":"PI-2026-03 / Iteration 1"):"",target_node_ids:[id],validation_hint:"Existing native planning rules",route_binding:{operation_kind:"plan_apply",oos_route:route,payload_key:key,target:"work_item"}});
  }
  current.draft_groups.push({group_id:"work-items",title:"Work metadata",summary:"Review current and future scope",fields});
  const request=applyRequest();request.accepted_draft.apply_plan=current.apply_plan;
  request.accepted_draft.metadata_values=Object.fromEntries(current.draft_groups.flatMap(g=>g.fields.flatMap(f=>f.target_node_ids.map(id=>[`${f.backend_field}:${id}`,f.value]))));
  const seal=()=>{request.accepted_draft.metadata_resolutions=Object.fromEntries(Object.keys(request.accepted_draft.metadata_values).map(key=>[key,"accepted"]));const {draft_digest,...draft}=request.accepted_draft;request.accepted_draft.draft_digest=canonicalDigest(draft);};seal();
  return {packet:current,request,seal};
}

test("Refinement accepts a mixed committed/backlog draft without fabricated planning values",async()=>{
  const mixed=mixedPlanningRequest();let starts=0;
  const runtime=service({sourceAdapter:{async projectPacket(){return mixed.packet;}},runAdapter:{async startRun({request}){starts++;assert.equal(request.accepted_draft.metadata_values["target_pi:1003"],"");return {state:"accepted"};}}});
  assert.equal((await runtime.apply({callerId:"console",packageId:packageRef,request:mixed.request})).state,"accepted");assert.equal(starts,1);
});

test("Refinement validates accepted PI/iteration intent before starting any durable effects",async()=>{
  for(const values of [
    {"target_pi:1003":"PI-2026-04"},
    {"target_pi:1003":"PI-2026-04","iteration:1003":"PI-2026-03 / Iteration 1"},
    {"iteration:1003":"PI-2026-04 / Iteration 1"},
    {"target_pi:1002":""},
  ]){
    const mixed=mixedPlanningRequest();Object.assign(mixed.request.accepted_draft.metadata_values,values);mixed.seal();
    const runtime=service({sourceAdapter:{async projectPacket(){return mixed.packet;}},runAdapter:{async startRun(){assert.fail("Invalid planning must not start a run");}}});
    await assert.rejects(runtime.apply({callerId:"console",packageId:packageRef,request:mixed.request}),error=>error.code==="request_invalid");
  }
});

test("Refinement may explicitly commit a backlog target with a compatible reviewed iteration",async()=>{
  const mixed=mixedPlanningRequest();Object.assign(mixed.request.accepted_draft.metadata_values,{"target_pi:1003":"PI-2026-04","iteration:1003":"PI-2026-04 / Iteration 1"});mixed.seal();
  const runtime=service({sourceAdapter:{async projectPacket(){return mixed.packet;}},runAdapter:{async startRun(){return {state:"accepted"};}}});
  assert.equal((await runtime.apply({callerId:"console",packageId:packageRef,request:mixed.request})).state,"accepted");
});

test("Refinement does not fabricate a blank value for an omitted read-only planning counterpart",async()=>{
  const mixed=mixedPlanningRequest();mixed.packet.draft_groups[1].fields=mixed.packet.draft_groups[1].fields.filter(f=>!(f.backend_field==="target_pi"&&f.target_node_ids.includes("1002")));
  delete mixed.request.accepted_draft.metadata_values["target_pi:1002"];mixed.seal();
  const runtime=service({sourceAdapter:{async projectPacket(){return mixed.packet;}},runAdapter:{async startRun(){return {state:"accepted"};}}});
  assert.equal((await runtime.apply({callerId:"console",packageId:packageRef,request:mixed.request})).state,"accepted");
});

function readyProjection(request) {
  const projection = {
    schema_version: 1,
    status: "ready",
    replayed: false,
    request_id: request.assist_request.request_id,
    correlation_id: request.assist_request.correlation_id,
    idempotency_key: request.idempotency_key,
    request_digest: request.assist_request_digest,
    binding: {
      request_id: request.assist_request.request_id,
      correlation_id: request.assist_request.correlation_id,
      idempotency_key: request.idempotency_key,
      workflow_session_id: request.workflow_session_id,
      execution_id: request.execution_id,
      delivery_id: request.assist_request.delivery_id,
      package_ref: request.assist_request.package_ref,
      source_ref: request.assist_request.source_ref,
      source_revision: request.assist_request.source_revision,
      caller_id: "operator-orchestration-service",
      operator_id: request.assist_request.operator.id,
      task: request.assist_request.task,
      packet: request.assist_request.packet,
      target: {
        field_key: request.assist_request.target.field_key,
        field_kind: request.assist_request.target.field_kind,
        selected_node_ids: request.assist_request.target.selected_node_ids,
      },
      requested_at: request.requested_at,
      context_digest: cggContextDigest(request.work_context ? { ...request.assist_request, work_context: request.work_context } : request.assist_request),
      budget_tokens: request.budget_tokens,
    },
    artifact_id: "refinement-artifact-1",
    artifact_digest: `sha256:${"c".repeat(64)}`,
    packet_ref: "/v1/context/packets/refinement-packet-1",
    redaction_receipt_ref: "/v1/context/receipts/refinement-receipt-1",
    projection_receipt_ref: "/v1/context/refinement/projections/refinement-projection-1",
    content: JSON.stringify({ ...request.assist_request, ...(request.work_context ? { work_context: request.work_context } : {}) }),
    admission_decision: {
      profile: "developer",
      raw_projection: "not_requested",
      redaction_safe: true,
    },
    timeline: { requested_at: request.requested_at, projected_at: timestamp },
    authority: {
      may_select_or_invoke_model: false,
      may_approve_suggestion: false,
      may_mutate_delivery: false,
    },
  };
  // CGG hashes its bound projection envelope; context_digest separately binds
  // the canonical assist request. Those two digests are deliberately distinct.
  projection.request_digest = cggContextDigest({
    binding: projection.binding,
    refinement_context: request.assist_request,
    ...(request.work_context ? { work_context: request.work_context } : {}),
  });
  return projection;
}

function service(overrides = {}, outputOverrides = {}) {
  return createRefinementService({
    clock: () => new Date(timestamp),
    contextClient: {
      async project(request) {
        return readyProjection(request);
      },
    },
    gatewayClient: {
      async invoke(request) {
        return {
          policy_decision: "allow",
          policy_status: "active",
          profile_id: "delivery-refinement-advisor-v1",
          decision_id: request.caller_identity.decision_or_correlation_id,
          caller_id: request.caller_identity.caller_id,
          invocation_path: "governed-ai-gateway",
          task: request.task,
          effective_selection: { revision: 2, configuration_digest: `sha256:${"a".repeat(64)}`, task: `delivery-refinement-advisor-v1/${request.task.kind}`,
            selection_ref: `ai-routing-selection:${"b".repeat(64)}`, attempts: [{ backend_id: "local", model: "test-model", effort: false, outcome: "suggestion-produced" }] },
          output: {
            confidence: "medium",
            required_operator_action: "review",
            field_key: "initiative-target-pi",
            value: "PI-2026-04",
            summary: "Use the next admitted increment.",
            rationale: "The operator requested a bounded alternative.",
            ...outputOverrides,
          },
          audit_ref: "local-ledger:refinement-1",
          generated_at: timestamp,
        };
      },
    },
    runAdapter: {
      async getRun() {
        throw new Error("unused");
      },
      async listRuns() {
        return [];
      },
      async startRun({ request }) {
        return {
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          run_id: "refinement-run-1",
          state: "accepted",
          replayed: false,
          submitted_at: timestamp,
          updated_at: timestamp,
          poll_ref: `/v1/delivery-refinement/${packageRef}/runs/refinement-run-1`,
          events: [],
          receipt: null,
          failure: null,
        };
      },
    },
    sourceAdapter: {
      async projectPacket() {
        return packet();
      },
    },
    ...overrides,
  });
}

test("Refinement projection combines the canonical packet with durable run history", async () => {
  const result = await service().project({
    callerId: "governance-operations-console",
    correlationId: "correlation-1",
    packageId: packageRef,
    sourceRef,
  });
  assert.equal(result.packet.packet_revision, packet().packet_revision);
  assert.equal(result.active_run, null);
  assert.deepEqual(result.history, []);
});

test("Refinement projection bounds internal source contract failures", async () => {
  const runtime = service({
    sourceAdapter: {
      async projectPacket() {
        const error = new Error("Internal packet schema detail.");
        error.code = "refinement_contract_invalid";
        throw error;
      },
    },
  });

  await assert.rejects(
    runtime.project({
      callerId: "governance-operations-console",
      correlationId: "correlation-internal-source-failure",
      packageId: packageRef,
      sourceRef,
    }),
    (error) => {
      assert.equal(error.code, "backend_projection_failed");
      assert.equal(error.statusCode, 502);
      assert.equal(
        error.message,
        "Canonical Refinement source could not be projected safely.",
      );
      assert.equal(error.toResponse().code, "backend_projection_failed");
      return true;
    },
  );
});

test("Refinement assist binds CGG projection and governed output to one packet field", async () => {
  const result = await service().assist({
    callerId: "governance-operations-console",
    packageId: packageRef,
    request: assistRequest(),
  });
  assert.equal(result.suggestion.field_key, "initiative-target-pi");
  assert.equal(result.suggestion.value, "PI-2026-04");
  assert.equal(result.evidence.effective_selection.attempts[0].effort, false);
  assert.equal(result.required_operator_action, "review");
});

test("Refinement native request retains complete follow-up conversation through CGG",async()=>{
  const request=assistRequest();request.conversation=[{role:"operator",text:"Keep the accepted scope local."},{role:"advisor",text:"Understood; this is working context, not approval."}];
  let captured;
  await service({contextClient:{async project(input){captured=input;return readyProjection(input);}}}).assist({callerId:"governance-operations-console",packageId:packageRef,request});
  assert.deepEqual(captured.assist_request.conversation,request.conversation);
  assert.equal(captured.assist_request_digest,canonicalDigest(request));
});

test("Refinement carries canonical selected and ancestor narratives, excludes sibling branches and binds their content", async () => {
  const current = packet();
  current.target_tree.description = "Accepted architecture: keep project data local and recover the original operation.";
  current.target_tree.children = [
    { ...structuredClone(current.target_tree), id: "885", title: "Selected feature", description: "Selected acceptance criteria", children: [] },
    { ...structuredClone(current.target_tree), id: "886", title: "Unrelated feature", description: "UNRELATED_BRANCH_CONTENT", children: [] },
  ];
  current.draft_groups[0].fields[0].target_node_ids = ["885"];
  current.draft_groups[0].fields[0].target_values = { "885": "PI-2026-03" };
  const request = assistRequest(); request.target.selected_node_ids = ["885"];
  let captured;
  const result = await service({ sourceAdapter: { async projectPacket() { return structuredClone(current); } },
    contextClient: { async project(input) { captured = input; return readyProjection(input); } },
  }).assist({ callerId: "governance-operations-console", packageId: packageRef, request });
  assert.equal(result.required_operator_action, "review");
  assert.deepEqual(captured.work_context.nodes.map(node => node.id), ["885", "884"]);
  assert.match(JSON.stringify(captured.work_context), /Accepted architecture/);
  assert.doesNotMatch(JSON.stringify(captured.work_context), /UNRELATED_BRANCH_CONTENT/);
  assert.equal(captured.assist_request.operator_prompt, request.operator_prompt, "Knowledge is data, not appended operator instructions.");
  assert.equal(captured.assist_request_digest, canonicalDigest(request));
  const projected = readyProjection(captured);
  assert.equal(projected.binding.context_digest, canonicalDigest({ ...request, work_context: captured.work_context }));
  current.target_tree.description = "Changed canonical architecture";
  let changed;
  await service({ sourceAdapter: { async projectPacket() { return structuredClone(current); } },
    contextClient: { async project(input) { changed = input; return readyProjection(input); } },
  }).assist({ callerId: "governance-operations-console", packageId: packageRef, request });
  assert.notEqual(changed.idempotency_key, captured.idempotency_key);
  assert.notEqual(readyProjection(changed).binding.context_digest, projected.binding.context_digest);
});

test("Refinement assist rejects a stale packet before context or model invocation", async () => {
  let invoked = false;
  const request = assistRequest();
  request.packet.packet_revision = "version-stale";
  await assert.rejects(
    service({
      contextClient: { async project() { invoked = true; } },
    }).assist({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request,
    }),
    (error) => error instanceof RefinementServiceError && error.code === "packet_stale",
  );
  assert.equal(invoked, false);
});

test("Refinement explanation returns no field value and rejects an answer carrying edits", async () => {
  const request = assistRequest(); request.operator_prompt = "Explain this field without changing it.";
  const result = await service({}, { required_operator_action: "none", value: null }).assist({ callerId: "governance-operations-console", packageId: packageRef, request });
  assert.equal(result.required_operator_action, "none");
  assert.equal(result.suggestion.value, null);
  await assert.rejects(service({}, { required_operator_action: "none", value: "PI-2026-04" }).assist({ callerId: "governance-operations-console", packageId: packageRef, request }), (error) => error.code === "ai_output_invalid");
});

test("Refinement assist rejects output outside the admitted option set", async () => {
  const base = service();
  await assert.rejects(
    createRefinementService({
      clock: () => new Date(timestamp),
      contextClient: {
        async project(request) { return readyProjection(request); },
      },
      gatewayClient: {
        async invoke(request) {
          return {
            policy_decision: "allow",
            policy_status: "active",
            profile_id: "delivery-refinement-advisor-v1",
            decision_id: request.caller_identity.decision_or_correlation_id,
            caller_id: request.caller_identity.caller_id,
            invocation_path: "governed-ai-gateway",
            task: request.task,
            output: {
              confidence: "high",
              required_operator_action: "review",
              field_key: "initiative-target-pi",
              value: "PI-NOT-ADMITTED",
              summary: "Invalid option.",
              rationale: "Must be rejected.",
            },
            audit_ref: "local-ledger:invalid-1",
            generated_at: timestamp,
          };
        },
      },
      runAdapter: { async listRuns() { return []; } },
      sourceAdapter: { async projectPacket() { return packet(); } },
    }).assist({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request: assistRequest(),
    }),
    (error) => error instanceof RefinementServiceError && error.code === "ai_output_invalid",
  );
  assert.ok(base);
});

test("Refinement apply validates the immutable draft before starting a durable run", async () => {
  let started = 0;
  const runtime = service({
    runAdapter: {
      async listRuns() { return []; },
      async startRun({ request }) {
        started += 1;
        return {
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          run_id: "refinement-run-1",
          state: "accepted",
          replayed: false,
          submitted_at: timestamp,
          updated_at: timestamp,
          poll_ref: `/v1/delivery-refinement/${packageRef}/runs/refinement-run-1`,
          events: [],
          receipt: null,
          failure: null,
        };
      },
    },
  });
  const result = await runtime.apply({
    callerId: "governance-operations-console",
    packageId: packageRef,
    request: applyRequest(),
  });
  assert.equal(result.state, "accepted");
  assert.equal(started, 1);

  const stale = applyRequest();
  stale.accepted_draft.packet_revision = "version-stale";
  await assert.rejects(
    runtime.apply({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request: stale,
    }),
    (error) =>
      error instanceof RefinementServiceError && error.code === "accepted_draft_stale",
  );
  assert.equal(started, 1);
});


test("Refinement rejects context-only receipts and tampered CGG bindings before invocation", async () => {
  for (const [index, mutation] of [
    (projection, request) => { projection.request_digest = request.assist_request_digest; },
    (projection) => { projection.binding.operator_id = "operator:other"; },
    (projection) => { projection.binding.packet.packet_revision = "wrong-revision"; },
    (projection) => { projection.binding.target.selected_node_ids = ["unbound-node"]; },
    (projection) => { projection.binding.context_digest = `sha256:${"0".repeat(64)}`; },
  ].entries()) {
    await assert.rejects(service({
      contextClient: {
        async project(request) {
          const projection = structuredClone(readyProjection(request));
          mutation(projection, request);
          if (index > 0) projection.request_digest = cggContextDigest({
            binding: projection.binding, refinement_context: request.assist_request,
          });
          return projection;
        },
      },
      gatewayClient: { async invoke() { assert.fail("Unbound projection must not invoke a model"); } },
    }).assist({ callerId: "governance-operations-console", packageId: packageRef,
                request: assistRequest() }),
      (error) => error.code === "context_projection_failed");
  }
});

function subsetAdvice() {
  const current = packet(), request = assistRequest();
  const base = structuredClone(current.target_tree);
  current.target_tree.children = ["885","886","887"].map(id => ({...base,id,kind:"Feature",title:`Outcome ${id}`,children:[],planning:{status:"new",target_pi:"",iteration:"",owner_repo:""}}));
  const field = {...current.draft_groups[0].fields[0],field_key:"work-repo",backend_field:"owner_repo",label:"Repository",field_kind:"short_text",allowed_values:[],value:"",target_node_ids:["885","886","887"],target_values:{"885":"alpha","886":"beta","887":"gamma"}};
  current.draft_groups.push({group_id:"work",title:"Work",summary:"Selected work",fields:[field]});
  request.target={field_key:field.field_key,field_label:field.label,field_kind:field.field_kind,required:field.required,source_value:"alpha",draft_value:"alpha",selected_node_ids:["885"],allowed_values:[]};
  const invoke=(extra={},output={})=>service({sourceAdapter:{async projectPacket(){return current;}},...extra},{field_key:field.field_key,value:"reviewed-repo",...output}).assist({callerId:"console",packageId:packageRef,request});
  return {current,request,field,invoke};
}

test("individual and mixed-value subsets bind exact canonical values without expanding to the field group",async()=>{
  const h=subsetAdvice();let captured;
  const contextClient={async project(input){captured=input;return readyProjection(input);}};
  assert.equal((await h.invoke({contextClient})).suggestion.value,"reviewed-repo");
  assert.deepEqual(captured.work_context.nodes.map(n=>n.id),["885","884"]);
  h.request.target.selected_node_ids=["885","886"];h.request.target.source_value="";
  await h.invoke({contextClient});assert.deepEqual(captured.assist_request.target.selected_node_ids,["885","886"]);
  assert.doesNotMatch(JSON.stringify(captured.work_context),/Outcome 887|gamma/);
  h.request.target.source_value="alpha";
  await assert.rejects(h.invoke(),error=>error.code==="packet_stale");
});

test("foreign, duplicate, blocked and stale choices are rejected before the model",async()=>{
  for(const patch of [{selected_node_ids:["999"]},{selected_node_ids:["885","885"]},{field_label:"Unrelated"},{allowed_values:["forged"]}]){
    const h=subsetAdvice();Object.assign(h.request.target,patch);
    await assert.rejects(h.invoke({gatewayClient:{async invoke(){assert.fail("No model invocation for invalid scope");}}}),e=>["packet_stale","request_invalid"].includes(e.code));
  }
  const h=subsetAdvice();h.field.target_statuses={"885":"blocked"};
  await assert.rejects(h.invoke(),e=>e.code==="packet_stale");
});

test("related drafts bind selected/ancestor field identities and remain distinct from canonical facts",async()=>{
  const h=subsetAdvice();let seen;
  h.request.related_drafts=[{node_id:"884",field_key:"initiative-target-pi",value:"PI-2026-04"}];
  await h.invoke({contextClient:{async project(input){seen=input;return readyProjection(input);}}});
  const pi=seen.work_context.metadata.find(f=>f.node_id==="884");
  assert.equal(pi.source_value,"PI-2026-03");assert.equal(pi.draft_value,"PI-2026-04");
  assert.match(seen.work_context.coverage,/unaccepted/);
  for(const drafts of [[{node_id:"887",field_key:"work-repo",value:"outside"}], [...h.request.related_drafts,...h.request.related_drafts]]){
    h.request.related_drafts=drafts;await assert.rejects(h.invoke(),e=>e.code==="packet_stale");
  }
});

test("planning advice cannot conflict with retained or edited counterpart and never silently commits backlog",async()=>{
  const h=subsetAdvice();Object.assign(h.field,{field_key:"work-pi",backend_field:"target_pi",label:"Target PI",field_kind:"select",allowed_values:["PI-2026-03","PI-2026-04"],required:false,target_values:{"885":""}});
  Object.assign(h.request.target,{field_key:h.field.field_key,field_label:h.field.label,field_kind:h.field.field_kind,required:false,source_value:"",draft_value:"",allowed_values:h.field.allowed_values});
  h.current.target_tree.children[0].planning.iteration="PI-2026-03 / Iteration 1";
  h.current.draft_groups[1].fields.push({...h.field,field_key:"work-iteration",backend_field:"iteration",label:"Iteration",field_kind:"short_text",allowed_values:[],value:"PI-2026-03 / Iteration 1",target_values:{"885":"PI-2026-03 / Iteration 1"},target_node_ids:["885"]});
  const bad=await h.invoke({}, {value:"PI-2026-04"});
  assert.equal(bad.suggestion.value,null);assert.equal(bad.required_operator_action,"none");assert.match(bad.suggestion.rationale,/align/);
  h.request.related_drafts=[{node_id:"885",field_key:"work-iteration",value:"PI-2026-04 / Iteration 1"}];
  assert.equal((await h.invoke({}, {value:"PI-2026-04"})).suggestion.value,"PI-2026-04");
  assert.equal((await h.invoke({}, {value:null,required_operator_action:"none"})).suggestion.value,null);
});

test("a read-only planning counterpart uses its saved snapshot instead of fabricating a blank or starting invalid work",async()=>{
 const h=mixedPlanningRequest(),node=h.packet.target_tree.children[0];
 node.planning={status:"new",target_pi:"PI-2026-03",iteration:"PI-2026-03 / Iteration 1",owner_repo:"repo"};
 h.packet.draft_groups[1].fields=h.packet.draft_groups[1].fields.filter(f=>!(f.backend_field==="target_pi"&&f.target_node_ids.includes(node.id)));
 delete h.request.accepted_draft.metadata_values['target_pi:'+node.id];
 h.request.accepted_draft.metadata_values['iteration:'+node.id]='PI-2026-04 / Iteration 1';h.seal();
 await assert.rejects(service({sourceAdapter:{async projectPacket(){return h.packet;}},runAdapter:{async startRun(){assert.fail('Invalid counterpart must fail before effects');}}}).apply({callerId:'console',packageId:packageRef,request:h.request}),e=>e.code==='request_invalid');
});

test("Apply checks each item against its own options and rejects incompatible shared values before start",async()=>{
 const current=packet(),field=current.draft_groups[0].fields[0];
 field.backend_field="owner_repo";field.label="Repository";field.route_binding.payload_key="owner_repo";
 field.target_node_ids=["884","885"];field.allowed_values=[];field.target_values={884:"repo-a",885:"repo-b"};
 field.target_allowed_values={884:["repo-a"],885:["repo-b"]};
 const adapter=service({sourceAdapter:{async projectPacket(){return current;}}});
 const request=applyRequest();
 const setValues=values=>{request.accepted_draft.metadata_values=values;request.accepted_draft.metadata_resolutions=Object.fromEntries(Object.keys(values).map(key=>[key,"accepted"]));const {draft_digest,...content}=request.accepted_draft;request.accepted_draft.draft_digest=canonicalDigest(content);};
 setValues({"owner_repo:884":"repo-a","owner_repo:885":"repo-b"});
 assert.equal((await adapter.apply({callerId:"console",packageId:packageRef,request})).state,"accepted");
 setValues({owner_repo:"repo-a"});
 await assert.rejects(adapter.apply({callerId:"console",packageId:packageRef,request}),/offered/);
});

test("advice accepts the exact selected item's options and rejects a broadened list",async()=>{
 const current=packet(),field=current.draft_groups[0].fields[0];
 field.allowed_values=[];field.target_allowed_values={884:["PI-2026-03","PI-2026-04"],885:["PI-other"]};field.target_node_ids=["884","885"];
 const adapter=service({sourceAdapter:{async projectPacket(){return current;}}});
 const request=assistRequest();
 assert.equal((await adapter.assist({callerId:"console",packageId:packageRef,request})).suggestion.value,"PI-2026-04");
 request.target.allowed_values.push("PI-other");
 await assert.rejects(adapter.assist({callerId:"console",packageId:packageRef,request}),/canonical packet/);
});


test("integer Apply preflight rejects fractional values before durable execution",async()=>{
 const current=packet(),field=current.draft_groups[0].fields[0];
 field.backend_field="planned_business_value";field.label="Planned Business Value";field.field_kind="number";field.numeric_type="integer";field.value="8";field.target_values={884:"8"};field.route_binding.payload_key="planned_business_value";
 let starts=0;
 const adapter=service({sourceAdapter:{async projectPacket(){return current;}},runAdapter:{async startRun(){starts++;throw Error("must not start");}}});
 for(const value of ["1.5","0x10","1e3"]){
  const request=applyRequest();request.accepted_draft.metadata_values={planned_business_value:value};request.accepted_draft.metadata_resolutions={planned_business_value:"accepted"};
  const {draft_digest,...content}=request.accepted_draft;request.accepted_draft.draft_digest=canonicalDigest(content);
  await assert.rejects(adapter.apply({callerId:"console",packageId:packageRef,request}),/whole number/);
 }
 assert.equal(starts,0);
});


test("Refinement uses the CGG Python wire digest for Unicode owner context and operator input", async () => {
  const current = packet();
  current.target_tree.title = "PM² — 開発 😀";
  current.target_tree.description = "Preserve café and \u007f in canonical source text.";
  const request = assistRequest();
  request.operator_prompt = "Explain PM² for 開発 😀 without changing values.";
  let invoked = false;
  const result = await service({
    sourceAdapter: { async projectPacket() { return current; } },
    contextClient: { async project(input) {
      const projection = readyProjection(input);
      const values = {
        assist: input.assist_request,
        context: { ...input.assist_request, work_context: input.work_context },
        envelope: { binding: projection.binding, refinement_context: input.assist_request, work_context: input.work_context },
      };
      const python = spawnSync("python3", ["-c", "import sys,json,hashlib; v=json.load(sys.stdin); print(json.dumps({k:'sha256:'+hashlib.sha256(json.dumps(x,ensure_ascii=True,separators=(',',':'),sort_keys=True).encode()).hexdigest() for k,x in v.items()}))"], { input: JSON.stringify(values), encoding: "utf8" });
      assert.equal(python.status, 0, python.stderr);
      const digests = JSON.parse(python.stdout);
      assert.equal(input.assist_request_digest, digests.assist);
      assert.equal(projection.binding.context_digest, digests.context);
      assert.equal(projection.request_digest, digests.envelope);
      assert.notEqual(digests.context, canonicalDigest(values.context));
      assert.equal(input.work_context.nodes[0].title, current.target_tree.title);
      invoked = true;
      return projection;
    } },
  }, { value: null, required_operator_action: "none", summary: "Explanation only." }).assist({ callerId: "governance-operations-console", packageId: packageRef, request });
  assert.equal(invoked, true);
  assert.equal(result.suggestion.value, null);
  assert.equal(result.required_operator_action, "none");
});
