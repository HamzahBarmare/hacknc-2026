import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DB_PATH ?? "messages.db";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL,
    sender TEXT,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_space_ts ON messages (space_id, ts);
`);

export interface StoredMessage {
  sender: string | null;
  text: string;
  ts: number;
}

export function insertMessage(
  spaceId: string,
  sender: string | null,
  text: string,
  ts: number,
): void {
  db.prepare(
    "INSERT INTO messages (space_id, sender, text, ts) VALUES (?, ?, ?, ?)",
  ).run(spaceId, sender, text, ts);
}

export function getMessagesSince(spaceId: string, fromTs: number): StoredMessage[] {
  const rows = db
    .prepare(
      "SELECT sender, text, ts FROM messages WHERE space_id = ? AND ts >= ? ORDER BY ts ASC",
    )
    .all(spaceId, fromTs) as Array<{ sender: string | null; text: string; ts: number }>;
  return rows.map((row) => ({ sender: row.sender, text: row.text, ts: row.ts }));
}

export function pruneOlderThan(cutoffTs: number): number {
  const result = db
    .prepare("DELETE FROM messages WHERE ts < ?")
    .run(cutoffTs);
  return Number(result.changes);
}
