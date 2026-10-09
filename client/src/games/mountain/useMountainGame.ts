import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface MtPos {
  x: number;
  y: number;
  /** đang choáng sau khi bị trúng */
  s: boolean;
  /** đang được bảo vệ (nhấp nháy) */
  g: boolean;
  /** giờ lên đỉnh (ms từ lúc bắt đầu), 0 = chưa */
  f: number;
  /** đang tăng tốc */
  b?: boolean;
  /** đang có khiên */
  h?: boolean;
}

export interface MtRock {
  id: number;
  x: number;
  y: number;
  /** giờ server (ms) rơi chạm đất */
  land: number;
}

export interface MtGust {
  dir: number;
  from: number;
  to: number;
}

export interface MtPickup {
  id: number;
  k: 0 | 1;
  x: number;
  y: number;
}

export interface MtObstacle {
  k: 0 | 1;
  x: number;
  t0: number;
  v: number;
  s: number;
}

export interface MtSpinner {
  x: number;
  y: number;
  half: number;
  w: number;
  ph: number;
}

export interface MtConfig {
  w: number;
  len: number;
  speed: number;
  radius: number;
  knock: number;
  stun: number;
  topY: number;
  logDepth: number;
  obstacles: MtObstacle[];
  spinners: MtSpinner[];
  pickups: MtPickup[];
  checkpoints: number[];
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

export interface MtFx {
  playerId: string;
  kind: 'ball' | 'log' | 'spin' | 'rock';
  ox: number;
  oy: number;
}

/**
 * Trạng thái + điều khiển của LEO NÚI ĐỔ.
 * Chướng ngại KHÔNG đi qua mạng: cảnh tự tính vị trí từ lịch trong config + đồng hồ server (net.now()),
 * nên rớt gói hay trễ mạng cũng không làm bóng/búa giật. Mạng chỉ chở vị trí người chơi và các cú trúng.
 */
export function useMountainGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as MtConfig;

  const positions = useRef<Record<string, MtPos>>({});
  const fx = useRef<MtFx[]>([]);
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const pct = useRef(0);
  const rocks = useRef<MtRock[]>([]);
  const impacts = useRef<number[]>([]);
  const gusts = useRef<MtGust[]>([]);
  const taken = useRef(new Set<number>());
  const boostUntil = useRef(0);
  const [banner, setBanner] = useState<{ text: string; tone: string; until: number } | null>(null);
  const [lastCall, setLastCall] = useState(0);
  const [shield, setShield] = useState(false);
  const bannerTimer = useRef(0);
  const say = (text: string, tone: string, ms = 2200) => {
    setBanner({ text, tone, until: Date.now() + ms });
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), ms);
  };
  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);

  const [fin, setFin] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const finRef = useRef(fin);
  const shieldRef = useRef(false);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      const mine: MtPos | undefined = p.positions[meId];
      if (mine) {
        if (!!mine.h !== shieldRef.current) {
          shieldRef.current = !!mine.h;
          setShield(!!mine.h);
        }
        // bị văng/choáng hoặc đã về đích: lấy vị trí server; còn lại chỉ chỉnh khi lệch nhiều
        if (!synced.current || mine.s || mine.f || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8) {
          me.current = { x: mine.x, y: mine.y };
          synced.current = true;
        }
        const h = Math.min(100, Math.floor((mine.y / cfg.len) * 100));
        if (h !== pct.current) {
          pct.current = h;
          setHeight(h);
        }
      }
    } else if (p.type === 'hit') {
      fx.current.push({ playerId: p.playerId, kind: p.kind, ox: p.ox, oy: p.oy });
      if (p.playerId === meId) {
        if (p.blocked) {
          sfx.tick();
          say('KHIÊN ĐÃ CHẶN!', 'good', 1200);
        } else sfx.miss();
      }
    } else if (p.type === 'warn') {
      if (p.kind === 'rock') {
        rocks.current.push(...(p.rocks as MtRock[]));
        say('ĐÁ RƠI! Tránh vòng đỏ', 'bad');
      } else {
        gusts.current.push({ dir: p.dir, from: p.from, to: p.to });
        say(p.dir > 0 ? 'GIÓ SẮP THỔI SANG PHẢI ➜' : '⬅ GIÓ SẮP THỔI SANG TRÁI', 'warn');
      }
      sfx.tick();
    } else if (p.type === 'impact') {
      impacts.current.push(p.id);
    } else if (p.type === 'pick') {
      if (p.playerId === meId) {
        taken.current.add(p.item);
        if (p.k === 0) {
          boostUntil.current = net.now() + 2500;
          say('TĂNG TỐC!', 'good', 1100);
        } else say('CÓ KHIÊN!', 'good', 1100);
        sfx.tick();
      }
    } else if (p.type === 'cp') {
      if (p.playerId === meId) say('CHECKPOINT ' + p.i, 'good', 1200);
    } else if (p.type === 'lastcall') {
      setLastCall(p.until);
    } else if (p.type === 'finish') {
      if (finRef.current[p.playerId] !== undefined) return;
      finRef.current = { ...finRef.current, [p.playerId]: p.at };
      setFin(finRef.current);
      if (p.playerId === meId) sfx.winner();
      else sfx.tick();
    }
  });

  // giữ phím để chạy mọi hướng (lên = leo về phía đỉnh)
  useEffect(() => {
    if (!live) return;
    const push = () => {
      const dx = (keys.current.r ? 1 : 0) - (keys.current.l ? 1 : 0);
      const dy = (keys.current.u ? 1 : 0) - (keys.current.d ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const set = (code: string, on: boolean) => {
      if (code === 'ArrowLeft' || code === 'KeyA') keys.current.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') keys.current.r = on;
      else if (code === 'ArrowUp' || code === 'KeyW') keys.current.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') keys.current.d = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
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
    // nhắc lại hướng đang giữ, phòng khi gói keyup bị mất
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

  /** dự đoán vị trí của chính mình cho mượt; server vẫn chốt ai bị trúng */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    const mine = positions.current[meId];
    if (!live || !synced.current || !mine || mine.s || mine.f) return;
    const maxW = cfg.w / 2 - cfg.radius;
    for (const g of gusts.current) {
      if (serverNow >= g.from && serverNow < g.to) me.current.x = Math.max(-maxW, Math.min(maxW, me.current.x + g.dir * 9 * dt));
    }
    if (!dx && !dy) return;
    const len = Math.hypot(dx, dy) || 1;
    const maxX = cfg.w / 2 - cfg.radius;
    const sp = cfg.speed * (serverNow < boostUntil.current ? 1.55 : 1);
    me.current = {
      x: Math.max(-maxX, Math.min(maxX, me.current.x + (dx / len) * sp * dt)),
      y: Math.max(0, Math.min(cfg.len, me.current.y + (dy / len) * sp * dt)),
    };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  return { cfg, positions, fx, rocks, impacts, gusts, taken, banner, lastCall, shield, fin, height, total: players.length, startAt, predict, posOf, serverNow: () => net.now() };
}

export type MountainGameState = ReturnType<typeof useMountainGame>;
