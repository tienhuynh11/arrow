import { useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ButtonConfig {
  windowMs: number;
  danger?: { from: number; to: number }[];
}

/** Trạng thái + điều khiển của BẤM NHANH TAY, dùng chung cho bản 2D và 3D. */
export function useButtonGame({ gameId, config, startAt, live }: GameProps) {
  const cfg = config as ButtonConfig;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [punch, setPunch] = useState(0);
  const now = useServerClock(80);

  const punchAt = useRef<Record<string, number>>({});
  const penaltyAt = useRef<Record<string, number>>({});
  const prevCounts = useRef<Record<string, number>>({});

  useGameEvents(gameId, (p) => {
    if (p.type !== 'counts') return;
    const t = Date.now();
    for (const [id, c] of Object.entries(p.counts as Record<string, number>)) {
      const prev = prevCounts.current[id] ?? 0;
      if (prev < c) punchAt.current[id] = t;
      else if (prev > c) penaltyAt.current[id] = t; // bấm lúc đèn đỏ bị trừ điểm
      prevCounts.current[id] = c;
    }
    setCounts(p.counts);
  });

  const tap = () => {
    net.input(gameId, { type: 'tap' });
    setPunch(Date.now());
    sfx.tap();
  };

  useKeys({ Space: tap }, live);

  const remain = Math.max(0, Math.ceil((startAt + cfg.windowMs - now) / 1000));
  const max = Math.max(1, ...Object.values(counts));
  // đèn đỏ: lịch giống hệt nhau cho mọi người, lấy thẳng từ config của server
  const rel = now - startAt;
  const isDanger = live && (cfg.danger ?? []).some((d) => rel >= d.from && rel <= d.to);

  return { cfg, counts, punch, punchAt, penaltyAt, tap, remain, max, isDanger, live };
}

export type ButtonGameState = ReturnType<typeof useButtonGame>;
