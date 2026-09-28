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

export interface SkillDistribution {
  mean: number;
  sd: number;
}

/** Keep bots away from 0 (never taps) and 1 (inhumanly perfect). */
const SKILL_FLOOR = 0.02;
const SKILL_CEILING = 0.98;

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation,
 * accurate to ~1e-9, which is far more than we need).
 */
export function normalQuantile(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * Bot skills that follow a bell curve, like a real player base: mostly
 * middling, a few standouts. Rather than drawing independently (which can
 * hand one lobby three aces and the next none), we take one draw from each
 * equal-probability slice of the curve, so every lobby has the same shape.
 */
export function botSkills(count: number, dist: SkillDistribution, rng: Rng): number[] {
  const skills = Array.from({ length: count }, (_, i) => {
    const p = (i + rng()) / count;
    const skill = dist.mean + dist.sd * normalQuantile(p);
    return Math.min(SKILL_CEILING, Math.max(SKILL_FLOOR, skill));
  });
  // Shuffle so seat order doesn't reveal who is strong.
  for (let i = skills.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [skills[i], skills[j]] = [skills[j], skills[i]];
  }
  return skills;
}
