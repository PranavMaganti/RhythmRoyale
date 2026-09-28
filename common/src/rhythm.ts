import { pick, type Rng } from "./random.js";

/**
 * A single held tone. Times are in milliseconds from the first downbeat;
 * `pitch` is the index of the key/pad (0 = lowest) out of `Rhythm.pitches`.
 */
export interface Note {
  start: number;
  duration: number;
  pitch: number;
}

export interface Rhythm {
  bpm: number;
  /** Length of the phrase in beats (quarter notes). */
  beats: number;
  /** How many different pitches (keys) the phrase can use, 1–6. */
  pitches: number;
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
  pitches: number;
}

/**
 * Each level adds a pitch to choose from. Rhythmic difficulty rises more
 * slowly, so players aren't hit with faster rhythms and more keys at once.
 */
export const DIFFICULTIES: readonly DifficultySpec[] = [
  { bpm: 90, beats: 4, subdivision: 2, lengths: [1, 2], gaps: [1, 2], pitches: 1 },
  { bpm: 95, beats: 4, subdivision: 2, lengths: [1, 2, 3], gaps: [1, 2], pitches: 2 },
  { bpm: 100, beats: 8, subdivision: 2, lengths: [1, 2, 3], gaps: [1, 2], pitches: 3 },
  { bpm: 100, beats: 8, subdivision: 2, lengths: [1, 2, 3], gaps: [1, 2, 3], pitches: 4 },
  { bpm: 110, beats: 8, subdivision: 4, lengths: [2, 3, 4], gaps: [1, 2, 3], pitches: 5 },
  { bpm: 115, beats: 8, subdivision: 4, lengths: [1, 2, 3, 4, 6], gaps: [1, 2, 3], pitches: 6 },
];

export const MAX_DIFFICULTY = DIFFICULTIES.length;
export const MAX_PITCHES = 6;

/**
 * A major pentatonic scale: any combination of these notes sounds pleasant,
 * and there are no semitone steps, which are hard to tell apart by ear.
 */
const SCALE = ["C4", "D4", "E4", "G4", "A4", "C5"] as const;

/** Note names for each key, low to high. Fewer keys are spread further apart. */
export function pitchNames(count: number): string[] {
  const n = Math.min(MAX_PITCHES, Math.max(1, Math.round(count)));
  if (n === 1) return [SCALE[3]];
  return Array.from({ length: n }, (_, i) => SCALE[Math.round((i * (SCALE.length - 1)) / (n - 1))]);
}

/** Clicks played before the phrase (and before the player's turn) to set the tempo. */
export const COUNT_IN_BEATS = 4;
/** Silence before anything plays, so the audio scheduler has room. */
export const LEAD_IN_MS = 300;
/** Spacing of the low-to-high "these are your notes" preview. */
export const REFERENCE_STEP_MS = 380;
export const REFERENCE_NOTE_MS = 280;
const REFERENCE_PAUSE_MS = 500;

export function beatMs(bpm: number): number {
  return 60000 / bpm;
}

export function rhythmLengthMs(rhythm: Rhythm): number {
  return rhythm.beats * beatMs(rhythm.bpm);
}

/** Length of the pitch preview that opens a round with more than one key. */
export function referenceMs(pitches: number): number {
  return pitches > 1 ? pitches * REFERENCE_STEP_MS + REFERENCE_PAUSE_MS : 0;
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
  const listenMs = LEAD_IN_MS + referenceMs(rhythm.pitches) + phraseMs;
  const recordMs = phraseMs;
  return { listenMs, recordMs, totalMs: listenMs + recordMs };
}

function clampDifficulty(difficulty: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(1, Math.round(difficulty)));
}

/**
 * Mostly stepwise melodies with the occasional leap: easier to remember than
 * uniformly random jumps, and closer to how real tunes move.
 */
function melody(count: number, pitches: number, rng: Rng): number[] {
  if (pitches === 1) return new Array(count).fill(0);
  const lanes = Array.from({ length: pitches }, (_, i) => i);
  for (let attempt = 0; attempt < 20; attempt++) {
    const line = [Math.floor(rng() * pitches)];
    for (let i = 1; i < count; i++) {
      const prev = line[i - 1];
      if (rng() < 0.6) {
        const step = pick([-2, -1, 1, 2], rng);
        line.push(Math.min(pitches - 1, Math.max(0, prev + step)));
      } else {
        line.push(pick(lanes, rng));
      }
    }
    // Make sure the extra keys actually matter.
    if (new Set(line).size >= Math.min(pitches, 2 + Math.floor(count / 4))) return line;
  }
  return Array.from({ length: count }, (_, i) => i % pitches);
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

  const line = melody(steps.length, spec.pitches, rng);
  return {
    bpm: spec.bpm,
    beats: spec.beats,
    pitches: spec.pitches,
    notes: steps.map(([pos, len], i) => ({
      start: pos * stepMs,
      duration: len * stepMs,
      pitch: line[i],
    })),
  };
}
