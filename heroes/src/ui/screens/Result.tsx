// Màn kết quả: sao, thưởng, lên cấp.
import { useEffect, useRef } from 'preact/hooks';
import type { BattleRes } from '@shared/heroes/api';
import { nextStage, stageOf } from '@shared/heroes/stages';
import { sfx } from '../../audio';
import { GEAR_CAP } from '@shared/heroes/gear';
import { me } from '../../api';
import { fmt, go, returnTo } from '../../state';
import { Btn } from '../common';
import { useResultFx } from '../result-fx';
import { GearDrops } from '../gear';
import { Icon } from '../icons';

export function Result({ stage, res }: { stage: string; res: BattleRes }) {
  const def = stageOf(stage);
  const next = nextStage(stage);
  const rootRef = useRef<HTMLDivElement>(null);
  useResultFx(rootRef, res.win);
  useEffect(() => {
    sfx(res.win ? 'win' : 'lose');
    if (res.levelUp) setTimeout(() => sfx('level'), 900);
  }, []);
  return (
    <div class={`result ${res.win ? 'win' : 'lose'}`} ref={rootRef}>
      <div class="result-card">
        <h1 class="res-title">{res.win ? 'CHIẾN THẮNG!' : 'THẤT BẠI'}</h1>
        <small class="muted">{def?.name}</small>
        <div class="res-stars">
          {[1, 2, 3].map((i) => (
            <span key={i} class={`res-star${i <= res.stars ? ' got' : ''}`} style={{ animationDelay: `${0.25 + i * 0.3}s` }}>
              <Icon n={i <= res.stars ? 'star' : 'starEmpty'} size={64} />
            </span>
          ))}
        </div>
        {res.win ? (
          <div class="reward-row">
            <div class="reward big"><Icon n="gold" size={30} /><b>+{fmt(res.reward.gold)}</b></div>
            <div class="reward big"><Icon n="exp" size={30} /><b>+{fmt(res.reward.exp)}</b></div>
            <div class="reward big"><Icon n="user" size={30} /><b>+{fmt(res.reward.xp)} XP</b></div>
            {res.reward.gems > 0 && (
              <div class="reward big first"><Icon n="gem" size={30} /><b>+{res.reward.gems}</b>{res.reward.firstClear && <small>Lần đầu</small>}</div>
            )}
          </div>
        ) : (
          <p class="muted tips">Gợi ý: nâng cấp tướng, đổi hàng trước/sau, hoặc bật Auto để dùng tuyệt kỹ đúng lúc.</p>
        )}
        {res.win && <GearDrops ids={res.drops ?? []} full={(me.value?.gear.length ?? 0) >= GEAR_CAP} />}
        {res.levelUp && (
          <div class="levelup">
            <Icon n="sparkle" size={22} /> Cấp tài khoản tăng!
          </div>
        )}
        <div class="res-btns">
          {res.win && next ? (
            <Btn kind="primary" big class="res-main" onClick={() => go({ n: 'campaign', stage: next.id })}>
              Ải kế tiếp <Icon n="battle" size={24} />
            </Btn>
          ) : (
            <Btn kind="primary" big class="res-main" onClick={() => go({ n: 'battle', stage })}>
              Chơi lại
            </Btn>
          )}
          {res.win && next && <Btn kind="blue" onClick={() => go({ n: 'battle', stage })}>Chơi lại</Btn>}
          <Btn kind="green" onClick={() => { returnTo.value = stage; go({ n: 'squad' }); }}>Đội hình</Btn>
          {!res.win && <Btn kind="purple" onClick={() => go({ n: 'heroes' })}>Nâng cấp tướng</Btn>}
          <Btn kind="ghost" onClick={() => go({ n: 'campaign' })}>Về bản đồ</Btn>
        </div>
      </div>
    </div>
  );
}
