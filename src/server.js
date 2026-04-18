import http from "node:http";

import { createRuntime } from "./runtime.js";

const runtime = createRuntime();
const server = http.createServer(runtime.app);

server.listen(runtime.config.service.port, runtime.config.service.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event_type: "service.started",
      host: runtime.config.service.host,
      port: runtime.config.service.port,
      service: runtime.config.service.name,
      version: runtime.config.service.version,
      gitCommit: runtime.config.service.gitCommit,
    })}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
