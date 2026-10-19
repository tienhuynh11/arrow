// Phụ kiện + kiểu tóc RIÊNG từng tướng (chỉ lớp hiển thị) để nhìn xa vẫn nhận ra ai là ai.
// Khoá = id tướng. `drop` bỏ bớt props gốc trong HeroDef.look.props; `add` thêm props mới (xem addProp ở procedural-model.ts).
export interface HeroStyle {
  /** màu tóc; mặc định = màu nhấn tối đi */
  hair?: string;
  drop?: string[];
  add: string[];
}

export const HERO_STYLE: Record<string, HeroStyle> = {
  linh_rung: { hair: '#5a3a1e', add: ['leafcap', 'backpack'] },
  tho_san: { hair: '#4a2c14', drop: ['bow'], add: ['bigbow', 'huntercap', 'quiver'] },
  khien_da: { hair: '#555a66', drop: ['shield'], add: ['bigshield', 'stone', 'headband'] },
  thay_thuoc: { hair: '#3b2a1a', add: ['healcap', 'glasses', 'satchel'] },
  kiem_si_song: { hair: '#1f4f9a', drop: ['sword'], add: ['greatsword', 'spiky', 'scarf'] },
  phap_su_re: { hair: '#e8f0dc', add: ['longbeard', 'hatleaf'] },
  ho_ve_nui: { hair: '#6b4220', add: ['horns', 'beard'] },
  nhac_si_gio: { hair: '#ff7fa0', add: ['beret', 'scarf', 'floatnotes'] },
  phap_su_anh_sang: { hair: '#ff9a3d', add: ['twintails', 'sunstar'] },
  sat_thu_bong_dem: { hair: '#2a1d4a', add: ['demonhorns', 'scarftail'] },
  thanh_y: { hair: '#ffe27a', add: ['wings', 'longhair'] },
  hau_vuong: { hair: '#b8631a', drop: ['staff'], add: ['ruyi', 'monkeyears', 'monkeytail', 'pheasant', 'goldarmor'] },
};
