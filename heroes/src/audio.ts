// Âm thanh tối giản bằng WebAudio (không asset). Chỉ phát sau cử chỉ người dùng đầu tiên.
import { sound } from './settings';

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!sound.value) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slide = 0, delay = 0) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export type Sfx = 'tap' | 'hit' | 'crit' | 'ult' | 'heal' | 'win' | 'lose' | 'reveal' | 'rare' | 'level';
export function sfx(k: Sfx) {
  switch (k) {
    case 'tap': return tone(640, 0.06, 'square', 0.05);
    case 'hit': return tone(180, 0.1, 'triangle', 0.1, -80);
    case 'crit': return (tone(260, 0.14, 'sawtooth', 0.09, -120), tone(520, 0.1, 'square', 0.05, 0, 0.03));
    case 'ult': return (tone(220, 0.4, 'sawtooth', 0.08, 500), tone(880, 0.3, 'triangle', 0.06, 0, 0.15));
    case 'heal': return (tone(660, 0.15, 'sine', 0.07), tone(990, 0.2, 'sine', 0.06, 0, 0.1));
    case 'win': return [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.09, 0, i * 0.12));
    case 'lose': return [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, 0, i * 0.16));
    case 'reveal': return tone(500, 0.12, 'triangle', 0.07, 300);
    case 'rare': return [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.25, 'triangle', 0.09, 0, i * 0.08));
    case 'level': return [659, 880, 1175].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, 0, i * 0.09));
  }
}
