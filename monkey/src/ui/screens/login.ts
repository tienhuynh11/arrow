// Màn đăng nhập / đăng ký (tên + mật khẩu) + lối "chơi vô tận không cần tài khoản".

import { MAX_PLAYERS } from '@shared/monkey/config';
import { api } from '../../api';
import * as A from '../../audio';
import { store } from '../../settings';
import { clear, h, toast } from '../dom';
import { S, closeModal, nav } from './ctx';

const NAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

/** tranh banner vẽ bằng SVG: đền rừng, mặt trời lặn, khỉ, chuối */
function bannerArt() {
  const el = h('div', { class: 'lgart' });
  el.innerHTML = `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
<linearGradient id="lgsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9f43"/><stop offset=".55" stop-color="#f5a524"/><stop offset="1" stop-color="#5a3b12"/></linearGradient>
<radialGradient id="lgsun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6c2"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></radialGradient>
<linearGradient id="lgban" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset="1" stop-color="#e0a800"/></linearGradient>
</defs>
<rect width="400" height="260" fill="url(#lgsky)"/>
<circle cx="200" cy="150" r="90" fill="url(#lgsun)"/>
<path d="M120 200 L140 120 L170 120 L175 95 L225 95 L230 120 L260 120 L280 200 Z" fill="#3b2a12" opacity=".75"/>
<path d="M188 95 L200 68 L212 95 Z" fill="#3b2a12" opacity=".75"/>
<rect x="190" y="150" width="20" height="50" rx="10" fill="#1d1408" opacity=".7"/>
<path d="M0 260 L0 170 Q30 140 60 165 Q80 120 110 160 Q130 150 140 200 L140 260 Z" fill="#1f3a12"/>
<path d="M400 260 L400 160 Q370 130 345 160 Q320 120 290 165 Q270 150 262 205 L262 260 Z" fill="#1f3a12"/>
<path d="M0 260 Q100 200 200 222 Q300 200 400 260 Z" fill="#13240f"/>
<g fill="#13240f"><path d="M40 260 L52 120 L58 120 L66 260 Z"/><path d="M55 122 Q20 100 5 120 Q30 108 55 126 Q30 130 18 152 Q42 132 57 128 Q70 140 80 165 Q76 135 60 124 Q90 112 110 128 Q92 104 58 120 Q62 92 48 78 Q56 100 55 122 Z"/>
<path d="M342 260 L350 110 L356 110 L366 260 Z"/><path d="M353 112 Q318 92 300 110 Q328 100 353 116 Q326 122 316 146 Q338 124 355 118 Q370 130 380 156 Q376 126 358 114 Q388 102 400 116 Q390 96 356 110 Q362 84 348 70 Q356 92 353 112 Z"/></g>
<g transform="translate(150 150)"><circle cx="0" cy="0" r="30" fill="#7c4a26" stroke="#2b1706" stroke-width="3"/><circle cx="-30" cy="-4" r="11" fill="#d9a066" stroke="#2b1706" stroke-width="3"/><circle cx="30" cy="-4" r="11" fill="#d9a066" stroke="#2b1706" stroke-width="3"/><ellipse cx="0" cy="8" rx="20" ry="16" fill="#d9a066"/><circle cx="-10" cy="-6" r="5" fill="#140d06"/><circle cx="10" cy="-6" r="5" fill="#140d06"/><circle cx="-8" cy="-8" r="1.6" fill="#fff"/><circle cx="12" cy="-8" r="1.6" fill="#fff"/><path d="M-9 12 Q0 20 9 12" fill="none" stroke="#140d06" stroke-width="3" stroke-linecap="round"/></g>
<g transform="translate(250 168) rotate(-25)"><path d="M-34 0 Q0 30 34 0 Q0 16 -34 0 Z" fill="url(#lgban)" stroke="#5b3a08" stroke-width="3" stroke-linejoin="round"/><path d="M30 -2 l8 -6" stroke="#5b3a08" stroke-width="4" stroke-linecap="round"/></g>
<g fill="#ffd23f" opacity=".85"><circle cx="70" cy="60" r="2"/><circle cx="320" cy="48" r="2.5"/><circle cx="280" cy="80" r="1.6"/><circle cx="110" cy="40" r="1.6"/></g>
</svg>`;
  return el;
}

export function renderLogin(msg?: string) {
  closeModal();
  const app = document.getElementById('app')!;
  clear(app);
  S.screen = 'login';
  let tab: 'login' | 'register' = 'login';
  let busy = false;
  const user = h('input', { maxlength: '20', placeholder: 'Tên đăng nhập', autocomplete: 'username', value: store('monkey-last-user') ?? '' }) as HTMLInputElement;
  const pass = h('input', { type: 'password', maxlength: '64', placeholder: 'Mật khẩu', autocomplete: 'current-password' }) as HTMLInputElement;
  const pass2 = h('input', { type: 'password', maxlength: '64', placeholder: 'Nhập lại mật khẩu', autocomplete: 'new-password' }) as HTMLInputElement;
  const err = h('div', { class: 'lgerr' }, msg ?? '');
  const submit = h('button', { class: 'btn green big', type: 'submit' }, 'ĐĂNG NHẬP') as HTMLButtonElement;
  const f2 = h('div', { class: 'field hidden' }, h('label', null, 'Nhập lại mật khẩu'), pass2);
  const hint = h('div', { class: 'lghint' });
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => {
    clear(tabs);
    tabs.append(
      h('button', { type: 'button', class: tab === 'login' ? 'on' : '', onclick: () => { tab = 'login'; sync(); } }, '🔑 ĐĂNG NHẬP'),
      h('button', { type: 'button', class: tab === 'register' ? 'on' : '', onclick: () => { tab = 'register'; sync(); } }, '✨ ĐĂNG KÝ'));
  };
  const sync = () => {
    drawTabs();
    f2.classList.toggle('hidden', tab === 'login');
    submit.textContent = tab === 'login' ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN';
    pass.autocomplete = tab === 'login' ? 'current-password' : 'new-password';
    hint.textContent = tab === 'register' ? 'Tên 3–20 ký tự (chữ, số, _ . -), mật khẩu từ 6 ký tự. Không cần email.' : 'Đăng nhập để vượt ải, cày đồ, mở khoá nhân vật và nhận quà sự kiện.';
    err.textContent = '';
  };
  const validate = (): string | null => {
    const u = user.value.trim();
    if (!NAME_RE.test(u)) return 'Tên đăng nhập 3–20 ký tự, chỉ gồm chữ, số, _ . -';
    if (pass.value.length < 6) return 'Mật khẩu cần ít nhất 6 ký tự';
    if (tab === 'register' && pass.value !== pass2.value) return 'Hai mật khẩu không khớp';
    return null;
  };
  const go = async (e?: Event) => {
    e?.preventDefault();
    A.initAudio();
    if (busy) return;
    const v = validate();
    if (v) {
      err.textContent = v;
      return;
    }
    busy = true;
    submit.disabled = true;
    err.textContent = '';
    const u = user.value.trim();
    try {
      if (tab === 'login') await api.login(u, pass.value);
      else await api.register(u, pass.value);
      store('monkey-last-user', u);
      toast(tab === 'login' ? `Chào mừng trở lại, ${u}!` : `Tạo tài khoản thành công — chào ${u}!`, true);
      A.sfxBuy();
      nav.hub('stages');
    } catch (ex) {
      err.textContent = (ex as Error).message || 'Có lỗi xảy ra';
      A.sfxDeny();
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };
  const form = h('form', { class: 'lgform', onsubmit: go },
    tabs,
    h('div', { class: 'field' }, h('label', null, 'Tên đăng nhập'), user),
    h('div', { class: 'field' }, h('label', null, 'Mật khẩu'), pass),
    f2,
    err,
    submit,
    hint);
  for (const i of [user, pass, pass2]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  app.append(h('div', { class: 'login' }, h('div', { class: 'card lgcard' },
    h('div', { class: 'lgside' },
      bannerArt(),
      h('div', { class: 'lgtitle' }, h('h1', { class: 'logo' }, 'SINH TỒN', h('small', null, 'BẦY KHỈ 🐒')),
        h('p', null, `Co-op 1–${MAX_PLAYERS} người · Vượt ải · Cày đồ · Sự kiện hằng tuần`))),
    h('div', { class: 'lgmain' },
      form,
      h('div', { class: 'lgor' }, h('span', null, 'hoặc')),
      h('button', { class: 'btn ghost', onclick: () => { A.initAudio(); nav.home(); } }, '♾️ Chơi vô tận không cần tài khoản'),
      h('div', { class: 'lgfoot' },
        h('button', { class: 'btn ghost sm', onclick: () => nav.help() }, '❓ Cách chơi'),
        h('button', { class: 'btn ghost sm', onclick: () => nav.settings() }, '⚙ Cài đặt'),
        document.fullscreenEnabled ? h('button', { class: 'btn ghost sm', onclick: () => nav.toggleFullscreen() }, '⛶') : null)))));
  sync();
  if (msg) err.textContent = msg;
  setTimeout(() => (user.value ? pass : user).focus(), 60);
}
