// Màn kết quả chiến dịch: banner rơi, 3 sao nổi từng cái kèm điều kiện, hàng tướng + thanh XP tài khoản,
// rương thưởng bật ra từng ô; thua thì gợi ý mạnh lên. Chạm màn hình để chạy nốt hoạt ảnh tức thì.
import { useEffect, useRef } from 'preact/hooks';
import type { BattleRes } from '@shared/heroes/api';
import { powerOf } from '@shared/heroes/formulas';
import { GEAR_CAP } from '@shared/heroes/gear';
import { nextStage, stageOf, stageSetup } from '@shared/heroes/stages';
import { BATTLE_HZ } from '@shared/heroes/config';
import { me } from '../../api';
import { sfx } from '../../audio';
import { squadPower } from '../../game';
import { go, returnTo } from '../../state';
import { Btn } from '../common';
import { GearDrops } from '../gear';
import { Icon } from '../icons';
import { animChest, animXp, ChestStrip, DefeatTips, getLastBattle, RsBanner, SquadRow, StarList, useRsSeq, XpBar, type Chip } from '../result-kit';

export function Result({ stage, res }: { stage: string; res: BattleRes }) {
  const def = stageOf(stage);
  const next = nextStage(stage);
  const m = me.value;
  const lb = getLastBattle();
  const rootRef = useRef<HTMLDivElement>(null);
  const squad = (m?.squads[m.activeSquad] ?? []).filter(Boolean);
  const dead = lb?.dead ?? [];
  const r = res.reward;
  const secs = def ? Math.ceil(def.star3Ticks / BATTLE_HZ) : 0;
  // điều kiện sao: ưu tiên số liệu trận vừa đánh; thiếu thì suy từ số sao server chấm
  const noDeath = lb ? lb.deaths === 0 : res.stars >= 2;
  const fast = lb ? !!def && lb.ticks <= def.star3Ticks : res.stars >= 3;
  const conds = [
    { got: res.win, text: 'Chiến thắng' },
    { got: res.win && noDeath, text: 'Không ai gục' },
    { got: res.win && fast, text: `Xong dưới ${secs} giây` },
  ];
  const unlocked = res.win && res.reward.firstClear && next;
  const chips: Chip[] = [
    { icon: 'gold', value: r.gold },
    { icon: 'exp', value: r.exp },
    ...(r.gems > 0 ? [{ icon: 'gem' as const, value: r.gems, first: r.firstClear }] : []),
  ];
  // lực chiến: đội mình vs đợt mạnh nhất của ải (giống PreBattle)
  const mine = m ? squadPower(m, m.squads[m.activeSquad] ?? []) : 0;
  const enemy = def ? Math.max(...stageSetup(def, [], 0).waves.map((w) => w.reduce((a, u) => a + powerOf(u.stats), 0))) : null;

  const skip = useRsSeq(rootRef, (tl, q) => {
    const banner = q('.rs-banner');
    tl.fromTo(banner, { y: -120, opacity: 0, scale: 1.3 }, { y: 0, opacity: 1, scale: 1, duration: res.win ? 0.7 : 1.1, ease: res.win ? 'bounce.out' : 'power2.out' }, 0);
    let t = 0.5;
    if (res.win) {
      const stars = q('.rs-star');
      const lines = q('.rs-cond');
      const sparks = q('.rs-spk');
      stars.forEach((s, i) => {
        const got = conds[i].got;
        const at = t + i * 0.34;
        tl.fromTo(s, { scale: 0, rotation: -60, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.45, ease: 'back.out(3)' }, at)
          .fromTo(lines[i], { opacity: 0, y: 6 }, { opacity: got ? 1 : 0.6, y: 0, duration: 0.25 }, at + 0.2);
        if (got) {
          tl.call(() => sfx('star'), undefined, at + 0.05)
            .fromTo(s, { filter: 'brightness(2.2)' }, { filter: 'brightness(1)', duration: 0.45 }, at + 0.1)
            .fromTo(sparks[i], { scale: 0.2, opacity: 1, rotation: 0 }, { scale: 2.2, opacity: 0, rotation: 90, duration: 0.5, ease: 'power2.out' }, at + 0.1);
        }
      });
      t += 3 * 0.34 + 0.35;
      const sq = q('.rs-hero');
      if (sq.length) {
        tl.fromTo(sq, { y: 24, scale: 0.6, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.07 }, t);
        t += 0.1 + sq.length * 0.07;
      }
      t = animXp(tl, q, t, sfx) + 0.1;
      t = animChest(tl, q, t, sfx);
      const rb = q('.rs-ribbon')[0];
      if (rb) {
        tl.fromTo(rb, { scale: 0.2, opacity: 0, rotation: -12 }, { scale: 1, opacity: 1, rotation: -2, duration: 0.4, ease: 'back.out(3)' }, t - 0.2);
        t += 0.2;
      }
      const un = q('.rs-unlock')[0];
      if (un) tl.fromTo(un, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'expo.out' }, t - 0.1);
    } else {
      const tips = q('.rs-tips');
      tl.fromTo(tips, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.9);
      const sq = q('.rs-hero');
      if (sq.length) tl.fromTo(sq, { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.05 }, 0.7);
    }
  });

  useEffect(() => {
    // tiếng thắng/thua đã phát ở banner trong trận; chỉ phát lại khi bỏ qua trận
    if (!lb?.fanfare) sfx(res.win ? 'win' : 'lose');
  }, []);

  const retry = () => go({ n: 'battle', stage });
  return (
    <div class={`result rs-root ${res.win ? 'win' : 'lose'}`} ref={rootRef} onPointerDown={skip}>
      <div class="result-card rs-card">
        {res.win && <div class="rs-rays" />}
        <RsBanner win={res.win} text={res.win ? 'THẮNG LỢI' : 'THẤT BẠI'} sub={def?.name} />
        {res.win && <StarList conds={conds} />}
        {squad.length > 0 && <SquadRow ids={squad} dead={dead} />}
        {res.win ? (
          <>
            <XpBar gained={r.xp} levelUp={res.levelUp} />
            <ChestStrip chips={chips} />
            <GearDrops ids={res.drops ?? []} full={(m?.gear.length ?? 0) >= GEAR_CAP} />
            {r.firstClear && <div class="rs-ribbon">THƯỞNG LẦN ĐẦU</div>}
            {unlocked && (
              <div class="rs-unlock">
                <Icon n="unlock" size={20} /> {next!.name} đã mở
              </div>
            )}
          </>
        ) : (
          <DefeatTips mine={mine} enemy={enemy} squadLen={squad.length} />
        )}
        <div class="res-btns">
          {res.win && next ? (
            <Btn kind="primary" big class={`res-main${unlocked ? ' rs-pulse' : ''}`} onClick={() => go({ n: 'campaign', stage: next.id })}>
              Ải kế tiếp <Icon n="battle" size={24} />
            </Btn>
          ) : (
            <Btn kind="primary" big class="res-main" onClick={retry}>
              {res.win ? 'Chơi lại' : 'Thử lại'}
            </Btn>
          )}
          {res.win && next && <Btn kind="blue" onClick={retry}>Chơi lại</Btn>}
          <Btn kind="green" onClick={() => { returnTo.value = stage; go({ n: 'squad' }); }}>Đội hình</Btn>
          <Btn kind="ghost" onClick={() => go({ n: 'campaign' })}>Về bản đồ</Btn>
        </div>
      </div>
    </div>
  );
}
