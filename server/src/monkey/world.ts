// Thế giới khỉ phía server: AI 20Hz, va chạm (spatial hash), tìm đường (flow field BFS),
// đạn bay, thực thể đặt (trụ, rào, trạm hồi, pháo sáng, vật phẩm), lịch sử vị trí để bù trễ khi bắn,
// và mã hoá delta khỉ cho snapshot. Toàn bộ dữ liệu nóng là typed array cấp phát một lần.

import { AI_DT, HIST, LAG_COMP_TICKS, MAX_MONKEYS } from '../../../shared/monkey/config.js';
import {
  BANANA_SPEED,
  BOMB_RADIUS,
  HEAD_MUL,
  MK_CHAY,
  MK_CON,
  MK_DOT,
  MK_NAU,
  MK_NEM,
  MK_NO,
  MK_TRANG,
  MK_VUA,
  MONKEYS,
  POUNCE_RANGE,
  POUNCE_SPEED,
  PROJ_G,
  SHOCK_BAND,
  SHOCK_MAX,
  SHOCK_SPEED,
  bodyR,
  bodyY,
  headR,
  headY,
} from '../../../shared/monkey/content.js';
import { ARENA, BOXES, CIRCLES, PLAYER_R, SPAWNS, collide, losBlocked, rayWorld } from '../../../shared/monkey/map.js';
import {
  EN_BARRICADE,
  EN_FLARE,
  EN_PICKUP,
  EN_POD,
  EN_TURRET,
  FX_EXPLODE,
  FX_SHOCK,
  FX_SLAM,
  MF_FULL,
  MF_HP,
  MF_ST,
  MF_YAW,
  PJ_BANANA,
  PJ_BARREL,
  PJ_GRENADE,
  QP,
  QV,
  ST_DROP,
  ST_FUSE,
  ST_MOVE,
  ST_POUNCE,
  ST_ROAR,
  ST_SLAM,
  ST_STRIKE,
  ST_STUN,
  ST_THROW,
  ST_WIND,
  STX_SLOW,
  STX_TAUNT,
  Writer,
  q16,
} from '../../../shared/monkey/proto.js';
import { raySphere, type PState } from '../../../shared/monkey/sim.js';

export const CAUSE_SHOT = 0;
export const CAUSE_EXPLODE = 1;
export const CAUSE_TURRET = 2;
export const CAUSE_SKILL = 3;
export const CAUSE_SELF = 4; // khỉ nổ tự hủy / biến mất

export interface WPlayer {
  idx: number;
  st: PState;
  /** đang khiêu khích tới tick này (đấu sĩ) */
  tauntUntil: number;
}

export interface WorldHost {
  hurt(idx: number, dmg: number, sx: number, sz: number, kind: number): void;
  killed(slot: number, type: number, killer: number, cause: number, x: number, z: number): void;
  heal(idx: number, amount: number): void;
  pickup(idx: number, kind: number): void;
}

export interface Ent {
  id: number;
  kind: number;
  owner: number;
  x: number;
  z: number;
  yaw: number;
  until: number;
  born: number;
  /** trụ: hồi bắn; pod: nhịp hồi; flare: tick nổ; pickup: loại */
  cd: number;
  /** thông số phụ (sát thương trụ…) */
  power: number;
}

interface Shock { x: number; z: number; t0: number; hit: number; dmg: number }
interface Boom { x: number; z: number; at: number; r: number; dmg: number; owner: number }

const CELL = 2; // ô spatial hash (m)
const GRID = Math.ceil((ARENA * 2) / CELL) + 2;
const FF = 1; // ô flow field (m)
const FN = Math.ceil((ARENA * 2) / FF);
const MAXP = 64;
const NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

export class MonkeyWorld {
  tick = 0;
  /* ---------- khỉ ---------- */
  alive = new Uint8Array(MAX_MONKEYS);
  id = new Uint32Array(MAX_MONKEYS);
  type = new Uint8Array(MAX_MONKEYS);
  x = new Float64Array(MAX_MONKEYS);
  z = new Float64Array(MAX_MONKEYS);
  vx = new Float64Array(MAX_MONKEYS);
  vz = new Float64Array(MAX_MONKEYS);
  kx = new Float64Array(MAX_MONKEYS); // hất văng
  kz = new Float64Array(MAX_MONKEYS);
  yaw = new Float64Array(MAX_MONKEYS);
  hp = new Float64Array(MAX_MONKEYS);
  maxHp = new Float64Array(MAX_MONKEYS);
  dmgMul = new Float64Array(MAX_MONKEYS);
  spdMul = new Float64Array(MAX_MONKEYS);
  st = new Uint8Array(MAX_MONKEYS);
  stT = new Float64Array(MAX_MONKEYS); // giây còn lại của trạng thái
  atkCd = new Float64Array(MAX_MONKEYS);
  skCd = new Float64Array(MAX_MONKEYS); // hồi chiêu đặc biệt (ném, vồ, boss)
  sk2 = new Float64Array(MAX_MONKEYS); // boss: hồi gầm
  target = new Int8Array(MAX_MONKEYS).fill(-1);
  tauntBy = new Int8Array(MAX_MONKEYS).fill(-1);
  slowed = new Uint8Array(MAX_MONKEYS);
  los = new Uint8Array(MAX_MONKEYS);
  pdx = new Float64Array(MAX_MONKEYS); // hướng vồ
  pdz = new Float64Array(MAX_MONKEYS);
  freeTick = new Int32Array(MAX_MONKEYS).fill(-1000);
  spawnTick = new Int32Array(MAX_MONKEYS);
  lastHitBy = new Int8Array(MAX_MONKEYS).fill(-1);
  private nextId = 1;
  count = 0;

  /* ---------- lịch sử vị trí (bù trễ) ---------- */
  private hX = new Float32Array(MAX_MONKEYS * HIST);
  private hZ = new Float32Array(MAX_MONKEYS * HIST);
  private hId = new Uint32Array(MAX_MONKEYS * HIST);
  private hT = new Int32Array(HIST).fill(-1);

  /* ---------- spatial hash ---------- */
  private cellHead = new Int16Array(GRID * GRID);
  private nextIn = new Int16Array(MAX_MONKEYS);

  /* ---------- flow field ---------- */
  private ffBlocked = new Uint8Array(FN * FN);
  ffDist = new Uint16Array(FN * FN);
  private ffQueue = new Int32Array(FN * FN);

  /* ---------- đạn bay ---------- */
  pAlive = new Uint8Array(MAXP);
  pId = new Uint16Array(MAXP);
  pKind = new Uint8Array(MAXP);
  pOwner = new Uint8Array(MAXP);
  pX = new Float64Array(MAXP);
  pY = new Float64Array(MAXP);
  pZ = new Float64Array(MAXP);
  pVX = new Float64Array(MAXP);
  pVY = new Float64Array(MAXP);
  pVZ = new Float64Array(MAXP);
  pT = new Float64Array(MAXP);
  pDmg = new Float64Array(MAXP);
  private nextPid = 1;

  ents: Ent[] = [];
  private nextEnt = 1;
  shocks: Shock[] = [];
  booms: Boom[] = [];

  /* ---------- đã gửi (để mã hoá delta) ---------- */
  private sentId = new Uint32Array(MAX_MONKEYS);
  private sentQX = new Int32Array(MAX_MONKEYS);
  private sentQZ = new Int32Array(MAX_MONKEYS);
  private sentYaw = new Uint8Array(MAX_MONKEYS);
  private sentHp = new Uint8Array(MAX_MONKEYS);
  private sentSt = new Uint8Array(MAX_MONKEYS);
  private sentType = new Uint8Array(MAX_MONKEYS);

  /* ---------- sự kiện trong tick (gửi trong snapshot rồi xoá) ---------- */
  rmN = 0;
  rmSlot = new Uint8Array(256);
  rmKiller = new Uint8Array(256);
  rmCause = new Uint8Array(256);
  hitN = 0;
  hitSlot = new Uint8Array(255);
  hitDmg = new Float64Array(255);
  hitBy = new Uint8Array(255);
  hitCrit = new Uint8Array(255);
  shotN = 0;
  shotBy = new Uint8Array(64);
  shotYaw = new Uint16Array(64);
  shotPitch = new Int16Array(64);
  shotDist = new Uint8Array(64);
  pjNewN = 0;
  pjNew = new Uint8Array(64);
  pjEndN = 0;
  pjEnd = new Uint16Array(64);
  fxN = 0;
  fxKind = new Uint8Array(64);
  fxX = new Float64Array(64);
  fxZ = new Float64Array(64);
  fxA = new Uint8Array(64);
  fxB = new Uint16Array(64);

  /** người chơi đang nhìn thấy (cập nhật bởi room) */
  players: WPlayer[] = [];
  rng: () => number;
  /** hệ số kỹ năng theo đợt */
  skillMul = 1;
  overclockUntil = new Int32Array(4);
  /** đo đạc */
  aiMs = 0;

  constructor(private host: WorldHost, seed: number) {
    let a = seed >>> 0 || 1;
    this.rng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.buildBlocked();
  }

  /* ======================= SINH / HUỶ ======================= */
  spawn(type: number, x: number, z: number, hpMul: number, dmgMul: number, spdMul: number, hpOverride = 0): number {
    let slot = -1;
    for (let i = 0; i < MAX_MONKEYS; i++) {
      // không dùng lại slot vừa giải phóng trong 1 giây (client còn đang diễn cảnh chết)
      if (!this.alive[i] && this.tick - this.freeTick[i] > 20) { slot = i; break; }
    }
    if (slot < 0) return -1;
    const d = MONKEYS[type];
    this.alive[slot] = 1;
    this.id[slot] = this.nextId++;
    if (this.nextId > 0xfffffff0) this.nextId = 1;
    this.type[slot] = type;
    this.x[slot] = x;
    this.z[slot] = z;
    this.vx[slot] = this.vz[slot] = this.kx[slot] = this.kz[slot] = 0;
    this.yaw[slot] = Math.atan2(-x, -z);
    this.maxHp[slot] = this.hp[slot] = hpOverride > 0 ? hpOverride : d.hp * hpMul;
    this.dmgMul[slot] = dmgMul;
    this.spdMul[slot] = spdMul * (0.92 + this.rng() * 0.16);
    this.st[slot] = ST_DROP;
    this.stT[slot] = 0.5;
    this.atkCd[slot] = 0.3;
    this.skCd[slot] = 1 + this.rng() * 2;
    this.sk2[slot] = 8;
    this.target[slot] = -1;
    this.tauntBy[slot] = -1;
    this.lastHitBy[slot] = -1;
    this.spawnTick[slot] = this.tick;
    this.count++;
    return slot;
  }

  private remove(slot: number, killer: number, cause: number) {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.freeTick[slot] = this.tick;
    this.count--;
    if (this.rmN < 256) {
      this.rmSlot[this.rmN] = slot;
      this.rmKiller[this.rmN] = killer < 0 ? 255 : killer;
      this.rmCause[this.rmN] = cause;
      this.rmN++;
    }
  }

  /** gây sát thương; trả true nếu giết */
  damage(slot: number, dmg: number, by: number, crit: number, cause: number): boolean {
    if (!this.alive[slot] || dmg <= 0) return false;
    this.hp[slot] -= dmg;
    if (by >= 0) this.lastHitBy[slot] = by;
    if (by >= 0 && by < 4) {
      // gộp số sát thương theo (khỉ, người bắn) trong tick
      let k = -1;
      for (let i = 0; i < this.hitN; i++) if (this.hitSlot[i] === slot && this.hitBy[i] === by) { k = i; break; }
      if (k < 0 && this.hitN < 255) {
        k = this.hitN++;
        this.hitSlot[k] = slot;
        this.hitBy[k] = by;
        this.hitDmg[k] = 0;
        this.hitCrit[k] = 0;
      }
      if (k >= 0) {
        this.hitDmg[k] += dmg;
        if (crit) this.hitCrit[k] = 1;
      }
    }
    // khỉ trúng đạn khựng lại một chút (không áp lên boss/khỉ đột)
    const t = this.type[slot];
    if (t !== MK_VUA && t !== MK_DOT && this.st[slot] === ST_MOVE) {
      this.vx[slot] *= 0.6;
      this.vz[slot] *= 0.6;
    }
    if (this.hp[slot] <= 0) {
      const x = this.x[slot], z = this.z[slot];
      this.remove(slot, by, cause);
      this.host.killed(slot, t, by, cause, x, z);
      if (t === MK_NO) {
        // khỉ đỏ bị bắn chết vẫn nổ: sát thương khỉ xung quanh (ghi công người bắn), người chơi chịu một nửa
        this.explode(x, z, BOMB_RADIUS, 80 * this.dmgMul[slot], by, 0.5 * MONKEYS[MK_NO].dmg * this.dmgMul[slot], slot);
      }
      return true;
    }
    return false;
  }

  /** vụ nổ: khỉ trong bán kính chịu dmgMonkeys (giảm theo khoảng cách), người chơi chịu dmgPlayers */
  explode(x: number, z: number, r: number, dmgMonkeys: number, by: number, dmgPlayers: number, srcSlot = -1) {
    this.addFx(FX_EXPLODE, x, z, Math.min(255, Math.round(r * 10)), by >= 0 && by < 4 ? by + 1 : 0);
    if (dmgMonkeys > 0) {
      const r2 = r * r;
      for (let i = 0; i < MAX_MONKEYS; i++) {
        if (!this.alive[i] || i === srcSlot) continue;
        const dx = this.x[i] - x, dz = this.z[i] - z;
        const d2 = dx * dx + dz * dz;
        const rr = r + MONKEYS[this.type[i]].r;
        if (d2 > rr * rr) continue;
        const k = d2 < r2 ? 1 - 0.5 * Math.sqrt(d2) / r : 0.5;
        const d = Math.sqrt(d2) || 1;
        this.kx[i] += (dx / d) * 6;
        this.kz[i] += (dz / d) * 6;
        this.damage(i, dmgMonkeys * k, by, 0, CAUSE_EXPLODE);
      }
    }
    if (dmgPlayers > 0) {
      for (const p of this.players) {
        if (p.st.down) continue;
        const dx = p.st.x - x, dz = p.st.z - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > r + PLAYER_R || p.st.y > 2.5) continue;
        this.host.hurt(p.idx, dmgPlayers * (1 - 0.5 * Math.min(1, d / r)), x, z, MK_NO);
      }
    }
  }

  addFx(kind: number, x: number, z: number, a: number, b: number) {
    if (this.fxN >= 64) return;
    const i = this.fxN++;
    this.fxKind[i] = kind;
    this.fxX[i] = x;
    this.fxZ[i] = z;
    this.fxA[i] = a & 255;
    this.fxB[i] = b & 0xffff;
  }

  addShot(by: number, yaw: number, pitch: number, dist: number) {
    if (this.shotN >= 64) return;
    const i = this.shotN++;
    this.shotBy[i] = by;
    this.shotYaw[i] = yaw & 0xffff;
    this.shotPitch[i] = pitch;
    this.shotDist[i] = Math.max(0, Math.min(255, Math.round(dist)));
  }

  /* ======================= ĐẠN BAY ======================= */
  spawnProjectile(kind: number, owner: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, dmg: number) {
    let s = -1;
    for (let i = 0; i < MAXP; i++) if (!this.pAlive[i]) { s = i; break; }
    if (s < 0) return;
    this.pAlive[s] = 1;
    this.pId[s] = this.nextPid++ & 0xffff;
    this.pKind[s] = kind;
    this.pOwner[s] = owner;
    this.pX[s] = x; this.pY[s] = y; this.pZ[s] = z;
    // lượng tử hoá ngay để client mô phỏng cùng đường bay
    this.pX[s] = Math.round(x * 64) / 64;
    this.pY[s] = Math.round(y * 64) / 64;
    this.pZ[s] = Math.round(z * 64) / 64;
    this.pVX[s] = Math.round(vx * QV) / QV;
    this.pVY[s] = Math.round(vy * QV) / QV;
    this.pVZ[s] = Math.round(vz * QV) / QV;
    this.pT[s] = life;
    this.pDmg[s] = dmg;
    if (this.pjNewN < 64) this.pjNew[this.pjNewN++] = s;
  }

  private endProjectile(s: number) {
    this.pAlive[s] = 0;
    if (this.pjEndN < 64) this.pjEnd[this.pjEndN++] = this.pId[s];
  }

  private stepProjectiles() {
    const dt = AI_DT;
    for (let s = 0; s < MAXP; s++) {
      if (!this.pAlive[s]) continue;
      const kind = this.pKind[s];
      // 2 bước con cho va chạm chính xác hơn
      let done = false;
      for (let k = 0; k < 2 && !done; k++) {
        const h = dt / 2;
        const nx = this.pX[s] + this.pVX[s] * h;
        const nz = this.pZ[s] + this.pVZ[s] * h;
        this.pVY[s] -= PROJ_G * h;
        let ny = this.pY[s] + this.pVY[s] * h;
        this.pT[s] -= h;
        if (kind === PJ_GRENADE) {
          // lựu đạn: lăn trên đất, chạm vật cản thì dừng, nổ khi hết ngòi
          if (ny <= 0.15) { ny = 0.15; this.pVY[s] = 0; this.pVX[s] *= 0.7; this.pVZ[s] *= 0.7; }
          if (this.pointBlocked(nx, ny, nz)) { this.pVX[s] = 0; this.pVZ[s] = 0; }
          else { this.pX[s] = nx; this.pZ[s] = nz; }
          this.pY[s] = ny;
          if (this.pT[s] <= 0) {
            this.explode(this.pX[s], this.pZ[s], 4.2, this.pDmg[s], this.pOwner[s], 0);
            this.endProjectile(s);
            done = true;
          }
          continue;
        }
        this.pX[s] = nx; this.pY[s] = ny; this.pZ[s] = nz;
        // khỉ ném → trúng người chơi
        let hit = false;
        for (const p of this.players) {
          if (p.st.down) continue;
          const dx = p.st.x - nx, dz = p.st.z - nz, dy = p.st.y + 0.9 - ny;
          const rr = kind === PJ_BARREL ? 1.3 : 0.75;
          if (dx * dx + dz * dz + dy * dy * 0.6 < rr * rr) {
            hit = true;
            break;
          }
        }
        if (hit || ny <= 0.1 || this.pT[s] <= 0 || this.pointBlocked(nx, ny, nz)) {
          if (kind === PJ_BARREL) {
            this.explode(nx, nz, 3.2, 0, -1, this.pDmg[s]);
          } else {
            // chuối: chỉ trúng ai gần điểm rơi
            for (const p of this.players) {
              if (p.st.down) continue;
              const dx = p.st.x - nx, dz = p.st.z - nz, dy = p.st.y + 0.9 - ny;
              if (dx * dx + dz * dz + dy * dy * 0.6 < 0.95 * 0.95) this.host.hurt(p.idx, this.pDmg[s], nx - this.pVX[s], nz - this.pVZ[s], MK_NEM);
            }
            this.addFx(7, nx, nz, 0, 0);
          }
          this.endProjectile(s);
          done = true;
        }
      }
    }
  }

  private pointBlocked(x: number, y: number, z: number) {
    if (x < -ARENA || x > ARENA || z < -ARENA || z > ARENA) return true;
    for (const c of CIRCLES) {
      const dx = x - c.x, dz = z - c.z;
      if (y < c.h && dx * dx + dz * dz < c.r * c.r) return true;
    }
    for (const b of BOXES) {
      if (y < b.h && Math.abs(x - b.x) < b.hx && Math.abs(z - b.z) < b.hz) return true;
    }
    return false;
  }

  /* ======================= THỰC THỂ ======================= */
  addEnt(kind: number, owner: number, x: number, z: number, yaw: number, life: number, power = 0): Ent {
    const e: Ent = { id: this.nextEnt++ & 0xffff, kind, owner, x, z, yaw, until: this.tick + Math.round(life * 20), born: this.tick, cd: 0, power };
    this.ents.push(e);
    if (this.ents.length > 40) this.ents.shift();
    return e;
  }

  private stepEnts() {
    const now = this.tick;
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i];
      if (now >= e.until) {
        if (e.kind === EN_FLARE) this.airstrike(e);
        this.ents.splice(i, 1);
        continue;
      }
      if (e.kind === EN_TURRET) this.stepTurret(e);
      else if (e.kind === EN_POD) {
        if (--e.cd <= 0) {
          e.cd = 10; // mỗi 0.5s
          for (const p of this.players) {
            if (p.st.down) continue;
            const dx = p.st.x - e.x, dz = p.st.z - e.z;
            if (dx * dx + dz * dz < 4.5 * 4.5) this.host.heal(p.idx, 4.5 * this.skillMul);
          }
        }
      } else if (e.kind === EN_PICKUP) {
        for (const p of this.players) {
          if (p.st.down) continue;
          const dx = p.st.x - e.x, dz = p.st.z - e.z;
          if (dx * dx + dz * dz < 1.6 * 1.6) {
            this.host.pickup(p.idx, e.cd);
            this.addFx(12, e.x, e.z, e.cd, p.idx);
            this.ents.splice(i, 1);
            break;
          }
        }
      }
    }
    // bom không kích theo lịch
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      if (now >= b.at) {
        this.explode(b.x, b.z, b.r, b.dmg, b.owner, 0);
        this.booms.splice(i, 1);
      }
    }
  }

  private airstrike(e: Ent) {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    for (let k = 0; k < 8; k++) {
      const d = 3 + k * 3.4;
      let x = e.x + fx * d + (this.rng() - 0.5) * 2;
      let z = e.z + fz * d + (this.rng() - 0.5) * 2;
      x = Math.max(-ARENA, Math.min(ARENA, x));
      z = Math.max(-ARENA, Math.min(ARENA, z));
      this.booms.push({ x, z, at: this.tick + k * 2, r: 4, dmg: e.power, owner: e.owner });
    }
  }

  private stepTurret(e: Ent) {
    const oc = this.overclockUntil[e.owner] > this.tick;
    if (e.cd > 0) { e.cd -= oc ? 2 : 1; return; }
    // tìm khỉ gần nhất trong 18m, có tầm nhìn
    let best = -1;
    let bd = 18 * 18;
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i] || this.st[i] === ST_DROP) continue;
      const dx = this.x[i] - e.x, dz = this.z[i] - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd && !losBlocked(e.x, e.z, this.x[i], this.z[i], 0)) { bd = d2; best = i; }
    }
    if (best < 0) return;
    e.yaw = Math.atan2(this.x[best] - e.x, this.z[best] - e.z);
    e.cd = 3; // 6.7 phát/giây (quá tải: gấp đôi)
    const dmg = e.power * (oc ? 1.5 : 1);
    const d = Math.sqrt(bd);
    // phát bắn của trụ hiển thị như vệt đạn (người bắn = 100 + id thực thể)
    this.addShot(100 + (this.ents.indexOf(e) & 63), Math.round((e.yaw / (Math.PI * 2)) * 65536), Math.round((Math.atan2(bodyY(this.type[best]) - 0.9, d) / (Math.PI * 2)) * 65536), d);
    this.damage(best, dmg, e.owner, 0, CAUSE_TURRET);
  }

  /* ======================= FLOW FIELD ======================= */
  private buildBlocked() {
    const pad = 0.45;
    for (let j = 0; j < FN; j++) {
      for (let i = 0; i < FN; i++) {
        const x = -ARENA + (i + 0.5) * FF;
        const z = -ARENA + (j + 0.5) * FF;
        let b = 0;
        for (const c of CIRCLES) {
          const dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz < (c.r + pad) * (c.r + pad)) { b = 1; break; }
        }
        if (!b) for (const bx of BOXES) {
          if (Math.abs(x - bx.x) < bx.hx + pad && Math.abs(z - bx.z) < bx.hz + pad) { b = 1; break; }
        }
        this.ffBlocked[j * FN + i] = b;
      }
    }
  }

  private cellOf(x: number, z: number) {
    let i = Math.floor((x + ARENA) / FF);
    let j = Math.floor((z + ARENA) / FF);
    if (i < 0) i = 0; else if (i >= FN) i = FN - 1;
    if (j < 0) j = 0; else if (j >= FN) j = FN - 1;
    return j * FN + i;
  }

  /** BFS đa nguồn từ mọi người chơi còn đứng (8 hướng) */
  private buildFlow() {
    const dist = this.ffDist;
    dist.fill(65535);
    const q = this.ffQueue;
    let qh = 0, qt = 0;
    for (const p of this.players) {
      if (p.st.down) continue;
      const c = this.cellOf(p.st.x, p.st.z);
      if (dist[c] !== 0) { dist[c] = 0; q[qt++] = c; }
    }
    if (qt === 0) return;
    while (qh < qt) {
      const c = q[qh++];
      const ci = c % FN, cj = (c / FN) | 0;
      const nd = dist[c] + 1;
      for (let k = 0; k < 16; k += 2) {
        const ni = ci + NB[k], nj = cj + NB[k + 1];
        if (ni < 0 || nj < 0 || ni >= FN || nj >= FN) continue;
        const n = nj * FN + ni;
        if (this.ffBlocked[n] || dist[n] <= nd) continue;
        // chéo: không cắt góc vật cản
        if (k >= 8 && (this.ffBlocked[cj * FN + ni] || this.ffBlocked[nj * FN + ci])) continue;
        dist[n] = nd;
        q[qt++] = n;
      }
    }
  }

  /** hướng đi theo flow field tại (x,z) → ghi vào fdir */
  private fdir = new Float64Array(2);
  private flowDir(x: number, z: number): boolean {
    const c = this.cellOf(x, z);
    const ci = c % FN, cj = (c / FN) | 0;
    let best = this.ffDist[c];
    let bi = -1, bj = -1;
    for (let k = 0; k < 16; k += 2) {
      const ni = ci + NB[k], nj = cj + NB[k + 1];
      if (ni < 0 || nj < 0 || ni >= FN || nj >= FN) continue;
      const n = nj * FN + ni;
      if (k >= 8 && (this.ffBlocked[cj * FN + ni] || this.ffBlocked[nj * FN + ci])) continue;
      if (this.ffDist[n] < best) { best = this.ffDist[n]; bi = ni; bj = nj; }
    }
    if (bi < 0) return false;
    const tx = -ARENA + (bi + 0.5) * FF, tz = -ARENA + (bj + 0.5) * FF;
    const dx = tx - x, dz = tz - z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    this.fdir[0] = dx / d;
    this.fdir[1] = dz / d;
    return true;
  }

  /* ======================= AI ======================= */
  private tmp2 = new Float64Array(2);

  update() {
    const t0 = performance.now();
    this.tick++;
    const dt = AI_DT;
    if (this.tick % 10 === 1) this.buildFlow();
    this.stepProjectiles();
    this.stepEnts();
    this.stepShocks();
    this.rebuildHash();
    const players = this.players;

    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i]) continue;
      const type = this.type[i];
      const def = MONKEYS[type];
      const r = def.r;
      this.atkCd[i] -= dt;
      this.skCd[i] -= dt;
      this.sk2[i] -= dt;
      if (this.stT[i] > 0) this.stT[i] -= dt;

      // ---- chọn mục tiêu ----
      let tgt = -1;
      let td = 1e9;
      const taunter = this.tauntBy[i];
      if (taunter >= 0) {
        const tp = players.find((p) => p.idx === taunter);
        if (tp && !tp.st.down && tp.tauntUntil > this.tick) {
          tgt = taunter;
          const dx = tp.st.x - this.x[i], dz = tp.st.z - this.z[i];
          td = Math.sqrt(dx * dx + dz * dz);
        } else this.tauntBy[i] = -1;
      }
      if (tgt < 0) {
        for (const p of players) {
          if (p.st.down) continue;
          const dx = p.st.x - this.x[i], dz = p.st.z - this.z[i];
          let d = Math.sqrt(dx * dx + dz * dz);
          if (p.idx === this.target[i]) d -= 2.5; // bám mục tiêu cũ, tránh đổi qua lại
          if (d < td) { td = d; tgt = p.idx; }
        }
        if (tgt >= 0) {
          const tp = players.find((p) => p.idx === tgt)!;
          const dx = tp.st.x - this.x[i], dz = tp.st.z - this.z[i];
          td = Math.sqrt(dx * dx + dz * dz);
        }
      }
      this.target[i] = tgt;
      const tp = tgt >= 0 ? players.find((p) => p.idx === tgt)! : null;
      const tx = tp ? tp.st.x : 0, tz = tp ? tp.st.z : 0;
      const edge = td - r - PLAYER_R;

      // tầm nhìn tới mục tiêu: kiểm 4 tick một lần (rải đều)
      if (tp && ((i + this.tick) & 3) === 0) this.los[i] = td < 16 && !losBlocked(this.x[i], this.z[i], tx, tz, r * 0.6) ? 1 : 0;

      let wantX = 0, wantZ = 0;
      let speed = def.speed * this.spdMul[i];
      const s = this.st[i];

      // ---- máy trạng thái ----
      if (s === ST_DROP || s === ST_STUN || s === ST_ROAR) {
        if (this.stT[i] <= 0) this.st[i] = ST_MOVE;
        if (s === ST_ROAR && this.stT[i] <= 0) this.summon(i);
      } else if (s === ST_WIND) {
        // vung tay: đứng xoay về mục tiêu
        if (tp) this.faceTo(i, tx, tz, 0.5);
        if (this.stT[i] <= 0) this.strike(i, tp, edge);
      } else if (s === ST_STRIKE) {
        if (this.stT[i] <= 0) this.st[i] = ST_MOVE;
      } else if (s === ST_THROW) {
        if (tp) this.faceTo(i, tx, tz, 0.6);
        if (this.stT[i] <= 0) {
          if (tp) this.throwAt(i, tp, type === MK_VUA ? PJ_BARREL : PJ_BANANA);
          this.st[i] = ST_MOVE;
          this.skCd[i] = type === MK_VUA ? 5 : 2.6 + this.rng() * 0.8;
        }
      } else if (s === ST_FUSE) {
        if (tp) { wantX = (tx - this.x[i]) / (td || 1); wantZ = (tz - this.z[i]) / (td || 1); speed *= 0.35; }
        if (this.stT[i] <= 0) {
          const x = this.x[i], z = this.z[i];
          const dm = this.dmgMul[i];
          this.remove(i, -1, CAUSE_SELF);
          this.explode(x, z, BOMB_RADIUS, 60 * dm, -1, def.dmg * dm, i);
          continue;
        }
      } else if (s === ST_POUNCE) {
        wantX = this.pdx[i];
        wantZ = this.pdz[i];
        speed = POUNCE_SPEED;
        if (tp && edge < 0.3) {
          this.host.hurt(tgt, def.dmg * 1.4 * this.dmgMul[i], this.x[i], this.z[i], type);
          this.st[i] = ST_STUN;
          this.stT[i] = 0.45;
          this.vx[i] *= 0.2;
          this.vz[i] *= 0.2;
        } else if (this.stT[i] <= 0) {
          this.st[i] = ST_STUN;
          this.stT[i] = 0.35;
        }
      } else if (s === ST_SLAM) {
        if (this.stT[i] <= 0) {
          // boss đập đất: sóng xung kích lan ra, nhảy để né
          this.shocks.push({ x: this.x[i], z: this.z[i], t0: this.tick, hit: 0, dmg: 30 * this.dmgMul[i] });
          this.addFx(FX_SHOCK, this.x[i], this.z[i], 0, 0);
          this.st[i] = ST_STRIKE;
          this.stT[i] = 0.5;
        }
      } else {
        // ST_MOVE
        if (tp) {
          const enraged = type === MK_VUA && this.hp[i] < this.maxHp[i] * 0.5;
          if (enraged) speed *= 1.3;
          if (type === MK_NEM) {
            // giữ khoảng cách 9–14m rồi ném
            if (this.los[i] && td < 15 && this.skCd[i] <= 0) {
              this.st[i] = ST_THROW;
              this.stT[i] = 0.5;
            } else if (td < 8 && this.los[i]) {
              this.dirAway(i, tx, tz);
              wantX = this.fdir[0];
              wantZ = this.fdir[1];
              speed *= 0.8;
            } else if (td > 11 || !this.los[i]) {
              this.dirTo(i, tx, tz, td);
              wantX = this.fdir[0];
              wantZ = this.fdir[1];
            } else {
              // đi ngang vòng quanh
              const dx = (tx - this.x[i]) / td, dz = (tz - this.z[i]) / td;
              const sgn = (i & 1) ? 1 : -1;
              wantX = -dz * sgn * 0.6;
              wantZ = dx * sgn * 0.6;
            }
          } else if (type === MK_TRANG && this.los[i] && td > 3 && td < POUNCE_RANGE && this.skCd[i] <= 0) {
            this.st[i] = ST_WIND;
            this.stT[i] = 0.35;
            this.pdx[i] = (tx - this.x[i]) / td;
            this.pdz[i] = (tz - this.z[i]) / td;
            this.skCd[i] = 3.5;
            this.atkCd[i] = -1; // đánh dấu: vung để vồ
          } else if (type === MK_VUA && this.skCd[i] <= 0 && td < 22) {
            // boss: luân phiên đập đất (gần) / ném thùng (xa) / gầm gọi quân
            if (this.sk2[i] <= 0) {
              this.st[i] = ST_ROAR;
              this.stT[i] = 1.1;
              this.sk2[i] = enraged ? 11 : 15;
              this.addFx(5, this.x[i], this.z[i], 0, 0);
            } else if (td < 9) {
              this.st[i] = ST_SLAM;
              this.stT[i] = enraged ? 0.7 : 0.95;
              this.addFx(FX_SLAM, this.x[i], this.z[i], 1, 0);
            } else if (this.los[i]) {
              this.st[i] = ST_THROW;
              this.stT[i] = 0.75;
            }
            this.skCd[i] = enraged ? 3.2 : 4.6;
          } else if (edge <= def.reach && this.atkCd[i] <= 0) {
            if (type === MK_NO) {
              this.st[i] = ST_FUSE;
              this.stT[i] = 0.6;
            } else {
              this.st[i] = ST_WIND;
              this.stT[i] = def.wind;
              this.atkCd[i] = def.cd;
            }
          } else if (edge > def.reach * 0.6) {
            this.dirTo(i, tx, tz, td);
            wantX = this.fdir[0];
            wantZ = this.fdir[1];
          }
        } else {
          // không còn ai đứng: lững thững về giữa sân
          const d = Math.sqrt(this.x[i] * this.x[i] + this.z[i] * this.z[i]);
          if (d > 6) { wantX = -this.x[i] / d * 0.4; wantZ = -this.z[i] / d * 0.4; }
        }
      }

      // vồ: khi vung xong thì lao đi
      if (this.st[i] === ST_STRIKE && type === MK_TRANG && this.atkCd[i] < 0) {
        this.st[i] = ST_POUNCE;
        this.stT[i] = 0.55;
        this.atkCd[i] = 1;
      }

      // ---- di chuyển ----
      this.slowed[i] = 0;
      for (const e of this.ents) {
        if (e.kind !== EN_BARRICADE) continue;
        // rào 4m × 1.2m xoay theo yaw
        const dx = this.x[i] - e.x, dz = this.z[i] - e.z;
        const c = Math.cos(e.yaw), sn = Math.sin(e.yaw);
        const lx = dx * c - dz * sn; // dọc rào
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) < 2.2 + r && Math.abs(lz) < 0.9 + r) { this.slowed[i] = 1; break; }
      }
      if (this.slowed[i] && this.st[i] !== ST_POUNCE) speed *= 0.35;
      const acc = type === MK_VUA || type === MK_DOT ? 0.18 : 0.32;
      this.vx[i] += (wantX * speed - this.vx[i]) * acc;
      this.vz[i] += (wantZ * speed - this.vz[i]) * acc;
      if (this.st[i] === ST_POUNCE) { this.vx[i] = wantX * speed; this.vz[i] = wantZ * speed; }
      let nx = this.x[i] + (this.vx[i] + this.kx[i]) * dt;
      let nz = this.z[i] + (this.vz[i] + this.kz[i]) * dt;
      this.kx[i] *= 0.75;
      this.kz[i] *= 0.75;
      // tách nhau (spatial hash)
      const ci = Math.floor((this.x[i] + ARENA) / CELL) + 1;
      const cj = Math.floor((this.z[i] + ARENA) / CELL) + 1;
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          const gi = ci + oi, gj = cj + oj;
          if (gi < 0 || gj < 0 || gi >= GRID || gj >= GRID) continue;
          let o = this.cellHead[gj * GRID + gi];
          while (o >= 0) {
            if (o !== i && this.alive[o]) {
              const dx = nx - this.x[o], dz = nz - this.z[o];
              const rr = r + MONKEYS[this.type[o]].r;
              const d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-6) {
                const d = Math.sqrt(d2);
                // khỉ to đẩy khỉ nhỏ
                const share = MONKEYS[this.type[o]].r / rr;
                const push = (rr - d) * 0.5 * share * 1.6;
                nx += (dx / d) * push;
                nz += (dz / d) * push;
              }
            }
            o = this.nextIn[o];
          }
        }
      }
      // không chồng lên người chơi
      for (const p of players) {
        if (p.st.down === 2) continue;
        const dx = nx - p.st.x, dz = nz - p.st.z;
        const rr = r + PLAYER_R;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = p.st.x + (dx / d) * rr;
          nz = p.st.z + (dz / d) * rr;
        }
      }
      collide(nx, nz, r * 0.85, this.tmp2);
      this.x[i] = this.tmp2[0];
      this.z[i] = this.tmp2[1];
      // xoay theo hướng chạy
      const sp2 = this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i];
      if (this.st[i] === ST_MOVE && sp2 > 0.3) this.faceTo(i, this.x[i] + this.vx[i], this.z[i] + this.vz[i], 0.35);
      else if (this.st[i] === ST_MOVE && tp && edge < 1.5) this.faceTo(i, tx, tz, 0.3);
    }
    this.recordHistory();
    this.aiMs = performance.now() - t0;
  }

  private faceTo(i: number, tx: number, tz: number, k: number) {
    const want = Math.atan2(tx - this.x[i], tz - this.z[i]);
    let d = want - this.yaw[i];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw[i] += d * k;
  }

  /** hướng tới mục tiêu: thẳng nếu nhìn thấy, không thì theo flow field */
  private dirTo(i: number, tx: number, tz: number, td: number) {
    if ((this.los[i] && td < 16) || td < 2.5 || !this.flowDir(this.x[i], this.z[i])) {
      const d = td || 1;
      this.fdir[0] = (tx - this.x[i]) / d;
      this.fdir[1] = (tz - this.z[i]) / d;
    }
  }

  private dirAway(i: number, tx: number, tz: number) {
    const dx = this.x[i] - tx, dz = this.z[i] - tz;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    this.fdir[0] = dx / d;
    this.fdir[1] = dz / d;
  }

  private strike(i: number, tp: WPlayer | null, edge: number) {
    const type = this.type[i];
    const def = MONKEYS[type];
    this.st[i] = ST_STRIKE;
    this.stT[i] = 0.25;
    if (type === MK_TRANG && this.atkCd[i] < 0) return; // chuyển sang vồ ở trên
    if (type === MK_DOT) {
      // khỉ đột đập đất: trúng mọi người trong 2.6m trước mặt
      const fx = this.x[i] + Math.sin(this.yaw[i]) * 1.1;
      const fz = this.z[i] + Math.cos(this.yaw[i]) * 1.1;
      this.addFx(FX_SLAM, fx, fz, 0, 0);
      for (const p of this.players) {
        if (p.st.down) continue;
        const dx = p.st.x - fx, dz = p.st.z - fz;
        if (dx * dx + dz * dz < 2.6 * 2.6 && p.st.y < 1.2) this.host.hurt(p.idx, def.dmg * this.dmgMul[i], this.x[i], this.z[i], type);
      }
      return;
    }
    if (tp && !tp.st.down && edge < def.reach + 0.45) {
      this.host.hurt(tp.idx, def.dmg * this.dmgMul[i], this.x[i], this.z[i], type);
    }
  }

  private throwAt(i: number, tp: WPlayer, kind: number) {
    const sx = this.x[i], sz = this.z[i];
    const sy = kind === PJ_BARREL ? 3.5 : 1.5;
    // ngắm đón đầu theo vận tốc người chơi
    let tx = tp.st.x, tz = tp.st.z;
    const d0 = Math.sqrt((tx - sx) ** 2 + (tz - sz) ** 2);
    const spd = kind === PJ_BARREL ? 11 : BANANA_SPEED;
    const T = Math.max(0.35, d0 / spd);
    tx += tp.st.vx * T * 0.7;
    tz += tp.st.vz * T * 0.7;
    const dx = tx - sx, dz = tz - sz;
    const ty = 0.9;
    const vy = (ty - sy + 0.5 * PROJ_G * T * T) / T;
    const dmg = (kind === PJ_BARREL ? 30 : MONKEYS[MK_NEM].dmg) * this.dmgMul[i];
    this.spawnProjectile(kind, 255, sx, sy, sz, dx / T, vy, dz / T, T + 0.6, dmg);
  }

  /** số khỉ con boss gọi mỗi lần gầm (room đặt theo đợt) */
  bossSummon = 5;
  private summon(i: number) {
    const n = this.bossSummon;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = this.x[i] + Math.sin(a) * 3;
      const z = this.z[i] + Math.cos(a) * 3;
      collide(x, z, 0.4, this.tmp2);
      this.spawn(MK_CON, this.tmp2[0], this.tmp2[1], this.dmgMul[i], this.dmgMul[i], 1);
    }
  }

  private stepShocks() {
    for (let k = this.shocks.length - 1; k >= 0; k--) {
      const s = this.shocks[k];
      const rad = (this.tick - s.t0) * AI_DT * SHOCK_SPEED;
      if (rad > SHOCK_MAX) { this.shocks.splice(k, 1); continue; }
      for (const p of this.players) {
        if (p.st.down || s.hit & (1 << p.idx)) continue;
        const d = Math.sqrt((p.st.x - s.x) ** 2 + (p.st.z - s.z) ** 2);
        // nhảy lên (y > 0.35) là né được
        if (Math.abs(d - rad) < SHOCK_BAND + 0.3 && p.st.y < 0.35) {
          s.hit |= 1 << p.idx;
          this.host.hurt(p.idx, s.dmg, s.x, s.z, MK_VUA);
        }
      }
    }
  }

  private rebuildHash() {
    this.cellHead.fill(-1);
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i]) continue;
      let gi = Math.floor((this.x[i] + ARENA) / CELL) + 1;
      let gj = Math.floor((this.z[i] + ARENA) / CELL) + 1;
      if (gi < 0) gi = 0; else if (gi >= GRID) gi = GRID - 1;
      if (gj < 0) gj = 0; else if (gj >= GRID) gj = GRID - 1;
      const c = gj * GRID + gi;
      this.nextIn[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  /* ======================= BÙ TRỄ ======================= */
  private recordHistory() {
    const h = this.tick & (HIST - 1);
    this.hT[h] = this.tick;
    const b = h * MAX_MONKEYS;
    for (let i = 0; i < MAX_MONKEYS; i++) {
      this.hId[b + i] = this.alive[i] ? this.id[i] : 0;
      this.hX[b + i] = this.x[i];
      this.hZ[b + i] = this.z[i];
    }
  }

  /** vị trí khỉ ở thời điểm vt (tick AI có phần lẻ); trả false nếu lúc đó chưa tồn tại */
  private rw = new Float64Array(2);
  rewound(slot: number, vt: number): boolean {
    if (vt >= this.tick) {
      this.rw[0] = this.x[slot];
      this.rw[1] = this.z[slot];
      return true;
    }
    const t0 = Math.floor(vt);
    const a = vt - t0;
    const h0 = t0 & (HIST - 1), h1 = (t0 + 1) & (HIST - 1);
    const id = this.id[slot];
    const ok0 = this.hT[h0] === t0 && this.hId[h0 * MAX_MONKEYS + slot] === id;
    const ok1 = this.hT[h1] === t0 + 1 && this.hId[h1 * MAX_MONKEYS + slot] === id;
    if (ok0 && ok1) {
      const i0 = h0 * MAX_MONKEYS + slot, i1 = h1 * MAX_MONKEYS + slot;
      this.rw[0] = this.hX[i0] + (this.hX[i1] - this.hX[i0]) * a;
      this.rw[1] = this.hZ[i0] + (this.hZ[i1] - this.hZ[i0]) * a;
      return true;
    }
    if (ok1 && t0 + 1 >= this.spawnTick[slot]) {
      const i1 = h1 * MAX_MONKEYS + slot;
      this.rw[0] = this.hX[i1];
      this.rw[1] = this.hZ[i1];
      return a > 0.3; // vừa sinh: chỉ tính nếu gần tick đó
    }
    return false;
  }

  /** kết quả dò tia */
  rayN = 0;
  raySlot = new Int16Array(16);
  rayT = new Float64Array(16);
  rayCrit = new Uint8Array(16);
  rayObs = 0;

  /**
   * Dò tia bù trễ: tìm tối đa maxHits khỉ gần nhất dọc tia trước khi chạm vật cản.
   * vt: tick hiển thị của người bắn (đã kẹp).
   */
  traceRewind(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, vt: number, maxHits: number) {
    const tObs = rayWorld(ox, oy, oz, dx, dy, dz, range);
    this.rayObs = tObs;
    let n = 0;
    const lim = Math.min(16, maxHits);
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i]) continue;
      if (!this.rewound(i, vt)) continue;
      const mx = this.rw[0], mz = this.rw[1];
      const t = this.type[i];
      // loại nhanh: khoảng cách ngang tới tia
      const rx = mx - ox, rz = mz - oz;
      const along = rx * dx + rz * dz;
      const hlen = Math.sqrt(dx * dx + dz * dz) || 1;
      if (along < -2 || along / hlen > tObs + 3) continue;
      const big = headR(t) + bodyR(t) + 1;
      const px = rx - (dx / hlen) * (along / hlen), pz = rz - (dz / hlen) * (along / hlen);
      if (px * px + pz * pz > big * big) continue;
      let best = 1e9;
      let crit = 0;
      // khoan dung nhỏ (+10%) cho sai số nội suy
      const th = raySphere(ox, oy, oz, dx, dy, dz, mx, headY(t), mz, headR(t) * 1.1);
      if (th >= 0) { best = th; crit = 1; }
      const tb = raySphere(ox, oy, oz, dx, dy, dz, mx, bodyY(t), mz, bodyR(t) * 1.15);
      if (tb >= 0 && tb < best) { best = tb; crit = 0; }
      if (best > tObs) continue;
      // chèn có thứ tự, giữ lim phần tử gần nhất
      if (n < lim) n++;
      else if (best >= this.rayT[n - 1]) continue;
      let k = n - 1;
      while (k > 0 && this.rayT[k - 1] > best) {
        this.rayT[k] = this.rayT[k - 1];
        this.raySlot[k] = this.raySlot[k - 1];
        this.rayCrit[k] = this.rayCrit[k - 1];
        k--;
      }
      this.rayT[k] = best;
      this.raySlot[k] = i;
      this.rayCrit[k] = crit;
    }
    this.rayN = n;
    return n;
  }

  static readonly HEAD_MUL = HEAD_MUL;
  static readonly LAG_TICKS = LAG_COMP_TICKS;

  /* ======================= SINH ĐỢT ======================= */
  /** chọn cổng ra khỉ xa người chơi */
  pickSpawn(out: Float64Array) {
    let best = 0;
    let bestScore = -1;
    for (let k = 0; k < 4; k++) {
      const s = SPAWNS[Math.floor(this.rng() * SPAWNS.length)];
      let md = 1e9;
      for (const p of this.players) {
        if (p.st.down) continue;
        const d = Math.hypot(p.st.x - s.x, p.st.z - s.z);
        if (d < md) md = d;
      }
      const sc = Math.min(md, 30) + this.rng() * 8;
      if (sc > bestScore) { bestScore = sc; best = SPAWNS.indexOf(s); }
    }
    const s = SPAWNS[best];
    collide(s.x + (this.rng() - 0.5) * 3, s.z + (this.rng() - 0.5) * 3, 0.5, out);
  }

  /** boss lấy % máu (0..65535) */
  bossRatio() {
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (this.alive[i] && this.type[i] === MK_VUA) return Math.max(1, Math.round((this.hp[i] / this.maxHp[i]) * 65535));
    }
    return 0;
  }

  /** ước lượng khỉ ở gần người chơi (bot đo độ khó) */
  nearest(x: number, z: number) {
    let bd = 1e9;
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i]) continue;
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) bd = d;
    }
    return Math.sqrt(bd);
  }

  /* ======================= MÃ HOÁ SNAPSHOT ======================= */
  /** ghi phần khỉ + sự kiện vào writer. key = gửi đầy đủ (người mới vào) */
  encodeMonkeys(w: Writer, key: boolean) {
    // ---- bản ghi khỉ ----
    const countAt = w.o;
    w.u8(0);
    let n = 0;
    for (let i = 0; i < MAX_MONKEYS; i++) {
      if (!this.alive[i]) {
        if (!key) this.sentId[i] = 0;
        continue;
      }
      let qx: number, qz: number, yq: number, hq: number, sq: number;
      if (key) {
        // bản đầy đủ lấy đúng trạng thái đã gửi cho cả phòng (cùng gốc delta)
        if (this.sentId[i] !== this.id[i]) continue;
        w.u8(i);
        w.u8(MF_FULL);
        w.u8(this.sentType[i]);
        w.i16(this.sentQX[i]);
        w.i16(this.sentQZ[i]);
        w.u8(this.sentYaw[i]);
        w.u8(this.sentHp[i]);
        w.u8(this.sentSt[i]);
        n++;
        continue;
      }
      qx = q16(this.x[i]);
      qz = q16(this.z[i]);
      yq = Math.round((this.yaw[i] / (Math.PI * 2)) * 256) & 255;
      hq = Math.max(1, Math.min(255, Math.ceil((this.hp[i] / this.maxHp[i]) * 255)));
      sq = this.st[i] | (this.slowed[i] ? STX_SLOW : 0) | (this.tauntBy[i] >= 0 ? STX_TAUNT : 0);
      if (this.sentId[i] !== this.id[i]) {
        w.u8(i);
        w.u8(MF_FULL);
        w.u8(this.type[i]);
        w.i16(qx);
        w.i16(qz);
        w.u8(yq);
        w.u8(hq);
        w.u8(sq);
        this.sentId[i] = this.id[i];
        this.sentType[i] = this.type[i];
        this.sentQX[i] = qx;
        this.sentQZ[i] = qz;
        this.sentYaw[i] = yq;
        this.sentHp[i] = hq;
        this.sentSt[i] = sq;
        n++;
        continue;
      }
      let dx = qx - this.sentQX[i];
      let dz = qz - this.sentQZ[i];
      if (dx > 127 || dx < -127 || dz > 127 || dz < -127) {
        // nhảy xa (vồ, hất văng) → gửi lại đầy đủ (giữ id)
        w.u8(i);
        w.u8(MF_FULL);
        w.u8(this.type[i]);
        w.i16(qx);
        w.i16(qz);
        w.u8(yq);
        w.u8(hq);
        w.u8(sq);
        this.sentQX[i] = qx;
        this.sentQZ[i] = qz;
        this.sentYaw[i] = yq;
        this.sentHp[i] = hq;
        this.sentSt[i] = sq;
        n++;
        continue;
      }
      // chỉ gửi khi đổi (khỉ đứng đánh không tốn byte)
      let f = 0;
      if (Math.abs(((yq - this.sentYaw[i] + 128) & 255) - 128) > 1) f |= MF_YAW;
      if (hq !== this.sentHp[i]) f |= MF_HP;
      if (sq !== this.sentSt[i]) f |= MF_ST;
      if (dx === 0 && dz === 0 && f === 0) continue;
      w.u8(i);
      w.u8(f);
      w.i8(dx);
      w.i8(dz);
      if (f & MF_YAW) { w.u8(yq); this.sentYaw[i] = yq; }
      if (f & MF_HP) { w.u8(hq); this.sentHp[i] = hq; }
      if (f & MF_ST) { w.u8(sq); this.sentSt[i] = sq; }
      this.sentQX[i] += dx;
      this.sentQZ[i] += dz;
      dx = dz = 0;
      n++;
    }
    w.put8(countAt, n);
    // ---- khỉ bị xoá ----
    const nr = key ? 0 : this.rmN;
    w.u8(nr);
    for (let i = 0; i < nr; i++) {
      w.u8(this.rmSlot[i]);
      w.u8(this.rmKiller[i]);
      w.u8(this.rmCause[i]);
    }
    // ---- trúng ----
    w.u8(this.hitN);
    for (let i = 0; i < this.hitN; i++) {
      w.u8(this.hitSlot[i]);
      w.u16(Math.min(65535, Math.round(this.hitDmg[i])));
      w.u8((this.hitBy[i] & 127) | (this.hitCrit[i] << 7));
    }
    // ---- phát bắn ----
    w.u8(this.shotN);
    for (let i = 0; i < this.shotN; i++) {
      w.u8(this.shotBy[i]);
      w.u16(this.shotYaw[i]);
      w.i16(this.shotPitch[i]);
      w.u8(this.shotDist[i]);
    }
    // ---- thực thể ----
    const ne = Math.min(64, this.ents.length);
    w.u8(ne);
    for (let i = 0; i < ne; i++) {
      const e = this.ents[i];
      w.u16(e.id);
      w.u8(e.kind);
      w.u8(e.kind === EN_PICKUP ? e.cd : e.owner);
      w.i16(Math.round(e.x * 64));
      w.i16(Math.round(e.z * 64));
      w.u8(Math.round((e.yaw / (Math.PI * 2)) * 256) & 255);
      w.u8(Math.max(0, Math.min(255, Math.ceil((e.until - this.tick) / 20))));
    }
    // ---- đạn bay mới (người mới vào: gửi mọi viên đang bay) ----
    if (key) {
      let c = 0;
      for (let s = 0; s < MAXP; s++) if (this.pAlive[s]) c++;
      w.u8(c);
      for (let s = 0; s < MAXP; s++) if (this.pAlive[s]) this.writeProj(w, s);
    } else {
      w.u8(this.pjNewN);
      for (let k = 0; k < this.pjNewN; k++) this.writeProj(w, this.pjNew[k]);
    }
    w.u8(key ? 0 : this.pjEndN);
    if (!key) for (let k = 0; k < this.pjEndN; k++) w.u16(this.pjEnd[k]);
    // ---- hiệu ứng ----
    w.u8(this.fxN);
    for (let i = 0; i < this.fxN; i++) {
      w.u8(this.fxKind[i]);
      w.i16(Math.round(this.fxX[i] * 64));
      w.i16(Math.round(this.fxZ[i] * 64));
      w.u8(this.fxA[i]);
      w.u16(this.fxB[i]);
    }
  }

  private writeProj(w: Writer, s: number) {
    w.u16(this.pId[s]);
    w.u8(this.pKind[s]);
    w.u8(this.pOwner[s]);
    w.i16(Math.round(this.pX[s] * 64));
    w.i16(Math.round(this.pY[s] * 64));
    w.i16(Math.round(this.pZ[s] * 64));
    w.i16(Math.round(this.pVX[s] * QV));
    w.i16(Math.round(this.pVY[s] * QV));
    w.i16(Math.round(this.pVZ[s] * QV));
  }

  /** xoá danh sách sự kiện sau khi đã gửi */
  clearEvents() {
    this.rmN = this.hitN = this.shotN = this.pjNewN = this.pjEndN = this.fxN = 0;
  }

  /** dọn sạch (hết ván) */
  reset() {
    this.alive.fill(0);
    this.count = 0;
    this.pAlive.fill(0);
    this.ents.length = 0;
    this.shocks.length = 0;
    this.booms.length = 0;
    this.sentId.fill(0);
    this.clearEvents();
  }
}

export { MK_NAU, MK_CHAY, MK_NEM, MK_NO, MK_TRANG, MK_DOT, MK_VUA, MK_CON, EN_TURRET, EN_POD, EN_BARRICADE, EN_FLARE, EN_PICKUP, ST_ROAR, ST_THROW };
