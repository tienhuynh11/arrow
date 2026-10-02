import { useEffect, useRef, useState } from 'react';
import { stepBody, type ArenaBody, type ArenaBox } from '@shared/bombArena';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface BombPos {
  x: number;
  y: number;
  /** độ cao chân (đang đứng trên bục / đang nhảy) */
  z: number;
  safe: boolean;
  out: boolean;
}

export interface BombConfig {
  w: number;
  h: number;
  speed: number;
  carrierBoost: number;
  tagRadius: number;
  playerRadius: number;
  boxes: ArenaBox[];
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

/**
 * Trạng thái + điều khiển của ĐUỔI BẮT BOM. Phần vẽ 3D chỉ đọc các ref ở đây.
 * Vị trí của chính mình được dự đoán bằng đúng hàm vật lý của server (shared/bombArena) cho mượt.
 */
export function useBombGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as BombConfig;

  const positions = useRef<Record<string, BombPos>>({});
  const body = useRef<ArenaBody>({ x: cfg.w / 2, y: cfg.h / 2, z: 0, vz: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const jumpAt = useRef(0);
  /** thời điểm (giờ máy) bấm nhảy gần nhất, để cảnh 3D chớp hiệu ứng bật nhảy */
  const jumpFx = useRef(0);
  const lastPredict = useRef(0);
  const holdersRef = useRef<string[]>([]);

  const [holders, setHolders] = useState<string[]>([]);
  const [fuseEnd, setFuseEnd] = useState(0);
  const [fuseLen, setFuseLen] = useState(14_000);
  const [round, setRound] = useState(0);
  const [out, setOut] = useState<Record<string, number>>({});
  const outRef = useRef(out);
  const [blastAt, setBlastAt] = useState<Record<string, number>>({});
  const [tagAt, setTagAt] = useState(0);
  const lastBeep = useRef(0);
  const now = useServerClock(70);

  const takeHolders = (list: string[]) => {
    const same = list.length === holdersRef.current.length && list.every((id, i) => id === holdersRef.current[i]);
    if (same) return;
    holdersRef.current = list;
    setHolders(list);
  };
  const markOut = (id: string, notify: boolean) => {
    if (outRef.current[id] !== undefined) return;
    outRef.current = { ...outRef.current, [id]: Date.now() };
    setOut(outRef.current);
    if (notify) {
      setBlastAt((s) => ({ ...s, [id]: Date.now() }));
      if (id === meId) sfx.miss();
      else sfx.tick();
    }
  };

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      const mine: BombPos | undefined = p.positions[meId];
      // lần đầu lấy vị trí từ server; sau đó chỉ kéo về khi dự đoán lệch nhiều
      if (
        mine &&
        (!synced.current ||
          mine.out ||
          Math.hypot(mine.x - body.current.x, mine.y - body.current.y) > 9 ||
          Math.abs(mine.z - body.current.z) > 7)
      ) {
        body.current = { x: mine.x, y: mine.y, z: mine.z, vz: 0 };
        synced.current = true;
      }
      if (Array.isArray(p.holders)) takeHolders(p.holders);
      // vào lại giữa ván thì chưa có sự kiện 'bomb' nào: lấy ngòi nổ từ gói vị trí
      if (typeof p.fuseEnd === 'number' && Math.abs(p.fuseEnd - fuseEnd) > 50) {
        setFuseLen(Math.max(1500, p.fuseLen ?? p.fuseEnd - net.now()));
        setFuseEnd(p.fuseEnd);
        setRound(p.round ?? 0);
      }
      // ai đã bị loại (kể cả người nổ lúc mình chưa vào lại)
      for (const id of Object.keys(p.positions)) if (p.positions[id].out) markOut(id, false);
    } else if (p.type === 'bomb') {
      takeHolders(p.holders);
      setFuseLen(Math.max(1500, p.fuseLen));
      setFuseEnd(p.fuseEnd);
      setRound(p.round);
      if (p.round > 0) sfx.start();
    } else if (p.type === 'tag') {
      holdersRef.current = holdersRef.current.map((id) => (id === p.from ? p.to : id));
      setHolders(holdersRef.current);
      setTagAt(Date.now());
      if (p.from === meId) sfx.perfect();
      else if (p.to === meId) sfx.miss();
      else sfx.tap();
    } else if (p.type === 'blast') {
      markOut(p.playerId, true);
    }
  });

  // giữ phím để chạy, SPACE để nhảy
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
        if (!e.repeat && !positions.current[meId]?.out) {
          jumpAt.current = net.now();
          jumpFx.current = Date.now();
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

  const remain = Math.max(0, fuseEnd - now);
  const ratio = fuseLen > 0 ? Math.max(0, Math.min(1, remain / fuseLen)) : 0;
  const iHold = holders.includes(meId);

  // ngòi càng ngắn tiếng tích tắc càng dồn (chỉ người ôm bom nghe rõ nhất, người khác nghe thưa hơn)
  useEffect(() => {
    if (!holders.length || remain <= 0) return;
    const gap = (remain < 1500 ? 170 : remain < 3000 ? 330 : 600) * (iHold ? 1 : 2);
    if (Date.now() - lastBeep.current > gap) {
      lastBeep.current = Date.now();
      sfx.tick();
    }
  }, [now, holders.length, remain, iHold]);

  /** Dự đoán vị trí + độ cao của chính mình bằng đúng vật lý của server; server vẫn là bên chốt chuyện chạm nhau. */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    if (!live || !synced.current || positions.current[meId]?.out) return;
    const { dx, dy } = sent.current;
    const sp = cfg.speed * (holdersRef.current.includes(meId) ? cfg.carrierBoost : 1);
    const wantJump = serverNow - jumpAt.current < 150;
    stepBody(cfg, body.current, dx, dy, sp, wantJump, dt);
    if (body.current.vz > 0) jumpAt.current = 0;
  };

  const posOf = (id: string): { x: number; y: number; z: number } | undefined =>
    id === meId && synced.current && !positions.current[meId]?.out ? body.current : positions.current[id];

  const alive = players.filter((p) => out[p.id] === undefined).length;

  return {
    cfg,
    positions,
    holders,
    holder: holders[0] ?? null,
    iHold,
    round,
    out,
    alive,
    total: players.length,
    blastAt,
    tagAt,
    jumpFx,
    ratio,
    predict,
    posOf,
    serverNow: () => net.now(),
  };
}

export type BombGameState = ReturnType<typeof useBombGame>;
