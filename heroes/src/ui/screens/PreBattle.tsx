// Bảng chuẩn bị trận (mở ngay trên màn Chiến dịch): thông tin ải, xem trước địch, đội hình hiện tại 5 ô
// (chạm ô để chọn tướng ngay tại chỗ / kéo thả), so sánh lực chiến, nút BẮT ĐẦU. Không phải chuyển màn.
import { useMemo, useState } from 'preact/hooks';
import { STAMINA_MAX, SWEEP_COST } from '@shared/heroes/config';
import { powerOf } from '@shared/heroes/formulas';
import { gearDropOdds } from '@shared/heroes/gear';
import type { SweepRes } from '@shared/heroes/api';
import { RARITIES } from '@shared/heroes/types';
import { MONSTERS, stageSetup, type StageDef } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { powerOfOwned, squadPower, starsOfStage } from '../../game';
import { fmt, go, returnTo, toast, useBusy } from '../../state';
import { Btn, ElemChip, Modal, Portrait } from '../common';
import { GearDrops } from '../gear';
import { Icon } from '../icons';
import { pad, Roster, SquadBoard, useSquadOps } from '../squadkit';

export function PreBattle({ stage, onClose }: { stage: StageDef; onClose: () => void }) {
  const m = me.value!;
  const [busy, run] = useBusy();
  const base = pad(m.squads[m.activeSquad]);
  const [slots, setSlots] = useState<string[]>(base);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [swept, setSwept] = useState<{ times: number; r: SweepRes } | null>(null);
  const ops = useSquadOps(slots, setSlots, { closeWhenFull: true });

  const stars = starsOfStage(m, stage.id);
  const count = slots.filter(Boolean).length;
  const dirty = slots.join('|') !== base.join('|');
  const mine = squadPower(m, slots);
  // lực chiến địch = đợt mạnh nhất (stageSetup dựng sẵn chỉ số quái)
  const enemy = useMemo(() => {
    const ws = stageSetup(stage, [], 0).waves;
    return Math.max(...ws.map((w) => w.reduce((a, u) => a + powerOf(u.stats), 0)));
  }, [stage]);
  const ratio = enemy > 0 ? mine / enemy : 1;
  const verdict = count === 0 ? { t: 'Chưa có tướng', c: 'bad' } : ratio >= 1.15 ? { t: 'Thắng thế', c: 'good' } : ratio >= 0.85 ? { t: 'Cân tài', c: 'mid' } : { t: 'Yếu thế', c: 'bad' };

  const heroes = useMemo(
    () => m.heroes.slice().sort((a, b) => powerOfOwned(b) - powerOfOwned(a)),
    // eslint-disable-next-line
    [m.heroes],
  );
  const odds = gearDropOdds(stage.chapter);
  const mName = (k: string) => MONSTERS.find((x) => x.id === k)?.name ?? k;

  const begin = () =>
    run(async () => {
      if (count === 0) return toast('Hãy xếp ít nhất 1 tướng', 'info');
      if (dirty) await api.setSquad(m.activeSquad, slots, true);
      returnTo.value = null;
      go({ n: 'battle', stage: stage.id });
    });
  const toSquad = () => {
    returnTo.value = stage.id;
    go({ n: 'squad' });
  };

  const sweepable = stars >= 3;
  const stamina = m.profile.stamina;
  const maxSweep = Math.min(10, Math.floor(stamina / SWEEP_COST));
  const sweep = (times: number) =>
    run(async () => {
      const r = await api.sweep(stage.id, times);
      setSwept({ times, r });
    });

  return (
    <Modal onClose={onClose} wide class="pb" title={`${stage.name}${stage.boss ? ' (BOSS)' : ''}`}>
      <div class="pb-meta">
        <ElemChip el={stage.element} label />
        <span class="lvtag">Đề xuất Lv {stage.level}</span>
        <span class="stars-big">
          {[1, 2, 3].map((i) => <Icon key={i} n={i <= stars ? 'star' : 'starEmpty'} size={22} />)}
        </span>
      </div>
      <div class="pb-cols">
        <div class="pb-left">
          <div class="waves">
            {stage.waves.map((w, i) => (
              <div class="wave-row" key={i}>
                <small>Đợt {i + 1}</small>
                <div class="mons">
                  {w.map((k, j) => (
                    <div class="mon" key={j} title={mName(k)}>
                      <Portrait id={k} rarity="R" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div class="pb-rewards">
            <span class="reward"><Icon n="gold" size={18} /><b>{fmt(stage.reward.gold)}</b></span>
            <span class="reward"><Icon n="exp" size={18} /><b>{fmt(stage.reward.exp)}</b></span>
            <span class="reward"><Icon n="user" size={18} /><b>{fmt(stage.reward.xp)}</b></span>
            {stars === 0 && <span class="reward first"><Icon n="gem" size={18} /><b>{stage.reward.gems}</b></span>}
          </div>
          <div class="pb-drop" title="Tỉ lệ rớt trang bị theo phẩm">
            <Icon n="gWeapon" size={20} />
            <span>Có thể rớt: trang bị{stage.boss ? ' (+1 ải boss)' : ''}</span>
            {RARITIES.filter((r) => odds[r] > 0).map((r) => (
              <i key={r} class={`rtag r-${r}`}>{r} {odds[r]}%</i>
            ))}
          </div>
        </div>
        <div class="pb-right">
          <div class="pb-power">
            <span>Đội bạn <b>{fmt(mine)}</b></span>
            <i class={`verdict ${verdict.c}`}>{verdict.t}</i>
            <span>Địch <b>{fmt(enemy)}</b></span>
          </div>
          <SquadBoard m={m} slots={slots} sel={ops.sel} onTapSlot={ops.tapSlot} onDrop={ops.drop} compact />
          {ops.sel !== null ? (
            <div class="pb-pick">
              <small class="hint">Chọn tướng cho ô {ops.sel + 1} (chạm tướng đang ở ô để gỡ)</small>
              <Roster heroes={heroes} slots={slots} onTap={ops.tapHero} onDrop={ops.drop} compact />
            </div>
          ) : (
            <small class="hint">Chạm một ô để đổi tướng, hoặc kéo thả giữa các ô.</small>
          )}
        </div>
      </div>
      {count === 0 && <p class="form-err">Đội hình đang trống. Chạm một ô để chọn tướng.</p>}
      {sweepOpen && sweepable && (
        <div class="sweep">
          <small>Quét nhanh, mỗi lần {SWEEP_COST} thể lực. Thể lực: <b>{stamina}/{STAMINA_MAX}</b></small>
          <div class="btn-row">
            <Btn kind="blue" small busy={busy} disabled={maxSweep < 1} onClick={() => sweep(1)}>Quét x1</Btn>
            <Btn kind="blue" small busy={busy} disabled={maxSweep < 5} onClick={() => sweep(5)}>Quét x5</Btn>
            <Btn kind="blue" small busy={busy} disabled={maxSweep < 10} onClick={() => sweep(10)}>Quét x10</Btn>
          </div>
        </div>
      )}
      <div class="pb-foot">
        <Btn kind="ghost" small onClick={toSquad}>Đội hình đầy đủ</Btn>
        <Btn kind="blue" small disabled={!sweepable} onClick={() => setSweepOpen(!sweepOpen)} title={sweepable ? '' : 'Đạt 3 sao để mở quét nhanh'}>
          {sweepable ? 'Quét nhanh' : 'Quét (cần 3 sao)'}
        </Btn>
        <Btn kind="primary" big class="pb-go" busy={busy} disabled={count === 0} onClick={begin}>
          <Icon n="battle" size={26} /> BẮT ĐẦU
        </Btn>
      </div>
      {swept && (
        <Modal title={`Quét x${swept.times}`} onClose={() => setSwept(null)}>
          <div class="reward-row">
            <div class="reward"><Icon n="gold" size={22} /><b>+{fmt(swept.r.reward.gold)}</b></div>
            <div class="reward"><Icon n="exp" size={22} /><b>+{fmt(swept.r.reward.exp)}</b></div>
            <div class="reward"><Icon n="user" size={22} /><b>+{fmt(swept.r.reward.xp)} XP</b></div>
          </div>
          <GearDrops ids={swept.r.drops ?? []} full />
          <Btn kind="green" onClick={() => setSwept(null)}>Tuyệt!</Btn>
        </Modal>
      )}
    </Modal>
  );
}
