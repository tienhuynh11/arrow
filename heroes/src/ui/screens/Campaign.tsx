// Chiến dịch: 3 chương, mỗi chương chuỗi 10 ải, sao, khoá, quét nhanh.
import { useEffect, useState } from 'preact/hooks';
import { CHAPTERS, STAGES, STAGES_PER_CHAPTER } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { nextStageOf, stageUnlocked, starsOfStage } from '../../game';
import { toast, useMedia } from '../../state';
import { useDesktopLand } from '../common';
import { Icon } from '../icons';
import { PreBattle } from './PreBattle';

export function Campaign({ initial }: { initial?: string }) {
  const m = me.value!;
  const next = nextStageOf(m);
  const startStage = STAGES.find((s) => s.id === initial);
  const [chapter, setChapter] = useState((startStage ?? next).chapter);
  const [open, setOpen] = useState<string | null>(startStage ? startStage.id : null);
  const vertical = useMedia('(max-aspect-ratio: 1/1)');
  // PC ngang: bảng ải đang chọn luôn nằm bên phải bản đồ (không cần hộp thoại)
  const side = useDesktopLand();

  // làm mới thể lực khi vào màn
  useEffect(() => {
    void api.refresh().catch(() => {});
  }, []);

  const stages = STAGES.filter((s) => s.chapter === chapter);
  // bản đồ rắn (zigzag) co theo khung, KHÔNG cuộn: dọc 3 cột x 4 hàng, ngang 5 cột x 2 hàng
  const cols = vertical ? 3 : 5;
  const rows = Math.ceil(stages.length / cols);
  const xy = (i: number): [number, number] => {
    const r = Math.floor(i / cols);
    const c = r % 2 ? cols - 1 - (i % cols) : i % cols;
    return [((c + 0.5) / cols) * 100, ((r + 0.5) / rows) * 100];
  };
  const pos = (i: number) => {
    const [x, y] = xy(i);
    return { left: `${x}%`, top: `${y}%` };
  };
  const pts = stages.map((_, i) => xy(i).join(',')).join(' ');
  const cur = STAGES.find((s) => s.id === (side ? (open ?? (next.chapter === chapter ? next.id : stages[0].id)) : open)) ?? null;

  return (
    <div class={`campaign${side ? ' dk-side' : ''}`}>
      <div class="chapter-tabs">
        {CHAPTERS.map((c, i) => {
          const first = STAGES[i * STAGES_PER_CHAPTER];
          const locked = !stageUnlocked(m, first);
          return (
            <button type="button" key={c.name} class={`fchip wide chap${chapter === i + 1 ? ' on' : ''}${locked ? ' locked' : ''}`} onClick={() => setChapter(i + 1)}>
              {locked && <Icon n="lock" size={14} />}
              <span>Chương {i + 1}</span>
              <small>{c.name}</small>
            </button>
          );
        })}
      </div>
      <div class={`map el-${CHAPTERS[chapter - 1].element}`}>
        <div class="map-inner">
          <svg class="map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts} fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".55" />
            <polyline points={pts} fill="none" stroke="#1e2a4a" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".55" />
          </svg>
          {stages.map((s, i) => {
            const stars = starsOfStage(m, s.id);
            const unlocked = stageUnlocked(m, s);
            const isNext = unlocked && stars === 0;
            return (
              <button
                type="button"
                key={s.id}
                class={`node${s.boss ? ' boss' : ''}${unlocked ? '' : ' locked'}${stars > 0 ? ' cleared' : ''}${isNext ? ' current' : ''}${side && cur?.id === s.id ? ' picked' : ''}`}
                style={pos(i)}
                onClick={() => (unlocked ? setOpen(s.id) : toast('Hãy qua ải trước đó để mở khoá', 'info'))}
                aria-label={`${s.name}${unlocked ? '' : ' (khoá)'}`}
                data-tut={isNext ? 'stage-next' : undefined}
              >
                <span class="node-c">
                  {unlocked ? (s.boss ? <Icon n="crown" size={26} /> : <b>{s.n}</b>) : <Icon n="lock" size={22} />}
                </span>
                {unlocked && (
                  <span class="node-stars">
                    {[1, 2, 3].map((k) => <Icon key={k} n={k <= stars ? 'star' : 'starEmpty'} size={13} />)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {cur && <PreBattle key={side ? cur.id : undefined} stage={cur} inline={side} onClose={() => setOpen(null)} />}
    </div>
  );
}
