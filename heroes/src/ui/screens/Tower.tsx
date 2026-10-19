// Tháp thử thách: cột tầng (đã qua / hiện tại / khoá), thông tin tầng kế tiếp (địch, lực chiến, thưởng),
// đội hình sửa ngay tại chỗ, nút THÁCH ĐẤU. Trận đánh dùng lại màn Battle với stage 'tower'.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { powerOf } from '@shared/heroes/formulas';
import { stageSetup } from '@shared/heroes/stages';
import { isTowerBoss, TOWER_MAX_FLOOR, TOWER_TRIES, towerReward, towerStage } from '@shared/heroes/tower';
import { api, me } from '../../api';
import { powerOfOwned, slotsOpenOf, squadPower, towerOf } from '../../game';
import { fmt, fmtDur, go, returnTo, toast, useBusy } from '../../state';
import { Btn, ElemChip, Modal, useDesktopLand } from '../common';
import { Icon } from '../icons';
import { EnemyLineup, fitSquad, Roster, SquadBoard, useSquadOps } from '../squadkit';
import { ActHead, ResetChip, useDayReset, WalletChips } from './activity';

/** cột tháp: hiển thị vài tầng quanh tầng hiện tại, tự cuộn tới tầng hiện tại */
function TowerStrip({ done, cur }: { done: number; cur: number }) {
  const box = useRef<HTMLDivElement>(null);
  const hi = Math.min(TOWER_MAX_FLOOR, cur + 6);
  const lo = Math.max(1, cur - 5);
  const floors: number[] = [];
  for (let f = hi; f >= lo; f--) floors.push(f);
  useEffect(() => {
    const b = box.current;
    const c = b?.querySelector<HTMLElement>('.tw-fl.cur');
    if (b && c) b.scrollTop = c.offsetTop - b.clientHeight / 2 + c.offsetHeight / 2;
  }, [cur]);
  return (
    <div class="tw-strip fade-wrap">
      <div class="tw-floors scroll" ref={box}>
        {floors.map((f) => {
          const st = f <= done ? 'done' : f === cur ? 'cur' : 'lock';
          const boss = isTowerBoss(f);
          return (
            <div key={f} class={`tw-fl ${st}${boss ? ' boss' : ''}`} aria-label={`Tầng ${f}`}>
              <span class="tw-n">{f}</span>
              <span class="tw-st">
                {boss ? <Icon n="crown" size={20} /> : st === 'done' ? <Icon n="check" size={16} /> : st === 'lock' ? <Icon n="lock" size={16} /> : <Icon n="sword" size={18} />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Tower() {
  const m = me.value!;
  const left = useDayReset();
  const [busy, run] = useBusy();
  const side = useDesktopLand(); // PC ngang: lực chiến + thưởng chuyển sang bảng bên phải cùng đội hình và nút THÁCH ĐẤU
  const base = fitSquad(m, m.squads[m.activeSquad]);
  const [slots, setSlots] = useState<string[]>(base);
  const ops = useSquadOps(slots, setSlots, { closeWhenFull: true, open: slotsOpenOf(m) });

  const t = towerOf(m);
  const cap = t.floor >= TOWER_MAX_FLOOR;
  const cur = Math.min(TOWER_MAX_FLOOR, t.floor + 1);
  const stage = useMemo(() => towerStage(cur), [cur]);
  const reward = towerReward(cur);
  const boss = isTowerBoss(cur);
  const count = slots.filter(Boolean).length;
  const dirty = slots.join('|') !== base.join('|');
  const mine = squadPower(m, slots);
  // lực chiến địch = đợt mạnh nhất (giống bảng chuẩn bị trận)
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

  const blocked = cap ? 'Bạn đã chinh phục toàn bộ tháp!' : t.tries <= 0 ? `Hết lượt hôm nay. Làm mới sau ${fmtDur(left)}` : count === 0 ? 'Hãy xếp ít nhất 1 tướng' : '';

  const begin = () =>
    run(async () => {
      if (blocked) return toast(blocked, 'info');
      if (dirty) await api.setSquad(m.activeSquad, slots, true);
      go({ n: 'battle', stage: 'tower' });
    });
  const toSquad = () => {
    returnTo.value = 'tower';
    go({ n: 'squad' });
  };

  const powerEl = (
  <div class="pb-power">
    <span>Đội bạn <b>{fmt(mine)}</b></span>
    <i class={`verdict ${verdict.c}`}>{verdict.t}</i>
    <span>Địch <b>{fmt(enemy)}</b></span>
  </div>
  );
  const rewEl = (
  <div class="tw-rew" aria-label="Thưởng">
    <WalletChips w={{ gold: reward.gold, exp: reward.exp, gems: reward.gems, stones: reward.stones }} />
    <span class="ah-chip"><Icon n="user" size={16} /><b>{fmt(reward.xp)}</b></span>
    {reward.gearRolls > 0 && (
      <span class="ah-chip gear"><Icon n="gWeapon" size={16} /><b>Trang bị x{reward.gearRolls}</b></span>
    )}
  </div>
  );

  return (
    <div class="tower">
      <ActHead title="Tháp thử thách" icon="tower">
        <span class="ah-pill" title="Lượt thử hôm nay">
          <Icon n="sword" size={16} /> {t.tries}/{TOWER_TRIES}
        </span>
        <ResetChip left={left} />
      </ActHead>

      <div class="tw-body">
        <TowerStrip done={t.floor} cur={cur} />

        <section class="tw-info panel scroll">
          <div class="tw-ihead">
            <h3>
              {boss && <Icon n="crown" size={22} />} {stage.name}
              {boss ? ' · BOSS' : ''}
            </h3>
            <ElemChip el={stage.element} />
            <span class="lvtag">Lv {stage.level}</span>
          </div>
          <EnemyLineup ids={stage.waves[0] ?? []} boss={boss} />
          {!side && powerEl}
          {!side && rewEl}
        </section>

        <section class="tw-squad">
          {side && powerEl}
          {side && rewEl}
          <SquadBoard m={m} slots={slots} sel={null} onTapSlot={ops.tapSlot} onDrop={ops.drop} compact />
          <div class="tw-actions">
            <Btn kind="ghost" small onClick={toSquad}>Đội hình</Btn>
            <Btn kind="primary" big class="tw-go" busy={busy} disabled={!!blocked} onClick={begin}>
              <Icon n="battle" size={26} /> THÁCH ĐẤU
            </Btn>
          </div>
          {blocked && <small class="tw-note">{blocked}</small>}
        </section>
      </div>

      {ops.sel !== null && (
        <Modal class="dk-pick" title={`Chọn tướng cho ô ${ops.sel + 1}`} onClose={() => ops.setSel(null)}>
          <small class="hint">Chạm tướng để xếp vào ô; chạm lại tướng đang ở ô để gỡ.</small>
          <div class="tw-pick">
            <Roster heroes={heroes} slots={slots} onTap={ops.tapHero} onDrop={ops.drop} compact />
          </div>
          <Btn kind="green" small onClick={() => ops.setSel(null)}>Xong</Btn>
        </Modal>
      )}
    </div>
  );
}
