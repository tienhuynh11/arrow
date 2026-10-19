// Kết quả một trận Đấu trường: thắng/thua (theo kết quả của server), điểm đổi (số chạy), thưởng, nút đi tiếp.
import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ArenaBattleRes } from '@shared/heroes/api';
import { sfx } from '../../audio';
import { api, me } from '../../api';
import { arenaOf } from '../../game';
import { fmt, go, returnTo } from '../../state';
import { Btn } from '../common';
import { Icon } from '../icons';
import { useResultFx } from '../result-fx';
import { MiniRow } from './Arena';
import { squadPower } from '../../game';
import { DefeatTips, getLastBattle } from '../result-kit';

/** số chạy từ 0 tới `to` trong ~0,9 giây (GSAP tween, huỷ khi rời màn) */
function useCount(to: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const o = { v: 0 };
    const tw = gsap.to(o, {
      v: to, duration: 0.9, delay: 0.3, ease: 'power3.out',
      onUpdate: () => {
        const n = Math.round(o.v);
        setV((p) => (p === n ? p : n));
      },
    });
    return () => void tw.kill();
  }, [to]);
  return v;
}

export function ArenaResult({ res }: { res: ArenaBattleRes }) {
  const [rank, setRank] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useResultFx(rootRef, res.win);
  useEffect(() => {
    if (!getLastBattle()?.fanfare) sfx(res.win ? 'win' : 'lose'); // nhạc hiệu đã phát ở banner trong trận
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
    <div class={`result ar-result ${res.win ? 'win' : 'lose'}`} ref={rootRef}>
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
        {!res.win && m && (
          <DefeatTips mine={squadPower(m, m.squads[m.activeSquad] ?? [])} enemy={res.opponent.power} squadLen={(m.squads[m.activeSquad] ?? []).filter(Boolean).length} />
        )}
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
