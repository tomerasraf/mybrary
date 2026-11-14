import type { Metadata, Viewport } from "next";
import { Caveat, Familjen_Grotesk, Instrument_Serif } from "next/font/google";
import type { CSSProperties } from "react";
import { MoodSky } from "@/components/MoodSky";
import { Nav } from "@/components/Nav";
import { PALETTES, type Weather } from "@/lib/mood";
import { currentWeather } from "@/lib/moodState";
import "./globals.css";

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});
const familjen = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-familjen", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TimeFlow",
  description: "Your inner sky: diary, rooms, places and Ember.",
  appleWebApp: { capable: true, title: "TimeFlow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d1838",
};

/** Hue used to tint the map so it matches the mood. */
const MAP_HUE: Record<Weather, string> = {
  dusk: "220deg",
  ember: "-20deg",
  tide: "140deg",
  meadow: "60deg",
  bloom: "270deg",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { weather, speed } = currentWeather();
  const p = PALETTES[weather];
  const vars = {
    "--sky-top": p.skyTop,
    "--sky-bottom": p.skyBottom,
    "--glow": p.glow,
    "--spark": p.spark,
    "--ink": p.ink,
    "--dim": p.dim,
    "--map-hue": MAP_HUE[weather],
  } as CSSProperties;

  return (
    <html
      lang="en"
      data-weather={weather}
      style={vars}
      className={`${instrument.variable} ${familjen.variable} ${caveat.variable}`}
    >
      <body>
        <MoodSky palette={p} speed={speed} />
        <div className="shell">
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
