import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";

test("service binds all interfaces by default for container and cluster reachability", () => {
  const config = loadConfig({});

  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, 8080);
});
