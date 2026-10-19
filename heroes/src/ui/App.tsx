// Khung ứng dụng: thanh điều hướng (tab dưới trên điện thoại dọc / cột trái trên PC + ngang), thanh trên, chọn màn hình.
import { useState } from 'preact/hooks';
import { accountXpToNext } from '@shared/heroes/formulas';
import { STAMINA_MAX } from '@shared/heroes/config';
import { api, me } from '../api';
import { hubBadges } from '../game';
import { quality, saveSettings, sound, type Quality } from '../settings';
import { go, returnTo, screen, type Screen } from '../state';
import { Btn, Modal, Toasts } from './common';
import { Icon, type IconName } from './icons';
import { fmt } from '../state';
import { Login } from './screens/Login';
import { Hub } from './screens/Hub';
import { Heroes } from './screens/Heroes';
import { Squad } from './screens/Squad';
import { Summon } from './screens/Summon';
import { Campaign } from './screens/Campaign';
import { BattleScreen } from './screens/Battle';
import { Result } from './screens/Result';
import { Tower } from './screens/Tower';
import { TowerResult } from './screens/TowerResult';
import { Quests } from './screens/Quests';
import { Shop } from './screens/Shop';

const TABS: { n: Screen['n']; label: string; icon: IconName }[] = [
  { n: 'hub', label: 'Thành', icon: 'home' },
  { n: 'heroes', label: 'Tướng', icon: 'heroes' },
  { n: 'squad', label: 'Đội hình', icon: 'squad' },
  { n: 'summon', label: 'Triệu hồi', icon: 'summon' },
  { n: 'campaign', label: 'Chiến', icon: 'battle' },
];

function Nav() {
  const n = screen.value.n;
  // 3 màn Hoạt động (Tháp/Nhiệm vụ/Cửa hàng) nằm dưới tab Thành
  const cur = n === 'tower' || n === 'quests' || n === 'shop' ? 'hub' : n;
  const tickets = me.value?.wallet.tickets ?? 0;
  const act = me.value ? hubBadges(me.value).total : 0;
  return (
    <nav class="nav" aria-label="Điều hướng">
      {TABS.map((t) => (
        <button type="button" key={t.n} class={`tab${cur === t.n ? ' on' : ''}`} onClick={() => { if (t.n !== 'squad') returnTo.value = null; go({ n: t.n } as Screen); }} aria-label={t.label}>
          <span class="tab-ic">
            <Icon n={t.icon} size={26} />
            {t.n === 'summon' && tickets > 0 && <i class="dot" />}
            {t.n === 'hub' && act > 0 && <i class="dot" />}
          </span>
          <span class="tab-lb">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const m = me.value!;
  const qs: [Quality, string][] = [['auto', 'Tự động'], ['high', 'Cao'], ['medium', 'Vừa'], ['low', 'Thấp']];
  return (
    <Modal title="Cài đặt" onClose={onClose}>
      <div class="set-row">
        <b>Tài khoản</b>
        <span>{m.profile.username}</span>
      </div>
      <div class="set-row col">
        <b>Đồ hoạ 3D</b>
        <div class="seg">
          {qs.map(([k, l]) => (
            <button type="button" key={k} class={quality.value === k ? 'on' : ''} onClick={() => { quality.value = k; saveSettings(); }}>
              {l}
            </button>
          ))}
        </div>
        <small>Áp dụng cho cảnh 3D mở sau đó. Máy yếu nên chọn Thấp.</small>
      </div>
      <div class="set-row">
        <b>Âm thanh</b>
        <button type="button" class={`switch${sound.value ? ' on' : ''}`} onClick={() => { sound.value = !sound.value; saveSettings(); }} aria-pressed={sound.value}>
          <i />
        </button>
      </div>
      <Btn kind="red" onClick={() => void api.logout().then(() => go({ n: 'hub' }))}>
        <Icon n="logout" size={18} /> Đăng xuất
      </Btn>
    </Modal>
  );
}

export function TopBar() {
  const m = me.value!;
  const [open, setOpen] = useState(false);
  const need = accountXpToNext(m.profile.level);
  const pct = Math.min(100, Math.floor((m.profile.xp * 100) / need));
  const w = m.wallet;
  return (
    <header class="topbar">
      <button type="button" class="avatar" onClick={() => setOpen(true)} aria-label="Cài đặt tài khoản">
        <span class="av-face">{m.profile.username.slice(0, 1).toUpperCase()}</span>
        <span class="av-lv">{m.profile.level}</span>
      </button>
      <div class="who">
        <b class="who-name">{m.profile.username}</b>
        <div class="xpbar" title={`${m.profile.xp}/${need}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div class="curs">
        <div class="cur" title="Vàng"><Icon n="gold" size={20} /><b>{fmt(w.gold)}</b></div>
        <div class="cur" title="Kim cương"><Icon n="gem" size={20} /><b>{fmt(w.gems)}</b></div>
        <div class="cur" title="Vé triệu hồi"><Icon n="ticket" size={20} /><b>{fmt(w.tickets)}</b></div>
        <div class="cur hide-sm" title="EXP bình"><Icon n="exp" size={20} /><b>{fmt(w.exp)}</b></div>
        <div class="cur" title="Thể lực"><Icon n="bolt" size={20} /><b>{m.profile.stamina}/{STAMINA_MAX}</b></div>
      </div>
      <button type="button" class="ibtn" aria-label="Cài đặt" onClick={() => setOpen(true)}>
        <Icon n="gear" size={22} />
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </header>
  );
}

function Body() {
  const s = screen.value;
  switch (s.n) {
    case 'hub': return <Hub />;
    case 'heroes': return <Heroes initial={s.id} />;
    case 'squad': return <Squad />;
    case 'summon': return <Summon />;
    case 'campaign': return <Campaign initial={s.stage} />;
    case 'battle': return <BattleScreen stage={s.stage} />;
    case 'result': return <Result stage={s.stage} res={s.res} />;
    case 'tower': return <Tower />;
    case 'towerResult': return <TowerResult res={s.res} />;
    case 'quests': return <Quests />;
    case 'shop': return <Shop />;
  }
}

export function App() {
  if (!me.value) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }
  const s = screen.value;
  const full = s.n === 'battle' || s.n === 'result' || s.n === 'towerResult';
  return (
    <div class={`app${full ? ' full' : ''}`}>
      {!full && <Nav />}
      <main class="main">
        {!full && <TopBar />}
        <div class="screen-body" key={s.n}>
          <Body />
        </div>
      </main>
      <Toasts />
    </div>
  );
}
