import { useEffect, useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { useServerClock } from '../../utils/hooks';
import { sfx } from '../../utils/sound';
import DrawPad from './DrawPad';
import Vote from './Vote';
import Result from './Result';
import type { ArtShowState } from './useArtShowGame';

interface Props {
  game: ArtShowState;
  gameId: string;
  config: any;
  startAt: number;
  players: PlayerState[];
  meId: string;
  live: boolean;
}

export default function ArtShow({ game, gameId, config, startAt, players, meId, live }: Props) {
  const now = useServerClock(200);
  const ph = game.ph?.ph ?? 'draw';
  const topic: string = game.ph?.topic ?? config.topic;
  const drawEnd = startAt + (config.drawMs ?? 55000);
  const endAt = ph === 'draw' ? game.ph?.endAt ?? drawEnd : game.ph?.endAt ?? 0;
  const left = Math.max(0, Math.ceil((endAt - now) / 1000));
  const lastTick = useRef(-1);

  useEffect(() => {
    if (ph !== 'result' && live && left > 0 && left <= 5 && lastTick.current !== left) {
      lastTick.current = left;
      sfx.tick();
    }
  }, [left, ph, live]);

  const drawing = ph === 'draw';
  const activeDraw = drawing && live && now < drawEnd;

  return (
    <div className={`as as-${ph}`}>
      <div className="as-top">
        <span className="as-title">🎨 ĐẠI HỘI HỌA SĨ</span>
        {drawing && (
          <span className="as-topic">
            Chủ đề: <b>{topic}</b>
          </span>
        )}
        {ph === 'vote' && (
          <span className="as-topic">
            Bình chọn · <b>{game.prog.voted}/{game.prog.total}</b> đã bầu
          </span>
        )}
        {ph === 'result' && (
          <span className="as-topic">
            Chủ đề: <b>{topic}</b>
          </span>
        )}
        {ph !== 'result' && (
          <span className={`as-clock ${left <= 10 ? 'low' : ''}`} aria-label="Thời gian còn lại">
            ⏱ {left}s
          </span>
        )}
      </div>
      {drawing && (
        <>
          {!live && <div className="as-wait">Chuẩn bị bút… chủ đề: {topic}</div>}
          {live && <DrawPad gameId={gameId} active={activeDraw} endAt={drawEnd} restore={game.restore} />}
        </>
      )}
      {ph === 'vote' && <Vote game={game} />}
      {ph === 'result' && <Result game={game} players={players} meId={meId} />}
    </div>
  );
}
