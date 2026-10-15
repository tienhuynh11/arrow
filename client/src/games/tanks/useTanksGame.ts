import { useEffect, useMemo, useRef, useState } from 'react';
import { net } from '../../network/net';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';
import { TankClient } from '@shared/tankClient';
import { COUNT_TICKS, ROUNDS, STEP_MS } from '@shared/tank';

export interface TanksConfig {
  arenas: { ids: string[]; w: number; h: number }[];
  rounds: number;
}

export interface TanksHud {
  round: number;
  rounds: number;
  /** 0 = đếm ngược, 1 = đang đánh, 2 = hết vòng */
  phase: number;
  /** số giây đếm ngược còn lại (phase 0) hoặc -1 */
  count: number;
  go: boolean;
  alive: boolean[];
  aliveN: number;
  score: number[];
  kills: number[];
  wins: number[];
  weapon: number;
  weaponLeft: number;
  shield: boolean;
  winner: number;
  sudden: boolean;
  finished: boolean;
}

const EMPTY: TanksHud = {
  round: 0, rounds: ROUNDS, phase: 0, count: -1, go: false, alive: [], aliveN: 0, score: [], kills: [], wins: [],
  weapon: 0, weaponLeft: 0, shield: false, winner: -1, sudden: false, finished: false,
};

/**
 * XE TĂNG ĐẠN NẢY phía client. Mọi thứ nặng (dự đoán, hoà giải, nội suy, đạn) nằm trong TankClient
 * và chạy trong rAF của cảnh 3D đọc qua ref; React chỉ nhận HUD ~8 lần/giây.
 */
export function useTanksGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as TanksConfig;
  const ai = Math.max(0, cfg.arenas.findIndex((a) => a.ids.includes(meId)));
  const ac = cfg.arenas[ai];
  const seat = Math.max(0, ac.ids.indexOf(meId));

  const cl = useMemo(
    () => new TankClient(startAt, ai, ac.ids, seat, ac.w, ac.h),
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

  const apply = (fireEdge: boolean) => {
    const k = keys.current;
    const turn = (k.r ? 1 : 0) - (k.l ? 1 : 0);
    const move = (k.u ? 1 : 0) - (k.d ? 1 : 0);
    const msg = clRef.current.setKeys(turn, move, fireEdge, net.now());
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
  const [hud, setHud] = useState<TanksHud>(EMPTY);
  const lastKey = useRef('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = clRef.current;
      if (c.round < 0) return;
      const now = net.now();
      const fsMs = startAt + c.fs * STEP_MS;
      const toGo = fsMs - now;
      const phase = toGo > 0 ? 0 : c.over ? 2 : 1;
      const alive: boolean[] = [];
      for (let i = 0; i < c.n; i++) alive.push(!!c.alive[i]);
      const h: TanksHud = {
        round: c.round + 1,
        rounds: cfg.rounds,
        phase,
        count: phase === 0 ? Math.max(1, Math.ceil(toGo / 1000)) : -1,
        go: phase === 1 && -toGo < 700,
        alive,
        aliveN: c.aliveCount(),
        score: Array.from(c.score.subarray(0, c.n)),
        kills: Array.from(c.kills.subarray(0, c.n)),
        wins: Array.from(c.wins.subarray(0, c.n)),
        weapon: c.wKind[seat],
        weaponLeft: c.wLeft[seat],
        shield: !!c.shield[seat],
        winner: c.winner,
        sudden: c.sudden,
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

  const fireOnce = () => {
    if (liveRef.current) apply(true);
  };

  return { cl, ai, ac, seat, hud, step, serverNow: () => net.now(), fireOnce, cfg, COUNT_TICKS };
}

export type TanksGameState = ReturnType<typeof useTanksGame>;
