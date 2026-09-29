import { describe, expect, test } from "vitest";
import { seededRng } from "./random.js";
import {
  beatMs,
  DIFFICULTIES,
  generateRhythm,
  MAX_DIFFICULTY,
  MAX_PITCHES,
  padNames,
  pitchesUsed,
  pitchNames,
  referenceMs,
  rhythmLengthMs,
  roundTiming,
} from "./rhythm.js";

describe("generateRhythm", () => {
  test.each(DIFFICULTIES.map((_, i) => i + 1))(
    "difficulty %i produces well-formed phrases",
    (difficulty) => {
      const rng = seededRng(difficulty);
      for (let i = 0; i < 200; i++) {
        const rhythm = generateRhythm(difficulty, rng);
        const length = rhythmLengthMs(rhythm);
        expect(rhythm.notes.length).toBeGreaterThanOrEqual(3);
        expect(rhythm.notes[0].start).toBe(0);
        expect(rhythm.pitches).toBe(DIFFICULTIES[difficulty - 1].pads);
        rhythm.notes.forEach((note, j) => {
          expect(Number.isInteger(note.pitch)).toBe(true);
          expect(note.pitch).toBeGreaterThanOrEqual(0);
          expect(note.pitch).toBeLessThan(rhythm.pitches);
          expect(note.duration).toBeGreaterThan(0);
          expect(note.start + note.duration).toBeLessThanOrEqual(length + 1e-6);
          if (j > 0) {
            const prev = rhythm.notes[j - 1];
            // Always a silence between notes so each one is a separate press.
            expect(note.start).toBeGreaterThan(prev.start + prev.duration);
          }
        });
      }
    },
  );

  test("is deterministic for a seeded rng", () => {
    expect(generateRhythm(4, seededRng("abc"))).toEqual(generateRhythm(4, seededRng("abc")));
    expect(generateRhythm(4, seededRng("abc"))).not.toEqual(generateRhythm(4, seededRng("abd")));
  });

  test("clamps out-of-range difficulties", () => {
    expect(generateRhythm(0, seededRng(1)).bpm).toBe(DIFFICULTIES[0].bpm);
    expect(generateRhythm(99, seededRng(1)).bpm).toBe(DIFFICULTIES[MAX_DIFFICULTY - 1].bpm);
  });
});

describe("timing", () => {
  test("beatMs converts tempo to milliseconds", () => {
    expect(beatMs(120)).toBe(500);
    expect(beatMs(60)).toBe(1000);
  });

  test("round timing covers listening and recording the whole phrase", () => {
    const rhythm = generateRhythm(3, seededRng(3));
    const { listenMs, recordMs, totalMs } = roundTiming(rhythm);
    expect(recordMs).toBeGreaterThan(rhythmLengthMs(rhythm));
    expect(listenMs).toBeGreaterThan(rhythmLengthMs(rhythm));
    expect(totalMs).toBe(listenMs + recordMs);
  });
});

describe("pitches", () => {
  test("level 1 is one pad; after that four pads, with melodies using more of them", () => {
    expect(DIFFICULTIES.map((d) => d.pads)).toEqual([1, 4, 4, 4, 4, 4]);
    expect(DIFFICULTIES.map((d) => d.lanes.length)).toEqual([1, 2, 3, 4, 4, 4]);
    expect(MAX_PITCHES).toBe(4);
  });

  test("melodies only use their level's pads and use several of them", () => {
    const rng = seededRng("spread");
    for (let level = 2; level <= MAX_DIFFICULTY; level++) {
      const { lanes } = DIFFICULTIES[level - 1];
      for (let i = 0; i < 100; i++) {
        const r = generateRhythm(level, rng);
        for (const n of r.notes) expect(lanes).toContain(n.pitch);
        expect(pitchesUsed(r)).toBeGreaterThanOrEqual(Math.min(lanes.length, 3));
      }
    }
  });

  test("melodies end on the home note", () => {
    const rng = seededRng("home");
    for (let level = 2; level <= MAX_DIFFICULTY; level++) {
      for (let i = 0; i < 100; i++) {
        const r = generateRhythm(level, rng);
        expect(r.notes[r.notes.length - 1].pitch).toBe(0);
      }
    }
  });

  test("two-bar phrases open both bars with the same figure", () => {
    const rng = seededRng("echo");
    for (let i = 0; i < 100; i++) {
      const r = generateRhythm(4, rng);
      const bar = 4 * beatMs(r.bpm);
      const firstBeats = (from: number) =>
        r.notes
          .filter((n) => n.start >= from && n.start < from + bar / 4)
          .map((n) => Math.round(n.start - from));
      expect(firstBeats(bar)).toEqual(firstBeats(0));
    }
  });

  test("pads rise from low to high", () => {
    expect(pitchNames(1)).toEqual(["G4"]);
    expect(pitchNames(4)).toEqual(["C4", "D4", "E4", "G4"]);
    expect(padNames(4)).toEqual(["do", "re", "mi", "sol"]);
  });

  test("the pitch preview plays only the pads in play, and only when there's more than one", () => {
    expect(referenceMs(1)).toBe(0);
    expect(referenceMs(4)).toBeGreaterThan(referenceMs(2));
    const mono = generateRhythm(1, seededRng(1));
    const two = { ...mono, pitches: 4, lanes: [0, 3] };
    const all = { ...mono, pitches: 4, lanes: [0, 1, 2, 3] };
    expect(roundTiming(two).listenMs - roundTiming(mono).listenMs).toBe(referenceMs(2));
    expect(roundTiming(all).listenMs - roundTiming(mono).listenMs).toBe(referenceMs(4));
  });

  test("each level brings in one more pad until all four are in play", () => {
    const rng = seededRng("lanes");
    expect([1, 2, 3, 4, 5].map((level) => generateRhythm(level, rng).lanes)).toEqual([
      [0],
      [0, 3],
      [0, 2, 3],
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ]);
  });
});
