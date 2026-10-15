import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';
import { newBoard, type Board, type Orient, type Pos, type Side, type Wall } from '@shared/wallrush';

export interface WrTableCfg {
  players: string[];
  sides: Side[];
  walls: number;
}

export interface WrConfig {
  tables: WrTableCfg[];
  turnMs: number;
  afkMs: number;
  endsAt: number;
}

export interface WrLast {
  k: 'step' | 'jump' | 'diag' | 'wall' | 'auto';
  s: number;
  over?: number;
  win?: number;
}

/** trạng thái bàn của mình (server gửi nguyên cả bàn mỗi khi đổi + định kỳ) */
export interface WrState {
  seq: number;
  pos: Pos[];
  walls: (Wall & { by: number })[];
  wl: number[];
  turn: number;
  endsAt: number;
  winner: number;
  over: boolean;
  order: number[];
  last: WrLast | null;
}

/** thứ tự ưu tiên: kết quả xem trước của chuột/chạm */
export interface WrHover {
  kind: 'cell' | 'wall';
  x: number;
  y: number;
  o?: Orient;
  ok: boolean;
  reason?: string;
}

export interface WrLogItem {
  id: number;
  text: string;
  color: string;
}

export type WrMode = 'move' | 'wall';

export const boardOf = (cfg: WrConfig, ti: number, st: WrState): Board => ({
  sides: cfg.tables[ti].sides,
  pos: st.pos,
  walls: st.walls,
  wallsLeft: st.wl,
});

const decode = (p: any): WrState => ({
  seq: p.seq,
  pos: (p.pos as number[][]).map(([x, y]) => ({ x, y })),
  walls: (p.walls as any[]).map(([x, y, o, by]) => ({ x, y, o, by })),
  wl: p.wl,
  turn: p.turn,
  endsAt: p.endsAt,
  winner: p.winner,
  over: !!p.over,
  order: p.order ?? [],
  last: p.last ?? null,
});

/**
 * Trạng thái + điều khiển của ĐUA TƯỜNG. Server là trọng tài; client chỉ giữ bản mới nhất
 * của bàn mình và gửi `wmove` / `wwall`. Đồng hồ lượt tính theo giờ server.
 */
export function useWallRushGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as WrConfig;
  const found = cfg.tables.findIndex((t) => t.players.includes(meId));
  const ti = Math.max(0, found);
  const table = cfg.tables[ti];
  const seat = found >= 0 ? table.players.indexOf(meId) : -1;

  const init = (): WrState => {
    const b = newBoard(table.players.length);
    return { seq: 0, pos: b.pos, walls: [], wl: b.wallsLeft, turn: 0, endsAt: startAt + 15_000, winner: -1, over: false, order: [], last: null };
  };
  const st = useRef<WrState>(init());
  const [ver, setVer] = useState(0);
  const [mode, setModeState] = useState<WrMode>('move');
  const modeRef = useRef<WrMode>('move');
  const manualO = useRef<Orient | null>(null);
  const [manual, setManual] = useState<Orient | null>(null);
  const hoverRef = useRef<WrHover | null>(null);
  const [hover, setHoverState] = useState<WrHover | null>(null);
  const [touch, setTouch] = useState(false);
  const [log, setLog] = useState<WrLogItem[]>([]);
  const lastSend = useRef(0);
  const logId = useRef(0);

  const nameOf = (s: number) => players.find((p) => p.id === table.players[s])?.name ?? '?';
  const colorOf = (s: number) => players.find((p) => p.id === table.players[s])?.color ?? '#fff';

  const pushLog = (text: string, color: string) => {
    const id = ++logId.current;
    setLog((l) => [...l.slice(-3), { id, text, color }]);
    window.setTimeout(() => setLog((l) => l.filter((x) => x.id !== id)), 7000);
  };

  useGameEvents(gameId, (p) => {
    if (p.type !== 'tb' || p.ti !== ti) return;
    const next = decode(p);
    const cur = st.current;
    if (next.seq < cur.seq) return;
    const fresh = next.seq > cur.seq;
    st.current = next;
    if (!fresh) {
      // gói định kỳ: chỉ cần render lại khi đổi lượt (vào lại giữa ván)
      if (next.turn !== cur.turn || next.over !== cur.over) setVer((v) => v + 1);
      return;
    }
    setVer((v) => v + 1);
    const l = next.last;
    if (l) {
      const who = nameOf(l.s);
      const c = colorOf(l.s);
      const over = l.over !== undefined ? nameOf(l.over) : '';
      if (l.k === 'wall') {
        pushLog(`${who} đặt tường`, c);
        sfx.tap();
      } else if (l.k === 'jump') {
        pushLog(`${who} nhảy qua ${over}`, c);
        sfx.good();
      } else if (l.k === 'diag') {
        pushLog(`${who} bước chéo qua ${over}`, c);
        sfx.good();
      } else if (l.k === 'auto') {
        pushLog(`${who} hết giờ, quân tự đi`, c);
        sfx.tick();
      } else {
        sfx.tick();
      }
      if (l.win !== undefined) {
        pushLog(`${nameOf(l.win)} về đích!`, colorOf(l.win));
        if (l.win === seat) sfx.winner();
        else sfx.miss();
      } else if (next.turn === seat && seat >= 0) {
        sfx.start();
      }
    }
  });

  const setMode = (m: WrMode) => {
    modeRef.current = m;
    setModeState(m);
    if (m === 'move') {
      manualO.current = null;
      setManual(null);
    }
  };
  const rotate = (cur?: Orient) => {
    const next: Orient = (manualO.current ?? cur ?? 'h') === 'h' ? 'v' : 'h';
    manualO.current = next;
    setManual(next);
  };
  const setHover = (h: WrHover | null) => {
    const a = hoverRef.current;
    hoverRef.current = h;
    if (!a && !h) return;
    if (a && h && a.kind === h.kind && a.x === h.x && a.y === h.y && a.o === h.o && a.ok === h.ok && a.reason === h.reason) return;
    setHoverState(h);
  };

  const canAct = () => {
    const s = st.current;
    return live && seat >= 0 && !s.over && s.turn === seat && Date.now() - lastSend.current > 300;
  };
  const doMove = (x: number, y: number) => {
    if (!canAct()) return;
    lastSend.current = Date.now();
    net.input(gameId, { type: 'wmove', x, y });
  };
  const doWall = (x: number, y: number, o: Orient) => {
    if (!canAct()) return;
    lastSend.current = Date.now();
    net.input(gameId, { type: 'wwall', x, y, o });
    setMode('move');
  };
  const confirm = () => {
    const h = hoverRef.current;
    if (h && h.kind === 'wall' && h.ok && h.o) doWall(h.x, h.y, h.o);
  };

  const live2 = useRef(live);
  live2.current = live;
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyW') {
        e.preventDefault();
        setMode(modeRef.current === 'wall' ? 'move' : 'wall');
      } else if (e.code === 'Escape') {
        setMode('move');
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        const h = hoverRef.current;
        rotate(h?.o);
      } else if (e.code === 'Enter' || e.code === 'Space') {
        if (modeRef.current === 'wall') {
          e.preventDefault();
          confirm();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);

  return {
    cfg,
    ti,
    seat,
    table,
    live,
    st,
    ver,
    mode,
    modeRef,
    manual,
    manualO,
    hover,
    touch,
    setTouch,
    log,
    setMode,
    rotate,
    setHover,
    doMove,
    doWall,
    confirm,
    nameOf,
    colorOf,
    serverNow: () => net.now(),
  };
}

export type WallRushState = ReturnType<typeof useWallRushGame>;
