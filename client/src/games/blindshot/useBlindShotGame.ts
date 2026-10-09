import { useEffect, useRef, useState } from 'react';
import { stepBlind, type BlindBody, type BlindCfg } from '@shared/blindArena';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface BsConfig extends BlindCfg {
  prepMs: number;
  hideMs: number;
  revealMs: number;
  rounds: number;
  endsAt: number;
  spawns: Record<string, [number, number, number]>;
}

export type BsPhase = 'prep' | 'hide' | 'reveal';

/** kết quả một lượt bắn đồng loạt */
export interface BsFire {
  r: number;
  pos: Record<string, [number, number, number]>;
  shots: { id: string; hit: string | null; len: number }[];
  /** giờ máy lúc nhận, để cảnh dựng tia đạn đúng một lần */
  at: number;
}

/**
 * Trạng thái + điều khiển của ĐẤU TRƯỜNG MÙ. Pha ẩn: server không gửi vị trí ai khác,
 * nên `others` chỉ có dữ liệu ở pha chuẩn bị / kết quả.
 */
export function useBlindShotGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as BsConfig;
  const roundMs = cfg.prepMs + cfg.hideMs + cfg.revealMs;

  /** thân của chính mình: tự dự đoán, server sửa khi lệch */
  const body = useRef<BlindBody>({
    x: cfg.spawns[meId]?.[0] ?? 0,
    y: cfg.spawns[meId]?.[1] ?? 0,
    a: cfg.spawns[meId]?.[2] ?? 0,
  });
  const synced = useRef(false);
  const others = useRef<Record<string, [number, number, number]>>({});
  const keys = useRef({ u: false, d: false, l: false, r: false });
  const sent = useRef({ dx: 0, dy: 0 });
  /** góc ngắm theo chuột: cảnh 3D tính từ vị trí con trỏ rồi ghi vào đây */
  const aim = useRef(cfg.spawns[meId]?.[2] ?? 0);
  const sentAim = useRef(9);
  const lastPredict = useRef(0);
  const fire = useRef<BsFire | null>(null);

  const [hits, setHits] = useState<Record<string, number>>({});
  const [hurt, setHurt] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<{ r: number; hit: boolean; hurt: number } | null>(null);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      if (p.ph === 'hide') {
        const m = p.me as [number, number, number];
        others.current = {};
        if (!synced.current || Math.hypot(m[0] - body.current.x, m[1] - body.current.y) > 6) {
          body.current = { x: m[0], y: m[1], a: m[2] };
          synced.current = true;
        }
      } else {
        const all = p.all as Record<string, [number, number, number]>;
        const { [meId]: m, ...rest } = all;
        others.current = rest;
        if (m && (!synced.current || Math.hypot(m[0] - body.current.x, m[1] - body.current.y) > 6)) {
          body.current = { x: m[0], y: m[1], a: m[2] };
          synced.current = true;
        }
      }
    } else if (p.type === 'fire') {
      fire.current = { r: p.r, pos: p.pos, shots: p.shots, at: Date.now() };
      others.current = Object.fromEntries(Object.entries(p.pos as Record<string, [number, number, number]>).filter(([id]) => id !== meId));
      const mine = p.pos[meId];
      if (mine) body.current = { x: mine[0], y: mine[1], a: mine[2] };
      setHits(p.hits);
      setHurt(p.hurt);
      const myShot = p.shots.find((s: { id: string }) => s.id === meId);
      const gotHurt = p.shots.filter((s: { hit: string | null }) => s.hit === meId).length;
      setLastResult({ r: p.r, hit: !!myShot?.hit, hurt: gotHurt });
      if (myShot?.hit) sfx.perfect();
      else if (gotHurt) sfx.miss();
      else sfx.tap();
    }
  });

  useEffect(() => {
    if (!live) return;
    const send = () => {
      const k = keys.current;
      const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0);
      const dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      sent.current = { dx, dy };
      sentAim.current = aim.current;
      net.input(gameId, { type: 'steer', dx, dy, a: aim.current });
    };
    const set = (code: string, on: boolean) => {
      const k = keys.current;
      if (code === 'ArrowUp' || code === 'KeyW') k.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') k.d = on;
      else if (code === 'ArrowLeft' || code === 'KeyA') k.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') k.r = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (set(e.code, true)) {
        e.preventDefault();
        send();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) send();
    };
    const onBlur = () => {
      keys.current = { u: false, d: false, l: false, r: false };
      send();
    };
    // gửi lại hướng chạy + góc ngắm: ngay khi chuột xoay đủ nhiều, và nhắc lại mỗi 400ms
    const watch = window.setInterval(() => {
      if (Math.abs(Math.atan2(Math.sin(aim.current - sentAim.current), Math.cos(aim.current - sentAim.current))) > 0.03) send();
    }, 50);
    const beat = window.setInterval(send, 400);
    send();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(watch);
      window.clearInterval(beat);
    };
  }, [gameId, live]);

  /** phase theo giờ server */
  const phaseAt = (serverNow: number): { phase: BsPhase; round: number; left: number } => {
    const rel = Math.max(0, serverNow - startAt);
    const round = Math.min(cfg.rounds - 1, Math.floor(rel / roundMs));
    const off = rel - round * roundMs;
    if (off < cfg.prepMs) return { phase: 'prep', round, left: cfg.prepMs - off };
    if (off < cfg.prepMs + cfg.hideMs) return { phase: 'hide', round, left: cfg.prepMs + cfg.hideMs - off };
    return { phase: 'reveal', round, left: roundMs - off };
  };

  /** dự đoán thân của mình bằng đúng hàm di chuyển của server (đứng yên ở pha kết quả) */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    if (!live || !synced.current || phaseAt(serverNow).phase === 'reveal') return;
    const s = sent.current;
    stepBlind(cfg, body.current, s.dx, s.dy, dt);
  };

  return {
    cfg,
    live,
    startAt,
    body,
    aim,
    others,
    fire,
    hits,
    hurt,
    lastResult,
    players,
    meId,
    phaseAt,
    predict,
    serverNow: () => net.now(),
  };
}

export type BlindShotGameState = ReturnType<typeof useBlindShotGame>;
