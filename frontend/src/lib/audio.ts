import * as Tone from "tone";

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
  /** Echoes the player's own presses; polyphonic in case keys overlap. */
  echo: Tone.PolySynth;
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
  const echo = new Tone.PolySynth(Tone.Synth, voiceOptions).toDestination();
  echo.volume.value = -10;
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
