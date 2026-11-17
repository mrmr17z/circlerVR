// شهادة إتمام المختبر الافتراضي — تُرسم على canvas (للعرض داخل المشهد وللتنزيل صورةً)
import { FONT } from './ui.js';
import { BRAND, drawLogo, drawLogoIcon } from './brand.js';

const fmtDate = d => d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

// data: { name, pass, comp, perf, test, date }
export function drawCertificate(c, W, H, data) {
  const s = W / 1600;
  c.save(); c.direction = 'rtl'; c.textBaseline = 'alphabetic';
  // الخلفية والإطار
  const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#fffdf6'); bg.addColorStop(1, '#f4ecd8');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#1f4e79'; c.lineWidth = 18 * s; c.strokeRect(24 * s, 24 * s, W - 48 * s, H - 48 * s);
  c.strokeStyle = '#c9a227'; c.lineWidth = 5 * s; c.strokeRect(54 * s, 54 * s, W - 108 * s, H - 108 * s);
  // زخرفة الزوايا
  c.fillStyle = '#c9a227';
  for (const [x, y] of [[54, 54], [W / s - 54, 54], [54, H / s - 54], [W / s - 54, H / s - 54]]) { c.beginPath(); c.arc(x * s, y * s, 14 * s, 0, Math.PI * 2); c.fill(); }

  // الشعار
  drawLogo(c, W / 2, 175 * s, 420 * s, 170 * s);

  const center = (t, y, size, color, bold = false) => {
    c.fillStyle = color; c.textAlign = 'center'; c.font = `${bold ? 'bold ' : ''}${size * s}px ${FONT}`;
    let fs = size; while (c.measureText(t).width > W - 260 * s && fs > 14) { fs -= 2; c.font = `${bold ? 'bold ' : ''}${fs * s}px ${FONT}`; }
    c.fillText(t, W / 2, y * s);
  };
  // سطر مختلط: أجزاء عربية وأرقام تُرسم كلٌّ باتجاهه من اليمين إلى اليسار (لا يعتمد على خوارزمية الاتجاه في المتصفح)
  const mixed = (parts, y, size, color, bold = false) => {
    c.fillStyle = color; c.font = `${bold ? 'bold ' : ''}${size * s}px ${FONT}`; c.textAlign = 'left';
    const ws = parts.map(p => c.measureText(p.t).width), tot = ws.reduce((a, b) => a + b, 0);
    let x = W / 2 + tot / 2;
    parts.forEach((p, i) => {
      x -= ws[i];
      if (p.ltr) { let xx = x; for (const ch of p.t) { c.fillText(ch, xx, y * s); xx += c.measureText(ch).width; } }   // الأرقام والنسبة حرفاً حرفاً من اليسار
      else c.fillText(p.t, x, y * s);
    });
  };
  center('شهادة إتمام', 345, 86, '#1f4e79', true);
  center('تشهد ' + BRAND.name + ' بأنّ', 425, 38, '#4a5560');
  center(data.name || 'الطالب/ـة', 515, 72, '#8a6a12', true);
  c.strokeStyle = '#c9a227'; c.lineWidth = 3 * s; c.beginPath(); c.moveTo(W / 2 - 360 * s, 545 * s); c.lineTo(W / 2 + 360 * s, 545 * s); c.stroke();
  center('قد أتمّ تجربة المختبر الافتراضي', 610, 40, '#333d47');
  center('«الحركة الدائرية» — الفيزياء 1 · الفصل 6 · الحركة في بعدين', 670, 42, '#1f4e79', true);
  if (data.pass) mixed([{ t: 'وحقّق شروط النجاح بتقدير مركّب ' }, { t: data.comp, ltr: true }], 740, 38, '#2e7d4f', true); else center('وأنهى جميع مراحل التجربة', 740, 38, '#333d47');
  if (data.perf) mixed([{ t: 'الأداء العملي ' }, { t: data.perf, ltr: true }, { t: '  ·  الاختبار ' }, { t: data.test, ltr: true }], 795, 30, '#6b7680');

  // التاريخ والختم
  c.textAlign = 'center'; c.fillStyle = '#4a5560'; c.font = `${30 * s}px ${FONT}`;
  c.fillText('التاريخ', 1260 * s, 920 * s); c.font = `bold ${32 * s}px ${FONT}`; c.fillText(fmtDate(data.date || new Date()), 1260 * s, 965 * s);
  c.strokeStyle = '#9aa3ab'; c.lineWidth = 2 * s; c.beginPath(); c.moveTo(1110 * s, 985 * s); c.lineTo(1410 * s, 985 * s); c.stroke();
  c.font = `${30 * s}px ${FONT}`; c.fillStyle = '#4a5560'; c.fillText('الجهة المانحة', 340 * s, 920 * s);
  c.font = `bold ${32 * s}px ${FONT}`; c.fillText(BRAND.name, 340 * s, 965 * s);
  c.beginPath(); c.moveTo(190 * s, 985 * s); c.lineTo(490 * s, 985 * s); c.stroke();
  // ختم دائري
  c.strokeStyle = '#c9a227'; c.lineWidth = 6 * s; c.beginPath(); c.arc(W / 2, 935 * s, 78 * s, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 2 * s; c.beginPath(); c.arc(W / 2, 935 * s, 64 * s, 0, Math.PI * 2); c.stroke();
  drawLogoIcon(c, W / 2, 935 * s, 112 * s, '#c9a227');
  c.restore();
}

// نسخة كاملة الدقة للتنزيل
export function certificateCanvas(data) {
  const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1131;
  drawCertificate(cv.getContext('2d'), cv.width, cv.height, data); return cv;
}
