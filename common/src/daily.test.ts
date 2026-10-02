import { describe, expect, test } from "vitest";
import {
  DAILY_DIFFICULTIES,
  dailyKey,
  dailyNumber,
  dailyRhythms,
  dailyShareText,
  isDailyKey,
  msUntilNextDaily,
  scoreEmoji,
} from "./daily.js";

describe("daily challenge", () => {
  test("everyone gets the same rhythms on the same day", () => {
    expect(dailyRhythms("2026-09-28")).toEqual(dailyRhythms("2026-09-28"));
    expect(dailyRhythms("2026-09-28")).not.toEqual(dailyRhythms("2026-09-29"));
    expect(dailyRhythms("2026-09-28")).toHaveLength(DAILY_DIFFICULTIES.length);
  });

  test("keys are UTC dates", () => {
    expect(dailyKey(new Date("2026-09-28T23:59:59Z"))).toBe("2026-09-28");
    expect(dailyKey(new Date("2026-09-29T00:00:00Z"))).toBe("2026-09-29");
    expect(isDailyKey("2026-09-28")).toBe(true);
    expect(isDailyKey("2026-13-45")).toBe(false);
    expect(isDailyKey("yesterday")).toBe(false);
  });

  test("numbers count up from the first daily", () => {
    expect(dailyNumber("2026-10-02")).toBe(1);
    expect(dailyNumber("2026-10-03")).toBe(2);
    expect(dailyNumber("2027-10-02")).toBe(366);
  });

  test("every melody changes from one day to the next", () => {
    const today = dailyRhythms("2026-10-02");
    const tomorrow = dailyRhythms("2026-10-03");
    today.forEach((rhythm, i) => expect(tomorrow[i].notes).not.toEqual(rhythm.notes));
  });

  test("time until the next daily", () => {
    expect(msUntilNextDaily(new Date("2026-09-28T23:00:00Z"))).toBe(60 * 60 * 1000);
  });

  test("share text has an emoji per round and the total", () => {
    expect(scoreEmoji(90)).toBe("🟩");
    expect(scoreEmoji(70)).toBe("🟨");
    expect(scoreEmoji(10)).toBe("🟥");
    expect(dailyShareText("2026-10-04", [90, 70, 10, 100, 85])).toBe(
      "Rhythm Royale Daily #3\n🟩🟨🟥🟩🟩 355/500",
    );
  });
});
