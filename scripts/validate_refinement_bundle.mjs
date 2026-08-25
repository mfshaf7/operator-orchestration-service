import { fileURLToPath } from "node:url";

import { bundleWorkflowCode } from "@temporalio/worker";

const workflowsPath = fileURLToPath(
  new URL("../src/refinement/workflows.js", import.meta.url),
);
const bundle = await bundleWorkflowCode({ workflowsPath });

if (!bundle.code.includes("deliveryRefinementApplyV1")) {
  throw new Error(
    "Temporal workflow bundle does not contain deliveryRefinementApplyV1",
  );
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    workflows: ["deliveryRefinementApplyV1"],
    bundle_bytes: Buffer.byteLength(bundle.code),
  })}\n`,
);
