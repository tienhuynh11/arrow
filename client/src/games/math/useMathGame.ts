import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface MathQuestion {
  text: string;
  options: number[];
  answer: number;
  deadline: number;
}

export interface MathLock {
  cell: number;
  ok: boolean;
  order: number;
  gained: number;
  at: number;
}

/** Trạng thái + điều khiển của TÍNH NHANH, dùng chung cho bản 2D và 3D. */
export function useMathGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const questions = config.questions as MathQuestion[];
  const lanes = config.lanes as number;

  const [index, setIndex] = useState(0);
  const [cells, setCells] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Record<string, MathLock>>({});
  const [flash, setFlash] = useState(0);
  const [reveal, setReveal] = useState<number | null>(null);
  const myCell = useRef(Math.floor(lanes / 2) - 1);
  const now = useServerClock(80);

  useEffect(() => {
    // ai cũng bắt đầu ở cùng một ô
    const init: Record<string, number> = {};
    for (const p of players) init[p.id] = Math.floor(lanes / 2) - 1;
    setCells(init);
  }, [lanes, players.length]);

  useGameEvents(gameId, (p) => {
    if (p.type === 'question') {
      setIndex(p.index);
      setLocked({});
      setReveal(null);
    } else if (p.type === 'move') {
      setCells((c) => ({ ...c, [p.playerId]: p.cell }));
    } else if (p.type === 'lock') {
      setLocked((l) => ({
        ...l,
        [p.playerId]: { cell: p.cell, ok: p.ok, order: p.order ?? 0, gained: p.gained ?? 0, at: Date.now() },
      }));
      if (p.playerId === meId) {
        setFlash(Date.now());
        (p.ok ? sfx.perfect : sfx.miss)();
      }
    } else if (p.type === 'reveal') {
      setReveal(p.answer);
    }
  });

  const move = (dir: 'L' | 'R') => {
    if (locked[meId]) return;
    const next = myCell.current + (dir === 'L' ? -1 : 1);
    if (next < 0 || next >= lanes) return;
    myCell.current = next;
    setCells((c) => ({ ...c, [meId]: next })); // dự đoán trước, server xác nhận sau
    net.input(gameId, { type: 'move', dir });
    sfx.tap();
  };

  useKeys(
    {
      ArrowLeft: () => move('L'),
      ArrowRight: () => move('R'),
      Space: () => {
        if (locked[meId]) return;
        net.input(gameId, { type: 'lock' });
      },
    },
    live,
  );

  const q = questions[Math.min(index, questions.length - 1)];
  const opensAt = index === 0 ? 1200 : questions[index - 1].deadline + 900;
  const rel = now - startAt;
  const progress = Math.max(0, Math.min(1, (q.deadline - rel) / (q.deadline - opensAt)));
  const waiting = rel < opensAt;

  return { questions, lanes, index, cells, locked, flash, reveal, q, progress, waiting, myLock: locked[meId] };
}

export type MathGameState = ReturnType<typeof useMathGame>;
