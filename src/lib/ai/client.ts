import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

/** On a safety refusal, the API transparently retries on a fallback model. */
export function fallbackOpts(): { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } {
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

let client: Anthropic | null = null;

export function hasAi(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient(): Anthropic {
  if (!hasAi()) {
    throw new AiUnavailableError();
  }
  client ??= new Anthropic();
  return client;
}

export class AiUnavailableError extends Error {
  constructor() {
    super("No Claude key is set (ANTHROPIC_API_KEY).");
    this.name = "AiUnavailableError";
  }
}
