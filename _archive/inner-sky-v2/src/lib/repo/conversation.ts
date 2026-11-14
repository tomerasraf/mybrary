import { getDb, type DB } from "../db";

export interface ChatMessage {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
}

interface Row {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

const toMsg = (r: Row): ChatMessage => ({
  id: r.id,
  role: r.role === "assistant" ? "assistant" : "user",
  content: r.content,
  createdAt: r.created_at,
});

export function addMessage(role: "user" | "assistant", content: string, db: DB = getDb()): ChatMessage {
  const info = db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run(role, content);
  return toMsg(db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as Row);
}

/** Most recent messages, oldest first. */
export function recentMessages(limit: number, db: DB = getDb()): ChatMessage[] {
  const rows = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit) as Row[];
  return rows.map(toMsg).reverse();
}

export function clearMessages(db: DB = getDb()): void {
  db.prepare("DELETE FROM messages").run();
}
