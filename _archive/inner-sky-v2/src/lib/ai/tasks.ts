import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MEMORY_CATEGORIES } from "../repo/memories";
import { ROOM_IDS } from "../rooms";
import { MODEL, fallbackOpts, getClient } from "./client";
import { EMBER_PERSONA } from "./persona";

type Effort = "low" | "medium" | "high";

function systemBlocks(snapshot: string) {
  return [
    { type: "text" as const, text: EMBER_PERSONA, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `# Current state of the user's life\n\n${snapshot}` },
  ];
}

async function structured<T extends z.ZodType>(
  schema: T,
  snapshot: string,
  prompt: string,
  effort: Effort,
): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...fallbackOpts(),
    system: systemBlocks(snapshot),
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("Ember couldn't produce an answer for that. Try rephrasing.");
  }
  return response.parsed_output as z.infer<T>;
}

// ---------- Pull tasks out of a diary entry ----------

export const ExtractSchema = z.object({
  items: z.array(
    z.object({
      room: z.enum(ROOM_IDS).nullable().describe("Best-fit life room, or null if it truly fits none"),
      kind: z.enum(["task", "idea", "question"]),
      title: z.string().describe("Short, clear title (max ~10 words), in the user's language"),
      detail: z.string().describe("Extra context worth keeping, or empty string"),
    }),
  ),
  reply: z.string().describe("One short, warm line about what you pulled out (or that there was nothing actionable)"),
});
export type ExtractResult = z.infer<typeof ExtractSchema>;

export function extractTasks(entry: string, snapshot: string): Promise<ExtractResult> {
  return structured(
    ExtractSchema,
    snapshot,
    `Read this diary entry of mine and pull out only the concrete things I could act on: tasks, ideas worth keeping, open questions. File each into the right room. Don't invent anything I didn't say, and skip pure feelings — they stay in the diary. If nothing is actionable, return an empty list.

<diary_entry>
${entry}
</diary_entry>`,
    "low",
  );
}

// ---------- Reflection (learning about the user) ----------

export const ReflectSchema = z.object({
  add: z
    .array(
      z.object({
        fact: z.string().describe("One short insight about the user, phrased in third person"),
        category: z.enum(MEMORY_CATEGORIES),
      }),
    )
    .describe("New durable insights not already captured. Empty if nothing new."),
  removeIds: z.array(z.number().int()).describe("IDs of existing memories that are now outdated or wrong"),
  summary: z.string().describe("2-3 warm sentences to the user about what you noticed"),
});
export type ReflectResult = z.infer<typeof ReflectSchema>;

export function reflect(snapshot: string, conversation: string): Promise<ReflectResult> {
  return structured(
    ReflectSchema,
    snapshot,
    `Reflect on everything you know about me — diary entries, check-ins, what I'm doing and avoiding, our recent conversation — and update your long-term understanding of me: habits, beliefs (including limiting ones), preferences, goals, wins, struggles. Only add insights that are durable and useful for guiding me later; skip trivia and anything already captured. Remove memories that are clearly outdated.\n\n<recent_conversation>\n${conversation || "(none)"}\n</recent_conversation>`,
    "high",
  );
}
