import test from "node:test";
import assert from "node:assert/strict";

import {
  getAcceptedIdeaDeliveryMissingConfig,
  loadConfig,
} from "../src/config.js";

test("service binds all interfaces by default for container and cluster reachability", () => {
  const config = loadConfig({});

  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, 8080);
});

test("accepted idea delivery reports missing delivery-art configuration when unset", () => {
  const config = loadConfig({});

  assert.deepEqual(getAcceptedIdeaDeliveryMissingConfig(config), [
    "OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER",
    "OPENPROJECT_DELIVERY_TOP_LEVEL_TYPE_ID",
    "OPENPROJECT_DELIVERY_NEW_STATUS_ID",
    "OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID",
  ]);
});
