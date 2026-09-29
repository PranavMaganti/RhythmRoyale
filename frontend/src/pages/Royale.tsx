import type { GameOver, LobbyState, Note, RoundResults, RoundStart } from "@rhythm-royale/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
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
  const { code: linkCode } = useParams();
  const [params] = useSearchParams();
  const mode = params.get("mode");
  const [conn, setConn] = useState<GameConnection>(() =>
    OFFLINE ? localConnection() : socketConnection(),
  );
  const [name, setName] = useState(loadName());
  const [view, setView] = useState<View>("join");
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const viewRef = useRef<View>("join");
  viewRef.current = view;
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<{ state: LobbyState; startsAt: number | null } | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The private room we're in, so "play again" goes back to the same one. */
  const roomCode = useRef<string | null>(linkCode?.toUpperCase() ?? null);
  const [round, setRound] = useState<RoundStart | null>(null);
  const [progress, setProgress] = useState<{ submitted: number; waitingFor: number } | null>(null);
  const [results, setResults] = useState<{ data: RoundResults; nextAt: number } | null>(null);
  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const gameOverRef = useRef<GameOver | null>(null);
  gameOverRef.current = gameOver;
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
    setRoomError(null);
    setView("connecting");
  }, []);

  useEffect(() => {
    conn.onStatus((status) => {
      setReconnecting(status === "reconnecting");
      if (status === "connected") {
        setError(null);
      } else if (status === "unreachable") {
        setError("Can't reach the game server.");
      } else if (status === "lost") {
        setError(null);
        // Only matters if we were in the middle of something.
        const finished = viewRef.current === "results" && gameOverRef.current;
        if (viewRef.current !== "join" && !finished) {
          setRoomError("You were away too long and lost your place. Join again below.");
          setView("join");
        }
      }
    });
    conn.on("welcome", ({ playerId }) => {
      idRef.current = playerId;
      setPlayerId(playerId);
    });
    conn.on("lobby", (state) => {
      setLobby({
        state,
        startsAt: state.startsInMs === null ? null : Date.now() + state.startsInMs,
      });
      setView("lobby");
      if (state.code) {
        roomCode.current = state.code;
        // Put the invite link in the address bar, so a refresh rejoins the room.
        const path = `/r/${state.code}`;
        if (!OFFLINE && window.location.pathname !== path) {
          window.history.replaceState(null, "", path);
        }
      }
    });
    conn.on("room_error", (message) => {
      setRoomError(message);
      setView("join");
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

  const begin = useCallback(async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    reset();
  }, [name, reset]);

  const join = useCallback(async () => {
    await begin();
    roomCode.current = null;
    conn.queue(name);
  }, [begin, conn, name]);

  const createRoom = useCallback(async () => {
    await begin();
    conn.createRoom(name);
  }, [begin, conn, name]);

  const joinRoom = useCallback(
    async (code: string) => {
      await begin();
      conn.joinRoom(code, name);
    },
    [begin, conn, name],
  );

  /** Back to the same private room, or into another public lobby. */
  const playAgain = useCallback(() => {
    if (roomCode.current && !conn.offline) joinRoom(roomCode.current);
    else join();
  }, [conn, join, joinRoom]);

  const playOffline = useCallback(async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    reset();
    queueOnConnect.current = true;
    setConn(localConnection());
  }, [name, reset]);

  // Coming from the home screen the audio is already unlocked, so skip straight
  // in. An invite link needs a tap first (for the name, and to allow sound).
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current || !name || !audioReady()) return;
    const action = conn.offline
      ? join
      : linkCode
        ? null
        : mode === "quick"
          ? join
          : mode === "private"
            ? createRoom
            : null;
    if (action) {
      autoJoined.current = true;
      action();
    }
  }, [conn, createRoom, join, linkCode, mode, name]);

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
  const inviteLink = lobby?.state.code ? `${window.location.origin}/r/${lobby.state.code}` : "";
  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const canShare = typeof navigator.share === "function";
  const shareInvite = () =>
    navigator
      .share({ title: "Rhythm Royale", text: "Join my Rhythm Royale room", url: inviteLink })
      .catch(() => undefined);
  const nextSeconds = useSecondsLeft(results && view === "results" ? results.nextAt : null);

  const connectionBanner = error && (
    <div className="banner banner--error">
      <span>{error}</span>
      <button type="button" className="btn btn--small" onClick={playOffline}>
        Play offline against bots
      </button>
    </div>
  );

  const errorBanner = (error || roomError || reconnecting) && (
    <>
      {reconnecting && <div className="banner pulse">Connection dropped. Reconnecting…</div>}
      {roomError && <div className="banner banner--error">{roomError}</div>}
      {error && connectionBanner}
    </>
  );

  if (view === "join") {
    const nameField = (
      <label className="field">
        <span>Nickname</span>
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      </label>
    );

    if (linkCode && !conn.offline) {
      const code = linkCode.toUpperCase();
      return (
        <Shell>
          {errorBanner}
          <section className="card center">
            <p className="muted">You're invited to a private room</p>
            <h1 className="room-code">{code}</h1>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                joinRoom(code);
              }}
            >
              {nameField}
              <button className="btn btn--primary" type="submit">
                Join room
              </button>
            </form>
            <p className="small">
              <Link to="/royale">Or play somewhere else</Link>
            </p>
          </section>
        </Shell>
      );
    }

    if (conn.offline) {
      return (
        <Shell>
          {errorBanner}
          <section className="card center">
            <h1>Battle Royale</h1>
            <p className="muted">
              You against nine bots, right here in your browser. The tunes use more notes each
              round, up to four.
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              {nameField}
              <button className="btn btn--primary" type="submit">
                Start
              </button>
            </form>
          </section>
        </Shell>
      );
    }

    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <h1>Battle Royale</h1>
          <p className="muted">
            Hear a tune, play it back, and outlast everyone. The tunes use more notes each round, up
            to four.
          </p>
          <div className="stack">
            {nameField}
            <button className="btn btn--primary" type="button" onClick={join}>
              Quick match
            </button>
            <p className="muted small choice-note">
              A public lobby. After a short countdown, bots fill the empty seats.
            </p>
            <button className="btn btn--ghost" type="button" onClick={createRoom}>
              Create a private room
            </button>
            <p className="muted small choice-note">
              Get an invite link for friends and start when you're ready, with or without bots.
            </p>
          </div>
        </section>
      </Shell>
    );
  }

  if (view === "connecting" || !lobby) {
    return (
      <Shell>
        {errorBanner}
        <p className="center muted pulse">
          {linkCode || mode === "private" ? "Opening the room…" : "Finding a lobby…"}
        </p>
      </Shell>
    );
  }

  if (view === "lobby" && lobby.state.code) {
    const { players, maxPlayers, hostId, bots, code } = lobby.state;
    const isHost = hostId === playerId;
    const host = players.find((p) => p.id === hostId);
    const empty = Math.max(0, maxPlayers - players.length);
    const blocker =
      !bots && players.length < 2 ? "Without bots you need at least one more player." : null;
    return (
      <Shell>
        {errorBanner}
        <section className="card center">
          <p className="muted">Private room</p>
          <h1 className="room-code">{code}</h1>
          <div className="invite">
            <input
              className="invite-link"
              readOnly
              value={inviteLink}
              aria-label="Invite link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="invite-actions">
              <button type="button" className="btn btn--small" onClick={copyInvite}>
                {copied ? "Copied!" : "Copy link"}
              </button>
              {canShare && (
                <button type="button" className="btn btn--small btn--ghost" onClick={shareInvite}>
                  Share…
                </button>
              )}
            </div>
          </div>

          <p className="muted">
            {players.length} of {maxPlayers} players
          </p>
          <ul className="seats">
            {players.map((p) => (
              <li key={p.id} className={p.id === playerId ? "seat seat--me" : "seat"}>
                {p.id === hostId && (
                  <span className="host-mark" title="Host">
                    ♛{" "}
                  </span>
                )}
                {p.name}
                {p.id === playerId && " (you)"}
              </li>
            ))}
          </ul>

          {isHost ? (
            <div className="stack room-controls">
              <fieldset className="chips">
                <legend className="muted small">Empty seats</legend>
                <button
                  type="button"
                  aria-pressed={bots}
                  className={`chip chip--wide${bots ? " chip--on" : ""}`}
                  onClick={() => conn.setBots(true)}
                >
                  Fill with bots
                </button>
                <button
                  type="button"
                  aria-pressed={!bots}
                  className={`chip chip--wide${bots ? "" : " chip--on"}`}
                  onClick={() => conn.setBots(false)}
                >
                  No bots
                </button>
              </fieldset>
              <p className="muted small">
                {bots
                  ? `${empty} bot${empty === 1 ? "" : "s"} will join when you start.`
                  : "Only the people in this room will play."}
              </p>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!!blocker}
                onClick={() => conn.startRoom()}
              >
                Start game
              </button>
              {blocker && <p className="muted small">{blocker}</p>}
            </div>
          ) : (
            <p className="muted pulse">
              Waiting for {host?.name ?? "the host"} to start.{" "}
              {bots ? "Bots will fill the empty seats." : "No bots this time."}
            </p>
          )}
        </section>
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
            <p className="muted small">
              Want to play with friends?{" "}
              <button type="button" className="link-button" onClick={createRoom}>
                Create a private room
              </button>
            </p>
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
            <button type="button" className="btn btn--primary" onClick={playAgain}>
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
            <button type="button" className="btn btn--primary" onClick={playAgain}>
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
