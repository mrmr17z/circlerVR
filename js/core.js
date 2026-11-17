import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { audio } from './audio.js';
import { Label, bidi } from './ui.js';

// ================================================================
// المحرك: العرض، اللاعب، الحركة والتصادم، الإدخال (ماوس/لوحة مفاتيح/وحدات تحكم/يدين)،
// نظام الإمساك والإفلات، فيزياء الأجسام البسيطة، مناطق الوضع، الأهداف القابلة للتحديد.
// ================================================================

const EYE = 1.6, WALK = 1.4, RADIUS = 0.22, GRAV = 9.8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class Grabbable {
  // object: Group مركزها في منتصف الأداة؛ halfH: نصف الارتفاع (للاستقرار على الأسطح)
  constructor(object, { name, info = '', halfH = 0.03, radius = 0.05, grabbable = true, holdOffset = null } = {}) {
    this.object = object; this.name = name; this.info = info; this.halfH = halfH; this.radius = radius;
    this.vel = new THREE.Vector3(); this.held = null; this.resting = true; this.enabled = grabbable;
    this.locked = false; this.zone = null; this.holdOffset = holdOffset; this.inspected = false;
    this.userRot = 0; this.listeners = {};
    // صندوق إصابة غير مرئي يغطي الأداة كلها (يسهّل التأشير على الأدوات الصغيرة والحلقية)
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()).sub(object.position);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x + 0.02, 0.05), Math.max(size.y + 0.02, 0.05), Math.max(size.z + 0.02, 0.05)),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    proxy.position.copy(c); proxy.userData.proxy = true; object.add(proxy);
    object.traverse(o => { o.userData.grabbable = this; });
    this.label = new Label(name, { w: 0.34, h: 0.065, size: 40 });
    this.label.mesh.visible = false;
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }
}

export class Engine {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true; this.renderer.xr.setReferenceSpaceType('local-floor');
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 300);
    this.rig = new THREE.Group(); this.rig.add(this.camera); this.scene.add(this.rig);
    this.camera.position.y = EYE; this.pitch = 0;

    this.updates = []; this.panels = []; this.grabbables = []; this.selectables = []; this.zones = [];
    this.colliders = []; this.surfaces = []; this.regions = [];
    this.keys = {}; this.locked = false; this.paused = true; this.moveEnabled = true; this.time = 0;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.settings = { snapTurn: true, turnAngle: 30, vignette: true };

    this._setupDesktop(); this._setupXR();
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    this.renderer.setAnimationLoop(() => this._tick());
  }

  get isXR() { return this.renderer.xr.isPresenting; }
  addUpdate(fn) { this.updates.push(fn); return fn; }
  removeUpdate(fn) { const i = this.updates.indexOf(fn); if (i >= 0) this.updates.splice(i, 1); }
  registerPanel(p) { if (!this.panels.includes(p)) this.panels.push(p); return p; }
  unregisterPanel(p) { const i = this.panels.indexOf(p); if (i >= 0) this.panels.splice(i, 1); p.mesh.parent?.remove(p.mesh); }
  addGrabbable(g) { this.grabbables.push(g); this.scene.add(g.label.mesh); return g; }
  addSelectable(object, opts) { const s = { object, ...opts, enabled: true }; object.traverse(o => o.userData.selectable = s); this.selectables.push(s); return s; }
  removeSelectable(s) { s.enabled = false; const i = this.selectables.indexOf(s); if (i >= 0) this.selectables.splice(i, 1); }
  addZone(z) { this.zones.push(z); return z; }

  // ---------- مدخل الكمبيوتر ----------
  _setupDesktop() {
    const el = this.renderer.domElement;
    this.desktopHand = new THREE.Object3D(); this.desktopHand.position.set(0.18, -0.2, -0.45);
    this.camera.add(this.desktopHand);
    // مؤشر الماوس ظاهر: ما تحت المؤشر هو ما تُمسكه أو تضغطه. الالتفات بالسحب (الزر الأيمن، أو الأيسر على فراغ)
    this.mouse = new THREE.Vector2(0, 0); this.mouseIn = false; this.dragging = false;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mousePx = [e.clientX, e.clientY]; this.mouseIn = true;
      if (!this.locked) return;
      if (this.keys.ShiftLeft && this.desktop.held) { this.desktop.held.userRot += e.movementX * 0.01; this.desktop.held.userPitch = (this.desktop.held.userPitch || 0) + e.movementY * 0.01; return; }
      const look = (e.buttons & 2) || ((e.buttons & 1) && this.dragging);
      if (!look) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) this.dragMoved = true;
      this.rig.rotation.y -= e.movementX * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.004, -1.45, 1.45);
      this.camera.rotation.x = this.pitch;
    });
    el.addEventListener('mouseleave', () => { this.mouseIn = false; });
    el.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) {
        // نقر على لوحة أو هدف أو أداة ممسوكة ← تنفيذ؛ نقر على فراغ ← سحب للالتفات
        this.dragMoved = false;
        if (!this._press(this.desktop)) this.dragging = true;
      }
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    // للاختبار الآلي: الضغط من المستند يمر بالمسار نفسه
    document.addEventListener('mousedown', e => { if (e.target === document || e.target === document.body) { if (this.locked && e.button === 0) this._press(this.desktop); } });
    document.addEventListener('wheel', e => { if (this.desktop.held) this.desktop.held.userRot += Math.sign(e.deltaY) * 0.25; });
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (!this.locked) return;
      if (e.code === 'Space') { e.preventDefault(); document.activeElement?.blur?.(); }
      if (e.code === 'KeyE') this._grabToggle(this.desktop);
      if (e.code === 'KeyQ' && this.desktop.held) this._release(this.desktop);
      if (e.code === 'KeyR' && this.desktop.held) this.desktop.held.userRot += Math.PI / 8;
      if (e.code === 'KeyF') this.desktop.inspect = !this.desktop.inspect;
      this.onKey && this.onKey(e.code);
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    this.desktop = { id: 'desktop', grip: this.desktopHand, held: null, hover: null, hist: [], inspect: false };
  }

  // ---------- مدخل النظارة ----------
  _setupXR() {
    const xr = this.renderer.xr, cmf = new XRControllerModelFactory(), hmf = new XRHandModelFactory();
    this.xrHands = [];
    for (let i = 0; i < 2; i++) {
      const ray = xr.getController(i), grip = xr.getControllerGrip(i), hand = xr.getHand(i);
      grip.add(cmf.createControllerModel(grip));
      hand.add(hmf.createHandModel(hand, 'mesh'));
      this.rig.add(ray, grip, hand);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      line.scale.z = 3; ray.add(line);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
      dot.visible = false; this.scene.add(dot);
      const h = { id: 'xr' + i, ray, grip, hand, line, dot, held: null, hover: null, hist: [], handedness: null, gamepad: null, pinch: false };
      ray.addEventListener('connected', e => { h.handedness = e.data.handedness; h.gamepad = e.data.gamepad; h.isHand = !!e.data.hand; });
      ray.addEventListener('disconnected', () => { h.gamepad = null; });
      ray.addEventListener('selectstart', () => { if (h.isHand) { h.pinch = true; if (!this._press(h)) this._grab(h); } else this._press(h); });
      ray.addEventListener('selectend', () => { if (h.isHand && h.held) this._release(h); h.pinch = false; });
      ray.addEventListener('squeezestart', () => this._grab(h));
      ray.addEventListener('squeezeend', () => { if (h.held) this._release(h); });
      this.xrHands.push(h);
    }
    // قوس الانتقال القفزي
    const N = 30; this.arcPts = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.arcPts, 3));
    this.arc = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x55ddff })); this.arc.visible = false; this.arc.frustumCulled = false;
    this.arcTarget = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x55ddff }));
    this.arcTarget.visible = false; this.scene.add(this.arc, this.arcTarget);
    this.turnReady = true; this.teleportAim = false;
    xr.addEventListener('sessionstart', () => { this.camera.position.set(0, 0, 0); this.pitch = 0; this.camera.rotation.set(0, 0, 0); });
    xr.addEventListener('sessionend', () => { this.camera.position.set(0, EYE, 0); });
  }

  // كل الأيدي النشطة
  get hands() { return this.isXR ? this.xrHands.filter(h => h.gamepad || h.isHand) : [this.desktop]; }

  _handRay(h) {
    if (h.id === 'desktop') {
      this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.mouse, this.camera);   // من موضع مؤشر الماوس
    } else {
      _m.identity().extractRotation(h.ray.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(h.ray.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_m);
    }
    this.raycaster.far = 14;   // اللوحات الكبيرة (شاشة العرض) يمكن الضغط عليها من بعيد؛ الأدوات والأهداف لها حد أقرب
    return this.raycaster;
  }

  // ما الذي تشير إليه اليد: لوحة أو أداة أو هدف قابل للتحديد
  _pick(h) {
    const rc = this._handRay(h);
    const objs = [];
    for (const p of this.panels) if (p.mesh.visible && isShown(p.mesh)) objs.push(p.mesh);
    for (const g of this.grabbables) if (g.enabled && !g.held && isShown(g.object)) objs.push(g.object);
    for (const s of this.selectables) if (s.enabled && isShown(s.object)) objs.push(s.object);
    const hits = rc.intersectObjects(objs, true);
    for (const hit of hits) {
      let o = hit.object;
      if (o.userData.panel) {
        const id = o.userData.panel.hitTest(hit.uv);
        if (id) return { type: 'panel', panel: o.userData.panel, id, point: hit.point, dist: hit.distance };
        continue;
      }
      if (o.userData.grabbable && o.userData.grabbable.enabled && !o.userData.grabbable.held) {
        const g = o.userData.grabbable;
        if (hit.distance < (h.id === 'desktop' ? 2.4 : 4)) return { type: 'grab', g, point: hit.point, dist: hit.distance };
        return null;
      }
      if (o.userData.selectable && o.userData.selectable.enabled && hit.distance < 6) return { type: 'sel', s: o.userData.selectable, point: hit.point, dist: hit.distance };
    }
    return null;
  }

  _press(h) {
    if (h.hover?.type === 'panel') { audio.play('click'); h.hover.panel.click(h.hover.id); return true; }
    if (h.hover?.type === 'sel' && !h.held) { h.hover.s.onSelect?.(h.hover.s); return true; }
    if (h.held && h.held.onUse) { h.held.onUse(); return true; }
    return false;
  }
  _grabToggle(h) { if (h.held) this._release(h); else this._grab(h); }

  _grab(h) {
    if (h.held) return;
    let g = null;
    // أولاً: الأقرب لليد (في النظارة)
    if (h.id !== 'desktop') {
      h.grip.getWorldPosition(_v); let best = 0.14;
      for (const x of this.grabbables) {
        if (!x.enabled || x.held) continue;
        const d = x.object.getWorldPosition(_v2).distanceTo(_v) - x.radius;
        if (d < best) { best = d; g = x; }
      }
    }
    if (!g && h.hover?.type === 'grab') g = h.hover.g;
    if (!g) return;
    // جزء متصل بجهاز (مثل السدادة المربوطة بالخيط): إمساكه يرفع الجهاز من مقبضه
    if (g.grabRedirect) { const r = g.grabRedirect(); if (r) g = r; }
    if (g.held) return;
    if (g.canGrab && !g.canGrab()) { g.emit('denied'); return; }
    if (g.zone) { const z = g.zone; g.zone = null; z.occupant = null; z.onRemove?.(g); }
    g.held = h; h.held = g; g.resting = false; g.vel.set(0, 0, 0); g.userRot = 0; g.userPitch = 0;
    g.grabT = 0; g.grabFrom = g.object.position.clone(); g.grabFromQ = g.object.quaternion.clone();
    g.inspected = true; h.hist = [];
    audio.play('grab'); g.emit('grab', h);
    this._pulse(h, 0.3, 40);
  }

  _release(h) {
    const g = h.held; if (!g) return;
    if (g.canRelease && !g.canRelease(this._nearZone(g))) { g.emit('releaseDenied'); return; }
    h.held = null; g.held = null;
    // سرعة اليد لحظة الإفلات
    if (h.hist.length > 2) {
      const a = h.hist[0], b = h.hist[h.hist.length - 1], dt = Math.max(0.016, b.t - a.t);
      g.vel.copy(b.p).sub(a.p).divideScalar(dt).clampLength(0, 6);
    } else g.vel.set(0, 0, 0);
    // منطقة وضع قريبة؟
    const zone = this._nearZone(g);
    for (const z of this.zones) if (z.ghost) z.ghost.visible = false;
    if (zone) {
      if (zone.accepts(g)) { this._snap(g, zone); g.emit('release', h); return; }
      zone.onReject?.(g); g.emit('rejected', zone);
    }
    g.resting = false; g.emit('release', h);
  }

  _snap(g, z) {
    z.getPose(_v, _q);
    g.vel.set(0, 0, 0); g.resting = true; g.zone = z; z.occupant = g;
    g.snapAnim = { t: 0, from: g.object.position.clone(), fromQ: g.object.quaternion.clone(), to: _v.clone(), toQ: _q.clone() };
    audio.play('place'); z.onSnap?.(g);
  }

  _nearZone(g) {
    let best = null, bd = Infinity;
    g.object.getWorldPosition(_v);
    for (const z of this.zones) {
      if (!z.active || z.occupant) continue;
      z.getPose(_v2, _q);
      const d = _v.distanceTo(_v2);
      if (d < z.radius && d < bd) { bd = d; best = z; }
    }
    return best;
  }

  _pulse(h, i, ms) { try { h.gamepad?.hapticActuators?.[0]?.pulse(i, ms); } catch (e) { } }

  // ---------- الحركة ----------
  get headPos() { return this.camera.getWorldPosition(new THREE.Vector3()); }
  teleportPlayer(pos, yaw = null) {
    this.vel = { x: 0, z: 0 };
    const head = this.headPos;
    this.rig.position.x += pos.x - head.x; this.rig.position.z += pos.z - head.z;
    if (yaw !== null) {
      if (this.isXR) {
        const cur = this._headYaw(); const d = yaw - cur;
        const hp = this.headPos;
        this.rig.position.sub(hp).applyAxisAngle(_v.set(0, 1, 0), d).add(hp); this.rig.rotation.y += d;
      } else { this.rig.rotation.y = yaw; this.pitch = 0; this.camera.rotation.x = 0; }
    }
  }
  _headYaw() { const e = new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(_q), 'YXZ'); return e.y; }
  fade(cb, ms = 450) {
    const f = document.getElementById('fade'); f.style.opacity = 1;
    this._fadeXR = 1;
    setTimeout(() => { cb && cb(); setTimeout(() => { f.style.opacity = 0; this._fadeXR = 0; }, 120); }, ms);
  }
  blocked(x, z, r = RADIUS) {
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    if (this.regions.length && !this.regions.some(R => x > R.minX + r && x < R.maxX - r && z > R.minZ + r && z < R.maxZ - r)) return true;
    return false;
  }
  // يتحرك مع الانزلاق على الجدران؛ يُصفّر مركّبة السرعة المصطدمة
  _move(dx, dz) {
    const h = this.headPos; this.vel ??= { x: 0, z: 0 };
    if (!this.blocked(h.x + dx, h.z)) { this.rig.position.x += dx; h.x += dx; } else this.vel.x = 0;
    if (!this.blocked(h.x, h.z + dz)) this.rig.position.z += dz; else this.vel.z = 0;
  }
  // حركة سلسة: السرعة تتسارع وتتباطأ تدريجياً بدل البدء والتوقف المفاجئ
  _applyWalk(tx, tz, dt, rate) {
    this.vel ??= { x: 0, z: 0 };
    const k = 1 - Math.exp(-rate * dt);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    if (Math.abs(this.vel.x) < 0.005 && Math.abs(this.vel.z) < 0.005 && !tx && !tz) { this.vel.x = this.vel.z = 0; return; }
    this._move(this.vel.x * dt, this.vel.z * dt);
  }

  _updateMovement(dt) {
    if (!this.moveEnabled) return;
    if (!this.isXR) {
      let f = 0, s = 0;
      if (this.locked) {
        if (this.keys.KeyW || this.keys.ArrowUp) f += 1; if (this.keys.KeyS || this.keys.ArrowDown) f -= 1;
        if (this.keys.KeyD || this.keys.ArrowRight) s += 1; if (this.keys.KeyA || this.keys.ArrowLeft) s -= 1;
      }
      const yaw = this.rig.rotation.y, len = Math.hypot(f, s) || 1, sp = WALK / len;
      this._applyWalk((-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp, (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp, dt, 7);
      return;
    }
    // النظارة: العصا اليسرى للمشي (سرعة تتناسب مع ميل العصا)، اليمنى للالتفاف والانتقال القفزي
    let L = null, R = null;
    for (const h of this.xrHands) { if (!h.gamepad) continue; if (h.handedness === 'left') L = h; else R = h; }
    let tx = 0, tz = 0;
    if (L) {
      const ax = L.gamepad.axes, x = ax[2] ?? ax[0], y = ax[3] ?? ax[1], m = Math.hypot(x, y);
      if (m > 0.15) {
        const yaw = this._headYaw(), sp = WALK * Math.min(1, (m - 0.15) / 0.75) / m;
        tx = (Math.cos(yaw) * x + Math.sin(yaw) * y) * sp; tz = (-Math.sin(yaw) * x + Math.cos(yaw) * y) * sp;
      }
    }
    this._applyWalk(tx, tz, dt, 12);
    if (R) {
      const ax = R.gamepad.axes, x = ax[2] ?? ax[0], y = ax[3] ?? ax[1];
      if (this.settings.snapTurn) {
        if (Math.abs(x) > 0.7 && this.turnReady) { this._turn(-Math.sign(x) * THREE.MathUtils.degToRad(this.settings.turnAngle)); this.turnReady = false; }
        if (Math.abs(x) < 0.3) this.turnReady = true;
      } else if (Math.abs(x) > 0.2) this._turn(-x * 1.6 * dt);
      // الانتقال القفزي: ادفع العصا للأمام للتصويب، اتركها للانتقال
      if (y < -0.7 && !R.held) { this.teleportAim = true; this._aimArc(R); }
      else if (this.teleportAim && y > -0.3) {
        this.teleportAim = false; this.arc.visible = false; this.arcTarget.visible = false;
        if (this.arcValid) { const p = this.arcTarget.position.clone(); this.fade(() => this.teleportPlayer(p), 200); }
      }
    }
  }
  _turn(a) {
    const hp = this.headPos;
    this.rig.position.sub(hp).applyAxisAngle(_v.set(0, 1, 0), a).add(hp); this.rig.rotation.y += a;
  }
  _aimArc(h) {
    const o = new THREE.Vector3().setFromMatrixPosition(h.ray.matrixWorld);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(h.ray.getWorldQuaternion(_q)).multiplyScalar(7);
    let p = o.clone(), hit = null; const step = 0.05;
    for (let i = 0; i < 30; i++) {
      this.arcPts.set([p.x, p.y, p.z], i * 3);
      if (!hit) {
        const n = p.clone().addScaledVector(d, step); d.y -= GRAV * step;
        if (n.y <= 0) { hit = n.clone(); hit.y = 0; p = hit; } else p = n;
      }
    }
    this.arc.geometry.attributes.position.needsUpdate = true; this.arc.visible = true;
    this.arcValid = !!hit && !this.blocked(hit.x, hit.z);
    this.arc.material.color.set(this.arcValid ? 0x55ddff : 0xff5555);
    this.arcTarget.visible = !!hit; if (hit) this.arcTarget.position.copy(hit);
    this.arcTarget.material.color.set(this.arcValid ? 0x55ddff : 0xff5555);
  }

  // دفع الرأس خارج الأثاث إذا مشى الطالب جسدياً داخله (في النظارة)
  _pushOut() {
    if (!this.isXR) return;
    const h = this.headPos;
    if (!this.blocked(h.x, h.z, 0.15)) return;
    for (const [dx, dz] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]]) {
      for (let k = 1; k < 30; k++) if (!this.blocked(h.x + dx * k, h.z + dz * k, 0.15)) { this.rig.position.x += dx * k; this.rig.position.z += dz * k; return; }
    }
  }

  // ---------- الأيدي: التأشير والإمساك ----------
  _updateHands(dt) {
    const hint = document.getElementById('hint'), cross = document.getElementById('crosshair');
    let hintText = '';
    for (const g of this.grabbables) g._hl = false;
    for (const h of this.hands) {
      // التأشير
      const prev = h.hover;
      h.hover = h.held ? (() => { const p = this._pick(h); return p && p.type === 'panel' ? p : null; })() : this._pick(h);
      if (prev?.type === 'panel' && (h.hover?.panel !== prev.panel)) prev.panel.setHover(null);
      if (h.hover?.type === 'panel') h.hover.panel.setHover(h.hover.id);
      if (h.hover?.type === 'grab') h.hover.g._hl = true;
      if (h.dot) {
        h.dot.visible = !!h.hover; if (h.hover) h.dot.position.copy(h.hover.point);
        h.line.scale.z = h.hover ? h.hover.dist : 3;
        h.line.visible = !h.held || !!h.hover;
      }
      // اقتراب اليد من أداة في النظارة
      if (h.id !== 'desktop' && !h.held) {
        h.grip.getWorldPosition(_v);
        for (const g of this.grabbables) if (g.enabled && !g.held && g.object.getWorldPosition(_v2).distanceTo(_v) - g.radius < 0.14) g._hl = true;
      }
      if (h.id === 'desktop') {
        if (h.hover?.type === 'grab') hintText = (h.hover.g.hintText && h.hover.g.hintText()) || `${h.hover.g.name} — اضغط E للإمساك`;
        else if (h.hover?.type === 'sel') hintText = h.hover.s.hint || 'انقر للتحديد';
        else if (h.held && h.held.heldHint && h.held.heldHint()) hintText = h.held.heldHint();
        else if (h.held) hintText = `${h.held.name} — E/Q للإفلات · R/العجلة للتدوير · Shift+ماوس للتقليب · F للفحص عن قرب`;
        cross.className = h.hover ? 'on' : '';
      }
      // الأداة الممسوكة تتبع اليد
      if (h.held) {
        const g = h.held, grip = h.id === 'desktop' ? this.desktopHand : h.grip;
        grip.updateWorldMatrix(true, false);
        const tp = new THREE.Vector3(), tq = new THREE.Quaternion();
        if (h.id === 'desktop') {
          const local = new THREE.Vector3().copy(h.inspect ? _v.set(0, -0.02, -0.32) : this.desktopHand.position);
          if (g.holdOffset) local.add(g.holdOffset);
          tp.copy(local).applyMatrix4(this.camera.matrixWorld);
          // مدّ اليد: إذا نظر الطالب إلى سطح طاولة قريب تُحمل الأداة فوق النقطة التي ينظر إليها مباشرة
          if (!h.inspect) {
            // اتجاه مؤشر الماوس (يمدّ الطالب يده نحو ما يشير إليه المؤشر)
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const o = this.raycaster.ray.origin.clone(), dv = this.raycaster.ray.direction.clone();
            let best = 1.7;
            if (dv.y < -0.05 && !g.holdOffset) for (const s of this.surfaces) {
              if (s.disabled) continue;
              const t = (s.y - o.y) / dv.y; if (t <= 0 || t > best) continue;
              const x = o.x + dv.x * t, z = o.z + dv.z * t;
              if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ) { best = t; tp.set(x, s.y + g.halfH + 0.04, z); }
            }
            // إذا وجّه الطالب نظره إلى منطقة تركيب مناسبة قريبة تُحمل الأداة فوقها
            const ray = new THREE.Ray(o, dv), zp = new THREE.Vector3(), zq = new THREE.Quaternion();
            for (const z of this.zones) {
              if (!z.active || z.occupant || !(z.showFor ? z.showFor(g) : true)) continue;
              z.getPose(zp, zq); const along = zp.clone().sub(o).dot(dv);
              if (along > 0 && along < 1.9 && ray.distanceToPoint(zp) < z.radius * 0.8) { tp.copy(zp); break; }
            }
          }
          const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(g.userPitch || 0, this.rig.rotation.y + (g.userRot || 0), 0, 'YXZ'));
          tq.copy(g.uprightHold ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.rig.rotation.y + (g.userRot || 0), 0)) : yawQ);
          // وضعية مسك في العالم (مثل رفع الأنبوب فوق الرأس أثناء التدوير) لا تتبع ميل الكاميرا
          const wh = g.worldHold && g.worldHold(h); if (wh) tp.copy(wh);
        } else {
          grip.getWorldPosition(tp); grip.getWorldQuaternion(tq);
          if (g.uprightHold) tq.setFromEuler(new THREE.Euler(0, new THREE.Euler().setFromQuaternion(tq, 'YXZ').y, 0));
          if (g.holdOffset) tp.add(g.holdOffset.clone().applyQuaternion(tq));
        }
        // انتقال سلس إلى اليد خلال 0.12 ثانية ثم تتبع مباشر
        g.grabT = Math.min(1, g.grabT + dt / 0.12);
        if (g.grabT < 1) { g.object.position.lerpVectors(g.grabFrom, tp, ease(g.grabT)); g.object.quaternion.slerpQuaternions(g.grabFromQ, tq, ease(g.grabT)); }
        else { g.object.position.copy(tp); g.object.quaternion.copy(tq); }
        // منع اختراق سطح الطاولة أثناء الإمساك
        const sup = this.supportBelow(g.object.position, g.radius * 0.6);
        if (g.object.position.y - g.halfH < sup.y) g.object.position.y = sup.y + g.halfH;
        h.hist.push({ p: g.object.position.clone(), t: this.time }); if (h.hist.length > 6) h.hist.shift();
        // مؤشر منطقة الوضع
        for (const z of this.zones) if (z.ghost) z.ghost.visible = false;
        if (g.held) {
          g.object.getWorldPosition(_v);
          for (const z of this.zones) {
            if (!z.active || z.occupant || !z.ghost) continue;
            z.getPose(_v2, _q);
            const d = _v.distanceTo(_v2);
            if (d < z.radius * 2.5 && (z.showFor ? z.showFor(g) : true)) {
              z.ghost.visible = true; z.ghost.position.copy(_v2); z.ghost.quaternion.copy(_q);
              const ok = z.accepts(g);
              z.ghost.material.color.set(ok ? (d < z.radius ? 0x33ff88 : 0x33aa66) : 0xff4444);
              z.ghost.material.opacity = d < z.radius ? 0.55 : 0.25;
            }
          }
        }
      }
    }
    // إبراز الأداة المستهدفة واسمها
    for (const g of this.grabbables) {
      setGlow(g.object, g._hl && !g.held);
      const show = g._hl && !g.held;
      g.label.mesh.visible = show;
      if (show) { g.object.getWorldPosition(g.label.mesh.position); g.label.mesh.position.y += g.halfH + 0.07; }
    }
    if (!this.isXR) {
      hint.style.display = this.locked && hintText ? 'block' : 'none'; hint.textContent = bidi(hintText);
      // التلميح بجانب مؤشر الماوس، وشكل المؤشر يدل على ما سيحدث عند النقر
      if (this.mousePx) { hint.style.left = this.mousePx[0] + 'px'; hint.style.top = (this.mousePx[1] + 26) + 'px'; }
      const hv = this.desktop.hover;
      this.renderer.domElement.style.cursor = this.dragging ? 'grabbing' : hv?.type === 'panel' || hv?.type === 'sel' ? 'pointer' : hv?.type === 'grab' ? 'grab' : 'default';
    }
  }

  // أعلى سطح تحت نقطة
  supportBelow(p, r = 0) {
    let best = { y: 0, kind: 'floor' };
    for (const s of this.surfaces) {
      if (s.disabled) continue;
      if (p.x > s.minX - r && p.x < s.maxX + r && p.z > s.minZ - r && p.z < s.maxZ + r && s.y <= p.y + 0.02 && s.y > best.y) best = s;
    }
    return best;
  }

  // ---------- فيزياء بسيطة للأجسام المفلوتة ----------
  _updatePhysics(dt) {
    for (const g of this.grabbables) {
      if (g.snapAnim) {
        const a = g.snapAnim; a.t = Math.min(1, a.t + dt / 0.18);
        g.object.position.lerpVectors(a.from, a.to, ease(a.t)); g.object.quaternion.slerpQuaternions(a.fromQ, a.toQ, ease(a.t));
        if (a.t >= 1) g.snapAnim = null;
        continue;
      }
      if (g.held || g.resting || g.locked || g.zone) continue;
      const p = g.object.position;
      g.vel.y -= GRAV * dt;
      const steps = 3, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        p.addScaledVector(g.vel, h);
        // الجدران والأثاث جانبياً
        for (const c of this.colliders) {
          if (c.disabled || p.y - g.halfH > c.top - 0.01) continue;
          if (p.x > c.minX - g.radius && p.x < c.maxX + g.radius && p.z > c.minZ - g.radius && p.z < c.maxZ + g.radius) {
            const dx1 = p.x - (c.minX - g.radius), dx2 = c.maxX + g.radius - p.x, dz1 = p.z - (c.minZ - g.radius), dz2 = c.maxZ + g.radius - p.z;
            const m = Math.min(dx1, dx2, dz1, dz2);
            if (m === dx1) { p.x -= dx1; g.vel.x = -Math.abs(g.vel.x) * 0.3; } else if (m === dx2) { p.x += dx2; g.vel.x = Math.abs(g.vel.x) * 0.3; }
            else if (m === dz1) { p.z -= dz1; g.vel.z = -Math.abs(g.vel.z) * 0.3; } else { p.z += dz2; g.vel.z = Math.abs(g.vel.z) * 0.3; }
          }
        }
        const sup = this.supportBelow(_v.set(p.x, p.y - g.halfH + 0.03, p.z));
        if (p.y - g.halfH <= sup.y) {
          p.y = sup.y + g.halfH;
          const impact = -g.vel.y;
          if (impact > 0.6) {
            audio.play(sup.kind === 'floor' ? 'drop' : 'place', impact / 3);
            g.vel.y = impact * 0.25; g.vel.x *= 0.6; g.vel.z *= 0.6;
          } else {
            g.vel.set(0, 0, 0); g.resting = true;
            if (impact > 0.05) audio.play('place', 0.4);
            g.emit('rest', sup);
          }
        }
      }
      // ينتصب الجسم تدريجياً عند الاستقرار (يحافظ على اتجاهه الأفقي)
      if (!g.noUpright) {
        const e = new THREE.Euler().setFromQuaternion(g.object.quaternion, 'YXZ');
        _q.setFromEuler(new THREE.Euler(0, e.y, 0)); g.object.quaternion.slerp(_q, Math.min(1, dt * 8));
      } else g.object.rotateX(dt * 2);
    }
    // فصل الأجسام المتراكبة على السطح نفسه
    const rs = this.grabbables.filter(g => g.resting && !g.zone && !g.held && !g.locked && g.object.visible);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i].object.position, b = rs[j].object.position;
      if (Math.abs(a.y - b.y) > rs[i].halfH + rs[j].halfH) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = rs[i].radius + rs[j].radius;
      if (d < min && d > 1e-4) { const push = (min - d) / 2; a.x -= dx / d * push; a.z -= dz / d * push; b.x += dx / d * push; b.z += dz / d * push; }
      else if (d <= 1e-4) b.x += 0.01;
    }
  }

  _tick() {
    const dt = Math.min(0.05, this.clock.getDelta()); this.time += dt;
    if (!this.paused || this.isXR) {
      this._updateMovement(dt); this._pushOut();
      this._updateHands(dt); this._updatePhysics(dt);
      for (const f of [...this.updates]) f(dt, this.time);
      // اللوحات والأسماء تواجه الطالب
      const cam = this.camera.getWorldPosition(_v);
      for (const g of this.grabbables) if (g.label.mesh.visible) g.label.mesh.lookAt(cam);
      this.scene.traverseVisible(o => { if (o.userData.billboardY) { o.lookAt(cam.x, o.getWorldPosition(_v2).y, cam.z); } });
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function isShown(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
function setGlow(obj, on) {
  if (obj.userData._glow === on) return; obj.userData._glow = on;
  obj.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.emissive) return;
    if (o.userData._baseEm === undefined) o.userData._baseEm = o.material.emissive.getHex();
    o.material.emissive.setHex(on ? 0x554411 : o.userData._baseEm);
  });
}
