# Deploying Rhythm Royale

Rhythm Royale is one Node server. It runs the real-time matches over WebSockets,
serves the API and serves the web app. The daily leaderboard needs somewhere
to live, and everything can sit on a single platform:

| Option                    | What you get                                                        | Best for                      |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| **Fly.io** (recommended)  | One always-on machine plus a Fly Managed Postgres cluster for the leaderboard | Launch: managed backups, near your players |
| **Render**                | One Blueprint creates the server and a Render Postgres database     | Trying it out with no command line |

Both use the `Dockerfile`. The server picks its storage from `DATABASE_URL`:

- `file:/path/to.db` stores the leaderboard in SQLite.
- `postgres://…` stores it in any Postgres (Render, Supabase, Neon, Fly Managed Postgres…).
- Unset keeps it in memory, where it resets on restart.

## Run exactly one server instance

Matches live in the server's memory, so every player must reach the same
process. Both configs keep exactly one instance. One small machine handles on
the order of a thousand simultaneous players. Running several instances would
need the Socket.IO Redis adapter and shared match state, which is a future
step.

## Fly.io

Needs the [flyctl](https://fly.io/docs/flyctl/install/) command line and a Fly
account.

```sh
fly auth login
fly launch --no-deploy --copy-config --name <your-app-name>   # keeps fly.toml
fly mpg create --region lhr                                    # same region as fly.toml
fly mpg attach <cluster-id> -a <your-app-name>                 # sets DATABASE_URL
fly deploy
```

The game is then live at `https://<your-app-name>.fly.dev`.

- `fly mpg attach` stores the connection string as the `DATABASE_URL` secret.
  The server creates its table on first start.
- Set `primary_region` in `fly.toml` (and the `--region` above) near your
  players. `lhr` is London.
- Fly Managed Postgres handles backups; see `fly mpg --help`.
- Deploy again after changes with `fly deploy`.
- To use SQLite on a volume instead, create a volume, add a `[mounts]` section
  with `destination = "/data"` to `fly.toml`, and set
  `DATABASE_URL=file:/data/rhythm-royale.db`.

## Render

1. Push this repository to GitHub.
2. In [Render](https://render.com), choose **New > Blueprint** and select the
   repository.
3. Render reads `render.yaml`, creates the `rhythm-royale` web service and the
   `rhythm-royale-db` Postgres database, and connects them. There's nothing to
   paste.
4. The game is live at `https://rhythm-royale-xxxx.onrender.com`.

Both are on Render's free plans in `render.yaml`, which suit testing but not
launch:

- A free web service sleeps after 15 minutes without visitors, and the next
  visit takes up to a minute to wake it.
- Free Postgres databases are time-limited.

For launch, switch both `plan:` values to paid plans in `render.yaml` (or in
the dashboard). Check Render's pricing page for current limits.

## Using another database (optional)

Set `DATABASE_URL` to any Postgres connection string instead. The server
creates its table on first start, and `backend/sql/schema.sql` is safe to run
by hand.

- **Supabase**: in the project, click **Connect** and copy the **Session
  pooler** string, then put in your database password. The table is locked
  against Supabase's public API keys (row level security with no policies, and
  no grants for `anon` / `authenticated`), so only the game server can read or
  write scores.
- **Fly**: `fly secrets set DATABASE_URL=postgres://...`.

If the database is unreachable the game keeps running. Only the leaderboard
reports that it's unavailable, and it recovers by itself.

## Other hosts

The `Dockerfile` runs anywhere that runs containers. Expose port 8080 and set
`DATABASE_URL`. For SQLite, mount a persistent disk and point `DATABASE_URL` at
a file on it.

- **Railway**: create a service from the repo (it uses the Dockerfile), add a
  volume at `/data`, and set `DATABASE_URL=file:/data/rhythm-royale.db`.
- **Google Cloud Run**: it has no persistent disk, so use Postgres. Deploy with
  `--min-instances=1 --max-instances=1 --session-affinity --timeout=3600`.
- **Your own server**:

  ```sh
  docker build -t rhythm-royale .
  docker run -d -p 80:8080 -v rhythm-data:/data \
    -e DATABASE_URL=file:/data/rhythm-royale.db rhythm-royale
  ```

## Configuration

| Variable             | Default          | Meaning                                                          |
| -------------------- | ---------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`       | unset (memory)   | `file:/path.db` for SQLite, `postgres://…` for Postgres          |
| `DATABASE_SSL`       | auto             | Postgres only: `require` or `disable`; auto prefers TLS for non-local hosts |
| `DATABASE_POOL_SIZE` | 5                | Postgres only: maximum connections                               |
| `DATABASE_CONNECT_ATTEMPTS` | 10        | Postgres only: startup retries while the database comes up (about a minute) |
| `PORT`               | 8080 in Docker   | HTTP port                                                        |
| `MAX_PLAYERS`        | 10               | Seats per battle royale lobby                                    |
| `LOBBY_WAIT_MS`      | 15000            | How long a lobby waits for people before bots fill it            |
| `BOT_SKILL_MEAN`     | 0.4              | Average bot skill (0–1)                                          |
| `BOT_SKILL_SD`       | 0.2              | Spread of bot skill                                              |

## Check a deployment

Open `https://<your-host>/api/health`. The `database` field shows `sqlite` or
`postgres`:

- `memory` means `DATABASE_URL` isn't set.
- A value ending in `(unreachable)` means the connection string or network is
  wrong.

## Hosting the web app separately (optional)

The server already serves the app, so this is only needed if you want it on a
CDN such as Vercel or Netlify. Build it with the server's address:

```sh
VITE_BACKEND_URL=https://<your-server-host> pnpm --filter @rhythm-royale/frontend build
```

Deploy `frontend/dist`. Configure the host to serve `index.html` for unknown
paths so links like `/daily` work.

`pnpm build:offline` produces `frontend/dist-offline/index.html`: one file with
Practice, Daily and Battle Royale against bots that needs no server at all.
