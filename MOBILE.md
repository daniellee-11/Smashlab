# SmashLab 移动端（Android / iOS）构建说明

本项目已通过 **Capacitor** 生成好原生工程：

- `android/` —— Android Studio 工程（包名 `com.smashlab.app`）
- `ios/` —— Xcode 工程（打开 `ios/App/App.xcworkspace`）

Web 代码（姿态估计 + LSTM 动作分类）全部跑在原生 WebView 里，摄像头通过 `getUserMedia` 在端内调用，**不上传服务器**。

---

## 0. 前置条件

| 平台 | 需要 | 说明 |
|------|------|------|
| 通用 | Node.js 18+、`npm` | 用于构建前端资源 |
| Android | [Android Studio](https://developer.android.com/studio) + Android SDK（API 22+） | 用 `npx cap open android` 打开 `android/` |
| iOS | macOS + Xcode 15+ + CocoaPods | 用 `npx cap open ios` 打开 `ios/App/App.xcworkspace` |

> ⚠️ 本仓库在生成时已把前端资源同步进原生工程，但**姿态模型文件 `pose_landmarker_lite.task` 需你本地联网下载一次**（约 3–4 MB，托管在 Google 存储，构建机若屏蔽该域名会下载失败）。请在你本机执行下面第 1 步以补全模型。

---

## 1. 构建离线前端资源（含模型）

```bash
npm install
npm run build        # 下载 wasm / tfjs / jsPDF / 姿态模型 到 dist/
```

构建完成后 `dist/models/pose_landmarker_lite.task` 应存在。若该项提示下载失败，请手动下载并放入：

```
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
→ 放到 dist/models/pose_landmarker_lite.task
```

---

## 2. 同步到原生工程并打相机权限补丁

```bash
npm run make:android   # = cap sync android + 补丁（一次搞定）
npm run make:ios       # = cap sync ios   + 补丁（一次搞定）
```

补丁脚本 `scripts/patch-native.mjs` 会：
- Android：确保 `AndroidManifest.xml` 含 `<uses-permission android:name="android.permission.CAMERA" />`
  （Capacitor 的 `BridgeWebChromeClient` 已内置处理 WebView 相机运行时授权，无需改 Java）
- iOS：在 `Info.plist` 注入 `NSCameraUsageDescription`（WKWebView 调用摄像头必需）

> 每次修改前端后，重复 `npm run build` → `npm run make:android` / `make:ios` 即可更新 App。

---

## 3. 运行 / 打包

### Android
```bash
npx cap open android     # 启动 Android Studio
```
- 连接真机或启动模拟器，点 ▶ Run 即可。
- 打包 APK / AAB：`Build → Generate Signed Bundle / APK`。
- **建议使用真机**：模拟器默认无摄像头，且 GPU delegate 可能不可用（App 已自动回退 CPU）。

### iOS（需 macOS）
```bash
cd ios/App && pod install   # 首次需安装 CocoaPods 依赖
npx cap open ios            # 启动 Xcode，打开 App.xcworkspace
```
- 选真机或模拟器 ▶ Run。摄像头在模拟器上不可用，请用真机调试。
- 上架前在 Xcode 中配置签名（Team / Bundle Identifier）。

### iOS 云端自动构建（无需 Mac）

没有 macOS / Xcode 也能出包：把代码 push 到 GitHub，工作流 `.github/workflows/build-ios.yml` 在云端 Runner 自动构建，输出可安装的 **IPA**。

- 未配签名密钥：仅做**编译检查**（验证工程可构建）。
- 配置 4 个仓库 Secrets（`IOS_CERTIFICATE_BASE64` / `IOS_CERTIFICATE_PASSWORD` / `IOS_PROVISIONING_PROFILE_BASE64` / `IOS_TEAM_ID`）后：自动导入证书+描述文件，出 **Ad Hoc / App Store IPA**，打 `v*` 标签即发布到 Release。

详细步骤、Secrets 准备、描述文件选择见 **[IOS.md](./IOS.md)**。

---

## 4. 已做的原生适配

- **相机权限**：Android `CAMERA` + iOS `NSCameraUsageDescription` 已写入。
- **安全上下文**：Capacitor 以 `localhost` 提供资源，被视为安全上下文，`getUserMedia` 与 WebGL 可用。
- **GPU 回退**：MediaPipe 在部分手机 WebView 的 GPU 加速不可用，App 已自动回退到 CPU delegate（`js/app.js`）。
- **完全离线**：`dist/` 已内置 wasm / 模型 / tfjs / jsPDF，球场弱网也能跑。

---

## 5. 常见问题

- **App 打开后黑屏 / 模型加载失败**：检查 `dist/models/pose_landmarker_lite.task` 是否存在（第 1 步未成功下载）。
- **相机无反应 / 权限弹窗不出现**：确认已执行 `make:android` / `make:ios`（写入权限），并在系统设置里授予 SmashLab 相机权限。
- **iOS 模拟器无法用相机**：这是系统限制，请用真机。
- **想换包名 / App 名**：改 `capacitor.config.ts` 的 `appId` / `appName`，再 `cap sync`。

---

## 附：相关脚本（package.json）

```jsonc
"build":        "node build-offline.mjs",   // 离线构建到 dist/
"cap:sync":     "npx cap sync",             // 同步前端资源到原生工程
"cap:patch":    "node scripts/patch-native.mjs",
"make:android": "npm run build && npx cap sync android && node scripts/patch-native.mjs",
"make:ios":     "npm run build && npx cap sync ios && node scripts/patch-native.mjs",
"cap:android":  "npx cap open android",
"cap:ios":      "npx cap open ios"
```
