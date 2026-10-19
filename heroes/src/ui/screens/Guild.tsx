// Bang hội. Chưa có bang: tìm bang / lập bang. Đã có bang: đầu trang (cấp, EXP, thông báo) + 4 tab
// Thành viên / Boss / Hoạt động (điểm danh, quyên góp) / Chat. Trên PC ngang: chat luôn hiện ở cột phải.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BOSS_ATTACKS_PER_DAY,
  BOSS_CYCLE_DAYS,
  GUILD_CHAT_MAX,
  GUILD_CREATE_COST,
  GUILD_DONATE_PER_DAY,
  GUILD_DONATIONS,
  GUILD_MAX_LEVEL,
  GUILD_MAX_MEMBERS,
  GUILD_MIN_ACCOUNT_LEVEL,
  GUILD_NAME_MAX,
  GUILD_NAME_MIN,
  GUILD_NOTICE_MAX,
  guildCheckinReward,
  type GuildBossState,
  type GuildBrief,
  type GuildChatMsg,
  type GuildInfo,
  type GuildMember,
} from '@shared/heroes/guild';
import { dayKey, nextDayStart } from '@shared/heroes/quests';
import type { Element, Wallet } from '@shared/heroes/types';
import { api, me, serverNow } from '../../api';
import { powerOfOwned, squadPower } from '../../game';
import { errToast, fmt, go, returnTo, toast, useBusy } from '../../state';
import { Btn, ElemChip, Modal, Portrait, Spinner, useDesktopLand } from '../common';
import { Icon } from '../icons';
import { pad, Roster, SquadBoard, useSquadOps } from '../squadkit';
import { fmtCountdown } from './Events';
import { ActHead, ResetChip, useDayReset, WalletChips } from './activity';

type Tab = 'members' | 'boss' | 'acts' | 'chat';
const WALLET_KEYS: (keyof Wallet)[] = ['gold', 'gems', 'tickets', 'exp', 'stones'];
/** nguyên tố của boss theo chu kỳ (khớp bossSetup) */
export const BOSS_ELEMS: Element[] = ['forest', 'water', 'earth'];

/** ví thiếu loại nào trong chi phí `c` */
function lackOf(w: Wallet, c: Partial<Wallet>): Partial<Record<keyof Wallet, boolean>> {
  const o: Partial<Record<keyof Wallet, boolean>> = {};
  for (const k of WALLET_KEYS) if ((c[k] ?? 0) > w[k]) o[k] = true;
  return o;
}

/* ------------------------------ TÊN BANG: kiểm tra như server (validGuildName) ------------------------------ */
const NAME_RE = /^[\p{L}\p{M}\p{Nd}]+(?: [\p{L}\p{M}\p{Nd}]+)*$/u;
/** '' = hợp lệ; chuỗi khác = lý do (mirror server/guilds.ts validGuildName) */
export function guildNameError(raw: string): string {
  const n = raw.trim().normalize('NFC');
  if (n.length < GUILD_NAME_MIN || n.length > GUILD_NAME_MAX) return `Tên bang từ ${GUILD_NAME_MIN} đến ${GUILD_NAME_MAX} ký tự`;
  if (!NAME_RE.test(n)) return 'Tên bang chỉ gồm chữ, số và khoảng trắng đơn giữa các từ';
  return '';
}
const cleanLine = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim();

/* ------------------------------ THANH MÁU BOSS (dùng chung với màn kết quả) ------------------------------ */
export function BossHp({ hp, hpMax, killed, big }: { hp: number; hpMax: number; killed?: boolean; big?: boolean }) {
  const raw = hpMax > 0 ? (hp * 100) / hpMax : 0;
  const pct = hp <= 0 ? 0 : Math.max(1, Math.min(100, Math.ceil(raw)));
  return (
    <div class={`gld-hp${big ? ' big' : ''}${killed ? ' dead' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Máu boss">
      <i style={{ width: `${pct}%` }} />
      <span>
        {fmt(Math.max(0, hp))} / {fmt(hpMax)} · {pct}%
      </span>
    </div>
  );
}

/* ------------------------------ HỘP XÁC NHẬN ------------------------------ */
function Confirm({ title, text, ok, kind = 'red', onOk, onClose }: { title: string; text: string; ok: string; kind?: 'red' | 'green' | 'blue'; onOk: () => Promise<unknown>; onClose: () => void }) {
  const [busy, run] = useBusy();
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      <div class="btn-row">
        <Btn kind="ghost" onClick={onClose}>Huỷ</Btn>
        <Btn
          kind={kind}
          busy={busy}
          onClick={() =>
            void run(async () => {
              await onOk();
              onClose();
            })
          }
        >
          {ok}
        </Btn>
      </div>
    </Modal>
  );
}

/* ============================== CHƯA CÓ BANG ============================== */
function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const m = me.value!;
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, run] = useBusy();
  const err = name.trim() ? guildNameError(name) : '';
  const valid = !guildNameError(name);
  const lack = lackOf(m.wallet, GUILD_CREATE_COST);
  const lowLevel = m.profile.level < GUILD_MIN_ACCOUNT_LEVEL;
  const submit = () =>
    run(async () => {
      if (!valid) return toast(guildNameError(name), 'error');
      await api.guildCreate(name.trim().normalize('NFC'), cleanLine(notice).slice(0, GUILD_NOTICE_MAX));
      toast('Đã lập bang!', 'ok');
      onClose();
      onDone();
    });
  return (
    <Modal title="Lập bang" onClose={onClose}>
      <form
        class="gld-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label class="gld-fld">
          <span>Tên bang ({GUILD_NAME_MIN}-{GUILD_NAME_MAX} ký tự)</span>
          <input
            class="gld-input"
            value={name}
            maxLength={GUILD_NAME_MAX + 8}
            autoFocus
            autoComplete="off"
            placeholder="Ví dụ: Hổ Phách"
            aria-invalid={!!err}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <small class={err ? 'gld-err' : 'muted'}>{err || `${name.trim().length}/${GUILD_NAME_MAX} · chỉ chữ, số, khoảng trắng đơn giữa các từ`}</small>
        </label>
        <label class="gld-fld">
          <span>Thông báo (tuỳ chọn)</span>
          <input
            class="gld-input"
            value={notice}
            maxLength={GUILD_NOTICE_MAX}
            autoComplete="off"
            placeholder="Lời chào đến thành viên"
            onInput={(e) => setNotice((e.target as HTMLInputElement).value)}
          />
          <small class="muted">{notice.length}/{GUILD_NOTICE_MAX}</small>
        </label>
        <div class="gld-req">
          <span>Phí lập bang</span>
          <WalletChips w={GUILD_CREATE_COST} lack={lack} />
        </div>
        <div class={`gld-req${lowLevel ? ' bad' : ''}`}>
          <span>Yêu cầu</span>
          <span class={`ah-chip${lowLevel ? ' lack' : ''}`}>
            <Icon n="user" size={16} />
            <b>Cấp tài khoản {GUILD_MIN_ACCOUNT_LEVEL}</b>
          </span>
          <small class="muted">Bạn: cấp {m.profile.level}</small>
        </div>
        <div class="btn-row">
          <Btn kind="ghost" onClick={onClose}>Huỷ</Btn>
          <Btn kind="green" busy={busy} disabled={!valid} onClick={() => void submit()}>
            <Icon n="guild" size={20} /> Lập bang
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function BrowseCard({ g, busy, onJoin }: { g: GuildBrief; busy: boolean; onJoin: () => void }) {
  const full = g.members >= g.max;
  return (
    <div class="gld-card">
      <div class="gld-crest">
        <Icon n="guild" size={34} />
        <i class="gld-lvb">Lv {g.level}</i>
      </div>
      <div class="gld-cinfo">
        <b class="gld-cname">{g.name}</b>
        <small class="gld-cmeta">
          <Icon n="user" size={13} /> {g.members}/{g.max} · <Icon n="crown" size={13} /> {g.leader}
        </small>
        {g.notice && <small class="gld-cnote muted">{g.notice}</small>}
      </div>
      <Btn kind={full ? 'ghost' : 'blue'} small class="gld-join" busy={busy} disabled={full} onClick={onJoin}>
        {full ? 'Đã đầy' : 'Xin vào'}
      </Btn>
    </div>
  );
}

function Browse({ onJoined }: { onJoined: () => void }) {
  const m = me.value!;
  const [q, setQ] = useState('');
  const [list, setList] = useState<GuildBrief[] | null>(null);
  const [create, setCreate] = useState(false);
  const [joining, setJoining] = useState(0);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const search = (text: string) => {
    const my = ++seq.current;
    return api
      .guildSearch(text.trim())
      .then((r) => alive.current && my === seq.current && setList(r.guilds))
      .catch((e) => {
        if (alive.current && my === seq.current) {
          setList((l) => l ?? []);
          errToast(e);
        }
      });
  };
  // gõ xong 350 ms mới tìm; lần đầu (rỗng) tìm ngay
  useEffect(() => {
    const t = setTimeout(() => void search(q), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q]);

  const join = async (g: GuildBrief) => {
    if (joining) return;
    setJoining(g.id);
    try {
      await api.guildJoin(g.id);
      toast(`Đã vào bang ${g.name}`, 'ok');
      onJoined();
    } catch (e) {
      errToast(e); // 400 chưa đủ cấp / đang chờ, 409 bang đầy
      void search(q);
    } finally {
      if (alive.current) setJoining(0);
    }
  };

  return (
    <div class="gld-browse">
      <div class="gld-bar">
        <label class="gld-searchbox">
          <Icon n="search" size={20} />
          <input
            type="search"
            value={q}
            maxLength={40}
            placeholder="Tìm bang theo tên"
            aria-label="Tìm bang theo tên"
            autoComplete="off"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
        </label>
        <Btn kind="green" small class="gld-create" onClick={() => setCreate(true)}>
          <Icon n="plus" size={18} /> Lập bang
        </Btn>
      </div>
      {m.profile.level < GUILD_MIN_ACCOUNT_LEVEL && (
        <small class="gld-warn">Cần đạt cấp tài khoản {GUILD_MIN_ACCOUNT_LEVEL} để vào hoặc lập bang (bạn đang cấp {m.profile.level}).</small>
      )}
      <div class="fade-wrap gld-fw">
        <div class="gld-list scroll">
          {!list && (
            <div class="ev-wait">
              <Spinner />
            </div>
          )}
          {list && list.length === 0 && (
            <div class="gld-none">
              <Icon n="guild" size={48} />
              <b>{q.trim() ? 'Không tìm thấy bang nào' : 'Chưa có bang nào, hãy lập bang đầu tiên!'}</b>
            </div>
          )}
          {list?.map((g) => <BrowseCard key={g.id} g={g} busy={joining === g.id} onJoin={() => void join(g)} />)}
        </div>
      </div>
      {create && <CreateModal onClose={() => setCreate(false)} onDone={onJoined} />}
    </div>
  );
}

/* ============================== ĐÃ CÓ BANG ============================== */
function NoticeModal({ cur, onClose, onDone }: { cur: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(cur);
  const [busy, run] = useBusy();
  const save = () =>
    run(async () => {
      await api.guildNotice(cleanLine(text).slice(0, GUILD_NOTICE_MAX));
      toast('Đã cập nhật thông báo', 'ok');
      onClose();
      onDone();
    });
  return (
    <Modal title="Thông báo bang" onClose={onClose}>
      <label class="gld-fld">
        <span>Nội dung (tối đa {GUILD_NOTICE_MAX} ký tự)</span>
        <input class="gld-input" value={text} maxLength={GUILD_NOTICE_MAX} autoFocus autoComplete="off" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <small class="muted">{text.length}/{GUILD_NOTICE_MAX}</small>
      </label>
      <div class="btn-row">
        <Btn kind="ghost" onClick={onClose}>Huỷ</Btn>
        <Btn kind="green" busy={busy} onClick={() => void save()}>Lưu</Btn>
      </div>
    </Modal>
  );
}

function Header({ info, onReload }: { info: GuildInfo; onReload: () => void }) {
  const g = info.guild;
  const leader = info.mine.role === 'leader';
  const [edit, setEdit] = useState(false);
  const [leave, setLeave] = useState(false);
  const max = g.level >= GUILD_MAX_LEVEL;
  const pct = max ? 100 : Math.min(100, Math.floor((g.exp * 100) / g.expNext));
  const alone = info.members.length <= 1;
  return (
    <section class="gld-head panel">
      <div class="gld-crest sm">
        <Icon n="guild" size={34} />
      </div>
      <div class="gld-hinfo">
        <div class="gld-htop">
          <h3 class="gld-name">{g.name}</h3>
          <i class="gld-lvb">Lv {g.level}</i>
          <span class="ah-chip" title="Thành viên">
            <Icon n="user" size={14} /> {g.members}/{GUILD_MAX_MEMBERS}
          </span>
        </div>
        <div class="gld-xp xpbar" title={max ? 'Cấp tối đa' : `${g.exp}/${g.expNext}`}>
          <i style={{ width: `${pct}%` }} />
          <span>{max ? 'Cấp tối đa' : `EXP ${fmt(g.exp)}/${fmt(g.expNext)}`}</span>
        </div>
        <div class="gld-notice">
          <small class="gld-ntext">{g.notice || (leader ? 'Chưa có thông báo. Chạm nút bút để viết.' : 'Bang chưa có thông báo.')}</small>
        </div>
      </div>
      <div class="gld-hbtns">
        {leader && (
          <button type="button" class="ibtn" aria-label="Sửa thông báo" title="Sửa thông báo" onClick={() => setEdit(true)}>
            <Icon n="info" size={22} />
          </button>
        )}
        <button type="button" class="ibtn" aria-label="Rời bang" title="Rời bang" onClick={() => setLeave(true)}>
          <Icon n="logout" size={22} />
        </button>
      </div>
      {edit && <NoticeModal cur={g.notice} onClose={() => setEdit(false)} onDone={onReload} />}
      {leave && (
        <Confirm
          title="Rời bang?"
          text={
            leader && !alone
              ? 'Bạn là bang chủ, hãy chuyển quyền cho thành viên khác trước khi rời bang.'
              : leader
                ? 'Bạn là người duy nhất, rời bang sẽ giải tán bang. Sau khi rời phải chờ vài giờ mới vào được bang khác.'
                : 'Sau khi rời phải chờ vài giờ mới vào được bang khác.'
          }
          ok="Rời bang"
          onOk={async () => {
            if (leader && !alone) {
              toast('Hãy chuyển quyền bang chủ trước', 'error');
              return;
            }
            await api.guildLeave();
            toast('Đã rời bang', 'ok');
            onReload();
          }}
          onClose={() => setLeave(false)}
        />
      )}
    </section>
  );
}

/* ---- tab Thành viên ---- */
function Members({ info, onReload }: { info: GuildInfo; onReload: () => void }) {
  const m = me.value!;
  const leader = info.mine.role === 'leader';
  const [ask, setAsk] = useState<{ kind: 'kick' | 'transfer'; who: GuildMember } | null>(null);
  return (
    <div class="fade-wrap gld-fw">
      <div class="gld-members scroll">
        {info.members.map((u, i) => {
          const mine = u.username === m.profile.username;
          return (
            <div key={u.id} class={`gld-mem${mine ? ' me' : ''}`}>
              <span class="gld-rk">{i + 1}</span>
              <div class="gld-minfo">
                <div class="gld-mtop">
                  <b class="gld-uname">{u.username}</b>
                  {mine && <small class="gld-you">Bạn</small>}
                  {u.role === 'leader' && (
                    <span class="gld-role" title="Bang chủ">
                      <Icon n="crown" size={14} /> Bang chủ
                    </span>
                  )}
                </div>
                <div class="gld-mstats">
                  <span title="Điểm cống hiến"><Icon n="star" size={13} /> {fmt(u.contribution)}</span>
                  <span title="Sát thương boss chu kỳ này"><Icon n="boss" size={13} /> {fmt(u.bossDamage)}</span>
                </div>
              </div>
              {leader && u.role !== 'leader' && (
                <div class="gld-macts">
                  <Btn kind="blue" small onClick={() => setAsk({ kind: 'transfer', who: u })}>Chuyển quyền</Btn>
                  <Btn kind="red" small onClick={() => setAsk({ kind: 'kick', who: u })}>Kick</Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {ask && (
        <Confirm
          title={ask.kind === 'kick' ? 'Đuổi thành viên?' : 'Chuyển quyền bang chủ?'}
          text={
            ask.kind === 'kick'
              ? `${ask.who.username} sẽ bị mời ra khỏi bang.`
              : `${ask.who.username} sẽ trở thành bang chủ mới, bạn chỉ còn là thành viên.`
          }
          ok={ask.kind === 'kick' ? 'Kick' : 'Chuyển quyền'}
          kind={ask.kind === 'kick' ? 'red' : 'blue'}
          onOk={async () => {
            if (ask.kind === 'kick') await api.guildKick(ask.who.id);
            else await api.guildTransfer(ask.who.id);
            toast(ask.kind === 'kick' ? `Đã mời ${ask.who.username} ra khỏi bang` : `${ask.who.username} là bang chủ mới`, 'ok');
            onReload();
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  );
}

/* ---- tab Boss ---- */
function BossPane({ info }: { info: GuildInfo }) {
  const m = me.value!;
  const [busy, run] = useBusy();
  const b: GuildBossState = info.boss;
  const base = pad(m.squads[m.activeSquad]);
  const [slots, setSlots] = useState<string[]>(base);
  const ops = useSquadOps(slots, setSlots, { closeWhenFull: true });
  const count = slots.filter(Boolean).length;
  const dirty = slots.join('|') !== base.join('|');
  const mine = squadPower(m, slots);
  const heroes = useMemo(
    () => m.heroes.slice().sort((a, c) => powerOfOwned(c) - powerOfOwned(a)),
    // eslint-disable-next-line
    [m.heroes],
  );
  // boss hồi máu khi hết chu kỳ 7 ngày
  const now = serverNow();
  const daysLeft = (b.cycle + 1) * BOSS_CYCLE_DAYS - dayKey(now);
  const endMs = nextDayStart(now) + (daysLeft - 1) * 86_400_000;
  const tries = info.mine.bossTries;
  const blocked = b.killed || b.hp <= 0 ? 'Boss đã bị hạ, chờ chu kỳ mới để đánh tiếp' : tries <= 0 ? 'Hết lượt đánh boss hôm nay' : count === 0 ? 'Hãy xếp ít nhất 1 tướng' : '';
  const rank = useMemo(() => info.members.filter((u) => u.bossDamage > 0).sort((a, c) => c.bossDamage - a.bossDamage), [info.members]);
  const total = rank.reduce((a, u) => a + u.bossDamage, 0);

  const begin = () =>
    run(async () => {
      if (blocked) return toast(blocked, 'info');
      if (dirty) await api.setSquad(m.activeSquad, slots, true);
      go({ n: 'battle', stage: 'guildboss' });
    });
  const toSquad = () => {
    returnTo.value = 'guild';
    go({ n: 'squad' });
  };

  return (
    <div class="gld-boss scroll">
      <section class={`gld-bcard panel${b.killed ? ' dead' : ''}`}>
        <div class="gld-bpic">
          <Portrait id="mk_chua" rarity="SSR" />
          {b.killed && <span class="gld-kill">ĐÃ HẠ</span>}
        </div>
        <div class="gld-binfo">
          <div class="gld-btop">
            <h3 class="gld-bname">{b.name}</h3>
            <ElemChip el={BOSS_ELEMS[b.cycle % 3]} />
            <span class="lvtag">Lv {b.level}</span>
          </div>
          <BossHp hp={b.hp} hpMax={b.hpMax} killed={b.killed} />
          <div class="gld-bmeta">
            <span class={`ah-chip${b.killed ? ' gear' : ''}`}>{b.killed ? 'Đã bị hạ' : 'Đang sống'}</span>
            <span class="ah-chip" title="Lượt đánh còn lại hôm nay">
              <Icon n="sword" size={14} /> <b>{tries}/{BOSS_ATTACKS_PER_DAY}</b>
            </span>
            <span class="ah-chip" title="Boss hồi đầy máu sau">
              <Icon n="clock" size={14} /> <b>{fmtCountdown(endMs - now)}</b>
            </span>
          </div>
        </div>
      </section>

      <section class="gld-bsquad panel">
        <div class="gld-sqh">
          <b>
            <Icon n="squad" size={16} /> Đội xuất trận
          </b>
          <span class="ar-pw">
            Lực <b>{fmt(mine)}</b>
          </span>
          <Btn kind="ghost" small onClick={toSquad}>Đội hình</Btn>
        </div>
        <SquadBoard m={m} slots={slots} sel={null} onTapSlot={ops.tapSlot} onDrop={ops.drop} compact />
        <Btn kind="primary" big class="gld-go" busy={busy} disabled={!!blocked} onClick={() => void begin()}>
          <Icon n="boss" size={28} /> ĐÁNH BOSS
        </Btn>
        {blocked && <small class="tw-note">{blocked}</small>}
      </section>

      <section class="gld-rank panel">
        <h3>
          <Icon n="crown" size={20} /> Sát thương chu kỳ này
        </h3>
        {rank.length === 0 ? (
          <p class="muted gld-rnone">Chưa ai đánh boss trong chu kỳ này.</p>
        ) : (
          <ol class="gld-rlist">
            {rank.map((u, i) => (
              <li key={u.id} class={u.username === m.profile.username ? 'me' : ''}>
                <span class="gld-rk">{i + 1}</span>
                <b class="gld-uname">{u.username}</b>
                <span class="gld-rbar">
                  <i style={{ width: `${Math.max(3, (u.bossDamage * 100) / (rank[0].bossDamage || 1))}%` }} />
                </span>
                <span class="gld-rdmg">{fmt(u.bossDamage)}</span>
              </li>
            ))}
          </ol>
        )}
        {rank.length > 0 && <small class="muted">Tổng cả bang: {fmt(total)}</small>}
      </section>

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

/* ---- tab Hoạt động ---- */
function Acts({ info, onReload }: { info: GuildInfo; onReload: () => void }) {
  const m = me.value!;
  const [busy, run] = useBusy();
  const lvl = info.guild.level;
  const reward = guildCheckinReward(lvl);
  const done = info.mine.checkedIn;
  const donated = info.mine.donated;
  const full = donated >= GUILD_DONATE_PER_DAY;
  const [key, setKey] = useState('');
  const checkin = () =>
    run(async () => {
      const r = await api.guildCheckin();
      const parts = WALLET_KEYS.filter((k) => (r.reward[k] ?? 0) > 0).map((k) => `${fmt(r.reward[k]!)} ${NAME[k]}`);
      toast(`Điểm danh thành công: ${parts.join(', ')}`, 'ok');
      onReload();
    });
  const donate = (id: string, gexp: number) =>
    run(async () => {
      setKey(id);
      await api.guildDonate(id);
      toast(`Đã quyên góp, bang +${gexp} EXP`, 'ok');
      onReload();
    });
  return (
    <div class="gld-acts scroll">
      <section class={`gld-act panel${done ? ' done' : ' ready'}`}>
        <div class="gld-aic">
          <Icon n="chest" size={40} />
        </div>
        <div class="gld-ainfo">
          <b class="gld-atitle">Điểm danh bang</b>
          <small class="muted">Mỗi ngày một lần, thưởng theo cấp bang (Lv {lvl}).</small>
          <div class="ev-rew">
            <WalletChips w={reward} />
          </div>
        </div>
        <Btn kind={done ? 'ghost' : 'green'} class="gld-abtn" busy={busy && !key} disabled={done} onClick={() => { setKey(''); void checkin(); }}>
          {done ? (
            <>
              <Icon n="check" size={18} /> Đã điểm danh
            </>
          ) : (
            'Điểm danh'
          )}
        </Btn>
      </section>

      <section class="gld-don panel">
        <div class="gld-donh">
          <h3>Quyên góp</h3>
          <span class="ah-pill" title="Lượt quyên góp hôm nay">
            <Icon n="plus" size={16} /> {donated}/{GUILD_DONATE_PER_DAY}
          </span>
        </div>
        <small class="muted">Quyên góp để tăng EXP bang và điểm cống hiến của bạn.</small>
        <div class="gld-dlist">
          {GUILD_DONATIONS.map((d) => {
            const lack = lackOf(m.wallet, d.cost);
            const poor = Object.keys(lack).length > 0;
            return (
              <div key={d.id} class="gld-dopt">
                <div class="gld-dcost">
                  <WalletChips w={d.cost} lack={lack} />
                </div>
                <div class="gld-dgain">
                  <span class="ah-chip">+{d.gexp} EXP bang</span>
                  <span class="ah-chip">
                    <Icon n="star" size={14} /> +{d.contribution}
                  </span>
                </div>
                <Btn kind="blue" small class="gld-dbtn" busy={busy && key === d.id} disabled={full || poor} onClick={() => void donate(d.id, d.gexp)}>
                  {full ? 'Hết lượt' : poor ? 'Thiếu tiền' : 'Quyên góp'}
                </Btn>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
const NAME: Record<keyof Wallet, string> = { gold: 'vàng', gems: 'kim cương', tickets: 'vé', exp: 'EXP', stones: 'đá' };

/* ---- tab Chat ---- */
const CHAT_GAP_MS = 1600;
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function Chat() {
  const m = me.value!;
  const [msgs, setMsgs] = useState<GuildChatMsg[] | null>(null);
  const [text, setText] = useState('');
  const [cool, setCool] = useState(false);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // đang ở đáy -> tin mới tự cuộn xuống
  const lastSend = useRef(0);
  const alive = useRef(true);

  const apply = (list: GuildChatMsg[]) => {
    if (!alive.current) return;
    setMsgs((old) => (old && old.length === list.length && old[old.length - 1]?.id === list[list.length - 1]?.id ? old : list));
  };
  const poll = () => {
    if (document.hidden) return; // tab trình duyệt đang ẩn: không hỏi
    void api.guildChat().then((r) => apply(r.messages)).catch(() => {});
  };
  // Component chỉ tồn tại khi tab Chat đang mở -> chỉ hỏi 5 s/lần trong lúc đó
  useEffect(() => {
    alive.current = true;
    void api.guildChat().then((r) => apply(r.messages)).catch((e) => { errToast(e); if (alive.current) setMsgs([]); });
    const t = setInterval(poll, 5000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
    // eslint-disable-next-line
  }, []);
  useEffect(() => {
    const b = box.current;
    if (b && stick.current) b.scrollTop = b.scrollHeight;
  }, [msgs]);

  const send = async () => {
    const t = cleanLine(text);
    if (!t || sending) return;
    const now = Date.now();
    if (now - lastSend.current < CHAT_GAP_MS) return;
    lastSend.current = now;
    setSending(true);
    setCool(true);
    setTimeout(() => alive.current && setCool(false), CHAT_GAP_MS);
    try {
      const r = await api.guildChatPost(t.slice(0, GUILD_CHAT_MAX));
      setText('');
      stick.current = true;
      apply(r.messages);
    } catch (e) {
      errToast(e); // 429 nhắn quá nhanh, 403 chưa vào bang
    } finally {
      if (alive.current) setSending(false);
    }
  };

  return (
    <div class="gld-chat">
      <div
        class="gld-msgs scroll"
        ref={box}
        onScroll={(e) => {
          const b = e.currentTarget;
          stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
        }}
      >
        {!msgs && (
          <div class="ev-wait">
            <Spinner />
          </div>
        )}
        {msgs && msgs.length === 0 && <p class="muted gld-cnone">Chưa có tin nhắn nào. Hãy chào cả bang!</p>}
        {msgs?.map((x) => (
          <div key={x.id} class={`gld-msg${x.username === m.profile.username ? ' me' : ''}`}>
            <div class="gld-mhead">
              <b>{x.username}</b>
              <small>{hhmm(x.at)}</small>
            </div>
            <p class="gld-mtext">{x.text}</p>
          </div>
        ))}
      </div>
      <form
        class="gld-send"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          class="gld-input"
          value={text}
          maxLength={GUILD_CHAT_MAX}
          placeholder="Nhắn cho cả bang..."
          aria-label="Tin nhắn"
          autoComplete="off"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <Btn kind="blue" small class="gld-sendb" busy={sending} disabled={cool || !text.trim()} onClick={() => void send()}>
          Gửi
        </Btn>
      </form>
    </div>
  );
}

/* ---- khung bang ---- */
const TAB_LABEL: Record<Tab, string> = { members: 'Thành viên', boss: 'Boss', acts: 'Hoạt động', chat: 'Chat' };
const TAB_ICON = { members: 'user', boss: 'boss', acts: 'chest', chat: 'chat' } as const;

function Home({ info, onReload, first }: { info: GuildInfo; onReload: () => void; first?: Tab }) {
  const side = useDesktopLand();
  const [tab0, setTab] = useState<Tab>(first ?? 'members');
  // PC ngang: chat luôn nằm cột phải nên tab Chat không còn trong dải tab
  const tabs: Tab[] = side ? ['members', 'boss', 'acts'] : ['members', 'boss', 'acts', 'chat'];
  const tab = tabs.includes(tab0) ? tab0 : 'members';
  return (
    <div class="gld-home">
      <Header info={info} onReload={onReload} />
      <div class="gld-cols">
        <div class="gld-main">
          <div class="seg wide gld-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" class={tab === t ? 'on' : ''} aria-selected={tab === t} onClick={() => setTab(t)}>
                <Icon n={TAB_ICON[t]} size={18} /> <span>{TAB_LABEL[t]}</span>
              </button>
            ))}
          </div>
          <div class="gld-pane">
            {tab === 'members' && <Members info={info} onReload={onReload} />}
            {tab === 'boss' && <BossPane info={info} />}
            {tab === 'acts' && <Acts info={info} onReload={onReload} />}
            {tab === 'chat' && <Chat />}
          </div>
        </div>
        {side && (
          <aside class="gld-side panel">
            <h3>
              <Icon n="chat" size={20} /> Chat bang
            </h3>
            <Chat />
          </aside>
        )}
      </div>
    </div>
  );
}

export function Guild({ tab }: { tab?: Tab }) {
  const left = useDayReset();
  const [info, setInfo] = useState<GuildInfo | null | undefined>(undefined);
  const alive = useRef(true);
  const load = () =>
    api
      .guild()
      .then((r) => alive.current && setInfo(r.info))
      .catch((e) => {
        if (!alive.current) return;
        errToast(e);
        setInfo((o) => (o === undefined ? null : o));
      });
  // sau khi vào/rời/lập bang: tải lại thông tin bang và hồ sơ (guildId, ví)
  const reload = () => {
    void load();
    void api.refresh().catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => void (alive.current = false);
    // eslint-disable-next-line
  }, []);

  return (
    <div class="guild">
      <ActHead title="Bang hội" icon="guild">
        {info && (
          <span class="ah-pill" title="Lượt đánh boss còn lại hôm nay">
            <Icon n="boss" size={16} /> {info.mine.bossTries}/{BOSS_ATTACKS_PER_DAY}
          </span>
        )}
        <ResetChip left={left} />
      </ActHead>
      {info === undefined ? (
        <div class="ev-wait">
          <Spinner />
        </div>
      ) : info === null ? (
        <Browse onJoined={reload} />
      ) : (
        <Home info={info} onReload={reload} first={tab} />
      )}
    </div>
  );
}
