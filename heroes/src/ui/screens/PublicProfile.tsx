// Hồ sơ công khai của người chơi khác: mở bằng <PublicProfileModal name="..." onClose={...} />.
// Gắn vào: bảng xếp hạng + thẻ đối thủ (không phải bot) ở Đấu trường, danh sách thành viên ở Bang hội.
import { useEffect, useState } from 'preact/hooks';
import type { PublicProfile } from '@shared/heroes/api';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { STAGES } from '@shared/heroes/stages';
import { TOWER_MAX_FLOOR } from '@shared/heroes/tower';
import { api } from '../../api';
import { fmt } from '../../state';
import { Btn, Modal, Portrait, Stars } from '../common';
import { Icon } from '../icons';
import { StatCell } from './profile-common';
import '../profile.css';

export function PublicProfileModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState('');
  const load = () => {
    setErr('');
    api.profile(name).then((r) => setP(r.profile)).catch((e) => setErr(e?.message || 'Không tải được hồ sơ'));
  };
  useEffect(load, [name]);

  const lead = p?.squad[0] ? HERO_BY_ID[p.squad[0].id] : null;
  const stage = p && p.stage > 0 ? STAGES[Math.min(STAGES.length, p.stage) - 1] : null;
  return (
    <Modal title="Hồ sơ người chơi" onClose={onClose} wide class="pf-pubm">
      {!p ? (
        <div class="pf-load">
          {err ? (
            <>
              <p class="pf-red">{err}</p>
              <Btn kind="blue" small onClick={load}>Thử lại</Btn>
            </>
          ) : (
            <p class="muted">Đang tải...</p>
          )}
        </div>
      ) : (
        <>
          <div class="pf-pubhead">
            <span class={`pf-av r-${lead?.rarity ?? 'R'}`} style={{ '--s': '68px' } as any}>
              <span class="pf-face">{lead ? <Portrait id={lead.id} rarity={lead.rarity} /> : <b>{p.username.slice(0, 1).toUpperCase()}</b>}</span>
              <span class="pf-av-lv">{p.level}</span>
            </span>
            <div class="pf-pubtx">
              <h3 class="pf-name">{p.username}</h3>
              <div class="pf-lvline">
                <span class="pf-lvtag">Cấp {p.level}</span>
                <span class="pf-pow"><Icon n="sword" size={18} /> {fmt(p.power)}</span>
              </div>
            </div>
          </div>
          <h4 class="pf-h">Đội hình</h4>
          <div class="pf-pubsquad">
            {p.squad.length === 0 && <small class="muted">Chưa có đội hình.</small>}
            {p.squad.map((s, i) => {
              const d = HERO_BY_ID[s.id];
              return d ? (
                <div class={`pf-pc r-${d.rarity}`} key={i} title={d.name}>
                  <span class="pf-pc-art"><Portrait id={d.id} rarity={d.rarity} /></span>
                  <small class="pf-pc-lv">Lv{s.level}</small>
                  <Stars n={s.star} size={11} />
                </div>
              ) : null;
            })}
          </div>
          <div class="pf-stats">
            <StatCell ic="battle" label="Ải đã qua" value={`${p.stage}/${STAGES.length}`} sub={stage?.name} />
            <StatCell ic="tower" label="Tầng tháp" value={`${p.tower}/${TOWER_MAX_FLOOR}`} />
            <StatCell ic="arena" label="Đấu trường" value={`${fmt(p.arenaRating)} điểm`} sub={`${p.arenaWins} thắng`} />
            <StatCell ic="heroes" label="Số tướng" value={p.heroCount} />
            <StatCell ic="guild" label="Bang hội" value={p.guild ?? 'Chưa vào bang'} />
            <StatCell ic="trophy" label="Thành tựu hoàn thành" value={p.achDone} />
          </div>
        </>
      )}
    </Modal>
  );
}
