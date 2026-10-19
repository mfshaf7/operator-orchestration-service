import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inventorySourceFiles, inventorySourceDigest } from "../src/workspace-inventory/source-files.js";
import { createWorkspaceInventoryGitHubClient } from "../src/workspace-inventory/provider-client.js";

function preparationFixture() {
  const preparation = { branch: `inventory/${"a".repeat(64)}`, base_commit: "1".repeat(40),
    inventory_path: "contracts/repos.yaml", inventory_text: "repos: {sample: {posture: active}}\n",
    intake_text: "repos: {}\n", readback: { target: { kind: "repo", name: "sample", record_id: "repo:sample" } } };
  preparation.source_files = { [preparation.inventory_path]: preparation.inventory_text,
    "contracts/intake-register.yaml": preparation.intake_text,
    "contracts/repo-rules/sample.yaml": "repo: sample\n",
    "workspace-root/AGENTS.md": "reviewed instructions and derived owner index\n",
    "contracts/context-behavior.yaml": "raw_model_projection: deny\n",
    "generated/resolved-owner-map.json": "{}\n" };
  preparation.content_digest = inventorySourceDigest(preparation);
  return preparation;
}

test("Inventory file family binds complete bytes and denies broad controls, substitution, overflow and downgrade", () => {
  const good = preparationFixture();
  assert.deepEqual(inventorySourceFiles(good), good.source_files);
  const changed = structuredClone(good);
  changed.source_files["workspace-root/AGENTS.md"] += "different index\n";
  assert.notEqual(inventorySourceDigest(changed), good.content_digest);
  for (const source_files of [null, false, [], {},
    { ...good.source_files, "scripts/control.py": "replace control" },
    { ...good.source_files, "contracts/repo-rules/other.yaml": "other owner" },
    { ...good.source_files, "contracts/intake-register.yaml": "substituted" },
    { ...good.source_files, "generated/system-map.yaml": "x".repeat(2 * 1024 * 1024 + 1) }]) {
    assert.throws(() => inventorySourceFiles({ ...good, source_files }));
  }
  const legacy = { ...good };
  delete legacy.source_files;
  assert.equal(Object.keys(inventorySourceFiles(legacy)).length, 2);
  const component = { ...good, inventory_path: "contracts/components.yaml" };
  assert.throws(() => inventorySourceFiles(component));
});

test("GitHub publishes every owner companion in one tree and verifies exact-head, modes and merged bytes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-registration-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_synthetic", { mode: 0o600 });
  for (const fault of [null, "extra-file", "executable", "truncated", "merged-missing", "merged-changed", "merged-mode"]) {
    await t.test(fault ?? "complete", async () => {
      const preparation = preparationFixture();
      const base = preparation.base_commit, head = "2".repeat(40), merge = "3".repeat(40), treeSha = "4".repeat(40);
      let created = false, branchCreated = false, merged = false, treeEntries = [], writes = 0;
      const client = createWorkspaceInventoryGitHubClient({ owner: "example", repositoryId: "123", tokenFile,
        fetchImpl: async (url, options) => {
          const route = new URL(url).pathname;
          const body = options.body ? JSON.parse(options.body) : null;
          if (options.method !== "GET") writes += 1;
          if (route === "/installation/repositories") return Response.json({ total_count: 1, repositories: [{ id: 123, full_name: "example/workspace-governance" }] });
          if (route.endsWith("/pulls") && options.method === "GET") return Response.json(created ? [{ number: 8 }] : []);
          if (route.endsWith("/pulls") && options.method === "POST") { created = true; return Response.json({ number: 8 }); }
          if (route.endsWith("/pulls/8")) return Response.json({ number: 8, html_url: "https://github.com/example/workspace-governance/pull/8", state: merged ? "closed" : "open", merged,
            merge_commit_sha: merged ? merge : null, merged_by: { type: "User" },
            base: { ref: "main", repo: { id: 123 } }, head: { ref: preparation.branch, sha: head, repo: { id: 123 } } });
          if (route.endsWith("/reviews")) return Response.json([{ state: "APPROVED", commit_id: head, user: { id: 1, type: "User" } }]);
          if (route.endsWith("/check-runs")) return Response.json({ total_count: 1, check_runs: [{ head_sha: head, status: "completed", conclusion: "success" }] });
          if (route.includes("/git/ref/heads/")) return route.endsWith("/main") || branchCreated
            ? Response.json({ object: { sha: route.endsWith("/main") ? base : head } }) : Response.json({}, { status: 404 });
          if (route.endsWith("/git/refs")) { branchCreated = true; return Response.json({ object: { sha: head } }); }
          if (route.endsWith("/git/blobs")) return Response.json({ sha: "5".repeat(40) });
          if (route.endsWith("/git/trees") && options.method === "POST") { treeEntries = body.tree; return Response.json({ sha: treeSha }); }
          if (route.includes("/git/trees/")) return Response.json({ truncated: fault === "truncated", tree: treeEntries.map((entry) => ({ ...entry,
            ...((fault === "executable" || (fault === "merged-mode" && merged)) && entry.path === "workspace-root/AGENTS.md" ? { mode: "100755" } : {}) })) });
          if (route.endsWith("/git/commits") && options.method === "POST") return Response.json({ sha: head });
          if (route.includes("/git/commits/")) return Response.json({ parents: [{ sha: base }], tree: { sha: treeSha } });
          if (route.includes(`/compare/${merge}...`)) return Response.json({ status: "identical" });
          if (route.includes("/compare/")) return Response.json({ total_commits: 1, files: [...Object.keys(preparation.source_files), ...(fault === "extra-file" ? ["scripts/control.py"] : [])].map((filename) => ({ filename })) });
          if (route.includes("/contents/")) {
            const name = route.split("/contents/")[1];
            if (merged && name === "workspace-root/AGENTS.md" && fault === "merged-missing") return Response.json({}, { status: 404 });
            const text = merged && name === "workspace-root/AGENTS.md" && fault === "merged-changed" ? "unreviewed instructions" : preparation.source_files[name];
            return Response.json({ encoding: "base64", content: Buffer.from(text).toString("base64") });
          }
          throw new Error(`Unexpected synthetic provider route: ${route}`);
        } });
      const run = () => client.prepareReview(preparation, { requestId: "request:sample", binding: "sha256:" + "a".repeat(64), target: preparation.readback.target });
      if (["extra-file", "executable", "truncated"].includes(fault)) {
        await assert.rejects(run());
        assert.equal(created, false);
        return;
      }
      const first = await run();
      assert.equal(first.head_commit, head);
      assert.deepEqual(treeEntries.map((entry) => entry.path).sort(), Object.keys(preparation.source_files).sort());
      const afterCreation = writes;
      await run();
      assert.equal(writes, afterCreation, "Recovery must not republish or duplicate a review");
      merged = true;
      const review = await client.review(8);
      const readback = () => client.readMergedFiles(review, preparation.inventory_path, preparation);
      if (fault) await assert.rejects(readback());
      else assert.deepEqual((await readback()).sourceFiles, preparation.source_files);
    });
  }
});
