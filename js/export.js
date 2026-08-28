// 诊断报告导出：PDF（jsPDF）+ PNG（画面截图）
// app 负责合成"画面+骨骼+参考骨骼"的快照 dataURL，本模块负责排版与下载。

let jsPDFRef = null;
async function getJsPDF() {
  if (jsPDFRef) return jsPDFRef;
  const g = globalThis.jspdf && globalThis.jspdf.jsPDF;
  if (g) { jsPDFRef = g; return g; }
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    jsPDFRef = mod.jsPDF || mod.default;
    if (jsPDFRef) return jsPDFRef;
  } catch (e) { /* 离线由 UMD 全局提供 */ }
  jsPDFRef = (globalThis.jspdf && globalThis.jspdf.jsPDF) || null;
  return jsPDFRef;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// data: { snapshot, action, conf, score, scoreTag, handLabel, metrics:[{name,val}],
//         deviation:{match, joints:[{name,actual,ideal,delta}]}|null, tips:[{text,cls}] }
export async function exportPDF(data) {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  doc.setFillColor(22, 27, 35); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(70, 224, 138); doc.setFontSize(20); doc.setFont(undefined, "bold");
  doc.text("AI 羽毛球动作诊断报告", M, 34);
  doc.setTextColor(180, 190, 200); doc.setFontSize(10); doc.setFont(undefined, "normal");
  doc.text("SmashLab · " + new Date().toLocaleString("zh-CN"), M, 52);

  y = 90;
  doc.setTextColor(20, 20, 20); doc.setFontSize(13); doc.setFont(undefined, "bold");
  doc.text(`识别动作：${data.action}　置信度 ${data.conf}%`, M, y);
  y += 20;
  doc.text(`动作评分：${data.score} / 100（${data.scoreTag}）　${data.handLabel || ""}`, M, y);
  y += 14;

  if (data.snapshot) {
    try {
      const imgW = W - M * 2, imgH = imgW * 0.5625;
      doc.addImage(data.snapshot, "JPEG", M, y, imgW, imgH);
      y += imgH + 18;
    } catch (e) { /* 忽略图片错误 */ }
  }

  // 指标表
  doc.setFontSize(12); doc.setFont(undefined, "bold"); doc.setTextColor(20, 20, 20);
  doc.text("实时关节数据", M, y); y += 8;
  doc.setDrawColor(200); doc.setLineWidth(0.5);
  const colW = (W - M * 2) / 3;
  data.metrics.forEach((m, i) => {
    const cx = M + (i % 3) * colW;
    const cy = y + Math.floor(i / 3) * 18 + 12;
    doc.setFontSize(9); doc.setTextColor(120, 120, 120); doc.setFont(undefined, "normal");
    doc.text(m.name, cx, cy - 4);
    doc.setFontSize(12); doc.setTextColor(20, 20, 20); doc.setFont(undefined, "bold");
    doc.text(String(m.val), cx, cy + 8);
  });
  y += Math.ceil(data.metrics.length / 3) * 18 + 20;

  // 偏差表
  if (data.deviation) {
    doc.setFontSize(12); doc.setFont(undefined, "bold"); doc.setTextColor(20, 20, 20);
    doc.text(`标准动作吻合度：${data.deviation.match}%`, M, y); y += 16;
    doc.setFontSize(9);
    const hx = M, hx2 = M + 120, hx3 = M + 200, hx4 = M + 280;
    doc.setTextColor(120, 120, 120);
    doc.text("关节", hx, y); doc.text("实际", hx2, y); doc.text("理想", hx3, y); doc.text("偏差", hx4, y);
    y += 6; doc.line(M, y, W - M, y); y += 12;
    data.deviation.joints.forEach((j) => {
      const dColor = Math.abs(j.delta) > 25 ? [200, 50, 50] : Math.abs(j.delta) > 10 ? [210, 150, 30] : [40, 160, 80];
      doc.setTextColor(40, 40, 40); doc.text(j.name, hx, y);
      doc.text(j.actual + "°", hx2, y);
      doc.text(j.ideal + "°", hx3, y);
      doc.setTextColor(dColor[0], dColor[1], dColor[2]); doc.text((j.delta > 0 ? "+" : "") + j.delta + "°", hx4, y);
      y += 16;
    });
    y += 10;
  }

  // 建议
  doc.setFontSize(12); doc.setFont(undefined, "bold"); doc.setTextColor(20, 20, 20);
  doc.text("AI 改进建议", M, y); y += 16;
  doc.setFontSize(10); doc.setFont(undefined, "normal");
  (data.tips || []).forEach((t) => {
    const lines = doc.splitTextToSize("• " + t.text, W - M * 2 - 10);
    doc.setTextColor(t.cls === "bad" ? 200 : t.cls === "warn" ? 170 : 40, t.cls === "bad" ? 50 : t.cls === "warn" ? 120 : 150, t.cls === "bad" ? 50 : t.cls === "warn" ? 30 : 80);
    doc.text(lines, M + 4, y); y += lines.length * 13 + 2;
  });

  const fname = `羽毛球诊断报告_${data.action}_${Date.now()}.pdf`;
  const blob = doc.output("blob");
  download(blob, fname);
  return fname;
}

export function exportPNG(dataUrl, action) {
  download(dataUrlToBlob(dataUrl), `羽毛球动作_${action}_${Date.now()}.png`);
}
function dataUrlToBlob(u) {
  const arr = u.split(","), mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]), n = bstr.length, u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}
