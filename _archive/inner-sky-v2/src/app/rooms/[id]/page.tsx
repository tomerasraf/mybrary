import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemRow } from "@/components/ItemRow";
import { AddItem, FocusEditor } from "@/components/RoomEditors";
import { listRoomItems } from "@/lib/repo/items";
import { getRoomFocus } from "@/lib/repo/rooms";
import { getRoom } from "@/lib/rooms";

export const dynamic = "force-dynamic";

const ROOM_PROMPTS: Record<string, string> = {
  love: "Help me plan one way to meet new people this week in Gush Dan.",
  body: "Give me a simple 3-day beginner strength routine I can start this week.",
  kitchen: "What's a good first recipe to learn, and what do I need to buy?",
  home: "Suggest 3 affordable things that would make my apartment feel cozier.",
  game: "Help me define the smallest version of my game I could ship on Steam.",
  money: "Teach me the first 3 things to understand before investing in Israel.",
};

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = getRoom(id);
  if (!room) notFound();

  const items = listRoomItems(room.id);
  const open = items.filter((i) => i.status === "open");
  const done = items.filter((i) => i.status === "done");

  return (
    <div className="page" style={{ ["--room" as string]: `var(${room.color})` }}>
      <header className="page-head">
        <Link href="/rooms" className="dim small">
          All rooms
        </Link>
        <div className="row" style={{ gap: 22, flexWrap: "nowrap" }}>
          <span className="planet" style={{ ["--size" as string]: "72px" }} aria-hidden />
          <h1>{room.name}</h1>
        </div>
        <FocusEditor room={room.id} focus={getRoomFocus(room.id)} />
      </header>

      <div className="split">
        <section className="section" aria-labelledby="open-title">
          <div className="section-head">
            <h2 id="open-title">Steps</h2>
            <span className="dim small">✦ marks the next one</span>
          </div>
          <AddItem room={room.id} />
          <div>
            {open.length === 0 && <p className="empty">Nothing here yet. Add one small step.</p>}
            {open.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>

        <div className="stack" style={{ gap: 40 }}>
          <section className="section veil">
            <h3>Stuck here?</h3>
            <Link className="btn" style={{ whiteSpace: "normal", textAlign: "left" }} href={`/ember?q=${encodeURIComponent(ROOM_PROMPTS[room.id])}`}>
              Ask Ember: “{ROOM_PROMPTS[room.id]}”
            </Link>
          </section>
          {done.length > 0 && (
            <section className="section" aria-labelledby="done-title">
              <div className="section-head">
                <h2 id="done-title">Done</h2>
                <span className="dim small">{done.length}</span>
              </div>
              <div>
                {done.slice(0, 15).map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
