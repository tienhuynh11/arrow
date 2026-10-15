import { useEffect, useMemo, useRef, useState } from 'react';
import { net } from '../../network/net';
import { useGameEvents } from '../../utils/hooks';
import { sfx } from '../../utils/sound';
import type { GameProps } from '../types';
import { DisasterClient, FL_WON, type DzConfig, type DzResult } from '@shared/disasterClient';
import { INTRO, THEME_NAME, TICK_HZ } from '@shared/disaster';

export interface DzHud {
  round: number;
  rounds: number;
  theme: string;
  inter: boolean;
  /** intro | warn | act | gap | end */
  stage: string;
  kind: number;
  /** giây còn lại của giai đoạn hiện tại (làm tròn lên) */
  secs: number;
  /** cảnh báo thứ hai đang chạy chồng (vòng cuối) */
  alsoKind: number;
  alive: boolean[];
  aliveN: number;
  meAlive: boolean;
  meWon: boolean;
  cause: number;
  wet: number;
  result: DzResult | null;
  finalRound: boolean;
}

const EMPTY: DzHud = {
  round: 1, rounds: 3, theme: '', inter: false, stage: 'intro', kind: 0, secs: 0, alsoKind: 0, alive: [], aliveN: 0,
  meAlive: true, meWon: false, cause: 0, wet: 0, result: null, finalRound: false,
};

/**
 * SURVIVAL HỖN LOẠN phía client. Dự đoán + nội suy + thảm họa nằm trong DisasterClient và chạy trong rAF
 * của cảnh 3D; React chỉ nhận HUD ~8 lần/giây.
 */
export function useDisasterGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as DzConfig;
  const ai = Math.max(0, cfg.arenas.findIndex((a) => a.includes(meId)));
  const ids = cfg.arenas[ai];
  const seat = Math.max(0, ids.indexOf(meId));

  const cl = useMemo(
    () => new DisasterClient(startAt, cfg, ai, seat),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startAt, ai, meId],
  );
  const clRef = useRef(cl);
  clRef.current = cl;
  const liveRef = useRef(live);
  liveRef.current = live;

  useGameEvents(gameId, (p) => {
    if (p && (p.y === 's' || p.y === 'e')) clRef.current.onMessage(p, net.now());
  });

  const keys = useRef({ l: false, r: false, u: false, d: false });
  const dir = () => {
    const k = keys.current;
    return { dx: (k.r ? 1 : 0) - (k.l ? 1 : 0), dy: (k.d ? 1 : 0) - (k.u ? 1 : 0) };
  };
  const apply = () => {
    if (!liveRef.current) return;
    const { dx, dy } = dir();
    const m = clRef.current.setDir(dx, dy, net.now());
    if (m) net.input(gameId, m);
  };
  const doJump = () => {
    if (!liveRef.current) return;
    const m = clRef.current.jump(net.now());
    if (m) {
      net.input(gameId, m);
      sfx.dzJump();
    }
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
        apply();
      } else if (e.code === 'Space') {
        e.preventDefault();
        doJump();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) apply();
    };
    const onBlur = () => {
      keys.current = { l: false, r: false, u: false, d: false };
      apply();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      keys.current = { l: false, r: false, u: false, d: false };
      apply();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, live, cl]);

  /** gọi mỗi khung hình trong rAF của cảnh: dự đoán tới giờ server + giữ hướng khớp với phím (kể cả khi sang vòng mới) */
  const step = (now: number) => {
    const c = clRef.current;
    c.frame(now);
    if (liveRef.current) {
      const { dx, dy } = dir();
      const m = c.setDir(dx, dy, now);
      if (m) net.input(gameId, m);
    }
  };

  /* HUD ~8Hz */
  const [hud, setHud] = useState<DzHud>(EMPTY);
  const lastKey = useRef('');
  const lastStage = useRef('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = clRef.current;
      const now = net.now();
      const local = c.localTick(now);
      const w = c.w;
      let stage = 'intro';
      let kind = 0;
      let alsoKind = 0;
      let secs = 0;
      if (c.inter) stage = 'end';
      else if (local < INTRO) {
        stage = 'intro';
        secs = Math.max(0, Math.ceil((INTRO - local) / TICK_HZ));
      } else {
        const p = w.phaseAt(local);
        if (p >= 0) {
          kind = w.pKind[p];
          stage = local < w.pAct[p] ? 'warn' : 'act';
          secs = Math.max(0, Math.ceil(((stage === 'warn' ? w.pAct[p] : w.pEnd[p]) - local) / TICK_HZ));
          const q = p > 0 && local < w.pEnd[p - 1] && local >= w.pWarn[p - 1] ? p - 1 : -1;
          if (q >= 0) alsoKind = w.pKind[q];
        } else stage = local > w.endTick - 20 ? 'act' : 'gap';
      }
      const alive: boolean[] = [];
      for (let i = 0; i < c.n; i++) alive.push(i === c.seat ? c.alive : (c.flags[i] & 7) === 0);
      const res = c.result;
      const h: DzHud = {
        round: c.round + 1,
        rounds: cfg.rounds,
        theme: THEME_NAME[w.theme],
        inter: c.inter,
        stage,
        kind,
        secs,
        alsoKind,
        alive,
        aliveN: alive.filter(Boolean).length,
        meAlive: c.alive,
        meWon: (c.flags[c.seat] & FL_WON) !== 0,
        cause: c.deathCause,
        wet: Math.round(c.wet * 20) / 20,
        result: res,
        finalRound: c.round >= cfg.rounds - 1,
      };
      const key = JSON.stringify(h);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setHud(h);
      }
      const sk = `${c.round}-${stage}-${kind}`;
      if (sk !== lastStage.current) {
        lastStage.current = sk;
        if (stage === 'end' && res) {
          if (res.rk[c.seat] === 1) sfx.winner();
          else sfx.miss();
        }
      }
    }, 120);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cl]);

  return { cl, ai, ids, seat, hud, step, serverNow: () => net.now(), doJump, cfg, TICK_HZ };
}

export type DisasterGameState = ReturnType<typeof useDisasterGame>;
