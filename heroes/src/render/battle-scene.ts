// Cảnh 3D của trận đánh: sảnh đá, hai phe đối mặt TRÁI - PHẢI ở mọi tỉ lệ màn hình, đội hình KHÓA LÀN (không đuổi/lượn).
// Cảnh CHỈ phát lại BattleEvent do engine dùng chung xuất ra (act/dmg/heal/fx/die/wave/end).
// Phần "trình diễn" (hit-stop, slow-mo, rung, zoom, cinematic tuyệt kỹ, hạt) chỉ là hình ảnh — không đụng kết quả tính toán.
import * as THREE from 'three';
import { rowOfSlot } from '@shared/heroes/config';
import { ARENA_LEN } from '@shared/heroes/combat';
import { ENERGY_MAX, type Battle, type BattleEvent, type Unit } from '@shared/heroes/battle';
import { skillOf } from '@shared/heroes/skills';
import type { EffectType, Element, Role } from '@shared/heroes/types';
import type { Sfx } from '../audio';
import { HITSTOP, MOTION } from '../battle/pacing';
import { buildArena, type ArenaEnv } from './arena-env';
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

/** số sát thương rút gọn kiểu game: 163K, 1.2M */
export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

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
  /** biển tên kỹ năng: MỖI PHE chỉ một biển nhỏ ở đầu đội hình (không còn chữ trên đầu từng đơn vị) */
  skill?(uid: number, name: string, color: string, ult: boolean): void;
  /** dòng chạy tên kỹ năng phía trên thẻ tướng */
  ticker?(who: string, skill: string, side: 0 | 1, ult: boolean, color: string): void;
  /** bảng sát thương: `src` gây `n` lên `dst` (đúng lúc đòn trúng) */
  meter?(src: number, dst: number, n: number): void;
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
  /** ô đội hình theo slot — luôn là làn (z) của đơn vị */
  home: THREE.Vector3;
  /** vị trí nền hiện tại (xz): x bám mượt theo x của engine (tx), z = làn cố định */
  pos: THREE.Vector3;
  /** x thế giới đích (đọc thẳng unit.x của engine mỗi khung) */
  tx: number;
  /** độ lệch z do tách mềm (hiện tại / đích) — chỉ hình ảnh */
  sz: number;
  szT: number;
  /** đếm giờ nhả bụi dưới chân khi chạy */
  dustT: number;
  /** độ lệch lao đòn cộng thêm vào pos (đã nhân profile) */
  ox: number;
  oz: number;
  /** giật lùi lò xo (trúng đòn / hồi tay khi bắn): vị trí + vận tốc */
  rx: number;
  rz: number;
  rvx: number;
  rvz: number;
  /** độ trượt vào cảnh (hiệu ứng xuất hiện) */
  kick: THREE.Vector3;
  melee: boolean;
  /** lao đòn: thời gian đã trôi (-1 = không), tổng thời lượng, vector tới 'trước mặt mục tiêu' */
  lt: number;
  ld: number;
  lax: number;
  laz: number;
  /** hướng mặt khi vừa ra đòn (rad) + giây còn giữ */
  face: number;
  faceT: number;
  yaw: number;
  /** khựng cục bộ khi trúng đòn (giây THẬT) */
  freeze: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  gone: boolean;
  leaned: boolean;
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

/**
 * TỈ LỆ THẾ GIỚI: trục engine [0, ARENA_LEN=12000] -> x thế giới [-5, +5] (1 đơn vị thế giới = 1200 đơn vị engine).
 * Phe ta bên TRÁI. Đường xuất phát: hàng trước ±2.0, hàng giữa ±2.75, hàng sau ±3.5; tầm cận chiến 900 ≈ 0.75, tầm xa 4200 ≈ 3.5.
 */
export const WORLD_HALF = 5;
export const worldX = (x: number): number => (x / ARENA_LEN - 0.5) * 2 * WORLD_HALF;

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const rnd = Math.random;

/** hình dạng lao đòn: ra nhanh (ease out) → giữ lúc trúng → về chỗ (ease in-out) */
const lungeProfile = (k: number): number => {
  if (k <= 0) return 0;
  if (k < 0.4) return easeOut(k / 0.4);
  if (k < 0.55) return 1;
  if (k < 1) {
    const q = (k - 0.55) / 0.45;
    return 1 - q * q * (3 - 2 * q);
  }
  return 0;
};

export class BattleScene implements LiveScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 140);
  readonly views = new Map<number, UnitView>();
  hooks: SceneHooks;
  /** hệ số tốc độ trận (SPEED_MULT); 0 khi tạm dừng */
  timeScale = 1;
  /** true = màn dọc (điện thoại đứng) */
  portrait = true;
  canvasW = 1;
  canvasH = 1;

  private q: QualityState = currentPreset();
  private low = this.q.level === 'low';
  private pool: FxPool;
  private env: ArenaEnv;
  private battle: Battle | null = null;
  private tweens: Tw[] = [];
  private laters: Later[] = [];
  private curDelay = 0;
  private curStag: number = MOTION.aoeStagger;
  private curUlt = false;
  private dmgIdx = 0;
  private lastT = -1;
  private fightOver = false;
  private alive: [number, number] = [0, 0];
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

  /** `chapter` 1 Đền Rừng / 2 Làng Ven Sông / 3 Mỏ Đá — mặc định 1 (tháp, đấu trường, boss bang) */
  constructor(hooks: SceneHooks, chapter: number = 1) {
    this.hooks = hooks;
    brightLights(this.scene);
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2);
    this.sphereGeo = new THREE.SphereGeometry(1, 10, 8);
    this.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    this.owned.push(this.ringGeo, this.sphereGeo, this.pillarGeo);
    this.pool = new FxPool(this.scene, this.q.level === 'high' ? 180 : this.q.level === 'medium' ? 120 : 60);
    // đạn bay + đuôi sáng: máy yếu bớt số viên, bỏ đuôi
    this.pj = new ProjPool(this.scene, this.q.level === 'low' ? 14 : 28, this.pool, this.q.level === 'high' ? 0.028 : this.q.level === 'medium' ? 0.05 : 0);
    this.env = buildArena(this.scene, chapter, this.q.level);
  }

  /* ------------------------------ BỐ TRÍ ------------------------------ */
  /** Ô của đơn vị: x lấy từ vị trí engine (xuất phát xa nhau), z là LÀN cố định theo ô (MOTION.laneZ, trải ±1.6, so le kiểu gạch) cộng độ lệch tách mềm `sz` (xem separate). */
  private homeOf(slot: number, boss: boolean, engineX: number, out: THREE.Vector3): THREE.Vector3 {
    const z = boss ? MOTION.bossZ : ((MOTION.laneZ[slot] ?? 0) * (this.portrait ? 1.35 : 1));
    return out.set(worldX(engineX), 0, z);
  }
  private faceOf(side: 0 | 1): number {
    return side === 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  private place(v: UnitView) {
    v.group.position.set(v.pos.x + v.ox + v.kick.x + v.rx, v.kick.y, v.pos.z + v.oz + v.kick.z + v.rz);
  }

  /** camera nghiêng ~37° (dọc) / ~29° (ngang), khung đủ rộng để thấy cả hai phe + cổng vòm. Dọc: mỗi đơn vị ≥ ~11% bề ngang */
  private fitCamera() {
    const aspect = this.canvasW / this.canvasH;
    this.portrait = aspect < 1;
    let el: number, W: number, H: number;
    if (this.portrait) {
      this.camera.fov = 32;
      el = (26 * Math.PI) / 180; // thấp để nhìn nhân vật từ BÊN HÔNG (thấy chân tay chạy), không nhìn từ đỉnh đầu như 37° cũ
      W = 8.4; // (x giữ nguyên tỉ lệ; làn z trải ±1.6 chỉ tốn chiều dọc, màn dọc còn dư nên đơn vị vẫn ≥ ~11% bề ngang) bề ngang thế giới nhìn thấy tại mặt phẳng tâm: hàng sau hai phe ở ±3.5 (+ nửa thân) vừa khít; 390px => 1 đơn vị ≈ 12% bề ngang
      H = 0;
      this.camTarget.set(0, 1.0, 0.2);
    } else {
      this.camera.fov = 34;
      el = (15 * Math.PI) / 180;
      W = 13;
      H = 11; // chiều cao thế giới tối thiểu (chừa chỗ cho thanh trên + thẻ tướng)
      this.camTarget.set(0, 1.0, 0);
    }
    this.camera.updateProjectionMatrix();
    const th = Math.tan((this.camera.fov * Math.PI) / 360);
    const d = Math.max(W / 2 / (th * aspect), H / 2 / th);
    this.camera.position.set(this.camTarget.x, this.camTarget.y + Math.sin(el) * d, this.camTarget.z + Math.cos(el) * d);
    this.camera.lookAt(this.camTarget);
    this.camBase.copy(this.camera.position);
  }

  resize(w: number, h: number) {
    this.canvasW = w;
    this.canvasH = h;
    this.fitCamera();
    this.camDirty = false;
  }

  /* ------------------------------ ĐƠN VỊ ------------------------------ */
  addUnit(u: Unit, pop = false): UnitView {
    const init = u.init;
    const model = createHeroModel(init.key, { outlines: this.q.outlines });
    const group = new THREE.Group();
    group.add(model.object3d);
    const boss = !!init.boss || init.key === 'mk_chua';
    const blob = makeBlob(boss ? 2.6 : 1.4);
    group.add(blob);
    const v: UnitView = {
      uid: u.uid, key: init.key, side: init.side, slot: init.slot, role: init.role, element: init.element, boss,
      unit: u, group, model, blob, home: this.homeOf(init.slot, boss, u.x, new THREE.Vector3()),
      pos: new THREE.Vector3(), tx: 0, sz: 0, szT: 0, dustT: 0, ox: 0, oz: 0, rx: 0, rz: 0, rvx: 0, rvz: 0, kick: new THREE.Vector3(),
      melee: init.role === 'warrior' || init.role === 'tank',
      lt: -1, ld: 0.3, lax: 0, laz: 0, face: this.faceOf(init.side), faceT: 0, yaw: this.faceOf(init.side),
      freeze: 0, hp: u.hp, maxHp: u.maxHp, alive: true, gone: false, leaned: false,
      aura: null, auraT: 0, shieldMesh: null, shieldOn: false, stunGroup: null, stunOn: false,
    };
    v.pos.copy(v.home);
    v.tx = v.home.x;
    const mhk = model as unknown as Partial<MoveHook>;
    if (!this.low) {
      // bụi nhỏ dưới chân mỗi bước chạy / khi phanh (model gọi lúc chân chạm đất; hàm dựng một lần, không cấp phát mỗi khung)
      mhk.onStep = (strong: boolean) => this.stepDust(v, strong);
    }
    this.alive[init.side]++;
    model.object3d.rotation.y = v.yaw;
    group.position.copy(v.home);
    this.scene.add(group);
    this.views.set(u.uid, v);
    if (pop) {
      // trượt vào từ mép phe mình + nảy to dần
      const sgn = init.side === 0 ? -1 : 1;
      const ax = sgn * 1.6;
      group.scale.setScalar(0.01);
      this.tween(0.5, (k) => {
        const s = k < 0.7 ? easeOut(k / 0.7) * 1.15 : 1.15 - 0.15 * ((k - 0.7) / 0.3);
        group.scale.setScalar(Math.max(0.01, s));
        const e = 1 - easeOut(k);
        v.kick.set(ax * e, 0, 0);
      });
      this.ring(v.home, ELEMENT_COLOR[init.element], 1.6, 0.5);
    }
    return v;
  }

  private stepDust(v: UnitView, strong: boolean) {
    if (!v.alive || this.pool.active >= 70) return;
    const back = v.side === 0 ? -1 : 1;
    const n = strong ? 3 : 1;
    for (let i = 0; i < n; i++) {
      this.pool.spawn('dot', v.pos.x + back * 0.2, 0.07, v.pos.z + (rnd() - 0.5) * 0.3, back * (strong ? 0.9 : 0.35), strong ? 0.8 : 0.45, 0, -0.5, 0.42, strong ? 0.2 : 0.14, 0.5, 0xd8cdb4, 0, false, 0.42);
    }
  }

  /**
   * Tách mềm thuần hình ảnh: engine cho phép đồng minh chồng/đứng sát nhau nên ở đây ép khoảng cách trên màn hình
   * (xz) ≥ sepSame (cùng phe) / sepFoe (khác phe) bằng cách đẩy RA XA nhau CHỈ theo z. Tính từ z làn gốc (không từ z đã lệch)
   * nên ổn định, không dao động; `sz` bám mượt tới đích. O(n^2) với n ≤ 12, không cấp phát.
   */
  private separate() {
    const all = this.views;
    for (const a of all.values()) {
      if (a.gone || !a.alive) {
        a.szT = 0;
        continue;
      }
      let push = 0;
      for (const b of all.values()) {
        if (b === a || b.gone || !b.alive) continue;
        const minD = a.side === b.side ? MOTION.sepSame : MOTION.sepFoe;
        const dx = a.pos.x - b.pos.x;
        if (dx >= minD || dx <= -minD) continue;
        const need = Math.sqrt(minD * minD - dx * dx);
        const dz = a.home.z - b.home.z;
        const cur = dz < 0 ? -dz : dz;
        if (cur >= need) continue;
        // đẩy mỗi bên một nửa phần thiếu; cùng làn gốc thì bên uid nhỏ về phía -z
        const sgn = dz > 1e-4 ? 1 : dz < -1e-4 ? -1 : a.uid < b.uid ? -1 : 1;
        push += sgn * (need - cur) * 0.5;
      }
      a.szT = Math.max(-MOTION.sepMax, Math.min(MOTION.sepMax, push));
    }
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
      this.camKick = Math.max(this.camKick, this.low ? 0.05 : 0.1);
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
        const amt = Math.min(0.3, 0.06 + ratio * 0.8) * (crit ? 1.3 : 1) * (ult ? 1.2 : 1) * 10;
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

  /** quay mặt về phía mục tiêu ngay từ lúc ra đòn (giữ `faceHold` giây rồi quay về hướng phe) */
  private faceTo(v: UnitView, t: UnitView) {
    const dx = t.pos.x - v.pos.x;
    const dz = t.pos.z - v.pos.z;
    if (dx * dx + dz * dz > 1e-4) {
      v.face = Math.atan2(dx, dz);
      v.faceT = MOTION.faceHold;
    }
  }

  /**
   * Đòn cận chiến TẠI CHỖ: mục tiêu đã nằm trong tầm (≤ ~0.75) nên chỉ bước tới một nhịp ngắn rồi giật về
   * (độ lệch tạm ox, KHÔNG đổi nền pos). 'hit' ≤ MOTION.lungeStep; 'aoe' gần như vậy; 'ult' bước dài hơn một chút và lâu hơn.
   */
  private lunge(v: UnitView, t: UnitView, mode: 'hit' | 'aoe' | 'ult') {
    const dx = t.pos.x - v.pos.x;
    if (Math.abs(dx) < 1e-3) return;
    const dir = dx > 0 ? 1 : -1;
    const reach = Math.min(Math.abs(dx), mode === 'ult' ? MOTION.lungeStepUlt : MOTION.lungeStep);
    v.lax = dir * reach;
    v.laz = 0;
    v.ld = mode === 'ult' ? MOTION.lungeUlt : MOTION.lungeMin;
    v.lt = 0;
    v.face = Math.atan2(dx, t.pos.z - v.pos.z);
    v.faceT = MOTION.faceHold;
  }

  /** độ cao cung đạn theo khoảng cách (bắn qua đầu hàng trước) */
  private arcFor(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.min(1.5, 0.3 + Math.hypot(a.x - b.x, a.z - b.z) * 0.14);
  }

  /** một vòng sóng xung kích lớn trùm cả phe `side` (AoE gộp, không rải vòng nhỏ khắp nơi) */
  private areaRing(side: 0 | 1, color: number, size: number) {
    let n = 0;
    this.tmpC.set(0, 0, 0);
    for (const o of this.views.values()) {
      if (o.gone || !o.alive || o.side !== side) continue;
      this.tmpC.x += o.pos.x;
      this.tmpC.z += o.pos.z;
      n++;
    }
    if (!n) return;
    this.tmpC.x /= n;
    this.tmpC.z /= n;
    this.ring(this.tmpC, color, size, 0.45);
    if (!this.low) this.ring(this.tmpC, 0xffffff, size * 0.6, 0.3);
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
    // thời gian bay tỉ lệ khoảng cách THẬT (vị trí hiện tại của hai bên): bắn xa -> bay lâu hơn
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
        // đợt mới: phe ta engine đã đưa về đội hình xuất phát (sự kiện 'move' vừa tới) -> đặt thẳng tại đó, hai bên lại cách xa
        for (const v of this.views.values()) {
          if (v.gone || !v.alive || v.side !== 0) continue;
          const nx = worldX(v.unit.x);
          if (Math.abs(nx - v.pos.x) > 0.3) this.ring(this.tmpC.set(nx, 0, v.pos.z), ELEMENT_COLOR[v.element], 1.0, 0.35);
          v.tx = v.pos.x = nx;
          v.home.x = nx;
        }
        this.curDelay = 0;
        this.hooks.wave(ev.n);
        break;
      }
      case 'move': {
        // vị trí thật từ engine: nền sẽ bám mượt tới đây (xem moveUnit); người đã gục đứng yên tại chỗ ngã
        const v = this.views.get(ev.u);
        if (v && v.alive) v.tx = worldX(ev.x);
        break;
      }
      case 'act': {
        const v = this.views.get(ev.u);
        if (!v) break;
        const sk = skillOf(ev.s);
        const tgs = ev.tg.map((id) => this.views.get(id)).filter((x): x is UnitView => !!x);
        const col = ELEMENT_COLOR[v.element];
        const first = tgs[0];
        const enemyFirst = first && first.side !== v.side ? first : undefined;
        this.dmgIdx = 0;
        this.curUlt = sk.kind === 'ult';
        this.curStag = this.curUlt ? 0.07 : MOTION.aoeStagger;
        if (enemyFirst) this.faceTo(v, enemyFirst);
        if (sk.kind !== 'basic') this.hooks.log?.(sk.kind === 'ult' ? `${v.unit.init.name} tung tuyệt kỹ ${sk.name}!` : `${v.unit.init.name} dùng ${sk.name}`, v.side);
        if (sk.kind !== 'basic') this.hooks.ticker?.(v.unit.init.name, sk.name, v.side, sk.kind === 'ult', hex(col));
        if (sk.kind === 'ult') this.cutIn(v, sk.name, v.side === 1 && v.key.startsWith('mk_'));
        else if (sk.kind !== 'basic') this.hooks.skill?.(v.uid, sk.name, hex(col), false);
        const aoe = sk.target === 'enemyAll';
        if (sk.kind === 'ult') {
          v.model.play('cast');
          this.ring(v.group.position, col, 2.4, 0.7);
          // tuyệt kỹ cận chiến: lao xa hơn tới giữa đội địch rồi về chỗ
          if (v.melee && enemyFirst && sk.type === 'dmg') this.lunge(v, tgs[tgs.length >> 1] ?? enemyFirst, 'ult');
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
          if (sk.type === 'dmg' && aoe) this.later(MOTION.ultHit - 0.1, () => this.areaRing(1 - v.side as 0 | 1, col, 4.2));
          this.curDelay = MOTION.ultHit;
        } else if (sk.type === 'dmg' && v.melee && !aoe && enemyFirst) {
          // cận chiến: lao tới trước mặt mục tiêu, chém đúng lúc trúng, rồi lùi về chỗ
          v.model.play('attack');
          this.lunge(v, enemyFirst, 'hit');
          this.curDelay = MOTION.meleeHit;
          const tg = enemyFirst;
          this.later(MOTION.meleeHit - 0.02, () => {
            if (v.gone || tg.gone) return;
            const a = this.chestTo(v, this.tmpA);
            const b = this.chestTo(tg, this.tmpB);
            const mx = b.x + (a.x - b.x) * 0.35;
            const mz = b.z + (a.z - b.z) * 0.35;
            const sz = v.boss ? 2.4 : 1.7;
            this.pool.spawn('slash', mx, a.y + 0.1, mz, 0, 0, 0, 0, 0.2, sz * 0.8, sz * 1.5, col, 0, true, 0.9, -0.6 + rnd() * 1.2);
            if (!this.low) this.pool.spawn('slash', mx, a.y - 0.05, mz, 0, 0, 0, 0, 0.16, sz * 0.6, sz * 1.2, 0xffffff, 0, true, 0.8, 0.6 + rnd() * 0.8);
          });
        } else if (sk.type === 'dmg' && v.melee) {
          // cận chiến diện rộng: một sóng xung kích lớn trùm phe địch
          v.model.play('attack');
          if (enemyFirst) this.lunge(v, tgs[tgs.length >> 1] ?? enemyFirst, 'aoe');
          this.ring(v.group.position, col, 2.2, 0.35);
          this.later(0.16, () => this.areaRing(1 - v.side as 0 | 1, col, 4));
          this.curDelay = 0.22;
        } else if (sk.type === 'dmg') {
          // tầm xa: đứng yên tại ô, bắn qua đầu hàng trước; đạn bay tới VỊ TRÍ HIỆN TẠI của mục tiêu rồi mới trúng
          const role = v.role;
          const kind: ProjKind = role === 'archer' ? 'arrow' : role === 'support' ? 'note' : 'orb';
          const rel = role === 'archer' ? MOTION.releaseArcher : role === 'mage' ? MOTION.releaseMage : MOTION.releaseSupport;
          v.model.play(role === 'archer' ? 'attack' : 'cast');
          if (enemyFirst) this.impulse(v, v.pos.x - enemyFirst.pos.x, v.pos.z - enemyFirst.pos.z, 1.2);
          const fl = enemyFirst ? this.flight(v, enemyFirst) : MOTION.flightMin;
          const size = sk.kind === 'active' ? 1.35 : 1;
          if (aoe) {
            // mưa đạn rơi xuống từng mục tiêu + một vòng sóng lớn trùm cả phe địch
            const fall = 0.3;
            this.later(rel, () => this.areaRing(1 - v.side as 0 | 1, col, 3.6));
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
                const arc = this.arcFor(a, b);
                this.shoot(kind, a, b, col, fl, kind === 'arrow' ? arc : arc * 0.7, size);
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
                const b = this.chestTo(t, this.tmpB);
                this.shoot(sk.type === 'heal' ? 'heal' : 'note', a, b, good, fl, this.arcFor(a, b) * 0.9, 1.1);
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
          this.hooks.number(ev.tg, `-${compactNum(ev.n)}`, ev.crit ? 'crit' : 'dmg', { adv: ev.adv });
          this.hooks.meter?.(ev.u, ev.tg, ev.n);
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
        this.alive[v.side]--;
        v.lt = -1;
        v.ox = v.oz = 0;
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

  /** chiếu một điểm thế giới ra pixel trong canvas */
  projectWorld(x: number, y: number, z: number): { x: number; y: number } {
    this.tmp.set(x, y, z).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * this.canvasW, y: (-this.tmp.y * 0.5 + 0.5) * this.canvasH };
  }
  /** điểm gắn biển tên kỹ năng của mỗi phe: phía trên đầu đội hình */
  sideAnchor(side: 0 | 1): { x: number; y: number } {
    return this.projectWorld(side === 0 ? -2.3 : 2.3, 3.1, -0.4);
  }

  /* ------------------------------ DI CHUYỂN (thuần hình ảnh) ------------------------------ */
  /**
   * Chuyển động mỗi khung — ĐỘI HÌNH KHÓA LÀN: mỗi đơn vị giữ z của ô mình, không đuổi/lượn/xếp lại.
   * - cận chiến (trừ boss) bước tới 'vị trí tiền tuyến' ngắn trước vạch giữa khi còn địch sống rồi đứng yên;
   * - lao đòn (v.lt ≥ 0) là độ lệch tạm (ox,oz) theo lungeProfile: ra nhanh → giữ lúc trúng → về chỗ;
   * - tầm xa / hồi máu / hỗ trợ đứng yên tại ô; boss chỉ rời chỗ khi tự lao đòn.
   * Vị trí chỉ để vẽ — engine chọn ai đánh ai.
   */
  private moveUnit(v: UnitView, dt: number) {
    if (dt <= 0) return;
    const mh = v.model as unknown as Partial<MoveHook>;
    // lò xo giật lùi khi trúng đòn / hồi tay (bán ẩn: ổn định với dt ≤ 0.1)
    const sdt = Math.min(dt, 0.05);
    v.rvx += (-v.rx * 90 - v.rvx * 16) * sdt;
    v.rvz += (-v.rz * 90 - v.rvz * 16) * sdt;
    v.rx += v.rvx * sdt;
    v.rz += v.rvz * sdt;
    if (!v.alive) {
      mh.setMove?.(0);
      this.place(v);
      return;
    }
    // 1) nền: x bám mượt theo x engine (tốc độ bám đủ nhanh để độ trễ ~0.04 ở mọi tốc độ x1..x3, vì dt đã nhân tốc độ);
    //    z KHÓA ở làn của ô
    const px = v.pos.x;
    v.tx = worldX(v.unit.x);
    const gap = v.tx - px;
    v.pos.x = Math.abs(gap) < 0.002 ? v.tx : px + gap * Math.min(1, MOTION.followRate * dt);
    v.sz += (v.szT - v.sz) * Math.min(1, MOTION.sepRate * dt);
    v.pos.z = v.home.z + v.sz;
    const speed = Math.abs(v.pos.x - px) / dt;
    const running = !this.fightOver && (Math.abs(v.tx - v.pos.x) > MOTION.moveEps || speed > MOTION.runSpeed * 0.3);

    // 2) đòn cận chiến tại chỗ: bước tới ngắn rồi giật về
    v.ox = v.oz = 0;
    let lk = -1;
    if (v.lt >= 0) {
      v.lt += dt;
      lk = v.lt / v.ld;
      if (lk >= 1) {
        v.lt = -1;
        lk = -1;
      } else {
        const pr = lungeProfile(lk);
        v.ox = v.lax * pr;
        v.oz = v.laz * pr;
      }
    }
    // chạy khi còn lệch x so với engine; đứng yên (idle) khi đã tới tầm
    mh.setMove?.(running ? 0.6 + 0.4 * Math.min(1, speed / MOTION.runSpeed) : 0);
    // thế sẵn sàng: đã dừng ở tầm đánh giữa trận (đứng nhún chân, tay giơ), không phải tượng đá
    mh.setReady?.(!running && !this.fightOver && this.battle !== null);

    // 3) hướng mặt: vừa ra đòn thì nhìn mục tiêu, sau đó về hướng phe
    if (v.faceT > 0) v.faceT -= dt;
    const want = v.faceT > 0 ? v.face : this.faceOf(v.side);
    let df = want - v.yaw;
    df = ((((df + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const step = MOTION.turn * dt;
    v.yaw += Math.max(-step, Math.min(step, df));
    v.model.object3d.rotation.y = v.yaw;

    // nghiêng người về hướng lao
    if (lk >= 0 && (v.lax !== 0 || v.laz !== 0)) {
      const l = Math.hypot(v.lax, v.laz);
      this.leanAxis.set(v.laz / l, 0, -v.lax / l);
      v.group.quaternion.setFromAxisAngle(this.leanAxis, MOTION.lean * (lk < 0.4 || lk > 0.55 ? 1 : 0.3));
      v.leaned = true;
    } else if (v.leaned) {
      v.group.quaternion.identity();
      v.leaned = false;
    }

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
    this.separate();
    for (const v of this.views.values()) {
      if (v.gone) continue;
      // hit-stop cục bộ: chỉ đơn vị vừa bị trúng khựng ≤ vài chục ms
      let vs = sdt;
      if (v.freeze > 0) {
        v.freeze -= dt;
        vs = 0;
      }
      this.moveUnit(v, Math.min(vs, 0.1));
      v.model.update(vs);
      this.updateView(v, sdt, dt);
    }
    this.env.update(sdt, t);
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
    this.env.dispose();
    this.pj.dispose();
    this.pool.dispose();
    disposeFxTextures();
    for (const o of this.owned) o.dispose();
  }
}
