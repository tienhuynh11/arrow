import { useEffect, useRef, useState } from 'react';
import { CELL_CRATE, CELL_FLOOR, parseGrid, stepMaze, type MazeGrid } from '@shared/bombMaze';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface BmConfig {
  cols: number;
  rows: number;
  grid: string;
  spawns: Record<string, [number, number]>;
  speed: number;
  speedStep: number;
  fuseMs: number;
  flameMs: number;
  closeStartMs: number;
  closeEveryMs: number;
  closeWarnMs: number;
  spiral: number[];
  endsAt: number;
}

export interface BmBomb {
  id: number;
  idx: number;
  owner: string;
  at: number;
  range: number;
}

/** [x, y, còn sống, số bom, tầm nổ, cấp tốc độ, có khiên] */
export type BmPlayer = [number, number, number, number, number, number, number];

export interface BmFx {
  kind: 'boom' | 'pick' | 'die' | 'shield';
  /** giờ máy lúc nhận */
  at: number;
  cells?: number[];
  crates?: [number, string][];
  idx?: number;
  who?: string;
}

/**
 * Trạng thái + điều khiển của MÊ CUNG ĐẶT BOM. Server chốt mọi thứ; client chỉ dự đoán vị trí của chính mình
 * (cùng hàm stepMaze với server) và dựng lại bom/lửa/thùng/vật phẩm từ các sự kiện.
 */
export function useBombMazeGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as BmConfig;

  const grid = useRef<MazeGrid>(parseGrid(cfg.cols, cfg.rows, cfg.grid));
  /** tăng mỗi khi lưới thùng thay đổi để cảnh dựng lại */
  const gridVer = useRef(0);
  const bombs = useRef(new Map<number, BmBomb>());
  const flames = useRef(new Map<number, number>());
  const items = useRef(new Map<number, string>());
  const snap = useRef<Record<string, BmPlayer>>({});
  const fx = useRef<BmFx[]>([]);
  const me = useRef({ x: (cfg.spawns[meId]?.[0] ?? 1) + 0.5, y: (cfg.spawns[meId]?.[1] ?? 1) + 0.5 });
  const synced = useRef(false);
  const pressed = useRef<string[]>([]);
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const serverMe = useRef<{ x: number; y: number } | null>(null);
  const idleSince = useRef(0);

  const [alive, setAlive] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<[number, number, number, number]>([1, 1, 0, 0]);
  const [feed, setFeed] = useState<{ id: number; text: string; by: string; who: string }[]>([]);
  const feedId = useRef(0);
  const aliveRef = useRef<Record<string, boolean>>({});

  const bombList = () => [...bombs.current.values()].map((b) => ({ cx: b.idx % cfg.cols, cy: Math.floor(b.idx / cfg.cols) }));

  useGameEvents(gameId, (p) => {
    if (p.type === 's') {
      snap.current = p.p;
      const mine: BmPlayer | undefined = p.p[meId];
      if (mine) {
        if (!synced.current || Math.hypot(mine[0] - me.current.x, mine[1] - me.current.y) > 1.2) {
          me.current = { x: mine[0], y: mine[1] };
          synced.current = true;
        } else {
          // lệch vừa: không nhảy, để predict hoà trộn dần về vị trí server
          serverMe.current = { x: mine[0], y: mine[1] };
        }
      }
      if (mine) {
        setStats((s) => (s[0] === mine[3] && s[1] === mine[4] && s[2] === mine[5] && s[3] === (mine[6] ?? 0) ? s : [mine[3], mine[4], mine[5], mine[6] ?? 0]));
      }
      let changed = false;
      for (const id of Object.keys(p.p)) {
        const a = !!p.p[id][2];
        if (aliveRef.current[id] !== a) {
          aliveRef.current[id] = a;
          changed = true;
        }
      }
      if (changed) setAlive({ ...aliveRef.current });
      if (p.full) {
        grid.current = parseGrid(cfg.cols, cfg.rows, p.full.grid);
        gridVer.current++;
        bombs.current = new Map(p.full.bombs.map((b: [number, number, string, number, number]) => [b[0], { id: b[0], idx: b[1], owner: b[2], at: b[3], range: b[4] }]));
        flames.current = new Map(p.full.flames);
        items.current = new Map(p.full.items);
      }
    } else if (p.type === 'bomb') {
      bombs.current.set(p.i, { id: p.i, idx: p.c, owner: p.o, at: p.at, range: p.r });
      sfx.tap();
    } else if (p.type === 'boom') {
      bombs.current.delete(p.i);
      const until = net.now() + cfg.flameMs;
      for (const c of p.cells as number[]) {
        flames.current.set(c, until);
        items.current.delete(c);
      }
      for (const [idx, drop] of p.crates as [number, string][]) {
        grid.current.cells[idx] = CELL_FLOOR;
        if (drop) items.current.set(idx, drop);
      }
      if (p.crates.length) gridVer.current++;
      fx.current.push({ kind: 'boom', at: Date.now(), cells: p.cells, crates: p.crates });
      sfx.miss();
    } else if (p.type === 'pick') {
      items.current.delete(p.c);
      fx.current.push({ kind: 'pick', at: Date.now(), idx: p.c, who: p.p });
      if (p.p === meId) sfx.perfect();
    } else if (p.type === 'shield') {
      fx.current.push({ kind: 'shield', at: Date.now(), who: p.p });
      if (p.p === meId) sfx.miss();
      else sfx.tick();
    } else if (p.type === 'die') {
      aliveRef.current[p.p] = false;
      setAlive({ ...aliveRef.current });
      fx.current.push({ kind: 'die', at: Date.now(), who: p.p });
      const id = ++feedId.current;
      setFeed((f) => [...f.slice(-3), { id, text: '', by: p.by, who: p.p }]);
      window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4500);
      if (p.p === meId) sfx.miss();
      else sfx.tick();
    }
  });

  useEffect(() => {
    if (!live) return;
    const dirOf = (code: string) =>
      code === 'ArrowLeft' || code === 'KeyA'
        ? 'L'
        : code === 'ArrowRight' || code === 'KeyD'
          ? 'R'
          : code === 'ArrowUp' || code === 'KeyW'
            ? 'U'
            : code === 'ArrowDown' || code === 'KeyS'
              ? 'D'
              : '';
    const send = () => {
      // 4 hướng: lấy phím bấm SAU CÙNG (nhả phím mới thì quay về phím còn giữ)
      const d = pressed.current[pressed.current.length - 1];
      const dx = d === 'L' ? -1 : d === 'R' ? 1 : 0;
      const dy = d === 'U' ? -1 : d === 'D' ? 1 : 0;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) net.input(gameId, { type: 'plant' });
        return;
      }
      const d = dirOf(e.code);
      if (!d) return;
      e.preventDefault();
      if (!pressed.current.includes(d)) {
        pressed.current.push(d);
        send();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const d = dirOf(e.code);
      if (!d) return;
      pressed.current = pressed.current.filter((x) => x !== d);
      send();
    };
    const onBlur = () => {
      pressed.current = [];
      send();
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

  /** số ô đã sập và số ô sắp sập (đang nháy cảnh báo) theo giờ server */
  const closing = (serverNow: number) => {
    const rel = serverNow - startAt;
    const total = cfg.spiral.length;
    const closed = rel < cfg.closeStartMs ? 0 : Math.min(total, Math.floor((rel - cfg.closeStartMs) / cfg.closeEveryMs) + 1);
    const warnTo = rel + cfg.closeWarnMs < cfg.closeStartMs ? 0 : Math.min(total, Math.floor((rel + cfg.closeWarnMs - cfg.closeStartMs) / cfg.closeEveryMs) + 1);
    return { closed, warnTo };
  };

  /** dự đoán vị trí của mình bằng đúng hàm di chuyển của server */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    if (!live || !synced.current) return;
    if (aliveRef.current[meId] === false) return;
    const { dx, dy } = sent.current;
    if (dx || dy) {
      idleSince.current = 0;
      const lvl = snap.current[meId]?.[5] ?? 0;
      stepMaze(grid.current, bombList(), me.current, dx, dy, cfg.speed + cfg.speedStep * lvl, dt);
    } else if (!idleSince.current) idleSince.current = serverNow;
    // hoà trộn về vị trí server (server chốt; bom đặt theo ô của server nên đứng yên phải khớp)
    const sv = serverMe.current;
    if (sv) {
      const ex = sv.x - me.current.x;
      const ey = sv.y - me.current.y;
      const err = Math.hypot(ex, ey);
      const idle = !dx && !dy && serverNow - idleSince.current > 200;
      // đứng yên: kéo nhanh; đang chạy: chỉ kéo nhẹ khi lệch đáng kể (server luôn chậm hơn do độ trễ)
      const rate = idle ? 14 : err > 0.45 ? 4 : 0;
      if (rate) {
        const k = 1 - Math.exp(-dt * rate);
        const nx = me.current.x + ex * k;
        const ny = me.current.y + ey * k;
        // không kéo xuyên tường
        const probe = { x: me.current.x, y: me.current.y };
        const wall = !grid.current.cells || grid.current.cells[Math.floor(ny) * cfg.cols + Math.floor(nx)] !== CELL_FLOOR;
        if (!wall) {
          probe.x = nx;
          probe.y = ny;
          me.current = probe;
        }
      }
    }
  };

  return {
    cfg,
    live,
    startAt,
    grid,
    gridVer,
    bombs,
    flames,
    items,
    snap,
    fx,
    me,
    alive,
    stats,
    feed,
    players,
    meId,
    closing,
    predict,
    serverNow: () => net.now(),
    isCrate: (idx: number) => grid.current.cells[idx] === CELL_CRATE,
  };
}

export type BombMazeGameState = ReturnType<typeof useBombMazeGame>;
