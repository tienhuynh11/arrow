import { useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ReactionResult {
  falseStart: boolean;
  ms: number;
  /** hạng của người này trong vòng hiện tại (chỉ tính người nhấn hợp lệ) */
  order: number;
  /** điểm của vòng đó */
  points: number;
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

export const resultText = (r?: ReactionResult) =>
  !r ? '-' : r.falseStart ? 'NHẤN SỚM' : `${MEDALS[Math.min(r.order - 1, 3)]} ${r.ms} ms`;

/** Trạng thái + điều khiển của PHẢN XẠ NHANH (nhiều vòng), dùng cho cảnh 3D. */
export function useReactionGame({ gameId, config, meId, live }: GameProps) {
  const totalRounds = (config.rounds as number | undefined) ?? 1;
  /** vòng đang diễn ra, bắt đầu từ 0; -1 = chưa vào vòng nào */
  const [round, setRound] = useState(-1);
  const [go, setGo] = useState(false);
  const [fake, setFake] = useState(0);
  /** kết quả của vòng hiện tại, dọn khi sang vòng mới */
  const [results, setResults] = useState<Record<string, ReactionResult>>({});
  /** tổng điểm cộng dồn qua các vòng */
  const [totals, setTotals] = useState<Record<string, number>>({});
  const roundRef = useRef(-1);
  const pressedRound = useRef(-1);

  useGameEvents(gameId, (p) => {
    if (p.type === 'round') {
      roundRef.current = p.index;
      setRound(p.index);
      setGo(false);
      setFake(0);
      setResults({});
      return;
    }
    // tin của vòng cũ đến muộn thì bỏ qua
    if (typeof p.round === 'number' && p.round !== roundRef.current) return;

    if (p.type === 'go') {
      setGo(true);
      sfx.start();
      return;
    }
    if (p.type === 'fake') {
      // tín hiệu giả: chỉ nhấp nháy, ai nhấn vào đây là nhấn sớm
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
                points: p.points ?? 0,
                order: Object.values(r).filter((x) => !x.falseStart).length + (p.falseStart ? 0 : 1),
              },
            },
      );
      setTotals((t) => ({ ...t, [p.playerId]: (t[p.playerId] ?? 0) + (p.points ?? 0) }));
      if (p.playerId === meId) (p.falseStart ? sfx.miss : sfx.perfect)();
    }
  });

  useKeys(
    {
      Space: () => {
        const r = roundRef.current;
        if (r < 0 || pressedRound.current === r) return; // mỗi vòng chỉ nhấn một lần
        pressedRound.current = r;
        net.input(gameId, { type: 'press', at: net.now() });
      },
    },
    live,
  );

  return { go, fake, results, totals, round, totalRounds };
}

export type ReactionGameState = ReturnType<typeof useReactionGame>;
