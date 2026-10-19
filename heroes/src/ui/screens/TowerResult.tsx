// Kết quả một trận Tháp: thắng/thua, tầng vừa đánh, thưởng, trang bị rớt, nút đi tiếp.
import { useEffect, useRef } from 'preact/hooks';
import type { TowerBattleRes } from '@shared/heroes/api';
import { GEAR_CAP } from '@shared/heroes/gear';
import { TOWER_MAX_FLOOR } from '@shared/heroes/tower';
import { sfx } from '../../audio';
import { me } from '../../api';
import { towerOf } from '../../game';
import { fmt, go, returnTo } from '../../state';
import { powerOf } from '@shared/heroes/formulas';
import { towerStage } from '@shared/heroes/tower';
import { stageSetup } from '@shared/heroes/stages';
import { squadPower } from '../../game';
import { DefeatTips, getLastBattle } from '../result-kit';
import { Btn } from '../common';
import { useResultFx } from '../result-fx';
import { GearDrops } from '../gear';
import { Icon } from '../icons';

export function TowerResult({ res }: { res: TowerBattleRes }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useResultFx(rootRef, res.win);
  useEffect(() => {
    if (!getLastBattle()?.fanfare) sfx(res.win ? 'win' : 'lose'); // nhạc hiệu đã phát ở banner trong trận
    if (res.levelUp) setTimeout(() => sfx('level'), 900);
  }, []);
  const m = me.value;
  const t = m ? towerOf(m) : { floor: res.win ? res.floor : res.floor - 1, tries: 0 };
  const r = res.reward;
  const canNext = t.tries > 0 && t.floor < TOWER_MAX_FLOOR;
  return (
    <div class={`result ${res.win ? 'win' : 'lose'}`} ref={rootRef}>
      <div class="result-card">
        <h1 class="res-title">{res.win ? 'CHIẾN THẮNG!' : 'THẤT BẠI'}</h1>
        <small class="muted">Tháp · Tầng {res.floor}{res.win && res.floor % 10 === 0 ? ' (Boss)' : ''}</small>
        {res.win ? (
          <>
            <div class="reward-row">
              <div class="reward big"><Icon n="gold" size={30} /><b>+{fmt(r.gold)}</b></div>
              <div class="reward big"><Icon n="exp" size={30} /><b>+{fmt(r.exp)}</b></div>
              <div class="reward big"><Icon n="user" size={30} /><b>+{fmt(r.xp)} XP</b></div>
              {r.gems > 0 && <div class="reward big first"><Icon n="gem" size={30} /><b>+{r.gems}</b></div>}
              {r.stones > 0 && <div class="reward big first"><Icon n="stone" size={30} /><b>+{r.stones}</b></div>}
            </div>
            <GearDrops ids={res.drops ?? []} full={(m?.gear.length ?? 0) >= GEAR_CAP} />
          </>
        ) : (
          <DefeatTips
            mine={m ? squadPower(m, m.squads[m.activeSquad] ?? []) : 0}
            enemy={Math.max(...stageSetup(towerStage(res.floor), [], 0).waves.map((w) => w.reduce((x, u) => x + powerOf(u.stats), 0)))}
            squadLen={(m?.squads[m.activeSquad] ?? []).filter(Boolean).length}
          />
        )}
        {res.levelUp && (
          <div class="levelup">
            <Icon n="sparkle" size={22} /> Cấp tài khoản tăng!
          </div>
        )}
        <small class="muted">
          {t.floor >= TOWER_MAX_FLOOR ? 'Bạn đã chinh phục toàn bộ tháp!' : `Lượt còn lại hôm nay: ${t.tries}`}
        </small>
        <div class="res-btns">
          {canNext && (
            <Btn kind="primary" big class="res-main" onClick={() => go({ n: 'battle', stage: 'tower' })}>
              {res.win ? 'Tầng kế tiếp' : 'Thử lại'} <Icon n="battle" size={24} />
            </Btn>
          )}
          <Btn kind="green" onClick={() => { returnTo.value = 'tower'; go({ n: 'squad' }); }}>Đội hình</Btn>
          <Btn kind={canNext ? 'ghost' : 'primary'} onClick={() => go({ n: 'tower' })}>Về tháp</Btn>
        </div>
      </div>
    </div>
  );
}
