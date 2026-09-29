import type { Note } from "@rhythm-royale/common";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { laneForKey } from "../lib/keys";

interface Options {
  enabled: boolean;
  pitches: number;
  /** Lanes that can be played this round; keys for the others are ignored. */
  lanes: readonly number[];
  /** Ignore presses that begin this long before the origin (e.g. tapping along to the count-in). */
  earlyToleranceMs: number;
  onPress?: (lane: number) => void;
  onRelease?: (lane: number) => void;
}

/**
 * Turns key/pointer presses into notes timed relative to `origin` (a
 * performance.now() timestamp). Uses refs for the recording itself so the
 * final result never depends on a stale render.
 */
export function useTapRecorder({
  enabled,
  pitches,
  lanes,
  earlyToleranceMs,
  onPress,
  onRelease,
}: Options) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const originRef = useRef(0);
  const downAtRef = useRef(new Map<number, number>());
  const notesRef = useRef<Note[]>([]);
  const callbacks = useRef({ onPress, onRelease });
  callbacks.current = { onPress, onRelease };
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  const syncHeld = useCallback(() => setHeld(new Set(downAtRef.current.keys())), []);

  const press = useCallback(
    (lane: number) => {
      if (downAtRef.current.has(lane)) return;
      downAtRef.current.set(lane, performance.now());
      syncHeld();
      callbacks.current.onPress?.(lane);
    },
    [syncHeld],
  );

  const release = useCallback(
    (lane: number) => {
      const downAt = downAtRef.current.get(lane);
      if (downAt === undefined) return;
      downAtRef.current.delete(lane);
      syncHeld();
      callbacks.current.onRelease?.(lane);
      const start = downAt - originRef.current;
      if (start < -earlyToleranceMs) return;
      notesRef.current = [
        ...notesRef.current,
        { start, duration: performance.now() - downAt, pitch: lane },
      ];
      setNotes(notesRef.current);
    },
    [earlyToleranceMs, syncHeld],
  );

  const releaseAll = useCallback(() => {
    for (const lane of Array.from(downAtRef.current.keys())) release(lane);
  }, [release]);

  /** Start a fresh recording whose time zero is `origin`. */
  const arm = useCallback((origin: number) => {
    originRef.current = origin;
    downAtRef.current.clear();
    notesRef.current = [];
    setNotes([]);
    setHeld(new Set());
  }, []);

  /** Stop recording, closing any note that is still held. */
  const finish = useCallback((): Note[] => {
    releaseAll();
    return [...notesRef.current].sort((a, b) => a.start - b.start);
  }, [releaseAll]);

  useEffect(() => {
    if (!enabled) {
      releaseAll();
      return;
    }
    const down = (e: KeyboardEvent) => {
      const lane = laneForKey(e.key, pitches);
      if (lane === null) return;
      e.preventDefault();
      if (!e.repeat && lanesRef.current.includes(lane)) press(lane);
    };
    const up = (e: KeyboardEvent) => {
      const lane = laneForKey(e.key, pitches);
      if (lane === null) return;
      e.preventDefault();
      release(lane);
    };
    // Releasing outside the window (alt-tab) must not leave a note stuck on.
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
    };
  }, [enabled, pitches, press, release, releaseAll]);

  /** Props for the on-screen pad of `lane` (touch and mouse). */
  const padHandlers = (lane: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      press(lane);
    },
    onPointerUp: () => release(lane),
    onPointerCancel: () => release(lane),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  });

  return { notes, held, arm, finish, padHandlers };
}
