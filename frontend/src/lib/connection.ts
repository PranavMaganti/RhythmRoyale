import {
  type ClientToServerEvents,
  DEFAULT_MATCH_CONFIG,
  Match,
  type ServerToClientEvents,
} from "@rhythm-royale/common";
import { io, type Socket } from "socket.io-client";
import { backendUrl } from "../config";

type Events = ServerToClientEvents;
type Handler<E extends keyof Events> = Events[E];

/**
 * - connected: connected, or reconnected with our seat intact.
 * - reconnecting: the connection dropped (often just the phone backgrounding
 *   the page); Socket.IO keeps retrying and the server holds our seat.
 * - lost: reconnected, but too late: the server no longer knows us.
 * - unreachable: never managed to connect at all.
 */
export type ConnectionStatus = "connected" | "reconnecting" | "lost" | "unreachable";

/**
 * What the Battle Royale screen needs from a game: the real server over
 * Socket.IO, or the same match engine running in this tab against bots.
 */
export interface GameConnection {
  readonly offline: boolean;
  on<E extends keyof Events>(event: E, handler: Handler<E>): void;
  /** Connection changes (never called for offline games). */
  onStatus(handler: (status: ConnectionStatus) => void): void;
  /** Join the next public lobby. */
  queue(name: string): void;
  /** Private rooms need the server; offline connections ignore these. */
  createRoom(name: string): void;
  joinRoom(code: string, name: string): void;
  setBots(bots: boolean): void;
  startRoom(): void;
  submit(...args: Parameters<ClientToServerEvents["submit"]>): void;
  close(): void;
}

export function socketConnection(): GameConnection {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = backendUrl
    ? io(backendUrl, { autoConnect: false })
    : io({ autoConnect: false });
  return {
    offline: false,
    on: (event, handler) => {
      // Socket.IO's typed `on` can't be called with a generic event name.
      (socket.on as (e: string, h: unknown) => void)(event, handler);
    },
    onStatus: (handler) => {
      let everConnected = false;
      socket.on("connect", () => {
        const fresh = !everConnected;
        everConnected = true;
        handler(fresh || socket.recovered ? "connected" : "lost");
      });
      socket.on("connect_error", () => handler(everConnected ? "reconnecting" : "unreachable"));
      socket.on("disconnect", (reason) => {
        if (reason !== "io client disconnect") handler("reconnecting");
      });
    },
    queue: (name) => {
      if (!socket.connected) socket.connect();
      socket.emit("queue", name);
    },
    createRoom: (name) => {
      if (!socket.connected) socket.connect();
      socket.emit("create_room", name);
    },
    joinRoom: (code, name) => {
      if (!socket.connected) socket.connect();
      socket.emit("join_room", { code, name });
    },
    setBots: (bots) => socket.emit("room_bots", bots),
    startRoom: () => socket.emit("start_room"),
    submit: (payload) => socket.emit("submit", payload),
    close: () => {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}

const LOCAL_PLAYER_ID = "you";
/** Nobody else can join an offline lobby, so don't make the player wait long. */
const OFFLINE_LOBBY_MS = 3000;

export function localConnection(): GameConnection {
  const handlers = new Map<keyof Events, Array<(payload: unknown) => void>>();
  let match: Match | null = null;
  let closed = false;

  // Deliver asynchronously, like a network would, so React sees the same
  // ordering of updates as it does online.
  const dispatch = (event: keyof Events, payload: unknown) => {
    setTimeout(() => {
      if (closed) return;
      for (const h of handlers.get(event) ?? []) h(payload);
    }, 0);
  };

  return {
    offline: true,
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler as (payload: unknown) => void]);
    },
    onStatus: () => {},
    queue: (name) => {
      match?.removeHuman(LOCAL_PLAYER_ID);
      const current = new Match(
        `local-${Date.now()}`,
        {
          broadcast: (event, ...args) => current === match && dispatch(event, args[0]),
          send: (_id, event, ...args) => current === match && dispatch(event, args[0]),
        },
        () => {},
        { ...DEFAULT_MATCH_CONFIG, lobbyWaitMs: OFFLINE_LOBBY_MS },
      );
      match = current;
      dispatch("welcome", { playerId: LOCAL_PLAYER_ID });
      current.addHuman(LOCAL_PLAYER_ID, name);
    },
    createRoom: () => {},
    joinRoom: () => {},
    setBots: () => {},
    startRoom: () => {},
    submit: ({ round, notes }) => match?.submit(LOCAL_PLAYER_ID, round, notes),
    close: () => {
      closed = true;
      match?.removeHuman(LOCAL_PLAYER_ID);
      match = null;
    },
  };
}
