import { HttpError } from "./errors.js";

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return "";
  }
  return baseUrl.trim().replace(/\/+$/, "");
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createWgcfArtReadinessClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    async evaluate({ context, operation, targetItemId }) {
      if (!normalizedBaseUrl) {
        throw new HttpError(
          503,
          "wgcf_art_readiness_not_configured",
          "WGCF ART readiness is required but WGCF_ART_READINESS_BASE_URL is not configured.",
        );
      }

      if (typeof fetchImpl !== "function") {
        throw new HttpError(
          503,
          "wgcf_art_readiness_fetch_unavailable",
          "WGCF ART readiness requires a fetch implementation.",
        );
      }

      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/v1/art/readiness`, {
          body: JSON.stringify({
            context,
            operation,
            target_item_id: targetItemId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
      } catch (error) {
        throw new HttpError(
          503,
          "wgcf_art_readiness_unavailable",
          `WGCF ART readiness request failed: ${error.message}`,
        );
      }
      const body = await readJsonResponse(response);

      if (!response.ok) {
        throw new HttpError(
          response.status || 502,
          "wgcf_art_readiness_unavailable",
          "WGCF ART readiness request failed.",
          body,
        );
      }

      const readiness = body?.readiness ?? body;
      if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
        throw new HttpError(
          502,
          "wgcf_art_readiness_invalid_response",
          "WGCF ART readiness returned an invalid response.",
          body,
        );
      }

      return readiness;
    },
  };
}
