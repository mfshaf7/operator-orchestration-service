import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest, parseCanonicalJson } from "../src/delivery-art/canonical-json.js";

const platformHead = "552f5e5c03cbc33b428855c1055c09c549d5fdf2";
const cases = {
  recovery: "cases-b17cb044-3324-4788-8202-9e2dfc18947a",
  rejected_inputs: "cases-bc81236b-2c49-4aff-9a1f-d211ee142c79",
};
const maxReceiptBytes = 16 * 1024;
const sha256 = /^sha256:[0-9a-f]{64}$/;
const revision = /^[0-9a-f]{40}$/;

function requirePrivate(info) {
  if (info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error("The rehearsal result must be in the executor's private receipt directory.");
  }
}

function readReceipt(root, brokerHead) {
  const directory = lstatSync(root);
  if (!directory.isDirectory()) throw new Error("The rehearsal receipt directory is unavailable.");
  requirePrivate(directory);
  const file = openSync(path.join(root, `${brokerHead}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(file);
    requirePrivate(info);
    if (!info.isFile() || info.size < 1 || info.size > maxReceiptBytes) {
      throw new Error("The rehearsal receipt is not a bounded regular file.");
    }
    const buffer = Buffer.alloc(maxReceiptBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(file, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== info.size) throw new Error("The rehearsal receipt changed during readback.");
    return parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally {
    closeSync(file);
  }
}

export function verifyProjectRuntimeCase({ root, brokerHead, testCase }) {
  if (!revision.test(brokerHead) || !Object.hasOwn(cases, testCase)) {
    throw new Error("Select a named Broker runtime case and an exact source revision.");
  }
  const { content_digest: seal, ...record } = readReceipt(root, brokerHead);
  const { observations } = record;
  if (record.artifact_type !== "broker-project-runtime-rehearsal/v1" ||
      record.state !== "completed" || !Number.isFinite(Date.parse(record.recorded_at)) ||
      !sha256.test(seal) || canonicalDigest(record) !== seal ||
      record.plan_cases?.[testCase] !== cases[testCase] ||
      observations?.sourceRevisions?.broker !== brokerHead ||
      observations.sourceRevisions.platform !== platformHead ||
      observations.disposableNamespaceRemoved !== true) {
    throw new Error("The receipt does not bind the completed rehearsal to this source revision and case.");
  }
  if (testCase === "recovery") {
    const files = observations.manifestFiles;
    const expectedFiles = ["app/index.html", "shared/logo.bin", "shared/module.js"];
    if (observations.status !== "ready" || observations.observedAfterRestart !== "preparing" ||
        observations.originalProcessExit !== "SIGKILL" || observations.effectCount !== 1 ||
        observations.submissionsAfterRecovery !== 0 || observations.servedExactDraft !== true ||
        observations.removedAndOutOfScopeFilesAbsent !== true ||
        !/^project-operation:[0-9a-f]{64}$/.test(observations.originalOperation) ||
        !sha256.test(observations.originalSnapshot) ||
        !/^project-setup:[0-9a-f]{64}:1$/.test(observations.configurationRevision) ||
        !files || Object.keys(files).length !== expectedFiles.length ||
        !expectedFiles.every(file => sha256.test(files[file]))) {
      throw new Error("The original command, exact materialized source and single dispatch were not verified after restart.");
    }
  } else {
    const rejected = observations.rejections;
    if (!rejected || rejected.missingBlob !== "project_source_snapshot_changed" ||
        rejected.changedBlob !== "project_source_snapshot_changed" ||
        rejected.outsideAppScope !== "project_source_outside_scope" ||
        rejected.unapprovedDependency !== "project_source_outside_scope" ||
        rejected.changedProjectReplay !== "project_runtime_command_conflict" ||
        rejected.changedRevisionReplay !== "project_runtime_command_conflict" ||
        rejected.rejectedSubmissions !== 0 || rejected.originalSnapshotPreserved !== true ||
        observations.priorOwnerStatePreserved !== true) {
      throw new Error("The rejection case did not prove zero dispatches and preservation of prior state.");
    }
  }
  return { conformance_case_id: cases[testCase], broker_head: brokerHead, receipt_digest: seal };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const repo = fileURLToPath(new URL("..", import.meta.url));
    const brokerHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const root = path.join(homedir(), ".local/state/operator-orchestration-service/project-runtime/rehearsal-receipts");
    console.log(JSON.stringify(verifyProjectRuntimeCase({ root, brokerHead, testCase: process.argv[2] })));
  } catch (error) {
    console.error(error.code === "ENOENT"
      ? "Run the isolated Broker rehearsal for the exact reviewed revision before collecting results."
      : `Could not verify the Broker rehearsal. ${error.message}`);
    process.exitCode = 1;
  }
}
