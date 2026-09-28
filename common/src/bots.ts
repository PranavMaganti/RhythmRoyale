import { gaussian, Rng } from "./random";
import { beatMs, Note, Rhythm } from "./rhythm";

/**
 * Imitate a human attempt at a rhythm. `skill` runs from 0 (flailing) to 1
 * (near-perfect); bots go through exactly the same scoring as players.
 */
export function simulateAttempt(rhythm: Rhythm, skill: number, rng: Rng = Math.random): Note[] {
  const s = Math.min(1, Math.max(0, skill));
  const beat = beatMs(rhythm.bpm);
  const weakness = 1 - s;
  // Longer phrases are harder to remember, so memory slips scale with note count.
  const memoryLoad = rhythm.notes.length / 4;
  const missChance = weakness * 0.1 * memoryLoad;
  const misplaceChance = weakness * 0.18 * memoryLoad;
  const extraChance = weakness * 0.05 * memoryLoad;
  const onsetSd = 10 + weakness * beat * 0.12;
  const durationSd = 0.05 + weakness * 0.35;
  // A consistent reaction delay; scoring forgives this, as it does for players.
  const latency = 40 + rng() * 120;

  const notes: Note[] = [];
  for (const note of rhythm.notes) {
    if (rng() < missChance) continue;
    // Misremembering the rhythm: the note lands on the wrong subdivision.
    const misplaced = rng() < misplaceChance ? (rng() < 0.5 ? -1 : 1) * beat * 0.5 : 0;
    notes.push({
      start: note.start + latency + misplaced + gaussian(rng, 0, onsetSd),
      duration: Math.max(30, note.duration * (1 + gaussian(rng, 0, durationSd))),
    });
    if (rng() < extraChance) {
      notes.push({
        start: note.start + latency + note.duration + beat * 0.25,
        duration: 60 + rng() * 100,
      });
    }
  }

  notes.sort((a, b) => a.start - b.start);
  // A single key can't overlap itself.
  for (let i = 0; i < notes.length - 1; i++) {
    const room = notes[i + 1].start - notes[i].start - 10;
    notes[i].duration = Math.max(10, Math.min(notes[i].duration, room));
  }
  return notes.filter((n, i) => i === 0 || n.start > notes[i - 1].start + 10);
}
