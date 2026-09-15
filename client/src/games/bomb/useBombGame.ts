import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface BombPos {
  x: number;
  y: number;
  safe: boolean;
  out: boolean;
}

export interface Pillar {
  x: number;
  y: number;
  r: number;
}

export interface BombConfig {
  w: number;
  h: number;
  speed: number;
  carrierBoost: number;
  tagRadius: number;
  playerRadius: number;
  pillars: Pillar[];
  lives: number;
  endsAt: number;
}

/**
 * Toàn bộ trạng thái + điều khiển của ĐUỔI BẮT BOM, dùng chung cho bản 2D và 3D.
 * Phần vẽ chỉ việc đọc các ref ở đây, nên hai bản luôn chạy đúng cùng một luật.
 */
export function useBombGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as BombConfig;

  const positions = useRef<Record<string, BombPos>>({});
  const me = useRef({ x: cfg.w / 2, y: cfg.h / 2 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const holderRef = useRef<string | null>(null);

  const [holder, setHolder] = useState<string | null>(null);
  const [fuseEnd, setFuseEnd] = useState(0);
  const [fuseLen, setFuseLen] = useState(7000);
  const [lives, setLives] = useState<Record<string, number>>({});
  const [blastAt, setBlastAt] = useState<Record<string, number>>({});
  const [tagAt, setTagAt] = useState(0);
  const lastBeep = useRef(0);
  const now = useServerClock(70);

  useEffect(() => {
    const l: Record<string, number> = {};
    for (const p of players) l[p.id] = cfg.lives;
    setLives(l);
  }, [players.length, cfg.lives]);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      const mine = p.positions[meId];
      // lần đầu lấy vị trí xuất phát từ server; sau đó chỉ kéo về khi lệch nhiều
      if (mine && (!synced.current || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8)) {
        me.current = { x: mine.x, y: mine.y };
        synced.current = true;
      }
      if (p.holder !== holderRef.current) {
        holderRef.current = p.holder;
        setHolder(p.holder);
      }
      // vào lại giữa ván thì chưa có sự kiện 'bomb' nào: lấy ngòi nổ từ gói vị trí
      if (typeof p.fuseEnd === 'number' && Math.abs(p.fuseEnd - fuseEnd) > 50) {
        setFuseLen(Math.max(1500, p.fuseEnd - net.now()));
        setFuseEnd(p.fuseEnd);
      }
    } else if (p.type === 'bomb') {
      holderRef.current = p.holder;
      setHolder(p.holder);
      setFuseLen(Math.max(1500, p.fuseEnd - net.now()));
      setFuseEnd(p.fuseEnd);
    } else if (p.type === 'tag') {
      holderRef.current = p.to;
      setHolder(p.to);
      setTagAt(Date.now());
      if (p.from === meId) sfx.perfect();
      else if (p.to === meId) sfx.miss();
      else sfx.tap();
    } else if (p.type === 'blast') {
      setBlastAt((s) => ({ ...s, [p.playerId]: Date.now() }));
      setLives((s) => ({ ...s, [p.playerId]: p.lives }));
      if (p.playerId === meId) sfx.miss();
      else sfx.tick();
    }
  });

  // giữ phím để chạy mọi hướng
  useEffect(() => {
    if (!live) return;
    const push = () => {
      const dx = (keys.current.r ? 1 : 0) - (keys.current.l ? 1 : 0);
      const dy = (keys.current.d ? 1 : 0) - (keys.current.u ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const set = (code: string, on: boolean) => {
      if (code === 'ArrowLeft') keys.current.l = on;
      else if (code === 'ArrowRight') keys.current.r = on;
      else if (code === 'ArrowUp') keys.current.u = on;
      else if (code === 'ArrowDown') keys.current.d = on;
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

  const remain = Math.max(0, fuseEnd - now);
  const ratio = fuseLen > 0 ? Math.max(0, Math.min(1, remain / fuseLen)) : 0;

  // ngòi càng ngắn tiếng tích tắc càng dồn
  useEffect(() => {
    if (!holder || remain <= 0) return;
    const gap = remain < 1500 ? 170 : remain < 3000 ? 330 : 600;
    if (Date.now() - lastBeep.current > gap) {
      lastBeep.current = Date.now();
      sfx.tick();
    }
  }, [now, holder, remain]);

  /** Dự đoán vị trí của chính mình cho mượt; server vẫn là bên chốt chuyện chạm nhau. */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    if (!live || !synced.current || (!dx && !dy) || positions.current[meId]?.out) return;

    const len = Math.hypot(dx, dy) || 1;
    const sp = cfg.speed * (holderRef.current === meId ? cfg.carrierBoost : 1);
    let nx = me.current.x + (dx / len) * sp * dt;
    let ny = me.current.y + (dy / len) * sp * dt;
    nx = Math.max(cfg.playerRadius, Math.min(cfg.w - cfg.playerRadius, nx));
    ny = Math.max(cfg.playerRadius, Math.min(cfg.h - cfg.playerRadius, ny));
    for (const c of cfg.pillars) {
      const ddx = nx - c.x;
      const ddy = ny - c.y;
      const d = Math.hypot(ddx, ddy);
      const min = c.r + cfg.playerRadius;
      if (d < min && d > 0.001) {
        nx = c.x + (ddx / d) * min;
        ny = c.y + (ddy / d) * min;
      }
    }
    me.current = { x: nx, y: ny };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  return {
    cfg,
    positions,
    holder,
    lives,
    blastAt,
    tagAt,
    ratio,
    predict,
    posOf,
    serverNow: () => net.now(),
  };
}

export type BombGameState = ReturnType<typeof useBombGame>;
