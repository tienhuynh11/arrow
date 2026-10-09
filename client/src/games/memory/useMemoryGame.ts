import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface MmPos {
  x: number;
  y: number;
  out: boolean;
}

export interface MmRound {
  r: number;
  startAt: number;
  pattern: string;
  /** hình cần tìm; -1 khi chưa tới giờ úp ô */
  target: number;
  hideAt: number;
  dropAt: number;
  nextAt: number;
}

export interface MmConfig {
  n: number;
  size: number;
  symbols: number;
  speed: number;
  radius: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
  round0: MmRound;
}

/** Trạng thái + điều khiển của HÃY CHỌN GIÁ ĐÚNG. Mỗi vòng chỉ có một gói `round` và một gói `ask` (hình cần tìm); còn lại client tự đếm theo đồng hồ server. */
export function useMemoryGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as MmConfig;

  const positions = useRef<Record<string, MmPos>>({});
  const round = useRef<MmRound>(cfg.round0);
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);

  const [out, setOut] = useState<Record<string, number>>({});
  const [roundNo, setRoundNo] = useState(cfg.round0.r);
  const outRef = useRef(out);

  const markOut = (id: string, at: number) => {
    if (outRef.current[id] !== undefined) return;
    outRef.current = { ...outRef.current, [id]: at };
    setOut(outRef.current);
    if (id === meId) sfx.miss();
    else sfx.tick();
  };
  const takeRound = (r: MmRound) => {
    const cur = round.current;
    if (r.r === cur.r && r.pattern === cur.pattern) {
      // cùng vòng: chỉ cập nhật hình cần tìm nếu vừa biết (vào lại giữa ván)
      if (r.target >= 0 && cur.target !== r.target) round.current = { ...cur, target: r.target };
      return;
    }
    round.current = r;
    setRoundNo(r.r);
    sfx.start();
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      if (p.round) takeRound(p.round);
      const mine: MmPos | undefined = p.positions[meId];
      if (mine && (!synced.current || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8)) {
        me.current = { x: mine.x, y: mine.y };
        synced.current = true;
      }
      for (const id of Object.keys(p.positions)) if (p.positions[id].out) markOut(id, Date.now());
    } else if (p.type === 'round') {
      takeRound(p as MmRound);
    } else if (p.type === 'ask') {
      if (p.r === round.current.r) {
        round.current = { ...round.current, target: p.target };
        sfx.tick();
      }
    } else if (p.type === 'out') {
      markOut(p.playerId, Date.now());
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

  /** dự đoán vị trí của chính mình cho mượt; server vẫn chốt ai rơi */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    if (!live || !synced.current || (!dx && !dy) || positions.current[meId]?.out) return;
    const len = Math.hypot(dx, dy) || 1;
    const lim = (cfg.n * cfg.size) / 2 - 1;
    me.current = {
      x: Math.max(-lim, Math.min(lim, me.current.x + (dx / len) * cfg.speed * dt)),
      y: Math.max(-lim, Math.min(lim, me.current.y + (dy / len) * cfg.speed * dt)),
    };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  const alive = players.filter((p) => out[p.id] === undefined).length;

  return { cfg, live, positions, round, roundNo, out, alive, total: players.length, predict, posOf, serverNow: () => net.now() };
}

export type MemoryGameState = ReturnType<typeof useMemoryGame>;
