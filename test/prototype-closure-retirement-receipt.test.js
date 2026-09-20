import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrototypeClosureStore } from "../src/prototype-closure/store.js";

test("retirement owner proof comes only from one completed stored receipt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-closure-retirement-"));
  try {
    const store = createPrototypeClosureStore({ root });
    const ref = `receipt://prototype-closure/${"a".repeat(64)}`;
    const retirementRef = "record://prototype-closure/sample/history/prototype-closure:sample:0001";
    const revision = "b".repeat(40);
    const record = {
      caller_id: "operator:sample", binding_digest: "sha256:test",
      request: { request_id: "retire-sample", idempotency_key: "retire-sample", action: "retire-incubation" },
      status: "succeeded",
      receipt: {
        receipt_id: ref, outcome: "completed", prototype_id: "sample",
        source_event_ref: "prototype-closure:sample:0001", merged_source_revision: revision,
      },
      readback: { source_event_ref: "prototype-closure:sample:0001", merged_source_revision: revision },
    };
    await store.transact((transaction) => transaction.put(record));
    const proof = await store.readRetirementReceipt({ ref, prototypeId: "sample", retirementRef });
    assert.equal(proof.ref, ref);
    assert.equal(proof.subject_ref, retirementRef);
    assert.equal(proof.owner_ref, "operator-orchestration-service");
    await assert.rejects(
      store.readRetirementReceipt({ ref, prototypeId: "sample", retirementRef: retirementRef.replace("0001", "0002") }),
      { code: "prototype_closure_retirement_receipt_not_found" },
    );
    await assert.rejects(
      store.readRetirementReceipt({ ref, prototypeId: "other", retirementRef }),
      { code: "prototype_closure_retirement_receipt_not_found" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
