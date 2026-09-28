import { beatMs, type Note, type Rhythm } from "./rhythm.js";

/** Onset errors inside this window count as perfect (typical human tap jitter). */
const PERFECT_ONSET_MS = 35;
/** Duration errors inside this window count as perfect. */
const PERFECT_DURATION_MS = 70;
const ONSET_WEIGHT = 0.75;
const DURATION_WEIGHT = 1 - ONSET_WEIGHT;
/** Share of a note's credit kept when the timing is right but the key is wrong. */
export const WRONG_PITCH_CREDIT = 0.3;
/** Largest constant offset we forgive (covers audio/input latency and a nervous start). */
const MAX_OFFSET_BEATS = 1.5;

export interface NoteMatch {
  target: number;
  attempt: number;
  /** 0..1 credit for this pairing. */
  credit: number;
  /** Whether the right key was pressed. */
  pitchOk: boolean;
}

export interface AttemptScore {
  /** 0..100 */
  score: number;
  /** Shift (ms) that was subtracted from the attempt to line it up with the target. */
  offset: number;
  matches: NoteMatch[];
  misses: number;
  extras: number;
  /** Notes that were timed right but played on the wrong key. */
  wrongPitches: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Drop malformed input and put notes in time order. */
export function sanitizeNotes(notes: unknown, maxNotes = 64): Note[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter(
      (n): n is Note =>
        !!n &&
        typeof n === "object" &&
        Number.isFinite((n as Note).start) &&
        Number.isFinite((n as Note).duration) &&
        (n as Note).duration >= 0,
    )
    .slice(0, maxNotes)
    .map((n) => ({
      start: n.start,
      duration: n.duration,
      pitch: Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch < 16 ? n.pitch : 0,
    }))
    .sort((a, b) => a.start - b.start);
}

function noteCredit(target: Note, attempt: Note, window: number): number {
  const onsetErr = Math.abs(target.start - attempt.start);
  if (onsetErr >= window) return 0;
  const onset = clamp01(1 - Math.max(0, onsetErr - PERFECT_ONSET_MS) / (window - PERFECT_ONSET_MS));
  const durErr = Math.abs(target.duration - attempt.duration);
  const duration = clamp01(
    1 - Math.max(0, durErr - PERFECT_DURATION_MS) / Math.max(target.duration, 150),
  );
  const timing = ONSET_WEIGHT * onset + DURATION_WEIGHT * duration;
  return target.pitch === attempt.pitch ? timing : timing * WRONG_PITCH_CREDIT;
}

/**
 * Order-preserving alignment (like an edit distance) that maximises total credit,
 * so one early tap doesn't knock every later note out of place.
 */
function align(
  target: Note[],
  attempt: Note[],
  window: number,
): { total: number; matches: NoteMatch[] } {
  const n = target.length;
  const m = attempt.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = noteCredit(target[i - 1], attempt[j - 1], window);
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], c > 0 ? dp[i - 1][j - 1] + c : 0);
    }
  }

  const matches: NoteMatch[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const c = noteCredit(target[i - 1], attempt[j - 1], window);
    if (c > 0 && dp[i][j] === dp[i - 1][j - 1] + c) {
      matches.push({
        target: i - 1,
        attempt: j - 1,
        credit: c,
        pitchOk: target[i - 1].pitch === attempt[j - 1].pitch,
      });
      i--;
      j--;
    } else if (dp[i][j] === dp[i - 1][j]) {
      i--;
    } else {
      j--;
    }
  }
  matches.reverse();
  return { total: dp[n][m], matches };
}

export function scoreAttempt(rhythm: Rhythm, rawAttempt: Note[]): AttemptScore {
  const target = rhythm.notes;
  const attempt = sanitizeNotes(rawAttempt);
  const empty: AttemptScore = {
    score: 0,
    offset: 0,
    matches: [],
    misses: target.length,
    extras: attempt.length,
    wrongPitches: 0,
  };
  if (target.length === 0 || attempt.length === 0) return empty;

  const beat = beatMs(rhythm.bpm);
  const window = beat * 0.4;

  // Players only need to get the *relative* timing right, so try lining up
  // each of the first couple of taps with each of the first couple of notes.
  const offsets = new Set<number>([0]);
  for (let a = 0; a < Math.min(2, attempt.length); a++) {
    for (let t = 0; t < Math.min(2, target.length); t++) {
      const offset = attempt[a].start - target[t].start;
      if (Math.abs(offset) <= MAX_OFFSET_BEATS * beat) offsets.add(offset);
    }
  }

  let best = empty;
  let bestTotal = -1;
  offsets.forEach((offset) => {
    const shifted = attempt.map((n) => ({ ...n, start: n.start - offset }));
    const { total, matches } = align(target, shifted, window);
    if (total > bestTotal) {
      bestTotal = total;
      best = {
        score: Math.round((100 * total) / Math.max(target.length, attempt.length)),
        offset,
        matches,
        misses: target.length - matches.length,
        extras: attempt.length - matches.length,
        wrongPitches: matches.filter((m) => !m.pitchOk).length,
      };
    }
  });
  return best;
}
