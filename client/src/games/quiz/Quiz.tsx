import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import Character from '../../components/Character';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import type { QuizGameState } from './useQuizGame';

interface Props {
  game: QuizGameState;
  players: PlayerState[];
  meId: string;
  live: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Làm rõ dần theo tiến độ k (0..1): mờ giảm chậm lúc đầu, nhanh dần về cuối */
function fade(p: number) {
  const k = Math.max(0, Math.min(1, p));
  const blur = 28 * (1 - k * k);
  return {
    filter: `blur(${blur.toFixed(2)}px) saturate(${(0.25 + 0.75 * k).toFixed(2)}) brightness(${(0.55 + 0.45 * k).toFixed(2)})`,
    transform: `scale(${(1.16 - 0.16 * k).toFixed(3)})`,
    fog: (1 - k) * 0.85,
  };
}

/** Chân dung tròn của người chơi (đầu nhân vật) */
function Portrait({ p, size }: { p: PlayerState; size: number }) {
  return (
    <span className="qz-face" style={{ width: size, height: size, ['--c' as string]: p.color }}>
      <Character color={p.color} look={p.look} view="head" size={size} />
    </span>
  );
}

/** Số đếm tăng dần from → to (chỉ đổi textContent, không re-render) */
function Count({ from, to, delay }: { from: number; to: number; delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = String(from);
    if (from === to) return;
    let id = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 900));
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [from, to, delay]);
  return <span ref={ref}>{from}</span>;
}

export default function Quiz({ game, players, meId, live }: Props) {
  const { q, prog, ack, sent, result, scores, submit } = game;
  const [text, setText] = useState('');
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [needPlay, setNeedPlay] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);
  const ptsRef = useRef<HTMLElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const nextRef = useRef<HTMLSpanElement>(null);
  const mediaRef = useRef<HTMLElement | null>(null);
  const fogRef = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const qRef = useRef(q);
  const resRef = useRef(result);
  qRef.current = q;
  resRef.current = result;
  const playersRef = useRef(players);
  playersRef.current = players;

  // câu mới: xoá ô nhập + lỗi media
  useEffect(() => {
    setText('');
    setMediaErr(null);
    setNeedPlay(false);
    if (q) {
      const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
      return () => window.clearTimeout(t);
    }
  }, [q?.i]);

  // một vòng rAF: thanh điểm, đồng hồ, độ rõ của media, tắt tiếng; không re-render React mỗi khung hình
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const qq = qRef.current;
      const res = resRef.current;
      const now = net.now();
      if (res) {
        if (nextRef.current) {
          const s = Math.max(0, Math.ceil((res.nextAt - now) / 1000));
          nextRef.current.textContent = `Câu kế sau ${s}s`;
        }
      }
      if (qq) {
        const total = Math.max(1, qq.endAt - qq.startAt);
        const p = res ? 1 : (now - qq.startAt) / total;
        const remain = res ? 0 : Math.max(0, Math.min(1, 1 - p));
        const ended = !!res || now >= qq.endAt;
        if (barRef.current) {
          barRef.current.style.clipPath = `inset(0 ${((1 - (ended ? 0 : remain)) * 100).toFixed(2)}% 0 0)`;
        }
        if (ptsRef.current) ptsRef.current.textContent = String(ended ? 0 : Math.round(300 + 700 * remain));
        if (clockRef.current) {
          clockRef.current.textContent = res ? '' : ended ? 'Hết giờ…' : `${Math.max(0, Math.ceil((qq.endAt - now) / 1000))}s`;
          clockRef.current.classList.toggle('low', !ended && p > 0.8);
        }
        const f = fade(p);
        const el = mediaRef.current;
        if (el) {
          el.style.filter = res ? 'none' : f.filter;
          el.style.transform = res ? 'scale(1)' : f.transform;
        }
        if (fogRef.current) fogRef.current.style.opacity = String(res ? 0 : f.fog);
        const av = avRef.current;
        if (av) {
          av.muted = sfx.isMuted();
          if (res && qq.audio && !qq.video && !av.paused) av.pause();
        }
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  /** gắn audio/video: phát từ đầu câu, vào muộn thì tua theo thời gian đã trôi */
  const startAv = (el: HTMLAudioElement | HTMLVideoElement) => {
    avRef.current = el;
    const qq = qRef.current;
    if (!qq) return;
    el.muted = sfx.isMuted();
    const sync = () => {
      const t = (net.now() - qq.startAt) / 1000;
      if (t > 0.6 && (!Number.isFinite(el.duration) || t < el.duration)) {
        try {
          el.currentTime = t;
        } catch {
          /* chưa tua được */
        }
      }
    };
    if (el.readyState >= 1) sync();
    else el.addEventListener('loadedmetadata', sync, { once: true });
    el.play().catch(() => setNeedPlay(true));
  };

  const manualPlay = () => {
    const el = avRef.current;
    if (!el) return;
    el.muted = sfx.isMuted();
    el.play()
      .then(() => setNeedPlay(false))
      .catch(() => {});
  };

  const doSubmit = () => {
    if (submit(text)) inputRef.current?.blur();
  };

  /* ---------- bảng xếp hạng sau câu: thứ tự mới / cũ ---------- */
  const board = useMemo(() => {
    if (!result) return null;
    const ptsOf = new Map(result.rows.map((r) => [r.id, r]));
    const list = playersRef.current.filter((p) => !p.spectator || result.scores[p.id] !== undefined);
    const entries = list.map((p, idx) => {
      const total = result.scores[p.id] ?? 0;
      const row = ptsOf.get(p.id);
      const gain = row?.pts ?? 0;
      return { p, idx, total, prev: Math.max(0, total - gain), row };
    });
    const byNew = [...entries].sort((a, b) => b.total - a.total || a.idx - b.idx);
    const byOld = [...entries].sort((a, b) => b.prev - a.prev || a.idx - b.idx);
    const oldIndex = new Map(byOld.map((e, k) => [e.p.id, k]));
    return { byNew, oldIndex };
  }, [result?.i]);

  // FLIP: các hàng bắt đầu ở vị trí xếp hạng cũ rồi trượt về vị trí mới
  useLayoutEffect(() => {
    if (!result || !board) return;
    const els = board.byNew.map((e) => rowRefs.current.get(e.p.id));
    if (els.some((e) => !e)) return;
    const slots = els.map((e) => e!.getBoundingClientRect());
    els.forEach((el, n) => {
      const o = board.oldIndex.get(board.byNew[n].p.id) ?? n;
      if (!el || o === n || !slots[o]) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${slots[o].left - slots[n].left}px, ${slots[o].top - slots[n].top}px)`;
    });
    const t = window.setTimeout(() => {
      els.forEach((el) => {
        if (!el) return;
        el.style.transition = 'transform 0.95s cubic-bezier(0.22, 0.9, 0.25, 1)';
        el.style.transform = '';
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [result?.i, board]);

  if (!q && !result) {
    return (
      <div className="qz qz-q">
        <div className="qz-wait">Đang chờ câu hỏi…</div>
      </div>
    );
  }

  /* ======================= PHA XẾP HẠNG ======================= */
  if (result && board) {
    const total = q?.total ?? 0;
    const isLast = total > 0 && result.i + 1 >= total;
    const mine = result.rows.find((r) => r.id === meId);
    const accSet = result.accepted?.slice(1) ?? [];
    const dense = board.byNew.length > 8;
    return (
      <div className="qz qz-r">
        <div className="qz-topbar">
          <span className="qz-game">QUIZ ĐOÁN NHANH</span>
          <span className="qz-no">{total > 0 ? `Câu ${result.i + 1}/${total}` : `Câu ${result.i + 1}`}</span>
        </div>
        <div className="qz-ans">
          <small>Đáp án</small>
          <b>{result.answer}</b>
          {accSet.length > 0 && <em>cũng nhận: {accSet.join(' · ')}</em>}
          {mine ? (
            <span className={`qz-verdict ${mine.ok ? 'ok' : 'bad'}`}>{mine.ok ? `Đúng rồi! +${mine.pts}` : 'Sai rồi'}</span>
          ) : (
            <span className="qz-verdict none">Bạn chưa trả lời</span>
          )}
        </div>
        <ol
          className={`qz-rank ${dense ? 'dense' : ''} ${board.byNew.length > 12 ? 'cols2' : ''}`}
          style={{ ['--rows' as string]: Math.ceil(board.byNew.length / 2) }}
        >
          {board.byNew.map((e, n) => {
            const r = e.row;
            const label = r ? (r.ok ? `+${r.pts}` : 'Sai') : 'Không trả lời';
            const cls = r ? (r.ok ? 'ok' : 'bad') : 'none';
            return (
              <li
                key={e.p.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(e.p.id, el);
                  else rowRefs.current.delete(e.p.id);
                }}
                className={e.p.id === meId ? 'me' : ''}
              >
                <span className="rk">{n < 3 ? MEDALS[n] : n + 1}</span>
                <Portrait p={e.p} size={44} />
                <span className="nm">{e.p.name}</span>
                <span className={`gain ${cls}`}>{label}</span>
                <b className="tt">
                  <Count from={e.prev} to={e.total} delay={700} />
                </b>
              </li>
            );
          })}
        </ol>
        <div className="qz-next">
          <span ref={nextRef} />
          {isLast && <em> · ván kết thúc, chuẩn bị tổng kết</em>}
        </div>
      </div>
    );
  }

  /* ======================= PHA CÂU HỎI ======================= */
  const over = q ? net.now() >= q.endAt : false;
  const locked = sent || over || !live;
  const audioOnly = !!q?.audio && !q.image && !q.video;
  const hasMedia = !!q && !!(q.image || q.video || q.audio);
  const crew = players.filter((p) => !p.spectator);
  const status = ack !== null || sent ? 'Đã chốt!' : over ? 'Hết giờ' : 'Gõ đáp án rồi nhấn Enter';

  return (
    <div className="qz qz-q">
      <div className="qz-topbar">
        <span className="qz-game">QUIZ ĐOÁN NHANH</span>
        <span className="qz-clock" ref={clockRef} />
        <span className="qz-no">{q ? `Câu ${q.i + 1}/${q.total}` : ''}</span>
      </div>

      <div className={`qz-main ${hasMedia ? 'has-media' : ''}`}>
        <div className="qz-left">
          {q && <h2 className="qz-text">{q.text}</h2>}
          <form
            className={`qz-pill ${sent ? 'sent' : ''}`}
            onSubmit={(e) => {
              e.preventDefault();
              doSubmit();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              disabled={locked}
              maxLength={80}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={sent ? (ack ?? 'Đã chốt') : 'Nhập đáp án…'}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="qz-ok" disabled={locked || !text.trim()} aria-label="Chốt đáp án">
              ✓
            </button>
          </form>
          <div className={`qz-status ${sent ? 'done' : ''}`}>{status}</div>
          <div className="qz-pts" aria-label="Điểm có thể nhận ngay lúc này">
            <div className="qz-ptrack">
              <div className="qz-pfill" ref={barRef} />
            </div>
            <b ref={ptsRef}>1000</b>
          </div>
        </div>

        {hasMedia && q && (
          <div className={`qz-frame ${audioOnly ? 'audio' : ''}`}>
            {q.image && !mediaErr && (
              <img
                key={`i${q.i}`}
                ref={(el) => {
                  if (el) mediaRef.current = el;
                }}
                src={q.image}
                alt=""
                draggable={false}
                onError={() => setMediaErr('Không tải được ảnh')}
              />
            )}
            {q.video && !mediaErr && (
              <video
                key={`v${q.i}`}
                ref={(el) => {
                  if (el && avRef.current !== el) {
                    mediaRef.current = el;
                    startAv(el);
                  }
                }}
                src={q.video}
                playsInline
                autoPlay
                loop
                preload="auto"
                onError={() => setMediaErr('Không tải được video')}
              />
            )}
            {(q.image || q.video) && !mediaErr && <div className="qz-fog" ref={fogRef} />}
            {q.audio && !q.video && (
              <>
                <audio
                  key={`a${q.i}`}
                  ref={(el) => {
                    if (el && avRef.current !== el) startAv(el);
                  }}
                  src={q.audio}
                  autoPlay
                  preload="auto"
                  onError={() => setMediaErr((m) => m ?? 'Không tải được âm thanh')}
                />
                {audioOnly && !mediaErr && (
                  <div className="qz-eq" aria-hidden="true">
                    {Array.from({ length: 16 }, (_, k) => (
                      <i
                        key={k}
                        style={{ animationDelay: `${(k * 0.13) % 0.9}s`, animationDuration: `${0.6 + ((k * 7) % 5) * 0.12}s` }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            {mediaErr && <div className="qz-err">⚠️ {mediaErr}</div>}
            {needPlay && !mediaErr && (
              <button type="button" className="qz-play" onClick={manualPlay}>
                ▶ Bấm để phát
              </button>
            )}
          </div>
        )}
      </div>

      <div className="qz-crew">
        {crew.map((p) => {
          const done = prog.ids.includes(p.id) || (p.id === meId && sent);
          return (
            <div key={p.id} className={`qz-pl ${p.id === meId ? 'me' : ''} ${done ? 'done' : ''}`}>
              <span className="n">{p.name}</span>
              <span className="av">
                <Portrait p={p} size={46} />
                {done && <i className="tick">✓</i>}
              </span>
              <b>{scores[p.id] ?? 0}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}
