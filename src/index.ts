import "./env.ts";
import { Spectrum } from "spectrum-ts";
import { localIMessage } from "@spectrum-ts/imessage-local";
import { getMessagesSince, insertMessage, pruneOlderThan, RETENTION_MS } from "./db.ts";
import { describeWindow, isSummarizeCommand, parseWindowMs } from "./parse.ts";
import { summarize } from "./summarize.ts";

const app = await Spectrum({ providers: [localIMessage.config()] });

const im = localIMessage(app);

// macOS mirrors a message sent from another device on the same account back
// into chat.db as an "incoming" row (prefixed with "echo: "). Without a guard
// the bot replies to its own replies forever. Remember what we send and ignore
// any inbound that matches it.
const ECHO_TTL_MS = 60_000;
const recentOutgoing: Array<{ text: string; ts: number }> = [];

function rememberOutgoing(text: string): void {
  const cutoff = Date.now() - ECHO_TTL_MS;
  while (recentOutgoing.length > 0 && (recentOutgoing[0]?.ts ?? Infinity) < cutoff) {
    recentOutgoing.shift();
  }
  recentOutgoing.push({ text: text.trim(), ts: Date.now() });
}

function isLoopbackEcho(text: string): boolean {
  const normalized = text.replace(/^\s*echo:\s*/i, "").trim();
  return recentOutgoing.some((entry) => entry.text === normalized);
}

const allowedSenders = new Set(
  (process.env.ALLOWED_SENDERS ?? "")
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean),
);

function isAllowed(senderId: string | null): boolean {
  return allowedSenders.size === 0 || (senderId !== null && allowedSenders.has(senderId));
}

if (allowedSenders.size === 0) {
  console.warn(
    "[safety] ALLOWED_SENDERS is empty — any group member can trigger a summary. " +
      "Set ALLOWED_SENDERS to a comma-separated list of handles to restrict who can.",
  );
}

type DmSpace = Awaited<ReturnType<typeof im.space.create>>;
const dmSpaces = new Map<string, Promise<DmSpace>>();

function getDmSpace(userId: string): Promise<DmSpace> {
  let pending = dmSpaces.get(userId);
  if (!pending) {
    pending = im.user(userId).then((user) => im.space.create(user));
    dmSpaces.set(userId, pending);
  }
  return pending;
}

type Sendable = { send: (content: string) => Promise<unknown> };

async function reply(space: Sendable, text: string): Promise<void> {
  rememberOutgoing(text);
  await space.send(text);
}

pruneOlderThan(Date.now() - RETENTION_MS);
setInterval(() => {
  const removed = pruneOlderThan(Date.now() - RETENTION_MS);
  if (removed > 0) {
    console.log(`[retention] pruned ${removed} message(s)`);
  }
}, 60 * 60 * 1000).unref();

for await (const [space, message] of app.messages) {
  try {
    if (message.direction === "outbound") continue;
    if (message.platform !== "local_imessage") continue;

    const imSpace = localIMessage(space);
    const senderId = message.sender?.id ?? null;
    console.log(
      `[inbound] space=${imSpace.id} type=${imSpace.type} content=${message.content.type} sender=${senderId ?? "?"}`,
    );
    if (!senderId) continue;

    if (imSpace.type === "dm") {
      if (message.content.type === "text" && !isLoopbackEcho(message.content.text)) {
        const dmText = message.content.text.trim().toLowerCase();
        await reply(
          space,
          dmText === "ping"
            ? "pong — the local summarizer is running."
            : 'I summarize group chats. In a group, say "summarize past 24 hours".',
        );
      }
      continue;
    }

    if (imSpace.type !== "group") continue;
    if (message.content.type !== "text") continue;

    const text = message.content.text;
    if (isLoopbackEcho(text)) continue;
    const ts = message.timestamp ? new Date(message.timestamp).getTime() : Date.now();

    insertMessage(space.id, senderId, text, ts);

    if (!isSummarizeCommand(text)) continue;

    if (!isAllowed(senderId)) {
      await reply(space, "This bot is restricted to approved senders.");
      continue;
    }

    if (!senderId) {
      await reply(space, "I can't tell who asked, so I can't DM the summary.");
      continue;
    }

    const requested = parseWindowMs(text);
    if (requested === null) {
      await reply(space, `Couldn't read that time window. Try "summarize past 24 hours".`);
      continue;
    }

    const windowMs = Math.min(requested, RETENTION_MS);
    const label = describeWindow(windowMs);
    const messages = getMessagesSince(space.id, Date.now() - windowMs);

    if (messages.length === 0) {
      await reply(space, `No messages in the last ${label} to summarize.`);
      continue;
    }

    await space.responding(async () => {
      const summary = await summarize(messages, label);
      const dm = await getDmSpace(senderId);
      await reply(dm, summary);
    });

    if (windowMs < requested) {
      await reply(
        space,
        `Note: only the last ${label} were summarized (older messages have been pruned).`,
      );
    }
  } catch (error) {
    console.error("[handler] failed to process message", error);
  }
}
