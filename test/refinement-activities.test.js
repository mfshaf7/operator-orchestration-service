import assert from "node:assert/strict";
import test from "node:test";

import {
  createRefinementActivities,
  RefinementActivityError,
} from "../src/refinement/activities.js";
import { OpenProjectError } from "../src/errors.js";

function request() {
  return {
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    delivery_id: "delivery-884",
    operator: { id: "operator:owner" },
    accepted_draft: {
      metadata_values: {
        target_pi: "PI-2026-04",
        "delivery_team:1002": "Team A",
        "delivery_team:1003": "Team B",
      },
    },
  };
}

function packet() {
  return {
    draft_groups: [{
      fields: [
        {
          backend_field: "target_pi",
          required: true,
          value: "PI-2026-03",
          target_node_ids: ["884"],
          target_values: { "884": "PI-2026-03" },
          route_binding: {
            operation_kind: "governance",
            oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
          },
        },
        {
          backend_field: "delivery_team",
          required: true,
          value: "",
          target_node_ids: ["1002", "1003"],
          target_values: { "1002": "", "1003": "" },
          route_binding: {
            operation_kind: "bulk_update",
            oos_route: "POST /v1/delivery-work-items/bulk-update",
          },
        },
      ],
    }],
  };
}

function sourceAdapter(tree = null) {
  return {
    async readDeliverySnapshot() {
      return {
        deliveryRef: "openproject://work_packages/884",
        tree: tree ?? {
          id: 884,
          target_pi: "PI-2026-03",
          children: [
            { id: 1002, delivery_team: "Unassigned", children: [] },
            { id: 1003, delivery_team: "Unassigned", children: [] },
          ],
        },
      };
    },
  };
}

test("Refinement governance activity uses the existing Delivery authority", async () => {
  let captured;
  const activities = createRefinementActivities({
    deliveryService: {
      async updateDeliveryInitiative(input) {
        captured = input;
        return { delivery_record_ref: "openproject://work_packages/884" };
      },
    },
    sourceAdapter: sourceAdapter(),
  });
  const result = await activities.applyRefinementOperation({
    callerId: "governance-operations-console",
    operation: {
      operation_id: "governance",
      kind: "governance",
      oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
      status: "planned",
      target: "openproject://work_packages/884",
    },
    packet: packet(),
    request: request(),
  });
  assert.equal(captured.recordId, "delivery-884");
  assert.equal(captured.targetPi, "PI-2026-04");
  assert.deepEqual(result.updated_refs, ["openproject://work_packages/884"]);
});

test("Refinement bulk activity applies target-specific accepted values once", async () => {
  const calls = [];
  const activities = createRefinementActivities({
    deliveryService: {
      async updateDeliveryWorkItem(input) {
        calls.push(input);
        return {
          work_item_record_ref: `openproject://work_packages/${input.workItemId.split("-").at(-1)}`,
        };
      },
    },
    sourceAdapter: sourceAdapter(),
  });
  const result = await activities.applyRefinementOperation({
    callerId: "governance-operations-console",
    operation: {
      operation_id: "work-items",
      kind: "bulk_update",
      oos_route: "POST /v1/delivery-work-items/bulk-update",
      status: "planned",
    },
    packet: packet(),
    request: request(),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].deliveryTeam, "Team A");
  assert.equal(calls[1].deliveryTeam, "Team B");
  assert.deepEqual(result.updated_refs, [
    "openproject://work_packages/1002",
    "openproject://work_packages/1003",
  ]);
});

test("Refinement typed metadata never leaks PI Objective fields into a different target", async () => {
  const currentPacket = packet();
  currentPacket.draft_groups[0].fields.push({
    backend_field: "pi_objective_type", required: true, value: "Committed",
    target_node_ids: ["1003"], target_values: {"1003":"Committed"},
    route_binding: {operation_kind:"bulk_update",oos_route:"POST /v1/delivery-work-items/bulk-update"},
  });
  const accepted = request();
  accepted.accepted_draft.metadata_values["pi_objective_type:1003"] = "Committed";
  const calls = [];
  const activities = createRefinementActivities({
    deliveryService: {async updateDeliveryWorkItem(input) {
      calls.push(input);
      return {work_item_record_ref:`openproject://work_packages/${input.workItemId.split("-").at(-1)}`};
    }},
    sourceAdapter: sourceAdapter(),
  });
  const operation = {kind:"bulk_update",status:"planned",operation_id:"typed",oos_route:"POST /v1/delivery-work-items/bulk-update"};
  await activities.applyRefinementOperation({callerId:"console",operation,packet:currentPacket,request:accepted});
  assert.equal(calls.length, 2);
  assert.equal(Object.hasOwn(calls[0], "piObjectiveType"), false);
  assert.equal(calls[1].piObjectiveType, "Committed");
  const replay = createRefinementActivities({
    deliveryService: {async updateDeliveryWorkItem() {throw new Error("must reuse committed typed values");}},
    sourceAdapter: sourceAdapter({id:884,children:[
      {id:1002,delivery_team:"Team A",children:[]},
      {id:1003,delivery_team:"Team B",pi_objective_type:"Committed",children:[]},
    ]}),
  });
  const result = await replay.applyRefinementOperation({callerId:"console",operation,packet:currentPacket,request:accepted});
  assert.equal(result.reused_refs.length, 2);
});

test("Refinement activity preserves retryability of backend unavailability", async () => {
  const activities = createRefinementActivities({
    deliveryService: {
      async updateDeliveryInitiative() {
        throw new OpenProjectError(
          "backend_unavailable",
          "OpenProject is unavailable.",
          503,
        );
      },
    },
    sourceAdapter: sourceAdapter(),
  });
  await assert.rejects(
    activities.applyRefinementOperation({
      callerId: "governance-operations-console",
      operation: {
        operation_id: "governance",
        kind: "governance",
        oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
        status: "planned",
        target: "openproject://work_packages/884",
      },
      packet: packet(),
      request: request(),
    }),
    (error) =>
      error instanceof RefinementActivityError &&
      error.code === "apply_execution_failed" &&
      error.retryable === true,
  );
});

test("Refinement activity reconciles a committed effect before retrying", async () => {
  let updateCalls = 0;
  const activities = createRefinementActivities({
    deliveryService: {
      async updateDeliveryInitiative() {
        updateCalls += 1;
        throw new Error("must not repeat a committed mutation");
      },
    },
    sourceAdapter: sourceAdapter({
      id: 884,
      target_pi: "PI-2026-04",
      children: [],
    }),
  });
  const result = await activities.applyRefinementOperation({
    callerId: "governance-operations-console",
    operation: {
      operation_id: "governance",
      kind: "governance",
      oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
      status: "planned",
      target: "openproject://work_packages/884",
    },
    packet: packet(),
    request: request(),
  });
  assert.equal(updateCalls, 0);
  assert.deepEqual(result.reused_refs, ["openproject://work_packages/884"]);
});

function planningCase() {
  const tree = { id: 884, type: "Epic", subject: "Product", children: [
    { id: 1002, type: "Feature", subject: "Deliver product", execution_classification: "Business", status: "new", children: [
      { id: 1003, type: "User story", subject: "Record product", execution_classification: "Business", status: "new", children: [] },
    ] },
    { id: 1004, type: "PI Objective", subject: "Prove product", target_pi: "PI-2026-04", iteration: "PI-2026-04 / Iteration 1", status: "new", children: [] },
  ] };
  const reviewed = (node) => ({ id: String(node.id), kind: node.type, title: node.subject, children: node.children.map(reviewed) });
  const fields = ["target_pi", "iteration"].map((key) => ({
    backend_field: key, required: true, value: "", target_node_ids: ["1002", "1003", "1004"],
    route_binding: {operation_kind:"plan_apply",oos_route:"POST /v1/delivery-initiatives/{delivery_id}/plan/apply"},
  }));
  return {
    tree,
    packet: { target_tree: reviewed(tree), draft_groups: [{ fields }] },
    operation: { operation_id:"planning",kind:"plan_apply",status:"planned",oos_route:fields[0].route_binding.oos_route },
    request: {...request(),accepted_draft:{metadata_values:{target_pi:"PI-2026-04",iteration:"PI-2026-04 / Iteration 1", "execution_classification:1003":"Enabler"}}},
  };
}

test("Refinement planning preserves native taxonomy/status and routes only accepted planning inputs", async () => {
  const current = planningCase();
  let input;
  const activities = createRefinementActivities({
    sourceAdapter: sourceAdapter(current.tree),
    deliveryService: {async applyDeliveryPlan(value) {
      input = value;
      return {delivery_record_ref:"openproject://work_packages/884",plan_result:{created:[],updated:[{record_ref:"openproject://work_packages/1002"}],reused:[]}};
    }},
  });
  await activities.applyRefinementOperation({callerId:"console",...current});
  assert.equal(input.reconcileMissing, "ignore");
  const feature = input.plan.items[0];
  const story = feature.children[0];
  assert.equal(feature.target_pi, "PI-2026-04");
  assert.equal(story.iteration, "PI-2026-04 / Iteration 1");
  assert.equal(story.executionClassification, "Business", "accepted reclassification belongs to the later explicit-id metadata writer");
  for (const node of [feature, story, input.plan.items[1]]) {
    assert.equal(Object.hasOwn(node, "status"), false, "do not transition to Ready or replay a terminal status");
    assert.equal(Object.hasOwn(node, "id"), false, "native plan reconciliation is parent/type/subject, not an invented ID API");
    assert.equal(Object.hasOwn(node, "description"), false);
  }
});

test("Refinement planning reuses committed fields after an ID-bound metadata rename", async () => {
  const current = planningCase();
  for (const node of [current.tree.children[0], current.tree.children[0].children[0]]) {
    node.target_pi = "PI-2026-04";
    node.iteration = "PI-2026-04 / Iteration 1";
  }
  current.tree.children[0].children[0].subject = "Enabler: Record product";
  const activities = createRefinementActivities({sourceAdapter:sourceAdapter(current.tree),deliveryService:{async applyDeliveryPlan(){throw new Error("must not repeat");}}});
  const result = await activities.applyRefinementOperation({callerId:"console",...current});
  assert.equal(result.reused_refs.length, 3);
});

test("Refinement planning does not resubmit unreviewed read-only planning values", async () => {
  const current = planningCase();
  for (const field of current.packet.draft_groups[0].fields) field.target_node_ids = ["1002", "1003"];
  let written;
  const activities = createRefinementActivities({sourceAdapter:sourceAdapter(current.tree),deliveryService:{async applyDeliveryPlan(input){
    written = input.plan.items;
    return {delivery_record_ref:"openproject://work_packages/884",plan_result:{created:[],updated:[],reused:[]}};
  }}});
  await activities.applyRefinementOperation({callerId:"console",...current});
  assert.equal(Object.hasOwn(written[1],"target_pi"),false);
  assert.equal(Object.hasOwn(written[1],"iteration"),false);
});

test("Refinement planning rejects changed, missing or ambiguous hierarchy before invoking native reconciliation", async () => {
  for (const change of [
    (tree) => {tree.children[0].subject = "Renamed";},
    (tree) => {tree.children[0].children[0].id = 9999;},
    (tree) => {tree.children.push(structuredClone(tree.children[0]));},
    (tree) => {tree.children[0].children = [];},
  ]) {
    const current = planningCase();
    change(current.tree);
    const activities = createRefinementActivities({sourceAdapter:sourceAdapter(current.tree),deliveryService:{async applyDeliveryPlan(){assert.fail("no write for stale scope");}}});
    await assert.rejects(activities.applyRefinementOperation({callerId:"console",...current}), {code:"apply_conflict"});
  }
});

test("Refinement planning cannot certify unexpected native creation", async () => {
  const current = planningCase();
  const activities = createRefinementActivities({sourceAdapter:sourceAdapter(current.tree),deliveryService:{async applyDeliveryPlan(){
    return {delivery_record_ref:"openproject://work_packages/884",plan_result:{created:[{record_ref:"openproject://work_packages/9999"}]}};
  }}});
  await assert.rejects(activities.applyRefinementOperation({callerId:"console",...current}), {code:"backend_readback_incomplete"});
});

test("Refinement final readback compares every accepted target and reuses the same fresh snapshot", async () => {
  let reads = 0;
  let passed;
  const currentPacket = packet();
  currentPacket.draft_groups[0].fields.push({backend_field:"planned_business_value",field_kind:"number",required:false,value:"",target_node_ids:["1003"]});
  const accepted = request();
  accepted.accepted_draft.metadata_values["planned_business_value:1003"] = "8.0";
  const snapshot = {deliveryRef:"openproject://work_packages/884",tree:{id:884,target_pi:"PI-2026-04",children:[
    {id:1002,delivery_team:"Team A",children:[]}, {id:1003,delivery_team:"Team B",planned_business_value:8,children:[]},
  ]}};
  const activities = createRefinementActivities({deliveryService:{},sourceAdapter:{
    async readDeliverySnapshot(){reads++;return snapshot;},
    async readCanonicalState(input){passed=input;return {source_revision:"canonical-digest"};},
  }});
  const result = await activities.readRefinementCanonicalState({packet:currentPacket,request:accepted,operationResults:[]});
  assert.equal(reads, 1);
  assert.equal(passed.snapshot, snapshot);
  assert.equal(result.source_revision,"canonical-digest");
  snapshot.tree.children[0].delivery_team = "Ignored by writer";
  await assert.rejects(activities.readRefinementCanonicalState({packet:currentPacket,request:accepted,operationResults:[]}),{code:"backend_readback_incomplete"});
  snapshot.tree.children.shift();
  await assert.rejects(activities.readRefinementCanonicalState({packet:currentPacket,request:accepted,operationResults:[]}),{code:"backend_readback_incomplete"});
});

test("Refinement bulk metadata refuses an absent reviewed id rather than updating unrelated work", async () => {
  const activities = createRefinementActivities({sourceAdapter:sourceAdapter({id:884,children:[]}),deliveryService:{async updateDeliveryWorkItem(){assert.fail("absent scope must not write");}}});
  await assert.rejects(activities.applyRefinementOperation({callerId:"console",packet:packet(),request:request(),operation:{kind:"bulk_update",status:"planned",oos_route:"POST /v1/delivery-work-items/bulk-update"}}),{code:"apply_conflict"});
});
