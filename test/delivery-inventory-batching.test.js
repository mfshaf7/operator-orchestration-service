import assert from "node:assert/strict";
import test from "node:test";
import { createOpenProjectClient } from "../src/openproject-client.js";

test("inventory batches at most 100 involved IDs, paginates and deduplicates both endpoints; failures remain failures", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1, lockVersion: 1, subject: `Inventory item ${index + 1}`, description: { raw: "## Scope\n\nSynthetic read-only inventory proof." },
    _links: { parent: { href: index ? "/api/v3/work_packages/1" : null },
      type: { title: index ? "Task" : "Epic" }, status: { title: "in-progress" } },
  }));
  const edges = [[1, 100, 101], [2, 101, 102]].map(([id, from, to]) => ({
    id, relationType: "follows", lag: 0,
    _links: { from: { href: `/api/v3/work_packages/${from}` }, to: { href: `/api/v3/work_packages/${to}` } },
  }));
  const batches = [];
  let fail = false;
  const response = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const client = createOpenProjectClient({ config: {
    apiToken: "synthetic", baseUrl: "http://openproject.test", deliveryProjectIdentifier: "workspace-delivery-art",
  }, fetchImpl: async (url, options) => {
    const u = new URL(url);
    if (/^\/api\/v3\/work_packages\/\d+$/.test(u.pathname)) {
      return response(rows.find(row => row.id === Number(u.pathname.split("/").at(-1))));
    }
    if (u.pathname === "/api/v3/projects/workspace-delivery-art/work_packages") {
      const page = Number(u.searchParams.get("offset"));
      const elements = rows.slice((page - 1) * 100, page * 100);
      return response({ _embedded: { elements }, count: elements.length, total: rows.length });
    }
    if (u.pathname.endsWith("/form")) {
      return response({ _embedded: { schema: { type: { _links: { allowedValues: [] } } } } });
    }
    if (u.pathname === "/api/v3/relations") {
      assert.equal(options.method, "GET");
      if (fail) return response({ errorIdentifier: "urn:openproject-org:api:v3:errors:Unauthorized" }, 403);
      const ids = JSON.parse(u.searchParams.get("filters"))[0].involved.values.map(Number);
      assert.ok(ids.length <= 100);
      batches.push(ids);
      const selected = edges.filter(edge => ids.some(id => Object.values(edge._links).some(link => link.href === `/api/v3/work_packages/${id}`)));
      const offset = Number(u.searchParams.get("offset"));
      const elements = selected.slice(offset - 1, offset); // Force real helper pagination.
      return response({ _embedded: { elements }, count: elements.length, total: selected.length });
    }
    throw new Error(`Unexpected inventory request ${options.method} ${u.pathname}`);
  } });
  const result = await client.listDeliveryInitiatives({});
  assert.equal(result.summary.dependency_count, 2);
  assert.ok(batches.length <= 4, "205 items must not cause 205 relation requests");
  assert.ok(batches.some(ids => ids.includes(100)) && batches.some(ids => ids.includes(101)));
  fail = true;
  await assert.rejects(client.listDeliveryInitiatives({}));
});
