import { JUDGE_LABEL, type RhythmGameState } from './useRhythmGame';

export default function RhythmJudge({ game, meId }: { game: RhythmGameState; meId: string }) {
  const mine = game.status[meId];
  const showJudge = mine && Date.now() - mine.at < 520;
  return (
    <>
      {showJudge && (
        <div className={`judge judge-${mine.judge}`}>
          {JUDGE_LABEL[mine.judge]}
          {mine.note === 'gold' && mine.judge !== 'MISS' && mine.judge !== 'TRAP' ? ' ⭐x2' : ''}
        </div>
      )}
      {mine && mine.combo > 1 && <div className="combo">{mine.combo} COMBO</div>}
    </>
  );
}
