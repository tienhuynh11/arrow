// Kéo thả tự viết bằng pointer events (KHÔNG dùng HTML5 drag): chạy cho cả chuột và cảm ứng.
// - Nguồn kéo: gắn `onPointerDown={dragStart(opts)}` lên phần tử. Chạm/nhấp ngắn vẫn là click bình thường.
// - Ngưỡng ~6px mới bắt đầu kéo. Cảm ứng: kéo ngang ngay, hoặc giữ ~220ms rồi kéo mọi hướng (để danh sách vẫn cuộn dọc được).
// - Bóng (ghost) nổi theo ngón tay/chuột; các vùng thả là phần tử có `data-drop="khoá"`, được tô sáng khi rê qua.
// - Sau khi thả, click kế tiếp bị nuốt để không kích hoạt thao tác "chạm".

export const DRAG_THRESHOLD = 6;
const HOLD_MS = 320;

export interface DragOpts<T> {
  /** dữ liệu mang theo, gọi lúc bắt đầu kéo */
  payload: () => T;
  /** thả: `target` là giá trị data-drop của vùng thả dưới con trỏ (null = thả ra ngoài) */
  onDrop: (payload: T, target: string | null) => void;
  onStart?: (payload: T) => void;
  onEnd?: () => void;
  /** cảm ứng: cho phép kéo ngay mọi hướng (dùng ở nơi không cần cuộn). Mặc định: kéo ngang hoặc giữ rồi kéo */
  instant?: boolean;
}

function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return (el?.closest('[data-drop]') as HTMLElement | null) ?? null;
}

/** trả về handler onPointerDown cho phần tử nguồn kéo */
export function dragStart<T>(opts: DragOpts<T>) {
  return (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const id = e.pointerId;
    const touch = e.pointerType !== 'mouse';
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let moved = false; // đã di chuyển thật sự quá ngưỡng (giữ yên rồi nhả vẫn tính là chạm)
    let hold = false;
    let ghost: HTMLElement | null = null;
    let hot: HTMLElement | null = null;
    let payload: T | undefined;
    let ox = 0;
    let oy = 0;
    let holdTimer = 0;

    try {
      el.setPointerCapture(id);
    } catch {
      /* bỏ qua: trình duyệt không cho capture */
    }

    // chặn cuộn trang khi đã vào chế độ kéo (touch-action chỉ đọc lúc pointerdown nên cần chặn thêm touchmove)
    const block = (ev: TouchEvent) => {
      if (dragging) ev.preventDefault();
    };
    window.addEventListener('touchmove', block, { passive: false });

    const begin = () => {
      dragging = true;
      payload = opts.payload();
      const r = el.getBoundingClientRect();
      ox = sx - r.left;
      oy = sy - r.top;
      ghost = el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-drop');
      ghost.classList.add('dnd-ghost');
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      document.body.appendChild(ghost);
      el.classList.add('dnd-src');
      document.body.classList.add('dnd-on');
      if (navigator.vibrate && touch) navigator.vibrate(8);
      opts.onStart?.(payload);
    };

    const place = (x: number, y: number) => {
      if (ghost) ghost.style.transform = `translate(${x - ox}px, ${y - oy}px) scale(1.08) rotate(3deg)`;
      const t = targetAt(x, y);
      if (t !== hot) {
        hot?.classList.remove('drop-hot');
        hot = t;
        hot?.classList.add('drop-hot');
      }
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) >= DRAG_THRESHOLD) moved = true;
      if (!dragging) {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        const d = Math.hypot(dx, dy);
        if (d < DRAG_THRESHOLD) return;
        if (touch && !opts.instant && !hold && Math.abs(dx) <= Math.abs(dy) * 1.2) {
          // cảm ứng kéo dọc trước khi giữ đủ lâu: nhường cho cuộn danh sách
          cleanup(false);
          return;
        }
        begin();
      }
      place(ev.clientX, ev.clientY);
    };

    const cleanup = (drop: boolean, ev?: PointerEvent) => {
      clearTimeout(holdTimer);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', block);
      try {
        el.releasePointerCapture(id);
      } catch {
        /* đã nhả */
      }
      if (!dragging) return;
      const t = drop && ev ? targetAt(ev.clientX, ev.clientY) : null;
      const key = t?.getAttribute('data-drop') ?? null;
      hot?.classList.remove('drop-hot');
      ghost?.remove();
      el.classList.remove('dnd-src');
      document.body.classList.remove('dnd-on');
      if (!moved) {
        opts.onEnd?.(); // giữ yên rồi nhả: coi như chạm, để click chạy bình thường
        return;
      }
      // nuốt click ngay sau khi thả
      const eat = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 80);
      opts.onEnd?.();
      if (drop && payload !== undefined) opts.onDrop(payload, key);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === id) cleanup(true, ev);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === id) cleanup(false);
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    // giữ lâu (cảm ứng) => bật chế độ kéo mọi hướng
    if (touch && !opts.instant) {
      holdTimer = window.setTimeout(() => {
        hold = true;
        if (!dragging) begin();
        place(sx, sy);
      }, HOLD_MS);
    }
  };
}
