import type { GameDefinition } from './types.js';
import { rhythmGame } from './rhythm.js';
import { reactionGame } from './reaction.js';
import { sequenceGame } from './sequence.js';
import { raceGame } from './race.js';
import { buttonBattleGame } from './buttonBattle.js';
import { mathRushGame } from './mathRush.js';
import { dodgeGame } from './dodge.js';
import { hotPotatoGame } from './hotPotato.js';
import { tugWarGame } from './tugWar.js';
import { coconutGame } from './coconut.js';
import { hexAGoneGame } from './hexAGone.js';
import { doorDashGame } from './doorDash.js';
import { fallMountainGame } from './fallMountain.js';
import { jumpShowdownGame } from './jumpShowdown.js';
import { blockPartyGame } from './blockParty.js';
import { memoryMatchGame } from './memoryMatch.js';
import { tipToeGame } from './tipToe.js';

/** Add a new minigame here and the match loop picks it up automatically. */
export const GAMES: GameDefinition[] = [
  rhythmGame,
  reactionGame,
  sequenceGame,
  raceGame,
  buttonBattleGame,
  mathRushGame,
  dodgeGame,
  hotPotatoGame,
  tugWarGame,
  coconutGame,
  hexAGoneGame,
  doorDashGame,
  fallMountainGame,
  jumpShowdownGame,
  blockPartyGame,
  memoryMatchGame,
  tipToeGame,
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);

/** danh sách gọn để client dựng màn chọn game */
export const gameCatalog = () =>
  GAMES.map((g) => ({ id: g.id, name: g.name, instructions: g.instructions }));

/**
 * Một trận chơi HẾT các minigame mà phòng đã chọn (mặc định là tất cả),
 * thứ tự xáo trộn mỗi trận.
 */
export function pickMatchGames(playerCount: number, allowed?: string[]): string[] {
  const pool = GAMES.filter(
    (g) =>
      playerCount >= g.minPlayers &&
      playerCount <= g.maxPlayers &&
      (!allowed || allowed.length === 0 || allowed.includes(g.id)),
  ).map((g) => g.id);
  // Fisher-Yates: xáo đều, không lệch như sort(() => Math.random() - 0.5)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
