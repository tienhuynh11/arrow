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
  /* z (làn) theo từng ô 0..5; x lấy THẲNG từ engine (mỗi ô một x riêng: hai ô cùng hàng so le ~450 đv = 0.375 thế giới, hàng cách 0.75).
     Làn trải ±1.6, 3 làn/hàng so le dạng gạch: hàng trước -1.0/+0.6, hàng giữa +1.6/-0.2, hàng sau -1.6/+1.0
     => mọi cặp đồng đội (x engine ban đầu) cách nhau ≥ ~1.0 thế giới ngay từ lúc xuất phát (xem sepSame bên dưới nếu vẫn sát nhau khi dàn trận đổi). */
  laneZ: [-1.0, 0.6, 1.6, -0.2, -1.6, 1.0] as readonly number[],
  /** boss đứng giữa */
  bossZ: 0,
  /* tách cảnh quan thuần hình ảnh: khoảng cách thế giới tối thiểu (xz) giữa hai đơn vị cùng phe / khác phe; chỉ đẩy theo z, bám mượt sepRate (1/giây) */
  sepSame: 0.9, sepFoe: 0.7, sepMax: 1.0, sepRate: 9,
  /** nhịp mở màn (giây THẬT): đứng yên để thấy hai đạo quân ở xa nhau trước khi tiến */
  readyReal: 0.8,
  /* x thế giới = (x_engine/12000 - 0.5) * 10 (xem worldX): nền bám x engine với tốc độ followRate (1/giây cảnh); chạy khi còn lệch > moveEps;
     runSpeed = tốc độ (đv thế giới/giây cảnh) tương ứng chạy hết cỡ (~40 đv engine/tick x 20Hz / 1200 ≈ 0.67); x đích đọc thẳng từ engine mỗi khung (không đợi sự kiện move) nên model không bị giật cục/trễ */
  followRate: 22, moveEps: 0.02, runSpeed: 0.7,
  /* đòn cận chiến TẠI CHỖ: bước tới ≤ lungeStep (≤0,25) rồi giật về, tuyệt kỹ bước hơi xa/lâu hơn */
  lungeMin: 0.24, lungeStep: 0.24, lungeStepUlt: 0.35, lungeUlt: 0.45,
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
