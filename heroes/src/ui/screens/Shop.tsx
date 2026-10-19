// Cửa hàng: mặt hàng cố định, giới hạn mua mỗi ngày. Mua x1 hoặc "Tối đa"; mảnh tướng phải chọn tướng đang có;
// rương trang bị hiện món rớt. Trừ tiền + tăng bộ đếm ngay (lạc quan), server đối chiếu sau.
import { useMemo, useState } from 'preact/hooks';
import { GEAR_CAP } from '@shared/heroes/gear';
import { SHOP_ITEMS, type ShopItem } from '@shared/heroes/shop';
import type { Wallet } from '@shared/heroes/types';
import { api, me } from '../../api';
import { defOf, powerOfOwned, shopBought } from '../../game';
import { errToast, toast } from '../../state';
import { Btn, HeroCard, Modal } from '../common';
import { GearDrops } from '../gear';
import { Icon, type IconName } from '../icons';
import { ActHead, ResetChip, useDayReset, WalletChips } from './activity';

const COST_KEYS: (keyof Wallet)[] = ['gold', 'gems', 'tickets', 'exp', 'stones'];

function iconOf(it: ShopItem): IconName {
  const g = it.give;
  if (g.kind === 'stamina') return 'bolt';
  if (g.kind === 'shards') return 'sparkle';
  if (g.kind === 'gear') return 'chest';
  const k = Object.keys(g.give)[0];
  return k === 'tickets' ? 'ticket' : k === 'stones' ? 'stone' : k === 'gold' ? 'gold' : k === 'gems' ? 'gem' : 'exp';
}

export function Shop() {
  const m = me.value!;
  const left = useDayReset();
  const bought = shopBought(m);
  const [pick, setPick] = useState<{ item: ShopItem; times: number } | null>(null);
  const [drops, setDrops] = useState<string[] | null>(null);

  const heroes = useMemo(
    () => m.heroes.slice().sort((a, b) => powerOfOwned(b) - powerOfOwned(a)),
    // eslint-disable-next-line
    [m.heroes],
  );

  const info = (it: ShopItem) => {
    const got = bought[it.id] ?? 0;
    const remain = Math.max(0, it.limit - got);
    let afford = Infinity;
    const lack: Partial<Record<keyof Wallet, boolean>> = {};
    for (const k of COST_KEYS) {
      const c = it.cost[k] ?? 0;
      if (c <= 0) continue;
      afford = Math.min(afford, Math.floor(m.wallet[k] / c));
      if (m.wallet[k] < c) lack[k] = true;
    }
    if (!Number.isFinite(afford)) afford = remain;
    return { got, remain, max: Math.max(0, Math.min(remain, afford)), lack };
  };

  const buy = async (it: ShopItem, times: number, hero?: string) => {
    try {
      const r = await api.shopBuy(it.id, times, hero);
      toast(`Đã mua ${it.name}${r.bought > 1 ? ` x${r.bought}` : ''}`, 'ok');
      if (it.give.kind === 'gear') setDrops(r.drops ?? []);
    } catch (e) {
      errToast(e);
    }
  };
  const press = (it: ShopItem, times: number) => {
    if (times <= 0) return;
    if (it.give.kind === 'shards') {
      if (!m.heroes.length) return toast('Bạn chưa có tướng nào', 'info');
      setPick({ item: it, times });
    } else void buy(it, times);
  };

  return (
    <div class="shop">
      <ActHead title="Cửa hàng" icon="shop">
        <ResetChip left={left} />
      </ActHead>

      <div class="fade-wrap sh-wrap">
        <div class="sh-grid scroll">
          {SHOP_ITEMS.map((it) => {
            const s = info(it);
            const out = s.remain <= 0;
            return (
              <div key={it.id} class={`sh-card${out ? ' out' : ''}`}>
                <div class="sh-top">
                  <span class="sh-ic"><Icon n={iconOf(it)} size={34} /></span>
                  <b class="sh-name">{it.name}</b>
                </div>
                <small class="sh-desc">{it.desc}</small>
                <div class="sh-mid">
                  <span class="sh-cost"><WalletChips w={it.cost} lack={s.lack} /></span>
                  <small class="sh-count">Hôm nay {s.got}/{it.limit}</small>
                </div>
                <div class="sh-btns">
                  <Btn kind="green" small disabled={out || s.max < 1} onClick={() => press(it, 1)}>
                    {out ? 'Hết lượt' : 'Mua x1'}
                  </Btn>
                  <Btn kind="blue" small disabled={out || s.max < 2} onClick={() => press(it, s.max)}>
                    Tối đa{s.max > 1 ? ` (${s.max})` : ''}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pick && (
        <Modal title="Chọn tướng nhận mảnh" onClose={() => setPick(null)}>
          <small class="hint">
            {pick.item.name} x{pick.times}: chạm một tướng để nhận mảnh.
          </small>
          <div class="sh-heroes scroll">
            {heroes.map((o) => (
              <HeroCard
                key={o.id}
                def={defOf(o.id)}
                owned={o}
                badge={<span class="sh-shard">Mảnh {o.shards}</span>}
                onClick={() => {
                  const p = pick;
                  setPick(null);
                  void buy(p.item, p.times, o.id);
                }}
              />
            ))}
          </div>
        </Modal>
      )}

      {drops && (
        <Modal title="Rương trang bị" onClose={() => setDrops(null)}>
          <GearDrops ids={drops} full={drops.length === 0 && m.gear.length >= GEAR_CAP} />
          {drops.length === 0 && m.gear.length < GEAR_CAP && <small class="muted drops-none">Không có trang bị mới.</small>}
          <Btn kind="green" onClick={() => setDrops(null)}>Tuyệt!</Btn>
        </Modal>
      )}
    </div>
  );
}
