import { OpenProjectError } from "../errors.js";
import { REFINEMENT_METADATA_FIELDS } from "./packet-model.js";
import {
  acceptedRefinementValue,
  effectiveRefinementPlanningValue,
  isRefinementPlanningField,
} from "./planning-fields.js";

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
  execution_classification: "executionClassification",
  pi_objective_type: "piObjectiveType",
  actual_business_value: "actualBusinessValue",
  pi_objective_review_outcome: "piObjectiveReviewOutcome",
  roam_state: "roamState",
  risk_owner: "riskOwner",
  risk_review_date: "riskReviewDate",
  risk_disposition: "riskDisposition",
});

if (REFINEMENT_METADATA_FIELDS.some((field) => !FIELD_ARGUMENTS[field.backendField])) {
  throw new Error("Refinement metadata field has no existing Delivery writer argument.");
}

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
  const value = acceptedRefinementValue(field, request.accepted_draft, targetNodeId);
  return isRefinementPlanningField(field) ? String(value ?? "").trim() : value;
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
      if (field.target_node_ids?.length && !field.target_node_ids.includes(String(targetNodeId))) return [];
      const argument = FIELD_ARGUMENTS[field.backend_field];
      if (!argument) return [];
      const value = acceptedValue(request, field, targetNodeId);
      return value === "" && !field.required ? [] : [[argument, value]];
    }),
  );
}

function planNode(node, fields, request) {
  const accepted = argumentsFor(fields, request, String(node.id));
  return {
    type: node.type,
    subject: node.subject,
    // Native reconciliation is parent/type/subject based. Do not send a new
    // classification here: metadata applies it later by explicit work-item id.
    ...(node.execution_classification ? { executionClassification: node.execution_classification } : {}),
    // Absent fields stay native-retained; do not re-submit read-only values
    // merely because the whole coordinated hierarchy is present in the plan.
    ...(Object.hasOwn(accepted, "targetPi") ? { target_pi: accepted.targetPi } : {}),
    ...(Object.hasOwn(accepted, "iteration") ? { iteration: accepted.iteration } : {}),
    // Omit status/description: Refinement does not authorize execution or edits
    // to the accepted hierarchy's narratives. Native plan retains current state.
    children: (node.children ?? []).map((child) => planNode(child, fields, request)),
  };
}

function assertPlanningScope(current, accepted) {
  if (String(current.id) !== String(accepted.id) || current.type !== accepted.kind || current.subject !== accepted.title) {
    throw new RefinementActivityError("apply_conflict", "The reviewed planning hierarchy changed; reload Refinement before applying.");
  }
  const currentChildren = current.children ?? [];
  const acceptedChildren = accepted.children ?? [];
  const identities = currentChildren.map((child) => `${child.type.toLowerCase()}:${child.subject.trim().toLowerCase()}`);
  if (currentChildren.length !== acceptedChildren.length || new Set(identities).size !== identities.length) {
    throw new RefinementActivityError("apply_conflict", "The reviewed planning scope changed or contains ambiguous native identities.");
  }
  for (const child of currentChildren) {
    const reviewed = acceptedChildren.find((entry) => String(entry.id) === String(child.id));
    if (!reviewed) throw new RefinementActivityError("apply_conflict", "The reviewed planning scope no longer matches canonical work-item ids.");
    assertPlanningScope(child, reviewed);
  }
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
  if (field.target_node_ids?.length && !field.target_node_ids.includes(String(targetNodeId))) return false;
  const value = acceptedValue(request, field, targetNodeId);
  return field.required || value !== "" || isRefinementPlanningField(field);
}

function targetMatchesAcceptedValues(node, fields, request, targetNodeId) {
  return Boolean(node) && fields
    .filter((field) => fieldHasAcceptedEffect(field, request, targetNodeId))
    .every((field) =>
      comparableValue(node[field.backend_field], field) ===
        comparableValue(isRefinementPlanningField(field)
          ? effectiveRefinementPlanningValue(field, request.accepted_draft, targetNodeId)
          : acceptedValue(request, field, targetNodeId), field),
    );
}

function comparableValue(value, field) {
  const text = String(value ?? "").trim();
  return field.field_kind === "number" && text !== "" && Number.isFinite(Number(text)) ? String(Number(text)) : text;
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
          if (!nodesById.has(targetNodeId)) {
            throw new RefinementActivityError("apply_conflict", `Reviewed work item ${targetNodeId} is absent from the canonical hierarchy.`);
          }
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
        const snapshot = await sourceAdapter.readDeliverySnapshot({ packet });
        const nodesById = new Map(flattenTree(snapshot.tree).map((node) => [String(node.id), node]));
        const targetNodeIds = [...new Set(fields.flatMap((field) => field.target_node_ids ?? []))];
        if (targetNodeIds.length === 0) {
          throw new RefinementActivityError("request_invalid", "Coordinated planning has no reviewed field targets.");
        }
        const targetRefs = targetNodeIds.map((id) => `openproject://work_packages/${id}`);
        for (const field of fields) {
          for (const id of field.target_node_ids ?? []) {
            if (!field.required && acceptedValue(request, field, id) === "" &&
                comparableValue(nodesById.get(id)?.[field.backend_field], field) !==
                comparableValue(effectiveRefinementPlanningValue(field, request.accepted_draft, id), field)) {
              throw new RefinementActivityError("apply_conflict", `Retained planning for work item ${id} changed; reload Refinement before applying.`);
            }
          }
        }
        if (targetNodeIds.every((id) => targetMatchesAcceptedValues(nodesById.get(id), fields, request, id))) {
          return { operation_id: operation.operation_id, skipped: false, created_refs: [], updated_refs: [], reused_refs: targetRefs, target_refs: targetRefs };
        }
        assertPlanningScope(snapshot.tree, packet.target_tree);
        const result = await deliveryService.applyDeliveryPlan({
          callerId,
          correlationId: request.correlation_id,
          plan: {
            schema_version: 1,
            items: snapshot.tree.children.map((node) => planNode(node, fields, request)),
          },
          recordId: request.delivery_id,
          reconcileMissing: "ignore",
        });
        const createdRefs = resultRefs(result, "created");
        const writtenRefs = [...resultRefs(result, "updated"), ...resultRefs(result, "reused")];
        const knownRefs = new Set([...nodesById.keys()].map((id) => `openproject://work_packages/${id}`));
        if (!result?.delivery_record_ref || createdRefs.length || writtenRefs.some((ref) => !knownRefs.has(ref))) {
          throw new RefinementActivityError("backend_readback_incomplete", "Coordinated Refinement did not reconcile only the existing reviewed hierarchy; inspect canonical state before continuing.");
        }
        return {
          operation_id: operation.operation_id,
          skipped: false,
          created_refs: resultRefs(result, "created"),
          updated_refs: resultRefs(result, "updated"),
          reused_refs: resultRefs(result, "reused"),
          target_refs: targetRefs,
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

  async function readRefinementCanonicalState({ operationResults, packet, request }) {
    const snapshot = await sourceAdapter.readDeliverySnapshot({ packet });
    const nodesById = new Map(flattenTree(snapshot.tree).map((node) => [String(node.id), node]));
    for (const field of allFields(packet)) {
      for (const id of field.target_node_ids ?? []) {
        if (fieldHasAcceptedEffect(field, request, id) && !targetMatchesAcceptedValues(nodesById.get(String(id)), [field], request, id)) {
          throw new RefinementActivityError("backend_readback_incomplete", `Canonical work item ${id} does not contain the accepted ${field.backend_field} value.`);
        }
      }
    }
    return sourceAdapter.readCanonicalState({ operationResults, packet, snapshot });
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
