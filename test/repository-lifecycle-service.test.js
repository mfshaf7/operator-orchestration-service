import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { HttpError } from "../src/errors.js";
import { createRepositoryLifecycleService } from "../src/repository-lifecycle/service.js";
import { createRepositoryLifecycleStore } from "../src/repository-lifecycle/store.js";
import {
  lifecycleClock,
  lifecycleDecision,
  lifecycleProviderReadback,
  lifecycleRequest,
} from "../test-fixtures/repository-lifecycle.js";

function harness(action, { decision, provider } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-lifecycle-"));
  const request = lifecycleRequest(action);
  const calls = [];
  let currentProviderState = request.current_state.provider_lifecycle_state;
  let currentProviderVersion = request.current_state.provider_version;
  const service = createRepositoryLifecycleService({
    audit: { emit(event) { calls.push({ operation: "audit", event }); } },
    clock: lifecycleClock,
    providerClient: {
      async read(input) {
        calls.push({ operation: "provider-read" });
        return lifecycleProviderReadback(input, {
          provider_lifecycle_state: currentProviderState,
          provider_version: currentProviderVersion,
        });
      },
      async setArchived(input, archived) {
        calls.push({ operation: "provider-mutate", archived });
        if (provider instanceof Error) throw provider;
        currentProviderState = archived ? "archived" : "active";
        currentProviderVersion = "etag-after";
        return lifecycleProviderReadback(input, {
          provider_lifecycle_state: currentProviderState,
          provider_version: currentProviderVersion,
        });
      },
    },
    readinessClient: {
      async evaluate(input) {
        calls.push({ operation: "readiness" });
        const value = typeof decision === "function"
          ? decision(input)
          : decision ?? lifecycleDecision(input);
        return {
          decision: value,
          decisionRef: {
            uri: "wgcf://decisions/repository-lifecycle/0123456789abcdef01234567.json",
            digest: value.integrity.content_digest,
          },
        };
      },
    },
    store: createRepositoryLifecycleStore({ root }),
  });
  return {
    calls,
    cleanup() { rmSync(root, { force: true, recursive: true }); },
    request,
    root,
    service,
    setProviderState(state, version = "etag-after") {
      currentProviderState = state;
      currentProviderVersion = version;
    },
  };
}

for (const action of [
  "transfer-workspace-custody",
  "archive-provider",
  "unarchive-provider",
  "retire-workspace-record",
  "restore-workspace-record",
]) {
  test(`repository lifecycle executes and replays ${action}`, async () => {
    const target = harness(action);
    try {
      const first = await target.service.execute({ callerId: "console", input: target.request });
      const replay = await target.service.execute({ callerId: "console", input: target.request });
      const projected = await target.service.project(target.request.request_id);
      const audit = await target.service.projectRepository(target.request.repository_identity);
      assert.equal(first.status, "succeeded");
      assert.equal(first.receipt.downstream_mutation, "none");
      assert.equal(replay.replayed, true);
      assert.equal(projected.replayed, true);
      assert.equal(audit.history.length, 1);
      assert.equal(audit.history[0].action, action);
      assert.equal(target.calls.filter(({ operation }) => operation === "readiness").length, 1);
      assert.equal(
        target.calls.filter(({ operation }) => operation === "provider-mutate").length,
        ["archive-provider", "unarchive-provider"].includes(action) ? 1 : 0,
      );
    } finally { target.cleanup(); }
  });
}

test("repository lifecycle denial records history without mutation", async () => {
  const target = harness("archive-provider", {
    decision(input) {
      return lifecycleDecision(input, {
        approved_target: null,
        outcome: "denied",
        required_human_gates: [],
        findings: [{ code: "policy-denied", severity: "blocking", summary: "Policy denied the action." }],
        obligations: [],
        next_action: "stop",
      });
    },
  });
  try {
    const result = await target.service.execute({ callerId: "console", input: target.request });
    assert.equal(result.status, "denied");
    assert.equal(result.current_state.provider_lifecycle_state, "active");
    assert.equal(target.calls.some(({ operation }) => operation === "provider-read"), false);
    assert.equal(result.audit.history[0].outcome, "denied");
  } finally { target.cleanup(); }
});

test("repository lifecycle fails closed on stale state and conflicting replay", async () => {
  const stale = harness("archive-provider");
  try {
    stale.setProviderState("active", "etag-newer");
    const result = await stale.service.execute({ callerId: "console", input: stale.request });
    assert.equal(result.status, "failed");
    assert.equal(result.failure.code, "repository_lifecycle_state_stale");
    assert.equal(stale.calls.some(({ operation }) => operation === "provider-mutate"), false);
  } finally { stale.cleanup(); }

  const conflict = harness("retire-workspace-record");
  try {
    await conflict.service.execute({ callerId: "console", input: conflict.request });
    const changed = lifecycleRequest("retire-workspace-record", {
      request_id: conflict.request.request_id,
      idempotency_key: "different-content",
    });
    await assert.rejects(
      conflict.service.execute({ callerId: "console", input: changed }),
      (error) => error.code === "repository_lifecycle_idempotency_conflict",
    );
  } finally { conflict.cleanup(); }
});

test("repository lifecycle recovers provider acknowledgement without repeating mutation", async () => {
  const target = harness("archive-provider", {
    provider: new HttpError(503, "repository_provider_unavailable", "Readback unavailable."),
  });
  const originalSetState = target.setProviderState;
  try {
    const failed = await target.service.execute({ callerId: "console", input: target.request });
    assert.equal(failed.retryable, true);
    originalSetState("archived", "etag-after");
    const recovered = await target.service.execute({ callerId: "console", input: target.request });
    assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.operation.completion_path, "recovered");
    assert.equal(target.calls.filter(({ operation }) => operation === "provider-mutate").length, 1);
    assert.equal(recovered.audit.history.length, 2);
  } finally { target.cleanup(); }
});

test("repository lifecycle rejects tampered persisted evidence", async () => {
  const target = harness("retire-workspace-record");
  try {
    await target.service.execute({ callerId: "console", input: target.request });
    const [name] = readdirSync(path.join(target.root, "requests"));
    const file = path.join(target.root, "requests", name);
    const record = JSON.parse(readFileSync(file, "utf8"));
    record.receipt_ref.uri = "oos://receipts/repository-lifecycle/tampered.json";
    writeFileSync(file, `${JSON.stringify(record)}\n`);
    await assert.rejects(
      target.service.project(target.request.request_id),
      (error) => error.code === "repository_lifecycle_state_invalid",
    );
  } finally { target.cleanup(); }
});
