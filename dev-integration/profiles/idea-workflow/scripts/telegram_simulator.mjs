import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    result[key] = value;
    index += 1;
  }
  return result;
}

function readArg(args, ...names) {
  for (const name of names) {
    const value = args[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

const args = parseArgs(process.argv.slice(2));
const telegramRepo = process.env.DEVINT_OPENCLAW_TELEGRAM_ENHANCED_PATH?.trim();

if (!telegramRepo) {
  process.stderr.write("DEVINT_OPENCLAW_TELEGRAM_ENHANCED_PATH is required.\n");
  process.exit(1);
}

const moduleUrl = pathToFileURL(
  path.resolve(telegramRepo, "src/idea-capture-command.ts"),
).href;
const { captureIdeaThroughBroker } = await import(moduleUrl);

const response = await captureIdeaThroughBroker({
  accountId: readArg(args, "accountId", "account-id") ?? "devint-idea-workflow",
  chatType: readArg(args, "chatType", "chat-type") ?? "supergroup",
  messageId: Number.parseInt(readArg(args, "messageId", "message-id") ?? "9000", 10),
  rawArgs: readArg(args, "rawArgs", "raw-args") ?? "",
  senderId: readArg(args, "senderId", "sender-id") ?? "devint-operator",
  senderUsername: readArg(args, "senderUsername", "sender-username") ?? "devint_operator",
  telegramChatId: Number.parseInt(
    readArg(args, "telegramChatId", "telegram-chat-id") ?? "10001",
    10,
  ),
  ...(readArg(args, "telegramThreadId", "telegram-thread-id")
    ? {
        telegramThreadId: Number.parseInt(
          readArg(args, "telegramThreadId", "telegram-thread-id"),
          10,
        ),
      }
    : {}),
});

process.stdout.write(`${response.text}\n`);
if (response.isError) {
  process.exit(1);
}
