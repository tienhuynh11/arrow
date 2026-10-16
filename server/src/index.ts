import { initStore } from './monkey/db/index.js';
import { startServer } from './network/server.js';

// nạp server/.env (nếu có) + kết nối/migrate DB ở nền; lỗi DB không chặn server (tự chuyển sang RAM)
void initStore();
startServer();
