import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HttpError } from "../src/errors.js";
import { createLifecycleTransitionService } from "../src/lifecycle-transition/service.js";
import { createLifecycleTransitionStore } from "../src/lifecycle-transition/store.js";

const times = [
  "2026-09-27T12:00:00.000Z",
  "2026-09-27T12:01:00.000Z",
  "2026-09-27T12:02:00.000Z",
  "2026-09-27T12:03:00.000Z",
  "2026-09-27T12:04:00.000Z",
  "2026-09-27T12:05:00.000Z",
  "2026-09-27T12:06:00.000Z",
  "2026-09-27T12:07:00.000Z",
  "2026-09-27T12:08:00.000Z",
  "2026-09-27T12:09:00.000Z",
  "2026-09-27T12:10:00.000Z",
  "2026-09-27T12:11:00.000Z",
  "2026-09-27T12:12:00.000Z",
  "2026-09-27T12:13:00.000Z",
  "2026-09-27T12:14:00.000Z",
  "2026-09-27T12:15:00.000Z",
];

function request(overrides = {}) {
  return {
    schema_version: 1,
    route_id: "proposal-to-delivery",
    correlation_id: "proposal-42:delivery:1",
    idempotency_key: "proposal-42:delivery:1",
    requested_by: "console",
    source: {
      owner_ref: "proposal",
      projection_version: "version-8",
      record_id: "proposal:42",
      source_version: "version-8",
    },
    reason: {
      code: "delivery-required",
      detail: "The accepted proposal requires governed delivery.",
    },
    evidence_refs: ["proposal-event://42/handoff-ready"],
    supersedes_transition_id: null,
    ...overrides,
  };
}

function event(kind, sequence, details, authority, index = sequence + 1) {
  return {
    schema_version: 1,
    event_id: `${kind}:${sequence}`,
    expected_sequence: sequence,
    artifact_kind: kind,
    authority,
    evidence_refs: [`evidence://${kind}/${sequence}`],
    recorded_at: times[index],
    details,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-lifecycle-transition-"));
  let clockIndex = 0;
  const service = createLifecycleTransitionService({
    clock: () => new Date(times[clockIndex++]),
    store: createLifecycleTransitionStore({ root }),
    writerBindings: {
      console: ["proposal", "prototype"],
      wgcf: ["workspace-governance-control-fabric"],
      delivery: ["delivery-ingress-policy"],
      adapter: ["delivery-ingress-adapter"],
      oos: ["operator-orchestration-service"],
    },
  });
  return { root, service };
}

async function create(service, value = request()) {
  return service.create({
    callerId: "console",
    correlationId: "http-correlation",
    request: value,
  });
}

async function append(service, transitionId, callerId, value) {
  return service.append({
    callerId,
    correlationId: "http-correlation",
    event: value,
    transitionId,
  });
}

test("runtime image carries the pinned Lifecycle Transition contract bundle", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/lifecycle-transition \.\/contracts\/lifecycle-transition/,
  );
});

test("creates one deterministic canonical transition and replays identical input", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await create(service);
  const replay = await create(service);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.transition.projection.transition_id, first.transition.projection.transition_id);
  assert.equal(first.transition.projection.state, "prepared");
  assert.deepEqual(first.transition.projection.next_action, {
    action: "start-validation",
    owner_ref: "workspace-governance-control-fabric",
    review_at: null,
  });
  assert.equal(first.transition.revision.event_sequence, 0);
  assert.equal(first.transition.binding.authority, "operator-orchestration-service");

  await assert.rejects(
    create(service, request({ reason: { code: "changed", detail: "Changed input." } })),
    (error) => error instanceof HttpError && error.code === "lifecycle_transition_idempotency_conflict",
  );
  await assert.rejects(
    service.create({ callerId: "oos", correlationId: "x", request: request({ requested_by: "oos" }) }),
    (error) => error.statusCode === 403,
  );
});

test("derives target metadata for every locked route", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    {
      routeId: "proposal-to-delivery",
      sourceOwner: "proposal",
      target: {
        admission_owner_ref: "delivery-ingress-policy",
        application_owner_ref: "delivery-ingress-adapter",
        domain: "delivery",
        home_ref: "workspace-delivery-art",
        ingress_ref: "delivery-intake",
        lane_ref: "delivery-intake",
      },
    },
    {
      routeId: "proposal-to-prototype",
      sourceOwner: "proposal",
      target: {
        admission_owner_ref: "prototype-ingress-policy",
        application_owner_ref: "prototype-ingress-adapter",
        domain: "prototype",
        home_ref: "workspace-prototype-studio",
        ingress_ref: "prototype-ingress",
        lane_ref: "prototype-landing",
      },
    },
    {
      routeId: "prototype-to-delivery",
      sourceOwner: "prototype",
      target: {
        admission_owner_ref: "delivery-ingress-policy",
        application_owner_ref: "delivery-ingress-adapter",
        domain: "delivery",
        home_ref: "workspace-delivery-art",
        ingress_ref: "delivery-intake",
        lane_ref: "delivery-intake",
      },
    },
  ];

  for (const [index, value] of cases.entries()) {
    const input = request({
      correlation_id: `${value.routeId}:${index}`,
      idempotency_key: `${value.routeId}:${index}`,
      route_id: value.routeId,
      source: {
        owner_ref: value.sourceOwner,
        projection_version: "version-1",
        record_id: `${value.sourceOwner}:${index}`,
        source_version: "version-1",
      },
    });
    const created = await create(service, input);
    assert.deepEqual(created.transition.projection.target, value.target);
  }
});

test("projects blocked, returned, rejected, and cancelled outcomes with exact recovery", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const validationAuthority = {
    owner_ref: "workspace-governance-control-fabric",
    role: "validation-authority",
  };

  const blockedId = (await create(service, request({
    correlation_id: "blocked",
    idempotency_key: "blocked",
  }))).transition.projection.transition_id;
  await append(service, blockedId, "wgcf", event(
    "validation-started", 0, { run_ref: "wgcf-run://blocked" }, validationAuthority,
  ));
  const blocked = await append(service, blockedId, "wgcf", event("validation-completed", 1, {
    gates: [{
      evidence_ref: "evidence://gate/repository",
      gate_id: "repository-ready",
      owner_ref: "proposal",
      required_fix: "Select the repository posture.",
      state: "blocked",
    }],
    receipt_ref: null,
    requires_authority_decision: false,
    state: "blocked",
  }, validationAuthority));
  assert.equal(blocked.transition.projection.state, "blocked");
  assert.deepEqual(blocked.transition.projection.next_action, {
    action: "resolve-gate",
    owner_ref: "proposal",
    review_at: null,
  });
  const returned = await append(service, blockedId, "console", event(
    "source-correction-returned",
    2,
    {
      correction: {
        owner_ref: "proposal",
        reason_code: "repository-posture-missing",
        required_fix: "Record the selected repository posture.",
      },
    },
    { owner_ref: "proposal", role: "source-domain" },
  ));
  assert.equal(returned.transition.projection.state, "returned");
  assert.equal(returned.transition.projection.next_action.action, "correct-source");

  const rejectedId = (await create(service, request({
    correlation_id: "rejected",
    idempotency_key: "rejected",
  }))).transition.projection.transition_id;
  await append(service, rejectedId, "wgcf", event(
    "validation-started", 0, { run_ref: "wgcf-run://rejected" }, validationAuthority, 5,
  ));
  await append(service, rejectedId, "wgcf", event("validation-completed", 1, {
    gates: [],
    receipt_ref: "wgcf-receipt://rejected",
    requires_authority_decision: false,
    state: "passed",
  }, validationAuthority, 6));
  const rejected = await append(service, rejectedId, "delivery", event(
    "target-admission-recorded",
    2,
    {
      admission: {
        reason_code: "target-capacity-unavailable",
        receipt_ref: null,
        recorded_at: times[7],
        state: "rejected",
        target_record_ref: null,
      },
    },
    { owner_ref: "delivery-ingress-policy", role: "target-domain" },
    7,
  ));
  assert.equal(rejected.transition.projection.state, "rejected");
  assert.equal(rejected.transition.projection.next_action.action, "review-rejection");

  const cancelled = await append(service, rejectedId, "console", event(
    "transition-cancelled",
    3,
    { reason_code: "operator-withdrew-request" },
    { owner_ref: "proposal", role: "source-domain" },
    8,
  ));
  assert.equal(cancelled.transition.projection.state, "cancelled");
  assert.equal(cancelled.transition.projection.next_action, null);
});

test("records the complete proposal-to-delivery sequence with exact receipts", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = await create(service);
  const id = created.transition.projection.transition_id;
  const validationAuthority = {
    owner_ref: "workspace-governance-control-fabric",
    role: "validation-authority",
  };
  const events = [
    ["wgcf", event("validation-started", 0, { run_ref: "wgcf-run://1" }, validationAuthority)],
    ["wgcf", event("validation-completed", 1, {
      gates: [],
      receipt_ref: "wgcf-receipt://1",
      requires_authority_decision: false,
      state: "passed",
    }, validationAuthority)],
    ["delivery", event("target-admission-recorded", 2, {
      admission: {
        reason_code: null,
        receipt_ref: "delivery-admission://42",
        recorded_at: times[4],
        state: "admitted",
        target_record_ref: "openproject://work_packages/142",
      },
    }, { owner_ref: "delivery-ingress-policy", role: "target-domain" })],
    ["oos", event("application-started", 3, { run_ref: "oos-run://42" }, {
      owner_ref: "operator-orchestration-service",
      role: "orchestration",
    })],
    ["adapter", event("target-application-recorded", 4, {
      application: {
        evidence_kind: "target-admission-receipt",
        receipt_ref: "delivery-admission://42",
        resulting_refs: ["openproject://work_packages/142"],
        target_record_ref: "openproject://work_packages/142",
      },
    }, { owner_ref: "delivery-ingress-adapter", role: "target-adapter" })],
  ];
  let result;
  for (const [callerId, value] of events) {
    result = await append(service, id, callerId, value);
  }
  assert.equal(result.transition.projection.state, "applied");
  assert.equal(result.transition.projection.next_action, null);
  assert.equal(result.transition.projection.application.state, "applied");
  assert.equal(result.transition.projection.application.receipt_ref, "delivery-admission://42");
  assert.equal(result.transition.revision.event_sequence, 5);
  assert.equal(result.transition.projection.history.entries.length, 6);
  await assert.rejects(
    append(service, id, "oos", event("transition-cancelled", 5, { reason_code: "late" }, {
      owner_ref: "proposal",
      role: "source-domain",
    }, 7)),
    (error) => error.code === "lifecycle_transition_writer_forbidden" || error.code === "lifecycle_transition_terminal",
  );
});

test("fails closed on stale order, supports exact replay, and recovers retryable application", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = (await create(service)).transition.projection.transition_id;
  const validation = event("validation-started", 0, { run_ref: "wgcf-run://2" }, {
    owner_ref: "workspace-governance-control-fabric",
    role: "validation-authority",
  });
  const first = await append(service, id, "wgcf", validation);
  const replay = await append(service, id, "wgcf", validation);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    append(service, id, "wgcf", { ...validation, event_id: "other-event" }),
    (error) => error.code === "lifecycle_transition_revision_conflict",
  );
  await append(service, id, "wgcf", event("validation-completed", 1, {
    gates: [],
    receipt_ref: "wgcf-receipt://retry",
    requires_authority_decision: false,
    state: "passed",
  }, validation.authority));
  await append(service, id, "delivery", event("target-admission-recorded", 2, {
    admission: {
      reason_code: null,
      receipt_ref: "delivery-admission://retry",
      recorded_at: times[3],
      state: "admitted",
      target_record_ref: "openproject://work_packages/143",
    },
  }, { owner_ref: "delivery-ingress-policy", role: "target-domain" }));
  const orchestration = {
    owner_ref: "operator-orchestration-service",
    role: "orchestration",
  };
  await append(service, id, "oos", event("application-started", 3, {
    run_ref: "oos-run://retry-1",
  }, orchestration));
  const failed = await append(service, id, "oos", event("application-failed", 4, {
    failure: {
      code: "target-timeout",
      detail: "The target adapter timed out before a receipt was returned.",
      retryable: true,
      run_ref: "oos-run://retry-1",
    },
  }, orchestration));
  assert.equal(failed.transition.projection.state, "failed");
  assert.equal(failed.transition.projection.next_action.action, "retry-application");
  const retried = await append(service, id, "oos", event("application-started", 5, {
    run_ref: "oos-run://retry-2",
  }, orchestration));
  assert.equal(retried.transition.projection.state, "applying");
  assert.equal(retried.transition.projection.application.failure_code, null);
});

test("atomically supersedes a live transition and preserves durable integrity", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prior = await create(service);
  const priorId = prior.transition.projection.transition_id;
  const replacementRequest = request({
    correlation_id: "proposal-42:delivery:2",
    idempotency_key: "proposal-42:delivery:2",
    supersedes_transition_id: priorId,
  });
  const replacement = await create(service, replacementRequest);
  const old = await service.get({ callerId: "console", correlationId: "x", transitionId: priorId });
  assert.equal(old.projection.state, "superseded");
  assert.equal(old.projection.superseded_by_transition_id, replacement.transition.projection.transition_id);
  assert.equal(replacement.transition.projection.supersedes_transition_id, priorId);

  const disk = JSON.parse(await readFile(path.join(root, "journal.json"), "utf8"));
  await writeFile(path.join(root, "journal.json"), JSON.stringify({ ...disk, digest: "sha256:broken" }));
  await assert.rejects(
    service.get({ callerId: "console", correlationId: "x", transitionId: priorId }),
    (error) => error.code === "lifecycle_transition_storage_invalid" && error.statusCode === 503,
  );
});

test("bounded list and history expose owner-backed records without raw event details", async (t) => {
  const { root, service } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = await create(service);
  const id = created.transition.projection.transition_id;
  await append(service, id, "wgcf", event("validation-started", 0, { run_ref: "wgcf-run://3" }, {
    owner_ref: "workspace-governance-control-fabric",
    role: "validation-authority",
  }));
  const list = await service.list({
    callerId: "console",
    correlationId: "x",
    filters: { routeId: "proposal-to-delivery" },
    limit: 1,
  });
  const history = await service.history({
    callerId: "console",
    correlationId: "x",
    transitionId: id,
    limit: 1,
  });
  assert.equal(list.transitions.length, 1);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].artifact_kind, "validation-started");
  assert.equal("details" in history.entries[0], false);
  assert.equal(history.next_cursor, "history-before:1");
});
