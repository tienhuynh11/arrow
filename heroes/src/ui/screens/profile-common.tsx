// Phần dùng chung của màn Hồ sơ: chip thưởng, hộp thoại báo thưởng, ô thống kê.
import type { ComponentChildren } from 'preact';
import { GEAR_BY_ID } from '@shared/heroes/gear';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import type { Wallet } from '@shared/heroes/types';
import { Btn, Portrait } from '../common';
import { GearDrops, GearTile } from '../gear';
import { Icon, type IconName } from '../icons';
import { WalletChips } from './activity';
import '../profile.css';

export interface Rw {
  wallet?: Partial<Wallet>;
  shards?: { hero: string; n: number };
  gear?: string[];
}

/** chip thưởng: tiền (icon), mảnh (chân dung tướng), trang bị (ô GearTile) */
export function RewardChips({ r, tile = 32 }: { r: Rw; tile?: number }) {
  const sh = r.shards;
  const hero = sh ? HERO_BY_ID[sh.hero] : null;
  return (
    <span class="pf-rw">
      <WalletChips w={r.wallet ?? {}} />
      {sh && hero && (
        <span class="pf-shard" title={`${sh.n} mảnh ${hero.name}`}>
          <span class="pf-sp"><Portrait id={hero.id} rarity={hero.rarity} /></span>
          <b>+{sh.n}</b>
        </span>
      )}
      {(r.gear ?? []).map((g, i) => (GEAR_BY_ID[g] ? <GearTile key={`${g}${i}`} def={GEAR_BY_ID[g]} size={tile} /> : null))}
    </span>
  );
}

/** hộp thoại báo thưởng vừa nhận */
export function RewardModal({ title, sub, r, onClose }: { title: string; sub?: ComponentChildren; r: Rw; onClose: () => void }) {
  const sh = r.shards;
  const hero = sh ? HERO_BY_ID[sh.hero] : null;
  return (
    <div class="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal pf-rwmodal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="modal-body pf-rwbody">
          <Icon n="gift" size={52} />
          <h2>{title}</h2>
          {sub && <div class="pf-rwsub">{sub}</div>}
          <div class="pf-rwline"><WalletChips w={r.wallet ?? {}} /></div>
          {sh && hero && (
            <div class="pf-rwhero">
              <span class="pf-sp big"><Portrait id={hero.id} rarity={hero.rarity} /></span>
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

/** ô thống kê: icon + nhãn + giá trị + dòng phụ */
export function StatCell({ ic, label, value, sub }: { ic: IconName; label: string; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="pf-stat">
      <span class="pf-stat-ic"><Icon n={ic} size={26} /></span>
      <span class="pf-stat-tx">
        <small>{label}</small>
        <b>{value}</b>
        {sub != null && <small class="pf-stat-sub">{sub}</small>}
      </span>
    </div>
  );
}
