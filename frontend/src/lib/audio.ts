import * as Tone from "tone";

/** Browsers only allow audio after a user gesture; call this from a click handler. */
export async function unlockAudio(): Promise<void> {
  // iPhones mute web audio when the silent switch is on unless the page says
  // it plays media (Safari 16.4+). A game with no sound is no game.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  // Started inside the same gesture, as Safari requires; finishes on its own.
  latency = measureOutputLatency();
  if (Tone.getContext().state !== "running") {
    await Tone.start();
  }
}

export function audioReady(): boolean {
  return Tone.getContext().state === "running";
}

/** Above this, players hear their own taps noticeably late (typical of Bluetooth). */
export const HIGH_LATENCY_MS = 100;

let latency: Promise<number | null> = Promise.resolve(null);

/**
 * How long sound takes to reach the speakers or headphones, in ms, or null if
 * the browser doesn't say (Safari may not). Bluetooth headphones are usually
 * 150 to 250 ms; wired ones and phone speakers well under 50. Measured each
 * time audio is unlocked, in case headphones were connected since.
 */
export function outputLatencyMs(): Promise<number | null> {
  return latency;
}

/**
 * Tone.js wraps the AudioContext and doesn't pass `outputLatency` through, so
 * open a plain one for a moment and ask it. Same device, same answer.
 */
async function measureOutputLatency(): Promise<number | null> {
  const Ctx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext | undefined;
  try {
    ctx = new Ctx({ latencyHint: "interactive" });
    await ctx.resume();
    // The figure is only filled in once audio is actually flowing.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const output = ctx.outputLatency;
    if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return null;
    return Math.round((output + (ctx.baseLatency ?? 0)) * 1000);
  } catch {
    // Not knowing just means no headphone note.
    return null;
  } finally {
    ctx?.close().catch(() => undefined);
  }
}

export interface Instruments {
  /** Plays the phrase. */
  voice: Tone.PolySynth<Tone.FMSynth>;
  /** Echoes the player's own presses; polyphonic in case keys overlap. */
  echo: Tone.PolySynth<Tone.FMSynth>;
  /** Metronome. */
  click: Tone.MembraneSynth;
  dispose(): void;
}

/**
 * A soft electric-piano tone: a bell-like attack that settles into a warm
 * sustain, so held notes still sound held. Friendlier than a bare oscillator
 * and easier to place in pitch.
 */
const KEYS_OPTIONS = {
  harmonicity: 2,
  modulationIndex: 1.6,
  oscillator: { type: "sine" as const },
  envelope: { attack: 0.004, decay: 0.35, sustain: 0.55, release: 0.25 },
  modulation: { type: "sine" as const },
  modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.2 },
};

export function createInstruments(): Instruments {
  const out = new Tone.Gain(1).toDestination();
  // A touch of room so notes ring into each other like a real instrument.
  const room = new Tone.Freeverb({ roomSize: 0.55, dampening: 2800, wet: 0.14 }).connect(out);
  const voice = new Tone.PolySynth(Tone.FMSynth, KEYS_OPTIONS).connect(room);
  voice.volume.value = -8;
  const echo = new Tone.PolySynth(Tone.FMSynth, KEYS_OPTIONS).connect(room);
  echo.volume.value = -11;
  const click = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 },
  }).connect(out);
  click.volume.value = -16;
  return {
    voice,
    echo,
    click,
    dispose() {
      voice.dispose();
      echo.dispose();
      click.dispose();
      room.dispose();
      out.dispose();
    },
  };
}
