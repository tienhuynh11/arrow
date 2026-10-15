import { memo, useLayoutEffect, useRef } from 'react';
import type { ArtStroke } from '@shared/artshow';
import { ART_H, ART_W } from '@shared/artshow';
import { paintAll } from './render';

/** Một tranh (danh sách nét) vẽ lên canvas có bộ đệm cố định `px` điểm ngang — dùng cho lưới thu nhỏ và xem phóng to. */
function ArtView({ strokes, px = 320, className }: { strokes: ArtStroke[] | undefined; px?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = px;
    cv.height = Math.round((px * ART_H) / ART_W);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(px / ART_W, 0, 0, px / ART_W, 0, 0);
    paintAll(g, strokes ?? []);
  }, [strokes, px]);
  return <canvas ref={ref} className={className ?? 'as-art'} />;
}

export default memo(ArtView);
