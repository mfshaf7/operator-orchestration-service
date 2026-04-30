import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  archiveLegacyScratchArtifacts,
  createMutationDraft,
  createReviewPacketDraft,
  inspectScratchArtifacts,
  validateMutationDraft,
  validateReviewPacket,
  validateReviewPacketReadiness,
} from "../src/art-workflow-artifacts.js";

test("mutation draft creation locks route to supported broker operations", () => {
  const draft = createMutationDraft({
    operation: "work-item.complete",
    targetId: "381",
  });

  assert.equal(draft.artifact_type, "art_mutation_draft");
  assert.equal(draft.target.id, "work-item-381");
  assert.deepEqual(draft.route, {
    method: "POST",
    path: "/v1/delivery-work-items/work-item-381/complete",
  });

  const validation = validateMutationDraft(draft);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.warnings.some((entry) => entry.includes("CHECK")), true);
});

test("bulk update mutation drafts include the broker input schema version", () => {
  const draft = createMutationDraft({
    operation: "work-item.bulk-update",
    targetId: "-",
  });

  assert.deepEqual(draft.route, {
    method: "POST",
    path: "/v1/delivery-work-items/bulk-update",
  });
  assert.equal(draft.payload.input.schema_version, 1);

  const validation = validateMutationDraft(draft);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("bulk update mutation draft validation rejects missing input schema version", () => {
  const draft = createMutationDraft({
    operation: "work-item.bulk-update",
    targetId: "-",
  });
  delete draft.payload.input.schema_version;

  const validation = validateMutationDraft(draft);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes(
      "payload.input.schema_version must equal 1 for work-item.bulk-update",
    ),
    true,
  );
});

test("bulk update mutation draft validation preflights done description completion evidence", () => {
  const draft = createMutationDraft({
    operation: "work-item.bulk-update",
    targetId: "-",
  });
  draft.payload.input.updates = [
    {
      description: [
        "## Completion Summary",
        "",
        "Repaired done-state notes to match the closeout standard.",
        "",
        "## Changed Surfaces",
        "",
        "- `operator-orchestration-service/src/art-workflow-artifacts.js`: backs the CLI with managed draft read/write behavior, route metadata, validation state, and submission results.",
        "",
        "## Test Result Evidence",
        "",
        "- PASS: `npm test`",
        "",
        "## Validation Evidence",
        "",
        "- PASS: `npm run art -- draft validate .art/drafts/example.json`",
      ].join("\n"),
      target_work_package_id: "385",
    },
  ];

  const validResult = validateMutationDraft(draft);
  assert.equal(validResult.valid, true);
  assert.deepEqual(validResult.errors, []);

  draft.payload.input.updates[0].description = [
    "## Completion Summary",
    "",
    "Repaired done-state notes to match the closeout standard.",
    "",
    "## Changed Surfaces",
    "",
    "- operator-orchestration-service/src/art-workflow-artifacts.js",
    "",
    "## Test Result Evidence",
    "",
    "- PASS: `npm test`",
    "",
    "## Validation Evidence",
    "",
    "- PASS: `npm run art -- draft validate .art/drafts/example.json`",
  ].join("\n");

  const invalidResult = validateMutationDraft(draft);
  assert.equal(invalidResult.valid, false);
  assert.equal(
    invalidResult.errors.some((entry) =>
      entry.includes("payload.input.updates[0].description: Changed Surfaces"),
    ),
    true,
  );
});

test("work item create mutation draft validation preflights active PI Objective narrative", () => {
  const draft = createMutationDraft({
    operation: "work-item.create",
    targetId: "-",
  });
  draft.payload.input = {
    acceptance_criteria: "- Architecture slice can start from this objective.",
    actual_business_value: 0,
    assignee_login: "Workspace Governance",
    definition_of_done: "- Design artifacts are merged and reviewed.",
    definition_of_ready: "- Admission foundation is complete.",
    delivery_team: "Platform Architecture",
    description: "Create the PI objective.",
    iteration: "PI-2026-03 / Iteration 1",
    owner_repo: "workspace-governance",
    parent_work_item_id: "work-item-420",
    pi_objective_type: "Committed",
    planned_business_value: 8,
    responsible_login: "Workspace Governance",
    status: "in-progress",
    subject: "Define the control-fabric architecture foundation",
    target_pi: "PI-2026-03",
    type: "PI Objective",
  };

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: Narrative headings: Outcome, Why This PI, Success Signal, Execution Context"),
    ),
    true,
  );
});

test("work item create mutation draft validation accepts active PI Objective narrative", () => {
  const draft = createMutationDraft({
    operation: "work-item.create",
    targetId: "-",
  });
  draft.payload.input = {
    acceptance_criteria: "- Architecture slice can start from this objective.",
    actual_business_value: 0,
    assignee_login: "Workspace Governance",
    definition_of_done: "- Design artifacts are merged and reviewed.",
    definition_of_ready: "- Admission foundation is complete.",
    delivery_team: "Platform Architecture",
    description: [
      "## Outcome",
      "",
      "Define the architecture and trust-boundary foundation.",
      "",
      "## Why This PI",
      "",
      "Implementation depends on stable architecture truth.",
      "",
      "## Success Signal",
      "",
      "Runtime features can consume the design without chat memory.",
      "",
      "## Execution Context",
      "",
      "- Owner Repo: workspace-governance",
      "- Parent Item: #420 Build Workspace Governance Control Fabric foundation",
      "- Delivery Team: Platform Architecture",
      "- Iteration: PI-2026-03 / Iteration 1",
    ].join("\n"),
    iteration: "PI-2026-03 / Iteration 1",
    owner_repo: "workspace-governance",
    parent_work_item_id: "work-item-420",
    pi_objective_type: "Committed",
    planned_business_value: 8,
    responsible_login: "Workspace Governance",
    status: "in-progress",
    subject: "Define the control-fabric architecture foundation",
    target_pi: "PI-2026-03",
    type: "PI Objective",
  };

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("plan apply mutation draft validation preflights active PI Objective contract", () => {
  const draft = createMutationDraft({
    operation: "initiative.plan.apply",
    targetId: "420",
  });
  draft.payload.input.plan.items = [
    {
      actualBusinessValue: 0,
      deliveryTeam: "Platform Architecture",
      description: [
        "## Outcome",
        "",
        "Deliver the runtime skeleton foundation.",
        "",
        "## Why This PI",
        "",
        "The control fabric needs a real runtime seam.",
        "",
        "## Success Signal",
        "",
        "The first runtime feature can run locally.",
        "",
        "## Execution Context",
        "",
        "- Owner Repo: workspace-governance-control-fabric",
        "- Parent Item: #420 Build Workspace Governance Control Fabric foundation",
        "- Delivery Team: Platform Architecture",
        "- Iteration: PI-2026-03 / Iteration 1",
      ].join("\n"),
      iteration: "PI-2026-03 / Iteration 1",
      ownerRepo: "workspace-governance-control-fabric",
      plannedBusinessValue: 8,
      status: "in-progress",
      subject: "Deliver the control-fabric runtime skeleton foundation for PI-2026-03",
      target_pi: "PI-2026-03",
      type: "PI Objective",
    },
  ];

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: PI Objective Type: input.pi_objective_type is required for active PI Objective creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: Assignee: input.assignee_login is required for active PI Objective creation"),
    ),
    true,
  );
});

test("plan apply mutation draft validation accepts active PI Objective contract", () => {
  const draft = createMutationDraft({
    operation: "initiative.plan.apply",
    targetId: "420",
  });
  draft.payload.input.plan.items = [
    {
      acceptanceCriteria: "- Runtime skeleton feature is complete.",
      actualBusinessValue: 0,
      assigneeLogin: "Workspace Governance Control Fabric",
      definitionOfDone: "- Feature #430 is complete.",
      definitionOfReady: "- Architecture foundation is complete.",
      deliveryTeam: "Platform Architecture",
      description: [
        "## Outcome",
        "",
        "Deliver the runtime skeleton foundation.",
        "",
        "## Why This PI",
        "",
        "The control fabric needs a real runtime seam.",
        "",
        "## Success Signal",
        "",
        "The first runtime feature can run locally.",
        "",
        "## Execution Context",
        "",
        "- Owner Repo: workspace-governance-control-fabric",
        "- Parent Item: #420 Build Workspace Governance Control Fabric foundation",
        "- Delivery Team: Platform Architecture",
        "- Iteration: PI-2026-03 / Iteration 1",
      ].join("\n"),
      iteration: "PI-2026-03 / Iteration 1",
      ownerRepo: "workspace-governance-control-fabric",
      piObjectiveType: "Committed",
      plannedBusinessValue: 8,
      responsibleLogin: "Workspace Governance Control Fabric",
      status: "in-progress",
      subject: "Deliver the control-fabric runtime skeleton foundation for PI-2026-03",
      target_pi: "PI-2026-03",
      type: "PI Objective",
    },
  ];

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("pi review mutation draft validation rejects invalid target id before submit", () => {
  const draft = createMutationDraft({
    operation: "initiative.pi-review",
    targetId: "420",
  });
  draft.payload.input = {
    pi_review_date: "2026-04-30",
    reviews: [
      {
        actual_business_value: 8,
        review_outcome: "Met",
        target_work_package_id: "work-item-476",
      },
    ],
    target_pi: "PI-2026-03",
  };

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input.reviews[0].target_work_package_id"),
    ),
    true,
  );
});

test("pi review mutation draft validation accepts documented integer target id", () => {
  const draft = createMutationDraft({
    operation: "initiative.pi-review",
    targetId: "420",
  });
  draft.payload.input = {
    pi_review_date: "2026-04-30",
    reviews: [
      {
        actual_business_value: 8,
        review_outcome: "Met",
        target_work_package_id: 476,
      },
    ],
    target_pi: "PI-2026-03",
  };

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("plan apply mutation draft validation rejects unsupported snake-case actor keys", () => {
  const draft = createMutationDraft({
    operation: "initiative.plan.apply",
    targetId: "420",
  });
  draft.payload.input.plan.items = [
    {
      acceptanceCriteria: "- Manifest graph PI objective can be tracked.",
      actualBusinessValue: 0,
      assignee_login: "Workspace Governance Control Fabric",
      definitionOfDone: "- Manifest graph feature has a source-backed Review Packet.",
      definitionOfReady: "- Runtime skeleton is complete.",
      deliveryTeam: "Platform Architecture",
      description: [
        "## Outcome",
        "",
        "Deliver the manifest graph foundation.",
        "",
        "## Why This PI",
        "",
        "The control fabric needs a durable manifest graph before validators scale.",
        "",
        "## Success Signal",
        "",
        "Manifest ingestion work can proceed from recorded ART truth.",
        "",
        "## Execution Context",
        "",
        "- Owner Repo: workspace-governance-control-fabric",
        "- Parent Item: #420 Build Workspace Governance Control Fabric foundation",
        "- Delivery Team: Platform Architecture",
        "- Iteration: PI-2026-03 / Iteration 1",
      ].join("\n"),
      iteration: "PI-2026-03 / Iteration 1",
      ownerRepo: "workspace-governance-control-fabric",
      piObjectiveType: "Committed",
      plannedBusinessValue: 8,
      responsible_login: "Workspace Governance Control Fabric",
      status: "in-progress",
      subject: "Deliver the control-fabric manifest graph foundation for PI-2026-03",
      target_pi: "PI-2026-03",
      type: "PI Objective",
    },
  ];

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0] contains unsupported keys: assignee_login, responsible_login."),
    ),
    true,
  );
});

test("plan apply mutation draft validation preflights ready User story contract", () => {
  const draft = createMutationDraft({
    operation: "initiative.plan.apply",
    targetId: "420",
  });
  draft.payload.input.plan.items = [
    {
      deliveryTeam: "Platform Architecture",
      description: [
        "## What This Enables",
        "",
        "Define the manifest schema front.",
      ].join("\n"),
      executionClassification: "Enabler",
      iteration: "PI-2026-03 / Iteration 1",
      ownerRepo: "workspace-governance-control-fabric",
      status: "ready",
      subject: "Enabler: Define governance manifest schema for repos, components, validators, and projections",
      target_pi: "PI-2026-03",
      type: "User story",
    },
  ];

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: Acceptance Criteria: input.acceptance_criteria is required for active User story creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: Definition of Ready: input.definition_of_ready is required for active User story creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: Definition of Done: input.definition_of_done is required for active User story creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: plan.items[0]: Narrative headings: Why This Matters Now, Evidence Expectation, Execution Context"),
    ),
    true,
  );
});

test("plan apply mutation draft validation accepts ready User story contract", () => {
  const draft = createMutationDraft({
    operation: "initiative.plan.apply",
    targetId: "420",
  });
  draft.payload.input.plan.items = [
    {
      acceptanceCriteria: "- Schema defines repo, component, validator, and projection manifests.",
      definitionOfDone: "- Schema and tests are merged with Review Packet evidence.",
      definitionOfReady: "- Runtime skeleton and manifest graph PI objective are active.",
      deliveryTeam: "Platform Architecture",
      description: [
        "## What This Enables",
        "",
        "Define the manifest schema front for the runtime control graph.",
        "",
        "## Why This Matters Now",
        "",
        "The control fabric needs stable manifest truth before ingestion work expands.",
        "",
        "## Evidence Expectation",
        "",
        "Source change, schema tests, and Review Packet evidence prove the schema front.",
        "",
        "## Execution Context",
        "",
        "- Owner Repo: workspace-governance-control-fabric",
        "- Parent Item: #435 Enabler: Implement manifest ingestion and the runtime control graph",
        "- Delivery Team: Platform Architecture",
        "- Iteration: PI-2026-03 / Iteration 1",
      ].join("\n"),
      executionClassification: "Enabler",
      iteration: "PI-2026-03 / Iteration 1",
      ownerRepo: "workspace-governance-control-fabric",
      status: "ready",
      subject: "Enabler: Define governance manifest schema for repos, components, validators, and projections",
      target_pi: "PI-2026-03",
      type: "User story",
    },
  ];

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("work item create mutation draft validation preflights active Defect required fields", () => {
  const draft = createMutationDraft({
    operation: "work-item.create",
    targetId: "-",
  });
  draft.payload.input = {
    assignee_login: "Operator Orchestration-Service",
    delivery_team: "Workflow Integration",
    description: [
      "## Observed Failure",
      "",
      "Active source-backed ART work could merge before Review Packet readiness was proven.",
      "",
      "## Expected Behavior",
      "",
      "The broker should fail closed before merge when item evidence is incomplete.",
      "",
      "## Reproduction / Trigger",
      "",
      "Open a PR for source-backed ART work without item-level Review Packet evidence.",
      "",
      "## Impact",
      "",
      "The operator has to create corrective PRs after merge.",
      "",
      "## Execution Context",
      "",
      "- Owner Repo: operator-orchestration-service",
      "- Parent Item: #426 Define the control-fabric architecture, operating model, and threat boundary",
      "- Delivery Team: Workflow Integration",
      "- Iteration: PI-2026-03 / Iteration 1",
    ].join("\n"),
    iteration: "PI-2026-03 / Iteration 1",
    owner_repo: "operator-orchestration-service",
    parent_work_item_id: "work-item-426",
    responsible_login: "Operator Orchestration-Service",
    status: "in-progress",
    subject: "Add pre-merge landing-unit readiness gate for source-backed ART work",
    target_pi: "PI-2026-03",
    type: "Defect",
  };

  const validation = validateMutationDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: Acceptance Criteria: input.acceptance_criteria is required for active Defect creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: Definition of Ready: input.definition_of_ready is required for active Defect creation"),
    ),
    true,
  );
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("payload.input: Definition of Done: input.definition_of_done is required for active Defect creation"),
    ),
    true,
  );
});

test("mutation draft validation rejects route tampering", () => {
  const draft = createMutationDraft({
    operation: "initiative.governance",
    targetId: "378",
  });
  draft.route.path = "/api/v3/work_packages/378";

  const validation = validateMutationDraft(draft);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("/v1/delivery-initiatives/delivery-378/governance"),
    ),
    true,
  );
});

test("review packet final validation rejects tmp scratch evidence", () => {
  const packet = {
    artifact_type: "art_review_packet",
    covered_work_item_ids: ["work-item-381"],
    delivery_id: "delivery-378",
    evidence: {
      validations: ["- PASS: npm test"],
    },
    landing_unit: {
      evidence_kind: "merged_pr",
      merge_commit: "abc123",
      pr_url: "https://github.example/pr/1",
      repos: [
        {
          branch: "codex/example",
          changed_files: [".tmp/complete-381.json"],
          head_sha: "abc123",
          repo_name: "operator-orchestration-service",
        },
      ],
      rollback_boundary: "One OOS branch and PR.",
    },
    schema_version: 1,
    status: "draft",
  };

  const validation = validateReviewPacket(packet, { final: true });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes(
      "review packets must not use .tmp scratch files as durable evidence",
    ),
    true,
  );
});

test("review packet readiness fails incomplete pre-merge packet", () => {
  const packet = createReviewPacketDraft({
    coveredWorkItemIds: ["381"],
    deliveryId: "378",
    execFileSyncImpl(_command, args) {
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return "/tmp/operator-orchestration-service\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--abbrev-ref") {
        return "codex/readiness\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "HEAD") {
        return "abc123\n";
      }
      if (gitArgs[0] === "merge-base") {
        return "base123\n";
      }
      if (gitArgs[0] === "diff") {
        return "src/art-workflow-artifacts.js\n";
      }
      return "";
    },
  });

  const validation = validateReviewPacketReadiness(packet);

  assert.equal(validation.valid, false);
  assert.equal(validation.ready, false);
  assert.equal(
    validation.errors.some((entry) =>
      entry.includes("landing_unit.evidence_kind must be open_pr"),
    ),
    true,
  );
  assert.equal(
    validation.errors.includes("review packet still contains CHECK placeholders"),
    true,
  );
});

test("review packet readiness accepts complete open PR evidence before merge", () => {
  const packet = {
    artifact_type: "art_review_packet",
    completion_mapping: [
      {
        evidence_summary: "The open PR adds the pre-merge readiness gate and documentation for the covered defect.",
        work_item_id: "work-item-471",
      },
    ],
    covered_work_item_ids: ["work-item-471"],
    delivery_id: "delivery-420",
    evidence: {
      changed_surfaces: [
        "`src/art-workflow-artifacts.js`: adds the pre-merge Review Packet readiness validator.",
      ],
      test_results: ["PASS: `npm test -- test/art-workflow-artifacts.test.js`"],
      validations: ["PASS: `npm run validate:api-docs`"],
    },
    landing_unit: {
      evidence_kind: "open_pr",
      merge_commit: null,
      pr_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/90",
      repos: [
        {
          branch: "feature/readiness",
          changed_files: ["src/art-workflow-artifacts.js"],
          head_sha: "abc123",
          repo_name: "operator-orchestration-service",
        },
      ],
      rollback_boundary: "Revert the OOS readiness-gate PR before merge if readiness fails.",
    },
    packet_id: "review-packet-readiness",
    schema_version: 1,
    status: "draft",
  };

  const validation = validateReviewPacketReadiness(packet);

  assert.equal(validation.valid, true);
  assert.equal(validation.ready, true);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.next_action.includes("Merge the reviewed PR"), true);

  const finalValidation = validateReviewPacket(packet, { final: true });
  assert.equal(finalValidation.valid, false);
  assert.equal(
    finalValidation.errors.some((entry) =>
      entry.includes("landing_unit.evidence_kind must be merged_pr"),
    ),
    true,
  );
});

test("review packet draft can be built from repo evidence", () => {
  const packet = createReviewPacketDraft({
    coveredWorkItemIds: ["381"],
    deliveryId: "378",
    execFileSyncImpl(_command, args) {
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return "/tmp/operator-orchestration-service\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--abbrev-ref") {
        return "codex/art-review-packet-drafts\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "HEAD") {
        return "abc123\n";
      }
      if (gitArgs[0] === "merge-base") {
        return "base123\n";
      }
      if (gitArgs[0] === "diff") {
        return "src/art-workflow-artifacts.js\n";
      }
      return "";
    },
  });

  assert.equal(packet.delivery_id, "delivery-378");
  assert.deepEqual(packet.covered_work_item_ids, ["work-item-381"]);
  assert.equal(packet.landing_unit.repos[0].branch, "codex/art-review-packet-drafts");
  assert.deepEqual(packet.evidence.changed_surfaces, [
    "operator-orchestration-service/src/art-workflow-artifacts.js",
  ]);
});

test("review packet draft excludes broker-local ART scratch artifacts", () => {
  const packet = createReviewPacketDraft({
    coveredWorkItemIds: ["483"],
    deliveryId: "420",
    execFileSyncImpl(_command, args) {
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return "/tmp/operator-orchestration-service\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--abbrev-ref") {
        return "feature/483-review-packet-repo-detection\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "HEAD") {
        return "abc483\n";
      }
      if (gitArgs[0] === "merge-base") {
        return "base483\n";
      }
      if (gitArgs[0] === "diff" || gitArgs[0] === "ls-files") {
        return [
          ".art/archive/old.json",
          ".art/drafts/483-plan.json",
          ".art/outputs/context.json",
          ".art/payloads/483-complete.json",
          ".art/review-packets/483.json",
          ".platform-drills/run/evidence.yaml",
          ".tmp/legacy.json",
          "src/art-workflow-artifacts.js",
        ].join("\n");
      }
      return "";
    },
  });

  assert.deepEqual(packet.landing_unit.repos[0].changed_files, [
    "src/art-workflow-artifacts.js",
  ]);
  assert.deepEqual(packet.evidence.changed_surfaces, [
    "operator-orchestration-service/src/art-workflow-artifacts.js",
  ]);
});

test("scratch status classifies legacy tmp payloads separately from managed artifacts", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "oos-artifacts-"));
  await mkdir(path.join(repoRoot, ".tmp"), { recursive: true });
  await mkdir(path.join(repoRoot, ".art", "drafts"), { recursive: true });
  await writeFile(path.join(repoRoot, ".tmp", "legacy.json"), "{}", "utf8");
  await writeFile(path.join(repoRoot, ".art", "drafts", "draft.json"), "{}", "utf8");

  const status = inspectScratchArtifacts({ repoRoot });
  assert.equal(status.summary.legacy_unmanaged_payload_count, 1);
  assert.equal(status.summary.managed_mutation_draft_count, 1);

  const cleanup = archiveLegacyScratchArtifacts({ dryRun: true, repoRoot });
  assert.equal(cleanup.summary.would_archive_count, 1);
  assert.equal(cleanup.actions[0].action, "would_archive");
});
