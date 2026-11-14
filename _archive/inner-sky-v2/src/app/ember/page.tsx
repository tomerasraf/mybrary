import { Chat } from "@/components/Chat";
import { hasAi } from "@/lib/ai/client";
import { recentMessages } from "@/lib/repo/conversation";

export const dynamic = "force-dynamic";

export default async function EmberPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const initial = recentMessages(50).map((m) => ({ role: m.role, content: m.content }));

  return (
    <div className="page" style={{ maxWidth: 760, gap: 28 }}>
      <header className="page-head">
        <h1>Ember</h1>
      </header>
      <Chat initial={initial} starter={typeof q === "string" ? q.slice(0, 500) : ""} aiReady={hasAi()} />
    </div>
  );
}
