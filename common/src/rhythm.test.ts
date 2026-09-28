import { seededRng } from "./random";
import {
  beatMs,
  DIFFICULTIES,
  generateRhythm,
  MAX_DIFFICULTY,
  rhythmLengthMs,
  roundTiming,
} from "./rhythm";

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
        rhythm.notes.forEach((note, j) => {
          expect(note.duration).toBeGreaterThan(0);
          expect(note.start + note.duration).toBeLessThanOrEqual(length + 1e-6);
          if (j > 0) {
            const prev = rhythm.notes[j - 1];
            // Always a silence between notes so each one is a separate press.
            expect(note.start).toBeGreaterThan(prev.start + prev.duration);
          }
        });
      }
    }
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
