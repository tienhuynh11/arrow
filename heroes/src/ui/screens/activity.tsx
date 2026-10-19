// Phần dùng chung của 3 màn "Hoạt động" (Tháp / Nhiệm vụ / Cửa hàng): thanh tiêu đề có nút về Thành,
// đếm ngược reset ngày (00:00 giờ VN), chip thưởng/chi phí.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { nextDayStart } from '@shared/heroes/quests';
import type { Wallet } from '@shared/heroes/types';
import { api, serverNow } from '../../api';
import { fmt, fmtDur, go, useTicker } from '../../state';
import { Btn } from '../common';
import { Icon, type IconName } from '../icons';

/** thời gian còn lại (ms) đến lúc reset ngày; làm mới hồ sơ khi vào màn và ngay sau khi sang ngày mới */
export function useDayReset(): number {
  useTicker(1000);
  const left = Math.max(0, nextDayStart(serverNow()) - serverNow());
  const fired = useRef(false);
  useEffect(() => {
    void api.refresh().catch(() => {});
  }, []);
  const over = left <= 0;
  useEffect(() => {
    if (!over || fired.current) return;
    fired.current = true;
    const t = setTimeout(() => {
      void api.refresh().catch(() => {});
      fired.current = false;
    }, 1500);
    return () => clearTimeout(t);
  }, [over]);
  return left;
}

export function ResetChip({ left }: { left: number }) {
  return (
    <span class="ah-pill" title="Làm mới lúc 00:00 hằng ngày">
      <Icon n="clock" size={16} /> {fmtDur(left)}
    </span>
  );
}

export function ActHead({ title, icon, children }: { title: string; icon: IconName; children?: ComponentChildren }) {
  return (
    <div class="ah-head">
      <Btn kind="ghost" small class="ah-back" onClick={() => go({ n: 'hub' })}>
        <Icon n="back" size={18} /> <span>Thành</span>
      </Btn>
      <h2 class="ah-title">
        <Icon n={icon} size={26} /> <span>{title}</span>
      </h2>
      <div class="ah-right">{children}</div>
    </div>
  );
}

const WALLET_ICON: Record<keyof Wallet, IconName> = { gold: 'gold', gems: 'gem', tickets: 'ticket', exp: 'exp', stones: 'stone' };
const WALLET_KEYS: (keyof Wallet)[] = ['gold', 'gems', 'tickets', 'exp', 'stones'];

/** chip thưởng / chi phí; `lack` đánh dấu đỏ những loại không đủ */
export function WalletChips({ w, lack }: { w: Partial<Wallet>; lack?: Partial<Record<keyof Wallet, boolean>> }) {
  return (
    <>
      {WALLET_KEYS.filter((k) => (w[k] ?? 0) > 0).map((k) => (
        <span key={k} class={`ah-chip${lack?.[k] ? ' lack' : ''}`}>
          <Icon n={WALLET_ICON[k]} size={16} />
          <b>{fmt(w[k]!)}</b>
        </span>
      ))}
    </>
  );
}
