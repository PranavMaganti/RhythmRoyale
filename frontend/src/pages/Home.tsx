import { dailyKey, DAILY_DIFFICULTIES, dailyNumber } from "@rhythm-royale/common";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Shell from "../components/Shell";
import { unlockAudio } from "../lib/audio";
import { load, loadName, saveName } from "../lib/storage";
import type { DailyProgress } from "./Daily";

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName());
  const today = dailyKey();
  const daily = load<DailyProgress | null>(`daily:${today}`, null);
  const dailyDone = daily?.scores.length === DAILY_DIFFICULTIES.length;
  const dailyTotal = daily?.scores.reduce((a, b) => a + b, 0) ?? 0;

  const go = async (path: string) => {
    saveName(name);
    // Clicking is the user gesture browsers require before they will play sound.
    await unlockAudio().catch(() => undefined);
    navigate(path);
  };

  return (
    <Shell>
      <section className="hero">
        <h1 className="hero-title">
          Hear it. <span className="accent">Tap it.</span> Outlast everyone.
        </h1>
        <p className="muted hero-sub">
          Each round plays a short rhythm. Tap it back as precisely as you can. The least accurate
          players are knocked out until one is left standing.
        </p>
        <label className="field">
          <span>Nickname</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go("/royale")}
          />
        </label>
      </section>

      <section className="modes">
        <button className="mode mode--primary" onClick={() => go("/royale")}>
          <span className="mode-title">Battle Royale</span>
          <span className="mode-desc">
            Up to 10 players. Bots fill the empty seats. Last one standing wins.
          </span>
        </button>
        <button className="mode" onClick={() => go("/daily")}>
          <span className="mode-title">
            Daily #{dailyNumber(today)}
            {dailyDone && (
              <span className="badge">
                {dailyTotal}/{DAILY_DIFFICULTIES.length * 100}
              </span>
            )}
          </span>
          <span className="mode-desc">
            {dailyDone
              ? "Done for today. See how you compare and share your result."
              : "Five rhythms, the same for everyone, one attempt each."}
          </span>
        </button>
        <button className="mode" onClick={() => go("/practice")}>
          <span className="mode-title">Practice</span>
          <span className="mode-desc">Pick a difficulty and replay as often as you like.</span>
        </button>
      </section>

      <section className="howto">
        <h2>How to play</h2>
        <ol>
          <li>
            <strong>Listen.</strong> Four clicks count you in, then the rhythm plays once.
          </li>
          <li>
            <strong>Play it back.</strong> After another count-in, hold <kbd>Space</kbd> (or the pad
            on a phone) for each note, as long as it sounded.
          </li>
          <li>
            <strong>Survive.</strong> Timing matters most, note length a little. A steady delay from
            your headphones or device isn&apos;t held against you.
          </li>
        </ol>
        <p className="muted small">
          Tip: use wired headphones, and turn off silent mode on iPhone.
        </p>
      </section>
    </Shell>
  );
}
