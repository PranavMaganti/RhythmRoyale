# Rhythm Royale

Hear a melody, play it back, outlast everyone. Originally an ICHACK 2022 submission.

## Game modes

- **Battle Royale**: up to 10 players share a lobby. After 15 seconds (or as soon as the lobby
  is full) any empty seats are filled with bots and the first melody plays. Everyone hears the
  same phrase, plays it back, and the least accurate ~30% are knocked out until one player is
  left. Knocked-out players can keep watching or requeue straight away.
- **Daily challenge**: five melodies per day, the same for everyone (seeded from the UTC date),
  easiest first, one attempt each. You get an emoji result card to share, a streak, and a
  percentile against everyone else who played that day.
- **Practice**: pick a level from 1 to 6 and replay as much as you like.

If the server can't be reached, the Battle Royale screen offers to play offline: the same match
engine runs in the browser against bots.

### Pitches

Each difficulty level adds a note to choose from, from a single tone at level 1 up to six at
level 6, while the rhythms get harder more slowly. A royale plans its rounds when it starts and
spreads the levels across them, so the first round is always one note and the final round
always uses all six.

The notes come from a major pentatonic scale (C D E G A C), so any combination sounds musical
and there are no semitone steps to confuse. When there are only a few notes they sit further
apart (two notes are an octave apart). Keys follow the home row, with the thumb on Space in the
middle:

| Notes | Keys          |
| ----- | ------------- |
| 1     | Space         |
| 2     | F J           |
| 3     | F Space J     |
| 4     | D F J K       |
| 5     | D F Space J K |
| 6     | S D F J K L   |

On touch screens each note gets its own coloured pad.

### A round

1. With more than one note, each note plays once from low to high while its pad lights up.
2. Four count-in clicks, then the melody plays once.
3. Four more clicks, then the player holds each note's key for as long as it sounded.

## Scoring

Scoring lives in `common/src/scoring.ts` and is shared by the browser, the server and the bots:

- Presses are aligned to the target with an order-preserving alignment, so one missed or extra
  note only costs that note.
- Each note earns credit for onset timing (75%) and held length (25%). Errors under ~35 ms
  count as perfect. The right timing on the wrong key keeps 30% of the note's credit.
- A constant offset is forgiven, so Bluetooth headphones or a slow device don't cost points.
- `100 × credit / max(target notes, pressed notes)`, so mashing keys doesn't help.

The server always recomputes scores from the raw presses (royale and daily leaderboard), so a
modified client can't just claim 100%.

## Bots

Bots go through the same scoring as people. `simulateAttempt` in `common/src/bots.ts` models
human-style mistakes: forgotten notes, notes on the wrong subdivision, stray presses, timing
jitter and wrong keys (usually a neighbouring one). These get more likely as phrases get
longer and there are more keys to choose from.

Bot skill follows a bell curve, like a real player base: most bots are middling and a few are
very strong or very weak (`BOT_SKILL_MEAN` 0.4, `BOT_SKILL_SD` 0.2). Skills are drawn one per
equal-probability slice of the curve rather than independently, so every lobby has the same
overall shape instead of occasionally getting three aces or none. With these settings, a
strong player wins most games and an average one wins sometimes. Bots are labelled as bots in
the results.

If every human in a match has been knocked out, the bots' remaining rounds are resolved
instantly instead of making people watch.

## Project layout

A pnpm workspace with three TypeScript (ES module) packages:

```
common/    Rhythm generation, scoring, bots, the match engine, daily seed, socket protocol
backend/   Express + Socket.IO server: matchmaking, daily leaderboard
frontend/  React + Vite app (Tone.js audio)
```

`common` is consumed from its TypeScript source during development, type-checking and tests
(the `source` export condition), so it only needs building for production.

Stack: Node 24, pnpm, TypeScript 7, Vite 8, React 19, React Router 8, Express 5, Socket.IO 4,
Tone.js 15, Vitest and Biome (lint + format).

## Running locally

Requires Node 22.22 or newer. pnpm is provided by Corepack (`corepack enable`).

```sh
pnpm install
pnpm dev              # server on :5000 and the app on http://localhost:5173
```

Checks and a production build:

```sh
pnpm lint             # Biome lint + format check (pnpm format to fix)
pnpm typecheck
pnpm test
pnpm build            # common, frontend, backend
pnpm start            # serves the built app and the API on http://localhost:5000
```

`pnpm build:offline` produces `frontend/dist-offline/index.html`, a single self-contained page
with Practice, Daily and Battle Royale against bots that works with no server at all.

### Deploying

See [DEPLOY.md](DEPLOY.md). Everything runs on one platform: Fly.io (`fly.toml`: the server
plus Fly Managed Postgres for the leaderboard) or Render (`render.yaml`: the server plus Render
Postgres), or anywhere else that runs the `Dockerfile`.

### Server configuration

| Variable         | Default | Meaning                                       |
| ---------------- | ------- | --------------------------------------------- |
| `DATABASE_URL`   | unset   | Daily leaderboard storage: `file:/path.db` (SQLite) or `postgres://…`; memory otherwise |
| `PORT`           | 5000    | HTTP port                                     |
| `MAX_PLAYERS`    | 10      | Seats per battle royale lobby                 |
| `LOBBY_WAIT_MS`  | 15000   | How long a lobby waits for people before bots |
| `BOT_SKILL_MEAN` | 0.4     | Average bot skill (0–1)                       |
| `BOT_SKILL_SD`   | 0.2     | Spread of bot skill                           |

The app talks to its own origin by default. Set `VITE_BACKEND_URL` at build time to host it
separately from the server.

### Tests against Postgres

The daily leaderboard tests always run against the in-memory and SQLite stores, and also
against Postgres when `TEST_DATABASE_URL` points at a disposable database (CI provides one):

```sh
docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres pnpm test
```

## Known limitations

- Matches live in the server's memory, so the server runs as a single instance and a restart
  ends matches in progress. Scaling out would need the Socket.IO Redis adapter and shared
  match state.
- There are no accounts: the daily leaderboard uses an anonymous per-browser token.
