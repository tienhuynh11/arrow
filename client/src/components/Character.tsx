import { useId, type CSSProperties, type ReactNode } from 'react';
import type { PlayerLook } from '@shared/protocol';
import { useStore } from '../state/store';
import { appearanceFor, hairColor, shoeColor, skinColor } from '../utils/appearance';

export type CharState = 'idle' | 'run' | 'jump' | 'hit' | 'miss' | 'win' | 'lose' | 'punch';

/**
 * Nhân vật chibi vẽ hoàn toàn bằng SVG inline (0 byte ảnh). Mọi tư thế/animation chỉ là CSS transform.
 *
 * Ngoại hình (giới tính, tóc, mắt, miệng, trang phục, phụ kiện…) và trạng thái "hạng bét → băng bó, run rẩy"
 * tự tra theo màu áo; truyền `look` / `hurt` để ghi đè (ví dụ màn tạo nhân vật).
 * `view="head"` cắt khung chỉ lấy phần đầu (dùng cho ô chọn kiểu mắt, tóc…).
 */
export default function Character({
  color,
  state = 'idle',
  size = 56,
  flip = false,
  look,
  hurt,
  view = 'full',
}: {
  color: string;
  state?: CharState;
  size?: number;
  flip?: boolean;
  look?: PlayerLook;
  hurt?: boolean;
  view?: 'full' | 'head';
}) {
  const room = useStore((s) => s.room);
  const found = appearanceFor(room, color);
  const lk = look ?? found.look;
  const isHurt = hurt ?? found.hurt;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const female = lk.gender === 1;
  const hc = hairColor(lk);
  const hairFill: CSSProperties | undefined = hc ? { fill: hc, filter: 'none' } : undefined;
  const skinFill: CSSProperties = { fill: skinColor(lk) };
  const shoeFill: CSSProperties = { fill: shoeColor(lk) };
  const dress = lk.outfit === 5;
  const head = view === 'head';

  const sad = state === 'miss' || state === 'lose';
  const happy = state === 'hit' || state === 'win' || state === 'punch';
  const hair = hairParts(lk, hairFill);
  const mouthCls = `ch-mouth ${female ? 'female' : ''}`;
  const browStyle: CSSProperties = { stroke: hc ?? '#3b2b36' };
  // tóc dài che mất tai
  const showEars = !(female && (lk.hair === 0 || lk.hair === 4));

  let eyes: ReactNode;
  let mouth: ReactNode;
  let brows: ReactNode;
  if (sad) {
    eyes = <path className="ch-eye-line" d="M14 15.6l3.2 3.2M17.2 15.6L14 18.8M22.8 15.6l3.2 3.2M26 15.6l-3.2 3.2" />;
    mouth = <path className={mouthCls} d="M17 23.8q3-2.6 6 0" />;
    brows = <path className="ch-brow" style={browStyle} d="M13.6 13.8l4-1.4M26.4 13.8l-4-1.4" />;
  } else if (happy) {
    eyes = <path className="ch-eye-line" d="M13.4 18q2.2-3 4.4 0M22.2 18q2.2-3 4.4 0" />;
    mouth = (
      <>
        <path className="ch-mouth-open" d="M16.8 21.6h6.4a3.2 3.2 0 0 1-6.4 0z" />
        <path className="ch-tongue" d="M18.4 23.6q1.6-1.2 3.2 0a1.8 1.2 0 0 1-3.2 0z" />
      </>
    );
  } else if (isHurt) {
    // mặt nhăn nhó đau đớn
    eyes = <path className="ch-eye-line" d="M13.6 16.2l3.8 1.4-3.8 1.4M26.4 16.2l-3.8 1.4 3.8 1.4" />;
    mouth = <path className={mouthCls} d="M16.8 23.4l1.1-.9 1.1.9 1.1-.9 1.1.9 1.1-.9 1.1.9" />;
    brows = <path className="ch-brow" style={browStyle} d="M13.6 13.8l4-1.4M26.4 13.8l-4-1.4" />;
  } else {
    eyes = <Eyes kind={lk.eyes} female={female} />;
    mouth = <Mouth kind={lk.mouth} cls={mouthCls} />;
  }
  if (!brows) {
    brows =
      lk.eyes === 5 && !happy ? (
        <path className="ch-brow bold" style={browStyle} d="M13.4 12.6l4.6 1.8M26.6 12.6l-4.6 1.8" />
      ) : female ? (
        <path className="ch-brow thin" style={browStyle} d="M13.6 13.2q2-1.4 4-.4M22.4 12.8q2-1 4 .4" />
      ) : (
        <path className="ch-brow bold" style={browStyle} d="M13.2 13.6q2.2-1.2 4.6-.4M22.2 13.2q2.4-.8 4.6.4" />
      );
  }

  return (
    <svg
      className={`ch ch-${state} ${isHurt ? 'ch-hurt' : ''} ${female ? 'ch-female' : ''} ${head ? 'ch-headview' : ''}`}
      viewBox={head ? '3 -3 34 34' : '0 0 40 58'}
      width={size}
      height={head ? size : (size * 58) / 40}
      style={{ ['--c' as string]: color, transform: flip ? 'scaleX(-1)' : undefined }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${uid}-torso`}>
          <rect x="12.8" y="26" width="14.4" height="15.6" rx="6" />
        </clipPath>
      </defs>
      {!head && <ellipse className="ch-shadow" cx="20" cy="55" rx="11" ry="2.4" />}

      <g className="ch-rig">
        {/* chân + giày */}
        <g className="ch-leg ch-leg-l">
          <rect className={`ch-ol ${dress ? '' : 'ch-pants'}`} style={dress ? skinFill : undefined} x="15.4" y="40" width="4.2" height="10" rx="2" />
          <rect className="ch-ol" style={shoeFill} x="14.2" y="48.4" width="5.8" height="3.8" rx="1.9" />
        </g>
        <g className="ch-leg ch-leg-r">
          <rect className={`ch-ol ${dress ? '' : 'ch-pants'}`} style={dress ? skinFill : undefined} x="20.4" y="40" width="4.2" height="10" rx="2" />
          <rect className="ch-ol" style={shoeFill} x="20" y="48.4" width="5.8" height="3.8" rx="1.9" />
          {isHurt && <rect className="ch-bandage" x="20.1" y="43.4" width="4.8" height="2.6" rx="0.8" />}
        </g>

        {/* tay nằm sau thân để đọc ra vai */}
        <g className="ch-arm ch-arm-l">
          <rect className="ch-sleeve ch-ol" x="9.4" y="27.4" width="4.2" height="11.4" rx="2.1" />
          <circle className="ch-ol" style={skinFill} cx="11.5" cy="39.6" r="2.2" />
          {isHurt && <rect className="ch-bandage" x="9.1" y="31.6" width="4.8" height="3" rx="0.8" />}
        </g>
        <g className="ch-arm ch-arm-r">
          <rect className="ch-sleeve ch-ol" x="26.4" y="27.4" width="4.2" height="11.4" rx="2.1" />
          <circle className="ch-ol" style={skinFill} cx="28.5" cy="39.6" r="2.2" />
        </g>

        {/* thân + trang phục */}
        <rect className="ch-torso ch-ol" x="12.8" y="26" width="14.4" height="15.6" rx="6" />
        {lk.outfit !== 2 && !dress && <rect className="ch-belt" x="12.8" y="38.4" width="14.4" height="2.8" rx="1.4" />}
        <Outfit kind={lk.outfit} clip={`url(#${uid}-torso)`} />
        {dress && <path className="ch-torso ch-ol" d="M13.4 35.4h13.2l3.8 9.6q-10.4 2.8-20.8 0z" />}

        <g className="ch-head">
          {hair.back}
          {showEars && (
            <>
              <circle className="ch-ol" style={skinFill} cx="7.9" cy="17.6" r="2.1" />
              <circle className="ch-ol" style={skinFill} cx="32.1" cy="17.6" r="2.1" />
            </>
          )}
          <circle className="ch-face ch-ol" cx="20" cy="16" r="12.4" style={skinFill} />
          <ellipse className="ch-face-shine" cx="15" cy="9.4" rx="4.2" ry="2.3" transform="rotate(-24 15 9.4)" />
          {(female || lk.face === 1) && (
            <>
              <ellipse className="ch-blush" cx="12.4" cy="21.6" rx="2.4" ry="1.4" />
              <ellipse className="ch-blush" cx="27.6" cy="21.6" rx="2.4" ry="1.4" />
            </>
          )}
          <path className="ch-nose" d="M19.3 20.2q.7.6 1.4 0" />
          {brows}
          {eyes}
          {mouth}
          <FaceMark kind={lk.face} hairFill={hairFill} />
          {hair.front}

          {isHurt && (
            <>
              {/* băng quấn trán + băng keo chữ X trên má + giọt mồ hôi */}
              <path className="ch-bandage" d="M7.8 11.6q12.2-4.8 24.4 0v3.4q-12.2-4.8-24.4 0z" />
              <path className="ch-bandage-x" d="M27 9.2l2.4 2.6M29.4 9.2L27 11.8" />
              <g className="ch-plaster">
                <rect x="10.4" y="21.4" width="5.4" height="2.1" rx="1" transform="rotate(-28 13.1 22.4)" />
                <rect x="10.4" y="21.4" width="5.4" height="2.1" rx="1" transform="rotate(28 13.1 22.4)" />
              </g>
              <path className="ch-sweat" d="M33.6 7.2q2.1 3.1 0 4.4-2.1-1.3 0-4.4z" />
            </>
          )}

          <Glasses kind={lk.glasses} />
          <Hat kind={lk.hat} hairFill={hairFill} />
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

const BANGS_F =
  'M7.8 17.6C7.4 9.6 12.8 3.6 20 3.6s12.6 6 12.2 14c-1.2-2.6-2.8-4.4-4.8-5.4-.8 2-2.4 3-4.4 3.2-1-1.4-1.4-2.8-1.4-4-1.8 2.2-4.4 3.6-7.6 3.8-2.4.4-4.4 1.8-6.2 3.4z';

function hairParts(lk: PlayerLook, style?: CSSProperties): { back: ReactNode; front: ReactNode } {
  const H = (d: string) => <path className="ch-hair ch-ol" style={style} d={d} />;
  const C = (cx: number, cy: number, r: number) => (
    <circle key={`${cx}-${cy}`} className="ch-hair ch-ol" style={style} cx={cx} cy={cy} r={r} />
  );

  if (lk.gender === 1) {
    switch (lk.hair) {
      case 1: // đuôi ngựa
        return {
          back: H('M28.6 6.8c5-1.4 8.6 2.4 8.2 7.8-.4 5.8-3.4 10.2-2.4 14.8-3.2-2.4-4.8-6.4-4.2-11 .4-3.4-.4-6.4-1.6-9.2z'),
          front: (
            <>
              {H(BANGS_F)}
              <circle className="ch-hairtie" cx="30.2" cy="7.4" r="1.5" />
            </>
          ),
        };
      case 2: // hai bím
        return {
          back: (
            <>
              {C(7.2, 21.4, 2.7)}
              {C(6.8, 26, 2.4)}
              {C(7, 30.2, 2.1)}
              {C(32.8, 21.4, 2.7)}
              {C(33.2, 26, 2.4)}
              {C(33, 30.2, 2.1)}
            </>
          ),
          front: (
            <>
              {H(BANGS_F)}
              <circle className="ch-hairtie" cx="7" cy="32.4" r="1.1" />
              <circle className="ch-hairtie" cx="33" cy="32.4" r="1.1" />
            </>
          ),
        };
      case 3: // búi củ tỏi
        return { back: C(20, 2.2, 4.6), front: H(BANGS_F) };
      case 4: // bob
        return {
          back: H('M6.6 16.4C6.6 8.2 12.6 3 20 3s13.4 5.2 13.4 13.4v9c-1.6 1.4-4 1.2-5-.2V18.6H11.6v7.6c-1 1.4-3.4 1.6-5 .2z'),
          front: H('M7.8 14.4C8.4 7.8 13.4 3.6 20 3.6s11.6 4.2 12.2 10.8c-4-.9-8.1-1.3-12.2-1.3s-8.2.4-12.2 1.3z'),
        };
      case 5: // hai búi
        return {
          back: (
            <>
              {C(10.2, 4.6, 3.9)}
              {C(29.8, 4.6, 3.9)}
            </>
          ),
          front: H(BANGS_F),
        };
      default: // xoã dài
        return {
          back: H('M6.2 16.4C6.2 7.8 12.2 2.6 20 2.6s13.8 5.2 13.8 13.8v17.4c-2 1.6-4.6 1.4-5.8-.4V21H12v12.4c-1.2 1.8-3.8 2-5.8.4z'),
          front: H(BANGS_F),
        };
    }
  }

  switch (lk.hair) {
    case 1: // dựng ngược
      return {
        back: null,
        front: H(
          'M7.8 16.2C6.8 11.4 8 7.4 10.4 5.4L9.8 1.8l3.4 1.6L15 .2l2.6 2.4 2.8-2.4 2.4 2.6 3.4-1.8.6 3.2 3.4-.2-1 3.2c2.6 2.4 3.2 6 2.4 9.4-2-3-4.6-4.8-8-5.4-3.4 1.2-7.4 1.2-10.8.4-2.6 1.2-4.2 2.8-5.2 5z',
        ),
      };
    case 2: // mái lệch
      return {
        back: null,
        front: H('M7.6 17.4C6.6 9.6 12.2 3.4 20.2 3.4c7.6 0 12.8 5.8 12.2 13.2-1.2-2.8-2.8-4.6-5-5.6-4.4 2.6-12 4-16.6 8.4-1.4-.4-2.4-1-3.2-2z'),
      };
    case 3: // xoăn tít
      return {
        back: null,
        front: (
          <>
            {(
              [
                [9.6, 11.4, 3.8],
                [13.4, 6.6, 4],
                [20, 4.6, 4.3],
                [26.6, 6.6, 4],
                [30.4, 11.4, 3.8],
              ] as const
            ).map(([x, y, r]) => C(x, y, r))}
          </>
        ),
      };
    case 4: // undercut
      return {
        back: null,
        front: (
          <>
            <path
              className="ch-hair ch-fade"
              style={style}
              d="M7.8 17.2C7.6 12 9.2 8.6 11.8 6.6l.4 6.2c-2 1.2-3.4 2.6-4.4 4.4zM32.2 17.2c.2-5.2-1.4-8.6-4-10.6l-.4 6.2c2 1.2 3.4 2.6 4.4 4.4z"
            />
            {H('M10.4 12.6C10.6 6.2 14.8 1.8 20.4 1.8c6 0 10.2 4.2 9.8 10.6-3.2-1.8-6.4-2.6-9.8-2.6s-6.8.8-10 2.8z')}
          </>
        ),
      };
    case 5: // trọc
      return { back: null, front: <path className="ch-bald-shine" d="M13.4 7.4q3.4-2.4 7-2.6" /> };
    default: // ngắn gọn
      return {
        back: null,
        front: H('M7.6 16.6C7 9.2 12.4 3.4 20 3.4s13 5.8 12.4 13.2c-1.4-3.2-3.4-5.2-6-6-2.4 2-6.4 2.8-10.6 2.2-3.4.6-6 2-8.2 4z'),
      };
  }
}

function Eyes({ kind, female }: { kind: number; female: boolean }) {
  const lashes =
    female && (kind === 0 || kind === 1 || kind === 4) ? (
      <path className="ch-lash" d="M14.2 15.6l-1-1.1M13.8 16.5l-1.3-.5M25.8 15.6l1-1.1M26.2 16.5l1.3-.5" />
    ) : null;
  switch (kind) {
    case 1: // long lanh
      return (
        <>
          {[15.6, 24.4].map((x) => (
            <g key={x}>
              <ellipse className="ch-eye" cx={x} cy="17.4" rx="2.5" ry="2.9" />
              <circle className="ch-eye-shine" cx={x + 0.8} cy="16.4" r="1" />
              <circle className="ch-eye-shine" cx={x - 0.7} cy="18.5" r="0.45" />
            </g>
          ))}
          {lashes}
        </>
      );
    case 2: // mắt cười
      return <path className="ch-eye-line" d="M13.4 18q2.2-3 4.4 0M22.2 18q2.2-3 4.4 0" />;
    case 3: // lim dim
      return (
        <>
          <path className="ch-eye-line" d="M13.4 16.8h4.4M22.2 16.8h4.4" />
          <path className="ch-eye" d="M14 16.9a1.6 1.5 0 0 0 3.2 0zM22.8 16.9a1.6 1.5 0 0 0 3.2 0z" />
        </>
      );
    case 4: // mắt mèo
      return (
        <>
          {[15.6, 24.4].map((x) => (
            <g key={x}>
              <path className="ch-eye" d={`M${x - 2.6} 17.6q2.6-2.8 5.2 0q-2.6 2.6-5.2 0z`} />
              <circle className="ch-eye-shine" cx={x + 0.9} cy="16.9" r="0.6" />
            </g>
          ))}
          {lashes}
        </>
      );
    case 5: // ngầu lòi
      return (
        <>
          {[15.6, 24.4].map((x) => (
            <circle key={x} className="ch-eye" cx={x} cy="17.6" r="1.4" />
          ))}
        </>
      );
    default: // tròn xoe
      return (
        <>
          {[15.6, 24.4].map((x) => (
            <g key={x}>
              <ellipse className="ch-eye" cx={x} cy="17.4" rx="1.8" ry="2.2" />
              <circle className="ch-eye-shine" cx={x + 0.6} cy="16.6" r="0.65" />
            </g>
          ))}
          {lashes}
        </>
      );
  }
}

function Mouth({ kind, cls }: { kind: number; cls: string }) {
  switch (kind) {
    case 1: // cười toe
      return (
        <>
          <path className="ch-mouth-open" d="M17.2 21.8h5.6a2.8 2.8 0 0 1-5.6 0z" />
          <path className="ch-tongue" d="M18.6 23.6q1.4-1 2.8 0a1.5 1 0 0 1-2.8 0z" />
        </>
      );
    case 2: // miệng mèo
      return <path className={cls} d="M17.4 22.4q1.3 1.4 2.6 0q1.3 1.4 2.6 0" />;
    case 3: // lè lưỡi
      return (
        <>
          <ellipse className="ch-tongue" cx="20.8" cy="24" rx="1.1" ry="1.4" />
          <path className={cls} d="M17.8 22.6q2.2 1.8 4.4 0" />
        </>
      );
    case 4: // chu môi
      return <ellipse className={`${cls} ch-pout`} cx="20.4" cy="22.9" rx="1" ry="1.1" />;
    default:
      return <path className={cls} d="M18 22.6q2 1.7 4 0" />;
  }
}

function FaceMark({ kind, hairFill }: { kind: number; hairFill?: CSSProperties }) {
  switch (kind) {
    case 2: // tàn nhang
      return (
        <g className="ch-freckle">
          {(
            [
              [12.2, 20.3],
              [13.7, 21.2],
              [12.7, 22.2],
              [27.8, 20.3],
              [26.3, 21.2],
              [27.3, 22.2],
            ] as const
          ).map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.45" />
          ))}
        </g>
      );
    case 3:
      return <circle className="ch-mole" cx="25.6" cy="23.8" r="0.6" />;
    case 4: // râu mép
      return (
        <path
          className="ch-hair ch-ol"
          style={hairFill}
          d="M16.2 22q1.9-1.8 3.8-.5 1.9-1.3 3.8.5-1.9.9-3.8-.2-1.9 1.1-3.8.2z"
        />
      );
    case 5:
      return <path className="ch-star" d="M28 19.6l.7 1.4 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" />;
    default:
      return null;
  }
}

function Outfit({ kind, clip }: { kind: number; clip: string }) {
  const collar = <path className="ch-collar" d="M17.4 26.4q2.6 2.6 5.2 0" />;
  switch (kind) {
    case 1: // áo sọc
      return (
        <>
          <g clipPath={clip}>
            {[28.6, 32, 35.4, 38.8].map((y) => (
              <rect key={y} className="ch-stripe" x="12" y={y} width="16" height="1.7" />
            ))}
          </g>
          {collar}
        </>
      );
    case 2: // hoodie
      return (
        <>
          <path className="ch-outfit-dark ch-ol" d="M11.8 28.2q8.2-6 16.4 0-2.6 3.2-8.2 3.4-5.6-.2-8.2-3.4z" />
          <rect className="ch-outfit-dark" x="15.4" y="34.4" width="9.2" height="4.4" rx="2" />
          <path className="ch-string" d="M18.2 29.8v3.6M21.8 29.8v3.6" />
        </>
      );
    case 3: // áo khoác
      return (
        <>
          <g clipPath={clip}>
            <rect className="ch-white" x="17.2" y="25" width="5.6" height="18" />
          </g>
          <path className="ch-outfit-dark ch-ol" d="M17.2 26.2l2.8 5.8-2.8 1.6zM22.8 26.2L20 32l2.8 1.6z" />
          <circle className="ch-button" cx="15.6" cy="35.6" r="0.7" />
          <circle className="ch-button" cx="24.4" cy="35.6" r="0.7" />
        </>
      );
    case 4: // sơ mi cà vạt
      return (
        <>
          <g clipPath={clip}>
            <rect className="ch-white" x="12" y="25" width="16" height="4.6" />
          </g>
          <path className="ch-white ch-ol" d="M16.4 26l3.6 2.8-3 2zM23.6 26L20 28.8l3 2z" />
          <path className="ch-tie ch-ol" d="M19.1 28.8h1.8l1 7.6-1.9 1.8-1.9-1.8z" />
        </>
      );
    case 5: // váy xoè: nơ ở eo (thân váy vẽ riêng)
      return (
        <>
          {collar}
          <path className="ch-white ch-ol" d="M17.8 33.4l2.2 1.2 2.2-1.2v2.4l-2.2-1.2-2.2 1.2z" />
        </>
      );
    default:
      return collar;
  }
}

function Glasses({ kind }: { kind: number }) {
  switch (kind) {
    case 1:
      return (
        <g className="ch-glasses">
          <circle cx="15.6" cy="17.4" r="3.6" />
          <circle cx="24.4" cy="17.4" r="3.6" />
          <path d="M19.2 17.2h1.6M8.2 16.4l4-.3M31.8 16.4l-4-.3" />
        </g>
      );
    case 2:
      return (
        <g className="ch-shades">
          <path className="lens" d="M11.4 15.2h8v2.8a3.4 3.4 0 0 1-8 0zM20.6 15.2h8v2.8a3.4 3.4 0 0 1-8 0z" />
          <path className="frame" d="M19.4 15.8h1.2M8.2 15.6l3.2-.2M31.8 15.6l-3.2-.2" />
          <path className="shine" d="M13 17l1.8-1M22.2 17l1.8-1" />
        </g>
      );
    case 3:
      return (
        <g className="ch-heart-glasses">
          <path d="M15.6 20.6l-3.4-3.3a2.1 2.1 0 0 1 3.4-2.6 2.1 2.1 0 0 1 3.4 2.6zM24.4 20.6l-3.4-3.3a2.1 2.1 0 0 1 3.4-2.6 2.1 2.1 0 0 1 3.4 2.6z" />
          <path className="frame" d="M19 16.6h2" />
        </g>
      );
    default:
      return null;
  }
}

function Hat({ kind, hairFill }: { kind: number; hairFill?: CSSProperties }) {
  switch (kind) {
    case 1:
      return (
        <g className="ch-hat-cap">
          <path className="ch-ol" d="M7.2 13.4a12.8 12.8 0 0 1 25.6 0z" />
          <rect className="brim ch-ol" x="19.6" y="11.8" width="16" height="3" rx="1.5" />
          <circle className="btn" cx="20" cy="1.2" r="1.2" />
        </g>
      );
    case 2:
      return (
        <g className="ch-beanie">
          <path className="dome ch-ol" d="M7.2 14C7 6.2 12.8 1.4 20 1.4S33 6.2 32.8 14z" />
          <rect className="band ch-ol" x="6.6" y="11.6" width="26.8" height="4" rx="2" />
          <circle className="pom ch-ol" cx="20" cy="0.8" r="2.6" />
        </g>
      );
    case 3:
      return (
        <g>
          <path className="ch-crown" d="M12 9.4l1.6-7.2 3.8 3.6L20 .4l2.6 5.4 3.8-3.6 1.6 7.2z" />
          <circle className="ch-gem" cx="20" cy="7.2" r="1" />
        </g>
      );
    case 4:
      return (
        <g className="ch-bow">
          <path className="ch-ol" d="M27.6 5.6l5.6-3.8v7.6zM27.6 5.6l-4.8-4v8z" />
          <circle cx="27.6" cy="5.6" r="1.6" />
        </g>
      );
    case 5:
      return (
        <g className="ch-cat">
          <path className="ch-hair ch-ol" style={hairFill} d="M8.4 10.6L8 .8l7.8 4.8zM31.6 10.6L32 .8l-7.8 4.8z" />
          <path className="inner" d="M9.4 8.4l-.2-5 4 2.5zM30.6 8.4l.2-5-4 2.5z" />
        </g>
      );
    case 6:
      return (
        <g className="ch-phones">
          <path className="band" d="M7 17a13 13 0 0 1 26 0" />
          <rect className="ch-ol" x="4.4" y="13.6" width="4.8" height="7.6" rx="2.3" />
          <rect className="ch-ol" x="30.8" y="13.6" width="4.8" height="7.6" rx="2.3" />
        </g>
      );
    case 7:
      return (
        <g className="ch-horns">
          <path className="ch-ol" d="M12.6 8.2Q8.8 5 9.6.4q2.8 3.4 5.8 4.8z" />
          <path className="ch-ol" d="M27.4 8.2Q31.2 5 30.4.4q-2.8 3.4-5.8 4.8z" />
        </g>
      );
    case 8:
      return (
        <g className="ch-flower">
          {[0, 72, 144, 216, 288].map((a) => (
            <circle
              key={a}
              className="petal"
              cx={29.4 + Math.cos((a * Math.PI) / 180) * 2.1}
              cy={7.2 + Math.sin((a * Math.PI) / 180) * 2.1}
              r="1.8"
            />
          ))}
          <circle className="core" cx="29.4" cy="7.2" r="1.3" />
        </g>
      );
    case 9:
      return <ellipse className="ch-halo" cx="20" cy="-2" rx="8" ry="2.2" />;
    default:
      return null;
  }
}
