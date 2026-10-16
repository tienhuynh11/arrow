// Hộp thoại CÀI ĐẶT: chuột & camera, âm thanh, đồ hoạ, phím, cảm ứng. Đổi là lưu ngay.

import { applyVolumes, sfxUi } from '../audio';
import { ACTIONS, DEFAULT_KEYS, keyLabel, resetSettings, saveSettings, settings, type Action } from '../settings';
import { clear, h } from './dom';

type Tab = 'mouse' | 'audio' | 'gfx' | 'keys' | 'touch';
let tab: Tab = 'mouse';

export function openSettings(onClose: () => void) {
  const root = h('div', { class: 'modal' });
  const body = h('div');
  const tabsEl = h('div', { class: 'tabs' });
  const card = h('div', { class: 'card' },
    h('h2', null, 'CÀI ĐẶT', h('button', { class: 'btn ghost sm', onclick: close }, 'Đóng ✕')),
    tabsEl,
    body,
    h('div', { class: 'row', style: 'margin-top:14px;justify-content:space-between' },
      h('button', { class: 'btn ghost sm', onclick: () => { resetSettings(); applyVolumes(); render(); } }, '↺ Mặc định'),
      h('button', { class: 'btn green', onclick: close }, 'Xong')),
  );
  root.append(card);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  let waitKey: ((e: KeyboardEvent | MouseEvent) => void) | null = null;

  function close() {
    if (waitKey) stopWait();
    root.remove();
    document.removeEventListener('keydown', escClose, true);
    onClose();
  }
  const escClose = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !waitKey) { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', escClose, true);

  function stopWait() {
    if (!waitKey) return;
    window.removeEventListener('keydown', waitKey as any, true);
    window.removeEventListener('mousedown', waitKey as any, true);
    waitKey = null;
  }

  const slider = (label: string, hint: string, key: 'sens' | 'adsSens' | 'fov' | 'camDist' | 'master' | 'sfx' | 'ambient' | 'shake' | 'touchSens' | 'touchScale', min: number, max: number, stepv: number, fmtv: (v: number) => string) => {
    const val = h('span', { class: 'val' }, fmtv(settings[key]));
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(stepv) }) as HTMLInputElement;
    inp.value = String(settings[key]);
    inp.addEventListener('input', () => {
      (settings as any)[key] = Number(inp.value);
      val.textContent = fmtv(settings[key]);
      saveSettings();
      if (key === 'master' || key === 'sfx' || key === 'ambient') applyVolumes();
    });
    inp.addEventListener('change', () => { if (key === 'sfx' || key === 'master') sfxUi(); });
    return h('div', { class: 'set' }, h('div', { class: 'lbl' }, label, hint ? h('small', null, hint) : null), h('div', { class: 'row' }, inp, val));
  };
  const toggle = (label: string, hint: string, key: 'invertY' | 'adsToggle' | 'dmgNumbers' | 'showFps' | 'aimAssist') => {
    const b = h('button', { class: `toggle${settings[key] ? ' on' : ''}`, 'aria-label': label }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      (settings as any)[key] = !settings[key];
      b.classList.toggle('on', settings[key]);
      saveSettings();
    });
    return h('div', { class: 'set' }, h('div', { class: 'lbl' }, label, hint ? h('small', null, hint) : null), b);
  };
  const seg = <T extends string>(label: string, hint: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      clear(wrap);
      for (const [v, t] of opts) wrap.append(h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); saveSettings(); draw(); } }, t));
    };
    draw();
    return h('div', { class: 'set' }, h('div', { class: 'lbl' }, label, hint ? h('small', null, hint) : null), wrap);
  };

  function render() {
    clear(tabsEl);
    const tabs: [Tab, string][] = [['mouse', '🖱️ Chuột & camera'], ['audio', '🔊 Âm thanh'], ['gfx', '🎨 Đồ hoạ'], ['keys', '⌨️ Phím'], ['touch', '📱 Cảm ứng']];
    for (const [t, l] of tabs) tabsEl.append(h('button', { class: tab === t ? 'on' : '', onclick: () => { tab = t; render(); } }, l));
    clear(body);
    if (tab === 'mouse') {
      body.append(
        slider('Độ nhạy chuột', 'Xoay camera khi rê chuột', 'sens', 0.05, 5, 0.05, (v) => v.toFixed(2)),
        slider('Độ nhạy khi ngắm (chuột phải)', 'Nhân với độ nhạy chính', 'adsSens', 0.2, 1.5, 0.05, (v) => `×${v.toFixed(2)}`),
        toggle('Đảo trục Y', 'Đẩy chuột lên thì nhìn xuống', 'invertY'),
        toggle('Ngắm kiểu bật/tắt', 'Bấm chuột phải một lần để ngắm thay vì giữ', 'adsToggle'),
        slider('Góc nhìn (FOV)', 'Rộng hơn = thấy nhiều khỉ hơn ở hai bên', 'fov', 55, 110, 1, (v) => `${v}°`),
        slider('Khoảng cách camera', 'Camera đứng sau vai bao xa', 'camDist', 2.2, 6, 0.1, (v) => `${v.toFixed(1)}m`),
        slider('Rung màn hình', 'Khi bắn / nổ / bị đánh', 'shake', 0, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
        crossColor(),
      );
    } else if (tab === 'audio') {
      body.append(
        slider('Âm lượng tổng', '', 'master', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
        slider('Hiệu ứng (súng, khỉ, nổ)', '', 'sfx', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
        slider('Âm thanh rừng', 'Gió, chim, côn trùng', 'ambient', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      );
    } else if (tab === 'gfx') {
      body.append(
        seg('Chất lượng đồ hoạ', 'Tự động: đoán theo máy rồi tự hạ nếu dưới 45 FPS', [['auto', 'Tự động'], ['high', 'Cao'], ['medium', 'Vừa'], ['low', 'Thấp']], () => settings.quality, (v) => { settings.quality = v; }),
        toggle('Hiện số sát thương', '', 'dmgNumbers'),
        toggle('Hiện FPS / ping', '', 'showFps'),
      );
    } else if (tab === 'keys') {
      const list = h('div');
      for (const [a, label] of ACTIONS) {
        const b = h('button', { class: 'keybtn' }, keyLabel(settings.keys[a])) as HTMLButtonElement;
        b.addEventListener('click', () => {
          stopWait();
          b.classList.add('wait');
          b.textContent = 'Nhấn phím…';
          waitKey = (e: KeyboardEvent | MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            let code = '';
            if (e instanceof KeyboardEvent) {
              if (e.code === 'Escape') { stopWait(); render(); return; }
              code = e.code;
            } else {
              if (e.button === 0 || e.button === 2) return;
              code = `Mouse${e.button}`;
            }
            // trùng phím: đổi chỗ cho nhau
            const other = (Object.keys(settings.keys) as Action[]).find((k) => k !== a && settings.keys[k] === code);
            if (other) settings.keys[other] = settings.keys[a];
            settings.keys[a] = code;
            saveSettings();
            stopWait();
            render();
          };
          window.addEventListener('keydown', waitKey as any, true);
          window.addEventListener('mousedown', waitKey as any, true);
        });
        list.append(h('div', { class: 'set' }, h('div', { class: 'lbl' }, label), b));
      }
      body.append(
        h('div', { class: 'sensprev' }, 'Chuột trái: bắn · Chuột phải: ngắm · Esc: tạm dừng. Bấm vào ô để đổi phím (nút chuột 4/5 cũng được).'),
        list,
        h('button', { class: 'btn ghost sm', style: 'margin-top:10px', onclick: () => { settings.keys = { ...DEFAULT_KEYS }; saveSettings(); render(); } }, 'Khôi phục phím mặc định'),
      );
    } else {
      body.append(
        slider('Độ nhạy vuốt ngắm', '', 'touchSens', 0.2, 3, 0.05, (v) => v.toFixed(2)),
        toggle('Hỗ trợ ngắm', 'Tâm ngắm chậm lại và hút nhẹ về khỉ gần tâm khi đang bắn', 'aimAssist'),
        slider('Cỡ nút', '', 'touchScale', 0.7, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`),
      );
    }
  }

  function crossColor() {
    const colors = ['#ffffff', '#ffd23f', '#5ee27d', '#5ab4ff', '#ff5ad1'];
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      clear(wrap);
      for (const c of colors) wrap.append(h('button', { class: settings.crossColor === c ? 'on' : '', style: `color:${c}`, onclick: () => { settings.crossColor = c; saveSettings(); draw(); } }, '✚'));
    };
    draw();
    return h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Màu tâm ngắm'), wrap);
  }

  render();
  document.getElementById('app')!.append(root);
  return close;
}
