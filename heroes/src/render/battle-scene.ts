// Cảnh 3D của trận đánh: camera nghiêng cố định, hai phe đối mặt, camera tự lùi theo tỉ lệ màn hình.
// Cảnh CHỈ phát lại BattleEvent do engine dùng chung xuất ra (act/dmg/heal/fx/die/wave/end).
// Phần "trình diễn" (hit-stop, slow-mo, rung, zoom, cinematic tuyệt kỹ, hạt) chỉ là hình ảnh — không đụng kết quả tính toán.
import * as THREE from 'three';
import { FRONT_SLOTS } from '@shared/heroes/config';
import { ENERGY_MAX, type Battle, type BattleEvent, type Unit } from '@shared/heroes/battle';
import { skillOf } from '@shared/heroes/skills';
import type { EffectType, Element, Role } from '@shared/heroes/types';
import { HITSTOP, PACE } from '../battle/pacing';
import { FxPool, disposeFxTextures, fxTex } from './fx-pool';
import { createHeroModel, type HeroModel } from './hero-model';
import { brightLights, makeBlob, type LiveScene } from './live';
import { currentPreset, type QualityState } from './quality';
import { playUlt, type FxHost } from './ult-fx';

export const ELEMENT_COLOR: Record<Element, number> = {
  forest: 0x54c74a, earth: 0xd9a050, water: 0x3fa7ff, light: 0xffe66b, dark: 0xb066ff,
};
export const EFFECT_LABEL: Record<EffectType, { text: string; color: string }> = {
  atkUp: { text: 'Công +', color: '#ff9a3d' },
  defUp: { text: 'Thủ +', color: '#4aa3ff' },
  defDown: { text: 'Thủ -', color: '#c77dff' },
  stun: { text: 'Choáng!', color: '#ffd23f' },
  shield: { text: 'Khiên', color: '#7fe3ff' },
  spdUp: { text: 'Tốc +', color: '#5ee08a' },
};
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** thông tin cho màn cắt cảnh tuyệt kỹ (DOM) */
export interface CineInfo {
  uid: number;
  key: string;
  name: string;
  color: string;
  boss: boolean;
  side: 0 | 1;
  /** giây THẬT của đoạn chờ trước khi tung chiêu */
  dur: number;
  low: boolean;
}

/** cầu nối sang lớp HUD HTML */
export interface SceneHooks {
  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }): void;
  hp(uid: number, hp: number, max: number): void;
  died(uid: number): void;
  wave(n: number): void;
  flash(color: string): void;
  sfx(k: 'hit' | 'crit' | 'ult' | 'heal'): void;
  /** chữ tên kỹ năng to, vui nhộn bật lên trên đầu người dùng (tuyệt kỹ = to hơn) */
  skill?(uid: number, name: string, color: string, ult: boolean): void;
  /** sau mỗi khung vẽ: HUD cập nhật vị trí thanh máu theo camera */
  frame?(): void;
  /** banner cắt cảnh tuyệt kỹ */
  cinematic?(c: CineInfo): void;
  /** dòng nhật ký trận */
  log?(text: string, side: 0 | 1): void;
  /** banner thắng/thua */
  banner?(win: boolean): void;
}

export interface UnitView {
  uid: number;
  /** khoá mô hình: id tướng hoặc mk_* */
  key: string;
  side: 0 | 1;
  slot: number;
  role: Role;
  element: Element;
  boss: boolean;
  /** trạng thái engine (chỉ đọc) — để vẽ aura đầy năng lượng, khiên, choáng */
  unit: Unit;
  group: THREE.Group;
  model: HeroModel;
  blob: THREE.Mesh;
  home: THREE.Vector3;
  offset: THREE.Vector3;
  /** độ giật lùi do trúng đòn / trượt vào cảnh */
  kick: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  gone: boolean;
  aura: THREE.Mesh | null;
  auraT: number;
  shieldMesh: THREE.Mesh | null;
  shieldOn: boolean;
  stunGroup: THREE.Group | null;
  stunOn: boolean;
}

interface Tw {
  t: number;
  dur: number;
  fn(k: number): void;
  done?(): void;
}
interface Later {
  t: number;
  fn(): void;
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const FRONT_DEPTH = 1.5;
const BACK_DEPTH = 3.1;
const FRONT_LAT = [-0.95, 0.95];
const BACK_LAT = [-1.95, 0, 1.95];
const rnd = Math.random;

export type Layout = 'h' | 'v';

export class BattleScene implements LiveScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  readonly views = new Map<number, UnitView>();
  hooks: SceneHooks;
  /** hệ số tốc độ trận (SPEED_MULT); 0 khi tạm dừng */
  timeScale = 1;
  layout: Layout = 'h';
  canvasW = 1;
  canvasH = 1;
  /** thời gian giữ (giây cảnh) mà nhóm sự kiện vừa phát yêu cầu — session đọc để chặn engine */
  groupHold = 0;

  private q: QualityState = currentPreset();
  private low = this.q.level === 'low';
  private pool: FxPool;
  private battle: Battle | null = null;
  private tweens: Tw[] = [];
  private laters: Later[] = [];
  private curDelay = 0;
  private curUlt = false;
  private dmgIdx = 0;
  private cineActive = false;
  private shake = 0;
  private time = 0;
  /* đồng hồ hoạt hình: hit-stop đóng băng, slow-mo giảm tốc (tính bằng giây THẬT) */
  private freezeT = 0;
  private slowT = 0;
  private slowK = 1;
  /* camera: đẩy vào / zoom nhẹ / nghiêng */
  private camBase = new THREE.Vector3();
  private camFocus = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private cinePush = 0;
  private cineDir = 1;
  private camKick = 0;
  private camDirty = false;
  private owned: { dispose(): void }[] = [];
  private ringGeo: THREE.RingGeometry;
  private sphereGeo: THREE.SphereGeometry;
  private pillarGeo: THREE.CylinderGeometry;
  private camTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  /** cầu nối cho hiệu ứng tuyệt kỹ riêng từng tướng (ult-fx.ts) */
  private fxHost: FxHost = {
    scene: this.scene,
    tween: (d, f, dn) => this.tween(d, f, dn),
    later: (s, f) => this.later(s, f),
    ring: (p, c, s, d) => this.ring(p, c, s, d),
    burst: (p, c, n, sp) => this.burst(p, c, n, sp),
    shake: (v) => {
      this.shake = Math.max(this.shake, v);
    },
    low: this.q.level === 'low',
  };

  constructor(hooks: SceneHooks, theme: Element = 'forest') {
    this.hooks = hooks;
    brightLights(this.scene);
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2);
    this.sphereGeo = new THREE.SphereGeometry(1, 10, 8);
    this.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    this.owned.push(this.ringGeo, this.sphereGeo, this.pillarGeo);
    this.pool = new FxPool(this.scene, this.q.level === 'high' ? 140 : this.q.level === 'medium' ? 90 : 48);
    this.buildGround(theme);
  }

  /* ------------------------------ MÔI TRƯỜNG ------------------------------ */
  private mat(c: number): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color: c });
    this.owned.push(m);
    return m;
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.owned.push(g);
    return g;
  }
  private buildGround(theme: Element) {
    const palette: Record<Element, [number, number, number]> = {
      forest: [0x6cc24a, 0x86d95e, 0xe8d79a],
      water: [0x4fb7a8, 0x6fd0c0, 0xdff3ea],
      earth: [0xc8a266, 0xdcb97c, 0xf2e2b0],
      light: [0x8fd36a, 0xa9e482, 0xfff3b8],
      dark: [0x5a7a62, 0x71937a, 0xcdb8e8],
    };
    const [outer, inner, edge] = palette[theme];
    const ground = new THREE.Mesh(this.geo(new THREE.CircleGeometry(40, 40).rotateX(-Math.PI / 2)), this.mat(outer));
    ground.position.y = -0.02;
    const arena = new THREE.Mesh(this.geo(new THREE.CircleGeometry(6.2, 48).rotateX(-Math.PI / 2)), this.mat(inner));
    const rim = new THREE.Mesh(this.geo(new THREE.RingGeometry(6.2, 6.6, 48).rotateX(-Math.PI / 2)), this.mat(edge));
    rim.position.y = 0.01;
    this.scene.add(ground, arena, rim);
    // cây và đá rải quanh đấu trường (xa camera, rẻ: dùng chung hình khối)
    const cone = this.geo(new THREE.ConeGeometry(0.6, 1.3, 8));
    const trunk = this.geo(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 6));
    const rock = this.geo(new THREE.DodecahedronGeometry(0.5, 0));
    const green = this.mat(0x3fae4a);
    const brown = this.mat(0x8a5a2b);
    const gray = this.mat(0x9aa0aa);
    const n = this.q.level === 'low' ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const r = 8.2 + (i % 3) * 1.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (i % 4 === 3) {
        const m = new THREE.Mesh(rock, gray);
        m.position.set(x, 0.25, z);
        m.scale.setScalar(0.8 + (i % 3) * 0.4);
        this.scene.add(m);
      } else {
        const g = new THREE.Group();
        const t = new THREE.Mesh(trunk, brown);
        t.position.y = 0.25;
        const c = new THREE.Mesh(cone, green);
        c.position.y = 1.05;
        g.add(t, c);
        g.position.set(x, 0, z);
        g.scale.setScalar(1.1 + (i % 4) * 0.35);
        this.scene.add(g);
      }
    }
  }

  /* ------------------------------ BỐ TRÍ ------------------------------ */
  private homeOf(side: 0 | 1, slot: number): THREE.Vector3 {
    const front = slot < FRONT_SLOTS;
    const depth = front ? FRONT_DEPTH : BACK_DEPTH;
    const lat = front ? (FRONT_LAT[slot] ?? 0) : (BACK_LAT[slot - FRONT_SLOTS] ?? 0);
    const s = side === 0 ? -1 : 1;
    if (this.layout === 'h') return new THREE.Vector3(s * depth * this.spread(), 0, lat);
    return new THREE.Vector3(lat * 1.25, 0, -s * depth);
  }
  /** màn ngang rộng (điện thoại xoay ngang) thì giãn hai phe ra hai bên cho đỡ chồng thanh máu */
  private spread(): number {
    return Math.min(1.55, Math.max(1, this.canvasW / Math.max(1, this.canvasH) / 1.4));
  }
  private faceOf(side: 0 | 1): number {
    if (this.layout === 'h') return side === 0 ? Math.PI / 2 : -Math.PI / 2;
    return side === 0 ? Math.PI : 0;
  }
  private place(v: UnitView) {
    v.group.position.copy(v.home).add(v.offset).add(v.kick);
  }
  private applyLayout() {
    for (const v of this.views.values()) {
      v.home.copy(this.homeOf(v.side, v.slot));
      v.model.object3d.rotation.y = this.faceOf(v.side);
      this.place(v);
    }
  }

  private fitCamera() {
    const aspect = this.canvasW / this.canvasH;
    const th = Math.tan((this.camera.fov * Math.PI) / 360);
    let el: number, W: number, H: number, k: number;
    if (this.layout === 'h') {
      el = (30 * Math.PI) / 180;
      W = 4.5 * this.spread();
      H = 2.6 * Math.sin(el) + 2.0 * Math.cos(el) + 0.5;
      k = 1.1;
      this.camTarget.set(0, 0.7, 0.2);
    } else {
      el = (40 * Math.PI) / 180; // thấp hơn 54° cũ để thấy mặt nhân vật, không chỉ đỉnh đầu
      W = 3.6;
      H = 3.9 * Math.sin(el) + 2.0 * Math.cos(el) + 0.4;
      k = 1.1;
      this.camTarget.set(0, 0.5, 0.9);
    }
    const d = Math.max(W / (th * aspect), H / th) * k;
    this.camera.position.set(this.camTarget.x, this.camTarget.y + Math.sin(el) * d, this.camTarget.z + Math.cos(el) * d);
    this.camera.lookAt(this.camTarget);
    this.camBase.copy(this.camera.position);
  }

  resize(w: number, h: number) {
    this.canvasW = w;
    this.canvasH = h;
    const lay: Layout = w / h >= 1.05 ? 'h' : 'v';
    this.layout = lay;
    this.applyLayout(); // khoảng cách hai phe phụ thuộc tỉ lệ màn hình
    this.fitCamera();
    this.camDirty = false;
  }

  /* ------------------------------ ĐƠN VỊ ------------------------------ */
  addUnit(u: Unit, pop = false): UnitView {
    const init = u.init;
    const model = createHeroModel(init.key, { outlines: this.q.outlines });
    const group = new THREE.Group();
    group.add(model.object3d);
    const blob = makeBlob(init.boss ? 2.4 : 1.4);
    group.add(blob);
    const v: UnitView = {
      uid: u.uid, key: init.key, side: init.side, slot: init.slot, role: init.role, element: init.element, boss: !!init.boss,
      unit: u, group, model, blob, home: this.homeOf(init.side, init.slot), offset: new THREE.Vector3(), kick: new THREE.Vector3(),
      hp: u.hp, maxHp: u.maxHp, alive: true, gone: false,
      aura: null, auraT: 0, shieldMesh: null, shieldOn: false, stunGroup: null, stunOn: false,
    };
    model.object3d.rotation.y = this.faceOf(init.side);
    group.position.copy(v.home);
    this.scene.add(group);
    this.views.set(u.uid, v);
    if (pop) {
      // trượt vào từ mép phe mình + nảy to dần
      const sgn = init.side === 0 ? -1 : 1;
      const away = this.layout === 'h' ? this.tmpA.set(sgn * 3.2, 0, 0) : this.tmpA.set(0, 0, -sgn * 3.2);
      const ax = away.x;
      const az = away.z;
      group.scale.setScalar(0.01);
      this.tween(0.5, (k) => {
        const s = k < 0.7 ? easeOut(k / 0.7) * 1.15 : 1.15 - 0.15 * ((k - 0.7) / 0.3);
        group.scale.setScalar(Math.max(0.01, s));
        const e = 1 - easeOut(k);
        v.kick.set(ax * e, 0, az * e);
        this.place(v);
      });
      this.ring(v.home, ELEMENT_COLOR[init.element], 1.6, 0.5);
    }
    return v;
  }

  private removeView(v: UnitView) {
    v.gone = true;
    this.scene.remove(v.group);
    v.model.dispose();
    this.disposeExtras(v);
  }
  private disposeExtras(v: UnitView) {
    if (v.aura) (v.aura.material as THREE.Material).dispose();
    if (v.shieldMesh) (v.shieldMesh.material as THREE.Material).dispose();
    if (v.stunGroup) for (const c of v.stunGroup.children) ((c as THREE.Sprite).material as THREE.Material).dispose();
    v.aura = v.shieldMesh = null;
    v.stunGroup = null;
  }

  /* ------------------------------ HẸN GIỜ / TWEEN (theo thời gian đã nhân tốc độ) ------------------------------ */
  private tween(dur: number, fn: (k: number) => void, done?: () => void) {
    this.tweens.push({ t: 0, dur, fn, done });
  }
  private later(sec: number, fn: () => void) {
    if (sec <= 0) fn();
    else this.laters.push({ t: sec, fn });
  }

  /* ------------------------------ HIỆU ỨNG ------------------------------ */
  private fxMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  }
  private ring(pos: THREE.Vector3, color: number, size: number, dur: number) {
    const m = this.fxMat(color, 0.9);
    const r = new THREE.Mesh(this.ringGeo, m);
    r.position.copy(pos).setY(0.05);
    this.scene.add(r);
    this.tween(dur, (k) => {
      r.scale.setScalar(0.3 + size * easeOut(k));
      m.opacity = 0.9 * (1 - k);
    }, () => {
      this.scene.remove(r);
      m.dispose();
    });
  }
  /** vụ nổ hạt (dùng hồ sprite, không tạo mesh/vật liệu mới) */
  private burst(pos: THREE.Vector3, color: number, n = this.q.particles, speed = 2.2) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = speed * (0.4 + rnd() * 0.6);
      this.pool.spawn('dot', pos.x, pos.y, pos.z, Math.cos(a) * sp, 1.2 + rnd() * 1.8, Math.sin(a) * sp, -7, 0.55, 0.3, 0.08, color);
    }
  }
  private projectile(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number, size = 0.16) {
    const m = this.fxMat(color, 1);
    const mesh = new THREE.Mesh(this.sphereGeo, m);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.tween(dur, (k) => {
      mesh.position.lerpVectors(from, to, k);
      mesh.position.y += Math.sin(k * Math.PI) * 0.5;
      // đuôi sáng nhỏ sau đạn
      if (!this.low && rnd() < 0.5) this.pool.spawn('dot', mesh.position.x, mesh.position.y, mesh.position.z, 0, 0, 0, 0, 0.22, size * 2.2, 0.02, color, 0, true, 0.8);
    }, () => {
      this.scene.remove(mesh);
      m.dispose();
    });
  }
  private pillar(pos: THREE.Vector3, color: number, dur: number) {
    const m = this.fxMat(color, 0.55);
    const p = new THREE.Mesh(this.pillarGeo, m);
    p.position.copy(pos).setY(2);
    this.scene.add(p);
    this.tween(dur, (k) => {
      p.scale.set(0.9 * (1 - k * 0.6), 4, 0.9 * (1 - k * 0.6));
      m.opacity = 0.55 * (1 - k);
    }, () => {
      this.scene.remove(p);
      m.dispose();
    });
  }
  private chest(v: UnitView): THREE.Vector3 {
    return v.group.position.clone().setY(v.model.height * 0.55 * v.group.scale.y);
  }
  private chestTo(v: UnitView, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(v.group.position).setY(v.model.height * 0.55 * v.group.scale.y);
  }

  /** chậm hình trong `realSec` giây thật (hệ số k < 1) */
  slowmo(k: number, realSec: number) {
    if (this.slowT <= 0 || k < this.slowK) this.slowK = k;
    this.slowT = Math.max(this.slowT, realSec);
  }
  /** đóng băng đồng hồ hoạt hình `sec` giây thật (hit-stop) */
  hitStop(sec: number) {
    this.freezeT = Math.max(this.freezeT, sec);
  }

  /** tia sáng, vệt chém, sao, loé trắng tại điểm trúng */
  private impact(att: UnitView | undefined, tg: UnitView, n: number, crit: boolean, ult: boolean, first: boolean) {
    const c = this.chestTo(tg, this.tmpB);
    const col = ELEMENT_COLOR[att?.element ?? tg.element];
    const ratio = n / Math.max(1, tg.maxHp);
    const h = Math.max(0.8, tg.model.height * tg.group.scale.y);
    const P = this.pool;
    P.spawn('glow', c.x, c.y, c.z, 0, 0, 0, 0, 0.16, h * 1.2, h * 0.6, 0xffffff, 0, true, 0.95);
    const sz = (crit ? 1.9 : ult ? 1.5 : 1.2) * (0.8 + Math.min(0.5, ratio));
    P.spawn('slash', c.x, c.y, c.z, 0, 0, 0, 0, crit ? 0.26 : 0.2, sz * 0.7, sz * 1.4, crit ? 0xfff176 : 0xffffff, 0, true, 1, (rnd() - 0.5) * 1.4 - 0.4);
    if (crit && !this.low) P.spawn('slash', c.x, c.y, c.z, 0, 0, 0, 0, 0.24, sz * 0.7, sz * 1.3, col, 0, true, 1, (rnd() - 0.5) * 1.4 + 1.1);
    const ns = crit ? this.q.particles + 3 : this.q.particles;
    for (let i = 0; i < ns; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 1.6 + rnd() * 2.2;
      P.spawn('spark', c.x, c.y, c.z, Math.cos(a) * sp, 0.8 + rnd() * 2, Math.sin(a) * sp, -6, 0.38, 0.34, 0.06, i % 2 ? col : 0xffffff, 0, true);
    }
    if (crit) {
      // sao nổ lớn
      P.spawn('star', c.x, c.y + 0.1, c.z, 0, 0, 0, 0, 0.3, 0.5, 1.9 + Math.min(0.6, ratio), 0xfff176, 2.5, true);
      const k = this.low ? 2 : 5;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + rnd();
        P.spawn('star', c.x, c.y, c.z, Math.cos(a) * 2.6, 1.2 + rnd() * 1.4, Math.sin(a) * 2.6, -5, 0.55, 0.36, 0.1, 0xffe14d, 4, true);
      }
    } else if (!this.low) {
      P.spawn('star', c.x, c.y, c.z, (rnd() - 0.5) * 3, 1.6 + rnd(), (rnd() - 0.5) * 3, -5, 0.45, 0.26, 0.08, col, 3, true);
    }
    // hit-stop (tuyệt kỹ nhiều mục tiêu: chỉ khựng ở mục tiêu đầu để khỏi giật liên tục)
    if (first) this.hitStop(ult ? HITSTOP.ult : crit ? HITSTOP.crit : HITSTOP.normal);
    // rung màn hình theo lượng sát thương
    const sh = Math.min(ult ? 0.3 : 0.17, 0.035 + ratio * 0.6 + (crit ? 0.06 : 0));
    this.shake = Math.max(this.shake, sh);
    if (crit) {
      this.camKick = Math.max(this.camKick, this.low ? 0.15 : 0.3);
      this.camFocus.copy(c);
    }
    // giật lùi khỏi người đánh
    if (att && att !== tg) {
      const dir = this.tmpC.copy(tg.home).sub(att.home);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        const amt = Math.min(0.55, 0.1 + ratio * 1.2) * (crit ? 1.4 : 1) * (ult ? 1.3 : 1);
        const kx = dir.x * amt;
        const kz = dir.z * amt;
        this.tween(0.3, (k) => {
          const e = k < 0.3 ? easeOut(k / 0.3) : 1 - easeOut((k - 0.3) / 0.7);
          tg.kick.set(kx * e, 0, kz * e);
          this.place(tg);
        });
      }
    }
  }

  /** dấu hiệu năng lượng vừa đầy (HUD gọi) */
  ping(uid: number) {
    const v = this.views.get(uid);
    if (!v || v.gone) return;
    const c = this.chestTo(v, this.tmpB);
    this.pool.spawn('glow', c.x, c.y, c.z, 0, 0, 0, 0, 0.35, 0.6, v.model.height * 1.6, 0xffe27a, 0, true, 0.9);
    const n = this.low ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.pool.spawn('spark', c.x + Math.cos(a) * 0.3, c.y, c.z + Math.sin(a) * 0.3, Math.cos(a) * 1.6, 1.2, Math.sin(a) * 1.6, -2, 0.5, 0.3, 0.05, 0xfff1a0, 0, true);
    }
  }

  /* ------------------------------ CẮT CẢNH TUYỆT KỸ ------------------------------ */
  /** bắt đầu cinematic; trả về giây cảnh cần giữ engine trước khi phát act (0 = không có) */
  cineStart(ev: Extract<BattleEvent, { k: 'act' }>, boss: boolean): number {
    const v = this.views.get(ev.u);
    if (!v) return 0;
    const sk = skillOf(ev.s);
    const pre = boss ? PACE.cinePreBoss : this.low ? PACE.cinePreLow : PACE.cinePre;
    const col = ELEMENT_COLOR[v.element];
    this.cineActive = true;
    this.hooks.cinematic?.({
      uid: v.uid, key: v.key, name: sk.name, color: hex(col), boss, side: v.side, low: this.low,
      dur: pre / Math.max(0.2, this.timeScale),
    });
    this.chestTo(v, this.camFocus);
    this.cineDir = v.side === 0 ? 1 : -1;
    const maxP = boss ? 0.5 : 1;
    this.tween(pre * 0.6, (k) => {
      this.cinePush = maxP * easeOut(k);
    });
    v.model.play('cast');
    this.ring(v.group.position, col, 1.7, pre);
    if (boss) this.shake = Math.max(this.shake, 0.16);
    else if (!this.low) this.later(pre * 0.62, () => this.slowmo(0.35, 0.3)); // chậm nhẹ ngay trước khi chiêu nổ
    return pre;
  }

  /** nhát cuối của trận: chậm hẳn + khựng, gọi sau khi đã phát nhóm sự kiện chứa nhát đó */
  finalBlow() {
    this.later(this.curDelay + 0.02, () => {
      this.slowmo(0.22, 0.9);
      this.hitStop(HITSTOP.final);
      this.camKick = Math.max(this.camKick, 0.4);
    });
  }

  /** bỏ hết hiệu ứng thời gian/camera (khi bỏ qua trận) */
  resetFx() {
    this.cinePush = 0;
    this.camKick = 0;
    this.slowT = 0;
    this.freezeT = 0;
    this.shake = 0;
  }

  /* ------------------------------ PHÁT LẠI SỰ KIỆN ------------------------------ */
  private nm(uid: number): string {
    return this.views.get(uid)?.unit.init.name ?? '?';
  }

  handle(ev: BattleEvent, battle: Battle) {
    this.battle = battle;
    switch (ev.k) {
      case 'wave': {
        for (const uid of ev.units) {
          const u = battle.unit(uid);
          if (u && !this.views.has(uid)) this.addUnit(u, true);
        }
        this.curDelay = 0;
        this.hooks.wave(ev.n);
        this.groupHold = Math.max(this.groupHold, PACE.waveHold);
        break;
      }
      case 'act': {
        const v = this.views.get(ev.u);
        if (!v) break;
        const sk = skillOf(ev.s);
        const tgs = ev.tg.map((id) => this.views.get(id)).filter((x): x is UnitView => !!x);
        const col = ELEMENT_COLOR[v.element];
        const first = tgs[0];
        this.dmgIdx = 0;
        this.curUlt = sk.kind === 'ult';
        if (sk.kind !== 'basic') this.hooks.log?.(sk.kind === 'ult' ? `${v.unit.init.name} tung tuyệt kỹ ${sk.name}!` : `${v.unit.init.name} dùng ${sk.name}`, v.side);
        if (sk.kind !== 'basic' && !(sk.kind === 'ult' && this.cineActive)) this.hooks.skill?.(v.uid, sk.name, hex(col), sk.kind === 'ult');
        const ranged = v.role === 'mage' || v.role === 'archer' || sk.target === 'enemyAll' || sk.type !== 'dmg';
        if (sk.kind === 'ult') {
          this.cineActive = false;
          v.model.play('cast');
          this.ring(v.group.position, col, 2.4, 0.7);
          const custom = playUlt({
            host: this.fxHost, hero: v.key, from: v.group.position.clone(), height: v.model.height,
            targets: tgs.map((t) => t.group.position.clone()), color: col,
          });
          if (!custom) this.pillar(v.group.position, col, 0.8);
          this.shake = Math.max(this.shake, 0.25);
          this.hooks.flash(hex(col));
          this.hooks.sfx('ult');
          if (sk.type === 'dmg' && !custom) for (const t of tgs) this.projectile(this.chest(v).setY(2.4), this.chest(t), col, 0.4, 0.28);
          this.curDelay = PACE.ultHit;
          this.groupHold = Math.max(this.groupHold, PACE.ultHold);
          // nhả camera về sau khi chiêu trúng
          this.later(PACE.ultHit + 0.25, () => {
            const from = this.cinePush;
            this.tween(0.5, (k) => {
              this.cinePush = from * (1 - easeOut(k));
            });
          });
        } else if (sk.type === 'dmg' && !ranged && first) {
          const dir = first.home.clone().sub(v.home);
          const dist = dir.length();
          dir.normalize();
          const to = dir.multiplyScalar(Math.max(0, dist - 1.2));
          v.model.play('attack');
          // gồng lùi ra sau (anticipation) -> lao tới quá đà -> trượt về chỗ cũ
          const back = this.tmpA.copy(dir).multiplyScalar(-0.28).clone();
          const over = to.clone().multiplyScalar(1.04);
          this.tween(0.12, (k) => {
            v.offset.copy(back).multiplyScalar(easeOut(k));
            this.place(v);
          });
          this.later(0.12, () =>
            this.tween(0.08, (k) => {
              v.offset.lerpVectors(back, over, k * k);
              this.place(v);
            }),
          );
          this.later(0.3, () =>
            this.tween(0.24, (k) => {
              v.offset.copy(over).multiplyScalar(1 - easeOut(k));
              this.place(v);
            }),
          );
          this.curDelay = PACE.meleeHit;
          this.groupHold = Math.max(this.groupHold, PACE.meleeHold);
        } else if (sk.type === 'dmg') {
          v.model.play(v.role === 'archer' ? 'attack' : 'cast');
          const from = this.chest(v).setY(v.model.height * 0.8);
          for (const t of tgs) this.projectile(from, this.chest(t), col, 0.28);
          this.curDelay = PACE.rangedHit;
          this.groupHold = Math.max(this.groupHold, PACE.rangedHold);
        } else {
          v.model.play('cast');
          const good = sk.type === 'heal' ? 0x5ee08a : 0x7fd0ff;
          for (const t of tgs) this.later(0.35, () => this.ring(t.group.position, good, 1.3, 0.55));
          this.ring(v.group.position, good, 1.1, 0.5);
          this.curDelay = PACE.supportHit;
          this.groupHold = Math.max(this.groupHold, PACE.supportHold);
        }
        break;
      }
      case 'dmg': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        const idx = this.dmgIdx++;
        const ult = this.curUlt;
        // số sát thương lần lượt rơi lên từng mục tiêu
        const d = this.curDelay + idx * 0.07;
        this.groupHold = Math.max(this.groupHold, d + 0.25);
        this.later(d, () => {
          if (tg.gone) return;
          tg.hp = ev.hp;
          tg.model.play('hit');
          const att = this.views.get(ev.u);
          this.impact(att, tg, ev.n, ev.crit, ult, idx === 0);
          this.hooks.number(ev.tg, String(ev.n), ev.crit ? 'crit' : 'dmg', { adv: ev.adv });
          this.hooks.hp(ev.tg, ev.hp, tg.maxHp);
          this.hooks.sfx(ev.crit ? 'crit' : 'hit');
          this.hooks.log?.(
            `${att?.unit.init.name ?? '?'} gây ${ev.n} sát thương lên ${tg.unit.init.name}${ev.adv > 0 ? ' (khắc hệ)' : ev.adv < 0 ? ' (bị kháng)' : ''}${ev.crit ? ' · CHÍ MẠNG' : ''}`,
            att?.side ?? 0,
          );
        });
        break;
      }
      case 'heal': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        const idx = this.dmgIdx++;
        const d = this.curDelay + idx * 0.07;
        this.groupHold = Math.max(this.groupHold, d + 0.3);
        this.later(d, () => {
          if (tg.gone) return;
          tg.hp = ev.hp;
          const c = this.chestTo(tg, this.tmpB);
          const n = this.low ? 3 : 6;
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2;
            const r = 0.25 + rnd() * 0.35;
            this.pool.spawn(i % 2 ? 'plus' : 'spark', c.x + Math.cos(a) * r, c.y - 0.2 + rnd() * 0.3, c.z + Math.sin(a) * r, 0, 0.9 + rnd() * 0.8, 0, 0.4, 0.9, 0.3, 0.2, 0x7dffa8, 0, true);
          }
          this.pool.spawn('glow', c.x, c.y, c.z, 0, 0, 0, 0, 0.4, 0.5, tg.model.height * 1.5, 0x5ee08a, 0, true, 0.7);
          this.hooks.number(ev.tg, `+${ev.n}`, 'heal');
          this.hooks.hp(ev.tg, ev.hp, tg.maxHp);
          this.hooks.sfx('heal');
          this.hooks.log?.(`${this.nm(ev.u)} hồi ${ev.n} máu cho ${tg.unit.init.name}`, tg.side);
        });
        break;
      }
      case 'fx': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        this.later(this.curDelay + 0.05, () => {
          if (tg.gone) return;
          const l = EFFECT_LABEL[ev.type];
          this.hooks.number(ev.tg, l.text, 'text', { color: l.color });
          const c = this.chestTo(tg, this.tmpB);
          if (ev.type === 'shield') {
            tg.shieldOn = true;
            this.ring(tg.group.position, 0x7fe3ff, 1.4, 0.5);
          } else if (ev.type === 'stun') {
            tg.stunOn = true;
            this.pool.spawn('star', c.x, tg.model.height + 0.3, c.z, 0, 0.6, 0, 0, 0.5, 0.2, 0.9, 0xffd23f, 3, true);
          } else {
            // mũi tên lên (buff) / xuống (debuff) bằng tia sáng
            const up = ev.type !== 'defDown';
            const colr = ev.type === 'atkUp' ? 0xff9a3d : ev.type === 'defUp' ? 0x4aa3ff : ev.type === 'spdUp' ? 0x5ee08a : 0xc77dff;
            const k = this.low ? 2 : 4;
            for (let i = 0; i < k; i++) {
              const a = (i / k) * Math.PI * 2;
              this.pool.spawn('spark', c.x + Math.cos(a) * 0.4, c.y + (up ? -0.3 : 0.5), c.z + Math.sin(a) * 0.4, 0, up ? 1.5 : -1.5, 0, 0, 0.6, 0.3, 0.05, colr, 0, true);
            }
            this.ring(tg.group.position, colr, 1.1, 0.45);
          }
          this.hooks.log?.(`${tg.unit.init.name}: ${l.text.replace(/[+\-!]/g, '').trim()}`, tg.side);
        });
        this.groupHold = Math.max(this.groupHold, this.curDelay + 0.2);
        break;
      }
      case 'die': {
        const v = this.views.get(ev.u);
        if (!v) break;
        const d = this.curDelay + 0.05 + this.dmgIdx * 0.04;
        v.alive = false;
        this.groupHold = Math.max(this.groupHold, d + PACE.dieExtra);
        this.later(d, () => {
          if (v.gone) return;
          v.hp = 0;
          v.model.play('die');
          this.hooks.died(v.uid);
          v.shieldOn = v.stunOn = false;
          this.burst(this.chest(v), 0xffffff, this.q.particles, 1.4);
          // tan biến: loé trắng to + vòng + sao + hồn bay lên
          const h = Math.max(1, v.model.height * v.group.scale.y);
          const p = v.group.position;
          this.pool.spawn('glow', p.x, h * 0.5, p.z, 0, 0, 0, 0, 0.42, h * 0.8, h * (v.boss ? 3.4 : 2.6), 0xffffff, 0, true, 0.9);
          this.ring(p, 0xffffff, v.boss ? 3.4 : 2, 0.55);
          const ns = this.low ? 3 : 8;
          const palette = [0xffe14d, 0xffffff, 0xff9ad5, 0x7fd9ff];
          for (let i = 0; i < ns; i++) {
            const a = (i / ns) * Math.PI * 2 + rnd();
            this.pool.spawn('star', p.x, h * 0.5, p.z, Math.cos(a) * 2.2, 2 + rnd() * 2, Math.sin(a) * 2.2, -5.5, 0.9, 0.4, 0.1, palette[i % 4], 4, true);
          }
          this.pool.spawn('soul', p.x, h * 0.6, p.z, 0, 1.3, 0, 0.2, 1.4, 0.5, 0.95, 0xd8ecff, 0, false, 0.9);
          this.slowmo(0.4, 0.45);
          this.shake = Math.max(this.shake, v.boss ? 0.3 : 0.12);
          this.hooks.log?.(`${v.unit.init.name} gục ngã`, v.side);
          // đơn vị ngã rồi biến mất
          this.later(1.5, () => {
            if (v.side === 1) this.removeView(v);
            else v.group.visible = false;
          });
        });
        break;
      }
      case 'end': {
        this.hooks.banner?.(ev.win);
        this.later(0.2, () => {
          if (!ev.win) {
            for (const v of this.views.values()) if (v.side === 1 && v.alive) v.model.play('win');
            return;
          }
          const confetti = [0xff7fa0, 0xffe14d, 0x7fd9ff, 0x7be05a];
          let ci = 0;
          for (const v of this.views.values()) {
            if (v.side !== 0 || !v.alive) continue;
            v.model.play('win');
            this.burst(this.tmpB.copy(v.group.position).setY(v.model.height + 0.3), confetti[ci++ % 4], this.q.particles, 1.6);
          }
          // mưa giấy hoa từ trên xuống
          const n = this.low ? 14 : 34;
          for (let i = 0; i < n; i++) {
            this.later(i * 0.035, () => {
              this.pool.spawn('star', (rnd() - 0.5) * 8, 5.5, (rnd() - 0.5) * 4, (rnd() - 0.5) * 0.8, -1.2 - rnd(), 0, -0.6, 2.4, 0.3, 0.2, confetti[(rnd() * 4) | 0], 3 + rnd() * 3, false);
            });
          }
        });
        break;
      }
    }
  }

  /** chiếu đỉnh đầu đơn vị ra toạ độ pixel trong canvas (null nếu đã biến mất) */
  project(uid: number, lift = 0.25): { x: number; y: number } | null {
    const v = this.views.get(uid);
    if (!v || v.gone || !v.group.visible) return null;
    this.tmp.copy(v.group.position);
    this.tmp.y += v.model.height * v.group.scale.y + lift;
    this.tmp.project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * this.canvasW, y: (-this.tmp.y * 0.5 + 0.5) * this.canvasH };
  }

  /* ------------------------------ VÒNG LẶP ------------------------------ */
  /** phiên trận đánh đẩy logic theo dt thực mỗi khung; sdt = dt đã nhân tốc độ / slow-mo / hit-stop (đồng hồ trình diễn) */
  onTick: ((dt: number, sdt: number) => void) | null = null;

  /** hào quang đầy năng lượng, khiên, sao choáng — đọc trạng thái engine (chỉ đọc) */
  private updateView(v: UnitView, sdt: number, dt: number) {
    const u = v.unit;
    const vis = v.alive && v.group.visible;
    // aura đầy năng lượng
    const full = vis && u.energy >= ENERGY_MAX;
    if (full) {
      if (!v.aura) {
        const m = this.fxMat(v.side === 0 ? ELEMENT_COLOR[v.element] : 0xff5050, 0.6);
        m.blending = THREE.AdditiveBlending;
        v.aura = new THREE.Mesh(this.ringGeo, m);
        v.aura.position.y = 0.06;
        v.group.add(v.aura);
      }
      const base = v.boss ? 2.1 : 1.15;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      v.aura.visible = true;
      v.aura.scale.setScalar(base * (0.9 + 0.22 * pulse));
      (v.aura.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * pulse;
      v.auraT -= dt;
      if (v.auraT <= 0 && this.pool.active < 60) {
        v.auraT = this.low ? 0.55 : 0.26;
        const a = rnd() * Math.PI * 2;
        const r = base * 0.8;
        const p = v.group.position;
        this.pool.spawn('spark', p.x + Math.cos(a) * r, 0.1, p.z + Math.sin(a) * r, 0, 1.5 + rnd(), 0, 0.5, 0.7, 0.22, 0.04, v.side === 0 ? 0xffe27a : 0xff8a8a, 0, true, 0.9);
      }
    } else if (v.aura) v.aura.visible = false;
    // khiên: còn thì bong bóng còn (theo trạng thái engine)
    if (u.shield <= 0) v.shieldOn = false;
    const sh = vis && v.shieldOn;
    if (sh && !v.shieldMesh) {
      const m = this.fxMat(0x7fe3ff, 0.26);
      v.shieldMesh = new THREE.Mesh(this.sphereGeo, m);
      v.shieldMesh.position.y = v.model.height * 0.5;
      v.group.add(v.shieldMesh);
    }
    if (v.shieldMesh) {
      v.shieldMesh.visible = sh;
      if (sh) {
        const s = 0.85 * v.model.height * (1 + 0.04 * Math.sin(this.time * 5));
        v.shieldMesh.scale.setScalar(s);
        (v.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.08 * Math.sin(this.time * 5);
      }
    }
    // choáng: sao quay quanh đầu
    if (this.battle && !this.battle.stunned(u)) v.stunOn = false;
    const st = vis && v.stunOn;
    if (st && !v.stunGroup) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex('star'), color: 0xffd23f, transparent: true, depthWrite: false }));
        const a = (i / 3) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
        sp.scale.setScalar(0.3);
        g.add(sp);
      }
      g.position.y = v.model.height + 0.12;
      v.group.add(g);
      v.stunGroup = g;
    }
    if (v.stunGroup) {
      v.stunGroup.visible = st;
      if (st) {
        v.stunGroup.rotation.y += 4.5 * sdt;
        v.stunGroup.position.y = v.model.height + 0.12 + 0.04 * Math.sin(this.time * 7);
      }
    }
  }

  update(dt: number, t: number) {
    this.time = t;
    // đồng hồ trình diễn: hit-stop đóng băng, slow-mo giảm tốc
    let k = this.timeScale;
    if (this.slowT > 0) {
      this.slowT -= dt;
      k *= this.slowK;
    }
    let sdt = dt * k;
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      sdt = 0;
    }
    this.onTick?.(dt, sdt);
    for (let i = this.laters.length - 1; i >= 0; i--) {
      const l = this.laters[i];
      l.t -= sdt;
      if (l.t <= 0) {
        this.laters.splice(i, 1);
        l.fn();
      }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const w = this.tweens[i];
      w.t += sdt;
      const kk = Math.min(1, w.t / w.dur);
      w.fn(kk);
      if (kk >= 1) {
        this.tweens.splice(i, 1);
        w.done?.();
      }
    }
    for (const v of this.views.values()) {
      if (v.gone) continue;
      v.model.update(sdt);
      this.updateView(v, sdt, dt);
    }
    this.pool.update(sdt);
    this.updateCamera(dt);
  }

  /** camera: đẩy vào / zoom nhẹ khi crit / nghiêng khi cinematic / rung; chỉ ghi khi đang có hiệu ứng */
  private updateCamera(dt: number) {
    this.camKick = Math.max(0, this.camKick - dt * 1.4);
    let sh = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.9);
      sh = this.shake * 0.45;
    }
    const p = Math.min(1, this.cinePush + this.camKick);
    const roll = this.cinePush * 0.05 * this.cineDir;
    if (p < 0.002 && sh <= 0 && Math.abs(roll) < 1e-4) {
      if (this.camDirty) {
        this.camDirty = false;
        this.fitCamera();
      }
      return;
    }
    this.camDirty = true;
    const cam = this.camera;
    cam.position.lerpVectors(this.camBase, this.camFocus, p * 0.28);
    this.camLook.lerpVectors(this.camTarget, this.camFocus, p * 0.55);
    if (sh > 0) {
      cam.position.x += (rnd() - 0.5) * sh;
      cam.position.y += (rnd() - 0.5) * sh;
    }
    cam.lookAt(this.camLook);
    if (roll) cam.rotateZ(roll);
  }

  /** HUD cập nhật vị trí theo camera đang vẽ (kể cả rung / đẩy vào) */
  afterRender() {
    this.hooks.frame?.();
  }

  /** còn hiệu ứng đang chạy (dùng khi kết thúc) */
  get busy(): boolean {
    return this.tweens.length > 0 || this.laters.length > 0;
  }

  dispose() {
    this.tweens.length = 0;
    this.laters.length = 0;
    for (const v of this.views.values()) {
      if (!v.gone) v.model.dispose();
      this.disposeExtras(v);
    }
    this.views.clear();
    this.pool.dispose();
    disposeFxTextures();
    for (const o of this.owned) o.dispose();
  }
}
