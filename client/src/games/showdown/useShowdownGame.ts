import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface SdPos {
  x: number;
  y: number;
  /** đang bay trên không */
  j: boolean;
  /** đang choáng sau khi bị xà hất */
  s: boolean;
  out: boolean;
}

export interface SdConfig {
  r: number;
  hub: number;
  arm: number;
  t0: number;
  w0: number;
  a: number;
  speed: number;
  radius: number;
  jumpMs: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

/** góc của xà tại giây t — cùng công thức với server, nên không cần gửi góc qua mạng */
export const barAngle = (c: { t0: number; w0: number; a: number }, t: number) => {
  const tau = Math.max(0, t - c.t0);
  return c.w0 * tau + 0.5 * c.a * tau * tau;
};

/** Trạng thái + điều khiển của NHẢY XÀ. Phần vẽ chỉ đọc các ref ở đây. */
export function useShowdownGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as SdConfig;

  const positions = useRef<Record<string, SdPos>>({});
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  /** lúc (giờ server) mình bấm nhảy gần nhất — cảnh dùng để vẽ cú nhảy ngay */
  const jumpAt = useRef(0);

  const [out, setOut] = useState<Record<string, number>>({});
  const outRef = useRef(out);

  const markOut = (id: string, at: number) => {
    if (outRef.current[id] !== undefined) return;
    outRef.current = { ...outRef.current, [id]: at };
    setOut(outRef.current);
    if (id === meId) sfx.miss();
    else sfx.tick();
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      const mine: SdPos | undefined = p.positions[meId];
      if (mine && (!synced.current || mine.s || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8)) {
        me.current = { x: mine.x, y: mine.y };
        synced.current = true;
      }
      for (const id of Object.keys(p.positions)) if (p.positions[id].out) markOut(id, Date.now());
    } else if (p.type === 'out') {
      markOut(p.playerId, Date.now());
    } else if (p.type === 'hit') {
      if (p.playerId === meId) sfx.miss();
    }
  });

  useEffect(() => {
    if (!live) return;
    const push = () => {
      const dx = (keys.current.r ? 1 : 0) - (keys.current.l ? 1 : 0);
      const dy = (keys.current.d ? 1 : 0) - (keys.current.u ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const set = (code: string, on: boolean) => {
      if (code === 'ArrowLeft' || code === 'KeyA') keys.current.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') keys.current.r = on;
      else if (code === 'ArrowUp' || code === 'KeyW') keys.current.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') keys.current.d = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        const t = net.now();
        if (!e.repeat && !positions.current[meId]?.out) {
          jumpAt.current = t;
          net.input(gameId, { type: 'jump' });
        }
        return;
      }
      if (set(e.code, true)) {
        e.preventDefault();
        push();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) push();
    };
    const onBlur = () => {
      keys.current = { l: false, r: false, u: false, d: false };
      push();
    };
    const beat = window.setInterval(() => {
      const { dx, dy } = sent.current;
      if (dx || dy) net.input(gameId, { type: 'moveXY', dx, dy });
    }, 400);

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(beat);
    };
  }, [gameId, live]);

  /** dự đoán vị trí của chính mình cho mượt; server vẫn chốt ai bị xà hất */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    const mine = positions.current[meId];
    if (!live || !synced.current || (!dx && !dy) || !mine || mine.s || mine.out) return;
    const len = Math.hypot(dx, dy) || 1;
    let x = me.current.x + (dx / len) * cfg.speed * dt;
    let y = me.current.y + (dy / len) * cfg.speed * dt;
    const minR = cfg.hub + cfg.radius;
    const r = Math.hypot(x, y);
    if (r < minR && r > 1e-6) {
      x *= minR / r;
      y *= minR / r;
    }
    me.current = { x, y };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  const alive = players.filter((p) => out[p.id] === undefined).length;

  return { cfg, startAt, positions, jumpAt, out, alive, total: players.length, predict, posOf, serverNow: () => net.now() };
}

export type ShowdownGameState = ReturnType<typeof useShowdownGame>;
