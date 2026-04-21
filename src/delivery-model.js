export function toDeliveryId(recordId) {
  return `delivery-${recordId}`;
}

export function parseDeliveryId(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim();
  const deliveryMatch = normalized.match(/^delivery-(\d+)$/);
  if (deliveryMatch) {
    return Number.parseInt(deliveryMatch[1], 10);
  }

  const numericMatch = normalized.match(/^(\d+)$/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1], 10);
  }

  return null;
}
