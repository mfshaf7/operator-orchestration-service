import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArtScaffoldPayload,
  buildArtScaffoldRequest,
} from "../src/art-scaffold.js";

test("buildArtScaffoldRequest defaults repo roots to cwd", async () => {
  const originalCwd = process.cwd;
  process.cwd = () => "/tmp/current-repo";

  try {
    const result = buildArtScaffoldRequest([
      "scaffold",
      "item-complete",
      "327",
      ".tmp/complete-327.json",
    ]);

    assert.equal(result.scaffoldType, "item-complete");
    assert.equal(result.targetId, "327");
    assert.deepEqual(result.repoRoots, ["/tmp/current-repo"]);
  } finally {
    process.cwd = originalCwd;
  }
});

test("buildArtScaffoldPayload creates a valid item-complete scaffold", async () => {
  const payload = buildArtScaffoldPayload({
    generatedAt: "2026-04-25T03:00:00.000Z",
    repoStates: [
      {
        branch: "codex/test",
        changedChangeRecords: [
          "docs/records/change-records/2026-04-25-example.md",
        ],
        changedFiles: [
          "src/openproject-client.js",
          "docs/contracts/delivery-workflow-api-v1.md",
        ],
        headSha: "abc1234",
        repoName: "operator-orchestration-service",
      },
    ],
    scaffoldType: "item-complete",
    targetId: "327",
  });

  assert.match(
    payload.input.changed_surfaces,
    /operator-orchestration-service\/src\/openproject-client\.js/,
  );
  assert.match(
    payload.input.validation_evidence,
    /repo `operator-orchestration-service` branch `codex\/test` at commit `abc1234`/,
  );
  assert.match(
    payload.input.validation_evidence,
    /change record `operator-orchestration-service\/docs\/records\/change-records\/2026-04-25-example\.md`/,
  );
  assert.match(
    payload.input.completion_note,
    /operator-orchestration-service@codex\/test\(abc1234\)/,
  );
  assert.match(payload.input.completion_summary, /work item `327`/);
});

test("buildArtScaffoldPayload creates an initiative-close scaffold", async () => {
  const payload = buildArtScaffoldPayload({
    generatedAt: "2026-04-25T03:00:00.000Z",
    repoStates: [
      {
        branch: "codex/test",
        changedChangeRecords: [],
        changedFiles: [],
        headSha: "abc1234",
        repoName: "platform-engineering",
      },
      {
        branch: "codex/test-2",
        changedChangeRecords: [],
        changedFiles: ["docs/contracts/delivery-workflow-api-v1.md"],
        headSha: "def5678",
        repoName: "operator-orchestration-service",
      },
    ],
    scaffoldType: "initiative-close",
    targetId: "304",
  });

  assert.equal(payload.input.demo_date, "2026-04-25");
  assert.equal(payload.input.inspect_date, "2026-04-25");
  assert.equal(payload.input.demo_outcome, "reviewed");
  assert.match(payload.input.demo_summary, /`304`/);
  assert.match(payload.input.inspect_action_items, /TODO/);
  assert.match(
    payload.input.changed_surfaces,
    /operator-orchestration-service\/docs\/contracts\/delivery-workflow-api-v1\.md/,
  );
  assert.match(
    payload.input.validation_evidence,
    /repo `platform-engineering` branch `codex\/test` at commit `abc1234`/,
  );
});

test("buildArtScaffoldPayload excludes transient local residue from changed surfaces", async () => {
  const payload = buildArtScaffoldPayload({
    generatedAt: "2026-04-25T03:00:00.000Z",
    repoStates: [
      {
        branch: "main",
        changedChangeRecords: ["docs/records/change-records/2026-04-25-example.md"],
        changedFiles: [
          ".tmp/example.json",
          ".platform-drills/run-1/evidence.yaml",
          "docs/archive/session-handoff-2026-04-23.md",
          "docs/contracts/delivery-workflow-api-v1.md",
        ],
        headSha: "abc1234",
        repoName: "workspace-governance",
      },
    ],
    scaffoldType: "item-complete",
    targetId: "315",
  });

  assert.doesNotMatch(payload.input.changed_surfaces, /\.tmp\/example\.json/);
  assert.doesNotMatch(payload.input.changed_surfaces, /\.platform-drills/);
  assert.doesNotMatch(payload.input.changed_surfaces, /session-handoff-2026-04-23/);
  assert.match(
    payload.input.changed_surfaces,
    /workspace-governance\/docs\/contracts\/delivery-workflow-api-v1\.md/,
  );
});
