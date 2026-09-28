import {
  DAILY_DIFFICULTIES,
  dailyKey,
  DailyLeaderboard,
  dailyRhythms,
  DailyStanding,
  isDailyKey,
  scoreAttempt,
} from "@rhythm-royale/common";
import { sanitizeName } from "./names";

interface Entry {
  name: string;
  total: number;
  scores: number[];
}

const TOP_N = 10;

/**
 * In-memory daily leaderboard. Scores are recomputed on the server from the raw
 * taps so a modified client can't simply claim 500/500. Swap for a database to
 * survive restarts.
 */
export class DailyBoard {
  private readonly days = new Map<string, Map<string, Entry>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Today, plus yesterday for people who started just before midnight UTC. */
  acceptedDates(): string[] {
    const today = this.now();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return [dailyKey(today), dailyKey(yesterday)];
  }

  submit(body: unknown): DailyStanding | { error: string } {
    const { date, token, name, attempts } = (body ?? {}) as Record<string, unknown>;
    if (typeof date !== "string" || !isDailyKey(date) || !this.acceptedDates().includes(date)) {
      return { error: "That daily challenge is no longer open." };
    }
    if (typeof token !== "string" || token.length < 8 || token.length > 64) {
      return { error: "Missing player token." };
    }
    if (!Array.isArray(attempts) || attempts.length !== DAILY_DIFFICULTIES.length) {
      return { error: "Expected one attempt per rhythm." };
    }

    this.prune();
    let day = this.days.get(date);
    if (!day) {
      day = new Map();
      this.days.set(date, day);
    }
    // First attempt counts, like Wordle: resubmitting just returns the original standing.
    if (!day.has(token)) {
      const rhythms = dailyRhythms(date);
      const scores = rhythms.map((r, i) => scoreAttempt(r, attempts[i]).score);
      day.set(token, {
        name: sanitizeName(name),
        scores,
        total: scores.reduce((a, b) => a + b, 0),
      });
    }
    const entry = day.get(token) as Entry;
    const all = Array.from(day.values());
    const lower = all.filter((e) => e.total < entry.total).length;
    return {
      ...this.leaderboard(date),
      total: entry.total,
      scores: entry.scores,
      rank: all.filter((e) => e.total > entry.total).length + 1,
      percentile: all.length > 1 ? Math.round((100 * lower) / (all.length - 1)) : 100,
    };
  }

  leaderboard(date: string): DailyLeaderboard {
    const entries = Array.from(this.days.get(date)?.values() ?? []);
    return {
      date,
      players: entries.length,
      top: entries
        .sort((a, b) => b.total - a.total)
        .slice(0, TOP_N)
        .map(({ name, total }) => ({ name, total })),
    };
  }

  private prune(): void {
    const keep = this.acceptedDates();
    Array.from(this.days.keys())
      .filter((d) => !keep.includes(d))
      .forEach((d) => this.days.delete(d));
  }
}
