/**
 * Where the game server lives. In production the server also serves this app,
 * so the same origin is used; in development the server runs on port 5000.
 */
export const backendUrl =
  process.env.REACT_APP_BACKEND_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:5000");
