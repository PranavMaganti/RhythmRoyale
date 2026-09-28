import {
  ClientToServerEvents,
  GameOver,
  LobbyState,
  Note,
  RoundResults,
  RoundStart,
  ServerToClientEvents,
} from "@rhythm-royale/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { useSecondsLeft } from "../components/Countdown";
import RhythmCompare from "../components/RhythmCompare";
import RoundPlayer from "../components/RoundPlayer";
import Shell from "../components/Shell";
import { backendUrl } from "../config";
import { audioReady, unlockAudio } from "../lib/audio";
import { loadName, saveName } from "../lib/storage";

type View = "join" | "connecting" | "lobby" | "playing" | "waiting" | "results" | "spectating";
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function Royale() {
  const socket: GameSocket = useMemo(
    () => (backendUrl ? io(backendUrl, { autoConnect: false }) : io({ autoConnect: false })),
    []
  );
  const [name, setName] = useState(loadName());
  const [view, setView] = useState<View>("join");
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<{ state: LobbyState; startsAt: number } | null>(null);
  const [round, setRound] = useState<RoundStart | null>(null);
  const [progress, setProgress] = useState<{ submitted: number; waitingFor: number } | null>(null);
  const [results, setResults] = useState<{ data: RoundResults; nextAt: number } | null>(null);
  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const [out, setOut] = useState(false);
  const attempts = useRef<Record<number, Note[]>>({});
  const idRef = useRef<string | null>(null);
  const outRef = useRef(false);

  useEffect(() => {
    socket.on("connect_error", () => setError("Can't reach the game server. Retrying…"));
    socket.on("connect", () => setError(null));
    socket.on("welcome", ({ playerId }) => {
      idRef.current = playerId;
      setPlayerId(playerId);
    });
    socket.on("lobby", (state) => {
      setLobby({ state, startsAt: Date.now() + state.startsInMs });
      setView("lobby");
    });
    socket.on("round_start", (r) => {
      setRound(r);
      setProgress(null);
      setView(outRef.current ? "spectating" : "playing");
    });
    socket.on("submissions", setProgress);
    socket.on("round_results", (data) => {
      setResults({ data, nextAt: Date.now() + data.nextRoundInMs });
      const me = data.results.find((r) => r.id === idRef.current);
      if (me?.eliminated) {
        outRef.current = true;
        setOut(true);
      }
      setView("results");
    });
    socket.on("game_over", setGameOver);
    socket.on("disconnect", (reason) => {
      if (reason !== "io client disconnect") {
        setError("Lost connection to the game server.");
        setView("join");
      }
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  const join = useCallback(async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    attempts.current = {};
    outRef.current = false;
    setOut(false);
    setGameOver(null);
    setResults(null);
    setRound(null);
    setLobby(null);
    setView("connecting");
    if (!socket.connected) socket.connect();
    socket.emit("queue", name);
  }, [name, socket]);

  // Coming from the home screen the audio is already unlocked, so skip straight in.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!autoJoined.current && name && audioReady()) {
      autoJoined.current = true;
      join();
    }
  }, [join, name]);

  const onRoundComplete = useCallback(
    (notes: Note[]) => {
      if (!round) return;
      attempts.current[round.round] = notes;
      socket.emit("submit", { round: round.round, notes });
      setView("waiting");
    },
    [round, socket]
  );

  const lobbySeconds = useSecondsLeft(view === "lobby" && lobby ? lobby.startsAt : null);
  const nextSeconds = useSecondsLeft(results && view === "results" ? results.nextAt : null);

  const errorBanner = error && <div className="banner banner--error">{error}</div>;

  if (view === "join") {
    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <h1>Battle Royale</h1>
          <p className="muted">
            Join a lobby. When it fills up, or after a short wait, bots take the empty seats and the
            first rhythm plays.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <label className="field">
              <span>Nickname</span>
              <input
                value={name}
                maxLength={16}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn--primary" type="submit">
              Find a match
            </button>
          </form>
        </section>
      </Shell>
    );
  }

  if (view === "connecting" || !lobby) {
    return (
      <Shell>
        {errorBanner}
        <p className="center muted pulse">Finding a lobby…</p>
      </Shell>
    );
  }

  if (view === "lobby") {
    const { players, maxPlayers } = lobby.state;
    const empty = Math.max(0, maxPlayers - players.length);
    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <h1>Lobby</h1>
          <p className="big-number">{lobbySeconds}</p>
          <p className="muted">
            {players.length} of {maxPlayers} players.{" "}
            {empty > 0 &&
              `${empty} empty seat${
                empty === 1 ? "" : "s"
              } will get a bot when the timer runs out.`}
          </p>
          <ul className="seats">
            {players.map((p) => (
              <li key={p.id} className={p.id === playerId ? "seat seat--me" : "seat"}>
                {p.name}
                {p.id === playerId && " (you)"}
              </li>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <li key={`empty-${i}`} className="seat seat--empty">
                Waiting…
              </li>
            ))}
          </ul>
          <button
            className="btn btn--ghost"
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/royale`)}
          >
            Copy invite link
          </button>
        </section>
      </Shell>
    );
  }

  const aliveLabel = round && `${round.aliveCount} of ${round.playerCount} left`;

  if (view === "playing" && round) {
    return (
      <Shell>
        {errorBanner}
        <RoundPlayer
          key={round.round}
          rhythm={round.rhythm}
          onComplete={onRoundComplete}
          heading={
            <>
              Round {round.round} · <span className="muted">{aliveLabel}</span>
            </>
          }
        />
      </Shell>
    );
  }

  if (view === "waiting" || view === "spectating") {
    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <h2>{view === "waiting" ? "Scoring…" : `Round ${round?.round} in progress`}</h2>
          <p className="muted pulse">
            {view === "waiting"
              ? progress && progress.waitingFor > 0
                ? `Waiting for ${progress.waitingFor} more player${
                    progress.waitingFor === 1 ? "" : "s"
                  }…`
                : "Waiting for the other players…"
              : `You're spectating. ${aliveLabel}.`}
          </p>
          {view === "spectating" && (
            <button className="btn btn--primary" onClick={join}>
              Play again
            </button>
          )}
        </section>
      </Shell>
    );
  }

  // Results (and the end of the game).
  const data = results?.data;
  const me = data?.results.find((r) => r.id === playerId);
  const myAttempt = data ? attempts.current[data.round] : undefined;
  const myFinal = gameOver?.standings.find((p) => p.id === playerId);
  const won = gameOver?.winner.id === playerId;

  return (
    <Shell wide>
      {errorBanner}
      <section className="results">
        {gameOver ? (
          <div className={`result-banner ${won ? "result-banner--win" : ""}`}>
            <h1>{won ? "Last one standing!" : `${gameOver.winner.name} wins`}</h1>
            {myFinal?.placement && (
              <p>
                You finished <strong>{ordinal(myFinal.placement)}</strong> of{" "}
                {gameOver.standings.length}
              </p>
            )}
          </div>
        ) : me ? (
          <div
            className={`result-banner ${
              me.eliminated ? "result-banner--out" : "result-banner--safe"
            }`}
          >
            <h1>{me.eliminated ? "Eliminated" : "You survived!"}</h1>
            <p>
              {me.score}% accuracy
              {me.placement && ` · finished ${ordinal(me.placement)}`}
            </p>
          </div>
        ) : (
          <div className="result-banner">
            <h1>Round {data?.round} results</h1>
          </div>
        )}

        {round && myAttempt && <RhythmCompare rhythm={round.rhythm} attempt={myAttempt} />}

        {data && (
          <table className="scoreboard">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r, i) => (
                <tr
                  key={r.id}
                  className={[r.eliminated ? "out" : "", r.id === playerId ? "me" : ""].join(" ")}
                >
                  <td>{i + 1}</td>
                  <td>
                    {r.name}
                    {r.isBot && (
                      <span className="tag" title="Computer player">
                        bot
                      </span>
                    )}
                    {r.eliminated && <span className="tag tag--out">out</span>}
                  </td>
                  <td className="num">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="actions">
          {!gameOver && !out && <p className="muted">Next round in {nextSeconds}s…</p>}
          {!gameOver && out && <p className="muted">You can keep watching or start a new match.</p>}
          {(gameOver || out) && (
            <button className="btn btn--primary" onClick={join}>
              Play again
            </button>
          )}
          <Link className="btn btn--ghost" to="/">
            Home
          </Link>
        </div>
      </section>
    </Shell>
  );
}
