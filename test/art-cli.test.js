import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";

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

test("buildArtCliRequest resolves initiative close with numeric ids", async () => {
  const payloadPath = "/tmp/initiative-close.json";
  await writeFile(payloadPath, "{\"input\":{}}", "utf8");

  const result = buildArtCliRequest(["initiative", "close", "304", payloadPath]);
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/v1/delivery-initiatives/delivery-304/close");
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

test("artCliUsage exposes the supported command matrix", () => {
  assert.equal(artCliUsage().includes("initiative close"), true);
  assert.equal(artCliUsage().includes("item stale-open-close"), true);
});
