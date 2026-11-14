import { DiaryPage, EntryView } from "@/components/Diary";
import { hasAi } from "@/lib/ai/client";
import { groupByDay, listEntries, searchEntries } from "@/lib/repo/diary";
import { seeded } from "@/lib/sky/layout";
import { todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

const PROMPTS = [
  "What's taking up space in your head right now?",
  "What happened today that you want to remember?",
  "What are you avoiding, and why?",
  "Who did you think about today?",
  "What would make tomorrow a little better?",
  "What felt good this week?",
];

function prettyDate(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export default async function Diary({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const today = todayKey();
  const entries = query ? searchEntries(query, 200) : listEntries(200);
  const prompt = PROMPTS[Math.floor(seeded(today)() * PROMPTS.length)];
  const aiReady = hasAi();

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="page-head">
        <h1>Diary</h1>
        <p className="lede">Write it down and let it go. Nothing here gets turned into tasks unless you ask.</p>
      </header>

      <DiaryPage prompt={prompt} />

      <section className="section" aria-label="Past entries">
        <form className="row" style={{ flexWrap: "nowrap" }} role="search">
          <input className="field" name="q" defaultValue={query} placeholder="Search what you wrote" aria-label="Search diary" />
          <button className="btn">Search</button>
        </form>
        {entries.length === 0 && (
          <p className="empty">{query ? `Nothing mentions "${query}".` : "Your first entry will appear here."}</p>
        )}
        {groupByDay(entries).map((day) => (
          <div className="day" key={day.date}>
            <h2 className="day-date">{prettyDate(day.date, today)}</h2>
            <div>
              {day.entries.map((e) => (
                <EntryView key={e.id} entry={e} aiReady={aiReady} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
