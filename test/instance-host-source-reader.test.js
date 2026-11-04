import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { createConfiguredHostInstanceSourceReader } from "../src/instance-records/host-source-reader.js";
import { instanceSourceProof } from "./fixtures/instance-source-authority.js";

const env = { OOS_INSTANCE_RECORDS_ENABLED: "true", OOS_INSTANCE_ID: "synthetic-installation",
  OOS_PLATFORM_OPERATION_PROVIDER_CALLER_ID: "synthetic-oos", OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET: "s".repeat(32),
  OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP: "true" };
const current = instanceSourceProof();
const selector = { ownerRepo: current.source_authority.owner_repo, operation: "ordinary-source", policyRef: current.source_authority.policy_ref };

test("synchronous host reads authenticated Platform authority in a bounded child without inheriting ambient identity", async t => {
  // A separate provider process is required: the host intentionally uses a
  // synchronous admission interface and must not block its test HTTP server.
  const server = spawn(process.execPath, ["--input-type=module", "-e", `
    import http from 'node:http';
    let raw=''; for await (const chunk of process.stdin) raw += chunk;
    const body=JSON.parse(raw);
    const server=http.createServer(async(req,res)=>{
      let input=''; for await (const chunk of req) input+=chunk;
      const value=JSON.parse(input);
      const ok=req.method==='POST' && req.url==='/v1/console-operations/source-authority/inspect' &&
        req.headers['x-platform-caller-id']==='synthetic-oos' && req.headers['x-platform-caller-secret']==='s'.repeat(32) &&
        value.schema_version===1 && value.owner_repo===body.source_authority.owner_repo && value.operation==='ordinary-source';
      res.writeHead(ok ? 200 : 403,{'content-type':'application/json'}); res.end(JSON.stringify(ok ? body : {}));
    }); server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));
  `], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH } });
  t.after(() => server.kill());
  server.stdin.end(JSON.stringify(current));
  const [rawPort] = await once(server.stdout, "data");
  const reader = createConfiguredHostInstanceSourceReader({ env: { ...env, OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL: `http://127.0.0.1:${String(rawPort).trim()}` } });
  assert.deepEqual(reader(selector), current.source_authority);
  assert.throws(() => reader({ ...selector, policyRef: { ...selector.policyRef, revision: "d".repeat(40) } }),
    { code: "instance_records_source_authority_unavailable" });
});

test("host cannot select legacy after disable, outage, namespace or privilege substitution", () => {
  assert.equal(createConfiguredHostInstanceSourceReader({ env: {} }), null);
  const disabled = createConfiguredHostInstanceSourceReader({ env: { ...env, OOS_INSTANCE_RECORDS_ENABLED: "false" } });
  assert.throws(() => disabled(selector), { code: "instance_records_disabled" });
  for (const mutate of [value => { value.canonical_authority.instance_id = "another-installation"; },
    value => { value.source_authority.runtime_activation = true; }, value => { value.source_authority.record_ref.version++; },
    value => { value.source_authority.classification = "suspended"; }, value => { value.source_authority.token = "must-not-return"; }]) {
    const value = structuredClone(current); mutate(value);
    const reader = createConfiguredHostInstanceSourceReader({ env, execute: (_node, args, options) => {
      assert.equal(args.length, 1);
      assert.equal(options.env.GH_TOKEN, undefined); assert.equal(options.env.OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET, undefined);
      assert.equal(options.timeout, 50000); assert.equal(options.maxBuffer, 65536);
      return JSON.stringify(value);
    } });
    assert.throws(() => reader(selector), { code: "instance_records_source_authority_unavailable" });
  }
  const reader = createConfiguredHostInstanceSourceReader({ env, execute: () => { throw new Error("private provider body must not leak"); } });
  assert.throws(() => reader(selector), error => error.code === "instance_records_source_authority_unavailable" && !error.message.includes("private provider body"));
  const legacy = { schema_version: 1, canonical_authority: { kind: "legacy-git", repo: "workspace-governance", revision: selector.policyRef.revision }, record_id: `repo:${selector.ownerRepo}` };
  assert.equal(createConfiguredHostInstanceSourceReader({ env, execute: () => JSON.stringify(legacy) })(selector), null);
});
