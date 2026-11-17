import * as THREE from 'three';

// لوحات ثلاثية الأبعاد تُرسم بـ Canvas (تدعم العربية من اليمين لليسار والحروف المتصلة)
export const FONT = '"Segoe UI", Tahoma, "Noto Kufi Arabic", "Noto Sans Arabic", Arial, sans-serif';
export const COLORS = {
  bg: 'rgba(24,32,40,0.94)', panel2: '#2c3844', text: '#eef3f7', dim: '#9fb0bf', accent: '#ffcf4a',
  btn: '#34495c', btnHover: '#4b6a86', ok: '#2f9e6e', bad: '#c0504d', sel: '#3d79b8', vel: '#3aa0ff', force: '#ff6a3d'
};

// يعزل المقاطع اللاتينية والرياضية داخل السطر العربي كي لا ينقلب ترتيبها
export function bidi(line) {
  const LRI = '⁦', PDI = '⁩';
  if (!line || line.includes(LRI)) return line;
  if (line.includes('\n')) return line.split('\n').map(bidi).join('\n');
  return line.replace(/[A-Za-z0-9(π][A-Za-z0-9π .,=±÷×²√()\/+%·^_\-]*[A-Za-z0-9)²%]|[A-Za-z0-9]/g, m => LRI + m + PDI);
}
export function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    // لا نكسر السطر داخل مقطع معزول (معادلة)
    const words = []; let cur = '', depth = 0;
    for (const ch of para) {
      if (ch === '⁦') depth++; else if (ch === '⁩') depth = Math.max(0, depth - 1);
      if (ch === ' ' && depth === 0) { words.push(cur); cur = ''; } else cur += ch;
    }
    words.push(cur);
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export class Panel {
  // textScale: يكبّر الخطوط والعناصر نسبةً لعرض اللوحة (للوحات التي تُقرأ من بعيد مثل شاشة العرض)
  constructor({ w = 1, h = 0.6, ppm = 800, closable = false, name = '', textScale = 1 } = {}) {
    this.textScale = textScale;
    this.w = w; this.h = h; this.name = name;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * ppm); this.canvas.height = Math.round(h * ppm);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: true, toneMapped: false }));
    this.mesh.userData.panel = this; this.mesh.renderOrder = 2;
    this.buttons = []; this.hoverId = null; this.onClick = null; this.closable = closable; this.minimized = false;
    this.content = {}; this.customDraw = null;
  }
  get object() { return this.mesh; }
  set(content) { this.content = content; this.minimized = false; this.redraw(); return this; }
  show(v = true) { this.mesh.visible = v; }
  redraw() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, s = W / 1000 * this.textScale;
    c.clearRect(0, 0, W, H); c.direction = 'rtl'; this.buttons = [];
    if (this.minimized) {
      round(c, W - 260 * s, 0, 260 * s, 70 * s, 14 * s, COLORS.bg);
      c.fillStyle = COLORS.accent; c.font = `bold ${30 * s}px ${FONT}`; c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillText('▢ إظهار ' + (this.name || ''), W - 20 * s, 35 * s);
      this.buttons.push({ id: '__restore', x: W - 260 * s, y: 0, w: 260 * s, h: 70 * s });
      this.tex.needsUpdate = true; return;
    }
    const ct = this.content;
    round(c, 0, 0, W, H, 22 * s, ct.bg || COLORS.bg);
    if (ct.border) { c.lineWidth = 6 * s; c.strokeStyle = ct.border; strokeRound(c, 3 * s, 3 * s, W - 6 * s, H - 6 * s, 20 * s); }
    let y = 26 * s; const pad = 34 * s;
    c.textAlign = 'right'; c.textBaseline = 'top';
    if (ct.tag) { c.font = `bold ${24 * s}px ${FONT}`; c.fillStyle = COLORS.accent; c.fillText(ct.tag, W - pad, y); y += 38 * s; }
    if (ct.title) {
      c.font = `bold ${(ct.titleSize || 40) * s}px ${FONT}`; c.fillStyle = COLORS.text;
      for (const l of wrap(c, bidi(ct.title), W - 2 * pad - (this.closable ? 70 * s : 0))) { c.fillText(l, W - pad, y); y += (ct.titleSize || 40) * 1.3 * s; }
      y += 8 * s;
    }
    if (ct.body) {
      const fs = (ct.bodySize || 31) * s; c.font = `${fs}px ${FONT}`; c.fillStyle = ct.bodyColor || '#d6e0e8';
      for (const l of wrap(c, bidi(ct.body), W - 2 * pad)) { c.fillText(l, W - pad, y); y += fs * 1.45; }
      y += 10 * s;
    }
    if (this.customDraw) y = this.customDraw(c, W, H, s, y, pad) ?? y;
    if (ct.buttons && ct.buttons.length) {
      const cols = ct.cols || 1, gap = 14 * s, bh = (ct.btnH || 74) * s;
      const rows = Math.ceil(ct.buttons.length / cols);
      let by = ct.btnTop ? y : H - pad - rows * bh - (rows - 1) * gap - (ct.footer ? 44 * s : 0);
      by = Math.max(by, y);
      const bw = (W - 2 * pad - (cols - 1) * gap) / cols;
      ct.buttons.forEach((b, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = W - pad - (col + 1) * bw - col * gap, yy = by + row * (bh + gap);
        let fill = b.color || COLORS.btn;
        if (b.state === 'ok') fill = COLORS.ok; else if (b.state === 'bad') fill = COLORS.bad; else if (b.state === 'sel') fill = COLORS.sel;
        if (this.hoverId === b.id && !b.disabled) fill = b.state ? fill : COLORS.btnHover;
        c.globalAlpha = b.disabled ? 0.4 : 1;
        round(c, x, yy, bw, bh, 14 * s, fill);
        if (this.hoverId === b.id && !b.disabled) { c.lineWidth = 4 * s; c.strokeStyle = COLORS.accent; strokeRound(c, x, yy, bw, bh, 14 * s); }
        c.fillStyle = '#fff'; let fs = (b.size || 30) * s; c.font = `${b.bold ? 'bold ' : ''}${fs}px ${FONT}`;
        const lines = wrap(c, b.label, bw - 30 * s);
        if (lines.length > 2) { fs *= 0.8; c.font = `${fs}px ${FONT}`; }
        const ls = wrap(c, bidi(b.label), bw - 30 * s);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        ls.forEach((l, k) => c.fillText(l, x + bw / 2, yy + bh / 2 + (k - (ls.length - 1) / 2) * fs * 1.2));
        c.textAlign = 'right'; c.textBaseline = 'top'; c.globalAlpha = 1;
        this.buttons.push({ id: b.id, x, y: yy, w: bw, h: bh, disabled: b.disabled });
      });
    }
    if (ct.footer) {
      c.font = `${24 * s}px ${FONT}`; c.fillStyle = COLORS.dim; c.textBaseline = 'bottom';
      c.fillText(ct.footer, W - pad, H - 14 * s); c.textBaseline = 'top';
    }
    if (this.closable) {
      const bx = 18 * s, by2 = 16 * s, bs = 58 * s;
      round(c, bx, by2, bs, bs, 12 * s, this.hoverId === '__close' ? COLORS.btnHover : COLORS.panel2);
      c.fillStyle = '#fff'; c.font = `bold ${36 * s}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('–', bx + bs / 2, by2 + bs / 2); c.textAlign = 'right'; c.textBaseline = 'top';
      this.buttons.push({ id: '__close', x: bx, y: by2, w: bs, h: bs });
    }
    this.tex.needsUpdate = true;
  }
  hitTest(uv) {
    if (!uv) return null;
    const px = uv.x * this.canvas.width, py = (1 - uv.y) * this.canvas.height;
    for (const b of this.buttons) if (!b.disabled && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
    if (this.minimized) return null;
    return '__surface';
  }
  setHover(id) { if (id === '__surface') id = null; if (id !== this.hoverId) { this.hoverId = id; this.redraw(); } }
  click(id) {
    if (id === '__close') { this.minimized = true; this.redraw(); return; }
    if (id === '__restore') { this.minimized = false; this.redraw(); return; }
    if (id && id !== '__surface' && this.onClick) this.onClick(id);
  }
}

export function round(c, x, y, w, h, r, fill) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.fillStyle = fill; c.fill();
}
export function strokeRound(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.stroke();
}

// ملصق نصي صغير (اسم أداة، قيمة على شاشة جهاز)
export class Label {
  constructor(text, { w = 0.3, h = 0.07, size = 46, bg = 'rgba(15,20,26,0.85)', color = '#fff', ppm = 1000, billboard = true } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * ppm); this.canvas.height = Math.round(h * ppm);
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, depthTest: true }));
    this.mesh.renderOrder = 3; this.mesh.userData.billboard = billboard;
    this.opts = { size, bg, color }; this.set(text);
  }
  set(text, color) {
    if (text === this.text && !color) return; this.text = text;
    const c = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (this.opts.bg) round(c, 0, 0, W, H, H * 0.25, this.opts.bg);
    c.direction = 'rtl'; c.fillStyle = color || this.opts.color; c.textAlign = 'center'; c.textBaseline = 'middle';
    let fs = this.opts.size; c.font = `bold ${fs}px ${FONT}`;
    while (c.measureText(text).width > W * 0.92 && fs > 10) { fs -= 2; c.font = `bold ${fs}px ${FONT}`; }
    c.fillText(bidi(text), W / 2, H / 2 + 2); this.tex.needsUpdate = true;
  }
}
