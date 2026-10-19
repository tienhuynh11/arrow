// Gói Tân thủ (giữ chân người mới): điểm danh 7 ngày (ngày 7 tặng UR Hầu Vương), hành trình 12 mốc, 10 lượt quay miễn phí chắc SSR+.
// Trạng thái lấy từ newbieView (signal trong api.ts); mọi thao tác nhận thưởng đều đổi hồ sơ `me` và trả view mới.
import { useEffect, useRef, useState } from 'preact/hooks';
import { GEAR_BY_ID } from '@shared/heroes/gear';
import { HERO_BY_ID, poolOf } from '@shared/heroes/heroes';
import { LOGIN7, MILESTONES, STARTER_SUMMON, type Login7Day, type Milestone, type MilestoneKind } from '@shared/heroes/newbie';
import { nextDayStart } from '@shared/heroes/quests';
import type { Wallet } from '@shared/heroes/types';
import { api, me, newbieView, serverNow } from '../../api';
import { sfx } from '../../audio';
import { nextStageOf } from '../../game';
import { errToast, fmt, fmtDur, go, toast, useBusy, useTicker, uuid, type Screen } from '../../state';
import { Btn, Portrait } from '../common';
import { GearDrops, GearTile } from '../gear';
import { Icon } from '../icons';
import { Reveal, type RevealPull } from '../reveal';
import { ActHead, WalletChips } from './activity';

type Tab = 'login' | 'journey' | 'free';
interface Rw {
  wallet?: Partial<Wallet>;
  shards?: { hero: string; n: number };
  gear?: string[];
}

const HV = 'hau_vuong';

/* ------------------------------ THƯỞNG ------------------------------ */
/** chip thưởng: tiền (icon), mảnh (chân dung tướng), trang bị (ô GearTile) */
function RewardChips({ r, tile = 34 }: { r: Rw; tile?: number }) {
  const sh = r.shards;
  const hero = sh ? HERO_BY_ID[sh.hero] : null;
  return (
    <span class="nb-rw">
      <WalletChips w={r.wallet ?? {}} />
      {sh && hero && (
        <span class="nb-shard" title={`${sh.n} mảnh ${hero.name}`}>
          <span class="nb-sp"><Portrait id={hero.id} rarity={hero.rarity} /></span>
          <b>+{sh.n}</b>
        </span>
      )}
      {(r.gear ?? []).map((g, i) => (GEAR_BY_ID[g] ? <GearTile key={`${g}${i}`} def={GEAR_BY_ID[g]} size={tile} /> : null))}
    </span>
  );
}

/** hộp thoại báo thưởng vừa nhận */
function RewardModal({ title, r, onClose }: { title: string; r: Rw; onClose: () => void }) {
  const sh = r.shards;
  const hero = sh ? HERO_BY_ID[sh.hero] : null;
  return (
    <div class="modal-back nb-rwback" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal nb-rwmodal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="modal-body nb-rwbody">
          <Icon n="gift" size={52} />
          <h2>{title}</h2>
          <div class="nb-rwline"><WalletChips w={r.wallet ?? {}} /></div>
          {sh && hero && (
            <div class="nb-rwhero">
              <span class="nb-sp big"><Portrait id={hero.id} rarity={hero.rarity} /></span>
              <b>{hero.name}</b>
              <span class="ah-chip">+{sh.n} mảnh</span>
            </div>
          )}
          <GearDrops ids={r.gear ?? []} />
          <Btn kind="green" big onClick={onClose}>Tuyệt!</Btn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ TAB 1: ĐIỂM DANH ------------------------------ */
type DayState = 'done' | 'today' | 'wait' | 'lock';

function DayCard({ d, st, onClaim }: { d: Login7Day; st: DayState; onClaim: () => void }) {
  const d7 = d.day === 7;
  const hero = d7 ? HERO_BY_ID[HV] : null;
  const act = st === 'today';
  return (
    <div
      class={`nb-day nb-${st}${d7 ? ' nb-d7' : ''}${d.big && !d7 ? ' nb-bigd' : ''}`}
      role={act ? 'button' : undefined}
      tabIndex={act ? 0 : undefined}
      aria-label={`Ngày ${d.day}: ${d.name}${st === 'done' ? ', đã nhận' : act ? ', bấm để nhận' : ''}`}
      onClick={act ? onClaim : undefined}
      onKeyDown={act ? (e) => (e.key === 'Enter' || e.key === ' ') && onClaim() : undefined}
    >
      <div class="nb-dh">
        <b>Ngày {d.day}</b>
        {st === 'done' && <span class="nb-tick"><Icon n="check" size={14} /></span>}
        {st === 'lock' && <Icon n="lock" size={14} />}
      </div>
      {d7 && hero ? (
        <div class="nb-d7body">
          <div class="nb-ur">
            <Portrait id={hero.id} rarity="UR" />
            <span class="nb-urtag">UR</span>
          </div>
          <div class="nb-d7txt">
            <b>{hero.name}</b>
            <small>Tướng UR đặc trưng. Đã có thì nhận +80 mảnh.</small>
          </div>
        </div>
      ) : (
        <>
          <small class="nb-dn">{d.name}</small>
          <RewardChips r={d.reward} />
        </>
      )}
      {act && <span class="nb-take">NHẬN</span>}
      {st === 'done' && <span class="nb-stamp" aria-hidden="true"><Icon n="check" size={30} /></span>}
    </div>
  );
}

function LoginTab({ onClaim, busy }: { onClaim: () => void; busy: boolean }) {
  const v = newbieView.value!;
  useTicker(1000);
  const { claimed, canClaim, next } = v.login;
  const all = next > 7;
  const left = Math.max(0, nextDayStart(serverNow()) - serverNow());
  const stOf = (day: number): DayState => (day < next ? 'done' : day === next ? (canClaim ? 'today' : 'wait') : 'lock');
  return (
    <div class="nb-pane">
      <div class="nb-days scroll">
        {LOGIN7.map((d) => (
          <DayCard key={d.day} d={d} st={stOf(d.day)} onClaim={onClaim} />
        ))}
      </div>
      <div class="nb-bar">
        {all ? (
          <Btn kind="ghost" big disabled><Icon n="check" size={20} /> Đã nhận đủ 7 ngày</Btn>
        ) : canClaim ? (
          <Btn kind="green" big busy={busy} onClick={onClaim}>NHẬN QUÀ NGÀY {next}</Btn>
        ) : (
          <div class="nb-wait">
            <Icon n="clock" size={22} />
            <span>
              <b>Hôm nay đã nhận, quay lại ngày mai</b>
              <small>Quà ngày {next} mở sau {fmtDur(left)}</small>
            </span>
          </div>
        )}
        <small class="nb-note">Bỏ lỡ ngày nào cũng không mất tiến trình ({claimed}/7 ngày đã nhận).</small>
      </div>
    </div>
  );
}

/* ------------------------------ TAB 2: HÀNH TRÌNH ------------------------------ */
interface Row {
  def: Milestone;
  progress: number;
  claimed: boolean;
  ready: boolean;
  ratio: number;
}

/** màn đích của nút "Đi tới" theo loại mốc */
function targetOf(kind: MilestoneKind): Screen {
  const m = me.value;
  switch (kind) {
    case 'stage': return { n: 'campaign', stage: m ? nextStageOf(m).id : undefined };
    case 'tower': return { n: 'tower' };
    case 'arenaWins': return { n: 'arena' };
    case 'guild': return { n: 'guild' };
    case 'pulls': return { n: 'summon' };
    default: return { n: 'heroes' }; // heroLevel / heroStar / heroCount / gearWorn
  }
}

function MsRow({ r, onClaim, busy }: { r: Row; onClaim: (id: string) => void; busy: boolean }) {
  const { def } = r;
  const pr = Math.min(def.target, r.progress);
  return (
    <div class={`nb-ms${r.ready ? ' ready' : ''}${r.claimed ? ' done' : ''}`}>
      <div class="nb-msi">
        <b class="nb-msn">{def.name}</b>
        <small class="nb-msd">{def.desc}</small>
        <div class="qs-bar" aria-label={`Tiến trình ${pr}/${def.target}`}>
          <i style={{ width: `${(pr * 100) / def.target}%` }} />
          <span>{fmt(pr)}/{fmt(def.target)}</span>
        </div>
        <RewardChips r={def.reward} tile={30} />
      </div>
      <div class="nb-msb">
        {r.claimed ? (
          <Btn kind="ghost" small disabled><Icon n="check" size={18} /> Đã nhận</Btn>
        ) : r.ready ? (
          <Btn kind="green" small busy={busy} onClick={() => onClaim(def.id)}>Nhận</Btn>
        ) : (
          <>
            <Btn kind="blue" small onClick={() => go(targetOf(def.kind))}>Đi tới</Btn>
            <small class="nb-lk"><Icon n="lock" size={12} /> Chưa xong</small>
          </>
        )}
      </div>
    </div>
  );
}

function JourneyTab({ onClaim, busy }: { onClaim: (id: string) => void; busy: boolean }) {
  const v = newbieView.value!;
  const [showDone, setShowDone] = useState(false);
  const rows: Row[] = MILESTONES.map((def) => {
    const st = v.milestones.find((x) => x.id === def.id);
    const progress = st?.progress ?? 0;
    const claimed = !!st?.claimed;
    return { def, progress, claimed, ready: !claimed && progress >= def.target, ratio: Math.min(1, progress / def.target) };
  });
  const ready = rows.filter((r) => r.ready);
  const prog = rows.filter((r) => !r.claimed && !r.ready).sort((a, b) => b.ratio - a.ratio);
  const done = rows.filter((r) => r.claimed);
  const nx = prog[0];
  return (
    <div class="nb-pane">
      <div class="nb-next" aria-live="polite">
        {nx ? (
          <>
            <span class="nb-nl"><Icon n="star" size={18} /> Mục tiêu tiếp theo: <b>{nx.def.name}</b> ({fmt(Math.min(nx.progress, nx.def.target))}/{fmt(nx.def.target)})</span>
            <div class="nb-mini"><i style={{ width: `${nx.ratio * 100}%` }} /></div>
          </>
        ) : ready.length ? (
          <span class="nb-nl"><Icon n="gift" size={18} /> Có <b>{ready.length}</b> phần thưởng đang chờ bạn nhận</span>
        ) : (
          <span class="nb-nl"><Icon n="crown" size={18} /> Hoàn thành toàn bộ Hành trình tân thủ!</span>
        )}
      </div>
      <div class="nb-mslist scroll">
        {ready.map((r) => <MsRow key={r.def.id} r={r} onClaim={onClaim} busy={busy} />)}
        {prog.map((r) => <MsRow key={r.def.id} r={r} onClaim={onClaim} busy={busy} />)}
        {done.length > 0 && (
          <>
            <button type="button" class="nb-fold" aria-expanded={showDone} onClick={() => setShowDone((x) => !x)}>
              <Icon n={showDone ? 'up' : 'down'} size={18} /> Đã nhận ({done.length})
            </button>
            {showDone && done.map((r) => <MsRow key={r.def.id} r={r} onClaim={onClaim} busy={busy} />)}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ TAB 3: QUAY MIỄN PHÍ ------------------------------ */
function FreeTab({ onSummon, busy }: { onSummon: () => void; busy: boolean }) {
  const v = newbieView.value!;
  const used = v.starterUsed;
  const top = poolOf('UR').concat(poolOf('SSR'));
  return (
    <div class="nb-pane">
      <div class="nb-ban">
        <span class="nb-banic"><Icon n="gift" size={44} /></span>
        <div>
          <h3>{STARTER_SUMMON.count} lượt quay MIỄN PHÍ</h3>
          <p>Chắc chắn có SSR trở lên! Chỉ một lần cho mỗi tài khoản.</p>
        </div>
      </div>
      <div class="nb-poolh"><b>Có thể nhận được</b> <small class="muted">tướng SSR và UR</small></div>
      <div class="nb-pool scroll">
        {top.map((h) => (
          <div key={h.id} class={`nb-pt nb-pt-${h.rarity}`} role="img" aria-label={`${h.name} (${h.rarity})`} title={h.name}>
            <Portrait id={h.id} rarity={h.rarity} />
            <span class="nb-ptr">{h.rarity}</span>
            <small>{h.name}</small>
          </div>
        ))}
      </div>
      <div class="nb-bar">
        {used ? (
          <>
            <Btn kind="ghost" big disabled><Icon n="check" size={20} /> Đã nhận</Btn>
            <small class="nb-note">Bạn đã dùng lượt quay tân thủ. Hãy tiếp tục ở mục Triệu hồi bằng vé và kim cương.</small>
            <Btn kind="blue" small onClick={() => go({ n: 'summon' })}>Tới Triệu hồi</Btn>
          </>
        ) : (
          <Btn kind="primary" big busy={busy} onClick={onSummon} class="nb-go">QUAY MIỄN PHÍ x{STARTER_SUMMON.count}</Btn>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ MÀN CHÍNH ------------------------------ */
export function Newbie() {
  const v = newbieView.value;
  const [tab, setTab] = useState<Tab | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useBusy();
  const [reveal, setReveal] = useState<{ pulls: RevealPull[]; title: string } | null>(null);
  const [rw, setRw] = useState<{ title: string; r: Rw } | null>(null);
  useTicker(1000);

  const load = async () => {
    try {
      await api.newbie();
      setFailed(false);
    } catch (e) {
      setFailed(true);
      errToast(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  // mở đúng tab đang có gì để nhận: tài khoản mới -> quay miễn phí trước
  useEffect(() => {
    if (!v || tab) return;
    const claimable = MILESTONES.some((d) => {
      const s = v.milestones.find((x) => x.id === d.id);
      return s && !s.claimed && s.progress >= d.target;
    });
    setTab(!v.starterUsed ? 'free' : v.login.canClaim && v.login.next <= 7 ? 'login' : claimable ? 'journey' : 'login');
  }, [v, tab]);

  // sang ngày mới (đếm ngược về 0) thì tải lại để mở quà ngày kế
  const left = nextDayStart(serverNow()) - serverNow();
  const fired = useRef(false);
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    const t = setTimeout(() => {
      void load().then(() => api.refresh().catch(() => {}));
      fired.current = false;
    }, 1500);
    return () => clearTimeout(t);
  }, [left <= 0]);

  const claimLogin = () =>
    run(async () => {
      sfx('claim');
      const r = await api.newbieLoginClaim();
      if (r.day === 7) {
        if (r.reward.heroGranted) {
          const id = r.reward.heroGranted;
          setReveal({ pulls: [{ heroId: id, rarity: HERO_BY_ID[id]?.rarity ?? 'UR', isNew: true, shards: 0 }], title: 'Quà tân thủ' });
        } else toast(`+${r.reward.shards?.n ?? 80} mảnh Đại Thánh Hầu Vương`, 'ok');
        return;
      }
      setRw({ title: `Điểm danh ngày ${r.day}`, r: r.reward });
    });

  const claimMs = (id: string) =>
    run(async () => {
      sfx('claim');
      const r = await api.newbieMilestoneClaim(id);
      const name = MILESTONES.find((x) => x.id === id)?.name ?? 'Mốc tân thủ';
      if (r.reward.shards || r.reward.gear.length) setRw({ title: name, r: r.reward });
      else toast(`Đã nhận thưởng: ${name}`, 'ok');
    });

  const starter = () =>
    run(async () => {
      try {
        const r = await api.newbieStarterSummon(uuid());
        setReveal({ pulls: r.pulls, title: 'Quà tân thủ' });
      } catch (e) {
        errToast(e); // đã dùng rồi / lỗi mạng: báo và đồng bộ lại trạng thái nút
        await load();
      }
    });

  const dotLogin = !!v && v.login.canClaim && v.login.next <= 7;
  const nJourney = v ? MILESTONES.filter((d) => { const s = v.milestones.find((x) => x.id === d.id); return s && !s.claimed && s.progress >= d.target; }).length : 0;
  const tabs: { id: Tab; label: string; dot: boolean | number }[] = [
    { id: 'login', label: 'Điểm danh 7 ngày', dot: dotLogin },
    { id: 'journey', label: 'Hành trình', dot: nJourney },
    { id: 'free', label: 'Quay miễn phí', dot: !!v && !v.starterUsed },
  ];

  return (
    <div class="nb">
      <ActHead title="Tân thủ" icon="gift">
        {v && (
          <span class="ah-pill" title="Số ngày điểm danh đã nhận">
            <Icon n="calendar" size={16} /> {v.login.claimed}/7
          </span>
        )}
      </ActHead>

      <div class="seg wide nb-tabs" role="tablist" aria-label="Mục Tân thủ">
        {tabs.map((t) => (
          <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => { sfx('tap'); setTab(t.id); }}>
            <span class="nb-tl">{t.label}</span>
            {typeof t.dot === 'number' ? (t.dot > 0 ? <i class="nb-td">{t.dot}</i> : null) : t.dot ? <i class="nb-td nb-dot" /> : null}
          </button>
        ))}
      </div>

      {!v || !tab ? (
        <div class="nb-load">
          {failed ? (
            <>
              <p>Không tải được dữ liệu Tân thủ.</p>
              <Btn kind="blue" onClick={() => void load()}>Thử lại</Btn>
            </>
          ) : (
            <p class="muted">Đang tải...</p>
          )}
        </div>
      ) : tab === 'login' ? (
        <LoginTab onClaim={() => void claimLogin()} busy={busy} />
      ) : tab === 'journey' ? (
        <JourneyTab onClaim={(id) => void claimMs(id)} busy={busy} />
      ) : (
        <FreeTab onSummon={() => void starter()} busy={busy} />
      )}

      {rw && <RewardModal title={rw.title} r={rw.r} onClose={() => setRw(null)} />}
      {reveal && <Reveal pulls={reveal.pulls} title={reveal.title} onClose={() => setReveal(null)} />}
    </div>
  );
}
