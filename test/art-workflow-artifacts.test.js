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
