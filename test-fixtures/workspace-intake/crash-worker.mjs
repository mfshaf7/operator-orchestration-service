import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWorkspaceIntakeService } from "../../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../../src/workspace-intake/store.js";
import { at, caller, readinessFixture } from "./fixture.js";

const [root, fixturePath, mode] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const providerFile = path.join(root, "provider.json");
const service = createWorkspaceIntakeService({
  store: createWorkspaceIntakeStore({ root }), clock: () => new Date(at),
  readinessClient: { evaluate: async (input) => readinessFixture(input) },
  sourceClient: {
    prepare: async () => fixture.preparation,
    async openReview() {
      let value;
      try { value = JSON.parse(await readFile(providerFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!value) await writeFile(providerFile, JSON.stringify({ creates: 1 }));
      if (mode === "crash") process.kill(process.pid, "SIGKILL");
      return fixture.review;
    },
    observe: async () => ({ review: fixture.review, readback: fixture.readback }),
    cancel: async () => null,
  },
});
if (fixture.candidate) {
  await service.attest({
    callerId: "workspace-prototype-studio",
    input: fixture.candidate,
  });
}
await service.submit({ callerId: caller, input: fixture.input });
const command = { callerId: caller, requestId: fixture.input.request.request_id, action: mode === "cancel" ? "cancel" : "continue" };
await service.advance(command);
console.log(JSON.stringify(await service.advance(command)));
