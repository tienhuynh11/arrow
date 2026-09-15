import { useEffect, useRef, useState } from 'react';
import type { ServerMessage } from '@shared/protocol';
import { net } from '../network/net';

/** Subscribe to game:event payloads for one minigame. */
export function useGameEvents(gameId: string, handler: (payload: any) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      net.on((msg: ServerMessage) => {
        if (msg.t === 'game:event' && msg.gameId === gameId) ref.current(msg.payload);
      }),
    [gameId],
  );
}

/**
 * Keyboard handler. `repeat` events from holding a key are ignored so that
 * holding SPACE can never act as an auto-clicker.
 */
export function useKeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const fn = ref.current[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** requestAnimationFrame loop that hands the callback the current server time. */
export function useRaf(cb: (serverNow: number) => void, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    let id = 0;
    const loop = () => {
      ref.current(net.now());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [enabled]);
}

/** Re-renders on an interval; returns the current server time. */
export function useServerClock(intervalMs = 100) {
  const [now, setNow] = useState(() => net.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(net.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
