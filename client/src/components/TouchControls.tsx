import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ControlHint } from '@shared/protocol';

/**
 * Nút ảo cho điện thoại / máy tính bảng. Mọi game đang nghe phím trên `window`, nên các nút này chỉ việc
 * bắn KeyboardEvent giả (keydown/keyup) — không game nào phải sửa, và bàn phím thật vẫn chơi bình thường.
 */
const CODE: Record<string, string> = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown', SPACE: 'Space' };
const LABEL: Record<string, string> = { ArrowLeft: '◀', ArrowRight: '▶', ArrowUp: '▲', ArrowDown: '▼', Space: '' };

/** game chạy tự do mọi hướng: dùng cần điều khiển thay cho 4 nút */
const FREE_MOVE = new Set(['bomb', 'tiptoe', 'memory', 'blockparty', 'showdown', 'mountain', 'hex', 'door', 'codehunt', 'blindshot', 'bombmaze', 'chairs', 'actnatural']);

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

const held = new Set<string>();
function fire(code: string, down: boolean) {
  if (down === held.has(code)) return;
  if (down) held.add(code);
  else held.delete(code);
  window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }),
  );
}
const releaseAll = () => [...held].forEach((c) => fire(c, false));

function KeyButton({ code, label, big, jump }: { code: string; label?: string; big?: boolean; jump?: boolean }) {
  const [on, setOn] = useState(false);
  const down = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setOn(true);
    fire(code, true);
  };
  const up = () => {
    setOn(false);
    fire(code, false);
  };
  return (
    <button
      type="button"
      className={`tc-btn ${big ? 'big' : ''} ${jump ? 'jump' : ''} ${on ? 'on' : ''}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label ?? LABEL[code]}
    </button>
  );
}

/** cần điều khiển: kéo về hướng nào thì giữ phím mũi tên hướng đó (chéo = giữ hai phím) */
function Stick({ keys }: { keys: Set<string> }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);

  const apply = (e: ReactPointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R);
    let dy = e.clientY - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob({ x: dx, y: dy });
    const t = R * 0.32;
    if (keys.has('ArrowLeft')) fire('ArrowLeft', dx < -t);
    if (keys.has('ArrowRight')) fire('ArrowRight', dx > t);
    if (keys.has('ArrowUp')) fire('ArrowUp', dy < -t);
    if (keys.has('ArrowDown')) fire('ArrowDown', dy > t);
  };
  const end = () => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    for (const c of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) fire(c, false);
  };

  return (
    <div
      ref={base}
      className="tc-stick"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        active.current = true;
        apply(e);
      }}
      onPointerMove={(e) => active.current && apply(e)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tc-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export default function TouchControls({ gameId, controls }: { gameId: string; controls: ControlHint[] }) {
  // thả hết phím khi rời game / tab bị ẩn, tránh nhân vật chạy mãi
  useEffect(() => {
    document.addEventListener('visibilitychange', releaseAll);
    return () => {
      document.removeEventListener('visibilitychange', releaseAll);
      releaseAll();
    };
  }, []);

  const codes = new Set(controls.flatMap((c) => c.keys).map((k) => CODE[k]).filter(Boolean));
  const arrows = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].filter((c) => codes.has(c));
  const hasSpace = codes.has('Space');
  const free = FREE_MOVE.has(gameId);
  const cross = !free && arrows.length === 4;
  // game chỉ bấm SPACE: nút to ở giữa phía dưới cho dễ đập
  const spaceOnly = arrows.length === 0 && hasSpace;
  const actionLabel = gameId === 'math' ? 'CHỐT' : gameId === 'tug' ? 'KÉO!' : gameId === 'button' ? 'BẤM!' : gameId === 'reaction' ? 'BẤM!' : gameId === 'rhythm' ? 'NỐT ●' : gameId === 'bombmaze' ? '💣 BOM' : 'NHẢY';

  return (
    <div className={`tc ${spaceOnly ? 'solo' : ''}`} aria-hidden="true">
      {!spaceOnly && (
        <div className="tc-left">
          {free ? (
            <Stick keys={new Set(arrows)} />
          ) : cross ? (
            <div className="tc-cross">
              {arrows.map((c) => (
                <KeyButton key={c} code={c} />
              ))}
            </div>
          ) : (
            <div className="tc-row">
              {arrows.map((c) => (
                <KeyButton key={c} code={c} big />
              ))}
            </div>
          )}
        </div>
      )}
      {hasSpace && (
        <div className="tc-right">
          <KeyButton code="Space" label={actionLabel} big jump />
        </div>
      )}
    </div>
  );
}
