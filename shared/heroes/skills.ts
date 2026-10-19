// Danh mục kỹ năng. Dữ liệu thuần — thêm kỹ năng chỉ cần thêm một dòng.
import type { EffectType, SkillDef, SkillEffect, SkillKind, SkillTarget, SkillType } from './types.js';

const fx = (type: EffectType, value: number, dur: number): SkillEffect => ({ type, value, dur });
const sk = (
  id: string, name: string, kind: SkillKind, type: SkillType, target: SkillTarget,
  power: number, cd = 0, ...effects: SkillEffect[]
): SkillDef => ({ id, name, kind, type, target, power, cd, effects });

const ACTIVE_CD = 160; // 8 giây

export const SKILL_LIST: SkillDef[] = [
  // ----- đòn thường theo vai trò -----
  sk('b_tank', 'Húc', 'basic', 'dmg', 'enemy', 90),
  sk('b_warrior', 'Chém', 'basic', 'dmg', 'enemy', 100),
  sk('b_mage', 'Phép Cầu', 'basic', 'dmg', 'enemy', 100),
  sk('b_archer', 'Bắn Tên', 'basic', 'dmg', 'enemyBack', 100),
  sk('b_healer', 'Gậy Gõ', 'basic', 'dmg', 'enemy', 80),
  sk('b_support', 'Đập', 'basic', 'dmg', 'enemy', 80),

  // ----- tướng R -----
  sk('linh_rung_a', 'Chém Xoáy', 'active', 'dmg', 'enemy', 190, ACTIVE_CD),
  sk('linh_rung_u', 'Rừng Gầm', 'ult', 'dmg', 'enemyAll', 140, 0, fx('defDown', 20, 100)),
  sk('tho_san_a', 'Mũi Tên Xuyên', 'active', 'dmg', 'enemyBack', 200, ACTIVE_CD),
  sk('tho_san_u', 'Mưa Tên', 'ult', 'dmg', 'enemyAll', 130),
  sk('khien_da_a', 'Dựng Khiên', 'active', 'buff', 'self', 0, 200, fx('shield', 150, 140)),
  sk('khien_da_u', 'Tường Đá', 'ult', 'buff', 'allyAll', 0, 0, fx('shield', 80, 140)),
  sk('thay_thuoc_a', 'Thuốc Lá', 'active', 'heal', 'allyLowest', 160, ACTIVE_CD),
  sk('thay_thuoc_u', 'Suối Lành', 'ult', 'heal', 'allyAll', 110),

  // ----- tướng SR -----
  sk('kiem_si_song_a', 'Sóng Kiếm', 'active', 'dmg', 'enemy', 210, ACTIVE_CD),
  sk('kiem_si_song_u', 'Thuỷ Triều', 'ult', 'dmg', 'enemyAll', 160),
  sk('phap_su_re_a', 'Rễ Trói', 'active', 'dmg', 'enemy', 150, 200, fx('stun', 0, 40)),
  sk('phap_su_re_u', 'Rừng Thức Tỉnh', 'ult', 'dmg', 'enemyAll', 170, 0, fx('defDown', 25, 100)),
  sk('ho_ve_nui_a', 'Giáp Núi', 'active', 'buff', 'self', 0, 200, fx('defUp', 50, 160)),
  sk('ho_ve_nui_u', 'Động Đất', 'ult', 'dmg', 'enemyAll', 100, 0, fx('stun', 0, 30)),
  sk('nhac_si_gio_a', 'Khúc Tăng Tốc', 'active', 'buff', 'allyAll', 0, 220, fx('spdUp', 20, 160)),
  sk('nhac_si_gio_u', 'Bản Nhạc Chiến', 'ult', 'buff', 'allyAll', 0, 0, fx('atkUp', 30, 200)),

  // ----- tướng SSR -----
  sk('phap_su_anh_sang_a', 'Tia Sáng', 'active', 'dmg', 'enemyLowest', 240, ACTIVE_CD),
  sk('phap_su_anh_sang_u', 'Thiên Quang', 'ult', 'dmg', 'enemyAll', 200),
  sk('sat_thu_bong_dem_a', 'Đâm Lén', 'active', 'dmg', 'enemyBack', 260, ACTIVE_CD),
  sk('sat_thu_bong_dem_u', 'Bóng Tử Thần', 'ult', 'dmg', 'enemyLowest', 400),
  sk('thanh_y_a', 'Phép Lành', 'active', 'heal', 'allyLowest', 220, ACTIVE_CD, fx('defUp', 20, 80)),
  sk('thanh_y_u', 'Hồi Sinh Sáng', 'ult', 'heal', 'allyAll', 160, 0, fx('shield', 50, 120)),

  // ----- tướng UR -----
  sk('hau_vuong_a', 'Gậy Như Ý', 'active', 'dmg', 'enemy', 260, ACTIVE_CD),
  sk('hau_vuong_u', 'Đại Náo Thiên Cung', 'ult', 'dmg', 'enemyAll', 260, 0, fx('stun', 0, 30)),

  // ----- quái -----
  sk('m_basic', 'Cào', 'basic', 'dmg', 'enemy', 90),
  sk('m_a1', 'Vồ', 'active', 'dmg', 'enemy', 170, 200),
  sk('m_a2', 'Gầm', 'active', 'dmg', 'enemyAll', 80, 240),
  sk('m_boss_u', 'Giậm Đất', 'ult', 'dmg', 'enemyAll', 150, 0, fx('stun', 0, 20)),
  sk('m_ult', 'Nhảy Bổ', 'ult', 'dmg', 'enemyLowest', 220),
];

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(SKILL_LIST.map((s) => [s.id, s]));

export function skillOf(id: string): SkillDef {
  const s = SKILLS[id];
  if (!s) throw new Error(`unknown skill ${id}`);
  return s;
}
