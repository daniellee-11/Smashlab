// 构建脚本：把前端静态文件拷贝到 dist/，供 Capacitor / Tauri 打包使用
import { mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });
for (const f of ["index.html", "css", "js"]) {
  const src = join(root, f);
  if (existsSync(src)) cpSync(src, join(dist, f), { recursive: true });
}
console.log("✅ 已构建到 dist/  （index.html + css/ + js/）");
