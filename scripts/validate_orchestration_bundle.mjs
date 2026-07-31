import { fileURLToPath } from "node:url";

import { bundleWorkflowCode } from "@temporalio/worker";

const workflowsPath = fileURLToPath(
  new URL("../src/orchestration/workflows.js", import.meta.url),
);
const bundle = await bundleWorkflowCode({ workflowsPath });

if (!bundle.code.includes("validationReadinessRunV1")) {
  throw new Error(
    "Temporal workflow bundle does not contain validationReadinessRunV1",
  );
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    workflow: "validationReadinessRunV1",
    bundle_bytes: Buffer.byteLength(bundle.code),
  })}\n`,
);
