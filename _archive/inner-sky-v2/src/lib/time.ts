const DEFAULT_TZ = "Asia/Jerusalem";

export function timezone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_TZ;
}

/** YYYY-MM-DD in the user's timezone. */
export function todayKey(now: Date = new Date(), tz: string = timezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function localHour(now: Date = new Date(), tz: string = timezone()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now);
  return Number(h) % 24;
}

export function weekday(now: Date = new Date(), tz: string = timezone()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function greeting(part: DayPart): string {
  switch (part) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    case "night":
      return "Still up";
  }
}

/** Israeli weekend is Friday + Saturday. */
export function isWeekend(day: string): boolean {
  return day === "Friday" || day === "Saturday";
}
