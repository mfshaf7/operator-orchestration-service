import test from "node:test";
import assert from "node:assert/strict";

import { createIdeaService } from "../src/idea-service.js";

function createAudit() {
  const events = [];
  return {
    emit(event) {
      events.push(event);
    },
    events,
  };
}

test("listIdeas filters by canonical status across backend pages", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async listIdeas({ limit, offset }) {
      assert.equal(limit, 25);
      if (offset === 1) {
        return {
          count: 2,
          items: [
            {
              body: "Captured one",
              createdAt: "2026-04-19T00:00:00Z",
              ideaId: "idea-4",
              recordRef: "openproject://work_packages/4",
              source: { surface: "telegram" },
              status: "captured",
              title: "Captured one",
              updatedAt: "2026-04-19T00:00:00Z",
            },
            {
              body: "Parked one",
              createdAt: "2026-04-19T00:01:00Z",
              ideaId: "idea-3",
              recordRef: "openproject://work_packages/3",
              source: { surface: "telegram" },
              status: "parked",
              title: "Parked one",
              updatedAt: "2026-04-19T00:01:00Z",
            },
          ],
          limit,
          offset,
          total: 4,
        };
      }

      return {
        count: 2,
        items: [
          {
            body: "Captured two",
            createdAt: "2026-04-19T00:02:00Z",
            ideaId: "idea-2",
            recordRef: "openproject://work_packages/2",
            source: { surface: "telegram" },
            status: "captured",
            title: "Captured two",
            updatedAt: "2026-04-19T00:02:00Z",
          },
          {
            body: "Captured three",
            createdAt: "2026-04-19T00:03:00Z",
            ideaId: "idea-1",
            recordRef: "openproject://work_packages/1",
            source: { surface: "telegram" },
            status: "captured",
            title: "Captured three",
            updatedAt: "2026-04-19T00:03:00Z",
          },
        ],
        limit,
        offset,
        total: 4,
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  const result = await service.listIdeas({
    callerId: "openclaw-telegram-enhanced",
    correlationId: "corr-1",
    limit: 2,
    offset: 1,
    status: "captured",
  });

  assert.deepEqual(
    result.ideas.map((entry) => entry.idea_id),
    ["idea-4", "idea-2"],
  );
  assert.equal(result.page.count, 2);
  assert.equal(result.page.has_more, true);
  assert.equal(result.page.next_offset, 3);
  assert.equal(result.page.total, 3);
  assert.equal(audit.events.at(-1)?.status_filter, "captured");
});
