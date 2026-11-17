// الهوية: اسم الجهة وشعارها
// ملف الشعار: assets/brand/logo.png (يُضمَّن تلقائياً في ملف HTML الواحد عند البناء).
// إن لم يوجد الملف يظهر اسم الجهة نصاً مكان الشعار.
import { FONT } from './ui.js';

export const BRAND = {
  name: 'الأمد', logo: 'assets/brand/logo.png',
  bg: '#131c31',                         // لون خلفية الشعار (كحلي)
  icon: { x: 145, y: 11, w: 64, h: 64 }, // موضع الأيقونة الدائرية داخل ملف الشعار (237×88)
};

let img = null;
export const logoReady = new Promise(res => {
  const i = new Image();
  i.onload = () => { img = i; res(i); };
  i.onerror = () => res(null);
  i.src = BRAND.logo;
});
export const logoImage = () => img;

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// يرسم الشعار كاملاً داخل مستطيل (cx,cy مركزه) مع الحفاظ على نسبه، على بطاقة كحلية بزوايا مستديرة؛ وإلا يكتب الاسم
export function drawLogo(c, cx, cy, w, h, color = '#1f4e79') {
  c.save();
  if (img) {
    const k = Math.min(w / img.width, h / img.height), dw = img.width * k, dh = img.height * k;
    roundRect(c, cx - dw / 2, cy - dh / 2, dw, dh, dh * 0.18); c.fillStyle = BRAND.bg; c.fill(); c.clip();
    c.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.direction = 'rtl';
    let fs = h * 0.62; c.font = `bold ${fs}px ${FONT}`;
    while (c.measureText(BRAND.name).width > w && fs > 8) { fs -= 2; c.font = `bold ${fs}px ${FONT}`; }
    c.fillText(BRAND.name, cx, cy);
  }
  c.restore();
}

// الأيقونة الدائرية وحدها (للختم)
export function drawLogoIcon(c, cx, cy, size, color) {
  if (!img) return drawLogo(c, cx, cy, size, size * 0.6, color);
  const I = BRAND.icon;
  c.save(); c.beginPath(); c.arc(cx, cy, size / 2, 0, Math.PI * 2); c.fillStyle = BRAND.bg; c.fill(); c.clip();
  c.drawImage(img, I.x, I.y, I.w, I.h, cx - size / 2, cy - size / 2, size, size);
  c.restore();
}
