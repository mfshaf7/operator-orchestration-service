import { HttpError } from "../errors.js";

const login = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const decimal = /^[1-9][0-9]*$/;
const roles = ["metadata", "provisioning", "lifecycle"];
const binding = value => value && typeof value.uri === "string" && /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9/._:-]+$/.test(value.uri) && /^sha256:[a-f0-9]{64}$/.test(value.digest);
const invalid = () => new HttpError(503, "repository_connections_invalid", "The GitHub connection configuration is invalid. Reconnect the affected account.");

// Platform supplies verified installation metadata and purpose-separated grants.
// This object is server-only. Only projection() may cross the API boundary.
export function repositoryConnections(raw, { clock = () => new Date() } = {}) {
  if (raw === undefined || raw === "") return null;
  let value;
  try {
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 131_072) throw invalid();
    value = JSON.parse(raw);
    if (value.schema_version !== 1 || !Array.isArray(value.connections) || value.connections.length > 32 ||
        ![null, ...value.connections.map(item => item.id)].includes(value.default_connection_id)) throw invalid();
    const ids = new Set(), accounts = new Set(), accountIds = new Set();
    for (const item of value.connections) {
      if (!login.test(item.account) || item.id !== `github:${item.account.toLowerCase()}` ||
          !decimal.test(item.account_id) || !["personal", "organization"].includes(item.account_type) ||
          ids.has(item.id) || accounts.has(item.account.toLowerCase()) || accountIds.has(item.account_id) ||
          !item.grants || typeof item.grants !== "object" || Array.isArray(item.grants) ||
          Object.keys(item.grants).some(role => !roles.includes(role))) throw invalid();
      ids.add(item.id); accounts.add(item.account.toLowerCase()); accountIds.add(item.account_id);
      for (const [role, grant] of Object.entries(item.grants)) {
        if (!grant || typeof grant.token !== "string" || !grant.token.startsWith("ghs_") ||
            !decimal.test(grant.installation_id) || !binding(grant.credential_binding_ref) ||
            !Number.isFinite(Date.parse(grant.expires_at)) || role === "lifecycle" && !decimal.test(grant.repository_id)) throw invalid();
      }
    }
  } catch { throw invalid(); }
  const current = grant => Boolean(grant && Date.parse(grant.expires_at) > clock().getTime() + 30_000);
  return {
    projection() {
      return { schema_version: 1, default_connection_id: value.default_connection_id,
        connections: value.connections.map(item => ({ id: item.id, account: item.account, account_id: item.account_id,
          account_type: item.account_type, capabilities: Object.fromEntries(roles.map(role => [role, current(item.grants[role])])),
          credential_bindings: Object.fromEntries(roles.filter(role => current(item.grants[role])).map(role => [role, item.grants[role].credential_binding_ref])),
        })) };
    },
    resolve({ owner, role, credentialBindingRef, ownerScope }) {
      const item = value.connections.find(item => typeof owner === "string" && item.account.toLowerCase() === owner.toLowerCase());
      if (!item || ownerScope && item.account_type !== ownerScope) throw new HttpError(403,
        "repository_connection_account_denied", "This GitHub account is not connected for the requested operation.");
      const grant = item.grants[role];
      if (!current(grant)) throw new HttpError(503, "repository_connection_not_ready",
        "The selected GitHub account needs a current connection for this operation.");
      if (credentialBindingRef && (credentialBindingRef.uri !== grant.credential_binding_ref.uri || credentialBindingRef.digest !== grant.credential_binding_ref.digest)) {
        throw new HttpError(403, "repository_connection_binding_mismatch", "The approval belongs to a different GitHub connection.");
      }
      return { ...grant, account: item.account, accountId: item.account_id, accountType: item.account_type };
    },
    resolveBinding(role, reference, repositoryId) {
      const matches = value.connections.filter(item => item.grants[role]?.credential_binding_ref.uri === reference?.uri &&
        item.grants[role]?.credential_binding_ref.digest === reference?.digest);
      if (matches.length !== 1) throw new HttpError(403, "repository_connection_binding_mismatch", "This operation has no exact account-specific GitHub grant.");
      const grant = this.resolve({owner: matches[0].account, role, credentialBindingRef: reference});
      if (role === "lifecycle" && grant.repository_id !== repositoryId) throw new HttpError(403,
        "repository_connection_repository_denied", "This lifecycle connection is approved for a different repository.");
      return grant;
    },
  };
}
