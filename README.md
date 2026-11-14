<p align="center">
  <img src="docs/media/banner.png" alt="MyBrary" width="100%">
</p>

<p align="center">
  Say what's on your mind. A little bird types it up,<br>
  and it floats away as a bubble.
</p>

<p align="center">
  <img src="docs/media/mybrary.gif" alt="Typing a thought, the bird carries it to the tube, and a bubble floats up" width="680">
</p>

<br>

## How it goes

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/media/step-1-write.jpg" alt="Writing a thought"><br><b>1 · Write it</b><br><sub>or just say it out loud</sub></td>
    <td align="center" width="33%"><img src="docs/media/step-2-bubble.jpg" alt="The thought becomes a bubble"><br><b>2 · Let it go</b><br><sub>it becomes a bubble</sub></td>
    <td align="center" width="33%"><img src="docs/media/step-3-bird.jpg" alt="The bird asks a question"><br><b>3 · The bird wonders</b><br><sub>tap its question to answer</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center" valign="top"><img src="docs/media/read.gif" alt="Tapping a bubble opens the thought" width="520"><br><sub>Tap any bubble to read it again.</sub></td>
    <td align="center" valign="top"><img src="docs/media/phone.jpg" alt="MyBrary on a phone" width="200"><br><sub>Works on your phone too.</sub></td>
  </tr>
</table>

<br>

## Get it running

You need [Node.js](https://nodejs.org) and [Ollama](https://ollama.com/download).

```bash
git clone https://github.com/tomerasraf/mybrary.git
cd mybrary
npm install
ollama pull qwen3:8b     # the bird's brain, about 5 GB
npm run dev
```

Open **http://localhost:3000** and write your first thought. 🫧

<details>
<summary><b>On your phone</b></summary>
<br>

1. Copy `.env.example` to `.env.local` and set an `APP_PASSCODE`, so nobody else on your Wi-Fi can get in.
2. Run `npm run dev:https` (the mic needs https).
3. On your phone, open `https://<your-computer's-ip>:3000`, accept the certificate warning once, and tap **Add to Home Screen**.

Voice works in Chrome, Edge and Safari.
</details>

<details>
<summary><b>Settings</b></summary>
<br>

All optional. Put them in `.env.local`.

| Setting | What it does |
| --- | --- |
| `APP_PASSCODE` | Asks for a passcode before opening |
| `OLLAMA_MODEL` | Give the bird another brain, e.g. `gemma3:12b` |
| `OLLAMA_THINK=true` | Slower, deeper questions |
| `ANTHROPIC_API_KEY` | Claude as a backup when Ollama is off |
| `MYBRARY_DB` | Where your bubbles are saved |
</details>

<br>

## Yours, and only yours

🏠 &nbsp;Your bubbles are saved on your own computer, in `data/`.<br>
🐦 &nbsp;The bird thinks on your computer too.<br>
🔒 &nbsp;Nothing you write is ever uploaded to git. Your keys aren't either.

<sub>If you add a Claude key and Ollama is off, the bird sends your bubbles to Claude to think. Chrome's voice typing uses Google's servers.</sub>

<br>

## Make it your own

Fork it, change it, give the bird a new hat. It's MIT licensed, so it's yours to play with.

<details>
<summary><b>Where things live</b></summary>
<br>

| Folder | |
| --- | --- |
| `src/world/` | The 3D world: the tube, the desk, the bird, the bubbles, the sounds |
| `src/components/` | The text box, voice input, the page you read |
| `src/lib/` | Saving thoughts, the bird's notebook, its brain |
| `_archive/` | An older version, kept for ideas |

```bash
npm test
npm run typecheck
```
</details>

<br>

<p align="center"><sub>Made with care · <a href="LICENSE">MIT</a></sub></p>
