// 标准动作"逐帧动画示范"：把某类动作的引拍→击球→随挥时间轴，
// 用你自身肢体比例生成一段连续运动的参考骨骼（像教练慢动作演示）。
import { DEMO_PROFILE, buildReferencePose, drawReference } from "./compare.js";

const FRAMES_PER_SEG = 26; // 每段过渡帧数

export class PoseDemo {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.action = "smash";
    this.seg = { torso: 0.25, upper: 0.18, fore: 0.16, thigh: 0.25, shank: 0.25 };
    this.playing = true;
    this.t = 0; // 全局帧计数
    this.phaseLabel = "";
    this.onFrame = opts.onFrame || null;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setAction(key) { if (DEMO_PROFILE[key]) this.action = key; }
  setSeg(seg) { if (seg && seg.torso) this.seg = seg; }
  toggle() { this.playing = !this.playing; return this.playing; }

  // 根据全局进度计算当前帧的理想角度与阶段名
  _sample() {
    const prof = DEMO_PROFILE[this.action] || DEMO_PROFILE.smash;
    const segs = prof.phases.length - 1;
    const total = segs * FRAMES_PER_SEG;
    const p = this.t % total;
    const segIdx = Math.min(segs - 1, Math.floor(p / FRAMES_PER_SEG));
    const local = (p - segIdx * FRAMES_PER_SEG) / FRAMES_PER_SEG; // 0..1
    const [n0, a0] = prof.phases[segIdx];
    const [n1, a1] = prof.phases[segIdx + 1];
    const ang = a0.map((v, i) => v + (a1[i] - v) * local);
    // 阶段名：过渡前半显示起点阶段
    this.phaseLabel = local < 0.5 ? n0 : n1;
    return { shoulderFlex: ang[0], elbowAngle: ang[1], kneeAngle: ang[2], trunkLean: ang[3] };
  }

  _loop() {
    const w = this.canvas.width, h = this.canvas.height;
    const x = this.ctx;
    x.clearRect(0, 0, w, h);
    // 背景地面
    x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, h * 0.86); x.lineTo(w, h * 0.86); x.stroke();

    const ang = this._sample();
    const pose = buildReferencePose(this.action, this.seg, ang);
    const cx = w * 0.5, cy = h * 0.84, scale = w * 0.82;
    drawReference(x, pose, cx, cy, scale, "#37c2ff");

    // 阶段标签
    x.fillStyle = "#37c2ff"; x.font = "bold 13px sans-serif"; x.textAlign = "center";
    x.fillText(this.phaseLabel, w / 2, 18);
    x.fillStyle = "rgba(232,237,244,.6)"; x.font = "11px sans-serif";
    x.fillText("标准动作示范", w / 2, h - 8);
    x.textAlign = "left";

    if (this.playing) this.t++;
    if (this.onFrame) this.onFrame(this.phaseLabel);
    requestAnimationFrame(this._loop);
  }
}
