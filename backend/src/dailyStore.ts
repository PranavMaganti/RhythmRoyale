import fs from "node:fs/promises";
import path from "node:path";
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
  readonly kind: "memory" | "postgres";
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

function sslMode(url: string): false | "require" {
  const setting = process.env.DATABASE_SSL;
  if (setting === "false" || setting === "disable") return false;
  if (setting === "true" || setting === "require") return "require";
  // Hosted databases (Supabase, Neon, Render...) expect TLS; local ones usually don't.
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(host) ? false : "require";
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
    await store.migrate();
    return store;
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

/** Postgres when DATABASE_URL is set, otherwise in memory. */
export async function createDailyStore(url = process.env.DATABASE_URL): Promise<DailyStore> {
  return url ? PostgresDailyStore.connect(url) : new MemoryDailyStore();
}
