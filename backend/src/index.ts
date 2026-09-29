import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  type ClientToServerEvents,
  DEFAULT_MATCH_CONFIG,
  dailyKey,
  isDailyKey,
  type MatchConfig,
  type ServerToClientEvents,
} from "@rhythm-royale/common";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { DailyBoard } from "./daily.js";
import { createDailyStore } from "./dailyStore.js";
import { Matchmaker } from "./matchmaker.js";
import { sanitizeName } from "./names.js";

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_BUILD = path.resolve(import.meta.dirname, "../../frontend/dist");

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const matchConfig: MatchConfig = {
  ...DEFAULT_MATCH_CONFIG,
  maxPlayers: envNumber("MAX_PLAYERS", DEFAULT_MATCH_CONFIG.maxPlayers),
  lobbyWaitMs: envNumber("LOBBY_WAIT_MS", DEFAULT_MATCH_CONFIG.lobbyWaitMs),
  botSkill: {
    mean: envNumber("BOT_SKILL_MEAN", DEFAULT_MATCH_CONFIG.botSkill.mean),
    sd: envNumber("BOT_SKILL_SD", DEFAULT_MATCH_CONFIG.botSkill.sd),
  },
};

const store = await createDailyStore();
console.log(`Daily leaderboard storage: ${store.kind}`);
const daily = new DailyBoard(store);

const app = express();
// Hosts like Render and Fly terminate TLS in a proxy in front of the app.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const matchmaker = new Matchmaker(
  (matchId) => ({
    broadcast: (event, ...args) => io.to(matchId).emit(event, ...args),
    send: (playerId, event, ...args) => io.to(playerId).emit(event, ...args),
  }),
  {
    joinRoom: (playerId, matchId) => io.sockets.sockets.get(playerId)?.join(matchId),
    leaveRoom: (playerId, matchId) => io.sockets.sockets.get(playerId)?.leave(matchId),
  },
  matchConfig,
);

io.on("connection", (socket) => {
  socket.emit("welcome", { playerId: socket.id });
  socket.on("queue", (name) => matchmaker.join(socket.id, sanitizeName(name)));
  socket.on("create_room", (name) => matchmaker.createRoom(socket.id, sanitizeName(name)));
  socket.on("join_room", (request) => {
    const result = matchmaker.joinRoom(socket.id, request?.code, sanitizeName(request?.name));
    if (typeof result === "string") socket.emit("room_error", result);
  });
  socket.on("room_bots", (bots) => matchmaker.setBots(socket.id, bots));
  socket.on("start_room", () => {
    const error = matchmaker.startRoom(socket.id);
    if (error) socket.emit("room_error", error);
  });
  socket.on("submit", (payload) => matchmaker.submit(socket.id, payload?.round, payload?.notes));
  socket.on("leave", () => matchmaker.leave(socket.id));
  socket.on("disconnect", () => matchmaker.leave(socket.id));
});

// Stays 200 when the database is down: restarting the server wouldn't fix the
// database, and it would end every match in progress.
app.get("/api/health", async (_req, res) => {
  let database: string = store.kind;
  try {
    await store.ping();
  } catch {
    database = `${store.kind} (unreachable)`;
  }
  res.json({
    ok: true,
    database,
    matches: matchmaker.matches.size,
    players: io.engine.clientsCount,
  });
});

const LEADERBOARD_DOWN = { error: "The leaderboard is unavailable right now." };

app.get("/api/daily/:date", async (req, res) => {
  const date = req.params.date === "today" ? dailyKey() : req.params.date;
  if (!isDailyKey(date)) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  try {
    res.json(await daily.leaderboard(date));
  } catch (err) {
    console.error("Daily leaderboard read failed", err);
    res.status(503).json(LEADERBOARD_DOWN);
  }
});

app.post("/api/daily", async (req, res) => {
  try {
    const result = await daily.submit(req.body);
    res.status("error" in result ? 400 : 200).json(result);
  } catch (err) {
    console.error("Daily submission failed", err);
    res.status(503).json(LEADERBOARD_DOWN);
  }
});

// Serve the React app in production; client-side routes fall back to index.html.
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(FRONTEND_BUILD, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`Rhythm Royale server listening on ${PORT}`);
});

// Hosts send SIGTERM before replacing an instance: stop taking connections,
// close sockets and the database pool, then exit.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  io.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
