import { Note } from "@rhythm-royale/common";

export interface LaneNote extends Note {
  tone?: "neutral" | "good" | "ok" | "bad" | "missed" | "live";
}

interface Props {
  notes: LaneNote[];
  lengthMs: number;
  beatMs: number;
  label?: string;
  /** Position of the moving playhead, in ms. */
  playheadMs?: number;
}

/** A horizontal strip showing notes as bars against beat gridlines. */
export default function RhythmLane({ notes, lengthMs, beatMs, label, playheadMs }: Props) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / lengthMs) * 100))}%`;
  const beats = Math.floor(lengthMs / beatMs);
  return (
    <div className="lane-row">
      {label && <div className="lane-label">{label}</div>}
      <div className="lane" role="img" aria-label={`${label ?? "Rhythm"}: ${notes.length} notes`}>
        {Array.from({ length: beats + 1 }, (_, i) => (
          <span key={i} className="lane-beat" style={{ left: pct(i * beatMs) }} />
        ))}
        {notes.map((n, i) => (
          <span
            key={i}
            className={`lane-note lane-note--${n.tone ?? "neutral"}`}
            style={{ left: pct(n.start), width: `max(4px, ${pct(n.duration)})` }}
          />
        ))}
        {playheadMs !== undefined && (
          <span className="lane-playhead" style={{ left: pct(playheadMs) }} />
        )}
      </div>
    </div>
  );
}
