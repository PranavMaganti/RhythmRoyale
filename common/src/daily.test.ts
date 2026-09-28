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
    expect(dailyNumber("2026-01-01")).toBe(1);
    expect(dailyNumber("2026-01-02")).toBe(2);
  });

  test("time until the next daily", () => {
    expect(msUntilNextDaily(new Date("2026-09-28T23:00:00Z"))).toBe(60 * 60 * 1000);
  });

  test("share text has an emoji per round and the total", () => {
    expect(scoreEmoji(90)).toBe("🟩");
    expect(scoreEmoji(70)).toBe("🟨");
    expect(scoreEmoji(10)).toBe("🟥");
    expect(dailyShareText("2026-01-03", [90, 70, 10, 100, 85])).toBe(
      "Rhythm Royale Daily #3\n🟩🟨🟥🟩🟩 355/500",
    );
  });
});
