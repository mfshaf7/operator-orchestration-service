import test from "node:test";
import assert from "node:assert/strict";

import { createAgentConsoleRuntime } from "../src/agent-console/runtime.js";

test("Agent Console runtime stays disabled by default and rejects non-admitted profiles", () => {
  assert.equal(createAgentConsoleRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createAgentConsoleRuntime({
      config: {
        enabled: true,
        profile: "stage",
      },
    }),
    (error) => error.code === "agent_console_activation_required",
  );
});

test("Agent Console runtime requires all source-owned integration boundaries", () => {
  assert.throws(
    () => createAgentConsoleRuntime({
      config: {
        enabled: true,
        profile: "dev-integration",
        operatorBindings: {},
      },
    }),
    (error) => error.code === "agent_console_configuration_missing",
  );
});
