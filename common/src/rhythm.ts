import { pick, Rng } from "./random";

/** A single held tone. Times are in milliseconds from the first downbeat. */
export interface Note {
  start: number;
  duration: number;
}

export interface Rhythm {
  bpm: number;
  /** Length of the phrase in beats (quarter notes). */
  beats: number;
  notes: Note[];
}

interface DifficultySpec {
  bpm: number;
  beats: number;
  /** Grid steps per beat: 2 = eighth notes, 4 = sixteenth notes. */
  subdivision: number;
  /** Allowed note lengths, in grid steps. */
  lengths: number[];
  /** Allowed silences between notes, in grid steps. */
  gaps: number[];
}

export const DIFFICULTIES: readonly DifficultySpec[] = [
  { bpm: 90, beats: 4, subdivision: 2, lengths: [1, 2], gaps: [1, 2] },
  { bpm: 100, beats: 4, subdivision: 2, lengths: [1, 2, 3], gaps: [1, 2] },
  { bpm: 100, beats: 8, subdivision: 2, lengths: [1, 2, 3], gaps: [1, 2, 3] },
  { bpm: 110, beats: 8, subdivision: 4, lengths: [1, 2, 4], gaps: [1, 2, 3] },
  { bpm: 120, beats: 8, subdivision: 4, lengths: [1, 2, 3, 4, 6], gaps: [1, 2, 3] },
  { bpm: 130, beats: 8, subdivision: 4, lengths: [1, 2, 3, 6], gaps: [1, 2, 3] },
];

export const MAX_DIFFICULTY = DIFFICULTIES.length;

/** Clicks played before the phrase (and before the player's turn) to set the tempo. */
export const COUNT_IN_BEATS = 4;
/** Silence before the count-in starts, so the audio scheduler has room. */
export const LEAD_IN_MS = 300;

export function beatMs(bpm: number): number {
  return 60000 / bpm;
}

export function rhythmLengthMs(rhythm: Rhythm): number {
  return rhythm.beats * beatMs(rhythm.bpm);
}

/**
 * How long each phase of a round lasts. Client and server both derive their
 * timers from this so they agree on when a round should be over.
 */
export function roundTiming(rhythm: Rhythm): {
  listenMs: number;
  recordMs: number;
  totalMs: number;
} {
  const beat = beatMs(rhythm.bpm);
  // Count-in, the phrase, then one beat of breathing room.
  const phraseMs = (COUNT_IN_BEATS + rhythm.beats + 1) * beat;
  const listenMs = LEAD_IN_MS + phraseMs;
  const recordMs = phraseMs;
  return { listenMs, recordMs, totalMs: listenMs + recordMs };
}

function clampDifficulty(difficulty: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(1, Math.round(difficulty)));
}

export function generateRhythm(difficulty: number, rng: Rng = Math.random): Rhythm {
  const spec = DIFFICULTIES[clampDifficulty(difficulty) - 1];
  const stepMs = beatMs(spec.bpm) / spec.subdivision;
  const totalSteps = spec.beats * spec.subdivision;
  const minNotes = Math.max(3, spec.beats / 2);

  let steps: Array<[number, number]> = [];
  // Retry until the phrase is busy enough to be interesting; this terminates
  // quickly in practice since short lengths/gaps are always available.
  for (let attempt = 0; attempt < 50; attempt++) {
    steps = [];
    let pos = 0;
    while (pos < totalSteps) {
      const fitting = spec.lengths.filter((len) => pos + len <= totalSteps);
      if (fitting.length === 0) break;
      const len = pick(fitting, rng);
      steps.push([pos, len]);
      pos += len + pick(spec.gaps, rng);
    }
    if (steps.length >= minNotes) break;
  }

  return {
    bpm: spec.bpm,
    beats: spec.beats,
    notes: steps.map(([pos, len]) => ({
      start: pos * stepMs,
      duration: len * stepMs,
    })),
  };
}
