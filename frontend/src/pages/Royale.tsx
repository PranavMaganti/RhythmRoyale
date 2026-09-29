import type { GameOver, LobbyState, Note, RoundResults, RoundStart } from "@rhythm-royale/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useSecondsLeft } from "../components/Countdown";
import RhythmCompare from "../components/RhythmCompare";
import RoundPlayer from "../components/RoundPlayer";
import Shell from "../components/Shell";
import { OFFLINE } from "../config";
import { audioReady, unlockAudio } from "../lib/audio";
import { type GameConnection, localConnection, socketConnection } from "../lib/connection";
import { loadName, saveName } from "../lib/storage";

type View = "join" | "connecting" | "lobby" | "playing" | "waiting" | "results" | "spectating";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function Royale() {
  const [conn, setConn] = useState<GameConnection>(() =>
    OFFLINE ? localConnection() : socketConnection(),
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
  const nameRef = useRef(name);
  nameRef.current = name;
  /** Set when switching to offline play, so the new connection queues straight away. */
  const queueOnConnect = useRef(false);

  const reset = useCallback(() => {
    attempts.current = {};
    outRef.current = false;
    setOut(false);
    setGameOver(null);
    setResults(null);
    setRound(null);
    setLobby(null);
    setError(null);
    setView("connecting");
  }, []);

  useEffect(() => {
    conn.onError((message) => {
      setError(message);
      if (message) setView((v) => (v === "connecting" ? v : "join"));
    });
    conn.on("welcome", ({ playerId }) => {
      idRef.current = playerId;
      setPlayerId(playerId);
    });
    conn.on("lobby", (state) => {
      setLobby({ state, startsAt: Date.now() + state.startsInMs });
      setView("lobby");
    });
    conn.on("round_start", (r) => {
      setRound(r);
      setProgress(null);
      setView(outRef.current ? "spectating" : "playing");
    });
    conn.on("submissions", setProgress);
    conn.on("round_results", (data) => {
      setResults({ data, nextAt: Date.now() + data.nextRoundInMs });
      const me = data.results.find((r) => r.id === idRef.current);
      if (me?.eliminated) {
        outRef.current = true;
        setOut(true);
      }
      setView("results");
    });
    conn.on("game_over", setGameOver);
    if (queueOnConnect.current) {
      queueOnConnect.current = false;
      conn.queue(nameRef.current);
    }
    return () => conn.close();
  }, [conn]);

  const join = useCallback(async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    reset();
    conn.queue(name);
  }, [conn, name, reset]);

  const playOffline = useCallback(async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    reset();
    queueOnConnect.current = true;
    setConn(localConnection());
  }, [name, reset]);

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
      conn.submit({ round: round.round, notes });
      setView("waiting");
    },
    [round, conn],
  );

  const lobbySeconds = useSecondsLeft(view === "lobby" && lobby ? lobby.startsAt : null);
  const nextSeconds = useSecondsLeft(results && view === "results" ? results.nextAt : null);

  const errorBanner = error && (
    <div className="banner banner--error">
      <span>{error}</span>
      <button type="button" className="btn btn--small" onClick={playOffline}>
        Play offline against bots
      </button>
    </div>
  );

  if (view === "join") {
    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <h1>Battle Royale</h1>
          <p className="muted">
            {conn.offline
              ? "You against nine bots, right here in your browser. The tunes use more notes each round, up to four."
              : "Join a lobby. When it fills up, or after a short wait, bots take the empty seats and the first melody plays. The tunes use more notes each round, up to four."}
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
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn btn--primary" type="submit">
              {conn.offline ? "Start" : "Find a match"}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: empty seats are interchangeable
              <li key={`empty-${i}`} className="seat seat--empty">
                Waiting…
              </li>
            ))}
          </ul>
          {!conn.offline && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/royale`)}
            >
              Copy invite link
            </button>
          )}
        </section>
      </Shell>
    );
  }

  const aliveLabel = round && `${round.aliveCount} of ${round.playerCount} left`;
  const roundLabel =
    round &&
    (round.round === round.totalRounds
      ? "Final round"
      : `Round ${round.round} of ${round.totalRounds}`);

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
              {roundLabel} · <span className="muted">{aliveLabel}</span>
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
          <h2>{view === "waiting" ? "Scoring…" : `${roundLabel} in progress`}</h2>
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
            <button type="button" className="btn btn--primary" onClick={join}>
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
            <button type="button" className="btn btn--primary" onClick={join}>
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
