import { generateRhythm, MAX_DIFFICULTY, Note, Rhythm, scoreAttempt } from "@rhythm-royale/common";
import { useState } from "react";
import RhythmCompare from "../components/RhythmCompare";
import RoundPlayer from "../components/RoundPlayer";
import Shell from "../components/Shell";
import { unlockAudio } from "../lib/audio";
import { load, save } from "../lib/storage";

export default function Practice() {
  const [difficulty, setDifficulty] = useState(() => load("practiceLevel", 1));
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  const [attempt, setAttempt] = useState<Note[] | null>(null);
  const [run, setRun] = useState(0);

  const play = async (next: Rhythm) => {
    await unlockAudio().catch(() => undefined);
    setRhythm(next);
    setAttempt(null);
    setRun((r) => r + 1);
  };

  const pickLevel = (level: number) => {
    setDifficulty(level);
    save("practiceLevel", level);
  };

  const levels = (
    <div className="chips" role="radiogroup" aria-label="Difficulty">
      {Array.from({ length: MAX_DIFFICULTY }, (_, i) => i + 1).map((level) => (
        <button
          key={level}
          role="radio"
          aria-checked={difficulty === level}
          className={`chip${difficulty === level ? " chip--on" : ""}`}
          onClick={() => pickLevel(level)}
        >
          {level}
        </button>
      ))}
    </div>
  );

  if (rhythm && !attempt) {
    return (
      <Shell>
        <RoundPlayer
          key={run}
          rhythm={rhythm}
          onComplete={setAttempt}
          heading={<>Practice · level {difficulty}</>}
        />
      </Shell>
    );
  }

  if (rhythm && attempt) {
    const { score } = scoreAttempt(rhythm, attempt);
    return (
      <Shell wide>
        <section className="results">
          <div className={`result-banner ${score >= 85 ? "result-banner--safe" : ""}`}>
            <p className="muted">Practice · level {difficulty}</p>
            <h1>{score}%</h1>
          </div>
          <RhythmCompare rhythm={rhythm} attempt={attempt} />
          <div className="actions">
            <button className="btn btn--ghost" onClick={() => play(rhythm)}>
              Try this one again
            </button>
            <button
              className="btn btn--primary"
              onClick={() => play(generateRhythm(difficulty))}
              autoFocus
            >
              New rhythm
            </button>
          </div>
          <div className="center">
            <p className="muted small">Difficulty</p>
            {levels}
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="card center">
        <h1>Practice</h1>
        <p className="muted">
          No pressure. Level 1 is a few slow notes; level {MAX_DIFFICULTY} is fast sixteenth-note
          phrases like the late rounds of a royale.
        </p>
        {levels}
        <button className="btn btn--primary" onClick={() => play(generateRhythm(difficulty))}>
          Start
        </button>
      </section>
    </Shell>
  );
}
