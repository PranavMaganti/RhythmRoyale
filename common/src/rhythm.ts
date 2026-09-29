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
  /** How many pads (keys) the round shows: 1, or 4 once melodies start. */
  pitches: number;
  /** Pads in play this round, low to high; the rest are shown but faded. All when absent. */
  lanes?: number[];
  notes: Note[];
}

/**
 * A rhythmic building block, in sixteenth notes: `[offset, length]` for each
 * note it contains. Phrases are strung together from these, the way real tunes
 * are built from a handful of recurring figures.
 */
interface Cell {
  length: number;
  notes: ReadonlyArray<readonly [number, number]>;
}

const CELLS = {
  quarter: { length: 4, notes: [[0, 4]] },
  eighths: {
    length: 4,
    notes: [
      [0, 2],
      [2, 2],
    ],
  },
  half: { length: 8, notes: [[0, 8]] },
  dottedQuarter: {
    length: 8,
    notes: [
      [0, 6],
      [6, 2],
    ],
  },
  syncopated: {
    length: 8,
    notes: [
      [0, 2],
      [2, 4],
      [6, 2],
    ],
  },
  quarterRest: { length: 4, notes: [] },
  offbeat: { length: 4, notes: [[2, 2]] },
  dottedEighth: {
    length: 4,
    notes: [
      [0, 3],
      [3, 1],
    ],
  },
  eighthSixteenths: {
    length: 4,
    notes: [
      [0, 2],
      [2, 1],
      [3, 1],
    ],
  },
  sixteenthsEighth: {
    length: 4,
    notes: [
      [0, 1],
      [1, 1],
      [2, 2],
    ],
  },
  sixteenths: {
    length: 4,
    notes: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
} satisfies Record<string, Cell>;

type CellName = keyof typeof CELLS;

interface DifficultySpec {
  bpm: number;
  /** 4 (one bar) or 8 (two bars: a phrase and its answer). */
  beats: number;
  cells: CellName[];
  /** Which pads the melody may use, low to high. */
  lanes: number[];
  /** Pads on screen. */
  pads: number;
}

const BASIC: CellName[] = ["quarter", "eighths", "half", "dottedQuarter"];

/**
 * Each level changes one thing. Level 1 is rhythm only, on a single pad. Then
 * the four pads stay put and the tunes use more of them, one at a time (low
 * and high first, as they're easiest to tell apart), while staying one bar
 * long. Level 4 doubles the length, but the second bar echoes the first.
 * Level 5 adds syncopation. Level 6 (sixteenth-note runs) is an expert level
 * for practice; battle royales stop at ROYALE_MAX_DIFFICULTY.
 */
export const DIFFICULTIES: readonly DifficultySpec[] = [
  { bpm: 90, beats: 4, cells: BASIC, lanes: [0], pads: 1 },
  { bpm: 90, beats: 4, cells: BASIC, lanes: [0, 3], pads: 4 },
  { bpm: 95, beats: 4, cells: BASIC, lanes: [0, 2, 3], pads: 4 },
  {
    bpm: 95,
    beats: 8,
    cells: [...BASIC, "quarterRest"],
    lanes: [0, 1, 2, 3],
    pads: 4,
  },
  {
    bpm: 100,
    beats: 8,
    cells: [...BASIC, "syncopated", "offbeat", "quarterRest"],
    lanes: [0, 1, 2, 3],
    pads: 4,
  },
  {
    bpm: 110,
    beats: 8,
    cells: [
      "quarter",
      "eighths",
      "dottedQuarter",
      "syncopated",
      "dottedEighth",
      "eighthSixteenths",
      "sixteenthsEighth",
      "sixteenths",
    ],
    lanes: [0, 1, 2, 3],
    pads: 4,
  },
];

export const MAX_DIFFICULTY = DIFFICULTIES.length;
/** The hardest level a battle royale reaches. */
export const ROYALE_MAX_DIFFICULTY = 5;
/** The first level that uses every pad: short matches end here. */
export const ALL_PADS_DIFFICULTY = 4;
export const MAX_PITCHES = 4;

/**
 * Do, re, mi and sol: enough for real tunes ("Mary Had a Little Lamb" uses
 * exactly these), with no semitone steps, which are hard to tell apart by ear.
 */
const SCALE = ["C4", "D4", "E4", "G4"] as const;
const SOLFEGE = ["do", "re", "mi", "sol"] as const;

/** Note names for each pad, low to high. */
export function pitchNames(count: number): string[] {
  const n = Math.min(MAX_PITCHES, Math.max(1, Math.round(count)));
  return n === 1 ? ["G4"] : SCALE.slice(0, n);
}

/** Sung names for each pad, low to high, e.g. for labels. */
export function padNames(count: number): string[] {
  const n = Math.min(MAX_PITCHES, Math.max(1, Math.round(count)));
  return n === 1 ? [""] : SOLFEGE.slice(0, n);
}

/** Pads in play this round, low to high. */
export function activeLanes(rhythm: Rhythm): number[] {
  return rhythm.lanes ?? Array.from({ length: rhythm.pitches }, (_, i) => i);
}

/** How many different pads a phrase actually uses. */
export function pitchesUsed(rhythm: Rhythm): number {
  return new Set(rhythm.notes.map((n) => n.pitch)).size;
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
  const listenMs = LEAD_IN_MS + referenceMs(activeLanes(rhythm).length) + phraseMs;
  const recordMs = phraseMs;
  return { listenMs, recordMs, totalMs: listenMs + recordMs };
}

function clampDifficulty(difficulty: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(1, Math.round(difficulty)));
}

/** Cells filling exactly `units` sixteenths, starting on a note. */
function fillCells(units: number, pool: CellName[], rng: Rng): Cell[] {
  const out: Cell[] = [];
  let left = units;
  // One rest per bar is a breath; more is a gap that's hard to count.
  let rested = false;
  while (left > 0) {
    const fitting = pool
      .map((name) => CELLS[name])
      .filter(
        (c) =>
          c.length <= left &&
          (out.length > 0 || c.notes[0]?.[0] === 0) &&
          !(rested && c.notes.length === 0),
      );
    const cell = fitting.length > 0 ? pick(fitting, rng) : CELLS.quarter;
    out.push(cell);
    left -= cell.length;
    if (cell.notes.length === 0) rested = true;
  }
  return out;
}

/** A held note to finish on: the phrase comes to rest instead of stopping mid-run. */
function cadence(units: number, pool: CellName[], rng: Rng): Cell[] {
  return rng() < 0.5
    ? [...fillCells(units - 8, pool, rng), CELLS.half]
    : [...fillCells(units - 4, pool, rng), CELLS.quarter];
}

/** `[start, length]` in sixteenths for every note in a row of cells. */
function layOut(cells: Cell[], from = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let pos = from;
  for (const cell of cells) {
    for (const [offset, length] of cell.notes) out.push([pos + offset, length]);
    pos += cell.length;
  }
  return out;
}

/**
 * The rhythm of a phrase. Two-bar phrases are a call and an answer: the
 * answer opens with the same figure as the call, then comes to rest, so there
 * is less to memorise and it sounds like a tune.
 */
function phraseRhythm(
  spec: DifficultySpec,
  rng: Rng,
): { steps: Array<[number, number]>; callNotes: number; echoed: number } {
  if (spec.beats <= 4) {
    return { steps: layOut(cadence(16, spec.cells, rng)), callNotes: 0, echoed: 0 };
  }
  const call = fillCells(16, spec.cells, rng);
  // The answer repeats the call's first half, then resolves.
  const opening: Cell[] = [];
  let used = 0;
  for (const cell of call) {
    if (used + cell.length > 8) break;
    opening.push(cell);
    used += cell.length;
  }
  const answer = [...opening, ...cadence(16 - used, spec.cells, rng)];
  const callSteps = layOut(call);
  return {
    steps: [...callSteps, ...layOut(answer, 16)],
    callNotes: callSteps.length,
    echoed: layOut(opening).length,
  };
}

/** A small melodic move, in scale steps: mostly steps, some repeats and skips. */
function move(rng: Rng): number {
  const r = rng();
  if (r < 0.15) return 0;
  if (r < 0.75) return rng() < 0.5 ? -1 : 1;
  return rng() < 0.5 ? -2 : 2;
}

function walk(count: number, degrees: number, first: number, rng: Rng): number[] {
  const line = [first];
  for (let i = 1; i < count; i++) {
    let next = line[i - 1] + move(rng);
    // Bounce off the ends of the scale instead of piling up on them.
    if (next < 0) next = -next;
    if (next > degrees - 1) next = 2 * (degrees - 1) - next;
    line.push(Math.min(degrees - 1, Math.max(0, next)));
  }
  return line;
}

/**
 * Scale degrees (0 = the home note) for each note. The call ends away from
 * home, like a question; the answer echoes the call's opening, exactly or a
 * step lower, and ends on the home note.
 */
function melody(
  count: number,
  degrees: number,
  callNotes: number,
  echoed: number,
  rng: Rng,
): number[] {
  if (degrees === 1) return new Array(count).fill(0);
  const start = pick([0, 0, 1, Math.min(2, degrees - 1)], rng);
  if (callNotes === 0) {
    const line = walk(count, degrees, start, rng);
    line[count - 1] = 0;
    return line;
  }
  const call = walk(callNotes, degrees, start, rng);
  if (call[callNotes - 1] === 0) call[callNotes - 1] = rng() < 0.5 ? 1 : degrees - 1;
  const shift = rng() < 0.6 || call.slice(0, echoed).some((d) => d === 0) ? 0 : -1;
  const answer = call.slice(0, echoed).map((d) => d + shift);
  const rest = count - callNotes - echoed;
  const tail = walk(rest + 1, degrees, answer[answer.length - 1] ?? start, rng).slice(1);
  if (tail.length > 0) tail[tail.length - 1] = 0;
  return [...call, ...answer, ...tail];
}

export function generateRhythm(difficulty: number, rng: Rng = Math.random): Rhythm {
  const spec = DIFFICULTIES[clampDifficulty(difficulty) - 1];
  const sixteenth = beatMs(spec.bpm) / 4;
  const minNotes = spec.beats <= 4 ? 3 : 6;
  const wantDistinct = Math.min(spec.lanes.length, 3);

  let steps: Array<[number, number]> = [];
  let line: number[] = [];
  // Retry until the phrase is busy enough and uses the pads it should; this
  // terminates quickly in practice.
  for (let attempt = 0; attempt < 50; attempt++) {
    const rhythm = phraseRhythm(spec, rng);
    steps = rhythm.steps;
    if (steps.length < minNotes) continue;
    line = melody(steps.length, spec.lanes.length, rhythm.callNotes, rhythm.echoed, rng);
    if (new Set(line).size >= wantDistinct) break;
  }

  return {
    bpm: spec.bpm,
    beats: spec.beats,
    pitches: spec.pads,
    lanes: [...spec.lanes],
    notes: steps.map(([pos, len], i) => {
      const slot = len * sixteenth;
      // Let go a moment before the next note so each one is a separate press.
      const gap = Math.min(80, slot * 0.3);
      return { start: pos * sixteenth, duration: slot - gap, pitch: spec.lanes[line[i]] ?? 0 };
    }),
  };
}
