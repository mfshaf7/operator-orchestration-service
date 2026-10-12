import {
  assertProductPublicationContract,
  createProductPublicationEvaluation,
  createProductPublicationPacket,
  createProductPublicationReceipt,
  productPublicationDigest,
  productPublicationError,
  productPublicationReceiptReference,
} from "./contracts.js";

function assertOwner(record, callerId) {
  if (!record || record.owner_caller_id !== callerId) {
    throw productPublicationError("not_found", "Product Publication request was not found.", 404);
  }
}

function publicResult(record, resolution) {
  return {
    schema_version: 1,
    workflow_id: "product-publication",
    request_id: record.command.request_id,
    revision: 1,
    resolution,
    state: record.receipt.outcome,
    command_digest: record.command_digest,
    command: structuredClone(record.command),
    evaluation: structuredClone(record.evaluation),
    readiness: structuredClone(record.readiness),
    packet: structuredClone(record.packet),
    receipt: structuredClone(record.receipt),
    receipt_digest: record.receipt_digest,
    owner_receipt: {
      uri: record.receipt.owner_receipt_ref,
      digest: record.receipt_digest,
    },
    history: structuredClone(record.history),
    next_action: record.receipt.outcome === "applied"
      ? "refresh-portfolio-projection"
      : "correct-owner-evidence-and-submit-new-request",
    cross_boundary_authority_granted: false,
  };
}

function assertOperator(operatorBindings, callerId, operatorId) {
  if (operatorBindings[callerId] !== operatorId) {
    throw productPublicationError(
      "operator_binding_invalid",
      "Caller identity is not bound to the supplied Product Publication operator.",
      403,
    );
  }
}

function assertSecurityDecision(expected, actual) {
  if (productPublicationDigest(expected) !== productPublicationDigest(actual)) {
    throw productPublicationError(
      "security_decision_mismatch",
      "The Product Publication command does not bind the exact configured Security decision.",
      403,
    );
  }
}

function assertPreviousReceipt(command, current) {
  if (!current) {
    if (
      command.expected_publication_version !== 0 ||
      command.previous_receipt !== null ||
      command.current_publication_posture !== "unlisted"
    ) {
      throw productPublicationError(
        "publication_version_conflict",
        "Initial publication requires version zero, unlisted posture, and no previous receipt.",
      );
    }
    return;
  }
  if (
    command.expected_publication_version !== current.publication_version ||
    command.current_publication_posture !== current.publication_posture ||
    !command.previous_receipt ||
    command.previous_receipt.receipt_id !== current.receipt_id ||
    command.previous_receipt.receipt_digest !== current.receipt_digest ||
    command.previous_receipt.publication_version !== current.publication_version
  ) {
    throw productPublicationError(
      "publication_version_conflict",
      "The request does not bind the current terminal publication receipt and version.",
    );
  }
}

export function createProductPublicationService({
  audit,
  clock = () => new Date(),
  operatorBindings,
  readinessClient,
  securityDecision,
  store,
}) {
  async function submit({ callerId, input, operatorId }) {
    assertOperator(operatorBindings, callerId, operatorId);
    const command = assertProductPublicationContract("command.schema.json", structuredClone(input));
    if (command.operator_id !== operatorId) {
      throw productPublicationError(
        "operator_mismatch",
        "Command operator does not match the authenticated operator.",
        403,
      );
    }
    assertSecurityDecision(securityDecision, command.security_decision);
    if (Date.parse(command.operator_decision.decided_at) > Date.parse(command.requested_at)) {
      throw productPublicationError(
        "timeline_invalid",
        "Operator decision must not occur after the publication request.",
        400,
      );
    }
    const commandDigest = productPublicationDigest(command);
    const evaluation = createProductPublicationEvaluation(command);

    return store.transact(async (transaction) => {
      const existingById = transaction.get(command.request_id);
      const idempotency = transaction.idempotency(callerId, command.idempotency_key);
      const existing = existingById ?? (idempotency ? transaction.get(idempotency.request_id) : null);
      if (existing) {
        assertOwner(existing, callerId);
        if (existing.command_digest !== commandDigest || idempotency?.command_digest !== commandDigest) {
          throw productPublicationError(
            "idempotency_conflict",
            "The request identity or idempotency key already binds different content.",
          );
        }
        return publicResult(existing, "replayed");
      }

      const readiness = await readinessClient.evaluate(evaluation);
      transaction.assertHeld();
      const artifact = readiness.readiness;
      assertPreviousReceipt(command, transaction.product(artifact.product_id));
      const packet = createProductPublicationPacket({
        command,
        evaluation,
        readiness: artifact,
        readinessRef: readiness.ledger.ref,
      });
      const recordedAt = clock().toISOString();
      const receipt = createProductPublicationReceipt({ command, packet, readiness: artifact, recordedAt });
      const receiptRef = productPublicationReceiptReference(receipt);
      const record = {
        owner_caller_id: callerId,
        command,
        command_digest: commandDigest,
        evaluation,
        readiness,
        packet,
        receipt,
        receipt_digest: receiptRef.receipt_digest,
        history: [{
          sequence: 1,
          event_type: receipt.outcome === "applied" ? "publication-applied" : "publication-rejected",
          occurred_at: recordedAt,
          actor_id: operatorId,
          readiness_ref: structuredClone(readiness.ledger.ref),
          receipt_ref: {
            uri: receipt.owner_receipt_ref,
            digest: receiptRef.receipt_digest,
          },
        }],
      };
      await transaction.put(record);
      audit?.emit({
        actor: operatorId,
        event_type: `product.publication.${receipt.outcome}`,
        outcome: receipt.outcome,
        product_id: receipt.product_id,
        request_id: command.request_id,
        receipt_ref: receipt.owner_receipt_ref,
      });
      return publicResult(record, "created");
    });
  }

  return {
    submit,
    async get({ callerId, requestId }) {
      const record = await store.get(requestId);
      assertOwner(record, callerId);
      return publicResult(record, "read");
    },
  };
}
