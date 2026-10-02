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

describe("private rooms", () => {
  test("have a code, a host, and never start on their own", () => {
    const { mm, log } = setup();
    const room = mm.createRoom("a", "Alice");
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    const lobby = lastPayload<LobbyState>(log, "lobby");
    expect(lobby.code).toBe(room.code);
    expect(lobby.hostId).toBe("a");
    expect(lobby.startsInMs).toBeNull();
    vi.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs * 10);
    expect(room.phase).toBe("lobby");
  });

  test("are joined by code, case-insensitively, and never by quick match", () => {
    const { mm } = setup();
    const room = mm.createRoom("a", "Alice");
    expect(mm.joinRoom("b", room.code?.toLowerCase(), "Bob")).toBe(room);
    expect(mm.join("c", "Carol")).not.toBe(room);
    expect(mm.joinRoom("d", "NOPE1", "Dan")).toMatch(/doesn't exist/);
    expect(mm.joinRoom("d", 42, "Dan")).toMatch(/doesn't exist/);
  });

  test("only the host starts the game, and bots can be turned off", () => {
    const { mm, log } = setup();
    const room = mm.createRoom("a", "Alice");
    mm.setBots("a", false);
    expect(lastPayload<LobbyState>(log, "lobby").bots).toBe(false);
    expect(mm.startRoom("a")).toMatch(/at least one more player/);
    mm.joinRoom("b", room.code, "Bob");
    mm.setBots("b", true);
    expect(room.bots).toBe(false);
    expect(mm.startRoom("b")).toMatch(/Only the host/);
    expect(mm.startRoom("a")).toBeNull();
    expect(room.phase).toBe("round");
    expect(Array.from(room.players.values()).every((p) => !p.isBot)).toBe(true);
    expect(mm.joinRoom("c", room.code, "Carol")).toMatch(/already started/);
  });

  test("with bots on, the host can start alone and bots fill the seats", () => {
    const { mm } = setup();
    const room = mm.createRoom("a", "Alice");
    expect(mm.startRoom("a")).toBeNull();
    expect(room.players.size).toBe(TEST_CONFIG.maxPlayers);
  });

  test("hand over to the next player when the host leaves", () => {
    const { mm, log } = setup();
    const room = mm.createRoom("a", "Alice");
    mm.joinRoom("b", room.code, "Bob");
    mm.leave("a");
    expect(lastPayload<LobbyState>(log, "lobby").hostId).toBe("b");
    expect(mm.startRoom("b")).toBeNull();
  });

  test("reopen with the same code once the game is over", () => {
    const { mm } = setup();
    const room = mm.createRoom("a", "Alice");
    mm.leave("a");
    expect(room.phase).toBe("finished");
    const again = mm.joinRoom("b", room.code, "Bob");
    expect(again).not.toBe(room);
    expect(typeof again === "string" ? null : again.code).toBe(room.code);
    expect(typeof again === "string" ? null : again.hostId).toBe("b");
  });

  test("codes are forgotten an hour after the last game", () => {
    let now = 0;
    const log: SentEvent[] = [];
    const rooms = { joinRoom: vi.fn(), leaveRoom: vi.fn() };
    const mm = new Matchmaker(
      (id) => recordingTransport(log, id),
      rooms,
      TEST_CONFIG,
      testRng(),
      () => now,
    );
    const code = mm.createRoom("a", "Alice").code;
    mm.leave("a");
    now += 61 * 60 * 1000;
    mm.createRoom("b", "Bob");
    expect(mm.joinRoom("c", code, "Carol")).toMatch(/doesn't exist/);
  });
});
