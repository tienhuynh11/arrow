import { useEffect, useRef, useState } from 'react';
import type { Judgement } from '@shared/protocol';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys } from '../../utils/hooks';
import type { GameProps } from '../types';

export type NoteType = 'normal' | 'gold' | 'trap';

export interface RhythmNote {
  t: number;
  lane: 0 | 1;
  type: NoteType;
}

export interface RhythmConfig {
  notes: RhythmNote[];
  windows: { perfect: number; great: number; good: number };
}

export interface RhythmLive {
  judge: Judgement;
  combo: number;
  score: number;
  note: NoteType;
  at: number;
}

/** hàng đợi sự kiện chấm điểm cho phần vẽ (2D hoặc 3D) lấy ra làm hiệu ứng */
export interface JudgeEvent {
  playerId: string;
  judge: Judgement;
  note: NoteType;
  lane: 0 | 1;
}

export const JUDGE_LABEL: Record<Judgement, string> = {
  PERFECT: 'CHUẨN!',
  GREAT: 'KHÁ!',
  GOOD: 'TẠM',
  MISS: 'TRƯỢT',
  TRAP: 'DÍNH BẪY!',
};

/** Trạng thái + điều khiển của BẮT NHỊP, dùng chung cho bản 2D và 3D. */
export function useRhythmGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as RhythmConfig;
  const consumed = useRef(new Set<number>());
  const events = useRef<JudgeEvent[]>([]);
  const [status, setStatus] = useState<Record<string, RhythmLive>>({});

  useGameEvents(gameId, (p) => {
    if (p.type !== 'judge') return;
    setStatus((s) => ({
      ...s,
      [p.playerId]: { judge: p.judge, combo: p.combo, score: p.score, note: p.note ?? 'normal', at: Date.now() },
    }));
    events.current.push({ playerId: p.playerId, judge: p.judge, note: p.note ?? 'normal', lane: (p.lane ?? 0) as 0 | 1 });
    if (events.current.length > 64) events.current.splice(0, events.current.length - 64);
    if (p.playerId !== meId) return;
    if (p.judge === 'TRAP') sfx.miss();
    else if (p.judge === 'PERFECT') sfx.perfect();
    else if (p.judge === 'GREAT') sfx.great();
    else if (p.judge === 'GOOD') sfx.good();
    else sfx.miss();
  });

  const hit = (lane: 0 | 1) => {
    net.input(gameId, { type: 'hit', at: net.now(), key: lane === 1 ? 'up' : 'space' });
    // nuốt nốt gần nhất CÙNG LÀN ngay ở client để nó ngừng vẽ tức thì
    const rel = net.now() - startAt;
    let best = -1;
    let bestD = Infinity;
    cfg.notes.forEach((n, i) => {
      if (n.lane !== lane || consumed.current.has(i)) return;
      const d = Math.abs(n.t - rel);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= cfg.windows.good) consumed.current.add(best);
  };

  useKeys({ Space: () => hit(0), ArrowUp: () => hit(1) }, live);

  useEffect(() => {
    const id = window.setInterval(() => setStatus((s) => ({ ...s })), 200);
    return () => window.clearInterval(id);
  }, []);

  return { cfg, startAt, status, consumed, events, serverNow: () => net.now() };
}

export type RhythmGameState = ReturnType<typeof useRhythmGame>;
