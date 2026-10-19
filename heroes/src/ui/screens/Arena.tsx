// Đấu trường PvP bất đồng bộ: danh sách đối thủ (người thật / bot), đội tấn công sửa tại chỗ, đội phòng thủ, bảng xếp hạng.
// Trận đánh dùng lại màn Battle với stage 'arena' (truyền kèm đối thủ).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ARENA_TRIES, type ArenaOpponent } from '@shared/heroes/arena';
import type { ArenaRes, ArenaTopRow } from '@shared/heroes/api';
import { SQUAD_COUNT, SQUAD_SIZE } from '@shared/heroes/config';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { api, me } from '../../api';
import { arenaOf, powerOfOwned, slotsOpenOf, squadPower, squadsOpenOf } from '../../game';
import { fmt, fmtDur, go, errToast, returnTo, toast, useBusy } from '../../state';
import { Btn, Modal, Portrait, Spinner } from '../common';
import { Icon, Medal } from '../icons';
import { fitSquad, Roster, SquadBoard, useSquadOps } from '../squadkit';
import { PublicProfileModal } from './PublicProfile';
import { ActHead, ResetChip, useDayReset } from './activity';

export function verdictOf(mine: number, theirs: number, empty: boolean): { t: string; c: string } {
  if (empty) return { t: 'Chưa có tướng', c: 'bad' };
  const ratio = theirs > 0 ? mine / theirs : 1;
  return ratio >= 1.15 ? { t: 'Thắng thế', c: 'good' } : ratio >= 0.85 ? { t: 'Cân tài', c: 'mid' } : { t: 'Yếu thế', c: 'bad' };
}

/** dải chân dung nhỏ của một đội, 6 ô (id '' = ô trống; `open` = số ô đang mở, ô khoá hiện ổ khoá hẹp) */
export function MiniRow({ heroes, size, open }: { heroes: { id: string; level?: number }[]; size?: 'sm' | 'md'; open?: number }) {
  return (
    <div class={`ar-mini${size === 'md' ? ' md' : ''}`}>
      {Array.from({ length: SQUAD_SIZE }, (_, i) => {
        const h = heroes[i];
        if (open !== undefined && i >= open) {
          return (
            <div key={i} class="ar-mh sq6-mlock" title="Ô đang khoá">
              <Icon n="lock" size={12} />
            </div>
          );
        }
        const d = h?.id ? HERO_BY_ID[h.id] : undefined;
        return (
          <div key={i} class={`ar-mh${d ? ` r-${d.rarity}` : ' none'}`} title={d?.name}>
            {d && <Portrait id={d.id} rarity={d.rarity} />}
            {d && h.level ? <i>{h.level}</i> : null}
          </div>
        );
      })}
    </div>
  );
}

function OppCard({ o, mine, empty, blocked, busy, onFight }: { o: ArenaOpponent; mine: number; empty: boolean; blocked: boolean; busy: boolean; onFight: () => void }) {
  const v = verdictOf(mine, o.power, empty);
  return (
    <div class="ar-opp">
      <div class="ar-opp-h">
        <b class="ar-name">{o.name}</b>
        {o.bot && <i class="ar-bot">BOT</i>}
        <span class="ar-rt" title="Điểm xếp hạng">
          <Icon n="crown" size={14} /> {o.rating}
        </span>
        <i class={`verdict ${v.c}`}>{v.t}</i>
      </div>
      <div class="ar-opp-b">
        <MiniRow heroes={o.heroes} />
        <span class="ar-pw">
          Lực <b>{fmt(o.power)}</b>
        </span>
        <Btn kind="primary" class="ar-go" busy={busy} disabled={blocked} onClick={onFight}>
          <Icon n="sword" size={18} /> ĐÁNH
        </Btn>
      </div>
    </div>
  );
}

function TopList({ rows, name }: { rows: ArenaTopRow[] | null; name: string }) {
  const [who, setWho] = useState<string | null>(null);
  if (!rows)
    return (
      <div class="ar-wait">
        <Spinner />
      </div>
    );
  if (!rows.length) return <p class="muted ar-none">Chưa có ai trên bảng xếp hạng.</p>;
  return (
    <div class="ar-top">
      {who && <PublicProfileModal name={who} onClose={() => setWho(null)} />}
      {rows.map((r) => (
        <div key={r.rank} class={`ar-row${r.username === name ? ' me' : ''}${r.rank <= 3 ? ` top${r.rank}` : ''}`}>
          <span class="ar-rk">{r.rank <= 3 ? <Medal rank={r.rank as 1 | 2 | 3} size={30} /> : r.rank}</span>
          <button type="button" class="ar-name" style={{ all: 'unset', cursor: 'pointer', fontWeight: 800, flex: 1, minWidth: 0 }} onClick={() => setWho(r.username)}>{r.username}</button>
          <span class="ar-wins" title="Số trận thắng">
            <Icon n="check" size={14} /> {r.wins}
          </span>
          <span class="ar-rt">
            <Icon n="crown" size={14} /> <b>{r.rating}</b>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Arena() {
  const m = me.value!;
  const left = useDayReset();
  const [busy, run] = useBusy();
  const a = arenaOf(m);
  const [data, setData] = useState<ArenaRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [cool, setCool] = useState(false);
  const [tab, setTab] = useState<'fight' | 'top'>('fight');
  const [top, setTop] = useState<ArenaTopRow[] | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  const alive = useRef(true);

  const base = fitSquad(m, m.squads[m.activeSquad]);
  const [slots, setSlots] = useState<string[]>(base);
  const ops = useSquadOps(slots, setSlots, { closeWhenFull: true, open: slotsOpenOf(m) });
  const count = slots.filter(Boolean).length;
  const dirty = slots.join('|') !== base.join('|');
  const mine = squadPower(m, slots);

  const load = () => {
    setLoading(true);
    return api
      .arena()
      .then((r) => alive.current && setData(r))
      .catch((e) => alive.current && errToast(e))
      .finally(() => alive.current && setLoading(false));
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => void (alive.current = false);
    // eslint-disable-next-line
  }, []);
  // mở tab xếp hạng lần đầu thì mới tải bảng
  useEffect(() => {
    if (tab !== 'top' || top) return;
    api
      .arenaTop()
      .then((r) => alive.current && setTop(r))
      .catch((e) => {
        errToast(e);
        if (alive.current) setTop([]);
      });
    // eslint-disable-next-line
  }, [tab]);

  const refresh = () => {
    if (cool) return;
    setCool(true);
    setTimeout(() => alive.current && setCool(false), 3000);
    void load();
    if (tab === 'top') {
      setTop(null);
      api.arenaTop().then((r) => alive.current && setTop(r)).catch(() => alive.current && setTop([]));
    }
  };

  const heroes = useMemo(
    () => m.heroes.slice().sort((x, y) => powerOfOwned(y) - powerOfOwned(x)),
    // eslint-disable-next-line
    [m.heroes],
  );
  const blocked = a.tries <= 0 ? `Hết lượt hôm nay. Làm mới sau ${fmtDur(left)}` : count === 0 ? 'Hãy xếp ít nhất 1 tướng để tấn công' : '';

  const fight = (o: ArenaOpponent) =>
    run(async () => {
      if (blocked) return toast(blocked, 'info');
      if (dirty) await api.setSquad(m.activeSquad, slots, true);
      go({ n: 'battle', stage: 'arena', opp: o });
    });
  const toSquad = () => {
    returnTo.value = 'arena';
    go({ n: 'squad' });
  };
  const setDefense = (i: number) =>
    run(async () => {
      await api.arenaDefense(i);
      setDefOpen(false);
      toast(`Đã đặt đội ${i + 1} làm đội phòng thủ`, 'ok');
    });

  const defIds = fitSquad(m, m.squads[a.defense]);
  const defPower = squadPower(m, defIds);
  const opps = data?.opponents ?? [];
  const rank = data?.rank ?? 0;

  const squadPanel = (
    <section class="ar-squad panel">
      <div class="ar-def">
        <div class="ar-def-t">
          <Icon n="shield" size={18} />
          <b>Phòng thủ: Đội {a.defense + 1}</b>
          <span class="ar-pw">
            Lực <b>{fmt(defPower)}</b>
          </span>
        </div>
        <MiniRow heroes={defIds.map((id) => ({ id }))} size="md" open={slotsOpenOf(m)} />
        <Btn kind="blue" small class="ar-def-b" onClick={() => setDefOpen(true)}>
          Đổi đội phòng thủ
        </Btn>
      </div>
      <div class="ar-atk-h">
        <b>
          <Icon n="sword" size={16} /> Đội tấn công
        </b>
        <span class="ar-pw">
          Lực <b>{fmt(mine)}</b>
        </span>
      </div>
      <SquadBoard m={m} slots={slots} sel={null} onTapSlot={ops.tapSlot} onDrop={ops.drop} compact />
      <div class="ar-acts">
        <Btn kind="ghost" small onClick={toSquad}>
          Đội hình
        </Btn>
      </div>
      {blocked && <small class="tw-note">{blocked}</small>}
    </section>
  );

  return (
    <div class={`arena${tab === 'top' ? ' ar-top-on' : ''}`}>
      <ActHead title="Đấu trường" icon="arena">
        <span class="ah-pill" title="Lượt đánh hôm nay">
          <Icon n="sword" size={16} /> {a.tries}/{ARENA_TRIES}
        </span>
        <ResetChip left={left} />
      </ActHead>

      <div class="ar-stats">
        <span class="ar-st big" title="Điểm xếp hạng">
          <Icon n="crown" size={20} /> <b>{a.rating}</b>
        </span>
        <span class="ar-st" title="Thứ hạng">
          Hạng <b>{rank > 0 ? `#${rank}` : '—'}</b>
        </span>
        <span class="ar-st wl" title="Thắng / Thua">
          <i class="w">{a.wins}T</i>
          <i class="l">{a.losses}B</i>
        </span>
        <div class="seg ar-tabs" role="tablist">
          <button type="button" role="tab" class={tab === 'fight' ? 'on' : ''} aria-selected={tab === 'fight'} onClick={() => setTab('fight')}>
            Đối thủ
          </button>
          <button type="button" role="tab" class={tab === 'top' ? 'on' : ''} aria-selected={tab === 'top'} onClick={() => setTab('top')}>
            Xếp hạng
          </button>
        </div>
      </div>

      <div class="ar-body">
        <section class="ar-list panel">
          <div class="ar-list-h">
            <h3>{tab === 'fight' ? 'Đối thủ vừa sức' : 'Bảng xếp hạng'}</h3>
            <Btn kind="ghost" small class="ar-refresh" disabled={cool} onClick={refresh}>
              <Icon n="auto" size={16} /> Làm mới
            </Btn>
          </div>
          <div class="ar-scroll scroll">
            {tab === 'top' ? (
              <TopList rows={top} name={m.profile.username} />
            ) : loading && !data ? (
              <div class="ar-wait">
                <Spinner />
              </div>
            ) : opps.length === 0 ? (
              <p class="muted ar-none">Chưa tìm thấy đối thủ. Hãy bấm Làm mới.</p>
            ) : (
              <div class="ar-opps">
                {opps.map((o) => (
                  <OppCard key={o.id} o={o} mine={mine} empty={count === 0} blocked={!!blocked} busy={busy} onFight={() => void fight(o)} />
                ))}
              </div>
            )}
          </div>
        </section>
        {squadPanel}
      </div>

      {defOpen && (
        <Modal title="Chọn đội phòng thủ" onClose={() => setDefOpen(false)}>
          <small class="hint">Người khác sẽ đánh đội này khi bạn không online (AI tự điều khiển). Chỉ liệt kê đội đã mở và có tướng.</small>
          <div class="ar-dpick">
            {Array.from({ length: SQUAD_COUNT }, (_, i) => {
              const ids = fitSquad(m, m.squads[i]);
              const n = ids.filter(Boolean).length;
              if (i >= squadsOpenOf(m) || n === 0) return null; // chỉ liệt kê đội đã mở và không trống
              return (
                <button type="button" key={i} class={`ar-dsq${a.defense === i ? ' on' : ''}`} disabled={n === 0 || busy} onClick={() => void setDefense(i)}>
                  <b>
                    Đội {i + 1}
                    {a.defense === i && <Icon n="shield" size={14} />}
                  </b>
                  <MiniRow heroes={ids.map((id) => ({ id }))} open={slotsOpenOf(m)} />
                  <small>{`Lực ${fmt(squadPower(m, ids))}`}</small>
                </button>
              );
            })}
          </div>
          <Btn kind="ghost" small onClick={() => setDefOpen(false)}>
            Đóng
          </Btn>
        </Modal>
      )}
      {ops.sel !== null && (
        <Modal class="dk-pick" title={`Chọn tướng cho ô ${ops.sel + 1}`} onClose={() => ops.setSel(null)}>
          <small class="hint">Chạm tướng để xếp vào ô; chạm lại tướng đang ở ô để gỡ.</small>
          <div class="tw-pick">
            <Roster heroes={heroes} slots={slots} onTap={ops.tapHero} onDrop={ops.drop} compact />
          </div>
          <Btn kind="green" small onClick={() => ops.setSel(null)}>
            Xong
          </Btn>
        </Modal>
      )}
    </div>
  );
}
