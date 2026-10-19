// Kết quả một trận Đấu trường: thắng/thua (theo kết quả của server), điểm đổi (số chạy), thưởng, nút đi tiếp.
import { useEffect, useState } from 'preact/hooks';
import type { ArenaBattleRes } from '@shared/heroes/api';
import { sfx } from '../../audio';
import { api, me } from '../../api';
import { arenaOf } from '../../game';
import { fmt, go, returnTo } from '../../state';
import { Btn } from '../common';
import { Icon } from '../icons';
import { MiniRow } from './Arena';

/** số chạy từ 0 tới `to` trong ~0,9 giây */
function useCount(to: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [to]);
  return v;
}

export function ArenaResult({ res }: { res: ArenaBattleRes }) {
  const [rank, setRank] = useState(0);
  useEffect(() => {
    sfx(res.win ? 'win' : 'lose');
    let off = false;
    api.arena().then((r) => !off && setRank(r.rank)).catch(() => {}); // chỉ để hiện hạng mới, lỗi thì bỏ qua
    return () => void (off = true);
  }, []);
  const d = res.ratingDelta;
  const shown = useCount(d);
  const m = me.value;
  const a = m ? arenaOf(m) : null;
  const tries = a?.tries ?? 0;
  const r = res.reward;
  return (
    <div class={`result ar-result ${res.win ? 'win' : 'lose'}`}>
      <div class="result-card">
        <h1 class="res-title">{res.win ? 'CHIẾN THẮNG!' : 'THẤT BẠI'}</h1>
        <small class="muted ar-vs">
          Đấu trường · vs <b>{res.opponent.name}</b>
          {res.opponent.bot ? ' (BOT)' : ''}
        </small>
        <MiniRow heroes={res.opponent.heroes} size="md" />
        <div class={`ar-delta ${d >= 0 ? 'up' : 'down'}`} aria-label={`Điểm ${d >= 0 ? 'cộng' : 'trừ'} ${Math.abs(d)}`}>
          <span class="ar-tri">{d >= 0 ? '▲' : '▼'}</span>
          <b>
            {d >= 0 ? '+' : '−'}
            {Math.abs(shown)}
          </b>
        </div>
        <div class="ar-newrt">
          <Icon n="crown" size={22} /> Điểm mới <b>{res.rating}</b>
          {rank > 0 && (
            <span>
              {' '}
              · Hạng <b>#{rank}</b>
            </span>
          )}
        </div>
        <div class="reward-row">
          <div class="reward big">
            <Icon n="gold" size={30} />
            <b>+{fmt(r.gold)}</b>
          </div>
          {r.gems > 0 && (
            <div class="reward big first">
              <Icon n="gem" size={30} />
              <b>+{r.gems}</b>
            </div>
          )}
        </div>
        <small class="muted">Lượt còn lại hôm nay: {tries}</small>
        <div class="res-btns">
          {tries > 0 && (
            <Btn kind="primary" big class="res-main" onClick={() => go({ n: 'arena' })}>
              Đánh tiếp <Icon n="battle" size={24} />
            </Btn>
          )}
          <Btn kind="green" onClick={() => { returnTo.value = 'arena'; go({ n: 'squad' }); }}>
            Đội hình
          </Btn>
          <Btn kind={tries > 0 ? 'ghost' : 'primary'} onClick={() => go({ n: 'arena' })}>
            Về đấu trường
          </Btn>
        </div>
      </div>
    </div>
  );
}
