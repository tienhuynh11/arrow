// Lớp hướng dẫn tân thủ: phủ tối có khoét sáng quanh đối tượng (data-tut), bong bóng thoại kèm linh vật chibi,
// ngón tay trỏ nhấp nháy. Tính lại vị trí theo nhịp 150ms nên chịu được đổi cỡ màn hình / bố cục / hiệu ứng dịch chuyển.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { me } from '../api';
import { defOf } from '../game';
import { tutDone, tutIdx, tutNext, tutPause, tutResume, tutRunning, tutSkip, getCtx, initTutorial } from '../tutorial-state';
import { findTarget, MASCOT, STEPS, type Plan } from '../tutorial-steps';
import { Btn, Portrait } from './common';

type Side = 'below' | 'above' | 'right' | 'left';
interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
interface View {
  plan: Plan;
  rect: Rect | null;
  held: boolean;
}

const PAD = 6; // viền sáng nở ra quanh đối tượng
const MARGIN = 10; // lề tối thiểu với mép màn hình
const FINGER = 36;
const GAP = FINGER + 6; // khoảng giữa vùng sáng và bong bóng (chừa chỗ cho ngón tay)
const MISSING_MS = 4000; // đối tượng không xuất hiện quá lâu thì bỏ qua bước

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sameRect = (a: Rect | null, b: Rect | null) => (a === b ? true : !!a && !!b && a.l === b.l && a.t === b.t && a.r === b.r && a.b === b.b);

/** chọn cạnh đặt bong bóng vừa trong màn hình; không cạnh nào vừa thì đè lên phía ít quan trọng hơn */
function place(rect: Rect, w: number, h: number): { x: number; y: number; side: Side } {
  const vw = innerWidth;
  const vh = innerHeight;
  const cx = (rect.l + rect.r) / 2;
  const cy = (rect.t + rect.b) / 2;
  const xs = clamp(cx - w / 2, MARGIN, vw - MARGIN - w);
  const ys = clamp(cy - h / 2, MARGIN, vh - MARGIN - h);
  if (rect.b + GAP + h <= vh - MARGIN) return { x: xs, y: rect.b + GAP, side: 'below' };
  if (rect.t - GAP - h >= MARGIN) return { x: xs, y: rect.t - GAP - h, side: 'above' };
  if (rect.r + GAP + w <= vw - MARGIN) return { x: rect.r + GAP, y: ys, side: 'right' };
  if (rect.l - GAP - w >= MARGIN) return { x: rect.l - GAP - w, y: ys, side: 'left' };
  // không còn chỗ trống: đặt ở mép xa đối tượng hơn
  return cy > vh / 2 ? { x: xs, y: MARGIN, side: 'below' } : { x: xs, y: vh - MARGIN - h, side: 'above' };
}

function Finger({ rect, side }: { rect: Rect; side: Side }) {
  const cx = (rect.l + rect.r) / 2;
  const cy = (rect.t + rect.b) / 2;
  // ngón nằm ở cạnh hướng về bong bóng và trỏ vào vùng sáng
  const pos =
    side === 'below'
      ? { left: cx - FINGER / 2, top: rect.b + 2, rot: 0 }
      : side === 'above'
        ? { left: cx - FINGER / 2, top: rect.t - 2 - FINGER, rot: 180 }
        : side === 'right'
          ? { left: rect.r + 2, top: cy - FINGER / 2, rot: -90 }
          : { left: rect.l - 2 - FINGER, top: cy - FINGER / 2, rot: 90 };
  return (
    <div class="tut-finger" style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${FINGER}px`, height: `${FINGER}px`, transform: `rotate(${pos.rot}deg)` }} aria-hidden="true">
      <svg viewBox="0 0 36 36" width={FINGER} height={FINGER}>
        <path d="M18 3 L31 19 H23 V32 H13 V19 H5 Z" fill="#fff8e6" stroke="#1e2a4a" stroke-width="3" stroke-linejoin="round" />
      </svg>
    </div>
  );
}

function Overlay() {
  const idx = tutIdx.value;
  const step = STEPS[idx];
  const [view, setView] = useState<View | null>(null);
  const bub = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 120 });
  const missing = useRef({ id: '', since: 0 });
  const scrolled = useRef('');

  // nhịp cập nhật: kiểm tra hoàn thành, tìm đối tượng, đo vị trí
  useEffect(() => {
    missing.current = { id: '', since: 0 };
    scrolled.current = '';
    const tick = () => {
      if (tutIdx.value !== idx || !tutRunning.value) return;
      if (step.done?.(getCtx())) return tutNext();
      const held = step.hold?.() ?? false;
      const plan = step.plan();
      let rect: Rect | null = null;
      if (!held && plan.target) {
        const el = findTarget(plan.target);
        if (el) {
          missing.current = { id: plan.target, since: 0 };
          if (scrolled.current !== plan.target) {
            scrolled.current = plan.target;
            const r0 = el.getBoundingClientRect();
            if (r0.top < 0 || r0.bottom > innerHeight || r0.left < 0 || r0.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'center' });
          }
          const r = el.getBoundingClientRect();
          rect = {
            l: Math.max(0, r.left - PAD),
            t: Math.max(0, r.top - PAD),
            r: Math.min(innerWidth, r.right + PAD),
            b: Math.min(innerHeight, r.bottom + PAD),
          };
        } else {
          // chưa thấy: chờ một lúc (màn đang chuyển cảnh) rồi bỏ qua bước cho khỏi kẹt
          const now = Date.now();
          if (missing.current.id !== plan.target) missing.current = { id: plan.target, since: now };
          else if (now - missing.current.since > MISSING_MS) return tutNext();
        }
      }
      setView((p) => (p && p.held === held && p.plan.text === plan.text && p.plan.target === plan.target && p.plan.act === plan.act && p.plan.quiet === plan.quiet && sameRect(p.rect, rect) ? p : { plan, rect, held }));
    };
    tick();
    const id = setInterval(tick, 150);
    addEventListener('resize', tick);
    return () => {
      clearInterval(id);
      removeEventListener('resize', tick);
    };
  }, [idx]);

  // Esc = tạm dừng (không bao giờ kẹt trên PC); bắt ở pha capture để không đóng nhầm hộp thoại bên dưới
  const held = view?.held ?? false;
  useEffect(() => {
    if (held) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tutPause();
      }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [held]);

  // đo bong bóng để đặt chỗ
  useLayoutEffect(() => {
    const el = bub.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w !== size.w || h !== size.h) setSize({ w, h });
  });

  if (!view || view.held) return null;
  const { plan, rect } = view;
  const act = !!plan.act && !!rect;
  const quiet = !!plan.quiet || (!!plan.target && !rect); // đang chờ đối tượng hiện ra thì không chặn người chơi
  const last = idx === STEPS.length - 1;
  const def = defOf(MASCOT);

  let bx: number;
  let by: number;
  let side: Side = 'below';
  if (rect) {
    const p = place(rect, size.w, size.h);
    bx = p.x;
    by = p.y;
    side = p.side;
  } else {
    bx = clamp((innerWidth - size.w) / 2, MARGIN, innerWidth - MARGIN - size.w);
    by = quiet ? MARGIN : clamp((innerHeight - size.h) / 2, MARGIN, innerHeight - MARGIN - size.h);
  }
  const hole = rect ? { left: `${rect.l}px`, top: `${rect.t}px`, width: `${rect.r - rect.l}px`, height: `${rect.b - rect.t}px` } : null;

  return (
    <div class="tut" role="dialog" aria-label="Hướng dẫn">
      {/* nền tối: có đối tượng thì khoét sáng, không thì phủ đều; chế độ "quiet" không phủ gì */}
      {hole && <div class="tut-hole" style={hole} />}
      {!hole && !quiet && <div class="tut-dim" />}
      {/* chặn bấm ra ngoài vùng sáng; bước chỉ-bấm-Tiếp chặn cả vùng sáng */}
      {hole && act && (
        <>
          <div class="tut-block" style={{ left: 0, top: 0, right: 0, height: hole.top }} />
          <div class="tut-block" style={{ left: 0, top: `${rect!.b}px`, right: 0, bottom: 0 }} />
          <div class="tut-block" style={{ left: 0, top: hole.top, width: hole.left, height: hole.height }} />
          <div class="tut-block" style={{ left: `${rect!.r}px`, top: hole.top, right: 0, height: hole.height }} />
        </>
      )}
      {hole && !act && <div class="tut-block" style={{ inset: 0 }} />}
      {rect && <Finger rect={rect} side={side} />}

      <div ref={bub} class={`tut-bubble${quiet ? ' quiet' : ''}`} style={{ left: `${bx}px`, top: `${by}px` }}>
        <div class="tut-mascot">
          <Portrait id={def.id} rarity={def.rarity} />
        </div>
        <div class="tut-body">
          <b class="tut-name">{def.name}</b>
          <p class="tut-text">{plan.text}</p>
          <div class="tut-btns">
            <button type="button" class="tut-skip" onClick={tutSkip}>
              Bỏ qua
            </button>
            <span class="tut-dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <i key={s.id} class={i === idx ? 'on' : i < idx ? 'past' : ''} />
              ))}
            </span>
            <Btn kind={act ? 'ghost' : 'green'} small onClick={tutNext}>
              {act ? 'Qua bước' : last ? 'Hoàn thành' : 'Tiếp'}
            </Btn>
          </div>
        </div>
        <button type="button" class="tut-x" aria-label="Để sau (Esc)" title="Để sau (Esc)" onClick={tutPause}>
          ×
        </button>
      </div>
    </div>
  );
}

/** gắn một lần trong App (khi đã đăng nhập): nạp tiến độ theo tài khoản và vẽ lớp hướng dẫn nếu đang chạy */
export function TutorialHost() {
  const uid = me.value?.profile.id;
  useEffect(() => {
    if (uid != null && me.value) initTutorial(uid, me.value);
  }, [uid]);
  return tutRunning.value ? <Overlay key={tutIdx.value} /> : null;
}

/** chip nhỏ trên màn Thành: còn dang dở thì bấm để tiếp tục */
export function TutorialChip() {
  if (tutRunning.value || tutDone.value) return null;
  return (
    <button type="button" class="tut-chip" onClick={tutResume} aria-label="Tiếp tục hướng dẫn">
      Hướng dẫn
    </button>
  );
}
