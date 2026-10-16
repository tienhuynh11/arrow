// Mô phỏng XÁC ĐỊNH của một người chơi ở 60Hz: di chuyển, nhảy, chạy nhanh, bắn/nạp đạn.
// Server và client chạy CÙNG hàm step() với CÙNG lệnh → client dự đoán ngay khi bấm, server xác nhận,
// client hoà giải (reconcile) bằng cách lấy trạng thái server rồi chạy lại các lệnh chưa được xác nhận.

import { DT } from './config.js';
import { CLASSES, WEAPONS } from './content.js';
import { collide, PLAYER_R } from './map.js';
import { hash2, icos, isin, mulberry32 } from './math.js';

/* nút giữ */
export const B_FIRE = 1;
export const B_ADS = 2;
export const B_SPRINT = 4;
export const B_JUMP = 8;
export const B_RELOAD = 16;
export const B_USE = 32;
/* nút bấm một lần (chỉ bật ở đúng lệnh lúc nhấn) */
export const P_G = 64;
export const P_X = 128;
export const P_Q = 256;
export const P_V = 512;
export const P_C = 1024;

export interface Cmd {
  seq: number;
  /** trục ngang (phải +) và dọc (tiến +), -127..127 */
  mx: number;
  mz: number;
  /** góc 16 bit */
  yaw: number;
  /** góc ngẩng có dấu (±16384 = ±90°) */
  pitch: number;
  btn: number;
  /** thời điểm client đang NHÌN thấy khỉ (tick AI × 16) — dùng để bù trễ khi bắn */
  vt: number;
}

export const DOWN_ALIVE = 0;
export const DOWN_DOWNED = 1;
export const DOWN_DEAD = 2;

export interface PState {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  ground: number;
  yaw: number;
  pitch: number;
  /** bậc súng */
  tier: number;
  ammo: number;
  /** đếm ngược tới phát kế (1/100 tick) */
  fireCd: number;
  /** đếm ngược nạp đạn (tick) */
  reloadT: number;
  /** đếm ngược gồng mình (tick) — làm chậm */
  braceT: number;
  /** 0 sống, 1 gục, 2 chết */
  down: number;
  cls: number;
}

export function newState(cls: number, x: number, z: number): PState {
  return {
    x, z, y: 0, vx: 0, vz: 0, vy: 0, ground: 1, yaw: 0, pitch: 0,
    tier: 0, ammo: WEAPONS[0].mag, fireCd: 0, reloadT: 0, braceT: 0, down: 0, cls,
  };
}

export function copyState(dst: PState, s: PState) {
  dst.x = s.x; dst.z = s.z; dst.y = s.y; dst.vx = s.vx; dst.vz = s.vz; dst.vy = s.vy;
  dst.ground = s.ground; dst.yaw = s.yaw; dst.pitch = s.pitch; dst.tier = s.tier; dst.ammo = s.ammo;
  dst.fireCd = s.fireCd; dst.reloadT = s.reloadT; dst.braceT = s.braceT; dst.down = s.down; dst.cls = s.cls;
  return dst;
}

/** sai khác giữa 2 trạng thái (dùng để quyết định có cần hoà giải không) */
export function stateDiff(a: PState, b: PState) {
  if (a.ammo !== b.ammo || a.reloadT !== b.reloadT || a.tier !== b.tier || a.down !== b.down) return 99;
  if (Math.abs(a.fireCd - b.fireCd) > 1) return 99;
  if (a.ground !== b.ground) return 98;
  const d = Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.y - b.y);
  const v = Math.abs(a.vx - b.vx) + Math.abs(a.vz - b.vz) + Math.abs(a.vy - b.vy);
  return d + v * 0.05;
}

export const WALK_ACCEL = 14 * DT;
export const AIR_ACCEL = 3 * DT;
export const JUMP_V = 7.4;
export const GRAVITY = 22;
export const SPRINT_MUL = 1.45;
export const ADS_MUL = 0.62;
export const CRAWL_SPEED = 1.1;
/** độ cao mắt/vai súng + lệch vai phải (để tâm ngắm không bị nhân vật che) */
export const EYE_Y = 1.78;
export const SHOULDER = 0.5;

/* kết quả bước */
export const F_FIRED = 1;
export const F_RELOAD = 2;
export const F_JUMP = 4;
export const F_EMPTY = 8;

const tmp2 = new Float64Array(2);

export function isSprinting(s: PState, c: Cmd) {
  return (c.btn & B_SPRINT) !== 0 && (c.btn & B_ADS) === 0 && (c.btn & B_FIRE) === 0 && c.mz > 30 && s.down === 0;
}

/** một bước 1/60 giây. Trả về cờ sự kiện (F_*). Không cấp phát. */
export function step(s: PState, c: Cmd): number {
  let out = 0;
  const cls = CLASSES[s.cls];
  const w = WEAPONS[s.tier];
  s.yaw = c.yaw & 0xffff;
  let p = c.pitch;
  if (p > 13000) p = 13000;
  else if (p < -13000) p = -13000;
  s.pitch = p;

  if (s.braceT > 0) s.braceT--;

  // ---------- di chuyển ----------
  let mx = c.mx;
  let mz = c.mz;
  if (mx > 127) mx = 127; else if (mx < -127) mx = -127;
  if (mz > 127) mz = 127; else if (mz < -127) mz = -127;
  let ix = mx / 127;
  let iz = mz / 127;
  const mag2 = ix * ix + iz * iz;
  if (mag2 > 1) {
    const inv = 1 / Math.sqrt(mag2);
    ix *= inv;
    iz *= inv;
  }
  let speed = cls.speed;
  const sprint = isSprinting(s, c);
  if (s.down === 1) speed = CRAWL_SPEED;
  else if (s.down === 2) speed = 0;
  else {
    if (sprint) speed *= SPRINT_MUL;
    else if (c.btn & B_ADS) speed *= ADS_MUL;
    if (s.braceT > 0) speed *= 0.75;
  }
  const fx = isin(s.yaw);
  const fz = icos(s.yaw);
  // phải = (-cos, sin)
  const tvx = (fx * iz - fz * ix) * speed;
  const tvz = (fz * iz + fx * ix) * speed;
  const k = s.ground ? WALK_ACCEL : AIR_ACCEL;
  s.vx += (tvx - s.vx) * k;
  s.vz += (tvz - s.vz) * k;

  if ((c.btn & B_JUMP) && s.ground && s.down === 0) {
    s.vy = JUMP_V;
    s.ground = 0;
    out |= F_JUMP;
  }
  if (!s.ground) {
    s.vy -= GRAVITY * DT;
    s.y += s.vy * DT;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
      s.ground = 1;
    }
  }
  collide(s.x + s.vx * DT, s.z + s.vz * DT, PLAYER_R, tmp2);
  s.x = tmp2[0];
  s.z = tmp2[1];

  // ---------- súng ----------
  if (s.fireCd > 0) {
    s.fireCd -= 100;
    if (s.fireCd < 0) s.fireCd = 0;
  }
  if (s.down !== 0) {
    s.reloadT = 0;
    return out;
  }
  if (s.reloadT > 0) {
    s.reloadT--;
    if (s.reloadT === 0) s.ammo = w.mag;
  }
  if ((c.btn & B_RELOAD) && s.reloadT === 0 && s.ammo < w.mag) {
    s.reloadT = w.reload;
    out |= F_RELOAD;
  }
  if ((c.btn & B_FIRE) && !sprint && s.reloadT === 0) {
    if (s.ammo > 0 && s.fireCd === 0) {
      s.ammo--;
      s.fireCd += w.interval;
      out |= F_FIRED;
      if (s.ammo === 0) {
        s.reloadT = w.reload;
        out |= F_RELOAD;
      }
    } else if (s.ammo === 0) {
      s.reloadT = w.reload;
      out |= F_RELOAD | F_EMPTY;
    }
  }
  return out;
}

/** điểm gốc tia bắn (lệch sang phải, ngang đầu) */
export function shotOrigin(s: PState, out: Float64Array) {
  const fx = isin(s.yaw);
  const fz = icos(s.yaw);
  out[0] = s.x - fz * SHOULDER;
  out[1] = s.y + EYE_Y;
  out[2] = s.z + fx * SHOULDER;
}

/** hệ số tản theo tư thế */
export function spreadOf(s: PState, c: Cmd) {
  const w = WEAPONS[s.tier];
  let k = 1;
  if (c.btn & B_ADS) k *= 0.45;
  const sp2 = s.vx * s.vx + s.vz * s.vz;
  if (sp2 > 4) k *= 1.35;
  if (!s.ground) k *= 1.8;
  return w.spread * k;
}

/**
 * Hướng từng viên đạn (đã chuẩn hoá) cho phát bắn ở lệnh c, ghi vào out[3*i..].
 * Dùng PRNG seed theo (người chơi, seq) nên client và server ra cùng hướng.
 */
export function pelletDirs(s: PState, c: Cmd, playerIdx: number, out: Float64Array): number {
  const w = WEAPONS[s.tier];
  const spread = spreadOf(s, c);
  const sy = isin(s.yaw);
  const cy = icos(s.yaw);
  const sp = isin(s.pitch);
  const cp = icos(s.pitch);
  // hệ trục: f (tới), r (phải), u (lên)
  const fX = sy * cp, fY = sp, fZ = cy * cp;
  const rX = -cy, rY = 0, rZ = sy;
  const uX = -sy * sp, uY = cp, uZ = -cy * sp;
  const rng = mulberry32(hash2(c.seq, playerIdx + 1));
  const n = w.pellets;
  for (let i = 0; i < n; i++) {
    let a = rng() * 6.283185307179586;
    let rad = Math.sqrt(rng()) * spread;
    if (n > 1 && i === 0) rad = 0; // viên đầu của súng săn bay thẳng tâm
    // dùng bảng: a → góc 16 bit
    const ai = Math.floor((a / 6.283185307179586) * 65536);
    const ox = icos(ai) * rad;
    const oy = isin(ai) * rad;
    let dx = fX + rX * ox + uX * oy;
    let dy = fY + rY * ox + uY * oy;
    let dz = fZ + rZ * ox + uZ * oy;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
    out[i * 3] = dx * inv;
    out[i * 3 + 1] = dy * inv;
    out[i * 3 + 2] = dz * inv;
    a = 0;
  }
  return n;
}

/** hướng nhìn (không tản) */
export function aimDir(yaw: number, pitch: number, out: Float64Array) {
  const sy = isin(yaw), cy = icos(yaw), sp = isin(pitch), cp = icos(pitch);
  out[0] = sy * cp;
  out[1] = sp;
  out[2] = cy * cp;
}

/** ray–sphere: trả t>=0 nhỏ nhất hoặc -1 */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
