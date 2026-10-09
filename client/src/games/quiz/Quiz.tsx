import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import type { QuizGameState } from './useQuizGame';

interface Props {
  game: QuizGameState;
  players: PlayerState[];
  meId: string;
  live: boolean;
}

const fmtMs = (ms: number) => (ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : '—');

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

export default function Quiz({ game, players, meId, live }: Props) {
  const { q, prog, ack, sent, result, scores, submit } = game;
  const [text, setText] = useState('');
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [needPlay, setNeedPlay] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const mediaRef = useRef<HTMLElement | null>(null);
  const fogRef = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qRef = useRef(q);
  const resRef = useRef(result);
  qRef.current = q;
  resRef.current = result;

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '???';

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

  // một vòng rAF: thanh đếm ngược, độ rõ của media, tắt tiếng; không re-render React mỗi khung hình
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const qq = qRef.current;
      const res = resRef.current;
      const now = net.now();
      if (qq) {
        const total = Math.max(1, qq.endAt - qq.startAt);
        const p = res ? 1 : (now - qq.startAt) / total;
        if (barRef.current) {
          barRef.current.style.transform = `scaleX(${res ? 0 : Math.max(0, Math.min(1, 1 - p))})`;
          barRef.current.classList.toggle('low', !res && p > 0.8);
        }
        if (clockRef.current) {
          clockRef.current.textContent = res
            ? `Câu kế sau ${Math.max(0, Math.ceil((res.nextAt - now) / 1000))}s`
            : now >= qq.endAt
              ? 'Hết giờ…'
              : `${Math.max(0, Math.ceil((qq.endAt - now) / 1000))}s`;
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
      } else if (clockRef.current && res) {
        clockRef.current.textContent = `Câu kế sau ${Math.max(0, Math.ceil((res.nextAt - now) / 1000))}s`;
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

  if (!q && !result) {
    return (
      <div className="qz">
        <div className="qz-wait">Đang chờ câu hỏi…</div>
      </div>
    );
  }

  const over = !!result || (q ? net.now() >= q.endAt : false);
  const locked = sent || over || !live;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const accSet = result?.accepted?.slice(1) ?? [];
  const audioOnly = !!q?.audio && !q.image && !q.video;

  return (
    <div className="qz">
      <div className="qz-head">
        <span className="qz-no">{q ? `CÂU ${q.i + 1}/${q.total}` : 'KẾT QUẢ'}</span>
        <span className="qz-clock" ref={clockRef} />
      </div>
      <div className="qz-bar">
        <div className="qz-bar-fill" ref={barRef} />
      </div>

      {q && <h2 className="qz-text">{q.text}</h2>}

      {q && (q.image || q.video || q.audio) && (
        <div className={`qz-media ${audioOnly ? 'audio' : ''}`}>
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
                <div className={`qz-eq ${result ? 'off' : ''}`} aria-hidden="true">
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
          {needPlay && !result && !mediaErr && (
            <button type="button" className="qz-play" onClick={manualPlay}>
              ▶ Bấm để phát
            </button>
          )}
        </div>
      )}

      {result ? (
        <div className="qz-res">
          <div className="qz-answer">
            <small>ĐÁP ÁN</small>
            <b>{result.answer}</b>
            {accSet.length > 0 && <em>cũng nhận: {accSet.join(' · ')}</em>}
          </div>
          <ul className="qz-rows">
            {result.rows.length === 0 && <li className="qz-none">Không ai chốt kịp</li>}
            {[...result.rows]
              .sort((a, b) => b.pts - a.pts || a.ms - b.ms)
              .map((r) => (
                <li key={r.id} className={`${r.ok ? 'ok' : 'bad'} ${r.id === meId ? 'me' : ''}`}>
                  <span className="mk">{r.ok ? '✓' : '✗'}</span>
                  <span className="nm">{nameOf(r.id)}</span>
                  <span className="tx">{r.text}</span>
                  <span className="ms">{fmtMs(r.ms)}</span>
                  <span className="pt">{r.pts > 0 ? `+${r.pts}` : '0'}</span>
                </li>
              ))}
          </ul>
          {ranked.length > 0 && (
            <div className="qz-score">
              {ranked.map(([id, s], k) => (
                <span key={id} className={id === meId ? 'me' : ''}>
                  {k + 1}. {nameOf(id)} <b>{s}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <form
            className="qz-form"
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
              placeholder={sent ? 'Đã chốt' : 'Nhập đáp án…'}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={locked || !text.trim()}>
              CHỐT
            </button>
          </form>
          <div className="qz-sub">
            {ack !== null ? (
              <span className="qz-acked">
                ✔ Đã chốt: <b>{ack}</b>
              </span>
            ) : sent ? (
              <span className="qz-acked">Đang gửi…</span>
            ) : q && q.len > 0 ? (
              <span>Đáp án có {q.len} ký tự</span>
            ) : null}
          </div>
          <div className="qz-players">
            {players
              .filter((p) => !p.spectator)
              .map((p) => (
                <span key={p.id} className={`${prog.ids.includes(p.id) ? 'done' : ''} ${p.id === meId ? 'me' : ''}`}>
                  {prog.ids.includes(p.id) ? '✓ ' : ''}
                  {p.name}
                </span>
              ))}
          </div>
        </>
      )}

      <p className="hint">
        Nhập đáp án rồi bấm CHỐT — đúng và nhanh thì nhiều điểm; phải gõ đúng hoàn toàn (không phân biệt hoa/thường)
      </p>
    </div>
  );
}
