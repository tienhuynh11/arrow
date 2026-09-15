import {
  DEFAULT_LOOK,
  HAIR_STYLES,
  LOOK_PARTS,
  type LookPart,
  type PlayerLook,
  type RoomState,
} from '@shared/protocol';

/** Những người đang xếp bét (có thể đồng hạng). Khi ai cũng bằng điểm (đầu trận) thì không có ai. */
export function lastPlaceIds(room: RoomState | null): Set<string> {
  const out = new Set<string>();
  if (!room || room.phase === 'lobby') return out;
  const active = room.players.filter((p) => !p.spectator);
  if (active.length < 2) return out;
  const totals = active.map((p) => p.total);
  const min = Math.min(...totals);
  if (min === Math.max(...totals)) return out;
  for (const p of active) if (p.total === min) out.add(p.id);
  return out;
}

/**
 * Tìm ngoại hình + trạng thái "bị băng bó" của một nhân vật theo màu áo.
 * Màu áo là duy nhất trong phòng nên mọi chỗ vẽ nhân vật (2D lẫn 3D) không phải truyền thêm gì.
 */
export function appearanceFor(room: RoomState | null, color: string): { look: PlayerLook; hurt: boolean } {
  const player = room?.players.find((p) => p.color === color);
  if (!player) return { look: DEFAULT_LOOK, hurt: false };
  return { look: player.look ?? DEFAULT_LOOK, hurt: lastPlaceIds(room).has(player.id) };
}

export const skinColor = (look: PlayerLook) => LOOK_PARTS.skin[look.skin] ?? LOOK_PARTS.skin[0];
export const shoeColor = (look: PlayerLook) => LOOK_PARTS.shoes[look.shoes] ?? LOOK_PARTS.shoes[0];

/** undefined = tóc theo màu áo (tối hơn) */
export function hairColor(look: PlayerLook): string | undefined {
  const c = LOOK_PARTS.hairColor[look.hairColor];
  return !c || c === 'auto' ? undefined : c;
}

/** tên các lựa chọn của một phần; kiểu tóc đổi theo giới tính */
export function optionNames(key: LookPart, look: PlayerLook): readonly string[] {
  return key === 'hair' ? (HAIR_STYLES[look.gender] ?? HAIR_STYLES[0]) : LOOK_PARTS[key];
}

export function randomLook(): PlayerLook {
  const pick = (k: LookPart) => Math.floor(Math.random() * LOOK_PARTS[k].length);
  const look = { ...DEFAULT_LOOK };
  for (const key of Object.keys(DEFAULT_LOOK) as LookPart[]) look[key] = pick(key);
  // bớt lố: không phải ai cũng đeo kính, đội mũ, có điểm nhấn
  if (Math.random() < 0.55) look.glasses = 0;
  if (Math.random() < 0.35) look.hat = 0;
  if (Math.random() < 0.5) look.face = look.gender === 1 ? 1 : 0;
  if (look.gender === 0 && look.outfit === 5 && Math.random() < 0.8) look.outfit = Math.floor(Math.random() * 5);
  return look;
}
