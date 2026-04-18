import { OpenProjectError } from "./errors.js";

function toIdeaId(recordId) {
  return `idea-${recordId}`;
}

export function createIdeaService({ openProjectClient, audit }) {
  return {
    async captureIdea({ correlationId, callerId, operator, source, sourceRef, title, body }) {
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
        source: {
          surface: source,
          ref: sourceRef,
        },
        outcome: "requested",
      });

      try {
        const result = await openProjectClient.captureIdea({
          operator,
          source,
          sourceRef,
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
          source: {
            surface: source,
            ref: sourceRef,
          },
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
          source: {
            surface: source,
            ref: sourceRef,
          },
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
          source: {
            surface: source,
            ref: sourceRef,
          },
          backend: {
            system: "openproject",
            target_ref: `openproject://projects/unknown`,
            result: "failed",
          },
          outcome: "failure",
          status: "capture_failed",
          error_class: failure?.errorClass ?? "unexpected_error",
        });

        throw error;
      }
    },
  };
}
