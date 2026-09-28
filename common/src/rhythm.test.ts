import { describe, expect, test } from "vitest";
import { seededRng } from "./random.js";
import {
  beatMs,
  DIFFICULTIES,
  generateRhythm,
  MAX_DIFFICULTY,
  MAX_PITCHES,
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
        expect(rhythm.pitches).toBe(DIFFICULTIES[difficulty - 1].pitches);
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
  test("each level adds a key, up to six", () => {
    expect(DIFFICULTIES.map((d) => d.pitches)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(MAX_PITCHES).toBe(6);
  });

  test("multi-key rhythms actually use several keys", () => {
    const rng = seededRng("spread");
    for (let level = 2; level <= MAX_DIFFICULTY; level++) {
      for (let i = 0; i < 100; i++) {
        const r = generateRhythm(level, rng);
        expect(new Set(r.notes.map((n) => n.pitch)).size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("key pitches rise from low to high and spread out when there are few", () => {
    expect(pitchNames(1)).toEqual(["G4"]);
    expect(pitchNames(2)).toEqual(["C4", "C5"]);
    expect(pitchNames(3)).toEqual(["C4", "G4", "C5"]);
    expect(pitchNames(6)).toEqual(["C4", "D4", "E4", "G4", "A4", "C5"]);
    for (let n = 1; n <= 6; n++) expect(new Set(pitchNames(n)).size).toBe(n);
  });

  test("the pitch preview only plays when there is more than one key", () => {
    expect(referenceMs(1)).toBe(0);
    expect(referenceMs(4)).toBeGreaterThan(referenceMs(2));
    const mono = generateRhythm(1, seededRng(1));
    const poly = { ...mono, pitches: 4 };
    expect(roundTiming(poly).listenMs - roundTiming(mono).listenMs).toBe(referenceMs(4));
  });
});
