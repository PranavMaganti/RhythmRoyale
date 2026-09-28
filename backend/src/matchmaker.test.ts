import type { LobbyState } from "@rhythm-royale/common";
import {
  lastPayload,
  recordingTransport,
  type SentEvent,
  TEST_CONFIG,
  testRng,
} from "@rhythm-royale/common/testing";
import { describe, expect, test, vi } from "vitest";
import { Matchmaker } from "./matchmaker.js";

vi.useFakeTimers();

function setup() {
  const log: SentEvent[] = [];
  const rooms = { joinRoom: vi.fn(), leaveRoom: vi.fn() };
  const mm = new Matchmaker((id) => recordingTransport(log, id), rooms, TEST_CONFIG, testRng());
  return { log, rooms, mm };
}

describe("Matchmaker", () => {
  test("groups players into the same lobby until it is full", () => {
    const { mm, rooms } = setup();
    const first = mm.join("a", "Alice");
    expect(mm.join("b", "Bob")).toBe(first);
    expect(rooms.joinRoom).toHaveBeenCalledWith("b", first.id);
    for (let i = 0; i < 4; i++) mm.join(`p${i}`, `P${i}`);
    expect(first.phase).toBe("round");
    expect(mm.join("late", "Late")).not.toBe(first);
    expect(mm.matches.size).toBe(2);
  });

  test("joins the room before the lobby is broadcast", () => {
    const { mm, rooms, log } = setup();
    rooms.joinRoom.mockImplementation(() => expect(log).toHaveLength(0));
    mm.join("a", "Alice");
    expect(lastPayload<LobbyState>(log, "lobby").players).toHaveLength(1);
  });

  test("forgets finished matches", () => {
    const { mm, rooms } = setup();
    const match = mm.join("a", "Alice");
    mm.leave("a");
    expect(rooms.leaveRoom).toHaveBeenCalledWith("a", match.id);
    expect(mm.matches.size).toBe(0);
    expect(mm.matchOf("a")).toBeUndefined();
  });

  test("re-queueing moves you out of your old match", () => {
    const { mm } = setup();
    mm.join("a", "Alice");
    mm.join("b", "Bob");
    const first = mm.matchOf("a");
    vi.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    const second = mm.join("a", "Alice");
    expect(second).not.toBe(first);
    expect(first?.players.get("a")?.alive).toBe(false);
  });

  test("rejects malformed submissions", () => {
    const { mm } = setup();
    mm.join("a", "Alice");
    expect(() => mm.submit("a", "1", null)).not.toThrow();
    expect(() => mm.submit("nobody", 1, [])).not.toThrow();
  });
});
