import { pick, Rng } from "@rhythm-royale/common";

const FIRST = [
  "Tempo",
  "Snare",
  "Kick",
  "Hi-Hat",
  "Treble",
  "Bass",
  "Metro",
  "Groove",
  "Synco",
  "Staccato",
  "Legato",
  "Clave",
  "Cowbell",
  "Bongo",
  "Tabla",
  "Cajon",
  "Tambo",
  "Rimshot",
];
const LAST = ["Kid", "Bot", "Beats", "Master", "Fox", "Wizard", "Queen", "King", "Ace", "Jr"];

export function botName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const name = `${pick(FIRST, rng)}${pick(LAST, rng)}`;
    if (!taken.has(name)) return name;
  }
  return `Bot${Math.floor(rng() * 1000)}`;
}

/** Spread bot skill across the range so each lobby has a mix of strong and weak bots. */
export function botSkills(count: number, range: [number, number], rng: Rng): number[] {
  const [min, max] = range;
  return Array.from({ length: count }, (_, i) => {
    const slot = (i + rng()) / Math.max(1, count);
    return min + (max - min) * slot;
  });
}
