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
import { lavaRunGame } from './lavaRun.js';
import { blockPartyGame } from './blockParty.js';
import { memoryMatchGame } from './memoryMatch.js';
import { tipToeGame } from './tipToe.js';
import { codeHuntGame } from './codeHunt.js';
import { blindShotGame } from './blindShot.js';
import { bombMazeGame } from './bombMaze.js';
import { musicalChairsGame } from './musicalChairs.js';
import { actNaturalGame } from './actNatural.js';
import { rooftopBrawlGame } from './rooftopBrawl.js';
import { quizGame } from './quizGame.js';
import { wallRushGame } from './wallRush.js';
import { tanksGame } from './tankTrouble.js';
import { fartGame } from './fart.js';
import { disasterGame } from './disaster.js';
import { artShowGame } from './artShow.js';
import { treasureGame } from './treasure.js';
import { fishingGame } from './fishing.js';

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
  lavaRunGame,
  blockPartyGame,
  memoryMatchGame,
  tipToeGame,
  codeHuntGame,
  blindShotGame,
  bombMazeGame,
  musicalChairsGame,
  actNaturalGame,
  rooftopBrawlGame,
  quizGame,
  wallRushGame,
  fartGame,
  tanksGame,
  disasterGame,
  artShowGame,
  treasureGame,
  fishingGame,
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);

/** game còn gắn nhãn "CHƯA CẬP NHẬT" trong tên thì ẩn khỏi màn chọn và trận thường; bỏ nhãn đi là tự hiện lại */
export const isHidden = (g: GameDefinition) => g.name.includes('CHƯA CẬP NHẬT');
const VISIBLE = () => GAMES.filter((g) => !isHidden(g));

/** danh sách gọn để client dựng màn chọn game */
export const gameCatalog = () =>
  VISIBLE().map((g) => ({ id: g.id, name: g.name, instructions: g.instructions }));

/**
 * Một trận chơi HẾT các minigame mà phòng đã chọn (mặc định là tất cả),
 * thứ tự xáo trộn mỗi trận.
 */
export function pickMatchGames(playerCount: number, allowed?: string[]): string[] {
  const pool = VISIBLE().filter(
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
