// Nhiệm vụ hằng ngày: 6 nhiệm vụ + rương thưởng thêm khi nhận hết. Nhận thưởng "lạc quan" (số đổi ngay).
import { QUEST_BONUS, QUEST_DEFS } from '@shared/heroes/quests';
import { api, me } from '../../api';
import { sfx } from '../../audio';
import { bonusState, questList } from '../../game';
import { errToast, fmt } from '../../state';
import { Btn } from '../common';
import { Icon } from '../icons';
import { ActHead, ResetChip, useDayReset, WalletChips } from './activity';

function ClaimBtn({ state, onClaim }: { state: 'claimed' | 'ready' | 'locked'; onClaim: () => void }) {
  if (state === 'claimed') {
    return (
      <Btn kind="ghost" small class="qs-btn" disabled>
        <Icon n="check" size={18} /> Đã nhận
      </Btn>
    );
  }
  if (state === 'ready') {
    return (
      <Btn kind="green" small class="qs-btn" onClick={onClaim}>
        Nhận
      </Btn>
    );
  }
  return (
    <Btn kind="ghost" small class="qs-btn" disabled>
      <Icon n="lock" size={16} /> Chưa xong
    </Btn>
  );
}

export function Quests() {
  const m = me.value!;
  const left = useDayReset();
  const list = questList(m);
  const bonus = bonusState(m);
  const doneN = list.filter((q) => q.claimed).length;
  const claim = (id: string) => {
    sfx('claim');
    void api.questClaim(id).catch(errToast);
  };

  return (
    <div class="quests">
      <ActHead title="Nhiệm vụ" icon="quest">
        <span class="ah-pill" title="Đã nhận / tổng">
          <Icon n="check" size={16} /> {doneN}/{QUEST_DEFS.length}
        </span>
        <ResetChip left={left} />
      </ActHead>

      <div class="fade-wrap qs-wrap">
        <div class="qs-list scroll">
          {QUEST_DEFS.map((d, i) => {
            const q = list[i];
            const pr = Math.min(d.target, q.progress);
            return (
              <div key={d.id} class={`qs-row${q.claimed ? ' done' : q.claimable ? ' ready' : ''}`}>
                <div class="qs-info">
                  <div class="qs-top">
                    <b class="qs-name">{d.name}</b>
                    <span class="qs-rew"><WalletChips w={d.reward} /></span>
                  </div>
                  <small class="qs-desc">{d.desc}</small>
                  <div class="qs-bar" aria-label={`Tiến trình ${pr}/${d.target}`}>
                    <i style={{ width: `${(pr * 100) / d.target}%` }} />
                    <span>{fmt(pr)}/{fmt(d.target)}</span>
                  </div>
                </div>
                <ClaimBtn state={q.claimed ? 'claimed' : q.claimable ? 'ready' : 'locked'} onClaim={() => claim(d.id)} />
              </div>
            );
          })}
        </div>
      </div>

      <div class={`qs-bonus panel${bonus.claimable ? ' ready' : ''}`}>
        <Icon n="chest" size={36} />
        <div class="qs-info">
          <b class="qs-name">Rương hoàn thành</b>
          <small class="qs-desc">Nhận hết trong ngày</small>
          <span class="qs-rew"><WalletChips w={QUEST_BONUS} /></span>
        </div>
        <ClaimBtn state={bonus.claimed ? 'claimed' : bonus.claimable ? 'ready' : 'locked'} onClaim={() => claim('bonus')} />
      </div>
    </div>
  );
}
