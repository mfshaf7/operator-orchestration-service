import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest, canonicalStringify } from "../src/delivery-art/canonical-json.js";
import { sourceControlEvidenceProfile } from "../src/delivery-art/application-verification.js";
import { createInstanceRecordReader } from "../src/instance-records/client.js";
import { createConfiguredHostInstanceSourceReader } from "../src/instance-records/host-source-reader.js";
import { planSourceOwnerBootstrap, sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";
import { instanceSourceProof } from "./fixtures/instance-source-authority.js";

const env = { OOS_INSTANCE_RECORDS_ENABLED: "true", OOS_INSTANCE_ID: "synthetic-installation" };
const config = { baseUrl: "http://127.0.0.1:32199", instanceId: env.OOS_INSTANCE_ID,
  callerId: "synthetic-reader", callerSecret: "s".repeat(32) };

for (const operation of ["bootstrap", "configure-verification", "ordinary-source"]) {
  test(`Async and canonical host readers preserve identical typed source bytes: ${operation}`, async () => {
    const original = instanceSourceProof({ operation });
    const sorted = JSON.parse(canonicalStringify(original));
    const reversed = JSON.parse(JSON.stringify(original, function (_key, value) {
      return value && !Array.isArray(value) && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).reverse()) : value;
    }));
    const results = [];
    for (const body of [original, sorted, reversed]) {
      const client = createInstanceRecordReader({ ...config, fetchImpl: async () => Response.json(body) });
      const asyncProof = (await client.sourceAuthority(original.source_authority.owner_repo, operation)).source_authority;
      const hostProof = createConfiguredHostInstanceSourceReader({ env, execute: () => canonicalStringify(body) })({
        ownerRepo: original.source_authority.owner_repo, operation, policyRef: original.source_authority.policy_ref });
      assert.equal(JSON.stringify(asyncProof.provider_repository), JSON.stringify(hostProof.provider_repository));
      assert.equal(JSON.stringify(asyncProof.intake_entry_ref), JSON.stringify(hostProof.intake_entry_ref));
      assert.equal(JSON.stringify(asyncProof.inventory_entry_ref), JSON.stringify(hostProof.inventory_entry_ref));
      assert.equal(canonicalDigest(asyncProof), canonicalDigest(original.source_authority));
      results.push(asyncProof, hostProof);
    }
    if (operation === "bootstrap") {
      const plan = authority => planSourceOwnerBootstrap({ authority, fetchedBase: "d".repeat(40),
        profile: sourceControlEvidenceProfile(authority.owner_repo), applicationMarkers: [], withCi: true,
        observedFiles: Object.fromEntries(sourceOwnerBootstrapPaths(true).map(name => [name, null])) });
      const approved = plan(results[0]);
      for (const proof of results) assert.deepEqual(plan(proof), approved,
        "The exact approved source files and plan digest must survive host-helper serialization");
    }
  });
}
