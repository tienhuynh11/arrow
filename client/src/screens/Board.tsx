import { useEffect, useMemo, useState } from 'react';
import { MOVE_STEP_MS, TILES } from '@shared/board';
import type { PlayerState, RoomState } from '@shared/protocol';
import { actions } from '../state/store';
import { sfx } from '../utils/sound';
import { useServerClock } from '../utils/hooks';
import Character from '../components/Character';
import Dice from '../components/Dice';

const N = TILES.length;
const TILE_W = 156;
const TILE_H = 84;
/** quân cờ nhảy qua từng ô: chờ một nhịp rồi mỗi nấc xúc xắc đi một ô */
const MOVE_LEAD_MS = 650;

/** Màn bàn cờ "Hành Trình Xuyên Việt": vòng 10 tỉnh, quân cờ, xúc xắc và ô được chọn. */
export default function Board({ room, meId }: { room: RoomState; meId: string }) {
  const board = room.board!;
  const players = room.players.filter((p) => !p.spectator);
  const byId = (id: string) => players.find((p) => p.id === id);
  const now = useServerClock(200);

  const roller = byId(board.rollerId);
  const iAmRoller = board.rollerId === meId;
  const secondsLeft = Math.max(0, Math.ceil((board.deadline - now) / 1000));
  // chỉ lộ ô được chọn khi quân cờ đã đi xong (không thì lộ trước kết quả)
  const [landed, setLanded] = useState(false);
  const picked = board.tileIndex >= 0 && landed ? TILES[board.tileIndex] : null;

  /* ---------------- quân cờ nhảy từng ô ---------------- */
  // ô đang hiển thị của từng người; khác `board.pos` trong lúc quân cờ còn đang đi
  const [shown, setShown] = useState<Record<string, number>>(() => ({ ...board.pos }));
  const [travelling, setTravelling] = useState(false);
  const turnKey = `${board.turn}:${board.stage}`;

  useEffect(() => {
    setLanded(false);
    if (board.stage === 'roll') {
      setShown({ ...board.pos });
      setTravelling(false);
      return;
    }
    // stage moving: bắt đầu từ ô cũ rồi nhảy từng bước theo số xúc xắc của mình
    setShown({ ...board.from });
    setTravelling(true);
    const timers: number[] = [];
    const maxSteps = Math.max(1, ...Object.values(board.dice));
    for (let step = 1; step <= maxSteps; step++) {
      timers.push(
        window.setTimeout(() => {
          setShown((prev) => {
            const next = { ...prev };
            for (const id of Object.keys(board.pos)) {
              if (step <= (board.dice[id] ?? 0)) next[id] = (board.from[id] + step) % N;
            }
            return next;
          });
          sfx.tap();
        }, MOVE_LEAD_MS + (step - 1) * MOVE_STEP_MS),
      );
    }
    timers.push(
      window.setTimeout(() => {
        setTravelling(false);
        setLanded(true);
        sfx.good();
      }, MOVE_LEAD_MS + maxSteps * MOVE_STEP_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [turnKey]);

  /* ---------------- xúc xắc ---------------- */
  const [rolling, setRolling] = useState(false);
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    setRolling(false);
    if (board.stage === 'moving') {
      // vừa tung xong: xúc xắc lắc thêm một chút rồi mới hiện kết quả
      setSpin(true);
      const t = window.setTimeout(() => setSpin(false), 700);
      return () => window.clearTimeout(t);
    }
    setSpin(false);
  }, [turnKey]);

  const canRoll = board.stage === 'roll' && iAmRoller && !rolling;
  const roll = () => {
    if (!canRoll) return;
    setRolling(true);
    sfx.start();
    actions.rollDice();
  };
  useEffect(() => {
    if (!canRoll) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        e.preventDefault();
        roll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRoll, turnKey]);

  /* ---------------- vị trí quân cờ ---------------- */
  const pawns = useMemo(() => {
    const perTile = new Map<number, PlayerState[]>();
    for (const p of players) {
      const t = shown[p.id] ?? 0;
      if (!perTile.has(t)) perTile.set(t, []);
      perTile.get(t)!.push(p);
    }
    const out: { p: PlayerState; x: number; y: number }[] = [];
    for (const [t, list] of perTile) {
      const tile = TILES[t];
      list.forEach((p, k) => {
        const spread = Math.min(30, 130 / Math.max(1, list.length));
        out.push({ p, x: tile.x + (k - (list.length - 1) / 2) * spread, y: tile.y - TILE_H / 2 - 2 });
      });
    }
    return out;
  }, [shown, players.map((p) => p.id).join('|')]);

  const myDice = board.dice[meId] ?? 0;

  return (
    <div className="board">
      <div className="bd-map">
        <svg viewBox="0 -26 1000 486" preserveAspectRatio="xMidYMid meet" className="bd-svg" role="img" aria-label="Bản đồ hành trình">
          <defs>
            <linearGradient id="bd-sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(76,201,240,0.10)" />
              <stop offset="1" stopColor="rgba(179,136,255,0.06)" />
            </linearGradient>
          </defs>
          <rect x="30" y="-6" width="940" height="446" rx="34" fill="url(#bd-sea)" />

          {/* đường đi nối các tỉnh theo vòng */}
          <path className="bd-road" d={`M${TILES[0].x} ${TILES[0].y} H${TILES[4].x} V${TILES[5].y} H${TILES[9].x} Z`} />

          {TILES.map((t, i) => {
            const isPicked = landed && board.tileIndex === i;
            return (
              <g key={t.id} transform={`translate(${t.x} ${t.y})`} className={`bd-tile ${isPicked ? 'picked' : ''} ${t.festival ? 'festival' : ''}`}>
                <rect x={-TILE_W / 2} y={-TILE_H / 2} width={TILE_W} height={TILE_H} rx="16" />
                <text className="bd-emoji" y="-6" textAnchor="middle">
                  {t.emoji}
                </text>
                <text className="bd-name" y="22" textAnchor="middle">
                  {t.name}
                </text>
                <text className="bd-spec" y="37" textAnchor="middle">
                  {t.specialty}
                </text>
                {t.festival && (
                  <g transform={`translate(${TILE_W / 2 - 4} ${-TILE_H / 2 + 6})`}>
                    <rect x="-44" y="-12" width="48" height="20" rx="10" className="bd-fest" />
                    <text x="-20" y="3" textAnchor="middle" className="bd-fest-t">
                      LỄ HỘI
                    </text>
                  </g>
                )}
                <text className="bd-idx" x={-TILE_W / 2 + 10} y={-TILE_H / 2 + 16}>
                  {i + 1}
                </text>
              </g>
            );
          })}

          {pawns.map(({ p, x, y }) => (
            <g key={p.id} className="bd-pawn" style={{ transform: `translate(${x}px, ${y}px)` }}>
              <g transform="translate(-14 -41)">
                <Character color={p.color} size={28} state={travelling && board.dice[p.id] ? 'run' : 'idle'} />
              </g>
              {p.id === meId && <path d="M-5 -48 L5 -48 L0 -41 Z" className="bd-me" />}
            </g>
          ))}
        </svg>

        {/* khu giữa bản đồ: xúc xắc + thông tin lượt */}
        <div className="bd-center">
          <div className="bd-turn">
            CHẶNG {board.turn}/{board.totalTurns}
          </div>

          <div className="bd-row">
            <Dice value={board.stage === 'moving' ? myDice : 0} rolling={rolling || spin} size={70} />
            <div className="bd-info">
              {board.stage === 'roll' ? (
                iAmRoller ? (
                  <>
                    <div className="bd-line">Đến lượt BẠN tung xúc xắc!</div>
                    <button className="btn primary bd-roll" onClick={roll} disabled={!canRoll}>
                      🎲 TUNG XÚC XẮC <span className="bd-count">{secondsLeft}s</span>
                    </button>
                    <div className="bd-sub">hoặc nhấn SPACE · cả phòng cùng đi theo xúc xắc của mình</div>
                  </>
                ) : (
                  <>
                    <div className="bd-line">
                      Chờ <b style={{ color: roller?.color }}>{roller?.name ?? '…'}</b> tung xúc xắc…
                    </div>
                    <div className="bd-sub">tự tung sau {secondsLeft}s · ô bạn đứng cuối cùng cũng có thể được chọn</div>
                  </>
                )
              ) : (
                <>
                  <div className="bd-line">
                    Bạn tung được <b>{myDice}</b>
                  </div>
                  {!picked && <div className="bd-sub">Quân cờ đang di chuyển…</div>}
                  {picked && (
                    <div className="bd-pick">
                      <span className="bd-pick-emoji">{picked.emoji}</span>
                      <span>
                        <b>{picked.name}</b> · {picked.title}
                        <em>
                          Đặc sản: {picked.specialty} · +{picked.value} Điểm Văn Hoá
                          {picked.festival ? ' (lễ hội)' : ''}
                        </em>
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* huy hiệu đặc sản mỗi người đã thu thập */}
      <div className="bd-badges">
        {players.map((p) => {
          const owned = board.badges[p.id] ?? [];
          return (
            <span key={p.id} className={`bd-chip ${p.id === meId ? 'me' : ''}`} style={{ '--c': p.color } as React.CSSProperties}>
              <b>{p.name}</b>
              <span className="bd-chip-b">{owned.length ? owned.map((i) => TILES[i].emoji).join('') : '–'}</span>
              <em>{owned.length}/{N}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}
