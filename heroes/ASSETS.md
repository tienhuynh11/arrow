# Nguồn asset

## 3D

**Hiện không có asset 3D ngoài nào trong game**: mọi tướng và quái là chibi dựng bằng code (`src/render/procedural-model.ts`).

Bộ nạp glTF (`src/render/gltf-model.ts`) vẫn còn nhưng đang tắt (`GLTF_HEROES` rỗng). Đã thử gói Quaternius *LowPoly RPG Characters* (CC0, https://opengameart.org/node/126989) cho Lính Rừng và Pháp Sư Rễ Cây. Phong cách giả tưởng thực tế không hợp giao diện tươi sáng nên đã gỡ file model.

Nếu sau này dùng lại asset ngoài: ghi nguồn và giấy phép vào đây. Lưu ý giấy phép mới của Quaternius (QAL) cấm đóng gói lại asset để phát tán riêng lẻ.

## Âm thanh (CHỈ CC0)

Tổng dung lượng phát hành: ~0,62 MB (`public/audio/`). Bản sao giấy phép gốc của từng gói nằm ở `public/audio/LICENSES/`.
Mã nguồn âm thanh: `src/audio/` (Howler, nạp lazy sau cử chỉ đầu tiên). Bảng cắt sprite: `src/audio/sprite.ts`.

| Gói | Nguồn | Giấy phép | File đã dùng |
| --- | --- | --- | --- |
| Kenney *Impact Sounds* 1.0 | https://kenney.nl/assets/impact-sounds | CC0 1.0 (xác minh trong `License.txt` của gói) | `impactGeneric_light_001/003` (hit), `impactPlate_heavy_002` (heavy), `impactMetal_heavy_001` (crit), `impactGlass_medium_001` (shield), `impactBell_heavy_001` (ultboom), `impactBell_heavy_003` (wave) |
| Kenney *UI Audio* | https://kenney.nl/assets/ui-audio | CC0 1.0 | `click1` (tap) |
| Kenney *Interface Sounds* 1.0 | https://kenney.nl/assets/interface-sounds | CC0 1.0 | `back_002`, `open_002`, `close_002`, `error_004`, `toggle_002`, `select_004`, `confirmation_004` (reveal R), `bong_001` (count) |
| Kenney *RPG Audio* | https://kenney.nl/assets/rpg-audio | CC0 1.0 | `handleCoins2` (claim), `cloth3` (miss) |
| Kenney *Digital Audio* | https://kenney.nl/assets/digital-audio | CC0 1.0 | `powerUp12` (level), `powerUp1` (star), `phaserUp1` (spin), `powerUp3` (reveal SR), `phaserUp5` (heal), `twoTone1` (stun), `threeTone1` (ult ready), `phaserUp7` (ult), `lowDown` (death), `zapThreeToneDown` (lose) |
| Kenney *Music Jingles* | https://kenney.nl/assets/music-jingles | CC0 1.0 | `jingles_STEEL07` (reveal SSR), `jingles_SAX07` (reveal UR), `jingles_STEEL03` (win) |
| *Fast fight / battle music (looped)* — OpenGameArt | https://opengameart.org/content/fast-fight-battle-music-looped (tệp `fight_looped.wav`) | CC0 (trang nguồn ghi "CC0") | nhạc trận `music_battle.mp3` |
| *Happy Lullaby (song17)* — OpenGameArt | https://opengameart.org/content/happy-lullaby-song17 (tệp `song17.mp3`) | CC0 (trang nguồn ghi "CC0") | nhạc menu `music_menu.mp3` |

Quy trình: tải bản gốc về thư mục ngoài repo, chỉ đọc dữ liệu (không chạy gì trong gói), `ffmpeg` đưa về mono 44,1 kHz, chuẩn hoá đỉnh/trung bình (mean -20 dB, đỉnh ≤ -2 dB), cắt theo độ dài tối đa từng cue, nối thành `sfx.mp3` (64 kbps) cách nhau 120 ms; nhạc chuẩn hoá `loudnorm` -24 LUFS, 56 kbps mono. Nhạc phát nhỏ hơn SFX khoảng 18 dB (`MUSIC_GAIN` trong `src/audio/index.ts`).

## Nhạc nền do chủ dự án cung cấp
- `public/audio/music_menu.mp3` (bài 1, 0:00–3:36) và `public/audio/music_battle.mp3` (bài 2, 3:38–6:41) cắt từ file `music.m4a` do chủ dự án cung cấp, bạn ấy xác nhận **không có bản quyền**. Chưa có giấy phép/nguồn ghi lại: nếu sau này cần, bổ sung tên tác giả/nguồn vào đây.
- Xử lý: mono 44,1 kHz, 56 kbps, chuẩn hoá -24 LUFS, mờ vào/ra đầu cuối. File gốc (31 phút, 28 MB) KHÔNG đưa vào repo.
- Thay hai bài CC0 ngắn từ OpenGameArt trước đó (Fast fight / Happy Lullaby).
