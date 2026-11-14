import { NowView } from "@/components/sky/NowView";
import { userName } from "@/lib/ai/context";
import { PALETTES, WEATHER_LABEL } from "@/lib/mood";
import { currentWeather } from "@/lib/moodState";
import { getCheckin } from "@/lib/repo/checkins";
import { buildSkyNodes } from "@/lib/sky/nodes";
import { dayPart, greeting, localHour, todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function NowPage() {
  const { weather, speed } = currentWeather();
  const palette = PALETTES[weather];
  const checkin = getCheckin(todayKey());
  const name = userName();

  return (
    <NowView
      nodes={buildSkyNodes()}
      greeting={`${greeting(dayPart(localHour()))}${name !== "friend" ? `, ${name}` : ""}.`}
      weatherLabel={WEATHER_LABEL[weather]}
      glow={palette.glow}
      ink={palette.ink}
      speed={speed}
      mood={checkin?.mood ?? null}
      energy={checkin?.energy ?? null}
    />
  );
}
