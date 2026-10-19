// Sự kiện theo thời gian: thẻ sự kiện (banner tướng, đếm ngược), mục tiêu có thanh tiến trình + thưởng + nút Nhận.
// Làm mới khi vào màn và sau mỗi lần nhận; mục tiêu bấm Nhận đổi sang "Đã nhận" ngay (lạc quan), lỗi thì trả lại.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EventClaimRes, EventsRes } from '@shared/heroes/api';
import { EVENT_KIND_NAME, type EventObjective, type EventReward, type EventView } from '@shared/heroes/events';
import { GEAR_BY_ID } from '@shared/heroes/gear';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { api, serverNow } from '../../api';
import { errToast, fmt, fmtDur, toast, useTicker } from '../../state';
import { Btn, Modal, Portrait, Spinner } from '../common';
import { GearDrops, GearTile } from '../gear';
import { Icon } from '../icons';
import { ActHead, WalletChips } from './activity';

/** "2 ngày 03 giờ" khi còn xa, "03g 12p 09s" khi gần */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'Đã kết thúc';
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d} ngày ${String(Math.floor((ms % 86_400_000) / 3_600_000)).padStart(2, '0')} giờ`;
  return fmtDur(ms);
}

/** màu tiêu đề thẻ theo id sự kiện (vòng 5 màu) */
const HEAD_COLORS: [string, string][] = [
  ['#ff9a1f', '#e8394f'],
  ['#3fa7ff', '#8a4ee0'],
  ['#4ccf5a', '#17928a'],
  ['#ff6ad5', '#8a4ee0'],
  ['#ffc43d', '#ff6a2a'],
];

/** thưởng của một mục: chip ví, chip mảnh tướng (kèm chân dung), ô trang bị */
export function RewardChips({ r }: { r: EventReward }) {
  const hero = r.shards ? HERO_BY_ID[r.shards.hero] : undefined;
  const gears = (r.gear ?? []).map((id) => GEAR_BY_ID[id]).filter(Boolean);
  return (
    <div class="ev-rew" aria-label="Phần thưởng">
      {r.wallet && <WalletChips w={r.wallet} />}
      {r.shards && (
        <span class="ah-chip ev-shard" title={hero ? `Mảnh ${hero.name}` : 'Mảnh tướng'}>
          {hero ? (
            <span class="ev-shp">
              <Portrait id={hero.id} rarity={hero.rarity} />
            </span>
          ) : (
            <Icon n="heroes" size={16} />
          )}
          <b>x{fmt(r.shards.n)}</b>
        </span>
      )}
      {gears.map((d, i) => (
        <GearTile key={`${d.id}${i}`} def={d} size={36} class="ev-gt" />
      ))}
    </div>
  );
}

function Objective({
  o,
  value,
  claimed,
  busy,
  onClaim,
}: {
  o: EventObjective;
  value: number;
  claimed: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  const pr = Math.min(o.target, value);
  const ready = !claimed && pr >= o.target;
  return (
    <div class={`ev-obj${claimed ? ' done' : ready ? ' ready' : ''}`}>
      <div class="ev-oinfo">
        <b class="ev-oname">{o.name}</b>
        <small class="ev-okind">{EVENT_KIND_NAME[o.kind]}</small>
        <div class="ev-bar" role="progressbar" aria-valuemin={0} aria-valuemax={o.target} aria-valuenow={pr} aria-label={o.name}>
          <i style={{ width: `${Math.min(100, (pr * 100) / o.target)}%` }} />
          <span>{fmt(pr)}/{fmt(o.target)}</span>
        </div>
        <RewardChips r={o.reward} />
      </div>
      {claimed ? (
        <Btn kind="ghost" small class="ev-btn" disabled>
          <Icon n="check" size={18} /> Đã nhận
        </Btn>
      ) : ready ? (
        <Btn kind="green" small class="ev-btn" busy={busy} onClick={onClaim}>
          Nhận
        </Btn>
      ) : (
        <Btn kind="ghost" small class="ev-btn" disabled>
          <Icon n="lock" size={16} /> Chưa xong
        </Btn>
      )}
    </div>
  );
}

function EventCard({ v, claimed, busyKey, onClaim }: { v: EventView; claimed: Set<string>; busyKey: string; onClaim: (o: EventObjective) => void }) {
  const e = v.event;
  const left = e.endsAt - serverNow();
  const hero = e.banner ? HERO_BY_ID[e.banner] : undefined;
  const [c1, c2] = HEAD_COLORS[e.id % HEAD_COLORS.length];
  const doneN = e.objectives.filter((o) => claimed.has(o.id)).length;
  return (
    <article class="ev-card">
      <header class="ev-head" style={{ '--c1': c1, '--c2': c2 } as any}>
        <div class="ev-htxt">
          <h3 class="ev-name">{e.name}</h3>
          <span class={`ev-left${left < 3_600_000 ? ' hot' : ''}`}>
            <Icon n="clock" size={16} /> {fmtCountdown(left)}
          </span>
          <span class="ev-cnt">Đã nhận {doneN}/{e.objectives.length}</span>
        </div>
        {hero && (
          <div class={`ev-hero r-${hero.rarity}`} title={hero.name}>
            <Portrait id={hero.id} rarity={hero.rarity} />
          </div>
        )}
      </header>
      {e.desc && <p class="ev-desc">{e.desc}</p>}
      <div class="ev-objs">
        {e.objectives.map((o) => (
          <Objective
            key={o.id}
            o={o}
            value={v.progress[o.id] ?? 0}
            claimed={claimed.has(o.id)}
            busy={busyKey === `${e.id}:${o.id}`}
            onClaim={() => onClaim(o)}
          />
        ))}
      </div>
    </article>
  );
}

export function Events() {
  useTicker(1000);
  const [data, setData] = useState<EventsRes | null>(null);
  const [err, setErr] = useState(false);
  // mục đã bấm nhận nhưng server chưa trả lại danh sách mới: hiện "Đã nhận" ngay
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState('');
  const [got, setGot] = useState<EventClaimRes['reward'] | null>(null);
  const alive = useRef(true);

  const load = () =>
    api
      .events()
      .then((r) => {
        if (!alive.current) return;
        setData(r);
        setErr(false);
        setLocal(new Set());
      })
      .catch((e) => {
        if (!alive.current) return;
        setErr(true);
        errToast(e);
      });

  useEffect(() => {
    alive.current = true;
    void load();
    void api.refresh().catch(() => {});
    return () => void (alive.current = false);
    // eslint-disable-next-line
  }, []);

  const now = serverNow();
  const list = (data?.events ?? []).filter((v) => v.event.endsAt > now);
  // có sự kiện vừa hết hạn khi đang xem -> tải lại danh sách
  const expired = (data?.events.length ?? 0) - list.length;
  useEffect(() => {
    if (expired > 0) void load();
    // eslint-disable-next-line
  }, [expired]);

  const claim = async (v: EventView, o: EventObjective) => {
    if (busyKey) return;
    const key = `${v.event.id}:${o.id}`;
    setBusyKey(key);
    setLocal((s) => new Set(s).add(key));
    try {
      const r = await api.eventClaim(v.event.id, o.id);
      const rw = r.reward;
      if (rw.gear.length || rw.shards) setGot(rw);
      else toast('Đã nhận thưởng', 'ok');
    } catch (e) {
      // lỗi: bỏ trạng thái lạc quan, tải lại số thật
      setLocal((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      errToast(e);
    } finally {
      if (alive.current) setBusyKey('');
      void load();
    }
  };

  return (
    <div class="events">
      <ActHead title="Sự kiện" icon="events">
        <span class="ah-pill" title="Số sự kiện đang diễn ra">
          <Icon n="events" size={16} /> {list.length}
        </span>
      </ActHead>

      <div class="fade-wrap ev-wrap">
        <div class="ev-list scroll">
          {!data && !err && (
            <div class="ev-wait">
              <Spinner />
            </div>
          )}
          {!data && err && (
            <div class="ev-none">
              <p class="muted">Không tải được sự kiện.</p>
              <Btn kind="blue" small onClick={() => void load()}>Thử lại</Btn>
            </div>
          )}
          {data && list.length === 0 && (
            <div class="ev-none">
              <Icon n="events" size={56} />
              <b>Chưa có sự kiện nào, quay lại sau nhé</b>
            </div>
          )}
          {list.map((v) => {
            const claimed = new Set(v.claimed);
            for (const k of local) if (k.startsWith(`${v.event.id}:`)) claimed.add(k.slice(String(v.event.id).length + 1));
            return <EventCard key={v.event.id} v={v} claimed={claimed} busyKey={busyKey} onClaim={(o) => void claim(v, o)} />;
          })}
        </div>
      </div>

      {got && (
        <Modal title="Nhận thưởng" onClose={() => setGot(null)}>
          <div class="ev-got">
            <WalletChips w={got.wallet} />
            {got.shards && (
              <span class="ah-chip ev-shard">
                {HERO_BY_ID[got.shards.hero] && (
                  <span class="ev-shp">
                    <Portrait id={got.shards.hero} rarity={HERO_BY_ID[got.shards.hero].rarity} />
                  </span>
                )}
                <b>Mảnh x{got.shards.n}</b>
              </span>
            )}
          </div>
          <GearDrops ids={got.gear} />
          <Btn kind="green" onClick={() => setGot(null)}>Tuyệt!</Btn>
        </Modal>
      )}
    </div>
  );
}
