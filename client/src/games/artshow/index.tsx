import type { GameProps } from '../types';
import ArtShow from './ArtShow';
import { useArtShowGame } from './useArtShowGame';

export default function ArtShowGame(props: GameProps) {
  const game = useArtShowGame(props);
  return (
    <ArtShow
      game={game}
      gameId={props.gameId}
      config={props.config}
      startAt={props.startAt}
      players={props.players}
      meId={props.meId}
      live={props.live}
    />
  );
}
