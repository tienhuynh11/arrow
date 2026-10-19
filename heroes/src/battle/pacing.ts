// Nhịp trình diễn trận đánh — MỌI hằng số chỉnh tay nằm ở đây.
// Quy ước: thời lượng "cảnh" tính bằng giây ở tốc độ 1.0 (đã nhân tốc độ khi chạy thật),
// nên giây thật ≈ giây cảnh / SPEED_MULT[speed]. Engine chỉ tiến khi session gọi step(), nên các khoảng giữ ở đây
// chỉ làm trễ THỜI ĐIỂM gọi step()/ult(), không đổi kết quả tính toán.
export type Speed = 1 | 2 | 3;

/** hệ số nhân so với nhịp gốc cũ (20Hz): x1 chậm dễ xem, x2 ≈ x1 cũ, x3 nhanh */
export const SPEED_MULT: Record<Speed, number> = { 1: 0.55, 2: 1.0, 3: 1.7 };

/** khi không có gì để trình diễn (chờ thanh hành động đầy) tua nhanh thêm chừng này để không nhàm */
export const IDLE_BOOST = 1.35;

export const PACE = {
  /* đòn thường: giây cảnh từ lúc bắt đầu tới lúc trúng, và tổng thời gian giữ sim trước khi cho đơn vị khác hành động */
  meleeHit: 0.2, meleeHold: 0.36,
  rangedHit: 0.3, rangedHold: 0.46,
  supportHit: 0.35, supportHold: 0.56,
  /* tuyệt kỹ người chơi: chặn trước khi tung (cinematic), rồi giữ sau khi FX bắt đầu */
  cinePre: 0.62, cinePreLow: 0.3, cinePreBoss: 0.34,
  ultHit: 0.5, ultHold: 0.95,
  /* gục / sang đợt */
  dieExtra: 0.4,
  waveHold: 1.0,
  /* sau khi engine báo kết thúc: giây THẬT giữ màn để xem đòn cuối + banner trước khi nộp kết quả */
  endHoldReal: 1.6, endHoldMaxReal: 3.5,
} as const;

/** hit-stop (giây thật đóng băng đồng hồ hoạt hình) */
export const HITSTOP = { normal: 0.04, crit: 0.09, ult: 0.1, final: 0.14 } as const;
