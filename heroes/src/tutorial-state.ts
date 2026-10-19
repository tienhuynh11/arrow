// Trạng thái hướng dẫn tân thủ + lưu theo tài khoản trong localStorage (không có gì lên server).
import { signal } from '@preact/signals';
import type { MeResponse } from '@shared/heroes/api';
import { store } from './settings';
import { snapshot, STEPS, type Ctx } from './tutorial-steps';

const key = (uid: number) => `heroes-tutorial-v1-${uid}`;

/** lớp hướng dẫn đang chạy */
export const tutRunning = signal(false);
/** đã hoàn thành hoặc bỏ qua hẳn */
export const tutDone = signal(true);
export const tutIdx = signal(0);
/** ảnh chụp số liệu lúc vào bước hiện tại (đọc qua getCtx) */
let ctx: Ctx = { spend: 0, levels: 0 };
export const getCtx = () => ctx;
let uidNow = 0;

function save() {
  if (!uidNow) return;
  store(key(uidNow), JSON.stringify({ i: tutIdx.value, done: tutDone.value }));
}

/** gọi khi biết tài khoản: có bản ghi thì nối tiếp (chỉ hiện chip), tài khoản mới tinh thì tự bắt đầu, tài khoản cũ coi như đã xong */
export function initTutorial(uid: number, m: MeResponse) {
  uidNow = uid;
  let rec: { i?: number; done?: boolean } | null = null;
  try {
    rec = JSON.parse(store(key(uid)) || 'null');
  } catch {
    rec = null;
  }
  tutRunning.value = false;
  if (rec && typeof rec === 'object') {
    tutDone.value = !!rec.done;
    tutIdx.value = Math.min(Math.max(0, Number(rec.i) || 0), STEPS.length - 1);
    return;
  }
  if (m.progress.length === 0) {
    tutDone.value = false;
    tutIdx.value = 0;
    ctx = snapshot();
    tutRunning.value = true;
  } else {
    tutDone.value = true; // người chơi cũ: không làm phiền, vẫn xem lại được trong Cài đặt
  }
  save();
}

/** sang bước kế; hết bước thì kết thúc */
export function tutNext() {
  if (tutIdx.value >= STEPS.length - 1) return tutFinish();
  tutIdx.value += 1;
  ctx = snapshot();
  save();
}
export function tutFinish() {
  tutDone.value = true;
  tutRunning.value = false;
  save();
}
/** "Bỏ qua": kết thúc hẳn */
export const tutSkip = tutFinish;
/** Esc / nút đóng: tạm dừng, chip "Hướng dẫn" trên Thành để tiếp tục */
export function tutPause() {
  tutRunning.value = false;
  save();
}
export function tutResume() {
  tutDone.value = false;
  ctx = snapshot();
  tutRunning.value = true;
  save();
}
/** "Xem lại hướng dẫn" trong Cài đặt */
export function tutRestart() {
  tutIdx.value = 0;
  tutResume();
}
