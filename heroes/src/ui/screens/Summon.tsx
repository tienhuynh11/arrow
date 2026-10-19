// Triệu hồi: banner, x1/x10, vé/kim cương, pity, bảng tỉ lệ, hiệu ứng lật thẻ. Mỗi lần bấm một khoá chống gửi trùng.
import { useEffect, useState } from 'preact/hooks';
import { BANNERS, RATES, SSR_PITY, SUMMON10_COST, SUMMON_COST, UR_PITY, NEW_PITY } from '@shared/heroes/gacha';
import { poolOf } from '@shared/heroes/heroes';
import { RARITIES, type Rarity } from '@shared/heroes/types';
import type { SummonRes } from '@shared/heroes/api';
import { api, me } from '../../api';
import { sfx } from '../../audio';
import { defOf } from '../../game';
import { uuid, useBusy } from '../../state';
import { Btn, ElemChip, IconBtn, Modal, Portrait, RarityTag, RoleChip } from '../common';
import { Icon } from '../icons';

type Pull = SummonRes['pulls'][number];

function RevealCard({ p, open }: { p: Pull; open: boolean }) {
  const d = defOf(p.heroId);
  return (
    <div class={`rv-card r-${p.rarity}${open ? ' open' : ''}`}>
      <div class="rv-inner">
        <div class="rv-back">
          <Icon n="sparkle" size={36} />
        </div>
        <div class="rv-front">
          <div class="rv-art">
            <Portrait id={d.id} rarity={d.rarity} />
            {p.rarity === 'UR' && <span class="shimmer" />}
          </div>
          <RarityTag r={p.rarity} />
          <b class="rv-name">{d.name}</b>
          <div class="rv-meta">
            <ElemChip el={d.element} />
            <RoleChip role={d.role} />
          </div>
          {p.isNew ? <span class="rv-new">MỚI!</span> : <span class="rv-dupe">+{p.shards} mảnh</span>}
        </div>
      </div>
    </div>
  );
}

function Reveal({ pulls, onDone }: { pulls: Pull[]; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const all = shown >= pulls.length;
  useEffect(() => {
    if (all) return;
    const t = setTimeout(() => {
      const p = pulls[shown];
      sfx(p.rarity === 'SSR' || p.rarity === 'UR' ? 'rare' : 'reveal');
      setShown(shown + 1);
    }, shown === 0 ? 450 : pulls.length === 1 ? 300 : 320);
    return () => clearTimeout(t);
  }, [shown, all, pulls]);
  const best = pulls.reduce<Rarity>((b, p) => (RARITIES.indexOf(p.rarity) > RARITIES.indexOf(b) ? p.rarity : b), 'R');
  return (
    <div class={`reveal best-${best}`}>
      <div class="rv-glow" />
      <div class={`rv-grid n${pulls.length}`}>
        {pulls.map((p, i) => (
          <RevealCard key={i} p={p} open={i < shown} />
        ))}
      </div>
      <div class="rv-actions">
        {!all && <Btn kind="ghost" onClick={() => setShown(pulls.length)}>Bỏ qua</Btn>}
        {all && <Btn kind="primary" big onClick={onDone}>XÁC NHẬN</Btn>}
      </div>
    </div>
  );
}

export function Summon() {
  const m = me.value!;
  const [bi, setBi] = useState(0);
  const [pay, setPay] = useState<'tickets' | 'gems'>('tickets');
  const [busy, run] = useBusy();
  const [rates, setRates] = useState(false);
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const banner = BANNERS[bi];
  const pity = m.pity[banner.id] ?? NEW_PITY;
  const w = m.wallet;
  const c1 = SUMMON_COST[pay];
  const c10 = SUMMON10_COST[pay];
  const have = w[pay];
  const feat = banner.featured ? defOf(banner.featured) : null;

  const doSummon = (count: 1 | 10) =>
    run(async () => {
      const r = await api.summon(banner.id, count, pay, uuid());
      setPulls(r.pulls);
    });

  const pctOf = (r: Rarity) => (RATES[r] / 100).toFixed(RATES[r] % 100 === 0 ? 0 : 1);

  return (
    <div class="summon">
      <div class="sm-main">
        <div class="banner-tabs">
          {BANNERS.map((b, i) => (
            <button type="button" key={b.id} class={`fchip wide${bi === i ? ' on' : ''}`} onClick={() => setBi(i)}>
              {b.name}
            </button>
          ))}
          <IconBtn n="info" label="Xem tỉ lệ triệu hồi" onClick={() => setRates(true)} />
        </div>
        <div class={`banner-art${feat ? ' feat' : ''}`}>
          {feat ? (
            <>
              <div class="ba-hero"><Portrait id={feat.id} rarity={feat.rarity} /></div>
              <div class="ba-text">
                <RarityTag r="UR" />
                <h2>{feat.name}</h2>
                <p>Tỉ lệ UR có đảm bảo "50/50 rồi chắc chắn" ra tướng nổi bật.</p>
              </div>
            </>
          ) : (
            <div class="ba-text">
              <h2>Triệu Hồi Thường</h2>
              <p>Gọi các anh hùng R, SR, SSR và UR về đội của bạn.</p>
              <div class="ba-showcase">
                {poolOf('SSR').concat(poolOf('UR')).slice(0, 4).map((h) => (
                  <div class="ba-mini" key={h.id}><Portrait id={h.id} rarity={h.rarity} /></div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div class="sm-ctrl">
        <div class="pity panel">
          <div class="pity-row">
            <span>Chắc chắn SSR</span>
            <div class="pbar"><i class="ssr" style={{ width: `${Math.min(100, (pity.sinceSSR * 100) / SSR_PITY)}%` }} /></div>
            <b>{pity.sinceSSR}/{SSR_PITY}</b>
          </div>
          <div class="pity-row">
            <span>Chắc chắn UR</span>
            <div class="pbar"><i class="ur" style={{ width: `${Math.min(100, (pity.sinceUR * 100) / UR_PITY)}%` }} /></div>
            <b>{pity.sinceUR}/{UR_PITY}</b>
          </div>
          {banner.featured && pity.guaranteed && <small class="ok">UR kế tiếp chắc chắn là tướng nổi bật!</small>}
        </div>

        <div class="pay-row">
          <div class="seg">
            <button type="button" class={pay === 'tickets' ? 'on' : ''} onClick={() => setPay('tickets')}>
              <Icon n="ticket" size={18} /> Vé ({w.tickets})
            </button>
            <button type="button" class={pay === 'gems' ? 'on' : ''} onClick={() => setPay('gems')}>
              <Icon n="gem" size={18} /> Kim cương ({w.gems})
            </button>
          </div>
        </div>
        <div class="summon-btns">
          <Btn kind="blue" big busy={busy} disabled={have < c1} onClick={() => doSummon(1)}>
            <span class="sb-top">Quay x1</span>
            <span class="sb-cost"><Icon n={pay === 'tickets' ? 'ticket' : 'gem'} size={18} />{c1}</span>
          </Btn>
          <Btn kind="primary" big busy={busy} disabled={have < c10} onClick={() => doSummon(10)}>
            <span class="sb-top">Quay x10</span>
            <span class="sb-cost"><Icon n={pay === 'tickets' ? 'ticket' : 'gem'} size={18} />{c10}</span>
          </Btn>
        </div>
        {have < c1 && <small class="lack-note">Không đủ {pay === 'tickets' ? 'vé' : 'kim cương'} để quay.</small>}
        </div>
      </div>


      {rates && (
        <Modal title="Tỉ lệ triệu hồi" onClose={() => setRates(false)}>
          <div class="rates">
              <table class="rate-table">
          <tbody>
            {RARITIES.slice().reverse().map((r) => (
              <tr key={r}>
                <td><RarityTag r={r} /></td>
                <td class="pct">{pctOf(r)}%</td>
                <td class="pool">{poolOf(r).map((h) => h.name).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul class="rate-notes">
          <li>Chắc chắn ra SSR trở lên sau {SSR_PITY} lượt, UR sau {UR_PITY} lượt chưa ra.</li>
          <li>Quay x10 đảm bảo ít nhất 1 tướng SR trở lên.</li>
          <li>Trùng tướng đổi thành mảnh để lên sao.</li>
        </ul>
          </div>
        </Modal>
      )}
      {pulls && <Reveal pulls={pulls} onDone={() => setPulls(null)} />}
    </div>
  );
}
