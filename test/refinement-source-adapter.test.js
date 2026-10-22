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
