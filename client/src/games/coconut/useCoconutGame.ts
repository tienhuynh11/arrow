import { useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface CoconutConfig {
  durationMs: number;
  climbTo: number;
  winds: { from: number; to: number }[];
  warnMs: number;
  stunMs: number;
  slip: number;
  minIntervalMs: number;
}

export interface CoconutSnap {
  /** độ cao hiện tại (số nấc đã leo) */
  h: number;
  /** số quả dừa đã hái */
  c: number;
  /** đang choáng sau khi bị gió lắc trượt */
  s: boolean;
}

export type WindState = 'none' | 'warn' | 'active';

/** Trạng thái + điều khiển của HÁI DỪA (bấm luân phiên ← → để leo, buông tay khi gió lắc). */
export function useCoconutGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as CoconutConfig;
  const now = useServerClock(100);

  const [snap, setSnap] = useState<Record<string, CoconutSnap>>({});
  /** bản mới nhất của snap cho vòng lặp 3D (không phải chờ React render) */
  const snapRef = useRef<Record<string, CoconutSnap>>({});
  /** độ cao dự đoán của CHÍNH MÌNH để leo mượt, server tới thì chỉnh lại */
  const pred = useRef(0);
  const harvestAt = useRef<Record<string, number>>({});
  const slipAt = useRef<Record<string, number>>({});
  const climbAt = useRef<Record<string, number>>({});
  const lastSide = useRef<'L' | 'R' | null>(null);
  const lastPress = useRef(0);
  const stunnedUntil = useRef(0);

  const windAt = (serverNow: number): WindState => {
    const rel = serverNow - startAt;
    for (const w of cfg.winds) {
      if (rel >= w.from && rel <= w.to) return 'active';
      if (rel >= w.from - cfg.warnMs && rel < w.from) return 'warn';
    }
    return 'none';
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'snap') {
      snapRef.current = p.players;
      setSnap(p.players);
      const mine = p.players[meId] as CoconutSnap | undefined;
      // server là trọng tài: lệch xa dự đoán thì kéo về
      if (mine && Math.abs(mine.h - pred.current) > 2) pred.current = mine.h;
    } else if (p.type === 'harvest') {
      harvestAt.current[p.playerId] = Date.now();
      if (p.playerId === meId) {
        pred.current = 0;
        sfx.perfect();
      }
    } else if (p.type === 'slip') {
      slipAt.current[p.playerId] = Date.now();
      if (p.playerId === meId) {
        pred.current = Math.max(0, pred.current - cfg.slip);
        stunnedUntil.current = Date.now() + cfg.stunMs;
        lastSide.current = null;
        sfx.miss();
      }
    }
  });

  const climb = (side: 'L' | 'R') => {
    const t = Date.now();
    if (t < stunnedUntil.current || t - lastPress.current < cfg.minIntervalMs) return;
    lastPress.current = t;
    net.input(gameId, { type: 'climb', side });
    climbAt.current[meId] = t;
    // dự đoán giống luật server: gió lắc mà vẫn leo là trượt, bấm cùng phía thì không leo thêm
    if (windAt(net.now()) === 'active') return;
    if (side === lastSide.current) return;
    lastSide.current = side;
    pred.current = (pred.current + 1) % cfg.climbTo;
    sfx.tap();
  };

  useKeys(
    {
      ArrowLeft: () => climb('L'),
      ArrowRight: () => climb('R'),
      KeyA: () => climb('L'),
      KeyD: () => climb('R'),
    },
    live,
  );

  const remain = Math.max(0, Math.ceil((startAt + cfg.durationMs - now) / 1000));
  const wind = windAt(now);

  return { cfg, startAt, meId, snap, snapRef, pred, harvestAt, slipAt, climbAt, windAt, wind, remain, live };
}

export type CoconutGameState = ReturnType<typeof useCoconutGame>;
