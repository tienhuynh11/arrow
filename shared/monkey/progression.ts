// Tiến trình lâu dài của Bầy Khỉ: đồ đạc, độ hiếm, nhân vật mở khoá, nâng kỹ năng, cấp người chơi,
// danh sách ải (vượt ải) và bảng rớt đồ. Thuần dữ liệu + hàm thuần — server, client và test cùng đọc.
// Mọi việc "tung xúc xắc" nhận rng từ ngoài vào (server dùng crypto) để test được.

/* ======================= ĐỘ HIẾM ======================= */
export type Rarity = 0 | 1 | 2 | 3;
export const RARITY = [
  { id: 0, name: 'Thường', color: '#9ca3af', mul: 1, subs: 0, salvage: 15 },
  { id: 1, name: 'Hiếm', color: '#38bdf8', mul: 1.35, subs: 1, salvage: 40 },
  { id: 2, name: 'Sử thi', color: '#a855f7', mul: 1.8, subs: 2, salvage: 110 },
  { id: 3, name: 'Huyền thoại', color: '#f59e0b', mul: 2.5, subs: 3, salvage: 300 },
] as const;

/* ======================= CHỈ SỐ ======================= */
export type StatKey = 'hp' | 'armor' | 'dmg' | 'headDmg' | 'reload' | 'fireRate' | 'speed' | 'cashGain' | 'knifeDmg' | 'luck';
/** chỉ số đã cộng dồn (đơn vị: hp = điểm máu, knifeDmg = điểm, còn lại là % dạng 0.10 = +10%) */
export type Stats = Partial<Record<StatKey, number>>;
export const STAT_INFO: Record<StatKey, { name: string; pct: boolean; cap: number }> = {
  hp: { name: 'Máu', pct: false, cap: 150 },
  armor: { name: 'Giáp', pct: true, cap: 0.4 },
  dmg: { name: 'Sát thương', pct: true, cap: 0.6 },
  headDmg: { name: 'Bắn đầu', pct: true, cap: 0.8 },
  reload: { name: 'Nạp đạn nhanh', pct: true, cap: 0.3 },
  fireRate: { name: 'Tốc bắn', pct: true, cap: 0.25 },
  speed: { name: 'Tốc chạy', pct: true, cap: 0.12 },
  cashGain: { name: 'Xu nhận', pct: true, cap: 0.5 },
  knifeDmg: { name: 'Sát thương dao', pct: false, cap: 400 },
  luck: { name: 'May mắn', pct: true, cap: 0.5 },
};

/* ======================= ĐỒ ======================= */
export type Slot = 'helmet' | 'armor' | 'gun' | 'knife' | 'skin';
export const SLOTS: { id: Slot; name: string; icon: string }[] = [
  { id: 'helmet', name: 'Mũ', icon: '⛑️' },
  { id: 'armor', name: 'Giáp', icon: '🦺' },
  { id: 'gun', name: 'Súng', icon: '🔫' },
  { id: 'knife', name: 'Dao', icon: '🔪' },
  { id: 'skin', name: 'Trang phục', icon: '👕' },
];

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  /** mô tả ngắn */
  desc: string;
  /** độ hiếm thấp/cao nhất có thể rớt */
  minR: Rarity;
  maxR: Rarity;
  /** chỉ số gốc ở độ hiếm Thường, cấp 1 */
  base: Stats;
  /** chỉ số phụ có thể tung thêm (theo RARITY.subs) */
  subPool: StatKey[];
  /** hình dáng hiển thị (avatar + icon); mũ: kiểu mũ; dao: kiểu dao; súng: màu; skin: bảng màu */
  look: { kind: string; color: number; accent?: number };
  /** chỉ có từ sự kiện / phần thưởng, không rớt ngẫu nhiên */
  special?: boolean;
}

export const ITEMS: ItemDef[] = [
  // ---- mũ ----
  { id: 'h_tre', slot: 'helmet', name: 'Nón Lá', desc: 'Nhẹ, mát, che nắng.', minR: 0, maxR: 1, base: { hp: 10 }, subPool: ['speed', 'luck'], look: { kind: 'nonla', color: 0xe8c872 } },
  { id: 'h_sat', slot: 'helmet', name: 'Mũ Sắt', desc: 'Mũ lính cứng cáp.', minR: 0, maxR: 2, base: { hp: 20, armor: 0.03 }, subPool: ['armor', 'hp', 'headDmg'], look: { kind: 'helmet', color: 0x5b6b3a } },
  { id: 'h_ky', slot: 'helmet', name: 'Mũ Kỵ Sĩ', desc: 'Che kín đầu, khó gục.', minR: 1, maxR: 3, base: { hp: 30, armor: 0.05 }, subPool: ['armor', 'hp', 'dmg'], look: { kind: 'knight', color: 0x9ca3af, accent: 0xdc2626 } },
  { id: 'h_xathu', slot: 'helmet', name: 'Mũ Thợ Săn', desc: 'Tập trung vào điểm yếu.', minR: 1, maxR: 3, base: { headDmg: 0.12 }, subPool: ['headDmg', 'dmg', 'reload'], look: { kind: 'hunter', color: 0x4d5e2a } },
  { id: 'h_chuoi', slot: 'helmet', name: 'Mũ Chuối Vàng', desc: 'Phần thưởng sự kiện Tuần Lễ Chuối Vàng.', minR: 2, maxR: 3, base: { hp: 25, luck: 0.1, cashGain: 0.1 }, subPool: ['luck', 'cashGain', 'dmg'], look: { kind: 'banana', color: 0xffd23f }, special: true },
  // ---- giáp ----
  { id: 'a_vai', slot: 'armor', name: 'Áo Vải Dày', desc: 'Đỡ được chút ít.', minR: 0, maxR: 1, base: { hp: 15 }, subPool: ['hp', 'speed'], look: { kind: 'vest', color: 0x8b7355 } },
  { id: 'a_da', slot: 'armor', name: 'Giáp Da', desc: 'Nhẹ mà chắc.', minR: 0, maxR: 2, base: { hp: 20, armor: 0.04 }, subPool: ['armor', 'speed', 'reload'], look: { kind: 'leather', color: 0x6b4423 } },
  { id: 'a_thep', slot: 'armor', name: 'Giáp Thép', desc: 'Nặng nhưng trâu.', minR: 1, maxR: 3, base: { hp: 35, armor: 0.08 }, subPool: ['armor', 'hp'], look: { kind: 'plate', color: 0x9ca3af } },
  { id: 'a_tre', slot: 'armor', name: 'Giáp Tre Đan', desc: 'Giáp của dân làng, rất bền.', minR: 1, maxR: 3, base: { hp: 25, armor: 0.06, cashGain: 0.05 }, subPool: ['armor', 'cashGain', 'luck'], look: { kind: 'bamboo', color: 0xa3b84a } },
  // ---- súng (cộng cho cả dòng súng của nhân vật + đổi màu súng) ----
  { id: 'g_ongvo', slot: 'gun', name: 'Báng Súng Ong Vò Vẽ', desc: 'Bắn nhanh hơn.', minR: 0, maxR: 2, base: { fireRate: 0.04 }, subPool: ['fireRate', 'dmg', 'reload'], look: { kind: 'gun', color: 0xfacc15, accent: 0x111827 } },
  { id: 'g_ranlua', slot: 'gun', name: 'Nòng Rắn Lửa', desc: 'Đạn nóng, sát thương cao.', minR: 0, maxR: 3, base: { dmg: 0.06 }, subPool: ['dmg', 'headDmg', 'fireRate'], look: { kind: 'gun', color: 0xdc2626, accent: 0xf97316 } },
  { id: 'g_bang', slot: 'gun', name: 'Băng Đạn Băng Giá', desc: 'Nạp đạn cực nhanh.', minR: 1, maxR: 3, base: { reload: 0.08 }, subPool: ['reload', 'fireRate', 'dmg'], look: { kind: 'gun', color: 0x7dd3fc, accent: 0xe0f2fe } },
  { id: 'g_vang', slot: 'gun', name: 'Súng Mạ Vàng', desc: 'Hạ khỉ ra nhiều xu.', minR: 2, maxR: 3, base: { dmg: 0.05, cashGain: 0.12 }, subPool: ['cashGain', 'dmg', 'luck'], look: { kind: 'gun', color: 0xeab308, accent: 0xfef08a } },
  // ---- dao (phím F) ----
  { id: 'k_gam', slot: 'knife', name: 'Dao Găm', desc: 'Dao cơ bản.', minR: 0, maxR: 1, base: { knifeDmg: 60 }, subPool: ['knifeDmg', 'speed'], look: { kind: 'dagger', color: 0xd1d5db } },
  { id: 'k_matau', slot: 'knife', name: 'Mã Tấu', desc: 'Chém rộng, đau.', minR: 0, maxR: 2, base: { knifeDmg: 90 }, subPool: ['knifeDmg', 'dmg'], look: { kind: 'machete', color: 0x9ca3af, accent: 0x7c2d12 } },
  { id: 'k_lua', slot: 'knife', name: 'Dao Lửa', desc: 'Lưỡi rực đỏ.', minR: 1, maxR: 3, base: { knifeDmg: 120 }, subPool: ['knifeDmg', 'dmg', 'speed'], look: { kind: 'fire', color: 0xf97316, accent: 0xfde047 } },
  { id: 'k_tre', slot: 'knife', name: 'Kiếm Tre', desc: 'Nhẹ, nhanh.', minR: 1, maxR: 3, base: { knifeDmg: 80, speed: 0.03 }, subPool: ['knifeDmg', 'speed', 'luck'], look: { kind: 'bamboo', color: 0x84cc16 } },
  // ---- trang phục (chỉ đổi màu, không chỉ số) ----
  { id: 's_rung', slot: 'skin', name: 'Rằn Ri Rừng', desc: 'Màu lá rừng.', minR: 0, maxR: 1, base: {}, subPool: [], look: { kind: 'skin', color: 0x4d7c0f, accent: 0x365314 } },
  { id: 's_hong', slot: 'skin', name: 'Kẹo Hồng', desc: 'Dễ thương hết nấc.', minR: 0, maxR: 2, base: {}, subPool: [], look: { kind: 'skin', color: 0xf472b6, accent: 0xfdf2f8 } },
  { id: 's_dem', slot: 'skin', name: 'Bóng Đêm', desc: 'Đen tuyền bí ẩn.', minR: 1, maxR: 3, base: {}, subPool: [], look: { kind: 'skin', color: 0x1f2937, accent: 0x8b5cf6 } },
  { id: 's_vang', slot: 'skin', name: 'Hoàng Kim', desc: 'Lấp lánh vàng ròng.', minR: 2, maxR: 3, base: {}, subPool: [], look: { kind: 'skin', color: 0xeab308, accent: 0xfef9c3 } },
];
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
/** dao mặc định khi chưa mặc dao */
export const BASE_KNIFE_DMG = 45;

/** một món đồ người chơi sở hữu */
export interface ItemInst {
  uid: number;
  itemId: string;
  rarity: Rarity;
  level: number;
  /** chỉ số phụ đã tung (giá trị cố định) */
  subs: Stats;
  /** đang mặc ở ô nào (null = trong kho) */
  equipped: boolean;
}
export const ITEM_MAX_LEVEL = 10;
/** chi phí vàng để nâng từ level → level+1 */
export function upgradeCost(rarity: Rarity, level: number) {
  return Math.round(60 * (1 + rarity * 0.8) * Math.pow(1.45, level - 1));
}
/** vàng nhận khi phân rã */
export function salvageValue(it: ItemInst) {
  return Math.round(RARITY[it.rarity].salvage * (1 + (it.level - 1) * 0.4));
}

/** chỉ số chính của món đồ ở độ hiếm + cấp hiện tại (+8%/cấp) */
export function itemStats(it: ItemInst): Stats {
  const def = ITEM_BY_ID[it.itemId];
  const out: Stats = {};
  if (!def) return out;
  const k = RARITY[it.rarity].mul * (1 + 0.08 * (it.level - 1));
  for (const [s, v] of Object.entries(def.base) as [StatKey, number][]) out[s] = v * k;
  for (const [s, v] of Object.entries(it.subs) as [StatKey, number][]) out[s] = (out[s] ?? 0) + v * (1 + 0.05 * (it.level - 1));
  return out;
}

/** giá trị một dòng phụ ngẫu nhiên (rng ∈ [0,1)) */
export function rollSub(stat: StatKey, rarity: Rarity, rng: () => number) {
  const base: Record<StatKey, number> = { hp: 12, armor: 0.025, dmg: 0.03, headDmg: 0.05, reload: 0.03, fireRate: 0.02, speed: 0.015, cashGain: 0.04, knifeDmg: 20, luck: 0.03 };
  const v = base[stat] * (0.6 + rng() * 0.8) * (1 + rarity * 0.25);
  return STAT_INFO[stat].pct ? Math.round(v * 1000) / 1000 : Math.round(v);
}

/* ======================= NHÂN VẬT ======================= */
/** chỉ số CLASSES; mở khoá */
export type UnlockRule = { kind: 'default' } | { kind: 'level'; level: number } | { kind: 'stage'; stage: string } | { kind: 'shards'; shards: number } | { kind: 'event' };
export const CHAR_UNLOCK: UnlockRule[] = [
  { kind: 'default' }, // 0 chiến binh
  { kind: 'default' }, // 1 y sĩ
  { kind: 'default' }, // 2 kỹ sư
  { kind: 'level', level: 5 }, // 3 đấu sĩ
  { kind: 'stage', stage: '1-10' }, // 4 xạ thủ
  { kind: 'shards', shards: 30 }, // 5 pháo thủ
  { kind: 'level', level: 15 }, // 6 cao bồi (hoặc tặng từ sự kiện)
];
export function unlockText(r: UnlockRule) {
  switch (r.kind) {
    case 'default': return 'Có sẵn';
    case 'level': return `Đạt cấp ${r.level}`;
    case 'stage': return `Qua ải ${r.stage}`;
    case 'shards': return `Ghép ${r.shards} mảnh nhân vật`;
    case 'event': return 'Phần thưởng sự kiện';
  }
}

/* ======================= KỸ NĂNG ======================= */
export type SkillKey = 'g' | 'x' | 'q';
export const SKILL_MAX = 5;
/** chi phí nâng kỹ năng lên cấp `to` (2..5) */
export function skillCost(to: number) {
  return { gold: [0, 0, 300, 700, 1500, 3000][to] ?? 9999, books: [0, 0, 1, 2, 3, 5][to] ?? 99 };
}
/** hệ số sức mạnh kỹ năng theo cấp (sát thương / thời gian) */
export const skillPower = (lv: number) => 1 + 0.1 * (Math.max(1, lv) - 1);
/** hệ số giá xu + hồi chiêu theo cấp */
export const skillCostMul = (lv: number) => 1 - 0.05 * (Math.max(1, lv) - 1);

/* ======================= CẤP NGƯỜI CHƠI ======================= */
export const LEVEL_MAX = 50;
/** XP cần để lên từ level → level+1 */
export const xpToNext = (level: number) => Math.round(100 * Math.pow(level, 1.35));
export function addXp(level: number, xp: number, gain: number) {
  let lv = level;
  let x = xp + gain;
  let ups = 0;
  while (lv < LEVEL_MAX && x >= xpToNext(lv)) {
    x -= xpToNext(lv);
    lv++;
    ups++;
  }
  if (lv >= LEVEL_MAX) x = 0;
  return { level: lv, xp: x, ups };
}
/** vàng thưởng khi lên cấp */
export const levelUpGold = (newLevel: number) => 100 + newLevel * 20;

/* ======================= ẢI ======================= */
export type Modifier = 'night' | 'fast' | 'pistolOnly' | 'noShop' | 'bossRush' | 'explosiveOnly' | 'tough';
export const MODIFIER_INFO: Record<Modifier, { name: string; icon: string; desc: string }> = {
  night: { name: 'Đêm tối', icon: '🌙', desc: 'Tầm nhìn hẹp.' },
  fast: { name: 'Khỉ nhanh', icon: '💨', desc: 'Khỉ chạy nhanh hơn 25%.' },
  pistolOnly: { name: 'Chỉ súng lục', icon: '🔫', desc: 'Không nâng được súng.' },
  noShop: { name: 'Không cửa hàng', icon: '🚫', desc: 'Không mua nâng cấp giữa đợt.' },
  bossRush: { name: 'Boss liên tục', icon: '👑', desc: 'Boss xuất hiện mỗi 2 đợt.' },
  explosiveOnly: { name: 'Khỉ bom', icon: '💣', desc: 'Toàn khỉ nổ.' },
  tough: { name: 'Khỉ trâu', icon: '🛡️', desc: 'Khỉ nhiều máu hơn 40%.' },
};

export interface DropRoll {
  /** ô đồ có thể rớt (rỗng = mọi ô) */
  slots: Slot[];
  /** xác suất rớt (0..1) trước khi cộng may mắn */
  chance: number;
  /** trọng số độ hiếm [thường, hiếm, sử thi, huyền thoại] */
  weights: [number, number, number, number];
}
export interface DropTable {
  gold: [number, number];
  xp: number;
  rolls: DropRoll[];
  /** mảnh nhân vật Pháo Thủ (0 = không) */
  shards?: [number, number];
  /** xác suất rớt 1 sách kỹ năng */
  book?: number;
}
export interface Reward {
  gold?: number;
  xp?: number;
  shards?: number;
  books?: number;
  /** đồ cụ thể: itemId + độ hiếm */
  items?: { itemId: string; rarity: Rarity }[];
  /** mở khoá nhân vật (chỉ số CLASSES) */
  unlockChar?: number;
}

export interface StageDef {
  id: string;
  chapter: number;
  name: string;
  map: 'rung' | 'lang' | 'mo';
  /** số đợt phải vượt */
  waves: number;
  /** bắt đầu từ đợt mấy (độ khó gốc) */
  startWave: number;
  /** hệ số độ khó cộng thêm (máu/sát thương khỉ) */
  diff: number;
  mods: Modifier[];
  /** sao 2: còn ≥ X% máu đội; sao 3: không ai gục và xong trong T giây */
  star3Secs: number;
  drops: DropTable;
  /** thưởng lần đầu qua */
  first: Reward;
  /** ải sự kiện: không nằm trong chuỗi chương */
  event?: boolean;
}

const CH = [
  { n: 1, map: 'rung' as const, name: 'Đền Rừng' },
  { n: 2, map: 'lang' as const, name: 'Làng Ven Sông' },
  { n: 3, map: 'mo' as const, name: 'Mỏ Đá' },
];
const MOD_PLAN: Modifier[][] = [[], [], ['fast'], [], ['night'], ['tough'], [], ['pistolOnly'], ['fast', 'tough'], ['bossRush']];
const NAMES = [
  ['Cổng Đền', 'Lối Rêu', 'Bậc Thang Đá', 'Sân Tượng', 'Đêm Đom Đóm', 'Tường Đổ', 'Hồ Sen', 'Đường Hẹp', 'Rừng Gào Thét', 'Vua Khỉ Đột'],
  ['Bến Đò', 'Chợ Phiên', 'Cầu Tre', 'Ruộng Lúa', 'Đêm Hội Đèn', 'Nhà Sàn', 'Bãi Thuyền', 'Đình Làng', 'Lũ Tràn', 'Thuyền Trưởng Khỉ'],
  ['Cửa Mỏ', 'Đường Ray', 'Giàn Gỗ', 'Hẻm Đá', 'Hầm Tối', 'Lò Luyện', 'Vách Đá', 'Kho Thuốc Nổ', 'Sập Hầm', 'Chúa Mỏ'],
];

function chapterStages(): StageDef[] {
  const out: StageDef[] = [];
  for (const c of CH) {
    for (let i = 1; i <= 10; i++) {
      const g = (c.n - 1) * 10 + i; // 1..30 độ khó tổng
      const boss = i === 10;
      out.push({
        id: `${c.n}-${i}`,
        chapter: c.n,
        name: NAMES[c.n - 1][i - 1],
        map: c.map,
        waves: Math.min(15, 4 + Math.ceil(g / 3)),
        startWave: 1 + Math.floor((g - 1) / 2),
        diff: 1 + (g - 1) * 0.06,
        mods: MOD_PLAN[i - 1],
        star3Secs: 90 + (4 + Math.ceil(g / 3)) * 55,
        drops: {
          gold: [40 + g * 12, 70 + g * 18],
          xp: 60 + g * 25,
          rolls: [
            { slots: [], chance: 0.55, weights: [70 - g, 25 + g * 0.6, 4 + g * 0.3, 1 + g * 0.1] },
            { slots: [], chance: boss ? 0.9 : 0.15, weights: boss ? [20, 45, 28, 7 + g * 0.2] : [60, 30, 9, 1] },
          ],
          shards: c.n >= 2 ? [1, boss ? 6 : 2] : undefined,
          book: boss ? 0.8 : 0.08,
        },
        first: boss
          ? { gold: 300 + g * 20, books: 1, items: [{ itemId: c.n === 1 ? 'h_ky' : c.n === 2 ? 'a_tre' : 'k_lua', rarity: 2 }] }
          : { gold: 80 + g * 10 },
      });
    }
  }
  return out;
}

export const STAGES: StageDef[] = chapterStages();
/** ải của sự kiện (sự kiện trỏ tới bằng id) */
export const EVENT_STAGES: StageDef[] = [
  {
    id: 'ev-vuonchuoi', chapter: 0, name: 'Vườn Chuối', map: 'lang', waves: 5, startWave: 1, diff: 0.9, mods: [], star3Secs: 420, event: true,
    drops: { gold: [80, 140], xp: 120, rolls: [{ slots: ['skin', 'helmet'], chance: 0.6, weights: [50, 35, 13, 2] }], book: 0.2 },
    first: { gold: 500, books: 1 },
  },
];
export const STAGE_BY_ID: Record<string, StageDef> = Object.fromEntries([...STAGES, ...EVENT_STAGES].map((s) => [s.id, s]));

/** ải kế tiếp trong chương (null nếu hết) */
export function nextStage(id: string): string | null {
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1].id : null;
}
/** ải có mở với người đã qua `cleared` không (ải đầu luôn mở) */
export function stageUnlocked(id: string, cleared: ReadonlySet<string>) {
  const s = STAGE_BY_ID[id];
  if (!s) return false;
  if (s.event) return true;
  const i = STAGES.findIndex((x) => x.id === id);
  return i === 0 || cleared.has(STAGES[i - 1].id);
}

/* ======================= RỚT ĐỒ ======================= */
function pickWeighted(w: readonly number[], rng: () => number) {
  const tot = w.reduce((a, b) => a + Math.max(0, b), 0);
  let r = rng() * tot;
  for (let i = 0; i < w.length; i++) {
    r -= Math.max(0, w[i]);
    if (r < 0) return i;
  }
  return w.length - 1;
}

/** tung đồ rớt cho một người. luck = chỉ số may mắn (0..0.5). Trả về phần thưởng (đồ chưa có uid). */
export function rollDrops(t: DropTable, luck: number, stars: number, rng: () => number): Reward & { items: { itemId: string; rarity: Rarity; subs: Stats }[] } {
  const L = Math.min(STAT_INFO.luck.cap, Math.max(0, luck));
  const starMul = 0.7 + stars * 0.15; // 1 sao 0.85 … 3 sao 1.15
  const gold = Math.round((t.gold[0] + rng() * (t.gold[1] - t.gold[0])) * starMul);
  const items: { itemId: string; rarity: Rarity; subs: Stats }[] = [];
  for (const r of t.rolls) {
    if (rng() >= Math.min(0.98, r.chance * (1 + L) * starMul)) continue;
    // may mắn đẩy trọng số lên độ hiếm cao
    const w = r.weights.map((x, i) => x * (1 + L * i * 1.5));
    let rarity = pickWeighted(w, rng) as Rarity;
    const pool = ITEMS.filter((d) => !d.special && (r.slots.length === 0 || r.slots.includes(d.slot)) && d.minR <= rarity);
    if (!pool.length) continue;
    const def = pool[Math.floor(rng() * pool.length)];
    if (rarity > def.maxR) rarity = def.maxR;
    items.push({ itemId: def.id, rarity, subs: rollSubs(def, rarity, rng) });
  }
  const shards = t.shards ? Math.round(t.shards[0] + rng() * (t.shards[1] - t.shards[0])) : 0;
  const books = t.book && rng() < t.book * (1 + L) ? 1 : 0;
  return { gold, xp: Math.round(t.xp * starMul), items, shards, books };
}

export function rollSubs(def: ItemDef, rarity: Rarity, rng: () => number): Stats {
  const subs: Stats = {};
  const pool = [...def.subPool];
  for (let n = 0; n < RARITY[rarity].subs && pool.length; n++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    subs[k] = (subs[k] ?? 0) + rollSub(k, rarity, rng);
  }
  return subs;
}

/* ======================= LOADOUT (đầu trận) ======================= */
/** những gì server cần để áp vào trận cho một người */
export interface Loadout {
  /** chỉ số cộng dồn đã chặn trần */
  stats: Stats;
  /** cấp kỹ năng của nhân vật đang chọn */
  skills: Record<SkillKey, number>;
  /** ngoại hình: id món đồ đang mặc theo ô (để client vẽ) */
  look: Partial<Record<Slot, string>>;
}
/** phần chỉ số ảnh hưởng mô phỏng chuyển động (client dự đoán cần biết) — gửi trong tin 'start' */
export interface SimMods {
  speed: number;
  fireRate: number;
  reload: number;
}
export const NO_MODS: SimMods = { speed: 0, fireRate: 0, reload: 0 };

export function capStats(s: Stats): Stats {
  const out: Stats = {};
  for (const [k, v] of Object.entries(s) as [StatKey, number][]) out[k] = Math.min(STAT_INFO[k].cap, Math.max(0, v));
  return out;
}
export function loadoutOf(equipped: ItemInst[], skills: Record<SkillKey, number>): Loadout {
  const sum: Stats = {};
  const look: Partial<Record<Slot, string>> = {};
  for (const it of equipped) {
    const def = ITEM_BY_ID[it.itemId];
    if (!def) continue;
    look[def.slot] = def.id;
    for (const [k, v] of Object.entries(itemStats(it)) as [StatKey, number][]) sum[k] = (sum[k] ?? 0) + v;
  }
  return { stats: capStats(sum), skills, look };
}
export function simModsOf(l: Loadout | null | undefined): SimMods {
  if (!l) return NO_MODS;
  return { speed: l.stats.speed ?? 0, fireRate: l.stats.fireRate ?? 0, reload: l.stats.reload ?? 0 };
}
