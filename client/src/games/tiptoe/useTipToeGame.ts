import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface TtPos {
  x: number;
  y: number;
  /** đang rơi (sắp quay về xuất phát) */
  out: boolean;
}

export interface TtConfig {
  cols: number;
  rows: number;
  size: number;
  speed: number;
  radius: number;
  startDepth: number;
  finishDepth: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

/** Trạng thái + điều khiển của CON ĐƯỜNG ẨN. Client chỉ biết các ô ĐÃ vỡ (chuỗi 0/1); đường thật không bao giờ được gửi. */
export function useTipToeGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as TtConfig;

  const positions = useRef<Record<string, TtPos>>({});
  const broken = useRef('0'.repeat(cfg.cols * cfg.rows));
  /** giờ đóng ván (ms tính từ startAt), null khi chưa ai về đích */
  const closeAt = useRef<number | null>(null);
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);

  const [fin, setFin] = useState<Record<string, number>>({});
  const [falls, setFalls] = useState(0);
  const finRef = useRef(fin);

  const markFin = (id: string, place: number) => {
    if (finRef.current[id] !== undefined) return;
    finRef.current = { ...finRef.current, [id]: place };
    setFin(finRef.current);
    if (id === meId) sfx.start();
    else sfx.tick();
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      if (typeof p.broken === 'string') broken.current = p.broken;
      if (typeof p.closeAt === 'number') closeAt.current = p.closeAt;
      if (p.fin) for (const id of Object.keys(p.fin)) markFin(id, p.fin[id]);
      const mine: TtPos | undefined = p.positions[meId];
      // lần đầu, hoặc vừa bị rơi/quay về xuất phát (lệch xa) → bám lại vị trí server
      if (mine && (!synced.current || mine.out || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8)) {
        me.current = { x: mine.x, y: mine.y };
        synced.current = true;
      }
    } else if (p.type === 'fall') {
      const i = Number(p.idx);
      if (i >= 0 && i < broken.current.length && broken.current[i] !== '1') {
        broken.current = broken.current.slice(0, i) + '1' + broken.current.slice(i + 1);
      }
      if (p.playerId === meId) {
        setFalls((n) => n + 1);
        sfx.miss();
      } else sfx.tick();
    } else if (p.type === 'finish') {
      if (typeof p.closeAt === 'number') closeAt.current = p.closeAt;
      markFin(p.playerId, p.place);
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

  /** dự đoán vị trí của chính mình cho mượt; server vẫn chốt ô nào vỡ */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    if (!live || !synced.current || (!dx && !dy) || positions.current[meId]?.out) return;
    const len = Math.hypot(dx, dy) || 1;
    const limX = (cfg.cols * cfg.size) / 2 - 1;
    const maxY = cfg.startDepth - 1;
    const minY = -(cfg.rows * cfg.size + cfg.finishDepth - 1);
    me.current = {
      x: Math.max(-limX, Math.min(limX, me.current.x + (dx / len) * cfg.speed * dt)),
      y: Math.max(minY, Math.min(maxY, me.current.y + (dy / len) * cfg.speed * dt)),
    };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current && !positions.current[meId]?.out ? me.current : positions.current[id];

  return { cfg, startAt, live, positions, broken, closeAt, fin, falls, predict, posOf, serverNow: () => net.now() };
}

export type TipToeGameState = ReturnType<typeof useTipToeGame>;
