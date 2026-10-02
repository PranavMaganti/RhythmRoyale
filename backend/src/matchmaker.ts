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

/** Room codes skip look-alike characters (0/O, 1/I/L) so they're easy to read out. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
/** How long a finished private room's code keeps working for a rematch. */
const ROOM_TTL_MS = 60 * 60 * 1000;

interface PrivateRoom {
  /** The current game, or null between games (the code still works). */
  match: Match | null;
  idleSince: number;
}

export class Matchmaker {
  readonly matches = new Map<string, Match>();
  private readonly playerMatch = new Map<string, Match>();
  private readonly privateRooms = new Map<string, PrivateRoom>();
  private nextId = 1;

  constructor(
    private readonly transportFor: (matchId: string) => MatchTransport,
    private readonly rooms: RoomHooks,
    private readonly config: MatchConfig = DEFAULT_MATCH_CONFIG,
    private readonly rng: Rng = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  /** Join the next public lobby with a free seat, or open a new one. */
  join(playerId: string, name: string): Match {
    this.leave(playerId);
    const open = Array.from(this.matches.values()).find((m) => !m.isPrivate && m.canJoin());
    const match = open ?? this.newMatch();
    this.enter(playerId, name, match);
    return match;
  }

  /** Open a private room with a fresh code, with this player as host. */
  createRoom(playerId: string, name: string): Match {
    this.leave(playerId);
    this.pruneRooms();
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[Math.floor(this.rng() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.privateRooms.has(code));
    const match = this.newMatch(code);
    this.privateRooms.set(code, { match, idleSince: this.now() });
    this.enter(playerId, name, match);
    return match;
  }

  /**
   * Join a private room by code. Between games the code reopens the room, so
   * "play again" brings everyone back to the same link. Returns an error
   * message instead if the player can't get in.
   */
  joinRoom(playerId: string, code: unknown, name: string): Match | string {
    const key = typeof code === "string" ? code.trim().toUpperCase() : "";
    const room = this.privateRooms.get(key);
    if (!room) return "That room doesn't exist. Check the link, or ask for a new one.";
    const current = this.playerMatch.get(playerId);
    if (room.match && current === room.match) return room.match;
    if (room.match && room.match.phase !== "lobby") {
      return "That game has already started. Wait for it to finish, then try the link again.";
    }
    if (room.match && !room.match.canJoin()) return "That room is full.";
    this.leave(playerId);
    if (!room.match) room.match = this.newMatch(key);
    const match = room.match;
    this.enter(playerId, name, match);
    return match;
  }

  setBots(playerId: string, bots: unknown): void {
    if (typeof bots !== "boolean") return;
    this.playerMatch.get(playerId)?.setBots(playerId, bots);
  }

  /** Host only. Returns an error message if the game can't start. */
  startRoom(playerId: string): string | null {
    const match = this.playerMatch.get(playerId);
    if (!match?.isPrivate) return "You're not in a private room.";
    return match.startBy(playerId);
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

  private newMatch(code?: string): Match {
    const id = code
      ? `room-${code}-${this.nextId++}`
      : `m${this.nextId++}-${Math.floor(this.rng() * 1e6).toString(36)}`;
    const match = new Match(
      id,
      this.transportFor(id),
      (m) => this.onFinished(m),
      this.config,
      this.rng,
      this.now,
      code,
    );
    this.matches.set(id, match);
    return match;
  }

  private enter(playerId: string, name: string, match: Match): void {
    this.playerMatch.set(playerId, match);
    // Join the socket room first so the player receives the first lobby update.
    this.rooms.joinRoom(playerId, match.id);
    match.addHuman(playerId, name);
  }

  /** Forget private rooms nobody has used for a while. */
  private pruneRooms(): void {
    const cutoff = this.now() - ROOM_TTL_MS;
    this.privateRooms.forEach((room, code) => {
      if (!room.match && room.idleSince < cutoff) this.privateRooms.delete(code);
    });
  }

  private onFinished(match: Match): void {
    this.matches.delete(match.id);
    const room = match.code ? this.privateRooms.get(match.code) : undefined;
    if (room?.match === match) {
      room.match = null;
      room.idleSince = this.now();
    }
    this.playerMatch.forEach((m, playerId) => {
      if (m === match) {
        this.playerMatch.delete(playerId);
        this.rooms.leaveRoom(playerId, match.id);
      }
    });
  }
}
