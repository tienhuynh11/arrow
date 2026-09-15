import { ARROW, type SequenceGameState } from './useSequenceGame';

export default function SequenceHead({ game, meId }: { game: SequenceGameState; meId: string }) {
  const { rounds } = game;
  const me = game.prog[meId] ?? { round: 0, index: 0, errors: 0, done: false };
  const current = rounds[Math.min(me.round, rounds.length - 1)];
  if (me.done) return <div className="seq-done">HOÀN THÀNH! ⚡</div>;
  return (
    <>
      <div className="seq-round">
        CHUỖI {me.round + 1}/{rounds.length}
        {Date.now() - game.timedOut < 900 && <span className="seq-timeout"> · QUÁ CHẬM, LÀM LẠI!</span>}
      </div>
      <div className={`seq-keys ${current.length > 6 ? 'dense' : ''} ${Date.now() - game.shake < 300 ? 'shake' : ''}`}>
        {current.map((k, i) => (
          <span key={i} className={`seq-key ${i < me.index ? 'hit' : i === me.index ? 'next' : ''}`}>
            {ARROW[k]}
          </span>
        ))}
      </div>
    </>
  );
}
