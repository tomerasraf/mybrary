import Anthropic from "@anthropic-ai/sdk";
import { MODEL, fallbackOpts, getClient, hasAi } from "./client";

/** Where the bird's thoughts come from. Ollama runs on this machine; Claude is the optional backup. */
export type Provider = "ollama" | "claude";

export interface JsonRequest {
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** How adventurous the local model is (default 0.8). */
  temperature?: number;
  /** Think before answering (local thinking models only). Slow: for work nobody is waiting on. */
  think?: boolean;
  /** How long the local model may take (default 90s). */
  timeoutMs?: number;
}

export interface BrainConfig {
  primary: Provider;
  ollamaUrl: string;
  ollamaModel: string;
  /** Let thinking models think before answering: better lines, several times slower. */
  ollamaThink: boolean;
}

const OLLAMA_TIMEOUT_MS = 90_000;
const KEEP_ALIVE = "30m";
/** Room for a thinking model to think in, on top of its answer. */
const THINK_TOKENS = 2200;

export function brainConfig(env: Partial<Record<string, string | undefined>> = process.env): BrainConfig {
  return {
    primary: env.BIRD_BRAIN === "claude" ? "claude" : "ollama",
    ollamaUrl: (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL || "qwen3:8b",
    ollamaThink: env.OLLAMA_THINK === "true",
  };
}

/** Providers to try, in order. Claude is only included when a key is set. */
export function providerOrder(config: BrainConfig, claudeAvailable: boolean): Provider[] {
  const order: Provider[] = config.primary === "claude" ? ["claude", "ollama"] : ["ollama", "claude"];
  return order.filter((p) => p !== "claude" || claudeAvailable);
}

export class BrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainError";
  }
}

/** Removes a leftover <think> block and code fences that small models sometimes add around JSON. */
export function cleanJsonText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Asks the bird's brain for a JSON answer. Tries the local model first, then Claude if configured. */
export async function askJson(req: JsonRequest): Promise<{ value: unknown; provider: Provider }> {
  const config = brainConfig();
  const order = providerOrder(config, hasAi());
  let lastError: unknown = new BrainError("No brain is configured.");
  for (const provider of order) {
    try {
      const text = provider === "ollama" ? await ollamaJson(config, req) : await claudeJson(req);
      return { value: JSON.parse(cleanJsonText(text)), provider };
    } catch (error) {
      console.error(`[bird] ${provider} failed`, error);
      lastError = error;
    }
  }
  throw lastError;
}

// ---------- Ollama (local) ----------

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

async function ollamaChat(config: BrainConfig, req: JsonRequest, think: boolean | undefined): Promise<Response> {
  return fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(req.timeoutMs ?? OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      // Thinking models (qwen3) answer far faster with thinking off; the bird's lines are short.
      ...(think === undefined ? {} : { think }),
      format: req.schema,
      keep_alive: KEEP_ALIVE,
      options: { temperature: req.temperature ?? 0.8, num_predict: think ? THINK_TOKENS + (req.maxTokens ?? 400) : (req.maxTokens ?? 400), num_ctx: 8192 },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
  });
}

async function ollamaJson(config: BrainConfig, req: JsonRequest): Promise<string> {
  let res: Response;
  try {
    res = await ollamaChat(config, req, req.think ?? config.ollamaThink);
    // Models without a thinking mode reject the flag: ask again without it.
    if (res.status === 400 && /think/i.test(await res.clone().text())) res = await ollamaChat(config, req, undefined);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new BrainError("The local model took too long.");
    throw new BrainError(`Ollama isn't running at ${config.ollamaUrl}. Start the Ollama app.`);
  }
  const data = (await res.json().catch(() => ({}))) as OllamaChatResponse;
  if (res.status === 404) throw new BrainError(`The model isn't installed. Run: ollama pull ${config.ollamaModel}`);
  if (!res.ok) throw new BrainError(`Ollama error (${res.status}): ${(data.error ?? "unknown").slice(0, 200)}`);
  const text = data.message?.content?.trim();
  if (!text) throw new BrainError("The local model said nothing.");
  return text;
}

/** Loads the local model into memory so the bird's first thought isn't slow. Never throws. */
export async function warmUp(): Promise<boolean> {
  const config = brainConfig();
  if (config.primary !== "ollama") return false;
  try {
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      body: JSON.stringify({ model: config.ollamaModel, keep_alive: KEEP_ALIVE }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Claude (optional backup) ----------

async function claudeJson(req: JsonRequest): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    ...fallbackOpts(),
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
    messages: [{ role: "user", content: req.user }],
  });
  if (response.stop_reason === "refusal") throw new BrainError("Claude declined.");
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (!text) throw new BrainError("Claude said nothing.");
  return text;
}

/** A short, friendly message for whatever went wrong. */
export function friendlyBrainError(error: unknown): string {
  if (error instanceof BrainError) return error.message;
  if (error instanceof SyntaxError) return "The bird's thought came out garbled.";
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status ?? "unknown"}).`;
  return "Something went wrong while the bird was thinking.";
}
