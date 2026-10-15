import { useEffect, useState } from 'react';
import ArtView from './ArtView';
import type { ArtShowState } from './useArtShowGame';

/** Màn bình chọn: lưới tranh ẩn danh (gọn cho 16 người), chạm để phóng to rồi bấm ❤️ / 🤣 / 💩. */
export default function Vote({ game }: { game: ArtShowState }) {
  const { ph, pics, mine, my } = game;
  const n = ph?.n ?? Object.keys(pics).length;
  const ks = Array.from({ length: n }, (_, i) => i);
  const [zoom, setZoom] = useState(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.code === 'Escape' && setZoom(-1);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;

  const doVote = (k: number, c: 'm' | 'h' | 't') => {
    const on = c === 'm' ? my.m === k : my.c === c && my.k === k;
    game.vote(on ? -1 : k, c);
    if (!on) setZoom(-1);
  };

  return (
    <div className="as-vote">
      <div className="as-vote-help">
        Chạm vào tranh để phóng to rồi chọn · <b>❤️ 1 phiếu chính</b> · <b>🤣 hài nhất</b> hoặc <b>💩 thảm họa</b> (1 phiếu phụ). Không bầu được tranh của mình.
      </div>
      <div className="as-grid" style={{ ['--cols' as string]: cols }}>
        {ks.map((k) => (
          <button key={k} type="button" className={`as-tile ${k === mine ? 'mine' : ''} ${my.m === k ? 'picked' : ''}`} onClick={() => setZoom(k)}>
            <ArtView strokes={pics[k]} />
            <span className="as-num">#{k + 1}</span>
            {k === mine && <span className="as-badge mine">CỦA BẠN</span>}
            <span className="as-marks">
              {my.m === k && '❤️'}
              {my.c === 'h' && my.k === k && '🤣'}
              {my.c === 't' && my.k === k && '💩'}
            </span>
          </button>
        ))}
      </div>
      {zoom >= 0 && (
        <div className="as-zoom" onClick={() => setZoom(-1)}>
          <div className="as-zoom-card" onClick={(e) => e.stopPropagation()}>
            <div className="as-zoom-art">
              <ArtView strokes={pics[zoom]} px={960} className="as-art big" />
            </div>
            {zoom === mine ? (
              <div className="as-self">🎨 Đây là tranh của bạn - không thể tự bình chọn</div>
            ) : (
              <div className="as-zoom-btns">
                <button type="button" className={`as-vb m ${my.m === zoom ? 'on' : ''}`} onClick={() => doVote(zoom, 'm')}>
                  ❤️ Thích nhất
                </button>
                <button type="button" className={`as-vb h ${my.c === 'h' && my.k === zoom ? 'on' : ''}`} onClick={() => doVote(zoom, 'h')}>
                  🤣 Hài nhất
                </button>
                <button type="button" className={`as-vb t ${my.c === 't' && my.k === zoom ? 'on' : ''}`} onClick={() => doVote(zoom, 't')}>
                  💩 Thảm họa
                </button>
              </div>
            )}
            <button type="button" className="as-close" onClick={() => setZoom(-1)}>
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
