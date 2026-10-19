import { render } from 'preact';
import { api, hasToken } from './api';
import { App } from './ui/App';
import { GLTF_HEROES, preloadHeroModels } from './render/gltf-model';
import './styles.css';

// tải sớm model glTF ngay khi mở app (không chặn giao diện; lỗi thì giữ mô hình procedural)
preloadHeroModels(Object.keys(GLTF_HEROES));

// khôi phục phiên nếu còn token; lỗi (hết hạn, mất mạng) thì rơi về màn đăng nhập
async function boot() {
  if (hasToken()) {
    try {
      await api.refresh();
    } catch {
      /* về màn đăng nhập */
    }
  }
  render(<App />, document.getElementById('app')!);
}
void boot();
