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
        return {
          decision: targetDecision,
          decisionRef: {
            uri: "wgcf://decisions/repository-custody/0123456789abcdef01234567.json",
            digest: targetDecision.integrity.content_digest,
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
    const first = await target.service.link({
      callerId: "governance-operations-console",
      input: target.request,
    });
    const replay = await target.service.link({
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
    await target.service.link({ callerId: "console", input: target.request });
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
    const result = await target.service.link({ callerId: "console", input: target.request });
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
      denied.service.link({ callerId: "console", input: denied.request }),
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
    const result = await stale.service.link({ callerId: "console", input: stale.request });
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
    assert.equal((await service.link({ callerId: "console", input: request })).retryable, true);
    const recovered = await service.link({ callerId: "console", input: request });
    assert.equal(recovered.status, "succeeded");
    assert.equal(attempts, 2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
