/** The single-file build that runs entirely in the browser against bots. */
export const OFFLINE = import.meta.env.MODE === "offline";

/**
 * Where the game server lives. In production the server also serves this app,
 * and in development Vite proxies to it, so the same origin works for both.
 */
export const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";
