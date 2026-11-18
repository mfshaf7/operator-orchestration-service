import test from "node:test";
import assert from "node:assert/strict";
import { createAgentConsoleGatewayClient, createAgentConsoleContextClient } from "../src/agent-console/clients.js";

test("actual gateway outcomes retain busy, context capacity and completion uncertainty instead of claiming access rejection", async () => {
  for (const [outcome, code, status] of [["provider-busy", "agent_console_ai_provider_busy", 429], ["provider-context-exceeded", "agent_console_ai_context_capacity_exceeded", 413], ["provider-completion-unknown", "agent_console_ai_completion_unknown", 503]]) {
    let calls = 0;
    const payload = { policy_decision: "allow", reasons: ["no-suitable-fallback"], effective_selection: { attempts: [{ outcome }] }, audit_ref: "local-ledger:test" };
    const client = createAgentConsoleGatewayClient({ baseUrl: "http://model.test", fetchImpl: async () => { calls++; return Response.json(payload, { status: 503 }); } });
    await assert.rejects(client.invoke({}), error => error.code === code && error.statusCode === status && error.details.audit_ref === payload.audit_ref);
    assert.equal(calls, 1, "classifying an outcome must never replay inference");
  }
});

test("real denials and unrelated context-owner errors keep their distinct rejection path", async () => {
  const denied = createAgentConsoleGatewayClient({ baseUrl: "http://model.test", fetchImpl: async () => Response.json({ policy_decision: "deny", reasons: ["caller-denied"], effective_selection: { attempts: [{ outcome: "provider-busy" }] } }, { status: 403 }) });
  await assert.rejects(denied.invoke({}), error => error.statusCode === 403 && error.code === "agent_console_upstream_rejected");
  const context = createAgentConsoleContextClient({ baseUrl: "http://context.test", callerId: "test", callerSecret: "test-only", fetchImpl: async () => Response.json({ effective_selection: { attempts: [{ outcome: "provider-busy" }] } }, { status: 422 }) });
  await assert.rejects(context.project({}), error => error.statusCode === 422 && error.code === "agent_console_upstream_rejected");
});
