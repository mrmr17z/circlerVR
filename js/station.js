import * as THREE from 'three';
import { Grabbable } from './core.js';
import { Panel, Label } from './ui.js';
import { audio } from './audio.js';
import { STATION } from './lab.js';

// ================================================================
// محطة السدادة الدوارة: الأدوات، مناطق التركيب، ومحاكاة الحركة الدائرية
// النموذج الفيزيائي:
//   الشد في الخيط يساوي وزن الثقل المعلق Mg (يقرؤه الميزان النابضي)
//   السدادة كتلتها m = 0.020 kg، طول الخيط من فوهة الأنبوب حتى السدادة L
//   إذا كانت ω أقل من ω0 = √(Mg / m L0) يسحب الثقل الخيط فيقصر L ويبتعد المشبك عن الأنبوب
//   وإذا زادت يلتصق المشبك بالأنبوب ويزداد الشد m ω² L0
//   ميل الخيط تحت الأفق: sinφ = g / (ω² L)  (البندول المخروطي)
// ================================================================

// وضعية الأنبوب أثناء التدوير على الكمبيوتر: فوق الرأس وأمامه، فتمر السدادة فوق الرأس ويراها الطالب أمامه
export const HOLD = { fwd: 0.55, right: 0.1, up: 0.3, pitch: 0.55 };
export const G = 9.8, M_STOPPER = 0.020;
const TOP = STATION.top, EDGE = STATION.z + STATION.d / 2;   // الحافة الأمامية للطاولة
const HX = STATION.x + 0.8;                                    // موضع الحامل
const AXIS = new THREE.Vector3(HX, TOP + 0.3, EDGE + 0.1);      // مركز الأنبوب في الحامل
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Quaternion();

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });

function makeTube() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.15, 20, 1, true), mat(0xd8eef8, { transparent: true, opacity: 0.55, roughness: 0.1, side: THREE.DoubleSide }));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.07, 20), mat(0x2a2a2a, { roughness: 0.9 }));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, 8, 20).rotateX(Math.PI / 2), mat(0xeeeeee, { metalness: 0.4 }));
  lip.position.y = 0.075; g.add(t, grip, lip); g.traverse(o => o.castShadow = true); return g;
}
function makeStopper() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.025, 24), mat(0x8a3b22, { roughness: 0.95 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.002, 8, 20), mat(0xc9c9c9, { metalness: 0.8, roughness: 0.3 }));
  ring.position.y = 0.02; g.add(s, ring);
  // العقدة (تظهر مرتخية في موقف السلامة)
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), mat(0xf5f5f0)); knot.position.y = 0.028; g.add(knot); g.userData.knot = knot;
  g.traverse(o => o.castShadow = true); return g;
}
function makeCoil() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 24).rotateX(Math.PI / 2), mat(0xf2f2ea, { roughness: 1 }));
  const end = new THREE.Mesh(new THREE.SphereGeometry(0.005), mat(0xffffff)); end.position.set(0.035, 0, 0);
  g.add(c, end); return g;
}
function makeSpring() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 16), mat(0xd9d9d9, { metalness: 0.5, roughness: 0.3 }));
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.12), mat(0xfff8d0)); sc.position.set(0, 0, 0.0125);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.0015, 6, 12, Math.PI * 1.4), mat(0x888888, { metalness: 0.8 }));
  hook.position.y = -0.085; const ringT = hook.clone(); ringT.position.y = 0.085;
  const ind = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.003, 0.004), mat(0xff3b30)); ind.position.set(0, 0.03, 0.013);
  g.add(body, sc, hook, ringT, ind); g.userData.ind = ind; g.traverse(o => o.castShadow = true); return g;
}
function makeWeight(N) {
  const g = new THREE.Group(), n = Math.round(N / 0.4);
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03 + n * 0.012), mat(0x777777, { metalness: 0.8 }));
  hanger.position.y = 0.01; g.add(hanger);
  for (let i = 0; i < n; i++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.011, 24), mat(0xb08d3c, { metalness: 0.7, roughness: 0.35 })); d.position.y = -0.012 * n / 2 + i * 0.012; g.add(d); }
  const lab = new Label(`${N.toFixed(2)} N`, { w: 0.06, h: 0.022, size: 16, bg: '#222' }); lab.mesh.position.set(0, 0, 0.0235); lab.mesh.userData.billboard = false; g.add(lab.mesh);
  g.traverse(o => o.castShadow = true); return g;
}
function makeRuler() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#e8c87a'; x.fillRect(0, 0, 1024, 32); x.fillStyle = '#222';
  for (let i = 0; i <= 100; i++) { const h = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6; x.fillRect(1024 - i * 10.2 - 1, 0, 1.5, h); if (i % 10 === 0 && i) { x.font = '11px sans-serif'; x.fillText(String(i), 1024 - i * 10.2 + 2, 28); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.004, 0.03), [mat(0xd8b868), mat(0xd8b868), new THREE.MeshStandardMaterial({ map: t }), mat(0xd8b868), mat(0xd8b868), mat(0xd8b868)]);
  m.castShadow = true; const g = new THREE.Group(); g.add(m); return g;
}
function makeStopwatch() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 24).rotateX(Math.PI / 2), mat(0x2e7d5b));
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.01), mat(0xcccccc, { metalness: 0.7 })); btn.position.y = 0.035;
  const d = new Label('00.00', { w: 0.045, h: 0.018, size: 15, bg: '#c8d8b0', color: '#111' }); d.mesh.position.z = 0.0065; d.mesh.userData.billboard = false;
  g.add(b, btn, d.mesh); g.userData.display = d; return g;
}

export class Station {
  constructor(engine, world) {
    this.e = engine; this.W = world; this.listeners = {};
    const sc = engine.scene;
    // ---------- الأجهزة الثابتة ----------
    // الحامل
    const holder = new THREE.Group(); sc.add(holder);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.14), mat(0x333333, { metalness: 0.5 })); base.position.set(HX, TOP + 0.01, EDGE - 0.12);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42), mat(0xaaaaaa, { metalness: 0.8, roughness: 0.3 })); rod.position.set(HX, TOP + 0.21, EDGE - 0.12);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.23), mat(0xaaaaaa, { metalness: 0.8 })); arm.position.set(HX, AXIS.y, EDGE - 0.005);
    const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 8, 16).rotateX(Math.PI / 2), mat(0x666666, { metalness: 0.8 })); clamp.position.copy(AXIS);
    holder.add(base, rod, arm, clamp); holder.traverse(o => o.castShadow = true);
    // الميزان الإلكتروني
    const bal = new THREE.Group(); bal.position.set(STATION.x - 0.75, TOP, STATION.z - 0.15); sc.add(bal);
    const bb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.2), mat(0xe8e8e8)); bb.position.y = 0.02;
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 32), mat(0xcccccc, { metalness: 0.8, roughness: 0.2 })); pan.position.set(0, 0.043, -0.02);
    this.balDisp = new Label('0.0 g', { w: 0.08, h: 0.028, size: 22, bg: '#0d2a1d', color: '#6dff9b' });
    this.balDisp.mesh.position.set(0, 0.03, 0.101); this.balDisp.mesh.userData.billboard = false;
    bal.add(bb, pan, this.balDisp.mesh); bal.traverse(o => o.castShadow = true);
    engine.surfaces.push({ minX: bal.position.x - 0.09, maxX: bal.position.x + 0.09, minZ: bal.position.z - 0.1, maxZ: bal.position.z + 0.1, y: TOP + 0.046, kind: 'table' });
    this.balPos = new THREE.Vector3(bal.position.x, TOP + 0.046, bal.position.z - 0.02);

    // ---------- الأدوات القابلة للإمساك ----------
    const P = (o, x, z, y) => { o.position.set(STATION.x + x, TOP + y, STATION.z + z); sc.add(o); return o; };
    const reg = (obj, opts) => engine.addGrabbable(new Grabbable(obj, opts));
    this.tube = reg(P(makeTube(), 0.45, -0.25, 0.075), { name: 'الأنبوب', info: 'أنبوب رأسي يمر الخيط من خلاله؛ تمسكه بيدك وتدوّر السدادة حوله، فيصير مركز الدائرة.', halfH: 0.075, radius: 0.02 });
    this.tube.uprightHold = true;
    this.stopper = reg(P(makeStopper(), -0.4, 0.2, 0.0125), { name: 'السدادة المطاطية', info: 'الجسم الذي يتحرك حركة دائرية. كتلتها مع الحلقة 20 g. تُربط في الطرف العلوي للخيط.', halfH: 0.0125, radius: 0.02 });
    this.coil = reg(P(makeCoil(), -0.15, 0.22, 0.006), { name: 'الخيط', info: 'خيط متين يمرّ عبر الأنبوب: طرفه العلوي للسدادة والسفلي للميزان النابضي والثقل.', halfH: 0.006, radius: 0.03 });
    this.spring = reg(P(makeSpring(), 0.15, 0.22, 0.08), { name: 'الميزان النابضي', info: 'يقيس الشد في الخيط بالنيوتن، وهو القوة المركزية التي تؤثر في السدادة.', halfH: 0.08, radius: 0.015 });
    this.weights = [0.4, 0.8, 1.6].map((N, i) => {
      const w = reg(P(makeWeight(N), 0.35 + i * 0.1, 0.25, 0.03), { name: `ثقل ${N.toFixed(2)} N`, info: `حلقات معلّقة وزنها ${N.toFixed(2)} N (كتلتها ≈ ${(N / G * 1000).toFixed(0)} g). وزنها يشدّ الخيط فيحدد القوة المركزية.`, halfH: 0.03, radius: 0.024 });
      w.N = N; return w;
    });
    this.ruler = reg(P(makeRuler(), -0.15, -0.3, 0.002), { name: 'المسطرة المترية', info: 'تقيس نصف القطر: المسافة من محور الأنبوب حتى مركز السدادة، بالمتر.', halfH: 0.002, radius: 0.05 });
    this.stopwatch = reg(P(makeStopwatch(), -0.8, 0.25, 0.03), { name: 'ساعة الإيقاف', info: 'تقيس زمن 30 دورة. المؤقت الرقمي في لوحة القياس مربوط بها.', halfH: 0.03, radius: 0.03 });
    // بعد التركيب: إمساك السدادة أو الميزان النابضي يرفع الجهاز كله من الأنبوب (كما في المختبر الحقيقي)
    // تلميح أثناء إمساك الأنبوب المركّب: كيف تدوّر السدادة
    this.tube.heldHint = () => this.sim.active ? (this.sim.omega > 1 ? '⟳ استمر بتحريك الماوس في دوائر بنفس الإيقاع لتبقى السرعة ثابتة · T للمؤقت · Q لإفلات الأنبوب' : '⟳ حرّك الماوس في دوائر صغيرة (كأنك تدوّر يدك) لتدوير السدادة — أو استمر بالضغط على Space') : null;
    // أثناء التدوير على الكمبيوتر: الأنبوب مرفوع فوق الرأس أمام الطالب قليلاً، ويتحرك مع دوائر اليد (الماوس)
    this.mouseHist = []; this.handCircle = new THREE.Vector2(); this._lookUp = 9;
    this.tube.worldHold = h => {
      if (h.id !== 'desktop' || !this.sim.active) return null;
      const e = this.e, head = e.camera.getWorldPosition(new THREE.Vector3()), yaw = e.rig.rotation.y;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      return head.add(fwd.multiplyScalar(HOLD.fwd - this.handCircle.y)).add(right.multiplyScalar(HOLD.right + this.handCircle.x)).add(_v.set(0, HOLD.up, 0));
    };
    this.tube.on('grab', () => { this.mouseHist = []; this._lookUp = 0; });
    const viaTube =(g, on, name) => { g.grabRedirect = () => on() ? this.tube : null; g.hintText = () => on() ? `${name} — اضغط E لرفع الأنبوب وتدوير السدادة` : null; };
    viaTube(this.stopper, () => this.s.stopperOn, 'السدادة مربوطة بالخيط'); viaTube(this.spring, () => this.s.springOn, 'الميزان النابضي معلّق بالخيط');
    this.all = [this.tube, this.stopper, this.coil, this.spring, ...this.weights, this.ruler, this.stopwatch];
    this.home = new Map(this.all.map(g => [g, { p: g.object.position.clone(), q: g.object.quaternion.clone() }]));

    // ---------- الخيط المرسوم ----------
    const lm = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.upperString = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lm);
    this.lowerString = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lm);
    this.upperString.frustumCulled = this.lowerString.frustumCulled = false;
    this.clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.01), mat(0xff2d55));
    this.refLine = new THREE.Mesh(new THREE.BoxGeometry(1, 0.003, 0.003), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    this.refFlag = new Label('مرجع', { w: 0.06, h: 0.022, size: 16, bg: '#c62828' });
    this.trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false;
    sc.add(this.upperString, this.lowerString, this.clip, this.refLine, this.refFlag.mesh, this.trail);
    this.upperString.visible = this.lowerString.visible = this.clip.visible = this.refLine.visible = this.refFlag.mesh.visible = this.trail.visible = false;

    // ---------- الحالة ----------
    this.s = { weighed: false, inHolder: false, threaded: false, stopperOn: false, springOn: false, weight: null, rulerOn: false, L0: 0.5, rConfirmed: false };
    this.sim = { theta: 0, omega: 0, L: 0.5, tension: 0, q: 0, reading: 0, active: false, allowSpin: false };
    this.timer = { state: 'idle', revs: 0, t: 0, inBand: 0, samples: 0, Fsum: 0, lastTheta: 0 };
    this.handHist = [];
    this._zones(); this.setAssembly(false);
    this._panel();
    engine.addUpdate(dt => this.update(dt));
    engine.onKey = code => { if (code === 'KeyT') this.timerButton(); };
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }
  // الخيط لا يُمرَّر إلا والأنبوب في الحامل، فالتركيب مكتمل متى اتصلت كل الأجزاء بالخيط
  get assembled() { const s = this.s; return s.threaded && s.stopperOn && s.springOn && !!s.weight; }
  get F() { return this.s.weight ? this.s.weight.N : 0; }

  // ---------- مناطق الوضع والتركيب ----------
  _zones() {
    const e = this.e, s = this.s;
    const ghost = (geo) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x33ff88, transparent: true, opacity: 0.4, depthWrite: false })); m.visible = false; e.scene.add(m); return m; };
    const Z = (o) => e.addZone({ active: true, occupant: null, radius: 0.12, ...o });
    this.zBalance = Z({ id: 'balance', radius: 0.11, ghost: ghost(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 16)),
      getPose: (p, q) => { p.copy(this.balPos).y += 0.0125; q.identity(); },
      accepts: g => g === this.stopper || g.weightLike, showFor: g => !s.stopperOn,
      onSnap: g => { if (g === this.stopper) { this.balDisp.set('20.0 g'); this.emit('weighed'); } },
      onRemove: () => this.balDisp.set('0.0 g') });
    this.zHolder = Z({ id: 'holder', radius: 0.15, ghost: ghost(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 12)),
      getPose: (p, q) => { p.copy(AXIS); q.identity(); }, accepts: g => g === this.tube, showFor: g => g === this.tube,
      onSnap: () => { s.inHolder = true; this.sim.active = false; this._refreshZones(); this.emit('step', 'holder'); },
      onRemove: () => { s.inHolder = false; this._refreshZones(); },
      onReject: g => this.emit('error', `${g.name} لا يوضع في حامل الأنبوب.`) });
    this.zThread = Z({ id: 'thread', radius: 0.12, active: false, ghost: ghost(new THREE.TorusGeometry(0.02, 0.004, 6, 16).rotateX(Math.PI / 2)),
      getPose: (p, q) => { p.copy(AXIS).y += 0.085; q.identity(); }, accepts: g => g === this.coil,
      showFor: g => g === this.coil,
      onSnap: () => { s.threaded = true; this.coil.object.visible = false; this.coil.enabled = false; this.coil.zone = null; this.zThread.occupant = null; this.zThread.active = false; audio.play('grab'); this.emit('step', 'thread'); this._refreshZones(); },
      onReject: g => this.emit('error', `هنا يُمرَّر الخيط عبر الأنبوب، لا ${g.name}.`) });
    this.zStopper = Z({ id: 'stopperOn', radius: 0.14, active: false, ghost: ghost(new THREE.CylinderGeometry(0.019, 0.019, 0.025, 16)),
      getPose: (p, q) => { this.restStopperPos(p); q.identity(); }, accepts: g => g === this.stopper,
      showFor: g => g === this.stopper,
      onSnap: () => { s.stopperOn = true; this.stopper.locked = true; this.emit('step', 'stopper'); this._refreshZones(); },
      onReject: g => this.emit('error', `الطرف العلوي للخيط تُربط فيه السدادة، لا ${g.name}.`) });
    this.zSpring = Z({ id: 'springOn', radius: 0.14, active: false, ghost: ghost(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 12)),
      getPose: (p, q) => { p.copy(AXIS); p.y -= 0.075 + 0.02 + 0.08; q.identity(); }, accepts: g => g === this.spring,
      showFor: g => g === this.spring || g.N,
      onSnap: () => { s.springOn = true; this.spring.locked = true; this.emit('step', 'spring'); this._refreshZones(); },
      onReject: g => this.emit('error', g.N ? 'علّق الميزان النابضي أولاً في الطرف السفلي، ثم علّق الثقل في خطّافه.' : `الطرف السفلي للخيط يُعلّق فيه الميزان النابضي، لا ${g.name}.`) });
    this.zHook = Z({ id: 'hook', radius: 0.13, active: false, ghost: ghost(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 16)),
      getPose: (p, q) => { p.copy(AXIS); p.y -= 0.075 + 0.02 + 0.16 + 0.05; q.identity(); }, accepts: g => !!g.N,
      showFor: g => !!g.N,
      onSnap: g => { s.weight = g; this.emit('step', 'weight', g.N); this._refreshZones(); },
      onRemove: () => { s.weight = null; this._refreshZones(); this.emit('step', 'weightOff'); },
      onReject: g => this.emit('error', `خطّاف الميزان النابضي يُعلّق فيه الثقل فقط.`) });
    this.zRuler = Z({ id: 'ruler', radius: 0.25, active: false, ghost: ghost(new THREE.BoxGeometry(1, 0.004, 0.03)),
      getPose: (p, q) => { p.set(HX - 0.5, TOP + 0.002, EDGE - 0.14); q.identity(); }, accepts: g => g === this.ruler,
      showFor: g => g === this.ruler,
      onSnap: () => { s.rulerOn = true; this.emit('step', 'ruler'); },
      onRemove: () => { s.rulerOn = false; } });
    // الأنبوب المركّب لا يُفلت إلا في الحامل
    this.tube.canGrab = () => {
      if (s.inHolder && (s.threaded && !this.assembled)) { this.emit('error', 'أكمل التركيب أولاً (السدادة، الميزان النابضي، الثقل) ثم ارفع الأنبوب.'); return false; }
      if (this.assembled && !this.sim.allowSpin) { this.emit('error', 'انتظر تعليمات تدوير السدادة.'); return false; }
      return true;
    };
    this.weights.forEach(w => w.canGrab = () => { if (this.sim.active) { this.emit('error', 'لا تغيّر الثقل أثناء الدوران.'); return false; } return true; });
    // الأنبوب المركّب لا يُفلت إلا فوق الحامل (السدادة والثقل متصلان به)
    this.tube.canRelease = zone => !this.s.threaded || zone === this.zHolder;
    this.tube.on('releaseDenied', () => this.emit('error', 'أعد الأنبوب إلى الحامل قبل إفلاته؛ السدادة والثقل متصلان به.'));
    this.tube.on('grab', h => {
      // على الكمبيوتر: الأنبوب أمام الطالب وفوق مستوى عينه قليلاً لتدور السدادة فوق الرأس
      this.tube.holdOffset = (h.id === 'desktop' && this.assembled) ? new THREE.Vector3(-0.18, 0.5, -0.2) : null;
      if (this.assembled) { this.sim.active = true; this.sim.theta = 0; this.sim.omega = 0; this.handHist = []; this.resetTimer(); this.emit('spinStart'); } });
    this.tube.on('release', () => { if (this.tube.zone === this.zHolder && this.sim.active) { this.sim.active = false; this.sim.omega = 0; audio.setWhirl(0); if (this.timer.state !== 'done') this.resetTimer(); else this.refreshPanel(); this.emit('spinStop'); } });
  }
  // مناطق التركيب لا تعمل إلا في مشهد التجربة (S2)؛ في S1 يفحص الطالب الأدوات فقط
  setAssembly(on) { this.assemblyOn = on; this._refreshZones(); }
  _refreshZones() {
    const s = this.s, on = !!this.assemblyOn;
    this.zBalance.active = on; this.zHolder.active = on;
    if (!on) { for (const z of [this.zThread, this.zStopper, this.zSpring, this.zHook, this.zRuler]) z.active = false; return; }
    this.zThread.active = s.inHolder && !s.threaded;
    this.zStopper.active = s.threaded && !s.stopperOn;
    this.zSpring.active = s.threaded && !s.springOn;
    this.zHook.active = s.springOn;
    this.zRuler.active = s.stopperOn;
  }
  restStopperPos(p) { return p.set(HX - this.s.L0, TOP + 0.0125, EDGE - 0.07); }
  setL0(L) {
    this.s.L0 = Math.round(THREE.MathUtils.clamp(L, 0.15, 0.85) * 100) / 100; this.s.rConfirmed = false;
    if (this.s.stopperOn && !this.sim.active) { this.restStopperPos(this.stopper.object.position); }
  }
  resetTools() {
    for (const g of this.all) {
      if (g.held) continue;
      const h = this.home.get(g); if (g.zone) { g.zone.occupant = null; g.zone = null; }
      g.object.position.copy(h.p); g.object.quaternion.copy(h.q); g.object.visible = true; g.enabled = true; g.locked = false; g.resting = true;
    }
    Object.assign(this.s, { weighed: false, inHolder: false, threaded: false, stopperOn: false, springOn: false, weight: null, rulerOn: false, rConfirmed: false });
    this.balDisp.set('0.0 g'); this._refreshZones();
  }
  // يضع الأدوات مركّبة مباشرة (للعرض في مشاهد أخرى)
  autoAssemble(N = 0.8) {
    const s = this.s;
    const put = (g, z) => { z.getPose(_v, _q); g.object.position.copy(_v); g.object.quaternion.copy(_q); g.zone = z; z.occupant = g; g.resting = true; };
    put(this.tube, this.zHolder); s.inHolder = true; s.threaded = true; this.coil.object.visible = false; this.coil.enabled = false;
    put(this.stopper, this.zStopper); this.stopper.zone = null; this.zStopper.occupant = null; s.stopperOn = true; this.stopper.locked = true;
    put(this.spring, this.zSpring); this.spring.zone = null; this.zSpring.occupant = null; s.springOn = true; this.spring.locked = true;
    const w = this.weights.find(w => w.N === N); put(w, this.zHook); s.weight = w;
    this._refreshZones();
  }

  // ---------- لوحة القياس (المؤقت وعداد الدورات وقراءة الميزان) ----------
  _panel() {
    const p = this.panel = new Panel({ w: 0.95, h: 0.62, ppm: 900, name: 'لوحة القياس' });
    p.mesh.position.set(STATION.x - 0.25, 1.55, STATION.z + 0.25); p.mesh.rotation.x = -0.15;
    this.e.scene.add(p.mesh); this.e.registerPanel(p); p.mesh.visible = false;
    p.customDraw = (c, W, H, s, y, pad) => this._drawPanel(c, W, H, s, y, pad);
    p.onClick = id => {
      if (id === 'timer') this.timerButton();
      if (id === 'reset') this.resetTimer();
      if (id === 'record') this.emit('record', this.lastRun);
    };
    this._panelT = 0;
  }
  _drawPanel(c, W, H, s, y, pad) {
    const t = this.timer, sim = this.sim;
    c.textAlign = 'right'; c.font = `bold ${30 * s}px Segoe UI`; c.fillStyle = '#9fb0bf';
    c.fillText(`الثقل المعلّق: ${this.s.weight ? this.s.weight.N.toFixed(2) + ' N' : '—'}    ·    نصف القطر r = ${this.s.L0.toFixed(2)} m`, W - pad, y); y += 46 * s;
    // عداد الدورات والزمن (أرقام كبيرة)
    const box = (x, label, val, col) => {
      c.fillStyle = '#101820'; c.fillRect(x, y, 290 * s, 130 * s);
      c.fillStyle = '#9fb0bf'; c.font = `${24 * s}px Segoe UI`; c.textAlign = 'center'; c.fillText(label, x + 145 * s, y + 10 * s);
      c.fillStyle = col; c.font = `bold ${62 * s}px Consolas, monospace`; c.fillText(val, x + 145 * s, y + 46 * s); c.textAlign = 'right';
    };
    box(W - pad - 290 * s, 'الدورات', `${t.revs} / 30`, '#ffd34d');
    box(W - pad - 600 * s, 'الزمن (s)', t.t.toFixed(2), '#6dff9b');
    box(W - pad - 910 * s + 0, 'الميزان النابضي (N)', sim.active ? sim.reading.toFixed(2) : (this.s.weight ? this.s.weight.N.toFixed(2) : '0.00'), '#7cc7ff');
    y += 145 * s;
    // مؤشر انتظام السرعة (موقع المشبك)
    c.fillStyle = '#9fb0bf'; c.font = `${24 * s}px Segoe UI`;
    c.fillText('موقع المشبك تحت الأنبوب (حافظ عليه في المنطقة الخضراء):', W - pad, y); y += 36 * s;
    const bx = pad, bw = W - 2 * pad, bh = 30 * s;
    c.fillStyle = '#3a2a2a'; c.fillRect(bx, y, bw, bh);
    c.fillStyle = '#2f9e6e'; c.fillRect(bx + bw * 0.42, y, bw * 0.16, bh);
    const q = sim.active ? THREE.MathUtils.clamp((sim.q - 1) / 0.25, -1, 1) : -1;
    c.fillStyle = '#fff'; c.fillRect(bx + bw * (0.5 - q * 0.5) - 3 * s, y - 6 * s, 6 * s, bh + 12 * s);
    c.font = `${20 * s}px Segoe UI`; c.fillStyle = '#c9d3dc';
    c.textAlign = 'right'; c.fillText('أبطأ: المشبك ينزل', W - pad, y + bh + 6 * s); c.textAlign = 'left'; c.fillText('أسرع: المشبك يلتصق والقراءة تزيد', pad, y + bh + 6 * s); c.textAlign = 'right';
    y += bh + 40 * s;
    const msg = { idle: this.e.isXR ? 'دوّر السدادة بتحريك يدك في دوائر صغيرة (أو الزناد)، ثم اضغط «ابدأ المؤقت».' : 'حرّك الماوس في دوائر صغيرة منتظمة لتدوير السدادة (أو Space)، ثم اضغط «ابدأ المؤقت» (أو T).', armed: 'المؤقت جاهز: يبدأ عند مرور السدادة بالخط الأحمر المرجعي…', running: 'جارٍ العدّ — حافظ على سرعة ثابتة', done: 'اكتملت 30 دورة' }[t.state];
    c.fillStyle = t.state === 'done' ? '#6dff9b' : '#ffd34d'; c.font = `bold ${26 * s}px Segoe UI`; c.fillText(msg, W - pad, y);
    return y + 40 * s;
  }
  refreshPanel() {
    const t = this.timer;
    this.panel.set({ title: 'لوحة القياس', titleSize: 34, cols: 3, btnH: 62,
      buttons: [
        { id: 'timer', label: t.state === 'idle' ? 'ابدأ المؤقت' : t.state === 'armed' ? 'إلغاء' : t.state === 'running' ? 'إيقاف' : 'ابدأ من جديد', bold: true, color: '#2f7d5b', disabled: !this.sim.active && t.state !== 'done' && t.state !== 'running' },
        { id: 'reset', label: 'تصفير' },
        { id: 'record', label: 'سجّل القراءة', disabled: t.state !== 'done' || !this.lastRun || this.lastRun.recorded, color: '#3d79b8' }
      ] });
  }
  timerButton() {
    const t = this.timer;
    if (t.state === 'idle' || t.state === 'done') { if (!this.sim.active) return; this.resetTimer(); t.state = 'armed'; audio.play('timer'); }
    else if (t.state === 'armed') t.state = 'idle';
    else if (t.state === 'running') { t.state = 'idle'; this.emit('error', 'أوقفت المؤقت قبل 30 دورة؛ أعد القياس.'); }
    this.refreshPanel();
  }
  resetTimer() { Object.assign(this.timer, { state: 'idle', revs: 0, t: 0, inBand: 0, samples: 0, Fsum: 0 }); this.refreshPanel(); }

  // ---------- المحاكاة ----------
  update(dt) {
    const s = this.s, sim = this.sim, t = this.timer;
    // الخيط والسدادة في وضع السكون (الأنبوب في الحامل)
    const tubeTop = this.tube.object.localToWorld(_v.set(0, 0.075, 0)).clone();
    const tubeBot = this.tube.object.localToWorld(_v.set(0, -0.075, 0)).clone();
    this.upperString.visible = s.threaded; this.lowerString.visible = s.threaded;
    if (!s.threaded) { this.trail.visible = this.refLine.visible = this.refFlag.mesh.visible = this.clip.visible = false; return; }

    let stopperP;
    if (sim.active) {
      // ----- القيادة: دوران يد الطالب أو الضغط على Space / الزناد -----
      let drive = 0, handOmega = null;
      const h = this.tube.held;
      let deskTarget = null;
      // الكمبيوتر: الاستمرار بالضغط على Space = اليد تدور بانتظام (تتسارع السدادة تدريجياً حتى سرعة ثابتة)، والترك = تتباطأ
      if (h && h.id === 'desktop') {
        // اليد = مؤشر الماوس: تحريكه في دوائر صغيرة يحرّك الأنبوب في دوائر ويدوّر السدادة بنفس التردد (كما في التجربة الحقيقية)
        const px = this.e.mousePx, mh = this.mouseHist, now = this.e.time;
        if (px) mh.push({ x: px[0], y: px[1], t: now });
        while (mh.length && now - mh[0].t > 0.7) mh.shift();
        this.handCircle.set(0, 0);
        if (mh.length > 8) {
          let cx = 0, cy = 0; for (const p of mh) { cx += p.x; cy += p.y; } cx /= mh.length; cy /= mh.length;
          // السرعة الزاوية لليد: مجموع تغيّر الزاوية حول المركز على آخر 0.4 ثانية ÷ الزمن
          const b = mh[mh.length - 1]; let k = mh.length - 1; while (k > 0 && now - mh[k].t < 0.4) k--;
          let sum = 0, rs = 0; for (let i = k + 1; i < mh.length; i++) { let d = Math.atan2(mh[i].y - cy, mh[i].x - cx) - Math.atan2(mh[i - 1].y - cy, mh[i - 1].x - cx); sum += Math.atan2(Math.sin(d), Math.cos(d)); rs += Math.hypot(mh[i].x - cx, mh[i].y - cy); }
          const rad = rs / Math.max(1, mh.length - 1 - k);
          if (rad > 10 && b.t > mh[k].t) handOmega = Math.abs(sum / (b.t - mh[k].t));
          const sc = Math.min(1, 0.06 / Math.max(1e-6, rad * 0.0011)) * 0.0011;   // بكسل ← متر (حتى 6 سم)
          this.handCircle.set((b.x - cx) * sc, (b.y - cy) * sc);
        }
        if (this.e.keys.Space) deskTarget = Math.sqrt(this.F / (M_STOPPER * s.L0)) * 1.03;   // بديل أسهل
        // في بداية التدوير يرفع الطالب نظره إلى السدادة فوق رأسه
        if (this._lookUp < 1.2) { this._lookUp += dt; this.e.pitch += (HOLD.pitch - this.e.pitch) * Math.min(1, dt * 3); this.e.camera.rotation.x = this.e.pitch; }
      }
      else if (h) {
        const trig = h.gamepad?.buttons?.[0]?.value || 0; drive = trig;
        // دوران اليد في دوائر صغيرة: معدل تغيّر زاوية اليد حول مركزها المتوسط
        const hp = h.grip.getWorldPosition(new THREE.Vector3());
        this.handHist.push({ p: hp, t: this.e.time }); while (this.handHist.length > 45) this.handHist.shift();
        if (this.handHist.length > 20) {
          const c = new THREE.Vector3(); this.handHist.forEach(x => c.add(x.p)); c.divideScalar(this.handHist.length);
          const a = this.handHist[this.handHist.length - 6], b = this.handHist[this.handHist.length - 1];
          const ang = p => Math.atan2(p.z - c.z, p.x - c.x);
          let d = ang(b.p) - ang(a.p); d = Math.atan2(Math.sin(d), Math.cos(d));
          const rad = b.p.clone().sub(c).setY(0).length();
          if (rad > 0.012) handOmega = Math.abs(d / Math.max(0.01, b.t - a.t));
        }
      }
      const prevOm = sim.omega;
      if (deskTarget !== null) sim.omega += (deskTarget * (1 + 0.012 * Math.sin(this.e.time * 1.7)) - sim.omega) * Math.min(1, dt * 0.9);
      else if (handOmega !== null && handOmega > 2) sim.omega += (Math.min(handOmega, 22) - sim.omega) * Math.min(1, dt * 1.5);
      else sim.omega += (drive * 2.6 - (0.05 * sim.omega + 0.25) * (sim.omega > 0 ? 1 : 0)) * dt;
      sim.omega = THREE.MathUtils.clamp(sim.omega, 0, 22);
      if (prevOm < 0.5 && sim.omega >= 0.5) audio.play('start');

      const F = this.F, L0 = s.L0, w2 = sim.omega * sim.omega;
      const omega0 = Math.sqrt(F / (M_STOPPER * L0));
      sim.q = sim.omega / omega0;
      sim.L = w2 > 0 ? THREE.MathUtils.clamp(F / (M_STOPPER * w2), 0.04, L0) : 0.04;
      sim.reading = sim.q >= 1 ? M_STOPPER * w2 * L0 : F;
      sim.theta += sim.omega * dt;
      const sinPhi = w2 > 0 ? Math.min(1, G / (w2 * sim.L)) : 1, cosPhi = Math.sqrt(1 - sinPhi * sinPhi);
      stopperP = new THREE.Vector3(Math.cos(sim.theta) * sim.L * cosPhi, -sim.L * sinPhi, -Math.sin(sim.theta) * sim.L * cosPhi).add(tubeTop);
      this.stopper.object.position.copy(stopperP); this.stopper.object.rotation.set(0, sim.theta, Math.PI / 2 * cosPhi);
      audio.setWhirl(sim.omega / (2 * Math.PI));
      // ----- الأثر -----
      const tp = this.trail.geometry.attributes.position; tp.array.copyWithin(3, 0, tp.count * 3 - 3); tp.setXYZ(0, stopperP.x, stopperP.y, stopperP.z); tp.needsUpdate = true;
      this.trail.visible = sim.omega > 3;
      // ----- الخط المرجعي (اتجاه ثابت في المختبر) -----
      this.refLine.visible = this.refFlag.mesh.visible = true;
      this.refLine.scale.x = L0 + 0.12; this.refLine.position.copy(tubeTop).add(_v.set((L0 + 0.12) / 2, -sim.L * sinPhi, 0)); this.refLine.rotation.set(0, 0, 0);
      this.refFlag.mesh.position.copy(tubeTop).add(_v.set(L0 + 0.15, -sim.L * sinPhi + 0.03, 0));
      // ----- عدّ الدورات: كل مرور للسدادة بالخط المرجعي (θ يعبر مضاعفات 2π) -----
      const crossed = Math.floor(sim.theta / (2 * Math.PI)) > Math.floor((sim.theta - sim.omega * dt) / (2 * Math.PI));
      if (t.state === 'armed' && crossed) { t.state = 'running'; t.t = 0; t.revs = 0; audio.play('timer'); this.refreshPanel(); }
      else if (t.state === 'running') {
        t.t += dt; t.samples++; t.Fsum += sim.reading; if (Math.abs(sim.q - 1) < (this.tube.held?.id === 'desktop' ? 0.06 : 0.04)) t.inBand++;   // الماوس أقل دقة من اليد فهامشه أوسع قليلاً
        if (crossed) {
          t.revs++; audio.play('click');
          if (t.revs >= 30) {
            // دقة القياس: تُصحَّح لحظة العبور داخل الإطار
            const frac = (sim.theta % (2 * Math.PI)) / Math.max(1e-3, sim.omega); t.t -= frac;
            t.state = 'done'; audio.play('complete');
            const steady = t.inBand / Math.max(1, t.samples);
            this.lastRun = { F: Math.round(t.Fsum / t.samples * 100) / 100, Fset: this.F, r: L0, t: Math.round(t.t * 10) / 10, steady, recorded: false };
            this.emit('runDone', this.lastRun); this.refreshPanel();
          }
        }
      }
    } else {
      sim.omega = 0; audio.setWhirl(0); this.trail.visible = this.refLine.visible = this.refFlag.mesh.visible = false;
      if (s.stopperOn) { stopperP = this.restStopperPos(new THREE.Vector3()); this.stopper.object.position.copy(stopperP); this.stopper.object.rotation.set(0, 0, 0); }
      else stopperP = tubeTop.clone().add(_v.set(-s.L0, -0.38 + 0.0125 + 0.0, -0.17)).setY(TOP + 0.005);
      sim.L = s.L0;
    }
    // الخيط العلوي من فوهة الأنبوب إلى السدادة
    const up = this.upperString.geometry.attributes.position; up.setXYZ(0, tubeTop.x, tubeTop.y, tubeTop.z); up.setXYZ(1, stopperP.x, stopperP.y + 0.02, stopperP.z); up.needsUpdate = true;
    // الجزء السفلي: المشبك ← الميزان النابضي ← الثقل
    const gap = sim.active ? Math.max(0, s.L0 - sim.L) : 0.0;
    const clipP = tubeBot.clone(); clipP.y -= 0.01 + gap; this.clip.position.copy(clipP); this.clip.visible = true;
    const springP = clipP.clone(); springP.y -= 0.01 + 0.08;
    if (s.springOn) { this.spring.object.position.copy(springP); this.spring.object.rotation.set(0, 0, 0); }
    // مؤشر الميزان النابضي يتحرك مع الشد
    const reading = sim.active ? sim.reading : this.F;
    const ind = this.spring.object.children[4]; if (ind) ind.position.y = 0.05 - Math.min(2.4, reading) * 0.04;
    if (s.weight) { const wp = springP.clone(); wp.y -= 0.08 + 0.01 + 0.04; s.weight.object.position.copy(wp); s.weight.object.rotation.set(0, 0, 0); }
    const lo = this.lowerString.geometry.attributes.position; lo.setXYZ(0, tubeBot.x, tubeBot.y, tubeBot.z); lo.setXYZ(1, springP.x, springP.y + 0.085, springP.z); lo.needsUpdate = true;
    // ساعة الإيقاف تعرض زمن المؤقت
    this.stopwatch.object.userData.display.set(t.t.toFixed(2));
    // تحديث اللوحة 10 مرات في الثانية
    if (this.panel.mesh.visible && (this._panelT += dt) > 0.1) { this._panelT = 0; this.panel.redraw(); }
  }
}
