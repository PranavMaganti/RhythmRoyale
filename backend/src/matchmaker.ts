import {
  DEFAULT_MATCH_CONFIG,
  Match,
  type MatchConfig,
  type MatchTransport,
  type Rng,
} from "@rhythm-royale/common";

export interface RoomHooks {
  /** Called before the player is added so they receive the first lobby update. */
  joinRoom(playerId: string, matchId: string): void;
  leaveRoom(playerId: string, matchId: string): void;
}

export class Matchmaker {
  readonly matches = new Map<string, Match>();
  private readonly playerMatch = new Map<string, Match>();
  private nextId = 1;

  constructor(
    private readonly transportFor: (matchId: string) => MatchTransport,
    private readonly rooms: RoomHooks,
    private readonly config: MatchConfig = DEFAULT_MATCH_CONFIG,
    private readonly rng: Rng = Math.random,
  ) {}

  join(playerId: string, name: string): Match {
    this.leave(playerId);
    let match = Array.from(this.matches.values()).find((m) => m.canJoin());
    if (!match) {
      const id = `m${this.nextId++}-${Math.floor(this.rng() * 1e6).toString(36)}`;
      match = new Match(
        id,
        this.transportFor(id),
        (m) => this.onFinished(m),
        this.config,
        this.rng,
      );
      this.matches.set(id, match);
    }
    this.playerMatch.set(playerId, match);
    this.rooms.joinRoom(playerId, match.id);
    match.addHuman(playerId, name);
    return match;
  }

  leave(playerId: string): void {
    const match = this.playerMatch.get(playerId);
    if (!match) return;
    this.playerMatch.delete(playerId);
    this.rooms.leaveRoom(playerId, match.id);
    match.removeHuman(playerId);
  }

  submit(playerId: string, round: unknown, notes: unknown): void {
    if (typeof round !== "number") return;
    this.playerMatch.get(playerId)?.submit(playerId, round, notes);
  }

  matchOf(playerId: string): Match | undefined {
    return this.playerMatch.get(playerId);
  }

  private onFinished(match: Match): void {
    this.matches.delete(match.id);
    this.playerMatch.forEach((m, playerId) => {
      if (m === match) {
        this.playerMatch.delete(playerId);
        this.rooms.leaveRoom(playerId, match.id);
      }
    });
  }
}
