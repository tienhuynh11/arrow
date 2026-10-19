// Đội hình: kéo thả hoặc chạm ô rồi chạm tướng; 3 đội lưu sẵn; hàng trước 2 ô, hàng sau 3 ô; tự xếp mạnh nhất.
// Nếu đến từ bảng chuẩn bị trận (returnTo) thì có nút lớn "Chiến tiếp" quay lại đúng ải.
import { useMemo, useState } from 'preact/hooks';
import { SQUAD_COUNT } from '@shared/heroes/config';
import { stageOf } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { defOf, squadPower } from '../../game';
import { fmt, go, returnTo, toast, useBusy } from '../../state';
import { Btn } from '../common';
import { applyFilter, EMPTY_FILTER, FilterBar, type HeroFilter } from '../filters';
import { Icon } from '../icons';
import { autoSquad, pad, Roster, SquadBoard, useSquadOps } from '../squadkit';

export function Squad() {
  const m = me.value!;
  const [tab, setTab] = useState(m.activeSquad);
  const [drafts, setDrafts] = useState<string[][]>(() => Array.from({ length: SQUAD_COUNT }, (_, i) => pad(m.squads[i])));
  const [f, setF] = useState<HeroFilter>({ ...EMPTY_FILTER, sort: 'power' });
  const [busy, run] = useBusy();

  const slots = drafts[tab];
  const saved = pad(m.squads[tab]).join('|');
  const dirty = slots.join('|') !== saved;
  const count = slots.filter(Boolean).length;
  const isActive = m.activeSquad === tab;
  const setSlots = (s: string[]) => setDrafts((d) => d.map((x, i) => (i === tab ? s : x)));
  const ops = useSquadOps(slots, setSlots, { initialSel: null });

  const back = returnTo.value === 'tower' ? { id: 'tower', name: 'Tháp thử thách' } : returnTo.value === 'arena' ? { id: 'arena', name: 'Đấu trường' } : returnTo.value ? stageOf(returnTo.value) : undefined;

  const save = () =>
    run(async () => {
      await api.setSquad(tab, slots, true);
      toast(`Đã lưu đội ${tab + 1} và đặt làm đội chính`, 'ok');
    });

  // quay lại bảng chuẩn bị trận: lưu đội đang xem (nếu có thay đổi / chưa là đội chính) rồi mở lại ải
  const resume = () =>
    run(async () => {
      if (count === 0) return toast('Đội đang trống, hãy xếp ít nhất 1 tướng', 'info');
      if (dirty || !isActive) await api.setSquad(tab, slots, true);
      const id = back!.id;
      returnTo.value = null;
      go(id === 'tower' ? { n: 'tower' } : id === 'arena' ? { n: 'arena' } : { n: 'campaign', stage: id });
    });

  const entries = useMemo(
    () => applyFilter(m.heroes.map((o) => ({ def: defOf(o.id), o })), f),
    // eslint-disable-next-line
    [m.heroes, f],
  );
  const heroes = entries.map((e) => e.o!);

  return (
    <div class="squad">
      <section class="sq-board panel" data-tut="squad-board">
        {back && (
          <Btn kind="primary" big class="sq-return" busy={busy} onClick={resume}>
            <Icon n="battle" size={26} /> Chiến tiếp → {back.name}
          </Btn>
        )}
        <div class="seg wide sq-tabs" role="tablist">
          {Array.from({ length: SQUAD_COUNT }, (_, i) => (
            <button type="button" role="tab" key={i} class={tab === i ? 'on' : ''} aria-selected={tab === i} onClick={() => { setTab(i); ops.setSel(null); }}>
              Đội {i + 1}
              {m.activeSquad === i && <Icon n="star" size={14} />}
            </button>
          ))}
        </div>
        <SquadBoard m={m} slots={slots} sel={ops.sel} onTapSlot={ops.tapSlot} onDrop={ops.drop} />
        <div class="sq-foot">
          <span class="power"><Icon n="sparkle" size={18} /> Lực chiến <b>{fmt(squadPower(m, slots))}</b></span>
          <Btn kind="ghost" small onClick={() => { setSlots(autoSquad(m)); ops.setSel(null); }}>Tự xếp mạnh nhất</Btn>
          {ops.sel !== null && slots[ops.sel] && (
            <Btn kind="ghost" small onClick={() => { const s = slots.slice(); s[ops.sel!] = ''; setSlots(s); }}>Gỡ ô {ops.sel + 1}</Btn>
          )}
          <Btn kind="green" small busy={busy} disabled={count === 0 || (!dirty && isActive)} onClick={save}>
            {dirty ? 'Lưu & dùng' : isActive ? 'Đang dùng' : 'Dùng đội này'}
          </Btn>
        </div>
      </section>

      <section class="sq-roster panel">
        <FilterBar f={f} setF={setF}>
          {entries.length}/{m.heroes.length}
        </FilterBar>
        <small class="hint">
          {ops.sel !== null ? `Chạm tướng để xếp vào ô ${ops.sel + 1}` : 'Kéo tướng vào ô (hoặc chạm ô rồi chạm tướng). Kéo ô về đây để gỡ.'}
        </small>
        <Roster heroes={heroes} slots={slots} onTap={ops.tapHero} onDrop={ops.drop} />
      </section>
    </div>
  );
}
