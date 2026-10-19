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
  /* z (làn) của hai ô trong cột; x lấy từ engine */
  rowZ: [-0.8, 0.8] as readonly number[],
  /** boss: hơi lệch z để không đè ô còn lại của cột đầu */
  bossZ: -0.5,
  /** nhịp mở màn (giây THẬT): đứng yên để thấy hai đạo quân ở xa nhau trước khi tiến */
  readyReal: 0.8,
  /* x thế giới = (x_engine/12000 - 0.5) * 10 (xem worldX): nền bám x engine với tốc độ followRate (1/giây cảnh); chạy khi còn lệch > moveEps;
     runSpeed = tốc độ (đv thế giới/giây cảnh) tương ứng chạy hết cỡ (~22 đv engine/tick x 20Hz / 1200 ≈ 0.37) */
  followRate: 12, moveEps: 0.02, runSpeed: 0.4,
  /* đòn cận chiến TẠI CHỖ: bước tới ≤ lungeStep (≤0,25) rồi giật về, tuyệt kỹ bước hơi xa/lâu hơn */
  lungeMin: 0.28, lungeStep: 0.22, lungeStepUlt: 0.4, lungeUlt: 0.5,
  /* xoay mặt (rad/s), nghiêng người khi lao */
  turn: 14, lean: 0.22,
  /* sau khi ra đòn: giữ mặt hướng mục tiêu chừng này giây rồi quay về hướng phe */
  faceHold: 0.9,
  /* thời điểm đòn (giây cảnh kể từ act) */
  meleeHit: 0.17,
  releaseArcher: 0.18, releaseMage: 0.24, releaseSupport: 0.22,
  flightMin: 0.16, flightMax: 0.62, flightSpeed: 10,
  aoeStagger: 0.05,
  ultHit: 0.5,
  /* cắt cảnh tuyệt kỹ nhẹ (giây THẬT) + đẩy camera */
  cutInReal: 0.55, camNudge: 0.3,
} as const;
