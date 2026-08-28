import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.smashlab.app',
  appName: 'SmashLab',
  webDir: 'dist',
  server: {
    // 原生 WebView 以 localhost 形式提供资源，被视为安全上下文，允许 getUserMedia
    androidScheme: 'https'
  },
  android: {
    // 摄像头权限（供 WebView 内 getUserMedia 使用）
    permissions: ['CAMERA']
  },
  ios: {
    // iOS 通过 WKWebView 使用摄像头，需在 Info.plist 声明用途（见 scripts/patch-native.mjs）
  },
  plugins: {}
};

export default config;
