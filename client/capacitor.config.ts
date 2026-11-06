import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arrowparty.app',
  appName: 'Arrow Party',
  webDir: 'dist-ios',
  backgroundColor: '#080a16',
  ios: {
    contentInset: 'always',
    backgroundColor: '#080a16',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#080a16',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      overlaysWebView: true,
    },
  },
};

export default config;
