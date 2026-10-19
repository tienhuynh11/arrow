// Cân bằng ải (chế độ mang đồ): bot một mình với bộ đồ khởi đầu (súng lục trắng + dao + 2 hộp cứu thương)
// phải qua được 1-1 và thua ở khoảng 1-8. Dùng chung cho monkeyProgress.test.ts và chạy tay:
//   cd server && npx tsx test/monkeyStageBalance.ts [ải...]
import type { EquipSlot, Grade } from '../../shared/monkey/gear.js';
import { STARTER_KIT, loadoutOf2, type ItemInst, type Loadout2, type Stats2 } from '../../shared/monkey/progression.js';
import { runSim } from './monkeySim.js';

let uid = 1;
/** món đồ giả (chưa có trong DB) để dựng Loadout2 bằng đúng công thức thật */
export const inst = (itemId: string, slot: EquipSlot, grade: Grade = 0, level = 1, count = 1, affixes: Stats2 = {}): ItemInst => ({ uid: uid++, itemId, grade, level, affixes, count, slot, stash: false });
const SK = { g: 1, x: 1, q: 1 };

/** bộ tân binh (STARTER_KIT): súng lục trắng + dao + 2 bình máu nhỏ */
export function starterLoadout(cls: number): Loadout2 {
  return loadoutOf2(STARTER_KIT.map((k) => inst(k.itemId, k.slot, k.grade, 1, k.count)), cls, SK);
}

/** bộ đồ khá (tím, cấp 5): súng trường + giáp/mũ/găng/nhẫn — đủ cho ải giữa chương */
export function strongLoadout(cls: number): Loadout2 {
  return loadoutOf2([
    inst('g_mangxa', 'weapon1', 2, 5), inst('g_k9', 'weapon2', 2, 5), inst('k_gam', 'knife', 2, 5),
    inst('h_sat', 'helmet', 2, 5), inst('a_xich', 'armor', 2, 5), inst('gl_vai', 'gloves', 2, 5), inst('bt_da', 'belt', 2, 5),
    inst('r_bac', 'ring1', 2, 5), inst('am_go', 'amulet', 2, 5),
    inst('q_maulon', 'quick1', 1, 1, 4), inst('q_luudan', 'quick2', 0, 1, 4),
  ], cls, SK);
}

export interface StageRun { stage: string; won: boolean; wave: number; lastWave: number; secs: number }

export function runStage(stage: string, seed: number, cls = 0, loadout = starterLoadout(cls), skill = 0.6): StageRun {
  let won = false;
  const r = runSim({
    players: 1, classes: [cls], rtt: 60, jitter: 5, seconds: 1500, seed, skill, stage,
    loadout: () => loadout,
    onRoom: (room) => {
      const orig = room.broadcast.bind(room);
      room.broadcast = (m) => { if (m.t === 'victory') won = true; orig(m); };
    },
  });
  return { stage, won, wave: r.wave, lastWave: r.room.lastWave, secs: Math.round(r.simMs / 1000) };
}

if (process.argv[1]?.endsWith('monkeyStageBalance.ts')) {
  const args = process.argv.slice(2);
  const strong = args.includes('--strong');
  const skill = Number(args.find((a) => a.startsWith('--skill='))?.slice(8) ?? 0.6);
  const stages = args.filter((a) => !a.startsWith('--'));
  for (const st of stages.length ? stages : ['1-1', '1-4', '1-8']) {
    for (const seed of [1, 2, 3]) {
      const r = runStage(st, seed, 0, strong ? strongLoadout(0) : starterLoadout(0), skill);
      console.log(`${st} seed ${seed}: ${r.won ? 'THẮNG' : 'thua'} ở đợt ${r.wave}/${r.lastWave} sau ${r.secs}s`);
    }
  }
}
