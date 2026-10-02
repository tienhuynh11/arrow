import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useBlockPartyGame } from './useBlockPartyGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const BlockParty3D = lazy(() => import('./BlockParty3D'));

export default function BlockPartyGame(props: GameProps) {
  const game = useBlockPartyGame(props);
  return <Scene3D render={() => <BlockParty3D game={game} players={props.players} meId={props.meId} />} />;
}
