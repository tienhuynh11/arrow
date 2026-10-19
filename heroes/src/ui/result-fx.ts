// Hiệu ứng trình diễn chung cho các màn kết quả (Result / TowerResult / ArenaResult), bằng GSAP:
// tiêu đề nảy, sao bật có overshoot (kèm tiếng), ô thưởng trồi lên + số chạy từ 0. Chỉ đụng DOM theo selector nên không đổi logic màn.
import { gsap } from 'gsap';
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import { sfx } from '../audio';

const NUM = /(\d+(?:\.\d+)?)([KM]?)/;

export function useResultFx(ref: RefObject<HTMLElement>, win: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = gsap.context(() => {
      const title = root.querySelector('.res-title');
      if (title) gsap.from(title, { scale: 1.7, rotation: -6, opacity: 0, duration: reduce ? 0.01 : 0.5, ease: 'back.out(2)' });

      // sao: bật tuần tự, sao đạt được có tiếng + loé phóng to
      root.querySelectorAll<HTMLElement>('.res-star').forEach((s, i) => {
        s.style.animation = 'none';
        const got = s.classList.contains('got');
        const tl = gsap.timeline({ delay: 0.25 + i * 0.3 });
        tl.fromTo(s, { scale: 2.6, rotation: -45, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: reduce ? 0.01 : 0.55, ease: 'back.out(2.6)' });
        if (got) {
          tl.call(() => sfx('star'), undefined, 0.05);
          tl.fromTo(s, { filter: 'brightness(2)' }, { filter: 'brightness(1)', duration: 0.4, ease: 'power2.out' }, 0.1);
        }
      });

      // ô thưởng trồi lên lần lượt, số chạy từ 0
      const rewards = root.querySelectorAll<HTMLElement>('.reward');
      if (rewards.length) {
        gsap.from(rewards, { y: 18, scale: 0.8, opacity: 0, duration: reduce ? 0.01 : 0.4, stagger: 0.09, delay: 0.55, ease: 'back.out(2)' });
        if (win) gsap.delayedCall(0.6, () => sfx('claim'));
      }
      root.querySelectorAll<HTMLElement>('.reward b').forEach((b, i) => {
        const text = b.textContent ?? '';
        const m = NUM.exec(text);
        if (!m || reduce) return;
        const end = parseFloat(m[1]);
        if (!(end >= 2)) return;
        const pre = text.slice(0, m.index);
        const post = text.slice(m.index + m[0].length);
        const unit = m[2];
        const frac = unit ? 1 : 0;
        const o = { v: 0 };
        b.textContent = `${pre}0${unit}${post}`;
        gsap.to(o, {
          v: end, duration: 0.9, delay: 0.6 + i * 0.09, ease: 'power2.out',
          onUpdate: () => {
            b.textContent = `${pre}${frac ? o.v.toFixed(1) : Math.round(o.v)}${unit}${post}`;
          },
          onComplete: () => {
            b.textContent = text;
          },
        });
      });
    }, root);
    return () => ctx.revert();
  }, []);
}
