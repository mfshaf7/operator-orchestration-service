import assert from "node:assert/strict";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createRefinementSourceAdapter } from "../src/refinement/source-adapter.js";
import { encodeWorkDesignApplicationEvent } from "../src/work-design/application-event-codec.js";
import {
  buildWorkDesignApplicationEvent,
  workDesignApplicationId,
} from "../src/work-design/application-model.js";

const timestamp = "2026-08-26T01:00:00.000Z";

function workDesignRequest() {
  const tree = {
    id: "884",
    kind: "Epic",
    title: "Delivery initiative",
    description: "",
    draft_body: "",
    remark: "",
    children: [],
  };
  return {
    request_id: "work-design-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "work-design-key-1",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:909",
    source_ref: "openproject://work_packages/909",
    source_revision: "version-5",
    operator: { id: "operator:owner" },
    accepted_draft: { draft_digest: canonicalDigest(tree), tree },
  };
}

function deliveryTree() {
  return {
    id: 884,
    type: "Epic",
    subject: "Delivery initiative",
    target_pi: "PI-2026-03",
    owner_repo: "operator-orchestration-service",
    initiative_family: "operator-platform",
    lineage_role: "delivery",
    children: [{
      id: 1002,
      type: "Feature",
      subject: "Deliver runtime",
      target_pi: "PI-2026-03",
      owner_repo: "operator-orchestration-service",
      delivery_team: "Platform",
      iteration: "Iteration 2",
      assignee_login: "actual-project-assignee",
      responsible_login: "actual-project-accountable",
      execution_classification: "Business",
      acceptance_criteria: "Reviewed feature outcomes",
      definition_of_ready: "Accepted current inputs and owner",
      definition_of_done: "Verified output and durable evidence",
      planned_business_value: 8,
      children: [],
    }, {
      id: 1004,
      type: "PI Objective",
      subject: "Prove governed Refinement",
      target_pi: "PI-2026-03",
      owner_repo: "operator-orchestration-service",
      delivery_team: "Workflow Integration",
      iteration: "PI-2026-03 / Iteration 2",
      assignee_login: "actual-project-assignee",
      responsible_login: "actual-project-accountable",
      acceptance_criteria: "Actual objective success signal",
      definition_of_ready: "Approved objective and source plan",
      definition_of_done: "Actual outcome and earned-value review",
      pi_objective_type: "Committed",
      planned_business_value: 8,
      children: [],
    }],
  };
}

function workDesignCompletion() {
  const request = workDesignRequest();
  const applicationId = workDesignApplicationId(request);
  return buildWorkDesignApplicationEvent({
    eventType: "apply-completed",
    recordedAt: timestamp,
    request,
    requestDigest: canonicalDigest(request),
    result: {
      schema_version: 1,
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      application_id: applicationId,
      status: "applied",
      applied_at: timestamp,
      applied_by: request.operator.id,
      accepted_draft_digest: request.accepted_draft.draft_digest,
      target: {
        delivery_ref: "openproject://work_packages/884",
        created_refs: ["openproject://work_packages/1002"],
        updated_refs: [],
        reused_refs: [],
        readback_complete: true,
      },
    },
  });
}

function client() {
  const activities = [{
    id: 1,
    comment: encodeWorkDesignApplicationEvent(workDesignCompletion()),
    userRef: "/api/v3/users/5",
  }];
  return {
    activities,
    async addRefinementReceiptEvent({ raw }) {
      const activity = { id: activities.length + 1, comment: raw, userRef: "/api/v3/users/5" };
      activities.push(activity);
      return activity;
    },
    async getRefinementAutomationUserRef() { return "/api/v3/users/5"; },
    async getRefinementDeliveryTree() {
      return {
        deliveryRef: "openproject://work_packages/884",
        sourceRevision: "version-9",
        tree: deliveryTree(),
      };
    },
    async getWorkDesignAutomationUserRef() { return "/api/v3/users/5"; },
    async getWorkDesignSourceRevision() {
      return {
        recordId: 909,
        recordRef: "openproject://work_packages/909",
        sourceRevision: "version-5",
      };
    },
    async listRefinementActivities({ offset = 1, pageSize = 100 }) {
      const refinement = activities.filter((entry) =>
        entry.comment.startsWith("OOS_REFINEMENT_RECEIPT_EVENT_V1 "),
      );
      const start = (offset - 1) * pageSize;
      return {
        items: refinement.slice(start, start + pageSize),
        offset,
        pageSize,
        total: refinement.length,
      };
    },
    async listWorkDesignApplicationActivities({ offset = 1, pageSize = 100 }) {
      const workDesign = activities.filter((entry) =>
        entry.comment.startsWith("OOS_WORK_DESIGN_APPLICATION_EVENT_V1 "),
      );
      const start = (offset - 1) * pageSize;
      return {
        items: workDesign.slice(start, start + pageSize),
        offset,
        pageSize,
        total: workDesign.length,
      };
    },
  };
}

test("Refinement source derives one packet from trusted Work Design and canonical tree truth", async () => {
  const adapter = createRefinementSourceAdapter({ openProjectClient: client() });
  const packet = await adapter.projectPacket({
    packageRef: "delivery-package:909",
    sourceRef: "openproject://work_packages/909",
  });
  assert.equal(packet.source.delivery_id, "delivery-884");
  assert.equal(packet.source.source_work_design_receipt_id, workDesignApplicationId(workDesignRequest()));
  assert.equal(packet.target_tree.children[0].id, "1002");
  assert.equal(packet.target_tree.children[1].kind, "PI Objective");
  assert.equal(packet.status, "ready_for_review");
  const fields = packet.draft_groups.flatMap((group) => group.fields);
  assert.deepEqual(fields.find((field) => field.backend_field === "pi_objective_type").target_node_ids, ["1004"]);
  assert.deepEqual(fields.find((field) => field.backend_field === "execution_classification").target_node_ids, ["1002"]);
  assert.equal(fields.find((field) => field.backend_field === "actual_business_value").required, false);
  assert.equal(fields.find((field) => field.backend_field === "target_pi").field_kind, "short_text");
  assert.deepEqual(packet.apply_plan.operations.map((operation) => operation.kind), ["governance", "plan_apply", "bulk_update"]);
  for (const field of fields.filter((field) => field.route_binding.target === "work_item")) {
    assert.equal(field.route_binding.operation_kind, ["target_pi", "iteration"].includes(field.backend_field) ? "plan_apply" : "bulk_update");
  }
});

test("Refinement missing fields stay bound to target identity, not numeric object-key order", async () => {
  const native = client();
  const tree = deliveryTree();
  tree.children.reverse();
  tree.children[0].acceptance_criteria = "";
  native.getRefinementDeliveryTree = async () => ({deliveryRef:"openproject://work_packages/884",sourceRevision:"version-9",tree});
  const packet = await createRefinementSourceAdapter({openProjectClient:native}).projectPacket({
    packageRef:"delivery-package:909",sourceRef:"openproject://work_packages/909",
  });
  const field = packet.draft_groups.flatMap(group=>group.fields).find(field=>field.backend_field==="acceptance_criteria");
  assert.equal(field.target_statuses["1004"], "missing");
  assert.equal(field.target_statuses["1002"], "complete");
  assert.equal(packet.status, "drafting");
  const gate = packet.readiness_gates.find((gate) => gate.label === "Metadata Review");
  assert.equal(gate.status, "open");
  assert.equal(gate.oos_route, "POST /v1/delivery-work-items/bulk-update",
    "the existing Console metadata draft review must be able to resolve its native editable gate");
});

test("Refinement keeps valid backlog planning optional beside required committed and active work", async () => {
  const native = client();
  const tree = deliveryTree();
  tree.children.push(
    {id:1010,type:"Feature",subject:"Future feature",status:"new",target_pi:null,iteration:null,children:[
      {id:1011,type:"User story",subject:"Future story",status:"parked",target_pi:null,iteration:"Not committed to a PI iteration yet.",children:[]},
    ]},
    {id:1012,type:"User story",subject:"Active needs planning",status:"ready",children:[]},
    {id:1013,type:"Task",subject:"Structural planning",status:"new",children:[]},
    {id:1014,type:"Milestone",subject:"Checkpoint",status:"new",children:[]},
    {id:1015,type:"Feature",subject:"Old history",status:"done",children:[]},
  );
  native.getRefinementDeliveryTree = async () => ({tree,deliveryRef:"openproject://work_packages/884",sourceRevision:"version-9"});
  const packet = await createRefinementSourceAdapter({openProjectClient:native}).projectPacket({packageRef:"delivery-package:909",sourceRef:"openproject://work_packages/909"});
  const fields = packet.draft_groups.flatMap(group=>group.fields).filter(field=>field.route_binding.operation_kind==="plan_apply");
  for(const key of ["target_pi","iteration"]){
    const optional=fields.find(field=>field.backend_field===key&&!field.required);
    assert.deepEqual(optional.target_node_ids,["1010","1011"]);
    assert.equal(optional.status,"complete");
    assert.equal(optional.target_statuses["1010"],"complete");
    const required=fields.find(field=>field.backend_field===key&&field.required);
    assert.deepEqual(required.target_node_ids,["1002","1004","1012","1013","1014"]);
    assert.equal(required.target_statuses["1012"],"missing");
    assert.equal(required.target_statuses["1002"],"complete");
    assert.equal(fields.some(field=>field.backend_field===key&&field.target_node_ids.includes("1015")),false);
  }
  const allowedKeys=fields.flatMap(field=>field.target_node_ids.map(id=>`${field.backend_field}:${id}`));
  assert.equal(new Set(allowedKeys).size,allowedKeys.length,"required/optional scopes cannot overlap");
  const backlog=packet.draft_groups.find(group=>group.group_id.endsWith("-backlog-planning"));
  assert.equal(backlog.fields.length,2);
  assert.ok(backlog.fields.every(field=>!field.required));
  for(const field of fields.filter(field=>field.required))assert.ok(!backlog.fields.includes(field),
    "shared selection must not merge different requiredness into a first-target editor");
});

test("Refinement does not demand or offer a write for an unavailable blank backlog planning field",async()=>{
  const native=client();const tree=deliveryTree();
  tree.children.push({id:1010,type:"Feature",subject:"Future",status:"new",children:[]});
  native.getRefinementDeliveryTree=async()=>({tree,fieldMetadata:{1010:{target_pi:{writable:false,field_kind:"short_text"},iteration:{writable:false,field_kind:"short_text"}}}});
  const packet=await createRefinementSourceAdapter({openProjectClient:native}).projectPacket({packageRef:"delivery-package:909",sourceRef:"openproject://work_packages/909"});
  const planning=packet.draft_groups.flatMap(g=>g.fields).filter(f=>["target_pi","iteration"].includes(f.backend_field));
  assert.equal(planning.some(f=>f.target_node_ids.includes("1010")),false);
});

test("Refinement receipt persistence replays identical output without duplicate comments", async () => {
  const openProjectClient = client();
  const adapter = createRefinementSourceAdapter({ openProjectClient });
  const request = {
    ...workDesignRequest(),
    request_id: "refinement-apply-1",
    accepted_draft: {
      draft_digest: `sha256:${"d".repeat(64)}`,
      source_work_design_receipt_id: workDesignApplicationId(workDesignRequest()),
    },
  };
  const input = {
    appliedAt: timestamp,
    readback: {
      delivery_ref: "openproject://work_packages/884",
      created_refs: [],
      updated_refs: ["openproject://work_packages/1002"],
      reused_refs: [],
      source_revision: "version-10",
    },
    request,
    runId: "refinement-run-1",
  };
  const first = await adapter.persistReceipt(input);
  const second = await adapter.persistReceipt(input);
  assert.equal(first.receipt_digest, second.receipt_digest);
  assert.equal(first.receipt_ref, second.receipt_ref);
  assert.equal(
    openProjectClient.activities.filter((entry) =>
      entry.comment.startsWith("OOS_REFINEMENT_RECEIPT_EVENT_V1 "),
    ).length,
    1,
  );
});


test("Refinement retains terminal history without root fallback and still requires current metadata", async () => {
  const current = client();
  const tree = deliveryTree();
  tree.children[0].status = "retired";
  tree.children[1].status = "done";
  for (const node of tree.children) {
    node.target_pi = "";
    node.acceptance_criteria = "";
  }
  current.getRefinementDeliveryTree = async () => ({tree, sourceRevision: "version-9", deliveryRef: "openproject://work_packages/884"});
  const adapter = createRefinementSourceAdapter({openProjectClient: current});
  const input = {packageRef: "delivery-package:909", sourceRef: "openproject://work_packages/909"};
  const historical = await adapter.projectPacket(input);
  assert.equal(historical.target_tree.children.length, 2);
  assert.equal(historical.status, "ready_for_review");
  assert.ok(historical.draft_groups.flatMap(group => group.fields).every(field => field.route_binding.target === "initiative"),
    "terminal-only branches must not create new work-item duties on the initiative");
  tree.children[0].children.push({...deliveryTree().children[0], id: 1005, status: "blocked", target_pi: ""});
  const currentPacket = await adapter.projectPacket(input);
  assert.notEqual(currentPacket.packet_revision, historical.packet_revision);
  assert.equal(currentPacket.status, "drafting");
  const pi = currentPacket.draft_groups.flatMap(group => group.fields).find(field => field.field_key === "work_item-target-pi");
  assert.deepEqual(pi.target_node_ids, ["1005"]);
  assert.equal(pi.target_statuses["1005"], "missing");
});
