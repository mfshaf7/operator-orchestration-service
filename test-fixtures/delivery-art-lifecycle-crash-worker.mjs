import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { artifactContentDigest } from "../src/delivery-art/contracts.js";
import { createDeliveryArtWorkStartDraft } from "../src/delivery-art/lifecycle-authoring.js";
import { createDeliveryArtLifecycleController } from "../src/delivery-art/lifecycle-controller.js";

const [stateRoot, mode] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(path.join(stateRoot, "plan.json"), "utf8"));
const durablePath = path.join(stateRoot, "durable-work-start.json");
const attemptsPath = path.join(stateRoot, "evaluation-attempts.json");
const crashMarkerPath = path.join(stateRoot, "crash-marker");

function readJson(filePath) {
  return existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, "utf8"))
    : null;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function durableWorkStart(candidate) {
  const artifact = structuredClone(candidate);
  artifact.readiness = {
    blockers: [],
    evaluated_at: candidate.created_at,
    level: "implementation-ready",
  };
  artifact.integrity.content_digest = artifactContentDigest(artifact);
  const digest = artifact.integrity.content_digest.slice("sha256:".length);
  artifact.custody = {
    backend: "wgcf-artifact-registry",
    persisted_at: candidate.created_at,
    receipt_ref: {
      digest: `sha256:${"b".repeat(64)}`,
      uri: `wgcf://receipts/artifact-custody/${"b".repeat(24)}-${"b".repeat(64)}.json`,
    },
    state: "durable",
    supersedes: null,
    uri: `wgcf://artifacts/delivery-art/sha256/${digest}`,
  };
  return artifact;
}

const fileAdapter = {
  async read(filePath) {
    return readJson(filePath);
  },
  async write(filePath, value) {
    writeJson(filePath, value);
  },
};

const brokerAdapter = {
  async request(request) {
    if (request.path.endsWith("/work-start/draft")) {
      const input = request.body.input;
      return {
        body: {
          work_start: createDeliveryArtWorkStartDraft({
            architecture: {
              packet_digest: null,
              packet_ref: null,
              readiness: "not-required",
              required: false,
            },
            coveredWorkItemIds: input.covered_work_item_ids,
            createdAt: "2026-08-12T17:00:00+08:00",
            deliveryId: input.delivery_id,
            landingUnit: input.landing_unit,
            operator: {
              decision_source: input.operator.decision_source,
              id: request.callerId,
            },
            sourceSnapshot: {
              art_digest: `sha256:${"a".repeat(64)}`,
              art_ref: "openproject://work_packages/819",
              captured_at: "2026-08-12T17:00:00+08:00",
              repo_revisions: input.landing_unit.branch_plan.map((entry) => ({
                base_ref: entry.base_ref,
                commit: entry.base_commit,
                repo: entry.repo,
              })),
            },
          }),
        },
        ok: true,
      };
    }
    if (request.path.endsWith("/work-start/evaluate")) {
      const attempts = readJson(attemptsPath) ?? [];
      attempts.push(request.body.artifact.integrity.content_digest);
      writeJson(attemptsPath, attempts);
      const durable = readJson(durablePath) ?? durableWorkStart(request.body.artifact);
      writeJson(durablePath, durable);
      if (mode === "crash" && !existsSync(crashMarkerPath)) {
        writeFileSync(crashMarkerPath, "crashed-after-durable-write\n", "utf8");
        process.exit(23);
      }
      return { body: { artifact: durable }, ok: true };
    }
    throw new Error(`Unexpected broker request ${request.path}`);
  },
};

const source = {
  base_commit: "1".repeat(40),
  branch: plan.landing_unit.branch,
  changed_files: [],
  head_commit: "2".repeat(40),
  state: "dirty",
  upstream_commit: "2".repeat(40),
};
const controller = createDeliveryArtLifecycleController({
  artAdapter: { async statuses() { return ["in-progress"]; } },
  brokerAdapter,
  clock: () => new Date("2026-08-12T17:00:00+08:00"),
  fileAdapter,
  sourceAdapter: {
    async inspect() { return structuredClone(source); },
    async pullRequest() { return { state: "missing" }; },
  },
});

const result = await controller.reconcile(plan);
process.stdout.write(JSON.stringify({
  executed_actions: result.executed_actions,
  projection: result.projection,
}));
