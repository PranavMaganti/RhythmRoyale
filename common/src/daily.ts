import { seededRng } from "./random";
import { generateRhythm, Rhythm } from "./rhythm";

/** Difficulty of each rhythm in the daily set, easiest first. */
export const DAILY_DIFFICULTIES = [1, 2, 3, 4, 5];
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily puzzle rolls over at midnight UTC so everyone shares the same one. */
export function dailyKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isDailyKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(`${key}T00:00:00Z`));
}

export function dailyNumber(key: string): number {
  return Math.floor((Date.parse(`${key}T00:00:00Z`) - DAILY_EPOCH) / DAY_MS) + 1;
}

export function msUntilNextDaily(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

export function dailyRhythms(key: string): Rhythm[] {
  const rng = seededRng(`rhythm-royale-daily:${key}`);
  return DAILY_DIFFICULTIES.map((difficulty) => generateRhythm(difficulty, rng));
}

export function scoreEmoji(score: number): string {
  if (score >= 85) return "🟩";
  if (score >= 60) return "🟨";
  return "🟥";
}

export function dailyShareText(key: string, scores: number[], url?: string): string {
  const total = scores.reduce((a, b) => a + b, 0);
  const lines = [
    `Rhythm Royale Daily #${dailyNumber(key)}`,
    `${scores.map(scoreEmoji).join("")} ${total}/${DAILY_DIFFICULTIES.length * 100}`,
  ];
  if (url) lines.push(url);
  return lines.join("\n");
}
