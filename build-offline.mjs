// 离线构建：把全部依赖（MediaPipe wasm + 姿态模型 + tasks-vision + tfjs + jsPDF）
// 下载进 dist/，改写 CDN 链接为本地相对路径，并注入 UMD <script>，
// 使 App 在球场无网/弱网环境也能完整运行。
import { mkdirSync, cpSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const WASM_VER = "@mediapipe/tasks-vision@0.10.12";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

async function download(url, dest, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      return buf.length;
    } catch (e) { if (i === tries - 1) throw e; await sleep(400); }
  }
}

async function main() {
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const f of ["index.html", "css", "js"]) cpSync(join(root, f), join(dist, f), { recursive: true });
  log("前端已拷贝到 dist/");

  const vendor = join(dist, "vendor");
  mkdirSync(vendor, { recursive: true });

  // tasks-vision：自包含 ESM
  let n = await download(`https://cdn.jsdelivr.net/npm/${WASM_VER}/vision_bundle.mjs`, join(vendor, "tasks-vision.mjs"));
  log(`tasks-vision  ESM  ${(n / 1e6).toFixed(2)} MB`);

  // tfjs：UMD（自包含，注入全局 tf）
  n = await download(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js`, join(vendor, "tfjs.js"));
  log(`tfjs  UMD  ${(n / 1e6).toFixed(2)} MB`);

  // jsPDF：UMD（注入全局 jspdf.jsPDF）
  n = await download(`https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js`, join(vendor, "jspdf.js"));
  log(`jsPDF  UMD  ${(n / 1e6).toFixed(2)} MB`);

  // MediaPipe wasm 运行时
  const wasmDir = join(dist, "wasm");
  mkdirSync(wasmDir, { recursive: true });
  const wasmFiles = ["vision_wasm_internal.js", "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];
  for (const f of wasmFiles) {
    try {
      const len = await download(`https://cdn.jsdelivr.net/npm/${WASM_VER}/wasm/${f}`, join(wasmDir, f));
      log(`wasm  ${f}  ${(len / 1e6).toFixed(2)} MB`);
    } catch (e) { log(`wasm  ${f}  跳过(${e.message})`); }
  }

  // 姿态模型（主源 googleapis；失败回退 jsDelivr 镜像，提高 CI/弱网成功率）
  const modelsDir = join(dist, "models");
  mkdirSync(modelsDir, { recursive: true });
  const modelUrls = [
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    "https://cdn.jsdelivr.net/gh/google-ai-edge/mediapipe@v0.10.12/mediapipe/model/pose_landmarker/pose_landmarker_lite.task"
  ];
  let ok = false;
  for (const u of modelUrls) {
    try {
      const ml = await download(u, join(modelsDir, "pose_landmarker_lite.task"));
      log(`姿态模型  ${(ml / 1e6).toFixed(1)} MB  (${u.split("/")[2]})`);
      ok = true; break;
    } catch (e) { log(`⚠ 姿态模型源失败：${u.split("/")[2]} (${e.message})`); }
  }
  if (!ok) log(`⚠ 所有姿态模型源均失败 —— 请联网环境下重新运行 npm run build，或手动把 pose_landmarker_lite.task 放入 dist/models/`);

  // 改写 CDN 链接为本地路径（先具体后笼统）
  const reps = [
    [`https://cdn.jsdelivr.net/npm/${WASM_VER}/wasm`, "./wasm"],
    [modelUrl, "./models/pose_landmarker_lite.task"],
    ["https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm", "./vendor/jspdf.js"],
    [`https://cdn.jsdelivr.net/npm/${WASM_VER}`, "./vendor/tasks-vision.mjs"],
    ["https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0", "./vendor/tfjs.js"]
  ];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|css|js|mjs)$/.test(e.name)) {
        let s = readFileSync(p, "utf8");
        for (const [from, to] of reps) s = s.split(from).join(to);
        writeFileSync(p, s);
      }
    }
  };
  walk(dist);
  log("CDN 链接已改写为本地路径");

  // 注入 UMD <script>（tfjs / jspdf），置于 module 脚本之前
  const htmlPath = join(dist, "index.html");
  let html = readFileSync(htmlPath, "utf8");
  const inject = `<script src="./vendor/tfjs.js"></script>\n  <script src="./vendor/jspdf.js"></script>`;
  html = html.replace(/(\s*)<script type="module" src="js\/app.js">/, `${inject}$1<script type="module" src="js/app.js">`);
  writeFileSync(htmlPath, html);
  log("已注入 UMD 脚本标签");

  // 校验：dist 内不应再有外部 CDN 引用
  const bad = [];
  const chk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) chk(p);
      else if (/\.(html|css|js|mjs)$/.test(e.name) && /cdn\.jsdelivr\.net|storage\.googleapis\.com/.test(readFileSync(p, "utf8"))) bad.push(p);
    }
  };
  chk(dist);
  if (bad.length) console.warn("⚠ 仍含外部引用：", bad.slice(0, 5));
  else log("✅ 校验通过：dist/ 已无任何外部 CDN 引用，可完全离线运行");
  console.log("离线构建完成 →", dist);
}

main().catch((e) => { console.error("❌ 离线构建失败：", e.message); process.exit(1); });
