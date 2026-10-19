// Cảnh 3D của trận đánh: camera nghiêng cố định, hai phe đối mặt, camera tự lùi theo tỉ lệ màn hình.
// Cảnh CHỈ phát lại BattleEvent do engine dùng chung xuất ra (act/dmg/heal/fx/die/wave/end).
// Phần "trình diễn" (hit-stop, slow-mo, rung, zoom, cinematic tuyệt kỹ, hạt) chỉ là hình ảnh — không đụng kết quả tính toán.
import * as THREE from 'three';
import { FRONT_SLOTS } from '@shared/heroes/config';
import { ENERGY_MAX, type Battle, type BattleEvent, type Unit } from '@shared/heroes/battle';
import { skillOf } from '@shared/heroes/skills';
import type { EffectType, Element, Role } from '@shared/heroes/types';
import type { Sfx } from '../audio';
import { HITSTOP, MOTION } from '../battle/pacing';
import { FxPool, ProjPool, disposeFxTextures, fxTex, type ProjKind } from './fx-pool';
import { createHeroModel, type HeroModel } from './hero-model';
import { brightLights, makeBlob, type LiveScene } from './live';
import { currentPreset, type QualityState } from './quality';
import { playUlt, type FxHost } from './ult-fx';
import type { MoveHook } from './procedural-model';

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
  sfx(k: Sfx): void;
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
  /** ô xuất phát (đội hình) — chỉ để xếp hàng đầu trận / đầu đợt, KHÔNG phải nơi quay về */
  home: THREE.Vector3;
  /** vị trí thật trên sân (xz) — di chuyển liên tục theo mục tiêu */
  pos: THREE.Vector3;
  /** vận tốc di chuyển (xz) */
  vx: number;
  vz: number;
  /** giật lùi lò xo (trúng đòn / hồi tay khi bắn / lao tới chém): vị trí + vận tốc */
  rx: number;
  rz: number;
  rvx: number;
  rvz: number;
  /** độ trượt vào cảnh (hiệu ứng xuất hiện) */
  kick: THREE.Vector3;
  /** uid mục tiêu hiện tại (-1 = chưa có, tự chọn địch gần nhất) */
  tgt: number;
  melee: boolean;
  /** đứng sau tiền tuyến (hồi máu / hỗ trợ) */
  hold: boolean;
  range: number;
  sepR: number;
  phase: number;
  /** giây cảnh còn đứng yên để vung/bắn, tăng tốc đuổi kịp, lướt về hàng khi sang đợt */
  actLock: number;
  boost: number;
  homeT: number;
  moved: boolean;
  yaw: number;
  /** khựng cục bộ khi trúng đòn (giây THẬT) */
  freeze: number;
  moveSent: number;
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

  private q: QualityState = currentPreset();
  private low = this.q.level === 'low';
  private pool: FxPool;
  private battle: Battle | null = null;
  private tweens: Tw[] = [];
  private laters: Later[] = [];
  private curDelay = 0;
  private curStag: number = MOTION.aoeStagger;
  private curUlt = false;
  private dmgIdx = 0;
  private lastT = -1;
  private fightOver = false;
  private bx = 4.4;
  private bz = 2.5;
  private pj: ProjPool;
  private leanAxis = new THREE.Vector3();
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
    this.pool = new FxPool(this.scene, this.q.level === 'high' ? 180 : this.q.level === 'medium' ? 120 : 60);
    // đạn bay + đuôi sáng: máy yếu bớt số viên, bỏ đuôi
    this.pj = new ProjPool(this.scene, this.q.level === 'low' ? 14 : 28, this.pool, this.q.level === 'high' ? 0.028 : this.q.level === 'medium' ? 0.05 : 0);
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
    v.group.position.set(v.pos.x + v.kick.x + v.rx, v.kick.y, v.pos.z + v.kick.z + v.rz);
  }
  private applyLayout() {
    if (this.layout === 'h') {
      this.bx = 4.4 * this.spread();
      this.bz = 2.5;
    } else {
      this.bx = 2.6;
      this.bz = 3.7;
    }
    for (const v of this.views.values()) {
      v.home.copy(this.homeOf(v.side, v.slot));
      if (!v.moved) v.pos.copy(v.home);
      v.yaw = this.faceOf(v.side);
      v.model.object3d.rotation.y = v.yaw;
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
      unit: u, group, model, blob, home: this.homeOf(init.side, init.slot), pos: new THREE.Vector3(), vx: 0, vz: 0,
      rx: 0, rz: 0, rvx: 0, rvz: 0, kick: new THREE.Vector3(), tgt: -1,
      melee: init.role === 'warrior' || init.role === 'tank',
      hold: init.role === 'healer' || init.role === 'support',
      range: 0, sepR: init.boss ? MOTION.sepBoss : MOTION.sepRadius, phase: rnd() * 6.28,
      actLock: 0, boost: 0, homeT: 0, moved: false, yaw: this.faceOf(init.side), freeze: 0, moveSent: 0,
      hp: u.hp, maxHp: u.maxHp, alive: true, gone: false,
      aura: null, auraT: 0, shieldMesh: null, shieldOn: false, stunGroup: null, stunOn: false,
    };
    v.pos.copy(v.home);
    v.range = v.melee ? (init.boss ? MOTION.rangeBossMelee : MOTION.rangeMelee) : init.role === 'archer' ? MOTION.rangeArcher : init.role === 'mage' ? MOTION.rangeMage : MOTION.rangeSupport;
    model.object3d.rotation.y = v.yaw;
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
  /** bắn đạn từ hồ dựng sẵn (không tạo mesh/vật liệu mới) */
  private shoot(kind: ProjKind, a: THREE.Vector3, b: THREE.Vector3, color: number, dur: number, arc = 0.3, size = 1) {
    this.pj.fire(kind, a.x, a.y, a.z, b.x, b.y, b.z, color, dur, arc, size);
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
  private impact(att: UnitView | undefined, tg: UnitView, n: number, crit: boolean, ult: boolean) {
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
      P.spawn('spark', c.x, c.y, c.z, Math.cos(a) * sp, 0.8 + rnd() * 2, Math.sin(a) * sp, -6, 0.38, 0.34, 0.06, 0xffffff, 0, true, 1, 0, col);
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
    // hit-stop CỤC BỘ: chỉ đơn vị bị trúng khựng một thoáng (không bao giờ dừng cả sim)
    tg.freeze = Math.max(tg.freeze, ult ? HITSTOP.ult : crit ? HITSTOP.crit : HITSTOP.normal);
    // rung màn hình theo lượng sát thương (nhẹ hơn vì đòn đánh dồn dập)
    const sh = Math.min(ult ? 0.3 : 0.12, 0.02 + ratio * 0.45 + (crit ? 0.05 : 0));
    this.shake = Math.max(this.shake, sh);
    if (crit) {
      this.camKick = Math.max(this.camKick, this.low ? 0.1 : 0.2);
      this.camFocus.copy(c);
    }
    // bị hất lùi khỏi người đánh (lò xo, cộng dồn được khi bị đánh liên tiếp)
    if (att && att !== tg) {
      let dx = tg.pos.x - att.pos.x;
      let dz = tg.pos.z - att.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        dx /= l;
        dz /= l;
        const amt = Math.min(0.5, 0.08 + ratio * 1.1) * (crit ? 1.4 : 1) * (ult ? 1.3 : 1) * 14;
        tg.rvx += dx * amt;
        tg.rvz += dz * amt;
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

  /* ------------------------------ CẮT CẢNH TUYỆT KỸ (nhẹ, KHÔNG chặn sim) ------------------------------ */
  /** banner nhỏ + chân dung + tên chiêu (DOM, ≤ cutInReal giây thật) và nhích camera nhẹ; sim vẫn chạy bình thường */
  private cutIn(v: UnitView, name: string, boss: boolean) {
    const col = ELEMENT_COLOR[v.element];
    this.hooks.cinematic?.({
      uid: v.uid, key: v.key, name, color: hex(col), boss, side: v.side, dur: MOTION.cutInReal, low: this.low,
    });
    this.chestTo(v, this.camFocus);
    const peak = boss ? MOTION.camNudge * 0.6 : MOTION.camNudge;
    this.tween(0.18, (k) => {
      this.cinePush = Math.max(this.cinePush, peak * easeOut(k));
    });
    this.later(0.28, () => {
      const from = this.cinePush;
      this.tween(0.35, (k) => {
        this.cinePush = from * (1 - easeOut(k));
      });
    });
  }

  /** nhát cuối của trận: chậm hẳn + khựng — engine đã xong nên chỉ là hình ảnh */
  finalBlow() {
    this.later(this.curDelay + 0.02, () => {
      this.slowmo(0.25, 0.8);
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

  /** quay mặt về phía điểm (x,z) ngay từ lúc ra đòn */
  private faceToward(v: UnitView, x: number, z: number) {
    const dx = x - v.pos.x;
    const dz = z - v.pos.z;
    if (dx * dx + dz * dz > 1e-4) v.yaw = Math.atan2(dx, dz);
  }

  /** xung giật lò xo theo hướng (dx,dz), độ mạnh `amt` (đơn vị vận tốc) */
  private impulse(v: UnitView, dx: number, dz: number, amt: number) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return;
    v.rvx += (dx / l) * amt;
    v.rvz += (dz / l) * amt;
  }

  /** thời gian bay của đạn theo khoảng cách (giây cảnh) */
  private flight(a: UnitView, b: UnitView): number {
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    return Math.min(MOTION.flightMax, Math.max(MOTION.flightMin, d / MOTION.flightSpeed));
  }

  handle(ev: BattleEvent, battle: Battle) {
    this.battle = battle;
    // sự kiện cùng một tick dùng chung độ trễ gốc; sang tick mới thì đặt lại (không giữ nhịp cũ)
    if (ev.t !== this.lastT) {
      this.lastT = ev.t;
      this.curDelay = 0;
      this.dmgIdx = 0;
    }
    switch (ev.k) {
      case 'wave': {
        for (const uid of ev.units) {
          const u = battle.unit(uid);
          if (u && !this.views.has(uid)) this.addUnit(u, true);
        }
        // tướng ta lướt về hàng xuất phát; địch chạy vào từ phía họ (hiệu ứng xuất hiện trong addUnit)
        for (const v of this.views.values()) {
          if (v.gone) continue;
          v.tgt = -1;
          if (v.alive && v.side === 0) v.homeT = MOTION.regroup;
        }
        this.curDelay = 0;
        this.hooks.wave(ev.n);
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
        this.curStag = this.curUlt ? 0.07 : MOTION.aoeStagger;
        // mục tiêu hiện tại của người ra đòn = mục tiêu engine chọn (chỉ để biết ai đánh ai)
        if (first && first.side !== v.side) {
          v.tgt = first.uid;
          this.faceToward(v, first.pos.x, first.pos.z);
        }
        if (sk.kind !== 'basic') this.hooks.log?.(sk.kind === 'ult' ? `${v.unit.init.name} tung tuyệt kỹ ${sk.name}!` : `${v.unit.init.name} dùng ${sk.name}`, v.side);
        if (sk.kind === 'ult') this.cutIn(v, sk.name, v.side === 1 && v.key.startsWith('mk_'));
        else if (sk.kind !== 'basic') this.hooks.skill?.(v.uid, sk.name, hex(col), false);
        const aoe = sk.target === 'enemyAll';
        const enemyFirst = first && first.side !== v.side ? first : undefined;
        const fdx = enemyFirst ? enemyFirst.pos.x - v.pos.x : 0;
        const fdz = enemyFirst ? enemyFirst.pos.z - v.pos.z : 0;
        v.actLock = MOTION.actLock;
        if (sk.kind === 'ult') {
          v.model.play('cast');
          this.ring(v.group.position, col, 2.4, 0.7);
          const custom = playUlt({
            host: this.fxHost, hero: v.key, from: v.group.position.clone(), height: v.model.height,
            targets: tgs.map((t) => t.group.position.clone()), color: col,
          });
          if (!custom) this.pillar(v.group.position, col, 0.8);
          this.shake = Math.max(this.shake, 0.22);
          this.hooks.flash(hex(col));
          this.hooks.sfx('ult');
          this.later(MOTION.ultHit, () => this.hooks.sfx('ultBoom'));
          if (sk.type === 'dmg' && !custom) for (const t of tgs) this.shoot('orb', this.chest(v).setY(2.4), this.chest(t), col, 0.4, 0.3, 1.5);
          this.curDelay = MOTION.ultHit;
        } else if (sk.type === 'dmg' && v.melee && !aoe && enemyFirst) {
          // cận chiến: đứng ngay trước mục tiêu (do di chuyển lo), vung chém + lao nhẹ tới + vệt chém tại thời điểm trúng
          const dist = Math.hypot(fdx, fdz);
          v.model.play('attack');
          this.impulse(v, fdx, fdz, 3.2);
          if (dist > v.range + 0.5) v.boost = MOTION.catchUp;
          this.curDelay = MOTION.meleeHit;
          const tg = enemyFirst;
          this.later(MOTION.meleeHit - 0.02, () => {
            if (v.gone || tg.gone) return;
            const a = this.chestTo(v, this.tmpA);
            const b = this.chestTo(tg, this.tmpB);
            const mx = (a.x + b.x) / 2;
            const mz = (a.z + b.z) / 2;
            const sz = v.boss ? 2.4 : 1.7;
            this.pool.spawn('slash', mx, a.y + 0.1, mz, 0, 0, 0, 0, 0.2, sz * 0.8, sz * 1.5, col, 0, true, 0.9, -0.6 + rnd() * 1.2);
            if (!this.low) this.pool.spawn('slash', mx, a.y - 0.05, mz, 0, 0, 0, 0, 0.16, sz * 0.6, sz * 1.2, 0xffffff, 0, true, 0.8, 0.6 + rnd() * 0.8);
          });
        } else if (sk.type === 'dmg' && v.melee) {
          // cận chiến diện rộng: sóng xung kích lan ra phía địch
          v.model.play('attack');
          this.ring(v.group.position, col, 2.6, 0.4);
          for (let i = 0; i < tgs.length; i++) {
            const t = tgs[i];
            this.later(0.18 + i * MOTION.aoeStagger, () => this.ring(t.group.position, col, 1.3, 0.35));
          }
          this.curDelay = 0.24;
        } else if (sk.type === 'dmg') {
          // tầm xa: đứng yên bắn, hồi tay nhẹ; đạn bay rồi mới trúng
          const role = v.role;
          const kind: ProjKind = role === 'archer' ? 'arrow' : role === 'support' ? 'note' : 'orb';
          const rel = role === 'archer' ? MOTION.releaseArcher : role === 'mage' ? MOTION.releaseMage : MOTION.releaseSupport;
          v.model.play(role === 'archer' ? 'attack' : 'cast');
          if (enemyFirst) this.impulse(v, -fdx, -fdz, 1.8);
          const fl = enemyFirst ? this.flight(v, enemyFirst) : MOTION.flightMin;
          const size = sk.kind === 'active' ? 1.35 : 1;
          if (aoe) {
            // mưa đạn rơi xuống từng mục tiêu của cả phe địch
            const fall = 0.3;
            for (let i = 0; i < tgs.length; i++) {
              const t = tgs[i];
              this.later(rel + i * this.curStag, () => {
                if (t.gone) return;
                const b = this.chestTo(t, this.tmpB);
                this.pj.fire(kind, b.x + (rnd() - 0.5) * 0.8, 4.8, b.z + (rnd() - 0.5) * 0.8, b.x, b.y, b.z, col, fall, 0, size);
              });
            }
            this.curDelay = rel + fall;
          } else {
            for (const t of tgs) {
              this.later(rel, () => {
                if (v.gone || t.gone) return;
                const a = this.chestTo(v, this.tmpA).setY(v.model.height * 0.75);
                const b = this.chestTo(t, this.tmpB);
                this.shoot(kind, a, b, col, fl, kind === 'arrow' ? 0.35 : 0.2, size);
              });
            }
            this.curDelay = rel + fl;
          }
        } else {
          // hồi máu / buff: cầu xanh (hồi) hoặc sao (buff) bay tới đồng đội, rồi vòng sáng tại chỗ
          const good = sk.type === 'heal' ? 0x5ee08a : 0x7fd0ff;
          v.model.play('cast');
          this.ring(v.group.position, good, 1.1, 0.5);
          let fl: number = MOTION.flightMin;
          let other = false;
          for (const t of tgs) {
            if (t === v) continue;
            other = true;
            fl = Math.max(fl, this.flight(v, t));
          }
          const rel = MOTION.releaseSupport;
          for (let i = 0; i < tgs.length; i++) {
            const t = tgs[i];
            if (t !== v) {
              this.later(rel + i * this.curStag, () => {
                if (v.gone || t.gone) return;
                const a = this.chestTo(v, this.tmpA).setY(v.model.height * 0.75);
                this.shoot(sk.type === 'heal' ? 'heal' : 'note', a, this.chestTo(t, this.tmpB), good, fl, 0.5, 1.1);
              });
            }
            this.later(rel + (t !== v ? fl : 0) + i * this.curStag, () => {
              if (!t.gone) this.ring(t.group.position, good, 1.3, 0.55);
            });
          }
          this.curDelay = rel + (other ? fl : 0);
        }
        break;
      }
      case 'dmg': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        const idx = this.dmgIdx++;
        const ult = this.curUlt;
        // đòn trúng đúng lúc đòn đánh/đạn tới nơi; nhiều mục tiêu thì lần lượt
        const d = this.curDelay + idx * this.curStag;
        this.later(d, () => {
          if (tg.gone) return;
          tg.hp = ev.hp;
          tg.model.play('hit');
          const att = this.views.get(ev.u);
          this.impact(att, tg, ev.n, ev.crit, ult);
          this.hooks.number(ev.tg, String(ev.n), ev.crit ? 'crit' : 'dmg', { adv: ev.adv });
          this.hooks.hp(ev.tg, ev.hp, tg.maxHp);
          // tiếng đánh theo mức: bị kháng = trầm, chí mạng, nặng (>=22% máu tối đa hoặc tuyệt kỹ), nhẹ
          this.hooks.sfx(ev.crit ? 'crit' : ev.adv < 0 ? 'miss' : ult || ev.n >= tg.maxHp * 0.22 ? 'heavy' : 'hit');
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
        const d = this.curDelay + idx * this.curStag;
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
          this.hooks.sfx(ev.type === 'shield' ? 'shield' : ev.type === 'stun' ? 'stun' : ev.type === 'defDown' ? 'miss' : 'heal');
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
        break;
      }
      case 'die': {
        const v = this.views.get(ev.u);
        if (!v) break;
        const d = this.curDelay + Math.max(0, this.dmgIdx - 1) * this.curStag + 0.03;
        v.alive = false;
        v.vx = v.vz = 0;
        this.later(d, () => {
          if (v.gone) return;
          v.hp = 0;
          v.model.play('die');
          this.hooks.died(v.uid);
          this.hooks.sfx('death');
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
          if (v.boss) this.slowmo(0.5, 0.4);
          this.shake = Math.max(this.shake, v.boss ? 0.3 : 0.1);
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
        this.fightOver = true;
        // chờ đòn cuối tới nơi rồi mới hiện banner / ăn mừng
        const wait = this.curDelay + 0.3;
        this.later(wait, () => this.hooks.banner?.(ev.win));
        this.later(wait + 0.2, () => {
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

  /* ------------------------------ DI CHUYỂN (thuần hình ảnh) ------------------------------ */
  /** địch sống gần nhất (khi chưa có mục tiêu từ engine) — không cấp phát */
  private nearestFoe(v: UnitView): UnitView | undefined {
    let best: UnitView | undefined;
    let bd = 1e9;
    for (const o of this.views.values()) {
      if (o.gone || !o.alive || o.side === v.side) continue;
      const dx = o.pos.x - v.pos.x;
      const dz = o.pos.z - v.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * Chuyển động mỗi khung của một đơn vị: tiến tới mục tiêu hiện tại, dừng ở tầm đánh, KHÔNG quay về ô xuất phát.
   * - cận chiến: đứng sát mục tiêu (lệch làn theo ô để không chồng nhau), đuổi theo khi mục tiêu đổi/chết;
   * - tầm xa: chỉ nhích tới/lui vừa đủ để nằm trong tầm, không rời hàng sau quá `rangedAdvance`;
   * - hồi máu/hỗ trợ: không vượt qua tiền tuyến cận chiến của phe mình;
   * - tách nhau (separation) + kéo nhẹ về làn ngang để đội hình vẫn đọc được.
   * Vị trí chỉ để vẽ — engine chọn ai đánh ai.
   */
  private moveUnit(v: UnitView, dt: number) {
    if (dt <= 0) return;
    const mh = v.model as unknown as Partial<MoveHook>;
    // lò xo giật lùi (bán ẩn: ổn định với dt ≤ 0.06)
    v.rvx += (-v.rx * 90 - v.rvx * 16) * dt;
    v.rvz += (-v.rz * 90 - v.rvz * 16) * dt;
    v.rx += v.rvx * dt;
    v.rz += v.rvz * dt;
    if (!v.alive) {
      mh.setMove?.(0);
      this.place(v);
      return;
    }
    const bt = this.battle;
    const stunned = !!bt && bt.stunned(v.unit);
    if (v.actLock > 0) v.actLock -= dt;
    if (v.boost > 0) v.boost -= dt;
    const h = this.layout === 'h';
    const fx = h ? (v.side === 0 ? 1 : -1) : 0;
    const fz = h ? 0 : v.side === 0 ? -1 : 1;
    const RUN = MOTION.runSpeed;

    let tg = v.tgt >= 0 ? this.views.get(v.tgt) : undefined;
    if (!tg || !tg.alive || tg.gone || tg.side === v.side) {
      tg = this.nearestFoe(v);
      v.tgt = tg ? tg.uid : -1;
    }

    let dvx = 0;
    let dvz = 0;
    let tdx = 0;
    let tdz = 0;
    let hasT = false;
    if (tg) {
      tdx = tg.pos.x - v.pos.x;
      tdz = tg.pos.z - v.pos.z;
      hasT = true;
    }
    if (this.fightOver || stunned) {
      /* đứng yên */
    } else if (v.homeT > 0) {
      // sang đợt: lướt về hàng xuất phát
      v.homeT -= dt;
      const ex = v.home.x - v.pos.x;
      const ez = v.home.z - v.pos.z;
      const d = Math.hypot(ex, ez);
      if (d > 0.05) {
        const s = Math.min(RUN * 1.2, d * 4);
        dvx = (ex / d) * s;
        dvz = (ez / d) * s;
      }
    } else if (hasT) {
      const dist = Math.hypot(tdx, tdz) || 1e-3;
      const nx = tdx / dist;
      const nz = tdz / dist;
      if (dist > v.range + 0.12) {
        const lane = v.melee ? ((v.slot % 3) - 1) * 0.35 : 0;
        const ex = tg!.pos.x - nx * v.range - nz * lane - v.pos.x;
        const ez = tg!.pos.z - nz * v.range + nx * lane - v.pos.z;
        const ed = Math.hypot(ex, ez) || 1e-3;
        const s = Math.min(RUN * (v.boost > 0 ? MOTION.catchUpMul : 1), ed * 3.5 + 0.35);
        dvx = (ex / ed) * s;
        dvz = (ez / ed) * s;
      } else if (!v.melee && dist < v.range * MOTION.tooClose) {
        dvx = -nx * MOTION.backSpeed;
        dvz = -nz * MOTION.backSpeed;
      } else {
        // đứng trong tầm: lượn nhẹ quanh mục tiêu cho đỡ cứng
        const s = Math.sin(this.time * 1.3 + v.phase) * 0.3;
        dvx = -nz * s;
        dvz = nx * s;
      }
      if (v.actLock > 0 && v.boost <= 0) {
        dvx *= 0.15;
        dvz *= 0.15;
      }
      if (!v.melee) {
        // giữ hàng sau: không tiến quá xa khỏi ô xuất phát
        const adv = (v.pos.x - v.home.x) * fx + (v.pos.z - v.home.z) * fz;
        const fwd = dvx * fx + dvz * fz;
        if (adv > MOTION.rangedAdvance) {
          if (fwd > 0) {
            dvx -= fx * fwd;
            dvz -= fz * fwd;
          }
          dvx -= fx * (adv - MOTION.rangedAdvance) * 2;
          dvz -= fz * (adv - MOTION.rangedAdvance) * 2;
        }
        if (v.hold) {
          // hồi máu / hỗ trợ đứng sau tiền tuyến cận chiến
          let front = -1e9;
          for (const o of this.views.values()) {
            if (o.gone || !o.alive || o.side !== v.side || !o.melee) continue;
            const f = o.pos.x * fx + o.pos.z * fz;
            if (f > front) front = f;
          }
          if (front > -1e8) {
            const over = v.pos.x * fx + v.pos.z * fz - (front - 0.9);
            const fw = dvx * fx + dvz * fz;
            if (over > 0) {
              if (fw > 0) {
                dvx -= fx * fw;
                dvz -= fz * fw;
              }
              dvx -= fx * over * 2;
              dvz -= fz * over * 2;
            }
          }
        }
      }
      // giữ làn ngang để đội hình còn đọc được
      const lat = (v.pos.x - v.home.x) * -fz + (v.pos.z - v.home.z) * fx;
      const kl = MOTION.laneKeep * (v.melee ? 0.35 : 1);
      dvx -= -fz * lat * kl;
      dvz -= fx * lat * kl;
    }

    // tách nhau
    if (!stunned) {
      for (const o of this.views.values()) {
        if (o === v || o.gone || !o.alive) continue;
        let dx = v.pos.x - o.pos.x;
        let dz = v.pos.z - o.pos.z;
        const r = (v.sepR + o.sepR) * 0.5;
        let d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          dx = Math.cos(v.phase);
          dz = Math.sin(v.phase);
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = ((r - d) / r) * MOTION.sepForce;
        dvx += (dx / d) * f;
        dvz += (dz / d) * f;
      }
    }

    const a = Math.min(1, MOTION.accel * dt);
    v.vx += (dvx - v.vx) * a;
    v.vz += (dvz - v.vz) * a;
    v.pos.x = Math.max(-this.bx, Math.min(this.bx, v.pos.x + v.vx * dt));
    v.pos.z = Math.max(-this.bz, Math.min(this.bz, v.pos.z + v.vz * dt));
    const sp = Math.hypot(v.vx, v.vz);
    if (sp > 0.05) v.moved = true;
    const mk = Math.min(1, sp / RUN);
    mh.setMove?.(mk > 0.12 ? mk : 0);

    // luôn xoay về mục tiêu hiện tại (không có thì theo hướng đi, rồi mới về hướng mặc định của phe)
    let want: number;
    if (hasT) want = Math.atan2(tdx, tdz);
    else if (sp > 0.3) want = Math.atan2(v.vx, v.vz);
    else want = this.faceOf(v.side);
    let df = want - v.yaw;
    df = ((((df + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const step = MOTION.turn * dt;
    v.yaw += Math.max(-step, Math.min(step, df));
    v.model.object3d.rotation.y = v.yaw;

    // nghiêng người về hướng chạy
    if (sp > 0.3) this.leanAxis.set(v.vz / sp, 0, -v.vx / sp);
    else this.leanAxis.set(1, 0, 0);
    v.group.quaternion.setFromAxisAngle(this.leanAxis, sp > 0.3 ? MOTION.lean * mk : 0);

    this.place(v);
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
    // sim chạy theo đồng hồ THẬT × tốc độ (không dính hit-stop / slow-mo hình ảnh)
    this.onTick?.(dt, dt * this.timeScale);
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
      // hit-stop cục bộ: chỉ đơn vị vừa bị trúng khựng ≤ vài chục ms
      let vs = sdt;
      if (v.freeze > 0) {
        v.freeze -= dt;
        vs = 0;
      }
      this.moveUnit(v, Math.min(vs, 0.06));
      v.model.update(vs);
      this.updateView(v, sdt, dt);
    }
    this.pj.update(sdt);
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
    this.pj.dispose();
    this.pool.dispose();
    disposeFxTextures();
    for (const o of this.owned) o.dispose();
  }
}
