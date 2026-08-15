import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contractRoot = new URL(
  "../contracts/proposal-workflow/",
  import.meta.url,
);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, contractRoot), "utf8"));
}

function compileSchema(filename) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(filename));
}

function currentSource(status = "triaged") {
  return {
    projection_state: "current",
    record_ref: "openproject://work_packages/851",
    record_version: "version-17",
    status,
  };
}

function authority() {
  return {
    mutation_adapter: "operator-orchestration-service",
    record_project: "workspace-proposals",
    record_system: "openproject",
  };
}

function existingRepoRoute() {
  return {
    rationale: "The accepted proposal extends an existing product.",
    source_custody: {
      classification: "existing-repo",
      owner: "governance-operations-console",
      rationale: "The product repository already owns the source.",
      repository_gate_state: "resolved",
      repository_mode: "existing",
      source_ref: "repo:governance-operations-console",
    },
    target: "delivery",
  };
}

function commandEnvelope(command, status = "triaged") {
  return {
    authority: authority(),
    command,
    command_id: "proposal-command-851",
    operator: {
      handle: "mfshaf7",
      id: "operator-1",
    },
    proposal_id: "idea-851",
    schema_version: 1,
    source: currentSource(status),
  };
}

test("Proposal workflow manifest is valid and separates live from admitted behavior", () => {
  const validateManifest = compileSchema("manifest.schema.json");
  const manifest = readJson("manifest.json");
  const openApi = JSON.parse(
    readFileSync(new URL("../../docs/api/openapi.json", contractRoot), "utf8"),
  );

  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
  assert.equal(manifest.canonical_authority, "openproject://projects/workspace-proposals");
  assert.equal(manifest.mutation_adapter, "operator-orchestration-service");
  assert.equal(manifest.source_guards.direct_authority_bypass_allowed, false);
  assert.ok(manifest.capabilities.live.some(({ id }) => id === "proposal-triage"));
  assert.ok(
    manifest.capabilities.contract_admitted.every(
      ({ runtime_status: runtimeStatus }) => runtimeStatus === "not-implemented",
    ),
  );
  assert.ok(
    manifest.capabilities.deferred.some(
      ({ id }) => id === "proposal-console-adapter",
    ),
  );
  for (const capability of manifest.capabilities.live) {
    assert.ok(
      openApi.paths[capability.path]?.[capability.method.toLowerCase()],
      `${capability.method} ${capability.path} must remain a documented live route`,
    );
  }
});

test("Proposal commands admit valid triage, disposition, and handoff inputs", () => {
  const validate = compileSchema("command.schema.json");
  const commands = [
    commandEnvelope(
      {
        summary: "The proposal has enough context for an operator decision.",
        type: "triage",
      },
      "captured",
    ),
    commandEnvelope({
      notes: "Move the accepted proposal into governed delivery.",
      outcome: "accepted",
      route: existingRepoRoute(),
      type: "disposition",
    }),
    commandEnvelope(
      {
        notes: "Keep the proposal available for later review.",
        outcome: "parked",
        route: null,
        type: "disposition",
      },
      "parked",
    ),
    commandEnvelope(
      {
        notes: "The route and repository gate are ready for target review.",
        packet_ref: "proposal-packet:851",
        result: "ready",
        route: existingRepoRoute(),
        type: "handoff",
      },
      "accepted",
    ),
    commandEnvelope(
      {
        notes: "Repository creation must complete before handoff.",
        packet_ref: null,
        result: "blocked",
        route: {
          rationale: "The prototype requires a new source repository.",
          source_custody: {
            classification: "new-repo-required",
            owner: null,
            rationale: "Repository Operation has not resolved custody yet.",
            repository_gate_state: "pending",
            repository_mode: "new",
            source_ref: "repo-request:proposal-851",
          },
          target: "prototype",
        },
        type: "handoff",
      },
      "accepted",
    ),
  ];

  for (const command of commands) {
    assert.equal(validate(command), true, JSON.stringify(validate.errors));
  }
});

test("Proposal commands fail closed on authority, source, transition, and custody violations", () => {
  const validate = compileSchema("command.schema.json");
  const accepted = commandEnvelope({
    notes: "Move the accepted proposal into governed delivery.",
    outcome: "accepted",
    route: existingRepoRoute(),
    type: "disposition",
  });
  const invalidCommands = [
    {
      ...accepted,
      authority: {
        ...accepted.authority,
        mutation_adapter: "governance-operations-console",
      },
    },
    {
      ...accepted,
      source: {
        ...accepted.source,
        projection_state: "stale",
      },
    },
    commandEnvelope(
      {
        summary: "A parked proposal cannot bypass Disposition through Triage.",
        type: "triage",
      },
      "parked",
    ),
    commandEnvelope({
      notes: "Accepted outcomes require a route.",
      outcome: "accepted",
      route: null,
      type: "disposition",
    }),
    commandEnvelope({
      notes: "Parked outcomes cannot carry a route.",
      outcome: "parked",
      route: existingRepoRoute(),
      type: "disposition",
    }),
    commandEnvelope(
      {
        notes: "Handoff cannot start before acceptance.",
        packet_ref: "proposal-packet:851",
        result: "ready",
        route: existingRepoRoute(),
        type: "handoff",
      },
      "triaged",
    ),
    commandEnvelope(
      {
        notes: "Pending repository custody cannot produce a ready handoff.",
        packet_ref: "proposal-packet:851",
        result: "ready",
        route: {
          rationale: "A new repository is required.",
          source_custody: {
            classification: "new-repo-required",
            owner: null,
            rationale: "The repository request remains unresolved.",
            repository_gate_state: "pending",
            repository_mode: "new",
            source_ref: "repo-request:proposal-851",
          },
          target: "prototype",
        },
        type: "handoff",
      },
      "accepted",
    ),
  ];

  for (const command of invalidCommands) {
    assert.equal(validate(command), false, JSON.stringify(command));
  }
});

test("Proposal projection requires target-owned evidence before handoff is applied", () => {
  const validate = compileSchema("projection.schema.json");
  const projection = {
    body: "Add a durable Proposal integration boundary.",
    decision_notes: "Accepted for governed delivery.",
    handoff: {
      packet_ref: "proposal-packet:851",
      state: "applied",
      target_receipt_ref: "delivery-ingress-receipt:851",
      target_record_ref: "openproject://work_packages/901",
    },
    last_event_ref: "proposal-event:851-4",
    projection_state: "current",
    proposal_id: "idea-851",
    record_project: "workspace-proposals",
    record_ref: "openproject://work_packages/851",
    record_system: "openproject",
    record_version: "version-19",
    route: existingRepoRoute(),
    schema_version: 1,
    source: {
      context_ref: {},
      ingress: "console",
      native_ref: {
        request_id: "console-request-851"
      },
      surface: "governance-operations-console",
    },
    status: "accepted",
    title: "Proposal contract parity",
    triage_summary: "Define the missing typed integration boundary.",
    updated_at: "2026-08-15T13:30:00Z",
  };

  assert.equal(validate(projection), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...projection,
      handoff: {
        ...projection.handoff,
        target_receipt_ref: null,
      },
    }),
    false,
  );
  assert.equal(
    validate({
      ...projection,
      route: {
        ...projection.route,
        source_custody: {
          ...projection.route.source_custody,
          repository_mode: "new",
        },
      },
    }),
    false,
  );
});

test("Proposal events and history are strict read-only projections", () => {
  const validateEvent = compileSchema("event.schema.json");
  const validateHistory = compileSchema("history.schema.json");
  const event = {
    actor: {
      id: "delivery-adapter",
      kind: "target",
    },
    command_id: "proposal-command-851",
    event_id: "proposal-event:851-4",
    event_type: "handoff-applied",
    occurred_at: "2026-08-15T13:30:00Z",
    proposal_id: "idea-851",
    receipt_refs: [
      "delivery-ingress-receipt:851"
    ],
    record_version: "version-19",
    schema_version: 1,
    status_after: "accepted",
    status_before: "accepted",
    summary: "Delivery acknowledged the Proposal handoff packet.",
  };

  assert.equal(validateEvent(event), true, JSON.stringify(validateEvent.errors));
  assert.equal(
    validateHistory({
      events: [event],
      next_cursor: null,
      proposal_id: "idea-851",
      record_version: "version-19",
      schema_version: 1,
    }),
    true,
    JSON.stringify(validateHistory.errors),
  );
  assert.equal(validateEvent({ ...event, mutable: true }), false);
});
