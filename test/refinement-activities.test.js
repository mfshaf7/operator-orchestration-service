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
