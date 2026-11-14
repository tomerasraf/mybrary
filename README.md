# timeflow

A quiet white place to untangle your mind.

Write or say what's on your mind. A little bird in round glasses types it up, carries the page to the
thought machine, and a bubble swells out of the tube in the middle of the world and floats up to join the
others. Tap any bubble to read it again. When you're not around, the bird wanders under your bubbles,
picks the ones that call to it, looks up at them and says what it notices. It keeps a notebook of what it
learns about you, so it gets to know you over days. When it asks you something, tap its question to answer;
your answer becomes a bubble too.

## Start

```bash
npm install
winget install Ollama.Ollama   # the bird's brain, runs on your machine
ollama pull qwen3:8b           # ~5 GB
cp .env.example .env.local     # set APP_PASSCODE (recommended); the bird's settings are optional
npm run dev                    # http://localhost:3000
```

**The bird's brain** is a local model run by [Ollama](https://ollama.com); nothing leaves your machine. Keep the
Ollama app running. To try another model, `ollama pull <name>` and set `OLLAMA_MODEL` (e.g. `gemma3:12b`, warmer
but slower on an 8 GB GPU). `OLLAMA_THINK=true` lets it think first: slightly deeper lines, 10-40s each. If `ANTHROPIC_API_KEY` is set, Claude is used as a backup when Ollama isn't available.
Without either, the bird still lives, it just sticks to its own little phrases.

**On your phone:** on the same Wi-Fi, open `http://<your-pc-ip>:3000` (find it with `ipconfig`) and "Add to
Home Screen". Keep `APP_PASSCODE` set so nobody else on the network can get in.

**Talking from your phone:** browsers only allow the microphone on `https` (or `localhost`). Run
`npm run dev:https` and open `https://<your-pc-ip>:3000`. The certificate is self-signed, so accept the
warning once. Voice uses the browser's own speech recognition: Chrome, Edge and Safari support it, Firefox
doesn't (the mic button hides itself there).

## How it's put together

| Where | What |
| --- | --- |
| `src/world/` | The three.js world: `tube.ts` (tube and thought machine), `desk.ts` (typewriter), `bird.ts` (the bird's body and moves), `brain.ts` (what the bird decides to do), `bubbles.ts` + `bubbleMaterial.ts` (soap bubbles), `sound.ts` (every sound, synthesized), `layout.ts` (where things float and how the bird walks around obstacles). |
| `src/components/` | React on top: the input box with voice (`Composer`, `useSpeech`), the opened bubble (`Reader`), the bird's speech (`BirdSpeech`). |
| `src/lib/` | SQLite storage for thoughts and the bird's notebook (`notebook.ts`), its canned lines, and its brain: `ai/ponder.ts` (what to ask) and `ai/llm.ts` (Ollama first, Claude as backup). |
| `_archive/inner-sky-v2/` | The previous version of the app, kept for reference. Not built. |

Thoughts live in `data/mind.db`. The previous version's data is still in `data/timeflow.db`, untouched.

## Privacy

Everything is stored on your machine, and by default the bird thinks with a model on your machine too. Only
if you set `ANTHROPIC_API_KEY` and the local model is unavailable are your bubbles and its notebook sent to the
Claude API. Voice recognition is done by your browser, which may use its
vendor's servers (Chrome does).

Nothing personal is ever committed: `.gitignore` keeps out the whole `data/` folder (your thoughts and the
bird's notebook), every `.env` file except `.env.example` (API keys, passcode), and local certificates.

## Fork it

TimeFlow is open source under the [MIT License](LICENSE). Use it, fork it, bend the idea into something of
your own. No permission needed.

## Dev

```bash
npm test          # unit tests
npm run typecheck
```
