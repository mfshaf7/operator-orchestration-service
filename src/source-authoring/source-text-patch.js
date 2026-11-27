import { createHash } from "node:crypto";

export const MAX_PATCH_FILE_BYTES = 256 * 1024;
export const MAX_PATCH_TEXT_BYTES = 16 * 1024;
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const validText = text => typeof text === "string" && text.isWellFormed() && !text.includes("\0");

export function validSourcePatch(operation) {
  const patch = operation.patch;
  return operation.action === "patch" && patch && Object.keys(patch).length === 2 &&
    Number.isSafeInteger(patch.offset_utf16) && patch.offset_utf16 >= 0 && patch.offset_utf16 <= MAX_PATCH_FILE_BYTES &&
    validText(patch.before) && validText(operation.content) && patch.before !== operation.content &&
    Buffer.byteLength(patch.before) <= MAX_PATCH_TEXT_BYTES &&
    Buffer.byteLength(operation.content) <= MAX_PATCH_TEXT_BYTES;
}

function patchError(code, message) {
  const error = new Error(message);
  error.code = `delivery_art_source_realization_${code}`;
  return error;
}

function decode(bytes) {
  if (bytes.length > MAX_PATCH_FILE_BYTES) throw patchError("patch_limit", "The file exceeds the section editor limit.");
  try {
    if (bytes.includes(0)) throw new Error("Binary content.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw patchError("context_unavailable", "The file is not valid UTF-8 source text.");
  }
}

export function applySourcePatch(bytes, operation) {
  if (!validSourcePatch(operation)) throw patchError("patch_limit", "Use a bounded text replacement for the selected section.");
  const original = decode(bytes);
  const { offset_utf16: offset, before } = operation.patch;
  if (digest(bytes) !== operation.expected_digest || offset + before.length > original.length ||
      original.slice(offset, offset + before.length) !== before) {
    throw patchError("source_drift", "The section no longer matches the approved source file.");
  }
  const replacement = original.slice(0, offset) + operation.content + original.slice(offset + before.length);
  if (!validText(replacement) || Buffer.byteLength(replacement) > MAX_PATCH_FILE_BYTES) {
    throw patchError("patch_limit", "The edited file exceeds the section editor limit.");
  }
  return replacement;
}

export function readSourceTextRegion(bytes, startLine) {
  const source = decode(bytes);
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [""];
  if (startLine > lines.length) throw patchError("patch_line_unavailable", "Choose a line within the source file.");
  const offset = lines.slice(0, startLine - 1).reduce((sum, line) => sum + line.length, 0);
  let content = "";
  let endLine = startLine - 1;
  for (const line of lines.slice(startLine - 1, startLine + 39)) {
    if (Buffer.byteLength(content) + Buffer.byteLength(line) > MAX_PATCH_TEXT_BYTES) break;
    content += line;
    endLine += 1;
  }
  if (endLine < startLine) throw patchError("patch_limit", "The selected line is too large for the section editor.");
  return { content, region: { start_line: startLine, end_line: endLine, total_lines: lines.length, offset_utf16: offset,
    baseline_digest: digest(bytes), baseline_bytes: bytes.length } };
}
