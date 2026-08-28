// 轻量动作分类模型（LSTM 序列分类器）
// 输入：长度为 T 的关节角特征序列  ->  输出：6 类动作概率
// 训练数据：生物力学合理的"合成序列" + 用户标注的真实样本（增量训练）

// 在线：动态导入 tfjs ESM；离线打包后由 dist/vendor/tfjs.js (UMD) 注入全局 tf
let tf = globalThis.tf;
if (!tf || !tf.tensor3d) {
  try {
    const m = await import("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0");
    if (m && m.tensor3d) tf = m;
  } catch (e) { /* 离线环境由 UMD 全局提供 */ }
}
if (!tf && globalThis.tf) tf = globalThis.tf;

export const ACTIONS = [
  { key: "smash", name: "杀球" },
  { key: "clear", name: "高远球" },
  { key: "drop", name: "吊球" },
  { key: "net", name: "平抽/网前" },
  { key: "defense", name: "防守挑球" },
  { key: "ready", name: "准备/移动" }
];
export const NUM_CLASSES = ACTIONS.length;
export const T = 30;   // 时间步
export const F = 8;    // 特征数（与 app.js 中特征顺序一致）
export const FEATURES = [
  "shoulderFlex", "elbowAngle", "kneeAngle", "trunkLean",
  "wristNormY", "wristAboveHead", "wristVelX", "wristVelY"
];

const KEY2IDX = Object.fromEntries(ACTIONS.map((a, i) => [a.key, i]));

// ---------- 合成数据：每类动作的"典型"时间剖面 ----------
// 关键帧：(phase, [shoulderFlex, elbowAngle, kneeAngle, trunkLean, wristNormY])
// wristNormY 采用与 App 一致的原始归一化坐标差值（鼻尖 y - 手腕 y）
const PROFILE = {
  smash:   [[0,[70,70,150,5,-0.08]],[0.5,[170,172,110,25,0.45]],[1,[120,150,130,10,0.20]]],
  clear:   [[0,[65,75,150,5,-0.04]],[0.5,[150,170,120,15,0.35]],[1,[110,150,135,8,0.18]]],
  drop:    [[0,[70,90,145,5,0.00]],[0.5,[140,120,130,10,0.20]],[1,[110,110,135,6,0.12]]],
  net:     [[0,[60,100,120,5,0.05]],[0.5,[75,95,110,8,0.00]],[1,[70,100,115,6,0.05]]],
  defense: [[0,[55,110,105,3,-0.30]],[0.5,[60,100,100,5,-0.40]],[1,[70,110,110,4,-0.25]]],
  ready:   [[0,[80,110,120,5,0.10]],[0.5,[85,112,122,6,0.12]],[1,[80,110,120,5,0.10]]]
};

function lerp(a, b, t) { return a + (b - a) * t; }
function gauss(std) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std;
}
function profileAt(key, p) {
  const kf = PROFILE[key];
  p = Math.max(0, Math.min(1, p));
  let i = 0;
  while (i < kf.length - 1 && p > kf[i + 1][0]) i++;
  const [p0, v0] = kf[i];
  const [p1, v1] = kf[Math.min(i + 1, kf.length - 1)];
  const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
  return v0.map((x, j) => lerp(x, v1[j], t));
}

function genSequence(key) {
  const xs = [];
  const phaseShift = gauss(0.06);
  let prevWY = null;
  for (let i = 0; i < T; i++) {
    const p = Math.max(0, Math.min(1, i / (T - 1) + phaseShift));
    const base = profileAt(key, p);
    const noise = [6, 6, 6, 3, 0.04, 0, 0, 0]; // 各特征噪声水平
    const f = base.map((x, j) => x + gauss(noise[j] || 0));
    f[5] = f[4] > 0 ? 1 : 0; // wristAboveHead
    // 速度由 wristNormY 的变化近似 + 噪声
    const wy = f[4];
    let vx = 0, vy = 0;
    if (prevWY !== null) {
      vy = (wy - prevWY) * 8 + gauss(0.4);
      vx = gauss(0.5);
    }
    prevWY = wy;
    f[6] = vx; f[7] = vy;
    xs.push(f);
  }
  return xs;
}

export function genSynthetic(nPerClass = 120) {
  const xs = [], ys = [];
  for (const a of ACTIONS) {
    for (let i = 0; i < nPerClass; i++) {
      xs.push(genSequence(a.key));
      const onehot = new Array(NUM_CLASSES).fill(0);
      onehot[KEY2IDX[a.key]] = 1;
      ys.push(onehot);
    }
  }
  return { xs, ys };
}

// ---------- 归一化 ----------
function computeStats(xs) {
  const mean = new Array(F).fill(0), std = new Array(F).fill(0);
  for (let j = 0; j < F; j++) {
    let s = 0;
    for (const seq of xs) for (const f of seq) s += f[j];
    mean[j] = s / (xs.length * T);
    let v = 0;
    for (const seq of xs) for (const f of seq) v += (f[j] - mean[j]) ** 2;
    std[j] = Math.sqrt(v / (xs.length * T)) || 1e-6;
  }
  return { mean, std };
}
function normalize(seq, stats) {
  return seq.map((f) => f.map((x, j) => (x - stats.mean[j]) / stats.std[j]));
}

// ---------- 模型 ----------
function buildModel() {
  const m = tf.sequential();
  m.add(tf.layers.lstm({ units: 32, inputShape: [T, F], returnSequences: false }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 24, activation: "relu" }));
  m.add(tf.layers.dense({ units: NUM_CLASSES, activation: "softmax" }));
  m.compile({ optimizer: "adam", loss: "categoricalCrossentropy", metrics: ["accuracy"] });
  return m;
}

export class ActionClassifier {
  constructor() {
    this.model = null;
    this.stats = null;
    this.ready = false;
    this.trained = false;
  }

  async loadOrTrain(onProgress) {
    // 尝试从 IndexedDB 恢复
    try {
      this.model = await tf.loadLayersModel("indexeddb://smash-clf");
      const raw = localStorage.getItem("smash-clf-stats");
      if (raw) this.stats = JSON.parse(raw);
      if (this.model && this.stats) {
        this.ready = true; this.trained = true;
        onProgress && onProgress("已加载本地模型", 1);
        return;
      }
    } catch (e) { /* 无已存模型，重新训练 */ }

    onProgress && onProgress("生成训练数据…", 0.05);
    const { xs, ys } = genSynthetic(120);
    this.stats = computeStats(xs);
    const X = tf.tensor3d(xs.map((s) => normalize(s, this.stats)));
    const Y = tf.tensor2d(ys);

    onProgress && onProgress("构建模型并训练中…", 0.1);
    this.model = buildModel();
    await this.model.fit(X, Y, {
      epochs: 25, batchSize: 32, validationSplit: 0.15,
      callbacks: {
        onEpochEnd: (ep, logs) => {
          const p = 0.1 + (ep + 1) / 25 * 0.85;
          onProgress && onProgress(`训练中 ${ep + 1}/25  (acc=${(logs.acc * 100).toFixed(1)}%)`, p);
        }
      }
    });
    X.dispose(); Y.dispose();
    await this.persist();
    this.ready = true; this.trained = true;
    onProgress && onProgress("模型就绪 ✓", 1);
  }

  async persist() {
    try {
      await this.model.save("indexeddb://smash-clf");
      localStorage.setItem("smash-clf-stats", JSON.stringify(this.stats));
    } catch (e) { console.warn("保存模型失败", e); }
  }

  // 用用户标注样本增量训练
  async retrainWith(userSamples, onProgress) {
    if (!this.model) return;
    const { xs, ys } = genSynthetic(60); // 基础数据
    for (const s of userSamples) {
      xs.push(s.seq);
      const oh = new Array(NUM_CLASSES).fill(0);
      oh[KEY2IDX[s.label]] = 1; ys.push(oh);
    }
    this.stats = computeStats(xs);
    const X = tf.tensor3d(xs.map((s) => normalize(s, this.stats)));
    const Y = tf.tensor2d(ys);
    await this.model.fit(X, Y, {
      epochs: 12, batchSize: 16, validationSplit: 0.1,
      callbacks: { onEpochEnd: (e, l) => onProgress && onProgress(`微调中 ${e + 1}/12`, (e + 1) / 12) }
    });
    X.dispose(); Y.dispose();
    await this.persist();
    onProgress && onProgress("模型已更新 ✓", 1);
  }

  // 输入：长度≈T 的特征序列（未归一化）；输出 {name, key, conf, probs}
  predict(seqRaw) {
    if (!this.ready || !this.model) return null;
    const seq = resample(seqRaw, T);
    const norm = normalize(seq, this.stats);
    const t = tf.tensor3d([norm]);
    const out = this.model.predict(t);
    const probs = Array.from(out.dataSync());
    t.dispose(); out.dispose();
    let idx = 0;
    probs.forEach((p, i) => { if (p > probs[idx]) idx = i; });
    return { key: ACTIONS[idx].key, name: ACTIONS[idx].name, conf: Math.round(probs[idx] * 100), probs };
  }
}

// 把任意长度序列重采样到 T 步
function resample(seq, T) {
  if (seq.length === T) return seq;
  const out = [];
  for (let i = 0; i < T; i++) {
    const pos = (i / (T - 1)) * (seq.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    const t = pos - lo;
    if (seq[lo] && seq[hi]) out.push(seq[lo].map((x, j) => lerp(x, seq[hi][j], t)));
    else out.push(seq[Math.min(lo, seq.length - 1)]);
  }
  return out;
}

// 从 app 的实时 buffer（每帧特征）抽取最近 T 帧
export function bufferToSeq(buf, T = 30) {
  const recent = buf.slice(-Math.max(T, buf.length));
  return recent.map((f) => FEATURES.map((k) => f[k] ?? 0));
}
