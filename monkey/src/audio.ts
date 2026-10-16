// Âm thanh tổng hợp bằng Web Audio (0 byte file): súng, khỉ, nổ, giao diện, nền rừng.
// Có giới hạn số tiếng đồng thời để máy yếu không nghẹt.

import { settings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode;
let sfxBus: GainNode;
let ambBus: GainNode;
let noise: AudioBuffer;
let active = 0;
const MAX_VOICES = 28;
let ambientOn = false;
let heartbeat = 0;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.connect(comp);
  ambBus = ctx.createGain();
  ambBus.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  startAmbient();
}

export function applyVolumes() {
  if (!ctx) return;
  master.gain.value = settings.master;
  sfxBus.gain.value = settings.sfx;
  ambBus.gain.value = settings.ambient * 0.5;
}

function t0() {
  return ctx!.currentTime;
}

function voice(dur: number): boolean {
  if (!ctx || ctx.state !== 'running') return false;
  if (active >= MAX_VOICES) return false;
  active++;
  setTimeout(() => active--, dur * 1000 + 30);
  return true;
}

/** đầu ra có âm lượng + định vị trái/phải */
function out(vol: number, pan = 0): GainNode {
  const g = ctx!.createGain();
  g.gain.value = vol;
  if (pan !== 0 && typeof (ctx as any).createStereoPanner === "function") {
    const p = ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(sfxBus);
  } else g.connect(sfxBus);
  return g;
}

function noiseBurst(dst: AudioNode, dur: number, type: BiquadFilterType, f0: number, f1: number, q = 1, vol = 1, delay = 0) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  const t = t0() + delay;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(dst);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

function tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol = 1, delay = 0, attack = 0.003) {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = type;
  const t = t0() + delay;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dst);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/* ======================= SÚNG ======================= */
export function sfxGun(kind: string, vol = 1, pan = 0) {
  if (!voice(0.4)) return;
  const o = out(0.55 * vol, pan);
  switch (kind) {
    case 'pistol':
      noiseBurst(o, 0.12, 'bandpass', 2600, 700, 0.8, 0.9);
      tone(o, 'sine', 180, 60, 0.12, 0.8);
      break;
    case 'smg':
      noiseBurst(o, 0.07, 'bandpass', 3200, 1200, 0.9, 0.7);
      tone(o, 'triangle', 220, 90, 0.06, 0.45);
      break;
    case 'shotgun':
      noiseBurst(o, 0.32, 'lowpass', 2400, 200, 0.7, 1.2);
      tone(o, 'sine', 120, 40, 0.25, 1);
      noiseBurst(o, 0.05, 'highpass', 4000, 2500, 0.7, 0.5, 0.42);
      break;
    case 'rifle':
      noiseBurst(o, 0.09, 'highpass', 3000, 1500, 0.7, 0.8);
      noiseBurst(o, 0.16, 'bandpass', 1400, 400, 1, 0.7);
      tone(o, 'sine', 160, 55, 0.12, 0.8);
      break;
    case 'revolver':
      noiseBurst(o, 0.16, 'bandpass', 2000, 500, 0.8, 1);
      tone(o, 'sine', 150, 50, 0.16, 0.9);
      noiseBurst(o, 0.04, 'highpass', 4200, 3000, 0.7, 0.35, 0.05);
      break;
    case 'sniper':
      noiseBurst(o, 0.08, 'highpass', 3600, 2000, 0.7, 1);
      noiseBurst(o, 0.45, 'lowpass', 1600, 120, 1, 1);
      tone(o, 'sine', 110, 35, 0.4, 1);
      break;
    case 'launcher':
      tone(o, 'sine', 140, 45, 0.28, 1);
      noiseBurst(o, 0.22, 'lowpass', 900, 150, 1, 0.9);
      break;
    case 'turret':
      noiseBurst(o, 0.05, 'bandpass', 3800, 1800, 1.2, 0.35);
      tone(o, 'square', 900, 300, 0.04, 0.12);
      break;
  }
}

export function sfxReload(tier: number) {
  if (!voice(0.6)) return;
  const o = out(0.35);
  tone(o, 'square', 900, 600, 0.03, 0.4);
  noiseBurst(o, 0.04, 'highpass', 3000, 2000, 1, 0.5, 0.02);
  tone(o, 'square', 700, 1200, 0.04, 0.4, tier === 2 ? 0.3 : 0.45);
  noiseBurst(o, 0.05, 'highpass', 3500, 2500, 1, 0.6, tier === 2 ? 0.32 : 0.48);
}

export function sfxEmpty() {
  if (!voice(0.1)) return;
  tone(out(0.3), 'square', 1400, 1000, 0.03, 0.3);
}

export function sfxHit(crit: boolean) {
  if (!voice(0.1)) return;
  const o = out(0.35);
  tone(o, 'sine', crit ? 2400 : 1700, crit ? 2000 : 1500, 0.05, crit ? 0.7 : 0.45);
  if (crit) tone(o, 'triangle', 3200, 3000, 0.04, 0.3, 0.02);
}

export function sfxKill(coins: boolean) {
  if (!voice(0.4)) return;
  const o = out(0.32);
  tone(o, 'sine', 600, 300, 0.12, 0.6);
  if (coins) {
    tone(o, 'sine', 1320, 1320, 0.09, 0.3, 0.05);
    tone(o, 'sine', 1760, 1760, 0.14, 0.3, 0.11);
  }
}

/* ======================= KHỈ ======================= */
export function sfxMonkey(kind: 'screech' | 'ook' | 'die' | 'throw' | 'roar' | 'beep' | 'pounce' | 'drop', vol = 1, pan = 0, pitch = 1) {
  if (vol < 0.04 || !voice(1.3)) return;
  const o = out(0.4 * vol, pan);
  const c = ctx!;
  switch (kind) {
    case 'screech': {
      // tiếng khỉ kêu "ú u á á": FM nhảy cao độ
      const base = (700 + Math.random() * 300) * pitch;
      for (let k = 0; k < 3; k++) tone(o, 'sawtooth', base * (1 + k * 0.25), base * (1.4 + k * 0.2), 0.08, 0.18, k * 0.09, 0.01);
      break;
    }
    case 'ook':
      tone(o, 'triangle', 380 * pitch, 240 * pitch, 0.16, 0.5);
      tone(o, 'triangle', 420 * pitch, 260 * pitch, 0.14, 0.4, 0.17);
      break;
    case 'die':
      tone(o, 'triangle', 600 * pitch, 160 * pitch, 0.32, 0.55);
      noiseBurst(o, 0.12, 'lowpass', 1200, 300, 1, 0.3);
      break;
    case 'throw':
      noiseBurst(o, 0.25, 'bandpass', 600, 2400, 2, 0.4);
      break;
    case 'roar': {
      const os = c.createOscillator();
      os.type = 'sawtooth';
      const t = t0();
      os.frequency.setValueAtTime(90, t);
      os.frequency.linearRampToValueAtTime(140, t + 0.4);
      os.frequency.linearRampToValueAtTime(70, t + 1.3);
      const lfo = c.createOscillator();
      lfo.frequency.value = 18;
      const lg = c.createGain();
      lg.gain.value = 12;
      lfo.connect(lg);
      lg.connect(os.frequency);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      os.connect(f);
      f.connect(g);
      g.connect(o);
      os.start(t);
      lfo.start(t);
      os.stop(t + 1.45);
      lfo.stop(t + 1.45);
      noiseBurst(o, 1.2, 'bandpass', 400, 200, 0.8, 0.5);
      break;
    }
    case 'beep':
      tone(o, 'square', 1800, 1800, 0.05, 0.25);
      break;
    case 'pounce':
      tone(o, 'sawtooth', 900, 1500, 0.15, 0.25);
      noiseBurst(o, 0.2, 'bandpass', 800, 2000, 2, 0.3);
      break;
    case 'drop':
      noiseBurst(o, 0.14, 'lowpass', 600, 120, 1, 0.5);
      break;
  }
}

/* ======================= NỔ / VA ĐẬP ======================= */
export function sfxExplosion(vol = 1, pan = 0) {
  if (!voice(1.2)) return;
  const o = out(0.75 * vol, pan);
  noiseBurst(o, 0.9, 'lowpass', 2200, 60, 0.7, 1.3);
  tone(o, 'sine', 90, 30, 0.7, 1.2);
  noiseBurst(o, 0.15, 'highpass', 3000, 1000, 0.7, 0.5);
}

export function sfxSlam(vol = 1, pan = 0, big = false) {
  if (!voice(0.8)) return;
  const o = out(0.6 * vol, pan);
  tone(o, 'sine', big ? 70 : 110, 30, big ? 0.6 : 0.3, 1.2);
  noiseBurst(o, big ? 0.6 : 0.3, 'lowpass', 800, 80, 1, 0.9);
}

export function sfxSplat(vol = 1, pan = 0) {
  if (!voice(0.3)) return;
  const o = out(0.4 * vol, pan);
  noiseBurst(o, 0.18, 'bandpass', 900, 300, 1.5, 0.8);
  tone(o, 'sine', 300, 120, 0.1, 0.4);
}

/* ======================= NGƯỜI CHƠI ======================= */
export function sfxHurt(heavy: boolean) {
  if (!voice(0.4)) return;
  const o = out(heavy ? 0.6 : 0.45);
  tone(o, 'sine', heavy ? 150 : 200, 60, 0.22, 0.9);
  noiseBurst(o, 0.15, 'lowpass', 900, 200, 1, 0.6);
}

export function sfxJump() {
  if (!voice(0.2)) return;
  noiseBurst(out(0.18), 0.18, 'bandpass', 500, 1500, 1.5, 0.6);
}

export function sfxDown() {
  if (!voice(1)) return;
  const o = out(0.5);
  tone(o, 'triangle', 440, 110, 0.9, 0.6);
  tone(o, 'triangle', 330, 82, 0.9, 0.4, 0.05);
}

export function sfxRevive() {
  if (!voice(0.8)) return;
  const o = out(0.4);
  [523, 659, 784, 1047].forEach((f, i) => tone(o, 'triangle', f, f, 0.18, 0.5, i * 0.07));
}

export function sfxHeal() {
  if (!voice(0.8)) return;
  const o = out(0.3);
  [784, 988, 1175].forEach((f, i) => tone(o, 'sine', f, f * 1.02, 0.5, 0.35, i * 0.06, 0.05));
}

export function sfxBuy() {
  if (!voice(0.6)) return;
  const o = out(0.4);
  tone(o, 'square', 1568, 1568, 0.07, 0.25);
  tone(o, 'square', 2093, 2093, 0.18, 0.25, 0.08);
  noiseBurst(o, 0.1, 'highpass', 5000, 3000, 1, 0.3, 0.02);
}

export function sfxDeny() {
  if (!voice(0.3)) return;
  const o = out(0.35);
  tone(o, 'square', 220, 180, 0.12, 0.35);
  tone(o, 'square', 180, 150, 0.16, 0.35, 0.12);
}

export function sfxBuild() {
  if (!voice(0.6)) return;
  const o = out(0.4);
  for (let i = 0; i < 3; i++) {
    noiseBurst(o, 0.06, 'bandpass', 1800, 900, 2, 0.6, i * 0.1);
    tone(o, 'square', 300, 200, 0.05, 0.25, i * 0.1);
  }
}

export function sfxUlt() {
  if (!voice(1)) return;
  const o = out(0.5);
  tone(o, 'sawtooth', 220, 880, 0.6, 0.35, 0, 0.05);
  tone(o, 'sawtooth', 330, 1320, 0.6, 0.25, 0.05, 0.05);
  noiseBurst(o, 0.5, 'bandpass', 500, 4000, 1, 0.3);
}

/** vung dao: tiếng gió vút + chút kim loại */
export function sfxWhoosh(vol = 1, pan = 0) {
  if (!voice(0.35)) return;
  const o = out(0.45 * vol, pan);
  noiseBurst(o, 0.22, 'bandpass', 900, 3800, 1.4, 0.9);
  noiseBurst(o, 0.12, 'highpass', 6000, 4000, 1, 0.25, 0.05);
  tone(o, 'triangle', 1800, 2600, 0.08, 0.08, 0.06);
}

/** đồ rớt hiện ra (màn thắng) — độ hiếm cao hơn thì vang hơn */
export function sfxLoot(rarity: number) {
  if (!voice(0.9)) return;
  const o = out(0.32 + rarity * 0.06);
  const base = [660, 784, 988, 1175][Math.max(0, Math.min(3, rarity))];
  tone(o, 'sine', base, base * 1.01, 0.35, 0.4);
  tone(o, 'sine', base * 1.5, base * 1.5, 0.45, 0.3, 0.07);
  if (rarity >= 2) tone(o, 'triangle', base * 2, base * 2.02, 0.6, 0.22, 0.14, 0.02);
  if (rarity >= 3) noiseBurst(o, 0.6, 'highpass', 7000, 5000, 1, 0.25, 0.1);
}

/** sao sáng lên */
export function sfxStar(i: number) {
  if (!voice(0.5)) return;
  const f = [880, 1109, 1319][Math.max(0, Math.min(2, i))];
  const o = out(0.35);
  tone(o, 'square', f, f, 0.08, 0.2);
  tone(o, 'sine', f * 2, f * 2, 0.3, 0.25, 0.04);
}

export function sfxUi() {
  if (!voice(0.1)) return;
  tone(out(0.2), 'sine', 900, 1200, 0.05, 0.4);
}

/* ======================= NHẠC HIỆU ======================= */
export function sfxWaveStart(boss: boolean) {
  if (!voice(2)) return;
  const o = out(0.45);
  if (boss) {
    for (let i = 0; i < 4; i++) {
      tone(o, 'sine', 60, 40, 0.3, 1.1, i * 0.32);
      noiseBurst(o, 0.15, 'lowpass', 500, 100, 1, 0.6, i * 0.32);
    }
    tone(o, 'sawtooth', 110, 104, 1.6, 0.35, 0.2, 0.2);
    tone(o, 'sawtooth', 165, 156, 1.6, 0.25, 0.2, 0.2);
  } else {
    // tù và
    tone(o, 'sawtooth', 196, 196, 0.9, 0.3, 0, 0.12);
    tone(o, 'sawtooth', 294, 294, 0.9, 0.22, 0, 0.12);
    tone(o, 'sawtooth', 262, 262, 0.7, 0.3, 0.75, 0.08);
    tone(o, 'sawtooth', 392, 392, 0.7, 0.2, 0.75, 0.08);
  }
}

export function sfxWaveClear() {
  if (!voice(1.2)) return;
  const o = out(0.4);
  [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(o, 'triangle', f, f, i === 5 ? 0.5 : 0.14, 0.45, i * 0.1));
}

export function sfxGameOver() {
  if (!voice(2.5)) return;
  const o = out(0.45);
  [392, 349, 311, 262].forEach((f, i) => tone(o, 'triangle', f, f * 0.98, 0.55, 0.5, i * 0.38, 0.03));
}

/* ======================= NỀN RỪNG ======================= */
function startAmbient() {
  if (!ctx || ambientOn) return;
  ambientOn = true;
  const c = ctx;
  // gió lá: nhiễu lọc thấp, lên xuống chậm
  const s = c.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = c.createGain();
  g.gain.value = 0.25;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.08;
  const lg = c.createGain();
  lg.gain.value = 0.12;
  lfo.connect(lg);
  lg.connect(g.gain);
  s.connect(f);
  f.connect(g);
  g.connect(ambBus);
  s.start();
  lfo.start();
  // chim + côn trùng ngẫu nhiên
  const bird = () => {
    if (!ctx) return;
    if (settings.ambient > 0.02 && ctx.state === 'running') {
      const r = Math.random();
      const pan = Math.random() * 2 - 1;
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      const gg = c.createGain();
      gg.gain.value = 0.12 + Math.random() * 0.1;
      if (p) { p.pan.value = pan; gg.connect(p); p.connect(ambBus); } else gg.connect(ambBus);
      if (r < 0.5) {
        const base = 2200 + Math.random() * 1600;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) tone(gg, 'sine', base, base * (1.1 + Math.random() * 0.3), 0.07, 0.6, i * 0.11);
      } else if (r < 0.8) {
        // tiếng khỉ xa xa trong rừng
        const base = 500 + Math.random() * 200;
        for (let i = 0; i < 4; i++) tone(gg, 'triangle', base * (1 + i * 0.15), base * (1.3 + i * 0.15), 0.1, 0.25, i * 0.12, 0.01);
      } else {
        for (let i = 0; i < 10; i++) tone(gg, 'sine', 4800, 4700, 0.025, 0.2, i * 0.05);
      }
    }
    setTimeout(bird, 1500 + Math.random() * 4500);
  };
  setTimeout(bird, 2000);
}

/** nhịp tim khi máu thấp (0 = tắt) */
export function setHeartbeat(on: boolean) {
  if (!ctx) return;
  if (on && !heartbeat) {
    const beat = () => {
      if (!ctx) return;
      const o = out(0.4);
      tone(o, 'sine', 70, 50, 0.12, 0.9);
      tone(o, 'sine', 70, 50, 0.12, 0.7, 0.18);
    };
    beat();
    heartbeat = window.setInterval(beat, 900);
  } else if (!on && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = 0;
  }
}

export function audioReady() {
  return !!ctx && ctx.state === 'running';
}
