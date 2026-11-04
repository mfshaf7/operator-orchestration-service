// Internal synchronous-host bridge. Connection arrives over private stdin;
// argv, stderr and generic operation journals never contain its credential.
import { readFileSync } from "node:fs";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";

try {
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw) > 16384) throw new Error();
  const { kind, connection, selector } = JSON.parse(raw);
  const client = createPlatformOperationProviderClient(connection);
  if (!["authority", "checkout"].includes(kind)) throw new Error();
  const result = kind === "authority" ? await client.inspectSourceAuthority(selector) : await client.sourceCheckout(selector);
  const encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) > 65536) throw new Error();
  process.stdout.write(encoded);
} catch {
  process.stderr.write("Current internal source admission is unavailable.\n");
  process.exitCode = 1;
}
