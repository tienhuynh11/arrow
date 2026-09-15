import type { MathGameState } from './useMathGame';

export function MathHead({ game }: { game: MathGameState }) {
  return (
    <div className="math-head">
      <span className="math-count">
        CÂU {Math.min(game.index + 1, game.questions.length)}/{game.questions.length}
      </span>
      <div className="math-timer">
        <div
          className={`math-timer-fill ${game.progress < 0.3 ? 'urgent' : ''}`}
          style={{ width: `${game.progress * 100}%` }}
        />
      </div>
    </div>
  );
}

export function MathStatus({ game }: { game: MathGameState }) {
  const { myLock, reveal } = game;
  return (
    <div className="math-status">
      {myLock ? (
        <span className={`math-locked ${myLock.ok && reveal !== null ? 'ok' : ''} ${!myLock.ok && reveal !== null ? 'bad' : ''}`}>
          🔒 ĐÃ CHỐT
          {myLock.order > 0 && <b> · CHỐT ĐÚNG THỨ {myLock.order}</b>}
          {reveal !== null && <b>{myLock.gained >= 0 ? ` +${myLock.gained}` : ` ${myLock.gained}`}</b>}
        </span>
      ) : (
        <span className="math-hintline">Đứng vào ô rồi nhấn SPACE để chốt</span>
      )}
    </div>
  );
}

export function MathHint() {
  return <p className="hint">← → chạy sang ô · SPACE chốt · chốt đúng SỚM NHẤT ăn nhiều điểm nhất</p>;
}
