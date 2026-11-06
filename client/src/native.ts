import { Capacitor } from '@capacitor/core';

/** Chạy trong app iOS (Capacitor) thì ẩn status bar + tắt splash cho cảm giác full-screen như game thật. */
export async function setupNativeShell() {
  if (!Capacitor.isNativePlatform()) return;
  const [{ StatusBar }, { SplashScreen }] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);
  await StatusBar.hide().catch(() => {});
  await SplashScreen.hide().catch(() => {});
}
