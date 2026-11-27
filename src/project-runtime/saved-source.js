import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, createReadStream, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { syncPrivateDirectory } from "../persistence/private-file-transactions.js";
import { applySourcePatch, MAX_PATCH_FILE_BYTES } from "../source-authoring/source-text-patch.js";
import { projectSourceSnapshotSchema } from "./contracts.js";

const git = promisify(execFile);
const digest = /^sha256:[a-f0-9]{64}$/;
const regularModes = new Set(["100644", "100755"]);
const fail = (status, code, detail) => {
  throw new HttpError(status, `project_source_${code}`, detail);
};
const gitEnvironment = {
  PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ALLOW_PROTOCOL: "", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0",
};

function assertPath(value) {
  if (typeof value !== "string" || !value.isWellFormed() || !value ||
      /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === ".." ||
        part.toLowerCase() === ".git" || /[. ]$/.test(part))) {
    fail(409, "path_invalid", "The source contains a path that cannot be copied into an isolated project.");
  }
  return value;
}

async function streamObject(repository, file, receive) {
  const object = spawn("git", ["--no-replace-objects", "cat-file", "blob", file.object], {
    cwd: repository,
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const closed = new Promise(resolve => {
    object.once("error", () => resolve(null));
    object.once("close", resolve);
  });
  let size = 0;
  const objectHash = createHash("sha1").update(`blob ${file.size}\0`);
  try {
    for await (const bytes of object.stdout) {
      size += bytes.length;
      if (size > file.size) fail(409, "object_changed", "The pinned source object exceeds its recorded size.");
      objectHash.update(bytes);
      receive(bytes);
    }
    if (await closed !== 0 || size !== file.size || objectHash.digest("hex") !== file.object) {
      fail(409, "object_changed", "The pinned source object could not be verified.");
    }
  } finally {
    if (object.exitCode === null) object.kill();
    await closed;
  }
}

async function committedFiles(repository, base, roots, limits) {
  let output;
  try {
    const type = await git("git", ["--no-replace-objects", "cat-file", "-t", base], {
      cwd: repository, env: gitEnvironment,
    });
    if (type.stdout.trim() !== "commit") throw new Error("Expected the admitted commit object.");
    const result = await git("git", ["--no-replace-objects", "--literal-pathspecs", "ls-tree", "-rlz", "--full-tree", base, "--",
      ...roots.filter(root => root !== ".")], {
      cwd: repository, env: gitEnvironment, encoding: "buffer", maxBuffer: limits.max_tree_bytes,
    });
    output = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout);
  } catch {
    fail(409, "tree_unavailable", "The exact pinned source tree is unavailable or exceeds its admitted metadata bound.");
  }
  const files = new Map();
  for (const entry of output.split("\0")) {
    if (!entry) continue;
    const match = /^([0-7]+) (\w+) ([0-9a-f]{40}) +([0-9-]+)\t(.+)$/s.exec(entry);
    if (!match || match[2] !== "blob" || !regularModes.has(match[1])) {
      fail(409, "entry_unsupported", "The admitted project contains a link, submodule or other unsupported entry.");
    }
    const name = assertPath(match[5]);
    if (!roots.some(root => containsPath(root, name))) {
      fail(409, "outside_scope", "The pinned tree returned a path outside the admitted project roots.");
    }
    const size = Number(match[4]);
    if (!Number.isSafeInteger(size) || size < 0 || files.has(name)) {
      fail(409, "tree_invalid", "The pinned source tree contains invalid file metadata.");
    }
    files.set(name, { mode: match[1], object: match[3], size });
  }
  return files;
}

const containsPath = (root, name) => root === "." || root === name || name.startsWith(`${root}/`);

async function applySavedOverlay(repository, files, source, saved, roots) {
  if (source.kind === "committed") {
    if (saved !== null) fail(409, "draft_changed", "A committed source selection cannot have a saved overlay.");
    return;
  }
  const changeSet = saved?.change_set;
  if (!changeSet || source.revision !== saved.revision || source.change_set_digest !== canonicalDigest(changeSet) ||
      source.session_id !== changeSet.session_id || source.base_commit !== changeSet.base_commit ||
      !Array.isArray(changeSet.operations) || new Set(changeSet.operations.map(item => item.path)).size !== changeSet.operations.length) {
    fail(409, "draft_changed", "The acknowledged draft does not match the original source selection.");
  }
  for (const operation of changeSet.operations) {
    const name = assertPath(operation.path);
    if (!roots.some(root => containsPath(root, name))) {
      fail(409, "outside_scope", "The saved draft contains a file outside the admitted project roots.");
    }
    const previous = files.get(name);
    if (operation.action !== "patch" && Object.hasOwn(operation, "patch")) {
      fail(409, "draft_changed", "A whole-file operation cannot carry a saved section.");
    }
    if (operation.action === "patch") {
      if (!previous || previous.size > MAX_PATCH_FILE_BYTES) fail(409, "baseline_changed", "The saved section requires its bounded baseline file.");
      const chunks = [];
      let size = 0;
      await streamObject(repository, previous, bytes => {
        size += bytes.length;
        if (size > MAX_PATCH_FILE_BYTES) fail(409, "baseline_changed", "The saved section baseline is too large.");
        chunks.push(bytes);
      });
      let content;
      try { content = applySourcePatch(Buffer.concat(chunks, size), operation); }
      catch { fail(409, "draft_changed", "The saved section no longer matches its exact baseline."); }
      const bytes = Buffer.from(content);
      files.set(name, { mode: previous.mode, bytes, size: bytes.length });
      continue;
    }
    if (operation.action === "create") {
      if (previous || operation.expected_digest !== null) fail(409, "baseline_changed", "A saved create requires an absent baseline file.");
    } else if (["replace", "delete"].includes(operation.action) && previous && digest.test(operation.expected_digest ?? "")) {
      const baseline = createHash("sha256");
      await streamObject(repository, previous, bytes => baseline.update(bytes));
      if (`sha256:${baseline.digest("hex")}` !== operation.expected_digest) {
        fail(409, "baseline_changed", "The saved edit no longer matches its pinned baseline bytes.");
      }
    } else {
      fail(409, "baseline_changed", "The saved edit has no matching pinned baseline.");
    }
    if (operation.action === "delete") {
      if (operation.content !== null) fail(409, "draft_changed", "A saved deletion cannot carry replacement content.");
      files.delete(name);
    } else {
      if (typeof operation.content !== "string" || !operation.content.isWellFormed() || operation.content.includes("\0")) {
        fail(409, "draft_changed", "The saved replacement bytes are invalid.");
      }
      const bytes = Buffer.from(operation.content, "utf8");
      files.set(name, { mode: previous?.mode ?? "100644", bytes, size: bytes.length });
    }
  }
}

function assertPortableTree(files) {
  const names = new Map();
  for (const file of files.keys()) {
    const parts = file.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const name = parts.slice(0, depth).join("/");
      const key = name.normalize("NFC").toUpperCase().normalize("NFC");
      const previous = names.get(key);
      if ((previous !== undefined && previous !== name) || (depth < parts.length && files.has(name))) {
        fail(409, "path_collision", "Two source entries collide when copied into the same project.");
      }
      names.set(key, name);
    }
  }
}

async function writeBlob(directory, repository, entry) {
  const staged = path.join(directory, ".blob");
  const descriptor = openSync(staged, "wx", 0o600);
  const hash = createHash("sha256");
  const receive = bytes => {
    hash.update(bytes);
    writeFileSync(descriptor, bytes);
  };
  try {
    if (entry.bytes) receive(entry.bytes);
    else await streamObject(repository, entry, receive);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const id = hash.digest("hex");
  renameSync(staged, path.join(directory, id));
  return `sha256:${id}`;
}

async function verifyRetainedSnapshot(directory, manifest, expectedDigest, maxManifestBytes) {
  try {
    const manifestPath = path.join(directory, "manifest.json");
    const info = lstatSync(manifestPath);
    if (!info.isFile() || info.size > maxManifestBytes) throw new Error("Invalid manifest file.");
    const retained = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (canonicalDigest(retained) !== expectedDigest) throw new Error("Invalid manifest digest.");
    const blobs = new Map(manifest.files.map(file => [file.blob_digest, file.size]));
    for (const [blob, size] of blobs) {
      const file = path.join(directory, "blobs", blob.slice(7));
      const entry = lstatSync(file);
      if (!entry.isFile() || entry.size !== size) throw new Error("Invalid blob file.");
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(file)) hash.update(bytes);
      if (`sha256:${hash.digest("hex")}` !== blob) throw new Error("Invalid blob digest.");
    }
  } catch {
    fail(409, "snapshot_changed", "The retained snapshot manifest or referenced bytes are missing or changed.");
  }
}

function assertBinding(scope, source, setup, commandId, limits) {
  if (!projectSourceSnapshotSchema.scope(scope) || !projectSourceSnapshotSchema.source(source) ||
      !projectSourceSnapshotSchema.setup(setup) || typeof commandId !== "string" || !commandId ||
      !["max_files", "max_bytes", "max_tree_bytes"].every(key => Number.isSafeInteger(limits?.[key]) && limits[key] > 0)) {
    fail(409, "binding_invalid", "The source owner and runtime recipe must supply a complete pinned snapshot binding.");
  }
}

// Both filesystem roots and binding objects come from native source and
// setup authorities. The public command carries only their opaque references.
export async function captureSavedProjectSource({
  repository, snapshotRoot, scope, source, setup, commandId, limits, saved = null,
}) {
  assertBinding(scope, source, setup, commandId, limits);
  const appRoot = scope.app_root === "." ? "." : assertPath(scope.app_root);
  const dependencies = scope.dependency_paths.map(assertPath);
  const roots = appRoot === "." ? ["."] : [appRoot, ...dependencies];
  const files = await committedFiles(repository, source.base_commit, roots, limits);
  await applySavedOverlay(repository, files, source, saved, roots);
  for (const dependency of dependencies) {
    if (![...files.keys()].some(name => containsPath(dependency, name))) {
      fail(409, "dependency_missing", "A declared dependency is absent from the exact saved source.");
    }
  }
  assertPortableTree(files);
  const totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0);
  if (files.size > limits.max_files || !Number.isSafeInteger(totalBytes) || totalBytes > limits.max_bytes) {
    fail(413, "source_over_limit", "The project exceeds the selected recipe's file or byte limit.");
  }
  // Keep the staging directory in the snapshot volume so publish is atomic.
  const staged = mkdtempSync(path.join(snapshotRoot, ".capture-"));
  try {
    const blobRoot = path.join(staged, "blobs");
    mkdirSync(blobRoot, { mode: 0o700 });
    const manifest = {
      schema_version: 1, scope, source, setup, command_id: commandId, total_bytes: totalBytes, files: [],
    };
    for (const name of [...files.keys()].sort()) {
      const file = files.get(name);
      const blob = await writeBlob(blobRoot, repository, file);
      manifest.files.push({ path: name, type: "file", mode: file.mode, size: file.size, blob_digest: blob });
    }
    syncPrivateDirectory(blobRoot);
    if (!projectSourceSnapshotSchema.manifest(manifest)) {
      fail(409, "manifest_invalid", "The source manifest did not meet its exact owner contract.");
    }
    const manifestDigest = canonicalDigest(manifest);
    const id = manifestDigest.slice(7);
    const serialized = JSON.stringify(manifest);
    const manifestFile = path.join(staged, "manifest.json");
    const descriptor = openSync(manifestFile, "wx", 0o600);
    try {
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    syncPrivateDirectory(staged);
    const destination = path.join(snapshotRoot, id);
    try {
      if (existsSync(destination)) {
        await verifyRetainedSnapshot(destination, manifest, manifestDigest, Buffer.byteLength(serialized));
      } else {
        renameSync(staged, destination);
      }
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      await verifyRetainedSnapshot(destination, manifest, manifestDigest, Buffer.byteLength(serialized));
    }
    syncPrivateDirectory(snapshotRoot);
    return { snapshot_id: `project-source:${id}`, manifest_digest: manifestDigest };
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}
