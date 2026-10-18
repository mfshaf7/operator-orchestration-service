import { canonicalDigest } from "../delivery-art/canonical-json.js";

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function normalizeBoundedSourceCommand(value, action, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw error(
      "command_invalid",
      "Source realization command must be an object.",
    );
  }
  const allowed = action === "continue"
    ? ["schema_version", "command_id", "expected_revision", "accepted_change_set_digest", "requested_at"]
    : action === "cancel"
      ? ["schema_version", "command_id", "expected_revision", "reason", "requested_at"]
      : ["schema_version", "command_id", "expected_revision", "requested_at"];
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (
    unexpected.length > 0 ||
    value.schema_version !== 1 ||
    !STABLE_ID.test(value.command_id ?? "") ||
    typeof value.expected_revision !== "string" ||
    !Number.isFinite(Date.parse(value.expected_revision)) ||
    typeof value.requested_at !== "string" ||
    !Number.isFinite(Date.parse(value.requested_at)) ||
    (action === "continue" && !DIGEST.test(value.accepted_change_set_digest ?? "")) ||
    (action === "cancel" && (typeof value.reason !== "string" || value.reason.trim().length < 20))
  ) {
    throw error(
      "command_invalid",
      `Source realization ${action} command is invalid.`,
      { details: { unexpected } },
    );
  }
  return structuredClone(value);
}

// Shared bounded acknowledgement/apply/cancel/recovery mechanics. The subject
// owner resolves real sessions and validates identity; this kernel cannot
// select a repository, authorize credentials, or fabricate another subject.
export function createBoundedSourceActions({
  assertCommand, assertIdentity, boundedFailure, configured, error, project,
  readRecord, revision, sessionFor, sourceAdapter, store, writeRecord,
}) {
  async function readCompletedCommand({ action, callerId, operatorId, request, subjectRef }) {
    if (!["continue", "recover"].includes(action)) return null;
    const command = assertCommand(request, action);
    const session = await sessionFor(subjectRef);
    assertIdentity(session, callerId, operatorId);
    const record = await readRecord(session);
    const attempt = record?.attempts?.at(-1);
    const prefix = action === "continue" ? "apply" : "recovery";
    if (!attempt || attempt[`${prefix}_command_id`] !== command.command_id) return null;
    if (attempt[`${prefix}_command_digest`] !== canonicalDigest(command)) {
      throw error("replay_conflict", "Source realization command_id is bound to a different immutable command.", { statusCode: 409 });
    }
    return attempt.state === "source-created" ? project(record, configured, true) : null;
  }

  async function continueRealization({ callerId, operatorId, request: input, subjectRef }) {
    const command = assertCommand(input, "continue");
    const commandDigest = canonicalDigest(command);
    const session = await sessionFor(subjectRef);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = await readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.apply_command_id === command.command_id) {
        if (attempt.apply_command_digest !== commandDigest) {
          throw error(
            "replay_conflict",
            "Source realization command_id is bound to different acceptance input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "source-created") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw error(
          "revision_stale",
          "Source realization command was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw error(
          "timeline_invalid",
          "Source realization acceptance time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      if (attempt.state !== "draft-ready") {
        throw error(
          "not_ready",
          "Only a draft-ready source realization can be accepted.",
          { statusCode: 409 },
        );
      }
      if (attempt.change_set_digest !== command.accepted_change_set_digest) {
        throw error(
          "acceptance_mismatch",
          "Operator acceptance does not bind the current change set.",
          { statusCode: 409 },
        );
      }
      attempt.apply_command_id = command.command_id;
      attempt.apply_command_digest = commandDigest;
      attempt.state = "applying";
      record.revision = revision();
      await writeRecord(session, record);
      try {
        attempt.source_receipt = await sourceAdapter.applySourceRealization(
          session,
          attempt.change_set,
        );
        attempt.state = "source-created";
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        await writeRecord(session, record);
        return project(record, configured);
      } catch (error) {
        attempt.state = "apply-unknown";
        attempt.failure = boundedFailure(error);
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        await writeRecord(session, record);
        throw error;
      }
    });
  }

  async function cancel({ callerId, operatorId, request: input, subjectRef }) {
    const command = assertCommand(input, "cancel");
    const commandDigest = canonicalDigest(command);
    const session = await sessionFor(subjectRef);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = await readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.cancel_command_id === command.command_id) {
        if (attempt.cancel_command_digest !== commandDigest) {
          throw error(
            "replay_conflict",
            "Source realization command_id is bound to different cancellation input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "cancelled") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw error(
          "revision_stale",
          "Source realization command was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw error(
          "timeline_invalid",
          "Source realization cancellation time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      // This lock also surrounds generation. An acquired lock with an
      // accepted-only record means generation was interrupted before a draft
      // or any accepted source action existed. Cancelling is therefore safe;
      // applying/apply-unknown must still use exact-action recovery instead.
      if (!["accepted", "draft-ready"].includes(attempt.state)) {
        throw error(
          "cancel_not_allowed",
          "Only an unapplied accepted or draft-ready source realization can be cancelled safely.",
          { statusCode: 409 },
        );
      }
      attempt.cancel_command_id = command.command_id;
      attempt.cancel_command_digest = commandDigest;
      attempt.cancel_reason = command.reason.trim();
      attempt.state = "cancelled";
      attempt.completed_at = revision();
      record.revision = attempt.completed_at;
      await writeRecord(session, record);
      return project(record, configured);
    });
  }

  async function recover({ callerId, operatorId, request: input, subjectRef }) {
    const command = assertCommand(input, "recover");
    const commandDigest = canonicalDigest(command);
    const session = await sessionFor(subjectRef);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = await readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.recovery_command_id === command.command_id) {
        if (attempt.recovery_command_digest !== commandDigest) {
          throw error(
            "replay_conflict",
            "Source realization command_id is bound to different recovery input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "source-created") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw error(
          "revision_stale",
          "Source realization recovery was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw error(
          "timeline_invalid",
          "Source realization recovery time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      if (!["applying", "apply-unknown"].includes(attempt.state) || !attempt.apply_command_id) {
        throw error(
          "recovery_not_required",
          "This source realization does not require apply reconciliation.",
          { statusCode: 409 },
        );
      }
      attempt.source_receipt = await sourceAdapter.applySourceRealization(
        session,
        attempt.change_set,
      );
      attempt.recovery_command_id = command.command_id;
      attempt.recovery_command_digest = commandDigest;
      attempt.failure = null;
      attempt.state = "source-created";
      attempt.completed_at = revision();
      record.revision = attempt.completed_at;
      await writeRecord(session, record);
      return project(record, configured);
    });
  }

  return { continue: continueRealization, cancel, recover, readCompletedCommand };
}
