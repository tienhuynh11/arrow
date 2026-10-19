// Trang quản trị SỰ KIỆN (công cụ cho chủ game): /heroes/admin.html. Không dùng service worker, không dùng CSS của game.
// Khoá admin chỉ lưu sessionStorage, gửi qua header `x-admin-key`. Quy tắc kiểm tra khớp server/src/heroes/events.ts.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { HEROES_API } from '@shared/heroes/config';
import type { AdminEventSaveReq, AdminEventsRes } from '@shared/heroes/api';
import {
  EVENT_KINDS,
  EVENT_KIND_NAME,
  EVENT_MAX_OBJECTIVES,
  EVENT_NAME_MAX,
  EVENT_WALLET_CAP,
  type EventDef,
  type EventKind,
  type EventObjective,
} from '@shared/heroes/events';
import { GEAR_BY_ID, GEAR_DEFS, GEAR_SLOT_NAME, GEAR_SLOTS } from '@shared/heroes/gear';
import { HERO_BY_ID, HEROES } from '@shared/heroes/heroes';
import type { Wallet } from '@shared/heroes/types';
import './admin.css';

/* giới hạn của server (events.ts) mà shared chưa xuất */
const DESC_MAX = 300;
const OBJ_NAME_MAX = 60;
const TARGET_MAX = 100_000;
const GEAR_MAX = 5;
const SHARDS_MAX = 1000;

const KEY_STORE = 'heroes-admin-key';
const WALLET: { k: keyof Wallet; label: string }[] = [
  { k: 'gold', label: 'Vàng' },
  { k: 'gems', label: 'Kim cương' },
  { k: 'tickets', label: 'Vé' },
  { k: 'exp', label: 'EXP bình' },
  { k: 'stones', label: 'Đá' },
];

/* ------------------------------ gọi API ------------------------------ */
function getKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}
function setKey(v: string) {
  try {
    if (v) sessionStorage.setItem(KEY_STORE, v);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* bỏ qua */
  }
}

class AdminError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

async function call<T>(route: string, key: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-admin-key': key };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${HEROES_API}${route}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AdminError(0, 'Không kết nối được máy chủ');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* không phải JSON */
  }
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = (data && typeof data.error === 'string' && data.error) || `Lỗi máy chủ (${res.status})`;
    throw new AdminError(res.status, res.status === 403 ? `${msg} (kiểm tra khoá admin / biến MONKEY_ADMIN_KEY của server)` : msg);
  }
  return data as T;
}

/* ------------------------------ bản nháp ------------------------------ */
interface ObjDraft {
  id: string;
  kind: EventKind;
  name: string;
  target: string;
  wallet: Record<keyof Wallet, string>;
  shardHero: string;
  shardN: string;
  gear: string[];
}
interface Draft {
  id?: number;
  name: string;
  desc: string;
  start: string;
  end: string;
  enabled: boolean;
  banner: string;
  objs: ObjDraft[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** ms epoch -> chuỗi cho <input type=datetime-local> theo giờ máy */
function toLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** chuỗi datetime-local (giờ máy) -> ms epoch; NaN nếu rỗng/sai */
const fromLocal = (s: string): number => (s ? new Date(s).getTime() : Number.NaN);
const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const emptyWallet = (): Record<keyof Wallet, string> => ({ gold: '', gems: '', tickets: '', exp: '', stones: '' });
function newObj(objs: ObjDraft[]): ObjDraft {
  // id mới = số lớn nhất đang có + 1: id đã cấp KHÔNG bao giờ đổi (tiến trình/nhận thưởng của người chơi gắn theo id)
  let max = 0;
  for (const o of objs) {
    const m = /^o(\d+)$/.exec(o.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return { id: `o${Math.max(max, objs.length) + 1}`, kind: 'win', name: '', target: '1', wallet: emptyWallet(), shardHero: '', shardN: '', gear: [] };
}
function blankDraft(): Draft {
  const now = Date.now();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  return { name: '', desc: '', start: toLocal(start.getTime()), end: toLocal(start.getTime() + 7 * 86_400_000), enabled: true, banner: '', objs: [newObj([])] };
}
function toDraft(e: EventDef): Draft {
  return {
    id: e.id,
    name: e.name,
    desc: e.desc,
    start: toLocal(e.startsAt),
    end: toLocal(e.endsAt),
    enabled: e.enabled,
    banner: e.banner ?? '',
    objs: e.objectives.map((o) => {
      const w = emptyWallet();
      for (const x of WALLET) w[x.k] = o.reward.wallet?.[x.k] ? String(o.reward.wallet[x.k]) : '';
      return {
        id: o.id,
        kind: o.kind,
        name: o.name,
        target: String(o.target),
        wallet: w,
        shardHero: o.reward.shards?.hero ?? '',
        shardN: o.reward.shards ? String(o.reward.shards.n) : '',
        gear: [...(o.reward.gear ?? [])],
      };
    }),
  };
}

const isInt = (s: string) => /^\d+$/.test(s.trim());

/** danh sách lỗi (rỗng = hợp lệ), cùng luật với validateEventInput của server */
function validate(d: Draft): string[] {
  const er: string[] = [];
  const name = d.name.trim();
  if (name.length < 1 || name.length > EVENT_NAME_MAX) er.push(`Tên sự kiện từ 1 đến ${EVENT_NAME_MAX} ký tự`);
  if (d.desc.length > DESC_MAX) er.push(`Mô tả tối đa ${DESC_MAX} ký tự`);
  const s = fromLocal(d.start);
  const e = fromLocal(d.end);
  if (Number.isNaN(s) || Number.isNaN(e)) er.push('Chưa chọn đủ thời gian bắt đầu / kết thúc');
  else if (s >= e) er.push('Thời gian bắt đầu phải trước thời gian kết thúc');
  if (d.banner && !HERO_BY_ID[d.banner]) er.push('Tướng làm hình đại diện không tồn tại');
  if (d.objs.length > EVENT_MAX_OBJECTIVES) er.push(`Tối đa ${EVENT_MAX_OBJECTIVES} mục tiêu`);
  const seen = new Set<string>();
  d.objs.forEach((o, i) => {
    const at = `Mục tiêu ${i + 1}`;
    if (!/^[a-z0-9_]{1,16}$/.test(o.id)) er.push(`${at}: id không hợp lệ`);
    if (seen.has(o.id)) er.push(`${at}: id "${o.id}" bị trùng`);
    seen.add(o.id);
    const on = o.name.trim().length;
    if (on < 1 || on > OBJ_NAME_MAX) er.push(`${at}: tên từ 1 đến ${OBJ_NAME_MAX} ký tự`);
    const t = Number(o.target);
    if (!isInt(o.target) || t < 1 || t > TARGET_MAX) er.push(`${at}: mục tiêu phải là số nguyên 1..${TARGET_MAX}`);
    for (const x of WALLET) {
      const v = o.wallet[x.k].trim();
      if (v !== '' && (!isInt(v) || Number(v) > EVENT_WALLET_CAP)) er.push(`${at}: ${x.label} phải là số nguyên 0..${EVENT_WALLET_CAP}`);
    }
    const hasHero = !!o.shardHero;
    const hasN = o.shardN.trim() !== '';
    if (hasHero !== hasN) er.push(`${at}: mảnh tướng cần chọn cả tướng và số mảnh`);
    else if (hasHero && (!HERO_BY_ID[o.shardHero] || !isInt(o.shardN) || Number(o.shardN) < 1 || Number(o.shardN) > SHARDS_MAX)) er.push(`${at}: số mảnh phải từ 1 đến ${SHARDS_MAX}`);
    if (o.gear.length > GEAR_MAX) er.push(`${at}: tối đa ${GEAR_MAX} trang bị`);
  });
  return er;
}

function toReq(d: Draft): AdminEventSaveReq {
  const objectives: EventObjective[] = d.objs.map((o) => {
    const wallet: Partial<Wallet> = {};
    for (const x of WALLET) {
      const v = Number(o.wallet[x.k] || 0);
      if (v > 0) wallet[x.k] = v;
    }
    const reward: EventObjective['reward'] = {};
    if (Object.keys(wallet).length) reward.wallet = wallet;
    if (o.shardHero && o.shardN.trim()) reward.shards = { hero: o.shardHero, n: Number(o.shardN) };
    if (o.gear.length) reward.gear = [...o.gear];
    return { id: o.id, kind: o.kind, name: o.name.trim(), target: Number(o.target), reward };
  });
  const ev: AdminEventSaveReq['event'] = { name: d.name.trim(), desc: d.desc, startsAt: fromLocal(d.start), endsAt: fromLocal(d.end), enabled: d.enabled, objectives };
  if (d.banner) ev.banner = d.banner;
  if (d.id !== undefined) ev.id = d.id;
  return { event: ev };
}

function statusOf(e: EventDef, now: number): { t: string; c: string } {
  if (!e.enabled) return { t: 'Tắt', c: 'off' };
  if (now < e.startsAt) return { t: 'Sắp tới', c: 'soon' };
  if (now >= e.endsAt) return { t: 'Đã kết thúc', c: 'end' };
  return { t: 'Đang diễn ra', c: 'live' };
}

/* ------------------------------ lựa chọn tướng / trang bị ------------------------------ */
const RARITY_ORDER = ['UR', 'SSR', 'SR', 'R'] as const;
function HeroSelect({ value, onChange, empty, label }: { value: string; onChange: (v: string) => void; empty: string; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{empty}</option>
      {RARITY_ORDER.map((r) => (
        <optgroup key={r} label={`Hạng ${r}`}>
          {HEROES.filter((h) => h.rarity === r).map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.id})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function GearPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [pick, setPick] = useState('');
  const full = value.length >= GEAR_MAX;
  return (
    <div class="gear">
      <div class="gear-chips">
        {value.length === 0 && <span class="muted">Chưa chọn trang bị</span>}
        {value.map((id, i) => (
          <span class="chip" key={`${id}${i}`}>
            {GEAR_BY_ID[id]?.name ?? id} <em>{GEAR_BY_ID[id]?.rarity}</em>
            <button type="button" aria-label="Bỏ trang bị" onClick={() => onChange(value.filter((_, k) => k !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div class="row">
        <select aria-label="Chọn trang bị" value={pick} onChange={(e) => setPick((e.target as HTMLSelectElement).value)}>
          <option value="">Chọn trang bị để thêm...</option>
          {GEAR_SLOTS.map((slot) => (
            <optgroup key={slot} label={GEAR_SLOT_NAME[slot]}>
              {GEAR_DEFS.filter((g) => g.slot === slot)
                .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.rarity}] {g.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          class="btn"
          disabled={!pick || full}
          onClick={() => {
            onChange([...value, pick]);
            setPick('');
          }}
        >
          Thêm{full ? ` (tối đa ${GEAR_MAX})` : ''}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ bộ sửa mục tiêu ------------------------------ */
function ObjEditor({
  o,
  i,
  n,
  onChange,
  onMove,
  onRemove,
}: {
  o: ObjDraft;
  i: number;
  n: number;
  onChange: (p: Partial<ObjDraft>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset class="obj">
      <legend>
        Mục tiêu {i + 1} <code>{o.id}</code>
      </legend>
      <div class="obj-tools">
        <button type="button" class="btn sm" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Lên">
          Lên
        </button>
        <button type="button" class="btn sm" disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Xuống">
          Xuống
        </button>
        <button type="button" class="btn sm danger" onClick={onRemove}>
          Xoá
        </button>
      </div>
      <div class="grid2">
        <label>
          Loại tiến trình
          <select value={o.kind} onChange={(e) => onChange({ kind: (e.target as HTMLSelectElement).value as EventKind })}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_NAME[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mục tiêu (số lần, 1..{TARGET_MAX})
          <input type="number" min={1} max={TARGET_MAX} step={1} inputMode="numeric" value={o.target} onInput={(e) => onChange({ target: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <label>
        Tên hiển thị
        <input value={o.name} maxLength={OBJ_NAME_MAX} placeholder="Ví dụ: Thắng 10 trận chiến dịch" onInput={(e) => onChange({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <div class="sub">Thưởng ví (để trống = 0)</div>
      <div class="wallet">
        {WALLET.map((x) => (
          <label key={x.k}>
            {x.label}
            <input
              type="number"
              min={0}
              max={EVENT_WALLET_CAP}
              step={1}
              inputMode="numeric"
              value={o.wallet[x.k]}
              onInput={(e) => onChange({ wallet: { ...o.wallet, [x.k]: (e.target as HTMLInputElement).value } })}
            />
          </label>
        ))}
      </div>
      <div class="sub">Mảnh tướng (tuỳ chọn)</div>
      <div class="row">
        <HeroSelect value={o.shardHero} onChange={(v) => onChange({ shardHero: v })} empty="Không tặng mảnh" label="Tướng nhận mảnh" />
        <input
          class="narrow"
          type="number"
          min={1}
          max={SHARDS_MAX}
          step={1}
          inputMode="numeric"
          placeholder="Số mảnh"
          aria-label="Số mảnh"
          value={o.shardN}
          disabled={!o.shardHero}
          onInput={(e) => onChange({ shardN: (e.target as HTMLInputElement).value })}
        />
      </div>
      <div class="sub">Trang bị (tối đa {GEAR_MAX}, tuỳ chọn)</div>
      <GearPicker value={o.gear} onChange={(v) => onChange({ gear: v })} />
    </fieldset>
  );
}

/* ------------------------------ bộ sửa sự kiện ------------------------------ */
function Editor({ init, adminKey, onClose, onSaved }: { init: Draft; adminKey: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [d, setD] = useState<Draft>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problems = useMemo(() => validate(d), [d]);
  const set = (p: Partial<Draft>) => setD((o) => ({ ...o, ...p }));
  const setObj = (i: number, p: Partial<ObjDraft>) => setD((o) => ({ ...o, objs: o.objs.map((x, k) => (k === i ? { ...x, ...p } : x)) }));
  const move = (i: number, dir: -1 | 1) =>
    setD((o) => {
      const a = o.objs.slice();
      const j = i + dir;
      if (j < 0 || j >= a.length) return o;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...o, objs: a };
    });

  const save = async () => {
    if (busy || problems.length) return;
    setBusy(true);
    setErr('');
    try {
      await call<{ event: EventDef }>('admin/event-save', adminKey, toReq(d));
      onSaved(d.id === undefined ? 'Đã tạo sự kiện' : 'Đã lưu sự kiện');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="card editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="head">
        <h2>{d.id === undefined ? 'Tạo sự kiện' : `Sửa sự kiện #${d.id}`}</h2>
        <button type="button" class="btn" onClick={onClose}>
          Quay lại danh sách
        </button>
      </div>

      <label>
        Tên sự kiện ({d.name.trim().length}/{EVENT_NAME_MAX})
        <input value={d.name} maxLength={EVENT_NAME_MAX + 10} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <label>
        Mô tả ({d.desc.length}/{DESC_MAX})
        <textarea rows={3} value={d.desc} maxLength={DESC_MAX + 20} onInput={(e) => set({ desc: (e.target as HTMLTextAreaElement).value })} />
      </label>
      <div class="grid2">
        <label>
          Bắt đầu (giờ máy bạn)
          <input type="datetime-local" value={d.start} onInput={(e) => set({ start: (e.target as HTMLInputElement).value })} />
        </label>
        <label>
          Kết thúc (giờ máy bạn)
          <input type="datetime-local" value={d.end} onInput={(e) => set({ end: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <div class="grid2">
        <label>
          Tướng làm hình đại diện
          <HeroSelect value={d.banner} onChange={(v) => set({ banner: v })} empty="Không có" label="Tướng đại diện" />
        </label>
        <label class="check">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: (e.target as HTMLInputElement).checked })} />
          Bật sự kiện (tắt = ẩn với người chơi)
        </label>
      </div>

      <h3>
        Mục tiêu ({d.objs.length}/{EVENT_MAX_OBJECTIVES})
      </h3>
      {d.objs.map((o, i) => (
        <ObjEditor
          key={o.id}
          o={o}
          i={i}
          n={d.objs.length}
          onChange={(p) => setObj(i, p)}
          onMove={(dir) => move(i, dir)}
          onRemove={() => {
            if (confirm(`Xoá mục tiêu ${i + 1}? Tiến trình/phần đã nhận của người chơi với mục này sẽ không còn hiển thị.`)) setD((x) => ({ ...x, objs: x.objs.filter((_, k) => k !== i) }));
          }}
        />
      ))}
      <button type="button" class="btn" disabled={d.objs.length >= EVENT_MAX_OBJECTIVES} onClick={() => setD((x) => ({ ...x, objs: [...x.objs, newObj(x.objs)] }))}>
        + Thêm mục tiêu
      </button>

      {problems.length > 0 && (
        <ul class="problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {err && (
        <div class="msg err" role="alert">
          Máy chủ từ chối: {err}
        </div>
      )}
      <div class="foot">
        <button type="submit" class="btn primary" disabled={busy || problems.length > 0}>
          {busy ? 'Đang lưu...' : 'Lưu sự kiện'}
        </button>
        <button type="button" class="btn" onClick={onClose}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

/* ------------------------------ trang chính ------------------------------ */
function Admin() {
  const [key, setKeyState] = useState(getKey);
  const [input, setInput] = useState(getKey);
  const [events, setEvents] = useState<EventDef[] | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const now = Date.now();

  const load = async (k = key) => {
    if (!k) return;
    setBusy(true);
    try {
      const r = await call<AdminEventsRes>('admin/events', k);
      setEvents(r.events.slice().sort((a, b) => b.startsAt - a.startsAt));
      setMsg(null);
    } catch (e) {
      setEvents(null);
      setMsg({ t: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line
  }, []);

  const applyKey = () => {
    const k = input.trim();
    setKey(k);
    setKeyState(k);
    if (k) void load(k);
    else {
      setEvents(null);
      setMsg({ t: 'Hãy nhập khoá admin', ok: false });
    }
  };
  const remove = async (e: EventDef) => {
    if (!confirm(`Xoá vĩnh viễn sự kiện "${e.name}" (#${e.id})? Không thể hoàn tác.`)) return;
    setBusy(true);
    try {
      await call('admin/event-delete', key, { id: e.id });
      setMsg({ t: `Đã xoá "${e.name}"`, ok: true });
      await load();
    } catch (er) {
      setMsg({ t: (er as Error).message, ok: false });
      setBusy(false);
    }
  };
  const duplicate = (e: EventDef) => {
    const d = toDraft(e);
    delete d.id;
    d.name = `${e.name} (bản sao)`.slice(0, EVENT_NAME_MAX);
    d.enabled = false; // bản sao tắt sẵn để không lộ ra trước khi chỉnh
    setEdit(d);
  };

  return (
    <div class="wrap">
      <header class="top">
        <h1>Quản trị sự kiện</h1>
        <span class="muted">Thẻ Tướng 3D</span>
      </header>

      <form
        class="card keybar"
        onSubmit={(e) => {
          e.preventDefault();
          applyKey();
        }}
      >
        <label>
          Khoá admin (chỉ lưu trong tab này)
          <input type="password" autoComplete="off" value={input} placeholder="MONKEY_ADMIN_KEY" onInput={(e) => setInput((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" class="btn primary" disabled={busy}>
          {key ? 'Đổi khoá & tải lại' : 'Vào'}
        </button>
        {key && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              setKey('');
              setKeyState('');
              setInput('');
              setEvents(null);
              setEdit(null);
            }}
          >
            Xoá khoá
          </button>
        )}
      </form>

      {msg && (
        <div class={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">
          {msg.t}
        </div>
      )}

      {edit ? (
        <Editor
          init={edit}
          adminKey={key}
          onClose={() => setEdit(null)}
          onSaved={(t) => {
            setEdit(null);
            setMsg({ t, ok: true });
            void load();
          }}
        />
      ) : (
        key &&
        events && (
          <section class="card">
            <div class="head">
              <h2>Sự kiện ({events.length})</h2>
              <div class="row">
                <button type="button" class="btn" disabled={busy} onClick={() => void load()}>
                  Tải lại
                </button>
                <button type="button" class="btn primary" onClick={() => setEdit(blankDraft())}>
                  + Tạo sự kiện
                </button>
              </div>
            </div>
            {events.length === 0 && <p class="muted">Chưa có sự kiện nào.</p>}
            <div class="list">
              {events.map((e) => {
                const st = statusOf(e, now);
                return (
                  <article class="ev" key={e.id}>
                    <div class="ev-main">
                      <div class="ev-title">
                        <b>{e.name}</b>
                        <span class={`chip st-${st.c}`}>{st.t}</span>
                      </div>
                      <div class="muted">
                        #{e.id} · {fmtDate(e.startsAt)} → {fmtDate(e.endsAt)} · {e.objectives.length} mục tiêu
                        {e.banner && HERO_BY_ID[e.banner] ? ` · ${HERO_BY_ID[e.banner].name}` : ''}
                      </div>
                    </div>
                    <div class="row">
                      <button type="button" class="btn sm" onClick={() => setEdit(toDraft(e))}>
                        Sửa
                      </button>
                      <button type="button" class="btn sm" onClick={() => duplicate(e)}>
                        Nhân bản
                      </button>
                      <button type="button" class="btn sm danger" disabled={busy} onClick={() => void remove(e)}>
                        Xoá
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )
      )}
    </div>
  );
}

render(<Admin />, document.getElementById('admin')!);
