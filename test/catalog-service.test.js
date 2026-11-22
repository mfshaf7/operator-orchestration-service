import assert from "node:assert/strict";
import test from "node:test";

import { CatalogUpstreamError } from "../src/catalog/http-client.js";
import { CatalogServiceError, createCatalogService } from "../src/catalog/service.js";
import { HttpError } from "../src/errors.js";

const timestamp = "2026-08-26T00:00:00Z";
const digest = `sha256:${"b".repeat(64)}`;

function binding() {
  return {
    repo_name: "operator-orchestration-service",
    repo_ref: "repo://operator-orchestration-service",
    catalog_value_key: "operator-orchestration-service",
    receipt: {
      receipt_id: "repository-readiness-receipt:1234567890abcdef12345678",
      uri: `wgcf://receipts/repository-readiness/repository-readiness-receipt-1234567890abcdef12345678-${"b".repeat(64)}.json`,
      digest,
      issuer: "workspace-governance-control-fabric",
      target_scope: "repo:operator-orchestration-service",
      outcome: "ready",
      evaluated_at: timestamp,
      generation: 1,
    },
  };
}

function item(overrides = {}) {
  return {
    catalog_item_id: "owner-repo",
    group_id: "organization",
    label: "Owner Repo",
    description: "Admitted repository identity used by Delivery.",
    value_key: "owner_repo",
    source_authority: "workspace-governance-control-fabric",
    backend_route: "/v1/delivery-catalog/owner-repo/mutations",
    owner_route: "repository-operation",
    create_authority: "repository-operation",
    console_capability: "request",
    gap_status: "console_requestable",
    lifecycle_state: "active",
    usage_count: 0,
    usage_summary: "No Delivery package uses this Catalog value yet.",
    evidence_refs: ["contract://workspace-governance/repos"],
    last_projected_at: timestamp,
    next_action_label: "Link Repository",
    next_action_detail: "Select an admitted Repository record.",
    ...overrides,
  };
}

function value(overrides = {}) {
  return {
    catalog_item_id: "owner-repo",
    catalog_value_id: "owner-repo-oos",
    value_key: "operator-orchestration-service",
    label: "Operator Orchestration Service",
    description: "Shared operator workflow broker.",
    lifecycle_state: "admitted",
    usage_count: 0,
    usage_summary: "No Delivery package uses this value yet.",
    evidence_refs: ["repo://operator-orchestration-service"],
    last_projected_at: timestamp,
    parent_catalog_item_id: null,
    parent_catalog_value_key: null,
    repository_binding: binding(),
    ...overrides,
  };
}

function projection({ revision = "catalog-version-1", values = [] } = {}) {
  return {
    schema_version: 1,
    source_revision: revision,
    projection_status: "ready",
    summary: {
      total_items: 1,
      requestable_count: 1,
      owner_routed_count: 0,
      missing_route_count: 0,
      drift_count: 0,
    },
    groups: [{
      group_id: "organization",
      title: "Organization",
      description: "Ownership vocabulary.",
      source_authority: "openproject://projects/workspace-delivery-art",
      expected_route: "/v1/delivery-catalog/owner-repo/mutations",
      route_status: "implemented",
      item_ids: ["owner-repo"],
    }],
    items: [item()],
    values,
    projected_at: timestamp,
  };
}

function request(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    idempotency_key: "owner-repo-oos-v1",
    source_revision: "catalog-version-1",
    catalog_item_id: "owner-repo",
    mode: "add",
    target_value_id: null,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Link the admitted repository.",
    },
    draft: {
      value_key: "operator-orchestration-service",
      label: "Operator Orchestration Service",
      description: "Shared operator workflow broker.",
      parent_catalog_value_key: null,
      planning_window_start_date: null,
      planning_window_end_date: null,
      repository_binding: binding(),
    },
    ...overrides,
  };
}

test("PI calendar generation rejects a connected adapter without the calendar capability before writing", async () => {
  const before = projection();
  before.items = [item({ catalog_item_id: "catalog-target-pi" })];
  before.groups[0].item_ids = ["catalog-target-pi"];
  let writes = 0;
  const service = createCatalogService({ backendClient: {
    async project() { return before; },
    async mutate() { writes += 1; },
  } });
  await assert.rejects(service.mutate({
    callerId: "operator:workspace-owner",
    catalogItemId: "catalog-target-pi",
    request: request({
      catalog_item_id: "catalog-target-pi",
      draft: {
        value_key: "PI-2027-01", label: "PI-2027-01", description: "",
        parent_catalog_value_key: null, repository_binding: null,
        planning_window_start_date: "2027-01-11", planning_window_end_date: null,
        iteration_length_days: 14, iteration_count: 5,
      },
    }),
  }), error => error.code === "catalog_read_only");
  assert.equal(writes, 0);
});

test("planning rejects standalone iteration writes and date-only PI changes before contacting the backend", async () => {
  const pi = "PI-2027-01";
  const planningItems = ["catalog-target-pi", "catalog-iteration"];
  const before = projection({ values: [value({
    catalog_item_id: "catalog-target-pi", catalog_value_id: "pi-1",
    value_key: pi, label: pi, repository_binding: null,
  })] });
  before.items = planningItems.map(catalog_item_id => item({ catalog_item_id, value_key: catalog_item_id }));
  before.groups[0].item_ids = planningItems;
  before.summary.total_items = planningItems.length;
  before.summary.requestable_count = planningItems.length;
  const service = createCatalogService({ backendClient: {
    async project() { return before; },
    async mutate() { assert.fail("A retired write path reached the backend"); },
  } });
  const draft = {
    ...request().draft, value_key: pi, label: pi, repository_binding: null,
    planning_window_start_date: "2027-01-11", planning_window_end_date: "2027-03-21",
  };
  for (const change of [
    { catalog_item_id: "catalog-iteration", draft: { ...draft, value_key: `${pi} / Iteration 1` }, error: "catalog_read_only" },
    { catalog_item_id: "catalog-target-pi", draft, error: "request_invalid" },
    { catalog_item_id: "catalog-target-pi", mode: "edit", target_value_id: "pi-1", draft, error: "request_invalid" },
  ]) {
    const { error, ...fields } = change;
    await assert.rejects(service.mutate({
      callerId: "operator:workspace-owner", catalogItemId: fields.catalog_item_id, request: request(fields),
    }), failure => failure.code === error);
  }
});

test("a retired iteration write can recover its original canonical receipt", async () => {
  const before = projection({ revision: "calendar-authority" });
  before.items = [item({ catalog_item_id: "catalog-iteration", console_capability: "owner_routed" })];
  before.groups[0].item_ids = ["catalog-iteration"];
  before.summary.requestable_count = 0;
  before.summary.owner_routed_count = 1;
  const key = "PI-2027-01 / Iteration 1";
  const accepted = request({
    catalog_item_id: "catalog-iteration",
    draft: { ...request().draft, value_key: key, label: "Iteration 1", repository_binding: null },
  });
  const service = createCatalogService({ backendClient: {
    async project() { return before; },
    async mutate(id, submitted) {
      assert.equal(id, "catalog-iteration");
      assert.deepEqual(submitted, accepted);
      return result({ replayed: true, value: value({
        catalog_item_id: id, value_key: key, label: "Iteration 1", repository_binding: null,
      }) });
    },
  } });
  const response = await service.mutate({
    callerId: "operator:workspace-owner", catalogItemId: "catalog-iteration", request: accepted,
  });
  assert.ok(response.replayed);
});

function result(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    mutation_id: "catalog-mutation-result-1",
    status: "applied",
    replayed: false,
    applied_at: timestamp,
    applied_by: "operator:workspace-owner",
    value: value(),
    related_values: [],
    source_revision: "catalog-version-2",
    readback_complete: true,
    receipt: { ref: "openproject://catalog-receipts/1", digest },
    ...overrides,
  };
}

test("PI calendar verifies the calculated dates and rejects a shortened final iteration", async () => {
  const pi = "PI-2027-01";
  const piValue = value({
    catalog_item_id: "catalog-target-pi", catalog_value_id: "pi-1",
    value_key: pi, label: pi, repository_binding: null,
  });
  const related = (catalogId, id, key) => value({
    catalog_item_id: catalogId, catalog_value_id: id, value_key: key,
    label: key, lifecycle_state: "active", repository_binding: null,
    parent_catalog_item_id: "catalog-target-pi", parent_catalog_value_key: pi,
  });
  const window = related("catalog-pi-planning-date", "pi-1-window", "2027-01-11/2027-02-07");
  const intervals = [
    { sequence: 1, start_date: "2027-01-11", end_date: "2027-01-24" },
    { sequence: 2, start_date: "2027-01-25", end_date: "2027-02-07" },
  ].map(interval => ({
    ...related("catalog-iteration", `iteration-${interval.sequence}`, `${pi} / Iteration ${interval.sequence}`),
    iteration_window: interval,
  }));
  const before = projection();
  before.items = [
    item({ catalog_item_id: "catalog-target-pi", value_key: "target_pi", supports_iteration_generation: true }),
    item({ catalog_item_id: "catalog-iteration", value_key: "iteration" }),
    item({ catalog_item_id: "catalog-pi-planning-date", value_key: "pi_planning_date" }),
  ];
  before.groups[0].item_ids = before.items.map(entry => entry.catalog_item_id);
  before.summary.total_items = before.summary.requestable_count = before.items.length;
  const accepted = request({
    catalog_item_id: "catalog-target-pi",
    draft: {
      value_key: pi, label: pi, description: "", parent_catalog_value_key: null, repository_binding: null,
      planning_window_start_date: "2027-01-11", planning_window_end_date: null,
      iteration_count: 2, iteration_length_days: 14,
    },
  });
  let saved;
  let shortened = false;
  const service = createCatalogService({ backendClient: {
    async project() {
      return saved ? { ...before, source_revision: saved.source_revision, values: [saved.value, ...saved.related_values] } : before;
    },
    async mutate() {
      const last = intervals[1];
      const finalIteration = shortened ? { ...last, iteration_window: { ...last.iteration_window, end_date: "2027-02-06" } } : last;
      saved = result({ value: piValue, related_values: [window, intervals[0], finalIteration] });
      return saved;
    },
  } });
  const submit = draft => service.mutate({
    callerId: "operator:workspace-owner", catalogItemId: "catalog-target-pi",
    request: { ...accepted, draft: { ...accepted.draft, ...draft } },
  });
  for (const invalid of [
    { planning_window_start_date: "2027-02-30" },
    { planning_window_end_date: "2027-02-06" },
    { iteration_length_days: undefined },
  ]) {
    await assert.rejects(submit(invalid), error => error.code === "request_invalid");
    assert.equal(saved, undefined);
  }
  assert.deepEqual((await submit()).related_values, [window, ...intervals]);
  saved = undefined;
  shortened = true;
  await assert.rejects(submit(), error => error.code === "backend_readback_incomplete");
});

function repositoryAuthority() {
  return {
    repo_name: "operator-orchestration-service",
    repo_ref: "repo://operator-orchestration-service",
    expected_owner_repo: "operator-orchestration-service",
    catalog_value_key: "operator-orchestration-service",
    expected_authority_digest: `sha256:${"c".repeat(64)}`,
  };
}

function service({
  after = projection({ revision: "catalog-version-2", values: [value()] }),
  before = projection(),
  mutateResult = result(),
  readinessError = null,
  readinessIssueError = null,
  repositoryAuthorityError = null,
} = {}) {
  const calls = [];
  const projections = [before, after];
  return {
    calls,
    instance: createCatalogService({
      audit: { emit(event) { calls.push({ operation: "audit", event }); } },
      backendClient: {
        async mutate(catalogItemId, mutation) {
          calls.push({ operation: "mutate", catalogItemId, mutation });
          return mutateResult;
        },
        async project() {
          calls.push({ operation: "project" });
          return projections.shift() ?? after;
        },
      },
      readinessClient: {
        async issueCurrent(authority) {
          calls.push({ operation: "readiness-issue", authority });
          if (readinessIssueError) throw readinessIssueError;
          return binding();
        },
        async verifyCurrent(reference) {
          calls.push({ operation: "readiness", reference });
          if (readinessError) throw readinessError;
          return reference;
        },
      },
      async repositoryAuthorityReader(input) {
        calls.push({ operation: "repository-authority", input });
        if (repositoryAuthorityError) throw repositoryAuthorityError;
        return repositoryAuthority();
      },
    }),
  };
}

test("Catalog prepares first-use repository readiness from current inventory authority", async () => {
  const target = service();
  const output = await target.instance.prepareRepositoryReadiness({
    callerId: "governance-operations-console",
    correlationId: "correlation-readiness-1",
    request: { schema_version: 1, repo_name: "operator-orchestration-service" },
  });

  assert.deepEqual(output, {
    schema_version: 1,
    repository_readiness_reference: binding(),
  });
  assert.deepEqual(
    target.calls.map((call) => call.operation),
    ["repository-authority", "readiness-issue", "audit"],
  );
  assert.deepEqual(target.calls[1].authority, repositoryAuthority());
});

test("Catalog readiness preparation is replay-safe and returns the same WGCF reference", async () => {
  const target = service();
  const input = {
    callerId: "governance-operations-console",
    correlationId: "correlation-readiness-1",
    request: { schema_version: 1, repo_name: "operator-orchestration-service" },
  };
  assert.deepEqual(
    await target.instance.prepareRepositoryReadiness(input),
    await target.instance.prepareRepositoryReadiness(input),
  );
  assert.equal(
    target.calls.filter((call) => call.operation === "readiness-issue").length,
    2,
  );
});

test("Catalog readiness preparation rejects inactive repositories before WGCF", async () => {
  const target = service({
    repositoryAuthorityError: new HttpError(
      409,
      "workspace_inventory_repository_not_admitted",
      "Repository is retired.",
    ),
  });
  await assert.rejects(
    target.instance.prepareRepositoryReadiness({
      callerId: "governance-operations-console",
      correlationId: "correlation-readiness-1",
      request: { schema_version: 1, repo_name: "operator-orchestration-service" },
    }),
    (error) => error.code === "repository_not_admitted" && error.statusCode === 409,
  );
  assert.equal(target.calls.some((call) => call.operation === "readiness-issue"), false);
});

test("Catalog readiness preparation fails closed on stale WGCF authority", async () => {
  const target = service({
    readinessIssueError: new HttpError(
      409,
      "repository_readiness_stale",
      "Authority changed during evaluation.",
    ),
  });
  await assert.rejects(
    target.instance.prepareRepositoryReadiness({
      callerId: "governance-operations-console",
      correlationId: "correlation-readiness-1",
      request: { schema_version: 1, repo_name: "operator-orchestration-service" },
    }),
    (error) => error.code === "repository_readiness_stale" && error.statusCode === 409,
  );
});

test("Catalog mutation verifies readiness, applies once, and proves canonical readback", async () => {
  const target = service();
  const output = await target.instance.mutate({
    callerId: "operator:workspace-owner",
    catalogItemId: "owner-repo",
    request: request(),
  });
  assert.equal(output.mutation_id, "catalog-mutation-result-1");
  assert.deepEqual(
    target.calls.filter((call) => call.operation !== "audit").map((call) => call.operation),
    ["project", "readiness", "mutate", "project"],
  );
});

test("Catalog stale request cannot become a new write through the receipt-replay path", async () => {
  let attempts=0;
  const instance=createCatalogService({backendClient:{ async project(){return projection({revision:"newer"});}, async mutate(){attempts++;throw new CatalogUpstreamError("source_revision_stale", "No existing receipt", {statusCode:409});} }});
  await assert.rejects(instance.mutate({callerId:"operator:workspace-owner",catalogItemId:"owner-repo",request:request()}),error=>error.statusCode===409);
  assert.equal(attempts,1);
});

test("Catalog recovers exact canonical receipt after an applied request changes the revision", async () => {
  const target=service({before:projection({revision:"catalog-version-2",values:[value()]}),mutateResult:result({replayed:true})});
  const recovered=await target.instance.mutate({callerId:"operator:workspace-owner",catalogItemId:"owner-repo",request:request()});
  assert.equal(recovered.replayed,true);
  assert.deepEqual(target.calls.filter(c=>c.operation!=="audit").map(c=>c.operation),["project","mutate"]);
});

test("Catalog mutation keeps authenticated caller and accepted operator as separate identities", async () => {
  const target = service();
  const output = await target.instance.mutate({
    callerId: "governance-operations-console",
    catalogItemId: "owner-repo",
    request: request(),
  });
  assert.equal(output.applied_by, "operator:workspace-owner");
  assert.equal(
    target.calls.find((call) => call.operation === "audit").event.actor,
    "governance-operations-console",
  );
});

test("Catalog mutation fails closed when repository readiness is stale", async () => {
  const target = service({
    readinessError: new HttpError(409, "repository_readiness_stale", "Authority changed."),
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "repository_readiness_stale" &&
      error.readinessReceiptRef === binding().receipt.uri,
  );
  assert.equal(target.calls.some((call) => call.operation === "mutate"), false);
});

test("Catalog mutation rejects false backend readback", async () => {
  const target = service({
    after: projection({ revision: "catalog-version-2", values: [] }),
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "backend_readback_incomplete",
  );
});

test("Catalog retirement blocks a value still used by Delivery", async () => {
  const used = value({ usage_count: 2, usage_summary: "Used by two records." });
  const before = projection({ values: [used] });
  const target = service();
  target.instance = createCatalogService({
    backendClient: { async project() { return before; }, async mutate() { throw new Error("must not write"); } },
    readinessClient: { async verifyCurrent(reference) { return reference; } },
  });
  const retirement = request({
    mode: "retire",
    target_value_id: used.catalog_value_id,
    draft: { ...request().draft, repository_binding: null },
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: retirement,
    }),
    (error) => error.code === "catalog_value_in_use",
  );
});

test("Owner Repo retirement does not re-authorize repository lifecycle", async () => {
  const retiredValue = value({ lifecycle_state: "retired", repository_binding: null });
  const target = service({
    after: projection({ revision: "catalog-version-2", values: [retiredValue] }),
    before: projection({ values: [value({ usage_count: 0 })] }),
    mutateResult: result({ value: retiredValue }),
  });
  const retirement = request({
    mode: "retire",
    target_value_id: "owner-repo-oos",
    draft: { ...request().draft, repository_binding: null },
  });

  const output = await target.instance.mutate({
    callerId: "operator:workspace-owner",
    catalogItemId: "owner-repo",
    request: retirement,
  });

  assert.equal(output.value.lifecycle_state, "retired");
  assert.equal(target.calls.some((call) => call.operation === "readiness"), false);
});

test("Catalog backend conflicts are bounded without exposing backend detail", async () => {
  const target = createCatalogService({
    backendClient: {
      async project() { return projection(); },
      async mutate() {
        throw new CatalogUpstreamError(
          "private_backend_conflict",
          "internal table and account detail",
          { statusCode: 409 },
        );
      },
    },
    readinessClient: { async verifyCurrent(reference) { return reference; } },
  });

  await assert.rejects(
    target.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "catalog_conflict" &&
      error.statusCode === 409 &&
      !error.message.includes("internal table"),
  );
});
