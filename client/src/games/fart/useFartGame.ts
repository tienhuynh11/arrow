import { useRef } from 'react';
import { FartCore, type FartConfig } from '@shared/raftClient';
import { net } from '../../network/net';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

/**
 * Lõi dự đoán/rollback nằm ngoài React (FartCore): React chỉ giữ tham chiếu, KHÔNG re-render mỗi khung hình.
 * Tin nhắn server đi thẳng vào core; cảnh 3D gọi core.frame() trong rAF của nó.
 */
export function useFartGame({ gameId, config, startAt, meId }: GameProps) {
  const ref = useRef<{ core: FartCore; startAt: number; meId: string } | null>(null);
  if (!ref.current || ref.current.startAt !== startAt || ref.current.meId !== meId) {
    ref.current = { core: new FartCore(config as FartConfig, meId, startAt, (i) => net.input(gameId, i)), startAt, meId };
  }
  const core = ref.current.core;
  useGameEvents(gameId, (p) => core.onMessage(p));
  return core;
}
