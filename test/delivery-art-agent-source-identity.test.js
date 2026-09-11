import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentSourceIdentityError,
  createAgentSourceIdentityAdapter,
} from "../src/delivery-art/agent-source-identity.js";

const CONTRACT = JSON.parse(readFileSync(
  new URL(
    "../contracts/delivery-art-work-session/agent-source-identity.json",
    import.meta.url,
  ),
  "utf8",
));
const NOW = new Date("2026-09-12T12:00:00Z");
const TOKEN = "test-installation-token-that-must-never-escape";

function git(cwd, ...args) {
  return String(execFileSync("git", args, { cwd, encoding: "utf8" }) ?? "").trim();
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "oos-agent-source-"));
  const repoRoot = path.join(root, "operator-orchestration-service");
  const credentialRoot = path.join(root, "runtime");
  mkdirSync(repoRoot);
  mkdirSync(credentialRoot, { mode: 0o700 });
  chmodSync(credentialRoot, 0o700);
  writeFileSync(path.join(credentialRoot, "projection.lock"), "", { mode: 0o600 });
  chmodSync(path.join(credentialRoot, "projection.lock"), 0o600);
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.name", "Bootstrap Human");
  git(repoRoot, "config", "user.email", "human@example.test");
  writeFileSync(path.join(repoRoot, "source.txt"), "base\n");
  git(repoRoot, "add", "source.txt");
  git(repoRoot, "commit", "-m", "Base");
  const base = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "switch", "-c", "feature/1137-agent-gary-oos-activation");
  const session = {
    landing_unit_id: "delivery-892-agent-gary-oos-activation",
    owner_repo: "operator-orchestration-service",
    covered_work_item_ids: ["work-item-1137"],
    landing_unit: {
      base_commit: base,
      base_ref: "origin/main",
      branch: "feature/1137-agent-gary-oos-activation",
    },
  };
  const sessionDigest = createHash("sha256")
    .update(session.landing_unit_id)
    .digest("hex")
    .slice(0, 24);
  const sessionRoot = path.join(credentialRoot, "sessions", sessionDigest);
  mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  chmodSync(sessionRoot, 0o700);
  const credentialPath = path.join(sessionRoot, "credential.json");
  const credential = {
    schema_version: 1,
    identity_id: CONTRACT.identity.identity_id,
    logical_agent_id: CONTRACT.identity.logical_agent_id,
    provider_principal: CONTRACT.identity.provider_principal,
    app_id: CONTRACT.identity.app_id,
    installation_id: CONTRACT.identity.installation_id,
    repository: "mfshaf7/operator-orchestration-service",
    repository_id: 1213863054,
    landing_unit_id: session.landing_unit_id,
    branch: session.landing_unit.branch,
    fetched_base: session.landing_unit.base_commit,
    human_reviewer_id: CONTRACT.identity.human_reviewer_id,
    token: TOKEN,
    token_expires_at: "2026-09-12T13:00:00Z",
  };
  function writeCredential(value = credential) {
    writeFileSync(credentialPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
  }
  writeCredential();
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    credential,
    credentialPath,
    credentialRoot,
    repoRoot,
    session,
    writeCredential,
  };
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(value); },
  };
}

function provider({ broadScope = false, principal = CONTRACT.identity.provider_principal } = {}) {
  const calls = [];
  let head = null;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      body: options.body ? JSON.parse(options.body) : null,
      method: options.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
    });
    assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
    if (parsed.pathname === "/installation/repositories") {
      const repositories = [{
        id: 1213863054,
        full_name: "mfshaf7/operator-orchestration-service",
      }];
      if (broadScope) repositories.push({ id: 1, full_name: "mfshaf7/other" });
      return response({ total_count: repositories.length, repositories });
    }
    if (parsed.pathname.includes("/git/ref/heads/")) {
      return response({ object: { sha: head } });
    }
    if (parsed.pathname.endsWith("/pulls") && options.method === "POST") {
      const body = JSON.parse(options.body);
      return response({
        number: 42,
        state: "open",
        draft: false,
        html_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/42",
        user: { login: principal },
        base: { ref: body.base },
        head: { sha: head },
      }, 201);
    }
    if (parsed.pathname.endsWith("/requested_reviewers")) return response({}, 201);
    if (parsed.pathname.endsWith("/pulls") || parsed.pathname.includes("/pulls?")) {
      return response([]);
    }
    throw new Error(`unexpected provider call: ${parsed.pathname}${parsed.search}`);
  };
  return {
    calls,
    fetchImpl,
    setHead(value) { head = value; },
  };
}

function testAdapter(fixture, providerFixture, overrides = {}) {
  const execFileSyncImpl = (executable, args, options) => {
    if (executable === "git" && args[0] === "push") return "ok";
    return execFileSync(executable, args, options);
  };
  return createAgentSourceIdentityAdapter({
    clock: () => NOW,
    credentialRoot: fixture.credentialRoot,
    enabled: true,
    execFileSyncImpl,
    fetchImpl: providerFixture.fetchImpl,
    lock: async (_path, operation) => operation(),
    ...overrides,
  });
}

test("Agent source prepares exact authorship and publishes one exact head for human review", async () => {
  const fixture = setup();
  const providerFixture = provider();
  try {
    const adapter = testAdapter(fixture, providerFixture);
    const before = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(before.state, "author-setup-required");
    assert.equal(JSON.stringify(before).includes(TOKEN), false);

    const prepared = await adapter.prepare({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(prepared.state, "author-ready");
    assert.equal(git(fixture.repoRoot, "config", "--local", "user.name"), "Agent Gary");
    assert.equal(
      git(fixture.repoRoot, "config", "--local", "user.email"),
      CONTRACT.identity.git_author_email,
    );

    writeFileSync(path.join(fixture.repoRoot, "source.txt"), "implemented\n");
    git(fixture.repoRoot, "add", "source.txt");
    git(fixture.repoRoot, "commit", "-m", "Activate Agent Gary source publishing");
    const head = git(fixture.repoRoot, "rev-parse", "HEAD");
    providerFixture.setHead(head);

    const result = await adapter.publish({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(result.state, "published");
    assert.equal(result.pushed_head, head);
    assert.equal(result.pull_request.author, "mfshaf7-agent-gary[bot]");
    assert.equal(result.human_reviewer_id, "mfshaf7");
    assert.equal(result.secret_values_embedded, false);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(providerFixture.calls.at(-1).body.reviewers[0], "mfshaf7");
  } finally {
    fixture.cleanup();
  }
});

test("Agent source re-reads rotation and revocation state without persisting token values", async () => {
  const fixture = setup();
  const providerFixture = provider();
  try {
    const adapter = testAdapter(fixture, providerFixture);
    const first = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(first.authorization_expires_at, "2026-09-12T13:00:00Z");
    assert.equal(Object.hasOwn(first, "token_expires_at"), false);
    fixture.writeCredential({
      ...fixture.credential,
      token_expires_at: "2026-09-12T14:00:00Z",
    });
    const rotated = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(rotated.authorization_expires_at, "2026-09-12T14:00:00Z");
    rmSync(fixture.credentialPath);
    const revoked = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(revoked.state, "credential-required");
    assert.equal(JSON.stringify([first, rotated, revoked]).includes(TOKEN), false);
  } finally {
    fixture.cleanup();
  }
});

test("Agent source requires and releases the real Platform projection lock", async () => {
  const fixture = setup();
  const providerFixture = provider();
  try {
    const adapter = createAgentSourceIdentityAdapter({
      clock: () => NOW,
      credentialRoot: fixture.credentialRoot,
      enabled: true,
      fetchImpl: providerFixture.fetchImpl,
    });
    const first = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(first.state, "author-setup-required");

    rmSync(path.join(fixture.credentialRoot, "projection.lock"));
    const missing = await adapter.inspect({ repoRoot: fixture.repoRoot, session: fixture.session });
    assert.equal(missing.state, "credential-required");
    assert.equal(missing.reason_code, "agent_source_projection_lock_missing");
    assert.equal(JSON.stringify([first, missing]).includes(TOKEN), false);
  } finally {
    fixture.cleanup();
  }
});

test("Agent source fails closed on expiry, suspension, binding drift, and broad provider scope", async () => {
  for (const scenario of ["expired", "suspended", "binding", "broad-scope"]) {
    const fixture = setup();
    const providerFixture = provider({ broadScope: scenario === "broad-scope" });
    try {
      const adapter = testAdapter(fixture, providerFixture);
      await adapter.prepare({ repoRoot: fixture.repoRoot, session: fixture.session });
      writeFileSync(path.join(fixture.repoRoot, "source.txt"), `${scenario}\n`);
      git(fixture.repoRoot, "add", "source.txt");
      git(fixture.repoRoot, "commit", "-m", `Exercise ${scenario}`);
      providerFixture.setHead(git(fixture.repoRoot, "rev-parse", "HEAD"));
      if (scenario === "expired") {
        fixture.writeCredential({ ...fixture.credential, token_expires_at: "2026-09-12T12:10:00Z" });
      } else if (scenario === "suspended") {
        writeFileSync(path.join(fixture.credentialRoot, "suspended"), "{}\n", { mode: 0o600 });
      } else if (scenario === "binding") {
        fixture.writeCredential({ ...fixture.credential, branch: "feature/wrong" });
      }
      await assert.rejects(
        adapter.publish({ repoRoot: fixture.repoRoot, session: fixture.session }),
        (error) => {
          assert.equal(error instanceof AgentSourceIdentityError, true);
          assert.equal(JSON.stringify(error).includes(TOKEN), false);
          return true;
        },
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("Agent source rejects human-authored source and non-human merge authority", async () => {
  const fixture = setup();
  const providerFixture = provider();
  try {
    writeFileSync(path.join(fixture.repoRoot, "source.txt"), "human change\n");
    git(fixture.repoRoot, "add", "source.txt");
    git(fixture.repoRoot, "commit", "-m", "Human-authored change");
    providerFixture.setHead(git(fixture.repoRoot, "rev-parse", "HEAD"));
    const adapter = testAdapter(fixture, providerFixture);
    await assert.rejects(
      adapter.publish({ repoRoot: fixture.repoRoot, session: fixture.session }),
      { code: "agent_source_commit_identity_mismatch" },
    );

    const mergeAdapter = testAdapter(fixture, providerFixture, {
      execFileSyncImpl(executable, args, options) {
        if (executable === "gh" && args[0] === "api") return "someone-else\n";
        return execFileSync(executable, args, options);
      },
    });
    assert.throws(
      () => mergeAdapter.assertHumanMergeAuthority({ repoRoot: fixture.repoRoot }),
      { code: "agent_source_human_merge_authority_mismatch" },
    );
  } finally {
    fixture.cleanup();
  }
});
