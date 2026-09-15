# 🎮 ARROW PARTY

Party game multiplayer realtime cho **2–16 người**, phong cách arcade/neon, lấy cảm hứng cơ chế
rhythm + tranh đua kiểu Audition. Host **tự chọn sức chứa phòng (2–16) và những minigame muốn chơi**;
mỗi trận chơi hết các game đã chọn theo thứ tự xáo trộn, cộng dồn điểm, cuối trận ra một nhà vô địch.
Chơi đủ 9 game mất khoảng **8–9 phút**; chọn ít game thì trận ngắn lại tương ứng.

**Nhẹ:** không game engine, không asset bitmap, không model tải về, không nhạc nền tải về.
Cả 9 minigame là **đồ hoạ 3D (Three.js)** nằm trong **chunk riêng ~130 KB gzip chỉ tải khi vào trận**;
màn chính/sảnh chờ tải ban đầu ≈80 KB gzip, nhân vật ở menu vẽ bằng inline SVG, âm thanh tổng hợp bằng Web Audio API.
Cần trình duyệt có **WebGL**.

---

## 1. Chạy server

```powershell
cd server
npm install
npm run dev          # tsx watch -> http://localhost:8787
```

> Windows PowerShell 5.1 không hỗ trợ `&&`. Dùng `;` để nối lệnh:
> `cd server; npm run dev`

Kiểm tra: mở http://localhost:8787/health → `{"ok":true,...}`

Biến môi trường:

| Biến | Ý nghĩa |
|---|---|
| `PORT` | cổng WebSocket (mặc định `8787`) |
| `SERVER_PORT` | đọc bởi `client/vite.config.ts` nếu bạn đổi cổng server |
| `ALLOW_SOLO=1` | cho phép bắt đầu trận với 1 người (tiện test một mình) — hoặc chạy `npm run dev:solo` (dùng được cả trên PowerShell) |
| `FORCE_GAMES=rhythm,race` | ghim danh sách minigame, bỏ qua lựa chọn của host (tiện dev) |

## 2. Chạy frontend

Mở terminal **thứ hai**:

```powershell
cd client
npm install
npm run dev          # http://localhost:5173
```

(PowerShell một dòng: `cd client; npm run dev`)

Vite proxy sẵn đường `/ws` sang server game (cổng 8787), nên client + server dùng
**chung một origin** - chạy local, LAN hay ngrok đều chỉ cần mở cổng `5173`.

Build production: `npm run build` → `client/dist` (static). Bản build không có proxy
của Vite, nên khi deploy tĩnh hãy đặt `VITE_WS_URL=ws://host:8787` lúc build, hoặc
cho reverse proxy (nginx/Caddy) forward `/ws` sang server game.

## 3. Test multiplayer trên cùng một máy

1. Chạy server + client như trên.
2. Mở **tab 1**: http://localhost:5173 → nhập tên → `CREATE ROOM` → nhận room code (vd `A7K2`).
3. Mở **tab 2** ở **cửa sổ ẩn danh** (Incognito): http://localhost:5173 → nhập tên khác →
   `JOIN ROOM` → nhập code → `JOIN`.
4. Ở tab 1 (host) bấm `START GAME`.

> ⚠️ Dùng cửa sổ ẩn danh hoặc profile trình duyệt khác cho mỗi người chơi.
> Session (room + player token) được lưu trong `localStorage`, nên hai tab cùng profile sẽ
> dùng chung session. Tab thường + tab ẩn danh + Edge + Firefox = 4 người chơi trên một máy.

## 4. Test đủ 4 người

**Cách A - 4 profile trên một máy:** Chrome thường, Chrome ẩn danh, Edge, Firefox.

**Cách B - nhiều máy trong cùng mạng LAN (giống thật nhất):**

```powershell
# tìm IP máy chủ
ipconfig            # ví dụ 192.168.1.20

# client đã bật host:true nên các máy khác truy cập được
# trên máy khác mở:  http://192.168.1.20:5173
```

Chỉ cần mở firewall cho cổng `5173` - WebSocket đã đi chung port đó qua proxy
của Vite, không phải mở thêm `8787`.

`VITE_WS_URL` chỉ cần khi bạn deploy bản build tĩnh (`npm run build`) ở nơi không
có proxy - lúc đó trỏ thẳng vào server game:

```powershell
cd client
$env:VITE_WS_URL="ws://192.168.1.20:8787"; npm run build
```

**Cách C - chơi với bạn bè qua Internet (ngrok):**

Client và server đi chung một origin: Vite proxy đường `/ws` sang server game,
nên **chỉ cần mở đúng một port 5173**.

```powershell
# terminal 1
cd server; npm run dev
# terminal 2
cd client; npm run dev
# terminal 3
ngrok http 5173
```

Lấy URL `https://xxxx.ngrok-free.dev` gửi cho bạn bè là xong - không cần tunnel
riêng cho 8787, và vì trang chạy HTTPS nên client tự dùng `wss://` (không dính
lỗi mixed content).

Hai lưu ý với ngrok:

1. Domain ngrok phải được khai trong `client/vite.config.ts` → `server.allowedHosts`,
   nếu không Vite sẽ chặn với lỗi *"Blocked request. This host is not allowed"*.
2. Bản ngrok miễn phí hiện một trang cảnh báo ở lần truy cập đầu - mỗi người bấm
   **Visit Site** một lần là vào được.

**Cách D - bot tự động:** script trong `server/` có thể mô phỏng người chơi qua WebSocket
(xem phần kiến trúc protocol bên dưới) - đã dùng để smoke-test toàn bộ 6 minigame.

## 5. Kiến trúc realtime

### Server authoritative

Client **không bao giờ gửi điểm số**. Client chỉ gửi *input thô* (`hit`, `press`, `key`, `step`,
`jump`, `tap`). Toàn bộ việc chấm điểm, xếp hạng, đếm giờ, quyết định thắng thua nằm ở server.

```
┌──────────┐   input thô (WebSocket)    ┌─────────────────────────────┐
│  CLIENT  │ ─────────────────────────► │          SERVER             │
│          │                            │  Room state machine         │
│ render   │ ◄───────────────────────── │  lobby→countdown→playing→   │
│ UI/anim  │  room:state / game:event   │  scoreboard→…→final         │
└──────────┘  game:score / game:end     │  tick 50ms · GameDefinition │
                                        └─────────────────────────────┘
```

### State machine của một trận

```
lobby → [host START] → countdown(3.5s) → playing → scoreboard(4.2s) ─┐
          ▲                                                          │
          └──────────── còn minigame? ───────────────────────────────┘
                              │ hết
                              ▼
                        final (WINNER)
```

Server chạy một `setInterval(50ms)` cho mỗi room: gọi `update()` của minigame hiện tại, kiểm tra
`isFinished()`, chuyển phase khi tới deadline. Mọi deadline đều là **server timestamp**.

### Đồng bộ đồng hồ

Client không tin `Date.now()` của chính nó:

1. Khi kết nối, client gửi 5 gói `time:ping` cách nhau 180 ms.
2. Server trả `time:pong { clientSent, serverTime }`.
3. Client tính `rtt = now - clientSent`, và với **mẫu có RTT thấp nhất** (chính xác nhất):
   `offset = serverTime + rtt/2 - now`.
4. Từ đó `net.now() = Date.now() + offset` ≈ giờ server. Heartbeat 5s để bám drift.

Mọi input nhạy timing (rhythm, reaction) gửi kèm `at: net.now()`. Server **clamp** giá trị này về
`[now - 250ms, now + 60ms]` trước khi chấm - bù được độ trễ mạng thật, nhưng nói dối về timestamp
thì vô nghĩa.

### Protocol

| Client → Server | Server → Client |
|---|---|
| `time:ping` | `time:pong` |
| `room:create` / `room:join` / `room:rejoin` / `room:leave` | `room:joined`, `room:state` |
| `room:ready` | `error` |
| `game:start` (host) | `game:start` (config + startAt/endAt) |
| `game:input` | `game:event` (live: judge/go/pos/counts…) |
| `match:again` | `game:score`, `game:end` |

Kiểu dữ liệu dùng chung ở [shared/protocol.ts](shared/protocol.ts) - một nguồn sự thật duy nhất
cho cả hai phía.

### Abstraction minigame

Mỗi minigame là một object `GameDefinition` ([server/src/games/types.ts](server/src/games/types.ts)):

```ts
{ id, name, instructions, controls, duration, minPlayers, maxPlayers,
  createConfig(), createState(), handleInput(), update(), isFinished(), calculateScore() }
```

`instructions` + `controls` được server gửi kèm `game:start` và hiển thị nguyên văn trên
màn hướng dẫn 10 giây - thêm game mới là tự có màn hướng dẫn, không phải sửa UI.

Core multiplayer không biết gì về từng game. Thêm game mới = 1 file server + 1 file React +
2 dòng registry, **không đụng vào code room/match nào cả**.

### Công thức điểm

```
điểm = điểm theo hạng            (nội suy 100 → 30, hợp mọi cỡ phòng 2…16)
     + bonus hiệu năng           (0…60, theo raw/maxRaw)
     × 1.1 nếu đang hạng chót    (comeback)
```

Với 4 người, công thức ra đúng 100 / 77 / 53 / 30 - gần như bảng cũ; với 16 người
khoảng cách giữa các hạng hẹp lại nên người về sau vẫn còn cơ hội bám đuổi.

Vừa thưởng người thắng, vừa không bỏ rơi người thua - và luôn dễ hiểu, không random.
Người hạng chót (chỉ khi đứng một mình ở đáy) được +10% ở minigame kế tiếp, hiển thị rõ
trên màn hình countdown và leaderboard.

---

## 6. Đã hoàn thành

**Hệ thống phòng**
- ✅ Tạo phòng, room code 4 ký tự (bỏ `I O 0 1` cho dễ đọc), join bằng code, copy 1 chạm
- ✅ **2–16 người mỗi phòng**, host chọn sức chứa lúc tạo phòng (2/4/6/8/10/12/16)
  và đổi lại được trong sảnh chờ (không hạ xuống dưới số người đang có)
- ✅ **Chọn minigame cho phòng**: tick những game muốn chơi lúc tạo phòng hoặc sửa trong sảnh chờ
- ✅ 16 màu người chơi phân biệt được, avatar, trạng thái READY, host, ping
- ✅ Nickname ≤ 12 ký tự, lọc HTML/control character (chống injection)
- ✅ **Emote ở sảnh chờ**: 6 emote (👋 🕺 😂 😡 😢 🤸) bấm bằng chuột hoặc phím `1`–`6`,
  nhân vật diễn luôn động tác và hiện bong bóng cho cả phòng thấy; server chặn emote lạ,
  chặn spam (cooldown 600ms) và chỉ cho dùng khi đang ở sảnh chờ

**Match & flow**
- ✅ HOME → CREATE/JOIN → LOBBY → COUNTDOWN → MINIGAME → SCORE → … → WINNER
- ✅ Mỗi trận chơi hết các minigame **host đã chọn**, thứ tự xáo trộn (Fisher-Yates)
  nên không trận nào giống trận nào
- ✅ **Màn hướng dẫn 10 giây** trước mỗi minigame: tên game, luật chơi đầy đủ,
  phím bấm dạng keycap, thanh tiến trình - 3 giây cuối mới đếm ngược lớn
- ✅ **Bục vinh danh** sau mỗi ván: tiêu đề "TÊN WINS!", nhân vật xếp hàng theo hạng
  (người nhất to hơn và ăn mừng), huy hiệu 1ST/2ND/3RD/4TH, ô Reward hiện điểm nhận được,
  bảng tổng điểm phía dưới - tự chuyển ván sau ~4s
- ✅ Màn hình WINNER + bảng xếp hạng + confetti + PLAY AGAIN / BACK TO LOBBY

**9 minigame** (toàn bộ chấm điểm ở server)
- ✅ **BẮT NHỊP** - đường nhạc 3D, **HAI LÀN phím**: làn dưới SPACE, làn trên ↑ (bấm nhầm làn là trượt).
  **Nốt ĐỎ ☠ là BẪY** - phải để nó trôi qua, lỡ bấm mất 70 điểm và đứt combo.
  Nốt ⭐ vàng gấp đôi điểm, combo ×2, nhạc tăng tốc 560ms → 310ms/nhịp, vùng chuẩn chỉ ±45ms
- ✅ **PHẢN XẠ NHANH** - tín hiệu xanh ngẫu nhiên + **1–2 tín hiệu giả** để đánh lừa, xếp 🥇🥈🥉,
  FALSE START bị phạt −30, cửa sổ phản xạ chỉ 2.2s
- ✅ **GÕ ĐÚNG CHUỖI** - **5 chuỗi 5/6/7/8/9 mũi tên**, sai một phím là reset cả chuỗi + khoá 650ms,
  và **ngập ngừng quá 1.3 giây giữa hai phím cũng mất chuỗi** - buộc phải bấm liên tục
- ✅ **VƯỢT RÀO** - cả phòng chạy **chung một đường đua ngang**, **GIỮ →** để chạy
  (thả là dừng), **↑ / SPACE** để nhảy qua **6 rào**. Đâm rào là vấp: đứng hình 1 giây,
  bị đẩy lùi **và vẫn phải nhảy qua đúng cái rào đó** - không đi vòng được.
  Đường chạy điền kinh 3D, camera bám theo mình; rào và người chơi dùng **chung toạ độ với server** nên hitbox khớp đúng với hình
- ✅ **BẤM NHANH TAY** - spam SPACE 7 giây, nhưng có **3 lượt ĐÈN ĐỎ**: nhấn lúc đỏ bị trừ 3 điểm
- ✅ **TÍNH NHANH** - tính nhẩm `+ −` (2–3 số hạng, khó dần) rồi dùng ← → **chạy sang ô đáp án
  đúng** và SPACE để chốt. Nhấn SPACE có **phản hồi rõ ràng**: ô sáng viền vàng, huy hiệu
  "🔒 ĐÃ CHỐT · CHỐT ĐÚNG THỨ N", nhân vật giơ tay, có âm thanh. **Ai chốt đúng sớm nhất ăn đậm nhất**
  (thứ tự chốt: +60 / +35 / +20 / +10) cộng thêm điểm theo thời gian còn lại; sai bị trừ 25 và khoá 700ms
- ✅ **ĐUỔI BẮT BOM** *(đấu trực tiếp, **đồ hoạ 3D**)* - cả phòng **chạy tự do mọi hướng trong đấu trường 3D**.
  Ai bị gắn bom phải **ĐUỔI THEO và CHẠM** vào người khác để tống bom sang, những người kia phải chạy trốn.
  Người ôm bom chạy nhanh hơn 16% nên trốn mãi không được; vừa chuyền xong thì cả hai miễn nhiễm
  0.85 giây để không chạm qua chạm lại. Sân có **5 cột đá** để né và cắt đuôi (server đẩy nhân vật
  ra khỏi cột). Hết ngòi thì người đang ôm NỔ, mất 1 mạng (mỗi người 3 mạng), bom gắn cho người khác
  với **ngòi ngắn dần mỗi vòng**. Hết mạng là bị loại
- ✅ **KÉO CO** *(đấu theo đội)* - cả phòng chia hai đội xanh/đỏ, spam SPACE kéo dây về phía mình.
  **Lực mỗi cú kéo chia theo sĩ số** nên đội ít người không thiệt. Kéo qua vạch đối phương là thắng ngay,
  hết giờ thì bên nào đang dẫn sẽ thắng. Cả đội thắng đều điểm cao, trong đội ai kéo nhiều hơn xếp trên
- ✅ **NÉ VẬT THỂ LẠ** - **chạy tự do** (giữ ← → , không còn chia làn), sân trải rộng hết khung hình.
  **8 loại vật thể 3D** có hồn riêng: đĩa bay, lưỡi cưa xoay, slime, tinh thể, mắt biết liếc,
  bom cháy ngòi, sao xoay, sâu nhiều đốt - ~130 vật mỗi ván, kích thước khác nhau,
  có vật **bay chéo**. Rơi nhanh dần (1.7s → 0.95s) và khe trống hẹp dần (30 → 15 đơn vị).
  Trúng mất 1 mạng (có 3 mạng) và đứng hình 0.42s

**Tranh giành**
- ✅ Live leaderboard cập nhật realtime, luôn hiển thị trong suốt trận
- ✅ Animation `OVERTAKE!` + âm thanh khi có người chiếm ngôi đầu
- ✅ Comeback: hạng chót +10% ở ván kế tiếp

**Mạng & chống gian lận**
- ✅ WebSocket thuần (`ws`), server authoritative tuyệt đối - client không gửi điểm
- ✅ Đồng bộ đồng hồ server, clamp timestamp input
- ✅ Rate limit 80 msg/s mỗi kết nối; giới hạn riêng từng game (rhythm 14/s, race & button 22/s)
- ✅ Chặn input sai phase, sai gameId, từ spectator, hoặc từ người không trong ván
- ✅ Điểm không âm, không có kênh nào để client tự khai điểm
- ✅ Giữ SPACE (key repeat) bị bỏ qua - không auto-clicker bằng cách đè phím

**Kết nối**
- ✅ Auto-reconnect WebSocket, **mỗi lần nối lại tự vào lại phòng** bằng token (30s trong trận); server gửi lại
  ván đang chơi / bảng điểm / kết quả nên màn hình tiếp tục ngay. Không vào lại được thì về màn chính thay vì treo
- ✅ Ở sảnh chờ, người rớt mạng được **giữ đúng chỗ 8 giây**; bấm "Rời phòng" thì xoá ngay
- ✅ Một người rớt mạng không làm crash phòng; quá hạn → chuyển spectator
- ✅ Host rớt mạng được **giữ quyền host 8 giây** chờ quay lại; mất hẳn mới chuyển host cho người khác

**Nhân vật**
- ✅ Trong trận: nhân vật **3D** dựng bằng hình khối bo tròn (0 byte model), 10 tư thế: chạy, nhảy, đấm, kéo co, nhảy múa, ăn mừng, buồn, choáng, chốt, ngã
- ✅ Ở màn chính / sảnh chờ / bục vinh danh / tổng kết / hộp tạo nhân vật: nhân vật **chibi SVG** (`Character`),
  8 tư thế `idle` `run` `jump` `hit` `punch` `win` `miss` `lose`, rig tay/chân/đầu riêng, 0 byte asset

**UI/UX & hiệu năng**
- ✅ Neon dark, CSS thuần, animation chỉ dùng `transform`/`opacity`
- ✅ Responsive desktop → mobile, tôn trọng `prefers-reduced-motion`
- ✅ **Toàn màn hình**: nút góc trên phải hoặc phím `F` (có nhắc lúc vào trận lần đầu)
- ✅ **Trận đấu vừa khít một màn hình**: không cuộn trang, header 1 dòng với bảng xếp hạng dạng chip ngang,
  khung game lấp phần còn lại và từng game tự co theo chiều cao khung (CSS container query)
- ✅ Pháo giấy màn tổng kết là lớp phủ cố định nên không làm thanh cuộn nhảy
- ✅ Âm thanh tổng hợp Web Audio (0 byte asset) + nút MUTE
- ✅ Zero ảnh, zero font ngoài, zero preload

**Giao diện khi phòng đông**
- ✅ Lưới slot tự co lại, leaderboard chỉ hiện top 8 nhưng luôn kèm dòng của chính bạn
- ✅ Bục vinh danh giữ 5 người đầu, phần còn lại xuống danh sách gọn bên dưới
- ✅ Từng minigame tự thu nhỏ nhân vật và giãn khoảng cách theo số người

**Tạo nhân vật**
- ✅ Nút **✏️ TẠO NHÂN VẬT** ở màn chính và **Nhân vật của bạn** ở sảnh chờ (hoặc bấm vào nhân vật của mình).
  Hộp thoại chia tab **Cơ thể / Tóc / Khuôn mặt / Phụ kiện**, mỗi lựa chọn có hình xem trước thu nhỏ:
  - **Nam / Nữ** — nữ có lông mi, má hồng, dáng người thon hơn
  - **Kiểu tóc riêng theo giới (6 + 6)**: ngắn gọn, dựng ngược, mái lệch, xoăn tít, undercut, trọc /
    xoã dài, đuôi ngựa, hai bím, búi củ tỏi, bob ngắn, hai búi — **13 màu tóc**
  - **Màu da (6)**, **mắt (6)**, **miệng (5)**, **điểm nhấn (má hồng, tàn nhang, nốt ruồi, râu mép, sticker)**, **kính (tròn, râm, tim)**
  - **Trang phục (6)**: áo thun, áo sọc, hoodie, áo khoác, sơ mi cà vạt, váy xoè — **màu giày (7)**
  - **Đội đầu (9)**: mũ lưỡi trai, mũ len, vương miện, nơ, tai mèo, tai nghe, sừng quỷ, hoa cài, vòng thiên thần
  - Nút 🎲 ngẫu nhiên và ↺ mặc định
- ✅ Nhân vật được vẽ lại cho đẹp hơn: 2D có viền nét, đầu chibi, mắt long lanh, tay, giày; 3D bo tròn mịn, có mắt sáng, miệng, tay, giày, tóc và trang phục 3D tương ứng
- ✅ Nhớ trong máy (localStorage), gửi lên khi vào phòng; đổi ở sảnh chờ thì cả phòng thấy ngay. Server kiểm tra và chuẩn hoá dữ liệu
- ✅ Hiện ở mọi nơi: sảnh chờ, cả 9 minigame 3D, bục vinh danh, màn tổng kết. Màu áo vẫn là màu người chơi để dễ nhận ra nhau

**Người xếp bét bị "băng bó"**
- ✅ Ai đang có tổng điểm thấp nhất thì nhân vật **quấn băng trán, dán băng keo, băng tay chân, toát mồ hôi và run bần bật** (2D lẫn 3D),
  bảng xếp hạng có dấu 🩹. Đầu trận khi ai cũng bằng điểm thì chưa ai bị

**Sảnh chờ**
- ✅ Host không có nút sẵn sàng; **mọi người còn lại phải SẴN SÀNG hết** thì nút START mới bấm được (server cũng chặn), có dòng báo đang chờ ai
- ✅ Test một mình: `npm run dev:solo` ở thư mục `server`

**Toàn màn hình**
- ✅ Khung game tràn hết chiều ngang màn hình (bỏ thanh người chơi dưới cùng, bảng xếp hạng đã đủ thông tin)
- ✅ Lời nhắc **"Chọn chế độ toàn màn hình để có trải nghiệm tốt nhất"** kèm nút bật ngay ở sảnh chờ và màn hướng dẫn trước mỗi game

**Tên game bằng tiếng Việt**
- ✅ BẮT NHỊP · PHẢN XẠ NHANH · GÕ ĐÚNG CHUỖI · VƯỢT RÀO · BẤM NHANH TAY · TÍNH NHANH ·
  NÉ VẬT THỂ LẠ · ĐUỔI BẮT BOM · KÉO CO
- ✅ Hướng dẫn viết lại bằng lời dễ hiểu, hiện đầy đủ trên màn hướng dẫn 10 giây

**Đồ hoạ 3D (cả 9 minigame)**
- ✅ **Mọi minigame đều là 3D** (đã bỏ hẳn bản 2D):
  - BẮT NHỊP: đường nhạc 3D chạy về phía camera, nốt đĩa/nốt vàng/nốt gai bẫy, loa nhún theo nhịp, nhân vật nhảy múa hai bên
  - PHẢN XẠ NHANH: vạch xuất phát sân vận động + cột đèn tín hiệu khổng lồ (vàng chờ / đỏ giả / xanh CHẠY), bấm là lao đi, phạm luật thì ngã
  - GÕ ĐÚNG CHUỖI: mỗi người một cầu thang, gõ đúng phím nào leo lên một bậc (bậc sáng màu mình), chậm quá bị tuột về đầu chuỗi, lên đỉnh giành cúp
  - VƯỢT RÀO: đường chạy điền kinh 3D, rào sọc đỏ trắng (InstancedMesh), vấp thì rào đổ, khán đài nhún nhảy, camera bám theo mình
  - BẤM NHANH TAY: nút arcade khổng lồ lún xuống mỗi cú bấm, tháp sức mạnh mọc cao theo điểm, đèn đỏ thì cả sân chớp đỏ
  - TÍNH NHANH: bảng câu hỏi 3D, các ô đáp án nổi, nhân vật nhảy qua lại giữa ô, chốt thì toả vòng sáng, lộ đáp án thì ô đúng nhô lên
  - NÉ VẬT THỂ LẠ: 8 vật thể lạ low-poly bay vòng cung từ xa tới, vòng đỏ báo chỗ sắp rơi, nhân vật chạy trên bệ neon
  - ĐUỔI BẮT BOM: đấu trường có cột đá, bom bay khi chuyền, nổ + rung camera
  - KÉO CO: hai bệ đội xanh/đỏ, sợi dây 3D, đội thua bị lôi tuột xuống hố bùn
- ✅ Three.js thuần, **tải lười** bằng `import()`: màn chính và lobby không phải gánh thêm byte nào;
  Three.js nằm trong một chunk dùng chung, mỗi cảnh game chỉ thêm ~4–9 KB
- ✅ Khung dựng cảnh chung `three/scene.ts` (đèn, bóng đổ, nhân vật, hạt, nhãn tên HTML, texture canvas, tự căn camera)
- ✅ Nhân vật low-poly dựng bằng hình khối (0 byte model), sàn đấu vẽ bằng canvas texture, cột đá + tinh thể phát sáng,
  quả bom bay vòng cung khi chuyền, nổ bằng hạt điểm (1 draw call) + sóng xung kích + đèn chớp + rung camera
- ✅ **3 mức đồ hoạ** CAO / VỪA / NHẸ đoán theo cấu hình máy, rồi **đo FPS thật và tự hạ mức** nếu dưới 45fps
  (tắt bóng đổ, giảm độ phân giải, bớt hạt). Ép mức bằng `localStorage['arrow-3d-quality']`
- ✅ Máy không có WebGL, mất WebGL context, hoặc tải chunk 3D lỗi → hiện **thông báo hướng dẫn** (bật tăng tốc phần cứng,
  cập nhật/đổi trình duyệt) kèm nút tải lại trang; sảnh chờ cũng báo trước nếu máy không chạy được 3D
- ✅ Mỗi game tách logic (nhận sự kiện, gửi phím) ra một hook (`useRhythmGame`, `useRaceGame`, …), phần vẽ 3D chỉ đọc trạng thái
- ✅ Màn tạo phòng dùng bố cục 2 cột nên vừa khít màn hình laptop 1366×768 ở zoom 100%, không phải cuộn

**Hiệu năng phần vẽ**
- ✅ NÉ VẬT THỂ LẠ **tái sử dụng vật thể** (pool) thay vì tạo/xoá mỗi đợt, con trỏ duyệt chỉ tiến nên mỗi khung
  chỉ đụng tới các vật đang bay
- ✅ Rào VƯỢT RÀO, bậc thang GÕ ĐÚNG CHUỖI, khán giả dùng **InstancedMesh** (cả trăm khối chỉ 1–2 draw call)
- ✅ Hình khối/vật liệu dùng chung giữa các nhân vật; texture vẽ bằng canvas (0 byte ảnh); DPR giới hạn theo mức đồ hoạ

**Đã test**
- ✅ Smoke test end-to-end 2 bot chơi trọn trận - cả 7 minigame
- ✅ Bot "chơi giỏi" vs bot "chơi bừa": Math Rush 8/8 đúng vs 0/8, Button Battle 76 vs 12
  (30 lỗi đèn đỏ), Dodge Zone né 12 đợt vs 0 đợt - xác nhận cơ chế phạt thực sự có tác dụng
- ✅ Test disconnect giữa trận → reconnect bằng token → từ chối token sai
- ✅ Test emote: broadcast tới người khác, cooldown chặn spam, emote bịa bị từ chối,
  và không emote được khi đang trong trận
- ✅ Test nốt bẫy: bot cố tình bấm trúng cả 4 bẫy → nhận đủ 4 phán định TRAP và bị phạt về 0 điểm;
  bot bấm đúng làn đạt 100% trong khi bot chỉ bấm SPACE chỉ đạt 65% (xác nhận cơ chế 2 làn)
- ✅ Test ĐUỔI BẮT BOM với 4 bot biết đuổi/chạy trốn trong đấu trường: **44 lần chạm chuyền bom**,
  8 lần nổ, cả 4 người đều từng ôm bom, 2 người bị loại - cơ chế đuổi bắt hoạt động đúng
- ✅ Test KÉO CO qua WebSocket thật: chia đội, đếm cú kéo và xử đội thắng đúng
- ✅ Test luật vượt rào: bot chạy mà không bao giờ nhảy bị **kẹt lại trước rào đầu tiên**
  (vị trí 14.5 / rào ở 18, vấp 6 lần, không qua được); bot biết nhảy về đích với 0 lần vấp
- ✅ Test né vật thể: 132 vật mỗi ván, đủ **8 loại**, có vật bay chéo, tốc độ rơi 1700ms → 950ms;
  bot biết né ăn điểm cao gấp đôi bot đứng yên
- ✅ Test phòng lớn: tạo phòng 10 người chỉ chọn 2 minigame → người thứ 11 bị chặn
  ("Phòng đã đầy"), non-host không đổi được cài đặt, host không hạ được sức chứa xuống
  dưới số người đang có, gameIds rác bị bỏ qua, trận chạy đúng 2 ván và chấm điểm đủ 10 người

## 7. Có thể nâng cấp tiếp

**Gameplay**
- Thêm minigame (memory, tug-of-war, drawing, quiz) - kiến trúc đã sẵn sàng, chỉ thêm file
- Math Rush: thêm phép `×` `÷`, hoặc chế độ "ai sai bị loại khỏi câu sau"
- Nhạc nền theo BPM đồng bộ với Rhythm Beat (Web Audio, sinh bằng oscillator)
- Power-up / item tranh giành trực tiếp giữa người chơi (cản trở đối thủ)
- Chọn độ khó, chọn danh sách minigame trước trận
- Chế độ đồng đội 2v2

**Hạ tầng**
- Chuyển room state sang **Redis** để scale nhiều instance - chỉ cần sửa `RoomManager`
- Sticky session / pub-sub giữa các node
- Lưu lịch sử trận + bảng xếp hạng toàn cầu (cần database)
- Docker compose cho một lệnh chạy tất cả

**Chất lượng**
- Unit test cho từng `calculateScore()` và integration test cho state machine
- Reconciliation mượt hơn cho Race (client prediction thay vì snapshot 10 Hz)
- Delta compression cho `room:state` (hiện gửi full state, vẫn rất nhỏ)
- Spectator mode đầy đủ với UI riêng
- Hỗ trợ điều khiển cảm ứng đầy đủ trên mobile (hiện Button Battle đã có, các game khác cần nút ảo)
- i18n (hiện UI tiếng Việt)

---

## Cấu trúc project

```
shared/
  protocol.ts             # kiểu dữ liệu + hằng số dùng chung 2 phía

server/src/
  index.ts
  network/  server.ts connection.ts      # WebSocket, routing message
  rooms/    Room.ts RoomManager.ts       # state machine + registry (điểm swap sang Redis)
  games/    types.ts index.ts            # GameDefinition + registry + random picker
            rhythm.ts reaction.ts sequence.ts race.ts buttonBattle.ts mathRush.ts
            dodge.ts hotPotato.ts tugWar.ts
  validation/ input.ts                   # sanitize tên/code + rate limiter

client/src/
  main.tsx App.tsx styles.css
  network/  net.ts                       # WebSocket + đồng bộ đồng hồ
  state/    store.ts                     # store nhẹ (useSyncExternalStore)
  screens/  Home.tsx Lobby.tsx Match.tsx Final.tsx
  components/ Character CharacterEditor FullscreenHint EmoteBar Leaderboard Countdown Scoreboard Toasts
  three/    engine quality scene character effects       # lớp 3D dùng chung, tải lười
            rhythmScene reactionScene sequenceScene raceScene buttonScene
            mathScene dodgeScene bombScene tugScene
  games/    view3d.tsx (Scene3D: tải lười cảnh 3D, báo lỗi khi máy không có WebGL)
            rhythm/ reaction/ sequence/ race/ button/ math/ dodge/ tug/
              (mỗi thư mục: useXGame · X3D · HUD · index)
            bomb/ (useBombGame · BombHud · Arena3D)
  utils/    hooks.ts sound.ts appearance.ts fullscreen.ts
```

## Điều khiển

| Minigame | Phím |
|---|---|
| BẮT NHỊP | `SPACE` (làn dưới) · `↑` (làn trên) |
| PHẢN XẠ NHANH | `SPACE` (chỉ khi thấy chữ xanh) |
| GÕ ĐÚNG CHUỖI | `←` `↑` `→` `↓` |
| VƯỢT RÀO | GIỮ `→` để chạy, `↑` hoặc `SPACE` để nhảy |
| BẤM NHANH TAY | `SPACE` (dừng khi nút đỏ) |
| TÍNH NHANH | `←` `→` chạy sang ô, `SPACE` chốt đáp án |
| NÉ VẬT THỂ LẠ | GIỮ `←` `→` để chạy tự do |
| ĐUỔI BẮT BOM | `←` `↑` `→` `↓` chạy tự do, chạm vào người khác để chuyền bom |
| KÉO CO | `SPACE` bấm liên tục để kéo |
