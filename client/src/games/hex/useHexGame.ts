import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface HexPos {
  x: number;
  y: number;
  /** tầng đang đứng (0 = thấp nhất), -1 = đã rơi khỏi sân */
  l: number;
  out: boolean;
  /** đang bay trên không */
  j?: boolean;
}

export interface HexConfig {
  radius: number;
  size: number;
  layers: number;
  speed: number;
  playerRadius: number;
  delay: number;
  bound: number;
  endsAt: number;
  jumpMs: number;
  spawns: Record<string, [number, number]>;
}

/** Trạng thái + điều khiển của SÀN TỔ ONG. Phần vẽ chỉ đọc các ref ở đây. */
export function useHexGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as HexConfig;

  const positions = useRef<Record<string, HexPos>>({});
  /** mỗi ký tự là một ô: 0 còn nguyên · 1 đang nháy · 2 đã rơi (theo tầng rồi theo ô) */
  const tiles = useRef('');
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const myLayer = useRef(cfg.layers - 1);
  /** lúc (giờ server) mình bấm nhảy gần nhất — cảnh dùng để vẽ cú nhảy ngay, khỏi chờ server */
  const jumpAt = useRef(0);

  const [out, setOut] = useState<Record<string, number>>({});
  const [layer, setLayer] = useState(cfg.layers - 1);
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
      if (typeof p.tiles === 'string') tiles.current = p.tiles;
      const mine: HexPos | undefined = p.positions[meId];
      if (mine) {
        if (!synced.current || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8) {
          me.current = { x: mine.x, y: mine.y };
          synced.current = true;
        }
        if (mine.l !== myLayer.current) {
          if (mine.l >= 0 && mine.l < myLayer.current) sfx.miss();
          myLayer.current = mine.l;
          setLayer(mine.l);
        }
      }
      for (const id of Object.keys(p.positions)) if (p.positions[id].out) markOut(id, Date.now());
    } else if (p.type === 'out') {
      markOut(p.playerId, Date.now());
    }
  });

  // giữ phím để chạy mọi hướng
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
        if (!e.repeat && t - jumpAt.current > cfg.jumpMs && !positions.current[meId]?.out) {
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
    // nhắc lại hướng đang giữ, phòng khi gói keyup bị mất
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

  /** dự đoán vị trí của chính mình cho mượt; server vẫn là bên chốt ô nào rơi */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    if (!live || !synced.current || (!dx && !dy) || positions.current[meId]?.out) return;
    const len = Math.hypot(dx, dy) || 1;
    me.current = {
      x: Math.max(-cfg.bound, Math.min(cfg.bound, me.current.x + (dx / len) * cfg.speed * dt)),
      y: Math.max(-cfg.bound, Math.min(cfg.bound, me.current.y + (dy / len) * cfg.speed * dt)),
    };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  const alive = players.filter((p) => out[p.id] === undefined).length;

  return { cfg, positions, tiles, jumpAt, out, layer, alive, total: players.length, predict, posOf, serverNow: () => net.now() };
}

export type HexGameState = ReturnType<typeof useHexGame>;
