import { createRefinementActivities } from "./refinement/activities.js";
import { createRefinementSourceAdapter } from "./refinement/source-adapter.js";
import { runRefinementWorker } from "./refinement/worker.js";
import { createRuntime } from "./runtime.js";

const runtime = createRuntime();
const activities = createRefinementActivities({
  deliveryService: runtime.deliveryService,
  sourceAdapter: createRefinementSourceAdapter({
    openProjectClient: runtime.openProjectClient,
  }),
});

await runRefinementWorker(runtime.config, activities);
