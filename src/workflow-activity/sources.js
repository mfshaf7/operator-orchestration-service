import { sourceRevisionDigest } from "../console-source-authority.js";

const LIFECYCLE_LABELS = Object.freeze({
  "source-packet-prepared": "Source packet prepared",
  "validation-started": "Validation started",
  "validation-completed": "Validation completed",
  "target-admission-recorded": "Target admission recorded",
  "authority-decision-recorded": "Authority decision recorded",
  "application-started": "Application started",
  "target-application-recorded": "Target application recorded",
  "application-failed": "Application failed",
  "gate-blocked": "Gate blocked",
  "source-correction-returned": "Source correction requested",
  "transition-deferred": "Transition deferred",
  "transition-cancelled": "Transition cancelled",
  "transition-superseded": "Transition superseded",
});

export function createLifecycleTransitionActivitySource(service, {
  clock = () => new Date(),
} = {}) {
  return {
    id: "lifecycle-transition",
    label: "Lifecycle transition",
    authority: "operator-orchestration-service",
    owner: "operator-orchestration-service",
    async read({ callerId, correlationId, limit }) {
      if (!service) {
        return inactiveSource(clock, "lifecycle_transition_not_active");
      }
      const result = await service.list({
        callerId,
        correlationId,
        cursor: null,
        filters: {},
        limit,
      });
      const events = result.transitions.flatMap((envelope) => {
        const projection = envelope.projection;
        const latestSequence = envelope.revision.event_sequence;
        return projection.history.entries.map((entry) => ({
          event_id: `lifecycle-transition:${projection.transition_id}:${entry.artifact_id}`,
          action: {
            id: entry.artifact_kind,
            label: LIFECYCLE_LABELS[entry.artifact_kind] ?? entry.artifact_kind,
          },
          actor: { kind: "system", ref: entry.authority.owner_ref },
          category: lifecycleCategory(entry.artifact_kind),
          outcome: lifecycleOutcome(entry.artifact_kind),
          occurred_at: entry.recorded_at,
          correlation_id: projection.correlation_id,
          causation_id: null,
          evidence_refs: entry.evidence_refs,
          receipt_ref: lifecycleReceiptRef(projection, entry.artifact_kind),
          next_actions: entry.sequence === latestSequence && projection.next_action
            ? [projection.next_action]
            : [],
          source_ref: `lifecycle-transition:oos://lifecycle-transitions/${projection.transition_id}`,
          source_revision: envelope.revision.source_revision,
          subject: {
            kind: "lifecycle-transition",
            label: projection.route_id,
            ref: projection.transition_id,
          },
          summary: lifecycleSummary(entry.artifact_kind, projection.route_id),
        }));
      });
      return {
        state: "current",
        observed_at: clock().toISOString(),
        source_revision: sourceRevisionDigest(result.transitions.map((entry) => entry.revision)),
        truncated: result.next_cursor !== null ||
          result.transitions.some((entry) => entry.projection.history.truncated),
        events,
      };
    },
  };
}

export function createOrchestrationActivitySource(service, {
  available = true,
  clock = () => new Date(),
} = {}) {
  return {
    id: "durable-orchestration",
    label: "Durable orchestration",
    authority: "operator-orchestration-service",
    owner: "operator-orchestration-service",
    async read({ callerId, limit }) {
      if (!available || !service) {
        return inactiveSource(clock, "orchestration_runtime_not_active");
      }
      const runs = await service.listRuns({ callerId, limit });
      const events = runs.flatMap((run) => run.events.map((entry, index) => {
        const latest = index === run.events.length - 1;
        const control = run.controls?.find((candidate) =>
          candidate.recorded_at === entry.occurred_at &&
          entry.summary.startsWith("Operator control "));
        return {
          event_id: `durable-orchestration:${entry.event_id}`,
          action: {
            id: orchestrationAction(entry, control),
            label: entry.summary,
          },
          actor: control
            ? { kind: "operator", ref: control.operator_id }
            : { kind: "system", ref: entry.node_id ?? "operator-orchestration-service" },
          category: orchestrationCategory(entry, run, latest),
          outcome: orchestrationOutcome(entry.state),
          occurred_at: entry.occurred_at,
          correlation_id: run.correlation_ref ?? null,
          causation_id: run.causation_ref ?? null,
          evidence_refs: latest ? orchestrationEvidenceRefs(run) : [],
          receipt_ref: latest ? run.aggregate_receipt?.receipt_id ?? null : null,
          next_actions: latest
            ? (run.control_availability ?? [])
                .filter((candidate) => candidate.available)
                .map((candidate) => ({
                  action: candidate.action,
                  owner_ref: candidate.authority,
                  review_at: null,
                }))
            : [],
          source_ref: `durable-orchestration:oos://orchestration/runs/${run.run_id}`,
          source_revision: `${run.run_id}:${run.last_projected_at}`,
          subject: {
            kind: "orchestration-run",
            label: `${run.definition_id} v${run.definition_version}`,
            ref: run.run_id,
          },
          summary: entry.summary,
        };
      }));
      return {
        state: "current",
        observed_at: clock().toISOString(),
        source_revision: sourceRevisionDigest(runs.map((run) => ({
          run_id: run.run_id,
          last_projected_at: run.last_projected_at,
        }))),
        truncated: runs.length >= limit,
        events,
      };
    },
  };
}

function lifecycleCategory(kind) {
  if (kind === "gate-blocked") return "blocker";
  if (["target-admission-recorded", "authority-decision-recorded", "target-application-recorded"].includes(kind)) {
    return "receipt";
  }
  return "transition";
}

function lifecycleOutcome(kind) {
  if (kind === "gate-blocked") return "blocked";
  if (kind === "application-failed") return "failed";
  if (["validation-started", "application-started"].includes(kind)) return "started";
  if (["transition-deferred", "source-correction-returned"].includes(kind)) return "waiting";
  if (["transition-cancelled", "transition-superseded"].includes(kind)) return "informational";
  return "succeeded";
}

function lifecycleReceiptRef(projection, kind) {
  if (kind === "validation-completed") return projection.validation.receipt_ref;
  if (kind === "target-admission-recorded") return projection.admission.receipt_ref;
  if (["target-application-recorded", "application-failed"].includes(kind)) {
    return projection.application.receipt_ref;
  }
  if (kind === "authority-decision-recorded") {
    return projection.authority_decisions.at(-1)?.receipt_ref ?? null;
  }
  return null;
}

function lifecycleSummary(kind, routeId) {
  return `${LIFECYCLE_LABELS[kind] ?? kind} for ${routeId}.`;
}

function orchestrationAction(entry, control) {
  if (control) return `control-${control.action}`;
  return `run-${entry.state}`;
}

function orchestrationCategory(entry, run, latest) {
  if (entry.state === "blocked") return "blocker";
  if (latest && run.aggregate_receipt) return "receipt";
  return "state-change";
}

function orchestrationOutcome(state) {
  if (state === "blocked") return "blocked";
  if (state === "failed") return "failed";
  if (state === "waiting") return "waiting";
  if (["queued", "running"].includes(state)) return "started";
  if (["completed", "cancelled"].includes(state)) return "succeeded";
  return "informational";
}

function orchestrationEvidenceRefs(run) {
  return [...new Set([
    ...(run.artifact_refs ?? []),
    ...(run.receipt_refs ?? []).map((entry) => entry.receipt_id),
  ])];
}

function inactiveSource(clock, errorCode) {
  return {
    state: "unavailable",
    observed_at: clock().toISOString(),
    source_revision: "unavailable",
    truncated: false,
    error_code: errorCode,
    events: [],
  };
}
