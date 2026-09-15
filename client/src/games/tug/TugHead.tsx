import type { TugGameState } from './useTugGame';

export default function TugHead({ game }: { game: TugGameState }) {
  return (
    <div className="tw-head">
      <span className={`tw-badge ${game.myTeam === 'A' ? 'a' : 'b'}`}>
        Bạn thuộc {game.myTeam === 'A' ? 'ĐỘI XANH' : 'ĐỘI ĐỎ'}
      </span>
      <span className="tw-timer">{game.winner ? 'KẾT THÚC' : `${game.remain}s`}</span>
    </div>
  );
}
