import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

export interface DailyEntry {
  name: string;
  total: number;
  scores: number[];
}

export interface DayStats {
  players: number;
  /** Players who scored strictly more / less than the given total. */
  higher: number;
  lower: number;
}

/** Where daily challenge results are kept. */
export interface DailyStore {
  readonly kind: "memory" | "postgres" | "sqlite";
  /**
   * Save `entry` unless this token already has one for `date` (the first
   * attempt counts), and return whichever entry is stored.
   */
  addFirst(date: string, token: string, entry: DailyEntry): Promise<DailyEntry>;
  stats(date: string, total: number): Promise<DayStats>;
  top(date: string, limit: number): Promise<Array<{ name: string; total: number }>>;
  /** Drop days that can no longer be played (only matters for memory). */
  prune(keepDates: string[]): Promise<void>;
  /** Throws if the store can't be reached. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Zero-setup store for development and single-instance hosting; lost on restart. */
export class MemoryDailyStore implements DailyStore {
  readonly kind = "memory";
  private readonly days = new Map<string, Map<string, DailyEntry>>();

  async addFirst(date: string, token: string, entry: DailyEntry): Promise<DailyEntry> {
    let day = this.days.get(date);
    if (!day) {
      day = new Map();
      this.days.set(date, day);
    }
    const existing = day.get(token);
    if (existing) return existing;
    day.set(token, entry);
    return entry;
  }

  async stats(date: string, total: number): Promise<DayStats> {
    const all = Array.from(this.days.get(date)?.values() ?? []);
    return {
      players: all.length,
      higher: all.filter((e) => e.total > total).length,
      lower: all.filter((e) => e.total < total).length,
    };
  }

  async top(date: string, limit: number): Promise<Array<{ name: string; total: number }>> {
    // Stable sort keeps earlier finishers ahead on ties, matching the SQL store.
    return Array.from(this.days.get(date)?.values() ?? [])
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map(({ name, total }) => ({ name, total }));
  }

  async prune(keepDates: string[]): Promise<void> {
    for (const date of Array.from(this.days.keys())) {
      if (!keepDates.includes(date)) this.days.delete(date);
    }
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

const SCHEMA_FILE = path.resolve(import.meta.dirname, "../sql/schema.sql");

function sslMode(url: string): false | "require" | "prefer" {
  const setting = process.env.DATABASE_SSL;
  if (setting === "false" || setting === "disable") return false;
  if (setting === "true" || setting === "require") return "require";
  // Hosted databases (Supabase, Neon...) use TLS; a host's private network
  // (Render's internal URL) may not; local databases usually don't.
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(host) ? false : "prefer";
}

/**
 * Postgres-backed store. Works with any Postgres, including Supabase through
 * its connection pooler, which doesn't support prepared statements.
 */
export class PostgresDailyStore implements DailyStore {
  readonly kind = "postgres";

  private constructor(private readonly sql: postgres.Sql) {}

  static async connect(url: string): Promise<PostgresDailyStore> {
    const sql = postgres(url, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_SIZE) || 5,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: sslMode(url),
      onnotice: () => {},
    });
    const store = new PostgresDailyStore(sql);
    // The database may still be starting (a fresh Render or Docker database,
    // or a restart), so retry for a while rather than crash on the first try.
    const attempts = Number(process.env.DATABASE_CONNECT_ATTEMPTS) || 10;
    for (let attempt = 1; ; attempt++) {
      try {
        await store.migrate();
        return store;
      } catch (err) {
        if (attempt >= attempts) {
          await sql.end({ timeout: 1 }).catch(() => undefined);
          throw err;
        }
        const waitMs = Math.min(10_000, 500 * 2 ** attempt);
        console.warn(
          `Database not ready (${(err as Error).message}); retrying in ${waitMs / 1000}s (${attempt}/${attempts})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private async migrate(): Promise<void> {
    await this.sql.unsafe(await fs.readFile(SCHEMA_FILE, "utf8"));
  }

  async addFirst(date: string, token: string, entry: DailyEntry): Promise<DailyEntry> {
    const inserted = await this.sql<DailyEntry[]>`
      insert into daily_scores (date, token, name, total, scores)
      values (${date}, ${token}, ${entry.name}, ${entry.total}, ${entry.scores}::smallint[])
      on conflict (date, token) do nothing
      returning name, total, scores`;
    if (inserted.length > 0) return inserted[0];
    const [existing] = await this.sql<DailyEntry[]>`
      select name, total, scores from daily_scores where date = ${date} and token = ${token}`;
    return existing;
  }

  async stats(date: string, total: number): Promise<DayStats> {
    const [row] = await this.sql<DayStats[]>`
      select
        count(*)::int as players,
        (count(*) filter (where total > ${total}))::int as higher,
        (count(*) filter (where total < ${total}))::int as lower
      from daily_scores
      where date = ${date}`;
    return row;
  }

  async top(date: string, limit: number): Promise<Array<{ name: string; total: number }>> {
    return this.sql<Array<{ name: string; total: number }>>`
      select name, total from daily_scores
      where date = ${date}
      order by total desc, created_at asc
      limit ${limit}`;
  }

  /** Past days are kept as history; nothing to prune. */
  async prune(): Promise<void> {}

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

const SQLITE_SCHEMA = `
  create table if not exists daily_scores (
    date text not null,
    token text not null,
    name text not null,
    total integer not null,
    scores text not null, -- JSON array of per-melody scores
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (date, token)
  );
  create index if not exists daily_scores_date_total_idx on daily_scores (date, total desc);
`;

interface SqliteRow {
  name: string;
  total: number;
  scores: string;
}

/**
 * SQLite file store, for a single server with a persistent disk (a Fly.io
 * volume, for example): no separate database service needed. Uses Node's
 * built-in SQLite, so there is nothing native to compile.
 */
export class SqliteDailyStore implements DailyStore {
  readonly kind = "sqlite";

  private constructor(private readonly db: DatabaseSync) {}

  static async open(file: string): Promise<SqliteDailyStore> {
    if (file !== ":memory:") await fs.mkdir(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    // WAL keeps reads fast while a write is in progress; wait rather than fail on a busy file.
    db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000;");
    db.exec(SQLITE_SCHEMA);
    return new SqliteDailyStore(db);
  }

  async addFirst(date: string, token: string, entry: DailyEntry): Promise<DailyEntry> {
    this.db
      .prepare(
        `insert into daily_scores (date, token, name, total, scores) values (?, ?, ?, ?, ?)
         on conflict (date, token) do nothing`,
      )
      .run(date, token, entry.name, entry.total, JSON.stringify(entry.scores));
    const row = this.db
      .prepare("select name, total, scores from daily_scores where date = ? and token = ?")
      .get(date, token) as unknown as SqliteRow;
    return { name: row.name, total: row.total, scores: JSON.parse(row.scores) };
  }

  async stats(date: string, total: number): Promise<DayStats> {
    return this.db
      .prepare(
        `select
           count(*) as players,
           coalesce(sum(total > ?), 0) as higher,
           coalesce(sum(total < ?), 0) as lower
         from daily_scores where date = ?`,
      )
      .get(total, total, date) as unknown as DayStats;
  }

  async top(date: string, limit: number): Promise<Array<{ name: string; total: number }>> {
    // rowid follows insertion order, so earlier finishers win ties.
    return this.db
      .prepare(
        `select name, total from daily_scores where date = ?
         order by total desc, rowid asc limit ?`,
      )
      .all(date, limit) as unknown as Array<{ name: string; total: number }>;
  }

  /** Past days are kept as history; nothing to prune. */
  async prune(): Promise<void> {}

  async ping(): Promise<void> {
    this.db.prepare("select 1").get();
  }

  async close(): Promise<void> {
    if (this.db.isOpen) this.db.close();
  }
}

/** `file:/data/x.db`, `file:///data/x.db` and `sqlite:./x.db` all name a file path. */
export function sqlitePath(url: string): string {
  const rest = url.replace(/^(file|sqlite):/, "");
  return rest.startsWith("//") ? rest.slice(2) : rest;
}

/**
 * Picks storage from DATABASE_URL: `postgres://…` for Postgres (Supabase,
 * Render, Neon…), `file:/path/to.db` for SQLite, unset for memory only.
 */
export async function createDailyStore(url = process.env.DATABASE_URL): Promise<DailyStore> {
  if (!url) return new MemoryDailyStore();
  if (/^postgres(ql)?:\/\//.test(url)) return PostgresDailyStore.connect(url);
  if (/^(file|sqlite):/.test(url)) return SqliteDailyStore.open(sqlitePath(url));
  throw new Error("DATABASE_URL must start with postgres://, postgresql://, file: or sqlite:");
}
