// Nhịp trình diễn trận đánh — MỌI hằng số chỉnh tay nằm ở đây.
// Trận chạy LIÊN TỤC: session gọi step() đều đặn 20Hz × SPEED_MULT, không bao giờ giữ engine chờ hoạt ảnh.
// Thời lượng "cảnh" tính bằng giây ở tốc độ 1.0 (đồng hồ cảnh đã nhân SPEED_MULT khi chạy thật).
// Trình diễn chỉ là hình ảnh: vị trí/chuyển động hoàn toàn mỹ thuật, KHÔNG ảnh hưởng engine.
export type Speed = 1 | 2 | 3;

/** hệ số nhân so với nhịp gốc 20Hz: x1 vừa xem, x2/x3 nhanh dần */
export const SPEED_MULT: Record<Speed, number> = { 1: 1.05, 2: 1.8, 3: 2.8 };

/** sau khi engine báo kết thúc: giây THẬT giữ màn để xem đòn cuối + banner trước khi nộp kết quả */
export const PACE = {
  endHoldReal: 1.6, endHoldMaxReal: 3.5,
} as const;

/** hit-stop (giây thật): chỉ khựng CỤC BỘ từng đơn vị bị trúng; `final` là khựng toàn cảnh sau nhát cuối (engine đã xong) */
export const HITSTOP = { normal: 0.025, crit: 0.055, ult: 0.04, final: 0.14 } as const;

/** bố cục + di chuyển + trình diễn (đơn vị: đơn vị thế giới / giây cảnh). Đội hình KHÓA LÀN: không đuổi, không lượn. */
export const MOTION = {
  /* cột x (khoảng cách tới vạch giữa) theo hàng: Trước, Giữa, Sau; lệch x thêm cho ô lẻ của cột (so le); z của hai hàng trong cột */
  colX: [0.95, 2.3, 3.65] as readonly number[],
  stagger: 0.3,
  rowZ: [-0.8, 0.8] as readonly number[],
  /** boss: đứng đầu phe, hơi lệch z để không đè ô còn lại của cột đầu */
  bossX: 1.25, bossZ: -0.5,
  /* cận chiến bước tới 'vị trí tiền tuyến' một đoạn ngắn rồi khoá; không bao giờ qua minX */
  stepFwd: 0.9, minX: 0.6, stepRate: 7,
  /* lao tới đòn: thời lượng giây cảnh (≤0,35), dừng cách mục tiêu `lungeGap` (boss to hơn), tuyệt kỹ cận chiến lao xa + lâu hơn */
  lungeMin: 0.26, lungeMax: 0.35, lungeUlt: 0.6, lungeGap: 0.95, lungeGapBoss: 1.7, lungeCap: 6.5,
  /* xoay mặt (rad/s), nghiêng người khi lao */
  turn: 14, lean: 0.22,
  /* sau khi ra đòn: giữ mặt hướng mục tiêu chừng này giây rồi quay về hướng phe */
  faceHold: 0.9,
  /* thời điểm đòn (giây cảnh kể từ act) */
  meleeHit: 0.17,
  releaseArcher: 0.18, releaseMage: 0.24, releaseSupport: 0.22,
  flightMin: 0.2, flightMax: 0.38, flightSpeed: 16,
  aoeStagger: 0.05,
  ultHit: 0.5,
  /* cắt cảnh tuyệt kỹ nhẹ (giây THẬT) + đẩy camera */
  cutInReal: 0.55, camNudge: 0.3,
} as const;
