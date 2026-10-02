// Dữ liệu chế độ "Hành Trình Xuyên Việt" — server và client cùng đọc file này.
// Giữ file không phụ thuộc gì để cả hai phía biên dịch được.

/** số lượt (chặng) của một trận */
export const JOURNEY_TURNS = 10;
/** thời gian chờ chủ xúc xắc bấm tung; hết giờ server tự tung */
export const ROLL_MS = 10_000;
/** hoạt hình di chuyển: nền + mỗi nấc xúc xắc */
export const MOVE_BASE_MS = 3200;
export const MOVE_STEP_MS = 380;

export interface Tile {
  id: string;
  name: string;
  emoji: string;
  /** đặc sản / nét văn hoá của tỉnh, hiện trên huy hiệu */
  specialty: string;
  /** minigame diễn ra ở ô này (id trùng id game ở server) */
  gameId: string;
  /** tên minigame theo chủ đề tỉnh, thay tên gốc ở màn đếm ngược và header */
  title: string;
  /** 1–2 câu kể luật gốc theo chủ đề tỉnh */
  intro: string;
  /** Điểm Văn Hoá của ô (hạng 1 nhận trọn, hạng 2 một nửa, hạng 3 một phần tư) */
  value: number;
  /** ô lễ hội: điểm cao hơn */
  festival?: boolean;
  /** toạ độ vẽ trên bản đồ (viewBox 1000×440) */
  x: number;
  y: number;
}

/**
 * Vòng 10 tỉnh vẽ thành một hình chữ nhật: hàng trên đi từ trái sang phải (bắc → trung → Tây Nguyên),
 * hàng dưới đi ngược lại (Đắk Lắk → miền Tây), rồi nối về Hà Nội.
 */
export const TILES: readonly Tile[] = [
  {
    id: 'hanoi',
    name: 'Hà Nội',
    emoji: '🍵',
    specialty: 'Trà đá vỉa hè',
    gameId: 'sequence',
    title: 'NHỚ ORDER QUÁN VỈA HÈ',
    intro: 'Khách gọi món dồn dập! Gõ đúng thứ tự các mũi tên như nhớ đúng order trà đá, quán vỉa hè không được nhầm.',
    value: 20,
    x: 100,
    y: 90,
  },
  {
    id: 'quangninh',
    name: 'Quảng Ninh',
    emoji: '🛶',
    specialty: 'Kayak Hạ Long',
    gameId: 'tug',
    title: 'KÉO CO CHÈO KAYAK HẠ LONG',
    intro: 'Hai đội chèo ngược chiều trên vịnh Hạ Long: bên nào chèo mạnh hơn sẽ kéo cả con thuyền về phía mình!',
    value: 20,
    x: 300,
    y: 90,
  },
  {
    id: 'hue',
    name: 'Huế',
    emoji: '🍜',
    specialty: 'Bún bò cố đô',
    gameId: 'math',
    title: 'TÍNH TIỀN MÂM CỖ CỐ ĐÔ',
    intro: 'Mùa lễ hội Huế! Tính nhẩm tiền mâm cỗ cung đình rồi đứng vào ô đáp án đúng, chốt càng sớm càng được thưởng.',
    value: 30,
    festival: true,
    x: 500,
    y: 90,
  },
  {
    id: 'danang',
    name: 'Đà Nẵng',
    emoji: '🐉',
    specialty: 'Cầu Rồng phun lửa',
    gameId: 'reaction',
    title: 'CẦU RỒNG PHUN LỬA',
    intro: 'Cầu Rồng sắp phun lửa! Chờ đúng khoảnh khắc rồi bấm thật nhanh, nhưng coi chừng những tia lửa giả đánh lừa bạn.',
    value: 20,
    x: 700,
    y: 90,
  },
  {
    id: 'gialai',
    name: 'Gia Lai',
    emoji: '🥁',
    specialty: 'Cồng chiêng Tây Nguyên',
    gameId: 'rhythm',
    title: 'NHỊP CỒNG CHIÊNG TÂY NGUYÊN',
    intro: 'Hội cồng chiêng bên đống lửa! Bấm đúng nhịp khi nốt chạm vạch, nốt gai là điềm xui, hãy để nó trôi qua.',
    value: 30,
    festival: true,
    x: 900,
    y: 90,
  },
  {
    id: 'daklak',
    name: 'Đắk Lắk',
    emoji: '🐘',
    specialty: 'Đua voi Buôn Đôn',
    gameId: 'race',
    title: 'ĐUA VOI BUÔN ĐÔN',
    intro: 'Mùa hội đua voi! Chạy thật nhanh, nhảy qua từng chướng ngại và về đích đầu tiên để nhận cờ chiến thắng.',
    value: 20,
    x: 900,
    y: 350,
  },
  {
    id: 'binhthuan',
    name: 'Bình Thuận',
    emoji: '🏜️',
    specialty: 'Đồi cát Mũi Né',
    gameId: 'button',
    title: 'TRƯỢT ĐỒI CÁT MŨI NÉ',
    intro: 'Dốc cát nóng bỏng! Bấm liên tục để lao xuống, nhưng thấy nút chuyển đỏ là phải khựng lại ngay kẻo lún cát.',
    value: 20,
    x: 700,
    y: 350,
  },
  {
    id: 'hcm',
    name: 'TP. Hồ Chí Minh',
    emoji: '☕',
    specialty: 'Cà phê sữa đá',
    gameId: 'dodge',
    title: 'LÁCH KẸT XE SÀI GÒN',
    intro: 'Giờ cao điểm Sài Gòn! Luồn lách qua dòng vật cản để kịp ly cà phê sữa đá, tông phải là mất mạng.',
    value: 20,
    x: 500,
    y: 350,
  },
  {
    id: 'bentre',
    name: 'Bến Tre',
    emoji: '🥥',
    specialty: 'Xứ dừa',
    gameId: 'coconut',
    title: 'HÁI DỪA XỨ DỪA',
    intro: 'Leo cây dừa Bến Tre hái quả! Bấm luân phiên hai phím để leo, gió lắc thì phải buông tay.',
    value: 20,
    x: 300,
    y: 350,
  },
  {
    id: 'cantho',
    name: 'Cần Thơ',
    emoji: '🍉',
    specialty: 'Chợ nổi Cái Răng',
    gameId: 'bomb',
    title: 'CHUYỀN TRÁI CÂY CHỢ NỔI',
    intro: 'Trái cây chín nổ tung trên chợ nổi! Ai ôm trái "bom" thì đuổi chạm người khác để tống đi trước khi nó nổ.',
    value: 20,
    x: 100,
    y: 350,
  },
];

/** điểm hạng 1 / 2 / 3 / còn lại theo tỉ lệ của `Tile.value` */
export const RANK_SHARE = [1, 0.5, 0.25] as const;
/** người đang đứng đúng ô được chọn (chủ nhà) nhân điểm */
export const HOME_BONUS = 1.5;
/** lần đầu thu thập một đặc sản được cộng thêm */
export const COLLECTION_BONUS = 5;

/** Điểm Văn Hoá một người nhận được ở một ô. */
export function culturePoints(tile: Tile, rank: number, atHome: boolean, isNewBadge: boolean): number {
  const share = RANK_SHARE[rank - 1] ?? 0;
  const base = tile.value * share * (atHome ? HOME_BONUS : 1);
  return Math.round(base) + (rank === 1 && isNewBadge ? COLLECTION_BONUS : 0);
}
