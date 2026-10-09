import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import { F_FIN, F_GROUND, F_OUT, F_STUN, lavaZ, newBody, stepLava, type LvBody, type LvConfig } from '@shared/lavaRun';
import type { GameProps } from '../types';

/** [x, y, z, cờ] */
export type LvPos = [number, number, number, number];

export type LvFx =
  | { kind: 'burn'; playerId: string; out: boolean; x: number; y: number; z: number }
  | { kind: 'col'; i: number };

/**
 * Trạng thái + điều khiển của SÀN LÀ DUNG NHAM.
 * Bục, dung nham đều là hàm của giờ server (net.now()) nên không đi qua mạng; mạng chỉ chở vị trí người chơi và vài sự kiện.
 * Vị trí của chính mình được dự đoán bằng đúng vật lý của server (shared/lavaRun) và chỉ snap khi lệch nhiều.
 */
export function useLavaGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as LvConfig;

  const positions = useRef<Record<string, LvPos>>({});
  const fx = useRef<LvFx[]>([]);
  const body = useRef<LvBody>(newBody());
  const synced = useRef(false);
  const trig = useRef<number[]>(cfg.plats.map(() => Infinity));
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const jumpAt = useRef(-1e9);
  const lastPredict = useRef(0);
  const bestZ = useRef(0);

  const [fin, setFin] = useState<Record<string, number>>({});
  const finRef = useRef(fin);
  const [hud, setHud] = useState({ pct: 0, gap: 99, out: false, burned: 0 });
  const burned = useRef(0);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.pos;
      const mine: LvPos | undefined = p.pos[meId];
      if (mine) {
        const b = body.current;
        const fl = mine[3];
        const hard = fl & (F_STUN | F_OUT | F_FIN);
        const err = Math.hypot(mine[0] - b.x, mine[1] - b.y);
        if (!synced.current || hard || err > 4 || Math.abs(mine[2] - b.z) > 3) {
          b.x = mine[0];
          b.y = mine[1];
          b.z = mine[2];
          b.vx = b.vy = b.vz = 0;
          b.on = fl & F_GROUND ? 0 : -1;
          b.air = 0;
          synced.current = true;
        } else if (err > 1.6) {
          // lệch vừa (bị người khác đẩy, bục trơn…): kéo dần về phía server
          b.x += (mine[0] - b.x) * 0.25;
          b.y += (mine[1] - b.y) * 0.25;
        }
      }
    } else if (p.type === 'col') {
      trig.current[p.i] = p.at / 1000;
      fx.current.push({ kind: 'col', i: p.i });
    } else if (p.type === 'burn') {
      fx.current.push({ kind: 'burn', playerId: p.playerId, out: p.out, x: p.x, y: p.y, z: p.z });
      if (p.playerId === meId) {
        sfx.miss();
        burned.current++;
      }
    } else if (p.type === 'finish') {
      if (finRef.current[p.playerId] !== undefined) return;
      finRef.current = { ...finRef.current, [p.playerId]: p.at };
      setFin(finRef.current);
      if (p.playerId === meId) sfx.winner();
      else sfx.tick();
    }
  });

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
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          jumpAt.current = net.now();
          net.input(gameId, { type: 'jump' });
        }
        return;
      }
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

  /** dự đoán vị trí của chính mình bằng đúng vật lý của server; server vẫn chốt dung nham, bục sụp, về đích */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const mine = positions.current[meId];
    if (!live || !synced.current || !mine || dt <= 0) return;
    if (mine[3] & (F_STUN | F_OUT | F_FIN)) return;
    const t = (serverNow - startAt) / 1000;
    if (t < 0) return;
    const b = body.current;
    const steps = Math.ceil(dt / 0.034);
    const sdt = dt / steps;
    const { dx, dy } = sent.current;
    for (let s = 0; s < steps; s++) {
      const wantJump = serverNow - jumpAt.current < 150;
      const jumped = stepLava(cfg.plats, trig.current, b, dx, dy, wantJump, t - dt + sdt * (s + 1), sdt, cfg.speed);
      if (jumped) jumpAt.current = -1e9;
    }
    if (b.on >= 0 && cfg.plats[b.on].z > bestZ.current) bestZ.current = cfg.plats[b.on].z;
  };

  const posOf = (id: string): { x: number; y: number; z: number } | undefined => {
    if (id === meId && synced.current) {
      const m = positions.current[meId];
      if (!m || !(m[3] & F_OUT)) return body.current;
    }
    const p = positions.current[id];
    return p ? { x: p[0], y: p[1], z: p[2] } : undefined;
  };

  // HUD gọn: cập nhật vài lần mỗi giây
  useEffect(() => {
    const iv = window.setInterval(() => {
      const t = (net.now() - startAt) / 1000;
      const m = positions.current[meId];
      const z = m ? m[2] : 0;
      const next = {
        pct: Math.max(0, Math.min(100, Math.round((bestZ.current / cfg.top) * 100))),
        gap: Math.round((z - lavaZ(cfg.lava, Math.max(0, t))) * 10) / 10,
        out: !!(m && m[3] & F_OUT),
        burned: burned.current,
      };
      setHud((h) => (h.pct === next.pct && h.gap === next.gap && h.out === next.out && h.burned === next.burned ? h : next));
    }, 250);
    return () => window.clearInterval(iv);
  }, [startAt, meId, cfg]);

  return {
    cfg,
    positions,
    fx,
    trig,
    fin,
    hud,
    total: players.length,
    startAt,
    predict,
    posOf,
    serverNow: () => net.now(),
    meBody: body,
  };
}

export type LavaGameState = ReturnType<typeof useLavaGame>;
