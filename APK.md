# 打包成 Android APK

两种方式，**都不需要你手动装一堆工具**：

| 方式 | 适合 | 你需要做的 |
|------|------|-----------|
| 🅰 **GitHub Actions 云端构建**（推荐） | 不想装 Android SDK、要可安装的 APK | 把代码推到 GitHub，自动出 APK 下载 |
| 🅱 **Android Studio 本地构建** | 本机已装 Android Studio / SDK | 打开 `android/` 工程点「Run / Build」 |

> ⚠️ 当前构建机（沙箱）**无法联网下载 Android SDK**（Google / Maven 被网络策略屏蔽），所以 APK 不能在这里直接编译。下面两种方式都在**你自己的环境 / GitHub 云端**执行，那里网络正常。

---

## 🅰 云端一键构建（最省事）

工程已包含 `.github/workflows/build-apk.yml`。只要把代码推到 GitHub，云端 Runner（自带 Android SDK）会自动：

1. `npm run build` 下载离线资源（wasm / tfjs / jsPDF / 姿态模型）
2. `npx cap sync android` 同步前端到原生工程
3. `./gradlew assembleDebug` 编译 **Debug APK**

### 使用步骤
1. 在 GitHub 新建仓库，把本工程 `git push` 上去（包含 `android/`、`ios/`、`js/`、`dist/` 等全部文件）。
2. 进入仓库 **Actions → Build Android APK → Run workflow**（或 push 到 `main` 自动触发）。
3. 跑完后在 **Actions → 本次运行 → Artifacts** 下载 `smashlab-debug-apk`（`app-debug.apk`）。
4. 手机开启「未知来源安装」，传过去装好即可用。

> Debug APK 无需签名即可安装到手机测试，适合自己用 / 给教练看。

### 进阶：生成**签名 Release APK**（可上架）
Release 包需要签名密钥。配置一次即可：

```bash
# 1) 生成密钥库（按提示填密码与信息）
keytool -genkey -v -keystore smashlab.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 -alias smashlab

# 2) 把密钥库转成一行 base64 字符串
base64 -w0 smashlab.keystore > keystore.b64 && cat keystore.b64
```

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 新增 4 个仓库密钥：

| Secret 名 | 值 |
|-----------|-----|
| `KEYSTORE_BASE64` | 上面 `keystore.b64` 的内容 |
| `KEYSTORE_PASSWORD` | 生成时填的密钥库密码 |
| `KEY_ALIAS` | `smashlab` |
| `KEY_PASSWORD` | 密钥密码（可与密钥库密码相同） |

配置后：
- 推一个 **tag**（如 `v1.0.0`）→ 工作流会构建**签名 Release APK** 并自动发布到仓库 **Releases**；
- 或手动 Run workflow 后，在 Artifacts 里下载 `smashlab-release-apk`。

（签名逻辑见 `android/app/build.gradle` 的 `signingConfigs.release`，仅在检测到 `KEYSTORE_BASE64` 时启用。）

---

## 🅱 本地用 Android Studio 构建

### 前置
- **Android Studio** + Android SDK **API 34**（SDK Platform 34、Build-Tools 34.0.0、Platform-Tools）
- **JDK 17**（AGP 8 要求；Capacitor 6 用的 AGP 8.2.1）

### 步骤
```bash
npm install
npm run build            # 联网下载离线资源（含姿态模型 .task）
npm run make:android     # = cap sync android + 相机权限补丁
```
然后：
- **方式 1（GUI）**：`npx cap open android` 打开 Android Studio → 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**，产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。
- **方式 2（命令行）**：
  ```bash
  cd android && ./gradlew assembleDebug      # Debug
  ./gradlew assembleRelease                   # Release（需先配好签名，见上）
  ```
- 装到手机：`adb install android/app/build/outputs/apk/debug/app-debug.apk`

---

## 关于姿态模型文件

APK 要把 `pose_landmarker_lite.task` 打进 `assets/public/models/`。它由 `npm run build` 自动下载（主源 googleapis，失败回退 jsDelivr 镜像）。

- 若 `npm run build` 日志显示「姿态模型源失败」，请手动下载并放入：
  ```
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
  → dist/models/pose_landmarker_lite.task
  ```
  再 `npx cap sync android` 同步进原生工程。
- 缺这个文件，App 打开能跑 UI，但**姿态模型加载会失败**，无法分析动作。

---

## 验证清单（在你本机 / CI）

- [ ] `npm run build` 成功，`dist/models/pose_landmarker_lite.task` 存在
- [ ] `npx cap sync android` 把 `dist/` 同步进 `android/app/src/main/assets/public`
- [ ] `AndroidManifest.xml` 含 `CAMERA` 权限（已由 `scripts/patch-native.mjs` 写入）
- [ ] `./gradlew assembleDebug` 成功，产出 `app-debug.apk`
- [ ] 手机安装后，授权相机，能实时分析动作

---

## 常见问题

- **构建报 `Could not determine the dependencies` / 下载慢**：首次构建需从 Maven 拉取 AGP 等依赖，确保网络可访问 `maven.google.com` / `repo1.maven.org`。
- **`compileSdk 34` 找不到**：确认已安装 **SDK Platform 34** 与 **Build-Tools 34.0.0**。
- **相机无反应**：确认装的是 `make:android` 之后的工程（带 CAMERA 权限），并在系统设置授予 SmashLab 相机权限。
- **模拟器无摄像头**：用真机调试；App 已对 GPU 不可用的设备自动回退 CPU delegate。
