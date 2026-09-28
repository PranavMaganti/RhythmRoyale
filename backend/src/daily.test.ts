import { type DailyStanding, dailyRhythms } from "@rhythm-royale/common";
import { describe, expect, test } from "vitest";
import { DailyBoard } from "./daily.js";

const TODAY = "2026-09-28";
const board = () => new DailyBoard(() => new Date(`${TODAY}T12:00:00Z`));
const perfect = dailyRhythms(TODAY).map((r) => r.notes);
const nothing = perfect.map(() => []);

describe("DailyBoard", () => {
  test("scores submissions on the server", () => {
    const result = board().submit({
      date: TODAY,
      token: "token-123",
      name: "Ann",
      attempts: perfect,
    });
    expect(result).toMatchObject({ total: 500, rank: 1, players: 1, percentile: 100 });
  });

  test("ranks players and reports a percentile", () => {
    const b = board();
    b.submit({ date: TODAY, token: "token-aaa", name: "Low", attempts: nothing });
    b.submit({
      date: TODAY,
      token: "token-bbb",
      name: "Mid",
      attempts: [perfect[0], [], [], [], []],
    });
    const top = b.submit({ date: TODAY, token: "token-ccc", name: "Top", attempts: perfect });
    expect(top).toMatchObject({ rank: 1, players: 3, percentile: 100 });
    const leaderboard = b.leaderboard(TODAY);
    expect(leaderboard.top.map((e) => e.name)).toEqual(["Top", "Mid", "Low"]);
  });

  test("only the first attempt counts", () => {
    const b = board();
    b.submit({ date: TODAY, token: "token-aaa", name: "Ann", attempts: nothing });
    const again = b.submit({ date: TODAY, token: "token-aaa", name: "Ann", attempts: perfect });
    expect((again as DailyStanding).total).toBe(0);
    expect(b.leaderboard(TODAY).players).toBe(1);
  });

  test("accepts yesterday but not older or future dates", () => {
    const b = board();
    const ok = (date: string) =>
      !("error" in b.submit({ date, token: `token-${date}`, name: "x", attempts: nothing }));
    expect(ok("2026-09-27")).toBe(true);
    expect(ok("2026-09-26")).toBe(false);
    expect(ok("2026-09-29")).toBe(false);
  });

  test("rejects malformed submissions", () => {
    const b = board();
    expect(b.submit(null)).toHaveProperty("error");
    expect(b.submit({ date: TODAY, token: "short", attempts: nothing })).toHaveProperty("error");
    expect(b.submit({ date: TODAY, token: "token-123", attempts: [[]] })).toHaveProperty("error");
  });
});
