import { HttpError, OpenProjectError } from "./errors.js";
import { parseIdeaId, toIdeaId } from "./idea-model.js";
import {
  getWorkflowDescriptor,
  listWorkflowDescriptors,
} from "./workflow-catalog.js";

const BACKEND_LIST_LIMIT = 25;

function toIdeaProjection(result) {
  return {
    body: result.body,
    created_at: result.createdAt,
    evaluation: {
      affected_scope: result.evaluation?.affectedScope ?? [],
      ai_assist_lane: result.evaluation?.aiAssistLane ?? null,
      confidence: result.evaluation?.confidence ?? null,
      notes: result.evaluation?.notes ?? null,
      suspected_owner: result.evaluation?.suspectedOwner ?? null,
      trust_boundary_areas: result.evaluation?.trustBoundaryAreas ?? [],
    },
    idea_id: result.ideaId,
    operator: result.operator,
    operator_decision_notes: result.operatorDecisionNotes,
    record_ref: result.recordRef,
    record_system: "openproject",
    source: result.source,
    status: result.status,
    title: result.title,
    triage_summary: result.triageSummary,
    updated_at: result.updatedAt,
    workflow_id: "idea-capture",
  };
}

function toIdeaListItem(result) {
  const bodyPreview =
    typeof result.body === "string" && result.body.trim()
      ? `${result.body.trim().slice(0, 157).trimEnd()}${
          result.body.trim().length > 157 ? "…" : ""
        }`
      : null;

  return {
    body_preview: bodyPreview,
    created_at: result.createdAt,
    idea_id: result.ideaId,
    record_ref: result.recordRef,
    record_system: "openproject",
    source: result.source,
    status: result.status,
    title: result.title,
    updated_at: result.updatedAt,
    workflow_id: "idea-capture",
  };
}

function buildIdeaListResponse({ items, limit, offset, total }) {
  const count = items.length;
  const nextOffset =
    offset + count <= total
      ? offset + count
      : null;
  const previousOffset =
    offset > 1 ? Math.max(1, offset - limit) : null;

  return {
    ideas: items.map((entry) => toIdeaListItem(entry)),
    page: {
      count,
      has_more: nextOffset !== null,
      limit,
      next_offset: nextOffset,
      offset,
      previous_offset: previousOffset,
      total,
    },
  };
}

async function listIdeasByStatus({ openProjectClient, status }) {
  const matches = [];
  let offset = 1;

  while (true) {
    const result = await openProjectClient.listIdeas({
      limit: BACKEND_LIST_LIMIT,
      offset,
    });
    const filteredItems = result.items.filter(
      (entry) => entry.status?.trim().toLowerCase() === status,
    );
    matches.push(...filteredItems);

    const nextOffset =
      result.offset + result.count <= result.total
        ? result.offset + result.count
        : null;
    if (nextOffset === null) {
      break;
    }

    offset = nextOffset;
  }

  return matches;
}

export function createIdeaService({ openProjectClient, audit }) {
  return {
    async listWorkflows({ callerId, correlationId }) {
      audit.emit({
        caller: {
          id: callerId,
        },
        correlation_id: correlationId,
        event_type: "workflow.catalog.served",
        outcome: "success",
      });

      return {
        workflows: listWorkflowDescriptors(),
      };
    },

    async getWorkflowDescriptor({ callerId, correlationId, workflowId }) {
      const descriptor = getWorkflowDescriptor(workflowId);

      if (!descriptor) {
        return null;
      }

      audit.emit({
        caller: {
          id: callerId,
        },
        correlation_id: correlationId,
        event_type: "workflow.descriptor.served",
        outcome: "success",
        workflow: {
          id: workflowId,
        },
      });

      return descriptor;
    },

    async captureIdea({ correlationId, callerId, operator, source, title, body }) {
      audit.emit({
        event_type: "idea.capture.requested",
        correlation_id: correlationId,
        operator: {
          id: operator.id,
          handle: operator.handle ?? null,
        },
        caller: {
          id: callerId,
        },
        source,
        outcome: "requested",
      });

      try {
        const result = await openProjectClient.captureIdea({
          operator,
          source,
          title,
          body,
        });

        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
          },
          caller: {
            id: callerId,
          },
          source,
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "created",
          },
          outcome: "success",
          status: result.status,
        });

        audit.emit({
          event_type: "idea.capture.recorded",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
            handle: operator.handle ?? null,
          },
          caller: {
            id: callerId,
          },
          source,
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "created",
          },
          outcome: "success",
          status: result.status,
        });

        return {
          idea_id: toIdeaId(result.id),
          record_system: "openproject",
          record_ref: result.recordRef,
          status: "captured",
          workflow_id: "idea-capture",
        };
      } catch (error) {
        const failure = error instanceof OpenProjectError ? error : null;

        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
          },
          caller: {
            id: callerId,
          },
          source,
          backend: {
            system: "openproject",
            target_ref: "openproject://projects/unknown",
            result: "failed",
          },
          outcome: "failure",
          status: "capture_failed",
          error_class: failure?.errorClass ?? "unexpected_error",
        });

        throw error;
      }
    },

    async getIdea({ callerId, correlationId, ideaId }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getIdea(recordId);

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "idea.record.read",
          outcome: "success",
          status: result.status,
        });

        return toIdeaProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "idea.record.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async listIdeas({ callerId, correlationId, limit, offset, status = null }) {
      try {
        let response;
        if (status) {
          const filteredItems = await listIdeasByStatus({
            openProjectClient,
            status,
          });
          response = buildIdeaListResponse({
            items: filteredItems.slice(offset - 1, offset - 1 + limit),
            limit,
            offset,
            total: filteredItems.length,
          });
        } else {
          const result = await openProjectClient.listIdeas({ limit, offset });
          response = buildIdeaListResponse({
            items: result.items,
            limit: result.limit,
            offset: result.offset,
            total: result.total,
          });
        }

        audit.emit({
          backend: {
            result: "listed",
            system: "openproject",
            target_ref: "openproject://projects/workspace-proposals",
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "idea.record.list",
          outcome: "success",
          status_filter: status,
          status: "listed",
        });

        return response;
      } catch (error) {
        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: "openproject://projects/workspace-proposals",
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "idea.record.list",
          outcome: "failure",
          status_filter: status,
          status: "list_failed",
        });

        throw error;
      }
    },

    async lookupIdea({ callerId, correlationId, source }) {
      try {
        const result = await openProjectClient.lookupIdeaBySource(source);

        audit.emit({
          backend: {
            result: result ? "matched" : "not_found",
            system: "openproject",
            target_ref: result?.recordRef ?? null,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "idea.record.lookup",
          outcome: "success",
          source,
          status: result?.status ?? "not_found",
        });

        return result ? toIdeaProjection(result) : null;
      } catch (error) {
        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: "openproject://work_packages/lookup",
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "idea.record.lookup",
          outcome: "failure",
          source,
          status: "lookup_failed",
        });

        throw error;
      }
    },

    async triageIdea({ callerId, correlationId, ideaId, operator, summary }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      audit.emit({
        caller: {
          id: callerId,
        },
        correlation_id: correlationId,
        event_type: "idea.triage.requested",
        idea_id: ideaId,
        operator: {
          handle: operator.handle ?? null,
          id: operator.id,
        },
        outcome: "requested",
        status: "triage_requested",
      });

      let current;
      try {
        current = await openProjectClient.getIdea(recordId);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        throw error;
      }

      const currentStatus = current.status?.trim().toLowerCase() ?? "";
      if (currentStatus !== "captured" && currentStatus !== "triaged") {
        throw new HttpError(
          409,
          "triage_status_invalid",
          `Idea ${ideaId} is currently ${current.status} and cannot be triaged from that state.`,
        );
      }

      try {
        const result = await openProjectClient.triageIdea({
          recordId,
          summary,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "backend.openproject.write",
          outcome: "success",
          status: result.status,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "idea.triage.recorded",
          idea_id: result.ideaId,
          operator: {
            handle: operator.handle ?? null,
            id: operator.id,
          },
          outcome: "success",
          status: result.status,
        });

        return {
          idea_id: result.ideaId,
          record_ref: result.recordRef,
          record_system: "openproject",
          status: result.status,
          triage_summary: result.triageSummary,
          updated_at: result.updatedAt,
          workflow_id: "idea-triage",
        };
      } catch (error) {
        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: current.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "backend.openproject.write",
          outcome: "failure",
          status: "triage_failed",
        });

        throw error;
      }
    },

    async decideIdea({ callerId, correlationId, ideaId, operator, status, notes }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      audit.emit({
        event_type: "idea.decision.requested",
        correlation_id: correlationId,
        operator: {
          id: operator.id,
          handle: operator.handle ?? null,
        },
        caller: {
          id: callerId,
        },
        outcome: "requested",
        status,
      });

      const current = await openProjectClient.getIdea(recordId);
      if (!current) {
        return null;
      }

      const currentStatus = current.status?.trim().toLowerCase() ?? "";
      if (
        currentStatus !== "triaged" &&
        currentStatus !== "parked" &&
        currentStatus !== "accepted" &&
        currentStatus !== "rejected"
      ) {
        throw new HttpError(
          409,
          "decision_status_invalid",
          `Idea ${ideaId} is currently ${current.status} and cannot be decided from that state.`,
        );
      }

      try {
        const result = await openProjectClient.decideIdea({
          notes,
          recordId,
          status,
        });

        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
          },
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "updated",
          },
          outcome: "success",
          status: result.status,
        });

        audit.emit({
          event_type: "idea.decision.recorded",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
            handle: operator.handle ?? null,
          },
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "updated",
          },
          outcome: "success",
          status: result.status,
        });

        return {
          idea_id: result.ideaId,
          operator_decision_notes: result.operatorDecisionNotes,
          record_ref: result.recordRef,
          record_system: "openproject",
          status: result.status,
          updated_at: result.updatedAt,
          workflow_id: "idea-decision",
        };
      } catch (error) {
        const failure = error instanceof OpenProjectError ? error : null;

        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          operator: {
            id: operator.id,
          },
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: current.recordRef,
            result: "failed",
          },
          outcome: "failure",
          status: "decision_failed",
          error_class: failure?.errorClass ?? "unexpected_error",
        });

        throw error;
      }
    },

    async recordIdeaEvaluation({
      callerId,
      correlationId,
      ideaId,
      evaluation,
    }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      audit.emit({
        event_type: "idea.evaluation.requested",
        correlation_id: correlationId,
        caller: {
          id: callerId,
        },
        idea_id: ideaId,
        outcome: "requested",
        status: "evaluation_requested",
      });

      let current;
      try {
        current = await openProjectClient.getIdea(recordId);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        throw error;
      }

      try {
        const result = await openProjectClient.recordIdeaEvaluation({
          evaluation,
          recordId,
        });

        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "updated",
          },
          outcome: "success",
          status: result.status,
        });

        audit.emit({
          event_type: "idea.evaluation.recorded",
          correlation_id: correlationId,
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: result.recordRef,
            result: "updated",
          },
          outcome: "success",
          status: result.status,
        });

        return {
          evaluation: {
            affected_scope: result.evaluation?.affectedScope ?? [],
            ai_assist_lane: result.evaluation?.aiAssistLane ?? null,
            confidence: result.evaluation?.confidence ?? null,
            notes: result.evaluation?.notes ?? null,
            suspected_owner: result.evaluation?.suspectedOwner ?? null,
            trust_boundary_areas: result.evaluation?.trustBoundaryAreas ?? [],
          },
          idea_id: result.ideaId,
          record_ref: result.recordRef,
          record_system: "openproject",
          status: result.status,
          updated_at: result.updatedAt,
          workflow_id: "idea-evaluation-metadata",
        };
      } catch (error) {
        audit.emit({
          event_type: "backend.openproject.write",
          correlation_id: correlationId,
          caller: {
            id: callerId,
          },
          backend: {
            system: "openproject",
            target_ref: current.recordRef,
            result: "failed",
          },
          outcome: "failure",
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          status: "evaluation_failed",
        });

        throw error;
      }
    },
  };
}
