// Kết quả một lượt đánh boss bang: sát thương (đếm lên), thanh máu boss tụt dần, thưởng, biểu ngữ hạ boss.
// Sát thương do SERVER tính (`res.damage`) là chuẩn; trận chạy ở máy chỉ để xem hình.
import { useEffect, useState } from 'preact/hooks';
import type { GuildBossRes } from '@shared/heroes/api';
import { BOSS_KILL_REWARD } from '@shared/heroes/guild';
import { sfx } from '../../audio';
import { fmt, go, returnTo } from '../../state';
import { Btn, Portrait } from '../common';
import { Icon } from '../icons';
import { BossHp } from './Guild';
import { WalletChips } from './activity';
import { getLastBattle } from '../result-kit';

export function GuildBossResult({ res }: { res: GuildBossRes }) {
  const after = res.boss.hp;
  const before = after + res.damage;
  const [hp, setHp] = useState(before); // máu hiển thị: tụt từ trước trận xuống sau trận
  const [dmg, setDmg] = useState(0);

  useEffect(() => {
    if (!getLastBattle()?.fanfare) sfx(res.killed || res.damage > 0 ? 'win' : 'lose'); // đã phát ở banner trong trận
    const t = setTimeout(() => setHp(after), 350);
    // đếm sát thương lên trong ~0,9 s
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setDmg(Math.round(res.damage * (1 - (1 - k) * (1 - k))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line
  }, []);

  return (
    <div class={`result ${res.killed || res.damage > 0 ? 'win' : 'lose'}`}>
      <div class="result-card gld-res">
        <h1 class="res-title">{res.killed ? 'HẠ BOSS!' : 'ĐÃ ĐÁNH BOSS'}</h1>
        <div class="gld-rpic">
          <Portrait id="mk_chua" rarity="SSR" />
          {res.killed && <span class="gld-kill">ĐÃ HẠ</span>}
        </div>
        <b class="gld-rname">{res.boss.name}</b>
        <div class="gld-rdmgbig" aria-label="Sát thương gây ra">
          <Icon n="sword" size={30} /> <b>{fmt(dmg)}</b> <small>sát thương</small>
        </div>
        <BossHp hp={hp} hpMax={res.boss.hpMax} killed={res.killed} big />
        {res.killed && (
          <div class="gld-killban">
            <Icon n="crown" size={22} /> Boss bang đã gục ngã! Cả bang nhận thưởng.
            <div class="reward-row">
              <WalletChips w={BOSS_KILL_REWARD} />
            </div>
          </div>
        )}
        <small class="muted">Thưởng lượt đánh</small>
        <div class="reward-row">
          <WalletChips w={res.reward} />
        </div>
        <div class="res-btns">
          <Btn kind="primary" big class="res-main" onClick={() => go({ n: 'guild', tab: 'boss' })}>
            Về bang
          </Btn>
          <Btn kind="green" onClick={() => { returnTo.value = 'guild'; go({ n: 'squad' }); }}>Đội hình</Btn>
        </div>
      </div>
    </div>
  );
}
