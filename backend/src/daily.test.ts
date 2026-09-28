import { type DailyStanding, dailyRhythms } from "@rhythm-royale/common";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DailyBoard } from "./daily.js";
import { type DailyStore, MemoryDailyStore, PostgresDailyStore } from "./dailyStore.js";

const TODAY = "2026-09-28";
const perfect = dailyRhythms(TODAY).map((r) => r.notes);
const nothing = perfect.map(() => []);

// Postgres tests run when TEST_DATABASE_URL points at a disposable database
// (CI starts one); otherwise only the in-memory store is exercised.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const stores: Array<[string, () => Promise<DailyStore>]> = [
  ["memory", async () => new MemoryDailyStore()],
];
if (TEST_DATABASE_URL) {
  const opened: DailyStore[] = [];
  stores.push([
    "postgres",
    async () => {
      const store = await PostgresDailyStore.connect(TEST_DATABASE_URL);
      opened.push(store);
      return store;
    },
  ]);
  const admin = postgres(TEST_DATABASE_URL, { onnotice: () => {} });
  beforeEach(async () => {
    await admin`drop table if exists daily_scores`;
  });
  afterAll(async () => {
    await Promise.all(opened.map((s) => s.close()));
    await admin.end();
  });
}

describe.each(stores)("DailyBoard (%s store)", (_kind, open) => {
  const board = async () => new DailyBoard(await open(), () => new Date(`${TODAY}T12:00:00Z`));

  test("scores submissions on the server", async () => {
    const result = await (await board()).submit({
      date: TODAY,
      token: "token-123",
      name: "Ann",
      attempts: perfect,
    });
    expect(result).toMatchObject({
      total: 500,
      scores: [100, 100, 100, 100, 100],
      rank: 1,
      players: 1,
      percentile: 100,
    });
  });

  test("ranks players and reports a percentile", async () => {
    const b = await board();
    await b.submit({ date: TODAY, token: "token-aaa", name: "Low", attempts: nothing });
    await b.submit({
      date: TODAY,
      token: "token-bbb",
      name: "Mid",
      attempts: [perfect[0], [], [], [], []],
    });
    const top = await b.submit({ date: TODAY, token: "token-ccc", name: "Top", attempts: perfect });
    expect(top).toMatchObject({ rank: 1, players: 3, percentile: 100 });
    const leaderboard = await b.leaderboard(TODAY);
    expect(leaderboard.players).toBe(3);
    expect(leaderboard.top.map((e) => e.name)).toEqual(["Top", "Mid", "Low"]);
  });

  test("only the first attempt counts", async () => {
    const b = await board();
    await b.submit({ date: TODAY, token: "token-aaa", name: "Ann", attempts: nothing });
    const again = await b.submit({
      date: TODAY,
      token: "token-aaa",
      name: "Ann",
      attempts: perfect,
    });
    expect((again as DailyStanding).total).toBe(0);
    expect((await b.leaderboard(TODAY)).players).toBe(1);
  });

  test("keeps each day separate", async () => {
    const b = await board();
    await b.submit({ date: "2026-09-27", token: "token-aaa", name: "Ann", attempts: nothing });
    await b.submit({ date: TODAY, token: "token-aaa", name: "Ann", attempts: nothing });
    expect((await b.leaderboard(TODAY)).players).toBe(1);
    expect((await b.leaderboard("2026-09-27")).players).toBe(1);
  });

  test("accepts yesterday but not older or future dates", async () => {
    const b = await board();
    const ok = async (date: string) =>
      !(
        "error" in (await b.submit({ date, token: `token-${date}`, name: "x", attempts: nothing }))
      );
    expect(await ok("2026-09-27")).toBe(true);
    expect(await ok("2026-09-26")).toBe(false);
    expect(await ok("2026-09-29")).toBe(false);
  });

  test("rejects malformed submissions", async () => {
    const b = await board();
    expect(await b.submit(null)).toHaveProperty("error");
    expect(await b.submit({ date: TODAY, token: "short", attempts: nothing })).toHaveProperty(
      "error",
    );
    expect(await b.submit({ date: TODAY, token: "token-123", attempts: [[]] })).toHaveProperty(
      "error",
    );
  });

  test("an empty day has an empty leaderboard", async () => {
    expect(await (await board()).leaderboard(TODAY)).toEqual({ date: TODAY, players: 0, top: [] });
  });
});
