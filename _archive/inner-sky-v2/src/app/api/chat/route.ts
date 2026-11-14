import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODEL, fallbackOpts, friendlyAiError, getClient } from "@/lib/ai/client";
import { buildSnapshotText } from "@/lib/ai/context";
import { EMBER_PERSONA } from "@/lib/ai/persona";
import { addMessage, recentMessages } from "@/lib/repo/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ message: z.string().trim().min(1).max(8000) });
const HISTORY_LIMIT = 30;
const MAX_CONTINUATIONS = 3;

type Msg = Anthropic.Beta.BetaMessageParam;

function webSearchTool(): Anthropic.Beta.BetaToolUnion {
  return {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
    user_location: { type: "approximate", city: "Ramat Gan", timezone: "Asia/Jerusalem" },
  };
}

export async function POST(req: Request): Promise<Response> {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ success: false, error: "Message is empty or too long." }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch (error) {
    return Response.json({ success: false, error: friendlyAiError(error) }, { status: 503 });
  }

  addMessage("user", parsed.data.message);
  const history: Msg[] = recentMessages(HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }));
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: EMBER_PERSONA, cache_control: { type: "ephemeral" } },
    { type: "text", text: `# Current state of the user's life\n\n${buildSnapshotText()}` },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      try {
        let messages = history;
        for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
          const s = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 64000,
            ...fallbackOpts(),
            system,
            tools: [webSearchTool()],
            output_config: { effort: "medium" },
            messages,
          });
          for await (const event of s) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullText += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            } else if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
              controller.enqueue(encoder.encode("\u0000searching\u0000"));
            }
          }
          const final = await s.finalMessage();
          if (final.stop_reason === "refusal") {
            const note = "\n\n_(I can't help with that one.)_";
            fullText += note;
            controller.enqueue(encoder.encode(note));
          }
          // Server-side web search may pause a long turn; resume it.
          if (final.stop_reason !== "pause_turn") break;
          messages = [...messages, { role: "assistant", content: final.content }];
        }
        if (fullText.trim()) addMessage("assistant", fullText.trim());
      } catch (error) {
        console.error("[chat] stream failed", error);
        controller.enqueue(encoder.encode(`\n\n${friendlyAiError(error)}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
