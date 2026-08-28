// 标准示范对比与偏差可视化
// 为每类动作定义"理想关节角"（击球关键帧），用用户自身肢体比例
// 通过二维前向运动学生成参考骨骼，叠加显示并计算逐关节偏差、吻合度。

// 理想关节角（度）：肩抬高角 / 肘伸展 / 膝弯曲 / 躯干前倾
export const IDEAL_ANGLES = {
  smash:   { shoulderFlex: 165, elbowAngle: 172, kneeAngle: 115, trunkLean: 22 },
  clear:   { shoulderFlex: 150, elbowAngle: 170, kneeAngle: 120, trunkLean: 15 },
  drop:    { shoulderFlex: 140, elbowAngle: 120, kneeAngle: 130, trunkLean: 10 },
  net:     { shoulderFlex: 75,  elbowAngle: 95,  kneeAngle: 110, trunkLean: 8  },
  defense: { shoulderFlex: 60,  elbowAngle: 100, kneeAngle: 100, trunkLean: 5  },
  ready:   { shoulderFlex: 85,  elbowAngle: 110, kneeAngle: 120, trunkLean: 5  }
};

// 逐帧动画示范用的"时间轴剖面"：每类动作 [引拍, 击球, 随挥] 三关键帧
// 每帧 = [shoulderFlex, elbowAngle, kneeAngle, trunkLean]
export const DEMO_PROFILE = {
  smash:   { phases: [["引拍",[70,70,150,5]],   ["击球",[170,172,110,25]], ["随挥",[120,150,135,10]]] },
  clear:   { phases: [["引拍",[65,75,150,5]],   ["击球",[150,170,120,15]], ["随挥",[110,150,135,8]]] },
  drop:    { phases: [["引拍",[70,90,145,5]],   ["击球",[140,120,130,10]], ["随挥",[110,110,135,6]]] },
  net:     { phases: [["举拍",[60,100,120,5]],  ["触球",[75,95,110,8]],    ["收拍",[70,100,115,6]]] },
  defense: { phases: [["举拍",[55,110,105,3]],  ["挑球",[60,100,100,5]],   ["回位",[70,110,110,4]]] },
  ready:   { phases: [["分腿",[80,110,120,5]],  ["垫步",[85,112,122,6]],  ["预备",[80,110,120,5]]] }
};

export const JOINT_NAMES = {
  shoulderFlex: "肩抬高角",
  elbowAngle: "肘伸展度",
  kneeAngle: "膝弯曲度",
  trunkLean: "躯干前倾"
};

// 计算逐关节偏差与吻合度
// actual: {shoulderFlex, elbowAngle, kneeAngle, trunkLean}
export function computeDeviation(actual, actionKey) {
  const ideal = IDEAL_ANGLES[actionKey] || IDEAL_ANGLES.ready;
  const keys = ["shoulderFlex", "elbowAngle", "kneeAngle", "trunkLean"];
  let sum = 0, n = 0;
  const joints = keys.map((k) => {
    const a = actual[k] ?? 0, b = ideal[k];
    const delta = a - b;
    sum += Math.abs(delta); n++;
    return { key: k, name: JOINT_NAMES[k], actual: Math.round(a), ideal: b, delta: Math.round(delta) };
  });
  const meanAbs = sum / n;
  const match = Math.max(0, Math.round(100 - (meanAbs / 40) * 100));
  return { joints, match, meanAbs: Math.round(meanAbs) };
}

// ---------- 二维前向运动学生成参考骨骼（y 向上，原点在髋） ----------
function rot(v, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
function norm(v) { const m = Math.hypot(v.x, v.y) || 1e-6; return { x: v.x / m, y: v.y / m }; }

// seg: {torso, upper, fore, thigh, shank}（归一化长度）
// anglesOverride: 可选，提供 {shoulderFlex, elbowAngle, kneeAngle, trunkLean} 覆盖默认理想角（供逐帧动画使用）
export function buildReferencePose(actionKey, seg, anglesOverride) {
  const A = anglesOverride || IDEAL_ANGLES[actionKey] || IDEAL_ANGLES.ready;
  const s = seg || { torso: 0.25, upper: 0.18, fore: 0.16, thigh: 0.25, shank: 0.25 };
  const hip = { x: 0, y: 0 };
  // 躯干：从髋向上、前倾 trunkLean（前=+x）
  const shoulder = { x: Math.sin((A.trunkLean * Math.PI) / 180) * s.torso, y: Math.cos((A.trunkLean * Math.PI) / 180) * s.torso };
  // 大臂：肩抬高角 = 肩-髋 与 肩-肘 的夹角（180=竖直向上）
  const downVec = norm({ x: hip.x - shoulder.x, y: hip.y - shoulder.y });
  const elbowDir = rot(downVec, A.shoulderFlex);
  const elbow = { x: shoulder.x + elbowDir.x * s.upper, y: shoulder.y + elbowDir.y * s.upper };
  // 前臂：肘伸展（180=伸直）；前臂相对大臂继续前伸
  const upperDir = norm({ x: elbow.x - shoulder.x, y: elbow.y - shoulder.y });
  const foreDir = rot(upperDir, -(180 - A.elbowAngle));
  const wrist = { x: elbow.x + foreDir.x * s.fore, y: elbow.y + foreDir.y * s.fore };
  // 下肢：大腿从髋向下前倾，膝弯曲决定小腿方向
  const thighDir = norm({ x: Math.sin(0.2) * 0.3, y: -1 }); // 略前
  const knee = { x: hip.x + thighDir.x * s.thigh, y: hip.y + thighDir.y * s.thigh };
  const shankDir = rot(norm({ x: knee.x - hip.x, y: knee.y - hip.y }), A.kneeAngle - 180 + 25);
  const ankle = { x: knee.x + shankDir.x * s.shank, y: knee.y + shankDir.y * s.shank };
  return { hip, shoulder, elbow, wrist, knee, ankle };
}

// 把参考骨骼画到 canvas（cx,cy 为髋在画布上的像素位置，scale 像素/单位）
export function drawReference(ctx, pose, cx, cy, scale, color = "#37c2ff") {
  const P = (p) => ({ x: cx + p.x * scale, y: cy - p.y * scale }); // y 向上翻转
  const segs = [
    [pose.hip, pose.shoulder], [pose.shoulder, pose.elbow],
    [pose.elbow, pose.wrist], [pose.hip, pose.knee], [pose.knee, pose.ankle]
  ];
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.9;
  for (const [a, b] of segs) {
    const pa = P(a), pb = P(b);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const k of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"]) {
    const p = P(pose[k]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }
  ctx.restore();
}
