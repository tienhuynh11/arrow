// Hình minh hoạ SVG vẽ tay (inline, không tải ảnh ngoài): súng theo họ, tim máu, huy hiệu kỹ năng.
// Mỗi hình nằm trong viewBox 120x60, nòng súng quay sang phải, viền tối + mảng sáng cho đồng bộ.

import { MAX_TIER, weaponOf } from '@shared/monkey/content';
import type { WeaponDef, WeaponModel } from '@shared/monkey/content';

export type GunModel = WeaponModel;

/** Dòng súng riêng của nhân vật: bậc 0..MAX_TIER. */
export function weaponLine(cls: number): WeaponDef[] {
  return Array.from({ length: MAX_TIER + 1 }, (_, t) => weaponOf(cls, t));
}

/* ---------- màu ---------- */
const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
function shade(n: number, f: number) {
  // f>0 pha trắng, f<0 pha đen
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return hex((ch[0] << 16) | (ch[1] << 8) | ch[2]);
}

let uid = 0;
const OL = '#140d06'; // viền
const METAL = '#4b5160';
const METAL_HI = '#8a93a6';
const WOOD = '#7a4b22';
const GRIP = '#2a2622';

function wrap(inner: string, defs: string, cls: string) {
  return `<svg class="${cls}" viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${defs}</defs>`
    + `<g stroke="${OL}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;
}

function gradDefs(id: string, color: number) {
  return `<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.35)}"/><stop offset=".55" stop-color="${hex(color)}"/><stop offset="1" stop-color="${shade(color, -0.45)}"/></linearGradient>`
    + `<linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${METAL_HI}"/><stop offset="1" stop-color="${METAL}"/></linearGradient>`
    + `<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a86a35"/><stop offset="1" stop-color="${WOOD}"/></linearGradient>`;
}

/** mảng sáng: vệt trắng mờ không viền */
const hi = (x: number, y: number, w: number, hh = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="1" fill="#fff" fill-opacity=".38" stroke="none"/>`;

function gunBody(model: GunModel, B: string, M: string, W: string, dark: string): string {
  switch (model) {
    case 'pistol':
      return `<path d="M44 33 L60 33 L57 54 L41 54 Z" fill="${GRIP}"/>`
        + `<path d="M58 35 q0 10 10 10 h4 v-10" fill="none"/>`
        + `<rect x="36" y="28" width="46" height="8" rx="2" fill="${dark}"/>`
        + `<rect x="86" y="21" width="8" height="6" fill="${M}"/>`
        + `<rect x="32" y="17" width="56" height="13" rx="3" fill="${B}"/>`
        + `<path d="M40 20 v7 M44 20 v7 M48 20 v7" stroke-width="1.5" opacity=".6"/>`
        + `<rect x="82" y="14" width="4" height="4" fill="${M}"/>`
        + hi(36, 19, 46) + `<path d="M44 38 L56 38 L54 50" fill="none" stroke="#fff" stroke-opacity=".12"/>`;
    case 'revolver':
      return `<path d="M38 28 C30 36 28 46 32 55 L47 55 C46 45 48 38 54 33 Z" fill="${W}"/>`
        + `<path d="M56 32 q0 10 9 10 h3 v-9" fill="none"/>`
        + `<rect x="60" y="19" width="48" height="8" rx="2" fill="${M}"/>`
        + `<rect x="104" y="14" width="3" height="5" fill="${M}"/>`
        + `<path d="M34 22 L60 20 L62 34 L38 34 Z" fill="${dark}"/>`
        + `<rect x="42" y="15" width="22" height="19" rx="5" fill="${B}"/>`
        + `<path d="M46 19 h14 M46 25 h14 M46 30 h14" stroke-width="1.5" opacity=".55"/>`
        + `<path d="M34 20 L28 12 L33 11 L39 18" fill="${M}"/>`
        + hi(62, 21, 40) + hi(45, 17, 16) + `<circle cx="39" cy="44" r="2" fill="#d9b26a"/>`;
    case 'smg':
      return `<path d="M30 22 H10 V34 L30 31" fill="none" stroke-width="3"/>`
        + `<path d="M10 22 V34" stroke-width="4"/>`
        + `<path d="M40 32 H50 L48 50 H38 Z" fill="${GRIP}"/>`
        + `<rect x="56" y="31" width="10" height="24" rx="2" fill="${M}"/>`
        + `<rect x="84" y="23" width="24" height="6" rx="2" fill="${M}"/>`
        + `<path d="M88 23 v6 M93 23 v6 M98 23 v6" stroke-width="1.2" opacity=".6"/>`
        + `<rect x="28" y="18" width="58" height="15" rx="3" fill="${B}"/>`
        + `<rect x="44" y="13" width="18" height="5" rx="1" fill="${dark}"/>`
        + `<path d="M70 22 h10" stroke-width="1.5" opacity=".6"/>`
        + hi(32, 20, 50) + hi(58, 34, 6, 18);
    case 'shotgun':
      return `<path d="M36 21 L6 25 L3 41 L14 42 L40 32 Z" fill="${W}"/>`
        + `<path d="M6 26 L3 41" stroke-width="4"/>`
        + `<path d="M44 32 q0 9 9 9 h3 v-9" fill="none"/>`
        + `<rect x="40" y="19" width="74" height="6" rx="2" fill="${M}"/>`
        + `<rect x="40" y="25" width="70" height="4" rx="1" fill="${dark}"/>`
        + `<rect x="64" y="26" width="32" height="9" rx="3" fill="${W}"/>`
        + `<path d="M70 28 v5 M75 28 v5 M80 28 v5 M85 28 v5 M90 28 v5" stroke-width="1.2" opacity=".55"/>`
        + `<rect x="32" y="17" width="30" height="16" rx="3" fill="${B}"/>`
        + `<circle cx="110" cy="17" r="2" fill="${M}"/>`
        + hi(42, 20, 68, 1.5) + hi(35, 19, 24) + hi(10, 27, 22, 1.5);
    case 'rifle':
      return `<path d="M30 21 L8 21 L5 37 L13 37 L30 33 Z" fill="${dark}"/>`
        + `<path d="M38 32 H48 L45 50 H35 Z" fill="${GRIP}"/>`
        + `<path d="M56 32 L67 32 L72 52 L61 55 Z" fill="${M}"/>`
        + `<rect x="98" y="24" width="16" height="4" rx="1" fill="${M}"/>`
        + `<rect x="112" y="22" width="4" height="8" rx="1" fill="${M}"/>`
        + `<rect x="74" y="20" width="26" height="12" rx="3" fill="${dark}"/>`
        + `<path d="M79 23 v6 M84 23 v6 M89 23 v6 M94 23 v6" stroke-width="1.4" opacity=".6"/>`
        + `<rect x="28" y="19" width="48" height="14" rx="3" fill="${B}"/>`
        + `<rect x="38" y="11" width="28" height="7" rx="2" fill="${M}"/>`
        + `<circle cx="66" cy="14.5" r="2.5" fill="#7dd3fc"/>`
        + `<path d="M96 20 V14" stroke-width="3"/>`
        + hi(32, 21, 40) + hi(41, 12.5, 20, 1.5) + hi(9, 23, 18, 1.5);
    case 'lmg':
      return `<path d="M28 20 L6 22 L4 38 L12 38 L28 34 Z" fill="${dark}"/>`
        + `<path d="M36 34 H46 L43 51 H33 Z" fill="${GRIP}"/>`
        + `<path d="M96 30 L89 53 M98 30 L106 53" stroke-width="3"/>`
        + `<rect x="76" y="23" width="40" height="6" rx="2" fill="${M}"/>`
        + `<rect x="78" y="20" width="22" height="11" rx="3" fill="${dark}"/>`
        + `<circle cx="83" cy="25.5" r="1.6" fill="${OL}" stroke="none"/><circle cx="89" cy="25.5" r="1.6" fill="${OL}" stroke="none"/><circle cx="95" cy="25.5" r="1.6" fill="${OL}" stroke="none"/>`
        + `<rect x="48" y="33" width="22" height="17" rx="2" fill="${dark}"/>`
        + `<path d="M48 40 h22" stroke-width="1.2" opacity=".6"/>`
        + `<rect x="26" y="17" width="52" height="17" rx="3" fill="${B}"/>`
        + `<path d="M46 17 V11 H62 V17" fill="none" stroke-width="3"/>`
        + `<path d="M36 22 h20" stroke-width="1.4" opacity=".6"/>`
        + hi(30, 19, 44) + hi(80, 22, 18, 1.5) + hi(51, 35, 16, 1.5);
    case 'sniper':
      return `<path d="M28 23 L4 23 L3 40 L16 40 L20 32 L30 32 Z" fill="${B}"/>`
        + `<path d="M9 28 h8 v6 h-8 Z" fill="${OL}" stroke="none"/>`
        + `<path d="M36 31 H45 L42 46 H33 Z" fill="${GRIP}"/>`
        + `<rect x="60" y="24" width="56" height="4" rx="1" fill="${M}"/>`
        + `<rect x="112" y="22" width="6" height="8" rx="1" fill="${M}"/>`
        + `<rect x="26" y="21" width="40" height="11" rx="3" fill="${B}"/>`
        + `<path d="M84 28 L80 40 M86 28 L91 40" stroke-width="2.5"/>`
        + `<path d="M44 21 v-4 M60 21 v-4" stroke-width="3"/>`
        + `<rect x="36" y="9" width="34" height="8" rx="3" fill="${M}"/>`
        + `<rect x="32" y="8" width="6" height="10" rx="2" fill="${dark}"/><rect x="68" y="7" width="7" height="12" rx="2" fill="${dark}"/>`
        + `<rect x="73" y="9" width="2" height="8" fill="#7dd3fc" stroke="none"/>`
        + `<circle cx="34" cy="34" r="2.5" fill="${M}"/>`
        + hi(30, 23, 32) + hi(39, 10.5, 28, 1.5) + hi(7, 25, 18, 1.5);
    case 'launcher':
      return `<path d="M44 33 H54 L51 51 H41 Z" fill="${GRIP}"/>`
        + `<path d="M72 33 H80 L79 46 H72 Z" fill="${GRIP}"/>`
        + `<path d="M108 25 q8 -2 10 0 q-2 6 -10 6 Z" fill="#facc15"/>`
        + `<path d="M104 15 L112 12 L112 38 L104 35 Z" fill="${M}"/>`
        + `<rect x="10" y="15" width="96" height="20" rx="6" fill="${B}"/>`
        + `<path d="M10 17 L4 13 L4 37 L10 33" fill="${M}"/>`
        + `<rect x="26" y="14" width="6" height="22" rx="1" fill="${dark}"/><rect x="88" y="14" width="6" height="22" rx="1" fill="${dark}"/>`
        + `<path d="M56 15 V8 H66 V15" fill="${M}"/>`
        + `<rect x="58" y="9" width="6" height="3" fill="#fca5a5" stroke="none"/>`
        + hi(14, 18, 88, 3) + hi(35, 23, 50, 1);
  }
}

/** SVG súng bên hông, tô theo màu súng (WeaponDef.color). */
export function gunSvg(w: WeaponDef, cls = 'gunpic'): string {
  const id = `g${++uid}`;
  const color = w.color ?? 0x6b7280;
  const B = `url(#${id}b)`, M = `url(#${id}m)`, W = `url(#${id}w)`;
  const shadow = `<ellipse cx="60" cy="56" rx="46" ry="2.6" fill="#000" fill-opacity=".35" stroke="none"/>`;
  return wrap(shadow + gunBody(w.model ?? 'rifle', B, M, W, shade(color, -0.35)), gradDefs(id, color), cls);
}

/** Tim máu có dấu cộng + số bậc. */
export function heartSvg(tier: number, cls = 'gunpic'): string {
  const id = `h${++uid}`;
  const defs = `<radialGradient id="${id}" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ff9a9a"/><stop offset=".55" stop-color="#ef4444"/><stop offset="1" stop-color="#8f1d1d"/></radialGradient>`;
  // vạch giáp xếp chồng = số bậc
  let armor = '';
  for (let i = 0; i < Math.min(tier, 6); i++) armor += `<rect x="88" y="${47 - i * 7}" width="20" height="5" rx="2" fill="#5ee27d"/>`;
  return wrap(
    `<ellipse cx="54" cy="56" rx="30" ry="2.6" fill="#000" fill-opacity=".35" stroke="none"/>`
    + `<path d="M54 52 C30 38 22 28 26 18 C30 8 44 7 54 18 C64 7 78 8 82 18 C86 28 78 38 54 52 Z" fill="url(#${id})" stroke-width="2.5"/>`
    + `<path d="M33 18 C35 13 41 12 45 15" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>`
    + `<path d="M54 22 V38 M46 30 H62" stroke="#fff" stroke-width="5"/>`
    + armor,
    defs, cls);
}

/** Huy hiệu tròn cho kỹ năng: vòng màu lớp + emoji biểu tượng ở giữa. */
export function badgeSvg(icon: string, color: number, cls = 'gunpic'): string {
  const id = `k${++uid}`;
  const defs = `<radialGradient id="${id}" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="${shade(color, 0.45)}"/><stop offset="1" stop-color="${shade(color, -0.5)}"/></radialGradient>`;
  const safe = icon.replace(/[<>&"]/g, '');
  return wrap(
    `<ellipse cx="60" cy="56" rx="22" ry="2.4" fill="#000" fill-opacity=".35" stroke="none"/>`
    + `<circle cx="60" cy="29" r="24" fill="url(#${id})" stroke-width="2.5"/>`
    + `<circle cx="60" cy="29" r="18" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>`
    + `<path d="M44 18 A20 20 0 0 1 60 9" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/>`
    + `<text x="60" y="37" text-anchor="middle" font-size="24" stroke="none">${safe}</text>`,
    defs, cls);
}

/** Bọc chuỗi SVG (do chính file này tạo) vào một phần tử. */
export function svgEl(svg: string, cls = 'pic'): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = svg;
  return el;
}
