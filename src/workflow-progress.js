export async function persistWorkflowFailure({
  transaction,
  record,
  failure,
  clock,
}) {
  transaction.assertHeld();
  record.failure = failure;
  record.history.push({
    sequence: record.history.length + 1,
    at: clock().toISOString(),
    status: record.status,
    details: {
      failure_code: failure.code,
      retryable: failure.retryable,
    },
  });
  await transaction.put(record);
}
