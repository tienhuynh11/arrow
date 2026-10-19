// Thành phần UI dùng chung: nút, hộp thoại, thẻ tướng, sao, huy hiệu hệ/vai trò, toast, khung 3D.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { MAX_STAR } from '@shared/heroes/config';
import { ELEMENT_NAME, ROLE_NAME, type HeroDef, type OwnedHero, type Rarity } from '@shared/heroes/types';
import { sfx } from '../audio';
import { portraitOf } from '../render/portraits';
import { toasts, useMedia } from '../state';
import { ELEM_CSS, ELEM_ICON, ROLE_ICON, Icon, type IconName } from './icons';

/** màn lớn (PC / máy tính bảng): khớp các khối @media "dk-" ở cuối styles.css; điện thoại giữ nguyên bố cục cũ */
export const DK_Q = '(min-width: 900px) and (min-height: 560px), (min-width: 700px) and (min-height: 800px)';
/** PC ngang đủ rộng để có cột phụ bên phải */
export const DK_LAND_Q = '(min-width: 900px) and (min-height: 560px) and (min-aspect-ratio: 1/1)';
export const useDesktop = () => useMedia(DK_Q);
export const useDesktopLand = () => useMedia(DK_LAND_Q);

export function Spinner() {
  return <span class="spin" aria-label="Đang tải" />;
}

export function Btn(p: {
  kind?: 'primary' | 'green' | 'blue' | 'red' | 'ghost' | 'purple';
  big?: boolean;
  small?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  class?: string;
  children?: ComponentChildren;
  title?: string;
  /** id cho hướng dẫn tân thủ (data-tut) */
  tut?: string;
}) {
  return (
    <button
      type="button"
      title={p.title}
      data-tut={p.tut}
      class={`btn ${p.kind ?? 'primary'}${p.big ? ' big' : ''}${p.small ? ' small' : ''}${p.busy ? ' busy' : ''} ${p.class ?? ''}`}
      disabled={p.disabled || p.busy}
      onClick={(e) => {
        sfx('tap');
        p.onClick?.(e);
      }}
    >
      {p.busy ? <Spinner /> : p.children}
    </button>
  );
}

export function IconBtn(p: { n: IconName; onClick: () => void; label: string; class?: string; active?: boolean }) {
  return (
    <button type="button" class={`ibtn ${p.class ?? ''}${p.active ? ' on' : ''}`} aria-label={p.label} title={p.label} onClick={() => { sfx('tap'); p.onClick(); }}>
      <Icon n={p.n} size={22} />
    </button>
  );
}

export function Modal(p: { title?: string; onClose?: () => void; children: ComponentChildren; wide?: boolean; class?: string }) {
  // tiếng mở / đóng hộp thoại
  useEffect(() => {
    sfx('open');
    return () => sfx('close');
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose?.();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [p.onClose]);
  return (
    <div class="modal-back" onPointerDown={(e) => e.target === e.currentTarget && p.onClose?.()}>
      <div class={`modal${p.wide ? ' wide' : ''} ${p.class ?? ''}`} role="dialog" aria-modal="true">
        {(p.title || p.onClose) && (
          <div class="modal-head">
            <h2>{p.title}</h2>
            {p.onClose && <IconBtn n="close" label="Đóng" onClick={p.onClose} />}
          </div>
        )}
        <div class="modal-body">{p.children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  // tiếng theo loại thông báo mới nhất: lỗi -> error, thành công -> select
  const latest = toasts.value[toasts.value.length - 1];
  const lastId = latest?.id;
  useEffect(() => {
    if (latest?.kind === 'error') sfx('error');
    else if (latest?.kind === 'ok') sfx('select');
  }, [lastId]);
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Stars({ n, max = MAX_STAR, size = 14 }: { n: number; max?: number; size?: number }) {
  return (
    <span class="stars">
      {Array.from({ length: max }, (_, i) => (
        <Icon key={i} n={i < n ? 'star' : 'starEmpty'} size={size} />
      ))}
    </span>
  );
}

export function ElemChip({ el, label }: { el: HeroDef['element']; label?: boolean }) {
  return (
    <span class="chip elem" style={{ '--c': ELEM_CSS[el] } as any} title={ELEMENT_NAME[el]}>
      <Icon n={ELEM_ICON[el]} size={16} />
      {label && <b>{ELEMENT_NAME[el]}</b>}
    </span>
  );
}
export function RoleChip({ role, label }: { role: HeroDef['role']; label?: boolean }) {
  return (
    <span class="chip role" title={ROLE_NAME[role]}>
      <Icon n={ROLE_ICON[role]} size={16} />
      {label && <b>{ROLE_NAME[role]}</b>}
    </span>
  );
}
export function RarityTag({ r }: { r: Rarity }) {
  return <span class={`rtag r-${r}`}>{r}</span>;
}

export function Portrait({ id, rarity }: { id: string; rarity: Rarity }) {
  const src = portraitOf(id, rarity).value;
  if (src && src !== 'none') return <img class="portrait" src={src} alt="" draggable={false} />;
  return <div class={`portrait ph${src === 'none' ? ' none' : ''}`}>{src === 'none' ? id.slice(0, 1).toUpperCase() : <Spinner />}</div>;
}

export function HeroCard(p: {
  def: HeroDef;
  owned?: OwnedHero;
  selected?: boolean;
  dim?: boolean;
  mini?: boolean;
  badge?: ComponentChildren;
  onClick?: () => void;
  tut?: string;
}) {
  const { def, owned } = p;
  return (
    <button
      type="button"
      data-tut={p.tut}
      class={`hcard r-${def.rarity}${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}${p.mini ? ' mini' : ''}`}
      onClick={() => {
        sfx('tap');
        p.onClick?.();
      }}
      aria-label={def.name}
    >
      <div class="hc-art">
        <Portrait id={def.id} rarity={def.rarity} />
        {def.rarity === 'UR' && <span class="shimmer" />}
      </div>
      <span class="hc-elem">
        <ElemChip el={def.element} />
      </span>
      <span class="hc-rar">{def.rarity}</span>
      {owned && <span class="hc-lv">Lv{owned.level}</span>}
      {owned && !p.mini && <Stars n={owned.star} size={11} />}
      {!p.mini && <span class="hc-name">{def.name}</span>}
      {p.badge}
    </button>
  );
}

/** khung canvas 3D: tạo/huỷ cảnh theo vòng đời component (đảm bảo trả WebGL context khi rời) */
export function Canvas3D({ start, class: cls, onPointer }: { start: (canvas: HTMLCanvasElement) => (() => void) | undefined; class?: string; onPointer?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    stop.current = start(ref.current!);
    return () => stop.current?.();
    // eslint-disable-next-line
  }, []);
  return <canvas ref={ref} class={`c3d ${cls ?? ''}`} style={onPointer ? { touchAction: 'none' } : undefined} />;
}
