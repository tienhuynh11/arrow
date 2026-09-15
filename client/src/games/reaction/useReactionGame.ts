import { useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ReactionResult {
  falseStart: boolean;
  ms: number;
  order: number;
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

export const resultText = (r?: ReactionResult) =>
  !r ? '-' : r.falseStart ? 'FALSE START' : `${MEDALS[Math.min(r.order - 1, 3)]} ${r.ms} ms`;

/** Trạng thái + điều khiển của PHẢN XẠ NHANH, dùng chung cho bản 2D và 3D. */
export function useReactionGame({ gameId, meId, live }: GameProps) {
  const [go, setGo] = useState(false);
  const [fake, setFake] = useState(0);
  const [results, setResults] = useState<Record<string, ReactionResult>>({});
  const [pressed, setPressed] = useState(false);

  useGameEvents(gameId, (p) => {
    if (p.type === 'go') {
      setGo(true);
      sfx.start();
      return;
    }
    if (p.type === 'fake') {
      // tín hiệu giả: chỉ nhấp nháy, ai nhấn vào đây là FALSE START
      setFake(Date.now());
      sfx.tick();
      setTimeout(() => setFake(0), 420);
      return;
    }
    if (p.type === 'press') {
      setResults((r) =>
        r[p.playerId]
          ? r
          : {
              ...r,
              [p.playerId]: {
                falseStart: p.falseStart,
                ms: p.ms,
                order: Object.values(r).filter((x) => !x.falseStart).length + (p.falseStart ? 0 : 1),
              },
            },
      );
      if (p.playerId === meId) (p.falseStart ? sfx.miss : sfx.perfect)();
    }
  });

  useKeys(
    {
      Space: () => {
        if (pressed) return;
        setPressed(true);
        net.input(gameId, { type: 'press', at: net.now() });
      },
    },
    live,
  );

  return { go, fake, results, pressed };
}

export type ReactionGameState = ReturnType<typeof useReactionGame>;
