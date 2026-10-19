// Hộp thoại CÁCH CHƠI.

import { ULT_KILLS } from '@shared/monkey/content';
import { keyLabel, settings } from '../../settings';
import { h } from '../dom';
import { S, modal } from './ctx';

export function showHelp() {
  const k = settings.keys;
  const root = h('div', { class: 'modal' });
  const close = () => { root.remove(); if (S.modalClose === close) S.modalClose = null; };
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  const li = (a: string, b: string) => h('div', { class: 'set' }, h('div', { class: 'lbl' }, a), h('div', { style: 'font-weight:900;color:var(--banana)' }, b));
  root.append(h('div', { class: 'card' },
    h('h2', null, 'CÁCH CHƠI', h('button', { class: 'btn ghost sm', onclick: close }, 'Đóng ✕')),
    h('p', { style: 'color:var(--dim);line-height:1.6;margin-top:0' },
      'Mỗi đợt, khỉ ùa vào đền từ 10 cổng rừng. Hạ khỉ để nhận xu (đồng đội được chia 30%). Hết đợt được nghỉ ngắn để mua sắm. Mỗi 5 đợt có VUA KHỈ ĐỘT: nó đập đất tạo SÓNG XUNG KÍCH — hãy NHẢY để né. Máu về 0 thì bạn GỤC: đồng đội đứng cạnh giữ phím đỡ dậy trong 3 giây (Y sĩ nhanh gấp đôi). Gục quá 25 giây là tử trận và chỉ hồi sinh khi đội qua đợt. Cả đội gục là thua.'),
    h('h3', null, 'Vượt ải & cày đồ'),
    h('p', { style: 'color:var(--dim);line-height:1.6;margin-top:0;font-size:13.5px' },
      'Đăng nhập để chơi VƯỢT ẢI (3 chương × 10 ải). Ở sảnh, mở Nhân vật (C) + Hành trang (B) để kéo đồ vào ô trang bị: 2 súng, dao, mũ, giáp, bao tay, giày, đai, hộ phù, 2 nhẫn, trang phục, 2 ô vật phẩm và TÚI AN TOÀN. Vào ải chỉ dùng đúng đồ mang theo — không có cửa hàng. Khỉ bị hạ rơi túi đồ có cột sáng màu phẩm (Trắng · Xanh · Tím · Vàng · Cam): chạy qua để nhặt. Sống sót tới cuối thì mang được tất cả về; GỤC HẲN thì mất đồ đang mang, chỉ Túi an toàn còn lại. Thương nhân (N) bán thuốc, súng, giáp và mua lại đồ thừa.'),
    h('h3', null, 'Các loài khỉ'),
    h('div', { style: 'color:var(--dim);font-size:13.5px;line-height:1.7' },
      '🟤 Khỉ Nâu — thường · 🟠 Khỉ Chạy — rất nhanh, máu ít · 🟢 Khỉ Ném Chuối — đứng xa ném (né được) · 🔴 Khỉ Đỏ Nổ — áp sát rồi phát nổ (có vòng đỏ cảnh báo); bắn chết nó gần bầy khỉ khác thì nổ lây · ⚪ Khỉ Trắng — vồ từ xa · ⚫ Khỉ Đột — trâu, đập đất diện rộng · 👑 Vua Khỉ Đột — boss mỗi 5 đợt'),
    h('h3', null, 'Phím'),
    li('Di chuyển', `${keyLabel(k.forward)} ${keyLabel(k.left)} ${keyLabel(k.back)} ${keyLabel(k.right)}`),
    li('Bắn / Ngắm', 'Chuột trái / Chuột phải'),
    li('Nhảy · Chạy nhanh · Nạp đạn', `${keyLabel(k.jump)} · ${keyLabel(k.sprint)} · ${keyLabel(k.reload)}`),
    li('Chém dao (đánh sau lưng ×2)', keyLabel(k.knife)),
    li('Đỡ đồng đội dậy (giữ)', keyLabel(k.use)),
    li('Kỹ năng 1 · Kỹ năng 2 · Tuyệt chiêu', `${keyLabel(k.skillG)} · ${keyLabel(k.skillX)} · ${keyLabel(k.ult)}`),
    li('Ải: rút súng 1 / 2 · vật phẩm ô 3 / 4', `${keyLabel(k.weapon1)} / ${keyLabel(k.weapon2)} · ${keyLabel(k.item1)} / ${keyLabel(k.item2)}`),
    li('Đổi camera · Ngắm nghía súng', `${keyLabel(k.camera)} · ${keyLabel(k.inspect)}`),
    li('Sảnh: Nhân vật · Hành trang · Kỹ năng · Vượt ải · Sự kiện · Thương nhân · Xếp hạng · Vô tận · Cài đặt', 'C · B · K · M · E · N · L · V · O'),
    li('Vô tận: Nâng súng · Nâng máu · Cửa hàng', `${keyLabel(k.buyWeapon)} · ${keyLabel(k.buyHp)} · ${keyLabel(k.shop)}`),
    li('Bảng điểm · Tạm dừng · Chat', `${keyLabel(k.scores)} (giữ) · Esc · Enter`),
    li('Xoay camera bằng phím (dự phòng)', `${keyLabel(k.turnLeft)} ${keyLabel(k.turnRight)} ${keyLabel(k.lookUp)} ${keyLabel(k.lookDown)}`),
    h('p', { style: 'color:var(--dim);font-size:13px' }, 'Dùng touchpad trên laptop mà chạy (giữ W A S D) thì không xoay được camera? Đó là Windows tự khoá touchpad khi gõ phím: vào Cài đặt Windows → Bluetooth & thiết bị → Touchpad → Độ nhạy touchpad → "Nhạy nhất", hoặc dùng chuột rời, hoặc xoay bằng phím mũi tên.'),
    h('p', { style: 'color:var(--dim);font-size:13px' }, `Tuyệt chiêu sạc đầy sau ${ULT_KILLS} con khỉ. Mỗi nhân vật có dòng súng 5 bậc riêng (nâng bằng phím V).`)));
  document.getElementById('app')!.append(root);
  modal(close);
}
