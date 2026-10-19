// Cảnh 3D của trận đánh: camera nghiêng cố định, hai phe đối mặt, camera tự lùi theo tỉ lệ màn hình.
// Cảnh CHỈ phát lại BattleEvent do engine dùng chung xuất ra (act/dmg/heal/fx/die/wave/end).
import * as THREE from 'three';
import { FRONT_SLOTS } from '@shared/heroes/config';
import type { Battle, BattleEvent, Unit } from '@shared/heroes/battle';
import { skillOf } from '@shared/heroes/skills';
import type { EffectType, Element, Role } from '@shared/heroes/types';
import { createHeroModel, type HeroModel } from './hero-model';
import { brightLights, makeBlob, type LiveScene } from './live';
import { currentPreset, type QualityState } from './quality';

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

/** cầu nối sang lớp HUD HTML */
export interface SceneHooks {
  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }): void;
  hp(uid: number, hp: number, max: number): void;
  died(uid: number): void;
  wave(n: number): void;
  flash(color: string): void;
  sfx(k: 'hit' | 'crit' | 'ult' | 'heal'): void;
  /** sau mỗi khung vẽ: HUD cập nhật vị trí thanh máu theo camera */
  frame?(): void;
}

export interface UnitView {
  uid: number;
  side: 0 | 1;
  slot: number;
  role: Role;
  element: Element;
  boss: boolean;
  group: THREE.Group;
  model: HeroModel;
  blob: THREE.Mesh;
  home: THREE.Vector3;
  offset: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  gone: boolean;
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
interface Temp {
  t: number;
  obj: THREE.Object3D;
  parent: THREE.Object3D;
  spin: number;
  mat: THREE.Material;
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const FRONT_DEPTH = 1.5;
const BACK_DEPTH = 3.1;
const FRONT_LAT = [-0.95, 0.95];
const BACK_LAT = [-1.95, 0, 1.95];

export type Layout = 'h' | 'v';

export class BattleScene implements LiveScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  readonly views = new Map<number, UnitView>();
  hooks: SceneHooks;
  timeScale = 1;
  layout: Layout = 'h';
  canvasW = 1;
  canvasH = 1;

  private q: QualityState = currentPreset();
  private tweens: Tw[] = [];
  private laters: Later[] = [];
  private temps: Temp[] = [];
  private curDelay = 0;
  private shake = 0;
  private time = 0;
  private owned: { dispose(): void }[] = [];
  private ringGeo: THREE.RingGeometry;
  private sphereGeo: THREE.SphereGeometry;
  private pillarGeo: THREE.CylinderGeometry;
  private torusGeo: THREE.TorusGeometry;
  private camTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(hooks: SceneHooks, theme: Element = 'forest') {
    this.hooks = hooks;
    brightLights(this.scene);
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2);
    this.sphereGeo = new THREE.SphereGeometry(1, 10, 8);
    this.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    this.torusGeo = new THREE.TorusGeometry(1, 0.12, 6, 18).rotateX(Math.PI / 2);
    this.owned.push(this.ringGeo, this.sphereGeo, this.pillarGeo, this.torusGeo);
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
  private applyLayout() {
    for (const v of this.views.values()) {
      v.home.copy(this.homeOf(v.side, v.slot));
      v.model.object3d.rotation.y = this.faceOf(v.side);
      v.group.position.copy(v.home).add(v.offset);
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
  }

  resize(w: number, h: number) {
    this.canvasW = w;
    this.canvasH = h;
    const lay: Layout = w / h >= 1.05 ? 'h' : 'v';
    this.layout = lay;
    this.applyLayout(); // khoảng cách hai phe phụ thuộc tỉ lệ màn hình
    this.fitCamera();
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
      uid: u.uid, side: init.side, slot: init.slot, role: init.role, element: init.element, boss: !!init.boss,
      group, model, blob, home: this.homeOf(init.side, init.slot), offset: new THREE.Vector3(),
      hp: u.hp, maxHp: u.maxHp, alive: true, gone: false,
    };
    model.object3d.rotation.y = this.faceOf(init.side);
    group.position.copy(v.home);
    this.scene.add(group);
    this.views.set(u.uid, v);
    if (pop) {
      group.scale.setScalar(0.01);
      this.tween(0.45, (k) => {
        const s = k < 0.7 ? easeOut(k / 0.7) * 1.15 : 1.15 - 0.15 * ((k - 0.7) / 0.3);
        group.scale.setScalar(Math.max(0.01, s));
      });
      this.ring(v.home, ELEMENT_COLOR[init.element], 1.6, 0.5);
    }
    return v;
  }

  private removeView(v: UnitView) {
    v.gone = true;
    this.scene.remove(v.group);
    v.model.dispose();
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
  private burst(pos: THREE.Vector3, color: number, n = this.q.particles, speed = 2.2) {
    const m = this.fxMat(color, 1);
    const parts: { mesh: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.sphereGeo, m);
      mesh.scale.setScalar(0.07 + Math.random() * 0.05);
      mesh.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      parts.push({ mesh, v: new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random() * 0.6), 1.2 + Math.random() * 1.8, Math.sin(a) * speed * (0.4 + Math.random() * 0.6)) });
      this.scene.add(mesh);
    }
    let last = 0;
    this.tween(0.55, (k) => {
      const dt = (k - last) * 0.55;
      last = k;
      for (const p of parts) {
        p.v.y -= 7 * dt;
        p.mesh.position.addScaledVector(p.v, dt);
      }
      m.opacity = 1 - k * k;
    }, () => {
      for (const p of parts) this.scene.remove(p.mesh);
      m.dispose();
    });
  }
  private projectile(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number, size = 0.16) {
    const m = this.fxMat(color, 1);
    const mesh = new THREE.Mesh(this.sphereGeo, m);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.tween(dur, (k) => {
      mesh.position.lerpVectors(from, to, k);
      mesh.position.y += Math.sin(k * Math.PI) * 0.5;
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
  /** vật gắn tạm lên đơn vị (khiên, sao choáng) */
  private attach(v: UnitView, obj: THREE.Object3D, mat: THREE.Material, sec: number, spin = 0) {
    v.group.add(obj);
    this.temps.push({ t: sec, obj, parent: v.group, spin, mat });
  }
  private chest(v: UnitView): THREE.Vector3 {
    return v.group.position.clone().setY(v.model.height * 0.55 * v.group.scale.y);
  }

  /* ------------------------------ PHÁT LẠI SỰ KIỆN ------------------------------ */
  handle(ev: BattleEvent, battle: Battle) {
    switch (ev.k) {
      case 'wave': {
        for (const uid of ev.units) {
          const u = battle.unit(uid);
          if (u && !this.views.has(uid)) this.addUnit(u, true);
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
        const ranged = v.role === 'mage' || v.role === 'archer' || sk.target === 'enemyAll' || sk.type !== 'dmg';
        if (sk.kind === 'ult') {
          v.model.play('cast');
          this.ring(v.group.position, col, 2.4, 0.7);
          this.pillar(v.group.position, col, 0.8);
          this.shake = Math.max(this.shake, 0.25);
          this.hooks.flash(`#${col.toString(16).padStart(6, '0')}`);
          this.hooks.sfx('ult');
          if (sk.type === 'dmg') for (const t of tgs) this.projectile(this.chest(v).setY(2.4), this.chest(t), col, 0.4, 0.28);
          this.curDelay = 0.5;
        } else if (sk.type === 'dmg' && !ranged && first) {
          const dir = first.home.clone().sub(v.home);
          const dist = dir.length();
          dir.normalize();
          const to = dir.multiplyScalar(Math.max(0, dist - 1.2));
          v.model.play('attack');
          this.tween(0.14, (k) => {
            v.offset.copy(to).multiplyScalar(easeOut(k));
            v.group.position.copy(v.home).add(v.offset);
          });
          this.later(0.34, () =>
            this.tween(0.2, (k) => {
              v.offset.copy(to).multiplyScalar(1 - easeOut(k));
              v.group.position.copy(v.home).add(v.offset);
            }),
          );
          this.curDelay = 0.3;
        } else if (sk.type === 'dmg') {
          v.model.play(v.role === 'archer' ? 'attack' : 'cast');
          const from = this.chest(v).setY(v.model.height * 0.8);
          for (const t of tgs) this.projectile(from, this.chest(t), col, 0.28);
          this.curDelay = 0.38;
        } else {
          v.model.play('cast');
          const good = sk.type === 'heal' ? 0x5ee08a : 0x7fd0ff;
          for (const t of tgs) this.later(0.35, () => this.ring(t.group.position, good, 1.3, 0.55));
          this.ring(v.group.position, good, 1.1, 0.5);
          this.curDelay = 0.4;
        }
        break;
      }
      case 'dmg': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        const d = this.curDelay;
        this.later(d, () => {
          if (tg.gone) return;
          tg.hp = ev.hp;
          tg.model.play('hit');
          const col = ELEMENT_COLOR[this.views.get(ev.u)?.element ?? tg.element];
          this.burst(this.chest(tg), ev.crit ? 0xfff176 : col, ev.crit ? this.q.particles + 3 : this.q.particles);
          this.hooks.number(ev.tg, String(ev.n), ev.crit ? 'crit' : 'dmg', { adv: ev.adv });
          this.hooks.hp(ev.tg, ev.hp, tg.maxHp);
          this.hooks.sfx(ev.crit ? 'crit' : 'hit');
          if (ev.crit) this.shake = Math.max(this.shake, 0.12);
        });
        break;
      }
      case 'heal': {
        const tg = this.views.get(ev.tg);
        if (!tg) break;
        this.later(this.curDelay, () => {
          if (tg.gone) return;
          tg.hp = ev.hp;
          this.burst(this.chest(tg), 0x5ee08a, this.q.particles, 0.8);
          this.hooks.number(ev.tg, `+${ev.n}`, 'heal');
          this.hooks.hp(ev.tg, ev.hp, tg.maxHp);
          this.hooks.sfx('heal');
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
          const sec = ev.dur / 20;
          if (ev.type === 'shield') {
            const m = this.fxMat(0x7fe3ff, 0.28);
            const bub = new THREE.Mesh(this.sphereGeo, m);
            bub.scale.setScalar(0.8 * tg.model.height);
            bub.position.y = tg.model.height * 0.5;
            this.attach(tg, bub, m, sec);
          } else if (ev.type === 'stun') {
            const m = this.fxMat(0xffd23f, 0.95);
            const st = new THREE.Mesh(this.torusGeo, m);
            st.scale.setScalar(0.45);
            st.position.y = tg.model.height + 0.1;
            this.attach(tg, st, m, sec, 6);
          }
        });
        break;
      }
      case 'die': {
        const v = this.views.get(ev.u);
        if (!v) break;
        const d = this.curDelay + 0.05;
        v.alive = false;
        this.later(d, () => {
          if (v.gone) return;
          v.hp = 0;
          v.model.play('die');
          this.hooks.died(v.uid);
          // đơn vị ngã rồi biến mất; hồn nhỏ bay lên
          this.later(1.5, () => {
            if (v.side === 1) this.removeView(v);
            else v.group.visible = false;
          });
        });
        break;
      }
      case 'end': {
        this.later(0.4, () => {
          if (!ev.win) {
            for (const v of this.views.values()) if (v.side === 1 && v.alive) v.model.play('win');
            return;
          }
          for (const v of this.views.values()) if (v.side === 0 && v.alive) v.model.play('win');
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
  /** phiên trận đánh đẩy logic theo dt thực mỗi khung hình */
  onTick: ((dt: number) => void) | null = null;

  update(dt: number, t: number) {
    this.onTick?.(dt);
    const sdt = dt * this.timeScale;
    this.time = t;
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
      const k = Math.min(1, w.t / w.dur);
      w.fn(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        w.done?.();
      }
    }
    for (let i = this.temps.length - 1; i >= 0; i--) {
      const p = this.temps[i];
      p.t -= sdt;
      p.obj.rotation.y += p.spin * sdt;
      if (p.t <= 0) {
        p.parent.remove(p.obj);
        p.mat.dispose();
        this.temps.splice(i, 1);
      }
    }
    for (const v of this.views.values()) if (!v.gone) v.model.update(sdt);
    // rung màn hình nhẹ
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.8);
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shaken = true;
    }
  }
  private shaken = false;

  /** cho camera về đúng vị trí sau rung, rồi báo HUD cập nhật vị trí */
  afterRender() {
    if (this.shaken) {
      this.shaken = false;
      this.fitCamera();
    }
    this.hooks.frame?.();
  }

  /** chạy các hiệu ứng còn lại tới hết (dùng khi kết thúc) */
  get busy(): boolean {
    return this.tweens.length > 0 || this.laters.length > 0;
  }

  dispose() {
    this.tweens.length = 0;
    this.laters.length = 0;
    for (const t of this.temps) t.mat.dispose();
    this.temps.length = 0;
    for (const v of this.views.values()) if (!v.gone) v.model.dispose();
    this.views.clear();
    for (const o of this.owned) o.dispose();
  }
}
