const IDEA_ID_PREFIX = "idea-";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeObjectMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, entry]) => {
    result[key] = entry;
    return result;
  }, {});
}

function omitNullishEntries(value) {
  return Object.entries(value).reduce((result, [key, entry]) => {
    if (
      entry !== null &&
      entry !== undefined &&
      (!(typeof entry === "object" && !Array.isArray(entry)) ||
        Object.keys(entry).length > 0)
    ) {
      result[key] = entry;
    }

    return result;
  }, {});
}

function toStableJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJson(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = toStableJson(value[key]);
        return result;
      }, {});
  }

  return value;
}

function pickLegacyValue(sourceRef, keys) {
  for (const key of keys) {
    const value = trimOptionalString(sourceRef[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeLegacyTelegramSource(surface, sourceRef) {
  const ref = normalizeObjectMap(sourceRef);
  const integrationId = pickLegacyValue(ref, ["integration_id", "accountId", "account_id"]);
  const conversationId = pickLegacyValue(ref, ["conversation_id", "chatId", "chat_id"]);
  const conversationType = pickLegacyValue(ref, [
    "conversation_type",
    "chatType",
    "chat_type",
  ]);
  const threadId = pickLegacyValue(ref, [
    "thread_id",
    "messageThreadId",
    "message_thread_id",
    "topicId",
    "topic_id",
  ]);
  const messageId = pickLegacyValue(ref, ["message_id", "messageId"]);
  const command = pickLegacyValue(ref, ["command"]);
  const nativeRef = { ...ref };

  delete nativeRef.integration_id;
  delete nativeRef.accountId;
  delete nativeRef.account_id;
  delete nativeRef.conversation_id;
  delete nativeRef.chatId;
  delete nativeRef.chat_id;
  delete nativeRef.conversation_type;
  delete nativeRef.chatType;
  delete nativeRef.chat_type;
  delete nativeRef.thread_id;
  delete nativeRef.messageThreadId;
  delete nativeRef.message_thread_id;
  delete nativeRef.topicId;
  delete nativeRef.topic_id;
  delete nativeRef.message_id;
  delete nativeRef.messageId;
  delete nativeRef.command;

  return normalizeSourceIdentity({
    context_ref: omitNullishEntries({
      conversation_id: conversationId,
      conversation_type: conversationType,
      thread_id: threadId,
    }),
    integration_id: integrationId,
    native_ref: omitNullishEntries({
      ...nativeRef,
      ...(messageId ? { message_id: messageId } : {}),
      ...(command ? { command } : {}),
    }),
    surface,
  });
}

export function toIdeaId(recordId) {
  return `${IDEA_ID_PREFIX}${recordId}`;
}

export function parseIdeaId(ideaId) {
  if (typeof ideaId !== "string" || !ideaId.startsWith(IDEA_ID_PREFIX)) {
    return null;
  }

  const parsed = Number.parseInt(ideaId.slice(IDEA_ID_PREFIX.length), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeSourceIdentity(value, legacySourceRef = null) {
  if (!isPlainObject(value)) {
    return normalizeLegacyTelegramSource("", legacySourceRef ?? {});
  }

  const surface = trimOptionalString(value.surface);

  if (surface) {
    if (
      legacySourceRef &&
      Object.keys(normalizeObjectMap(value.context_ref)).length === 0 &&
      Object.keys(normalizeObjectMap(value.native_ref)).length === 0 &&
      trimOptionalString(value.integration_id) === null
    ) {
      return normalizeLegacyTelegramSource(surface, legacySourceRef);
    }

    return omitNullishEntries({
      context_ref: normalizeObjectMap(value.context_ref),
      integration_id: trimOptionalString(value.integration_id),
      native_ref: normalizeObjectMap(value.native_ref),
      surface,
    });
  }

  return normalizeLegacyTelegramSource(
    trimOptionalString(value.surface) ?? "",
    legacySourceRef ?? value,
  );
}

export function serializeSourceIdentity(source) {
  return JSON.stringify(toStableJson(normalizeSourceIdentity(source)));
}

export function deserializeSourceIdentity(rawValue, fallbackSurface = "") {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return normalizeSourceIdentity({
      surface: fallbackSurface,
    });
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (isPlainObject(parsed) && trimOptionalString(parsed.surface)) {
      return normalizeSourceIdentity(parsed);
    }

    return normalizeLegacyTelegramSource(fallbackSurface, parsed);
  } catch {
    return normalizeSourceIdentity({
      native_ref: {
        raw: rawValue,
      },
      surface: fallbackSurface,
    });
  }
}
