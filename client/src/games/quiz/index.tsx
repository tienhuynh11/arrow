import type { GameProps } from '../types';
import Quiz from './Quiz';
import { useQuizGame } from './useQuizGame';

export default function QuizGame(props: GameProps) {
  const game = useQuizGame(props);
  return <Quiz game={game} players={props.players} meId={props.meId} live={props.live} />;
}
