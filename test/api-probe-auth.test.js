import assert from "node:assert/strict";
import test from "node:test";

import { resolveProbeAuth } from "../scripts/api_probe_auth.mjs";

test("API probe uses the selected caller's identity-bound secret", () => {
  const auth = resolveProbeAuth({
    CALLER_ALLOWED_IDS: "other-caller,delivery-reader",
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      "delivery-reader": "reader-secret",
      "other-caller": "other-secret",
    }),
    CALLER_AUTH_SHARED_SECRET: "shared-secret",
  }, "delivery-reader");

  assert.deepEqual(auth, {
    caller: "delivery-reader",
    secret: "reader-secret",
  });
});

test("API probe uses the shared secret only for a caller without a specific secret", () => {
  const auth = resolveProbeAuth({
    CALLER_ALLOWED_IDS: "compatibility-caller",
    CALLER_AUTH_SECRETS_JSON: "{}",
    CALLER_AUTH_SHARED_SECRET: "shared-secret",
  });

  assert.deepEqual(auth, {
    caller: "compatibility-caller",
    secret: "shared-secret",
  });
});

test("API probe fails closed when caller-specific secret JSON is invalid", () => {
  assert.throws(
    () => resolveProbeAuth({
      CALLER_ALLOWED_IDS: "delivery-reader",
      CALLER_AUTH_SECRETS_JSON: "not-json",
      CALLER_AUTH_SHARED_SECRET: "shared-secret",
    }),
    /CALLER_AUTH_SECRETS_JSON is invalid/,
  );
});
