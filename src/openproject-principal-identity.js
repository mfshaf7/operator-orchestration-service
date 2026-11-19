import { assertCatalogProjectionResult } from "./catalog/contracts.js";

// Catalog supplies scoped login-to-identity bindings. Native forms separately
// decide whether that identity can be used on the particular work item.
export function catalogPrincipalBindings(projection) {
  assertCatalogProjectionResult(projection);
  if (projection.projection_status !== "ready") return [];
  const entries = projection.values
    .filter((value) => value.catalog_item_id === "catalog-principal-lookup" &&
      ["active", "read_only", "admitted"].includes(value.lifecycle_state))
    .flatMap((value) => (value.evidence_refs ?? []).flatMap((ref) => {
      const match = /^openproject:\/\/(users|groups|placeholder_users)\/([1-9][0-9]*)$/.exec(ref);
      return match ? [{ login: value.value_key, href: `/api/v3/${match[1]}/${match[2]}` }] : [];
    }));
  // An ambiguous alias or identity must not be resolved by list order.
  const byLogin = new Map();
  const byHref = new Map();
  for (const entry of entries) {
    if ((byLogin.has(entry.login) && byLogin.get(entry.login) !== entry.href) ||
        (byHref.has(entry.href) && byHref.get(entry.href) !== entry.login)) {
      throw new Error("Catalog principal identity is ambiguous.");
    }
    byLogin.set(entry.login, entry.href);
    byHref.set(entry.href, entry.login);
  }
  return [...byLogin].map(([login, href]) => ({ login, href }));
}

export function allowedPrincipalLink(allowedLinks, bindings, login) {
  const binding = bindings.find((entry) => entry.login === login);
  return binding ? [...allowedLinks.values()].find((link) => link.href === binding.href) ?? null : null;
}

export function principalLoginForLink(bindings, link) {
  return bindings.find((entry) => entry.href === link?.href)?.login ?? null;
}

export function allowedPrincipalLogins(allowedLinks, bindings) {
  const hrefs = new Set([...allowedLinks.values()].map((link) => link.href));
  return [...new Set(bindings.filter((entry) => hrefs.has(entry.href)).map((entry) => entry.login))].sort();
}
