import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface DoorPos {
  x: number;
  y: number;
  /** đang choáng sau khi đâm cửa giả */
  s: boolean;
  /** giờ về đích (ms từ lúc bắt đầu), 0 = chưa về */
  f: number;
  /** điểm cạnh tranh */
  p: number;
  /** hệ số tốc độ hiện tại (tăng tốc / hỗ trợ tụt lùi) */
  k?: number;
  /** đang tụt lùi so với người dẫn đầu */
  b?: boolean;
}

export interface DoorConfig {
  w: number;
  cols: number;
  doorW: number;
  rows: number;
  rowY: number[];
  half: number;
  finishY: number;
  speed: number;
  radius: number;
  knock: number;
  stun: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

/** hiệu ứng chờ cảnh vẽ: cửa bật mở hoặc có người đâm trúng cửa giả */
export interface DoorFx {
  kind: 'door' | 'bump' | 'shut';
  row: number;
  col: number;
  by: string;
}

/** Trạng thái + điều khiển của CỬA BÍ MẬT. Client KHÔNG biết cửa nào thật — chỉ biết cửa nào đã mở. */
export function useDoorGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as DoorConfig;

  const positions = useRef<Record<string, DoorPos>>({});
  const open = useRef<boolean[]>(new Array(cfg.rows * cfg.cols).fill(false));
  const fx = useRef<DoorFx[]>([]);
  /** giờ server (net.now) cửa thật sẽ đóng sầm; 0 = không mở */
  const tried = useRef<boolean[]>([]);
  const closeAt = useRef<number[]>(new Array(cfg.rows * cfg.cols).fill(0));
  const [toast, setToast] = useState<{ n: number; pts: number } | null>(null);
  const me = useRef({ x: 0, y: 0 });
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const passed = useRef(0);

  const [fin, setFin] = useState<Record<string, number>>({});
  const [row, setRow] = useState(0);
  const [pts, setPts] = useState(0);
  const [boost, setBoost] = useState(1);
  const [behind, setBehind] = useState(false);
  const [banner, setBanner] = useState<{ n: number; text: string } | null>(null);
  const finRef = useRef(fin);

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.positions;
      if (typeof p.tried === 'string') tried.current = Array.from(p.tried as string, (c) => c === '1');
      if (typeof p.open === 'string') {
        open.current = Array.from(p.open as string, (c) => c === '1');
        open.current.forEach((o, i) => {
          if (!o) closeAt.current[i] = 0;
        });
      }
      const mine: DoorPos | undefined = p.positions[meId];
      if (mine) {
        // choáng/bị văng: lấy vị trí của server; còn lại chỉ chỉnh khi lệch nhiều
        if (!synced.current || mine.s || mine.f || Math.hypot(mine.x - me.current.x, mine.y - me.current.y) > 8) {
          me.current = { x: mine.x, y: mine.y };
          synced.current = true;
        }
        setPts(mine.p ?? 0);
        setBoost(mine.k ?? 1);
        setBehind(!!mine.b);
        const n = cfg.rowY.filter((y) => mine.y > y).length;
        if (n !== passed.current) {
          passed.current = n;
          setRow(n);
        }
      }
    } else if (p.type === 'door') {
      open.current[p.row * cfg.cols + p.col] = true;
      closeAt.current[p.row * cfg.cols + p.col] = net.now() + (p.ms ?? 3200);
      fx.current.push({ kind: 'door', row: p.row, col: p.col, by: p.by });
      if (p.by === meId) sfx.great();
      setBanner((b) => ({ n: (b?.n ?? 0) + 1, text: `${p.by === meId ? 'BẠN' : 'Có người'} TÌM RA CỬA THẬT! +${p.pts ?? 1} điểm, tăng tốc` }));
    } else if (p.type === 'shut') {
      open.current[p.row * cfg.cols + p.col] = false;
      closeAt.current[p.row * cfg.cols + p.col] = 0;
      fx.current.push({ kind: 'shut', row: p.row, col: p.col, by: '' });
    } else if (p.type === 'pass') {
      if (p.playerId === meId) {
        sfx.great();
        setToast((t) => ({ n: (t?.n ?? 0) + 1, pts: p.pts }));
      }
    } else if (p.type === 'bump') {
      fx.current.push({ kind: 'bump', row: p.row, col: p.col, by: p.by });
      if (p.by === meId) sfx.miss();
    } else if (p.type === 'finish') {
      if (finRef.current[p.playerId] !== undefined) return;
      finRef.current = { ...finRef.current, [p.playerId]: p.at };
      setFin(finRef.current);
      if (p.playerId === meId) sfx.winner();
      else sfx.tick();
    }
  });

  // giữ phím để chạy mọi hướng (lên = về phía đích)
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

  /** dự đoán vị trí của chính mình (cùng luật va chạm với server); server vẫn chốt cửa nào thật */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const { dx, dy } = sent.current;
    const mine = positions.current[meId];
    if (!live || !synced.current || (!dx && !dy) || !mine || mine.s || mine.f) return;
    const spd = cfg.speed * (mine.k ?? 1);
    const R = cfg.radius;
    const colOf = (x: number) => Math.max(0, Math.min(cfg.cols - 1, Math.floor((x + cfg.w / 2) / cfg.doorW)));
    const blocked = (x: number, y: number) => {
      for (let r = 0; r < cfg.rows; r++) {
        if (y > cfg.rowY[r] - cfg.half - R && y < cfg.rowY[r] + cfg.half + R && !open.current[r * cfg.cols + colOf(x)]) return true;
      }
      return false;
    };
    const len = Math.hypot(dx, dy) || 1;
    const maxX = cfg.w / 2 - R;
    const nx = Math.max(-maxX, Math.min(maxX, me.current.x + (dx / len) * spd * dt));
    const ny = Math.max(0, Math.min(cfg.finishY, me.current.y + (dy / len) * spd * dt));
    const cur = me.current;
    if (!blocked(nx, ny)) me.current = { x: nx, y: ny };
    else if (!blocked(cur.x, ny)) me.current = { x: cur.x, y: ny };
    else if (!blocked(nx, cur.y)) me.current = { x: nx, y: cur.y };
  };

  const posOf = (id: string): { x: number; y: number } | undefined =>
    id === meId && synced.current ? me.current : positions.current[id];

  return {
    cfg,
    positions,
    open,
    fx,
    closeAt,
    toast,
    fin,
    row,
    total: players.length,
    pts,
    boost,
    behind,
    banner,
    tried,
    predict,
    posOf,
    serverNow: () => net.now(),
  };
}

export type DoorGameState = ReturnType<typeof useDoorGame>;
