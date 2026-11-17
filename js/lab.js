import * as THREE from 'three';
import { Panel, Label, bidi } from './ui.js';
import { drawLogo, logoReady, logoImage, BRAND } from './brand.js';

// ================================================================
// البيئة: مختبر العلوم المدرسي + الممر + ساحة رمي المطرقة
// كل المجسمات مبنية بالكود (لا ملفات خارجية)
// ================================================================

export const LAB = { minX: -8, maxX: 8, minZ: -6, maxZ: 6, H: 3.2 };
export const FIELD = new THREE.Vector3(-60, 0, 0);
export const STATION = { x: 3.4, z: -1.2, top: 0.9, w: 2.0, d: 0.9 };   // طاولة محطة الدوران
export const SWING = new THREE.Vector3(3.4, 0, 0.75);                    // مركز دائرة المساحة الآمنة
export const SAFE_R = 1.45;

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8; return t;
}
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

export function buildWorld(engine) {
  const { scene } = engine;
  scene.background = new THREE.Color(0xb9c7d3);
  const W = {};

  // ---------- الإضاءة ----------
  scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x6b6257, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(4, 9, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 25 });
  sun.shadow.bias = -0.0005; scene.add(sun);

  // ---------- المختبر ----------
  const lab = new THREE.Group(); scene.add(lab); W.lab = lab;
  const floorTex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d9d4c8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#cfc9bb'; c.fillRect(0, 0, w / 2, h / 2); c.fillRect(w / 2, h / 2, w / 2, h / 2);
    c.strokeStyle = '#b9b2a2'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); c.strokeRect(0, 0, w / 2, h / 2);
  }, [8, 6]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), M(0xffffff, { map: floorTex, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; lab.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), M(0xeeeeea));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = LAB.H; lab.add(ceil);
  // أضواء السقف
  for (let x = -5; x <= 5; x += 5) for (let z = -3.5; z <= 3.5; z += 3.5) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfffbea, emissiveIntensity: 1.2 }));
    p.position.set(x, LAB.H - 0.02, z); lab.add(p);
  }
  const fill = new THREE.PointLight(0xfff4e0, 18, 14, 1.6); fill.position.set(2, 2.9, -0.5); lab.add(fill);

  const wallMat = M(0xe8e4da), trimMat = M(0x7d8a96);
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, LAB.H, d), wallMat); m.position.set(x, LAB.H / 2, z);
    m.receiveShadow = true; lab.add(m);
    const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.12, d + 0.02), trimMat); t.position.set(x, 0.06, z); lab.add(t);
    engine.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: LAB.H });
  };
  wall(0, -6.05, 16.2, 0.1); wall(-8.05, 0, 0.1, 12.2); wall(8.05, 0, 0.1, 12.2);
  wall(-4.45, 6.05, 7.3, 0.1); wall(4.45, 6.05, 7.3, 0.1);           // الجدار الأمامي مع فتحة الباب
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, LAB.H - 2.2, 0.1), wallMat); lintel.position.set(0, 2.2 + (LAB.H - 2.2) / 2, 6.05); lab.add(lintel);
  // إطار الباب ولوحة المختبر
  const frame = M(0x5a4636);
  for (const x of [-0.82, 0.82]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.16), frame); f.position.set(x, 1.1, 6.05); lab.add(f); }
  const sign = new Label('مختبر الفيزياء', { w: 1.2, h: 0.22, size: 100, bg: '#24527a' });
  sign.mesh.position.set(0, 2.5, 6.12); lab.add(sign.mesh);
  // نوافذ على الجدار الأيسر
  for (const z of [-3, 0.5, 4]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x9cc6ec, emissiveIntensity: 0.6 }));
    g.position.set(-7.99, 1.9, z); g.rotation.y = Math.PI / 2; lab.add(g);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 1.9), trimMat); fr.position.set(-8.0, 1.9, z); lab.add(fr);
  }

  // ---------- الممر (نقطة الدخول) ----------
  const corr = new THREE.Group(); lab.add(corr);
  const cf = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.6), M(0xbfb8a8)); cf.rotation.x = -Math.PI / 2; cf.position.set(0, 0, 8.3); cf.receiveShadow = true; corr.add(cf);
  const cc = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.6), M(0xeeeeea)); cc.rotation.x = Math.PI / 2; cc.position.set(0, LAB.H, 8.3); corr.add(cc);
  for (const x of [-1.55, 1.55]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, LAB.H, 4.6), M(0xd6dde3)); m.position.set(x, LAB.H / 2, 8.3); corr.add(m);
    engine.colliders.push({ minX: x - 0.05, maxX: x + 0.05, minZ: 6, maxZ: 10.6, top: LAB.H });
  }
  const end = new THREE.Mesh(new THREE.BoxGeometry(3.2, LAB.H, 0.1), M(0xd6dde3)); end.position.set(0, LAB.H / 2, 10.6); corr.add(end);
  engine.colliders.push({ minX: -1.6, maxX: 1.6, minZ: 10.55, maxZ: 10.7, top: LAB.H });
  const cl = new THREE.PointLight(0xffffff, 6, 6); cl.position.set(0, 2.9, 8.3); corr.add(cl);
  // مناطق المشي (متداخلة عند الباب؛ الجدران هي التي تمنع العبور فعلياً)
  engine.regions.push({ minX: LAB.minX, maxX: LAB.maxX, minZ: LAB.minZ, maxZ: LAB.maxZ + 0.6 }, { minX: -1.5, maxX: 1.5, minZ: 5.0, maxZ: 10.6 });

  // ---------- الأثاث ----------
  const wood = M(0x2f3b45, { roughness: 0.4 }), leg = M(0x9aa3ab, { metalness: 0.6, roughness: 0.4 });
  W.table = (x, z, w, d, h = 0.9, top = wood) => {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), top); t.position.y = h - 0.025; t.castShadow = t.receiveShadow = true; g.add(t);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h - 0.15, d - 0.15), M(0xd8d2c4)); cab.position.y = (h - 0.15) / 2 + 0.05; cab.castShadow = true; g.add(cab);
    lab.add(g);
    engine.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
    engine.surfaces.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y: h, kind: 'table' });
    return g;
  };
  // طاولات الطلاب (صفان على يسار المختبر)
  for (const [x, z] of [[-5.6, -1.4], [-2.6, -1.4], [-5.6, 1.6], [-2.6, 1.6], [-5.6, 4.2]]) {
    W.table(x, z, 2.0, 0.85);
    for (const dx of [-0.5, 0.5]) { const s = stool(); s.position.set(x + dx, 0, z + 0.7); lab.add(s); }
    const beaker = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.11, 16), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.45, roughness: 0.1 }));
    beaker.position.set(x - 0.7, 0.955, z - 0.2); lab.add(beaker);
  }
  // طاولة المعلم أمام الشاشة
  W.table(-4.6, -4.7, 1.6, 0.7, 0.9, M(0x6b4f3a, { roughness: 0.5 }));
  // خزائن وأرفف
  for (let z = -4.6; z <= 3.4; z += 1.6) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.1, 1.5), M(0xcfd6dc)); cab.position.set(7.7, 1.05, z); cab.castShadow = true; lab.add(cab);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.9), new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.5 }));
    gl.position.set(7.42, 1.55, z); gl.rotation.y = -Math.PI / 2; lab.add(gl);
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 0.12), M([0x3a7bd5, 0xd5833a, 0x3ad58a, 0xaa4ad5][k])); b.position.set(7.55, 1.22, z - 0.45 + k * 0.28); lab.add(b); }
    engine.colliders.push({ minX: 7.4, maxX: 8, minZ: z - 0.75, maxZ: z + 0.75, top: 2.1 });
  }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 3), M(0x8a6a4a)); shelf.position.set(-7.8, 1.0, -4.3); lab.add(shelf);
  engine.colliders.push({ minX: -8, maxX: -7.6, minZ: -5.8, maxZ: -2.8, top: 1.0 });
  // سبورة وجدول دوري على الجدار الأيمن
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ map: canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#f4f4ee'; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; c.font = 'bold 34px Segoe UI'; c.direction = 'rtl'; c.textAlign = 'center';
    c.fillText('احتياطات السلامة', w / 2, 50); c.font = '24px Segoe UI';
    ['ارتدِ النظارة الواقية', 'دوّر في مساحة مفتوحة فوق مستوى الرأس', 'تأكد من متانة الخيط وربطه', 'لا تزد السرعة فجأة'].forEach((t, i) => c.fillText('• ' + t, w / 2, 100 + i * 38));
  }) }));
  board.position.set(7.99 - 0.6, 2.3, 5.0); board.rotation.y = -Math.PI / 2; lab.add(board);

  // ---------- شاشة العرض ----------
  const scr = new THREE.Group(); scr.position.set(-1.2, 1.85, -5.97); lab.add(scr);
  const bez = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.95, 0.06), M(0x111417, { roughness: 0.3 })); scr.add(bez);
  W.screen = new Panel({ w: 3.2, h: 1.8, ppm: 400, name: 'شاشة العرض' });
  W.screen.mesh.position.z = 0.035; scr.add(W.screen.mesh);
  W.screen.set({ title: 'الحركة الدائرية', body: 'الفيزياء 1 · الفصل 6 · الحركة في بعدين', titleSize: 70, bodySize: 44, bg: '#14304a' });

  // ---------- شعار الأمد: لوحة على الجدار الأمامي بجانب الشاشة، وأخرى عند باب المختبر ----------
  const plaque = (w, h, x, y, z, ry) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * 500); cv.height = Math.round(h * 500);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const paint = () => { const c = cv.getContext('2d'); c.fillStyle = logoImage() ? BRAND.bg : '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
      c.strokeStyle = '#c9a227'; c.lineWidth = 10; c.strokeRect(5, 5, cv.width - 10, cv.height - 10);
      drawLogo(c, cv.width / 2, cv.height / 2, cv.width * 0.9, cv.height * 0.8); t.needsUpdate = true; };
    paint(); logoReady.then(paint);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    m.position.set(x, y, z); m.rotation.y = ry; lab.add(m); return m;
  };
  plaque(1.1, 0.62, 1.25, 2.05, -5.96, 0);            // داخل المختبر بجانب شاشة العرض
  plaque(0.8, 0.45, 1.75, 2.5, 6.13, 0);      // خارج الباب بجانب لافتة المختبر (يراها الطالب من الممر)

  // ---------- طاولة محطة الدوران (مميزة باللون والإضاءة واللافتة) ----------
  const stMat = M(0x1f5e8c, { roughness: 0.35 });
  W.stationTable = W.table(STATION.x, STATION.z, STATION.w, STATION.d, STATION.top, stMat);
  const stSign = new Label('محطة الحركة الدائرية', { w: 1.1, h: 0.18, size: 80, bg: '#1f5e8c' });
  stSign.mesh.position.set(STATION.x, 2.35, STATION.z - 0.2); lab.add(stSign.mesh);
  const spot = new THREE.SpotLight(0xffffff, 25, 6, 0.6, 0.5, 1.2); spot.position.set(STATION.x, 3.1, STATION.z + 0.8);
  spot.target.position.set(STATION.x, 0.9, STATION.z + 0.6); lab.add(spot, spot.target);
  // دائرة المساحة الآمنة على الأرض
  const ring = new THREE.Mesh(new THREE.RingGeometry(SAFE_R - 0.05, SAFE_R, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc400 }));
  ring.position.set(SWING.x, 0.004, SWING.z); lab.add(ring);
  const stripes = new THREE.Mesh(new THREE.CircleGeometry(SAFE_R - 0.05, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.25 }));
  stripes.position.set(SWING.x, 0.003, SWING.z); lab.add(stripes); W.safeRing = ring; W.safeFill = stripes;
  const sLab = new Label('المساحة الآمنة — لا يدخلها إلا المنفّذ', { w: 1.4, h: 0.12, size: 50, bg: null, color: '#b38600' });
  sLab.mesh.rotation.x = -Math.PI / 2; sLab.mesh.position.set(SWING.x, 0.006, SWING.z + SAFE_R + 0.15); sLab.mesh.userData.billboard = false; lab.add(sLab.mesh);

  buildField(engine, W);
  buildBoards(engine, W);
  return W;
}

function boardFace(w, h) {
  return canvasTex(Math.round(w * 600), Math.round(h * 600), (c, W, H) => {
    c.fillStyle = '#f7f8f4'; c.fillRect(0, 0, W, H); c.direction = 'rtl'; c.textAlign = 'center'; c.fillStyle = '#1f4e79';
    c.font = `bold ${H * 0.11}px Segoe UI, Tahoma`; c.fillText('الحركة الدائرية المنتظمة', W / 2, H * 0.18);
    c.fillStyle = '#333'; c.font = `${H * 0.085}px Segoe UI, Tahoma`;
    ['v = 2πrn ÷ t', 'aC = v² ÷ r', 'FC = m v² ÷ r'].forEach((t, i) => c.fillText(bidi(t), W / 2, H * (0.38 + i * 0.17)));
    c.fillStyle = '#8a8f94'; c.font = `${H * 0.06}px Segoe UI, Tahoma`; c.fillText('السرعة مماسية · التسارع نحو المركز', W / 2, H * 0.9);
  });
}

// ---------- سبورات ثابتة على حوامل: تُعرض عليها التعليمات والجداول في مكانها داخل المشهد ----------
export const BOARD = { w: 1.4, h: 0.72 };
function buildBoards(engine, W) {
  const frameM = M(0x9aa3ab, { metalness: 0.6, roughness: 0.4 }), backM = M(0x2a333c);
  // face: النقطة التي تتجه إليها السبورة (حيث يقف الطالب عادة)
  const make = (id, x, z, face, { area, y = 1.6, w = BOARD.w, h = BOARD.h, legs = true } = {}) => {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(face.x - x, face.z - z); engine.scene.add(g);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.04), backM); back.position.set(0, y, -0.03); back.castShadow = true; g.add(back);
    if (legs) for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, y + h / 2), frameM); leg.position.set(sx * (w / 2 - 0.05), (y + h / 2) / 2, -0.06); g.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.5), frameM); foot.position.set(sx * (w / 2 - 0.05), 0.015, -0.06); g.add(foot);
      if (area !== 'field') engine.colliders.push({ minX: x + Math.cos(g.rotation.y) * sx * (w / 2 - 0.05) - 0.2, maxX: x + Math.cos(g.rotation.y) * sx * (w / 2 - 0.05) + 0.2, minZ: z - Math.sin(g.rotation.y) * sx * (w / 2 - 0.05) - 0.2, maxZ: z - Math.sin(g.rotation.y) * sx * (w / 2 - 0.05) + 0.2, top: y + h / 2 });
    }
    // وجه السبورة الثابت (يظهر حين لا تُعرض عليها لوحة): سبورة بيضاء عليها قوانين الدرس
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: boardFace(w, h), roughness: 0.4 }));
    front.position.set(0, y, -0.008); g.add(front);
    const b = { id, group: g, front, area, y, w, h, pos: new THREE.Vector3(x, y, z), yaw: g.rotation.y };
    W.boards.push(b); return b;
  };
  W.boards = [];
  // في المختبر سبورتان فقط: شاشة العرض الكبيرة للتعليمات (على الجدار) + سبورة جدول البيانات عند المحطة
  // وفي ساحة الرمي لوحة واحدة خارج المختبر
  make('field', FIELD.x + 7.0, FIELD.z + 2.2, FIELD.clone().add(new THREE.Vector3(5.2, 0, 4.6)), { area: 'field', w: 1.4, h: 0.79 });
  make('stationR', 5.35, -1.2, new THREE.Vector3(3.4, 0, 0.9), { area: 'lab', w: 1.7, h: 1.0, y: 1.55 });
}

function stool() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20), M(0x333a40)); s.position.y = 0.62; s.castShadow = true; g.add(s);
  const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.6, 8), M(0x9aa3ab, { metalness: 0.6 })); l.position.y = 0.3; g.add(l);
  return g;
}

// ---------- ساحة رمي المطرقة ----------
function buildField(engine, W) {
  const f = new THREE.Group(); f.position.copy(FIELD); engine.scene.add(f); W.field = f;
  const grass = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#4f8a3a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { c.fillStyle = Math.random() > 0.5 ? '#5b9843' : '#467c33'; c.fillRect(Math.random() * w, Math.random() * h, 2, 4); }
  }, [20, 20]);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), M(0xffffff, { map: grass, roughness: 0.95 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; f.add(g);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.0, 48).rotateX(-Math.PI / 2), M(0x8b8b8b, { roughness: 0.9 }));
  pad.position.y = 0.005; f.add(pad);
  const circ = new THREE.Mesh(new THREE.RingGeometry(1.067, 1.1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  circ.position.y = 0.008; f.add(circ);
  // قطاع الرمي باتجاه -Z (34.92°)
  const half = THREE.MathUtils.degToRad(17.46);
  for (const s of [-1, 1]) {
    const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ln.position.set(Math.sin(s * half) * 21, 0.007, -Math.cos(half) * 21); ln.rotation.y = -s * half; f.add(ln);
  }
  // القفص (أعمدة وشبك)
  const pole = M(0xdddddd, { metalness: 0.5 }), net = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.12, side: THREE.DoubleSide, wireframe: true });
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.2 + (i / 10) * Math.PI * 1.6;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6), pole); p.position.set(Math.cos(a) * 3.6, 3, Math.sin(a) * 3.6 + 0.0); f.add(p);
  }
  const netG = new THREE.CylinderGeometry(3.6, 3.6, 5, 28, 5, true, -Math.PI * 0.3, Math.PI * 1.6);
  const n = new THREE.Mesh(netG, net); n.position.y = 3; n.rotation.y = Math.PI; f.add(n);
  // مدرجات وسماء
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTex(64, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5d9bd6'); gr.addColorStop(0.5, '#cfe5f7'); gr.addColorStop(1, '#cfe5f7');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  }) }));
  f.add(sky);
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5 + i * 0.5, 1.2), M(i % 2 ? 0x8899aa : 0x99aabb));
    st.position.set(14, 0.25 + i * 0.25, 2 - i * 0); st.position.x = 16 + i * 1.2; st.rotation.y = Math.PI / 2; st.position.z = 0; f.add(st);
  }
  const sunF = new THREE.DirectionalLight(0xffffff, 1.5); sunF.position.set(FIELD.x + 5, 12, 8); sunF.target.position.copy(FIELD); engine.scene.add(sunF, sunF.target);
  engine.regions.push({ minX: FIELD.x - 25, maxX: FIELD.x + 15, minZ: FIELD.z - 25, maxZ: FIELD.z + 15 });
  // حاجز القفص كعائق للمشي
  engine.colliders.push({ minX: FIELD.x - 3.8, maxX: FIELD.x + 3.8, minZ: FIELD.z - 0.5, maxZ: FIELD.z + 3.8, top: 6, field: true });
}
