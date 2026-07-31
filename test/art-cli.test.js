import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("buildArtCliRequest resolves optimized initiative packet reads", () => {
  const activeSession = buildArtCliRequest(["initiative", "active-session", "650"]);
  assert.equal(activeSession.method, "GET");
  assert.equal(
    activeSession.path,
    "/v1/delivery-initiatives/delivery-650/active-session-packet",
  );

  const evidencePacket = buildArtCliRequest(["initiative", "evidence-packet", "650"]);
  assert.equal(evidencePacket.method, "GET");
  assert.equal(
    evidencePacket.path,
    "/v1/delivery-initiatives/delivery-650/evidence-packet",
  );
});

test("buildArtCliRequest resolves optimized work-item evidence packet reads", () => {
  const result = buildArtCliRequest(["item", "evidence-packet", "657"]);
  assert.equal(result.method, "GET");
  assert.equal(result.path, "/v1/delivery-work-items/work-item-657/evidence-packet");
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

test("art CLI sends broker request bodies over stdin instead of argv", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-art-stdin-"));
  const payloadPath = path.join(tempDir, "complete.json");
  const largeEvidence = "A".repeat(12000);
  await writeFile(
    payloadPath,
    JSON.stringify({
      changed_surfaces: "- `src/art-cli.js`: transports large broker payloads over stdin.",
      completion_summary: "Large payload transport is validated without argv expansion.",
      test_result_evidence: `- PASS: ${largeEvidence}`,
      validation_evidence: "- PASS: stdin transport captured the encoded body.",
    }),
    "utf8",
  );

  let capturedArgs = null;
  let capturedStdin = "";
  const stdoutChunks = [];
  const exitCode = await runArtCliCommand({
    argv: ["item", "complete", "522", payloadPath],
    env: {},
    spawnImpl(command, args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end(chunk) {
          if (args.includes("/v1/delivery-work-items/work-item-522/complete")) {
            capturedStdin += String(chunk);
          }
        },
      };
      process.nextTick(() => {
        if (String(command).includes("python") || args.includes("wgcf_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                findings: [],
                mutation_allowed: true,
                operation: "complete",
                outcome: "ready",
                raw_context_embedded: false,
                receipt_id: "art-readiness-receipt:test",
                recommendations: [
                  {
                    action: "proceed_via_oos_broker",
                    decision_path: "remove",
                    route: "work-item.complete",
                    target: "work-item:522",
                  },
                ],
                target_item_id: "522",
              }),
            ),
          );
        } else if (args.includes("/v1/delivery-work-items/work-item-522/continuation-context")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  continuation_context: {
                    summary: {},
                    target_item: {
                      delivery_team: "Platform Architecture",
                      id: 522,
                      iteration: "PI-2026-03 / Iteration 1",
                      owner_repo: "operator-orchestration-service",
                      status: "in-progress",
                      target_pi: "PI-2026-03",
                      type: "User story",
                    },
                  },
                  workflow_id: "delivery-work-item-continuation-context",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        } else {
          capturedArgs = args;
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  workflow_id: "delivery-work-item-complete",
                  work_item_id: "work-item-522",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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

  const stdinEnvelope = JSON.parse(capturedStdin);
  const brokerPayload = JSON.parse(
    Buffer.from(stdinEnvelope.bodyBase64, "base64").toString("utf8"),
  );
  assert.equal(exitCode, 0);
  assert.equal(capturedArgs.includes("-i"), true);
  assert.equal(capturedArgs.some((entry) => String(entry).length > 2000), false);
  assert.equal(stdinEnvelope.bodyBase64.length > 12000, true);
  assert.equal(
    brokerPayload.input.completion_summary,
    "Large payload transport is validated without argv expansion.",
  );
  assert.equal(JSON.parse(stdoutChunks.join("")).workflow_id, "delivery-work-item-complete");
});

test("item continuation includes automatic WGCF readiness projection", async () => {
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["item", "continuation", "541"],
    env: {},
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (String(command).includes("python") || args.includes("wgcf_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                findings: [],
                mutation_allowed: true,
                operation: "continue",
                outcome: "ready",
                raw_context_embedded: false,
                receipt_id: "art-readiness-receipt:continuation",
                recommendations: [],
                target_item_id: "541",
              }),
            ),
          );
        } else {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  continuation_context: {
                    summary: {},
                    target_item: {
                      delivery_team: "Platform Architecture",
                      id: 541,
                      iteration: "PI-2026-03 / Iteration 1",
                      owner_repo: "workspace-governance-control-fabric",
                      status: "ready",
                      subject: "Enabler: Define WGCF operator flows",
                      target_pi: "PI-2026-03",
                      type: "User story",
                    },
                  },
                  workflow_id: "delivery-work-item-continuation-context",
                  work_item_id: "work-item-541",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(spawnCalls.some((call) => call.args.includes("wgcf_cli")), true);
  assert.equal(output.wgcf_art_readiness.receipt_id, "art-readiness-receipt:continuation");
  assert.equal(output.wgcf_art_readiness.mutation_allowed, true);
});

test("item evidence-packet reuses continuation context for WGCF readiness projection", async () => {
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["item", "evidence-packet", "657"],
    env: {},
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (String(command).includes("python") || args.includes("wgcf_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                findings: [],
                mutation_allowed: true,
                operation: "continue",
                outcome: "ready",
                raw_context_embedded: false,
                receipt_id: "art-readiness-receipt:evidence",
                recommendations: [],
                target_item_id: "657",
              }),
            ),
          );
        } else {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  continuation_context: {
                    summary: {
                      open_child_count: 0,
                    },
                    target_item: {
                      delivery_team: "Workflow Integration",
                      id: 657,
                      iteration: "PI-2026-03 / Iteration 1",
                      owner_repo: "operator-orchestration-service",
                      status: "ready",
                      subject: "Produce compact active-session packets",
                      target_pi: "PI-2026-03",
                      type: "User story",
                    },
                  },
                  evidence_packet: {
                    evidence_state: {
                      completion_evidence_present: true,
                    },
                    packet_kind: "art_work_item_evidence_packet",
                    target_item: {
                      id: 657,
                      status: "ready",
                      subject: "Produce compact active-session packets",
                      type: "User story",
                    },
                  },
                  workflow_id: "delivery-work-item-evidence-packet",
                  work_item_id: "work-item-657",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(spawnCalls.some((call) => call.args.includes("wgcf_cli")), true);
  assert.equal(output.workflow_id, "delivery-work-item-evidence-packet");
  assert.equal(output.wgcf_art_readiness.receipt_id, "art-readiness-receipt:evidence");
  assert.equal(output.wgcf_art_readiness.mutation_allowed, true);
});

test("completion mutation fails closed when WGCF readiness blocks", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-wgcf-block-"));
  const payloadPath = path.join(tempDir, "complete.json");
  await writeFile(payloadPath, "{\"input\":{}}", "utf8");
  const stdoutChunks = [];
  const brokerPaths = [];

  const exitCode = await runArtCliCommand({
    argv: ["item", "complete", "541", payloadPath],
    env: {},
    spawnImpl(command, args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (String(command).includes("python") || args.includes("wgcf_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                findings: [
                  {
                    code: "target-blocked",
                    recommended_route: "work-item.blocker",
                    severity: "error",
                    target: "work-item:541",
                  },
                ],
                mutation_allowed: false,
                operation: "complete",
                outcome: "blocked",
                raw_context_embedded: false,
                receipt_id: "art-readiness-receipt:blocked",
                recommendations: [
                  {
                    action: "respect_blocker",
                    decision_path: "defer",
                    route: "work-item.blocker",
                    target: "work-item:541",
                  },
                ],
                target_item_id: "541",
              }),
            ),
          );
        } else {
          const requestPath = args[args.length - 3];
          brokerPaths.push(requestPath);
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  continuation_context: {
                    summary: {},
                    target_item: {
                      blocked: true,
                      delivery_team: "Platform Architecture",
                      id: 541,
                      iteration: "PI-2026-03 / Iteration 1",
                      owner_repo: "workspace-governance-control-fabric",
                      status: "in-progress",
                      target_pi: "PI-2026-03",
                      type: "User story",
                    },
                  },
                  workflow_id: "delivery-work-item-continuation-context",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(exitCode, 1);
  assert.equal(output.workflow_id, "delivery-art-wgcf-readiness-required");
  assert.equal(output.wgcf_art_readiness.receipt_id, "art-readiness-receipt:blocked");
  assert.deepEqual(brokerPaths, ["/v1/delivery-work-items/work-item-541/continuation-context"]);
});

test("wgcf draft CLI creates a managed draft through the broker handoff endpoint", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-wgcf-draft-"));
  const handshakePath = path.join(tempDir, "wgcf-handshake.json");
  const outputPath = path.join(tempDir, "wgcf-draft.json");
  await writeFile(
    handshakePath,
    JSON.stringify({
      input: {
        schema_version: 1,
        source_system: "workspace-governance-control-fabric",
        receipt: {
          digest: "sha256:receipt",
          kind: "art_readiness_receipt",
          ref: "wgcf://receipts/art-readiness/522",
        },
        draft: {
          operation: "work-item.update",
          target_id: "522",
          payload_input: {
            work_note: "WGCF recommends operator review before continuation.",
          },
        },
      },
    }),
    "utf8",
  );

  let capturedArgs = null;
  let capturedStdin = "";
  const stdoutChunks = [];
  const exitCode = await runArtCliCommand({
    argv: ["wgcf", "draft", handshakePath, outputPath],
    env: {},
    spawnImpl(_command, args) {
      capturedArgs = args;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end(chunk) {
          capturedStdin += String(chunk);
        },
      };
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                authority: {
                  broker_submit_required: true,
                  direct_mutation_allowed: false,
                  mutation_authority: "operator-orchestration-service",
                  source_authority: "recommendation_only",
                  source_system: "workspace-governance-control-fabric",
                },
                mutation_draft: {
                  artifact_type: "art_mutation_draft",
                  draft_id: "mutation-draft-wgcf",
                  operation: "work-item.update",
                  route: {
                    method: "POST",
                    path: "/v1/delivery-work-items/work-item-522/update",
                  },
                  status: "draft",
                },
                receipt_refs: [
                  {
                    digest: "sha256:receipt",
                    kind: "art_readiness_receipt",
                    ref: "wgcf://receipts/art-readiness/522",
                  },
                ],
                workflow_id: "delivery-art-wgcf-mutation-draft-create",
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

  const stdinEnvelope = JSON.parse(capturedStdin);
  const requestBody = JSON.parse(
    Buffer.from(stdinEnvelope.bodyBase64, "base64").toString("utf8"),
  );
  const output = JSON.parse(stdoutChunks.join(""));
  const draft = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(exitCode, 0);
  assert.equal(capturedArgs.includes("/v1/delivery-art/wgcf/mutation-drafts"), true);
  assert.equal(requestBody.input.source_system, "workspace-governance-control-fabric");
  assert.equal(output.generated_draft, outputPath);
  assert.equal(draft.draft_id, "mutation-draft-wgcf");
});

test("review-packet draft accepts explicit source repo roots", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-review-packet-cli-"));
  const sourceRepo = path.join(tempDir, "source-repo");
  const outputPath = path.join(tempDir, "packet.json");
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: [
      "review-packet",
      "draft",
      "420",
      outputPath,
      "483",
      "--repo-root",
      sourceRepo,
    ],
    env: {},
    execFileSyncImpl(command, args) {
      assert.equal(command, "git");
      const repoRoot = args[1];
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return `${repoRoot}\n`;
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--abbrev-ref") {
        return "feature/source-owner\n";
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "HEAD") {
        return "abcsource\n";
      }
      if (gitArgs[0] === "merge-base") {
        return "basesource\n";
      }
      if (gitArgs[0] === "diff") {
        return "src/source-change.js\n.art/payloads/local.json\n";
      }
      if (gitArgs[0] === "ls-files") {
        return "docs/contracts/source.md\n.art/review-packets/local.json\n";
      }
      return "";
    },
    spawnImpl() {
      throw new Error("review-packet draft should not exec the broker");
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0);
  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(output.repo_count, 1);
  assert.equal(output.repos[0].repo_root, sourceRepo);

  const packet = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(packet.landing_unit.repos[0].repo_root, sourceRepo);
  assert.deepEqual(packet.landing_unit.repos[0].changed_files, [
    "docs/contracts/source.md",
    "src/source-change.js",
  ]);
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
    spawnImpl(command, args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (String(command).includes("python") || args.includes("wgcf_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                findings: [],
                mutation_allowed: true,
                operation: "complete",
                outcome: "ready",
                raw_context_embedded: false,
                receipt_id: "art-readiness-receipt:test",
                recommendations: [],
                target_item_id: "472",
              }),
            ),
          );
        } else if (args.includes("/v1/delivery-work-items/work-item-472/continuation-context")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  continuation_context: {
                    summary: {},
                    target_item: {
                      delivery_team: "Platform Architecture",
                      id: 472,
                      iteration: "PI-2026-03 / Iteration 1",
                      owner_repo: "operator-orchestration-service",
                      status: "in-progress",
                      target_pi: "PI-2026-03",
                      type: "User story",
                    },
                  },
                  workflow_id: "delivery-work-item-continuation-context",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        } else {
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
        }
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
  const cggRepoRoot = path.join(tempDir, "context-governance-gateway");
  await mkdir(path.join(cggRepoRoot, "apps/cli/src/cgg_cli"), { recursive: true });
  await writeFile(
    path.join(cggRepoRoot, "apps/cli/src/cgg_cli/cli.py"),
    "# fake cgg cli for projection sync unit test\n",
    "utf8",
  );
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
      ART_CGG_REPO_ROOT: cggRepoRoot,
      ART_PROJECTION_STATE_FILE: statePath,
      ART_OUTPUT_DIR: tempDir,
      PLATFORM_ENGINEERING_ROOT: "/workspace/platform-engineering",
    },
    spawnImpl(command, args) {
      calls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        if (args.includes("cgg_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                admission_decision: {
                  raw_projection: "denied",
                },
                artifact_digest: `sha256:${args[args.indexOf("--path") + 1].includes("quality") ? "quality" : "sync"}`,
                artifact_id: "projection-sync-packet",
                manifest_path: ".cgg/manifests/projection-sync.manifest.json",
                packet_path: ".cgg/packets/projection-sync.packet.json",
                receipt_path: ".cgg/receipts/projection-sync.receipt.json",
                redaction_findings: 0,
              }),
            ),
          );
        } else if (command === "bash") {
          child.stdout.emit("data", Buffer.from("RAW SYNC LOG SHOULD NOT STREAM\n"));
        } else if (command === "make") {
          child.stderr.emit("data", Buffer.from("RAW QUALITY LOG SHOULD NOT STREAM\n"));
        }
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
  assert.equal(stdoutChunks.join("").includes("RAW SYNC LOG SHOULD NOT STREAM"), false);
  assert.equal(stdoutChunks.join("").includes("RAW QUALITY LOG SHOULD NOT STREAM"), false);
  assert.equal(output.sync_output.raw_output_suppressed, true);
  assert.equal(output.sync_output.stdout_bytes > 0, true);
  assert.equal(output.sync_output.cgg_packet_ref.status, "projected");
  assert.equal(output.quality_output.raw_output_suppressed, true);
  assert.equal(output.quality_output.stderr_bytes > 0, true);
  assert.equal(output.quality_output.cgg_packet_ref.status, "projected");
  const syncArtifact = JSON.parse(await readFile(output.sync_output.full_output_path, "utf8"));
  const qualityArtifact = JSON.parse(await readFile(output.quality_output.full_output_path, "utf8"));
  assert.equal(syncArtifact.stdout.includes("RAW SYNC LOG SHOULD NOT STREAM"), true);
  assert.equal(qualityArtifact.stderr.includes("RAW QUALITY LOG SHOULD NOT STREAM"), true);
  const bashCall = calls.find((call) => call.command === "bash");
  const makeCall = calls.find((call) => call.command === "make");
  assert.equal(bashCall.args[0].endsWith("openproject_sync_delivery_art_views.sh"), true);
  assert.equal(makeCall.args.includes("TARGET_EPIC_ID=420"), true);
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
  assert.equal(artCliUsage().includes("initiative active-session"), true);
  assert.equal(artCliUsage().includes("initiative evidence-packet"), true);
  assert.equal(artCliUsage().includes("item evidence-packet"), true);
  assert.equal(artCliUsage().includes("item stale-open-close"), true);
  assert.equal(artCliUsage().includes("scaffold item-complete"), true);
  assert.equal(artCliUsage().includes("scaffold initiative-close"), true);
  assert.equal(artCliUsage().includes("draft create"), true);
  assert.equal(artCliUsage().includes("landing-unit status"), true);
  assert.equal(artCliUsage().includes("landing-unit dry-run"), true);
  assert.equal(artCliUsage().includes("landing-unit submit"), true);
  assert.equal(artCliUsage().includes("review-packet readiness"), true);
  assert.equal(artCliUsage().includes("review-packet evidence-packet"), true);
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

test("large compact ART output attaches a CGG packet reference by default", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-cgg-art-output-"));
  const cggRepoRoot = path.join(tempDir, "context-governance-gateway");
  await mkdir(path.join(cggRepoRoot, "apps/cli/src/cgg_cli"), { recursive: true });
  await writeFile(
    path.join(cggRepoRoot, "apps/cli/src/cgg_cli/cli.py"),
    "# fake cgg cli for art-cli unit test\n",
    "utf8",
  );
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health"],
    env: {
      ART_CGG_REPO_ROOT: cggRepoRoot,
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "1",
      ART_OUTPUT_DIR: tempDir,
    },
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (args.includes("cgg_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                admission_decision: {
                  raw_projection: "denied",
                },
                artifact_digest: "sha256:cgg",
                artifact_id: "pack-test",
                manifest_path: ".cgg/manifests/pack-test.manifest.json",
                packet_path: ".cgg/packets/pack-test.packet.json",
                receipt_path: ".cgg/receipts/pack-test.receipt.json",
                redaction_findings: 0,
              }),
            ),
          );
        } else {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  portfolio_summary: {
                    active_initiatives: 1,
                  },
                  project: {
                    identifier: "workspace-delivery-art",
                  },
                  workflow_health: {
                    pm2_phase: {
                      drift: [],
                      healthy: true,
                    },
                    roadmap: {
                      drift: [],
                      healthy: true,
                    },
                    summary: {
                      healthy: true,
                    },
                  },
                  workflow_id: "delivery-session-workflow-health",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(output.full_output.full_output_path.startsWith(tempDir), true);
  assert.equal(output.cgg_packet_ref.status, "projected");
  assert.equal(output.cgg_packet_ref.packet_path, ".cgg/packets/pack-test.packet.json");
  assert.equal(spawnCalls.some((call) => call.args.includes("cgg_cli")), true);
});

test("--json suppresses oversized ART output through CGG by default", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-cgg-art-json-"));
  const cggRepoRoot = path.join(tempDir, "context-governance-gateway");
  await mkdir(path.join(cggRepoRoot, "apps/cli/src/cgg_cli"), { recursive: true });
  await writeFile(
    path.join(cggRepoRoot, "apps/cli/src/cgg_cli/cli.py"),
    "# fake cgg cli for art-cli unit test\n",
    "utf8",
  );
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health", "--json"],
    env: {
      ART_CGG_REPO_ROOT: cggRepoRoot,
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "1",
      ART_OUTPUT_DIR: tempDir,
    },
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (args.includes("cgg_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                admission_decision: {
                  raw_projection: "denied",
                },
                artifact_digest: "sha256:cgg-json",
                artifact_id: "pack-json-test",
                manifest_path: ".cgg/manifests/pack-json-test.manifest.json",
                packet_path: ".cgg/packets/pack-json-test.packet.json",
                receipt_path: ".cgg/receipts/pack-json-test.receipt.json",
                redaction_findings: 0,
              }),
            ),
          );
        } else {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  portfolio_summary: {
                    active_initiatives: 1,
                  },
                  workflow_health: {
                    roadmap: {
                      drift: [{ id: 1, subject: "large enough to suppress raw output" }],
                      healthy: false,
                    },
                  },
                  workflow_id: "delivery-session-workflow-health",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(output.raw_json_suppressed, true);
  assert.equal(output.workflow_health, undefined);
  assert.equal(output.cgg_packet_ref.status, "projected");
  assert.equal(output.cgg_packet_ref.packet_path, ".cgg/packets/pack-json-test.packet.json");
  assert.equal(output.full_output.full_output_path.startsWith(tempDir), true);
  const rawArtifact = JSON.parse(await readFile(output.full_output.full_output_path, "utf8"));
  assert.equal(rawArtifact.workflow_id, "delivery-session-workflow-health");
  assert.equal(spawnCalls.some((call) => call.args.includes("cgg_cli")), true);
});

test("ART_CGG_PACKETING=off allows explicit raw --json debugging", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-cgg-art-json-off-"));
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health", "--json"],
    env: {
      ART_CGG_PACKETING: "off",
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "1",
      ART_OUTPUT_DIR: tempDir,
    },
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              body: {
                workflow_health: {
                  roadmap: {
                    drift: [{ id: 1, subject: "raw debug output" }],
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
  assert.equal(output.raw_json_suppressed, undefined);
  assert.equal(output.workflow_health.roadmap.drift[0].subject, "raw debug output");
  assert.equal(spawnCalls.some((call) => call.args.includes("cgg_cli")), false);
});

test("invalid ART_CGG_PACKETING values still use safe default projection", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-cgg-art-json-invalid-"));
  const cggRepoRoot = path.join(tempDir, "context-governance-gateway");
  await mkdir(path.join(cggRepoRoot, "apps/cli/src/cgg_cli"), { recursive: true });
  await writeFile(
    path.join(cggRepoRoot, "apps/cli/src/cgg_cli/cli.py"),
    "# fake cgg cli for art-cli unit test\n",
    "utf8",
  );
  const stdoutChunks = [];
  const spawnCalls = [];

  const exitCode = await runArtCliCommand({
    argv: ["workflow-health", "--json"],
    env: {
      ART_CGG_PACKETING: "definitely-not-a-mode",
      ART_CGG_REPO_ROOT: cggRepoRoot,
      ART_COMPACT_OUTPUT_THRESHOLD_BYTES: "1",
      ART_OUTPUT_DIR: tempDir,
    },
    spawnImpl(command, args) {
      spawnCalls.push({ args, command });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        if (args.includes("cgg_cli")) {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                admission_decision: {
                  raw_projection: "denied",
                },
                artifact_digest: "sha256:cgg-invalid-mode",
                artifact_id: "pack-invalid-mode-test",
                manifest_path: ".cgg/manifests/pack-invalid-mode-test.manifest.json",
                packet_path: ".cgg/packets/pack-invalid-mode-test.packet.json",
                receipt_path: ".cgg/receipts/pack-invalid-mode-test.receipt.json",
                redaction_findings: 0,
              }),
            ),
          );
        } else {
          child.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                body: {
                  workflow_health: {
                    roadmap: {
                      drift: [{ id: 1, subject: "must not raw print on typo" }],
                    },
                  },
                  workflow_id: "delivery-session-workflow-health",
                },
                ok: true,
                status: 200,
              }),
            ),
          );
        }
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
  assert.equal(output.raw_json_suppressed, true);
  assert.equal(output.cgg_packet_ref.status, "projected");
  assert.equal(output.cgg_packet_ref.packet_path, ".cgg/packets/pack-invalid-mode-test.packet.json");
  assert.equal(spawnCalls.some((call) => call.args.includes("cgg_cli")), true);
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

test("review-packet evidence-packet prints local compact evidence without broker exec", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-review-packet-evidence-"));
  const packetPath = path.join(tempDir, "packet.json");
  await writeFile(
    packetPath,
    JSON.stringify({
      covered_work_item_ids: ["work-item-657", "work-item-658"],
      delivery_id: "delivery-650",
      evidence: {
        changed_surfaces: ["src/art-cli.js"],
        test_results: ["PASS: npm test"],
        validations: ["PASS: npm run validate:api-docs"],
      },
      landing_unit: {
        evidence_kind: "open_pr",
        pr_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/107",
        repos: [
          {
            repo_name: "operator-orchestration-service",
          },
        ],
        rollback_boundary: "Revert PR #107.",
      },
      packet_id: "review-packet-650",
      schema_version: 1,
      status: "ready",
    }),
    "utf8",
  );
  const stdoutChunks = [];

  const exitCode = await runArtCliCommand({
    argv: ["review-packet", "evidence-packet", packetPath],
    spawnImpl() {
      throw new Error("review-packet evidence-packet should not exec the broker");
    },
    stdout: {
      write(chunk) {
        stdoutChunks.push(String(chunk));
      },
    },
  });

  const output = JSON.parse(stdoutChunks.join(""));
  assert.equal(exitCode, 0);
  assert.equal(output.workflow_id, "delivery-art-review-packet-evidence-packet");
  assert.equal(output.review_packet_evidence_packet.covered_work_item_ids.length, 2);
  assert.equal(
    output.review_packet_evidence_packet.landing_unit.repo_names[0],
    "operator-orchestration-service",
  );
  assert.equal(
    output.review_packet_evidence_packet.evidence_state.validation_count,
    1,
  );
});

function finalizedLandingUnitPacket() {
  return {
    artifact_type: "art_review_packet",
    completion_mapping: [
      {
        evidence_summary: "Adds landing-unit status and dry-run automation.",
        work_item_id: "work-item-661",
      },
      {
        evidence_summary: "Adds landing-unit submit automation.",
        work_item_id: "work-item-662",
      },
    ],
    covered_work_item_ids: ["work-item-661", "work-item-662"],
    delivery_id: "delivery-650",
    evidence: {
      changed_surfaces: [
        "operator-orchestration-service/src/art-cli.js: adds landing-unit automation.",
      ],
      test_results: ["PASS: npm test"],
      validations: ["PASS: npm run validate:api-docs"],
    },
    landing_unit: {
      evidence_kind: "merged_pr",
      merge_commit: "abc123",
      pr_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/108",
      repos: [
        {
          branch: "main",
          changed_files: ["src/art-cli.js"],
          repo_name: "operator-orchestration-service",
        },
      ],
      rollback_boundary: "Revert PR #108.",
    },
    packet_digest: "digest-landing-unit",
    packet_id: "review-packet-landing-unit",
    schema_version: 1,
    status: "finalized",
  };
}

function childEvidenceBody({ id, siblingId }) {
  return {
    continuation_context: {
      open_siblings: [
        {
          id: siblingId,
          status: "ready",
          subject: `Child ${siblingId}`,
          type: "User story",
        },
      ],
    },
    evidence_packet: {
      continuation_summary: {
        open_child_count: 0,
      },
      parent_chain: [
        {
          id: 650,
          status: "in-progress",
          subject: "Epic 650",
          type: "Epic",
        },
        {
          id: 660,
          status: "ready",
          subject: "Feature 660",
          type: "Feature",
        },
      ],
      target_item: {
        id,
        status: "ready",
        subject: `Child ${id}`,
        type: "User story",
      },
    },
    work_item_id: `work-item-${id}`,
    workflow_id: "delivery-work-item-evidence-packet",
  };
}

function parentEvidenceBody({ openChildCount = 0 } = {}) {
  return {
    continuation_context: {
      open_siblings: [],
    },
    evidence_packet: {
      continuation_summary: {
        open_child_count: openChildCount,
      },
      parent_chain: [
        {
          id: 650,
          status: "in-progress",
          subject: "Epic 650",
          type: "Epic",
        },
      ],
      target_item: {
        id: 660,
        status: "ready",
        subject: "Feature 660",
        type: "Feature",
      },
    },
    work_item_id: "work-item-660",
    workflow_id: "delivery-work-item-evidence-packet",
  };
}

test("landing-unit dry-run plans child completions and parent closeout", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-landing-unit-"));
  const packetPath = path.join(tempDir, "packet.json");
  await writeFile(packetPath, JSON.stringify(finalizedLandingUnitPacket()), "utf8");
  const stdoutChunks = [];
  const requestedPaths = [];

  const exitCode = await runArtCliCommand({
    argv: ["landing-unit", "dry-run", packetPath],
    spawnImpl(_command, args) {
      const method = args.at(-4);
      const requestPath = args.at(-3);
      requestedPaths.push(`${method} ${requestPath}`);
      assert.equal(method, "GET");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        const body = requestPath.includes("work-item-661")
          ? childEvidenceBody({ id: 661, siblingId: 662 })
          : childEvidenceBody({ id: 662, siblingId: 661 });
        child.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ body, ok: true, status: 200 })),
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
  assert.equal(output.workflow_id, "delivery-art-landing-unit-dry-run");
  assert.equal(output.planned_completion_count, 2);
  assert.equal(output.parent_closeout_candidates[0].parent_id, "work-item-660");
  assert.equal(
    output.parent_closeout_candidates[0].eligible_after_child_completion,
    true,
  );
  assert.deepEqual(requestedPaths, [
    "GET /v1/delivery-work-items/work-item-661/evidence-packet",
    "GET /v1/delivery-work-items/work-item-662/evidence-packet",
  ]);
});

test("landing-unit dry-run fails closed when generated completion evidence is invalid", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-landing-unit-invalid-"));
  const packetPath = path.join(tempDir, "packet.json");
  const packet = JSON.parse(JSON.stringify(finalizedLandingUnitPacket()));
  packet.evidence.changed_surfaces = [
    "`operator-orchestration-service/docs/records/change-records/example.md`: records delivery/runtime/AI-adjacent evidence.",
  ];
  await writeFile(packetPath, JSON.stringify(packet), "utf8");
  const stdoutChunks = [];
  const requestedPaths = [];

  const exitCode = await runArtCliCommand({
    argv: ["landing-unit", "dry-run", packetPath],
    spawnImpl(_command, args) {
      const method = args.at(-4);
      const requestPath = args.at(-3);
      requestedPaths.push(`${method} ${requestPath}`);
      assert.equal(method, "GET");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      process.nextTick(() => {
        const body = requestPath.includes("work-item-661")
          ? childEvidenceBody({ id: 661, siblingId: 662 })
          : childEvidenceBody({ id: 662, siblingId: 661 });
        child.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ body, ok: true, status: 200 })),
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
  assert.equal(exitCode, 1);
  assert.equal(output.ready_to_submit, false);
  assert.equal(output.generated_payload_preflight.valid, false);
  assert.equal(output.generated_payload_preflight.invalid_count, 3);
  assert.match(
    output.errors.join("\n"),
    /work-item\.complete work-item-661: Changed Surfaces: changed surface paths must be code-formatted/,
  );
  assert.deepEqual(requestedPaths, [
    "GET /v1/delivery-work-items/work-item-661/evidence-packet",
    "GET /v1/delivery-work-items/work-item-662/evidence-packet",
  ]);
});

test("landing-unit submit completes covered children before a covered parent", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-landing-unit-submit-"));
  const packetPath = path.join(tempDir, "packet.json");
  const statePath = path.join(tempDir, "projection-state.json");
  const packet = finalizedLandingUnitPacket();
  packet.completion_mapping.unshift({
    evidence_summary: "Closes the covered parent after its children.",
    work_item_id: "660",
  });
  packet.covered_work_item_ids.unshift("660");
  await writeFile(packetPath, JSON.stringify(packet), "utf8");
  const stdoutChunks = [];
  const requests = [];
  let parentReadCount = 0;

  const exitCode = await runArtCliCommand({
    argv: ["landing-unit", "submit", packetPath],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
    },
    spawnImpl(_command, args) {
      const method = args.at(-4);
      const requestPath = args.at(-3);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end(chunk) {
          if (chunk) {
            const stdinEnvelope = JSON.parse(String(chunk));
            if (stdinEnvelope.bodyBase64) {
              const decoded = JSON.parse(
                Buffer.from(stdinEnvelope.bodyBase64, "base64").toString("utf8"),
              );
              if (requestPath.includes("/complete")) {
                assert.match(
                  decoded.input.completion_note,
                  /digest-landing-unit/,
                );
                assert.match(
                  decoded.input.changed_surfaces,
                  /`operator-orchestration-service\/src\/art-cli\.js`:/,
                );
              }
              if (requestPath.includes("/stale-open-close")) {
                assert.match(
                  decoded.input.stale_open_justification,
                  /work-item-661, work-item-662/,
                );
              }
            }
          }
        },
      };
      requests.push(`${method} ${requestPath}`);
      process.nextTick(() => {
        let body;
        if (method === "GET" && requestPath.includes("work-item-661")) {
          body = childEvidenceBody({ id: 661, siblingId: 662 });
        } else if (method === "GET" && requestPath.includes("work-item-662")) {
          body = childEvidenceBody({ id: 662, siblingId: 661 });
        } else if (method === "GET" && requestPath.includes("work-item-660")) {
          parentReadCount += 1;
          body = parentEvidenceBody({
            openChildCount: parentReadCount === 1 ? 2 : 0,
          });
        } else if (method === "POST" && requestPath.includes("/complete")) {
          const id = requestPath.match(/work-item-\d+/)[0];
          body = {
            work_item: { status: "done" },
            work_item_id: id,
            workflow_id: "delivery-work-item-complete",
            wgcf_art_readiness: { receipt_id: `receipt-${id}` },
          };
        } else if (
          method === "POST" &&
          requestPath.includes("/stale-open-close")
        ) {
          body = {
            work_item: { status: "done" },
            work_item_id: "work-item-660",
            workflow_id: "delivery-work-item-stale-open-close",
            wgcf_art_readiness: { receipt_id: "receipt-work-item-660" },
          };
        }
        child.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ body, ok: true, status: 200 })),
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
  assert.equal(output.workflow_id, "delivery-art-landing-unit-submit");
  assert.equal(output.completed.length, 2);
  assert.deepEqual(output.skipped_work_items, [
    {
      reason: "parent_closeout_after_children",
      status: "ready",
      work_item_id: "work-item-660",
    },
  ]);
  assert.equal(output.parent_closeouts[0].parent_id, "work-item-660");
  assert.equal(output.parent_closeouts[0].action, "stale-open-closed");
  assert.equal(output.projection_checkpoint.dirty, false);
  assert.deepEqual(requests, [
    "GET /v1/delivery-work-items/work-item-660/evidence-packet",
    "GET /v1/delivery-work-items/work-item-661/evidence-packet",
    "GET /v1/delivery-work-items/work-item-662/evidence-packet",
    "POST /v1/delivery-work-items/work-item-661/complete",
    "POST /v1/delivery-work-items/work-item-662/complete",
    "GET /v1/delivery-work-items/work-item-660/evidence-packet",
    "POST /v1/delivery-work-items/work-item-660/stale-open-close",
  ]);
});

test("landing-unit submit closes nested covered parents deepest-first", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "oos-nested-landing-unit-"));
  const packetPath = path.join(tempDir, "packet.json");
  const statePath = path.join(tempDir, "projection-state.json");
  const packet = finalizedLandingUnitPacket();
  packet.completion_mapping = [
    {
      evidence_summary: "Closes the Feature after its descendants.",
      work_item_id: "work-item-660",
    },
    {
      evidence_summary: "Closes the Story after its Task.",
      work_item_id: "work-item-661",
    },
    {
      evidence_summary: "Completes the leaf Task.",
      work_item_id: "work-item-663",
    },
  ];
  packet.covered_work_item_ids = [
    "work-item-660",
    "work-item-661",
    "work-item-663",
  ];
  await writeFile(packetPath, JSON.stringify(packet), "utf8");
  const stdoutChunks = [];
  const requests = [];
  let featureReadCount = 0;
  let storyReadCount = 0;

  const hierarchyEvidenceBody = ({
    id,
    openChildCount,
    parentChain,
    type,
  }) => ({
    continuation_context: {
      open_siblings: [],
    },
    evidence_packet: {
      continuation_summary: {
        open_child_count: openChildCount,
      },
      parent_chain: parentChain,
      target_item: {
        id,
        status: "ready",
        subject: `${type} ${id}`,
        type,
      },
    },
    work_item_id: `work-item-${id}`,
    workflow_id: "delivery-work-item-evidence-packet",
  });
  const epic = {
    id: 650,
    status: "in-progress",
    subject: "Epic 650",
    type: "Epic",
  };
  const feature = {
    id: 660,
    status: "ready",
    subject: "Feature 660",
    type: "Feature",
  };
  const story = {
    id: 661,
    status: "ready",
    subject: "Story 661",
    type: "User story",
  };

  const exitCode = await runArtCliCommand({
    argv: ["landing-unit", "submit", packetPath],
    env: {
      ART_PROJECTION_STATE_FILE: statePath,
    },
    spawnImpl(_command, args) {
      const method = args.at(-4);
      const requestPath = args.at(-3);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {},
      };
      requests.push(`${method} ${requestPath}`);
      process.nextTick(() => {
        let body;
        if (method === "GET" && requestPath.includes("work-item-660")) {
          featureReadCount += 1;
          body = hierarchyEvidenceBody({
            id: 660,
            openChildCount: featureReadCount === 1 ? 1 : 0,
            parentChain: [epic],
            type: "Feature",
          });
        } else if (method === "GET" && requestPath.includes("work-item-661")) {
          storyReadCount += 1;
          body = hierarchyEvidenceBody({
            id: 661,
            openChildCount: storyReadCount === 1 ? 1 : 0,
            parentChain: [epic, feature],
            type: "User story",
          });
        } else if (method === "GET" && requestPath.includes("work-item-663")) {
          body = hierarchyEvidenceBody({
            id: 663,
            openChildCount: 0,
            parentChain: [epic, feature, story],
            type: "Task",
          });
        } else if (method === "POST" && requestPath.includes("/complete")) {
          const id = requestPath.match(/work-item-\d+/)[0];
          body = {
            work_item: { status: "done" },
            work_item_id: id,
            workflow_id: "delivery-work-item-complete",
            wgcf_art_readiness: { receipt_id: `receipt-${id}` },
          };
        } else if (
          method === "POST" &&
          requestPath.includes("/stale-open-close")
        ) {
          const id = requestPath.match(/work-item-\d+/)[0];
          body = {
            work_item: { status: "done" },
            work_item_id: id,
            workflow_id: "delivery-work-item-stale-open-close",
            wgcf_art_readiness: { receipt_id: `receipt-${id}` },
          };
        }
        child.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ body, ok: true, status: 200 })),
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
  assert.deepEqual(
    output.completed.map((entry) => entry.work_item_id),
    ["work-item-663"],
  );
  assert.deepEqual(
    output.parent_closeouts.map((entry) => entry.parent_id),
    ["work-item-661", "work-item-660"],
  );
  assert.deepEqual(requests, [
    "GET /v1/delivery-work-items/work-item-660/evidence-packet",
    "GET /v1/delivery-work-items/work-item-661/evidence-packet",
    "GET /v1/delivery-work-items/work-item-663/evidence-packet",
    "POST /v1/delivery-work-items/work-item-663/complete",
    "GET /v1/delivery-work-items/work-item-661/evidence-packet",
    "POST /v1/delivery-work-items/work-item-661/stale-open-close",
    "GET /v1/delivery-work-items/work-item-660/evidence-packet",
    "POST /v1/delivery-work-items/work-item-660/stale-open-close",
  ]);
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
      child.stdin = {
        end(chunk) {
          const stdinEnvelope = JSON.parse(String(chunk));
          const decoded = JSON.parse(
            Buffer.from(stdinEnvelope.bodyBase64, "base64").toString("utf8"),
          );
          assert.deepEqual(decoded.review_packet.covered_work_item_ids, ["work-item-471"]);
        },
      };
      process.nextTick(() => {
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
      ART_CGG_PACKETING: "off",
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
