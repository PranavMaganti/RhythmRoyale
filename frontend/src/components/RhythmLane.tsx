import type { Note } from "@rhythm-royale/common";
import { laneColor } from "../lib/keys";

export interface LaneNote extends Note {
  tone?: "neutral" | "good" | "ok" | "bad" | "missed" | "wrongKey" | "live";
}

interface Props {
  notes: LaneNote[];
  /** Number of keys; with more than one, notes sit on rows like a piano roll. */
  pitches: number;
  lengthMs: number;
  beatMs: number;
  label?: string;
  /** Position of the moving playhead, in ms. */
  playheadMs?: number;
}

const ROW_PX = 11;
const PAD_PX = 5;

/** A horizontal strip showing notes as bars against beat gridlines. */
export default function RhythmLane({ notes, pitches, lengthMs, beatMs, label, playheadMs }: Props) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / lengthMs) * 100))}%`;
  const beats = Math.floor(lengthMs / beatMs);
  const multi = pitches > 1;
  const height = multi ? PAD_PX * 2 + pitches * ROW_PX : 34;

  return (
    <div className="lane-row">
      {label && <div className="lane-label">{label}</div>}
      <div
        className="lane"
        style={{ height }}
        role="img"
        aria-label={`${label ?? "Rhythm"}: ${notes.length} notes`}
      >
        {Array.from({ length: beats + 1 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: gridlines have no identity beyond position
          <span key={i} className="lane-beat" style={{ left: pct(i * beatMs) }} />
        ))}
        {notes.map((n, i) => {
          const row = pitches - 1 - Math.min(n.pitch, pitches - 1);
          const tone = n.tone ?? "neutral";
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: notes are rendered in a fixed order
              key={i}
              className={`lane-note lane-note--${tone}`}
              style={{
                left: pct(n.start),
                width: `max(4px, ${pct(n.duration)})`,
                ...(multi && { top: PAD_PX + row * ROW_PX, height: ROW_PX - 2, bottom: "auto" }),
                ...(tone === "live" && { background: laneColor(n.pitch, pitches) }),
              }}
            />
          );
        })}
        {playheadMs !== undefined && (
          <span className="lane-playhead" style={{ left: pct(playheadMs) }} />
        )}
      </div>
    </div>
  );
}
