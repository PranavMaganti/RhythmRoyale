import {
  beatMs,
  COUNT_IN_BEATS,
  LEAD_IN_MS,
  type Note,
  padNames,
  pitchNames,
  REFERENCE_NOTE_MS,
  REFERENCE_STEP_MS,
  type Rhythm,
  referenceMs,
  rhythmLengthMs,
} from "@rhythm-royale/common";
import { type ReactNode, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { useTapRecorder } from "../hooks/useTapRecorder";
import { createInstruments, type Instruments } from "../lib/audio";
import { isTouchDevice, keyLabel, laneKeys } from "../lib/keys";
import RhythmLane from "./RhythmLane";

type Phase = "preview" | "listen" | "prepare" | "record" | "done";

interface Props {
  rhythm: Rhythm;
  onComplete: (notes: Note[]) => void;
  /** Shown above the pads, e.g. "Round 3 · 7 players left". */
  heading?: ReactNode;
}

const HEADLINES: Record<Phase, string> = {
  preview: "Your notes",
  listen: "Listen",
  prepare: "Your turn",
  record: "Go!",
  done: "Nice!",
};

/**
 * One full round: a preview of the available pitches, a count-in and the
 * phrase, then a count-in and the player's attempt. Everything is scheduled
 * on the audio clock so the metronome, the phrase and the recording window
 * all line up.
 */
export default function RoundPlayer({ rhythm, onComplete, heading }: Props) {
  const multi = rhythm.pitches > 1;
  const [phase, setPhase] = useState<Phase>(multi ? "preview" : "listen");
  const [count, setCount] = useState<number | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const instruments = useRef<Instruments | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const names = pitchNames(rhythm.pitches);
  const beat = beatMs(rhythm.bpm);
  const recording = phase === "prepare" || phase === "record";
  const recorder = useTapRecorder({
    enabled: recording,
    pitches: rhythm.pitches,
    earlyToleranceMs: beat / 2,
    onPress: (lane) => {
      instruments.current?.echo.triggerAttack(names[lane]);
      // A tiny buzz confirms the press on phones that support it (not iOS).
      navigator.vibrate?.(8);
    },
    onRelease: (lane) => instruments.current?.echo.triggerRelease(names[lane]),
  });
  const { arm, finish } = recorder;

  useEffect(() => {
    const inst = createInstruments();
    instruments.current = inst;
    const ctx = Tone.getContext();
    const drawer = Tone.getDraw();
    const notes = pitchNames(rhythm.pitches);
    const b = beatMs(rhythm.bpm) / 1000;
    let cancelled = false;
    const draw = (time: number, fn: () => void) => drawer.schedule(() => !cancelled && fn(), time);
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

    // Preview: each key's pitch, low to high, so players know what to listen for.
    const start = Tone.now() + LEAD_IN_MS / 1000;
    if (rhythm.pitches > 1) {
      notes.forEach((name, lane) => {
        const at = start + (lane * REFERENCE_STEP_MS) / 1000;
        inst.voice.triggerAttackRelease(name, REFERENCE_NOTE_MS / 1000, at);
        draw(at, () => setLit(lane));
        draw(at + REFERENCE_NOTE_MS / 1000, () => setLit(null));
      });
    }

    // Listen: count-in, then the phrase.
    const listenStart = start + referenceMs(rhythm.pitches) / 1000;
    draw(listenStart, () => setPhase("listen"));
    countIn(listenStart);
    const phraseStart = listenStart + COUNT_IN_BEATS * b;
    draw(phraseStart, () => setCount(null));
    metronome(phraseStart);
    for (const n of rhythm.notes) {
      const at = phraseStart + n.start / 1000;
      inst.voice.triggerAttackRelease(notes[n.pitch] ?? notes[0], n.duration / 1000, at);
      draw(at, () => setLit(n.pitch));
      draw(at + n.duration / 1000, () => setLit(null));
    }

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

    const doneTimer = setTimeout(
      () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        const notes = finish();
        setPhase("done");
        onCompleteRef.current(notes);
      },
      Math.max(0, toPerf(end) - performance.now()),
    );

    return () => {
      cancelled = true;
      clearTimeout(tickTimer);
      clearTimeout(doneTimer);
      cancelAnimationFrame(frame);
      instruments.current = null;
      inst.dispose();
    };
  }, [rhythm, arm, finish]);

  const keys = laneKeys(rhythm.pitches);
  const labels = padNames(rhythm.pitches);
  const touch = isTouchDevice();
  const keyList = keys.map(keyLabel).join(" ");
  const hints: Record<Phase, string> = {
    preview: touch
      ? "Here are your four notes, low to high."
      : `Here are your four notes, low to high: ${keyList}.`,
    listen: multi
      ? "Memorise the tune: which note, when, and for how long."
      : "Memorise the rhythm: one tone per press, held for as long as it sounds.",
    prepare: "Get ready to play it back.",
    record: touch
      ? `Hold ${multi ? "a pad" : "the pad"} for each note, as long as it sounded.`
      : multi
        ? `Hold ${keyList} (or tap the pads) for each note.`
        : "Hold SPACE or the pad for each note.",
    done: "Scoring…",
  };

  const lengthMs = rhythmLengthMs(rhythm) + beat;
  const isLit = (lane: number) =>
    phase === "preview" || phase === "listen" ? lit === lane : recorder.held.has(lane);

  return (
    <div className="round">
      <div className="round-top">
        {heading && <div className="round-heading">{heading}</div>}
        <h2 className={`round-headline round-headline--${phase}`}>{HEADLINES[phase]}</h2>
        <p className="muted round-hint">{hints[phase]}</p>
        {multi && <p className="count-line">{count ?? " "}</p>}
      </div>
      <RhythmLane
        label={recording ? "You" : undefined}
        notes={recorder.notes.map((n) => ({ ...n, tone: "live" }))}
        pitches={rhythm.pitches}
        lengthMs={lengthMs}
        beatMs={beat}
        playheadMs={phase === "record" ? playhead : undefined}
      />
      <div className={`pads ${multi ? "pads--bars" : "pads--single"}`}>
        {keys.map((key, lane) => (
          <button
            key={key}
            type="button"
            className={`pad pad--${phase}${isLit(lane) ? " pad--on" : ""}`}
            aria-label={`${multi ? `${labels[lane]}, note ${lane + 1} of ${rhythm.pitches}` : "Tap pad"} (${keyLabel(key)})`}
            tabIndex={-1}
            {...recorder.padHandlers(lane)}
          >
            {!multi && <span className="pad-count">{count ?? ""}</span>}
            {multi && (
              <span className="pad-label">
                <span className="pad-name">{labels[lane]}</span>
                {!touch && <span className="pad-key">{keyLabel(key)}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
