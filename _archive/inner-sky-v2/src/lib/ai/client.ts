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
    super("Ember is asleep — add ANTHROPIC_API_KEY to .env.local to wake the companion.");
    this.name = "AiUnavailableError";
  }
}

/** Turns SDK errors into a short, friendly message for the UI. */
export function friendlyAiError(error: unknown): string {
  if (error instanceof AiUnavailableError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "Your Claude API key was rejected — check .env.local.";
  if (error instanceof Anthropic.RateLimitError) return "Ember needs a short breather (rate limited). Try again in a minute.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude — are you online?";
  if (error instanceof Anthropic.BadRequestError) {
    const detail = (error.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `Claude rejected the request${detail ? `: ${detail.slice(0, 200)}` : ""}.`;
  }
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status ?? "unknown"}). Try again.`;
  return "Something went wrong talking to Ember.";
}
