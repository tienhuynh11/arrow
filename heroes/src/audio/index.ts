// Âm thanh: quản lý SFX (sprite) + nhạc nền bằng Howler. Giữ nguyên `sfx(name)` cũ; mở rộng thêm tên mới.
// - Howler tải LAZY (dynamic import) sau cử chỉ đầu tiên của người dùng (chính sách autoplay + mở khoá iOS).
// - Tắt tiếng tổng (`sound`), âm lượng nhạc/hiệu ứng riêng (`musicVol`/`sfxVol`), tạm dừng khi tab ẩn.
// - Giới hạn tần suất theo tên (chống spam) và đổi cao độ ±5% cho tiếng đánh để đỡ lặp.
import { effect } from '@preact/signals';
import { musicVol, sfxVol, sound } from '../settings';
import { SPRITE } from './sprite';

export type Sfx =
  | 'tap' | 'back' | 'open' | 'close' | 'error' | 'toggle' | 'select'
  | 'claim' | 'level' | 'star'
  | 'spin' | 'reveal' | 'revealSR' | 'revealSSR' | 'revealUR' | 'rare'
  | 'hit' | 'heavy' | 'crit' | 'miss' | 'heal' | 'shield' | 'stun' | 'ultReady' | 'ult' | 'ultBoom' | 'death' | 'wave'
  | 'win' | 'lose' | 'count';
export type MusicTrack = 'menu' | 'battle';

interface Cfg {
  /** tên cue trong sprite; nhiều cue = chọn ngẫu nhiên */
  cue: string | string[];
  /** khoảng cách tối thiểu giữa 2 lần phát (ms) */
  gap: number;
  /** hệ số âm lượng (cân bằng tương đối giữa các cue) */
  vol?: number;
  /** biên độ đổi cao độ (0.05 = ±5%) */
  pitch?: number;
}

/** CHỈNH TAY: cân bằng âm lượng, giới hạn tần suất, biến thể cao độ */
const CFG: Record<Sfx, Cfg> = {
  tap: { cue: 'tap', gap: 45, vol: 0.55 },
  back: { cue: 'back', gap: 80, vol: 0.6 },
  open: { cue: 'open', gap: 120, vol: 0.6 },
  close: { cue: 'close', gap: 120, vol: 0.6 },
  error: { cue: 'error', gap: 250, vol: 0.7 },
  toggle: { cue: 'toggle', gap: 80, vol: 0.55 },
  select: { cue: 'select', gap: 80, vol: 0.6 },
  claim: { cue: 'claim', gap: 120, vol: 0.8 },
  level: { cue: 'level', gap: 300, vol: 0.85 },
  star: { cue: 'star', gap: 300, vol: 0.9 },
  spin: { cue: 'spin', gap: 200, vol: 0.8 },
  reveal: { cue: 'reveal', gap: 120, vol: 0.8 },
  revealSR: { cue: 'rev_sr', gap: 200, vol: 0.85 },
  revealSSR: { cue: 'rev_ssr', gap: 300, vol: 0.9 },
  revealUR: { cue: 'rev_ur', gap: 300, vol: 1 },
  rare: { cue: 'rev_ssr', gap: 300, vol: 0.9 },
  hit: { cue: ['hit', 'hit2'], gap: 55, vol: 0.7, pitch: 0.05 },
  heavy: { cue: 'heavy', gap: 80, vol: 0.85, pitch: 0.05 },
  crit: { cue: 'crit', gap: 90, vol: 0.95, pitch: 0.05 },
  miss: { cue: 'miss', gap: 90, vol: 0.6, pitch: 0.05 },
  heal: { cue: 'heal', gap: 110, vol: 0.6, pitch: 0.04 },
  shield: { cue: 'shield', gap: 120, vol: 0.7 },
  stun: { cue: 'stun', gap: 150, vol: 0.55 },
  ultReady: { cue: 'ultready', gap: 250, vol: 0.7 },
  ult: { cue: 'ult', gap: 200, vol: 0.9 },
  ultBoom: { cue: 'ultboom', gap: 250, vol: 0.9 },
  death: { cue: 'death', gap: 150, vol: 0.7, pitch: 0.05 },
  wave: { cue: 'wave', gap: 400, vol: 0.8 },
  win: { cue: 'win', gap: 800, vol: 1 },
  lose: { cue: 'lose', gap: 800, vol: 0.9 },
  count: { cue: 'count', gap: 60, vol: 0.5 },
};

/** nhạc nền thấp hơn SFX ≈ 18 dB (file nhạc đã chuẩn hoá -24 LUFS; hệ số này nhân thêm với thanh trượt) */
const MUSIC_GAIN = 0.35;
const FADE_MS = 700;

interface HowlLike {
  play(id?: number | string): number;
  pause(id?: number): this;
  volume(v?: number, id?: number): any;
  rate(r?: number, id?: number): any;
  fade(from: number, to: number, ms: number, id?: number): this;
  playing(id?: number): boolean;
}
interface HowlerLib {
  Howl: new (o: Record<string, unknown>) => HowlLike;
  Howler: { mute(m: boolean): void; ctx?: AudioContext };
}

let lib: HowlerLib | null = null;
let loading = false;
let unlocked = false;
let sprite: HowlLike | null = null;
let hidden = false;
const last = new Map<Sfx, number>();
const musics = new Map<MusicTrack, HowlLike>();
let want: MusicTrack | null = 'menu';
let cur: MusicTrack | null = null;

const url = (f: string) => `${import.meta.env.BASE_URL}audio/${f}`;
const enabled = () => sound.value && !hidden;

/** Howler + sprite chỉ nạp sau cử chỉ đầu tiên */
function boot() {
  if (loading || lib) return;
  loading = true;
  void import('howler')
    .then((m) => {
      lib = { Howl: m.Howl as unknown as HowlerLib['Howl'], Howler: m.Howler as unknown as HowlerLib['Howler'] };
      sprite = new lib.Howl({ src: [url('sfx.mp3')], sprite: SPRITE, preload: true, volume: 1 });
      applyMusic();
    })
    .catch(() => {
      loading = false;
    });
}

const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
/** lần chạm đầu tiên mở khoá âm thanh (iOS/Android) */
function onFirstGesture() {
  if (unlocked) return;
  unlocked = true;
  for (const ev of GESTURES) window.removeEventListener(ev, onFirstGesture, true);
  boot();
}
if (typeof window !== 'undefined') for (const ev of GESTURES) window.addEventListener(ev, onFirstGesture, { capture: true, passive: true });

export function sfx(k: Sfx) {
  if (!enabled() || !sprite || !lib) return;
  const c = CFG[k];
  const now = performance.now();
  if (now - (last.get(k) ?? -1e9) < c.gap) return;
  last.set(k, now);
  const cue = Array.isArray(c.cue) ? c.cue[(Math.random() * c.cue.length) | 0] : c.cue;
  const id = sprite.play(cue);
  sprite.volume(Math.min(1, (c.vol ?? 1) * sfxVol.value), id);
  if (c.pitch) sprite.rate(1 + (Math.random() * 2 - 1) * c.pitch, id);
}

function getMusic(t: MusicTrack): HowlLike | null {
  if (!lib) return null;
  let h = musics.get(t);
  if (!h) {
    h = new lib.Howl({ src: [url(`music_${t}.mp3`)], loop: true, volume: 0, preload: true });
    musics.set(t, h);
  }
  return h;
}
const musicLevel = () => Math.min(1, musicVol.value * MUSIC_GAIN);

/** đồng bộ nhạc nền với: bài muốn phát, công tắc tắt tiếng, thanh trượt, tab ẩn */
function applyMusic() {
  if (!lib) return;
  const target = enabled() && musicLevel() > 0.002 ? want : null;
  if (target !== cur) {
    const old = cur ? musics.get(cur) : undefined;
    if (old && cur) {
      const name = cur;
      old.fade(old.volume() as number, 0, FADE_MS);
      // dừng hẳn sau khi tắt dần, trừ khi bài đó được bật lại trong lúc chờ
      window.setTimeout(() => {
        if (cur !== name) old.pause();
      }, FADE_MS + 60);
    }
    cur = target;
    const h = target ? getMusic(target) : null;
    if (h) {
      if (!h.playing()) h.play();
      h.fade(h.volume() as number, musicLevel(), FADE_MS);
    }
  } else if (cur) {
    musics.get(cur)?.volume(musicLevel());
  }
}

/** chọn bài nền (null = im lặng). Có thể gọi trước khi mở khoá: sẽ phát khi sẵn sàng */
export function music(t: MusicTrack | null) {
  want = t;
  applyMusic();
}

if (typeof window !== 'undefined') {
  effect(() => {
    // đọc các signal để đăng ký phụ thuộc
    void sound.value;
    void musicVol.value;
    applyMusic();
  });
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (lib) {
      lib.Howler.mute(hidden);
      const ctx = lib.Howler.ctx;
      if (ctx) void (hidden ? ctx.suspend() : ctx.resume());
    }
    applyMusic();
  });
}
