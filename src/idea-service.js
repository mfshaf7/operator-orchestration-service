import { createHash } from "node:crypto";

import { HttpError, OpenProjectError } from "./errors.js";
import { parseIdeaId, toIdeaId } from "./idea-model.js";
import {
  getWorkflowDescriptor,
  listWorkflowDescriptors,
} from "./workflow-catalog.js";

const BACKEND_LIST_LIMIT = 25;
const DELIVERY_CLOSEOUT_SOURCE_STATUSES = new Set(["accepted", "implemented"]);

function toIdeaProjection(result) {
  return {
    body: result.body,
    created_at: result.createdAt,
    delivery_closeout_notes: result.deliveryCloseoutNotes ?? null,
    delivery_ref: result.deliveryRef ?? null,
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

async function listIdeasForDeliveryCloseout({ openProjectClient }) {
  const matches = [];
  let offset = 1;

  while (true) {
    const result = await openProjectClient.listIdeas({
      limit: BACKEND_LIST_LIMIT,
      offset,
    });
    matches.push(
      ...result.items.filter((entry) =>
        DELIVERY_CLOSEOUT_SOURCE_STATUSES.has(
          entry.status?.trim().toLowerCase() ?? "",
        ),
      ),
    );

    const nextOffset =
      result.offset + result.count <= result.total
        ? result.offset + result.count
        : null;
    if (nextOffset === null) {
      return matches;
    }
    offset = nextOffset;
  }
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

    async consumeIdea({
      callerId,
      correlationId,
      ideaId,
      operator,
      ownerRepo = null,
      targetPi = null,
    }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      audit.emit({
        event_type: "idea.consume.requested",
        correlation_id: correlationId,
        operator: {
          id: operator.id,
          handle: operator.handle ?? null,
        },
        caller: {
          id: callerId,
        },
        idea_id: ideaId,
        outcome: "requested",
        status: "consume_requested",
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
      if (currentStatus !== "accepted") {
        throw new HttpError(
          409,
          "consume_status_invalid",
          `Idea ${ideaId} is currently ${current.status} and cannot be consumed from that state.`,
        );
      }

      try {
        const result = await openProjectClient.consumeAcceptedIdea({
          currentRecord: current,
          ownerRepo,
          recordId,
          targetPi,
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
            target_ref: result.deliveryRecord.recordRef,
            related_target_ref: result.sourceRecord.recordRef,
            result: result.deliveryCreated ? "created" : "reused",
          },
          outcome: "success",
          status: result.deliveryRecord.status ?? "existing",
        });

        audit.emit({
          event_type: "idea.consume.recorded",
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
            target_ref: result.deliveryRecord.recordRef,
            related_target_ref: result.sourceRecord.recordRef,
            result: result.deliveryCreated ? "created" : "reused",
          },
          outcome: "success",
          status: result.deliveryRecord.status ?? "existing",
        });

        return {
          delivery_created: result.deliveryCreated,
          delivery_pm2_phase: result.deliveryRecord.pm2Phase,
          delivery_record_ref: result.deliveryRecord.recordRef,
          delivery_record_system: "openproject",
          delivery_status: result.deliveryRecord.status,
          delivery_ref: result.sourceRecord.deliveryRef ?? result.deliveryRecord.recordRef,
          idea_id: result.sourceRecord.ideaId,
          owner_repo: result.deliveryRecord.ownerRepo ?? null,
          record_ref: result.sourceRecord.recordRef,
          record_system: "openproject",
          source_updated: result.sourceUpdated,
          status: result.sourceRecord.status,
          target_pi: result.deliveryRecord.targetPi ?? targetPi,
          updated_at: result.sourceRecord.updatedAt,
          workflow_id: "accepted-idea-delivery-consume",
        };
      } catch (error) {
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
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          status: "consume_failed",
        });

        throw error;
      }
    },

    async closeoutIdea({
      callerId,
      correlationId,
      ideaId,
      operator,
      closeoutNotes,
    }) {
      const recordId = parseIdeaId(ideaId);

      if (!recordId) {
        return null;
      }

      audit.emit({
        event_type: "idea.closeout.requested",
        correlation_id: correlationId,
        operator: {
          id: operator.id,
          handle: operator.handle ?? null,
        },
        caller: {
          id: callerId,
        },
        idea_id: ideaId,
        outcome: "requested",
        status: "closeout_requested",
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
      if (!DELIVERY_CLOSEOUT_SOURCE_STATUSES.has(currentStatus)) {
        throw new HttpError(
          409,
          "closeout_status_invalid",
          `Idea ${ideaId} is currently ${current.status} and cannot be closed out from that state.`,
        );
      }

      if (!current.deliveryRef) {
        throw new HttpError(
          409,
          "closeout_delivery_ref_missing",
          `Idea ${ideaId} does not yet have a linked delivery record.`,
        );
      }

      try {
        const result = await openProjectClient.closeAcceptedIdeaDelivery({
          closeoutNotes,
          currentRecord: current,
          recordId,
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
            target_ref: result.sourceRecord.recordRef,
            related_target_ref: result.deliveryRecord.recordRef,
            result: result.replayed ? "replayed" : "updated",
          },
          outcome: "success",
          status: result.sourceRecord.status,
        });

        audit.emit({
          event_type: "idea.closeout.recorded",
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
            target_ref: result.sourceRecord.recordRef,
            related_target_ref: result.deliveryRecord.recordRef,
            result: result.replayed ? "replayed" : "updated",
          },
          outcome: "success",
          status: result.sourceRecord.status,
        });

        return {
          closeout_outcome: result.replayed ? "replayed" : "implemented",
          delivery_closeout_notes: result.sourceRecord.deliveryCloseoutNotes,
          delivery_record_ref: result.deliveryRecord.recordRef,
          delivery_record_system: "openproject",
          delivery_status: result.deliveryRecord.status,
          delivery_ref: result.sourceRecord.deliveryRef,
          idea_id: result.sourceRecord.ideaId,
          operator_decision_notes: result.sourceRecord.operatorDecisionNotes,
          record_ref: result.sourceRecord.recordRef,
          record_system: "openproject",
          status: result.sourceRecord.status,
          updated_at: result.sourceRecord.updatedAt,
          workflow_id: "accepted-idea-delivery-closeout",
        };
      } catch (error) {
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
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          status: "closeout_failed",
        });

        throw error;
      }
    },

    async reconcileIdeaDeliveryCloseouts({
      apply,
      callerId,
      closeoutNotes,
      correlationId,
      expectedCandidateDigest,
      operator,
    }) {
      const ideas = await listIdeasForDeliveryCloseout({ openProjectClient });
      const items = [];
      const candidates = [];

      for (const idea of ideas) {
        if (!idea.deliveryRef) {
          items.push({
            action: "none",
            delivery_ref: null,
            delivery_status: null,
            idea_id: idea.ideaId,
            outcome: "delivery_ref_missing",
            source_status: idea.status,
          });
          continue;
        }

        try {
          const inspection = await openProjectClient.inspectAcceptedIdeaDelivery({
            currentRecord: idea,
          });
          const currentStatus = idea.status?.trim().toLowerCase() ?? "";
          if (currentStatus === "implemented") {
            items.push({
              action: "none",
              delivery_ref: inspection.deliveryRecord.recordRef,
              delivery_status: inspection.deliveryRecord.status,
              idea_id: idea.ideaId,
              outcome: "already_implemented",
              source_status: idea.status,
            });
            continue;
          }

          if (!inspection.eligible) {
            items.push({
              action: "none",
              delivery_ref: inspection.deliveryRecord.recordRef,
              delivery_status: inspection.deliveryRecord.status,
              idea_id: idea.ideaId,
              outcome: inspection.reason,
              source_status: idea.status,
            });
            continue;
          }

          candidates.push({
            idea,
            itemIndex: items.length,
          });
          items.push({
            action: "would_close",
            delivery_ref: inspection.deliveryRecord.recordRef,
            delivery_status: inspection.deliveryRecord.status,
            idea_id: idea.ideaId,
            outcome: "eligible",
            source_status: idea.status,
          });
        } catch (error) {
          items.push({
            action: "none",
            delivery_ref: idea.deliveryRef,
            delivery_status: null,
            error: {
              code:
                error instanceof OpenProjectError
                  ? typeof error.details === "string"
                    ? error.details
                    : error.errorClass
                  : "unexpected_error",
              class:
                error instanceof OpenProjectError
                  ? error.errorClass
                  : "unexpected_error",
            },
            idea_id: idea.ideaId,
            outcome: "inspection_failed",
            source_status: idea.status,
          });
        }
      }

      const candidateDigest = `sha256:${createHash("sha256")
        .update(
          JSON.stringify(
            candidates
              .map(({ idea }) => ({
                delivery_ref: idea.deliveryRef,
                idea_id: idea.ideaId,
              }))
              .sort((left, right) => left.idea_id.localeCompare(right.idea_id)),
          ),
        )
        .digest("hex")}`;

      if (apply && expectedCandidateDigest !== candidateDigest) {
        throw new HttpError(
          409,
          "reconciliation_plan_changed",
          "The current reconciliation candidate digest does not match the approved dry-run digest.",
          {
            actual_candidate_digest: candidateDigest,
            expected_candidate_digest: expectedCandidateDigest,
          },
        );
      }

      if (apply) {
        for (const candidate of candidates) {
          const { idea, itemIndex } = candidate;
          try {
            const closeoutResult = await openProjectClient.closeAcceptedIdeaDelivery({
              closeoutNotes,
              currentRecord: idea,
              recordId: parseIdeaId(idea.ideaId),
            });
            audit.emit({
              backend: {
                related_target_ref: closeoutResult.deliveryRecord.recordRef,
                result: closeoutResult.replayed ? "replayed" : "updated",
                system: "openproject",
                target_ref: closeoutResult.sourceRecord.recordRef,
              },
              caller: { id: callerId },
              correlation_id: correlationId,
              event_type: "idea.closeout.recorded",
              operator: {
                handle: operator.handle ?? null,
                id: operator.id,
              },
              outcome: "success",
              status: closeoutResult.sourceRecord.status,
            });
            items[itemIndex] = {
              action: closeoutResult.replayed ? "none" : "closed",
              delivery_ref: closeoutResult.deliveryRecord.recordRef,
              delivery_status: closeoutResult.deliveryRecord.status,
              idea_id: closeoutResult.sourceRecord.ideaId,
              outcome: closeoutResult.replayed
                ? "already_implemented"
                : "implemented",
              source_status: closeoutResult.sourceRecord.status,
            };
          } catch (error) {
            items[itemIndex] = {
              action: "none",
              delivery_ref: idea.deliveryRef,
              delivery_status: "done",
              error: {
                code:
                  error instanceof OpenProjectError
                    ? typeof error.details === "string"
                      ? error.details
                      : error.errorClass
                    : "unexpected_error",
                class:
                  error instanceof OpenProjectError
                    ? error.errorClass
                    : "unexpected_error",
              },
              idea_id: idea.ideaId,
              outcome: "inspection_failed",
              source_status: idea.status,
            };
          }
        }
      }

      const count = (outcome) =>
        items.filter((entry) => entry.outcome === outcome).length;
      const result = {
        applied: apply,
        candidate_digest: candidateDigest,
        items,
        status:
          count("inspection_failed") > 0
            ? "source_closeout_pending"
            : apply
              ? "completed"
              : "dry_run",
        summary: {
          already_implemented_count: count("already_implemented"),
          delivery_ref_missing_count: count("delivery_ref_missing"),
          eligible_count: candidates.length,
          implemented_count: count("implemented"),
          inspection_failed_count: count("inspection_failed"),
          not_done_count: count("delivery_not_done"),
          retired_count: count("delivery_retired"),
          scanned_count: items.length,
        },
        workflow_id: "accepted-idea-delivery-closeout-reconcile",
      };

      audit.emit({
        caller: { id: callerId },
        correlation_id: correlationId,
        event_type: "idea.delivery_closeout.reconciled",
        operator: {
          handle: operator.handle ?? null,
          id: operator.id,
        },
        outcome: "success",
        status: apply ? "applied" : "dry_run",
        summary: result.summary,
      });

      return result;
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
