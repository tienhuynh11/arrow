// Danh mục tướng. Dữ liệu thuần: thêm tướng = thêm một dòng + (nếu cần) kỹ năng ở skills.ts.
import type { Element, HeroDef, Rarity, Role } from './types.js';

const BASIC_OF: Record<Role, string> = {
  tank: 'b_tank', warrior: 'b_warrior', mage: 'b_mage', archer: 'b_archer', healer: 'b_healer', support: 'b_support',
};

function hero(
  id: string, name: string, title: string, rarity: Rarity, element: Element, role: Role,
  body: string, accent: string, props: string[], summonable = true,
): HeroDef {
  return {
    id, name, title, rarity, element, role,
    skills: [BASIC_OF[role], `${id}_a`, `${id}_u`],
    look: { model: id, body, accent, props },
    summonable,
  };
}

export const HEROES: HeroDef[] = [
  // R
  hero('linh_rung', 'Lính Rừng', 'Tân binh bìa rừng', 'R', 'forest', 'warrior', '#5fae4a', '#c9a15a', ['sword']),
  hero('tho_san', 'Thợ Săn', 'Mắt diều hâu', 'R', 'earth', 'archer', '#b98a52', '#6d4a24', ['bow']),
  hero('khien_da', 'Khiên Đá', 'Bức tường sống', 'R', 'earth', 'tank', '#8e8e98', '#d6c28b', ['shield']),
  hero('thay_thuoc', 'Thầy Thuốc Làng', 'Bàn tay lành', 'R', 'water', 'healer', '#5cb6d6', '#f2f2f2', ['staff']),
  // SR
  hero('kiem_si_song', 'Kiếm Sĩ Sông', 'Lưỡi kiếm xanh', 'SR', 'water', 'warrior', '#3f8fd8', '#f4d35e', ['sword', 'cape']),
  hero('phap_su_re', 'Pháp Sư Rễ Cây', 'Tiếng thì thầm rừng già', 'SR', 'forest', 'mage', '#2f9e6b', '#c4f27a', ['staff', 'hat']),
  hero('ho_ve_nui', 'Hộ Vệ Núi', 'Vững như đá', 'SR', 'earth', 'tank', '#a8764a', '#e6c27a', ['shield', 'helm']),
  hero('nhac_si_gio', 'Nhạc Sĩ Gió', 'Giai điệu dẫn lối', 'SR', 'water', 'support', '#7fd1d0', '#ff9fb2', ['flute']),
  // SSR
  hero('phap_su_anh_sang', 'Nữ Pháp Sư Ánh Sáng', 'Tia nắng đầu ngày', 'SSR', 'light', 'mage', '#f4e29a', '#ff9a3d', ['staff', 'hat']),
  hero('sat_thu_bong_dem', 'Sát Thủ Bóng Đêm', 'Không để lại dấu vết', 'SSR', 'dark', 'archer', '#4a3a78', '#b86bff', ['dagger', 'hood']),
  hero('thanh_y', 'Thánh Y Sinh Mệnh', 'Phép màu cứu rỗi', 'SSR', 'light', 'healer', '#fff1d6', '#ffd24d', ['staff', 'halo']),
  // UR
  hero('hau_vuong', 'Đại Thánh Hầu Vương', 'Náo loạn thiên cung', 'UR', 'forest', 'warrior', '#d9822b', '#ffd24d', ['staff', 'crown', 'cape']),
];

export const HERO_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));

export function heroOf(id: string): HeroDef {
  const h = HERO_BY_ID[id];
  if (!h) throw new Error(`unknown hero ${id}`);
  return h;
}

/** tướng tặng khi tạo tài khoản (vào đội hình theo thứ tự này) */
export const STARTER_HEROES: readonly string[] = ['khien_da', 'linh_rung', 'tho_san', 'thay_thuoc'];

/** tướng có thể quay được ở một phẩm */
export function poolOf(rarity: Rarity): HeroDef[] {
  return HEROES.filter((h) => h.rarity === rarity && h.summonable);
}
