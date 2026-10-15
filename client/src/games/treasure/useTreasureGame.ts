import { useEffect, useMemo, useRef, useState } from 'react';
import { net } from '../../network/net';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';
import { TreasureClient } from '@shared/treasureClient';
import { MAXC, SPEED_MUL, STEP_MS } from '@shared/treasure';

export interface TreasureConfig {
  arenas: { ids: string[]; w: number; h: number }[];
  maxCarry: number;
}

export interface TreasureHud {
  /** 0 = đếm ngược, 1 = đang chơi, 2 = hết giờ */
  phase: number;
  count: number;
  go: boolean;
  secLeft: number;
  score: number[];
  steals: number[];
  load: number;
  /** % tốc độ so với tay không */
  speedPct: number;
  /** hồi chiêu nút cướp 0..1 */
  cd: number;
  immune: boolean;
  noteKind: string;
  noteN: number;
  noteSeq: number;
  lostAtEnd: number;
  finished: boolean;
}

const EMPTY: TreasureHud = {
  phase: 0, count: -1, go: false, secLeft: 100, score: [], steals: [], load: 0, speedPct: 100, cd: 0, immune: false,
  noteKind: '', noteN: 0, noteSeq: 0, lostAtEnd: 0, finished: false,
};

/**
 * CƯỚP KHO BÁU phía client. Mọi thứ nặng (dự đoán, hoà giải, nội suy) nằm trong TreasureClient
 * và chạy trong rAF của cảnh 3D đọc qua ref; React chỉ nhận HUD ~8 lần/giây.
 */
export function useTreasureGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as TreasureConfig;
  const ai = Math.max(0, cfg.arenas.findIndex((a) => a.ids.includes(meId)));
  const ac = cfg.arenas[ai];
  const seat = Math.max(0, ac.ids.indexOf(meId));

  const cl = useMemo(
    () => new TreasureClient(startAt, ai, ac.ids, seat, ac.w, ac.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startAt, ai, meId],
  );
  const clRef = useRef(cl);
  clRef.current = cl;

  useGameEvents(gameId, (p) => {
    if (p && p.a === ai) clRef.current.onMessage(p, net.now());
  });

  const keys = useRef({ l: false, r: false, u: false, d: false });
  const liveRef = useRef(live);
  liveRef.current = live;

  const apply = (actEdge: boolean) => {
    const k = keys.current;
    const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0);
    const dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
    const msg = clRef.current.setKeys(dx, dy, actEdge, net.now());
    if (msg) net.input(gameId, msg);
  };

  useEffect(() => {
    if (!live) return;
    const set = (code: string, on: boolean) => {
      if (code === 'ArrowLeft' || code === 'KeyA') keys.current.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') keys.current.r = on;
      else if (code === 'ArrowUp' || code === 'KeyW') keys.current.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') keys.current.d = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (set(e.code, true) || e.code === 'Space') e.preventDefault();
        return;
      }
      if (set(e.code, true)) {
        e.preventDefault();
        apply(false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        apply(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) apply(false);
    };
    const onBlur = () => {
      keys.current = { l: false, r: false, u: false, d: false };
      apply(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      keys.current = { l: false, r: false, u: false, d: false };
      apply(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, live, cl]);

  /** gọi mỗi khung hình trong rAF của cảnh */
  const step = (now: number) => {
    const c = clRef.current;
    const m = c.poll(now);
    if (m) net.input(gameId, m);
    c.frame(now);
  };

  /* HUD ~8Hz */
  const [hud, setHud] = useState<TreasureHud>(EMPTY);
  const lastKey = useRef('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = clRef.current;
      if (!c.synced) return;
      const now = net.now();
      const toGo = startAt + c.fs * STEP_MS - now;
      const phase = c.phase();
      const load = Math.min(MAXC, c.world.load[seat]);
      const h: TreasureHud = {
        phase,
        count: phase === 0 ? Math.max(1, Math.ceil(toGo / 1000)) : -1,
        go: phase === 1 && -toGo < 700,
        secLeft: Math.max(0, Math.ceil((startAt + c.endT * STEP_MS - now) / 1000)),
        score: Array.from(c.score.subarray(0, c.n)),
        steals: Array.from(c.steals.subarray(0, c.n)),
        load,
        speedPct: Math.round(SPEED_MUL[load] * 100),
        cd: Math.round(c.cooldownFrac() * 20) / 20,
        immune: !!c.immune[seat],
        noteKind: now - (startAt + c.note.at * STEP_MS) < 1600 ? c.note.kind : '',
        noteN: c.note.n,
        noteSeq: c.note.seq,
        lostAtEnd: c.lostAtEnd[seat],
        finished: c.finished,
      };
      const key = JSON.stringify(h);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setHud(h);
      }
    }, 120);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cl]);

  const actOnce = () => {
    if (liveRef.current) apply(true);
  };

  return { cl, ai, ac, seat, hud, step, serverNow: () => net.now(), actOnce, cfg };
}

export type TreasureGameState = ReturnType<typeof useTreasureGame>;
