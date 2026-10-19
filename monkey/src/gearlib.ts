// Lớp chuyển đổi giữa giao diện và dữ liệu đồ đạc v2 (shared/monkey/gear.ts + progression.ts).
// Mọi màn (paperdoll, hành trang, thương nhân, HUD, tổng kết) đọc đồ qua file này: món chuẩn hoá (Inv),
// định nghĩa (Def2), chỉ số, súng từ món, giá bán, vị trí ô lưới (lưu cục bộ), ô mặc nhanh.

import type { MeResponse } from '@shared/monkey/api';
import { CLASSES, type WeaponDef } from '@shared/monkey/content';
import { SLOT_ACCEPTS, type ConsumableEffect, type EquipSlot, type Grade, type ItemKind, type StatKey2 } from '@shared/monkey/gear';
import {
  BAG_CAP, GRADES, ITEMS, ITEM_BY_ID, SHOP_STOCK, STARTER_KIT, STASH_CAP, STAT2_INFO, canClaimStarter, itemLevelReq, itemStats, sellPrice as sellPriceOf,
  weaponFromItem, type ItemDef2, type ItemInst,
} from '@shared/monkey/progression';
import { store } from './settings';

/* ======================= PHẨM ======================= */
/** màu phẩm kiểu VLTK (đồng bộ với CSS --g0..--g4 và cột sáng túi đồ) */
export const GRADE_COLORS = ['#ecebe6', '#4fa8ff', '#c07bff', '#ffd84a', '#ff8c24'] as const;
export const clampGrade = (g: unknown): Grade => Math.max(0, Math.min(4, Number(g) | 0)) as Grade;
export function gradeColor(g: number) {
  return GRADE_COLORS[clampGrade(g)];
}
export function gradeName(g: number) {
  return GRADES[clampGrade(g)].name;
}
/** "Tím · Hiếm" */
export function gradeLabel(g: number) {
  const G = GRADES[clampGrade(g)];
  return `${G.name} · ${G.tier}`;
}

/* ======================= CHỈ SỐ ======================= */
export const STAT_KEYS = Object.keys(STAT2_INFO) as StatKey2[];
export function statInfo(k: StatKey2): { name: string; pct: boolean } {
  return STAT2_INFO[k] ?? { name: k, pct: false };
}
export function fmtStat(k: StatKey2, v: number, sign = true) {
  const pct = statInfo(k).pct;
  const s = sign ? (v >= 0 ? '+' : '−') : '';
  const a = Math.abs(v);
  if (pct) {
    const p = a * 100;
    return `${s}${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
  }
  return `${s}${a >= 10 || Number.isInteger(a) ? Math.round(a) : Math.round(a * 10) / 10}`;
}
export type StatMap = Partial<Record<StatKey2, number>>;

/* ======================= LOẠI ĐỒ ======================= */
export const KIND_NAME: Record<ItemKind, string> = {
  gun: 'Súng', knife: 'Dao', helmet: 'Mũ', armor: 'Giáp', gloves: 'Bao tay', boots: 'Giày', belt: 'Đai lưng',
  amulet: 'Hộ phù', ring: 'Nhẫn', skin: 'Trang phục', consumable: 'Tiêu hao', material: 'Nguyên liệu',
};
export const KIND_ICON: Record<ItemKind, string> = {
  gun: '🔫', knife: '🔪', helmet: '⛑️', armor: '🦺', gloves: '🧤', boots: '🥾', belt: '🎗️', amulet: '📿', ring: '💍', skin: '👕', consumable: '🧪', material: '💎',
};
export const EQUIP_SLOTS = Object.keys(SLOT_ACCEPTS) as EquipSlot[];
export const SLOT_NAME: Record<EquipSlot, string> = {
  weapon1: 'Súng chính', weapon2: 'Súng phụ', knife: 'Dao', helmet: 'Mũ', armor: 'Giáp', gloves: 'Bao tay', boots: 'Giày', belt: 'Đai lưng',
  amulet: 'Hộ phù', ring1: 'Nhẫn trái', ring2: 'Nhẫn phải', skin: 'Trang phục', quick1: 'Ô nhanh [3]', quick2: 'Ô nhanh [4]', secure: 'Túi an toàn',
};
export const SLOT_KIND: Record<EquipSlot, ItemKind> = {
  weapon1: 'gun', weapon2: 'gun', knife: 'knife', helmet: 'helmet', armor: 'armor', gloves: 'gloves', boots: 'boots', belt: 'belt',
  amulet: 'amulet', ring1: 'ring', ring2: 'ring', skin: 'skin', quick1: 'consumable', quick2: 'consumable', secure: 'material',
};

/* ======================= ĐỊNH NGHĨA MÓN ======================= */
export interface Look { kind: string; color: number; accent?: number }
export interface Def2 {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  look: Look;
  /** cấp tối thiểu riêng của món (cấp thật còn tuỳ phẩm — xem levelReqOf) */
  levelReq: number;
  /** số tối đa một chồng (1 = không xếp chồng) */
  stack: number;
  base: StatMap;
  /** súng: họ mô hình */
  gun?: { model: string };
  consumable?: ConsumableEffect;
  special?: boolean;
  raw: ItemDef2;
}
const defCache = new Map<string, Def2 | null>();
export function defOf(itemId: string | undefined | null): Def2 | undefined {
  if (!itemId) return undefined;
  const c = defCache.get(itemId);
  if (c !== undefined) return c ?? undefined;
  const d = ITEM_BY_ID[itemId];
  if (!d) {
    defCache.set(itemId, null);
    return undefined;
  }
  const def: Def2 = {
    id: d.id,
    name: d.name,
    kind: d.kind,
    desc: d.desc ?? '',
    look: d.look,
    levelReq: d.levelReq ?? 1,
    stack: d.stack ?? 1,
    base: d.base ?? {},
    gun: d.gun ? { model: d.gun.family } : undefined,
    consumable: d.consumable,
    special: !!d.special,
    raw: d,
  };
  defCache.set(itemId, def);
  return def;
}
export function allDefs(): Def2[] {
  return ITEMS.map((d) => defOf(d.id)).filter((d): d is Def2 => !!d);
}
export function itemName(itemId: string) {
  return defOf(itemId)?.name ?? itemId;
}

/* ======================= MÓN SỞ HỮU ======================= */
export interface Inv {
  uid: number;
  itemId: string;
  grade: Grade;
  level: number;
  affixes: StatMap;
  count: number;
  /** ô đang mặc (null = trong túi / kho) */
  slot: EquipSlot | null;
  stash: boolean;
  raw: ItemInst;
}
export function normInst(it: Partial<ItemInst> & { itemId: string; subs?: StatMap }): Inv {
  const slot = it.slot && EQUIP_SLOTS.includes(it.slot) ? it.slot : null;
  const raw: ItemInst = {
    uid: Number(it.uid ?? -1),
    itemId: String(it.itemId),
    grade: clampGrade(it.grade ?? 0),
    level: Math.max(1, Number(it.level ?? 1) || 1),
    affixes: (it.affixes ?? it.subs ?? {}) as StatMap,
    count: Math.max(1, Number(it.count ?? 1) || 1),
    slot,
    stash: !!it.stash,
  };
  return { ...raw, raw };
}
/** món tạm (đồ rơi trong trận / hàng cửa hàng — chưa có uid) */
export function dropInst(d: { itemId: string; grade: number; subs?: StatMap; affixes?: StatMap; count?: number; level?: number }, uid = -1): Inv {
  return normInst({ uid, itemId: d.itemId, grade: clampGrade(d.grade), level: d.level ?? 1, affixes: d.affixes ?? d.subs ?? {}, count: d.count ?? 1, slot: null, stash: false });
}

let invCacheKey: unknown = null;
let invCache: Inv[] = [];
export function invOf(me: MeResponse | null | undefined): Inv[] {
  if (!me) return [];
  if (invCacheKey === me.items) return invCache;
  invCacheKey = me.items;
  invCache = me.items.map((i) => normInst(i));
  return invCache;
}
export function equippedMap(me: MeResponse | null | undefined): Map<EquipSlot, Inv> {
  const m = new Map<EquipSlot, Inv>();
  for (const it of invOf(me)) if (it.slot) m.set(it.slot, it);
  return m;
}
export const bagItems = (me: MeResponse | null | undefined) => invOf(me).filter((i) => !i.slot && !i.stash);
export const stashItems = (me: MeResponse | null | undefined) => invOf(me).filter((i) => !i.slot && i.stash);
export const BAG_SIZE = BAG_CAP;
export const STASH_SIZE = STASH_CAP;
/** cấp nhân vật cần để mặc món (theo phẩm) */
export function levelReqOf(it: Inv): number {
  return itemLevelReq(ITEM_BY_ID[it.itemId], it.grade);
}

/* ======================= TÍNH TOÁN ======================= */
/** chỉ số của một món (gốc × phẩm × cấp + dòng phụ) — súng: chỉ dòng phụ (chỉ số bắn nằm trong WeaponDef) */
export function instStats(it: Inv): StatMap {
  return itemStats(it.raw);
}
/** chỉ số gốc (không tính dòng phụ) — để tách dòng trắng / dòng xanh trong tooltip */
export function baseStats(it: Inv): StatMap {
  return itemStats({ ...it.raw, affixes: {} });
}
export function sumStats(items: Iterable<Inv>): StatMap {
  const out: StatMap = {};
  for (const it of items) {
    if (it.slot === 'secure' || it.slot === 'quick1' || it.slot === 'quick2') continue;
    for (const [k, v] of Object.entries(instStats(it)) as [StatKey2, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}
/** súng thật từ món súng (server tính đúng hàm này ở đầu trận); extra = tốc bắn/nạp/băng/xuyên từ đồ khác */
export function weaponOfItem(it: Inv | null | undefined, cls: number, extra: StatMap = {}): WeaponDef {
  return weaponFromItem(it?.raw ?? null, CLASSES[cls] ? cls : 0, extra);
}
/** phần chỉ số nướng vào súng từ đồ đang mặc (không tính chính khẩu súng) */
export function bakedExtra(me: MeResponse | null | undefined): StatMap {
  const st: StatMap = {};
  for (const it of equippedMap(me).values()) {
    if (it.slot === 'secure' || defOf(it.itemId)?.kind === 'gun') continue;
    for (const k of ['fireRate', 'reload', 'mag', 'pierce'] as const) st[k] = (st[k] ?? 0) + (instStats(it)[k] ?? 0);
  }
  return st;
}
/** sát thương mỗi giây (lý thuyết) và tính cả nạp đạn */
export function weaponDps(w: WeaponDef, reloadMul = 1) {
  const perShot = w.dmg * w.pellets + (w.splashDmg ?? 0);
  const shotSec = Math.max(1e-3, w.interval / 100 / 60);
  const raw = perShot / shotSec;
  const magTime = w.mag * shotSec + (w.reload * reloadMul) / 60;
  const sustained = (perShot * w.mag) / Math.max(1e-3, magTime);
  return { raw, sustained, rpm: 60 / shotSec };
}
export function sellPrice(it: Inv): number {
  return sellPriceOf(it.raw);
}

/* ======================= CỬA HÀNG ======================= */
export interface StockRow { idx: number; itemId: string; grade: Grade; price: number; count: number; def: Def2 }
export function shopStock(): StockRow[] {
  const out: StockRow[] = [];
  SHOP_STOCK.forEach((r, idx) => {
    const def = defOf(r.itemId);
    if (def) out.push({ idx, itemId: r.itemId, grade: r.grade, price: r.price, count: 1, def });
  });
  return out;
}
export function starterKit(): string[] {
  return STARTER_KIT.map((x) => x.itemId);
}
/** còn được nhận bộ tân binh? (server là nơi quyết định cuối) */
export function starterEligible(me: MeResponse | null | undefined) {
  return !!me && canClaimStarter(me.items);
}

/* ======================= MẶC / Ô ======================= */
export function slotAccepts(slot: EquipSlot, def: Def2 | undefined) {
  return !!def && (SLOT_ACCEPTS[slot] ?? []).includes(def.kind);
}
/** ô phù hợp nhất để mặc nhanh (chuột phải / nháy đúp) */
export function bestSlotFor(me: MeResponse | null | undefined, it: Inv): EquipSlot | null {
  const def = defOf(it.itemId);
  if (!def || def.kind === 'material') return null;
  const eq = equippedMap(me);
  const pair = (a: EquipSlot, b: EquipSlot) => (!eq.get(a) ? a : !eq.get(b) ? b : a);
  if (def.kind === 'gun') return pair('weapon1', 'weapon2');
  if (def.kind === 'ring') return pair('ring1', 'ring2');
  if (def.kind === 'consumable') {
    // cùng loại đã nằm ở ô nhanh → gộp vào ô đó
    for (const s of ['quick1', 'quick2'] as const) if (eq.get(s)?.itemId === it.itemId) return s;
    return pair('quick1', 'quick2');
  }
  return EQUIP_SLOTS.find((s) => s !== 'secure' && SLOT_KIND[s] === def.kind) ?? null;
}
/** món đang mặc để so sánh với `it` */
export function compareTarget(me: MeResponse | null | undefined, it: Inv): Inv | null {
  if (it.slot) return null;
  const def = defOf(it.itemId);
  if (!def || def.kind === 'consumable' || def.kind === 'material') return null;
  const eq = equippedMap(me);
  if (def.kind === 'gun') return eq.get('weapon1') ?? eq.get('weapon2') ?? null;
  if (def.kind === 'ring') return eq.get('ring1') ?? eq.get('ring2') ?? null;
  const s = EQUIP_SLOTS.find((x) => x !== 'secure' && SLOT_KIND[x] === def.kind);
  return s ? eq.get(s) ?? null : null;
}

/** ngoại hình avatar từ đồ đang mặc: ô → itemId */
export type GearLook = Partial<Record<EquipSlot | 'gun', string>>;
export function lookOf(me: MeResponse | null | undefined): GearLook {
  const look: GearLook = {};
  for (const [s, it] of equippedMap(me)) {
    if (s === 'secure' || s === 'quick1' || s === 'quick2') continue;
    look[s] = it.itemId;
  }
  if (look.weapon1) look.gun = look.weapon1;
  return look;
}

/* ======================= VỊ TRÍ Ô TRONG LƯỚI (lưu cục bộ) ======================= */
type Layout = Record<string, number>;
const LAYOUT_KEY = 'monkey-bag-layout';
let layout: { bag: Layout; stash: Layout } | null = null;
function loadLayout() {
  if (layout) return layout;
  try {
    const o = JSON.parse(store(LAYOUT_KEY) ?? 'null');
    layout = { bag: o?.bag ?? {}, stash: o?.stash ?? {} };
  } catch {
    layout = { bag: {}, stash: {} };
  }
  return layout;
}
function saveLayout() {
  if (layout) store(LAYOUT_KEY, JSON.stringify(layout));
}
/** xếp các món vào ô lưới: giữ ô cũ, món mới vào ô trống đầu tiên */
export function gridOf(list: Inv[], which: 'bag' | 'stash', size: number): (Inv | null)[] {
  const L = loadLayout()[which];
  const cells: (Inv | null)[] = new Array(Math.max(size, list.length)).fill(null);
  const rest: Inv[] = [];
  for (const it of list) {
    const c = L[it.uid];
    if (c !== undefined && c >= 0 && c < cells.length && !cells[c]) cells[c] = it;
    else rest.push(it);
  }
  let k = 0;
  for (const it of rest) {
    while (k < cells.length && cells[k]) k++;
    if (k >= cells.length) cells.push(it);
    else cells[k] = it;
    L[it.uid] = cells.indexOf(it);
  }
  // dọn uid không còn
  const live = new Set(list.map((i) => String(i.uid)));
  for (const u of Object.keys(L)) if (!live.has(u)) delete L[u];
  saveLayout();
  return cells;
}
/** đặt món vào ô (đổi chỗ nếu ô có món) */
export function placeAt(which: 'bag' | 'stash', uid: number, cell: number, occupant: number | null) {
  const L = loadLayout()[which];
  const old = L[uid];
  if (occupant !== null && occupant !== uid) {
    if (old !== undefined) L[occupant] = old;
    else delete L[occupant];
  }
  L[uid] = cell;
  saveLayout();
}
/** nhớ ô muốn đặt cho món sắp chuyển sang lưới khác */
export function preferCell(which: 'bag' | 'stash', uid: number, cell: number) {
  const L = loadLayout()[which];
  for (const [u, c] of Object.entries(L)) if (c === cell && Number(u) !== uid) return;
  L[uid] = cell;
  saveLayout();
}
const KIND_ORDER: ItemKind[] = ['gun', 'knife', 'helmet', 'armor', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'skin', 'consumable', 'material'];
export function sortGrid(list: Inv[], which: 'bag' | 'stash') {
  const L = loadLayout()[which];
  const sorted = [...list].sort((a, b) => {
    const da = defOf(a.itemId), db = defOf(b.itemId);
    return KIND_ORDER.indexOf(da?.kind ?? 'material') - KIND_ORDER.indexOf(db?.kind ?? 'material') || b.grade - a.grade || b.level - a.level || a.itemId.localeCompare(b.itemId) || a.uid - b.uid;
  });
  for (const k of Object.keys(L)) delete L[k];
  sorted.forEach((it, i) => (L[it.uid] = i));
  saveLayout();
}

/* ======================= BẢNG RỚT THEO PHẨM ======================= */
/** trọng số 5 phẩm cho bảng rớt của ải (dữ liệu cũ 4 bậc → bù bậc Cam = 0) */
export function gradeWeights(w: readonly number[] | undefined): number[] {
  const a = [...(w ?? [])].map((x) => Math.max(0, Number(x) || 0));
  while (a.length < 5) a.push(0);
  return a.slice(0, 5);
}
