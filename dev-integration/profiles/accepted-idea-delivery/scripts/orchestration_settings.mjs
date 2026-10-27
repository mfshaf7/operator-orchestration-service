import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { loadConfig, ORCHESTRATION_API_TEMPORAL_IDENTITY,
  ORCHESTRATION_WORKER_TEMPORAL_IDENTITY, ORCHESTRATION_WORKER_PROCESS_ROLE } from "../../../../src/config.js";
import { resolveActivationEvidence } from "../../../../src/orchestration/activation-evidence.js";

export const ACTIVATION_MOUNT = "/var/run/oos/orchestration-activation";

// Source launch is not activation authority. Reuse the runtime's exact bundle
// validator before creating a poller, then let each process revalidate at use.
export function orchestrationWorkerReplicas(env, activationRoot) {
  const config = loadConfig(env);
  const switches = [config.orchestration.runtimeEnabled,
    config.orchestration.workerEnabled, config.orchestration.executionAuthorized];
  if (switches.every(value => !value)) return 0;
  if (!switches.every(Boolean)) throw new Error("All existing orchestration switches must agree before launch.");
  if (config.orchestration.activationEvidence.manifestPath !== `${ACTIVATION_MOUNT}/manifest.json`) {
    throw new Error("Use the profile's fixed read-only activation bundle mount.");
  }
  for (const [role, identity] of [[undefined, ORCHESTRATION_API_TEMPORAL_IDENTITY],
    [ORCHESTRATION_WORKER_PROCESS_ROLE, ORCHESTRATION_WORKER_TEMPORAL_IDENTITY]]) {
    const selected = loadConfig({ ...env,
      OOS_TEMPORAL_IDENTITY: identity,
      OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH: join(activationRoot, "manifest.json"),
    }, role ? { orchestrationProcessRole: role } : {});
    if (!resolveActivationEvidence(selected).valid) {
      throw new Error("The existing activation validator denied the exact API/worker bundle.");
    }
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2];
    if (!root || !root.startsWith("/")) throw new Error("The profile activation root is required.");
    process.stdout.write(String(orchestrationWorkerReplicas(process.env, root)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
