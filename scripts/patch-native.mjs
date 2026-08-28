// 原生工程补丁：为 Android / iOS 原生 WebView 启用摄像头（getUserMedia）
// - Android：确保 AndroidManifest.xml 含 CAMERA 权限（Capacitor 的 WebChromeClient 已处理运行时授权）
// - iOS：在 Info.plist 注入 NSCameraUsageDescription（WKWebView 摄像头必需）
// 幂等：已存在则跳过。可在 `npx cap sync` 之后运行。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const proj = join(root, "..");

function walk(dir, cb) {
  let e;
  try { e = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const f of e) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

let changed = 0;

// ---------- Android：CAMERA 权限 ----------
const manifestPaths = [];
walk(join(proj, "android"), (p) => { if (p.endsWith("AndroidManifest.xml")) manifestPaths.push(p); });
for (const mp of manifestPaths) {
  let s = readFileSync(mp, "utf8");
  if (s.includes("android.permission.CAMERA")) { console.log("• AndroidManifest 已含 CAMERA 权限，跳过:", mp); continue; }
  const perm = '    <uses-permission android:name="android.permission.CAMERA" />\n';
  if (s.includes("<!-- Permissions -->")) {
    s = s.replace("<!-- Permissions -->", `<!-- Permissions -->\n${perm}`);
  } else {
    s = s.replace("</manifest>", `${perm}</manifest>`);
  }
  writeFileSync(mp, s);
  console.log("✅ AndroidManifest 已添加 CAMERA 权限:", mp);
  changed++;
}

// ---------- iOS：NSCameraUsageDescription ----------
const CAMERA_DESC = "SmashLab 需要使用摄像头实时分析你的羽毛球击球动作";
const infoPaths = [];
walk(join(proj, "ios"), (p) => { if (p.endsWith("Info.plist")) infoPaths.push(p); });
for (const ip of infoPaths) {
  const s = readFileSync(ip, "utf8");
  if (!s.includes("CFBundleName") || !s.includes("SmashLab")) continue; // 只改主 App 的 Info.plist
  if (s.includes("NSCameraUsageDescription")) { console.log("• Info.plist 已含相机用途说明，跳过:", ip); continue; }
  const block = `	<key>NSCameraUsageDescription</key>\n	<string>${CAMERA_DESC}</string>\n`;
  const ns = s.replace(/\n<\/dict>\n<\/plist>/, `\n${block}</dict>\n</plist>`);
  writeFileSync(ip, ns);
  console.log("✅ Info.plist 已注入 NSCameraUsageDescription:", ip);
  changed++;
}

console.log(changed ? `\n补丁完成，共修改 ${changed} 个文件。` : "\n无需修改，原生工程已就绪。");
