import { OpenProjectError } from "../errors.js";

const FIELD_ARGUMENTS = Object.freeze({
  acceptance_criteria: "acceptanceCriteria",
  architecture_anchor_ref: "architectureAnchorRef",
  assignee_login: "assigneeLogin",
  business_objective: "businessObjective",
  definition_of_done: "definitionOfDone",
  definition_of_ready: "definitionOfReady",
  delivery_team: "deliveryTeam",
  initiative_family: "initiativeFamily",
  iteration: "iteration",
  lineage_role: "lineageRole",
  nfr_category: "nfrCategory",
  owner_repo: "ownerRepo",
  planned_business_value: "plannedBusinessValue",
  pm2_phase: "pm2Phase",
  required_upstream_ref: "requiredUpstreamRef",
  responsible_login: "responsibleLogin",
  sponsor: "sponsor",
  success_criteria: "successCriteria",
  target_pi: "targetPi",
});

export class RefinementActivityError extends Error {
  constructor(code, message, { cause = null, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    // Temporal's default failure converter preserves Error.name as failure type.
    this.name = code;
    this.code = code;
    this.retryable = retryable;
  }
}

function nodeIdFromRef(value) {
  const match = String(value ?? "").match(/(?:work_packages\/|#)([1-9][0-9]*)$/);
  return match ? match[1] : null;
}

function allFields(packet) {
  return packet.draft_groups.flatMap((group) => group.fields);
}

function acceptedValue(request, field, targetNodeId) {
  const specificKey = `${field.backend_field}:${targetNodeId}`;
  if (Object.hasOwn(request.accepted_draft.metadata_values, specificKey)) {
    return request.accepted_draft.metadata_values[specificKey];
  }
  if (Object.hasOwn(request.accepted_draft.metadata_values, field.backend_field)) {
    return request.accepted_draft.metadata_values[field.backend_field];
  }
  return field.target_values?.[targetNodeId] ?? field.value;
}

function operationFields(packet, operation) {
  return allFields(packet).filter(
    (field) =>
      field.route_binding.operation_kind === operation.kind &&
      field.route_binding.oos_route === operation.oos_route,
  );
}

function argumentsFor(fields, request, targetNodeId) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const argument = FIELD_ARGUMENTS[field.backend_field];
      if (!argument) return [];
      const value = acceptedValue(request, field, targetNodeId);
      return value === "" && !field.required ? [] : [[argument, value]];
    }),
  );
}

function planNode(node) {
  return {
    type: node.kind,
    subject: node.title,
    description: node.draft_body || node.description,
    children: node.children.map(planNode),
  };
}

function resultRefs(result, field) {
  return (result?.plan_result?.[field] ?? [])
    .map((entry) => entry.record_ref ?? entry.work_item_record_ref)
    .filter(Boolean);
}

function flattenTree(node) {
  return [node, ...(node.children ?? []).flatMap(flattenTree)];
}

function fieldHasAcceptedEffect(field, request, targetNodeId) {
  const value = acceptedValue(request, field, targetNodeId);
  return field.required || value !== "";
}

function targetMatchesAcceptedValues(node, fields, request, targetNodeId) {
  return fields
    .filter((field) => fieldHasAcceptedEffect(field, request, targetNodeId))
    .every((field) =>
      String(node?.[field.backend_field] ?? "") ===
        String(acceptedValue(request, field, targetNodeId)),
    );
}

export function createRefinementActivities({ deliveryService, sourceAdapter }) {
  async function applyRefinementOperation({ callerId, operation, packet, request }) {
    if (operation.status === "skipped") {
      return {
        operation_id: operation.operation_id,
        skipped: true,
        created_refs: [],
        updated_refs: [],
        reused_refs: [],
        target_refs: [],
      };
    }
    const fields = operationFields(packet, operation);
    try {
      if (operation.kind === "governance") {
        const targetNodeId = nodeIdFromRef(operation.target);
        const snapshot = await sourceAdapter.readDeliverySnapshot({ packet });
        if (
          targetMatchesAcceptedValues(
            snapshot.tree,
            fields,
            request,
            targetNodeId,
          )
        ) {
          return {
            operation_id: operation.operation_id,
            skipped: false,
            created_refs: [],
            updated_refs: [],
            reused_refs: [snapshot.deliveryRef],
            target_refs: [snapshot.deliveryRef],
          };
        }
        const result = await deliveryService.updateDeliveryInitiative({
          ...argumentsFor(fields, request, targetNodeId),
          callerId,
          correlationId: request.correlation_id,
          recordId: request.delivery_id,
        });
        if (!result?.delivery_record_ref) {
          throw new RefinementActivityError(
            "backend_readback_incomplete",
            "Refinement governance update did not return canonical Delivery state.",
          );
        }
        return {
          operation_id: operation.operation_id,
          skipped: false,
          created_refs: [],
          updated_refs: [result.delivery_record_ref],
          reused_refs: [],
          target_refs: [result.delivery_record_ref],
        };
      }

      if (operation.kind === "bulk_update") {
        const targetNodeIds = [
          ...new Set(fields.flatMap((field) => field.target_node_ids ?? [])),
        ];
        const snapshot = await sourceAdapter.readDeliverySnapshot({ packet });
        const nodesById = new Map(
          flattenTree(snapshot.tree).map((node) => [String(node.id), node]),
        );
        const updatedRefs = [];
        const reusedRefs = [];
        for (const targetNodeId of targetNodeIds) {
          const targetRef = `openproject://work_packages/${targetNodeId}`;
          if (
            targetMatchesAcceptedValues(
              nodesById.get(targetNodeId),
              fields,
              request,
              targetNodeId,
            )
          ) {
            reusedRefs.push(targetRef);
            continue;
          }
          const result = await deliveryService.updateDeliveryWorkItem({
            ...argumentsFor(fields, request, targetNodeId),
            callerId,
            correlationId: request.correlation_id,
            workItemId: `work-item-${targetNodeId}`,
            workNote: `Refinement run ${request.request_id} applied accepted metadata.`,
          });
          if (!result?.work_item_record_ref) {
            throw new RefinementActivityError(
              "backend_readback_incomplete",
              `Refinement update for work item ${targetNodeId} returned no canonical reference.`,
            );
          }
          updatedRefs.push(result.work_item_record_ref);
        }
        return {
          operation_id: operation.operation_id,
          skipped: false,
          created_refs: [],
          updated_refs: updatedRefs,
          reused_refs: reusedRefs,
          target_refs: [...updatedRefs, ...reusedRefs],
        };
      }

      if (operation.kind === "plan_apply") {
        const result = await deliveryService.applyDeliveryPlan({
          callerId,
          correlationId: request.correlation_id,
          plan: {
            schema_version: 1,
            items: packet.target_tree.children.map(planNode),
          },
          recordId: request.delivery_id,
          reconcileMissing: "ignore",
        });
        return {
          operation_id: operation.operation_id,
          skipped: false,
          created_refs: resultRefs(result, "created"),
          updated_refs: resultRefs(result, "updated"),
          reused_refs: resultRefs(result, "reused"),
          target_refs: [result?.delivery_record_ref].filter(Boolean),
        };
      }

      if (operation.kind === "work_item_update") {
        const targetNodeId = nodeIdFromRef(operation.target);
        if (!targetNodeId) {
          throw new RefinementActivityError(
            "request_invalid",
            "Refinement work-item update target is invalid.",
          );
        }
        const result = await deliveryService.updateDeliveryWorkItem({
          ...argumentsFor(fields, request, targetNodeId),
          callerId,
          correlationId: request.correlation_id,
          workItemId: `work-item-${targetNodeId}`,
          workNote: `Refinement run ${request.request_id} applied accepted metadata.`,
        });
        return {
          operation_id: operation.operation_id,
          skipped: false,
          created_refs: [],
          updated_refs: [result.work_item_record_ref],
          reused_refs: [],
          target_refs: [result.work_item_record_ref],
        };
      }

      throw new RefinementActivityError(
        "request_invalid",
        `Refinement operation kind ${operation.kind} is not executable by this definition.`,
      );
    } catch (error) {
      if (error instanceof RefinementActivityError) throw error;
      throw activityFailure(error);
    }
  }

  async function readRefinementCanonicalState({ operationResults, packet }) {
    return sourceAdapter.readCanonicalState({ operationResults, packet });
  }

  async function persistRefinementReceipt({ appliedAt, readback, request, runId }) {
    return sourceAdapter.persistReceipt({ appliedAt, readback, request, runId });
  }

  return {
    applyRefinementOperation,
    persistRefinementReceipt,
    readRefinementCanonicalState,
  };
}

function activityFailure(error) {
  const conflict =
    error instanceof OpenProjectError && error.errorClass === "update_conflict";
  const retryable =
    error instanceof OpenProjectError && error.errorClass === "backend_unavailable";
  return new RefinementActivityError(
    conflict ? "apply_conflict" : "apply_execution_failed",
    error instanceof Error ? error.message : "Refinement operation failed.",
    { cause: error, retryable },
  );
}
