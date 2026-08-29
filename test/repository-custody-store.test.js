import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRepositoryCustodyStore } from "../src/repository-custody/store.js";
import { custodyRequest } from "../test-fixtures/repository-custody.js";

test("repository custody store binds request identity and rejects corrupt state", () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-custody-store-"));
  const store = createRepositoryCustodyStore({ root });
  const request = custodyRequest();
  const record = { request, retryable: false, status: "denied" };
  try {
    assert.equal(store.put(record), record);
    assert.deepEqual(store.get(request.request_id), record);

    const changed = custodyRequest({
      requested_custody: {
        workspace_owner_ref: "repo:another-owner",
        custody_kind: "dedicated-owner-repo",
      },
    });
    assert.throws(
      () => store.put({ request: changed, retryable: false, status: "denied" }),
      (error) => error.code === "repository_custody_idempotency_conflict",
    );

    const [recordName] = readdirSync(path.join(root, "records"));
    writeFileSync(path.join(root, "records", recordName), "not-json\n");
    assert.throws(
      () => store.get(request.request_id),
      (error) => error.code === "repository_custody_state_corrupt",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("repository custody store removes abandoned locks and preserves live locks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-repository-custody-lock-"));
  const request = custodyRequest();
  const key = createHash("sha256").update(request.request_id).digest("hex");
  const lockRoot = path.join(root, "locks");
  const lockPath = path.join(lockRoot, `${key}.lock`);
  const store = createRepositoryCustodyStore({ root });
  try {
    writeFileSync(lockPath, `${JSON.stringify({ pid: 999999999, token: "stale" })}\n`);
    assert.equal(store.put({ request, retryable: false, status: "denied" }).status, "denied");

    const second = custodyRequest({ request_id: "repository-custody-request:link-example-002" });
    const secondKey = createHash("sha256").update(second.request_id).digest("hex");
    const secondLock = path.join(lockRoot, `${secondKey}.lock`);
    mkdirSync(lockRoot, { recursive: true });
    writeFileSync(secondLock, `${JSON.stringify({ pid: process.pid, token: "live" })}\n`);
    assert.throws(
      () => store.put({ request: second, retryable: false, status: "denied" }),
      (error) => error.code === "repository_custody_state_busy",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
