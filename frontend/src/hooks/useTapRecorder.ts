import { Note } from "@rhythm-royale/common";
import { useCallback, useEffect, useRef, useState } from "react";

const KEYS = new Set([" ", "Enter"]);

interface Options {
  enabled: boolean;
  /** Ignore presses that begin this long before the origin (e.g. tapping along to the count-in). */
  earlyToleranceMs: number;
  onPress?: () => void;
  onRelease?: () => void;
}

/**
 * Turns key/pointer presses into notes timed relative to `origin` (a
 * performance.now() timestamp). Uses refs for the recording itself so the
 * final result never depends on a stale render.
 */
export function useTapRecorder({ enabled, earlyToleranceMs, onPress, onRelease }: Options) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isDown, setIsDown] = useState(false);
  const originRef = useRef(0);
  const downAtRef = useRef<number | null>(null);
  const notesRef = useRef<Note[]>([]);
  const callbacks = useRef({ onPress, onRelease });
  callbacks.current = { onPress, onRelease };

  const press = useCallback(() => {
    if (downAtRef.current !== null) return;
    downAtRef.current = performance.now();
    setIsDown(true);
    callbacks.current.onPress?.();
  }, []);

  const release = useCallback(() => {
    const downAt = downAtRef.current;
    if (downAt === null) return;
    downAtRef.current = null;
    setIsDown(false);
    callbacks.current.onRelease?.();
    const start = downAt - originRef.current;
    if (start < -earlyToleranceMs) return;
    notesRef.current = [...notesRef.current, { start, duration: performance.now() - downAt }];
    setNotes(notesRef.current);
  }, [earlyToleranceMs]);

  /** Start a fresh recording whose time zero is `origin`. */
  const arm = useCallback((origin: number) => {
    originRef.current = origin;
    downAtRef.current = null;
    notesRef.current = [];
    setNotes([]);
    setIsDown(false);
  }, []);

  /** Stop recording, closing any note that is still held. */
  const finish = useCallback((): Note[] => {
    release();
    return notesRef.current;
  }, [release]);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (!KEYS.has(e.key)) return;
      e.preventDefault();
      if (!e.repeat) press();
    };
    const up = (e: KeyboardEvent) => {
      if (!KEYS.has(e.key)) return;
      e.preventDefault();
      release();
    };
    // Releasing outside the window (alt-tab) must not leave a note stuck on.
    const blur = () => release();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enabled, press, release]);

  const padHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      press();
    },
    onPointerUp: () => release(),
    onPointerCancel: () => release(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  return { notes, isDown, arm, finish, padHandlers };
}
