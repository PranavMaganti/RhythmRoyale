import { describe, expect, test } from "vitest";
import { simulateAttempt } from "./bots.js";
import { seededRng } from "./random.js";
import { generateRhythm, type Note, type Rhythm } from "./rhythm.js";
import { sanitizeNotes, scoreAttempt, WRONG_PITCH_CREDIT } from "./scoring.js";

const rhythm: Rhythm = {
  bpm: 120,
  beats: 4,
  pitches: 1,
  notes: [
    { start: 0, duration: 250, pitch: 0 },
    { start: 500, duration: 250, pitch: 0 },
    { start: 1000, duration: 500, pitch: 0 },
    { start: 1750, duration: 250, pitch: 0 },
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
      ...n,
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
    for (let t = 0; t < 2000; t += 125) spam.push({ start: t, duration: 60, pitch: 0 });
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
    const junk = [
      null,
      { start: "x" },
      { start: 0, duration: -1, pitch: 0 },
      { start: NaN, duration: 1, pitch: 0 },
    ];
    expect(scoreAttempt(rhythm, junk as unknown as Note[]).score).toBe(0);
  });
});

describe("sanitizeNotes", () => {
  test("sorts and caps notes", () => {
    const notes = sanitizeNotes([
      { start: 20, duration: 1, pitch: 0 },
      { start: 10, duration: 1, pitch: 0 },
    ]);
    expect(notes.map((n) => n.start)).toEqual([10, 20]);
    expect(sanitizeNotes(new Array(100).fill({ start: 0, duration: 1, pitch: 0 })).length).toBe(64);
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

describe("pitch", () => {
  const melody: Rhythm = {
    bpm: 120,
    beats: 4,
    pitches: 3,
    notes: [
      { start: 0, duration: 250, pitch: 0 },
      { start: 500, duration: 250, pitch: 2 },
      { start: 1000, duration: 250, pitch: 1 },
    ],
  };

  test("right keys at the right time is perfect", () => {
    const result = scoreAttempt(melody, melody.notes);
    expect(result.score).toBe(100);
    expect(result.wrongPitches).toBe(0);
  });

  test("right rhythm on the wrong key keeps some credit", () => {
    const oneKey = { ...melody, notes: melody.notes.map((n) => ({ ...n, pitch: 0 })) };
    const wrong = oneKey.notes.map((n) => ({ ...n, pitch: 1 }));
    const result = scoreAttempt(oneKey, wrong);
    expect(result.score).toBe(Math.round(100 * WRONG_PITCH_CREDIT));
    expect(result.wrongPitches).toBe(3);
    expect(result.misses).toBe(0);
  });

  test("one wrong key costs part of one note", () => {
    const oneOff = melody.notes.map((n, i) => (i === 1 ? { ...n, pitch: 1 } : n));
    const score = scoreAttempt(melody, oneOff).score;
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(70);
  });

  test("sanitizeNotes keeps valid pitches and defaults the rest", () => {
    const notes = sanitizeNotes([
      { start: 0, duration: 1, pitch: 4 },
      { start: 1, duration: 1, pitch: -1 },
      { start: 2, duration: 1 },
      { start: 3, duration: 1, pitch: 1.5 },
    ]);
    expect(notes.map((n) => n.pitch)).toEqual([4, 0, 0, 0]);
  });
});

describe("simulateAttempt pitch errors", () => {
  test("weaker bots press the wrong key more often", () => {
    const wrongRate = (skill: number): number => {
      const rng = seededRng(`pitch-${skill}`);
      let wrong = 0;
      let total = 0;
      for (let i = 0; i < 300; i++) {
        const r = generateRhythm(4, rng);
        const result = scoreAttempt(r, simulateAttempt(r, skill, rng));
        wrong += result.wrongPitches;
        total += r.notes.length;
      }
      return wrong / total;
    };
    expect(wrongRate(0.2)).toBeGreaterThan(wrongRate(0.8));
    expect(wrongRate(0.95)).toBeLessThan(0.05);
  });

  test("single-pitch rhythms never produce wrong keys", () => {
    const rng = seededRng("mono");
    for (let i = 0; i < 100; i++) {
      const r = generateRhythm(1, rng);
      expect(simulateAttempt(r, 0, rng).every((n) => n.pitch === 0)).toBe(true);
    }
  });
});

describe("early and late notes", () => {
  // 120 bpm: a beat is 500 ms, so the close window is 200 ms and pairing reaches 450 ms.
  const rhythm: Rhythm = {
    bpm: 120,
    beats: 4,
    pitches: 1,
    notes: [
      { start: 0, duration: 200, pitch: 0 },
      { start: 1000, duration: 200, pitch: 0 },
      { start: 2000, duration: 200, pitch: 0 },
    ],
  };
  const shiftSecond = (by: number) =>
    rhythm.notes.map((n, i) => (i === 1 ? { ...n, start: n.start + by } : n));

  test("a late note that doesn't overlap its target still counts as that note, late", () => {
    // Starts 300 ms late: after the target (200 ms long) has already ended.
    const result = scoreAttempt(rhythm, shiftSecond(300));
    expect(result.misses).toBe(0);
    expect(result.extras).toBe(0);
    const second = result.matches.find((m) => m.target === 1);
    expect(second?.onsetError).toBe(300);
  });

  test("an early note is reported as early", () => {
    const result = scoreAttempt(rhythm, shiftSecond(-300));
    expect(result.matches.find((m) => m.target === 1)?.onsetError).toBe(-300);
  });

  test("credit falls the further off a note is, and beats not playing it", () => {
    const score = (by: number) => scoreAttempt(rhythm, shiftSecond(by)).score;
    const missing = scoreAttempt(rhythm, [rhythm.notes[0], rhythm.notes[2]]).score;
    expect(score(0)).toBe(100);
    expect(score(100)).toBeLessThan(score(0));
    expect(score(300)).toBeLessThan(score(100));
    expect(score(300)).toBeGreaterThan(missing);
  });

  test("a press nowhere near any note is still an extra", () => {
    const stray = [...rhythm.notes, { start: 1500, duration: 100, pitch: 0 }];
    const result = scoreAttempt(rhythm, stray);
    expect(result.extras).toBe(1);
    expect(result.misses).toBe(0);
  });
});
