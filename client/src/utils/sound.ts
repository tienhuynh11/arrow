/**
 * All sound effects are synthesised with the Web Audio API - zero asset bytes,
 * zero preload. A single AudioContext is created lazily on the first gesture.
 */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('arrow-party-muted') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(freq: number, ms: number, type: OscillatorType = 'square', gain = 0.05, slideTo?: number) {
  try {
    const a = ac();
    if (!a) return;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + ms / 1000);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
    osc.connect(g).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + ms / 1000 + 0.02);
  } catch {
    // máy không có đầu ra âm thanh hoặc trình duyệt chặn Web Audio: im lặng, game vẫn chạy tiếp
  }
}

export const sfx = {
  tick: () => blip(660, 90, 'square', 0.04),
  start: () => blip(880, 220, 'sawtooth', 0.05, 1320),
  perfect: () => blip(1320, 110, 'square', 0.06, 1760),
  great: () => blip(990, 90, 'square', 0.045),
  good: () => blip(740, 80, 'triangle', 0.04),
  miss: () => blip(180, 130, 'sawtooth', 0.045, 110),
  tap: () => blip(440, 35, 'square', 0.025),
  /** một nốt nhạc nền (ghế âm nhạc) */
  note: (freq: number, ms = 170) => blip(freq, ms, 'triangle', 0.045),
  overtake: () => blip(660, 200, 'triangle', 0.06, 1180),
  winner: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 220, 'triangle', 0.06), i * 130));
  },
  isMuted: () => muted,
  toggleMute: () => {
    muted = !muted;
    localStorage.setItem('arrow-party-muted', muted ? '1' : '0');
    return muted;
  },
};
