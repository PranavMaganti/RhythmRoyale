import { seededRng } from "@rhythm-royale/common";
import { botName, botSkills, normalQuantile } from "./bots";

describe("normalQuantile", () => {
  test("matches known points of the standard normal", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 4);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 4);
  });
});

describe("botSkills", () => {
  const dist = { mean: 0.4, sd: 0.2 };

  test("follows the bell curve across many lobbies", () => {
    const rng = seededRng("bell");
    const all: number[] = [];
    for (let i = 0; i < 2000; i++) all.push(...botSkills(9, dist, rng));
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
    expect(mean).toBeCloseTo(0.4, 2);
    expect(sd).toBeGreaterThan(0.17);
    expect(sd).toBeLessThan(0.21);
    // Roughly 68% within one standard deviation, as a normal distribution should.
    const within = all.filter((s) => Math.abs(s - 0.4) <= 0.2).length / all.length;
    expect(within).toBeGreaterThan(0.64);
    expect(within).toBeLessThan(0.72);
  });

  test("every lobby gets a similar spread (no all-ace or all-novice lobbies)", () => {
    const rng = seededRng("lobbies");
    for (let i = 0; i < 500; i++) {
      const skills = botSkills(9, dist, rng).sort();
      const avg = skills.reduce((a, b) => a + b, 0) / skills.length;
      expect(avg).toBeGreaterThan(0.33);
      expect(avg).toBeLessThan(0.47);
      expect(skills[8] - skills[0]).toBeGreaterThan(0.35);
    }
  });

  test("stays inside sensible bounds", () => {
    const skills = botSkills(200, { mean: 0.5, sd: 1 }, seededRng(1));
    expect(Math.min(...skills)).toBeGreaterThanOrEqual(0.02);
    expect(Math.max(...skills)).toBeLessThanOrEqual(0.98);
  });
});

test("botName avoids names already in the lobby", () => {
  const rng = seededRng("names");
  const taken = new Set<string>();
  for (let i = 0; i < 9; i++) taken.add(botName(rng, taken));
  expect(taken.size).toBe(9);
});
