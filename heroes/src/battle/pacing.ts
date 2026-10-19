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

/** di chuyển + trình diễn (đơn vị: đơn vị thế giới / giây cảnh) */
export const MOTION = {
  /* tốc độ chạy, gia tốc làm mượt, tầm đánh (khoảng cách đứng cách mục tiêu) */
  runSpeed: 4.2, accel: 9,
  rangeMelee: 1.3, rangeBossMelee: 2.1, rangeArcher: 3.6, rangeMage: 3.2, rangeSupport: 3.4,
  /** đơn vị tầm xa lùi lại khi địch lọt vào trong (tầm × tỉ lệ này) */
  tooClose: 0.62, backSpeed: 1.6,
  /** tầm xa chỉ tiến tối đa chừng này khỏi ô xuất phát (giữ hàng sau) */
  rangedAdvance: 1.5,
  /** giữ làn: lực kéo về toạ độ ngang của ô xuất phát */
  laneKeep: 0.9,
  /** tránh chồng nhau */
  sepRadius: 0.95, sepBoss: 1.5, sepForce: 5,
  /** xoay mặt (rad/s), nghiêng người khi chạy */
  turn: 14, lean: 0.22,
  /** đứng yên (giây cảnh) lúc đang vung/bắn */
  actLock: 0.28,
  /** nếu khi ra đòn còn xa mục tiêu: tăng tốc tạm thời (giây cảnh, hệ số) */
  catchUp: 0.45, catchUpMul: 3,
  /** sau khi sang đợt: tướng ta lướt về hàng xuất phát */
  regroup: 1.3,
  /* thời điểm đòn (giây cảnh kể từ act) */
  meleeHit: 0.2,
  releaseArcher: 0.18, releaseMage: 0.24, releaseSupport: 0.22,
  flightMin: 0.2, flightMax: 0.35, flightSpeed: 18,
  aoeStagger: 0.05,
  ultHit: 0.5,
  /* cắt cảnh tuyệt kỹ nhẹ (giây THẬT) + đẩy camera */
  cutInReal: 0.55, camNudge: 0.3,
} as const;
