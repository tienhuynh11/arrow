# 🎮 ARROW PARTY

Party game multiplayer realtime cho **2–16 người**, phong cách arcade/neon, lấy cảm hứng cơ chế
rhythm + tranh đua kiểu Audition. Host **tự chọn sức chứa phòng (2–16) và những minigame muốn chơi**;
mỗi trận chơi hết các game đã chọn theo thứ tự xáo trộn, cộng dồn điểm, cuối trận ra một nhà vô địch.
Chơi đủ 10 game mất khoảng **10–11 phút** (mỗi game ~35–50 giây); chọn ít game thì trận ngắn lại tương ứng.

**Nhẹ:** không game engine, không asset bitmap, không model tải về, không nhạc nền tải về.
Cả 10 minigame là **đồ hoạ 3D (Three.js)** nằm trong **chunk riêng ~130 KB gzip chỉ tải khi vào trận**;
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
| `FORCE_GAMES=rhythm,race` | ghim danh sách minigame, bỏ qua lựa chọn của host (tiện dev). Ở chế độ Hành Trình thì chỉ đổi minigame, vẫn giữ chủ đề tỉnh |
| `HEX_DELAY=14000` | kéo dài thời gian ô SÀN TỔ ONG tồn tại sau khi bị bước lên (mặc định 820 ms), chỉ để chạy thử/chụp ảnh |
| `JOURNEY_TURNS=3` | rút ngắn số chặng của chế độ Hành Trình Xuyên Việt (mặc định 10) để chạy thử nhanh |

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

**10 minigame** (toàn bộ chấm điểm ở server)
- ✅ **BẮT NHỊP** - đường nhạc 3D, **HAI LÀN phím**: làn dưới SPACE, làn trên ↑ (bấm nhầm làn là trượt).
  **Nốt ĐỎ ☠ là BẪY** - phải để nó trôi qua, lỡ bấm mất 70 điểm và đứt combo.
  Nốt ⭐ vàng gấp đôi điểm, combo ×2, **92 nốt** (~40 giây), nhạc tăng tốc 560ms → 290ms/nhịp có đoạn "thở" giữa bài, bẫy dày dần, vùng chuẩn chỉ ±45ms
- ✅ **PHẢN XẠ NHANH** - **6 vòng liên tiếp** (~33 giây): mỗi vòng chờ tín hiệu xanh ngẫu nhiên, càng về sau càng nhiều **tín hiệu giả** để đánh lừa,
  điểm mỗi vòng theo tốc độ (tối đa 1000) cộng dồn; nhấn sớm bị trừ 400, cửa sổ phản xạ chỉ 1.5s
- ✅ **GÕ ĐÚNG CHUỖI** - **8 chuỗi dài dần từ 6 đến 13 mũi tên**, sai một phím là reset cả chuỗi + khoá 650ms,
  và **ngập ngừng quá 1.3 giây giữa hai phím cũng mất chuỗi** - buộc phải bấm liên tục
- ✅ **VƯỢT RÀO** - cả phòng chạy **chung một đường đua ngang**, **GIỮ →** để chạy
  (thả là dừng), **↑ / SPACE** để nhảy qua **16 rào** trên đường đua dài, rào càng về cuối càng sít nhau. Đâm rào là vấp: đứng hình 1 giây,
  bị đẩy lùi **và vẫn phải nhảy qua đúng cái rào đó** - không đi vòng được.
  Đường chạy điền kinh 3D, camera bám theo mình; rào và người chơi dùng **chung toạ độ với server** nên hitbox khớp đúng với hình
- ✅ **BẤM NHANH TAY** - spam SPACE **38 giây**, nhưng có **8 lượt ĐÈN ĐỎ** ngắn dần: nhấn lúc đỏ bị trừ 15 lượt và đơ tay 0.6 giây
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
- ✅ **HÁI DỪA XỨ DỪA** *(chủ đề Bến Tre)* - mỗi người một cây dừa, bấm **LUÂN PHIÊN ← →** (hoặc A D) thật nhanh để leo
  (bấm lặp một phím không leo được), đủ 40 nấc là hái được 1 quả. **Gió lắc** theo lịch cố định (có cảnh báo trước 0,6 giây):
  lỡ leo lúc gió là **trượt 10 nấc và choáng 0,9 giây**, nên biết buông tay đúng lúc mới thắng. ~38 giây, giới hạn ~14 lần bấm/giây
- ✅ **SÀN TỔ ONG** *(kiểu Hex-A-Gone của Fall Guys)* - sàn lục giác **3 tầng**, chạy tự do bằng ← ↑ → ↓, **SPACE để nhảy** (đang bay thì không chạm ô, nhảy qua chỗ trống được, không có thời gian chờ giữa hai lần nhảy). Ô nào bạn bước lên sẽ **nháy đỏ rồi rơi sau chưa tới 1 giây**
  (đứng yên là rơi), rơi xuống tầng dưới còn cơ hội, **rơi hết tầng thấp nhất hoặc ra ngoài mép là bị loại**. Càng về cuối ván, ô càng **tự rơi dồn dập** (một nửa số lần
  nhằm đúng ô dưới chân ai đó). Người trụ lại cuối cùng thắng. Sàn to theo số người (5 → 8 vòng ô) nên ván dài ~25–40 giây.
  **Góc nhìn thứ ba bám theo mình, chỉ thấy tầng đang đứng** (các tầng phía trên ẩn đi); bị loại thì quay về toàn cảnh để xem tiếp.
  Server giữ toàn bộ trạng thái ô (`Uint8Array`), client chỉ vẽ; lưới lục giác dùng chung ở [shared/hex.ts](shared/hex.ts)
- ✅ **CỬA BÍ MẬT** *(kiểu Door Dash của Fall Guys)* - chạy qua **8 hàng cửa**, mỗi hàng 6 cánh nhưng **chỉ 1 cánh là cửa thật**, nhìn y hệt nhau. Đâm vào cửa thật thì nó bật mở cho cả phòng,
  đâm vào cửa giả thì **bị văng ngược + choáng nửa giây**. Cửa nào thật/giả **do server giữ bí mật** (không nằm trong config), client chỉ biết cửa nào đã mở. Về đích nhanh nhất thắng (~30–45 giây).
- ✅ **LEO NÚI ĐỔ** *(kiểu Fall Mountain của Fall Guys)* - chạy lên **đỉnh núi dốc**, né **bóng khổng lồ, khúc gỗ lăn và 4 thanh búa quét**. Trúng thì văng tụt xuống dốc + choáng, rồi được bảo vệ vài giây.
  Chướng ngại chạy **theo lịch** tạo một lần và gửi trong config: client tự tính vị trí theo đồng hồ server nên **không tốn băng thông và không giật khi mạng chậm**; server vẫn chốt ai bị trúng (có khoan dung ~14 % cho độ trễ).
- ✅ **SÀN LÀ DUNG NHAM** *(The Floor Is Lava)* - parkour leo cao bằng các bục, **dung nham dâng dần** từ dưới lên (chậm lúc đầu rồi nhanh dần). Bục thường, **sụp**, **trơn**, **biến mất** theo chu kỳ, **di chuyển**; chạm dung nham thì hồi sinh ở điểm kiểm tra gần nhất (dung nham ngập điểm đó là bị loại). Ai chạm bục đích trước thắng. Camera thứ 3 bám sau lưng kiểu Fall Guys; bục và dung nham không gửi qua mạng, client tự tính theo giờ server.
  **SPACE nhảy** qua xà (nhảy xong phải chờ ~0,3 giây mới nhảy tiếp được, nên không thể nhảy liên tục để bất tử). Trúng xà thì bị hất văng ra mép, rơi khỏi sàn là bị loại. Server kiểm tra cả cung xà quét trong mỗi tick để xà quay nhanh cũng không xuyên qua người.
- ✅ **SÀN ĐỔI MÀU** *(kiểu Block Party của Fall Guys)* - sàn ghép nhiều ô màu (8×8 → 12×12 tuỳ số người, hợp 16 người). Mỗi vòng báo một **màu an toàn**, hết giờ mọi ô khác màu rơi mất. Vòng sau thời gian ngắn lại (4,8 s → 1,1 s) và nhiều màu hơn (4 → 7).
- ✅ **HÃY CHỌN GIÁ ĐÚNG** *(trước là Lật Mảnh Ghép)* - sàn ô vuông, mỗi ô một **hình** (sao, tim, thoi, tròn, tam giác, chữ thập, trăng, chữ nhật). Cả sàn hiện hình vài giây để ghi nhớ rồi **úp lại** và server mới báo **hình cần tìm** (bí mật tới giây úp ô nên không ai đứng sẵn được); hết giờ mọi ô khác hình rơi mất. Ô to hơn, nhịp chậm và dài hơn (khoảng 2 phút); vòng sau ngắn dần và nhiều hình hơn (3 → 8). Hình vẽ bằng canvas, 0 byte ảnh.
- ✅ **CON ĐƯỜNG ẨN** *(Tip Toe)* - sàn kính nhiều hàng ô trông y hệt nhau, chỉ có **một đường thật** liền mạch tới đích, còn lại là ô giả. Bước nhầm ô giả là ô **vỡ** (cả phòng đều thấy nên nhìn người khác thử sai để tìm đường) và bạn rơi, hồi sinh lại từ vạch xuất phát. Đường do server sinh ngẫu nhiên và **không bao giờ gửi cho client** — client chỉ nhận danh sách ô đã vỡ. Về đích đầu tiên thắng và mở đồng hồ đóng ván 12 giây. Góc nhìn thứ 3.
- ✅ **MÃ SÁT THỦ** *(Code Hunt)* - mỗi người có một **mã 3 số cố định** trên đầu; chỉ đọc được khi **hai người nhìn thẳng vào mặt nhau** và không bị tường che. Gõ đúng mã để hạ, bị hạ thì hồi sinh ngẫu nhiên. 2 phút 30, ai hạ nhiều nhất thắng. Server chỉ gửi mã/vị trí cho người đang nhìn thấy nhau nên không thể soi qua tường; gõ sai bị khoá tay ngắn.
- ✅ **ĐẤU TRƯỜNG MÙ** *(Blind Duel)* - đấu trường tròn, mỗi vòng cả phòng thấy nhau rồi **biến mất khỏi mắt nhau**; đoán chỗ đối thủ, ngắm bằng chuột, hết pha ẩn **cả phòng nổ súng cùng lúc**. Server không gửi vị trí người khác trong pha ẩn.
- ✅ **MÊ CUNG ĐẶT BOM** *(kiểu Bomberman)* - mê cung lưới ô vuông nhìn từ trên xuống: đặt bom (SPACE), phá thùng, nhặt 💣🔥⚡, nổ dây chuyền; sau 70 giây sàn sập dần từ ngoài vào. Người sống sót cuối cùng thắng.
- ✅ **GHẾ ÂM NHẠC** *(Musical Chairs)* - chạy quanh vòng ghế khi nhạc phát; nhạc dừng bất ngờ (giờ dừng là bí mật của server) thì chạm ghế trống để ngồi, ghế luôn ít hơn người.
- ✅ **GIẢ DẠNG NPC** *(Just Act Natural)* - mỗi vòng một thợ săn, còn lại hoà vào đám NPC do server điều khiển; thợ săn đoán người thật và bắn (đạn có hạn). Server không gửi cho ai biết thực thể nào là người thật.
- ✅ **ĐẤU VẬT TRÊN NÓC NHÀ** *(kiểu Gang Beasts)* - đánh nhau trên nóc xe tải đang chạy: **đấm** (chuột trái), **túm** (chuột phải/E), **nhấc** (Shift/Space) rồi **quăng** đối thủ xuống. Camera thứ 3 xoay bằng chuột (Pointer Lock). Xe có phanh gấp, xóc, cầu thấp, biển báo quét ngang (có cảnh báo trước); rơi khỏi xe là bị loại, kể cả tự rơi hay kéo nhầm nhau.
- ✅ **QUIZ ĐOÁN NHANH** - câu hỏi có **ảnh / âm thanh / video** hiện dần từ mờ đến rõ; mọi người nhập đáp án rồi CHỐT, đúng và sớm thì nhiều điểm (300–1000). So khớp chính xác sau khi đổi chữ thường, gộp khoảng trắng, chuẩn hoá Unicode (tuỳ chọn bỏ qua dấu). Đáp án nằm ở server, chỉ lộ khi hết câu.
- ✅ **CÂU CÁ TRANH TÀI** (`fishing`, 2–16 người) - 80 giây, mỗi hồ 3–6 người (nhiều người thì chia hồ ~4–5 người chạy song song, phần điểm "rơi vãi" do giật cá được chia đều cả hồ cuối ván nên điểm TB giữa hồ 2–6 người chênh ≤ ~15% trong mô phỏng). Quăng cần → phao rung → phao nhúng (giật trong 1 giây) → ván kéo cá kiểu thanh cân bằng; cá thường / hiếm / huyền thoại (🐉 100 điểm) càng hiếm thanh càng nhỏ, cá càng giãy; có rác (👟 −8, 🥫 −4, 🌿 0) lúc cắn không phân biệt được với cá thường. **Giật cá**: cướp cá người khác đang kéo (35%) hoặc vừa lên bờ (1,7s, 55%), nhận 50% giá trị, hồi chiêu 7s, giật hụt thì −5 điểm và choáng 3s; nạn nhân được miễn nhiễm 3,8s. Server quyết loài cá bằng túi cá có seed riêng từng người (chỉ lộ lúc cắn, bỏ lỡ cũng mất con đó), mô phỏng lại ván kéo từ lệnh giữ/nhả có tick (chậm 150ms); client dự đoán cùng hàm trong `shared/fishing.ts` nên giữ/nhả tức thì, snapshot 5Hz (~0,7 KB/s/người). Test: `cd server && npx tsx test/fishing.test.ts`; bot WS: `npx tsx test/fishingBots.ts <số bot> <cổng>`.
- ✅ **ĐẠI HỘI HỌA SĨ** (`artshow`, 3–16 người) - cả phòng nhận cùng một chủ đề vui (72 chủ đề trong `shared/artshow.ts`) và có 55 giây vẽ trên canvas 2D. Hết giờ tranh được đưa lên **ẩn danh** để bình chọn (22 giây): 1 phiếu chính ❤️ (100 điểm/phiếu, hoà thì chia hạng) + 1 phiếu phụ 🤣 *hài nhất* (+30) hoặc 💩 *thảm họa nghệ thuật* (+20), cấm tự bình chọn (server kiểm tra). Tên họa sĩ chỉ lộ ở màn công bố. Tranh lưu dạng **nét** (RDP + số nguyên, ≤ 16 KB/tranh, ≤ 150 nét), không gửi bitmap; nét vẽ cục bộ tức thì, gửi theo lô + sao lưu định kỳ. Chỉ nhận chỉ số màu/độ dày từ whitelist và toạ độ số nguyên nên không chèn mã được. Cần ≥ 3 người (2 người thì mỗi người chỉ có 1 tranh để chọn). Test: `cd server && npx tsx test/artshow.test.ts`; bot WS: `npx tsx test/artshowBots.ts <số người> <cổng>`.
  Mỗi vòng chỉ có **một gói** từ server (bảng màu + màu an toàn + giờ chốt), client tự đếm ngược theo đồng hồ server nên rất nhẹ mạng.
- ✅ **NÉ VẬT THỂ LẠ** - **chạy tự do** (giữ ← → , không còn chia làn), sân trải rộng hết khung hình.
  **8 loại vật thể 3D** có hồn riêng: đĩa bay, lưỡi cưa xoay, slime, tinh thể, mắt biết liếc,
  bom cháy ngòi, sao xoay, sâu nhiều đốt - ~130 vật mỗi ván, kích thước khác nhau,
  có vật **bay chéo**. Rơi nhanh dần (1.7s → 0.95s) và khe trống hẹp dần (30 → 15 đơn vị).
  Trúng mất 1 mạng (có 3 mạng) và đứng hình 0.42s

**Chế độ "Hành Trình Xuyên Việt"** *(board game kiểu Mario Party)*
- ✅ Host chọn chế độ ở màn tạo phòng hoặc ở **Cài đặt phòng** trong sảnh chờ (chế độ Thường vẫn y như cũ)
- ✅ Bản đồ là một vòng **10 tỉnh**, mỗi ô một nét văn hoá và một minigame dùng lại game có sẵn nhưng **đổi tên + lời dẫn theo tỉnh**:
  Hà Nội 🍵 (GÕ ĐÚNG CHUỖI) · Quảng Ninh 🛶 (KÉO CO) · Huế 🍜 (TÍNH NHANH, lễ hội) · Đà Nẵng 🐉 (PHẢN XẠ) ·
  Gia Lai 🥁 (BẮT NHỊP, lễ hội) · Đắk Lắk 🐘 (VƯỢT RÀO) · Bình Thuận 🏜️ (BẤM NHANH TAY) · TP.HCM ☕ (NÉ VẬT) ·
  Bến Tre 🥥 (HÁI DỪA) · Cần Thơ 🍉 (ĐUỔI BẮT BOM). Dữ liệu ở [shared/board.ts](shared/board.ts) để thêm/đổi tỉnh rất dễ
- ✅ **Luật mỗi chặng:** chủ xúc xắc xoay vòng theo ghế bấm tung (hoặc SPACE, 10 giây không tung thì **server tự tung**, chủ xúc xắc rớt mạng thì tự tung ngay).
  Server tung 1–6 cho **mọi người**, quân cờ ai nấy đi theo xúc xắc của mình; ô nơi quân của chủ xúc xắc dừng lại quyết định tỉnh/minigame, **cả phòng cùng chơi**
- ✅ **Điểm Văn Hoá:** hạng 1 nhận trọn điểm ô (20, ô lễ hội 30), hạng 2 một nửa, hạng 3 một phần tư; người đang **đứng đúng ô được chọn nhân ×1,5**;
  hạng 1 nhận **huy hiệu đặc sản** của tỉnh (lần đầu +5). Hết 10 chặng, ai nhiều điểm nhất là **Nhà Văn Hoá Xuyên Việt**
- ✅ Màn bàn cờ vẽ bằng SVG (không tốn thêm thư viện): quân cờ là nhân vật đã tuỳ chỉnh, nhảy từng ô, xúc xắc có hoạt hình, ô được chọn sáng lên **sau khi quân cờ tới nơi**
- ✅ Server giữ toàn bộ trạng thái bàn cờ trong `room:state` nên **rớt mạng/vào lại giữa chừng vẫn khôi phục đúng**; game không đủ người (vd. KÉO CO cần ≥ 2) tự thay bằng BẤM NHANH TAY nhưng vẫn giữ chủ đề tỉnh
- ✅ Logic bàn cờ tách riêng ở [server/src/rooms/journey.ts](server/src/rooms/journey.ts), `Room.ts` chỉ điều phối

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
- ✅ Hiện ở mọi nơi: sảnh chờ, cả 10 minigame 3D, bục vinh danh, màn tổng kết. Màu áo vẫn là màu người chơi để dễ nhận ra nhau

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
  NÉ VẬT THỂ LẠ · ĐUỔI BẮT BOM · KÉO CO · HÁI DỪA XỨ DỪA · SÀN TỔ ONG · CỬA BÍ MẬT · LEO NÚI ĐỔ · SÀN LÀ DUNG NHAM · SÀN ĐỔI MÀU · HÃY CHỌN GIÁ ĐÚNG · CON ĐƯỜNG ẨN
- ✅ Hướng dẫn viết lại bằng lời dễ hiểu, hiện đầy đủ trên màn hướng dẫn 10 giây

**Đồ hoạ 3D (cả 10 minigame)**
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
  hex.ts                  # lưới lục giác của SÀN TỔ ONG
  board.ts                # 10 tỉnh, luật điểm của chế độ Hành Trình Xuyên Việt

server/src/
  index.ts
  network/  server.ts connection.ts      # WebSocket, routing message
  rooms/    Room.ts RoomManager.ts       # state machine + registry (điểm swap sang Redis)
            journey.ts                   # logic thuần của chế độ bàn cờ (xúc xắc, di chuyển, điểm văn hoá)
  games/    types.ts index.ts            # GameDefinition + registry + random picker
            rhythm.ts reaction.ts sequence.ts race.ts buttonBattle.ts mathRush.ts
            dodge.ts hotPotato.ts tugWar.ts coconut.ts hexAGone.ts doorDash.ts fallMountain.ts lavaRun.ts blockParty.ts memoryMatch.ts tipToe.ts
  validation/ input.ts                   # sanitize tên/code + rate limiter

client/src/
  main.tsx App.tsx styles.css
  network/  net.ts                       # WebSocket + đồng bộ đồng hồ
  state/    store.ts                     # store nhẹ (useSyncExternalStore)
  screens/  Home.tsx Lobby.tsx Match.tsx Final.tsx Board.tsx
  components/ Character CharacterEditor FullscreenHint EmoteBar Leaderboard Countdown Scoreboard Toasts Dice ModePicker
  three/    engine quality scene character effects       # lớp 3D dùng chung, tải lười
            rhythmScene reactionScene sequenceScene raceScene buttonScene
            mathScene dodgeScene bombScene tugScene coconutScene hexScene doorScene mountainScene lavaScene blockPartyScene memoryScene tipToeScene stage
  games/    view3d.tsx (Scene3D: tải lười cảnh 3D, báo lỗi khi máy không có WebGL)
            rhythm/ reaction/ sequence/ race/ button/ math/ dodge/ tug/ coconut/ hex/
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
| ĐUA TƯỜNG (Quoridor) | chuột / chạm chọn ô để đi hoặc đặt tường |
| XÌ HƠI CÙNG NHAU (`fart`) | `A` `D` / chuột để ngắm, GIỮ `SPACE` (hoặc chuột trái) để xì liên tục, buông để ngừng |
| 🎣 CÂU CÁ TRANH TÀI (`fishing`) | `SPACE` / chuột / chạm: quăng cần → bấm lại khi phao NHÚNG để giật cần → GIỮ để nâng thanh xanh bám theo cá, NHẢ để hạ; `F` (hoặc nút 🪝 GIẬT, cảm ứng: nút bên trái) giật cá người cùng hồ; bấm vào tên đối thủ để giật đúng người đó |
| XE TĂNG ĐẠN NẢY (`tanks`) | `W` `S` tiến/lùi, `A` `D` xoay thân xe, `SPACE` hoặc chuột trái để bắn |
| 🎨 ĐẠI HỘI HỌA SĨ (`artshow`) | KÉO chuột / ngón tay để vẽ (bút, tẩy, 10 màu, 3 độ dày, hoàn tác `Ctrl+Z`, xoá hết); sang pha bình chọn thì CHẠM tranh để phóng to rồi bấm ❤️ / 🤣 / 💩 |
| 💰 CƯỚP KHO BÁU (`treasure`) | `W` `A` `S` `D` / `←` `↑` `↓` `→` chạy 8 hướng, `SPACE` hoặc chuột trái để cướp / đẩy người (cảm ứng: cần điều khiển + nút 🤜 CƯỚP) |
| 🌋 SURVIVAL HỖN LOẠN (`disaster`) | `W` `A` `S` `D` hoặc `←` `↑` `↓` `→` chạy, `SPACE` nhảy (né sóng động đất); cảm ứng: cần điều khiển + nút NHẢY |


## Quiz: nhập câu hỏi (không cần database)

Mở `/arrow/#admin`, nhập mật khẩu quản trị rồi thêm câu hỏi (ảnh/âm thanh/video tải lên hoặc dán link, danh sách đáp án chấp nhận, số giây).

- **Mật khẩu:** đặt biến môi trường `QUIZ_ADMIN_KEY` trên server. Ở chế độ production mà thiếu biến này thì trang quản lý bị tắt.
- **Dữ liệu lưu ở file:** `questions.json` + thư mục `media/` trong `QUIZ_DIR` (mặc định `server/data/quiz`). Trên VM riêng dữ liệu giữ lâu dài; trên hosting có ổ đĩa tạm (Render gói miễn phí) sẽ mất khi khởi động lại, nên bấm **Xuất sao lưu** (một file JSON kèm media) và **Nhập sao lưu** để nạp lại. Muốn bền hơn có thể gắn ổ đĩa bền cho thư mục đó.
- Không có câu hỏi nào thì game dùng vài câu mẫu bằng chữ.

---

## Game riêng: 🐒 SINH TỒN BẦY KHỈ (`/monkey/`)

Bắn súng sinh tồn **co-op 1–10 người** góc nhìn thứ ba qua vai (lấy cảm hứng từ thể loại "survive the horde" như *Survive a Million Monkeys* trên Roblox, nhưng tên, hình, số liệu đều là của riêng dự án). Chạy **chung tiến trình server Node** với Arrow Party nhưng **tách hẳn**: phòng riêng, giao thức riêng, WebSocket riêng, bundle riêng.

| | Arrow Party (minigame) | Sinh Tồn Bầy Khỉ |
|---|---|---|
| Trang | `/arrow/` | `/monkey/` (`/monkey` tự chuyển hướng) |
| WebSocket | `/arrow/ws` (và mọi đường khác như trước) | `/monkey/ws` |
| Mã client | `client/` | `monkey/` (app Vite riêng, không React, Three.js) |
| Mã server | `server/src/games`, `rooms`… | `server/src/monkey/` |
| Dùng chung | `shared/*.ts` | `shared/monkey/*.ts` |
| Health | `/health` | `/monkey/health` (phòng, người, khỉ, tick, băng thông, RSS) |

Đường dẫn gốc là **một hằng số** `MONKEY_BASE` trong [shared/monkey/config.ts](shared/monkey/config.ts) — server và `monkey/vite.config.ts` cùng đọc, đổi một chỗ là đủ (nhớ build lại `monkey/`).

### Chạy dev

```powershell
# terminal 1 — server (phục vụ cả hai game)
cd server; npm run dev                 # http://localhost:8787
# terminal 2 — client Bầy Khỉ (Vite, proxy /monkey/ws sang 8787)
cd monkey; npm install; npm run dev    # http://localhost:5174/monkey/
```

Minigame vẫn chạy như cũ ở `cd client; npm run dev` (cổng 5173). Đổi cổng server thì đặt `SERVER_PORT` cho Vite.
Chạy production cục bộ: `cd monkey; npm run build` (ra `monkey/dist`) rồi `cd server; npm run build; npm start` → mở `http://localhost:8787/monkey/`.

Biến môi trường (server):

| Biến | Ý nghĩa |
|---|---|
| `MONKEY_STATIC_DIR` | thư mục bundle (mặc định `../monkey/dist` tính từ `server/`) |
| `MONKEY_DATA_DIR` | nơi lưu bảng xếp hạng `leaderboard.json` (mặc định `server/data/monkey`) |
| `MONKEY_START_WAVE=8` | **chỉ để thử/chụp ảnh**: bắt đầu thẳng từ đợt 8 kèm xu tương ứng |
| `VITE_MONKEY_WS_URL` | (lúc build `monkey/`) trỏ WebSocket sang host khác nếu không có reverse proxy |

### Deploy

**Render / Docker (một service duy nhất):** không cần làm gì thêm — `Dockerfile` đã có stage build `monkey/` và copy `monkey/dist` vào image; cùng một server phục vụ `/arrow/` lẫn `/monkey/`, WebSocket `/monkey/ws` đi chung cổng. Sau khi deploy mở `https://<tên-miền>/monkey/`.
Lưu ý: ổ đĩa của gói miễn phí là tạm, bảng xếp hạng mất khi khởi động lại — muốn giữ lâu thì gắn ổ đĩa bền và đặt `MONKEY_DATA_DIR` vào đó.

**VM có nginx đứng trước Node:** nginx phải chuyển `/monkey/` (gồm cả WebSocket `/monkey/ws`) sang Node giống như `/arrow/`. Thêm block (sửa cổng cho đúng server của bạn):

```nginx
# trong server { ... } của tên miền
location /monkey/ {
    proxy_pass http://127.0.0.1:8787;      # KHÔNG có dấu / ở cuối để giữ nguyên đường dẫn /monkey/...
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;  # nâng cấp WebSocket cho /monkey/ws
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;               # giữ kết nối game lâu
    proxy_send_timeout 3600s;
    proxy_buffering off;                    # snapshot 20 lần/giây, không đệm
}
# nếu chưa có ở mức http { ... }:
# map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

Rồi `sudo nginx -t && sudo systemctl reload nginx`. Kiểm tra: `curl https://<tên-miền>/monkey/health`.

### Cách chơi (tóm tắt)

WASD đi · chuột ngắm (Pointer Lock) · chuột trái bắn · chuột phải ngắm (zoom) · Space nhảy (né sóng xung kích của boss) · Shift chạy · R nạp · E giữ để đỡ đồng đội · G/X kỹ năng (tốn xu) · Q tuyệt chiêu (sạc bằng số khỉ hạ) · V nâng bậc súng · C nâng máu · B cửa hàng · Tab bảng điểm · Esc tạm dừng. Mọi phím đổi được trong **Cài đặt** (lưu `localStorage`): độ nhạy chuột, độ nhạy khi ngắm, đảo trục Y, ngắm bật/tắt, FOV, khoảng cách camera, rung màn hình, màu tâm, âm lượng (tổng/hiệu ứng/rừng), chất lượng đồ hoạ (Tự động/Cao/Vừa/Thấp), số sát thương, FPS; cảm ứng: độ nhạy vuốt, hỗ trợ ngắm, cỡ nút. Điện thoại: cần ảo bên trái, vuốt bên phải để ngắm, nút bắn/nhảy/đỡ/kỹ năng/mua.

- **4 lớp:** Chiến Binh (lựu đạn, rào chắn làm chậm, không kích) · Y Sĩ (hộp cứu thương, trạm hồi máu, hồi đầy + đỡ dậy cả đội; đỡ dậy nhanh ×2) · Kỹ Sư (sửa chữa, trụ súng tự động, quá tải) · Đấu Sĩ (dậm đất hất văng, gồng mình, cuồng nộ khiêu khích).
- **5 bậc súng chung:** súng lục → tiểu liên → súng săn → súng trường (xuyên) → pháo chuối (nổ lan); **5 bậc máu**.
- **8 loài khỉ:** nâu, chạy nhanh, ném chuối (đạn né được), đỏ nổ (có vòng cảnh báo, bắn chết thì nổ lây), trắng vồ, khỉ đột đập đất, khỉ con, **Vua Khỉ Đột** mỗi 5 đợt (đập đất → sóng xung kích phải nhảy né, ném thùng, gầm gọi quân, nổi điên dưới 50% máu).
- Gục → 25 giây chờ đồng đội giữ E 3 giây; quá hạn là tử trận, hồi sinh khi đội qua đợt; chơi một mình có lượt tự đứng dậy. Cả đội gục = thua → bảng tổng kết + **bảng xếp hạng** (Một mình / Đồng đội, file JSON ≤ 60 dòng mỗi bảng).

### Netcode (tóm tắt)

- **Nhân vật mình:** mô phỏng xác định 60Hz dùng chung ([shared/monkey/sim.ts](shared/monkey/sim.ts), sin/cos tự dựng bằng bảng) — client dự đoán ngay, gửi lệnh có `seq` (gói nhị phân 12 byte/lệnh, ~30 gói/s), server chạy đúng lệnh đó khi tới và trả `ack`; client lấy trạng thái server rồi chạy lại các lệnh chưa xác nhận (hoà giải), lệch hiển thị được làm mờ dần. Server giới hạn 62 lệnh/giây (chống hack tốc độ).
- **Bắn:** vệt đạn/tia lửa/dấu trúng hiện ngay ở client; mỗi lệnh kèm `vt` = thời điểm client đang nhìn thấy khỉ; server **tua lịch sử vị trí khỉ** (16 tick) về đúng lúc đó, tối đa 7 tick = 350 ms (≈ đệm nội suy 100 ms + 250 ms trễ mạng). Tản đạn dùng PRNG seed theo (người, seq) nên client/server ra cùng hướng. Client còn đoán trước khỉ "chắc đã chết" từ sát thương mình vừa bắn để không bắn thừa khi mạng chậm.
- **Khỉ:** AI ở server 20Hz (spatial hash, flow field BFS 1 m, typed array, không cấp phát trong vòng nóng), trần 150 khỉ sống đồng thời (160 slot) kể cả phòng 10 người — quá 4 người thì số khỉ cùng lúc tăng chậm lại (×0.2/người thay vì ×0.35), độ trâu +8%/người, phần xu chia đồng đội giảm theo căn (10 người ≈ 17%/người) để không lạm phát. Snapshot nhị phân **mã hoá một lần cho cả phòng**, delta theo slot (1/256 m, khỉ đứng yên không tốn byte), client nội suy với đệm tự giãn theo độ giật.
- Phòng hết ván / không còn ai: thế giới khỉ được giải phóng ngay, phòng tự huỷ.

### Kiểm thử

```powershell
cd server
npx tsx test/monkey.test.ts            # unit test xác định (sim, mã hoá, bù trễ, hoà giải RTT 0/80/150/250, AI, kinh tế, đỡ dậy)
npx tsx test/monkeyLag.ts 300          # độ khớp "client thấy trúng" ↔ "server xác nhận" theo RTT
npx tsx test/monkeySimRun.ts 2 80 900  # mô phỏng thời gian ảo một ván với bot (người, RTT, giây)
npx tsx test/monkeyBots.ts 8787 4 4 90 80   # bot WebSocket thật: 4 phòng × 4 người, 90 giây, RTT giả 80ms
```
