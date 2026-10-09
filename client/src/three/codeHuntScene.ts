import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { ChConfig, ChMe, ChOthers } from '../games/codehunt/useCodeHuntGame';

export interface CodeHuntFrame {
  cfg: ChConfig;
  me: { current: ChMe | null };
  others: { current: ChOthers };
  mine: { current: { x: number; y: number } };
  facing: { current: { x: number; y: number } };
  killFx: { current: { at: number; x: number; y: number; victim: string }[] };
  predict(serverNow: number): void;
  serverNow(): number;
}

export interface CodeHuntSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => CodeHuntFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.05;
const WALL_H = 2.6;
/** camera góc nhìn thứ 3: thấp, sát sau lưng, điểm nhìn ngẩng nhẹ về phía trước */
const FOLLOW_UP = 5;
const FOLLOW_BACK = 8.4;
const LOOK_AHEAD = 0.7;
/** bảng mã 3D trên đầu: đáy bảng cao hơn đầu nhân vật (~1.8) */
const BOARD_Y = 2.85;
/** người khác không còn trong tầm nhìn của server quá lâu này thì ẩn hẳn (giây) */
const HIDE_AFTER = 0.25;

const WALLS = ['#ff7a59', '#6a5bff', '#2fd6a0', '#ffb627', '#ff5e8a', '#4cc9f0'];

export function createCodeHuntScene(o: CodeHuntSceneOptions) {
  const cfg = o.read().cfg;
  const AW = cfg.w * S;
  const AH = cfg.h * S;
  const wx = (x: number) => x * S - AW / 2;
  const wz = (y: number) => y * S - AH / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [AW / 2 + 3, AH / 2 + 3], groundY: -34, ground: false },
      sun: [-9, 24, 12],
      shadowBox: 14,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      /* ---------------- sàn + viền ---------------- */
      const grass = k.texture(1024, 704, (g, w, h) => {
        const cols = 16;
        const rows = 11;
        const tw = w / cols;
        const th = h / rows;
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            g.fillStyle = (r + q) % 2 ? '#c9f2ff' : '#b4e6ff';
            g.fillRect(q * tw, r * th, tw + 1, th + 1);
          }
        }
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 8;
        g.strokeRect(10, 10, w - 20, h - 20);
      });
      const side = k.lit({ color: '#5d6bb8', flatShading: true });
      const floor = new Mesh(new BoxGeometry(AW, 0.6, AH), [side, side, k.lit({ map: grass }), side, side, side]);
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      scene.add(floor);

      /* ---------------- tường và vật cản: cao hơn người, che tầm nhìn ---------------- */
      cfg.boxes.forEach((b, i) => {
        const col = WALLS[i % WALLS.length];
        const side = k.lit({ color: col });
        const top = k.lit({ color: new Color(col).lerp(new Color('#ffffff'), 0.5) });
        const mesh = new Mesh(new BoxGeometry(b.w * S, WALL_H, b.d * S), [side, side, top, side, side, side]);
        mesh.position.set(wx(b.x), WALL_H / 2, wz(b.y));
        mesh.castShadow = !k.low;
        mesh.receiveShadow = true;
        scene.add(mesh);
      });
      // tường bao thấp quanh sân
      const rim = k.lit({ color: '#ffffff' });
      for (const [x, z, w, d] of [
        [0, -AH / 2 - 0.15, AW + 0.6, 0.3],
        [0, AH / 2 + 0.15, AW + 0.6, 0.3],
        [-AW / 2 - 0.15, 0, 0.3, AH],
        [AW / 2 + 0.15, 0, 0.3, AH],
      ]) {
        const m = new Mesh(new BoxGeometry(w, 0.5, d), rim);
        m.position.set(x, 0.25, z);
        scene.add(m);
      }

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        seenAt: number;
        board: Group;
        digits: InstancedMesh;
        code: string | null;
        ang: number;
      }
      // bảng 3D: khung dày + tấm nền + 3 chữ số NỔI (kiểu 7 đoạn, mỗi đoạn là một khối) gắn cố định trước mặt nhân vật.
      // Không ẩn hiện: bảng luôn có đó, chỉ mặt trước có số nên phải đứng đối diện mới đọc được.
      const frameGeo = new BoxGeometry(2.4, 1.3, 0.2);
      const plateGeo = new BoxGeometry(2.1, 1.0, 0.05);
      const postGeo = new CylinderGeometry(0.07, 0.07, 0.5, 6);
      const segGeo = new BoxGeometry(1, 1, 1);
      const plateMat = k.lit({ color: '#fffdf2' });
      const inkMat = k.lit({ color: '#1c1236' });
      const postMat = k.lit({ color: '#3a3358' });
      // đoạn a..g của số 7 đoạn: [cx, cy, ngang?]
      const SEG: [number, number, boolean][] = [
        [0, 0.34, true],
        [0.17, 0.17, false],
        [0.17, -0.17, false],
        [0, -0.34, true],
        [-0.17, -0.17, false],
        [-0.17, 0.17, false],
        [0, 0, true],
      ];
      const ON: Record<string, number[]> = {
        '0': [0, 1, 2, 3, 4, 5],
        '1': [1, 2],
        '2': [0, 1, 6, 4, 3],
        '3': [0, 1, 6, 2, 3],
        '4': [5, 6, 1, 2],
        '5': [0, 5, 6, 2, 3],
        '6': [0, 5, 6, 4, 2, 3],
        '7': [0, 1, 2],
        '8': [0, 1, 2, 3, 4, 5, 6],
        '9': [0, 1, 2, 3, 5, 6],
        '-': [6],
      };
      const DIGIT_X = [-0.62, 0, 0.62];
      const segM = new Matrix4();
      const segQ = new Quaternion();
      const setDigits = (inst: InstancedMesh, code: string) => {
        for (let d = 0; d < 3; d++) {
          const ch = code[d] && ON[code[d]] ? code[d] : '-';
          for (let sI = 0; sI < 7; sI++) {
            const [cx, cy, horiz] = SEG[sI];
            const on = ON[ch].includes(sI);
            const sc = on ? (horiz ? [0.36, 0.11, 0.12] : [0.11, 0.36, 0.12]) : [0, 0, 0];
            segM.compose(new Vector3(DIGIT_X[d] + cx, cy, 0.1), segQ, new Vector3(sc[0], sc[1], sc[2]));
            inst.setMatrixAt(d * 7 + sI, segM);
          }
        }
        inst.instanceMatrix.needsUpdate = true;
      };
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        const board = new Group();
        const frame = new Mesh(frameGeo, k.lit({ color: p.color }));
        const plate = new Mesh(plateGeo, plateMat);
        plate.position.z = 0.1; // chỉ mặt trước có tấm nền + số; mặt sau là khung trơn
        const digits = new InstancedMesh(segGeo, inkMat, 21);
        digits.frustumCulled = false;
        digits.castShadow = !k.low;
        setDigits(digits, '');
        const post = new Mesh(postGeo, postMat);
        post.position.y = -0.9;
        frame.castShadow = !k.low;
        board.add(frame, plate, digits, post);
        board.visible = false;
        scene.add(board);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, seenAt: -99, board, digits, code: null, ang: 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, 1.2, 0);
      const aim = new Vector3();
      const camPos = new Vector3();
      const sunOff = new Vector3(-9, 24, 12);
      const sunAim = new Vector3();
      let seenFirst = false;
      let fxDone = 0;

      const hideLabel = (id: string) => {
        const el = o.labels.get(id);
        if (el) el.style.opacity = '0';
        chars.get(id)!.board.visible = false;
      };

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const me = f.me.current;
          const meAlive = !me || me.alive;

          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const isMe = p.id === o.meId;
            let tx: number;
            let tz: number;
            let inv = false;
            let visible: boolean;
            let code = '';
            let fx = 0;
            let fz = 1;
            const wasHidden = time - e.seenAt > 0.4;

            if (isMe) {
              const m = meAlive ? f.mine.current : me;
              tx = wx(m ? m.x : cfg.spawns[p.id]?.[0] ?? 0);
              tz = wz(m ? m.y : cfg.spawns[p.id]?.[1] ?? 0);
              visible = meAlive;
              inv = !!me?.inv;
              fx = f.facing.current.x;
              fz = f.facing.current.y;
            } else {
              const t = f.others.current[p.id];
              if (t) {
                tx = wx(t[0]);
                tz = wz(t[1]);
                code = t[2];
                inv = !!t[3];
                fx = t[4];
                fz = t[5];
                e.seenAt = time;
              } else {
                tx = e.x;
                tz = e.z;
              }
              visible = !!t || time - e.seenAt < HIDE_AFTER;
            }

            if (!e.placed || (!isMe && wasHidden && f.others.current[p.id])) {
              // lần đầu thấy, hoặc vừa lộ diện lại sau khi bị che: đặt thẳng vào chỗ mới
              e.x = tx;
              e.z = tz;
              e.px = tx;
              e.pz = tz;
              e.placed = true;
            } else if (isMe) {
              e.x = tx;
              e.z = tz;
            } else {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }

            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;

            e.c.root.visible = visible;
            if (!visible) {
              hideLabel(p.id);
              continue;
            }
            e.c.root.position.set(e.x, 0, e.z);
            // quay mặt theo hướng mặt thật (kể cả lúc đứng yên) để người khác biết mã đang ở sau lưng hay không
            e.c.face(fx * 5, fz * 5, dt);
            e.c.update(dt, {
              speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              safe: inv,
              time,
              pose: 'run',
            });

            // bảng mã 3D quay theo hướng mặt nhân vật (không billboard); mình không cần thấy bảng của mình
            e.board.visible = true;
            if (isMe) code = me?.code ?? '';
            if (code !== e.code) {
              e.code = code;
              setDigits(e.digits, code);
            }
            const want = Math.atan2(fx, fz);
            const dA = Math.atan2(Math.sin(want - e.ang), Math.cos(want - e.ang));
            e.ang += dA * (1 - Math.exp(-dt * 14));
            e.board.rotation.y = e.ang;
            e.board.position.set(e.x, BOARD_Y, e.z);

            const el = o.labels.get(p.id);
            if (el) k.label(el, e.x, BOARD_Y + 1.0, e.z);
          }

          // hiệu ứng khi có người bị hạ
          const fx = f.killFx.current;
          while (fxDone < fx.length) {
            const ev = fx[fxDone++];
            k.effects.burst(wx(ev.x), 1.1, wz(ev.y), {
              count: k.count(60),
              palette: ['#ffffff', '#ffd166', '#ff5e8a', '#6a5bff'],
              speed: 6,
              life: 0.8,
              size: 0.2,
            });
            k.effects.ring(wx(ev.x), wz(ev.y), '#ff5e8a', 0.5, 4);
            if (ev.victim === o.meId) k.shake(0.3);
          }

          // camera góc nhìn thứ 3 bám sau lưng mình; đã bị hạ thì đứng yên tại chỗ ngã
          const m = chars.get(o.meId);
          if (m && m.placed) {
            aim.set(m.x, 0.9, m.z - LOOK_AHEAD);
            if (!seenFirst) {
              focus.copy(aim);
              seenFirst = true;
            }
            focus.lerp(aim, 1 - Math.exp(-dt * 6));
          }
          camPos.set(focus.x, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          k.look(camPos, focus);
          sunAim.set(focus.x, 0, focus.z);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
