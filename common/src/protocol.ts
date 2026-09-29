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
  /**
   * Public lobbies: milliseconds until the match starts (empty seats get
   * filled with bots). Private rooms start when the host says, so null.
   */
  startsInMs: number | null;
  /** Set for private rooms: the code in the invite link. */
  code?: string;
  /** Private rooms: the player who can change settings and start the game. */
  hostId?: string;
  /** Whether empty seats get bots when the game starts. */
  bots: boolean;
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
  /** A private-room request failed, e.g. the code doesn't exist or the game has started. */
  room_error: (message: string) => void;
}

export interface ClientToServerEvents {
  /** Join the next public lobby. */
  queue: (name: string) => void;
  /** Open a private room with you as host. */
  create_room: (name: string) => void;
  join_room: (request: { code: string; name: string }) => void;
  /** Host only: fill empty seats with bots when the game starts, or not. */
  room_bots: (bots: boolean) => void;
  /** Host only: start the private game now. */
  start_room: () => void;
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
