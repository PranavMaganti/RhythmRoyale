# Rhythm Royale

Hear a rhythm, tap it back, outlast everyone. Originally an ICHACK 2022 submission.

## Game modes

- **Battle Royale**: up to 10 players share a lobby. After 15 seconds (or as soon as the lobby
  is full) any empty seats are filled with bots and the first rhythm plays. Everyone hears the
  same phrase, plays it back, and the least accurate ~30% are knocked out. The rhythms get
  harder each round until one player is left. Knocked-out players can keep watching or requeue
  straight away.
- **Daily challenge**: five rhythms per day, the same for everyone (seeded from the UTC date),
  easiest first, one attempt each. You get an emoji result card to share, a streak, and a
  percentile against everyone else who played that day.
- **Practice**: pick a difficulty from 1 to 6 and replay as much as you like.

Each round goes like this: four count-in clicks, then the phrase plays once. Four more clicks,
then the player holds <kbd>Space</kbd> (or the on-screen pad on touch devices) for each note.

## Scoring

Scoring lives in `common/src/scoring.ts` and is shared by the browser, the server and the bots:

- Taps are aligned to the target with an order-preserving alignment, so one missed or extra
  note only costs that note.
- Each note earns credit for onset timing (75%) and held length (25%). Errors under ~35 ms
  count as perfect.
- A constant offset is forgiven, so Bluetooth headphones or a slow device don't cost points.
- `100 × credit / max(target notes, tapped notes)`, so spamming taps doesn't help.

The server always recomputes scores from the raw taps (royale and daily leaderboard), so a
modified client can't just claim 100%.

## Bots

Bots go through the same scoring as people. `simulateAttempt` in `common/src/bots.ts` models
human-style mistakes: forgotten notes, notes on the wrong subdivision, stray taps and timing
jitter. These get more likely as phrases get longer. Each lobby gets a spread of bot skill
levels (`BOT_SKILL_MIN`/`BOT_SKILL_MAX`, default 0.1–0.75). With that spread, a strong player
wins most games and an average one wins sometimes. Bots are labelled as bots in the results.

If every human in a match has been knocked out, the bots' remaining rounds are resolved
instantly instead of making people watch.

## Project layout

```
common/    Shared TypeScript: rhythm generation, scoring, bots, daily seed, socket protocol
backend/   Express + Socket.IO server: matchmaking, match state machine, daily leaderboard
frontend/  React app (Tone.js audio)
```

`backend` and `frontend` depend on `common` through `link:../common`, so `common` must be built
first. The root scripts handle that.

## Running locally

Requires Node 20 and Yarn 1.

```sh
yarn install          # installs every package and builds common
yarn dev:server       # API + sockets on http://localhost:5000
yarn dev:client       # React dev server on http://localhost:3000
```

Tests and a production build:

```sh
yarn test             # common + backend unit tests
yarn build            # common, frontend, backend
yarn start            # serves the built frontend and the API from one process
```

### Server configuration

| Variable        | Default | Meaning                                         |
| --------------- | ------- | ----------------------------------------------- |
| `PORT`          | 5000    | HTTP port                                       |
| `MAX_PLAYERS`   | 10      | Seats per battle royale lobby                   |
| `LOBBY_WAIT_MS` | 15000   | How long a lobby waits for people before bots   |
| `BOT_SKILL_MIN` | 0.1     | Weakest bot (0–1)                               |
| `BOT_SKILL_MAX` | 0.75    | Strongest bot (0–1)                             |

The frontend talks to the same origin in production. Set `REACT_APP_BACKEND_URL` at build time
to host it separately.

## Known limitations

- Matches and the daily leaderboard live in memory, so a restart clears them and the server
  can't be scaled horizontally yet. Moving the daily board to Redis or Postgres is the natural
  next step.
- There are no accounts: the daily leaderboard uses an anonymous per-browser token.
