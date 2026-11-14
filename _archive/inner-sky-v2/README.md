# timeflow

Your inner sky. A private place for your diary, your goals, your city and **Ember**, a companion that learns you.
The whole app takes its colour and motion from how you feel.

## Start

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY, APP_PASSCODE, APP_USER_NAME
npm run dev                  # http://localhost:3000
```

**On your phone:** on the same Wi-Fi, open `http://<your-pc-ip>:3000` (find it with `ipconfig`), then use
"Add to Home Screen". Keep `APP_PASSCODE` set so nobody else on the network can get in.

## What's inside

| Page | What it is |
| --- | --- |
| **now** | A 3D constellation of everything you've put in: rooms as planets, your diary thoughts in your handwriting, steps orbiting their rooms, places on a map floor, and what Ember has learned about you as distant stars. Drag to turn it, tap a light to open it. Set mood and energy, or drop a thought into the sky. |
| **diary** | A sheet of paper. Write freely. Entries stay as you wrote them; **Pull out tasks** turns one into steps only when you ask. |
| **rooms** | Love & People, Body, Kitchen, Home, Game → Steam, Money. Each has one focus and one ✦ next step. |
| **places** | A real map of Gush Dan (OpenStreetMap). Search or tap to pin where you train, buy things, meet people. |
| **ember** | Chat with your companion. It reads your diary, rooms and check-ins, and can search the web for real places. |
| **me** | Mood over two weeks, what you've done, and everything Ember knows about you, which you can edit. |

### Mood weather

Your latest mood and energy (from today's check-in, or a recent diary entry) picks the palette and how fast the
sky moves:

| | low energy (1–2) | middle (3) | high energy (4–5) |
| --- | --- | --- | --- |
| **low mood (1–2)** | Fireplace | Fireplace | Restless tide |
| **neutral (3)** | Fireplace | Quiet dusk | Festival |
| **good mood (4–5)** | Garden night | Garden night | Festival |

With no recent check-in or diary mood, the sky is Quiet dusk.

The rules live in `src/lib/mood.ts`.

## Privacy

Everything is stored in `data/timeflow.db` (SQLite) on your machine. Text you send to Ember goes to the Claude API.
Map searches go to OpenStreetMap's Nominatim, and map tiles come from OpenStreetMap.

## Dev

```bash
npm test          # vitest
npm run typecheck
npm run build
```

Code map: `src/lib/repo/*` data · `src/lib/mood.ts` + `moodState.ts` mood weather · `src/lib/sky/*` constellation
layout and nodes · `src/components/sky/*` WebGL scene · `src/components/MoodSky.tsx` background shader ·
`src/components/places/*` map · `src/lib/ai/*` Ember · `src/app/actions.ts` validated server actions.
