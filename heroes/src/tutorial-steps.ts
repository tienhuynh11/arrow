// Kịch bản hướng dẫn tân thủ: mỗi bước có hàm plan() tính lại liên tục theo màn hình hiện tại,
// nên người chơi đi lạc sang màn khác thì lời nhắc tự đổi thành "chạm tab ... để quay lại".
import { SSR_PITY, UR_PITY } from '@shared/heroes/gacha';
import { me } from './api';
import { screen } from './state';

/** một bước nhìn thấy gì lúc này */
export interface Plan {
  /** id data-tut cần làm nổi (nhiều ứng viên ngăn bằng '|', lấy cái đang hiện); null = bong bóng giữa/đầu màn hình */
  target: string | null;
  text: string;
  /** true = chờ người chơi tự thao tác lên đối tượng (vùng sáng bấm xuyên được); false = chỉ bấm "Tiếp" */
  act?: boolean;
  /** true = không phủ tối, không chặn thao tác (dùng khi đang xem trận đánh / kết quả) */
  quiet?: boolean;
}
/** ảnh chụp số liệu lúc vào bước, để biết người chơi đã làm xong thao tác chưa */
export interface Ctx {
  spend: number;
  levels: number;
}
export interface Step {
  id: string;
  plan(): Plan;
  /** tự qua bước khi điều kiện đạt (kiểm tra mỗi nhịp) */
  done?(c: Ctx): boolean;
  /** true = tạm ẩn lớp hướng dẫn (ví dụ đang xem hiệu ứng mở thẻ) */
  hold?(): boolean;
}

const scr = () => screen.value.n;
const FULL = ['battle', 'result', 'towerResult', 'arenaResult'];

/** phần tử đang hiện (có kích thước) theo danh sách id 'a|b' */
export function findTarget(spec: string | null): HTMLElement | null {
  if (!spec) return null;
  for (const id of spec.split('|')) {
    const el = document.querySelector<HTMLElement>(`[data-tut="${id}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}
const visible = (id: string): boolean => !!findTarget(id);

export function snapshot(): Ctx {
  const m = me.value;
  if (!m) return { spend: 0, levels: 0 };
  return { spend: m.wallet.tickets + m.wallet.gems, levels: m.heroes.reduce((a, h) => a + h.level, 0) };
}

/** các bước cần ở Thành: đang ở màn khác thì chỉ đường về */
const needHub = (): Plan | null => (scr() === 'hub' ? null : { target: 'nav-hub', act: true, text: 'Chạm tab "Thành" để quay về màn chính.' });

/** tướng làm linh vật trong bong bóng (dùng lại chân dung procedural đã cache) */
export const MASCOT = 'thay_thuoc';

export const STEPS: Step[] = [
  {
    id: 'welcome',
    plan: () => ({
      target: null,
      text: 'Chào mừng đến Linh Giới! Mình sẽ chỉ bạn vài bước đầu tiên, rất nhanh thôi. Bạn có thể bấm "Bỏ qua" bất cứ lúc nào.',
    }),
  },
  {
    id: 'squad',
    plan: () =>
      scr() !== 'squad'
        ? { target: 'nav-squad', act: true, text: 'Trước hết hãy xem Đội hình. Chạm tab "Đội hình" nhé.' }
        : {
            target: 'squad-board',
            text: 'Đội hình có tối đa 6 ô chia 3 hàng (Trước, Giữa, Sau); ban đầu mở 3 ô, lên cấp 5, 10, 18 mở thêm ô. Hàng trước chịu đòn, hàng sau ít bị đánh. Chạm một ô rồi chọn tướng, hoặc kéo thả để đổi chỗ. Đội đầu tiên đã xếp sẵn cho bạn.',
          },
  },
  {
    id: 'summon',
    plan: () =>
      scr() !== 'summon'
        ? { target: 'nav-summon', act: true, text: 'Giờ đến Triệu hồi để có thêm tướng. Chạm tab "Triệu hồi".' }
        : { target: 'summon-x1', act: true, text: 'Bạn có sẵn vé miễn phí. Bấm "Quay x1" để triệu hồi một tướng.' },
    done: (c) => snapshot().spend < c.spend,
  },
  {
    id: 'pity',
    hold: () => !!document.querySelector('.reveal'), // chờ người chơi xác nhận xong màn lật thẻ
    plan: () => ({
      target: scr() === 'summon' ? 'summon-pity' : null,
      text: `Thanh bảo hiểm: sau ${SSR_PITY} lượt chưa ra SSR thì lượt kế chắc chắn ra SSR, sau ${UR_PITY} lượt thì chắc chắn ra UR. Tướng trùng sẽ đổi thành mảnh để lên sao.`,
    }),
  },
  {
    id: 'hero',
    plan: () => {
      if (scr() !== 'heroes') return { target: 'nav-heroes', act: true, text: 'Tướng mới cần được nâng cấp. Chạm tab "Tướng".' };
      if (!visible('lvup')) return { target: 'hero-card', act: true, text: 'Chạm vào một tướng để xem chi tiết.' };
      return { target: 'lvup', act: true, text: 'Bấm "Lên cấp" để tăng một cấp, chỉ số tướng sẽ mạnh lên ngay.' };
    },
    done: (c) => (me.value?.heroes.reduce((a, h) => a + h.level, 0) ?? 0) > c.levels,
  },
  {
    id: 'battle-go',
    hold: () => FULL.includes(scr()) && scr() !== 'battle',
    plan: () => {
      const s = scr();
      if (s === 'hub') return { target: 'hub-go', act: true, text: 'Sẵn sàng ra trận! Chạm nút CHIẾN.' };
      if (s === 'campaign')
        return visible('pb-go')
          ? { target: 'pb-go', act: true, text: 'Bấm "Bắt đầu" để vào trận đầu tiên.' }
          : { target: 'stage-next', act: true, text: 'Chạm ải đang sáng (ải 1-1) để xem thông tin.' };
      return { target: 'nav-hub', act: true, text: 'Chạm tab "Thành" rồi bấm CHIẾN.' };
    },
    done: () => scr() === 'battle',
  },
  {
    id: 'battle',
    plan: () => ({
      target: null,
      quiet: true,
      text: 'Trận tự đánh theo lượt! Bật AUTO để tướng tự dùng tuyệt kỹ, đổi tốc độ x1/x2/x3, hoặc tự bấm nút tuyệt kỹ khi thanh nộ đầy.',
    }),
    done: () => scr() !== 'battle',
  },
  {
    id: 'result',
    hold: () => scr() === 'battle',
    plan: () => {
      const s = screen.value;
      const win = s.n === 'result' ? s.res.win : true;
      return {
        target: null,
        quiet: true,
        text: win
          ? 'Thắng rồi! Bạn nhận vàng, EXP bình và XP tài khoản; lần đầu qua ải còn có kim cương. Đánh càng giỏi càng nhiều sao.'
          : 'Thua cũng không sao! Hãy nâng cấp tướng hoặc đổi đội hình rồi thử lại.',
      };
    },
    done: () => scr() !== 'result' && scr() !== 'battle',
  },
  {
    id: 'afk',
    hold: () => FULL.includes(scr()),
    plan: () =>
      needHub() ?? {
        target: 'hub-afk',
        text: 'Treo máy: tướng tự kiếm vàng và EXP khi bạn vắng mặt (tối đa 12 giờ). Chạm khung này để nhận thưởng bất cứ lúc nào.',
      },
  },
  {
    id: 'acts',
    hold: () => FULL.includes(scr()),
    plan: () =>
      needHub() ?? {
        target: 'hub-acts|hub-dock',
        text: 'Mục Hoạt động: Nhiệm vụ ngày (nhận quà mỗi ngày), Cửa hàng, Tháp thử thách, Đấu trường (thách đấu người chơi khác) và Bang. Mỗi ngày ghé qua nhé!',
      },
  },
  {
    id: 'finish',
    plan: () => ({
      target: null,
      text: 'Xong rồi! Bạn đã nắm các bước cơ bản. Muốn xem lại hướng dẫn, vào Cài đặt chọn "Xem lại hướng dẫn". Chúc bạn chơi vui!',
    }),
  },
];
