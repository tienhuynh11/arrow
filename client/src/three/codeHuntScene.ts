import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
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
/** bảng mã 3D trên đầu: tâm bảng, đáy bảng cao hơn đầu nhân vật (~1.9) */
const BOARD_Y = 2.95;
/** người khác không còn trong tầm nhìn của server quá lâu này thì ẩn hẳn (giây) */
const HIDE_AFTER = 0.25;

/** màu tường nhà/quầy: cam, tím, ngọc, vàng, hồng, xanh trời */
const WALLS = ['#ff9a6b', '#8f86ff', '#43d9ae', '#ffc447', '#ff7aa3', '#5fcff5'];
const ROOFS = ['#e0523a', '#3d86d6', '#7a5cd6', '#f08a1c'];
const AWN = ['#ff4d6d', '#ffffff'];

const tint = (hex: string, to: string, t: number) => '#' + new Color(hex).lerp(new Color(to), t).getHexString();

/** số ngẫu nhiên cố định: cảnh giống nhau mỗi lần vào */
const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const Y_AXIS = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
/** đặt một instance: vị trí, tỉ lệ, góc quay quanh trục Y */
const put = (mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
  _q.setFromAxisAngle(Y_AXIS, ry);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _m);
};

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
      const rnd = seeded(20260610);
      const tweens: ((time: number, dt: number) => void)[] = [];

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      const rep = (t: Texture, x = 1, y = 1) => {
        t.wrapS = t.wrapT = RepeatWrapping;
        t.repeat.set(x, y);
        return t;
      };

      /* ---------------- sàn lát hoa văn + bãi cỏ + viền sân ---------------- */
      const PX = 32; // px mỗi đơn vị 3D của texture sàn
      const paving = k.texture(Math.round(AW * PX), Math.round(AH * PX), (g, w, h) => {
        const tile = 2 * PX;
        const cols = Math.ceil(w / tile);
        const rows = Math.ceil(h / tile);
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            const even = (r + q) % 2 === 0;
            const x = q * tile;
            const y = r * tile;
            g.fillStyle = even ? '#f6e3bd' : '#e9cfa0';
            g.fillRect(x, y, tile + 1, tile + 1);
            // hoa văn thoi + chấm góc
            g.fillStyle = even ? '#f0cf93' : '#f7e8c6';
            g.beginPath();
            g.moveTo(x + tile / 2, y + 6);
            g.lineTo(x + tile - 6, y + tile / 2);
            g.lineTo(x + tile / 2, y + tile - 6);
            g.lineTo(x + 6, y + tile / 2);
            g.closePath();
            g.fill();
            g.fillStyle = even ? '#e4a95e' : '#d9b887';
            g.beginPath();
            g.arc(x + tile / 2, y + tile / 2, 7, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(120,80,30,0.18)';
            g.lineWidth = 2;
            g.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
          }
        }
        // vòng quảng trường quanh tháp giữa sân
        const cx = w / 2;
        const cy = h / 2;
        const rings = ['#ff7aa3', '#ffc447', '#43d9ae', '#8f86ff'];
        rings.forEach((c, i) => {
          g.strokeStyle = c;
          g.lineWidth = 9;
          g.beginPath();
          g.arc(cx, cy, 3.3 * PX + i * 12, 0, Math.PI * 2);
          g.stroke();
        });
        g.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.beginPath();
          g.arc(cx + Math.cos(a) * 5.9 * PX, cy + Math.sin(a) * 5.9 * PX, 8, 0, Math.PI * 2);
          g.fill();
        }
        // vạch đứt hai trục
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 6;
        g.setLineDash([22, 18]);
        g.beginPath();
        g.moveTo(0, cy);
        g.lineTo(w, cy);
        g.moveTo(cx, 0);
        g.lineTo(cx, h);
        g.stroke();
        g.setLineDash([]);
        // bông hoa rải trên gạch
        const fr = seeded(5);
        for (let i = 0; i < 70; i++) {
          g.fillStyle = ['#ff7aa3', '#ffffff', '#ffc447', '#8f86ff'][i % 4];
          g.beginPath();
          g.arc(fr() * w, fr() * h, 4, 0, Math.PI * 2);
          g.fill();
        }
        // dải viền gạch đỏ
        g.strokeStyle = '#d9694a';
        g.lineWidth = 22;
        g.strokeRect(11, 11, w - 22, h - 22);
        g.strokeStyle = '#fff3d6';
        g.lineWidth = 4;
        g.strokeRect(24, 24, w - 48, h - 48);
      });
      const side = k.lit({ color: '#c9916a', flatShading: true });
      const floor = new Mesh(new BoxGeometry(AW, 0.6, AH), [side, side, k.lit({ map: paving }), side, side, side]);
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      scene.add(floor);

      const lawnTex = rep(
        k.texture(256, 256, (g, w, h) => {
          g.fillStyle = '#7fdc5c';
          g.fillRect(0, 0, w, h);
          const lr = seeded(11);
          for (let i = 0; i < 160; i++) {
            g.fillStyle = i % 2 ? 'rgba(60,160,60,0.35)' : 'rgba(190,255,130,0.4)';
            g.beginPath();
            g.ellipse(lr() * w, lr() * h, 10 + lr() * 22, 6 + lr() * 12, lr() * 3, 0, Math.PI * 2);
            g.fill();
          }
        }),
        10,
        8,
      );
      const lawn = new Mesh(new PlaneGeometry(AW + 34, AH + 30), new MeshBasicMaterial({ map: lawnTex }));
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.y = -0.28;
      scene.add(lawn);
      // lối đi gạch quanh sân
      const pathTex = k.texture(64, 64, (g, w, h) => {
        g.fillStyle = '#ecd9b0';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(150,100,50,0.35)';
        g.lineWidth = 3;
        g.strokeRect(0, 0, w, h);
      });
      const path = new Mesh(new PlaneGeometry(AW + 5, AH + 5), new MeshBasicMaterial({ map: rep(pathTex, (AW + 5) / 1.2, (AH + 5) / 1.2) }));
      path.rotation.x = -Math.PI / 2;
      path.position.y = -0.27;
      scene.add(path);

      // vỉa đỏ trắng quanh sân + dây đèn nhấp nháy trên vỉa
      const curbTex = (len: number) =>
        rep(
          k.texture(128, 32, (g, w, h) => {
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#ff4d6d';
            for (let i = 0; i < 4; i++) g.fillRect(i * 32, 0, 16, h);
          }),
          len / 1.6,
          1,
        );
      const curbX = k.lit({ map: curbTex(AW + 0.6) });
      const curbZ = k.lit({ map: curbTex(AH) });
      for (const [x, z, w, d, mat] of [
        [0, -AH / 2 - 0.15, AW + 0.6, 0.3, curbX],
        [0, AH / 2 + 0.15, AW + 0.6, 0.3, curbX],
        [-AW / 2 - 0.15, 0, 0.3, AH, curbZ],
        [AW / 2 + 0.15, 0, 0.3, AH, curbZ],
      ] as const) {
        const m = new Mesh(new BoxGeometry(w, 0.42, d), mat);
        m.position.set(x, 0.21, z);
        scene.add(m);
      }
      const bulbPts: [number, number][] = [];
      for (let x = -AW / 2; x <= AW / 2 + 0.01; x += 1.6) bulbPts.push([x, -AH / 2 - 0.15], [x, AH / 2 + 0.15]);
      for (let z = -AH / 2 + 1.6; z < AH / 2 - 0.5; z += 1.6) bulbPts.push([-AW / 2 - 0.15, z], [AW / 2 + 0.15, z]);
      const bulbs = new InstancedMesh(new SphereGeometry(0.1, 8, 6), new MeshBasicMaterial({ color: '#ffffff' }), bulbPts.length);
      bulbPts.forEach(([x, z], i) => {
        put(bulbs, i, x, 0.5, z);
        bulbs.setColorAt(i, new Color('#ffffff'));
      });
      scene.add(bulbs);
      const bulbCols = ['#ff4d6d', '#ffd166', '#43d9ae', '#6aa6ff'].map((c) => new Color(c));
      const bulbDim = new Color('#5b5a66');
      let bulbTick = -1;
      tweens.push((time) => {
        const t = Math.floor(time * 3);
        if (t === bulbTick || !bulbs.instanceColor) return;
        bulbTick = t;
        for (let i = 0; i < bulbPts.length; i++) bulbs.setColorAt(i, (i + t) % 3 === 0 ? bulbCols[(i >> 1) % 4] : bulbDim);
        bulbs.instanceColor.needsUpdate = true;
      });

      /* ---------------- nhà, quầy hàng, tháp: đúng là các hộp va chạm của server ---------------- */
      const facadeTex = WALLS.map((base) =>
        rep(
          k.texture(256, 256, (g, w, h) => {
            const dark = tint(base, '#000000', 0.22);
            g.fillStyle = base;
            g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(0,0,0,0.05)';
            for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2);
            // phào chỉ trên đỉnh
            g.fillStyle = '#fff6e4';
            g.fillRect(0, 0, w, 14);
            g.fillStyle = dark;
            g.fillRect(0, 14, w, 4);
            // 2 cửa sổ tầng trên + hộp hoa
            for (const wxp of [26, 154]) {
              g.fillStyle = tint(base, '#ffffff', 0.55);
              g.fillRect(wxp - 10, 34, 12, 84);
              g.fillRect(wxp + 76, 34, 12, 84);
              g.fillStyle = '#fff6e4';
              g.fillRect(wxp - 2, 32, 80, 90);
              const gr = g.createLinearGradient(0, 38, 0, 116);
              gr.addColorStop(0, '#7fd0ff');
              gr.addColorStop(1, '#e2f6ff');
              g.fillStyle = gr;
              g.fillRect(wxp + 4, 38, 68, 78);
              g.fillStyle = '#fff6e4';
              g.fillRect(wxp + 36, 38, 4, 78);
              g.fillRect(wxp + 4, 74, 68, 4);
              g.fillStyle = '#3f9d4d';
              g.fillRect(wxp - 4, 120, 84, 12);
              for (let i = 0; i < 6; i++) {
                g.fillStyle = ['#ff4d6d', '#ffd166', '#ffffff'][i % 3];
                g.beginPath();
                g.arc(wxp + 4 + i * 14, 119, 5, 0, Math.PI * 2);
                g.fill();
              }
            }
            // mái hiên sọc có viền lượn
            for (let i = 0; i < 8; i++) {
              g.fillStyle = AWN[i % 2];
              g.fillRect(i * 32, 142, 32, 30);
              g.beginPath();
              g.arc(i * 32 + 16, 172, 16, 0, Math.PI);
              g.fill();
            }
            g.fillStyle = 'rgba(0,0,0,0.12)';
            g.fillRect(0, 142, w, 4);
            // cửa hàng sáng đèn
            g.fillStyle = dark;
            g.fillRect(0, 196, w, 60);
            const wg = g.createLinearGradient(0, 196, 0, 252);
            wg.addColorStop(0, '#fff3c4');
            wg.addColorStop(1, '#ffc46b');
            g.fillStyle = wg;
            g.fillRect(14, 202, 100, 46);
            g.fillRect(142, 202, 100, 46);
            g.fillStyle = dark;
            g.fillRect(122, 202, 12, 54);
            g.fillStyle = 'rgba(255,255,255,0.35)';
            g.fillRect(20, 206, 14, 38);
            g.fillRect(148, 206, 14, 38);
            g.fillStyle = tint(base, '#000000', 0.4);
            g.fillRect(0, 248, w, 8);
          }),
        ),
      );
      const bodyMats = facadeTex.map((t) => k.lit({ map: t }));
      const endMats = WALLS.map((c) => k.lit({ color: tint(c, '#000000', 0.08) }));
      const roofTop = k.lit({ color: '#6b5a7a' });
      const capMat = k.lit({ color: '#fff6e4' });
      const stripeTex = ROOFS.map((c) =>
        rep(
          k.texture(96, 8, (g, w, h) => {
            for (let i = 0; i < 12; i++) {
              g.fillStyle = i % 2 ? '#ffffff' : c;
              g.fillRect((i * w) / 12, 0, w / 12 + 1, h);
            }
          }),
        ),
      );
      const roofMats = stripeTex.map((t) => k.lit({ map: t }));
      const pyramid = new ConeGeometry(0.70711, 1, 4, 1);
      pyramid.rotateY(Math.PI / 4);
      const tentGeo = new ConeGeometry(1, 1, 12, 1, true);
      const finialGeo = new SphereGeometry(0.16, 10, 8);
      const poleGeo = new CylinderGeometry(0.03, 0.03, 1, 5);
      const goldMat = k.lit({ color: '#ffd166', emissive: '#ffb300', emissiveIntensity: 0.5 });
      const poleMat = k.lit({ color: '#f2f2f7' });

      /** mặt hộp: ±x / ±z cạnh dài thì lát cửa sổ lặp lại, cạnh ngắn thì tô trơn */
      const buildBody = (bw: number, bd: number, ci: number) => {
        const geo = new BoxGeometry(bw, WALL_H, bd);
        const uv = geo.getAttribute('uv');
        const faceLen = [bd, bd, 0, 0, bw, bw];
        const mats: Material[] = [];
        for (let f = 0; f < 6; f++) {
          const len = faceLen[f];
          if (f === 2) mats.push(roofTop);
          else if (f === 3) mats.push(endMats[ci]);
          else if (len < 1.5) mats.push(endMats[ci]);
          else {
            const n = Math.max(1, Math.round(len / 2.6));
            for (let v = f * 4; v < f * 4 + 4; v++) uv.setX(v, uv.getX(v) * n);
            mats.push(bodyMats[ci]);
          }
        }
        return new Mesh(geo, mats);
      };

      interface Dress {
        g: Group;
        x0: number;
        x1: number;
        z0: number;
        z1: number;
        sq: number;
      }
      const dress: Dress[] = [];
      const flags: Mesh[] = [];
      const flagGeo = new PlaneGeometry(0.46, 0.28);
      flagGeo.translate(0.23, 0, 0);
      const flagMats = ['#ff4d6d', '#ffd166', '#43d9ae', '#6aa6ff'].map((c) => new MeshBasicMaterial({ color: c, side: DoubleSide }));
      const addFlag = (grp: Group, x: number, y: number, z: number, ci: number) => {
        const pole = new Mesh(poleGeo, poleMat);
        pole.scale.y = 1.5;
        pole.position.set(x, y + 0.75, z);
        const fl = new Mesh(flagGeo, flagMats[ci % flagMats.length]);
        fl.position.set(x, y + 0.85, z);
        grp.add(pole, fl);
        flags.push(fl);
      };

      cfg.boxes.forEach((b, i) => {
        const bw = b.w * S;
        const bd = b.d * S;
        const ci = i === 0 ? 3 : i % WALLS.length;
        const grp = new Group();
        grp.position.set(wx(b.x), 0, wz(b.y));
        const body = buildBody(bw, bd, ci);
        body.position.y = WALL_H / 2;
        body.castShadow = !k.low;
        body.receiveShadow = true;
        grp.add(body);

        const cap = new Mesh(new BoxGeometry(bw + 0.34, 0.16, bd + 0.34), capMat);
        cap.position.y = WALL_H + 0.08;
        grp.add(cap);

        const thin = Math.min(bw, bd) < 1.2;
        if (i === 0) {
          // tháp rạp xiếc giữa sân: mái lều sọc + cột cờ
          const tent = new Mesh(tentGeo, roofMats[0]);
          tent.scale.set(2.75, 2.3, 2.75);
          tent.position.y = WALL_H + 0.16 + 1.15;
          tent.castShadow = !k.low;
          const fin = new Mesh(finialGeo, goldMat);
          fin.position.y = WALL_H + 0.16 + 1.9 + 0.1;
          grp.add(tent, fin);
          addFlag(grp, 0, WALL_H + 2.1, 0, 0);
        } else if (!thin) {
          const roofI = i % ROOFS.length;
          const rh = Math.min(bw, bd) * 0.4 + 0.3;
          const roof = new Mesh(pyramid, roofMats[roofI]);
          roof.scale.set(bw + 0.4, rh, bd + 0.4);
          roof.position.y = WALL_H + 0.16 + rh / 2;
          roof.castShadow = !k.low;
          grp.add(roof);
          if (i % 2 === 0) addFlag(grp, 0, WALL_H + 0.16 + rh - 0.1, 0, i);
        } else {
          // dãy phố dài: biển hiệu nhỏ trên mái + cờ đuôi nheo ở hai đầu
          const horiz = bw > bd;
          const len = Math.max(bw, bd);
          const sign = new Mesh(new BoxGeometry(horiz ? len * 0.4 : 0.1, 0.5, horiz ? 0.1 : len * 0.4), k.lit({ color: tint(WALLS[ci], '#000000', 0.15) }));
          sign.position.y = WALL_H + 0.16 + 0.25;
          grp.add(sign);
          for (const sgn of [-1, 1]) addFlag(grp, horiz ? sgn * (len / 2 - 0.3) : 0, WALL_H + 0.16, horiz ? 0 : sgn * (len / 2 - 0.3), i + (sgn > 0 ? 1 : 0));
        }
        scene.add(grp);
        dress.push({ g: grp, x0: grp.position.x - bw / 2 - 0.35, x1: grp.position.x + bw / 2 + 0.35, z0: grp.position.z - bd / 2 - 0.35, z1: grp.position.z + bd / 2 + 0.35, sq: 1 });
      });
      tweens.push((time) => {
        for (let i = 0; i < flags.length; i++) flags[i].rotation.y = Math.sin(time * 4 + i * 1.7) * 0.5;
      });

      /* ---------------- trang trí không va chạm: nằm ngoài sân ---------------- */
      // đèn đường + dây cờ + ghế + thùng + cây + hoa
      const lampPts: [number, number, number][] = []; // x, z, rotation
      const stepX = AW / 6;
      for (let x = -AW / 2 + stepX / 2; x < AW / 2; x += stepX) {
        lampPts.push([x, -AH / 2 - 1.3, 0]);
        lampPts.push([x, AH / 2 + 1.3, Math.PI]);
      }
      const stepZ = AH / 4;
      for (let z = -AH / 2 + stepZ / 2; z < AH / 2; z += stepZ) {
        lampPts.push([-AW / 2 - 1.3, z, Math.PI / 2]);
        lampPts.push([AW / 2 + 1.3, z, -Math.PI / 2]);
      }
      const poles = new InstancedMesh(new CylinderGeometry(0.07, 0.1, 3.4, 6), k.lit({ color: '#3a3358' }), lampPts.length);
      const heads = new InstancedMesh(new SphereGeometry(0.3, 10, 8), new MeshBasicMaterial({ color: '#fff0b0' }), lampPts.length);
      const arms = new InstancedMesh(new BoxGeometry(0.5, 0.07, 0.07), k.lit({ color: '#3a3358' }), lampPts.length);
      lampPts.forEach(([x, z, r], i) => {
        put(poles, i, x, 1.7, z);
        put(heads, i, x, 3.5, z);
        put(arms, i, x, 3.3, z, 1, 1, 1, r);
        heads.setColorAt(i, new Color('#fff0b0'));
      });
      scene.add(poles, heads, arms);
      const lampOn = new Color('#fff0b0');
      const lampOff = new Color('#d9b66a');
      let lampTick = -1;
      tweens.push((time) => {
        const t = Math.floor(time * 2.2);
        if (t === lampTick || !heads.instanceColor) return;
        lampTick = t;
        for (let i = 0; i < lampPts.length; i++) {
          // vài đèn chập chờn
          const flick = i % 5 === 0 && (t + i) % 4 === 0;
          heads.setColorAt(i, flick ? lampOff : lampOn);
        }
        heads.instanceColor.needsUpdate = true;
      });

      // dây cờ tam giác giữa các cột đèn dọc cạnh bắc, đông, tây
      const bunt: { x: number; y: number; z: number; rot: number }[] = [];
      const rope = (ax: number, az: number, bx: number, bz: number) => {
        const n = 7;
        for (let j = 1; j < n; j++) {
          const t = j / n;
          const sag = Math.sin(t * Math.PI) * 0.45;
          bunt.push({ x: ax + (bx - ax) * t, y: 3.35 - sag, z: az + (bz - az) * t, rot: Math.atan2(bx - ax, bz - az) });
        }
      };
      const north = lampPts.filter((p) => p[2] === 0).sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < north.length - 1; i++) rope(north[i][0], north[i][1], north[i + 1][0], north[i + 1][1]);
      for (const sgn of [-1, 1]) {
        const col = lampPts.filter((p) => Math.abs(p[2]) === Math.PI / 2 && Math.sign(p[0]) === sgn).sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < col.length - 1; i++) rope(col[i][0], col[i][1], col[i + 1][0], col[i + 1][1]);
      }
      const buntGeo = new ConeGeometry(0.17, 0.4, 3);
      buntGeo.rotateX(Math.PI);
      const buntMesh = new InstancedMesh(buntGeo, new MeshBasicMaterial({ color: '#ffffff' }), bunt.length);
      const buntCols = ['#ff4d6d', '#ffd166', '#43d9ae', '#6aa6ff', '#c07bff'].map((c) => new Color(c));
      bunt.forEach((b, i) => buntMesh.setColorAt(i, buntCols[i % buntCols.length]));
      scene.add(buntMesh);
      tweens.push((time) => {
        for (let i = 0; i < bunt.length; i++) {
          const b = bunt[i];
          put(buntMesh, i, b.x, b.y - 0.2 + Math.sin(time * 3 + i) * 0.02, b.z, 1, 1, 1, b.rot + Math.sin(time * 2.5 + i * 0.9) * 0.35);
        }
        buntMesh.instanceMatrix.needsUpdate = true;
      });

      // cây quanh sân (phía nam chỉ có bụi thấp để không che camera)
      const trees: { x: number; z: number; s: number }[] = [];
      const bushes: { x: number; z: number; s: number }[] = [];
      for (let x = -AW / 2 - 4; x <= AW / 2 + 4; x += 3.6) trees.push({ x: x + rnd() * 1.5, z: -AH / 2 - 4.2 - rnd() * 3, s: 0.9 + rnd() * 0.5 });
      for (let z = -AH / 2; z <= AH / 2 - 1; z += 4.2) {
        trees.push({ x: -AW / 2 - 4.6 - rnd() * 2, z: z + rnd() * 1.2, s: 0.8 + rnd() * 0.5 });
        trees.push({ x: AW / 2 + 4.6 + rnd() * 2, z: z + rnd() * 1.2, s: 0.8 + rnd() * 0.5 });
      }
      for (let x = -AW / 2 - 3; x <= AW / 2 + 3; x += 2.8) bushes.push({ x: x + rnd(), z: AH / 2 + 3 + rnd() * 1.5, s: 0.6 + rnd() * 0.4 });
      const trunks = new InstancedMesh(new CylinderGeometry(0.16, 0.24, 1.6, 6), k.lit({ color: '#8a5a3a' }), trees.length);
      const crowns = new InstancedMesh(new SphereGeometry(1, 10, 8), k.lit({ color: '#ffffff' }), trees.length * 2 + bushes.length);
      const greens = ['#4fcf5f', '#39b86a', '#7ad94f', '#2fa5a0'].map((c) => new Color(c));
      trees.forEach((t, i) => {
        put(trunks, i, t.x, 0.8 * t.s, t.z, t.s, t.s, t.s);
        put(crowns, i * 2, t.x, 2.2 * t.s, t.z, 1.25 * t.s, 1.1 * t.s, 1.25 * t.s);
        put(crowns, i * 2 + 1, t.x + 0.3 * t.s, 3.1 * t.s, t.z - 0.1, 0.85 * t.s, 0.8 * t.s, 0.85 * t.s);
        crowns.setColorAt(i * 2, greens[i % 4]);
        crowns.setColorAt(i * 2 + 1, greens[(i + 1) % 4]);
      });
      bushes.forEach((b, i) => {
        const id = trees.length * 2 + i;
        put(crowns, id, b.x, 0.32 * b.s, b.z, 0.8 * b.s, 0.5 * b.s, 0.8 * b.s);
        crowns.setColorAt(id, greens[(i + 2) % 4]);
      });
      trunks.castShadow = crowns.castShadow = !k.low;
      scene.add(trunks, crowns);

      // ghế dài, thùng gỗ, thùng phuy dọc rìa sân
      const benches: { x: number; z: number; r: number }[] = [];
      for (const [x, z, r] of lampPts) {
        const off = 1.7; // lệch dọc rìa, tránh trùng cột đèn
        if (r === 0 || r === Math.PI) benches.push({ x: x + off, z: r === 0 ? -AH / 2 - 1.5 : AH / 2 + 1.5, r });
        else benches.push({ x, z: z + off, r });
      }
      const seatM = new InstancedMesh(new BoxGeometry(1.5, 0.12, 0.52), k.lit({ color: '#b9763f' }), benches.length);
      const backM = new InstancedMesh(new BoxGeometry(1.5, 0.5, 0.09), k.lit({ color: '#8d5428' }), benches.length);
      benches.forEach((b, i) => {
        // ghế nhìn vào sân
        const nz = Math.cos(b.r);
        const nx = Math.sin(b.r);
        put(seatM, i, b.x, 0.5, b.z, 1, 1, 1, b.r);
        put(backM, i, b.x - nx * 0.25, 0.85, b.z - nz * 0.25, 1, 1, 1, b.r);
      });
      scene.add(seatM, backM);

      const crateSpots: [number, number][] = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          crateSpots.push([sx * (AW / 2 + 1.0), sz * (AH / 2 + 1.0)]);
          crateSpots.push([sx * (AW / 2 + 1.9), sz * (AH / 2 + 0.55)]);
          crateSpots.push([sx * (AW / 2 + 0.55), sz * (AH / 2 + 1.9)]);
        }
      }
      const crates = new InstancedMesh(new BoxGeometry(0.7, 0.7, 0.7), k.lit({ color: '#ffffff' }), crateSpots.length);
      const barrels = new InstancedMesh(new CylinderGeometry(0.34, 0.34, 0.8, 10), k.lit({ color: '#ffffff' }), crateSpots.length);
      const crCols = ['#d9a05b', '#5fb0f0', '#ff7aa3', '#7ad94f'].map((c) => new Color(c));
      crateSpots.forEach(([x, z], i) => {
        if (i % 2 === 0) {
          put(crates, i, x, 0.35, z, 1, 1, 1, i);
          crates.setColorAt(i, crCols[i % 4]);
          put(barrels, i, 0, -9, 0, 0, 0, 0);
        } else {
          put(barrels, i, x, 0.4, z);
          barrels.setColorAt(i, crCols[(i + 2) % 4]);
          put(crates, i, 0, -9, 0, 0, 0, 0);
        }
      });
      crates.castShadow = barrels.castShadow = !k.low;
      scene.add(crates, barrels);

      // thảm hoa trên bãi cỏ
      const FLOWERS = 90;
      const flowerM = new InstancedMesh(new SphereGeometry(0.13, 6, 5), new MeshBasicMaterial({ color: '#ffffff' }), FLOWERS);
      const flCols = ['#ff7aa3', '#ffffff', '#ffd166', '#c07bff', '#ff9a6b'].map((c) => new Color(c));
      for (let i = 0; i < FLOWERS; i++) {
        let fx: number;
        let fz: number;
        do {
          fx = (rnd() - 0.5) * (AW + 22);
          fz = (rnd() - 0.5) * (AH + 20);
        } while (Math.abs(fx) < AW / 2 + 2.6 && Math.abs(fz) < AH / 2 + 2.6);
        put(flowerM, i, fx, -0.1, fz);
        flowerM.setColorAt(i, flCols[i % flCols.length]);
      }
      scene.add(flowerM);

      // bóng bay bồng bềnh
      const BALLS = 14;
      const balloons = new InstancedMesh(new SphereGeometry(0.5, 10, 8), new MeshBasicMaterial({ color: '#ffffff' }), BALLS);
      const bCols = ['#ff4d6d', '#ffd166', '#43d9ae', '#6aa6ff', '#c07bff'].map((c) => new Color(c));
      const bPos: [number, number, number][] = [];
      for (let i = 0; i < BALLS; i++) {
        const ang = (i / BALLS) * Math.PI * 2;
        bPos.push([Math.cos(ang) * (AW / 2 + 5 + rnd() * 3), 4.5 + rnd() * 2.5, -AH / 2 - 1 + Math.sin(ang) * (AH / 2 + 5 + rnd() * 2)]);
        balloons.setColorAt(i, bCols[i % 5]);
      }
      scene.add(balloons);
      tweens.push((time) => {
        for (let i = 0; i < BALLS; i++) {
          const [x, y, z] = bPos[i];
          put(balloons, i, x, y + Math.sin(time * 1.1 + i) * 0.35, z, 0.9, 1.1, 0.9);
        }
        balloons.instanceMatrix.needsUpdate = true;
      });

      // đài phun nước ở bốn góc, tia nước bay theo quỹ đạo
      const basinGeo = new CylinderGeometry(1.7, 1.9, 0.55, 16);
      const stoneMat = k.lit({ color: '#ece4d2' });
      const waterMat = new MeshBasicMaterial({ color: '#4cc9f0' });
      const colGeo = new CylinderGeometry(0.22, 0.3, 1.4, 8);
      const waterGeo = new CylinderGeometry(1.5, 1.5, 0.05, 16);
      const DROPS = 16;
      const fountains: [number, number][] = [
        [-AW / 2 - 5.2, -AH / 2 - 4.6],
        [AW / 2 + 5.2, -AH / 2 - 4.6],
        [-AW / 2 - 5.2, AH / 2 + 4.6],
        [AW / 2 + 5.2, AH / 2 + 4.6],
      ];
      const drops = new InstancedMesh(new SphereGeometry(0.1, 6, 5), new MeshBasicMaterial({ color: '#c9efff' }), fountains.length * DROPS);
      for (const [fx, fz] of fountains) {
        const basin = new Mesh(basinGeo, stoneMat);
        basin.position.set(fx, 0.2, fz);
        const wat = new Mesh(waterGeo, waterMat);
        wat.position.set(fx, 0.5, fz);
        const col = new Mesh(colGeo, stoneMat);
        col.position.set(fx, 1.0, fz);
        scene.add(basin, wat, col);
      }
      scene.add(drops);
      tweens.push((time) => {
        fountains.forEach(([fx, fz], f) => {
          for (let d = 0; d < DROPS; d++) {
            const ph = (time * 0.85 + d / DROPS) % 1;
            const a = (d / DROPS) * Math.PI * 2 * 3 + f;
            const r = ph * 1.25;
            put(drops, f * DROPS + d, fx + Math.cos(a) * r, 1.7 + 4 * ph * (1 - ph) * 1.5, fz + Math.sin(a) * r);
          }
        });
        drops.instanceMatrix.needsUpdate = true;
      });

      // vòng đu quay khổng lồ ở phía sau, quay chậm
      {
        const wheel = new Group();
        wheel.position.set(AW * 0.22, 8.2, -AH / 2 - 15);
        const R = 6.8;
        const rimMat = k.lit({ color: '#ff7aa3', emissive: '#ff4d8a', emissiveIntensity: 0.4 });
        const rim1 = new Mesh(new TorusGeometry(R, 0.14, 8, 40), rimMat);
        const rim2 = new Mesh(new TorusGeometry(R * 0.55, 0.1, 8, 32), rimMat);
        wheel.add(rim1, rim2);
        const spokeGeo = new BoxGeometry(R * 2, 0.1, 0.1);
        for (let i = 0; i < 6; i++) {
          const sp = new Mesh(spokeGeo, k.lit({ color: '#f2f2f7' }));
          sp.rotation.z = (i / 6) * Math.PI;
          wheel.add(sp);
        }
        const cabGeo = new BoxGeometry(1.1, 0.9, 1);
        const cabs: Mesh[] = [];
        const cabCols = ['#ffd166', '#43d9ae', '#6aa6ff', '#ff7aa3', '#c07bff', '#ff9a6b'];
        for (let i = 0; i < 12; i++) {
          const cab = new Mesh(cabGeo, k.lit({ color: cabCols[i % 6] }));
          const a = (i / 12) * Math.PI * 2;
          cab.position.set(Math.cos(a) * R, Math.sin(a) * R - 0.6, 0);
          wheel.add(cab);
          cabs.push(cab);
        }
        scene.add(wheel);
        const legMat = k.lit({ color: '#5d6bb8' });
        for (const sgn of [-1, 1]) {
          const leg = new Mesh(new BoxGeometry(0.35, 9.6, 0.5), legMat);
          leg.position.set(wheel.position.x + sgn * 2.6, 4.2, wheel.position.z);
          leg.rotation.z = -sgn * 0.3;
          scene.add(leg);
        }
        tweens.push((_t, dt) => {
          wheel.rotation.z += dt * 0.12;
          for (const c of cabs) c.rotation.z = -wheel.rotation.z;
        });
      }

      /* ---------------- bảng mã 3D trên đầu ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        seenAt: number;
        board: Group;
        frameMat: ReturnType<typeof k.lit>;
        digits: InstancedMesh;
        glow: InstancedMesh;
        code: string | null;
        ang: number;
        phase: number;
      }
      // bảng treo: lưng tối + viền màu người chơi phát sáng + mặt kính tối; 3 chữ số 7 đoạn NỔI phát sáng (kèm quầng màu) nằm ở mặt trước.
      // Lưng bảng đặc nên nhìn từ sau / hông chỉ thấy khung, không đọc được số.
      const BW = 2.7;
      const BH = 1.5;
      const backGeo = new BoxGeometry(BW, BH, 0.16);
      const barH = new BoxGeometry(BW + 0.04, 0.14, 0.28);
      const barV = new BoxGeometry(0.14, BH, 0.28);
      const capGeo = new SphereGeometry(0.13, 10, 8);
      const faceGeo = new BoxGeometry(BW - 0.28, BH - 0.28, 0.04);
      const postGeo = new CylinderGeometry(0.06, 0.06, 0.22, 6);
      const haloGeo = new TorusGeometry(0.4, 0.04, 8, 24);
      haloGeo.rotateX(Math.PI / 2);
      const auraGeo = new PlaneGeometry(BW * 1.45, BH * 1.7);
      const segGeo = new BoxGeometry(1, 1, 1);
      const backMat = k.lit({ color: '#171134' });
      const capWhite = new MeshBasicMaterial({ color: '#ffffff' });
      const faceTex = k.texture(128, 64, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#2b2160');
        gr.addColorStop(0.5, '#150f38');
        gr.addColorStop(1, '#0c0824');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
        // vệt sáng chéo như mặt kính
        g.fillStyle = 'rgba(255,255,255,0.09)';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(w * 0.5, 0);
        g.lineTo(w * 0.2, h);
        g.lineTo(0, h);
        g.closePath();
        g.fill();
      });
      const faceMat = new MeshBasicMaterial({ map: faceTex });
      const auraTex = k.texture(64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0.25)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      });
      const digitMat = new MeshBasicMaterial({ color: '#fffbd0' });
      const postMat = k.lit({ color: '#cfcde6' });

      // đoạn a..g của số 7 đoạn: [cx, cy, ngang?]
      const SEG: [number, number, boolean][] = [
        [0, 0.4, true],
        [0.2, 0.2, false],
        [0.2, -0.2, false],
        [0, -0.4, true],
        [-0.2, -0.2, false],
        [-0.2, 0.2, false],
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
      const DIGIT_X = [-0.8, 0, 0.8];
      const setDigits = (digits: InstancedMesh, glow: InstancedMesh, code: string) => {
        for (let d = 0; d < 3; d++) {
          const ch = code[d] && ON[code[d]] ? code[d] : '-';
          for (let sI = 0; sI < 7; sI++) {
            const [cx, cy, horiz] = SEG[sI];
            const on = ON[ch].includes(sI);
            const sx = on ? (horiz ? 0.44 : 0.13) : 0;
            const sy = on ? (horiz ? 0.13 : 0.44) : 0;
            _q.identity();
            _m.compose(_p.set(DIGIT_X[d] + cx, cy, 0.16), _q, _s.set(sx, sy, on ? 0.12 : 0));
            digits.setMatrixAt(d * 7 + sI, _m);
            _m.compose(_p.set(DIGIT_X[d] + cx, cy, 0.13), _q, _s.set(on ? sx + 0.1 : 0, on ? sy + 0.1 : 0, on ? 0.05 : 0));
            glow.setMatrixAt(d * 7 + sI, _m);
          }
        }
        digits.instanceMatrix.needsUpdate = true;
        glow.instanceMatrix.needsUpdate = true;
      };
      const chars = new Map<string, Entry>();
      let pi = 0;
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);

        const board = new Group();
        const frameMat = k.lit({ color: p.color, emissive: p.color, emissiveIntensity: 0.9 });
        const back = new Mesh(backGeo, backMat);
        const top = new Mesh(barH, frameMat);
        top.position.y = BH / 2;
        const bot = new Mesh(barH, frameMat);
        bot.position.y = -BH / 2;
        const lf = new Mesh(barV, frameMat);
        lf.position.x = -BW / 2;
        const rt = new Mesh(barV, frameMat);
        rt.position.x = BW / 2;
        board.add(back, top, bot, lf, rt);
        for (const [cx, cy] of [
          [-1, 1],
          [1, 1],
          [-1, -1],
          [1, -1],
        ]) {
          const cap = new Mesh(capGeo, capWhite);
          cap.position.set((cx * BW) / 2, (cy * BH) / 2, 0);
          board.add(cap);
        }
        const face = new Mesh(faceGeo, faceMat);
        face.position.z = 0.1;
        const digits = new InstancedMesh(segGeo, digitMat, 21);
        const glow = new InstancedMesh(segGeo, new MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.55, depthWrite: false }), 21);
        digits.frustumCulled = glow.frustumCulled = false;
        setDigits(digits, glow, '');
        const aura = new Mesh(auraGeo, new MeshBasicMaterial({ map: auraTex, color: p.color, transparent: true, opacity: 0.38, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
        aura.position.z = -0.12;
        const post = new Mesh(postGeo, postMat);
        post.position.y = -BH / 2 - 0.11;
        const halo = new Mesh(haloGeo, frameMat);
        halo.position.y = -BH / 2 - 0.3;
        board.add(face, glow, digits, aura, post, halo);
        back.castShadow = top.castShadow = bot.castShadow = !k.low;
        board.visible = false;
        scene.add(board);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, seenAt: -99, board, frameMat, digits, glow, code: null, ang: 0, phase: pi++ * 1.3 });
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

      /** đoạn camera→người có xuyên qua hình chữ nhật (x0..x1, z0..z1) không */
      const crosses = (ax: number, az: number, bx: number, bz: number, d: Dress) => {
        let t0 = 0;
        let t1 = 1;
        for (const [p, dd, lo, hi] of [
          [ax, bx - ax, d.x0, d.x1],
          [az, bz - az, d.z0, d.z1],
        ] as const) {
          if (Math.abs(dd) < 1e-9) {
            if (p < lo || p > hi) return false;
          } else {
            let ta = (lo - p) / dd;
            let tb = (hi - p) / dd;
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) return false;
          }
        }
        return true;
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

            // bảng mã 3D quay theo hướng mặt nhân vật (không billboard), nhấp nhô nhẹ; bảng của mình nhỏ hơn cho đỡ vướng tầm nhìn
            e.board.visible = true;
            if (isMe) code = me?.code ?? '';
            if (code !== e.code) {
              e.code = code;
              setDigits(e.digits, e.glow, code);
            }
            const want = Math.atan2(fx, fz);
            const dA = Math.atan2(Math.sin(want - e.ang), Math.cos(want - e.ang));
            e.ang += dA * (1 - Math.exp(-dt * 14));
            e.board.rotation.y = e.ang;
            const bob = Math.sin(time * 2.2 + e.phase) * 0.06;
            e.board.position.set(e.x, BOARD_Y + bob, e.z);
            e.board.scale.setScalar(isMe ? 0.82 : 1);
            e.frameMat.emissiveIntensity = inv ? 0.45 + 0.4 * Math.sin(time * 14) : 0.9;

            const el = o.labels.get(p.id);
            if (el) k.label(el, e.x, BOARD_Y + 1.1 + bob, e.z);
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

          // vật cản nằm giữa camera và mình thì hạ thấp xuống để không che nhân vật (chỉ là hình ảnh; tầm nhìn thật do server quyết)
          const px = m?.placed ? m.x : focus.x;
          const pz = m?.placed ? m.z : focus.z;
          const lerpK = 1 - Math.exp(-dt * 9);
          for (const d of dress) {
            const hide = crosses(camPos.x, camPos.z, px, pz, d);
            d.sq += ((hide ? 0.38 : 1) - d.sq) * lerpK;
            d.g.scale.y = d.sq;
          }

          for (const tw of tweens) tw(time, dt);
        },
      };
    },
  );
}
