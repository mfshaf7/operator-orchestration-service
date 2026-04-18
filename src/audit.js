export function createAuditLogger({
  sink = (line) => process.stdout.write(`${line}\n`),
  timestamp = () => new Date().toISOString(),
} = {}) {
  return {
    emit(event) {
      sink(
        JSON.stringify({
          ...event,
          timestamp: event.timestamp ?? timestamp(),
        }),
      );
    },
  };
}
