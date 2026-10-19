// Giao thức riêng của SINH TỒN BẦY KHỈ.
//  - Điều khiển (phòng, mua, sự kiện hiếm): JSON.
//  - Lệnh người chơi (60/giây) và snapshot (20/giây): NHỊ PHÂN, lượng tử hoá + nén delta theo slot.
// Snapshot được mã hoá MỘT lần cho cả phòng (mọi người nhận chung một buffer) → server rẻ CPU.

import { MAX_PLAYERS } from './config.js';
import type { Cmd } from './sim.js';
import type { Loadout, Modifier, SimMods } from './progression.js';
import type { RunReward } from './api.js';
import type { WeaponDef } from './content.js';
import type { GroundLoot } from './gear.js';

/* ============================ JSON ============================ */
export interface LobbyPlayer { idx: number; name: string; cls: number; ready: boolean; on: boolean; /** cấp tài khoản (khách: không có) */ level?: number; /** chơi khách (không đăng nhập) */ guest: boolean }
/** chế độ phòng: vô tận (khách được chơi) hoặc vượt ải (bắt buộc đăng nhập) */
export type RoomMode = 'endless' | 'stage';
/** người chơi trong tin 'start' */
export interface StartPlayer {
  idx: number; name: string; cls: number;
  /** chỉ số ảnh hưởng mô phỏng — client PHẢI đưa vào GameModel/newState */
  mods: SimMods;
  look: Loadout['look'];
  /** ải: 1–2 khẩu súng thật (chỉ số 0 = weapon1) — client PHẢI đưa vào GameModel/newState; vô tận: không có */
  weapons?: WeaponDef[];
  /** ải: vật phẩm ô nhanh (phím 3/4) lúc vào trận; số còn lại theo snapshot SnapPlayer.q1/q2 */
  quick?: QuickSlot[];
}
/** ô nhanh: món tiêu hao + số lượng mang vào */
export interface QuickSlot { itemId: string; count: number }
export interface BoardEntry {
  names: string[];
  cls: number[];
  wave: number;
  score: number;
  kills: number;
  players: number;
  at: number;
}
export interface EndStat { idx: number; name: string; cls: number; kills: number; dmg: number; revives: number; earned: number; downs: number }

export type CMsg =
  | { t: 'ping'; c: number }
  | { t: 'create'; name: string; cls: number; solo: boolean; /** id bản đồ hoặc 'random' */ map?: string; mode?: RoomMode; /** id ải (mode 'stage') */ stage?: string }
  | { t: 'join'; code: string; name: string; cls: number; mode?: RoomMode }
  | { t: 'rejoin'; code: string; pid: string; token: string }
  | { t: 'leave' }
  | { t: 'cls'; cls: number }
  | { t: 'ready'; r: boolean }
  | { t: 'start' }
  /** chủ phòng chọn bản đồ (id hoặc 'random') */
  | { t: 'map'; id: string }
  /** chủ phòng chọn ải (phải nằm trong 'stages' của tin room) */
  | { t: 'stage'; stage: string }
  /** chủ phòng đổi chế độ */
  | { t: 'mode'; mode: RoomMode }
  | { t: 'buy'; item: 'weapon' | 'hp' }
  | { t: 'bready'; r: boolean }
  | { t: 'again' }
  /** chơi đơn: tạm dừng thật (khỉ đứng im) */
  | { t: 'pause'; p: boolean }
  /** chat trong phòng (Enter) */
  | { t: 'chat'; m: string }
  | { t: 'lb' }
  /** gắn tài khoản vào kết nối (token từ REST login/register) */
  | { t: 'auth'; token: string };

export type SMsg =
  | { t: 'welcome'; st: number }
  | { t: 'pong'; c: number; st: number }
  | { t: 'joined'; code: string; pid: string; token: string; idx: number; solo: boolean }
  | { t: 'room'; code: string; phase: 'lobby' | 'play' | 'over'; solo: boolean; host: number; players: LobbyPlayer[]; /** lựa chọn bản đồ trong sảnh: id hoặc 'random' */ map: string; mode: RoomMode; /** ải đang chọn (mode 'stage') */ stage: string; /** ải chơi được = giao của các ải mọi thành viên đã mở */ stages: string[] }
  | { t: 'start'; seed: number; players: StartPlayer[]; tick: number; /** id bản đồ đã chốt */ map: string; mode: RoomMode; stage?: string; /** số đợt phải vượt (ải) */ waves?: number; /** luật đặc biệt của ải */ mods?: Modifier[];
      /** false = không có xu/cửa hàng (ải): ẩn xu, phím V/C vô hiệu, kỹ năng miễn phí */ economy: boolean;
      /** ải: túi đồ đang nằm trên đất (khi vào lại giữa trận) */ loot?: GroundLoot[] }
  | { t: 'wave'; n: number; phase: 'fight' | 'break'; ends: number; total: number; boss: boolean; ready: number[] }
  /**
   * sự kiện rời rạc. Ải thêm:
   *  {k:'use', i: người, s: itemId, v: số còn lại, j: ô (0/1)} — dùng vật phẩm ô nhanh
   *  {k:'picked', i: người, v: id túi, s: itemId, j: phẩm} — nhặt túi đồ vào ba lô
   *  {k:'bagfull', i: người} — ba lô đầy (chỉ gửi người đó)
   *  {k:'out', i: người} — chết hẳn trong ải: bị loại, mất đồ mang theo
   */
  | { t: 'ev'; k: string; i?: number; j?: number; v?: number; s?: string }
  /** ải: túi đồ rơi xuống đất */
  | ({ t: 'ev'; k: 'loot' } & GroundLoot)
  /** ải: túi đồ biến mất (nhặt hoặc hết 60 giây) */
  | { t: 'ev'; k: 'unloot'; v: number }
  | { t: 'over'; wave: number; score: number; kills: number; rank: number; secs: number; stats: EndStat[]; board: BoardEntry[]; /** thưởng an ủi (người có tài khoản) */ rewards?: RunReward[]; stage?: string }
  /** vượt ải thành công (phòng chuyển 'over' ngay, không gửi thêm tin 'over') */
  | { t: 'victory'; stage: string; stars: number; secs: number; wave: number; rewards: RunReward[]; stats: EndStat[]; score: number; kills: number }
  | { t: 'lb'; solo: BoardEntry[]; team: BoardEntry[] }
  | { t: 'err'; m: string }
  | { t: 'paused'; p: boolean }
  | { t: 'chat'; i: number; n: string; m: string }
  | { t: 'left' }
  /** trả lời {t:'auth'} thành công (thất bại → {t:'err'}) */
  | { t: 'authed'; username: string; accountId: number };

/* ============================ NHỊ PHÂN ============================ */
export const BIN_CMDS = 1;
export const BIN_SNAP = 2;
export const CMD_BYTES = 12;
export const MAX_CMDS_PER_MSG = 12;

/** đóng gói N lệnh liên tiếp (seq tăng dần 1) */
export function encodeCmds(cmds: Cmd[], from: number, count: number): ArrayBuffer {
  const buf = new ArrayBuffer(6 + count * CMD_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, BIN_CMDS);
  v.setUint8(1, count);
  v.setUint32(2, cmds[from].seq >>> 0, true);
  let o = 6;
  for (let i = 0; i < count; i++) {
    const c = cmds[from + i];
    v.setInt8(o, c.mx);
    v.setInt8(o + 1, c.mz);
    v.setUint16(o + 2, c.yaw & 0xffff, true);
    v.setInt16(o + 4, c.pitch, true);
    v.setUint16(o + 6, c.btn & 0xffff, true);
    v.setUint32(o + 8, c.vt >>> 0, true);
    o += CMD_BYTES;
  }
  return buf;
}

/** giải lệnh vào mảng đích (tái dùng object), trả số lệnh hoặc -1 nếu hỏng */
export function decodeCmds(v: DataView, out: Cmd[]): number {
  if (v.byteLength < 6 || v.getUint8(0) !== BIN_CMDS) return -1;
  const n = v.getUint8(1);
  if (n < 1 || n > MAX_CMDS_PER_MSG || v.byteLength !== 6 + n * CMD_BYTES) return -1;
  const seq0 = v.getUint32(2, true);
  let o = 6;
  for (let i = 0; i < n; i++) {
    const c = out[i];
    c.seq = (seq0 + i) >>> 0;
    c.mx = v.getInt8(o);
    c.mz = v.getInt8(o + 1);
    c.yaw = v.getUint16(o + 2, true);
    c.pitch = v.getInt16(o + 4, true);
    c.btn = v.getUint16(o + 6, true);
    c.vt = v.getUint32(o + 8, true);
    o += CMD_BYTES;
  }
  return n;
}

/* ---------- lượng tử hoá ---------- */
/** đơn vị vị trí khỉ: 1/256 m (i16 → ±128 m) */
export const QP = 256;
export const q16 = (v: number) => {
  const q = Math.round(v * QP);
  return q > 32767 ? 32767 : q < -32768 ? -32768 : q;
};

/* cờ bản ghi khỉ */
export const MF_FULL = 1;
export const MF_HP = 2;
export const MF_ST = 4;
export const MF_YAW = 8;

/* trạng thái hoạt cảnh khỉ */
export const ST_MOVE = 0;
export const ST_WIND = 1;
export const ST_STRIKE = 2;
export const ST_THROW = 3;
export const ST_STUN = 4;
export const ST_FUSE = 5;
export const ST_POUNCE = 6;
export const ST_ROAR = 7;
export const ST_DROP = 8;
export const ST_SLAM = 9;
/** bit cao của byte trạng thái */
export const STX_SLOW = 16;
export const STX_TAUNT = 32;

/* cờ người chơi */
export const PF_DOWN_MASK = 3;
export const PF_GROUND = 4;
export const PF_ADS = 8;
export const PF_SPRINT = 16;
export const PF_REVIVING = 32;
export const PF_ON = 64;
export const PF_BRACE = 128;

/* thực thể đặt (trụ, rào, trạm hồi) */
export const EN_TURRET = 1;
export const EN_BARRICADE = 2;
export const EN_POD = 3;
export const EN_FLARE = 4;
export const EN_PICKUP = 5;

/* đạn bay (server mô phỏng, client tự vẽ đường bay xác định) */
export const PJ_BANANA = 1;
export const PJ_GRENADE = 2;
export const PJ_BARREL = 3;
export const PJ_SHELL = 4; // pháo chuối của người chơi

/* hiệu ứng rời rạc */
export const FX_EXPLODE = 1;
export const FX_SLAM = 2;
export const FX_SHOCK = 3;
export const FX_HEAL = 4;
export const FX_ROAR = 5;
export const FX_STOMP = 6;
export const FX_SPLAT = 7;
export const FX_AIRSTRIKE = 8;
export const FX_PLAYERHIT = 9;
export const FX_BUILD = 10;
export const FX_REPAIR = 11;
export const FX_PICK = 12;

/* pha */
export const PH_FIGHT = 1;
export const PH_BREAK = 2;
export const PH_OVER = 3;

export interface SnapPlayer {
  idx: number; flags: number; cls: number; tier: number; hpTier: number;
  x: number; z: number; y: number; vx: number; vz: number; vy: number;
  yaw: number; pitch: number; ack: number;
  hp: number; maxHp: number; shield: number;
  ammo: number; fireCd: number; reloadT: number; braceT: number;
  cdG: number; cdX: number; ult: number; revive: number; bleed: number;
  cash: number; kills: number;
  /** ải: ô súng đang cầm, đếm ngược đổi súng, đạn khẩu kia */
  wslot: number; swapT: number; ammoAlt: number;
  /** tăng tốc tạm thời (tick 60Hz còn lại, hệ số) */
  spdT: number; spdMul: number;
  /** số vật phẩm còn lại ở ô nhanh 1/2 */
  q1: number; q2: number;
  /** số món trong ba lô trận */
  bag: number;
}

export function newSnapPlayer(): SnapPlayer {
  return {
    idx: 0, flags: 0, cls: 0, tier: 0, hpTier: 0, x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, ack: 0,
    hp: 0, maxHp: 0, shield: 0, ammo: 0, fireCd: 0, reloadT: 0, braceT: 0, cdG: 0, cdX: 0, ult: 0, revive: 0, bleed: 0, cash: 0, kills: 0,
    wslot: 0, swapT: 0, ammoAlt: 0, spdT: 0, spdMul: 1, q1: 0, q2: 0, bag: 0,
  };
}

/** Snapshot đã giải (mảng cấp phát một lần, dùng lại) */
export class SnapData {
  tick = 0;
  key = false;
  phase = 0;
  wave = 0;
  left = 0;
  bossHp = 0; // 0..65535 tỉ lệ máu boss, 0 = không có boss
  np = 0;
  players: SnapPlayer[] = Array.from({ length: MAX_PLAYERS }, newSnapPlayer);
  // khỉ
  nm = 0;
  mSlot = new Uint8Array(256);
  mFlags = new Uint8Array(256);
  mType = new Uint8Array(256);
  mA = new Int16Array(256); // full: qx, delta: dx
  mB = new Int16Array(256); // full: qz, delta: dz
  mYaw = new Uint8Array(256);
  mHp = new Uint8Array(256);
  mSt = new Uint8Array(256);
  // khỉ bị xoá
  nr = 0;
  rSlot = new Uint8Array(256);
  rKiller = new Uint8Array(256);
  rCause = new Uint8Array(256);
  // trúng đạn
  nh = 0;
  hSlot = new Uint8Array(256);
  hDmg = new Uint16Array(256);
  hShooter = new Uint8Array(256);
  hCrit = new Uint8Array(256);
  // phát bắn của người khác (vẽ vệt đạn)
  ns = 0;
  sShooter = new Uint8Array(64);
  sYaw = new Uint16Array(64);
  sPitch = new Int16Array(64);
  sDist = new Uint8Array(64);
  // thực thể đặt
  ne = 0;
  eId = new Uint16Array(64);
  eKind = new Uint8Array(64);
  eOwner = new Uint8Array(64);
  eX = new Int16Array(64);
  eZ = new Int16Array(64);
  eYaw = new Uint8Array(64);
  eLife = new Uint8Array(64);
  // đạn bay mới
  np2 = 0;
  pId = new Uint16Array(64);
  pKind = new Uint8Array(64);
  pOwner = new Uint8Array(64);
  pX = new Int16Array(64);
  pY = new Int16Array(64);
  pZ = new Int16Array(64);
  pVX = new Int16Array(64);
  pVY = new Int16Array(64);
  pVZ = new Int16Array(64);
  // đạn bay kết thúc
  npe = 0;
  peId = new Uint16Array(64);
  // hiệu ứng
  nf = 0;
  fKind = new Uint8Array(64);
  fX = new Int16Array(64);
  fZ = new Int16Array(64);
  fA = new Uint8Array(64);
  fB = new Uint16Array(64);
}

/** lượng tử hệ số tăng tốc (SnapPlayer.spdMul = byte / SPD_Q) */
export const SPD_Q = 50;
/** đạn tối đa một băng (snapshot ghi u8) */
export const MAX_MAG = 255;

/** đơn vị vận tốc đạn: 1/128 m/s */
export const QV = 128;

export function decodeSnap(v: DataView, s: SnapData): boolean {
  if (v.getUint8(0) !== BIN_SNAP) return false;
  let o = 1;
  s.tick = v.getUint32(o, true); o += 4;
  const fl = v.getUint8(o++);
  s.key = (fl & 1) !== 0;
  s.phase = v.getUint8(o++);
  s.wave = v.getUint16(o, true); o += 2;
  s.left = v.getUint16(o, true); o += 2;
  s.bossHp = v.getUint16(o, true); o += 2;
  // người chơi
  s.np = v.getUint8(o++);
  if (s.np > MAX_PLAYERS) return false;
  for (let i = 0; i < s.np; i++) {
    const p = s.players[i];
    p.idx = v.getUint8(o++);
    if (p.idx >= MAX_PLAYERS) return false;
    p.flags = v.getUint8(o++);
    p.cls = v.getUint8(o++);
    const t = v.getUint8(o++);
    p.tier = t & 15;
    p.hpTier = t >> 4;
    p.x = v.getFloat32(o, true); o += 4;
    p.z = v.getFloat32(o, true); o += 4;
    p.y = v.getFloat32(o, true); o += 4;
    p.vx = v.getFloat32(o, true); o += 4;
    p.vz = v.getFloat32(o, true); o += 4;
    p.vy = v.getFloat32(o, true); o += 4;
    p.yaw = v.getUint16(o, true); o += 2;
    p.pitch = v.getInt16(o, true); o += 2;
    p.ack = v.getUint32(o, true); o += 4;
    p.hp = v.getUint16(o, true); o += 2;
    p.maxHp = v.getUint16(o, true); o += 2;
    p.shield = v.getUint16(o, true); o += 2;
    p.ammo = v.getUint8(o++);
    p.fireCd = v.getUint16(o, true); o += 2;
    p.reloadT = v.getUint8(o++);
    p.braceT = v.getUint16(o, true); o += 2;
    p.cdG = v.getUint8(o++);
    p.cdX = v.getUint8(o++);
    p.ult = v.getUint8(o++);
    p.revive = v.getUint8(o++);
    p.bleed = v.getUint8(o++);
    p.cash = v.getUint32(o, true); o += 4;
    p.kills = v.getUint16(o, true); o += 2;
    p.wslot = v.getUint8(o++);
    p.swapT = v.getUint8(o++);
    p.ammoAlt = v.getUint8(o++);
    p.spdT = v.getUint16(o, true); o += 2;
    p.spdMul = v.getUint8(o++) / SPD_Q;
    p.q1 = v.getUint8(o++);
    p.q2 = v.getUint8(o++);
    p.bag = v.getUint8(o++);
  }
  // khỉ
  s.nm = v.getUint8(o++);
  for (let i = 0; i < s.nm; i++) {
    s.mSlot[i] = v.getUint8(o++);
    const f = v.getUint8(o++);
    s.mFlags[i] = f;
    if (f & MF_FULL) {
      s.mType[i] = v.getUint8(o++);
      s.mA[i] = v.getInt16(o, true); o += 2;
      s.mB[i] = v.getInt16(o, true); o += 2;
      s.mYaw[i] = v.getUint8(o++);
      s.mHp[i] = v.getUint8(o++);
      s.mSt[i] = v.getUint8(o++);
    } else {
      s.mA[i] = v.getInt8(o++);
      s.mB[i] = v.getInt8(o++);
      if (f & MF_YAW) s.mYaw[i] = v.getUint8(o++);
      if (f & MF_HP) s.mHp[i] = v.getUint8(o++);
      if (f & MF_ST) s.mSt[i] = v.getUint8(o++);
    }
  }
  s.nr = v.getUint8(o++);
  for (let i = 0; i < s.nr; i++) {
    s.rSlot[i] = v.getUint8(o++);
    s.rKiller[i] = v.getUint8(o++);
    s.rCause[i] = v.getUint8(o++);
  }
  s.nh = v.getUint8(o++);
  for (let i = 0; i < s.nh; i++) {
    s.hSlot[i] = v.getUint8(o++);
    s.hDmg[i] = v.getUint16(o, true); o += 2;
    const b = v.getUint8(o++);
    s.hShooter[i] = b & 127;
    s.hCrit[i] = b >> 7;
  }
  s.ns = v.getUint8(o++);
  for (let i = 0; i < s.ns; i++) {
    s.sShooter[i] = v.getUint8(o++);
    s.sYaw[i] = v.getUint16(o, true); o += 2;
    s.sPitch[i] = v.getInt16(o, true); o += 2;
    s.sDist[i] = v.getUint8(o++);
  }
  s.ne = v.getUint8(o++);
  for (let i = 0; i < s.ne; i++) {
    s.eId[i] = v.getUint16(o, true); o += 2;
    s.eKind[i] = v.getUint8(o++);
    s.eOwner[i] = v.getUint8(o++);
    s.eX[i] = v.getInt16(o, true); o += 2;
    s.eZ[i] = v.getInt16(o, true); o += 2;
    s.eYaw[i] = v.getUint8(o++);
    s.eLife[i] = v.getUint8(o++);
  }
  s.np2 = v.getUint8(o++);
  for (let i = 0; i < s.np2; i++) {
    s.pId[i] = v.getUint16(o, true); o += 2;
    s.pKind[i] = v.getUint8(o++);
    s.pOwner[i] = v.getUint8(o++);
    s.pX[i] = v.getInt16(o, true); o += 2;
    s.pY[i] = v.getInt16(o, true); o += 2;
    s.pZ[i] = v.getInt16(o, true); o += 2;
    s.pVX[i] = v.getInt16(o, true); o += 2;
    s.pVY[i] = v.getInt16(o, true); o += 2;
    s.pVZ[i] = v.getInt16(o, true); o += 2;
  }
  s.npe = v.getUint8(o++);
  for (let i = 0; i < s.npe; i++) {
    s.peId[i] = v.getUint16(o, true); o += 2;
  }
  s.nf = v.getUint8(o++);
  for (let i = 0; i < s.nf; i++) {
    s.fKind[i] = v.getUint8(o++);
    s.fX[i] = v.getInt16(o, true); o += 2;
    s.fZ[i] = v.getInt16(o, true); o += 2;
    s.fA[i] = v.getUint8(o++);
    s.fB[i] = v.getUint16(o, true); o += 2;
  }
  return o === v.byteLength;
}

/** Bộ ghi nhị phân tái dùng buffer (server) */
export class Writer {
  buf: ArrayBuffer;
  v: DataView;
  o = 0;
  constructor(size = 16384) {
    this.buf = new ArrayBuffer(size);
    this.v = new DataView(this.buf);
  }
  reset() { this.o = 0; }
  ensure(n: number) {
    if (this.o + n <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb;
    this.v = new DataView(nb);
  }
  u8(x: number) { this.ensure(1); this.v.setUint8(this.o++, x); }
  i8(x: number) { this.ensure(1); this.v.setInt8(this.o++, x); }
  u16(x: number) { this.ensure(2); this.v.setUint16(this.o, x, true); this.o += 2; }
  i16(x: number) { this.ensure(2); this.v.setInt16(this.o, x, true); this.o += 2; }
  u32(x: number) { this.ensure(4); this.v.setUint32(this.o, x >>> 0, true); this.o += 4; }
  f32(x: number) { this.ensure(4); this.v.setFloat32(this.o, x, true); this.o += 4; }
  /** ghi đè u8 tại vị trí cũ (dùng cho bộ đếm) */
  put8(at: number, x: number) { this.v.setUint8(at, x); }
  /** bản sao gọn (gửi đi) */
  bytes(): Uint8Array { return new Uint8Array(this.buf.slice(0, this.o)); }
}
