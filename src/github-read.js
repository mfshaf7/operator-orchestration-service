import { HttpError } from "./errors.js";

export function githubReadHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function githubRetryAt(response, now = Date.now()) {
  const remaining = response.headers?.get?.("x-ratelimit-remaining");
  const retryAfter = response.headers?.get?.("retry-after");
  if (response.status !== 429 && !(response.status === 403 &&
      (remaining === "0" || retryAfter != null))) return null;

  const reset = remaining === "0" ? Number(response.headers?.get?.("x-ratelimit-reset")) * 1000 : 0;
  const delay = /^\d+$/.test(retryAfter ?? "") ? now + Number(retryAfter) * 1000 : 0;
  const times = [reset, delay].filter(value => Number.isFinite(value) && value > now && value <= 8.64e15);
  return times.length ? Math.max(...times) : now + 60_000;
}

export function githubReadThrottled(retryAt) {
  const time = new Date(retryAt).toISOString();
  return new HttpError(429, "github_read_throttled", `GitHub temporarily limited repository reads. Retry the same request after ${time}.`, { retry_at: time });
}

export function githubReadFailure(error) {
  if (!["github_read_throttled", "repository_owner_bootstrap_provider_throttled", "github_source_connection_required"].includes(error?.code)) return null;
  return { code: error.code, message: error.message, retryable: true };
}

export async function githubReadResponse(fetchImpl, url, { headers, signal, timeoutMs = 15_000, now }) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(timeoutMs),
    headers,
  });
  const retryAt = githubRetryAt(response, now);
  if (retryAt !== null) {
    await response.body?.cancel?.().catch(() => {});
    throw githubReadThrottled(retryAt);
  }
  return response;
}
