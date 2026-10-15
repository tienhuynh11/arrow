import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { buildEdges, distanceField, N } from '@shared/wallrush';
import { createWallRushScene } from '../../three/wallRushScene';
import { useLatest, useScene } from '../view3d';
import { boardOf, type WallRushState } from './useWallRushGame';

/** biểu tượng tường: thanh gỗ nhỏ */
function WallIcon({ color }: { color: string }) {
  return <i className="wr-wallicon" style={{ background: color }} aria-hidden="true" />;
}

export default function WallRush3D({ game, players, meId }: { game: WallRushState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const { table, seat, cfg, ti } = game;
  const rosterKey = table.players.map((id) => `${id}:${players.find((p) => p.id === id)?.color}`).join('|');
  const seated = table.players.map((id) => players.find((p) => p.id === id)).filter(Boolean) as PlayerState[];

  useScene(
    hostRef,
    (host, hooks) =>
      createWallRushScene({
        host,
        hooks,
        players: seated.map((p) => ({ id: p.id, color: p.color })),
        sides: table.sides,
        meId,
        read: () => {
          const g = gameRef.current;
          return {
            cfg: g.cfg,
            ti: g.ti,
            seat: g.seat,
            st: g.st.current,
            mode: g.modeRef.current,
            manualO: g.manualO.current,
            live: g.live,
            serverNow: g.serverNow,
          };
        },
        labels: labels.current,
        ui: {
          setHover: (h) => gameRef.current.setHover(h),
          setTouch: () => gameRef.current.setTouch(true),
          doMove: (x, y) => gameRef.current.doMove(x, y),
          doWall: (x, y, o) => gameRef.current.doWall(x, y, o),
        },
      }),
    [rosterKey, meId],
  );

  // đồng hồ lượt theo giờ server
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(gameRef.current.serverNow()), 100);
    return () => window.clearInterval(id);
  }, []);

  const st = game.st.current;
  void game.ver;
  const board = boardOf(cfg, ti, st);
  const edges = buildEdges(st.walls);
  const dist = st.pos.map((p, i) => {
    const f = distanceField(edges, board.sides[i]);
    return f[p.y * N + p.x];
  });

  const myTurn = !st.over && seat >= 0 && st.turn === seat;
  const turnLeft = Math.max(0, (st.endsAt - now) / 1000);
  const tm = useRef({ endsAt: 0, total: 12000 });
  if (tm.current.endsAt !== st.endsAt) tm.current = { endsAt: st.endsAt, total: Math.max(1500, st.endsAt - game.serverNow()) };
  const frac = Math.max(0, Math.min(1, (turnLeft * 1000) / tm.current.total));
  const urgent = turnLeft <= 3 && !st.over;
  const turnColor = !st.over && st.turn >= 0 ? seated[st.turn]?.color ?? '#fff' : '#fff';
  const hover = game.hover;
  const wallLeft = seat >= 0 ? st.wl[seat] : 0;

  let banner = '';
  let bannerKind = '';
  if (st.over) {
    if (st.winner >= 0) {
      const wname = seated[st.winner]?.name ?? '';
      if (st.winner === seat) {
        banner = 'BẠN THẮNG BÀN!';
        bannerKind = 'win';
      } else {
        banner = `${wname} THẮNG BÀN`;
        bannerKind = 'lose';
      }
    } else {
      const rank = st.order.indexOf(seat) + 1;
      banner = rank > 0 ? `HẾT GIỜ · BẠN HẠNG ${rank}/${table.players.length}` : 'HẾT GIỜ';
      bannerKind = 'time';
    }
  } else if (myTurn) {
    banner = 'ĐẾN LƯỢT BẠN!';
    bannerKind = 'mine';
  } else if (st.turn >= 0) {
    banner = `Lượt của ${seated[st.turn]?.name ?? ''}`;
    bannerKind = 'other';
  }

  const hint =
    game.mode === 'wall'
      ? 'Rê chuột vào rãnh giữa các ô, bấm để đặt tường (R: xoay · Esc: về đi quân)'
      : 'Bấm vào ô sáng để đi · W: đặt tường';

  return (
    <div className="g3d-game wr-game">
      <div className="wr-bar">
        {cfg.tables.length > 1 && (
          <span className="wr-table">
            BÀN <b>{ti + 1}</b>/{cfg.tables.length}
          </span>
        )}
        {seated.map((p, s) => (
          <div
            key={p.id}
            className={`wr-chip ${!st.over && st.turn === s ? 'turn' : ''} ${p.id === meId ? 'me' : ''} ${st.winner === s ? 'won' : ''}`}
            style={{ ['--c' as string]: p.color }}
          >
            <span className="wr-dot" />
            <span className="wr-name">{p.name}</span>
            <span className="wr-stat" title="Số tường còn lại">
              <WallIcon color={p.color} />
              <b>{st.wl[s]}</b>
            </span>
            <span className="wr-stat" title="Số bước ngắn nhất tới đích">
              ➜ <b>{dist[s]}</b>
            </span>
          </div>
        ))}
      </div>

      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host wr-host" />
        {banner && game.live && (
          <div className={`wr-banner ${bannerKind}`} style={{ ['--c' as string]: turnColor }}>
            <span>{banner}</span>
            {!st.over && (
              <span className={`wr-count ${urgent ? 'urgent' : ''}`}>
                {Math.ceil(turnLeft)}
              </span>
            )}
            {!st.over && (
              <span className="wr-timer">
                <i style={{ width: `${frac * 100}%`, background: turnColor }} />
              </span>
            )}
          </div>
        )}
        {!st.over && game.mode === 'wall' && hover?.kind === 'wall' && !hover.ok && hover.reason && (
          <div className="wr-reason">✖ {hover.reason}</div>
        )}
        {!st.over && game.mode === 'wall' && hover?.kind === 'wall' && hover.ok && <div className="wr-reason ok">✔ Đặt được</div>}
        <div className="wr-log">
          {game.log.map((l) => (
            <div key={l.id} style={{ color: l.color }}>
              {l.text}
            </div>
          ))}
        </div>
        <div className="g3d-labels">
          {seated.map((p, s) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color, opacity: !st.over && st.turn === s ? 1 : 0.85 }}
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>

      <div className="wr-ctl">
        <button
          type="button"
          className={`btn ${game.mode === 'move' ? 'primary' : ''}`}
          onClick={() => game.setMode('move')}
          disabled={seat < 0}
        >
          ĐI QUÂN
        </button>
        <button
          type="button"
          className={`btn ${game.mode === 'wall' ? 'primary' : ''}`}
          onClick={() => game.setMode(game.mode === 'wall' ? 'move' : 'wall')}
          disabled={seat < 0 || wallLeft <= 0}
          title="Phím W"
        >
          ĐẶT TƯỜNG <b>{wallLeft}</b>
        </button>
        {game.mode === 'wall' && (
          <button type="button" className="btn" onClick={() => game.rotate(hover?.o)} title="Phím R">
            XOAY {hover?.o === 'v' ? '┃' : '━'}
          </button>
        )}
        {game.mode === 'wall' && game.touch && (
          <button type="button" className="btn primary" onClick={() => game.confirm()} disabled={!(hover?.kind === 'wall' && hover.ok)}>
            XÁC NHẬN
          </button>
        )}
      </div>
      <p className="hint">{hint}</p>
    </div>
  );
}
