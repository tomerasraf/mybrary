import { nameKey } from "./ai/ground";
import type { DB } from "./db";

// What the bird knows for sure. Facts come from your own words ("Dana: my sister"), and rules are
// things you told the bird to do. Nothing here is a guess.

export interface Fact {
  id: number;
  kind: "fact" | "rule";
  /** The person, project or place (facts only). */
  name: string | null;
  body: string;
  thoughtId: number | null;
}

export const FACT_NAME_MAX = 40;
export const FACT_BODY_MAX = 160;
export const RULE_MAX = 200;
const FACTS_SHOWN = 40;
const RULES_SHOWN = 12;

interface Row {
  id: number;
  kind: string;
  name: string | null;
  body: string;
  thought_id: number | null;
}

const toFact = (r: Row): Fact => ({
  id: r.id,
  kind: r.kind === "rule" ? "rule" : "fact",
  name: r.name,
  body: r.body,
  thoughtId: r.thought_id,
});

const flat = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

/** Writes down what something is. A newer bubble's words replace what was there. */
export function learnFact(db: DB, name: string, what: string, thoughtId: number): void {
  const cleanName = flat(name, FACT_NAME_MAX);
  const body = flat(what, FACT_BODY_MAX);
  const key = nameKey(cleanName);
  if (!key || !body) return;
  db.prepare(
    `INSERT INTO facts (kind, key, name, body, thought_id) VALUES ('fact', ?, ?, ?, ?)
     ON CONFLICT (key) WHERE key IS NOT NULL DO UPDATE SET body = excluded.body, thought_id = excluded.thought_id`,
  ).run(key, cleanName, body, thoughtId);
}

/** Something you told the bird to do. */
export function learnRule(db: DB, rule: string, thoughtId: number): void {
  const body = flat(rule, RULE_MAX);
  if (!body) return;
  const same = db.prepare("SELECT id FROM facts WHERE kind = 'rule' AND lower(body) = lower(?)").get(body);
  if (!same) db.prepare("INSERT INTO facts (kind, body, thought_id) VALUES ('rule', ?, ?)").run(body, thoughtId);
}

export function listFacts(db: DB): Fact[] {
  const rows = db
    .prepare("SELECT * FROM (SELECT * FROM facts WHERE kind = 'fact' ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(FACTS_SHOWN) as Row[];
  return rows.map(toFact);
}

export function listRules(db: DB): Fact[] {
  const rows = db
    .prepare("SELECT * FROM (SELECT * FROM facts WHERE kind = 'rule' ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(RULES_SHOWN) as Row[];
  return rows.map(toFact);
}

/** Forgets what the bird learned from a bubble that's gone. */
export function forget(db: DB, thoughtId: number): void {
  db.prepare("DELETE FROM facts WHERE thought_id = ?").run(thoughtId);
}

/** The bird's knowledge, written out for its brain to read before it does anything. */
export function knowledgeText(db: DB): string {
  const facts = listFacts(db);
  const rules = listRules(db);
  const parts = [
    `<what_you_know note="facts from the person's own words">\n${
      facts.length ? facts.map((f) => `- ${f.name}: ${f.body}`).join("\n") : "(nothing yet)"
    }\n</what_you_know>`,
  ];
  if (rules.length) {
    parts.push(
      `<the_person_told_you note="always follow these">\n${rules.map((r) => `- ${r.body}`).join("\n")}\n</the_person_told_you>`,
    );
  }
  return parts.join("\n\n");
}

/** Forgets one thing, because you said it was wrong. */
export function forgetFact(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM facts WHERE id = ?").run(id).changes > 0;
}
