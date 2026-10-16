// Trang quản trị Bầy Khỉ (/monkey/admin.html): sự kiện hằng tuần (tạo / sửa / xoá), thống kê, tặng thưởng thử.
// Mọi request gửi header `x-admin-key` (khoá giữ trong sessionStorage, mất khi đóng tab).

import './styles.css';
import './admin.css';
import { API, type AdminEventRes, type AdminEventsRes, type AdminStatsRes, type EventDef, type EventObjective } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import { EVENT_STAGES, ITEMS, ITEM_BY_ID, RARITY, STAGES, type Rarity, type Reward } from '@shared/monkey/progression';
import { clear, h, toast } from './ui/dom';
import { sessionGet, sessionSet } from './settings';

const BASE = import.meta.env.BASE_URL;
const root = document.getElementById('admin')!;
let key = sessionGet('monkey-admin-key') ?? '';
let events: EventDef[] = [];
let editing: EventDef | null = null;

async function call<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-admin-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Không kết nối được máy chủ');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  if (!res.ok || (data && typeof data.error === 'string')) throw new Error(data?.error || `Lỗi ${res.status}`);
  return data as T;
}

/* ---------- tiện ích thời gian (datetime-local ↔ ISO) ---------- */
function toLocal(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocal(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function blankEvent(): EventDef {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  return {
    id: 0, name: '', icon: '🎉', desc: '', startsAt: now.toISOString(), endsAt: end.toISOString(), enabled: true,
    stage: EVENT_STAGES[0]?.id, objectives: [{ id: 'o1', kind: 'kills', target: 100, label: 'Hạ 100 khỉ', reward: { gold: 200 } }],
  };
}

/* ---------- ô nhập nhỏ ---------- */
function inp(value: string | number, onInput: (v: string) => void, attrs: Record<string, string> = {}) {
  const el = h('input', { value: String(value), ...attrs }) as HTMLInputElement;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
function num(value: number | undefined, onInput: (v: number | undefined) => void, ph = '0') {
  return inp(value ?? '', (v) => onInput(v === '' ? undefined : Math.max(0, Math.floor(Number(v)) || 0)), { type: 'number', min: '0', placeholder: ph, class: 'n' });
}
function sel(options: [string, string][], value: string, onChange: (v: string) => void) {
  const el = h('select') as HTMLSelectElement;
  for (const [v, l] of options) el.append(h('option', { value: v }, l));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
const field = (label: string, ...kids: (Node | string)[]) => h('label', { class: 'af' }, h('span', null, label), ...kids);

/** trình sửa phần thưởng */
function rewardEditor(r: Reward, onChange: () => void) {
  const box = h('div', { class: 'arw' });
  const draw = () => {
    clear(box);
    box.append(
      h('div', { class: 'arow' },
        field('🪙 Vàng', num(r.gold, (v) => { r.gold = v; onChange(); })),
        field('✨ XP', num(r.xp, (v) => { r.xp = v; onChange(); })),
        field('🧩 Mảnh', num(r.shards, (v) => { r.shards = v; onChange(); })),
        field('📘 Sách', num(r.books, (v) => { r.books = v; onChange(); })),
        field('🔓 Mở nhân vật', sel([['', '— không —'], ...CLASSES.map((c, i) => [String(i), c.name] as [string, string])], r.unlockChar === undefined ? '' : String(r.unlockChar), (v) => { r.unlockChar = v === '' ? undefined : Number(v); onChange(); }))));
    const items = r.items ?? [];
    items.forEach((it, i) => {
      const def = ITEM_BY_ID[it.itemId];
      const rar = sel(RARITY.map((x) => [String(x.id), x.name] as [string, string]).filter(([v]) => !def || (Number(v) >= def.minR && Number(v) <= def.maxR)), String(it.rarity), (v) => { it.rarity = Number(v) as Rarity; onChange(); });
      box.append(h('div', { class: 'arow item' },
        field('Đồ', sel(ITEMS.map((d) => [d.id, `${d.name} (${d.slot})${d.special ? ' ★' : ''}`] as [string, string]), it.itemId, (v) => {
          it.itemId = v;
          const d = ITEM_BY_ID[v];
          if (d) it.rarity = Math.min(d.maxR, Math.max(d.minR, it.rarity)) as Rarity;
          onChange();
          draw();
        })),
        field('Độ hiếm', rar),
        h('button', { class: 'btn ghost sm', onclick: () => { items.splice(i, 1); if (!items.length) delete r.items; onChange(); draw(); } }, '✕')));
    });
    box.append(h('button', { class: 'btn ghost sm', onclick: () => { (r.items ??= []).push({ itemId: ITEMS[0].id, rarity: ITEMS[0].minR }); onChange(); draw(); } }, '+ Thêm đồ'));
  };
  draw();
  return box;
}

function objectiveEditor(ev: EventDef, o: EventObjective, i: number, redraw: () => void) {
  const stageOpts: [string, string][] = [...EVENT_STAGES.map((s) => [s.id, `🎉 ${s.name}`] as [string, string]), ...STAGES.map((s) => [s.id, `${s.id} · ${s.name}`] as [string, string])];
  const kind = sel([['kills', '🐒 Hạ N khỉ (cộng dồn)'], ['clearStage', '🏁 Qua ải N lần'], ['reachWave', '🌊 Đạt đợt W (vô tận)'], ['playRuns', '🎮 Chơi N trận']], o.kind, (v) => {
    o.kind = v as EventObjective['kind'];
    if (o.kind === 'clearStage' && !o.stage) o.stage = ev.stage ?? EVENT_STAGES[0]?.id ?? STAGES[0].id;
    if (o.kind !== 'clearStage') delete o.stage;
    redraw();
  });
  return h('div', { class: 'aobj' },
    h('div', { class: 'aobjh' }, h('b', null, `Mục tiêu #${i + 1}`), h('button', { class: 'btn ghost sm', onclick: () => { ev.objectives.splice(i, 1); redraw(); } }, 'Xoá')),
    h('div', { class: 'arow' },
      field('Mã (chữ/số)', inp(o.id, (v) => { o.id = v.replace(/[^A-Za-z0-9_-]/g, ''); }, { maxlength: '24' })),
      field('Loại', kind),
      field('Chỉ tiêu', num(o.target, (v) => { o.target = v ?? 1; }, '1')),
      o.kind === 'clearStage' ? field('Ải', sel(stageOpts, o.stage ?? '', (v) => { o.stage = v; })) : ''),
    field('Mô tả hiển thị', inp(o.label, (v) => { o.label = v; }, { maxlength: '80', class: 'wide' })),
    h('div', { class: 'asub' }, 'Phần thưởng'),
    rewardEditor(o.reward, () => {}));
}

function eventForm(ev: EventDef) {
  const box = h('div', { class: 'card aform' });
  const redraw = () => { const n = eventForm(ev); box.replaceWith(n); };
  box.append(
    h('h2', null, ev.id ? `Sửa sự kiện #${ev.id}` : 'Tạo sự kiện mới', h('button', { class: 'btn ghost sm', onclick: () => { editing = null; render(); } }, 'Đóng ✕')),
    h('div', { class: 'arow' },
      field('Biểu tượng', inp(ev.icon, (v) => { ev.icon = v; }, { maxlength: '16', class: 'ic' })),
      field('Tên sự kiện', inp(ev.name, (v) => { ev.name = v; }, { maxlength: '60', class: 'wide', placeholder: 'VD: 🍌 Tuần Lễ Chuối Vàng' })),
      h('label', { class: 'af chk' }, (() => { const c = h('input', { type: 'checkbox' }) as HTMLInputElement; c.checked = ev.enabled; c.addEventListener('change', () => { ev.enabled = c.checked; }); return c; })(), h('span', null, 'Bật'))),
    field('Mô tả', (() => { const t = h('textarea', { maxlength: '500', rows: '2' }) as HTMLTextAreaElement; t.value = ev.desc; t.addEventListener('input', () => { ev.desc = t.value; }); return t; })()),
    h('div', { class: 'arow' },
      field('Bắt đầu', inp(toLocal(ev.startsAt), (v) => { ev.startsAt = fromLocal(v); }, { type: 'datetime-local' })),
      field('Kết thúc', inp(toLocal(ev.endsAt), (v) => { ev.endsAt = fromLocal(v); }, { type: 'datetime-local' })),
      field('Ải sự kiện', sel([['', '— không có —'], ...EVENT_STAGES.map((s) => [s.id, `${s.name} (${s.waves} đợt)`] as [string, string])], ev.stage ?? '', (v) => { ev.stage = v || undefined; }))),
    h('h3', null, 'Mục tiêu & phần thưởng'),
    ...ev.objectives.map((o, i) => objectiveEditor(ev, o, i, redraw)),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost sm', onclick: () => { ev.objectives.push({ id: `o${ev.objectives.length + 1}`, kind: 'kills', target: 100, label: '', reward: { gold: 100 } }); redraw(); } }, '+ Thêm mục tiêu'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn green', onclick: () => save(ev) }, ev.id ? '💾 LƯU THAY ĐỔI' : '✚ TẠO SỰ KIỆN')));
  return box;
}

async function save(ev: EventDef) {
  if (!ev.name.trim()) return toast('Nhập tên sự kiện');
  if (!ev.startsAt || !ev.endsAt) return toast('Nhập ngày bắt đầu / kết thúc');
  try {
    const r = await call<AdminEventRes>(API.adminEvents, 'POST', ev);
    toast(`Đã lưu "${r.event.name}"`, true);
    editing = null;
    await load();
  } catch (e) {
    toast((e as Error).message);
  }
}

async function del(ev: EventDef) {
  if (!window.confirm(`Xoá sự kiện "${ev.name}"? Tiến trình của người chơi cũng mất.`)) return;
  try {
    await call(API.adminEventDelete, 'POST', { id: ev.id });
    toast('Đã xoá', true);
    if (editing?.id === ev.id) editing = null;
    await load();
  } catch (e) {
    toast((e as Error).message);
  }
}

function statusOf(ev: EventDef) {
  const now = Date.now();
  if (!ev.enabled) return ['tắt', 'off'];
  if (new Date(ev.endsAt).getTime() < now) return ['đã kết thúc', 'off'];
  if (new Date(ev.startsAt).getTime() > now) return ['sắp diễn ra', 'soon'];
  return ['đang diễn ra', 'on'];
}

const statsBox = h('div', { class: 'astats' });
async function loadStats() {
  try {
    const s = await call<AdminStatsRes>(API.adminStats);
    clear(statsBox);
    statsBox.append(
      h('div', null, h('b', null, s.accounts), h('span', null, 'tài khoản')),
      h('div', null, h('b', null, s.online), h('span', null, 'đang online')),
      h('div', null, h('b', null, s.runs24h), h('span', null, 'trận / 24 giờ')));
  } catch (e) {
    clear(statsBox);
    statsBox.append(h('div', { class: 'err' }, (e as Error).message));
  }
}

function grantBox() {
  const reward: Reward = { gold: 500 };
  let user = '';
  return h('div', { class: 'card' },
    h('h2', null, '🎁 Tặng thưởng (thử nghiệm)'),
    field('Tên tài khoản', inp('', (v) => { user = v; }, { maxlength: '40', class: 'wide' })),
    rewardEditor(reward, () => {}),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: async () => {
      if (!user.trim()) return toast('Nhập tên tài khoản');
      try {
        const r = await call<{ items?: unknown[] }>(API.adminGrant, 'POST', { username: user.trim(), reward });
        toast(`Đã tặng cho ${user.trim()}${r.items?.length ? ` (${r.items.length} món đồ)` : ''}`, true);
        loadStats();
      } catch (e) {
        toast((e as Error).message);
      }
    } }, 'TẶNG')));
}

function render() {
  clear(root);
  if (!key) {
    const k = inp('', () => {}, { type: 'password', placeholder: 'MONKEY_ADMIN_KEY', class: 'wide' });
    const go = async () => {
      key = k.value.trim();
      if (!key) return;
      try {
        await call<AdminEventsRes>(API.adminEvents);
        sessionSet('monkey-admin-key', key);
        render();
        load();
      } catch (e) {
        key = '';
        toast((e as Error).message);
      }
    };
    k.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.append(h('div', { class: 'alogin card' }, h('h1', { class: 'logo' }, 'QUẢN TRỊ', h('small', null, 'BẦY KHỈ 🐒')), field('Khoá quản trị', k), h('button', { class: 'btn green big', onclick: go }, 'VÀO')));
    setTimeout(() => k.focus(), 50);
    return;
  }
  const list = h('div', { class: 'card alist' },
    h('h2', null, '📅 Sự kiện', h('button', { class: 'btn green sm', onclick: () => { editing = blankEvent(); render(); } }, '+ Tạo mới')));
  if (!events.length) list.append(h('div', { class: 'empty' }, 'Chưa có sự kiện nào.'));
  for (const ev of events) {
    const [st, cls] = statusOf(ev);
    list.append(h('div', { class: `aev${editing?.id === ev.id ? ' on' : ''}` },
      h('div', { class: 'aevi' }, ev.icon || '🎉'),
      h('div', { class: 'aevt' }, h('b', null, ev.name), h('span', null, `${new Date(ev.startsAt).toLocaleString('vi-VN')} → ${new Date(ev.endsAt).toLocaleString('vi-VN')}`),
        h('span', null, `${ev.objectives.length} mục tiêu${ev.stage ? ` · ải ${ev.stage}` : ''}`)),
      h('em', { class: `ast ${cls}` }, st),
      h('button', { class: 'btn ghost sm', onclick: () => { editing = JSON.parse(JSON.stringify(ev)); render(); } }, 'Sửa'),
      h('button', { class: 'btn red sm', onclick: () => del(ev) }, 'Xoá')));
  }
  root.append(h('div', { class: 'awrap' },
    h('header', { class: 'ahead' }, h('h1', { class: 'logo' }, 'QUẢN TRỊ', h('small', null, 'BẦY KHỈ 🐒')), statsBox,
      h('div', { class: 'grow' }),
      h('a', { class: 'btn ghost sm', href: BASE }, '← Về game'),
      h('button', { class: 'btn ghost sm', onclick: () => { key = ''; sessionSet('monkey-admin-key', null); render(); } }, 'Thoát')),
    h('div', { class: 'acols' },
      h('div', { class: 'acol' }, list, grantBox()),
      h('div', { class: 'acol' }, editing ? eventForm(editing) : h('div', { class: 'card empty' }, 'Chọn "Sửa" một sự kiện hoặc "Tạo mới" để mở trình soạn.')))));
}

async function load() {
  try {
    const r = await call<AdminEventsRes>(API.adminEvents);
    events = r.events ?? [];
    render();
  } catch (e) {
    toast((e as Error).message);
    if (/khoá|key|403|401/i.test((e as Error).message)) { key = ''; sessionSet('monkey-admin-key', null); render(); }
  }
  loadStats();
}

document.title = 'Quản trị Bầy Khỉ';
render();
if (key) load();
