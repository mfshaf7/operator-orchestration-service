import { inventoryDigest, inventoryError } from "./contracts.js";

const GENERATED = ["system-map.yaml", "resolved-owner-map.json", "resolved-dependency-graph.json",
  "stale-content-rules.json", "governance-engine-boundary-map.json", "console-operational-capabilities.json"]
  .map((name) => `generated/${name}`);

// This validates the private, owner-produced preparation. It does not accept a
// browser file map, turn arbitrary policy into data, or replace owner proof.
export function inventorySourceFiles(preparation) {
  const lifecycle = typeof preparation.history_text === "string";
  const pair = { [preparation.inventory_path]: preparation.inventory_text,
    [lifecycle ? "contracts/workspace-inventory-history.yaml" : "contracts/intake-register.yaml"]:
      lifecycle ? preparation.history_text : preparation.intake_text };
  if (!Object.hasOwn(preparation, "source_files")) return pair; // Retained pre-extension requests.
  const target = preparation.readback?.target;
  const allowed = new Set([...Object.keys(pair), ...GENERATED]);
  if (preparation.inventory_path === "contracts/repos.yaml" && target?.kind === "repo" &&
      /^[a-z0-9][a-z0-9._-]*$/.test(target.name)) {
    allowed.add(`contracts/repo-rules/${target.name}.yaml`);
    for (const name of ["AGENTS", "README", "ARCHITECTURE"]) allowed.add(`workspace-root/${name}.md`);
    allowed.add("contracts/context-behavior.yaml");
    allowed.add("contracts/raw-context-retirement.yaml");
  }
  const files = preparation.source_files;
  if (!files || typeof files !== "object" || Object.getPrototypeOf(files) !== Object.prototype || Object.keys(files).length > 20 ||
      Object.entries(pair).some(([name, text]) => typeof text !== "string" || files[name] !== text) ||
      Object.entries(files).some(([name, text]) => !allowed.has(name) || typeof text !== "string" || Buffer.byteLength(text) > 2 * 1024 * 1024) ||
      Object.values(files).reduce((size, text) => size + Buffer.byteLength(text), 0) > 4 * 1024 * 1024) {
    throw inventoryError("source_change_invalid", "Inventory source must contain its exact canonical pair and bounded owner-derived registration companions.");
  }
  return files;
}

export function inventorySourceDigest(preparation) {
  if (preparation.source_files) return inventoryDigest({ source_files: inventorySourceFiles(preparation) });
  return typeof preparation.history_text === "string"
    ? inventoryDigest({ inventory: preparation.inventory_text, history: preparation.history_text })
    : inventoryDigest({ intake: preparation.intake_text, inventory: preparation.inventory_text });
}
