// Ảnh đại diện người chơi: chọn một tướng ĐANG SỞ HỮU, lưu localStorage theo id tài khoản.
import { signal } from '@preact/signals';
import type { MeResponse } from '@shared/heroes/api';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import type { Rarity } from '@shared/heroes/types';
import { activeSquadIds } from '../game';
import { store } from '../settings';
import { Portrait } from './common';
import './profile.css';

const rev = signal(0);
const keyOf = (uid: number) => `heroes-avatar-${uid}`;

/** id tướng làm ảnh đại diện: lựa chọn đã lưu (còn sở hữu) -> tướng đầu đội đang dùng -> null (hiện chữ cái) */
export function avatarIdOf(m: MeResponse): string | null {
  void rev.value; // đăng ký phụ thuộc để đổi ảnh là cập nhật mọi nơi
  const saved = store(keyOf(m.profile.id));
  if (saved && HERO_BY_ID[saved] && m.heroes.some((h) => h.id === saved)) return saved;
  return activeSquadIds(m)[0] ?? m.heroes[0]?.id ?? null;
}
export function setAvatar(m: MeResponse, heroId: string) {
  store(keyOf(m.profile.id), heroId);
  rev.value++;
}
export function avatarRarity(m: MeResponse): Rarity | null {
  const id = avatarIdOf(m);
  return id ? HERO_BY_ID[id].rarity : null;
}

/** mặt tròn: chân dung chibi cắt cận mặt, hoặc chữ cái đầu khi chưa có tướng */
export function AvatarFace({ m }: { m: MeResponse }) {
  const id = avatarIdOf(m);
  const d = id ? HERO_BY_ID[id] : null;
  return (
    <span class="pf-face">
      {d ? <Portrait id={d.id} rarity={d.rarity} /> : <b>{m.profile.username.slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

/** khung avatar đầy đủ: viền theo độ hiếm + huy hiệu cấp */
export function Avatar({ m, size = 56, lv = true, class: cls }: { m: MeResponse; size?: number; lv?: boolean; class?: string }) {
  const r = avatarRarity(m) ?? 'R';
  return (
    <span class={`pf-av r-${r} ${cls ?? ''}`} style={{ '--s': `${size}px` } as any}>
      <AvatarFace m={m} />
      {lv && <span class="pf-av-lv">{m.profile.level}</span>}
    </span>
  );
}
