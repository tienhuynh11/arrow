import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { WrConfig, WrHover, WrMode, WrState } from '../games/wallrush/useWallRushGame';
import { boardOf } from '../games/wallrush/useWallRushGame';
import { checkWall, legalMoves, moveKind, N, reachedGoal, type Orient, type Pos, type Side } from '@shared/wallrush';

export interface WallRushFrame {
  cfg: WrConfig;
  ti: number;
  seat: number;
  st: WrState;
  mode: WrMode;
  manualO: Orient | null;
  live: boolean;
  serverNow(): number;
}

export interface WallRushSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  /** người chơi của bàn, theo thứ tự ghế */
  players: { id: string; color: string }[];
  sides: Side[];
  meId: string;
  read: () => WallRushFrame;
  labels: Map<string, HTMLElement | null>;
  ui: {
    setHover(h: WrHover | null): void;
    setTouch(): void;
    doMove(x: number, y: number): void;
    doWall(x: number, y: number, o: Orient): void;
  };
}

/** bước ô (khoảng cách tâm hai ô) · cạnh ô · bề rộng rãnh */
const P = 1.25;
const CELL = 1;
const GROOVE = P - CELL;
const TOP = 0.14;
const WALL_H = 0.72;
const WALL_LEN = 2 * CELL + GROOVE;
const WALL_THICK = 0.2;
const CHAR_SCALE = 1.1;
const PITCH = (58 * Math.PI) / 180;
const MAX_WALLS = 24;
const DROP_S = 0.34;
const HOP_S = 0.4;
const HOP_FAR_S = 0.55;

/** quay hệ toạ độ lưới (u, v) để quân của mình luôn xuất phát ở cạnh dưới màn hình */
const rotate = (side: Side, u: number, v: number): [number, number] =>
  side === 'S' ? [u, v] : side === 'N' ? [-u, -v] : side === 'W' ? [v, -u] : [-v, u];
const unrotate = (side: Side, a: number, b: number): [number, number] =>
  side === 'S' ? [a, b] : side === 'N' ? [-a, -b] : side === 'W' ? [-b, a] : [b, -a];

export function createWallRushScene(o: WallRushSceneOptions) {
  const mySide: Side = o.sides[Math.max(0, o.players.findIndex((p) => p.id === o.meId))] ?? 'S';
  const quarter = mySide === 'W' || mySide === 'E';
  const W = (N - 1) * P + CELL;
  const half = W / 2 + 0.5;

  /** lưới (có thể lẻ nửa ô) → toạ độ thế giới */
  const toWorld = (gx: number, gy: number): [number, number] => {
    const [a, b] = rotate(mySide, gx - 4, gy - 4);
    return [a * P, b * P];
  };
  const fromWorld = (wx: number, wz: number): [number, number] => {
    const [u, v] = unrotate(mySide, wx / P, wz / P);
    return [u + 4, v + 4];
  };

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [half + 1, half + 1], groundY: -0.62 },
      sun: [-8, 24, 12],
      shadowBox: half + 3,
    },
    (k) => {
      const { scene, camera } = k.engine;
      const wood = new Color('#8e5a2b');

      /* ---------------- bàn cờ gỗ ---------------- */
      const slab = new Mesh(new BoxGeometry(W + 0.5, 0.3, W + 0.5), k.lit({ color: wood }));
      slab.position.y = -0.15;
      slab.receiveShadow = true;
      slab.castShadow = !k.low;
      scene.add(slab);
      const frameMat = k.lit({ color: '#d9a05b' });
      const fl = W + 1.5;
      for (const [sx, sz, lx, lz] of [
        [0, -1, fl, 0.5],
        [0, 1, fl, 0.5],
        [-1, 0, 0.5, W + 0.5],
        [1, 0, 0.5, W + 0.5],
      ] as const) {
        const f = new Mesh(new BoxGeometry(lx, 0.4, lz), frameMat);
        f.position.set(sx * (W / 2 + 0.5), -0.0, sz * (W / 2 + 0.5));
        f.castShadow = !k.low;
        f.receiveShadow = true;
        scene.add(f);
      }
      // chân bàn
      const base = new Mesh(new BoxGeometry(W + 1.2, 0.5, W + 1.2), k.lit({ color: '#7a4a22' }));
      base.position.y = -0.55;
      scene.add(base);

      /* ---------------- ô cờ ---------------- */
      const tiles = new InstancedMesh(new BoxGeometry(CELL, TOP, CELL), k.lit({ color: '#ffffff' }), N * N);
      tiles.receiveShadow = true;
      tiles.frustumCulled = false;
      scene.add(tiles);
      const m4 = new Matrix4();
      const light = new Color('#f8e8bf');
      const dark = new Color('#e8c98a');
      const tmp = new Color();
      for (let cy = 0; cy < N; cy++) {
        for (let cx = 0; cx < N; cx++) {
          const [wx, wz] = toWorld(cx, cy);
          m4.makeTranslation(wx, TOP / 2, wz);
          const i = cy * N + cx;
          tiles.setMatrixAt(i, m4);
          tmp.copy((cx + cy) % 2 ? dark : light);
          // ô đích tô màu người cần về đó
          const goals: number[] = [];
          o.sides.forEach((sd, s) => {
            if (reachedGoal(sd, { x: cx, y: cy })) goals.push(s);
          });
          if (goals.length) {
            const g = goals[(cx + cy) % goals.length];
            tmp.lerp(new Color(o.players[g].color), (cx + cy) % 2 ? 0.55 : 0.4);
          }
          tiles.setColorAt(i, tmp);
        }
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

      /* ---------------- vạch đích + cờ ---------------- */
      o.players.forEach((p, s) => {
        const side = o.sides[s];
        // đích = cạnh đối diện cạnh xuất phát
        const goalGx = side === 'W' ? 8.5 : side === 'E' ? -0.5 : 4;
        const goalGy = side === 'S' ? -0.5 : side === 'N' ? 8.5 : 4;
        const [wx, wz] = toWorld(goalGx, goalGy);
        const horizontal = side === 'S' || side === 'N' ? !quarter : quarter;
        const bar = new Mesh(new BoxGeometry(horizontal ? W : 0.22, 0.08, horizontal ? 0.22 : W), new MeshBasicMaterial({ color: p.color }));
        bar.position.set(wx, 0.04 + 0.02, wz);
        scene.add(bar);
        // cờ cắm ngoài khung ở giữa cạnh đích
        const outX = wx * (1 + 0.55 / Math.max(0.1, Math.abs(wx) + Math.abs(wz)));
        const outZ = wz * (1 + 0.55 / Math.max(0.1, Math.abs(wx) + Math.abs(wz)));
        const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 1.7, 8), k.lit({ color: '#f4f4f8' }));
        pole.position.set(outX, 0.85, outZ);
        pole.castShadow = !k.low;
        scene.add(pole);
        const flag = new Mesh(new BoxGeometry(0.7, 0.42, 0.05), new MeshBasicMaterial({ color: p.color }));
        flag.position.set(outX + (horizontal ? 0.37 : 0), 1.45, outZ + (horizontal ? 0 : 0.37));
        if (!horizontal) flag.rotation.y = Math.PI / 2;
        scene.add(flag);
      });

      /* ---------------- ô đi hợp lệ ---------------- */
      const hiGeo = new CylinderGeometry(0.4, 0.4, 0.05, 28);
      const hiMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
      const hi = new InstancedMesh(hiGeo, hiMat, 8);
      hi.count = 0;
      hi.frustumCulled = false;
      scene.add(hi);
      const hiGreen = new Color('#2fe88a');
      const hiHot = new Color('#fff36b');

      /* ---------------- tường ---------------- */
      const wallMat = k.lit({ color: '#ffffff' });
      const walls = new InstancedMesh(new BoxGeometry(1, 1, 1), wallMat, MAX_WALLS);
      walls.castShadow = !k.low;
      walls.receiveShadow = true;
      walls.frustumCulled = false;
      walls.count = 0;
      scene.add(walls);
      let wallsShown = 0;
      const wallBorn: number[] = [];
      const wallLanded: boolean[] = [];
      const wq = new Quaternion();
      const wp = new Vector3();
      const ws = new Vector3();
      const yAxis = new Vector3(0, 1, 0);

      /** (giao điểm x, y, hướng) → toạ độ thế giới + có nằm dọc trục x thế giới không */
      const wallPlace = (x: number, y: number, ori: Orient): { wx: number; wz: number; alongX: boolean } => {
        const [wx, wz] = toWorld(x + 0.5, y + 0.5);
        return { wx, wz, alongX: (ori === 'h') !== quarter };
      };

      // bóng tường xem trước
      const prevMat = new MeshBasicMaterial({ color: '#3dff8a', transparent: true, opacity: 0.6, depthWrite: false });
      const prev = new Mesh(new BoxGeometry(1, 1, 1), prevMat);
      prev.visible = false;
      scene.add(prev);

      /* ---------------- quân cờ (nhân vật) ---------------- */
      interface Piece {
        c: Character3D;
        x: number;
        z: number;
        fx: number;
        fz: number;
        tx: number;
        tz: number;
        t0: number;
        dur: number;
        arc: number;
        cell: Pos | null;
        placed: boolean;
        ring: Mesh;
      }
      const pieces: Piece[] = [];
      o.players.forEach((p) => {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        const ring = new Mesh(
          new RingGeometry(0.46, 0.6, 32),
          new MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.95, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        scene.add(ring);
        pieces.push({ c, x: 0, z: 0, fx: 0, fz: 0, tx: 0, tz: 0, t0: -9, dur: 0.4, arc: 0, cell: null, placed: false, ring });
      });
      k.onTier((tier) => {
        for (const e of pieces) e.c.setShadows(tier !== 'low');
      });

      /* ---------------- chuột / chạm ---------------- */
      const dom = k.engine.renderer.domElement;
      dom.style.touchAction = 'none';
      const ray = new Raycaster();
      const plane = new Plane(new Vector3(0, 1, 0), -TOP);
      const hit = new Vector3();
      const ndc = new Vector2();
      let pointer: { x: number; y: number; touch: boolean } | null = null;
      let tapKey = '';
      let hover: WrHover | null = null;
      let boardSeq = -1;
      let board = boardOf(o.read().cfg, o.read().ti, o.read().st);
      let legal: Pos[] = [];

      const refreshBoard = (f: WallRushFrame) => {
        if (boardSeq === f.st.seq) return;
        boardSeq = f.st.seq;
        board = boardOf(f.cfg, f.ti, f.st);
        legal = f.seat >= 0 && !f.st.over && f.st.turn === f.seat ? legalMoves(board, f.seat) : [];
      };

      const lattice = (): [number, number] | null => {
        if (!pointer) return null;
        const r = dom.getBoundingClientRect();
        ndc.set(((pointer.x - r.left) / r.width) * 2 - 1, -((pointer.y - r.top) / r.height) * 2 + 1);
        camera.updateMatrixWorld();
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return fromWorld(hit.x, hit.z);
      };

      const computeHover = (f: WallRushFrame): WrHover | null => {
        const g = lattice();
        if (!g) return null;
        const [lx, ly] = g;
        if (f.mode === 'move') {
          const cx = Math.round(lx);
          const cy = Math.round(ly);
          if (cx < 0 || cy < 0 || cx >= N || cy >= N || Math.abs(lx - cx) > 0.55 || Math.abs(ly - cy) > 0.55) return null;
          const ok = legal.some((p) => p.x === cx && p.y === cy);
          return { kind: 'cell', x: cx, y: cy, ok };
        }
        const x = Math.max(0, Math.min(N - 2, Math.round(lx - 0.5)));
        const y = Math.max(0, Math.min(N - 2, Math.round(ly - 0.5)));
        const du = lx - (x + 0.5);
        const dv = ly - (y + 0.5);
        const auto: Orient = Math.abs(dv) < Math.abs(du) ? 'h' : 'v';
        const ori = f.manualO ?? auto;
        let ok = true;
        let reason: string | undefined;
        if (f.seat < 0) {
          ok = false;
          reason = 'bạn đang xem';
        } else if (f.st.over) {
          ok = false;
          reason = 'bàn đã kết thúc';
        } else {
          const c = checkWall(board, f.seat, { x, y, o: ori });
          if (!c.ok) {
            ok = false;
            reason = c.reason;
          } else if (f.st.turn !== f.seat) {
            ok = false;
            reason = 'chưa đến lượt bạn';
          }
        }
        return { kind: 'wall', x, y, o: ori, ok, reason };
      };

      const hkey = (h: WrHover | null) => (h ? `${h.kind}${h.x},${h.y}${h.o ?? ''}` : '');

      const onMove = (e: PointerEvent) => {
        pointer = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
      };
      const onLeave = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') pointer = null;
      };
      const onDown = (e: PointerEvent) => {
        const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        pointer = { x: e.clientX, y: e.clientY, touch };
        if (touch) o.ui.setTouch();
        const f = o.read();
        refreshBoard(f);
        const h = computeHover(f);
        if (!h) return;
        if (f.mode === 'move') {
          if (h.ok) o.ui.doMove(h.x, h.y);
          return;
        }
        if (touch) {
          // chạm lần 1: xem trước · chạm lần 2 đúng chỗ đó: đặt
          if (tapKey === hkey(h) && h.ok && h.o) {
            tapKey = '';
            o.ui.doWall(h.x, h.y, h.o);
          } else {
            tapKey = hkey(h);
            hover = h;
            o.ui.setHover(h);
          }
        } else if (h.ok && h.o) {
          o.ui.doWall(h.x, h.y, h.o);
        }
      };
      dom.addEventListener('pointermove', onMove);
      dom.addEventListener('pointerleave', onLeave);
      dom.addEventListener('pointerdown', onDown);

      /* ---------------- camera ---------------- */
      const focus = new Vector3(0, 0, 0.1);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(half + 0.4, half + 0.6, PITCH) * 1.04;

      let lastOver = false;
      let lastMode: WrMode = 'move';
      let first = true;

      return {
        frame(dt, time) {
          const f = o.read();
          refreshBoard(f);
          const st = f.st;

          /* --- tường: thêm mới → rơi xuống --- */
          if (st.walls.length < wallsShown) {
            wallsShown = 0;
            wallBorn.length = 0;
            wallLanded.length = 0;
          }
          const firstSync = first;
          while (wallsShown < st.walls.length) {
            wallBorn.push(firstSync ? -1e9 : time);
            wallLanded.push(!!firstSync);
            wallsShown++;
          }
          first = false;
          walls.count = st.walls.length;
          for (let i = 0; i < st.walls.length; i++) {
            const w = st.walls[i];
            const { wx, wz, alongX } = wallPlace(w.x, w.y, w.o);
            const t = time - wallBorn[i];
            let y = WALL_H / 2 + TOP;
            if (t < DROP_S) {
              y += 3.2 * (1 - (t / DROP_S) ** 2);
            } else {
              if (!wallLanded[i]) {
                wallLanded[i] = true;
                k.effects.burst(wx, TOP + 0.1, wz, { count: k.count(16), palette: ['#fff6dd', '#e8d3a4', '#ffffff'], speed: 1.8, life: 0.55, size: 0.16, gravity: 2, additive: false });
                k.shake(0.05);
              }
              const tb = t - DROP_S;
              if (tb < 0.4) y += Math.abs(Math.sin(tb * 16)) * 0.16 * Math.exp(-tb * 8);
            }
            wp.set(wx, y, wz);
            wq.setFromAxisAngle(yAxis, 0);
            ws.set(alongX ? WALL_LEN : WALL_THICK, WALL_H, alongX ? WALL_THICK : WALL_LEN);
            m4.compose(wp, wq, ws);
            walls.setMatrixAt(i, m4);
            const owner = o.players[w.by]?.color ?? '#ffffff';
            walls.setColorAt(i, tmp.set(owner));
          }
          walls.instanceMatrix.needsUpdate = true;
          if (walls.instanceColor) walls.instanceColor.needsUpdate = true;

          /* --- xem trước (chuột / chạm) --- */
          if (f.mode !== lastMode) {
            lastMode = f.mode;
            tapKey = '';
          }
          if (!pointer || (pointer.touch && f.mode === 'wall' && !tapKey)) hover = null;
          else hover = computeHover(f);
          o.ui.setHover(hover);
          if (f.mode === 'wall' && hover && hover.kind === 'wall' && hover.o) {
            const { wx, wz, alongX } = wallPlace(hover.x, hover.y, hover.o);
            const pulse = 0.5 + 0.12 * Math.sin(time * 7);
            prev.visible = true;
            prev.position.set(wx, TOP + WALL_H / 2 + 0.03, wz);
            prev.scale.set(alongX ? WALL_LEN : WALL_THICK + 0.04, WALL_H, alongX ? WALL_THICK + 0.04 : WALL_LEN);
            prevMat.color.set(hover.ok ? '#3dff8a' : hover.reason === 'chưa đến lượt bạn' ? '#ffb23d' : '#ff4d4d');
            prevMat.opacity = pulse + (hover.ok ? 0.1 : 0);
          } else {
            prev.visible = false;
          }

          /* --- ô đi hợp lệ --- */
          const showMoves = f.mode === 'move' && legal.length > 0 && f.live;
          hi.count = showMoves ? legal.length : 0;
          if (showMoves) {
            const pulse = 1 + 0.12 * Math.sin(time * 6);
            legal.forEach((p, i) => {
              const [wx, wz] = toWorld(p.x, p.y);
              const hot = hover?.kind === 'cell' && hover.x === p.x && hover.y === p.y;
              wp.set(wx, TOP + 0.04, wz);
              const sc = hot ? 1.45 : pulse;
              m4.compose(wp, wq.identity(), ws.set(sc, 1, sc));
              hi.setMatrixAt(i, m4);
              hi.setColorAt(i, hot ? hiHot : hiGreen);
            });
            hi.instanceMatrix.needsUpdate = true;
            if (hi.instanceColor) hi.instanceColor.needsUpdate = true;
          }
          dom.style.cursor = f.mode === 'wall' ? (hover?.ok ? 'copy' : 'not-allowed') : hover?.ok ? 'pointer' : 'default';

          /* --- quân cờ --- */
          st.pos.forEach((pos, s) => {
            const e = pieces[s];
            if (!e) return;
            const [wx, wz] = toWorld(pos.x, pos.y);
            if (!e.placed) {
              e.x = e.fx = e.tx = wx;
              e.z = e.fz = e.tz = wz;
              e.cell = { ...pos };
              e.placed = true;
              e.t0 = -9;
            } else if (!e.cell || e.cell.x !== pos.x || e.cell.y !== pos.y) {
              const kind = e.cell ? moveKind(e.cell, pos) : 'step';
              e.fx = e.x;
              e.fz = e.z;
              e.tx = wx;
              e.tz = wz;
              e.t0 = time;
              e.dur = kind === 'step' ? HOP_S : HOP_FAR_S;
              e.arc = kind === 'step' ? 0.7 : 1.3;
              e.cell = { ...pos };
              k.effects.ring(wx, wz, o.players[s].color, 0.5, 2.4);
            }
            const u = Math.min(1, (time - e.t0) / e.dur);
            const hopping = u < 1;
            const ease = u * u * (3 - 2 * u);
            let y = 0;
            if (hopping) {
              e.x = e.fx + (e.tx - e.fx) * ease;
              e.z = e.fz + (e.tz - e.fz) * ease;
              y = Math.sin(u * Math.PI) * e.arc;
            } else {
              e.x = e.tx;
              e.z = e.tz;
              if (e.t0 > 0 && time - e.t0 < e.dur + 0.18) {
                // chạm đất: nhún nhẹ
                const sq = Math.sin(((time - e.t0 - e.dur) / 0.18) * Math.PI);
                e.c.root.scale.set(CHAR_SCALE * (1 + 0.1 * sq), CHAR_SCALE * (1 - 0.12 * sq), CHAR_SCALE * (1 + 0.1 * sq));
              } else {
                e.c.root.scale.setScalar(CHAR_SCALE);
              }
            }
            e.c.root.visible = true;
            e.c.root.position.set(e.x, TOP + y, e.z);

            // quay mặt: đang nhảy thì theo hướng nhảy, đứng yên thì hướng về đích
            if (hopping) e.c.face(e.tx - e.fx, e.tz - e.fz, dt);
            else {
              const side = o.sides[s];
              const [gx, gy] = side === 'S' ? [0, -1] : side === 'N' ? [0, 1] : side === 'W' ? [1, 0] : [-1, 0];
              const [a, b] = rotate(mySide, gx, gy);
              e.c.face(a, b, dt);
            }
            const win = st.winner;
            const pose = st.over ? (win === s ? 'cheer' : win >= 0 ? 'sad' : 'idle') : hopping ? 'jump' : 'idle';
            e.c.update(dt, { speed: 0, dead: false, time, pose });

            const turn = !st.over && st.turn === s;
            e.ring.visible = turn;
            if (turn) {
              e.ring.position.set(e.x, TOP + 0.03, e.z);
              const rs = 1 + 0.1 * Math.sin(time * 5);
              e.ring.scale.set(rs, rs, rs);
              e.ring.rotation.z = time * 1.5;
            }
            k.label(o.labels.get(o.players[s].id), e.x, TOP + y + 2.1, e.z);
          });

          if (st.over && !lastOver && st.winner >= 0) {
            const e = pieces[st.winner];
            k.effects.burst(e.tx, 1.2, e.tz, { count: k.count(60), palette: ['#ffd23f', '#ff5e8a', '#ffffff', '#4cc9f0'], speed: 5.5, life: 1.1, size: 0.22 });
          }
          lastOver = st.over;

          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
        },
        dispose() {
          dom.removeEventListener('pointermove', onMove);
          dom.removeEventListener('pointerleave', onLeave);
          dom.removeEventListener('pointerdown', onDown);
        },
      };
    },
  );
}
