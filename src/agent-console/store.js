import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { agentConsoleDigest, agentConsoleError } from "./contracts.js";

const emptyState = () => ({
  schema_version: 1,
  sessions: {},
  session_keys: {},
  invocation_keys: {},
  invocation_receipts: {},
  action_receipts: {},
});

export function createAgentConsoleStore({ root }) {
  const statePath = path.join(root, "state.json");
  let queue = Promise.resolve();

  async function initialize() {
    await mkdir(root, { recursive: true, mode: 0o700 });
  }

  async function load() {
    try {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const { digest, ...content } = state;
      if (
        state.schema_version !== 1 ||
        !state.sessions ||
        !state.session_keys ||
        !state.invocation_keys ||
        !state.invocation_receipts ||
        !state.action_receipts ||
        digest !== agentConsoleDigest(content)
      ) {
        throw new Error("integrity");
      }
      return content;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw agentConsoleError("storage_invalid", "Agent Console state failed integrity validation.", 503);
    }
  }

  async function save(state) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({ ...state, digest: agentConsoleDigest(state) })}\n`);
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, statePath);
      const directory = await open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (file) await file.close();
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async function transact(operation) {
    const prior = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      await initialize();
      const state = await load();
      const result = await operation(state);
      await save(state);
      return structuredClone(result);
    } finally {
      release();
    }
  }

  return {
    transact,
    async read(sessionId) {
      await initialize();
      return structuredClone((await load()).sessions[sessionId] ?? null);
    },
  };
}
