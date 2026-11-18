# 本地构建 APK 指南（离线资源已内置）

> 本包已包含**全部离线资源**：MediaPipe wasm（19M）、tfjs / jsPDF / tasks-vision（2M）、
> **姿态模型 pose_landmarker_lite.task（5.6M）**，以及 `node_modules`（85M）。
> **解压后构建 APK 无需联网**（Gradle 首次运行需下载 AGP 依赖除外，见下文）。

## 一、环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| JDK | **17**（AGP 8.2.1 强制要求） | `java -version` 确认 |
| Android SDK | compileSdk 34 / build-tools 34 | Android Studio 自带 |
| ANDROID_HOME | 指向 SDK 目录 | 或在 `android/local.properties` 写 `sdk.dir=/path/to/sdk` |

没有 SDK？最快路径：安装 [Android Studio](https://developer.android.com/studio)，首次启动会自动装好 SDK。

## 二、构建（命令行）

```bash
# 1. 指定 SDK 位置（二选一）
echo "sdk.dir=$HOME/Android/Sdk" > android/local.properties

# 2. 构建 Debug APK（可直接安装调试）
cd android
./gradlew assembleDebug

# 产物：android/app/build/outputs/apk/debug/app-debug.apk
# 安装到手机：
adb install app/build/outputs/apk/debug/app-debug.apk
```

> Gradle 首次运行需要联网下载 AGP/Capacitor 构建依赖（约 200-400M，缓存后离线）。
> 若网络受限，可在 `android/build.gradle` 的 buildscript repositories 里加阿里云镜像：
> `maven { url 'https://maven.aliyun.com/repository/google' }`、`maven { url 'https://maven.aliyun.com/repository/central' }`。

## 三、构建（Android Studio 图形界面）

1. Android Studio → **Open** → 选择本包的 `android/` 目录
2. 等待 Gradle Sync 完成
3. 菜单 **Build → Build Bundle(s)/APK(s) → Build APK(s)**
4. 点通知栏 **locate** 拿到 APK

## 四、Release 签名 APK（上架/正式发布）

```bash
# 1. 生成签名密钥（一次性）
keytool -genkey -v -keystore smashlab.keystore -alias smashlab \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. 在 android/keystore.properties 写入（不要提交到 git）：
# storeFile=/absolute/path/smashlab.keystore
# storePassword=你的密码
# keyAlias=smashlab
# keyPassword=你的密码

# 3. 构建
cd android && ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

> `app/build.gradle` 已内置签名配置（自动读取 `keystore.properties`，文件不存在则跳过，Debug 构建不受影响）。

## 五、注意事项

- **真机调试**：模拟器通常无摄像头，务必用真机（App 会自动申请相机权限）。
- **GPU 回退**：部分手机 WebView 不支持 GPU delegate，App 已自动回退 CPU。
- **App 内容即 `android/app/src/main/assets/public/`**：改了前端代码后运行
  `npm run make:android`（在本包根目录）即可重新同步，无需重新拷文件。
- **iOS 端**：同样已内置全部资源，Mac 上 `cd ios/App && pod install && npx cap open ios`。
- 模型文件校验：`dist/models/pose_landmarker_lite.task` 应为 5.6M 的 zip 容器（内含
  pose_detector.tflite + pose_landmarks_detector.tflite）。

## 六、云端构建备选

不想装本地环境？推到 GitHub 后 Actions 自动出包，见 `APK.md` / `IOS.md`。
