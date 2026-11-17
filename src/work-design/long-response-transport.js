import http from "node:http";
import https from "node:https";

/** A bounded JSON exchange without fetch's independent response-header timer. */
export async function workDesignJsonFetch(input, init = {}) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw Error("Unsupported Work Design upstream protocol.");
  return new Promise((resolve, reject) => {
    let submitted = false;
    const fail = error => {
      error.requestSubmitted = submitted;
      reject(error);
    };
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: init.method ?? "POST",
      headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.signal,
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 1_048_576) {
          response.destroy(Error("Work Design upstream response exceeds its bound."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("aborted", () => fail(Error("Work Design upstream response was interrupted.")));
      response.on("end", () => {
        const status = response.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status }));
      });
    });
    request.on("finish", () => { submitted = true; });
    request.on("error", fail);
    request.end(init.body);
  });
}
