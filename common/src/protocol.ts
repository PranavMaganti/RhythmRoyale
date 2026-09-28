import type { Note, Rhythm } from "./rhythm.js";

/** Socket.IO event contracts shared by the server and the browser. */

export interface PlayerInfo {
  id: string;
  name: string;
  isBot: boolean;
  alive: boolean;
  /** Final position (1 = winner), set once a player is out or has won. */
  placement?: number;
}

export interface LobbyState {
  matchId: string;
  players: PlayerInfo[];
  maxPlayers: number;
  /** Milliseconds until the match starts (empty seats get filled with bots). */
  startsInMs: number;
}

export interface RoundStart {
  round: number;
  difficulty: number;
  rhythm: Rhythm;
  aliveCount: number;
  playerCount: number;
  /** Rounds the match is planned to last (the last one uses every pitch). */
  totalRounds: number;
}

export interface RoundResultEntry {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  eliminated: boolean;
  placement?: number;
}

export interface RoundResults {
  round: number;
  /** Everyone who played this round, best first. */
  results: RoundResultEntry[];
  /** Milliseconds until the next round starts (0 when the match is over). */
  nextRoundInMs: number;
}

export interface GameOver {
  winner: PlayerInfo;
  /** Every player, winner first. */
  standings: PlayerInfo[];
}

export interface SubmitPayload {
  round: number;
  notes: Note[];
}

export interface ServerToClientEvents {
  welcome: (info: { playerId: string }) => void;
  lobby: (state: LobbyState) => void;
  round_start: (round: RoundStart) => void;
  submissions: (progress: { submitted: number; waitingFor: number }) => void;
  round_results: (results: RoundResults) => void;
  game_over: (result: GameOver) => void;
}

export interface ClientToServerEvents {
  queue: (name: string) => void;
  submit: (payload: SubmitPayload) => void;
  leave: () => void;
}

export interface DailySubmission {
  date: string;
  /** Random per-browser id so a player only gets one leaderboard entry per day. */
  token: string;
  name: string;
  attempts: Note[][];
}

export interface DailyLeaderboard {
  date: string;
  players: number;
  top: Array<{ name: string; total: number }>;
}

export interface DailyStanding extends DailyLeaderboard {
  total: number;
  scores: number[];
  rank: number;
  /** Share of players who scored strictly lower, 0..100. */
  percentile: number;
}
