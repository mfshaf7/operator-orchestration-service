import { createHash } from "node:crypto";
import { canonicalStringify } from "./delivery-art/canonical-json.js";

// CGG wire envelopes use Python json.dumps(ensure_ascii=True). This encoding
// binds the wire contract only; ART custody and source text remain UTF-8.
export function cggContextDigest(value) {
  const wire = canonicalStringify(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `sha256:${createHash("sha256").update(wire).digest("hex")}`;
}
