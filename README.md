# Crystal Draft — SMITE 2

A two-captain pick-and-ban draft for the gods of SMITE 2. Same-screen play works offline. Online play uses a small WebSocket room server: share this site and a room code (or a join link).

Fan-made. Not affiliated with Hi-Rez or Titan Forge.

The site at [smite2-draft.onrender.com](https://smite2-draft.onrender.com) is the built `index.html`. Sources live in `src/`. The room server lives in `server/`. **Conquest map** opens `map.html`: the SmiteSource Conquest image with wards and drawings on top. It does not use the room server.

## Play

Open `index.html` (or the deployed site).

- **Same screen** — two captains, one browser. No server.
- **Draft history** — a finished draft gets an ID you can copy, replay, or paste. The ID itself holds the picks and bans, so it still works after the free room server sleeps.
- **Draft plans** — private role priorities (Solo, Jungle, Mid, Support, ADC) and a ban list, built from portraits. During a draft, attach one to your side. The advisor suggests the next god for each role and re-ranks on this screen when the other captain takes a planned god.
- **Aspects** — picked gods that have a SMITE 2 Aspect show a small yellow toggle on the portrait. The owning team (or either captain, on one screen) can turn it on during or after the draft. Online rooms sync it, and it is stored in the draft ID.
- **Create room** — you are Order. Copy the join link or read the room code to your rival.
- **Join room** — you are Chaos. Paste the code, or open a link like `https://smite2-draft.onrender.com/?room=CODE`.

The room server holds the draft. A captain can only lock a ban or pick on their own turn. A dropped tab reconnects to the same seat while the room is still in memory. Free hosting sleeps after inactivity and forgets rooms; the page shows **Waking the room server…** and retries instead of failing silently.

## Sounds

Synthesized crystal ticks, bans, picks, your-turn, rival-join, and disconnect cues. **Sound effects** in the top bar is off until ticked, and that choice is remembered in this browser. Ticking it unlocks audio and plays a short chime.

## Build

```bash
python3 src/build.py
```

That inlines `src/engine.js`, `src/app.js`, and the 95 portraits into `index.html`. Commit the rebuilt file so the static site stays in sync. The room-server URL is `DEFAULT_ROOM_SERVER` at the top of `src/app.js` (default `wss://smite2-draft-rooms.onrender.com`). Health checks use that same host at `/health`.

## Room server locally

```bash
cd server
npm install
npm start
```

Listens on `PORT` or **8787**, on `0.0.0.0`. `GET /health` returns `{"ok":true}`. Point a local page at it by setting `DEFAULT_ROOM_SERVER` to `ws://localhost:8787` and rebuilding.

## Tests

```bash
npm install
npm test
```

Node checks the draft engine, the built page in jsdom, and the room server (turn enforcement, two clients reaching the same final state, reconnect, idle cleanup).

## Render

**Static site** (already set up): publish path `./`, build command `echo static`, auto-deploy from `main`. No new env vars. Redeploy after `index.html` changes.

**Room server** — a second **Web Service**, free instance:

| Setting | Value |
|---|---|
| Name | `smite2-draft-rooms` (this becomes `wss://smite2-draft-rooms.onrender.com`) |
| Root directory | `server` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |
| Env vars | none (`PORT` is provided) |

If the service name differs, change `DEFAULT_ROOM_SERVER` in `src/app.js`, rebuild, and redeploy the static site. Do not append a path; the client derives `https://…/health` from the WebSocket origin.

Rooms are in memory. A sleeping free service drops them. Open tabs ping the server so an active draft keeps it awake.

Draft order presets and the roster are unchanged. See `RESEARCH-AND-REPORT.md`.
