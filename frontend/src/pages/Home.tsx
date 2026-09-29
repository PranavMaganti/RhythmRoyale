import { DAILY_DIFFICULTIES, dailyKey, dailyNumber } from "@rhythm-royale/common";
import { useState } from "react";
import { useNavigate } from "react-router";
import Shell from "../components/Shell";
import { StaffDoodle } from "../components/Sketch";
import { OFFLINE } from "../config";
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
        <StaffDoodle />
        <h1 className="hero-title">
          Hear it. <span className="accent">Play it.</span> Outlast everyone.
        </h1>
        <p className="muted hero-sub">
          Each round plays a short melody. Play it back as precisely as you can. The least accurate
          players are knocked out, and the tunes use more notes each round, up to four.
        </p>
        <label className="field">
          <span>Nickname</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go("/royale");
            }}
          />
        </label>
      </section>

      <section className="modes">
        <button type="button" className="mode mode--primary" onClick={() => go("/royale")}>
          <span className="mode-title">Battle Royale</span>
          <span className="mode-desc">
            {OFFLINE
              ? "You against nine bots. Last one standing wins."
              : "Up to 10 players. Bots fill the empty seats. Last one standing wins."}
          </span>
        </button>
        <button type="button" className="mode" onClick={() => go("/daily")}>
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
        <button type="button" className="mode" onClick={() => go("/practice")}>
          <span className="mode-title">Practice</span>
          <span className="mode-desc">Pick a difficulty and replay as often as you like.</span>
        </button>
      </section>

      <section className="howto">
        <h2>How to play</h2>
        <ol>
          <li>
            <strong>Listen.</strong> When there&apos;s more than one note, you first hear each one
            from low to high. Then four clicks count you in and the melody plays once.
          </li>
          <li>
            <strong>Play it back.</strong> After another count-in, hold each note&apos;s key for as
            long as it sounded. On a phone, hold the pads with your thumbs: do, re, mi and sol, low
            to high. On a keyboard, use <kbd>Space</kbd> for one note, then <kbd>D</kbd>{" "}
            <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd>.
          </li>
          <li>
            <strong>Survive.</strong> Timing matters most, then pressing the right note, then how
            long you hold it. A steady delay from your headphones or device isn&apos;t held against
            you.
          </li>
        </ol>
        <p className="muted small">
          Tip: use wired headphones, and turn off silent mode on iPhone.
        </p>
      </section>
    </Shell>
  );
}
