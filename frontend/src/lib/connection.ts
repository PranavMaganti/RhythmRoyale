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
 * What the Battle Royale screen needs from a game: the real server over
 * Socket.IO, or the same match engine running in this tab against bots.
 */
export interface GameConnection {
  readonly offline: boolean;
  on<E extends keyof Events>(event: E, handler: Handler<E>): void;
  /** Called when the server can't be reached (never for offline games). */
  onError(handler: (message: string | null) => void): void;
  queue(name: string): void;
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
    onError: (handler) => {
      socket.on("connect", () => handler(null));
      socket.on("connect_error", () => handler("Can't reach the game server."));
      socket.on("disconnect", (reason) => {
        if (reason !== "io client disconnect") handler("Lost connection to the game server.");
      });
    },
    queue: (name) => {
      if (!socket.connected) socket.connect();
      socket.emit("queue", name);
    },
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
    onError: () => {},
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
    submit: ({ round, notes }) => match?.submit(LOCAL_PLAYER_ID, round, notes),
    close: () => {
      closed = true;
      match?.removeHuman(LOCAL_PLAYER_ID);
      match = null;
    },
  };
}
