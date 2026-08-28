// 左右手自适应：通过分析双手腕运动幅度自动判断持拍手
// 持拍手在挥拍时位移幅度明显更大；返回图像坐标系下的侧别 'L' / 'R'
// 这样彻底移除"固定右手=图像右侧"的镜像假设

export function detectRacketHand(frames) {
  if (!frames || frames.length < 4) return null;
  let lLen = 0, rLen = 0, lN = 0, rN = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (a.lw && b.lw) { lLen += Math.hypot(b.lw.x - a.lw.x, b.lw.y - a.lw.y); lN++; }
    if (a.rw && b.rw) { rLen += Math.hypot(b.rw.x - a.rw.x, b.rw.y - a.rw.y); rN++; }
  }
  if (lN < 3 && rN < 3) return null;
  // 若两侧都几乎不动（静态），默认右手（图像右侧）
  if (lLen < 1e-3 && rLen < 1e-3) return "R";
  return lLen >= rLen ? "L" : "R";
}

export const SIDE_LM = {
  L: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  R: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
};

// 给定侧别，返回该侧关键点索引
export function sideIndices(side) { return SIDE_LM[side] || SIDE_LM.R; }

// 中文标签
export function sideLabel(side) {
  return side === "L" ? "左手持拍" : "右手持拍";
}
