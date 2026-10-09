import { useEffect, useRef, useState } from 'react';
import { stepChair, trackFactor, trackStep, type ChairCfg } from '@shared/chairArena';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ChConfig extends ChairCfg {
  ring: number;
  sit: number;
  run: number;
  scrambleMs: number;
  restMs: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

export type ChPhase = 'm' | 's' | 'r';

/** [x, y, ghế đang ngồi (-1 = chưa), còn sống] */
export type ChPlayer = [number, number, number, number];

/** giai điệu nền: ngũ cung vui tai, lặp lại */
const MELODY = [523, 587, 659, 784, 659, 587, 523, 392, 440, 523, 659, 587, 523, 440, 392, 440];

/**
 * Trạng thái + điều khiển của GHẾ ÂM NHẠC. Giờ nhạc dừng là bí mật của server: client chỉ biết khi nhận sự kiện `stop`,
 * nên nhạc nền ở đây chạy tới khi server báo dừng.
 */
export function useChairsGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as ChConfig;

  const snap = useRef<Record<string, ChPlayer>>({});
  /** [x, y, id người đang ngồi] */
  const chairs = useRef<[number, number, string][]>([]);
  const me = useRef({ x: cfg.spawns[meId]?.[0] ?? 0, y: cfg.spawns[meId]?.[1] ?? 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  /** giờ máy (ms) của lần dừng nhạc gần nhất, để cảnh chớp ghế */
  const stopFx = useRef(0);
  /** bán kính làn chạy của mình khi nhạc phát */
  const lane = useRef(84);

  const [phase, setPhase] = useState<ChPhase>('r');
  const [round, setRound] = useState(0);
  const [alive, setAlive] = useState<Record<string, boolean>>({});
  const [out, setOut] = useState<{ ids: string[]; at: number } | null>(null);
  const aliveRef = useRef<Record<string, boolean>>({});
  const phaseRef = useRef<ChPhase>('r');

  const setPh = (p: ChPhase) => {
    if (phaseRef.current === p) return;
    phaseRef.current = p;
    setPhase(p);
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'p') {
      snap.current = p.p;
      const mine: ChPlayer | undefined = p.p[meId];
      if (mine && (!synced.current || mine[2] >= 0 || Math.hypot(mine[0] - me.current.x, mine[1] - me.current.y) > 8)) {
        me.current = { x: mine[0], y: mine[1] };
        synced.current = true;
      }
      let changed = false;
      for (const id of Object.keys(p.p)) {
        const a = !!p.p[id][3];
        if (aliveRef.current[id] !== a) {
          aliveRef.current[id] = a;
          changed = true;
        }
      }
      if (changed) setAlive({ ...aliveRef.current });
      setPh(p.ph);
      if (p.full) {
        setRound(p.full.r);
        chairs.current = p.full.chairs;
        if (p.full.lanes?.[meId]) lane.current = p.full.lanes[meId];
      }
    } else if (p.type === 'round') {
      chairs.current = p.chairs.map((c: [number, number]) => [c[0], c[1], '']);
      if (p.lanes?.[meId]) lane.current = p.lanes[meId];
      synced.current = false;
      setRound(p.r);
      setPh('m');
      sfx.start();
    } else if (p.type === 'stop') {
      setPh('s');
      stopFx.current = Date.now();
      sfx.miss();
    } else if (p.type === 'seat') {
      if (chairs.current[p.c]) chairs.current[p.c][2] = p.p;
      if (p.p === meId) sfx.perfect();
      else sfx.tap();
    } else if (p.type === 'out') {
      setPh('r');
      setOut({ ids: p.ids, at: Date.now() });
      if (p.ids.includes(meId)) sfx.miss();
      else if (p.ids.length) sfx.tick();
    }
  });

  // nhạc nền: phát khi pha "nhạc", ngắt ngay khi server báo dừng
  useEffect(() => {
    if (!live || phase !== 'm') return;
    let i = 0;
    const id = window.setInterval(() => {
      sfx.note(MELODY[i++ % MELODY.length], 200);
    }, 240);
    return () => window.clearInterval(id);
  }, [live, phase]);

  useEffect(() => {
    if (!live) return;
    const push = () => {
      const k = keys.current;
      const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0);
      const dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const set = (code: string, on: boolean) => {
      const k = keys.current;
      if (code === 'ArrowLeft' || code === 'KeyA') k.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') k.r = on;
      else if (code === 'ArrowUp' || code === 'KeyW') k.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') k.d = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (set(e.code, true)) {
        e.preventDefault();
        push();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) push();
    };
    const onBlur = () => {
      keys.current = { l: false, r: false, u: false, d: false };
      push();
    };
    const beat = window.setInterval(() => {
      const { dx, dy } = sent.current;
      if (dx || dy) net.input(gameId, { type: 'moveXY', dx, dy });
    }, 400);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(beat);
    };
  }, [gameId, live]);

  /** dự đoán vị trí của mình bằng đúng hàm di chuyển của server (ngồi ghế rồi hoặc đã bị loại thì thôi) */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const mine = snap.current[meId];
    if (!live || !synced.current || !mine || mine[2] >= 0 || !mine[3]) return;
    const { dx, dy } = sent.current;
    if (phaseRef.current === 'm') trackStep(cfg.run, me.current, lane.current, trackFactor(dx, dy), dt);
    else stepChair(cfg, me.current, dx, dy, dt);
  };

  return {
    cfg,
    live,
    snap,
    chairs,
    me,
    stopFx,
    phase,
    round,
    alive,
    out,
    players,
    meId,
    predict,
    serverNow: () => net.now(),
  };
}

export type ChairsGameState = ReturnType<typeof useChairsGame>;
