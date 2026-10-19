// Chúc mừng lên cấp (toàn cục): theo dõi me.profile.level, khi tăng thì bật popup GSAP.
// Không bao giờ hiện giữa trận: xếp hàng chờ, hiện khi rời màn 'battle'.
import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'preact/hooks';
import { unlocksBetween } from '@shared/heroes/progression';
import { me } from '../api';
import { sfx } from '../audio';
import { go, screen } from '../state';
import { Icon } from './icons';
import './profile.css';

interface Pending {
  from: number;
  to: number;
}

function LevelUpPopup({ from, to, onDone }: Pending & { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const num = useRef<HTMLElement>(null);
  const ups = unlocksBetween(from, to);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sfx('level');
    const ctx = gsap.context(() => {
      const d = (x: number) => (reduce ? 0.01 : x);
      gsap.from('.pf-lu-back', { opacity: 0, duration: d(0.25) });
      gsap.from('.pf-lu-rays', { opacity: 0, duration: d(0.8), ease: 'power2.out' });
      gsap.from('.pf-lu-title', { scale: 2.4, rotation: -8, opacity: 0, duration: d(0.55), ease: 'back.out(2.2)', delay: 0.1 });
      gsap.from('.pf-lu-ring', { scale: 0.3, opacity: 0, duration: d(0.5), ease: 'back.out(2)', delay: 0.3 });
      const o = { v: from };
      gsap.to(o, {
        v: to, duration: reduce ? 0.01 : Math.min(1.6, 0.5 + (to - from) * 0.18), delay: 0.45, ease: 'power2.out',
        onUpdate: () => {
          if (num.current) num.current.textContent = String(Math.round(o.v));
        },
        onComplete: () => {
          if (num.current) num.current.textContent = String(to);
          if (!reduce) gsap.fromTo(num.current, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
        },
      });
      const items = el.querySelectorAll('.pf-lu-unl');
      if (items.length) gsap.from(items, { y: 24, opacity: 0, duration: d(0.4), stagger: 0.15, delay: 0.9, ease: 'back.out(1.8)' });
      gsap.from('.pf-lu-cta', { y: 20, opacity: 0, duration: d(0.4), delay: 1.0 + items.length * 0.15, ease: 'back.out(2)' });
    }, el);
    const t = setTimeout(onDone, 12000);
    return () => {
      clearTimeout(t);
      ctx.revert();
    };
    // eslint-disable-next-line
  }, []);

  const armed = useRef(Date.now());
  const dismiss = () => {
    if (Date.now() - armed.current > 450) onDone();
  };
  return (
    <div class="pf-lu" ref={root} role="dialog" aria-modal="true" aria-label={`Lên cấp ${to}`} onClick={dismiss}>
      <div class="pf-lu-back" />
      <div class="pf-lu-rays" />
      <div class="pf-lu-box">
        <h2 class="pf-lu-title">LÊN CẤP!</h2>
        <div class="pf-lu-ring">
          <small>Cấp</small>
          <b ref={num}>{from}</b>
        </div>
        {ups.length > 0 && (
          <div class="pf-lu-list">
            {ups.map((u) => (
              <div class="pf-lu-unl" key={u.level}>
                <Icon n="unlock" size={30} />
                <span>
                  <b>{u.title}</b>
                  <small>{u.desc}</small>
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          class="btn green big pf-lu-cta"
          onClick={(e) => {
            e.stopPropagation();
            sfx('tap');
            onDone();
            go({ n: 'profile', tab: 'level' });
          }}
        >
          Nhận thưởng lên cấp
        </button>
        <small class="pf-lu-hint">Chạm để đóng</small>
      </div>
    </div>
  );
}

export function LevelUpHost() {
  const m = me.value;
  const uid = m?.profile.id ?? null;
  const lvl = m?.profile.level ?? null;
  const prev = useRef<{ uid: number | null; lvl: number | null }>({ uid: null, lvl: null });
  const [pend, setPend] = useState<Pending | null>(null);

  useEffect(() => {
    const p = prev.current;
    if (uid == null || lvl == null) {
      prev.current = { uid: null, lvl: null };
      setPend(null);
      return;
    }
    if (p.uid !== uid || p.lvl == null) {
      prev.current = { uid, lvl }; // lần nạp đầu / đổi tài khoản: bỏ qua
      return;
    }
    if (lvl > p.lvl) {
      const from = p.lvl;
      setPend((cur) => ({ from: cur ? cur.from : from, to: lvl })); // gộp nếu đang chờ
    }
    prev.current = { uid, lvl };
  }, [uid, lvl]);

  if (!pend || screen.value.n === 'battle') return null;
  return <LevelUpPopup key={`${pend.from}-${pend.to}`} from={pend.from} to={pend.to} onDone={() => setPend(null)} />;
}
