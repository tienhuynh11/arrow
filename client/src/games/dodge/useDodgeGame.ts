import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';
/** 8 loại vật thể lạ — phải khớp với server */
export type ObstacleKind = 'ufo' | 'saw' | 'blob' | 'crystal' | 'eye' | 'bomb' | 'star' | 'worm';

export interface DodgeObstacle {
  id: number;
  kind: ObstacleKind;
  x0: number;
  vx: number;
  w: number;
  t: number;
  travel: number;
  spin: number;
}

export interface DodgeConfig {
  width: number;
  playerWidth: number;
  speed: number;
  obstacles: DodgeObstacle[];
  lives: number;
  endsAt: number;
}

export interface DodgePos {
  x: number;
  lives: number;
  stunned: boolean;
}

/** Trạng thái + điều khiển của NÉ VẬT THỂ LẠ, dùng chung cho bản 2D và 3D. */
export function useDodgeGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as DodgeConfig;

  const positions = useRef<Record<string, DodgePos>>({});
  const myX = useRef(cfg.width / 2);
  const holding = useRef<'L' | 'R' | 'N'>('N');
  const lastPredict = useRef(0);

  const [lives, setLives] = useState<Record<string, number>>({});
  const [hitAt, setHitAt] = useState<Record<string, number>>({});
  const [shakeAt, setShakeAt] = useState(0);

  useEffect(() => {
    const l: Record<string, number> = {};
    for (const p of players) l[p.id] = cfg.lives;
    setLives(l);
  }, [players.length, cfg.lives]);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      const mine = p.positions[meId];
      // server là trọng tài: lệch nhiều thì kéo dự đoán của client về
      if (mine && Math.abs(mine.x - myX.current) > 6) myX.current = mine.x;
    } else if (p.type === 'impact') {
      const hits: string[] = p.hits ?? [];
      if (!hits.length) return;
      const now = Date.now();
      setHitAt((s) => {
        const next = { ...s };
        for (const id of hits) next[id] = now;
        return next;
      });
      setLives((s) => {
        const next = { ...s };
        for (const id of hits) next[id] = Math.max(0, (next[id] ?? cfg.lives) - 1);
        return next;
      });
      if (hits.includes(meId)) {
        sfx.miss();
        setShakeAt(now);
      }
    }
  });

  // giữ phím để chạy tự do sang hai bên
  useEffect(() => {
    if (!live) return;
    const setHold = (dir: 'L' | 'R' | 'N') => {
      if (holding.current === dir) return;
      holding.current = dir;
      net.input(gameId, { type: 'hold', dir });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setHold('L');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setHold('R');
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if ((e.code === 'ArrowLeft' && holding.current === 'L') || (e.code === 'ArrowRight' && holding.current === 'R')) {
        setHold('N');
      }
    };
    const onBlur = () => setHold('N');
    const beat = window.setInterval(() => {
      if (holding.current !== 'N') net.input(gameId, { type: 'hold', dir: holding.current });
    }, 400);

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(beat);
      holding.current = 'N';
    };
  }, [gameId, live]);

  /** dự đoán vị trí của chính mình cho mượt; server vẫn là bên chốt va chạm */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    if (!live || holding.current === 'N' || positions.current[meId]?.stunned) return;
    const half = cfg.playerWidth / 2;
    myX.current = Math.max(
      half,
      Math.min(cfg.width - half, myX.current + (holding.current === 'L' ? -1 : 1) * cfg.speed * dt),
    );
  };

  const xOf = (id: string) => (id === meId ? myX.current : (positions.current[id]?.x ?? cfg.width / 2));

  return { cfg, startAt, positions, lives, hitAt, shakeAt, predict, xOf, serverNow: () => net.now() };
}

export type DodgeGameState = ReturnType<typeof useDodgeGame>;
