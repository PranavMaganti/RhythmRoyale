import { GameOver, LobbyState, RoundResults, RoundStart, roundTiming } from "@rhythm-royale/common";
import { eliminationCount, Match } from "./match";
import { lastPayload, recordingTransport, SentEvent, TEST_CONFIG, testRng } from "./testing";

jest.useFakeTimers();

function setup(config = TEST_CONFIG) {
  const log: SentEvent[] = [];
  const finished = jest.fn();
  const match = new Match("m1", recordingTransport(log), finished, config, testRng());
  return { log, finished, match };
}

/** Play the current round perfectly as `playerId`. */
function playPerfectly(match: Match, log: SentEvent[], playerId: string) {
  const round = lastPayload<RoundStart>(log, "round_start");
  match.submit(playerId, round.round, round.rhythm.notes);
}

describe("eliminationCount", () => {
  test("knocks out roughly a third, always at least one, never everyone", () => {
    expect(eliminationCount(10, 0.3)).toBe(3);
    expect(eliminationCount(7, 0.3)).toBe(2);
    expect(eliminationCount(3, 0.3)).toBe(1);
    expect(eliminationCount(2, 0.3)).toBe(1);
    expect(eliminationCount(1, 0.3)).toBe(0);
    expect(eliminationCount(4, 0.9)).toBe(3);
  });
});

describe("Match lobby", () => {
  test("announces players and a countdown", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    const lobby = lastPayload<LobbyState>(log, "lobby");
    expect(lobby.players.map((p) => p.name)).toEqual(["Alice"]);
    expect(lobby.maxPlayers).toBe(6);
    expect(lobby.startsInMs).toBeGreaterThan(0);
  });

  test("fills empty seats with bots when the timer runs out", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    const round = lastPayload<RoundStart>(log, "round_start");
    expect(round.round).toBe(1);
    expect(round.playerCount).toBe(6);
    const bots = Array.from(match.players.values()).filter((p) => p.isBot);
    expect(bots).toHaveLength(5);
    expect(new Set(bots.map((b) => b.name)).size).toBe(5);
  });

  test("starts straight away when full", () => {
    const { log, match } = setup();
    for (let i = 0; i < 6; i++) match.addHuman(`p${i}`, `P${i}`);
    expect(match.canJoin()).toBe(false);
    expect(lastPayload<RoundStart>(log, "round_start").playerCount).toBe(6);
    expect(Array.from(match.players.values()).some((p) => p.isBot)).toBe(false);
  });

  test("is torn down when the last person leaves", () => {
    const { finished, match } = setup();
    match.addHuman("a", "Alice");
    match.removeHuman("a");
    expect(finished).toHaveBeenCalledWith(match);
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    expect(match.phase).toBe("finished");
  });
});

describe("Match rounds", () => {
  test("a perfect player wins against bots", () => {
    const { log, match, finished } = setup();
    match.addHuman("a", "Alice");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);

    let rounds = 0;
    while (match.phase !== "finished" && rounds < 20) {
      playPerfectly(match, log, "a");
      const results = lastPayload<RoundResults>(log, "round_results");
      expect(results.round).toBe(++rounds);
      expect(results.results.find((r) => r.id === "a")?.eliminated).toBe(false);
      jest.advanceTimersByTime(TEST_CONFIG.resultsMs);
    }

    const over = lastPayload<GameOver>(log, "game_over");
    expect(over.winner.id).toBe("a");
    expect(over.standings.map((p) => p.placement)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finished).toHaveBeenCalled();
    // 6 -> 4 -> 3 -> 2 -> 1
    expect(rounds).toBe(4);
  });

  test("results are sorted and eliminate the bottom of the field", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    playPerfectly(match, log, "a");
    const { results, nextRoundInMs } = lastPayload<RoundResults>(log, "round_results");
    expect(results).toHaveLength(6);
    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(results.map((r) => r.eliminated)).toEqual([false, false, false, false, true, true]);
    expect(results[5].placement).toBe(6);
    expect(results[4].placement).toBe(5);
    expect(nextRoundInMs).toBe(TEST_CONFIG.resultsMs);
  });

  test("a player who doesn't submit scores zero when time runs out", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    const round = lastPayload<RoundStart>(log, "round_start");
    jest.advanceTimersByTime(roundTiming(round.rhythm).totalMs + TEST_CONFIG.graceMs);
    const { results } = lastPayload<RoundResults>(log, "round_results");
    const alice = results.find((r) => r.id === "a");
    expect(alice?.score).toBe(0);
    expect(alice?.eliminated).toBe(true);
  });

  test("once every human is out the bots are settled instantly", () => {
    const { log, match, finished } = setup();
    match.addHuman("a", "Alice");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    match.submit("a", 1, []);
    const results = lastPayload<RoundResults>(log, "round_results");
    expect(results.nextRoundInMs).toBe(0);
    const over = lastPayload<GameOver>(log, "game_over");
    expect(over.winner.isBot).toBe(true);
    expect(over.standings.map((p) => p.placement)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finished).toHaveBeenCalled();
  });

  test("ignores late, duplicate and foreign submissions", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    match.addHuman("b", "Bob");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    match.submit("a", 99, []);
    match.submit("stranger", 1, []);
    match.submit("bot-m1-0", 1, []);
    expect(log.some((e) => e.event === "submissions")).toBe(false);

    playPerfectly(match, log, "a");
    match.submit("a", 1, []);
    const progress = log.filter((e) => e.event === "submissions");
    expect(progress).toHaveLength(1);
    expect(progress[0].payload).toEqual({ submitted: 1, waitingFor: 1 });
  });

  test("the round ends early once every human has submitted", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    match.addHuman("b", "Bob");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    playPerfectly(match, log, "a");
    expect(match.phase).toBe("round");
    playPerfectly(match, log, "b");
    expect(match.phase).toBe("results");
  });

  test("leaving mid-game counts as elimination and doesn't stall the round", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    match.addHuman("b", "Bob");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    playPerfectly(match, log, "a");
    match.removeHuman("b");
    expect(match.players.get("b")?.placement).toBe(6);
    const { results } = lastPayload<RoundResults>(log, "round_results");
    expect(results.map((r) => r.id)).not.toContain("b");
    expect(results).toHaveLength(5);
  });

  test("spectators keep the match running for the humans still in", () => {
    const { log, match } = setup();
    match.addHuman("a", "Alice");
    match.addHuman("b", "Bob");
    jest.advanceTimersByTime(TEST_CONFIG.lobbyWaitMs);
    playPerfectly(match, log, "a");
    match.submit("b", 1, []);
    const results = lastPayload<RoundResults>(log, "round_results");
    expect(results.results.find((r) => r.id === "b")?.eliminated).toBe(true);
    expect(results.nextRoundInMs).toBe(TEST_CONFIG.resultsMs);
    jest.advanceTimersByTime(TEST_CONFIG.resultsMs);
    expect(lastPayload<RoundStart>(log, "round_start").round).toBe(2);
  });
});
