import { botName, botSkills, type SkillDistribution } from "./botNames.js";
import { simulateAttempt } from "./bots.js";
import type { PlayerInfo, RoundResultEntry, ServerToClientEvents } from "./protocol.js";
import type { Rng } from "./random.js";
import { generateRhythm, MAX_DIFFICULTY, type Note, type Rhythm, roundTiming } from "./rhythm.js";
import { sanitizeNotes, scoreAttempt } from "./scoring.js";

export interface MatchConfig {
  maxPlayers: number;
  /** How long a lobby waits for people before filling the empty seats with bots. */
  lobbyWaitMs: number;
  /** How long the scoreboard is shown between rounds. */
  resultsMs: number;
  /** Slack for network latency after a round should have finished on the client. */
  graceMs: number;
  /** Fraction of the remaining field knocked out each round. */
  eliminationRate: number;
  botSkill: SkillDistribution;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  maxPlayers: 10,
  lobbyWaitMs: 15000,
  resultsMs: 7000,
  graceMs: 4000,
  eliminationRate: 0.3,
  botSkill: { mean: 0.4, sd: 0.2 },
};

type EventName = keyof ServerToClientEvents;
type EventArgs<E extends EventName> = Parameters<ServerToClientEvents[E]>;

export interface MatchTransport {
  broadcast<E extends EventName>(event: E, ...args: EventArgs<E>): void;
  send<E extends EventName>(playerId: string, event: E, ...args: EventArgs<E>): void;
}

interface Player extends PlayerInfo {
  skill: number;
  connected: boolean;
  attempt?: Note[];
}

export type MatchPhase = "lobby" | "round" | "results" | "finished";

/** How many rounds a match with this many players will take. */
export function plannedRounds(players: number, rate: number): number {
  let rounds = 0;
  for (let alive = players; alive > 1; alive -= eliminationCount(alive, rate)) rounds++;
  return rounds;
}

/**
 * Spread the difficulty levels across the match so the opening round is
 * gentle and the final round always uses every pitch.
 */
export function difficultyForRound(round: number, totalRounds: number): number {
  if (totalRounds <= 1) return MAX_DIFFICULTY;
  const level = 1 + ((round - 1) * (MAX_DIFFICULTY - 1)) / (totalRounds - 1);
  return Math.min(MAX_DIFFICULTY, Math.max(1, Math.round(level)));
}

export function eliminationCount(alive: number, rate: number): number {
  if (alive <= 1) return 0;
  if (alive === 2) return 1;
  return Math.min(alive - 1, Math.max(1, Math.round(alive * rate)));
}

export class Match {
  readonly players = new Map<string, Player>();
  phase: MatchPhase = "lobby";
  round = 0;
  totalRounds = 0;
  private rhythm?: Rhythm;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly startsAt: number;

  constructor(
    readonly id: string,
    private readonly transport: MatchTransport,
    private readonly onFinished: (match: Match) => void,
    private readonly config: MatchConfig = DEFAULT_MATCH_CONFIG,
    private readonly rng: Rng = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    this.startsAt = now() + config.lobbyWaitMs;
    this.timer = setTimeout(() => this.start(), config.lobbyWaitMs);
  }

  canJoin(): boolean {
    return this.phase === "lobby" && this.players.size < this.config.maxPlayers;
  }

  addHuman(id: string, name: string): void {
    this.players.set(id, { id, name, isBot: false, alive: true, connected: true, skill: 0 });
    this.broadcastLobby();
    if (this.players.size >= this.config.maxPlayers) this.start();
  }

  removeHuman(id: string): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;

    if (this.phase === "lobby") {
      this.players.delete(id);
      if (this.humans().length === 0) this.dispose();
      else this.broadcastLobby();
      return;
    }

    player.connected = false;
    if (player.alive && this.phase !== "finished") {
      // Leaving is the same as finishing last among those still standing.
      player.placement = this.alive().length;
      player.alive = false;
    }
    if (!this.humans().some((p) => p.connected)) {
      this.dispose();
    } else if (this.phase === "round") {
      this.finalizeIfAllSubmitted();
    }
  }

  submit(id: string, round: number, notes: unknown): void {
    const player = this.players.get(id);
    if (
      !player ||
      player.isBot ||
      !player.alive ||
      this.phase !== "round" ||
      round !== this.round ||
      player.attempt
    ) {
      return;
    }
    player.attempt = sanitizeNotes(notes);
    const aliveHumans = this.alive().filter((p) => !p.isBot);
    const submitted = aliveHumans.filter((p) => p.attempt).length;
    this.transport.broadcast("submissions", {
      submitted,
      waitingFor: aliveHumans.length - submitted,
    });
    this.finalizeIfAllSubmitted();
  }

  /** Start early (used when the lobby fills up, and by the lobby timer). */
  start(): void {
    if (this.phase !== "lobby") return;
    this.clearTimer();
    const taken = new Set(Array.from(this.players.values(), (p) => p.name));
    const seats = this.config.maxPlayers - this.players.size;
    botSkills(seats, this.config.botSkill, this.rng).forEach((skill, i) => {
      const name = botName(this.rng, taken);
      taken.add(name);
      const id = `bot-${this.id}-${i}`;
      this.players.set(id, { id, name, isBot: true, alive: true, connected: true, skill });
    });
    // Leavers only shorten a match, so this plan is an upper bound.
    this.totalRounds = plannedRounds(this.players.size, this.config.eliminationRate);
    this.startRound();
  }

  private startRound(): void {
    const alive = this.alive();
    if (alive.length <= 1) {
      this.finish();
      return;
    }
    this.round++;
    const difficulty = difficultyForRound(this.round, this.totalRounds);
    const rhythm = generateRhythm(difficulty, this.rng);
    this.rhythm = rhythm;
    for (const p of this.players.values()) p.attempt = undefined;
    this.phase = "round";
    this.transport.broadcast("round_start", {
      round: this.round,
      difficulty,
      rhythm,
      aliveCount: alive.length,
      playerCount: this.players.size,
      totalRounds: this.totalRounds,
    });
    const { totalMs } = roundTiming(rhythm);
    this.timer = setTimeout(() => this.finalizeRound(), totalMs + this.config.graceMs);
  }

  private finalizeIfAllSubmitted(): void {
    const waiting = this.alive().some((p) => !p.isBot && p.connected && !p.attempt);
    if (!waiting) this.finalizeRound();
  }

  private finalizeRound(): void {
    if (this.phase !== "round" || !this.rhythm) return;
    this.clearTimer();

    const alive = this.alive();
    if (alive.length === 0) {
      this.finish();
      return;
    }
    const ranked = this.playRound(this.rhythm, alive);
    const eliminated = eliminationCount(ranked.length, this.config.eliminationRate);

    const results: RoundResultEntry[] = ranked.map(({ player, score }, index) => {
      const out = index >= ranked.length - eliminated;
      if (out) {
        player.alive = false;
        player.placement = index + 1;
      }
      return {
        id: player.id,
        name: player.name,
        isBot: player.isBot,
        score,
        eliminated: out,
        placement: player.placement,
      };
    });

    const remaining = ranked.length - eliminated;
    const humanStillIn = this.alive().some((p) => !p.isBot && p.connected);
    const continues = remaining > 1 && humanStillIn;
    this.phase = "results";
    this.transport.broadcast("round_results", {
      round: this.round,
      results,
      nextRoundInMs: continues ? this.config.resultsMs : 0,
    });

    if (continues) {
      this.timer = setTimeout(() => this.startRound(), this.config.resultsMs);
    } else {
      // Nobody left to watch in real time: settle the bots' remaining rounds instantly.
      this.fastForward();
      this.finish();
    }
  }

  /** Score everyone still in, best first. Ties are broken randomly. */
  private playRound(rhythm: Rhythm, alive: Player[]): Array<{ player: Player; score: number }> {
    return alive
      .map((player) => {
        const attempt = player.isBot
          ? simulateAttempt(rhythm, player.skill, this.rng)
          : (player.attempt ?? []);
        return { player, score: scoreAttempt(rhythm, attempt).score, tiebreak: this.rng() };
      })
      .sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);
  }

  private fastForward(): void {
    let round = this.round;
    while (this.alive().length > 1) {
      round++;
      const rhythm = generateRhythm(difficultyForRound(round, this.totalRounds), this.rng);
      const ranked = this.playRound(rhythm, this.alive());
      const eliminated = eliminationCount(ranked.length, this.config.eliminationRate);
      ranked.slice(ranked.length - eliminated).forEach(({ player }, i) => {
        player.alive = false;
        player.placement = ranked.length - eliminated + i + 1;
      });
    }
  }

  private finish(): void {
    if (this.phase === "finished") return;
    this.clearTimer();
    this.phase = "finished";
    const alive = this.alive();
    if (alive.length === 1) alive[0].placement = 1;
    const standings = Array.from(this.players.values(), (p) => this.info(p)).sort(
      (a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity),
    );
    if (standings.length > 0) {
      this.transport.broadcast("game_over", { winner: standings[0], standings });
    }
    this.onFinished(this);
  }

  private dispose(): void {
    this.clearTimer();
    this.phase = "finished";
    this.onFinished(this);
  }

  private broadcastLobby(): void {
    this.transport.broadcast("lobby", {
      matchId: this.id,
      players: Array.from(this.players.values(), (p) => this.info(p)),
      maxPlayers: this.config.maxPlayers,
      startsInMs: Math.max(0, this.startsAt - this.now()),
    });
  }

  private info(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, isBot: p.isBot, alive: p.alive, placement: p.placement };
  }

  private humans(): Player[] {
    return Array.from(this.players.values()).filter((p) => !p.isBot);
  }

  private alive(): Player[] {
    return Array.from(this.players.values()).filter((p) => p.alive);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
