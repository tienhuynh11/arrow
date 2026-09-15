import { useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys } from '../../utils/hooks';
import type { GameProps } from '../types';

export type SeqKey = 'L' | 'U' | 'R' | 'D';
export const ARROW: Record<SeqKey, string> = { L: '←', U: '↑', R: '→', D: '↓' };

export interface SeqProg {
  round: number;
  index: number;
  errors: number;
  done: boolean;
}

/** Trạng thái + điều khiển của GÕ ĐÚNG CHUỖI, dùng chung cho bản 2D và 3D. */
export function useSequenceGame({ gameId, config, meId, live }: GameProps) {
  const rounds = config.rounds as SeqKey[][];
  const [prog, setProg] = useState<Record<string, SeqProg>>({});
  const [shake, setShake] = useState(0);
  const [timedOut, setTimedOut] = useState(0);
  const errAt = useRef<Record<string, number>>({});

  useGameEvents(gameId, (p) => {
    if (p.type !== 'progress') return;
    setProg((s) => ({ ...s, [p.playerId]: { round: p.round, index: p.index, errors: p.errors, done: p.done } }));
    if (!p.ok || p.timeout) errAt.current[p.playerId] = Date.now();
    if (p.playerId === meId) {
      if (p.timeout) {
        sfx.miss();
        setShake(Date.now());
        setTimedOut(Date.now());
      } else if (!p.ok) {
        sfx.miss();
        setShake(Date.now());
      } else sfx.good();
    }
  });

  const press = (key: SeqKey) => net.input(gameId, { type: 'key', key });
  useKeys(
    {
      ArrowLeft: () => press('L'),
      ArrowUp: () => press('U'),
      ArrowRight: () => press('R'),
      ArrowDown: () => press('D'),
    },
    live,
  );

  const totalKeys = rounds.reduce((a, r) => a + r.length, 0);
  const doneOf = (q?: SeqProg) =>
    !q ? 0 : q.done ? totalKeys : Math.min(totalKeys, rounds.slice(0, q.round).reduce((a, r) => a + r.length, 0) + q.index);

  return { rounds, prog, shake, timedOut, errAt, totalKeys, doneOf };
}

export type SequenceGameState = ReturnType<typeof useSequenceGame>;
