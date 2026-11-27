import { canonicalDigest } from "./canonical-json.js";
import { architectureImpactChanged, DeliveryArtServiceError } from "./service.js";
import { DELIVERY_SOURCE_REALIZATION_RECORD } from "./source-realization.js";
import {
  compatibleWorkSessionArchitecture,
  workSessionCanReconstruct,
  workSessionPristineProof,
  workSessionSourceOperationPending,
} from "./work-session-controller.js";

export function createArchitectureSessionImpactReader({ store, readPlanningFacts, inspectSource }) {
  function inventory(architecture) {
    const covered = new Set(architecture.covered_work_item_ids);
    return store.listSessions()
      .filter(session => session.delivery_id === architecture.delivery_id && session.state !== "closed")
      .filter(session => session.architecture.required || session.covered_work_item_ids.some(id => covered.has(id)));
  }

  function capture(session) {
    const source = store.readArtifact(session, DELIVERY_SOURCE_REALIZATION_RECORD);
    const rebuild = store.readPendingRebuild(session);
    return {
      pending: workSessionSourceOperationPending(source) || Boolean(rebuild),
      revision: canonicalDigest({
        session,
        source,
        rebuild,
        architecture: session.architecture.required ? store.readArtifact(session, session.architecture.artifact_file) : null,
        evidence: store.readArtifact(session, session.artifacts.evidence_file),
        review: store.readArtifact(session, session.artifacts.review_packet_file),
        readiness: store.readArtifact(session, session.artifacts.readiness_receipt_file),
      }),
    };
  }

  async function classify(session, architecture, context, pending) {
    if (!session.architecture.required) return { disposition: "continues", reason: "plan-not-required" };
    if (session.operator.id !== context.operatorId || session.caller_id !== context.callerId) {
      return { disposition: "review", reason: "session-operator" };
    }
    if (pending) return { disposition: "review", reason: "operation-pending" };

    const bound = store.readArtifact(session, session.architecture.artifact_file);
    if (!bound) return { disposition: "review", reason: "binding-unavailable" };
    const proof = await workSessionPristineProof({
      store, session, architecture, inspectSource: value => inspectSource(value, context),
    });
    if (compatibleWorkSessionArchitecture(session, bound, architecture)) {
      return { disposition: "refresh", reason: "scope-unchanged", source: proof.source };
    }
    if (!proof.current_landing_unit_id) {
      return { disposition: "review", reason: "scope-regrouped", source: proof.source };
    }
    return {
      ...(workSessionCanReconstruct(proof)
        ? { disposition: "rebuild", reason: "scope-changed-clean" }
        : { disposition: "review", reason: "source-or-evidence-exists" }),
      source: proof.source,
    };
  }

  return async (architecture, context) => {
    try {
      const sessions = inventory(architecture);
      if (!sessions.length) return { sessions: [], observation: [] };
      const ids = [...new Set(sessions.flatMap(session => session.covered_work_item_ids))].sort();
      const observed = new Map(sessions.map(session => [session.session_id, capture(session)]));
      const facts = await readPlanningFacts({
        recordId: Number(architecture.delivery_id.slice("delivery-".length)),
        ids: ids.map(id => Number(id.slice("work-item-".length))),
      });
      const status = new Map(facts.map(fact => [`work-item-${fact.id}`, fact.status]));
      const rows = [];
      const sourceObservations = [];
      for (const session of sessions) {
        const unverified = session.covered_work_item_ids.some(id => !status.get(id));
        const eligible = session.covered_work_item_ids.filter(id => status.get(id) &&
          !["done", "closed", "retired"].includes(status.get(id).toLowerCase()));
        if (!eligible.length && !unverified) continue;
        const { disposition, reason, source } = unverified
          ? { disposition: "review", reason: "binding-unavailable" }
          : await classify(session, architecture, context, observed.get(session.session_id).pending);
        rows.push({
          disposition, reason, owner_repo: session.owner_repo,
          work_item_ids: session.covered_work_item_ids,
          open_work_item_id: session.operator.id === context.operatorId && session.caller_id === context.callerId
            ? eligible[0] ?? null : null,
        });
        if (source) sourceObservations.push(canonicalDigest(source));
      }
      const revisions = [...observed.entries()].map(([id, value]) => [id, value.revision]);
      const current = inventory(architecture).map(session => [session.session_id, capture(session).revision]);
      if (canonicalDigest(revisions) !== canonicalDigest(current)) throw architectureImpactChanged();
      return { sessions: rows, observation: { revisions, statuses: ids.map(id => status.get(id) ?? null), source: sourceObservations } };
    } catch (error) {
      if (error?.code === "delivery_art_plan_impact_changed") throw error;
      throw new DeliveryArtServiceError(
        "delivery_art_plan_impact_unavailable",
        "The work sessions could not be checked. Retry plan validation when the work session service is available.",
        503,
      );
    }
  };
}
