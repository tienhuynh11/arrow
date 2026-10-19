// Màn chính: tiểu cảnh 3D nổi với đội hình đang dùng, nút CHIẾN lớn, khung AFK.
import { useState } from 'preact/hooks';
import { GEAR_CAP } from '@shared/heroes/gear';
import { AFK_CAP_MS, SQUAD_SIZE } from '@shared/heroes/config';
import { afkRatePerHour } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { activeSquadIds, afkNow, defOf, highestIndex, hubBadges, nextStageOf, squadPower } from '../../game';
import { runLive } from '../../render/live';
import { createHubScene } from '../../render/scenes';
import { fmt, fmtDur, go, useBusy, useTicker, toast } from '../../state';
import { Btn, Canvas3D, Modal } from '../common';
import { GearBag } from '../gear';
import { Icon, type IconName } from '../icons';
import { TutorialChip } from '../tutorial';

export function AfkPanel({ onClose }: { onClose: () => void }) {
  useTicker(500);
  const m = me.value!;
  const [busy, run] = useBusy();
  const a = afkNow(m);
  const rate = afkRatePerHour(highestIndex(m));
  const full = a.elapsed >= AFK_CAP_MS;
  const left = AFK_CAP_MS - a.elapsed;
  const claim = () =>
    run(async () => {
      const r = await api.afkClaim();
      toast(`Nhận ${fmt(r.reward.gold)} vàng, ${fmt(r.reward.exp)} EXP bình`, 'ok');
      onClose();
    });
  return (
    <Modal title="Treo máy (AFK)" onClose={onClose}>
      <p class="muted">Tướng tự luyện công khi bạn vắng mặt. Tích luỹ tối đa 12 giờ, tốc độ theo ải cao nhất đã qua.</p>
      <div class="afk-bar" aria-label="Tiến độ tích luỹ">
        <i style={{ width: `${Math.min(100, (a.elapsed * 100) / AFK_CAP_MS)}%` }} />
        <span>{full ? 'Đầy kho!' : `Đầy sau ${fmtDur(left)}`}</span>
      </div>
      <div class="reward-row">
        <div class="reward big"><Icon n="gold" size={30} /><b>{fmt(a.gold)}</b></div>
        <div class="reward big"><Icon n="exp" size={30} /><b>{fmt(a.exp)}</b></div>
      </div>
      <p class="muted small">
        Tốc độ: {fmt(rate.gold)} vàng và {fmt(rate.exp)} EXP mỗi giờ. Đã tích luỹ {fmtDur(a.elapsed)}.
      </p>
      <Btn kind="green" big busy={busy} onClick={claim} disabled={a.gold + a.exp <= 0}>
        NHẬN THƯỞNG
      </Btn>
    </Modal>
  );
}

export function Hub() {
  const m = me.value!;
  useTicker(1000);
  const [afk, setAfk] = useState(false);
  const [bag, setBag] = useState(false);
  const [acts, setActs] = useState(false); // bảng "Hoạt động" trên điện thoại dọc
  const ids = activeSquadIds(m);
  const next = nextStageOf(m);
  const a = afkNow(m);
  const bd = hubBadges(m);
  const leader = ids[0] ? defOf(ids[0]) : null;
  const power = squadPower(m, ids);

  const start = (canvas: HTMLCanvasElement) => {
    const sc = createHubScene(ids);
    const h = runLive(canvas, sc, 40);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      sc.look(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    };
    canvas.addEventListener('pointermove', move);
    return () => {
      canvas.removeEventListener('pointermove', move);
      h.stop();
    };
  };

  // bảy mục phụ: dùng chung cho dock bên phải (ngang/PC) và bảng Hoạt động (điện thoại dọc)
  const items: { k: string; ic: IconName; label: string; sub?: string; badge?: number | boolean; aria: string; run: () => void }[] = [
    { k: 'tower', ic: 'tower', label: 'Tháp', badge: bd.tower, aria: 'Tháp', run: () => go({ n: 'tower' }) },
    { k: 'arena', ic: 'arena', label: 'Đấu trường', badge: bd.arena, aria: 'Đấu trường', run: () => go({ n: 'arena' }) },
    { k: 'quests', ic: 'quest', label: 'Nhiệm vụ', badge: bd.quests, aria: `Nhiệm vụ${bd.quests ? `, ${bd.quests} có thể nhận` : ''}`, run: () => go({ n: 'quests' }) },
    { k: 'events', ic: 'events', label: 'Sự kiện', badge: bd.events, aria: `Sự kiện${bd.events ? `, ${bd.events} có thể nhận` : ''}`, run: () => go({ n: 'events' }) },
    { k: 'guild', ic: 'guild', label: 'Bang hội', aria: 'Bang hội', run: () => go({ n: 'guild' }) },
    { k: 'shop', ic: 'shop', label: 'Cửa hàng', aria: 'Cửa hàng', run: () => go({ n: 'shop' }) },
    { k: 'bag', ic: 'bag', label: 'Kho đồ', sub: `${m.gear.length}/${GEAR_CAP}`, aria: `Kho đồ ${m.gear.length}/${GEAR_CAP}`, run: () => setBag(true) },
  ];
  const badgeOf = (b?: number | boolean) => (typeof b === 'number' ? (b > 0 ? <i class="hb-badge">{b}</i> : null) : b ? <i class="hb-badge hb-badge-dot" /> : null);

  return (
    <div class="hub">
      <div class="sky" />
      {/* key theo đội hình để dựng lại cảnh khi đổi đội */}
      <Canvas3D key={ids.join(',')} start={start} class="hub-canvas" />
      <div class="hub-ui">
        <TutorialChip />
        {leader && (
          <div class="hb-plate">
            <b>{leader.name}</b>
            <small>{leader.title}</small>
          </div>
        )}

        {/* dock kính bên phải (ngang / PC) */}
        <div class="hb-dock" aria-label="Hoạt động" data-tut="hub-dock">
          {items.map((it) => (
            <button type="button" key={it.k} class="hb-dock-b" onClick={it.run} aria-label={it.aria}>
              <span class="hb-ic"><Icon n={it.ic} size={28} />{badgeOf(it.badge)}</span>
              <small>{it.sub ?? it.label}</small>
            </button>
          ))}
        </div>

        {/* nút tròn "Hoạt động" (điện thoại dọc) */}
        <button type="button" class="hb-acts-btn" data-tut="hub-acts" onClick={() => setActs((v) => !v)} aria-label={`Hoạt động${bd.total ? `, ${bd.total} mới` : ''}`} aria-expanded={acts}>
          <Icon n="grid" size={28} />
          {bd.total > 0 && <i class="hb-badge">{bd.total}</i>}
        </button>
        {acts && (
          <>
            <div class="hb-back" onClick={() => setActs(false)} />
            <div class="hb-sheet" role="menu" aria-label="Hoạt động">
              {items.map((it) => (
                <button type="button" key={it.k} class="hb-sheet-b" role="menuitem" aria-label={it.aria} onClick={() => { setActs(false); it.run(); }}>
                  <span class="hb-ic"><Icon n={it.ic} size={32} />{badgeOf(it.badge)}</span>
                  <b>{it.label}</b>
                  {it.sub && <small>{it.sub}</small>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* cụm CTA: AFK + thẻ CHIẾN gộp thông tin đội */}
        <div class="hb-bottom">
          <button type="button" class="hb-afk" data-tut="hub-afk" onClick={() => setAfk(true)} aria-label="Treo máy">
            <Icon n="clock" size={26} />
            <span>
              <b>Treo máy</b>
              <small>{fmt(a.gold)} vàng · {fmt(a.exp)} EXP</small>
            </span>
            {a.gold > 0 && <i class="dot" />}
          </button>
          <div class="hb-cta">
            <div class="hb-strip">
              <span><Icon n="squad" size={16} /> Đội hình {ids.length}/{SQUAD_SIZE}</span>
              <span><Icon n="sword" size={16} /> Lực chiến {fmt(power)}</span>
            </div>
            <button type="button" class="btn big hb-go" data-tut="hub-go" onClick={() => go({ n: 'campaign', stage: next.id })}>
              <Icon n="battle" size={36} />
              <span class="hb-go-t">
                <b>CHIẾN</b>
                <small>Tiếp tục · {next.name}</small>
              </span>
            </button>
          </div>
        </div>
      </div>
      {afk && <AfkPanel onClose={() => setAfk(false)} />}
      {bag && <GearBag onClose={() => setBag(false)} />}
    </div>
  );
}
