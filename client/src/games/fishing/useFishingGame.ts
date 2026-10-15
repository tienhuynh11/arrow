import { useEffect, useRef } from 'react';
import { net } from '../../network/net';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';
import { FishingCore, type FishingConfig } from './core';

/**
 * Lõi dự đoán nằm ngoài React (FishingCore): React chỉ giữ tham chiếu, KHÔNG render lại mỗi khung hình.
 * Bàn phím: SPACE = quăng / giật cần / giữ kéo · F (hoặc E) = giật cá người khác.
 */
export function useFishingGame({ gameId, config, startAt, meId, live, players }: GameProps) {
  const ref = useRef<{ core: FishingCore; startAt: number; meId: string } | null>(null);
  if (!ref.current || ref.current.startAt !== startAt || ref.current.meId !== meId) {
    ref.current = {
      core: new FishingCore(config as FishingConfig, meId, startAt, (i) => net.input(gameId, i), () => net.now()),
      startAt,
      meId,
    };
  }
  const core = ref.current.core;
  core.liveFn = () => live;
  core.nameOf = (seat) => players.find((p) => p.id === core.ids[seat])?.name ?? `#${seat + 1}`;
  useGameEvents(gameId, (p) => core.onMessage(p));

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        core.down('key');
      } else if (e.code === 'KeyF' || e.code === 'KeyE') {
        e.preventDefault();
        core.steal();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') core.up('key');
    };
    const blur = () => core.releaseAll();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', blur);
      core.releaseAll();
    };
  }, [core]);

  return core;
}
