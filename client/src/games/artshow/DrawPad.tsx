import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ART_COLORS,
  ART_ERASER,
  ART_H,
  ART_PAPER,
  ART_W,
  ART_WIDTHS,
  MAX_DRAWING_BYTES,
  MAX_STROKES,
  MAX_TOTAL_PTS,
  drawingBytes,
  mergeStrokes,
  simplifyStroke,
  strokeColorOf,
  strokeWidthOf,
  totalPoints,
  type ArtStroke,
} from '@shared/artshow';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { paintAll, paintStroke, setupCanvas } from './render';

interface Props {
  gameId: string;
  /** cho phép vẽ (đã vào ván và chưa hết giờ) */
  active: boolean;
  /** giờ server hết giờ vẽ */
  endAt: number;
  /** tranh server đang giữ (khi vào lại giữa ván) */
  restore: ArtStroke[] | null;
}

interface Cur {
  pid: number;
  c: number;
  w: number;
  pts: number[];
  px: number;
  py: number;
  mx: number;
  my: number;
}

const MIN_STEP = 1.5; // khoảng cách tối thiểu giữa 2 điểm thô (đơn vị toạ độ tranh)
const FLUSH_GAP_MS = 1200; // gom nét: tối đa ~1 gói/1,2 giây khi đang vẽ
const BACKUP_MS = 7000; // gửi lại toàn bộ định kỳ cho người rớt mạng/gói bị bỏ

const inkOf = (s: ArtStroke[]) =>
  Math.max(drawingBytes(s) / MAX_DRAWING_BYTES, totalPoints(s) / MAX_TOTAL_PTS, s.length / MAX_STROKES);

/**
 * Bảng vẽ canvas 2D. Nét vẽ NGAY trên máy (không chờ server); khi nhấc bút mới gom nét gửi theo lô.
 * Pointer events: chuột, cảm ứng, bút dùng chung một đường.
 */
export default function DrawPad({ gameId, active, endAt, restore }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<ArtStroke[]>([]);
  const cur = useRef<Cur | null>(null);
  const sync = useRef(0); // số nét đầu tranh mà server chắc chắn đã có giống hệt
  const lastSend = useRef(0);
  const flushTimer = useRef(0);
  const dirty = useRef(false);
  const cssW = useRef(0);
  const [tool, setTool] = useState({ c: 0, w: 1 });
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [count, setCount] = useState(0);
  const [ink, setInk] = useState(0);
  const [locked, setLocked] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hint, setHint] = useState('');
  const activeRef = useRef(active);
  activeRef.current = active && !locked;

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !cssW.current) return;
    const g = setupCanvas(cv, cssW.current);
    if (!g) return;
    paintAll(g, strokes.current);
    const c = cur.current;
    if (c && c.pts.length >= 4) paintStroke(g, [c.c, c.w, c.pts]);
  }, []);

  const refreshInfo = useCallback(() => {
    setCount(strokes.current.length);
    setInk(inkOf(strokes.current));
  }, []);

  const send = useCallback(
    (full: boolean, final = false) => {
      const all = strokes.current;
      const n = full ? 0 : Math.min(sync.current, all.length);
      net.input(gameId, { type: 'adraw', n, s: all.slice(n), ...(final ? { f: 1 } : {}) });
      sync.current = all.length;
      lastSend.current = Date.now();
      dirty.current = false;
    },
    [gameId],
  );

  const scheduleFlush = useCallback(() => {
    dirty.current = true;
    if (flushTimer.current) return;
    const wait = Math.max(0, lastSend.current + FLUSH_GAP_MS - Date.now());
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = 0;
      if (dirty.current) send(false);
    }, wait);
  }, [send]);

  /** kết thúc nét đang vẽ: làm gọn (RDP) và lượng tử hoá → đẩy vào danh sách nét */
  const commit = useCallback(() => {
    const c = cur.current;
    cur.current = null;
    if (!c) return;
    const pts = simplifyStroke(c.pts);
    const stroke: ArtStroke = [c.c, c.w, pts.length >= 2 ? pts : [pts[0] ?? 0, pts[1] ?? 0]];
    const next = mergeStrokes(strokes.current, strokes.current.length, [stroke]);
    if (!next) {
      setHint('Hết mực rồi! Hãy hoàn tác bớt nét.');
      redraw();
      return;
    }
    strokes.current = next;
    refreshInfo();
    scheduleFlush();
  }, [redraw, refreshInfo, scheduleFlush]);

  const undo = useCallback(() => {
    if (!activeRef.current || cur.current || !strokes.current.length) return;
    strokes.current = strokes.current.slice(0, -1);
    sync.current = Math.min(sync.current, strokes.current.length);
    redraw();
    refreshInfo();
    setHint('');
    scheduleFlush();
  }, [redraw, refreshInfo, scheduleFlush]);

  const clearAll = useCallback(() => {
    if (!activeRef.current || cur.current) return;
    strokes.current = [];
    sync.current = 0;
    redraw();
    refreshInfo();
    setHint('');
    scheduleFlush();
  }, [redraw, refreshInfo, scheduleFlush]);

  /* ---- khớp kích thước canvas theo khung (giữ tỉ lệ 4:3) ---- */
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const cv = cvRef.current;
    if (!wrap || !cv) return;
    const fit = () => {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      const w = Math.max(120, Math.floor(Math.min(W, (H * ART_W) / ART_H)));
      cv.style.width = `${w}px`;
      cv.style.height = `${(w * ART_H) / ART_W}px`;
      cssW.current = w;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  /* ---- khôi phục tranh từ server khi vào lại giữa ván ---- */
  useEffect(() => {
    if (!restore || !restore.length || strokes.current.length) return;
    strokes.current = restore;
    sync.current = restore.length;
    redraw();
    refreshInfo();
  }, [restore, redraw, refreshInfo]);

  /* ---- sao lưu định kỳ + nộp bản cuối khi hết giờ ---- */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (activeRef.current && strokes.current.length) send(true);
    }, BACKUP_MS);
    const onHide = () => {
      if (document.hidden && strokes.current.length && activeRef.current) send(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [send]);

  useEffect(() => {
    let t2 = 0;
    const t1 = window.setTimeout(() => {
      commit();
      setLocked(true);
      activeRef.current = false;
      if (flushTimer.current) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = 0;
      }
      send(true, true);
      sfx.good();
      t2 = window.setTimeout(() => send(true, true), 1200); // gửi lần nữa cho chắc (idempotent)
    }, Math.max(0, endAt - net.now()));
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [endAt, commit, send]);

  useEffect(
    () => () => {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  /* ---- pointer ---- */
  const toArt = (e: { clientX: number; clientY: number }) => {
    const r = cvRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ART_W, ((e.clientY - r.top) / r.height) * ART_H] as const;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current || cur.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (inkOf(strokes.current) >= 0.98) {
      setHint('Hết mực rồi! Hãy hoàn tác bớt nét.');
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toArt(e);
    const t = toolRef.current;
    cur.current = { pid: e.pointerId, c: t.c, w: t.w, pts: [x, y], px: x, py: y, mx: x, my: y };
    setHint('');
    setConfirmClear(false);
    // chấm ngay lập tức để thấy phản hồi
    const g = cvRef.current!.getContext('2d')!;
    g.fillStyle = strokeColorOf(t.c);
    g.beginPath();
    g.arc(x, y, strokeWidthOf(t.c, t.w) / 2, 0, Math.PI * 2);
    g.fill();
  };

  const addPoint = (g: CanvasRenderingContext2D, c: Cur, x: number, y: number) => {
    if (Math.hypot(x - c.px, y - c.py) < MIN_STEP) return;
    c.pts.push(x, y);
    g.strokeStyle = strokeColorOf(c.c);
    g.lineWidth = strokeWidthOf(c.c, c.w);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    const mx = (c.px + x) / 2;
    const my = (c.py + y) / 2;
    g.moveTo(c.mx, c.my);
    g.quadraticCurveTo(c.px, c.py, mx, my);
    g.stroke();
    c.px = x;
    c.py = y;
    c.mx = mx;
    c.my = my;
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cur.current;
    if (!c || c.pid !== e.pointerId) return;
    const g = cvRef.current!.getContext('2d')!;
    const evs = e.nativeEvent.getCoalescedEvents?.();
    const list = evs && evs.length ? evs : [e.nativeEvent];
    for (const ev of list) {
      const [x, y] = toArt(ev);
      addPoint(g, c, x, y);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cur.current;
    if (!c || c.pid !== e.pointerId) return;
    const g = cvRef.current!.getContext('2d')!;
    if (c.pts.length >= 4) {
      g.strokeStyle = strokeColorOf(c.c);
      g.lineWidth = strokeWidthOf(c.c, c.w);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c.mx, c.my);
      g.lineTo(c.px, c.py);
      g.stroke();
    }
    commit();
  };

  const pick = (c: number) => {
    sfx.tap();
    setTool((t) => ({ ...t, c }));
  };

  return (
    <div className="as-pad">
      <div className="as-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={cvRef}
          className={`as-canvas ${active && !locked ? '' : 'off'}`}
          style={{ background: ART_PAPER }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {locked && <div className="as-lock">⏰ Hết giờ! Đang nộp tranh…</div>}
      </div>
      <div className="as-tools" role="toolbar" aria-label="Công cụ vẽ">
        <div className="as-colors">
          {ART_COLORS.map((col, i) => (
            <button
              key={col}
              type="button"
              className={`as-sw ${tool.c === i ? 'on' : ''}`}
              style={{ background: col }}
              onClick={() => pick(i)}
              aria-label={`Màu ${i + 1}`}
            />
          ))}
          <button type="button" className={`as-sw erase ${tool.c === ART_ERASER ? 'on' : ''}`} onClick={() => pick(ART_ERASER)} aria-label="Tẩy">
            🧽
          </button>
        </div>
        <div className="as-widths">
          {ART_WIDTHS.map((w, i) => (
            <button key={w} type="button" className={`as-wd ${tool.w === i ? 'on' : ''}`} onClick={() => setTool((t) => ({ ...t, w: i }))} aria-label={`Nét ${i + 1}`}>
              <i style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
            </button>
          ))}
        </div>
        <div className="as-acts">
          <button type="button" className="as-act" onClick={undo} disabled={!count || locked}>
            ↶ Hoàn tác
          </button>
          <button
            type="button"
            className={`as-act ${confirmClear ? 'warn' : ''}`}
            disabled={!count || locked}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                window.setTimeout(() => setConfirmClear(false), 2000);
              } else {
                setConfirmClear(false);
                clearAll();
              }
            }}
          >
            {confirmClear ? 'Chắc chưa?' : '🗑 Xoá hết'}
          </button>
        </div>
        <div className={`as-ink ${ink > 0.85 ? 'low' : ''}`} title="Mực còn lại">
          <span>🖋</span>
          <b>
            <i style={{ width: `${Math.max(0, 100 - Math.round(ink * 100))}%` }} />
          </b>
        </div>
      </div>
      {hint && <div className="as-hint">{hint}</div>}
    </div>
  );
}
