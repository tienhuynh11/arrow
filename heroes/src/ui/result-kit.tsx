// Bộ phận dùng chung cho các màn kết quả mới: tiêu đề rơi, sao + điều kiện, hàng tướng, thanh XP tài khoản,
// rương thưởng bật ra từng ô, gợi ý khi thua. Hoạt ảnh bằng GSAP trên MỘT timeline (chạm màn hình = chạy nốt tức thì).
import { gsap } from 'gsap';
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { accountXpToNext } from '@shared/heroes/formulas';
import { me } from '../api';
import { HERO_BY_ID, ownedMap } from '../game';
import { fmt, go } from '../state';
import { Portrait } from './common';
import { Icon, type IconName } from './icons';
import './result.css';

/** dữ liệu trận vừa xong mà phản hồi server không có (Battle.tsx ghi lại trước khi nộp) */
export interface LastBattle {
  ticks: number;
  deaths: number;
  /** id tướng đã gục */
  dead: string[];
  /** banner thắng/thua đã chạy trong trận (đã có nhạc hiệu) — false khi bỏ qua trận */
  fanfare: boolean;
}
let last: LastBattle | null = null;
export const setLastBattle = (b: LastBattle | null) => {
  last = b;
};
export const getLastBattle = () => last;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const NF = (n: number) => fmt(Math.round(n));

/** số chạy từ 0 tới `end` trong timeline (kết thúc đúng chuỗi cuối); chạm bỏ qua thì progress(1) cũng về đúng giá trị */
export function countTo(tl: gsap.core.Timeline, el: HTMLElement, end: number, at: number, dur = 0.7, pre = '+', post = '') {
  const o = { v: 0 };
  el.textContent = `${pre}0${post}`;
  tl.to(o, {
    v: end, duration: dur, ease: 'power2.out',
    onUpdate: () => {
      el.textContent = `${pre}${NF(o.v)}${post}`;
    },
    onComplete: () => {
      el.textContent = `${pre}${NF(end)}${post}`;
    },
  }, at);
}

/**
 * Dựng timeline trình diễn một lần khi vào màn. `build(tl, q)`: q(selector) lấy các phần tử trong màn.
 * Trả về hàm `skip` (chạm màn hình để chạy nốt tức thì). reduced-motion: hiện luôn kết quả cuối.
 */
export function useRsSeq(ref: RefObject<HTMLElement>, build: (tl: gsap.core.Timeline, q: (sel: string) => HTMLElement[]) => void): () => void {
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      build(tl, (sel) => Array.from(root.querySelectorAll<HTMLElement>(sel)));
      tlRef.current = tl;
      if (reducedMotion()) tl.progress(1);
    }, root);
    return () => ctx.revert();
    // eslint-disable-next-line
  }, []);
  return () => {
    const tl = tlRef.current;
    if (tl && tl.progress() < 1) tl.progress(1);
  };
}

/* ---------------------------------- thành phần ---------------------------------- */

/** tiêu đề: chữ rơi từ trên xuống (GSAP gắn class rs-banner) */
export function RsBanner({ win, text, sub }: { win: boolean; text: string; sub?: string }) {
  return (
    <div class={`rs-banner ${win ? 'win' : 'lose'}`}>
      <h1 class="res-title rs-title">{text}</h1>
      {sub && <small class="rs-sub">{sub}</small>}
    </div>
  );
}

export interface StarCond {
  got: boolean;
  text: string;
}
/** 3 sao nổi từng cái + dòng điều kiện (rs-star / rs-cond cùng thứ tự) */
export function StarList({ conds }: { conds: StarCond[] }) {
  return (
    <div class="rs-stars">
      {conds.map((c, i) => (
        <div key={i} class={`rs-st${c.got ? ' got' : ''}`}>
          <span class="rs-star">
            <Icon n={c.got ? 'star' : 'starEmpty'} size={56} />
            <i class="rs-spk" />
          </span>
          <small class="rs-cond">{c.text}</small>
        </div>
      ))}
    </div>
  );
}

/** hàng tướng của đội (≤ 6): chân dung chibi; tướng gục xám + nhãn */
export function SquadRow({ ids, dead }: { ids: string[]; dead: string[] }) {
  const m = me.value;
  const owned = m ? ownedMap(m) : null;
  return (
    <div class="rs-squad">
      {ids.slice(0, 6).map((id) => {
        const d = HERO_BY_ID[id];
        if (!d) return null;
        const o = owned?.get(id);
        const gone = dead.includes(id);
        return (
          <div key={id} class={`rs-hero${gone ? ' dead' : ''}`}>
            <Portrait id={id} rarity={d.rarity} />
            <small>Lv{o?.level ?? 1}</small>
            {gone && <em>Gục</em>}
          </div>
        );
      })}
    </div>
  );
}

/** thanh XP tài khoản: điền từ giá trị trước trận; lên cấp thì đầy -> "LÊN CẤP!" -> về phần dư */
export function XpBar({ gained, levelUp }: { gained: number; levelUp: boolean }) {
  const p = me.value?.profile;
  const lv = p?.level ?? 1;
  const need = accountXpToNext(lv);
  const now = Math.min(100, Math.floor(((p?.xp ?? 0) * 100) / need));
  const before = levelUp ? 0 : Math.max(0, Math.floor((Math.max(0, (p?.xp ?? 0) - gained) * 100) / need));
  return (
    <div class="rs-xp" data-before={before} data-now={now} data-lvup={levelUp ? '1' : '0'}>
      <span class="rs-lv">Lv {lv}</span>
      <div class="rs-xpbar">
        <i style={{ width: `${before}%` }} />
      </div>
      <em class="rs-xpn">+{fmt(gained)} XP</em>
      <b class="rs-lvup">LÊN CẤP!</b>
    </div>
  );
}

/** thêm vào timeline: thanh XP điền (+ pop LÊN CẤP). `at` = mốc giây */
export function animXp(tl: gsap.core.Timeline, q: (sel: string) => HTMLElement[], at: number, sfxFn: (k: 'level') => void): number {
  const box = q('.rs-xp')[0];
  if (!box) return at;
  const fill = box.querySelector('.rs-xpbar i') as HTMLElement;
  const pop = box.querySelector('.rs-lvup') as HTMLElement;
  const before = Number(box.dataset.before);
  const now = Number(box.dataset.now);
  const up = box.dataset.lvup === '1';
  gsap.set(pop, { opacity: 0, scale: 0.3 });
  tl.fromTo(box, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, at);
  let t = at + 0.25;
  if (up) {
    tl.fromTo(fill, { width: `${before}%` }, { width: '100%', duration: 0.55, ease: 'power1.inOut' }, t);
    t += 0.55;
    tl.call(() => sfxFn('level'), undefined, t)
      .fromTo(pop, { opacity: 0, scale: 0.3, rotation: -12 }, { opacity: 1, scale: 1, rotation: -4, duration: 0.35, ease: 'back.out(3)' }, t)
      .fromTo(fill, { width: '0%' }, { width: `${now}%`, duration: 0.45, ease: 'power2.out' }, t + 0.2);
    t += 0.65;
  } else {
    tl.fromTo(fill, { width: `${before}%` }, { width: `${now}%`, duration: 0.7, ease: 'power2.out' }, t);
    t += 0.7;
  }
  return t;
}

export interface Chip {
  icon: IconName;
  value: number;
  suffix?: string;
  tag?: string;
  first?: boolean;
}
/** rương thưởng: rương nảy rồi các ô vật phẩm bắn ra từng ô một (rs-chest / rs-chip) */
export function ChestStrip({ chips }: { chips: Chip[] }) {
  return (
    <div class="rs-rewards">
      <span class="rs-chest">
        <Icon n="chest" size={46} />
      </span>
      <div class="rs-chips">
        {chips.map((c, i) => (
          <div key={i} class={`reward big rs-chip${c.first ? ' first' : ''}`}>
            <Icon n={c.icon} size={26} />
            <b data-end={c.value} data-post={c.suffix ?? ''}>+{fmt(c.value)}{c.suffix ?? ''}</b>
            {c.tag && <small>{c.tag}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** thêm vào timeline: rương nảy + ô thưởng bắn ra, số chạy. Trả về mốc kết thúc */
export function animChest(tl: gsap.core.Timeline, q: (sel: string) => HTMLElement[], at: number, sfxFn: (k: 'claim') => void): number {
  const chest = q('.rs-chest')[0];
  const chips = q('.rs-chip');
  if (!chest) return at;
  tl.fromTo(chest, { y: 40, scale: 0.4, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.4)' }, at)
    .to(chest, { scaleY: 0.82, scaleX: 1.12, duration: 0.1, ease: 'power1.in' }, at + 0.4)
    .to(chest, { scaleY: 1.1, scaleX: 0.94, y: -6, duration: 0.14, ease: 'power2.out' }, at + 0.5)
    .to(chest, { scale: 1, y: 0, duration: 0.2, ease: 'bounce.out' }, at + 0.64);
  let t = at + 0.5;
  chips.forEach((c, i) => {
    const b = c.querySelector('b') as HTMLElement;
    const end = Number(b.dataset.end);
    const post = b.dataset.post ?? '';
    // bay lên từ rương (phía dưới) rồi nảy vào chỗ
    tl.fromTo(c, { y: 54, x: 0, scale: 0.3, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.38, ease: 'back.out(2.2)' }, t)
      .call(() => sfxFn('claim'), undefined, t + 0.05);
    if (end >= 2) countTo(tl, b, end, t + 0.05, 0.6, '+', post);
    t += 0.2 + (i === 0 ? 0 : 0);
  });
  return t + 0.3;
}

/** gợi ý khi thua, tính từ dữ liệu game: so lực chiến + nút đi thẳng tới nâng cấp / trang bị */
export function DefeatTips({ mine, enemy, squadLen }: { mine: number; enemy: number | null; squadLen: number }) {
  const weak = enemy != null && mine < enemy * 0.95;
  return (
    <div class="rs-tips">
      <b class="rs-tipt">Gợi ý để mạnh hơn</b>
      {enemy != null && (
        <div class={`rs-tip pow ${weak ? 'bad' : 'ok'}`}>
          <Icon n="sword" size={22} />
          <span>
            Dùng đội mạnh hơn: lực chiến của bạn <b>{fmt(mine)}</b> so với địch <b>{fmt(enemy)}</b>
            {weak ? ` (thiếu ${fmt(enemy - mine)})` : ' - đủ sức, thử dùng tuyệt kỹ đúng lúc / bật Auto'}
          </span>
        </div>
      )}
      <div class="rs-tip">
        <Icon n="up" size={22} />
        <span>Nâng cấp tướng{squadLen < 6 ? ' hoặc xếp thêm tướng vào đội' : ''}</span>
        <button type="button" class="rs-go" onClick={() => go({ n: 'heroes' })}>Tướng</button>
      </div>
      <div class="rs-tip">
        <Icon n="gear" size={22} />
        <span>Mặc / cường hoá trang bị cho tướng</span>
        <button type="button" class="rs-go" onClick={() => go({ n: 'heroes' })}>Trang bị</button>
      </div>
    </div>
  );
}
