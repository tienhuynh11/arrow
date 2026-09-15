import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface RaceConfig {
  distance: number;
  hurdles: number[];
  jumpMs: number;
  speed: number;
}

export interface RacePos {
  pos: number;
  jumping: boolean;
  stunned: boolean;
  running: boolean;
}

/** Trạng thái + điều khiển của VƯỢT RÀO, dùng chung cho bản 2D và 3D. */
export function useRaceGame({ gameId, config, meId, live }: GameProps) {
  const cfg = config as RaceConfig;

  const positions = useRef<Record<string, RacePos>>({});
  const jumpAt = useRef<Record<string, number>>({});
  const holding = useRef<'L' | 'R' | 'N'>('N');

  const [pos, setPos] = useState<Record<string, RacePos>>({});
  const [finished, setFinished] = useState<Record<string, number>>({});
  const [tripAt, setTripAt] = useState<Record<string, number>>({});
  const [tripHurdle, setTripHurdle] = useState<Record<string, number>>({});
  const [, tick] = useState(0);

  // hiệu ứng vấp tự hết sau ~1 giây nên cần nhịp render
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 150);
    return () => window.clearInterval(id);
  }, []);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      setPos(p.positions);
    } else if (p.type === 'finish') {
      setFinished((f) => ({ ...f, [p.playerId]: p.ms }));
      if (p.playerId === meId) sfx.winner();
    } else if (p.type === 'trip') {
      setTripAt((s) => ({ ...s, [p.playerId]: Date.now() }));
      if (typeof p.at === 'number') setTripHurdle((s) => ({ ...s, [p.playerId]: p.at }));
      if (p.playerId === meId) sfx.miss();
    } else if (p.type === 'jump') {
      jumpAt.current[p.playerId] = Date.now();
      if (p.playerId === meId) sfx.good();
    }
  });

  // Giữ phím = chạy. Gửi lại trạng thái giữ mỗi 400ms để nếu gói keyup bị mất thì server vẫn tự cho dừng.
  useEffect(() => {
    if (!live) return;
    const setHold = (dir: 'L' | 'R' | 'N') => {
      if (holding.current === dir) return;
      holding.current = dir;
      net.input(gameId, { type: 'hold', dir });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        setHold('R');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setHold('L');
      } else if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (!e.repeat) net.input(gameId, { type: 'jump' });
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if ((e.code === 'ArrowRight' && holding.current === 'R') || (e.code === 'ArrowLeft' && holding.current === 'L')) {
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

  return { cfg, positions, jumpAt, pos, finished, tripAt, tripHurdle };
}

export type RaceGameState = ReturnType<typeof useRaceGame>;
