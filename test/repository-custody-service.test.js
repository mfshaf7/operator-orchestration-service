import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { HttpError } from "../src/errors.js";
import { createRepositoryCustodyService } from "../src/repository-custody/service.js";
import { createRepositoryCustodyStore } from "../src/repository-custody/store.js";
import {
  custodyDecision,
  custodyRequest,
  provisionDecision,
  provisionReadback,
  provisionRequest,
  providerReadback,
  TEST_CLOCK,
} from "../test-fixtures/repository-custody.js";

function harness({ decision, provider } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-custody-"));
  const calls = [];
  const request = custodyRequest();
  const targetDecision = decision ?? custodyDecision(request);
  const service = createRepositoryCustodyService({
    audit: { emit(event) { calls.push({ operation: "audit", event }); } },
    clock: TEST_CLOCK,
    providerClient: {
      async read(input) {
        calls.push({ operation: "provider", input });
        if (provider instanceof Error) throw provider;
        return provider ?? providerReadback(input);
      },
    },
    readinessClient: {
      async evaluate(input) {
        calls.push({ operation: "readiness", input });
        const evaluatedDecision = typeof targetDecision === "function"
          ? targetDecision(input)
          : targetDecision;
        return {
          decision: evaluatedDecision,
          decisionRef: {
            uri: "wgcf://decisions/repository-custody/0123456789abcdef01234567.json",
            digest: evaluatedDecision.integrity.content_digest,
          },
        };
      },
    },
    store: createRepositoryCustodyStore({ root }),
  });
  return {
    calls,
    cleanup() { rmSync(root, { force: true, recursive: true }); },
    request,
    root,
    service,
  };
}

function provisioningHarness({ create, find, read, decision } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-provisioning-"));
  const calls = [];
  const request = provisionRequest();
  const targetDecision = decision ?? provisionDecision(request);
  const service = createRepositoryCustodyService({
    audit: { emit(event) { calls.push({ operation: "audit", event }); } },
    clock: TEST_CLOCK,
    providerClient: {
      async create(input, approvedProvisioning) {
        calls.push({ operation: "create", input, approvedProvisioning });
        if (create instanceof Error) throw create;
        if (typeof create === "function") return create(input, approvedProvisioning);
        return create ?? { providerRepositoryId: "987654321" };
      },
      async find(input) {
        calls.push({ operation: "find", input });
        if (find instanceof Error) throw find;
        if (typeof find === "function") return find(input);
        return find ?? null;
      },
      async read(input, options) {
        calls.push({ operation: "read", input, options });
        if (read instanceof Error) throw read;
        if (typeof read === "function") return read(input, options);
        return read ?? provisionReadback(input);
      },
    },
    readinessClient: {
      async evaluate(input) {
        calls.push({ operation: "readiness", input });
        const evaluatedDecision = typeof targetDecision === "function"
          ? targetDecision(input)
          : targetDecision;
        return {
          decision: evaluatedDecision,
          decisionRef: {
            uri: "wgcf://decisions/repository-custody/0123456789abcdef01234567.json",
            digest: evaluatedDecision.integrity.content_digest,
          },
        };
      },
    },
    store: createRepositoryCustodyStore({ root }),
  });
  return {
    calls,
    cleanup() { rmSync(root, { force: true, recursive: true }); },
    request,
    root,
    service,
  };
}

test("repository custody links an exact provider identity and replays without side effects", async () => {
  const target = harness();
  try {
    const first = await target.service.execute({
      callerId: "governance-operations-console",
      input: target.request,
    });
    const replay = await target.service.execute({
      callerId: "governance-operations-console",
      input: target.request,
    });
    const projection = await target.service.project(target.request.request_id);

    assert.equal(first.status, "succeeded");
    assert.equal(first.receipt.custody.after, "linked");
    assert.equal(first.receipt.downstream_handoffs.active_inventory, "separate-action-required");
    assert.equal(replay.replayed, true);
    assert.equal(projection.replayed, true);
    assert.deepEqual(
      target.calls.filter(({ operation }) => operation !== "audit").map(({ operation }) => operation),
      ["readiness", "provider"],
    );
  } finally {
    target.cleanup();
  }
});

test("repository custody refuses tampered persisted references", async () => {
  const target = harness();
  try {
    await target.service.execute({ callerId: "console", input: target.request });
    const [recordName] = readdirSync(path.join(target.root, "records"));
    const recordPath = path.join(target.root, "records", recordName);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.receipt_ref.uri = "oos://receipts/repository-custody/tampered.json";
    writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
    await assert.rejects(
      target.service.project(target.request.request_id),
      (error) => error.code === "repository_custody_state_invalid",
    );
  } finally {
    target.cleanup();
  }
});

test("repository custody denial never reads or mutates provider state", async () => {
  const request = custodyRequest();
  const denied = custodyDecision(request, {
    outcome: "denied",
    resolved_identity: null,
    findings: [{ code: "policy-denied", severity: "blocking", summary: "Policy denied." }],
    obligations: [],
    next_action: "stop",
  });
  const target = harness({ decision: denied });
  try {
    const result = await target.service.execute({ callerId: "console", input: target.request });
    assert.equal(result.status, "denied");
    assert.equal(result.receipt.outcome, "denied");
    assert.equal(result.receipt.provider_readback_ref, null);
    assert.equal(result.failure.code, "repository_custody_denied");
    assert.equal(target.calls.some(({ operation }) => operation === "provider"), false);
  } finally {
    target.cleanup();
  }
});

test("repository custody fails closed for mismatched decision and provider readback", async () => {
  const request = custodyRequest();
  const mismatchedDecision = custodyDecision(request, {
    resolved_identity: { provider: "github", provider_repository_id: "987654321" },
  });
  const denied = harness({ decision: mismatchedDecision });
  try {
    await assert.rejects(
      denied.service.execute({ callerId: "console", input: denied.request }),
      (error) => error.code === "repository_custody_decision_mismatch",
    );
    assert.equal(denied.calls.some(({ operation }) => operation === "provider"), false);
  } finally {
    denied.cleanup();
  }

  const stale = harness({
    provider: providerReadback(request, {
      repository_identity: { provider: "github", provider_repository_id: "987654321" },
    }),
  });
  try {
    const result = await stale.service.execute({ callerId: "console", input: stale.request });
    assert.equal(result.status, "failed");
    assert.equal(result.receipt.outcome, "failed");
    assert.equal(result.failure.code, "repository_provider_readback_stale");
  } finally {
    stale.cleanup();
  }
});

test("retryable provider failure can recover under the same request identity", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-custody-retry-"));
  const request = custodyRequest();
  const decision = custodyDecision(request);
  let attempts = 0;
  const service = createRepositoryCustodyService({
    clock: TEST_CLOCK,
    providerClient: {
      async read(input) {
        attempts += 1;
        if (attempts === 1) {
          throw new HttpError(503, "repository_provider_unavailable", "Provider unavailable.");
        }
        return providerReadback(input);
      },
    },
    readinessClient: {
      async evaluate() {
        return {
          decision,
          decisionRef: {
            uri: "wgcf://decisions/repository-custody/0123456789abcdef01234567.json",
            digest: decision.integrity.content_digest,
          },
        };
      },
    },
    store: createRepositoryCustodyStore({ root }),
  });
  try {
    assert.equal((await service.execute({ callerId: "console", input: request })).retryable, true);
    const recovered = await service.execute({ callerId: "console", input: request });
    assert.equal(recovered.status, "succeeded");
    assert.equal(attempts, 2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("repository provisioning creates once, verifies exact settings, and replays", async () => {
  const target = provisioningHarness();
  try {
    const first = await target.service.execute({ callerId: "console", input: target.request });
    const replay = await target.service.execute({ callerId: "console", input: target.request });
    const projection = await target.service.project(target.request.request_id);

    assert.equal(first.status, "succeeded");
    assert.equal(first.provider_operation.completion_path, "created");
    assert.equal(first.provider_operation.attempt_count, 1);
    assert.equal(first.receipt.custody.after, "provisioned");
    assert.equal(first.receipt.downstream_handoffs.workspace_intake, "request-available");
    assert.equal(replay.replayed, true);
    assert.equal(projection.replayed, true);
    assert.deepEqual(
      target.calls
        .filter(({ operation }) => operation !== "audit")
        .map(({ operation }) => operation),
      ["readiness", "find", "create", "read"],
    );
  } finally {
    target.cleanup();
  }
});

test("repository provisioning denial performs no provider operation", async () => {
  const request = provisionRequest();
  const deniedDecision = provisionDecision(request, {
    outcome: "denied",
    approved_provisioning: null,
    findings: [{ code: "policy-denied", severity: "blocking", summary: "Policy denied." }],
    obligations: [],
    next_action: "stop",
  });
  const target = provisioningHarness({ decision: deniedDecision });
  try {
    const result = await target.service.execute({ callerId: "console", input: target.request });
    assert.equal(result.status, "denied");
    assert.equal(result.provider_operation.state, "not-started");
    assert.deepEqual(
      target.calls.filter(({ operation }) => operation !== "audit").map(({ operation }) => operation),
      ["readiness"],
    );
  } finally {
    target.cleanup();
  }
});

test("repository provisioning preserves recovery context when refreshed readiness denies", async () => {
  let evaluations = 0;
  const request = provisionRequest();
  const target = provisioningHarness({
    create: new HttpError(503, "repository_provider_unavailable", "Create acknowledgement lost."),
    decision(input) {
      evaluations += 1;
      return evaluations === 1
        ? provisionDecision(input)
        : provisionDecision(input, {
            outcome: "denied",
            approved_provisioning: null,
            findings: [{ code: "approval-expired", severity: "blocking", summary: "Approval expired." }],
            obligations: [],
            next_action: "stop",
          });
    },
  });
  try {
    const failed = await target.service.execute({ callerId: "console", input: request });
    const denied = await target.service.execute({ callerId: "console", input: request });

    assert.equal(failed.provider_operation.state, "recovery-required");
    assert.equal(denied.status, "denied");
    assert.equal(denied.provider_operation.state, "recovery-required");
    assert.equal(denied.provider_operation.attempt_count, 1);
    assert.equal(target.calls.filter(({ operation }) => operation === "create").length, 1);
  } finally {
    target.cleanup();
  }
});

test("repository provisioning recovers an indeterminate create without creating twice", async () => {
  let createAttempts = 0;
  let recoveryReads = 0;
  const target = provisioningHarness({
    create() {
      createAttempts += 1;
      throw new HttpError(503, "repository_provider_unavailable", "Create acknowledgement lost.");
    },
    find(input) {
      recoveryReads += 1;
      return recoveryReads === 1 ? null : provisionReadback(input);
    },
  });
  try {
    const first = await target.service.execute({ callerId: "console", input: target.request });
    const recovered = await target.service.execute({ callerId: "console", input: target.request });

    assert.equal(first.status, "failed");
    assert.equal(first.retryable, true);
    assert.equal(first.provider_operation.state, "recovery-required");
    assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.provider_operation.completion_path, "recovered");
    assert.equal(createAttempts, 1);
  } finally {
    target.cleanup();
  }
});

test("repository provisioning resumes readback from an acknowledged provider id", async () => {
  let readAttempts = 0;
  const target = provisioningHarness({
    read(input) {
      readAttempts += 1;
      if (readAttempts === 1) {
        throw new HttpError(503, "repository_provider_unavailable", "Readback unavailable.");
      }
      return provisionReadback(input);
    },
  });
  try {
    const first = await target.service.execute({ callerId: "console", input: target.request });
    const recovered = await target.service.execute({ callerId: "console", input: target.request });

    assert.equal(first.provider_operation.provider_repository_id, "987654321");
    assert.equal(first.provider_operation.state, "recovery-required");
    assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.provider_operation.completion_path, "recovered");
    assert.equal(target.calls.filter(({ operation }) => operation === "create").length, 1);
    assert.equal(target.calls.filter(({ operation }) => operation === "find").length, 1);
    assert.equal(readAttempts, 2);
  } finally {
    target.cleanup();
  }
});

test("repository provisioning rejects stale authorization and provider mismatch", async () => {
  const request = provisionRequest();
  const staleDecision = provisionDecision(request, {
    approved_provisioning: {
      ...provisionDecision(request).approved_provisioning,
      name: "another-repository",
    },
  });
  const denied = provisioningHarness({ decision: staleDecision });
  try {
    await assert.rejects(
      denied.service.execute({ callerId: "console", input: denied.request }),
      (error) => error.code === "repository_custody_decision_mismatch",
    );
    assert.equal(denied.calls.some(({ operation }) => operation === "create"), false);
  } finally {
    denied.cleanup();
  }

  const mismatched = provisioningHarness({
    read(input) {
      return provisionReadback(input, {
        applied_provisioning: {
          owner_scope: "organization",
          initialization_state: "initialized",
          settings: {
            ...input.provisioning,
            visibility: "public",
          },
        },
      });
    },
  });
  try {
    const result = await mismatched.service.execute({
      callerId: "console",
      input: mismatched.request,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.retryable, false);
    assert.equal(result.failure.code, "repository_provider_readback_stale");
    assert.equal(result.receipt.custody.after, "unrecorded");
  } finally {
    mismatched.cleanup();
  }
});

test("repository provisioning rejects changed content under the same request identity", async () => {
  const target = provisioningHarness();
  try {
    await target.service.execute({ callerId: "console", input: target.request });
    const changed = provisionRequest({
      provisioning: {
        ...target.request.provisioning,
        description: "Changed content.",
      },
    });
    await assert.rejects(
      target.service.execute({ callerId: "console", input: changed }),
      (error) => error.code === "repository_custody_idempotency_conflict",
    );
  } finally {
    target.cleanup();
  }
});
