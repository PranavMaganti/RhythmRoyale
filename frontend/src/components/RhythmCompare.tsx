import {
  type AttemptScore,
  beatMs,
  type Note,
  type NoteMatch,
  padNames,
  type Rhythm,
  rhythmLengthMs,
  sanitizeNotes,
  scoreAttempt,
} from "@rhythm-royale/common";

type Verdict = "good" | "ok" | "early" | "late" | "wrongKey" | "missed";

const MARKS: Record<Verdict, string> = {
  good: "✓",
  ok: "~",
  early: "«",
  late: "»",
  wrongKey: "✗",
  missed: "?",
};

/** Timing errors under this don't get a tip; they're within normal tap jitter. */
const TIMING_TIP_MS = 90;

function verdictFor(m: NoteMatch): Verdict {
  if (!m.pitchOk) return "wrongKey";
  if (m.credit >= 0.85) return "good";
  // Well off the beat says which way; otherwise it was the length that was off.
  if (m.credit < 0.5 && Math.abs(m.onsetError) > TIMING_TIP_MS) {
    return m.onsetError > 0 ? "late" : "early";
  }
  return "ok";
}

interface Tip {
  text: string;
  /** The target note the tip is about, highlighted on the roll. */
  note?: number;
}

/** The one thing most worth fixing next time, in plain words. */
function tipFor(rhythm: Rhythm, attempt: Note[], result: AttemptScore): Tip {
  const names = padNames(rhythm.pitches);
  const multi = rhythm.pitches > 1;
  if (attempt.length === 0)
    return { text: "Nothing was played. Hold a pad for each note you hear." };

  const wrong = result.matches.find((m) => !m.pitchOk);
  if (wrong && multi) {
    const should = names[rhythm.notes[wrong.target].pitch];
    const played = names[attempt[wrong.attempt].pitch];
    return {
      text: `Note ${wrong.target + 1} is ${should}; you played ${played}.`,
      note: wrong.target,
    };
  }
  if (result.misses > 0) {
    const matched = new Set(result.matches.map((m) => m.target));
    const first = rhythm.notes.findIndex((_, i) => !matched.has(i));
    const text =
      result.misses === 1
        ? `You missed note ${first + 1}.`
        : `You missed ${result.misses} notes, starting with note ${first + 1}. Count the notes as you listen.`;
    return { text, note: first };
  }
  if (result.extras > 0) {
    return {
      text: `You played ${result.extras} extra note${result.extras === 1 ? "" : "s"}. The tune has ${rhythm.notes.length}.`,
    };
  }

  let worstTiming: { note: number; error: number } | null = null;
  let worstLength: { note: number; ratio: number } | null = null;
  for (const m of result.matches) {
    const target = rhythm.notes[m.target];
    const played = attempt[m.attempt];
    const error = m.onsetError;
    if (Math.abs(error) > Math.abs(worstTiming?.error ?? TIMING_TIP_MS)) {
      worstTiming = { note: m.target, error };
    }
    // Only long notes: nobody can hold a quick note "longer".
    if (target.duration >= 250) {
      const ratio = played.duration / target.duration;
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worstLength?.ratio ?? 1.6))) {
        worstLength = { note: m.target, ratio };
      }
    }
  }
  if (worstTiming) {
    const ms = Math.round(Math.abs(worstTiming.error));
    const when = worstTiming.error > 0 ? "late" : "early";
    return {
      text: `Note ${worstTiming.note + 1} came in ${ms} ms ${when}.`,
      note: worstTiming.note,
    };
  }
  if (worstLength) {
    const text =
      worstLength.ratio < 1
        ? `Hold note ${worstLength.note + 1} longer: it rings for ${Math.round(1 / worstLength.ratio)}× as long as you held it.`
        : `Let go of note ${worstLength.note + 1} sooner.`;
    return { text, note: worstLength.note };
  }
  return { text: "Spot on. Every note in time." };
}

/**
 * The tune as outlined boxes, with your notes drawn inside them, lined up the
 * same way the scorer lined them up. Each box gets a mark saying how it went.
 */
export default function RhythmCompare({ rhythm, attempt }: { rhythm: Rhythm; attempt: Note[] }) {
  const played = sanitizeNotes(attempt);
  const result = scoreAttempt(rhythm, played);
  const beat = beatMs(rhythm.bpm);
  const lengthMs = rhythmLengthMs(rhythm) + beat;
  const rows = rhythm.pitches;
  const multi = rows > 1;
  const names = padNames(rows);

  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / lengthMs) * 100))}%`;
  const rowTop = (pitch: number) => `${((rows - 1 - Math.min(pitch, rows - 1)) / rows) * 100}%`;
  const rowHeight = `${100 / rows}%`;

  const targetVerdicts: Verdict[] = rhythm.notes.map(() => "missed");
  const playedVerdicts: Array<Verdict | "extra"> = played.map(() => "extra");
  for (const m of result.matches) {
    const v = verdictFor(m);
    targetVerdicts[m.target] = v;
    playedVerdicts[m.attempt] = v;
  }
  const targetFor = new Map(result.matches.map((m) => [m.attempt, m.target]));
  const hits = result.matches.filter((m) => m.pitchOk && m.credit >= 0.5).length;
  const tip = tipFor(rhythm, played, result);

  return (
    <div className="compare">
      <div className={`roll${multi ? "" : " roll--single"}`}>
        {multi && (
          <div className="roll-names" aria-hidden>
            {[...names].reverse().map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        )}
        <div
          className="roll-grid"
          role="img"
          aria-label={`${hits} of ${rhythm.notes.length} notes hit`}
        >
          {multi &&
            names.map((name, pitch) => (
              <span
                key={name}
                className="roll-row"
                style={{ top: rowTop(pitch), height: rowHeight }}
              />
            ))}
          {Array.from({ length: Math.floor(lengthMs / beat) + 1 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: gridlines have no identity beyond position
            <span key={`beat-${i}`} className="roll-beat" style={{ left: pct(i * beat) }} />
          ))}
          {rhythm.notes.map((n, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: notes are rendered in a fixed order
              key={`t-${i}`}
              className={`roll-target roll-target--${targetVerdicts[i]}${tip.note === i ? " roll-target--focus" : ""}`}
              style={{
                left: pct(n.start),
                width: pct(n.duration),
                top: rowTop(n.pitch),
                height: rowHeight,
              }}
            >
              <span className="roll-mark">{MARKS[targetVerdicts[i]]}</span>
            </span>
          ))}
          {played.map((n, i) => {
            const start = n.start - result.offset;
            const verdict = playedVerdicts[i];
            const target = targetFor.get(i);
            const link =
              verdict === "wrongKey" && target !== undefined
                ? [n.pitch, rhythm.notes[target].pitch]
                : null;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: notes are rendered in a fixed order
              <span key={`p-${i}`}>
                {link && (
                  <span
                    className="roll-link"
                    style={{
                      left: pct(start),
                      top: `calc(${rowTop(Math.max(...link))} + ${50 / rows}%)`,
                      height: `${(Math.abs(link[0] - link[1]) / rows) * 100}%`,
                    }}
                  />
                )}
                <span
                  className={`roll-played roll-played--${verdict}`}
                  style={{
                    left: pct(start),
                    width: `max(5px, ${pct(n.duration)})`,
                    top: `calc(${rowTop(n.pitch)} + ${100 / rows / 4}%)`,
                    height: `${100 / rows / 2}%`,
                  }}
                />
              </span>
            );
          })}
        </div>
      </div>

      <ul className="roll-legend" aria-label="Key">
        <li>
          <span className="swatch swatch--target" /> tune
        </li>
        <li>
          <span className="swatch swatch--played" /> you
        </li>
        <li>✓ spot on</li>
        <li>~ close</li>
        <li>« early</li>
        <li>» late</li>
        {multi && <li>✗ wrong note</li>}
        <li>? missed</li>
        <li>
          <span className="swatch swatch--extra" /> extra
        </li>
      </ul>

      <p className="compare-tip">{tip.text}</p>
      <p className="compare-summary">
        {hits}/{rhythm.notes.length} notes hit
        {result.wrongPitches > 0 &&
          ` · ${result.wrongPitches} wrong note${result.wrongPitches === 1 ? "" : "s"}`}
        {result.extras > 0 && ` · ${result.extras} extra`}
        {result.misses > 0 && ` · ${result.misses} missed`}
      </p>
    </div>
  );
}
