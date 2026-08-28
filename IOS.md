# iOS 云端自动出包（GitHub Actions）

无需本地 macOS / Xcode：把代码 push 到 GitHub，云端 Runner（自带 Xcode + CocoaPods）自动构建并把 **IPA** 作为「产物 / Release」提供下载。

对应工作流：`.github/workflows/build-ios.yml`

---

## 1. 不配密钥也能跑

直接 push 到 `main`（或手动在仓库 **Actions → Build iOS IPA → Run workflow**），工作流会：

1. 安装依赖、构建离线资源（`npm run build`，含姿态模型）
2. `cap sync ios` 同步原生工程 + `pod install`
3. 执行**编译检查**验证工程可构建

> 这一步不需要任何签名，只是验证代码能编过。要拿到**可安装的 IPA** 必须配置签名密钥（见下）。

---

## 2. 配置签名密钥（出可安装 IPA）

iOS 要在真机上安装，必须有**开发者证书 + 描述文件**。在 [Apple Developer](https://developer.apple.com) 后台准备后，把以下 4 个值存进仓库 **Settings → Secrets and variables → Actions → New repository secret**：

| Secret 名 | 内容 | 获取方式 |
|------------|------|----------|
| `IOS_CERTIFICATE_BASE64` | `.p12` 证书的 base64 | `openssl base64 -in Cert.p12 \| tr -d '\n'` |
| `IOS_CERTIFICATE_PASSWORD` | `.p12` 的导出密码 | 你创建证书时设的密码 |
| `IOS_PROVISIONING_PROFILE_BASE64` | `.mobileprovision` 的 base64 | `openssl base64 -in profile.mobileprovision \| tr -d '\n'` |
| `IOS_TEAM_ID` | 10 位 Team ID | Developer 后台右上角 |

可选：

| Secret 名 | 内容 | 默认 |
|-----------|------|------|
| `IOS_EXPORT_METHOD` | 导出方式 | `ad-hoc`（也可填 `app-store`） |

### 描述文件怎么选
- **`ad-hoc`**（默认，适合内测分发）：在 Developer 后台建 **Ad Hoc** 描述文件，**勾选你要安装的测试设备 UDID**，Bundle ID 填 `com.smashlab.app`。
- **`app-store`**（上架 TestFlight / App Store）：建 **App Store** 描述文件，正常提审即可。

> 证书类型不限「Apple Distribution」或「iOS Distribution」，只要描述文件与之匹配即可。工作流用 **Manual 签名**，按名称引用描述文件，避免自动签名抢不到正确 profile。

配置好 4 个必填 Secret 后，再次触发工作流就会自动：
导入证书到临时钥匙串 → 安装描述文件 → `xcodebuild archive` → 导出 IPA → 上传产物。

---

## 3. 拿包 & 安装

- **产物（Artifacts）**：工作流跑完在 **Actions → 对应运行 → Artifacts → `smashlab-ios-ipa`** 下载 `App.ipa`。
- **Release**：打 `v1.0.0` 这类 `v*` 标签并配好密钥，IPA 会自动作为 GitHub Release 附件发布。
- **安装**：
  - `ad-hoc` 包用 [Apple Configurator 2](https://apps.apple.com/us/app/apple-configurator/id1037126344)、[Diawi](https://www.diawi.com/)、或公司的 MDM 分发到已登记设备。
  - `app-store` 包走 TestFlight / App Store 审核流程。

---

## 4. 本地构建（有 Mac 时）

```bash
npm install
npm run build
npm run make:ios          # cap sync ios + 补丁
cd ios/App && pod install
npx cap open ios          # Xcode 打开 App.xcworkspace，配签名后 ▶ Run / Archive
```

---

## 5. 常见问题

- **编译检查通过但 IPA 步骤没跑**：说明没配置 4 个签名 Secret，工作流按设计只做编译验证。
- **`No profile matching '...' found`**：描述文件未包含该设备 UDID（ad-hoc 时），或 `IOS_TEAM_ID` 与证书所属 Team 不一致。
- **`Failed to parse entitlement` / 签名失败**：证书与描述文件类型不匹配（Distribution 证书配了 Development profile 之类）。
- **相机不可用**：iOS 模拟器不支持摄像头，请用真机；`Info.plist` 已写入 `NSCameraUsageDescription`。
- **模型加载失败**：确认 `dist/models/pose_landmarker_lite.task` 存在（工作流第一步 `npm run build` 会自动下载；若 Runner 网络限制下载失败，参见 `MOBILE.md` 手动补模型）。

---

## 附：与 Android 工作流对照

| 项 | Android | iOS |
|----|---------|-----|
| 工作流 | `build-apk.yml` | `build-ios.yml` |
| Runner | `ubuntu-latest`（自带 Android SDK） | `macos-latest`（自带 Xcode） |
| 无密钥产物 | Debug APK | 仅编译检查日志 |
| 签名 Secret | `KEYSTORE_BASE64` 等 4 个 | `IOS_CERTIFICATE_BASE64` 等 4 个 |
| 有密钥产物 | Release APK | 签名 IPA（ad-hoc / app-store） |
| Release | 打 `v*` 标签 | 打 `v*` 标签 |
