import { createHash } from "node:crypto";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { assertProposalStorageState } from "./contracts.js";

export function proposalRecordVersion(lockVersion) {
  return `version-${lockVersion}`;
}

export function parseProposalRecordVersion(recordVersion) {
  const match = /^version-(\d+)$/.exec(recordVersion ?? "");
  return match ? Number.parseInt(match[1], 10) : null;
}

export function defaultProposalState(updatedAt) {
  return {
    schema_version: 1,
    route: null,
    handoff: {
      state: "not-requested",
      packet_ref: null,
      target_receipt_ref: null,
      target_record_ref: null,
    },
    last_accepted_command: null,
    receipt_refs: [],
    updated_at: updatedAt,
  };
}

export function parseProposalState(rawValue, updatedAt) {
  const raw = typeof rawValue === "string" ? rawValue : rawValue?.raw;
  if (!raw?.trim()) {
    return defaultProposalState(updatedAt);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(
      502,
      "proposal_state_invalid",
      "The canonical Proposal workflow state is not valid JSON.",
    );
  }
  try {
    return assertProposalStorageState(parsed);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(
        502,
        "proposal_state_invalid",
        "The canonical Proposal workflow state does not satisfy its storage contract.",
        error.details,
      );
    }
    throw error;
  }
}

export function proposalCommandDigest(command) {
  return canonicalDigest(command);
}

export function proposalCommandReceiptRef(proposalId, command) {
  const digest = proposalCommandDigest(command).slice("sha256:".length);
  return `proposal-command-receipt:${proposalId}:${digest}`;
}

export function proposalHandoffApplicationReceiptRef(
  proposalId,
  applicationId,
  packetRef,
) {
  const digest = canonicalDigest({
    application_id: applicationId,
    packet_ref: packetRef,
    proposal_id: proposalId,
    target: "delivery",
  }).slice("sha256:".length);
  return `proposal-target-receipt:${proposalId}:${digest}`;
}

export function proposalHandoffApplicationFailureReceiptRef(
  proposalId,
  applicationId,
  packetRef,
) {
  const digest = canonicalDigest({
    application_id: applicationId,
    outcome: "failed",
    packet_ref: packetRef,
    proposal_id: proposalId,
    target: "delivery",
  }).slice("sha256:".length);
  return `proposal-target-failure-receipt:${proposalId}:${digest}`;
}

export function proposalEventId(proposalId, commandId) {
  const digest = createHash("sha256").update(commandId).digest("hex");
  return `proposal-event:${proposalId}:${digest}`;
}

export function proposalHandoffApplicationEventId(
  proposalId,
  applicationId,
  outcome = "applied",
) {
  return proposalEventId(proposalId, `${applicationId}:${outcome}`);
}

export function applyProposalHandoffApplicationFailureToState({
  failedAt,
  currentState,
  failureReceiptRef,
  packetRef,
}) {
  const next = structuredClone(currentState);
  next.handoff = {
    state: "blocked",
    packet_ref: packetRef,
    target_receipt_ref: null,
    target_record_ref: null,
  };
  next.receipt_refs = [
    ...next.receipt_refs.filter((entry) => entry !== failureReceiptRef),
    failureReceiptRef,
  ].slice(-8);
  next.updated_at = failedAt;
  return assertProposalStorageState(next);
}

export function applyProposalHandoffApplicationToState({
  appliedAt,
  currentState,
  packetRef,
  receiptRef,
  targetRecordRef,
}) {
  const next = structuredClone(currentState);
  next.handoff = {
    state: "applied",
    packet_ref: packetRef,
    target_receipt_ref: receiptRef,
    target_record_ref: targetRecordRef,
  };
  next.receipt_refs = [
    ...next.receipt_refs.filter((entry) => entry !== receiptRef),
    receiptRef,
  ].slice(-8);
  next.updated_at = appliedAt;
  return assertProposalStorageState(next);
}

export function applyProposalCommandToState({
  acceptedAt,
  command,
  currentState,
  receiptRef,
}) {
  const next = structuredClone(currentState);
  const boundedReceipts = [
    ...next.receipt_refs.filter((entry) => entry !== receiptRef),
    receiptRef,
  ].slice(-8);

  next.last_accepted_command = {
    command_id: command.command_id,
    command_type: command.command.type,
    accepted_at: acceptedAt,
  };
  next.receipt_refs = boundedReceipts;
  next.updated_at = acceptedAt;

  if (command.command.type === "disposition") {
    next.route = command.command.route;
    next.handoff = {
      state: "not-requested",
      packet_ref: null,
      target_receipt_ref: null,
      target_record_ref: null,
    };
  }

  if (command.command.type === "handoff") {
    next.route = command.command.route;
    next.handoff = {
      state: command.command.result === "ready" ? "ready" : "blocked",
      packet_ref: command.command.packet_ref,
      target_receipt_ref: null,
      target_record_ref: null,
    };
  }

  return assertProposalStorageState(next);
}

export function proposalStatusAfterCommand(command) {
  if (command.command.type === "triage") {
    return "triaged";
  }
  if (command.command.type === "disposition") {
    return command.command.outcome;
  }
  return "accepted";
}

export function proposalEventType(command) {
  if (command.command.type === "triage") {
    return "triaged";
  }
  if (command.command.type === "disposition") {
    return "disposition-recorded";
  }
  return command.command.result === "ready"
    ? "handoff-prepared"
    : "handoff-blocked";
}
