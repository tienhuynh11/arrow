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
  /** xì hơi hài hước: độ cao/độ dài theo lực p (0..1), vol để đồng đội nhỏ hơn */
  fart: (p = 0.6, vol = 1) => {
    const len = 90 + p * 260;
    blip(190 - p * 60 + Math.random() * 25, len, 'sawtooth', 0.05 * vol, 62);
    setTimeout(() => blip(120 + Math.random() * 30, len * 0.7, 'square', 0.028 * vol, 55), 18);
    setTimeout(() => blip(520 + p * 200, 55, 'triangle', 0.025 * vol, 260), len * 0.55);
  },
  /* xe tăng đạn nảy */
  tankFire: () => {
    blip(210, 110, 'square', 0.045, 70);
    blip(1100, 45, 'sawtooth', 0.016, 320);
  },
  tankBounce: () => blip(1250, 45, 'triangle', 0.022, 720),
  tankBoom: () => {
    blip(150, 460, 'sawtooth', 0.085, 38);
    blip(90, 520, 'square', 0.05, 30);
    setTimeout(() => blip(60, 380, 'sawtooth', 0.04, 28), 70);
  },
  tankPick: () => {
    blip(660, 90, 'triangle', 0.05, 1000);
    setTimeout(() => blip(990, 120, 'triangle', 0.05, 1500), 70);
  },
  tankLaser: () => blip(1700, 260, 'sawtooth', 0.035, 180),
  tankShield: () => blip(520, 200, 'sine', 0.05, 1040),
  /* cướp kho báu */
  trPick: () => blip(1250 + Math.random() * 200, 70, 'triangle', 0.04, 1900),
  trDeliver: () => {
    [784, 988, 1318].forEach((f, i) => setTimeout(() => blip(f, 130, 'triangle', 0.055), i * 70));
  },
  trDeliverOther: () => blip(880, 90, 'triangle', 0.02, 1320),
  trSteal: () => {
    blip(260, 150, 'sawtooth', 0.06, 90);
    setTimeout(() => blip(1400, 90, 'square', 0.03, 700), 40);
  },
  trSwing: () => blip(520, 70, 'triangle', 0.03, 260),
  trSwingOther: () => blip(420, 55, 'triangle', 0.012, 240),
  trShove: () => blip(160, 130, 'square', 0.05, 80),
  trWave: () => {
    [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => blip(f, 160, 'sine', 0.045), i * 90));
  },
  trWhistle: () => blip(1900, 380, 'sine', 0.05, 1500),
  /* survival hỗn loạn */
  dzAlarm: () => {
    blip(880, 170, 'square', 0.05, 660);
    setTimeout(() => blip(660, 170, 'square', 0.05, 880), 190);
    setTimeout(() => blip(880, 170, 'square', 0.05, 660), 380);
  },
  dzBoom: () => {
    blip(120, 380, 'sawtooth', 0.06, 40);
    blip(70, 420, 'square', 0.035, 28);
  },
  dzQuake: () => {
    blip(55, 360, 'sawtooth', 0.07, 36);
    setTimeout(() => blip(48, 300, 'square', 0.04, 30), 90);
  },
  dzJump: () => blip(420, 90, 'triangle', 0.03, 760),
  overtake: () => blip(660, 200, 'triangle', 0.06, 1180),
  /* câu cá */
  fishCast: () => {
    blip(520, 120, 'sine', 0.04, 220);
    setTimeout(() => blip(180, 140, 'triangle', 0.03, 90), 140);
  },
  fishNib: () => blip(880, 50, 'sine', 0.03),
  fishBite: () => {
    blip(300, 120, 'square', 0.06, 760);
    setTimeout(() => blip(760, 140, 'square', 0.05, 1100), 90);
  },
  fishHook: () => blip(900, 80, 'sawtooth', 0.05, 400),
  /** tier 0 = thường, 1 = hiếm, 2 = huyền thoại */
  fishLand: (tier = 0) => {
    const notes = tier === 2 ? [523, 659, 784, 1046, 1318] : tier === 1 ? [523, 659, 880] : [600, 800];
    notes.forEach((f, i) => setTimeout(() => blip(f, 150, 'triangle', 0.055), i * 90));
  },
  fishTrash: () => {
    blip(220, 160, 'sawtooth', 0.04, 120);
    setTimeout(() => blip(150, 200, 'square', 0.035, 90), 130);
  },
  fishEscape: () => blip(500, 260, 'triangle', 0.05, 120),
  fishStealTry: () => blip(700, 70, 'sawtooth', 0.04, 1300),
  fishSteal: () => {
    blip(880, 90, 'square', 0.055, 1320);
    setTimeout(() => blip(1320, 120, 'square', 0.05, 1760), 90);
  },
  fishStealFail: () => {
    blip(260, 220, 'sawtooth', 0.05, 90);
    setTimeout(() => blip(120, 260, 'square', 0.04, 60), 120);
  },
  fishRobbed: () => blip(420, 300, 'sawtooth', 0.06, 110),
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
