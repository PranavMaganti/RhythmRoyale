import {
  DAILY_DIFFICULTIES,
  type DailyStanding,
  dailyKey,
  dailyNumber,
  dailyRhythms,
  dailyShareText,
  msUntilNextDaily,
  type Note,
  scoreAttempt,
  scoreEmoji,
} from "@rhythm-royale/common";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { formatDuration, useSecondsLeft } from "../components/Countdown";
import RhythmCompare from "../components/RhythmCompare";
import RoundPlayer from "../components/RoundPlayer";
import Shell from "../components/Shell";
import { backendUrl, OFFLINE } from "../config";
import { unlockAudio } from "../lib/audio";
import { load, loadName, playerToken, save, saveName } from "../lib/storage";

export interface DailyProgress {
  attempts: Note[][];
  scores: number[];
  standing?: DailyStanding;
}

interface Streak {
  last: string;
  count: number;
  best: number;
}

const ROUNDS = DAILY_DIFFICULTIES.length;

function previousDay(key: string): string {
  return dailyKey(new Date(Date.parse(`${key}T00:00:00Z`) - 24 * 60 * 60 * 1000));
}

function recordStreak(key: string): Streak {
  const streak = load<Streak>("streak", { last: "", count: 0, best: 0 });
  if (streak.last === key) return streak;
  const count = streak.last === previousDay(key) ? streak.count + 1 : 1;
  const next = { last: key, count, best: Math.max(streak.best, count) };
  save("streak", next);
  return next;
}

export default function Daily() {
  const key = useMemo(() => dailyKey(), []);
  const rhythms = useMemo(() => dailyRhythms(key), [key]);
  const storageKey = `daily:${key}`;
  const [progress, setProgress] = useState<DailyProgress>(() =>
    load<DailyProgress>(storageKey, { attempts: [], scores: [] }),
  );
  // Rounds are self-paced: after each one, show how it went until the player moves on.
  const [stage, setStage] = useState<"intro" | "playing" | "review">(
    progress.scores.length > 0 && progress.scores.length < ROUNDS ? "review" : "intro",
  );
  const [name, setName] = useState(loadName());
  const [streak, setStreak] = useState<Streak | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareText, setShowShareText] = useState(false);

  const done = progress.scores.length === ROUNDS;
  const current = progress.scores.length;

  const update = useCallback(
    (next: DailyProgress) => {
      setProgress(next);
      save(storageKey, next);
    },
    [storageKey],
  );

  const onComplete = useCallback(
    (notes: Note[]) => {
      const score = scoreAttempt(rhythms[current], notes).score;
      update({
        attempts: [...progress.attempts, notes],
        scores: [...progress.scores, score],
      });
      setStage("review");
    },
    [current, progress, rhythms, update],
  );

  // Once finished, post the taps for server-side scoring and a percentile.
  useEffect(() => {
    if (!done) return;
    setStreak(recordStreak(key));
    if (progress.standing || OFFLINE) return;
    let cancelled = false;
    fetch(`${backendUrl}/api/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: key,
        token: playerToken(),
        name: loadName() || "Player",
        attempts: progress.attempts,
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((standing: DailyStanding) => {
        if (!cancelled) update({ ...progress, standing });
      })
      .catch(() => !cancelled && setSubmitError(true));
    return () => {
      cancelled = true;
    };
  }, [done, key, progress, update]);

  const start = async () => {
    saveName(name);
    await unlockAudio().catch(() => undefined);
    setStage("playing");
  };

  const nextDailyAt = useMemo(() => (done ? Date.now() + msUntilNextDaily() : null), [done]);
  const nextIn = useSecondsLeft(nextDailyAt);
  const total = progress.scores.reduce((a, b) => a + b, 0);
  // The offline build can be opened from anywhere, so its address isn't worth sharing.
  const shareText = dailyShareText(
    key,
    progress.scores,
    OFFLINE ? undefined : `${window.location.origin}/daily`,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
    } catch {
      // Clipboard refused (some embedded views): show the text to copy by hand.
      setShowShareText(true);
    }
  };

  const share = async () => {
    if (!navigator.share || OFFLINE) return copy();
    try {
      await navigator.share({ text: shareText });
    } catch (e) {
      // Dismissing the share sheet is fine; anything else falls back to copying.
      if ((e as Error).name !== "AbortError") await copy();
    }
  };

  const emojiRow = (
    <p
      className="emoji-row"
      role="img"
      aria-label={`Scores: ${progress.scores.join(", ") || "none yet"}`}
    >
      {progress.scores.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one fixed slot per melody
        <span key={i} title={`${s}%`}>
          {scoreEmoji(s)}
        </span>
      ))}
      {Array.from({ length: ROUNDS - progress.scores.length }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one fixed slot per melody
        <span key={`todo-${i}`}>⬜</span>
      ))}
    </p>
  );

  if (done) {
    const standing = progress.standing;
    return (
      <Shell wide>
        <section className="results">
          <div className="result-banner result-banner--safe">
            <p className="muted">Daily #{dailyNumber(key)}</p>
            <h1>
              {total}
              <span className="muted">/{ROUNDS * 100}</span>
            </h1>
            {emojiRow}
            {standing && standing.players > 1 && (
              <p>
                You beat <strong>{standing.percentile}%</strong> of {standing.players} players today
                (rank #{standing.rank})
              </p>
            )}
            {streak && (
              <p className="muted">
                🔥 {streak.count}-day streak · best {streak.best}
              </p>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn btn--primary" onClick={share}>
              {copied ? "Copied!" : OFFLINE ? "Copy result" : "Share result"}
            </button>
            <Link className="btn btn--ghost" to="/royale">
              Play Battle Royale
            </Link>
          </div>
          {showShareText && (
            <textarea
              className="share-text"
              readOnly
              rows={3}
              value={shareText}
              aria-label="Your result, ready to copy"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          {submitError && (
            <p className="muted small center">
              Couldn&apos;t reach the leaderboard. Your score is saved on this device.
            </p>
          )}
          {standing && standing.top.length > 0 && (
            <table className="scoreboard">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Today&apos;s best</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {standing.top.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rank is the identity here
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{e.name}</td>
                    <td className="num">{e.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 className="section-title">Your melodies</h2>
          {rhythms.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the day's melodies never reorder
            <div key={i} className="daily-review">
              <p>
                Melody {i + 1} · <strong>{progress.scores[i]}%</strong>
              </p>
              <RhythmCompare rhythm={r} attempt={progress.attempts[i] ?? []} />
            </div>
          ))}
          <p className="muted center">Next daily in {formatDuration(nextIn * 1000)}</p>
        </section>
      </Shell>
    );
  }

  if (stage === "playing") {
    return (
      <Shell>
        <RoundPlayer
          key={current}
          rhythm={rhythms[current]}
          onComplete={onComplete}
          heading={
            <>
              Daily #{dailyNumber(key)} · Melody {current + 1} of {ROUNDS}
            </>
          }
        />
      </Shell>
    );
  }

  if (stage === "review") {
    const last = current - 1;
    return (
      <Shell wide>
        <section className="results">
          <div className="result-banner">
            <p className="muted">
              Melody {last + 1} of {ROUNDS}
            </p>
            <h1>{progress.scores[last]}%</h1>
            {emojiRow}
          </div>
          <RhythmCompare rhythm={rhythms[last]} attempt={progress.attempts[last]} />
          <div className="actions">
            <button type="button" className="btn btn--primary" onClick={start}>
              Next melody →
            </button>
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="card center">
        <p className="muted">Daily challenge</p>
        <h1>#{dailyNumber(key)}</h1>
        <p className="muted">
          Five melodies, the same for everyone today, each harder than the last, ending with all
          four notes. You get <strong>one attempt</strong> at each, so make it count.
        </p>
        {emojiRow}
        <label className="field">
          <span>Name for the leaderboard</span>
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" className="btn btn--primary" onClick={start}>
          {current === 0 ? "Start" : "Continue"}
        </button>
      </section>
    </Shell>
  );
}
