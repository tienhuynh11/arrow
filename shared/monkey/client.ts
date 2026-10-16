// Mô hình phía client (không phụ thuộc DOM/Three → chạy được trong bài test và bot):
//  - Nhân vật MÌNH: dự đoán 60Hz bằng shared/monkey/sim.ts + hoà giải khi server xác nhận (ack seq).
//  - Khỉ + đồng đội: nội suy giữa snapshot 20Hz, đệm tự giãn theo độ giật mạng.
//  - Đồng hồ hiển thị (renderTick) gửi kèm mỗi lệnh để server bù trễ khi bắn.

import { AI_MS, DT, MAX_MONKEYS, MAX_PLAYERS, TICK_HZ } from './config.js';
import { CLASSES, MONKEYS, bodyR, bodyY, headR, headY, waveSpec, weaponOf, type WaveStage } from './content.js';
import { NO_MODS, type SimMods } from './progression.js';
import { rayWorld } from './map.js';
import {
  EN_PICKUP,
  MF_FULL,
  MF_HP,
  MF_ST,
  MF_YAW,
  PF_DOWN_MASK,
  QP,
  QV,
  SnapData,
  type SnapPlayer,
} from './proto.js';
import {
  B_FIRE,
  F_FIRED,
  copyState,
  newState,
  pelletDirs,
  raySphere,
  shotOrigin,
  stateDiff,
  step,
  type Cmd,
  type PState,
} from './sim.js';

const RING = 8; // mẫu nội suy mỗi slot (luỹ thừa 2)
const HIST_N = 256; // lịch sử lệnh đã dự đoán
const SLOTS = 256;
const PD_N = 8; // số phát dự đoán nhớ cho mỗi khỉ

export interface FxEvent {
  /** 'fire' | 'hit' | 'kill' | 'pj' | 'pjend' | 'fx' | 'shot' | 'mhit' | 'reload' | 'jump' | 'empty' | 'predhit' */
  k: string;
  a: number;
  b: number;
  c: number;
  x: number;
  y: number;
  z: number;
  /** tick server mà sự kiện thuộc về (để chờ tới lúc hiển thị) */
  tick: number;
}

export interface Corpse { type: number; x: number; z: number; yaw: number; t: number; killer: number; cause: number; vx: number; vz: number }

export interface Projectile { id: number; kind: number; owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; tick: number; end: number }

export interface Entity { id: number; kind: number; owner: number; x: number; z: number; yaw: number; life: number; seen: number }

export class GameModel {
  /* ---------- người chơi ---------- */
  readonly me: number;
  /** trạng thái dự đoán hiện tại của mình */
  pred: PState;
  /** trạng thái mình ở tick dự đoán trước (để nội suy khung hình) */
  private prev: PState;
  private hSeq = new Int32Array(HIST_N).fill(-1);
  private hCmd: Cmd[] = [];
  private hState: PState[] = [];
  seq = 1;
  private acc = 0;
  private lastFrame = -1;
  /** độ lệch hiển thị do hoà giải, giảm dần về 0 */
  offX = 0;
  offY = 0;
  offZ = 0;
  corrections = 0;
  lastCorrection = 0;
  maxCorrection = 0;
  /** bản snapshot mới nhất của từng người (máu, tiền, hồi chiêu…) */
  info: SnapPlayer[] = [];
  infoValid = new Uint8Array(MAX_PLAYERS);
  /** vị trí hiển thị của mình */
  rx = 0;
  ry = 0;
  rz = 0;

  /* ---------- đồng hồ ---------- */
  private base = 0;
  private baseInit = false;
  jitter = 0.5;
  delay = 2;
  renderTick = 0;
  lastSnapTick = 0;
  snaps = 0;

  /* ---------- đồng đội (nội suy) ---------- */
  private pT = new Int32Array(MAX_PLAYERS * RING).fill(-1);
  private pX = new Float32Array(MAX_PLAYERS * RING);
  private pY = new Float32Array(MAX_PLAYERS * RING);
  private pZ = new Float32Array(MAX_PLAYERS * RING);
  private pYaw = new Uint16Array(MAX_PLAYERS * RING);
  private pPitch = new Int16Array(MAX_PLAYERS * RING);
  oX = new Float32Array(MAX_PLAYERS);
  oY = new Float32Array(MAX_PLAYERS);
  oZ = new Float32Array(MAX_PLAYERS);
  oYaw = new Float32Array(MAX_PLAYERS);
  oPitch = new Float32Array(MAX_PLAYERS);
  oSpeed = new Float32Array(MAX_PLAYERS);

  /* ---------- khỉ ---------- */
  mAlive = new Uint8Array(SLOTS);
  mType = new Uint8Array(SLOTS);
  mHp = new Uint8Array(SLOTS);
  mSt = new Uint8Array(SLOTS);
  mSpawn = new Int32Array(SLOTS);
  /** vị trí đã lượng tử hoá theo server (đơn vị 1/QP) */
  private mQX = new Int32Array(SLOTS);
  private mQZ = new Int32Array(SLOTS);
  private mYawQ = new Uint8Array(SLOTS);
  private mT = new Int32Array(SLOTS * RING).fill(-1);
  private mX = new Float32Array(SLOTS * RING);
  private mZ = new Float32Array(SLOTS * RING);
  private mYw = new Float32Array(SLOTS * RING);
  /** khỉ đang chờ tới lúc hiển thị cái chết */
  private mDieAt = new Int32Array(SLOTS).fill(-1);
  private mKiller = new Uint8Array(SLOTS);
  private mCause = new Uint8Array(SLOTS);
  /** vị trí hiển thị */
  rmX = new Float32Array(SLOTS);
  rmZ = new Float32Array(SLOTS);
  rmYaw = new Float32Array(SLOTS);
  rmSpeed = new Float32Array(SLOTS);
  rmVisible = new Uint8Array(SLOTS);
  /** nháy trắng khi trúng (ms còn lại) */
  mFlash = new Float32Array(SLOTS);
  corpses: Corpse[] = [];

  projectiles: Projectile[] = [];
  entities: Entity[] = [];

  /* ---------- trạng thái pha ---------- */
  phase = 0;
  wave = 0;
  left = 0;
  bossHp = 0;

  /* ---------- sự kiện cho lớp vẽ ---------- */
  fx: FxEvent[] = [];
  private delayed: FxEvent[] = [];

  /** đo kiểm: phát mình thấy trúng */
  predictedHits = 0;
  private tmpO = new Float64Array(3);
  private tmpD = new Float64Array(30);
  /** đo kiểm: từng viên đạn dự đoán (seq, viên, slot trúng hoặc -1) */
  onPredPellet: ((seq: number, k: number, slot: number, vt: number) => void) | null = null;
  /** đo kiểm: số khung hình phải giữ vị trí khỉ vì thiếu mẫu nội suy */
  holdFrames = 0;
  /** thử nghiệm: không vẽ dự đoán (bot) */
  quiet = false;

  /** chỉ số đồ (tin 'start' players[i].mods) — phải khớp server để dự đoán đúng */
  readonly mods: SimMods;
  /** tham số ải (độ khó + luật) — để waveSpec ở client khớp server */
  stage: WaveStage | undefined;

  constructor(me: number, cls: number, x: number, z: number, mods: SimMods = NO_MODS, stage?: WaveStage) {
    this.me = me;
    this.mods = mods;
    this.stage = stage;
    this.pred = newState(cls, x, z, mods);
    this.prev = newState(cls, x, z, mods);
    for (let i = 0; i < HIST_N; i++) {
      this.hCmd.push({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0 });
      this.hState.push(newState(cls, x, z, mods));
    }
    this.rx = x;
    this.rz = z;
  }

  /* ======================= ĐỒNG HỒ ======================= */
  /** server vừa tạm dừng/chạy tiếp: tick nhảy so với đồng hồ thật → đồng bộ lại từ đầu */
  resetClock() {
    this.baseInit = false;
  }

  private clockSample(tick: number, nowMs: number) {
    const sample = tick - nowMs / AI_MS;
    if (!this.baseInit) {
      this.base = sample;
      this.baseInit = true;
      this.renderTick = tick - 2;
      return;
    }
    const d = sample - this.base;
    if (d > 0) this.base += d * 0.25;
    else this.base += d * 0.03;
    const dev = Math.abs(sample - this.base);
    this.jitter += (dev - this.jitter) * 0.08;
    // đệm = 1 tick nội suy + biên độ giật (tối thiểu ~70ms, tối đa 300ms)
    const want = Math.min(6, Math.max(1.4, 1.1 + this.jitter * 2.2));
    this.delay += (want - this.delay) * 0.05;
  }

  /** tick server đang hiển thị (có phần lẻ) */
  private updateRenderTick(nowMs: number) {
    if (!this.baseInit) return;
    const target = nowMs / AI_MS + this.base - this.delay;
    // không đi lùi, bắt kịp mượt
    const diff = target - this.renderTick;
    if (Math.abs(diff) > 8) this.renderTick = target;
    else if (diff > 0) this.renderTick += diff * 0.5 + 0;
    else this.renderTick += diff * 0.1;
    // không vẽ vượt snapshot mới nhất (ngoại suy làm lệch với cảnh server tua lại khi bắn)
    if (this.renderTick > this.lastSnapTick) this.renderTick = this.lastSnapTick;
  }

  /* ======================= SNAPSHOT ======================= */
  onSnap(s: SnapData, nowMs: number) {
    this.snaps++;
    this.clockSample(s.tick, nowMs);
    this.lastSnapTick = s.tick;
    this.phase = s.phase;
    this.wave = s.wave;
    this.left = s.left;
    this.bossHp = s.bossHp;
    const T = s.tick;

    if (s.key) {
      for (let i = 0; i < SLOTS; i++) {
        if (this.mAlive[i]) this.mAlive[i] = 0;
        this.mDieAt[i] = -1;
      }
      this.projectiles.length = 0;
    }

    if (s.wave > 0) this.hpMul = waveSpec(s.wave, Math.max(1, s.np), this.stage).hpMul;
    this.dmgMul = CLASSES[this.pred.cls].dmgMul;
    // ---- người chơi ----
    this.infoValid.fill(0);
    for (let i = 0; i < s.np; i++) {
      const p = s.players[i];
      const idx = p.idx;
      if (!this.info[idx]) this.info[idx] = { ...p };
      else Object.assign(this.info[idx], p);
      this.infoValid[idx] = 1;
      const r = idx * RING + (T & (RING - 1));
      this.pT[r] = T;
      this.pX[r] = p.x;
      this.pY[r] = p.y;
      this.pZ[r] = p.z;
      this.pYaw[r] = p.yaw;
      this.pPitch[r] = p.pitch;
      if (idx === this.me) this.reconcile(p);
    }

    // ---- khỉ bị xoá (xử lý trước bản ghi mới cùng slot) ----
    for (let i = 0; i < s.nr; i++) {
      const sl = s.rSlot[i];
      if (!this.mAlive[sl]) continue;
      this.mAlive[sl] = 0;
      this.mKiller[sl] = s.rKiller[i];
      this.mCause[sl] = s.rCause[i];
      if (s.rKiller[i] === this.me) this.killNow(sl);
      else this.mDieAt[sl] = T;
    }
    // ---- bản ghi khỉ ----
    for (let i = 0; i < s.nm; i++) {
      const sl = s.mSlot[i];
      const f = s.mFlags[i];
      if (f & MF_FULL) {
        if (this.mDieAt[sl] >= 0) this.killNow(sl);
        const wasAlive = this.mAlive[sl];
        this.mAlive[sl] = 1;
        this.mType[sl] = s.mType[i];
        this.mQX[sl] = s.mA[i];
        this.mQZ[sl] = s.mB[i];
        this.mYawQ[sl] = s.mYaw[i];
        this.mHp[sl] = s.mHp[i];
        this.mSt[sl] = s.mSt[i];
        if (!wasAlive) {
          this.pdHead[sl] = 0;
          for (let k = 0; k < PD_N; k++) this.pdT[sl * PD_N + k] = 0;
          this.mSpawn[sl] = s.key ? T - 8 : T;
          for (let k = 0; k < RING; k++) this.mT[sl * RING + k] = -1;
        }
      } else if (this.mAlive[sl]) {
        this.mQX[sl] += s.mA[i];
        this.mQZ[sl] += s.mB[i];
        if (f & MF_YAW) this.mYawQ[sl] = s.mYaw[i];
        if (f & MF_HP) this.mHp[sl] = s.mHp[i];
        if (f & MF_ST) this.mSt[sl] = s.mSt[i];
      }
    }
    // ghi mẫu nội suy cho mọi khỉ còn sống (kể cả không đổi)
    for (let sl = 0; sl < MAX_MONKEYS; sl++) {
      if (!this.mAlive[sl]) continue;
      const r = sl * RING + (T & (RING - 1));
      this.mT[r] = T;
      this.mX[r] = this.mQX[sl] / QP;
      this.mZ[r] = this.mQZ[sl] / QP;
      this.mYw[r] = (this.mYawQ[sl] / 256) * Math.PI * 2;
    }

    // ---- trúng đạn: số sát thương của mình hiện ngay, còn lại theo giờ hiển thị ----
    for (let i = 0; i < s.nh; i++) {
      const sl = s.hSlot[i];
      const ev = this.mk(s.hShooter[i] === this.me ? 'hit' : 'mhit', T);
      ev.a = sl;
      ev.b = s.hDmg[i];
      ev.c = s.hCrit[i] | (s.hShooter[i] << 1);
      ev.x = this.rmX[sl];
      ev.z = this.rmZ[sl];
      ev.y = headY(this.mType[sl] || 0) + 0.3;
      if (s.hShooter[i] === this.me) this.fx.push(ev);
      else this.delayed.push(ev);
    }
    // ---- phát bắn của người khác ----
    for (let i = 0; i < s.ns; i++) {
      if (s.sShooter[i] === this.me) continue;
      const ev = this.mk('shot', T);
      ev.a = s.sShooter[i];
      ev.b = s.sYaw[i];
      ev.c = s.sPitch[i];
      ev.x = s.sDist[i];
      this.delayed.push(ev);
    }
    // ---- thực thể đặt (danh sách đầy đủ mỗi snapshot) ----
    const ents = this.entities;
    for (const e of ents) e.seen = 0;
    for (let i = 0; i < s.ne; i++) {
      const id = s.eId[i];
      let e = ents.find((q) => q.id === id);
      if (!e) {
        e = { id, kind: s.eKind[i], owner: s.eOwner[i], x: 0, z: 0, yaw: 0, life: 0, seen: 0 };
        ents.push(e);
      }
      e.kind = s.eKind[i];
      e.owner = s.eOwner[i];
      e.x = s.eX[i] / 64;
      e.z = s.eZ[i] / 64;
      e.yaw = (s.eYaw[i] / 256) * Math.PI * 2;
      e.life = s.eLife[i];
      e.seen = 1;
    }
    for (let i = ents.length - 1; i >= 0; i--) if (!ents[i].seen) ents.splice(i, 1);
    // ---- đạn bay ----
    for (let i = 0; i < s.np2; i++) {
      this.projectiles.push({
        id: s.pId[i], kind: s.pKind[i], owner: s.pOwner[i],
        x: s.pX[i] / 64, y: s.pY[i] / 64, z: s.pZ[i] / 64,
        vx: s.pVX[i] / QV, vy: s.pVY[i] / QV, vz: s.pVZ[i] / QV,
        tick: T, end: -1,
      });
      if (this.projectiles.length > 96) this.projectiles.shift();
    }
    for (let i = 0; i < s.npe; i++) {
      const p = this.projectiles.find((q) => q.id === s.peId[i] && q.end < 0);
      if (p) p.end = T;
    }
    // ---- hiệu ứng rời rạc ----
    for (let i = 0; i < s.nf; i++) {
      const ev = this.mk('fx', T);
      ev.a = s.fKind[i];
      ev.b = s.fA[i];
      ev.c = s.fB[i];
      ev.x = s.fX[i] / 64;
      ev.z = s.fZ[i] / 64;
      this.delayed.push(ev);
    }
  }

  private mk(k: string, tick: number): FxEvent {
    return { k, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0, tick };
  }

  private killNow(sl: number) {
    this.mDieAt[sl] = -1;
    const t = this.mType[sl];
    const c: Corpse = {
      type: t, x: this.rmX[sl], z: this.rmZ[sl], yaw: this.rmYaw[sl], t: 0,
      killer: this.mKiller[sl], cause: this.mCause[sl], vx: 0, vz: 0,
    };
    // văng nhẹ ra xa người hạ
    const k = this.mKiller[sl];
    if (k < MAX_PLAYERS) {
      const px = k === this.me ? this.rx : this.oX[k];
      const pz = k === this.me ? this.rz : this.oZ[k];
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      c.vx = (dx / d) * 2.5;
      c.vz = (dz / d) * 2.5;
    }
    if (this.corpses.length > 40) this.corpses.shift();
    this.corpses.push(c);
    const ev = this.mk('kill', this.renderTick | 0);
    ev.a = sl;
    ev.b = t;
    ev.c = k;
    ev.x = c.x;
    ev.z = c.z;
    ev.y = this.mCause[sl];
    this.fx.push(ev);
    this.rmVisible[sl] = 0;
  }

  /* ======================= HOÀ GIẢI ======================= */
  private reconcile(p: SnapPlayer) {
    const ack = p.ack;
    // trạng thái server sau lệnh ack
    const srv = this.tmpState;
    srv.x = p.x; srv.z = p.z; srv.y = p.y; srv.vx = p.vx; srv.vz = p.vz; srv.vy = p.vy;
    srv.ground = (p.flags & 4) ? 1 : 0;
    srv.yaw = p.yaw; srv.pitch = p.pitch; srv.tier = p.tier; srv.ammo = p.ammo; srv.fireCd = p.fireCd;
    srv.reloadT = p.reloadT; srv.braceT = p.braceT; srv.down = p.flags & PF_DOWN_MASK; srv.cls = p.cls;
    srv.mods = this.pred.mods;

    if (ack === 0 || ack >= this.seq) {
      // chưa có lệnh nào được xác nhận (hoặc server đi trước — không thể) → lấy nguyên
      if (ack === 0) {
        const d = Math.abs(srv.x - this.pred.x) + Math.abs(srv.z - this.pred.z);
        if (d > 0.01 || srv.down !== this.pred.down || srv.tier !== this.pred.tier) {
          this.snapTo(srv, d > 4);
        }
      }
      return;
    }
    const h = ack & (HIST_N - 1);
    if (this.hSeq[h] !== ack) {
      // lịch sử đã trôi mất (trễ quá lớn) → lấy trạng thái server rồi chạy lại phần còn giữ
      this.replayFrom(srv, ack, true);
      return;
    }
    const mine = this.hState[h];
    // giữ yaw/pitch theo chuột mình, chỉ so phần vật lý
    const diff = stateDiff(mine, srv);
    if (diff > 0.002) this.replayFrom(srv, ack, false);
  }
  private tmpState: PState = newState(0, 0, 0);

  private snapTo(srv: PState, teleport: boolean) {
    const ox = this.pred.x, oy = this.pred.y, oz = this.pred.z;
    const yaw = this.pred.yaw, pitch = this.pred.pitch;
    copyState(this.pred, srv);
    this.pred.yaw = yaw;
    this.pred.pitch = pitch;
    copyState(this.prev, this.pred);
    if (!teleport) {
      this.offX += ox - this.pred.x;
      this.offY += oy - this.pred.y;
      this.offZ += oz - this.pred.z;
    } else {
      this.offX = this.offY = this.offZ = 0;
    }
  }

  private replayFrom(srv: PState, ack: number, lost: boolean) {
    const ox = this.pred.x, oy = this.pred.y, oz = this.pred.z;
    const s = this.pred;
    copyState(s, srv);
    let n = 0;
    for (let q = ack + 1; q < this.seq; q++) {
      const h = q & (HIST_N - 1);
      if (this.hSeq[h] !== q) continue;
      step(s, this.hCmd[h]);
      copyState(this.hState[h], s);
      n++;
    }
    copyState(this.prev, s);
    const ex = ox - s.x, ey = oy - s.y, ez = oz - s.z;
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    this.corrections++;
    this.lastCorrection = err;
    if (err > this.maxCorrection) this.maxCorrection = err;
    if (err > 3) {
      // dịch chuyển (hồi sinh đầu đợt…) → nhảy luôn
      this.offX = this.offY = this.offZ = 0;
    } else {
      this.offX += ex;
      this.offY += ey;
      this.offZ += ez;
    }
    void n;
    void lost;
  }

  /* ======================= KHUNG HÌNH ======================= */
  /**
   * Tiến mô phỏng của mình theo thời gian thực (bước cố định 60Hz) với input hiện tại.
   * Trả về các lệnh mới cần gửi (đã có seq).
   */
  frame(nowMs: number, mx: number, mz: number, yaw: number, pitch: number, btn: number, outCmds: Cmd[]) {
    this.nowMs = nowMs;
    if (this.lastFrame < 0) this.lastFrame = nowMs;
    let dt = (nowMs - this.lastFrame) / 1000;
    this.lastFrame = nowMs;
    if (dt > 0.25) dt = 0.25; // tab bị treo: không dồn quá nhiều lệnh
    if (dt < 0) dt = 0;
    this.updateRenderTick(nowMs);
    // nội suy khỉ/đồng đội TRƯỚC khi bước: phát bắn dự đoán dò đúng cảnh mà vt (renderTick) mô tả
    this.interpolate(dt);
    this.acc += dt;
    // nút bấm một lần chỉ gắn vào lệnh đầu tiên; khung hình chưa đủ 1 tick thì để dành
    let pressed = (btn & 0xffc0) | this.pendingPress;
    this.pendingPress = 0;
    const held = btn & 63;
    while (this.acc >= DT) {
      this.acc -= DT;
      const h = this.seq & (HIST_N - 1);
      const c = this.hCmd[h];
      c.seq = this.seq;
      c.mx = mx;
      c.mz = mz;
      c.yaw = yaw & 0xffff;
      c.pitch = pitch;
      c.btn = held | pressed;
      pressed = 0;
      c.vt = Math.max(0, Math.round(this.renderTick * 16));
      copyState(this.prev, this.pred);
      const f = step(this.pred, c);
      copyState(this.hState[h], this.pred);
      this.hSeq[h] = this.seq;
      this.seq++;
      outCmds.push({ ...c });
      if (!this.quiet) this.onStepFlags(f, c);
    }
    if (pressed) this.pendingPress |= pressed;
    // nội suy khung hình giữa prev và pred + giảm dần lệch hoà giải
    const a = this.acc / DT;
    const decay = Math.exp(-dt * 12);
    this.offX *= decay;
    this.offY *= decay;
    this.offZ *= decay;
    this.rx = this.prev.x + (this.pred.x - this.prev.x) * a + this.offX;
    this.ry = this.prev.y + (this.pred.y - this.prev.y) * a + this.offY;
    this.rz = this.prev.z + (this.pred.z - this.prev.z) * a + this.offZ;
    this.releaseDelayed();
  }
  /** nút bấm một lần chưa kịp vào lệnh nào (khung hình quá nhanh) — gắn vào lệnh kế */
  pendingPress = 0;

  private onStepFlags(f: number, c: Cmd) {
    if (f & F_FIRED) {
      const ev = this.mk('fire', 0);
      ev.a = this.pred.tier;
      ev.b = c.seq;
      this.fx.push(ev);
      this.predictShot(c);
    }
    if (f & 2) this.fx.push(this.mk('reload', 0));
    if (f & 4) this.fx.push(this.mk('jump', 0));
    if (f & 8) this.fx.push(this.mk('empty', 0));
  }

  /** bắn thử ở client lên khỉ đang hiển thị → vệt đạn + dấu trúng tức thì */
  private predictShot(c: Cmd) {
    const s = this.pred;
    const w = weaponOf(s.cls, s.tier);
    const cd = CLASSES[s.cls];
    const mul = this.dmgMul * (s.braceT > 0 ? cd.buff.dmg : 1);
    shotOrigin(s, this.tmpO);
    const n = pelletDirs(s, c, this.me, this.tmpD);
    const ox = this.tmpO[0], oy = this.tmpO[1], oz = this.tmpO[2];
    for (let i = 0; i < n; i++) {
      const dx = this.tmpD[i * 3], dy = this.tmpD[i * 3 + 1], dz = this.tmpD[i * 3 + 2];
      let best = rayWorld(ox, oy, oz, dx, dy, dz, w.range);
      let hit = -1;
      let crit = 0;
      for (let sl = 0; sl < MAX_MONKEYS; sl++) {
        if (!this.rmVisible[sl] || this.predDead(sl)) continue;
        const t = this.mType[sl];
        const mx = this.rmX[sl], mz = this.rmZ[sl];
        const ddx = mx - ox, ddz = mz - oz;
        if (ddx * ddx + ddz * ddz > (best + 3) * (best + 3)) continue;
        const th = raySphere(ox, oy, oz, dx, dy, dz, mx, headY(t), mz, headR(t) * 1.1);
        if (th >= 0 && th < best) { best = th; hit = sl; crit = 1; }
        const tb = raySphere(ox, oy, oz, dx, dy, dz, mx, bodyY(t), mz, bodyR(t) * 1.15);
        if (tb >= 0 && tb < best) { best = tb; hit = sl; crit = 0; }
      }
      const ev = this.mk('tracer', 0);
      ev.x = ox + dx * best;
      ev.y = oy + dy * best;
      ev.z = oz + dz * best;
      ev.a = hit;
      ev.b = crit;
      ev.c = i;
      this.fx.push(ev);
      this.onPredPellet?.(c.seq, i, hit, c.vt);
      if (hit >= 0) {
        this.predictedHits++;
        this.mFlash[hit] = 90;
        // ghi sát thương dự đoán (cùng công thức server) để biết khỉ "chắc đã chết" mà chưa kịp xác nhận
        let dmg = w.dmg * mul;
        if (best > w.falloff) dmg *= 1 - 0.6 * Math.min(1, (best - w.falloff) / Math.max(1, w.range - w.falloff));
        if (crit) dmg *= cd.headMul;
        const k = hit * PD_N + (this.pdHead[hit]++ % PD_N);
        this.pdT[k] = this.nowMs;
        this.pdV[k] = dmg + (w.splashR > 0 ? w.splashDmg : 0);
      }
    }
  }

  /* ---------- dự đoán khỉ chết (tránh bắn thừa khi mạng chậm) ---------- */
  private pdT = new Float64Array(SLOTS * PD_N);
  private pdV = new Float32Array(SLOTS * PD_N);
  private pdHead = new Uint32Array(SLOTS);
  private nowMs = 0;
  /** RTT hiện tại (ms), lớp vẽ cập nhật */
  rttMs = 100;
  /** hệ số máu khỉ của đợt hiện tại + hệ số sát thương lớp (lớp vẽ cập nhật) */
  hpMul = 1;
  dmgMul = 1;
  /** khỉ mà sát thương mình vừa bắn (chưa kịp được server xác nhận) đã đủ hạ */
  predDead(sl: number): boolean {
    const t = this.mType[sl];
    if (t === 6) return false; // boss: không đoán
    const win = this.nowMs - (this.rttMs + 60);
    let sum = 0;
    for (let i = 0; i < PD_N; i++) {
      const k = sl * PD_N + i;
      if (this.pdT[k] > win) sum += this.pdV[k];
    }
    if (sum <= 0) return false;
    const hp = (this.mHp[sl] / 255) * MONKEYS[t].hp * this.hpMul;
    return sum >= hp * 1.02;
  }

  private interpolate(dt: number) {
    const r = this.renderTick;
    const t0 = Math.floor(r);
    const a = r - t0;
    // khỉ
    for (let sl = 0; sl < MAX_MONKEYS; sl++) {
      if (this.mFlash[sl] > 0) this.mFlash[sl] -= dt * 1000;
      const dying = this.mDieAt[sl] >= 0;
      if (!this.mAlive[sl] && !dying) { this.rmVisible[sl] = 0; continue; }
      if (dying && r >= this.mDieAt[sl] - 1) { this.killNow(sl); continue; }
      if (r < this.mSpawn[sl] - 0.5) { this.rmVisible[sl] = 0; continue; }
      const b = sl * RING;
      const i0 = b + (t0 & (RING - 1));
      const i1 = b + ((t0 + 1) & (RING - 1));
      let x: number, z: number, yw: number;
      if (this.mT[i0] === t0 && this.mT[i1] === t0 + 1) {
        x = this.mX[i0] + (this.mX[i1] - this.mX[i0]) * a;
        z = this.mZ[i0] + (this.mZ[i1] - this.mZ[i0]) * a;
        let dy = this.mYw[i1] - this.mYw[i0];
        if (dy > Math.PI) dy -= Math.PI * 2;
        else if (dy < -Math.PI) dy += Math.PI * 2;
        yw = this.mYw[i0] + dy * a;
      } else {
        // thiếu mẫu: lấy mẫu mới nhất ≤ r (hoặc mẫu sớm nhất nếu vừa sinh)
        let best = -1;
        let bt = -1e9;
        let early = -1;
        let et = 1e9;
        for (let k = 0; k < RING; k++) {
          const tt = this.mT[b + k];
          if (tt < 0) continue;
          if (tt <= r + 1 && tt > bt) { bt = tt; best = b + k; }
          if (tt < et) { et = tt; early = b + k; }
        }
        const idx = best >= 0 ? best : early;
        this.holdFrames++;
        if (idx < 0) { this.rmVisible[sl] = 0; continue; }
        x = this.mX[idx];
        z = this.mZ[idx];
        yw = this.mYw[idx];
      }
      if (this.rmVisible[sl] && dt > 0) {
        const dx = x - this.rmX[sl], dz = z - this.rmZ[sl];
        const sp = Math.sqrt(dx * dx + dz * dz) / dt;
        this.rmSpeed[sl] += (Math.min(sp, 14) - this.rmSpeed[sl]) * Math.min(1, dt * 10);
      } else this.rmSpeed[sl] = 0;
      this.rmX[sl] = x;
      this.rmZ[sl] = z;
      this.rmYaw[sl] = yw;
      this.rmVisible[sl] = 1;
    }
    // đồng đội
    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (p === this.me) continue;
      const b = p * RING;
      const i0 = b + (t0 & (RING - 1));
      const i1 = b + ((t0 + 1) & (RING - 1));
      let x: number, y: number, z: number, yw: number, pt: number;
      if (this.pT[i0] === t0 && this.pT[i1] === t0 + 1) {
        x = this.pX[i0] + (this.pX[i1] - this.pX[i0]) * a;
        y = this.pY[i0] + (this.pY[i1] - this.pY[i0]) * a;
        z = this.pZ[i0] + (this.pZ[i1] - this.pZ[i0]) * a;
        let d = this.pYaw[i1] - this.pYaw[i0];
        if (d > 32768) d -= 65536;
        else if (d < -32768) d += 65536;
        yw = this.pYaw[i0] + d * a;
        pt = this.pPitch[i0] + (this.pPitch[i1] - this.pPitch[i0]) * a;
      } else {
        let best = -1;
        let bt = -1e9;
        for (let k = 0; k < RING; k++) {
          const tt = this.pT[b + k];
          if (tt >= 0 && tt > bt) { bt = tt; best = b + k; }
        }
        if (best < 0) continue;
        x = this.pX[best]; y = this.pY[best]; z = this.pZ[best]; yw = this.pYaw[best]; pt = this.pPitch[best];
      }
      if (dt > 0) {
        const dx = x - this.oX[p], dz = z - this.oZ[p];
        const sp = Math.sqrt(dx * dx + dz * dz) / dt;
        this.oSpeed[p] += (Math.min(sp, 12) - this.oSpeed[p]) * Math.min(1, dt * 10);
      }
      this.oX[p] = x; this.oY[p] = y; this.oZ[p] = z;
      this.oYaw[p] = (yw / 65536) * Math.PI * 2;
      this.oPitch[p] = (pt / 65536) * Math.PI * 2;
    }
  }

  private releaseDelayed() {
    const r = this.renderTick;
    let w = 0;
    for (let i = 0; i < this.delayed.length; i++) {
      const e = this.delayed[i];
      if (e.tick <= r + 0.5) {
        if (e.k === 'mhit') {
          e.x = this.rmX[e.a];
          e.z = this.rmZ[e.a];
          this.mFlash[e.a] = 70;
        }
        this.fx.push(e);
      } else this.delayed[w++] = e;
    }
    this.delayed.length = w;
    // đạn bay đã chạm: xoá khi tới giờ hiển thị
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.end >= 0 && r >= p.end) this.projectiles.splice(i, 1);
    }
  }

  /** vị trí hiển thị của đạn bay (ballistic xác định) */
  projectilePos(p: Projectile, g: number, out: Float64Array): boolean {
    const t = (this.renderTick - p.tick) * (AI_MS / 1000);
    if (t < 0) return false;
    out[0] = p.x + p.vx * t;
    out[1] = p.y + p.vy * t - 0.5 * g * t * t;
    out[2] = p.z + p.vz * t;
    if (out[1] < 0.05) out[1] = 0.05;
    return true;
  }

  /** số khỉ đang hiển thị */
  visibleMonkeys() {
    let n = 0;
    for (let i = 0; i < MAX_MONKEYS; i++) n += this.rmVisible[i];
    return n;
  }

  /** khỉ đang sống thật ở server (mới nhất) — dùng cho radar */
  monkeyLatest(sl: number, out: Float64Array) {
    out[0] = this.mQX[sl] / QP;
    out[1] = this.mQZ[sl] / QP;
  }

  get me_info(): SnapPlayer | undefined {
    return this.info[this.me];
  }

  static readonly TICK_HZ = TICK_HZ;
  static readonly MONKEY_DEFS = MONKEYS;
  static readonly PICKUP = EN_PICKUP;
}
