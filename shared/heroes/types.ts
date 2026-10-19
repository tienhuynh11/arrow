// Kiểu dữ liệu lõi của game thẻ tướng.

export type Rarity = 'R' | 'SR' | 'SSR' | 'UR';
export const RARITIES: readonly Rarity[] = ['R', 'SR', 'SSR', 'UR'];
export const RARITY_RANK: Record<Rarity, number> = { R: 0, SR: 1, SSR: 2, UR: 3 };

/** Rừng > Đất > Nước > Rừng; Sáng <-> Tối khắc nhau */
export type Element = 'forest' | 'earth' | 'water' | 'light' | 'dark';
export const ELEMENTS: readonly Element[] = ['forest', 'earth', 'water', 'light', 'dark'];
export const ELEMENT_NAME: Record<Element, string> = {
  forest: 'Rừng', earth: 'Đất', water: 'Nước', light: 'Sáng', dark: 'Tối',
};

export type Role = 'tank' | 'warrior' | 'mage' | 'archer' | 'healer' | 'support';
export const ROLES: readonly Role[] = ['tank', 'warrior', 'mage', 'archer', 'healer', 'support'];
export const ROLE_NAME: Record<Role, string> = {
  tank: 'Đỡ đòn', warrior: 'Chiến binh', mage: 'Pháp sư', archer: 'Xạ thủ', healer: 'Hồi máu', support: 'Hỗ trợ',
};

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  /** tốc độ hành động (ATB / thứ tự ra đòn) */
  spd: number;
  /** các chỉ số chiến đấu MỚI — tuỳ chọn, thiếu thì dùng STAT_DEFAULTS (combat.ts) */
  /** tốc đánh %: thanh hành động đầy với tốc độ spd * aspd / 100 (mặc định 100) */
  aspd?: number;
  /** tỉ lệ bạo kích % (mặc định 10) */
  crit?: number;
  /** sát thương khi bạo kích % (mặc định 150) */
  critDmg?: number;
  /** hút máu % sát thương gây ra (mặc định 0) */
  lifesteal?: number;
}

/* ------------------------------ KỸ NĂNG ------------------------------ */
/** đòn thường / kỹ năng chủ động (có hồi chiêu) / tuyệt kỹ (đủ năng lượng) */
export type SkillKind = 'basic' | 'active' | 'ult';
export type SkillType = 'dmg' | 'heal' | 'buff';
export type SkillTarget =
  | 'enemy' // 1 địch, ưu tiên hàng trước
  | 'enemyBack' // 1 địch, ưu tiên hàng sau
  | 'enemyLowest' // địch ít máu nhất
  | 'enemyAll'
  | 'self'
  | 'allyLowest' // đồng minh tỉ lệ máu thấp nhất
  | 'allyAll';
export type EffectType = 'atkUp' | 'defUp' | 'defDown' | 'stun' | 'shield' | 'spdUp';
export interface SkillEffect {
  type: EffectType;
  /** atkUp/defUp/defDown/spdUp: % ; shield: % ATK người dùng ; stun: bỏ qua */
  value: number;
  /** thời lượng (tick) */
  dur: number;
}
export interface SkillDef {
  id: string;
  name: string;
  kind: SkillKind;
  type: SkillType;
  target: SkillTarget;
  /** % ATK: sát thương (dmg) hoặc lượng hồi (heal) */
  power: number;
  /** hồi chiêu (tick) — chỉ cho 'active' */
  cd: number;
  effects: SkillEffect[];
}

/* ------------------------------ TƯỚNG ------------------------------ */
export interface HeroLook {
  /** khoá model glTF (xem heroes/ASSETS.md); chưa có model thì client dựng hình tạm */
  model: string;
  /** màu thân / màu nhấn (#rrggbb) */
  body: string;
  accent: string;
  /** phụ kiện gắn xương: mũ, vũ khí... */
  props: string[];
}
export interface HeroDef {
  id: string;
  name: string;
  title: string;
  rarity: Rarity;
  element: Element;
  role: Role;
  /** [đòn thường, kỹ năng, tuyệt kỹ] */
  skills: [string, string, string];
  look: HeroLook;
  /** có thể nhận ở banner thường */
  summonable: boolean;
}

/* ------------------------------ TÀI KHOẢN ------------------------------ */
export interface Wallet {
  gold: number;
  gems: number;
  tickets: number;
  /** EXP bình dùng để nâng cấp tướng */
  exp: number;
  /** đá cường hoá trang bị */
  stones: number;
}
export const EMPTY_WALLET: Wallet = { gold: 0, gems: 0, tickets: 0, exp: 0, stones: 0 };

export interface OwnedHero {
  /** id HeroDef */
  id: string;
  level: number;
  star: number;
  /** mảnh đang có (dùng lên sao) */
  shards: number;
}
