import Link from "next/link";
import { ItemRow } from "@/components/ItemRow";
import { listOpenItems } from "@/lib/repo/items";
import { getAllFocus } from "@/lib/repo/rooms";
import { ROOMS } from "@/lib/rooms";

export const dynamic = "force-dynamic";

export default function RoomsPage() {
  const items = listOpenItems();
  const focus = getAllFocus();
  const unsorted = items.filter((i) => i.room === null);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Rooms</h1>
        <p className="lede">Six parts of your life. Each one gets a focus and a single next step.</p>
      </header>

      <div className="room-orbit">
        {ROOMS.map((room) => {
          const roomItems = items.filter((i) => i.room === room.id);
          const next = roomItems.find((i) => i.isNext);
          const size = 46 + Math.min(roomItems.length, 10) * 4;
          return (
            <Link key={room.id} href={`/rooms/${room.id}`} className="room-link" style={{ ["--room" as string]: `var(${room.color})` }}>
              <span className="planet" style={{ ["--size" as string]: `${size}px` }} aria-hidden />
              <div className="stack" style={{ gap: 6 }}>
                <h2>{room.name}</h2>
                <p className="dim small">{focus[room.id] || room.tagline}</p>
                <p className="hand" style={{ color: "var(--room)" }}>
                  {next ? next.title : roomItems.length ? `${roomItems.length} open, no next step yet` : "nothing here yet"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {unsorted.length > 0 && (
        <section className="section" aria-labelledby="unsorted-title">
          <div className="section-head">
            <h2 id="unsorted-title">Still floating</h2>
            <span className="dim small">{unsorted.length} without a room</span>
          </div>
          <div>
            {unsorted.map((item) => (
              <ItemRow key={item.id} item={item} showMove />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
