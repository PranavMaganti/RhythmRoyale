import {
  DAILY_DIFFICULTIES,
  type DailyLeaderboard,
  type DailyStanding,
  dailyKey,
  dailyRhythms,
  isDailyKey,
  scoreAttempt,
} from "@rhythm-royale/common";
import type { DailyStore } from "./dailyStore.js";
import { sanitizeName } from "./names.js";

const TOP_N = 10;

/**
 * Daily challenge leaderboard. Scores are recomputed on the server from the
 * raw presses so a modified client can't simply claim 500/500.
 */
export class DailyBoard {
  constructor(
    private readonly store: DailyStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Today, plus yesterday for people who started just before midnight UTC. */
  acceptedDates(): string[] {
    const today = this.now();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return [dailyKey(today), dailyKey(yesterday)];
  }

  async submit(body: unknown): Promise<DailyStanding | { error: string }> {
    const { date, token, name, attempts } = (body ?? {}) as Record<string, unknown>;
    if (typeof date !== "string" || !isDailyKey(date) || !this.acceptedDates().includes(date)) {
      return { error: "That daily challenge is no longer open." };
    }
    if (typeof token !== "string" || token.length < 8 || token.length > 64) {
      return { error: "Missing player token." };
    }
    if (!Array.isArray(attempts) || attempts.length !== DAILY_DIFFICULTIES.length) {
      return { error: "Expected one attempt per melody." };
    }

    await this.store.prune(this.acceptedDates());
    const scores = dailyRhythms(date).map((r, i) => scoreAttempt(r, attempts[i]).score);
    // First attempt counts, like Wordle: resubmitting just returns the original standing.
    const entry = await this.store.addFirst(date, token, {
      name: sanitizeName(name),
      scores,
      total: scores.reduce((a, b) => a + b, 0),
    });
    const { players, higher, lower } = await this.store.stats(date, entry.total);
    return {
      date,
      players,
      top: await this.store.top(date, TOP_N),
      total: entry.total,
      scores: entry.scores,
      rank: higher + 1,
      percentile: players > 1 ? Math.round((100 * lower) / (players - 1)) : 100,
    };
  }

  async leaderboard(date: string): Promise<DailyLeaderboard> {
    const [{ players }, top] = await Promise.all([
      this.store.stats(date, 0),
      this.store.top(date, TOP_N),
    ]);
    return { date, players, top };
  }
}
