import { beatMs, Note, Rhythm, rhythmLengthMs, scoreAttempt } from "@rhythm-royale/common";
import RhythmLane, { LaneNote } from "./RhythmLane";

function toneFor(credit: number): LaneNote["tone"] {
  if (credit >= 0.85) return "good";
  if (credit >= 0.5) return "ok";
  return "bad";
}

/** Target vs. attempt, lined up the same way the scorer lined them up. */
export default function RhythmCompare({ rhythm, attempt }: { rhythm: Rhythm; attempt: Note[] }) {
  const result = scoreAttempt(rhythm, attempt);
  const beat = beatMs(rhythm.bpm);
  const lengthMs = rhythmLengthMs(rhythm) + beat;

  const target: LaneNote[] = rhythm.notes.map((n) => ({ ...n, tone: "missed" }));
  const yours: LaneNote[] = [...attempt]
    .sort((a, b) => a.start - b.start)
    .map((n) => ({ ...n, start: n.start - result.offset, tone: "bad" }));
  result.matches.forEach((m) => {
    const tone = toneFor(m.credit);
    target[m.target].tone = tone;
    yours[m.attempt].tone = tone;
  });
  const hits = result.matches.filter((m) => m.credit >= 0.5).length;

  return (
    <div className="compare">
      <RhythmLane label="Target" notes={target} lengthMs={lengthMs} beatMs={beat} />
      <RhythmLane label="You" notes={yours} lengthMs={lengthMs} beatMs={beat} />
      <p className="compare-summary">
        {hits}/{rhythm.notes.length} notes hit
        {result.extras > 0 && ` · ${result.extras} extra`}
        {result.misses > 0 && ` · ${result.misses} missed`}
      </p>
    </div>
  );
}
