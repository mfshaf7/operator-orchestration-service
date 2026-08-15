#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (["--outage-only", "--wait"].includes(key)) {
      values.set(key, true);
      continue;
    }
    if (!key.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${key}`);
    }
    values.set(key, argv[index + 1]);
    index += 1;
  }
  for (const required of [
    "--base-url",
    "--console-revision",
    "--oos-revision",
    "--output",
  ]) {
    if (!values.get(required)) {
      throw new Error(`${required} is required`);
    }
  }
  return values;
}

async function requestJson(baseUrl, requestPath, { body, expected = [200], method = "GET" } = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${method} ${requestPath} returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return { payload, status: response.status };
}

async function waitForConsole(baseUrl) {
  const deadline = Date.now() + 120_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await requestJson(baseUrl, "/api/proposals", { expected: [200] });
      if (result.payload?.mode === "live") return;
      lastError = new Error(`Console Proposal API is not live: ${JSON.stringify(result.payload)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError ?? new Error("Console Proposal API did not become ready.");
}

async function proveBackendOutage(baseUrl) {
  const result = await requestJson(baseUrl, "/api/proposals", {
    expected: [502, 503],
  });
  assert(
    result.payload?.mode === "live" && result.payload?.status === "offline",
    `Console did not fail closed after broker outage: ${JSON.stringify(result)}`,
  );
  return result.status;
}

async function capture(baseUrl, suffix) {
  const result = await requestJson(baseUrl, "/api/proposals", {
    body: {
      body: `Disposable dev-integration Proposal proof ${suffix}.`,
      requestId: `proposal-devint-${suffix}`,
      title: `Proposal dev-integration ${suffix}`,
    },
    expected: [201],
    method: "POST",
  });
  if (!result.payload?.proposalId) throw new Error("Capture did not return proposalId.");
  return result.payload.proposalId;
}

async function readRecord(baseUrl, proposalId) {
  const result = await requestJson(baseUrl, "/api/proposals");
  if (result.payload?.mode !== "live" || result.payload?.status !== "current") {
    throw new Error(`Proposal list is not current live truth: ${JSON.stringify(result.payload)}`);
  }
  const record = result.payload.records?.find(
    (entry) => entry?.projection?.proposal_id === proposalId,
  );
  if (!record) throw new Error(`Proposal ${proposalId} was not returned by refresh.`);
  return record;
}

function sourceFrom(record) {
  const projection = record.projection;
  return {
    projectionState: projection.projection_state,
    recordRef: projection.record_ref,
    recordVersion: projection.record_version,
    status: projection.status,
  };
}

async function command(baseUrl, proposalId, commandId, source, payload, expected = [201]) {
  return requestJson(baseUrl, `/api/proposals/${encodeURIComponent(proposalId)}/commands`, {
    body: { commandId, payload, proposalId, source },
    expected,
    method: "POST",
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(baseUrl) {
  const runId = `${Date.now()}-${process.pid}`;
  const primaryId = await capture(baseUrl, `${runId}-primary`);
  const captured = await readRecord(baseUrl, primaryId);
  assert(captured.projection.status === "captured", "Primary Proposal was not captured.");

  const triageId = `proposal-command:${primaryId}:triage:${runId}`;
  const capturedSource = sourceFrom(captured);
  const triagePayload = {
    advisorDraft: "",
    advisorPrompt: "",
    step: "triage",
    summary: "The Proposal is bounded for a dev-integration disposition decision.",
  };
  const triage = await command(baseUrl, primaryId, triageId, capturedSource, triagePayload);
  assert(triage.payload?.projection?.status === "triaged", "Triage did not reach triaged.");

  const replay = await command(
    baseUrl,
    primaryId,
    triageId,
    capturedSource,
    triagePayload,
    [200],
  );
  assert(replay.payload?.replayed === true, "Repeated triage was not reported as replayed.");

  const stale = await command(
    baseUrl,
    primaryId,
    `proposal-command:${primaryId}:stale:${runId}`,
    capturedSource,
    triagePayload,
    [409],
  );
  assert(stale.payload?.status === "offline", "Stale command did not fail closed.");

  const triaged = await readRecord(baseUrl, primaryId);
  assert(triaged.projection.status === "triaged", "Refresh did not retain triaged state.");

  const disposition = await command(
    baseUrl,
    primaryId,
    `proposal-command:${primaryId}:disposition:${runId}`,
    sourceFrom(triaged),
    {
      decision: {
        advisorDraft: "",
        advisorPrompt: "",
        notes: "Accept for Delivery without repository custody in this bounded proof.",
        outcome: "accepted",
      },
      route: {
        rationale: "Prove prepared handoff while target application remains unavailable.",
        repoMode: "not-required",
        repoOwner: "",
        repoRef: "",
        routeTarget: "Delivery",
      },
      step: "disposition",
    },
  );
  assert(disposition.payload?.projection?.status === "accepted", "Disposition was not accepted.");

  const accepted = await readRecord(baseUrl, primaryId);
  const handoff = await command(
    baseUrl,
    primaryId,
    `proposal-command:${primaryId}:handoff:${runId}`,
    sourceFrom(accepted),
    {
      notes: "Prepare the handoff packet without applying it to the target.",
      result: "ready",
      step: "handoff",
    },
  );
  assert(handoff.payload?.projection?.handoff?.state === "ready", "Handoff was not prepared.");

  const prepared = await readRecord(baseUrl, primaryId);
  assert(prepared.projection.handoff.target_record_ref === null, "Target record was applied unexpectedly.");
  assert(prepared.projection.handoff.target_receipt_ref === null, "Target receipt exists unexpectedly.");

  const gatedId = await capture(baseUrl, `${runId}-repository-gated`);
  const gatedCaptured = await readRecord(baseUrl, gatedId);
  await command(
    baseUrl,
    gatedId,
    `proposal-command:${gatedId}:triage:${runId}`,
    sourceFrom(gatedCaptured),
    triagePayload,
  );
  const gatedTriaged = await readRecord(baseUrl, gatedId);
  await command(
    baseUrl,
    gatedId,
    `proposal-command:${gatedId}:disposition:${runId}`,
    sourceFrom(gatedTriaged),
    {
      decision: {
        advisorDraft: "",
        advisorPrompt: "",
        notes: "Accept while repository custody remains unresolved.",
        outcome: "accepted",
      },
      route: {
        rationale: "Repository Operation must resolve custody before handoff.",
        repoMode: "new",
        repoOwner: "",
        repoRef: "",
        routeTarget: "Delivery",
      },
      step: "disposition",
    },
  );
  const gatedAccepted = await readRecord(baseUrl, gatedId);
  assert(
    gatedAccepted.projection.route?.source_custody?.repository_gate_state === "pending",
    "Repository gate was not projected as pending.",
  );
  const blocked = await command(
    baseUrl,
    gatedId,
    `proposal-command:${gatedId}:handoff:${runId}`,
    sourceFrom(gatedAccepted),
    {
      notes: "This command must not bypass unresolved repository custody.",
      result: "ready",
      step: "handoff",
    },
    [400, 409],
  );
  assert(blocked.payload?.status === "offline", "Repository-gated handoff did not fail closed.");
  const gatedAfter = await readRecord(baseUrl, gatedId);
  assert(
    gatedAfter.projection.handoff.state === "not-requested" &&
      gatedAfter.projection.handoff.target_record_ref === null,
    "Repository-gated handoff changed canonical target state.",
  );

  return {
    primary: {
      eventTypes: prepared.history.events.map((event) => event.event_type),
      handoffState: prepared.projection.handoff.state,
      proposalId: primaryId,
      recordVersion: prepared.projection.record_version,
      status: prepared.projection.status,
      targetApplied: false,
    },
    protections: {
      replayed: replay.payload.replayed,
      repositoryGateBlocked: true,
      staleStatus: stale.status,
      targetNonApplication: true,
    },
    repositoryGated: {
      handoffState: gatedAfter.projection.handoff.state,
      proposalId: gatedId,
      repositoryGateState: gatedAfter.projection.route.source_custody.repository_gate_state,
      status: gatedAfter.projection.status,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.get("--base-url")).replace(/\/$/, "");
  const output = path.resolve(String(args.get("--output")));
  if (args.get("--outage-only")) {
    const summary = JSON.parse(readFileSync(output, "utf8"));
    summary.observed_at = new Date().toISOString();
    summary.scenarios.protections.backendOutageStatus = await proveBackendOutage(baseUrl);
    writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (args.get("--wait")) await waitForConsole(baseUrl);
  const scenarios = await run(baseUrl);
  const summary = {
    schema_version: 1,
    proof: "governance-console-proposal-devint-e2e",
    result: "passed",
    observed_at: new Date().toISOString(),
    source_revisions: {
      "governance-operations-console": args.get("--console-revision"),
      "operator-orchestration-service": args.get("--oos-revision"),
    },
    scenarios,
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
