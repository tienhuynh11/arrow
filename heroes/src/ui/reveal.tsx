// Công bố kết quả gacha dùng chung: <Reveal pulls onClose />.
//  - UR: phim ngắn toàn màn hình (~4 s) trước khi lật thẻ: vòng phép + tia cầu vồng hội tụ -> loé sáng + sóng xung kích
//    -> tướng 3D xuất hiện LỚN trên bệ cầu vồng -> thẻ tên kiểu truyện tranh. 10 lượt: chiếu cho UR tốt nhất rồi mới lật thẻ.
//  - SSR (x1): bản nhẹ ~2 s cùng khung. SR: lấp lánh khi lật. R: như cũ.
// Tuỳ chỉnh nhanh: xem TUNE bên dưới. Mọi kích thước tính theo min(vw, vh) nên chạy được từ 360x640 tới 1920x1080.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { gsap } from 'gsap';
import { RARITIES, type Rarity } from '@shared/heroes/types';
import { sfx, type Sfx } from '../audio';
import { defOf } from '../game';
import { currentPreset, type QualityState } from '../render/quality';
import { runLive } from '../render/live';
import { createRevealScene, type RevealScene } from '../render/scenes';
import { Btn, Canvas3D, ElemChip, Portrait, RarityTag, RoleChip } from './common';
import { Icon } from './icons';
import './reveal.css';

/** hình dạng một lượt quay (khớp SummonRes['pulls'][number]) */
export interface RevealPull {
  heroId: string;
  rarity: Rarity;
  isNew?: boolean;
  shards: number;
}

export interface RevealProps {
  pulls: RevealPull[];
  onClose: () => void;
  /** tiêu đề nhỏ phía trên (vd. "Quà tân thủ"); bỏ trống = không hiện */
  title?: string;
  /** có thì hiện nút "Quay tiếp" cạnh "Đóng" ở bảng tổng kết */
  onAgain?: () => void;
  againLabel?: string;
}

/** CHỈNH TAY */
export const TUNE = {
  /** chạm màn hình để bỏ qua chỉ có tác dụng sau mốc này (giây); chip "Bỏ qua" thì luôn dùng được */
  skipAfter: 1.2,
  /** UR: giây (mốc loé sáng, hiện thẻ tên, nút tiếp tục) */
  ur: { flash: 2.15, title: 2.7, hold: 4.1 },
  /** SSR bản nhẹ */
  ssr: { flash: 0.55, title: 0.95, hold: 1.9 },
  /** 10 lượt có SSR nhưng không có UR: có chiếu phim SSR không (mặc định không để khỏi phiền) */
  ssrInBatch: false,
  /** số hạt nổ = preset.particles * hệ số này */
  burstMul: { UR: 14, SSR: 8 },
  /** hạt confetti/sao rơi mỗi giây theo mức chất lượng */
  confetti: { high: 42, medium: 28, low: 16 },
  /** biên độ rung màn hình (tỉ lệ min(vw,vh)) */
  shakeAmp: 0.014,
};

/** tiếng báo theo phẩm: R < SR < SSR < UR (stinger dâng dần) */
const REVEAL_SFX: Record<Rarity, Sfx> = { R: 'reveal', SR: 'revealSR', SSR: 'revealSSR', UR: 'revealUR' };
const BURST_COLOR: Record<string, string> = { SR: '#c79bff', SSR: '#ffd23f', UR: '#ff7be5' };

const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const vibrate = (p: number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* không hỗ trợ */
  }
};

/* ------------------------------ CHỌN PHIM ------------------------------ */
interface Cine {
  index: number;
  tier: 'UR' | 'SSR';
}
/** UR tốt nhất của lô (ưu tiên tướng MỚI), không có thì SSR khi quay x1 */
function pickCine(pulls: RevealPull[]): Cine | null {
  let best = -1;
  for (let i = 0; i < pulls.length; i++) {
    if (pulls[i].rarity !== 'UR') continue;
    if (best < 0 || (pulls[i].isNew && !pulls[best].isNew)) best = i;
  }
  if (best >= 0) return { index: best, tier: 'UR' };
  if (pulls.length === 1 || TUNE.ssrInBatch) {
    const i = pulls.findIndex((p) => p.rarity === 'SSR');
    if (i >= 0) return { index: i, tier: 'SSR' };
  }
  return null;
}

/* ------------------------------ LỚP HIỆU ỨNG CANVAS 2D ------------------------------ */
const PAL = ['#ff4d6d', '#ffb52e', '#ffe14d', '#5cff9d', '#4dd8ff', '#8a7bff', '#ff7be5', '#ffffff'];
const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// toạ độ đơn vị của lục giác (cho hình ngôi sao 6 cánh trong vòng phép)
const HX = [0, 1, 2, 3, 4, 5].map((k) => Math.cos(-Math.PI / 2 + (k * TAU) / 6));
const HY = [0, 1, 2, 3, 4, 5].map((k) => Math.sin(-Math.PI / 2 + (k * TAU) / 6));
const HEDGE = [[0, 2], [2, 4], [4, 0], [1, 3], [3, 5], [5, 1]];

/** trạng thái do GSAP tween (không phải state của Preact) */
interface FxState {
  circle: number;
  circleA: number;
  rot: number;
  rotV: number;
  shake: number;
  shock: number;
  suck: number;
  conf: number;
}

/** vẽ vòng phép, sóng xung kích, hạt/confetti; bể hạt cấp phát sẵn nên không tạo đối tượng mỗi khung */
function createFx(canvas: HTMLCanvasElement, q: QualityState, shake: (x: number, y: number) => void) {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(q.dpr, 1.5);
  const PMAX = q.level === 'high' ? 280 : q.level === 'medium' ? 200 : 120;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX), vx = new Float32Array(PMAX), vy = new Float32Array(PMAX);
  const life = new Float32Array(PMAX), lmax = new Float32Array(PMAX), size = new Float32Array(PMAX), rot = new Float32Array(PMAX), vr = new Float32Array(PMAX);
  const kind = new Uint8Array(PMAX), col = new Uint8Array(PMAX);
  const glows = PAL.map((c) => {
    const g = document.createElement('canvas');
    g.width = g.height = 48;
    const x = g.getContext('2d')!;
    const gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.3, c);
    gr.addColorStop(1, `${c}00`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 48, 48);
    return g;
  });
  const s: FxState = { circle: 0, circleA: 1, rot: 0, rotV: 0.6, shake: 0, shock: 0, suck: 0, conf: 0 };
  let w = 1, h = 1, u = 1, cx = 0, cy = 0;
  let cur = 0, acc1 = 0, acc2 = 0, shaking = false;
  const rate = q.level === 'high' ? TUNE.confetti.high : q.level === 'medium' ? TUNE.confetti.medium : TUNE.confetti.low;

  const resize = () => {
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    u = Math.min(w, h);
    cx = w / 2;
    cy = h * 0.46;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  resize();

  const spawn = (x: number, y: number, ax: number, ay: number, l: number, sz: number, k: number, c: number) => {
    for (let n = 0; n < PMAX; n++) {
      const i = (cur + n) % PMAX;
      if (life[i] > 0) continue;
      cur = (i + 1) % PMAX;
      px[i] = x; py[i] = y; vx[i] = ax; vy[i] = ay; life[i] = l; lmax[i] = l; size[i] = sz; kind[i] = k; col[i] = c;
      rot[i] = Math.random() * TAU; vr[i] = (Math.random() - 0.5) * 8;
      return;
    }
  };

  /** nổ tung từ tâm: tia sáng + sao */
  const burst = (n: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = u * (0.25 + Math.random() * 0.9);
      spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random() * 0.9, u * (0.012 + Math.random() * 0.022), 0, (Math.random() * 8) | 0);
    }
    for (let i = 0; i < n / 4; i++) {
      const a = Math.random() * TAU;
      const sp = u * (0.2 + Math.random() * 0.5);
      spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp, 1 + Math.random(), u * (0.02 + Math.random() * 0.02), 2, (Math.random() * 8) | 0);
    }
  };

  const strokeArc = (r: number, f: number) => {
    if (f <= 0) return;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    ctx.stroke();
  };

  const drawCircle = () => {
    const c = s.circle;
    if (c <= 0 || s.circleA <= 0.01) return;
    const R = u * 0.36;
    const co = Math.cos(s.rot) * dpr, si = Math.sin(s.rot) * dpr;
    ctx.setTransform(co, si, -si, co, cx * dpr, cy * dpr);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.globalAlpha = s.circleA * (0.2 + c * 0.5);
    ctx.drawImage(glows[1], -R * 1.5, -R * 1.5, R * 3, R * 3);
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? u * 0.006 : u * 0.024;
      ctx.strokeStyle = pass ? '#fff4c2' : '#ff5cd0';
      ctx.globalAlpha = s.circleA * (pass ? 1 : 0.3);
      strokeArc(R, clamp01(c * 2));
      strokeArc(R * 0.86, clamp01((c - 0.1) * 2));
      strokeArc(R * 0.5, clamp01((c - 0.3) * 2.2));
      // ngôi sao 6 cánh vẽ dần từng cạnh
      for (let e = 0; e < 6; e++) {
        const f = clamp01((c - 0.35 - e * 0.06) / 0.3);
        if (f <= 0) continue;
        const a = HEDGE[e][0], b = HEDGE[e][1];
        const x0 = HX[a] * R * 0.84, y0 = HY[a] * R * 0.84, x1 = HX[b] * R * 0.84, y1 = HY[b] * R * 0.84;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        ctx.stroke();
      }
      // 12 ký tự rune giữa hai vòng
      for (let k = 0; k < 12; k++) {
        const f = clamp01((c - 0.25 - k * 0.04) / 0.15);
        if (f <= 0) continue;
        ctx.globalAlpha = s.circleA * f * (pass ? 1 : 0.3);
        const a = (k / 12) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        const m = k % 3;
        if (m === 0) {
          ctx.moveTo(ca * R * 0.89, sa * R * 0.89);
          ctx.lineTo(ca * R * 0.97, sa * R * 0.97);
        } else if (m === 1) {
          ctx.arc(ca * R * 0.93, sa * R * 0.93, u * 0.011, 0, TAU);
        } else {
          const px2 = -sa * u * 0.012, py2 = ca * u * 0.012;
          ctx.moveTo(ca * R * 0.89 + px2, sa * R * 0.89 + py2);
          ctx.lineTo(ca * R * 0.97, sa * R * 0.97);
          ctx.lineTo(ca * R * 0.89 - px2, sa * R * 0.89 - py2);
        }
        ctx.stroke();
      }
    }
  };

  const drawShock = () => {
    if (s.shock <= 0 || s.shock >= 1) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const f = s.shock - k * 0.12;
      if (f <= 0) continue;
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.lineWidth = u * (0.03 * (1 - f) + 0.004);
      ctx.strokeStyle = k === 0 ? '#ffffff' : k === 1 ? '#ffe9a8' : '#ff9be8';
      ctx.beginPath();
      ctx.arc(cx, cy, u * (0.05 + f * 0.9), 0, TAU);
      ctx.stroke();
    }
  };

  const tick = (dtms: number) => {
    const dt = Math.min(dtms, 50) / 1000;
    s.rot += dt * s.rotV;
    if (s.shake > 0.003) {
      const a = s.shake * u * TUNE.shakeAmp * 2;
      shake((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      shaking = true;
    } else if (shaking) {
      shake(0, 0);
      shaking = false;
    }
    // tia sáng hút vào tâm trước khi nổ
    acc1 += dt * s.suck;
    while (acc1 >= 1) {
      acc1 -= 1;
      const a = Math.random() * TAU, r = u * (0.35 + Math.random() * 0.35), sp = u * (0.5 + Math.random() * 0.5);
      spawn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, -Math.cos(a) * sp, -Math.sin(a) * sp, r / sp, u * 0.016, 0, (Math.random() * 8) | 0);
    }
    // confetti + sao rơi
    acc2 += dt * s.conf * rate;
    while (acc2 >= 1) {
      acc2 -= 1;
      const v = u * (0.18 + Math.random() * 0.3);
      spawn(Math.random() * w, -u * 0.03, (Math.random() - 0.5) * u * 0.08, v, h / v + 0.2, u * (0.012 + Math.random() * 0.014), Math.random() < 0.35 ? 2 : 1, (Math.random() * 8) | 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    drawCircle();
    drawShock();
    for (let i = 0; i < PMAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      rot[i] += vr[i] * dt;
      if (kind[i] === 1) px[i] += Math.sin(rot[i] * 1.3) * u * 0.05 * dt;
    }
    // lượt 1: sáng cộng (tia, sao)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < PMAX; i++) {
      if (life[i] <= 0 || kind[i] === 1) continue;
      const a = Math.min(1, life[i] / lmax[i] * 1.6);
      ctx.globalAlpha = a;
      const sz = size[i];
      if (kind[i] === 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(glows[col[i]], px[i] - sz * 1.5, py[i] - sz * 1.5, sz * 3, sz * 3);
      } else {
        const c = Math.cos(rot[i]) * dpr, si = Math.sin(rot[i]) * dpr;
        ctx.setTransform(c, si, -si, c, px[i] * dpr, py[i] * dpr);
        ctx.fillStyle = PAL[col[i]];
        ctx.beginPath();
        ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.28, -sz * 0.28); ctx.lineTo(sz, 0); ctx.lineTo(sz * 0.28, sz * 0.28);
        ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.28, sz * 0.28); ctx.lineTo(-sz, 0); ctx.lineTo(-sz * 0.28, -sz * 0.28);
        ctx.closePath();
        ctx.fill();
      }
    }
    // lượt 2: confetti giấy
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < PMAX; i++) {
      if (life[i] <= 0 || kind[i] !== 1) continue;
      ctx.globalAlpha = Math.min(1, life[i] * 3);
      const c = Math.cos(rot[i]) * dpr, si = Math.sin(rot[i]) * dpr;
      ctx.setTransform(c, si, -si, c, px[i] * dpr, py[i] * dpr);
      ctx.fillStyle = PAL[col[i]];
      const f = Math.abs(Math.sin(rot[i] * 2.2)) * 0.9 + 0.1;
      ctx.fillRect(-size[i] * 0.5, -size[i] * 0.3 * f, size[i], size[i] * 0.6 * f);
    }
  };

  return { s, tick, resize, burst };
}

/* ------------------------------ PHIM UR / SSR ------------------------------ */
function Cinematic({ pull, tier, onDone }: { pull: RevealPull; tier: 'UR' | 'SSR'; onDone: () => void }) {
  const d = defOf(pull.heroId);
  const ur = tier === 'UR';
  const preset = useMemo(() => currentPreset(), []);
  const reduced = useMemo(reducedMotion, []);
  // 3D thật chỉ cho UR, máy không phải mức thấp, không giảm chuyển động; còn lại dùng ảnh chân dung đã cache
  const wantLive = ur && preset.level !== 'low' && !reduced;
  const [fallback, setFallback] = useState(false);
  const live = wantLive && !fallback;
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RevealScene | null>(null);
  const finishRef = useRef<() => void>(() => {});
  const readyRef = useRef(false);
  const t0 = useRef(performance.now());
  const starN = ur ? 5 : 4;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    const stage = q('.cx-stage'), bright = q('.cx-bright'), rays = q('.cx-rays'), sun = q('.cx-sun');
    const canvas = q<HTMLCanvasElement>('.cx-fx'), hero = q('.cx-hero'), flash = q('.cx-flash'), cont = q('.cx-cont');
    const badge = q('.cx-badge'), name = q('.cx-name'), sub = q('.cx-sub'), chips = q('.cx-chips'), tag = q('.cx-tag');
    const stars = root.querySelectorAll('.cx-stars svg');
    const T = ur ? TUNE.ur : TUNE.ssr;
    const setX = gsap.quickSetter(stage, 'x', 'px') as (v: number) => void;
    const setY = gsap.quickSetter(stage, 'y', 'px') as (v: number) => void;
    const fx = reduced ? null : createFx(canvas, preset, (x, y) => { setX(x); setY(y); });
    const onResize = () => fx?.resize();
    addEventListener('resize', onResize);
    if (fx) gsap.ticker.add(fxTick);
    function fxTick(_t: number, dtms: number) {
      fx!.tick(dtms);
    }

    let finished = false;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      const S = fx?.s;
      flash.style.background = ur ? '#ffffff' : 'radial-gradient(circle at 50% 46%, #fff, #ffe27a 60%)';
      const n = Math.round(preset.particles * (ur ? TUNE.burstMul.UR : TUNE.burstMul.SSR));
      const pop = () => sceneRef.current?.show();

      if (reduced) {
        // giảm chuyển động: chỉ mờ dần hiện, không loé/rung/hạt
        tl.fromTo(bright, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);
        tl.fromTo(sun, { opacity: 0 }, { opacity: 0.45, duration: 0.4 }, 0);
        tl.fromTo(hero, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.2);
        tl.fromTo([badge, name, sub, chips, tag, ...Array.from(stars)], { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, 0.4);
        tl.fromTo(cont, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, 0.8);
        tl.call(() => { readyRef.current = true; }, [], 0.8);
        tl.call(sfx, [REVEAL_SFX[tier]], 0.2);
        return;
      }

      // ---- (a) mở màn: tối, vòng phép, tia hội tụ, rung tăng dần ----
      tl.call(sfx, ['spin'], 0);
      if (ur) {
        const rayRot = gsap.to(rays, { rotation: 360, duration: 14, repeat: -1, ease: 'none' });
        tl.fromTo(rays, { scale: 2.6, opacity: 0 }, { scale: 0.8, opacity: 0.95, duration: T.flash, ease: 'power2.in' }, 0);
        tl.to(rayRot, { timeScale: 10, duration: T.flash, ease: 'power3.in' }, 0);
        tl.to(S!, { circle: 1, duration: 1.45, ease: 'power2.out' }, 0.15);
        tl.to(S!, { rotV: 7, duration: T.flash - 0.15, ease: 'power2.in' }, 0.15);
        tl.to(S!, { shake: 1, duration: T.flash - 0.3, ease: 'power3.in' }, 0.3);
        tl.to(S!, { suck: 70, duration: 1.3, ease: 'power1.in' }, 0.8);
        tl.call(sfx, ['ultReady'], 1.0);
        tl.call(sfx, ['spin'], 1.4);
        tl.call(sfx, ['ult'], 1.7);
      } else {
        // SSR: tia vàng cuộn vào rồi nổ
        tl.fromTo(sun, { scale: 2.4, opacity: 0 }, { scale: 0.9, opacity: 0.95, duration: T.flash, ease: 'power2.in' }, 0);
        tl.to(S!, { shake: 0.7, duration: T.flash, ease: 'power2.in' }, 0);
        tl.to(S!, { suck: 40, duration: T.flash - 0.1, ease: 'power1.in' }, 0.1);
      }

      // ---- (b) loé sáng + sóng xung kích + nổ hạt ----
      tl.call(() => {
        sfx(REVEAL_SFX[tier]);
        if (ur) sfx('ultBoom');
        if (ur) vibrate([30, 40, 60]);
        fx!.burst(n);
      }, [], T.flash);
      tl.set(S!, { suck: 0 }, T.flash);
      tl.fromTo(flash, { opacity: 1 }, { opacity: 0, duration: ur ? 0.75 : 0.55, ease: 'power2.out', immediateRender: false }, T.flash);
      tl.fromTo(S!, { shock: 0 }, { shock: 1, duration: 1, ease: 'power2.out', immediateRender: false }, T.flash);
      tl.fromTo(S!, { shake: ur ? 1.7 : 1 }, { shake: 0, duration: 0.9, ease: 'power2.out', immediateRender: false }, T.flash);
      tl.to(bright, { opacity: 1, duration: 0.7 }, T.flash);
      if (ur) {
        tl.to(rays, { opacity: 0, duration: 0.25 }, T.flash);
        tl.to(S!, { circleA: 0, duration: 0.35 }, T.flash);
        tl.fromTo(sun, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1.15, duration: 0.9, ease: 'power2.out', immediateRender: false }, T.flash);
        gsap.to(sun, { rotation: 360, duration: 30, repeat: -1, ease: 'none' });
        tl.set(S!, { conf: 1 }, T.flash + 0.25);
      } else {
        tl.to(sun, { scale: 1.2, duration: 1.2, ease: 'power2.out' }, T.flash);
        gsap.to(sun, { rotation: 360, duration: 24, repeat: -1, ease: 'none' });
        tl.set(S!, { conf: 0.45 }, T.flash + 0.2);
      }

      // ---- (c) tướng xuất hiện ----
      tl.fromTo(hero, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(2)', immediateRender: false }, T.flash + 0.05);
      tl.call(pop, [], T.flash + 0.05);

      // ---- (d) thẻ tên kiểu truyện tranh ----
      const k = T.title;
      tl.fromTo(badge, { opacity: 0, scale: 4, rotation: -25 }, { opacity: 1, scale: 1, rotation: -6, duration: 0.45, ease: 'back.out(2.4)', immediateRender: false }, k);
      tl.call(sfx, ['heavy'], k + 0.15);
      tl.fromTo(S!, { shake: ur ? 0.7 : 0.4 }, { shake: 0, duration: 0.35, immediateRender: false }, k + 0.15);
      tl.fromTo(name, { opacity: 0, xPercent: -60, skewX: -25 }, { opacity: 1, xPercent: 0, skewX: 0, duration: 0.5, ease: 'power4.out', immediateRender: false }, k + 0.15);
      tl.fromTo(stars, { opacity: 0, scale: 0, rotation: -90 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.35, stagger: 0.07, ease: 'back.out(3)', immediateRender: false }, k + 0.3);
      tl.fromTo(sub, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35, immediateRender: false }, k + 0.4);
      tl.fromTo(chips, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35, immediateRender: false }, k + 0.5);
      tl.fromTo(tag, { opacity: 0, scale: 0, rotation: 12 }, { opacity: 1, scale: 1, rotation: -4, duration: 0.6, ease: 'elastic.out(1, 0.45)', immediateRender: false }, k + 0.65);

      // ---- (e) giữ khung, chờ chạm ----
      tl.fromTo(cont, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, immediateRender: false }, T.hold);
      tl.call(() => { readyRef.current = true; }, [], T.hold);
    }, root);

    const finish = () => {
      if (finished) return;
      finished = true;
      gsap.ticker.remove(fxTick);
      gsap.to(root, { opacity: 0, duration: 0.18, onComplete: onDone });
    };
    finishRef.current = finish;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      if (readyRef.current || performance.now() - t0.current > TUNE.skipAfter * 1000) finish();
    };
    addEventListener('keydown', onKey);
    return () => {
      finished = true;
      removeEventListener('keydown', onKey);
      removeEventListener('resize', onResize);
      gsap.ticker.remove(fxTick);
      ctx.revert(); // dừng và dọn mọi tween trong ngữ cảnh (kể cả tween vô hạn)
      gsap.killTweensOf(root);
      setX(0);
      setY(0);
    };
  }, []);

  const onPointer = () => {
    if (readyRef.current || performance.now() - t0.current > TUNE.skipAfter * 1000) finishRef.current();
  };
  const start = (canvas: HTMLCanvasElement) => {
    try {
      const rs = createRevealScene();
      rs.setHero(d.id, d.rarity);
      const h = runLive(canvas, rs, 60);
      if (!h.ok) {
        h.stop();
        setFallback(true);
        return undefined;
      }
      sceneRef.current = rs;
      return () => {
        sceneRef.current = null;
        h.stop(); // trả WebGL context
      };
    } catch {
      setFallback(true);
      return undefined;
    }
  };

  return (
    <div class={`reveal cx cx-${tier}${reduced ? ' cx-reduced' : ''}`} ref={rootRef} role="dialog" aria-label={`Triệu hồi được ${d.name}`} onPointerDown={onPointer}>
      <div class="cx-stage">
        <div class="cx-bg" />
        <div class="cx-bright" />
        <div class="cx-rays" />
        <div class="cx-sun" />
        {!live && (
          <>
            <i class="cx-beam b1" /><i class="cx-beam b2" /><i class="cx-beam b3" />
          </>
        )}
        <div class="cx-hero">
          {live ? <Canvas3D class="cx-3d" start={start} /> : (
            <>
              <i class="cx-ped" />
              <div class="cx-img"><Portrait id={d.id} rarity={d.rarity} /></div>
            </>
          )}
        </div>
        <canvas class="cx-fx" />
        <div class="cx-title">
          <div class="cx-badge">{tier}</div>
          <div class="cx-stars">{Array.from({ length: starN }, (_, i) => <Icon key={i} n="star" size={28} />)}</div>
          <h1 class="cx-name">{d.name}</h1>
          <div class="cx-sub">{d.title}</div>
          <div class="cx-chips"><ElemChip el={d.element} label /><RoleChip role={d.role} label /></div>
          <div class={`cx-tag${pull.isNew ? ' new' : ''}`}>{pull.isNew ? 'MỚI!' : `+${pull.shards} mảnh`}</div>
        </div>
        <div class="cx-flash" />
      </div>
      <button type="button" class="cx-skip" onPointerDown={(e) => e.stopPropagation()} onClick={() => { sfx('tap'); finishRef.current(); }}>
        Bỏ qua
      </button>
      <button type="button" class="cx-cont btn primary big" onPointerDown={(e) => e.stopPropagation()} onClick={() => { if (readyRef.current) { sfx('tap'); finishRef.current(); } }}>
        TIẾP TỤC
      </button>
    </div>
  );
}

/* ------------------------------ THẺ & LƯỚI KẾT QUẢ ------------------------------ */
function RevealCard({ p, open, hl }: { p: RevealPull; open: boolean; hl?: boolean }) {
  const d = defOf(p.heroId);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // GSAP: lật thẻ có nảy quá đà (overshoot); SSR/UR thêm nhún phóng to. Tắt transition CSS cũ để không đánh nhau.
  useEffect(() => {
    const inner = innerRef.current;
    const card = cardRef.current;
    if (!open || !inner || !card) return;
    inner.style.transition = 'none';
    const rare = p.rarity === 'SSR' || p.rarity === 'UR';
    const tl = gsap.timeline();
    tl.fromTo(inner, { rotationY: 0 }, { rotationY: 180, duration: rare ? 0.75 : 0.55, ease: 'back.out(1.8)' }, 0);
    tl.fromTo(card, { scale: 0.92 }, { scale: rare ? 1.12 : 1, duration: 0.22, ease: 'power2.out' }, 0);
    tl.to(card, { scale: 1, duration: 0.35, ease: 'elastic.out(1, 0.5)' }, 0.22);
    return () => {
      tl.kill();
    };
  }, [open]);
  return (
    <div class={`rv-card r-${p.rarity}${open ? ' open' : ''}${hl ? ' rv-hl' : ''}`} ref={cardRef}>
      <div class="rv-inner" ref={innerRef}>
        <div class="rv-back">
          <Icon n="sparkle" size={36} />
        </div>
        <div class="rv-front">
          <div class="rv-art">
            <Portrait id={d.id} rarity={d.rarity} />
            {p.rarity === 'UR' && <span class="shimmer" />}
          </div>
          <RarityTag r={p.rarity} />
          <b class="rv-name">{d.name}</b>
          <div class="rv-meta">
            <ElemChip el={d.element} />
            <RoleChip role={d.role} />
          </div>
          {p.isNew ? <span class="rv-new">MỚI!</span> : <span class="rv-dupe">+{p.shards} mảnh</span>}
        </div>
      </div>
    </div>
  );
}

/** dòng tổng kết sau khi lật hết (chỉ khi nhiều lượt) */
function Summary({ pulls }: { pulls: RevealPull[] }) {
  const cnt: Record<Rarity, number> = { R: 0, SR: 0, SSR: 0, UR: 0 };
  let shards = 0;
  let news = 0;
  for (const p of pulls) {
    cnt[p.rarity]++;
    if (p.isNew) news++;
    else shards += p.shards;
  }
  return (
    <div class="rv-sum">
      {RARITIES.slice().reverse().filter((r) => cnt[r]).map((r) => (
        <span class="rv-sc" key={r}><RarityTag r={r} /> x{cnt[r]}</span>
      ))}
      {news > 0 && <span class="rv-sn">MỚI x{news}</span>}
      {shards > 0 && <b class="rv-sh">+{shards} mảnh</b>}
    </div>
  );
}

function Cards({ pulls, onClose, title, onAgain, againLabel, hl }: RevealProps & { hl: number }) {
  const [shown, setShown] = useState(0);
  const all = shown >= pulls.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hl < 0) sfx('spin');
  }, []);
  // dọn mọi tween/hạt còn dang dở khi rời màn
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      if (!root) return;
      gsap.killTweensOf(root.querySelectorAll('.rv-pt, .rv-flash'));
    };
  }, []);
  /** SR: lấp lánh; SSR/UR: loé màn hình + tia sáng toả ra từ thẻ vừa lật (số hạt theo preset chất lượng) */
  const burst = (i: number, rarity: Rarity) => {
    const root = rootRef.current;
    const fl = flashRef.current;
    const card = gridRef.current?.children[i] as HTMLElement | undefined;
    const col = BURST_COLOR[rarity];
    if (!root || !fl || !card || !col) return;
    const ur = rarity === 'UR';
    const sr = rarity === 'SR';
    // thẻ UR vừa có phim riêng thì không loé nữa
    if (!sr && i !== hl) {
      fl.style.background = `radial-gradient(circle at 50% 45%, ${col}, ${col}00 70%)`;
      gsap.fromTo(fl, { opacity: ur ? 0.95 : 0.7 }, { opacity: 0, duration: ur ? 0.8 : 0.55, ease: 'power2.out', overwrite: true });
    }
    const r = card.getBoundingClientRect();
    const o = root.getBoundingClientRect();
    const cx = r.left - o.left + r.width / 2;
    const cy = r.top - o.top + r.height / 2;
    const n = currentPreset().particles * (ur ? 3 : sr ? 1 : 2);
    for (let k = 0; k < n; k++) {
      const e = document.createElement('i');
      e.className = 'rv-pt';
      const sz = (sr ? 4 : 6) + Math.random() * (sr ? 5 : 8);
      Object.assign(e.style, {
        position: 'absolute', left: `${cx}px`, top: `${cy}px`, width: `${sz}px`, height: `${sz}px`, marginLeft: `${-sz / 2}px`, marginTop: `${-sz / 2}px`,
        borderRadius: k % 3 ? '50%' : '2px', background: k % 2 ? '#fff' : col, pointerEvents: 'none', zIndex: '3', willChange: 'transform, opacity',
      } as Partial<CSSStyleDeclaration>);
      root.append(e);
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const dist = (ur ? 150 : sr ? 70 : 110) * (0.6 + Math.random() * 0.7);
      gsap.to(e, {
        x: Math.cos(a) * dist, y: Math.sin(a) * dist, rotation: Math.random() * 360, scale: 0.2, opacity: 0, duration: 0.7 + Math.random() * 0.4,
        ease: 'power2.out', onComplete: () => e.remove(),
      });
    }
  };
  useEffect(() => {
    if (all) return;
    const t = setTimeout(() => {
      const p = pulls[shown];
      sfx(shown === hl ? 'reveal' : REVEAL_SFX[p.rarity]);
      // đợi thẻ lật tới nửa vòng rồi mới bùng sáng
      if (p.rarity !== 'R') gsap.delayedCall(0.3, () => burst(shown, p.rarity));
      setShown(shown + 1);
    }, shown === 0 ? 450 : pulls.length === 1 ? 300 : 320);
    return () => clearTimeout(t);
  }, [shown, all, pulls]);
  const best = pulls.reduce<Rarity>((b, p) => (RARITIES.indexOf(p.rarity) > RARITIES.indexOf(b) ? p.rarity : b), 'R');
  return (
    <div class={`reveal best-${best}`} ref={rootRef}>
      <div class="rv-glow" />
      <div class="rv-flash" ref={flashRef} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', zIndex: 2 }} />
      {title && <h2 class="rv-title">{title}</h2>}
      <div class={`rv-grid n${pulls.length}`} ref={gridRef}>
        {pulls.map((p, i) => (
          <RevealCard key={i} p={p} open={i < shown} hl={i === hl} />
        ))}
      </div>
      {all && pulls.length > 1 && <Summary pulls={pulls} />}
      <div class="rv-actions">
        {!all && <Btn kind="ghost" onClick={() => setShown(pulls.length)}>Bỏ qua</Btn>}
        {all && onAgain && <Btn kind="ghost" big onClick={onClose}>Đóng</Btn>}
        {all && onAgain && <Btn kind="primary" big onClick={onAgain}>{againLabel ?? 'Quay tiếp'}</Btn>}
        {all && !onAgain && <Btn kind="primary" big onClick={onClose}>XÁC NHẬN</Btn>}
      </div>
    </div>
  );
}

/** Công bố kết quả gacha: phim UR/SSR (nếu có) rồi lật thẻ + tổng kết */
export function Reveal(props: RevealProps) {
  const cine = useMemo(() => pickCine(props.pulls), [props.pulls]);
  const [playing, setPlaying] = useState(!!cine);
  if (cine && playing) return <Cinematic pull={props.pulls[cine.index]} tier={cine.tier} onDone={() => setPlaying(false)} />;
  return <Cards {...props} hl={cine ? cine.index : -1} />;
}
