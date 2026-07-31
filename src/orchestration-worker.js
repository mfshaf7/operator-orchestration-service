import { loadConfig } from "./config.js";
import {
  orchestrationWorkerStatus,
  runOrchestrationWorker,
} from "./orchestration/worker.js";

const command = process.argv[2] ?? "status";
const config = loadConfig();

if (command === "status") {
  process.stdout.write(
    `${JSON.stringify(orchestrationWorkerStatus(config), null, 2)}\n`,
  );
} else if (command === "run") {
  await runOrchestrationWorker(config);
} else {
  process.stderr.write(
    "Usage: node src/orchestration-worker.js [status|run]\n",
  );
  process.exitCode = 2;
}
