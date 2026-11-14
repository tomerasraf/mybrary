import { MemoryBoard } from "@/components/Memories";
import { hasAi } from "@/lib/ai/client";
import { WEATHER_LABEL } from "@/lib/mood";
import { currentWeather } from "@/lib/moodState";
import { listRecentCheckins } from "@/lib/repo/checkins";
import { listEntries } from "@/lib/repo/diary";
import { countDoneSince } from "@/lib/repo/items";
import { listMemories } from "@/lib/repo/memories";
import { listPlaces } from "@/lib/repo/places";
import { todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

const DAYS = 14;

function lastNDays(today: string, n: number): string[] {
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

export default function MePage() {
  const today = todayKey();
  const days = lastNDays(today, DAYS);
  const checkins = new Map(listRecentCheckins(DAYS).map((c) => [c.date, c]));
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().replace("T", " ").slice(0, 19);
  const entriesThisWeek = listEntries(500).filter((e) => e.date >= days[DAYS - 7]).length;
  const explored = listPlaces().filter((p) => p.status !== "want").length;
  const { weather } = currentWeather();

  return (
    <div className="page">
      <header className="page-head">
        <h1>You, lately</h1>
        <p className="lede">Weather inside: {WEATHER_LABEL[weather].toLowerCase()}.</p>
      </header>

      <div className="figures">
        <p className="figure">
          <b>{countDoneSince(weekAgo)}</b>
          <span className="dim">steps done this week</span>
        </p>
        <p className="figure">
          <b>{entriesThisWeek}</b>
          <span className="dim">diary entries this week</span>
        </p>
        <p className="figure">
          <b>{explored}</b>
          <span className="dim">places explored</span>
        </p>
      </div>

      <section className="section" aria-labelledby="mood-title">
        <div className="section-head">
          <h2 id="mood-title">Mood, last two weeks</h2>
        </div>
        <div className="mood-strip" role="img" aria-label="Mood for each of the last 14 days">
          {days.map((d) => {
            const c = checkins.get(d);
            return (
              <div
                key={d}
                className={`mood-bar${c ? "" : " none"}`}
                style={{ height: c ? `${c.mood * 20}%` : "3%" }}
                title={c ? `${d}: mood ${c.mood}, energy ${c.energy}` : `${d}: no check-in`}
              />
            );
          })}
        </div>
        <div className="row small dim" style={{ justifyContent: "space-between" }}>
          <span>{days[0].slice(5).replace("-", "/")}</span>
          <span>today</span>
        </div>
      </section>

      <MemoryBoard memories={listMemories()} aiReady={hasAi()} />
    </div>
  );
}
