# Deploying Rhythm Royale

Rhythm Royale is one Node server. It runs the real-time matches over WebSockets,
serves the API and serves the built web app. It can optionally use a Postgres
database for the daily leaderboard.

## Recommended setup

| Piece           | Use                                      | Why                                                               |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Database        | **Supabase** (Postgres)                  | Managed Postgres with a free tier, backups, and room to grow (accounts via Supabase Auth later). |
| Game server     | **Render** to try it, **Fly.io** for production | Both run long-lived containers with WebSockets. Render's free tier is the quickest start; Fly keeps the server always on and close to players. |

**Why the game server doesn't run on Supabase.** A match is a process that
stays alive for a few minutes. It holds WebSocket connections and runs round
timers. Supabase Edge Functions are short-lived request handlers, so they can't
host that. Supabase is used for what it's best at: the database.

Without a database the server still works. The leaderboard is kept in memory
and resets whenever the server restarts.

## 1. Create the database (Supabase)

1. Create a project at [supabase.com](https://supabase.com) and note the
   database password you choose.
2. Open the project, click **Connect**, and copy the **Session pooler**
   connection string. It works from every host, including those without IPv6.
   It looks like
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Put your database password in place of `[YOUR-PASSWORD]`.
3. That's all. The server creates its table on first start.
   (`backend/sql/schema.sql` is safe to run by hand in the SQL editor too.)

Security: players never talk to Supabase directly. The table has row level
security enabled with no policies, and the public `anon` / `authenticated`
roles have no grants. Your project's public API keys can't read or write
scores; only the game server (connecting as the database owner) can.

On the free plan Supabase pauses projects after about a week without
activity. The game keeps running if that happens; only the leaderboard
reports that it's unavailable until you restore the project.

## 2a. Deploy the server on Render (quickest)

1. Push this repository to GitHub.
2. In [Render](https://render.com), choose **New > Blueprint** and select the
   repository. Render reads `render.yaml`.
3. When asked for `DATABASE_URL`, paste the Supabase connection string.
4. Deploy. The game is live at `https://rhythm-royale-xxxx.onrender.com`.

On Render's free plan the server goes to sleep after 15 minutes without
visitors. The next visit takes up to a minute to wake it, so it's fine for
testing but not for launch. A paid instance stays awake.

## 2b. Deploy the server on Fly.io (production)

```sh
# Install flyctl: https://fly.io/docs/flyctl/install/
fly auth login
fly launch --no-deploy --copy-config --name <your-app-name>   # uses fly.toml
fly secrets set DATABASE_URL='postgresql://postgres.<ref>:<password>@...pooler.supabase.com:5432/postgres'
fly deploy
fly scale count 1
```

Set `primary_region` in `fly.toml` near your players (`lhr` is London). The
game is live at `https://<your-app-name>.fly.dev`.

## Other hosts

The `Dockerfile` runs anywhere that runs containers. Set `DATABASE_URL` and
expose port 8080.

- **Railway**: create a service from the repo; it uses the Dockerfile.
- **Google Cloud Run**: deploy with `--min-instances=1 --max-instances=1
  --session-affinity --timeout=3600` so WebSockets and matches survive.
- **Your own server**:
  `docker build -t rhythm-royale . && docker run -p 8080:8080 -e DATABASE_URL=... rhythm-royale`

## Run exactly one server instance

Matches live in the server's memory, so all players must reach the same
process. Keep one instance (the configs above do). One small instance handles
on the order of a thousand simultaneous players. Running several instances
would need the Socket.IO Redis adapter and shared match state, which is a
future step.

## Configuration

| Variable             | Default          | Meaning                                                          |
| -------------------- | ---------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`       | unset (memory)   | Postgres connection string for the daily leaderboard             |
| `DATABASE_SSL`       | auto             | `require` or `disable`; auto uses TLS for any non-local host     |
| `DATABASE_POOL_SIZE` | 5                | Maximum database connections                                     |
| `PORT`               | 8080 in Docker   | HTTP port                                                        |
| `MAX_PLAYERS`        | 10               | Seats per battle royale lobby                                    |
| `LOBBY_WAIT_MS`      | 15000            | How long a lobby waits for people before bots fill it            |
| `BOT_SKILL_MEAN`     | 0.4              | Average bot skill (0–1)                                          |
| `BOT_SKILL_SD`       | 0.2              | Spread of bot skill                                              |

## Check a deployment

Open `https://<your-host>/api/health`. It should show `"database":"postgres"`.
`"memory"` means `DATABASE_URL` isn't set, and `"postgres (unreachable)"` means
the connection string or network is wrong.

## Hosting the web app separately (optional)

The server already serves the app, so this is only needed if you want it on a
CDN such as Vercel or Netlify. Build it with the server's address:

```sh
VITE_BACKEND_URL=https://<your-server-host> pnpm --filter @rhythm-royale/frontend build
```

Deploy `frontend/dist`. Configure the host to serve `index.html` for unknown
paths so links like `/daily` work.

`pnpm build:offline` produces `frontend/dist-offline/index.html`: one file with
Practice, Daily and Battle Royale against bots that needs no server at all. You
can drop it on any static host.
