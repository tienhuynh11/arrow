import { useEffect, useRef, useState } from 'react';
import { stepCode, type CodeBox, type CodeMap } from '@shared/codeArena';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ChConfig {
  w: number;
  h: number;
  radius: number;
  boxes: CodeBox[];
  speed: number;
  vis: number;
  endsAt: number;
  respawnMs: number;
  spawns: Record<string, [number, number]>;
}

export interface ChMe {
  x: number;
  y: number;
  code: string;
  alive: boolean;
  respawnAt: number;
  inv: number;
  killer: string;
}

/** người khác chỉ có mặt ở đây khi server cho phép (đang nhìn thấy họ): [x, y, mã (rỗng nếu đang đối mặt), miễn nhiễm, hướng mặt x, hướng mặt y] */
export type ChOthers = Record<string, [number, number, string, number, number, number]>;

/** Trạng thái + điều khiển của MÃ SÁT THỦ: chạy bằng mũi tên/WASD, gõ 3 số để hạ mục tiêu. */
export function useCodeHuntGame({ gameId, config, endAt, players, meId, live }: GameProps) {
  const cfg = config as ChConfig;
  const map: CodeMap = { w: cfg.w, h: cfg.h, radius: cfg.radius, boxes: cfg.boxes };

  const me = useRef<ChMe | null>(null);
  const others = useRef<ChOthers>({});
  /** vị trí tự dự đoán của chính mình */
  const mine = useRef({ x: cfg.spawns[meId]?.[0] ?? cfg.w / 2, y: cfg.spawns[meId]?.[1] ?? cfg.h / 2 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  /** hướng mặt của chính mình = hướng bấm gần nhất */
  const facing = useRef({ x: 0, y: 1 });
  const lastPredict = useRef(0);
  /** các vụ hạ gần đây (giờ máy) để cảnh chớp hiệu ứng */
  const killFx = useRef<{ at: number; x: number; y: number; victim: string }[]>([]);

  const [typed, setTyped] = useState('');
  const typedRef = useRef('');
  const [lockUntil, setLockUntil] = useState(0);
  const lockRef = useRef(0);
  lockRef.current = lockUntil;
  const [flash, setFlash] = useState<{ at: number; ok: boolean; text: string } | null>(null);
  const [kills, setKills] = useState<Record<string, number>>({});
  const [deaths, setDeaths] = useState<Record<string, number>>({});
  const [feed, setFeed] = useState<{ id: number; killer: string; victim: string }[]>([]);
  const [alive, setAlive] = useState(true);
  const [myCode, setMyCode] = useState('');
  const [respawnAt, setRespawnAt] = useState(0);
  const [killer, setKiller] = useState('');
  const feedId = useRef(0);
  const aliveRef = useRef(true);

  const setTypedBoth = (v: string) => {
    typedRef.current = v;
    setTyped(v);
  };

  /** gõ một chữ số; đủ 3 số thì gửi lên server */
  const type = (d: string) => {
    if (!live || !aliveRef.current || Date.now() < lockRef.current) return;
    const next = (typedRef.current + d).slice(0, 3);
    setTypedBoth(next);
    if (next.length === 3) {
      net.input(gameId, { type: 'code', code: next });
      window.setTimeout(() => setTypedBoth(''), 120);
    }
  };
  const typeRef = useRef(type);
  typeRef.current = type;
  const backspace = () => setTypedBoth(typedRef.current.slice(0, -1));

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      const m: ChMe = p.me;
      me.current = m;
      others.current = p.o ?? {};
      if (!synced.current || !m.alive || Math.hypot(m.x - mine.current.x, m.y - mine.current.y) > 6) {
        mine.current = { x: m.x, y: m.y };
        synced.current = true;
      }
      if (m.alive !== aliveRef.current) {
        aliveRef.current = m.alive;
        setAlive(m.alive);
        if (!m.alive) setTypedBoth('');
      }
      setMyCode((c) => (c === m.code ? c : m.code));
      setRespawnAt((r) => (r === m.respawnAt ? r : m.respawnAt));
      setKiller((k) => (k === m.killer ? k : m.killer));
    } else if (p.type === 'score') {
      setKills(p.k);
      setDeaths(p.d);
    } else if (p.type === 'kill') {
      killFx.current.push({ at: Date.now(), x: p.x, y: p.y, victim: p.victim });
      const id = ++feedId.current;
      setFeed((f) => [...f.slice(-3), { id, killer: p.killer, victim: p.victim }]);
      window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4500);
      if (p.victim === meId) sfx.miss();
      else if (p.killer === meId) sfx.perfect();
      else sfx.tick();
    } else if (p.type === 'result') {
      if (p.ok) {
        setFlash({ at: Date.now(), ok: true, text: 'ĐÃ HẠ!' });
      } else if (p.reason === 'shield') {
        setFlash({ at: Date.now(), ok: false, text: 'Đang có khiên!' });
      } else {
        setFlash({ at: Date.now(), ok: false, text: 'SAI MÃ' });
        setLockUntil(Date.now() + (p.lockMs ?? 900));
        sfx.miss();
      }
    }
  });

  useEffect(() => {
    if (!live) return;
    const push = () => {
      const dx = (keys.current.r ? 1 : 0) - (keys.current.l ? 1 : 0);
      const dy = (keys.current.d ? 1 : 0) - (keys.current.u ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      if (dx || dy) facing.current = { x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) };
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        if (!e.repeat) typeRef.current(digit[2]);
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault();
        setTypedBoth(typedRef.current.slice(0, -1));
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

  /** dự đoán vị trí của chính mình bằng đúng hàm di chuyển của server */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    if (!live || !synced.current || !aliveRef.current) return;
    const { dx, dy } = sent.current;
    stepCode(map, mine.current, dx, dy, cfg.speed, dt);
  };

  return {
    cfg,
    live,
    endAt,
    me,
    others,
    mine,
    facing,
    killFx,
    typed,
    type,
    backspace,
    lockUntil,
    flash,
    kills,
    deaths,
    feed,
    alive,
    myCode,
    respawnAt,
    killer,
    players,
    meId,
    predict,
    serverNow: () => net.now(),
  };
}

export type CodeHuntGameState = ReturnType<typeof useCodeHuntGame>;
