import * as Tone from "tone";

/** Every rhythm is played on one pitch: the game is about timing, not melody. */
export const NOTE_PITCH = "A4";

/** Browsers only allow audio after a user gesture; call this from a click handler. */
export async function unlockAudio(): Promise<void> {
  if (Tone.getContext().state !== "running") {
    await Tone.start();
  }
}

export function audioReady(): boolean {
  return Tone.getContext().state === "running";
}

export interface Instruments {
  /** Plays the phrase. */
  voice: Tone.Synth;
  /** Echoes the player's own presses so they can hear what they're doing. */
  echo: Tone.Synth;
  /** Metronome. */
  click: Tone.MembraneSynth;
  dispose(): void;
}

export function createInstruments(): Instruments {
  const voiceOptions = {
    oscillator: { type: "triangle" as const },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.06 },
  };
  const voice = new Tone.Synth(voiceOptions).toDestination();
  voice.volume.value = -6;
  const echo = new Tone.Synth(voiceOptions).toDestination();
  echo.volume.value = -9;
  const click = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 },
  }).toDestination();
  click.volume.value = -16;
  return {
    voice,
    echo,
    click,
    dispose() {
      voice.dispose();
      echo.dispose();
      click.dispose();
    },
  };
}
