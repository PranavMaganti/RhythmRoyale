import { seededRng, ServerToClientEvents } from "@rhythm-royale/common";
import { MatchConfig, MatchTransport } from "./match";

type EventName = keyof ServerToClientEvents;

export interface SentEvent {
  to: string;
  event: EventName;
  payload: unknown;
}

/** Transport that just records what would have gone over the wire. */
export function recordingTransport(log: SentEvent[], matchId = "match"): MatchTransport {
  return {
    broadcast: (event, ...args) => log.push({ to: matchId, event, payload: args[0] }),
    send: (playerId, event, ...args) => log.push({ to: playerId, event, payload: args[0] }),
  };
}

export function lastPayload<T>(log: SentEvent[], event: EventName): T {
  const found = log.filter((e) => e.event === event);
  if (found.length === 0) throw new Error(`No ${event} event was sent`);
  return found[found.length - 1].payload as T;
}

export const TEST_CONFIG: MatchConfig = {
  maxPlayers: 6,
  lobbyWaitMs: 10000,
  resultsMs: 5000,
  graceMs: 2000,
  eliminationRate: 0.3,
  botSkill: [0.3, 0.85],
};

export const testRng = (): (() => number) => seededRng("tests");
