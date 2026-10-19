// Màn chính: tiểu cảnh 3D nổi với đội hình đang dùng, nút CHIẾN lớn, khung AFK.
import { useState } from 'preact/hooks';
import { GEAR_CAP } from '@shared/heroes/gear';
import { AFK_CAP_MS } from '@shared/heroes/config';
import { afkRatePerHour } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { activeSquadIds, afkNow, defOf, highestIndex, nextStageOf } from '../../game';
import { runLive } from '../../render/live';
import { createHubScene } from '../../render/scenes';
import { fmt, fmtDur, go, useBusy, useTicker, toast } from '../../state';
import { Btn, Canvas3D, Modal } from '../common';
import { GearBag } from '../gear';
import { Icon } from '../icons';

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
  const ids = activeSquadIds(m);
  const next = nextStageOf(m);
  const a = afkNow(m);
  const leader = ids[0] ? defOf(ids[0]) : null;

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

  return (
    <div class="hub">
      <div class="sky" />
      {/* key theo đội hình để dựng lại cảnh khi đổi đội */}
      <Canvas3D key={ids.join(',')} start={start} class="hub-canvas" />
      <div class="hub-ui">
        {leader && (
          <div class="leader-plate">
            <b>{leader.name}</b>
            <small>{leader.title}</small>
          </div>
        )}
        <button type="button" class="bag-chip" onClick={() => setBag(true)} aria-label={`Kho đồ ${m.gear.length}/${GEAR_CAP}`}>
          <Icon n="bag" size={30} />
          <small>{m.gear.length}/{GEAR_CAP}</small>
        </button>
        <button type="button" class="afk-chip" onClick={() => setAfk(true)} aria-label="Treo máy">
          <Icon n="clock" size={26} />
          <span>
            <b>Treo máy</b>
            <small>
              {fmt(a.gold)} vàng · {fmt(a.exp)} EXP
            </small>
          </span>
          {a.gold > 0 && <i class="dot" />}
        </button>
        <div class="go-wrap">
          <small class="next">Tiếp tục: {next.name}</small>
          <Btn big kind="primary" class="go-btn" onClick={() => go({ n: 'campaign', stage: next.id })}>
            <Icon n="battle" size={34} /> CHIẾN
          </Btn>
        </div>
      </div>
      {afk && <AfkPanel onClose={() => setAfk(false)} />}
      {bag && <GearBag onClose={() => setBag(false)} />}
    </div>
  );
}
