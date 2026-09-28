import {
  beatMs,
  COUNT_IN_BEATS,
  LEAD_IN_MS,
  Note,
  Rhythm,
  rhythmLengthMs,
} from "@rhythm-royale/common";
import { ReactNode, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { useTapRecorder } from "../hooks/useTapRecorder";
import { createInstruments, Instruments, NOTE_PITCH } from "../lib/audio";
import RhythmLane from "./RhythmLane";

type Phase = "listen" | "prepare" | "record" | "done";

interface Props {
  rhythm: Rhythm;
  onComplete: (notes: Note[]) => void;
  /** Shown above the pad, e.g. "Round 3 · 7 players left". */
  heading?: ReactNode;
}

/**
 * One full round: a count-in and the phrase, then a count-in and the player's
 * attempt. Everything is scheduled on the audio clock so the metronome, the
 * phrase and the recording window all line up.
 */
export default function RoundPlayer({ rhythm, onComplete, heading }: Props) {
  const [phase, setPhase] = useState<Phase>("listen");
  const [count, setCount] = useState<number | null>(null);
  const [lit, setLit] = useState(false);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const instruments = useRef<Instruments | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const beat = beatMs(rhythm.bpm);
  const recording = phase === "prepare" || phase === "record";
  const recorder = useTapRecorder({
    enabled: recording,
    earlyToleranceMs: beat / 2,
    onPress: () => instruments.current?.echo.triggerAttack(NOTE_PITCH),
    onRelease: () => instruments.current?.echo.triggerRelease(),
  });
  const { arm, finish } = recorder;

  useEffect(() => {
    const inst = createInstruments();
    instruments.current = inst;
    const ctx = Tone.getContext();
    const b = beatMs(rhythm.bpm) / 1000;
    let cancelled = false;
    const draw = (time: number, fn: () => void) =>
      Tone.Draw.schedule(() => !cancelled && fn(), time);
    const toPerf = (time: number) => performance.now() + (time - ctx.currentTime) * 1000;

    const countIn = (from: number) => {
      for (let i = 0; i < COUNT_IN_BEATS; i++) {
        inst.click.triggerAttackRelease(i === 0 ? "C4" : "G3", "32n", from + i * b);
        draw(from + i * b, () => setCount(COUNT_IN_BEATS - i));
      }
    };
    const metronome = (from: number) => {
      for (let i = 0; i < rhythm.beats; i++) {
        inst.click.triggerAttackRelease("G2", "32n", from + i * b, 0.5);
      }
    };

    // Listen: count-in, then the phrase.
    const listenStart = Tone.now() + LEAD_IN_MS / 1000;
    countIn(listenStart);
    const phraseStart = listenStart + COUNT_IN_BEATS * b;
    draw(phraseStart, () => setCount(null));
    metronome(phraseStart);
    rhythm.notes.forEach((n) => {
      const at = phraseStart + n.start / 1000;
      inst.voice.triggerAttackRelease(NOTE_PITCH, n.duration / 1000, at);
      draw(at, () => setLit(true));
      draw(at + n.duration / 1000, () => setLit(false));
    });

    // Record: count-in, then the player's turn.
    const prepareStart = phraseStart + (rhythm.beats + 1) * b;
    draw(prepareStart, () => setPhase("prepare"));
    countIn(prepareStart);
    const origin = prepareStart + COUNT_IN_BEATS * b;
    const end = origin + (rhythm.beats + 1) * b;
    const originPerf = toPerf(origin);
    arm(originPerf);
    draw(origin, () => {
      setCount(null);
      setPhase("record");
    });
    metronome(origin);

    let frame = 0;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - originPerf;
      setPlayhead(elapsed >= 0 ? elapsed : undefined);
      frame = requestAnimationFrame(tick);
    };
    const tickTimer = setTimeout(tick, Math.max(0, originPerf - performance.now()));

    const doneTimer = setTimeout(() => {
      cancelled = true;
      cancelAnimationFrame(frame);
      const notes = finish();
      setPhase("done");
      onCompleteRef.current(notes);
    }, Math.max(0, toPerf(end) - performance.now()));

    return () => {
      cancelled = true;
      clearTimeout(tickTimer);
      clearTimeout(doneTimer);
      cancelAnimationFrame(frame);
      instruments.current = null;
      inst.dispose();
    };
  }, [rhythm, arm, finish]);

  const headline = {
    listen: count !== null ? "Listen…" : "Listen",
    prepare: "Your turn",
    record: "Go!",
    done: "Nice!",
  }[phase];
  const hint = {
    listen: "Memorise the rhythm — one tone per press, held for as long as it sounds.",
    prepare: "Get ready to play it back.",
    record: "Hold SPACE or the pad for each note.",
    done: "Scoring…",
  }[phase];

  const lengthMs = rhythmLengthMs(rhythm) + beat;
  const padOn = phase === "listen" ? lit : recorder.isDown;

  return (
    <div className="round">
      {heading && <div className="round-heading">{heading}</div>}
      <h2 className={`round-headline round-headline--${phase}`}>{headline}</h2>
      <p className="muted round-hint">{hint}</p>
      <button
        type="button"
        className={`pad pad--${phase}${padOn ? " pad--on" : ""}`}
        aria-label="Tap pad: hold for each note"
        tabIndex={-1}
        {...recorder.padHandlers}
      >
        <span className="pad-count">{count ?? ""}</span>
      </button>
      <RhythmLane
        label={recording ? "You" : undefined}
        notes={recorder.notes.map((n) => ({ ...n, tone: "live" }))}
        lengthMs={lengthMs}
        beatMs={beat}
        playheadMs={phase === "record" ? playhead : undefined}
      />
    </div>
  );
}
