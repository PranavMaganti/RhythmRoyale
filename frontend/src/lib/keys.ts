/**
 * Home-row layouts, with the thumb on Space in the middle for odd counts.
 * Index 0 is the lowest pitch.
 */
const LAYOUTS: Record<number, string[]> = {
  1: [" "],
  2: ["f", "j"],
  3: ["f", " ", "j"],
  4: ["d", "f", "j", "k"],
  5: ["d", "f", " ", "j", "k"],
  6: ["s", "d", "f", "j", "k", "l"],
};

export function laneKeys(pitches: number): string[] {
  return LAYOUTS[pitches] ?? LAYOUTS[1];
}

/** Which lane a keyboard event plays, or null if it isn't one of ours. */
export function laneForKey(key: string, pitches: number): number | null {
  const k = key.toLowerCase();
  // Enter works as the only key too, for people who prefer it.
  if (pitches === 1 && (k === " " || k === "enter")) return 0;
  const lane = laneKeys(pitches).indexOf(k);
  return lane === -1 ? null : lane;
}

export function keyLabel(key: string): string {
  return key === " " ? "Space" : key.toUpperCase();
}

/** One colour per lane, low (warm) to high (cool). */
export const LANE_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dd4f0", "#b197fc"];

/** Colour for lane `lane` of `pitches`, spread across the palette. */
export function laneColor(lane: number, pitches: number): string {
  if (pitches <= 1) return "var(--accent)";
  const index = Math.round((lane * (LANE_COLORS.length - 1)) / (pitches - 1));
  return LANE_COLORS[index];
}
