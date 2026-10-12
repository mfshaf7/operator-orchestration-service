export function resolveProbeAuth(env, preferredCaller = null) {
  const allowed = (env.CALLER_ALLOWED_IDS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const caller = preferredCaller && allowed.includes(preferredCaller)
    ? preferredCaller
    : allowed[0];
  if (!caller) {
    throw new Error("No allowed caller id available in pod environment.");
  }

  let callerSecrets;
  try {
    callerSecrets = JSON.parse(env.CALLER_AUTH_SECRETS_JSON || "{}");
  } catch {
    throw new Error("CALLER_AUTH_SECRETS_JSON is invalid in pod environment.");
  }

  const secret = callerSecrets[caller] || env.CALLER_AUTH_SHARED_SECRET;
  if (!secret) {
    throw new Error(`No caller credential is available for ${caller}.`);
  }

  return { caller, secret };
}
