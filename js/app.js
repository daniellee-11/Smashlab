// AI 羽毛球动作分析 — 主逻辑（整合分类模型 / 手性自适应 / 对比 / 导出）
import {
  PoseLandmarker, FilesetResolver, DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12";
import { ActionClassifier, ACTIONS, bufferToSeq, FEATURES } from "./model.js";
import { detectRacketHand, sideIndices, sideLabel, SIDE_LM } from "./handedness.js";
import { computeDeviation, buildReferencePose, drawReference, IDEAL_ANGLES } from "./compare.js";
import { exportPDF, exportPNG } from "./export.js";
import { PoseDemo } from "./demo.js";

const VIDEO_W = 640;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video"), overlay = $("overlay"), ctx = overlay.getContext("2d");
const placeholder = $("placeholder"), statusPill = $("status");
const fileInput = $("file-input");
const btnCam = $("btn-cam"), btnFile = $("btn-file"), btnStop = $("btn-stop");
const fpsEl = $("fps"), poseStatusEl = $("pose-status");

const elAction = $("action-name"), elConf = $("action-conf");
const elScoreNum = $("score-num"), elScoreTag = $("score-tag"), ring = $("ring");
const elReport = $("report");
const mShoulder = $("m-shoulder"), mElbow = $("m-elbow"), mKnee = $("m-knee");
const mTrunk = $("m-trunk"), mWrist = $("m-wrist"), mSpeed = $("m-speed");

// 新增控件
const btnTrain = $("btn-train"), trainStatus = $("train-status"), trainBar = $("train-bar");
const btnCompare = $("btn-compare"), refPanel = $("ref-panel"), refMatch = $("ref-match"), devList = $("dev-list");
const btnPdf = $("btn-export-pdf"), btnPng = $("btn-export-png");
const handLabel = $("hand-label"), handOverride = $("hand-override");
const capAction = $("capture-action"), btnCapture = $("btn-capture"), capCount = $("capture-count"), btnRetrain = $("btn-retrain");
const btnPack = $("btn-pack"), packModal = $("pack-modal"), packClose = $("pack-close");
const demoCanvas = $("demo-canvas"), btnDemo = $("btn-demo"), demoPhase = $("demo-phase");

// ---------- 状态 ----------
let poseLandmarker = null, drawingUtils = null;
let running = false, stream = null;
let lastVideoTime = -1, rafId = null;
let frameCount = 0, lastFpsTime = performance.now(), fps = 0;

let activeSide = null;            // 'L' / 'R'，自动检测
let handBuf = [];                 // 双手腕原始坐标（手性检测）
let featBuf = [];                 // 每帧 8 维特征（分类模型输入）
let angleBuf = [];                // 每帧角度（启发式回退）
let prevWristRaw = null;          // 上一帧持拍手腕原始坐标（算速度）
let classifier = new ActionClassifier();
let showRef = false;
let lastMeta = null;              // 最近一帧元数据（用于快照/对比）
let userSamples = loadUserSamples();

// ---------- 几何工具 ----------
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y) || 1e-6;
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

// 计算某一侧（持拍侧）的关键指标
function computeSideMetrics(L, side) {
  const I = SIDE_LM[side];
  const sh = L[I.shoulder], el = L[I.elbow], wr = L[I.wrist];
  const hi = L[I.hip], kn = L[I.knee], an = L[I.ankle], no = L[0];
  const elbowAngle = angle(sh, el, wr);
  const shoulderFlex = angle(hi, sh, el);
  const kneeAngle = angle(hi, kn, an);
  const trunkLean = angle({ x: sh.x, y: sh.y + 1 }, sh, hi);
  const wristNormY = no.y - wr.y;               // 原始归一化差值（>0 高于头）
  const wristAboveHead = wr.y < no.y;
  const seg = {
    torso: dist(sh, hi), upper: dist(sh, el), fore: dist(el, wr),
    thigh: dist(hi, kn), shank: dist(kn, an)
  };
  return {
    elbowAngle, shoulderFlex, kneeAngle, trunkLean, wristNormY, wristAboveHead,
    seg, wristRaw: { x: wr.x, y: wr.y }, points: { sh, el, wr, hi, kn, an }
  };
}

// ---------- 模型 / 手性 / 分类 ----------
async function ensureModel() {
  if (classifier.ready) return;
  setTrain("加载/训练模型中…", 0.05);
  await classifier.loadOrTrain((msg, p) => setTrain(msg, p));
}

async function classify() {
  if (classifier.ready && featBuf.length >= 8) {
    const seq = bufferToSeq(featBuf, 30);
    const pred = classifier.predict(seq);
    if (pred) return pred;
  }
  return heuristicClassify(); // 回退
}

function heuristicClassify() {
  if (angleBuf.length < 6) return { key: "ready", name: "准备/移动", conf: 50 };
  let maxWY = -1e9, maxElbow = 0, minKnee = 999, maxTrunk = 0, maxSh = 0, above = 0;
  for (const m of angleBuf) {
    maxWY = Math.max(maxWY, m.wristNormY); maxElbow = Math.max(maxElbow, m.elbowAngle);
    minKnee = Math.min(minKnee, m.kneeAngle); maxTrunk = Math.max(maxTrunk, m.trunkLean);
    maxSh = Math.max(maxSh, m.shoulderFlex); if (m.wristAboveHead) above++;
  }
  const headRatio = above / angleBuf.length;
  if (maxWY > 0.15 && headRatio > 0.4) {
    if (maxSh > 130 && maxTrunk > 12) return { key: "smash", name: "杀球", conf: 80 };
    if (maxSh > 110) return { key: "clear", name: "高远球", conf: 78 };
    return { key: "drop", name: "吊球", conf: 70 };
  }
  if (maxWY < 0.08 && maxWY > -0.35) return { key: "net", name: "平抽/网前", conf: 68 };
  if (maxWY <= -0.2) return { key: "defense", name: "防守挑球", conf: 66 };
  return { key: "ready", name: "准备/移动", conf: 55 };
}

// ---------- 主循环 ----------
async function loop() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = poseLandmarker.detectForVideo(video, now);

    // FPS
    frameCount++;
    if (now - lastFpsTime >= 500) {
      fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      frameCount = 0; lastFpsTime = now; fpsEl.textContent = fps + " FPS";
    }

    ctx.save(); ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (res.landmarks && res.landmarks.length) {
      poseStatusEl.textContent = "已锁定人体 ✓";
      const L = res.landmarks[0];
      res.landmarks.forEach((lm) => {
        drawingUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#46e08a", lineWidth: 3 });
        drawingUtils.drawLandmarks(lm, { color: "#ffb02e", radius: 3 });
      });

      // 手性检测（自动判断持拍手）
      handBuf.push({ lw: { x: L[15].x, y: L[15].y }, rw: { x: L[16].x, y: L[16].y } });
      if (handBuf.length > 40) handBuf.shift();
      if (!activeSide && handBuf.length >= 30) {
        const det = detectRacketHand(handBuf);
        if (det) setActiveSide(det);
      }

      // 按持拍侧计算指标
      const side = activeSide || "R";
      const m = computeSideMetrics(L, side);

      // 特征向量（8 维）
      const sw = dist(L[11], L[12]) || 1e-6;
      const wristNormYfeat = (L[0].y - m.wristRaw.y) / sw;
      let vx = 0, vy = 0;
      if (prevWristRaw) { vx = (m.wristRaw.x - prevWristRaw.x) * 30; vy = (m.wristRaw.y - prevWristRaw.y) * 30; }
      prevWristRaw = { x: m.wristRaw.x, y: m.wristRaw.y };
      const feat = [m.shoulderFlex, m.elbowAngle, m.kneeAngle, m.trunkLean, wristNormYfeat, m.wristAboveHead ? 1 : 0, vx, vy];
      featBuf.push(feat); if (featBuf.length > 60) featBuf.shift();
      angleBuf.push({ ...m, shoulderFlex: m.shoulderFlex, elbowAngle: m.elbowAngle, kneeAngle: m.kneeAngle, trunkLean: m.trunkLean, wristNormY: m.wristNormY, wristAboveHead: m.wristAboveHead });
      if (angleBuf.length > 60) angleBuf.shift();

      updateMetricsUI(m);
      if (showRef) drawReferenceOverlay(m, side);
      lastMeta = { landmarks: L, actionKey: currentActionKey, seg: m.seg, points: m.points, metrics: m };
      demo.setSeg(m.seg);

      // 分类 + 评分（每 3 帧）
      if (frameCount % 3 === 0) {
        const pred = await classify();
        currentActionKey = pred.key; currentActionName = pred.name; currentConf = pred.conf;
        elAction.textContent = pred.name; elConf.textContent = "置信度 " + pred.conf + "%";
        demo.setAction(pred.key);
        analyzeLive(m, pred);
        if (showRef) updateDeviation(m, pred.key);
      }
    } else {
      poseStatusEl.textContent = "未检测到人体";
    }
    ctx.restore();
  }
  rafId = requestAnimationFrame(loop);
}

let currentActionKey = "ready", currentActionName = "准备/移动", currentConf = 50;

// ---------- 实时分析与评分 ----------
function analyzeLive(m, pred) {
  let score = 58; const report = [];
  if (m.kneeAngle < 150) { score += 12; report.push({ t: "<b>屈膝降重心得当</b>：膝关节弯曲、重心压低，利于启动与发力。", c: "good" }); }
  else report.push({ t: "<b>重心偏高</b>：建议击球前后保持屈膝（膝盖角度 < 150°），提升稳定性与爆发力。", c: "warn" });

  if (pred.key === "smash" || pred.key === "clear") {
    if (m.shoulderFlex > 120) { score += 10; report.push({ t: "<b>引拍充分</b>：肩抬高角大，手臂充分后引，为扣杀蓄积旋转空间。", c: "good" }); }
    else report.push({ t: "<b>引拍不足</b>：肩抬高角偏小，建议向后充分展肩，让击球点更高更靠前。", c: "warn" });
    if (m.trunkLean > 10) { score += 8; report.push({ t: "<b>躯干参与发力</b>：转体带动挥拍，符合鞭打击球原理。", c: "good" }); }
    else report.push({ t: "<b>躯干转动偏少</b>：扣杀应配合转髋转肩，仅靠手臂力量有限且易受伤。", c: "warn" });
  }
  if (m.elbowAngle > 150 && pred.key !== "net" && pred.key !== "defense") { score += 6; report.push({ t: "<b>击球手臂伸展</b>：肘部接近伸直，击球点前伸，利于力量传导。", c: "good" }); }
  else if (pred.key !== "net" && pred.key !== "defense" && m.elbowAngle < 130) report.push({ t: "<b>击球点偏近</b>：肘部过曲，建议把击球点送到身体前上方，手臂更舒展。", c: "warn" });

  const speed = estSpeed();
  if (speed >= 70) score += 4;
  mSpeed.textContent = speed > 0 ? speed + " 相对单位" : "--";

  score = Math.max(40, Math.min(99, Math.round(score)));
  setScore(score); renderReport(report);
}
function estSpeed() {
  if (featBuf.length < 4) return 0;
  const a = featBuf[featBuf.length - 4], b = featBuf[featBuf.length - 1];
  const v = Math.hypot((b[6] - a[6]), (b[7] - a[7])) * 1.2;
  return Math.min(99, Math.round(v * 10));
}

// ---------- UI 更新 ----------
function updateMetricsUI(m) {
  mShoulder.textContent = Math.round(m.shoulderFlex) + "°";
  mElbow.textContent = Math.round(m.elbowAngle) + "°";
  mKnee.textContent = Math.round(m.kneeAngle) + "°";
  mTrunk.textContent = Math.round(m.trunkLean) + "°";
  mWrist.textContent = m.wristAboveHead ? "高于头 ✓" : "头下";
}
function setScore(s) {
  elScoreNum.textContent = s;
  ring.style.strokeDashoffset = 327 - (s / 100) * 327;
  let color = "#46e08a", tag = "优秀";
  if (s < 60) { color = "#ff5d5d"; tag = "需加强"; }
  else if (s < 80) { color = "#ffb02e"; tag = "良好"; }
  ring.style.stroke = color; elScoreTag.textContent = tag; elScoreTag.style.color = color;
}
function renderReport(items) {
  if (!items.length) return;
  elReport.innerHTML = "";
  items.forEach((it) => {
    const li = document.createElement("li");
    li.className = it.c || ""; li.innerHTML = it.t; elReport.appendChild(li);
  });
}
function setStatus(text, loading, hideAfter) {
  statusPill.hidden = false; statusPill.textContent = text;
  statusPill.style.borderColor = loading ? "#ffb02e" : "#46e08a";
  statusPill.style.color = loading ? "#ffb02e" : "#46e08a";
  if (hideAfter) setTimeout(() => (statusPill.hidden = true), hideAfter);
}
function setTrain(msg, p) {
  trainStatus.textContent = msg;
  trainBar.style.width = Math.round((p || 0) * 100) + "%";
}
function setActiveSide(side) {
  activeSide = side;
  handLabel.textContent = sideLabel(side);
  handLabel.classList.add("on");
}

// ---------- 对比示范（偏差可视化） ----------
function drawReferenceOverlay(m, side) {
  if (!currentActionKey) return;
  const pose = buildReferencePose(currentActionKey, m.seg);
  const hip = m.points.hi;
  // 画布坐标（overlay 已 CSS 镜像，这里用原始坐标即可对齐）
  const cx = hip.x * overlay.width, cy = hip.y * overlay.height;
  drawReference(ctx, pose, cx, cy, overlay.width, "#37c2ff");
  ctx.save(); ctx.fillStyle = "#37c2ff"; ctx.font = "12px sans-serif";
  ctx.fillText("标准示范", cx - 30, cy - overlay.height * m.seg.torso - 8); ctx.restore();
}
function updateDeviation(m, key) {
  const dev = computeDeviation(m, key);
  refPanel.hidden = false;
  refMatch.textContent = dev.match + "%";
  refMatch.style.color = dev.match > 75 ? "#46e08a" : dev.match > 55 ? "#ffb02e" : "#ff5d5d";
  devList.innerHTML = "";
  dev.joints.forEach((j) => {
    const li = document.createElement("li");
    const c = Math.abs(j.delta) > 25 ? "bad" : Math.abs(j.delta) > 10 ? "warn" : "good";
    li.className = c;
    li.innerHTML = `<span>${j.name}</span><span>实际 ${j.actual}° / 理想 ${j.ideal}°</span><span>${j.delta > 0 ? "+" : ""}${j.delta}°</span>`;
    devList.appendChild(li);
  });
}

// ---------- 快照与导出 ----------
function makeSnapshot(includeRef) {
  const vw = video.videoWidth || VIDEO_W, vh = video.videoHeight || 360;
  const c = document.createElement("canvas"); c.width = vw; c.height = vh;
  const x = c.getContext("2d");
  x.save(); x.translate(vw, 0); x.scale(-1, 1); x.drawImage(video, 0, 0, vw, vh); x.restore();
  if (lastMeta && lastMeta.landmarks) {
    x.save(); x.translate(vw, 0); x.scale(-1, 1);
    const du = new DrawingUtils(x);
    du.drawConnectors(lastMeta.landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "#46e08a", lineWidth: 4 });
    du.drawLandmarks(lastMeta.landmarks, { color: "#ffb02e", radius: 4 });
    if (includeRef && lastMeta.actionKey && lastMeta.seg) {
      const pose = buildReferencePose(lastMeta.actionKey, lastMeta.seg);
      const hip = lastMeta.points.hi;
      drawReference(x, pose, hip.x * vw, hip.y * vh, vw, "#37c2ff");
    }
    x.restore();
  }
  return c.toDataURL("image/jpeg", 0.9);
}
async function doExportPDF() {
  if (!lastMeta) { alert("请先开始分析并捕捉到人体姿态。"); return; }
  const dev = showRef && currentActionKey ? computeDeviation(lastMeta.metrics, currentActionKey) : null;
  const tips = Array.from(elReport.querySelectorAll("li")).map((li) => ({ text: li.textContent, cls: li.className }));
  await exportPDF({
    snapshot: makeSnapshot(showRef),
    action: currentActionName, conf: currentConf,
    score: elScoreNum.textContent, scoreTag: elScoreTag.textContent,
    handLabel: handLabel.textContent,
    metrics: [
      { name: "肩抬高角", val: mShoulder.textContent }, { name: "肘伸展度", val: mElbow.textContent },
      { name: "膝弯曲度", val: mKnee.textContent }, { name: "躯干前倾", val: mTrunk.textContent },
      { name: "手腕高度", val: mWrist.textContent }, { name: "挥拍速度", val: mSpeed.textContent }
    ],
    deviation: dev, tips
  });
  setStatus("PDF 已导出", false, 2000);
}

// ---------- 输入控制 ----------
function showVideo() {
  placeholder.style.display = "none"; video.style.display = "block";
  overlay.width = VIDEO_W; overlay.height = Math.round((VIDEO_W * video.videoHeight) / video.videoWidth) || 360;
}
async function startCam() {
  if (!poseLandmarker) await initModel();
  stopAll();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_W, facingMode: "user" }, audio: false });
    video.srcObject = stream; await video.play(); showVideo();
    btnStop.hidden = false; btnCam.hidden = true; btnFile.hidden = true;
    running = true; lastVideoTime = -1; overlay.height = 360; rafId = requestAnimationFrame(loop);
  } catch (e) { alert("无法访问摄像头：" + e.message); }
}
function startFile(file) {
  if (!poseLandmarker) { initModel().then(() => beginFile(file)); return; }
  beginFile(file);
}
function beginFile(file) {
  stopAll();
  video.srcObject = null; video.src = URL.createObjectURL(file); video.loop = false;
  video.onloadedmetadata = () => { overlay.width = VIDEO_W; overlay.height = Math.round((VIDEO_W * video.videoHeight) / video.videoWidth) || 360; };
  video.play(); showVideo();
  btnStop.hidden = false; btnCam.hidden = true; btnFile.hidden = true;
  running = true; lastVideoTime = -1; rafId = requestAnimationFrame(loop);
}
function stopAll() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.pause();
  btnStop.hidden = true; btnCam.hidden = false; btnFile.hidden = false;
  handBuf = []; featBuf = []; angleBuf = []; prevWristRaw = null; activeSide = handOverride.value === "auto" ? null : handOverride.value;
  if (activeSide) setActiveSide(activeSide);
}

// ---------- 模型初始化（MediaPipe） ----------
async function initModel() {
  setStatus("正在加载姿态模型…", true);
  // 离线路径优先（Capacitor 原生包 / 离线构建），失败回退 CDN
  const wasmRoot = (window.Capacitor && window.Capacitor.isNativePlatform())
    ? "./wasm"
    : (location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "")
      ? "./wasm" : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
  const modelPath = (window.Capacitor && window.Capacitor.isNativePlatform())
    ? "./models/pose_landmarker_lite.task"
    : (location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "")
      ? "./models/pose_landmarker_lite.task"
      : "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
  const vision = await FilesetResolver.forVisionTasks(wasmRoot);
  // GPU delegate 在部分手机 WebView 不可用，自动回退 CPU
  const delegates = ["GPU", "CPU"];
  let lastErr;
  for (const delegate of delegates) {
    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: "VIDEO", numPoses: 1
      });
      lastErr = null; break;
    } catch (e) { lastErr = e; console.warn(`MediaPipe ${delegate} 失败，尝试下一 delegate`, e); }
  }
  if (lastErr) throw lastErr;
  drawingUtils = new DrawingUtils(ctx);
  setStatus("姿态模型就绪", false, 1500);
}

// ---------- 用户样本（增量训练） ----------
function loadUserSamples() {
  try { return JSON.parse(localStorage.getItem("smash-user-samples") || "[]"); }
  catch (e) { return []; }
}
function saveUserSamples() { localStorage.setItem("smash-user-samples", JSON.stringify(userSamples)); }

// ---------- 事件绑定 ----------
btnCam.addEventListener("click", startCam);
btnFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { if (e.target.files[0]) startFile(e.target.files[0]); });
btnStop.addEventListener("click", stopAll);

btnTrain.addEventListener("click", () => ensureModel().then(() => setTrain(classifier.ready ? "模型已就绪 ✓" : "训练完成", 1)));
btnCompare.addEventListener("click", () => {
  showRef = !showRef; btnCompare.classList.toggle("active", showRef);
  btnCompare.textContent = showRef ? "📊 关闭对比" : "📊 对比示范";
  if (!showRef) { refPanel.hidden = true; ctx.clearRect(0, 0, overlay.width, overlay.height); }
});
btnPdf.addEventListener("click", doExportPDF);
btnPng.addEventListener("click", () => { if (!lastMeta) return alert("请先开始分析。"); exportPNG(makeSnapshot(showRef), currentActionName); setStatus("PNG 已导出", false, 2000); });

handOverride.addEventListener("change", () => {
  if (handOverride.value === "auto") { activeSide = null; handLabel.textContent = "自动检测中…"; handLabel.classList.remove("on"); }
  else setActiveSide(handOverride.value);
});

btnCapture.addEventListener("click", () => {
  if (featBuf.length < 10) { alert("请先分析几秒，再记录这一拍。"); return; }
  const seq = bufferToSeq(featBuf, 30);
  userSamples.push({ seq, label: capAction.value });
  saveUserSamples();
  capCount.textContent = "已记录 " + userSamples.length + " 段";
});
btnRetrain.addEventListener("click", async () => {
  if (!userSamples.length) { alert("先用「记录这一拍」采集几段你的动作。"); return; }
  await ensureModel();
  setTrain("用你的数据微调中…", 0.1);
  await classifier.retrainWith(userSamples, (msg, p) => setTrain(msg, p));
  setTrain("模型已用你的数据更新 ✓", 1);
});

btnPack.addEventListener("click", () => packModal.classList.add("show"));
packClose.addEventListener("click", () => packModal.classList.remove("show"));
packModal.addEventListener("click", (e) => { if (e.target === packModal) packModal.classList.remove("show"); });

// 逐帧动画示范
const demo = new PoseDemo(demoCanvas, { onFrame: (p) => (demoPhase.textContent = p) });
btnDemo.addEventListener("click", () => {
  const playing = demo.toggle();
  btnDemo.textContent = playing ? "⏸ 暂停" : "▶ 播放";
});

// 动作要点速查
const GUIDE = [
  { name: "杀球 Smash", desc: "展肩引拍至头顶后上方，转体发力，击球点在身体前上方，手臂充分伸展下压。" },
  { name: "高远球 Clear", desc: "与杀球类似但弧度高远，击球点同样要高，靠转体+手腕闪动送到对方后场。" },
  { name: "吊球 Drop", desc: "动作伪装成高远，触球瞬间减力切击，使球过网即落，手腕控制落点。" },
  { name: "平抽 Net", desc: "重心降低，小臂快速平抽，肘部相对稳定，适合中前半场对抗。" },
  { name: "网前球 Net", desc: "手腕灵活轻巧，手指发力搓/勾/推，强调拍面角度与触球时机。" },
  { name: "防守挑球 Defense", desc: "低重心举拍于身前，来球下方由下向上挑，把被动球救回后场。" }
];
const guideGrid = $("guide-grid");
GUIDE.forEach((g) => {
  const d = document.createElement("div"); d.className = "guide-item";
  d.innerHTML = `<h3>${g.name}</h3><p>${g.desc}</p>`; guideGrid.appendChild(d);
});

// 启动：预加载
initModel().catch((e) => setStatus("姿态模型加载失败：" + e.message, false, 4000));
ensureModel().catch((e) => setTrain("模型加载失败：" + e.message, 0));
