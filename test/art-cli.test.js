import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  artCliUsage,
  buildArtCliRequest,
  runArtCliCommand,
} from "../src/art-cli.js";

test("buildArtCliRequest resolves the bootstrap command", () => {
  const result = buildArtCliRequest(["bootstrap"]);
  assert.equal(result.method, "GET");
  assert.equal(result.path, "/v1/delivery-session/bootstrap");
});

test("buildArtCliRequest resolves the workflow-health command", () => {
  const result = buildArtCliRequest(["workflow-health"]);
  assert.equal(result.method, "GET");
  assert.equal(result.path, "/v1/delivery-session/workflow-health");
});

test("projection status reports clean state without broker exec", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["projection", "status"],
    env: {
      ART_PROJECTION_STATE_FILE: path.join(tempDir, "projection-state.json"),
    },
    spawnImpl() {
      throw new Error("projection status should not exec the broker");
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.dirty, false);
  assert.equal(output.workflow_id, "delivery-art-projection-state");
});

test("buildArtCliRequest resolves initiative close with numeric ids", async () => {
  const payloadPath = "/tmp/initiative-close.json";
  await writeFile(payloadPath, "{\"input\":{}}", "utf8");

  const result = buildArtCliRequest(["initiative", "close", "304", payloadPath]);
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/v1/delivery-initiatives/delivery-304/close");
  assert.equal(typeof result.bodyBase64, "string");
  assert.equal(result.bodyBase64.length > 0, true);
});

test("buildArtCliRequest resolves initiative planning repair with numeric ids", async () => {
  const payloadPath = "/tmp/initiative-planning-repair.json";
  await writeFile(payloadPath, "{\"input\":{\"schema_version\":1,\"repairs\":[]}}", "utf8");

  const result = buildArtCliRequest(["initiative", "planning-repair", "304", payloadPath]);
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/v1/delivery-initiatives/delivery-304/plan/repair");
  assert.equal(typeof result.bodyBase64, "string");
  assert.equal(result.bodyBase64.length > 0, true);
});

test("buildArtCliRequest resolves initiative governance with numeric ids", async () => {
  const payloadPath = "/tmp/initiative-governance.json";
  await writeFile(payloadPath, "{\"input\":{\"initiative_family\":\"delivery-art-operator-surfaces\"}}", "utf8");

  const result = buildArtCliRequest(["initiative", "governance", "304", payloadPath]);
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/v1/delivery-initiatives/delivery-304/governance");
  assert.equal(typeof result.bodyBase64, "string");
  assert.equal(result.bodyBase64.length > 0, true);
});

test("buildArtCliRequest resolves stale-open close with numeric ids", async () => {
  const payloadPath = "/tmp/stale-open.json";
  await writeFile(payloadPath, "{\"input\":{}}", "utf8");

  const result = buildArtCliRequest(["item", "stale-open-close", "310", payloadPath]);
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/v1/delivery-work-items/work-item-310/stale-open-close");
});

test("runArtCliCommand prints the returned JSON body", async () => {
  let capturedCommand = null;
  const stdoutChunks = [];
  const stderrChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["bootstrap"],
    env: {},
    spawnImpl(command, args) {
      capturedCommand = { args, command };
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                workflow_id: "delivery-session-bootstrap",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stderr: {
      write(chunk) {
        stderrChunks.push(String(chunk));
      },
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(capturedCommand.command, "k3s");
  assert.equal(capturedCommand.args.includes("deploy/operator-orchestration-service"), true);
  assert.equal(stdoutChunks.join("").includes("\"workflow_id\": \"delivery-session-bootstrap\""), true);
  assert.equal(stderrChunks.length, 0);
});

test("broker mutation responses mark projection state dirty when external reconciliation is required", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const payloadPath = path.join(tempDir, "complete.json");
  const statePath = path.join(tempDir, "projection-state.json");
  await writeFile(payloadPath, "{\"input\":{}}", "utf8");
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["item", "complete", "472", payloadPath],
    env: {
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "999999",
      ART_PROJECTION_STATE_FILE: statePath,
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                changes_applied: {
                  roadmap_version_projection: {
                    from: null,
                    reason: "version_field_read_only",
                    status: "external_reconciler_required",
                    target_pi: "PI-2026-03",
                    to: "PI-2026-03",
                  },
                },
                work_item_id: "work-item-472",
                workflow_id: "delivery-work-item-complete",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(exitCode, 0);
  assert.equal(output.projection_checkpoint.dirty, true);
  assert.deepEqual(state.affected_work_item_ids, ["work-item-472"]);
  assert.equal(state.dirty_events[0].projection_reports[0].status, "external_reconciler_required");
});

test("draft submit mutation responses mark projection state dirty when external reconciliation is required", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const draftPath = path.join(tempDir, "draft.json");
  const statePath = path.join(tempDir, "projection-state.json");
  await writeFile(
    draftPath,
    JSON.stringify({
      artifact_type: "art_mutation_draft",
      created_at: "2026-04-30T00:00:00.000Z",
      draft_id: "mutation-draft-test",
      operation: "work-item.complete",
      operator: { caller_id: "codex-local" },
      payload: {
        input: {
          changed_surfaces: "- `src/art-cli.js`: marks projection state for draft submit.",
          completion_summary: "Draft submit projection state is marked when broker projection is external.",
          test_result_evidence: "- PASS: `node --test test/art-cli.test.js`",
          validation_evidence: "- PASS: projection checkpoint state written.",
        },
      },
      route: {
        method: "POST",
        path: "/v1/delivery-work-items/work-item-476/complete",
      },
      schema_version: 1,
      status: "draft",
      submission: { result: null, submitted_at: null },
      target: { id: "work-item-476", kind: "work-item" },
      validation: { last_validated_at: null, result: "not_validated" },
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["draft", "submit", draftPath],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                changes_applied: {
                  roadmap_version_projection: {
                    from: null,
                    reason: "version_field_read_only",
                    status: "external_reconciler_required",
                    target_pi: "PI-2026-03",
                    to: "PI-2026-03",
                  },
                },
                work_item_id: "work-item-476",
                workflow_id: "delivery-work-item-complete",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(exitCode, 0);
  assert.equal(output.projection_checkpoint.dirty, true);
  assert.deepEqual(state.affected_work_item_ids, ["work-item-476"]);
  assert.equal(state.dirty_events[0].source, "Submit mutation draft mutation-draft-test");
});

test("draft-submitted plan apply responses mark nested projection drift with affected children", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const draftPath = path.join(tempDir, "plan-apply-draft.json");
  const statePath = path.join(tempDir, "projection-state.json");
  await writeFile(
    draftPath,
    JSON.stringify({
      artifact_type: "art_mutation_draft",
      created_at: "2026-04-30T00:00:00.000Z",
      draft_id: "mutation-draft-plan-apply-test",
      operation: "initiative.plan.apply",
      operator: { caller_id: "codex-local" },
      payload: {
        input: {
          plan: {
            items: [],
            schema_version: 1,
          },
        },
      },
      route: {
        method: "POST",
        path: "/v1/delivery-initiatives/delivery-420/plan/apply",
      },
      schema_version: 1,
      status: "draft",
      submission: { result: null, submitted_at: null },
      target: { id: "delivery-420", kind: "delivery" },
      validation: { last_validated_at: null, result: "not_validated" },
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["draft", "submit", draftPath],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                delivery_id: "delivery-420",
                delivery_record_ref: "openproject://work_packages/420",
                delivery_record_system: "openproject",
                plan_result: {
                  created: [
                    {
                      creation_applied: {
                        roadmap_version_projection: {
                          from: null,
                          reason: "version_field_read_only",
                          status: "external_reconciler_required",
                          target_pi: "PI-2026-03",
                          to: "PI-2026-03",
                        },
                        target_pi: "PI-2026-03",
                      },
                      id: 481,
                      parent_id: 420,
                      record_ref: "openproject://work_packages/481",
                      status: "new",
                      subject: "Defect: Mark plan.apply projection drift in broker checkpoint",
                      target_pi: "PI-2026-03",
                      type: "Defect",
                    },
                  ],
                  deferred: [],
                  epic: {
                    id: 420,
                    record_ref: "openproject://work_packages/420",
                    subject: "Build Workspace Governance Control Fabric foundation",
                    target_pi: null,
                    updated: false,
                  },
                  retired: [],
                  reused: [],
                  summary: {
                    created_count: 1,
                    deferred_count: 0,
                    reused_count: 0,
                    retired_count: 0,
                    total_requested: 1,
                    updated_count: 0,
                  },
                  updated: [],
                },
                workflow_id: "delivery-plan-apply",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(exitCode, 0);
  assert.equal(output.projection_checkpoint.dirty, true);
  assert.deepEqual(state.affected_delivery_ids, ["delivery-420"]);
  assert.deepEqual(state.affected_work_item_ids, ["work-item-481"]);
  assert.equal(
    state.dirty_events[0].route,
    "POST /v1/delivery-initiatives/delivery-420/plan/apply",
  );
  assert.equal(state.dirty_events[0].projection_reports[0].status, "external_reconciler_required");
});

test("projection sync dry-run returns the scoped checkpoint plan", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const statePath = path.join(tempDir, "projection-state.json");
  await writeFile(
    statePath,
    JSON.stringify({
      affected_delivery_ids: ["delivery-420"],
      affected_work_item_ids: ["work-item-472"],
      dirty: true,
      dirty_events: [{ marked_at: "2026-04-30T00:00:00.000Z" }],
      schema_version: 1,
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: [
      "projection",
      "sync",
      "--pi-names",
      "PI-2026-03",
      "--target-epic-id",
      "420",
      "--quality",
      "--dry-run",
    ],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
      PLATFORM_ENGINEERING_ROOT: "/workspace/platform-engineering",
    },
    spawnImpl() {
      throw new Error("projection sync dry-run should not spawn");
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.dry_run, true);
  assert.equal(output.plan.pi_names, "PI-2026-03");
  assert.equal(output.plan.target_epic_id, "420");
  assert.equal(output.plan.quality, true);
});

test("projection sync runs platform sync and scoped quality then clears dirty state", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-projection-state-"));
  const statePath = path.join(tempDir, "projection-state.json");
  await writeFile(
    statePath,
    JSON.stringify({
      affected_delivery_ids: ["delivery-420"],
      affected_work_item_ids: ["work-item-472"],
      dirty: true,
      dirty_events: [{ marked_at: "2026-04-30T00:00:00.000Z" }],
      schema_version: 1,
    }),
    "utf8",
  );
  const stdoutChunks = [];
  const calls = [];

  const exitCode = await runArtCliCommand({
    argv: [
      "projection",
      "sync",
      "--pi-names",
      "PI-2026-03",
      "--target-epic-id",
      "420",
      "--quality",
    ],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
      PLATFORM_ENGINEERING_ROOT: "/workspace/platform-engineering",
    },
    spawnImpl(command, args) {
      calls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.result, "synced");
  assert.equal(calls[0].command, "bash");
  assert.equal(calls[0].args[0].endsWith("openproject_sync_delivery_art_views.sh"), true);
  assert.equal(calls[1].command, "make");
  assert.equal(calls[1].args.includes("TARGET_EPIC_ID=420"), true);
  await assert.rejects(readFile(statePath, "utf8"));
});

test("runArtCliCommand tolerates extra stdout before the JSON envelope", async () => {
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["initiative", "execution-summary", "304"],
    env: {},
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            'Defaulted container "operator-orchestration-service" out of: operator-orchestration-service\n',
          ),
        );
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                delivery_id: "delivery-304",
                workflow_id: "delivery-execution-summary",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stderr: {
      write() {},
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stdoutChunks.join("").includes('"delivery_id": "delivery-304"'), true);
});

test("runArtCliCommand handles local scaffold generation before broker exec", async () => {
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: [
      "scaffold",
      "item-complete",
      "327",
      "/tmp/complete-327-scaffold.json",
      "/tmp/mock-repo",
    ],
    execFileSyncImpl(_command, args) {
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return "/tmp/mock-repo";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--abbrev-ref") {
        return "codex/mock-branch";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--short") {
        return "abc1234";
      }
      if (gitArgs[0] === "merge-base") {
        return "deadbeef";
      }
      if (gitArgs[0] === "diff" && gitArgs[3] === "deadbeef..HEAD") {
        return "src/openproject-client.js\n";
      }
      return "";
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stdoutChunks.join("").includes('"workflow_id": "delivery-closeout-evidence-scaffold"'), true);
});

test("artCliUsage exposes the supported command matrix", () => {
  assert.equal(artCliUsage().includes("initiative close"), true);
  assert.equal(artCliUsage().includes("initiative planning-repair"), true);
  assert.equal(artCliUsage().includes("item stale-open-close"), true);
  assert.equal(artCliUsage().includes("scaffold item-complete"), true);
  assert.equal(artCliUsage().includes("scaffold initiative-close"), true);
  assert.equal(artCliUsage().includes("draft create"), true);
  assert.equal(artCliUsage().includes("review-packet readiness"), true);
  assert.equal(artCliUsage().includes("review-packet finalize"), true);
  assert.equal(artCliUsage().includes("scratch status"), true);
});

test("runArtCliCommand lists draft operations without broker exec", async () => {
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["draft", "operations"],
    spawnImpl() {
      throw new Error("draft operations should not exec the broker");
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stdoutChunks.join("").includes("work-item.complete"), true);
});

test("review-packet finalize prints compact summary by default and writes full packet", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-review-packet-"));
  const packetPath = path.join(tempDir, "packet.json");
  const packet = {
    artifact_type: "delivery-art-review-packet",
    completion_mapping: [
      {
        evidence_summary: "PR proves the work item closure.",
        work_item_id: "work-item-381",
      },
    ],
    covered_work_item_ids: ["work-item-381"],
    delivery_id: "delivery-378",
    evidence: {
      changed_surfaces: ["operator-orchestration-service/src/art-cli.js"],
      test_results: ["PASS: node --test test/art-cli.test.js"],
      validations: ["PASS: npm test"],
    },
    landing_unit: {
      evidence_kind: "merged_pr",
      merge_commit: "abc123",
      pr_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/80",
      repos: [
        {
          branch: "main",
          changed_files: ["src/art-cli.js"],
          change_records: ["docs/records/change-records/example.md"],
          head_sha: "abc123",
          merge_base: "base123",
          repo_name: "operator-orchestration-service",
          repo_root: "/tmp/operator-orchestration-service",
        },
      ],
      rollback_boundary: "Rollback PR #80.",
    },
    packet_id: "review-packet-test",
    schema_version: 1,
    status: "draft",
  };
  await writeFile(packetPath, JSON.stringify(packet), "utf8");
  const finalizedPacket = {
    ...packet,
    packet_digest: "digest123",
    status: "finalized",
  };
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["review-packet", "finalize", packetPath],
    env: {
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "999999",
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                review_packet: finalizedPacket,
                validation: {
                  errors: [],
                  final: true,
                  next_action: "Finalize this packet and use its digest in ART completion evidence.",
                  packet_digest: "digest123",
                  valid: true,
                  warnings: [],
                },
                workflow_id: "delivery-art-review-packet-finalize",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.packet_id, "review-packet-test");
  assert.equal(output.validation.packet_digest, "digest123");
  assert.equal(output.landing_unit.changed_surface_count, 1);
  assert.equal(output.review_packet, undefined);
  assert.equal(JSON.parse(await readFile(packetPath, "utf8")).status, "finalized");
});

test("review-packet validate preserves full broker response with --json", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-review-packet-"));
  const packetPath = path.join(tempDir, "packet.json");
  await writeFile(
    packetPath,
    JSON.stringify({
      artifact_type: "delivery-art-review-packet",
      covered_work_item_ids: ["work-item-381"],
      delivery_id: "delivery-378",
      evidence: { changed_surfaces: [], test_results: [], validations: [] },
      landing_unit: { repos: [] },
      packet_id: "review-packet-test",
      schema_version: 1,
      status: "draft",
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["review-packet", "validate", packetPath, "--json"],
    env: {
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "999999",
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                validation: {
                  errors: [],
                  final: false,
                  packet_digest: "digest123",
                  valid: true,
                  warnings: [],
                },
                workflow_id: "delivery-art-review-packet-validate",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.workflow_id, "delivery-art-review-packet-validate");
  assert.equal(output.validation.valid, true);
});

test("review-packet readiness fails closed through the broker route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-review-packet-"));
  const packetPath = path.join(tempDir, "packet.json");
  await writeFile(
    packetPath,
    JSON.stringify({
      artifact_type: "art_review_packet",
      covered_work_item_ids: ["work-item-471"],
      delivery_id: "delivery-420",
      evidence: { changed_surfaces: [], test_results: [], validations: [] },
      landing_unit: { evidence_kind: "pending", repos: [] },
      packet_id: "review-packet-readiness",
      schema_version: 1,
      status: "draft",
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["review-packet", "readiness", packetPath],
    env: {
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "999999",
    },
    spawnImpl(_command, args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        const bodyArg = args[args.length - 3];
        const decoded = JSON.parse(Buffer.from(bodyArg, "base64").toString("utf8"));
        assert.deepEqual(decoded.review_packet.covered_work_item_ids, ["work-item-471"]);
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                validation: {
                  errors: ["landing_unit.evidence_kind must be open_pr for pre-merge readiness"],
                  final: false,
                  next_action: "Fix the readiness errors before merging the source landing unit.",
                  ready: false,
                  valid: false,
                  warnings: [],
                },
                workflow_id: "delivery-art-review-packet-readiness",
              },
              ok: false,
              status: 422,
            }),
          ),
        );
        child.emit("close", 1);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 1);
  assert.equal(output.command, "review-packet readiness");
  assert.equal(output.validation.ready, false);
  assert.equal(output.validation.valid, false);
  assert.equal(output.workflow_id, "delivery-art-review-packet-readiness");
});

test("broker read commands print compact summaries and spill large full output", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-art-output-"));
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health"],
    env: {
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "100",
      ART_OUTPUT_DIR: tempDir,
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                portfolio_summary: {
                  active_initiatives: 2,
                  total_initiatives: 3,
                },
                workflow_health: {
                  pm2_phase: { drift: [], healthy: true },
                  roadmap: {
                    drift: [
                      {
                        item: {
                          id: 313,
                          status: "new",
                          subject: "A very long roadmap projection drift subject that should not be pasted in full into the compact operator output",
                          type: "Feature",
                        },
                        reason: "target_pi_version_drift",
                      },
                    ],
                    healthy: false,
                  },
                  summary: {
                    healthy: false,
                    roadmap_projection_drift_count: 1,
                  },
                },
                workflow_id: "delivery-session-workflow-health",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.workflow_id, "delivery-session-workflow-health");
  assert.equal(output.workflow_health.roadmap.drift_count, 1);
  assert.equal(output.full_output.full_output_path.startsWith(tempDir), true);
  const fullOutput = JSON.parse(await readFile(output.full_output.full_output_path, "utf8"));
  assert.equal(fullOutput.workflow_id, "delivery-session-workflow-health");
});

test("broker read commands preserve full output with --json", async () => {
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health", "--json"],
    env: {},
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                workflow_health: {
                  roadmap: {
                    drift: [
                      {
                        detail: "full detail remains available",
                      },
                    ],
                  },
                },
                workflow_id: "delivery-session-workflow-health",
              },
              ok: true,
              status: 200,
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.workflow_health.roadmap.drift[0].detail, "full detail remains available");
});
