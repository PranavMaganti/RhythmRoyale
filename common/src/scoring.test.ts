import { simulateAttempt } from "./bots";
import { seededRng } from "./random";
import { generateRhythm, Note, Rhythm } from "./rhythm";
import { sanitizeNotes, scoreAttempt } from "./scoring";

const rhythm: Rhythm = {
  bpm: 120,
  beats: 4,
  notes: [
    { start: 0, duration: 250 },
    { start: 500, duration: 250 },
    { start: 1000, duration: 500 },
    { start: 1750, duration: 250 },
  ],
};

const shift = (notes: Note[], ms: number): Note[] =>
  notes.map((n) => ({ ...n, start: n.start + ms }));

describe("scoreAttempt", () => {
  test("a perfect attempt scores 100", () => {
    const result = scoreAttempt(rhythm, rhythm.notes);
    expect(result.score).toBe(100);
    expect(result.misses).toBe(0);
    expect(result.extras).toBe(0);
  });

  test("an empty attempt scores 0", () => {
    expect(scoreAttempt(rhythm, []).score).toBe(0);
    expect(scoreAttempt(rhythm, []).misses).toBe(4);
  });

  test("small human jitter is still perfect", () => {
    const jittered = rhythm.notes.map((n, i) => ({
      start: n.start + (i % 2 ? 25 : -25),
      duration: n.duration + 40,
    }));
    expect(scoreAttempt(rhythm, jittered).score).toBe(100);
  });

  test("a constant delay (audio latency) is forgiven", () => {
    const result = scoreAttempt(rhythm, shift(rhythm.notes, 180));
    expect(result.score).toBe(100);
    expect(result.offset).toBe(180);
  });

  test("missing a note costs roughly that note's share", () => {
    const result = scoreAttempt(rhythm, rhythm.notes.slice(0, 3));
    expect(result.score).toBe(75);
    expect(result.misses).toBe(1);
  });

  test("missing the first note doesn't ruin the rest", () => {
    const result = scoreAttempt(rhythm, rhythm.notes.slice(1));
    expect(result.score).toBe(75);
  });

  test("spamming extra taps is penalised", () => {
    const spam: Note[] = [];
    for (let t = 0; t < 2000; t += 125) spam.push({ start: t, duration: 60 });
    expect(scoreAttempt(rhythm, spam).score).toBeLessThan(40);
  });

  test("worse timing gives a lower score", () => {
    const slightly = rhythm.notes.map((n, i) => ({ ...n, start: n.start + (i % 2 ? 70 : -70) }));
    const badly = rhythm.notes.map((n, i) => ({ ...n, start: n.start + (i % 2 ? 160 : -160) }));
    const s1 = scoreAttempt(rhythm, slightly).score;
    const s2 = scoreAttempt(rhythm, badly).score;
    expect(s1).toBeLessThan(100);
    expect(s2).toBeLessThan(s1);
  });

  test("wrong durations cost less than wrong onsets", () => {
    const held = rhythm.notes.map((n) => ({ ...n, duration: n.duration * 3 }));
    const score = scoreAttempt(rhythm, held).score;
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThanOrEqual(75);
  });

  test("ignores malformed input", () => {
    const junk = [null, { start: "x" }, { start: 0, duration: -1 }, { start: NaN, duration: 1 }];
    expect(scoreAttempt(rhythm, junk as unknown as Note[]).score).toBe(0);
  });
});

describe("sanitizeNotes", () => {
  test("sorts and caps notes", () => {
    const notes = sanitizeNotes([
      { start: 20, duration: 1 },
      { start: 10, duration: 1 },
    ]);
    expect(notes.map((n) => n.start)).toEqual([10, 20]);
    expect(sanitizeNotes(new Array(100).fill({ start: 0, duration: 1 })).length).toBe(64);
    expect(sanitizeNotes("nope")).toEqual([]);
  });
});

describe("simulateAttempt", () => {
  const average = (skill: number, difficulty: number): number => {
    const rng = seededRng(`bots-${skill}-${difficulty}`);
    let total = 0;
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const r = generateRhythm(difficulty, rng);
      total += scoreAttempt(r, simulateAttempt(r, skill, rng)).score;
    }
    return total / runs;
  };

  test("better bots score higher", () => {
    expect(average(0.9, 3)).toBeGreaterThan(average(0.5, 3));
    expect(average(0.5, 3)).toBeGreaterThan(average(0.1, 3));
  });

  test("harder rhythms are harder for bots", () => {
    expect(average(0.6, 1)).toBeGreaterThan(average(0.6, 6));
  });

  test("skilled bots are good but not perfect", () => {
    const avg = average(0.9, 4);
    expect(avg).toBeGreaterThan(75);
    expect(avg).toBeLessThan(100);
  });
});
