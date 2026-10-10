import "./env.ts";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { getMessagesSince, insertMessage, pruneOlderThan, RETENTION_MS } from "./db.ts";
import { describeWindow, isSummarizeCommand, parseWindowMs } from "./parse.ts";
import { summarize } from "./summarize.ts";

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

const im = imessage(app);

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
    if (message.platform !== "imessage") continue;

    const imSpace = imessage(space);
    console.log(
      `[inbound] space=${imSpace.id} type=${imSpace.type} content=${message.content.type} sender=${message.sender?.id ?? "?"}`,
    );

    if (imSpace.type === "dm") {
      if (message.content.type === "text") {
        const dmText = message.content.text.trim().toLowerCase();
        await space.send(
          dmText === "ping"
            ? "pong — I'm running on the shared line."
            : 'I\'m running. Add me to a group chat and say "summarize past 24 hours".',
        );
      }
      continue;
    }

    if (imSpace.type !== "group") continue;
    if (message.content.type !== "text") continue;

    const text = message.content.text;
    const senderId = message.sender?.id ?? null;
    const ts = message.timestamp ? new Date(message.timestamp).getTime() : Date.now();

    insertMessage(space.id, senderId, text, ts);

    if (!isSummarizeCommand(text)) continue;

    if (!senderId) {
      await space.send("I can't tell who asked, so I can't DM the summary.");
      continue;
    }

    const requested = parseWindowMs(text);
    if (requested === null) {
      await space.send(`Couldn't read that time window. Try "summarize past 24 hours".`);
      continue;
    }

    const windowMs = Math.min(requested, RETENTION_MS);
    const label = describeWindow(windowMs);
    const messages = getMessagesSince(space.id, Date.now() - windowMs);

    if (messages.length === 0) {
      await space.send(`No messages in the last ${label} to summarize.`);
      continue;
    }

    await space.responding(async () => {
      const summary = await summarize(messages, label);
      const dm = await getDmSpace(senderId);
      await dm.send(summary);
    });

    if (windowMs < requested) {
      await space.send(
        `Note: only the last ${label} were summarized (older messages have been pruned).`,
      );
    }
  } catch (error) {
    console.error("[handler] failed to process message", error);
  }
}
