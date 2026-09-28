import {
  ClientToServerEvents,
  dailyKey,
  isDailyKey,
  ServerToClientEvents,
} from "@rhythm-royale/common";
import cors from "cors";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { DailyBoard } from "./daily";
import { DEFAULT_MATCH_CONFIG, MatchConfig } from "./match";
import { Matchmaker } from "./matchmaker";
import { sanitizeName } from "./names";

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_BUILD = path.resolve(__dirname, "../../frontend/build");

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const matchConfig: MatchConfig = {
  ...DEFAULT_MATCH_CONFIG,
  maxPlayers: envNumber("MAX_PLAYERS", DEFAULT_MATCH_CONFIG.maxPlayers),
  lobbyWaitMs: envNumber("LOBBY_WAIT_MS", DEFAULT_MATCH_CONFIG.lobbyWaitMs),
  botSkill: [
    envNumber("BOT_SKILL_MIN", DEFAULT_MATCH_CONFIG.botSkill[0]),
    envNumber("BOT_SKILL_MAX", DEFAULT_MATCH_CONFIG.botSkill[1]),
  ],
};

const app = express();
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
  matchConfig
);

const daily = new DailyBoard();

io.on("connection", (socket) => {
  socket.emit("welcome", { playerId: socket.id });
  socket.on("queue", (name) => matchmaker.join(socket.id, sanitizeName(name)));
  socket.on("submit", (payload) => matchmaker.submit(socket.id, payload?.round, payload?.notes));
  socket.on("leave", () => matchmaker.leave(socket.id));
  socket.on("disconnect", () => matchmaker.leave(socket.id));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, matches: matchmaker.matches.size, players: io.engine.clientsCount });
});

app.get("/api/daily/:date", (req, res) => {
  const date = req.params.date === "today" ? dailyKey() : req.params.date;
  if (!isDailyKey(date)) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  res.json(daily.leaderboard(date));
});

app.post("/api/daily", (req, res) => {
  const result = daily.submit(req.body);
  res.status("error" in result ? 400 : 200).json(result);
});

// Serve the React app in production; client-side routes fall back to index.html.
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io/")) return next();
    res.sendFile(path.join(FRONTEND_BUILD, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`Rhythm Royale server listening on ${PORT}`);
});
