import { BoxGeometry, Color, CylinderGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { runScene, tileTexture, type LitMaterial, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { MathLock, MathQuestion } from '../games/math/useMathGame';

export interface MathFrame {
  lanes: number;
  index: number;
  q: MathQuestion;
  cells: Record<string, number>;
  locked: Record<string, MathLock>;
  reveal: number | null;
  progress: number;
  waiting: boolean;
  flash: number;
}

export interface MathSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => MathFrame;
  labels: Map<string, HTMLElement | null>;
}

const PAD_W = 2.2;
const PAD_D = 2.6;
const GAP = 0.35;
const PALETTE = ['#4cc9f0', '#ff6bd6', '#ffd166', '#3ddc97', '#b388ff', '#ff9f43'];
const PITCH = (30 * Math.PI) / 180;

export function createMathScene(o: MathSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0c0b24', fog: [26, 60], sun: [3, 16, 10], shadowBox: 12 }, (k) => {
    const { scene } = k.engine;
    const f0 = o.read();
    const lanes = Math.max(1, f0.lanes);
    const n = Math.max(1, o.players.length);
    const totalW = lanes * PAD_W + (lanes - 1) * GAP;
    const padX = (i: number) => -totalW / 2 + PAD_W / 2 + i * (PAD_W + GAP);

    const floor = new Mesh(
      new PlaneGeometry(totalW + 12, 14),
      k.lit({ map: tileTexture(k, 10, 6, ['#15142e', '#1a1936'], 'rgba(255,107,214,0.2)') }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.3, -1);
    floor.receiveShadow = true;
    scene.add(floor);

    /* ---------------- các ô đáp án ---------------- */
    const bodyMat = k.lit({ color: '#1c1f3d' });
    const padGeo = new BoxGeometry(PAD_W, 0.5, PAD_D);
    const rimGeo = new BoxGeometry(PAD_W, 0.08, PAD_D);
    const topGeo = new BoxGeometry(PAD_W * 0.9, 0.06, PAD_D * 0.9);
    const idle = new Color('#2a2f5a');
    const right = new Color('#2ecc71');
    const wrong = new Color('#141526');
    const pads = Array.from({ length: lanes }, (_, i) => {
      const body = new Mesh(padGeo, bodyMat);
      body.receiveShadow = true;
      body.castShadow = !k.low;
      const rim = new Mesh(rimGeo, new MeshBasicMaterial({ color: PALETTE[i % PALETTE.length] }));
      rim.position.y = 0.24;
      const topMat: LitMaterial = k.lit({ color: idle, emissive: PALETTE[i % PALETTE.length], emissiveIntensity: 0.12 });
      const top = new Mesh(topGeo, topMat);
      top.position.y = 0.28;
      top.receiveShadow = true;
      body.add(rim, top);
      body.position.set(padX(i), 0, 0);
      scene.add(body);
      return { body, topMat, y: 0 };
    });

    /* ---------------- bảng câu hỏi vẽ bằng canvas ---------------- */
    const boardW = Math.max(6.5, totalW);
    const boardH = boardW / 4;
    const boardTex = k.texture(1024, 256, () => {});
    const boardCanvas = boardTex.image as HTMLCanvasElement;
    const drawBoard = (text: string, dim: boolean) => {
      const g = boardCanvas.getContext('2d')!;
      const w = boardCanvas.width;
      const h = boardCanvas.height;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#221a4d');
      grad.addColorStop(1, '#120e2e');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff6bd6';
      g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.globalAlpha = dim ? 0.35 : 1;
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 130;
      g.font = `900 ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > w - 80 && size > 40) {
        size -= 8;
        g.font = `900 ${size}px system-ui, sans-serif`;
      }
      g.fillText(text, w / 2, h / 2 + 6);
      g.globalAlpha = 1;
      boardTex.needsUpdate = true;
    };
    const board = new Mesh(new PlaneGeometry(boardW, boardH), new MeshBasicMaterial({ map: boardTex }));
    board.position.set(0, 2.2, -PAD_D / 2 - 1.4);
    scene.add(board);
    const postMat = k.lit({ color: '#2b2f55' });
    for (const s of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.08, 0.1, 2.2 + boardH / 2, 8), postMat);
      post.position.set(s * (boardW / 2 - 0.3), (2.2 + boardH / 2) / 2 - 0.3, board.position.z - 0.1);
      scene.add(post);
    }
    const timerMat = new MeshBasicMaterial({ color: '#3ddc97' });
    const timer = new Mesh(new BoxGeometry(boardW, 0.12, 0.06), timerMat);
    timer.position.set(0, 2.2 - boardH / 2 - 0.15, board.position.z);
    scene.add(timer);

    /* ---------------- nhân vật ---------------- */
    interface Entry {
      c: Character3D;
      color: string;
      x: number;
      z: number;
      placed: boolean;
      lockAt: number;
    }
    const chars = new Map<string, Entry>();
    for (const p of o.players) {
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      scene.add(c.root);
      chars.set(p.id, { c, color: p.color, x: 0, z: 0, placed: false, lockAt: 0 });
    }
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let boardKey = '';
    let lastReveal: number | null = null;
    const cols = n > 9 ? 4 : 3;
    const sp = PAD_W / (cols + 0.4);
    const target = new Vector3(0, 1.2, -1.1);
    const camPos = new Vector3();

    return {
      frame(dt, time) {
        const f = o.read();
        const ease = 1 - Math.exp(-dt * 8);

        const key = `${f.index}|${f.waiting}`;
        if (key !== boardKey) {
          boardKey = key;
          drawBoard(`${f.q.text} = ?`, f.waiting);
        }
        timer.scale.x = Math.max(0.001, f.progress);
        timerMat.color.set(f.progress < 0.3 ? '#ff2d55' : '#3ddc97');

        if (f.reveal !== lastReveal) {
          lastReveal = f.reveal;
          if (f.reveal !== null) {
            k.effects.burst(padX(f.reveal), 0.8, 0, {
              count: k.count(50),
              palette: ['#3ddc97', '#ffffff', '#ffd166'],
              speed: 6,
              life: 0.9,
              size: 0.18,
              additive: true,
            });
          }
        }
        pads.forEach((pad, i) => {
          const state = f.reveal === null ? 0 : i === f.reveal ? 1 : -1;
          pad.topMat.color.lerp(state === 1 ? right : state === -1 ? wrong : idle, ease);
          pad.topMat.emissiveIntensity += ((state === 1 ? 0.6 : state === -1 ? 0 : 0.12) - pad.topMat.emissiveIntensity) * ease;
          pad.y += ((state === 1 ? 0.25 : state === -1 ? -0.18 : 0) - pad.y) * ease;
          pad.body.position.y = pad.y;
          k.label(o.labels.get(`pad${i}`), padX(i), pad.y + 0.35, PAD_D / 2 + 0.05);
        });

        // xếp người đứng trên từng ô thành lưới nhỏ
        const onPad: string[][] = Array.from({ length: lanes }, () => []);
        for (const pl of o.players) {
          const cell = Math.max(0, Math.min(lanes - 1, f.cells[pl.id] ?? 0));
          onPad[cell].push(pl.id);
        }
        onPad.forEach((ids, cell) => {
          ids.forEach((id, j) => {
            const e = chars.get(id)!;
            const row = Math.floor(j / cols);
            const inRow = Math.min(cols, ids.length - row * cols);
            const tx = padX(cell) + ((j % cols) - (inRow - 1) / 2) * sp;
            const tz = 0.6 - row * 0.62;
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.placed = true;
            }
            const prevX = e.x;
            const move = 1 - Math.exp(-dt * 10);
            e.x += (tx - e.x) * move;
            e.z += (tz - e.z) * move;
            const vx = (e.x - prevX) / Math.max(dt, 1e-3);
            const gap = Math.abs(tx - e.x);
            const hop = Math.min(0.7, gap * 0.9);
            const y = pads[cell].y + 0.31 + hop;
            e.c.root.position.set(e.x, y, e.z);
            e.c.face(vx, 1.2, dt);

            const lk = f.locked[id];
            if (lk && lk.at !== e.lockAt) {
              e.lockAt = lk.at;
              k.effects.ring(e.x, e.z, e.color, 0.6, 1.3);
              k.effects.burst(e.x, y + 1.6, e.z, { count: k.count(16), palette: [e.color, '#ffffff'], speed: 3, life: 0.5, size: 0.13, additive: true });
              if (id === o.meId) k.shake(0.1);
            }
            e.c.update(dt, {
              speed: gap > 0.05 ? 1 : 0,
              dead: false,
              time,
              pose: lk ? (f.reveal === null ? 'lock' : lk.ok ? 'cheer' : 'sad') : gap > 0.05 ? 'jump' : 'idle',
            });
            k.label(o.labels.get(id), e.x, y + 2.1, e.z);
          });
        });

        const dist = Math.max(k.fit(Math.max(totalW, boardW) / 2 + 0.8, 4.8, PITCH), 10.5);
        camPos.set(target.x, target.y + Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
        k.look(camPos, target);
      },

      dispose() {
        padGeo.dispose();
        rimGeo.dispose();
        topGeo.dispose();
      },
    };
  });
}
