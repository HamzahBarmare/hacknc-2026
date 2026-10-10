import OpenAI from "openai";
import type { StoredMessage } from "./db.ts";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const BASE_URL = process.env.OPENAI_BASE_URL;
const TIMEZONE = process.env.TIMEZONE;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(BASE_URL ? { baseURL: BASE_URL } : {}),
    });
  }
  return client;
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  ...(TIMEZONE ? { timeZone: TIMEZONE } : {}),
});

function formatTranscript(messages: StoredMessage[]): string {
  return messages
    .map((m) => `[${timeFormat.format(new Date(m.ts))}] ${m.sender ?? "unknown"}: ${m.text}`)
    .join("\n");
}

export async function summarize(messages: StoredMessage[], windowLabel: string): Promise<string> {
  const transcript = formatTranscript(messages);

  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You summarize group chat conversations. Produce a concise, neutral recap organized by topic, not by message order. " +
          "Note who raised each point where useful. Do not invent details. Keep it under 200 words.",
      },
      {
        role: "user",
        content: `Summarize this group chat from the last ${windowLabel}:\n\n${transcript}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || "Unable to generate a summary.";
}
