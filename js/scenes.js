import * as THREE from 'three';
import { Panel, Label, FONT, COLORS } from './ui.js';
import { Grabbable } from './core.js';
import { audio } from './audio.js';
import { Q, VO, SUMMARY, SCENES, RULES } from './content.js';
import { FIELD, STATION, SWING, SAFE_R } from './lab.js';
import { G, M_STOPPER } from './station.js';
import { drawCertificate, certificateCanvas } from './certificate.js';

// اسم الطالب للشهادة (يُكتب في شاشة البداية أو من زر «تعديل الاسم»)
const NAME_KEY = 'circular-motion-vr-name';
export const studentName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
export const saveStudentName = n => { try { localStorage.setItem(NAME_KEY, n); } catch {} };
function downloadCertificate(data) {
  const a = document.createElement('a');
  a.download = `شهادة-الحركة-الدائرية${data.name ? '-' + data.name : ''}.png`;
  a.href = certificateCanvas(data).toDataURL('image/png');
  document.body.appendChild(a); a.click(); a.remove();
}

// ================================================================
// المشاهد الخمسة S0 → S4
// ================================================================

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const isDesk = e => !e.isXR;
// عزل التعابير الرياضية (من اليسار لليمين) داخل النص العربي
const ltr = s => '⁦' + s + '⁩';

// سهم ثلاثي الأبعاد (أسطوانة + مخروط) قابل للتحديد بالمؤشر
function arrow(color, len = 0.5, r = 0.018) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12), m); shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, r * 6, 16), m);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(r * 4, r * 4, 1, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.y = 0.5;
  g.add(shaft, head, hit); g.userData = { shaft, head, hit, r };
  g.setLen = L => { shaft.scale.y = L - r * 6; shaft.position.y = (L - r * 6) / 2; head.position.y = L - r * 3; hit.scale.y = L; hit.position.y = L / 2; };
  g.point = (from, dir) => { g.position.copy(from); g.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize()); };
  g.setLen(len); return g;
}
function dashed(color, pts) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08 }));
  l.computeLineDistances(); l.frustumCulled = false; return l;
}

// خط سميك (متقطع اختيارياً) مكوّن من أسطوانات — خطوط WebGL عرضها بكسل واحد ولا تُرى جيداً في النظارة
function thick(color, pts, { r = 0.008, dash = 0.1, gap = 0.06 } = {}) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = a.distanceTo(b), dir = b.clone().sub(a).normalize();
    const step = gap ? dash + gap : L;
    for (let t = 0; t < L; t += step) {
      const len = Math.min(gap ? dash : L, L - t), seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), m);
      seg.position.copy(a).addScaledVector(dir, t + len / 2); seg.quaternion.setFromUnitVectors(V(0, 1, 0), dir); g.add(seg);
    }
  }
  return g;
}

export class Scenes {
  constructor(engine, world, chars, station, director) {
    this.e = engine; this.W = world; this.c = chars; this.st = station; this.d = director;
    this.st.on('error', msg => { this.d.sub = '⚠ ' + msg; this.d.guide.redraw(); audio.play('wrong'); this.errors = (this.errors || 0) + 1; });
    // الشخصيات تنظر إلى الطالب عند الحديث
    engine.addUpdate(dt => {
      const head = engine.headPos;
      for (const k of ['teacher', 'student', 'classmate']) { const ch = this.c[k]; if (ch.lookAtPlayer && !ch.walkTarget) ch.face(head, dt); }
    });
    this._placeCharacters();
  }
  _placeCharacters() {
    const { teacher, thrower, student, classmate } = this.c;
    teacher.root.position.set(-3.1, 0, -4.35); teacher.root.rotation.y = 0.3; teacher.lookAtPlayer = true;
    thrower.root.position.copy(FIELD);
    student.root.position.set(0.6, 0, 2.9); student.lookAtPlayer = true;
    classmate.root.position.set(1.6, 0, 2.6); classmate.lookAtPlayer = true;
  }

  async run(startIdx = 0) {
    const list = [this.S0, this.S1, this.S2, this.S3, this.S4];
    this._buildWearables(); if (startIdx > 0) this._wearAll();   // عند الاستئناف يكون الطالب قد ارتداهما
    this.d.onSkip = () => this.skip();
    for (let i = startIdx; i < list.length; i++) {
      this.d.startScene(i);
      const rec = this._record();
      const r = await Promise.race([
        (async () => { await list[i].call(this); if (i < list.length - 1) await this._sceneEnd(i); return 'done'; })(),
        new Promise(res => { this._skipRes = () => res('skip'); }),
      ]);
      this._skipRes = null; this._stopRecord(rec);
      if (r === 'skip') {
        this._cleanup(rec); this._afterSkip(i);
        if (i === list.length - 1) { await this.results(); return; }
      }
    }
  }

  // ---------- تخطّي المشهد (زر مؤقت للمراجعة؛ يُزال لاحقاً) ----------
  skip() { if (this._skipRes) { this.d.abort(); audio.play('transition'); this._skipRes(); } }
  // نسجّل كل ما يضيفه المشهد (تحديثات، لوحات، مجسمات، أهداف) لنزيله إن تخطّاه الطالب
  _record() {
    const e = this.e, rec = { ups: [], panels: [], objs: [], sels: [], orig: {} };
    rec.orig = { addUpdate: e.addUpdate, registerPanel: e.registerPanel, add: e.scene.add, addSelectable: e.addSelectable };
    e.addUpdate = fn => { rec.ups.push(fn); return rec.orig.addUpdate.call(e, fn); };
    e.registerPanel = p => { rec.panels.push(p); return rec.orig.registerPanel.call(e, p); };
    e.scene.add = (...o) => { rec.objs.push(...o); return rec.orig.add.apply(e.scene, o); };
    e.addSelectable = (o, opts) => { const s = rec.orig.addSelectable.call(e, o, opts); rec.sels.push(s); return s; };
    return rec;
  }
  _stopRecord(rec) { const e = this.e; e.addUpdate = rec.orig.addUpdate; e.registerPanel = rec.orig.registerPanel; e.scene.add = rec.orig.add; e.addSelectable = rec.orig.addSelectable; }
  _cleanup(rec) {
    const e = this.e;
    audio.stopSpeech(); audio.setWhirl(0);
    for (const fn of rec.ups) if (!fn.keep) e.removeUpdate(fn);
    for (const p of rec.panels) if (!p.keep) e.unregisterPanel(p);
    for (const o of rec.objs) if (!o.userData.keep && !o.userData.panel) o.parent?.remove(o);
    for (const s of rec.sels) e.removeSelectable(s);
    // إفلات أي أداة في اليد
    for (const h of [e.desktop, ...e.xrHands]) if (h.held) { h.held.held = null; h.held = null; }
    for (const z of e.zones) if (z.ghost) z.ghost.visible = false;
    for (const k of ['teacher', 'student', 'classmate']) { const ch = this.c[k]; ch.overrides.length = 0; ch.walkTarget = null; ch.play('idle'); ch.lookAtPlayer = true; }
  }
  _afterSkip(i) {
    const e = this.e, st = this.st, { teacher, student, classmate } = this.c;
    if (i === 0) {
      this._wearAll(); this._clearHammer();
      teacher.root.position.set(-3.1, 0, -4.35); student.root.position.set(0.6, 0, 2.9); classmate.root.position.set(1.6, 0, 2.6);
    }
    if (i === 2) { st.sim.active = false; st.sim.allowSpin = false; st.panel.mesh.visible = false; }
    if (i <= 2) { st.resetTools(); st.setAssembly(false); }
    // إن كان الطالب خارج المختبر ننقله إلى داخله
    const h = e.headPos; if (h.x < -20 || h.z > 5.5) e.teleportPlayer(V(1.0, 0, 2.5), yawTo(V(1.0, 0, 2.5), V(STATION.x, 0, STATION.z)));
  }
  async _sceneEnd(i) {
    const sc = SCENES[i], t = this.d.score.sceneTotal(sc.id);
    this.d.setStep(`انتهى المشهد ${sc.id}`, SCENES[i + 1].name, '');
    await this.d.info({ tag: `${sc.id} · ${sc.purpose}`, title: `أكملت: ${sc.name}`, body: `نقاط المشهد: ${t.e} من ${sc.max}${sc.counted ? '' : ' (قبلي — لا يدخل في الدرجة النهائية)'}` },
      { w: 0.9, h: 0.45, buttons: [{ id: 'ok', label: `انتقل إلى ${SCENES[i + 1].id}`, bold: true, color: '#2f7d5b' }] });
  }

  // =============================================================
  // S0 · التهيئة
  // =============================================================
  async S0() {
    const d = this.d, e = this.e;
    this.st.all.forEach(g => g.enabled = false);
    // --- اللقطة 1: ساحة رمي المطرقة ---
    const view = FIELD.clone().add(V(5.2, 0, 4.6));
    e.teleportPlayer(view, yawTo(view, FIELD.clone().add(V(0, 0, -2))));
    d.setStep('شاهد رامي المطرقة', 'ادخل المختبر', '');
    let again = 'again';
    const voP = d.say('s0_1');
    while (again === 'again') {
      await this.hammerThrow();
      again = await d.info({ title: 'لاحظ اتجاه انطلاق المطرقة لحظة الإفلات', body: 'السلك المشدود كان يسحب المطرقة نحو المركز (السهم البرتقالي). لحظة الإفلات انطلقت في اتجاه سرعتها (السهم الأزرق)، أي مماسياً للدائرة.' },
        // ثابتة إلى يسار الطالب (السبورة على يمينه) فلا تتغطى ولا تحجب الرامي
        { w: 1.0, h: 0.55, place: { pos: FIELD.clone().add(V(3.95, 0.95, 3.5)), lookAt: view.clone().setY(1.6) }, buttons: [{ id: 'again', label: '↻ شاهد مرة أخرى' }, { id: 'go', label: 'ادخل المختبر', bold: true, color: '#2f7d5b' }] });
    }
    await voP; this._clearHammer();
    // --- الانتقال إلى المختبر ---
    audio.play('transition');
    await new Promise(r => e.fade(() => { e.teleportPlayer(V(0, 0, 9.4), 0); r(); }, 500));
    await this.dress();
    d.setStep('ادخل المختبر واقترب من المعلم بجانب شاشة العرض', 'موقف السلامة');
    d.say('s0_lab');
    this.W.screen.set({ title: 'ما الذي يُبقي الجسم في الدائرة؟', body: 'اليوم: سدادة مطاطية · خيط · ميزان نابضي', titleSize: 80, bodySize: 46, bg: '#14304a' });
    await d.until(() => e.headPos.distanceTo(this.c.teacher.root.position.clone().setY(e.headPos.y)) < 2.6);
    // --- اللقطة 2: خطران في المحطة ---
    await this.safety();
    // --- اللقطة 3: سؤال البداية (قبلي) ---
    d.setStep('أجب عن سؤال البداية', 'المشهد S1');
    d.say('s0_3');
    const r = await d.ask(Q.pre, { scene: 'S0', h: 1.2, draw: topViewDraw, noScore: true, place: { pos: V(-1.2, 1.55, -4.6), lookAt: e.headPos } });
    d.score.d.pre = { choice: r.choice, correct: r.correct }; d.score.save();
  }

  // محاكاة رمي المطرقة: تسارع زاوي حقيقي ثم إفلات بسرعة مماسية + جاذبية
  hammerThrow() {
    const e = this.e, th = this.c.thrower, C = FIELD.clone(), R = 1.75, Y = 1.05;
    this._clearHammer();
    const grp = this.hGroup = new THREE.Group(); e.scene.add(grp);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.9, roughness: 0.3 })); ball.castShadow = true;
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0x222222 })); wire.frustumCulled = false;
    const ring = dashed(0xffffff, Array.from({ length: 65 }, (_, i) => V(C.x + Math.cos(i / 64 * Math.PI * 2) * R, Y, C.z - Math.sin(i / 64 * Math.PI * 2) * R)));
    ring.material.transparent = true; ring.material.opacity = 0.0;
    const vA = arrow(0x3aa0ff, 0.9, 0.025), fA = arrow(0xff6a3d, 0.7, 0.025); vA.visible = fA.visible = false;
    const vL = new Label('السرعة (مماسية)', { w: 0.5, h: 0.09, size: 44, bg: '#1d5a99' }), fL = new Label('القوة نحو المركز', { w: 0.5, h: 0.09, size: 44, bg: '#a8401f' });
    vL.mesh.visible = fL.mesh.visible = false;
    grp.add(ball, wire, ring, vA, fA, vL.mesh, fL.mesh);
    th.play(th.has('point') ? 'point' : 'idle');
    let theta = Math.PI, omega = 1.5, t = 0, phase = 'spin', vel = V(), slow = 0, released = null;
    return new Promise(done => {
      const fn = (dt0) => {
        const dt = dt0 * (slow > 0 ? 0.3 : 1); if (slow > 0) slow -= dt0;
        t += dt;
        if (phase === 'spin') {
          omega = Math.min(8.0, 1.5 + t * 1.1);                     // تسارع زاوي منتظم حتى 8 rad/s (v ≈ 14 m/s)
          const prev = theta; theta += omega * dt;
          ball.position.set(C.x + Math.cos(theta) * R, Y, C.z - Math.sin(theta) * R);
          const tang = V(-Math.sin(theta), 0, -Math.cos(theta)), toC = C.clone().setY(Y).sub(ball.position).normalize();
          th.root.rotation.y = Math.atan2(ball.position.x - C.x, ball.position.z - C.z);
          ring.material.opacity = Math.min(0.7, t * 0.25);
          if (t > 2.5) {
            vA.visible = fA.visible = vL.mesh.visible = fL.mesh.visible = true;
            vA.point(ball.position, tang); fA.point(ball.position, toC);
            vL.mesh.position.copy(ball.position).addScaledVector(tang, 1.0).y += 0.12; fL.mesh.position.copy(ball.position).addScaledVector(toC, 0.85).y += 0.15;
          }
          // الإفلات عند عبور θ لمضاعف 2π (السرعة حينها نحو قطاع الرمي)
          if (t > 6.2 && Math.floor(prev / (2 * Math.PI)) !== Math.floor(theta / (2 * Math.PI))) {
            phase = 'fly'; slow = 1.4; audio.play('cut');
            const v = omega * R; vel.copy(tang).multiplyScalar(v); vel.y = v * 0.55;
            released = ball.position.clone();
            fA.visible = fL.mesh.visible = false;
            const g1 = dashed(0x3aa0ff, [V(released.x, 0.02, released.z), V(released.x, 0.02, released.z - 40)]); grp.add(g1);
            const gl = new Label('اتجاه الانطلاق = اتجاه السرعة لحظة الإفلات (مماس)', { w: 1.6, h: 0.12, size: 46, bg: '#1d5a99' });
            gl.mesh.position.set(released.x + 0.3, 2.1, released.z - 2.5); grp.add(gl.mesh);
            th.play(th.has('look') ? 'look' : 'idle');
          }
        } else if (phase === 'fly') {
          vel.y -= G * dt; ball.position.addScaledVector(vel, dt);
          vA.point(ball.position, vel.clone().setY(0)); vL.mesh.position.copy(ball.position).y += 0.3;
          if (ball.position.y <= 0.065) { ball.position.y = 0.065; phase = 'land'; audio.play('drop', 1); vA.visible = vL.mesh.visible = false; t = 0; }
        } else if (phase === 'land') { if (t > 1.2) { e.removeUpdate(fn); th.play('idle'); done(); } }
        // السلك من يد الرامي إلى المطرقة
        if (phase === 'spin') { const hp = th.bonePos('R_Hand'); const p = wire.geometry.attributes.position; p.setXYZ(0, hp.x, hp.y, hp.z); p.setXYZ(1, ball.position.x, ball.position.y, ball.position.z); p.needsUpdate = true; wire.visible = true; }
        else wire.visible = false;
      };
      e.addUpdate(fn);
    });
  }
  _clearHammer() { if (this.hGroup) { this.e.scene.remove(this.hGroup); this.hGroup = null; } }

  // موقف السلامة: اكتشاف خطرين بالتأشير ثم اختيار الإجراء الصحيح
  async safety() {
    const d = this.d, e = this.e, { student, classmate } = this.c;
    student.lookAtPlayer = classmate.lookAtPlayer = false;
    student.root.position.set(SWING.x, 0, SWING.z); classmate.root.position.set(SWING.x + 0.75, 0, SWING.z + 0.35);
    student.face(classmate.root.position, 1); classmate.face(student.root.position, 1);
    student.play('idle'); classmate.play(classmate.has('look') ? 'look' : 'idle');
    // الطالب يمسك الأنبوب بيده اليمنى ويحرك يده في دوائر صغيرة فوق رأسه، فتدور السدادة حوله
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
    const tube = new THREE.Group(); e.scene.add(tube);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.75 }));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.08, 16), mat(0x2a2a2a)); grip.position.y = -0.04;
    tube.add(glass, grip);
    const prop = new THREE.Group(); e.scene.add(prop);
    const stp = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.025, 16), mat(0x8a3b22));
    const loose = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, 6, 16, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }));
    loose.position.y = 0.04; const hitS = new THREE.Mesh(new THREE.SphereGeometry(0.16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    prop.add(stp, loose, hitS);
    // منطقة إصابة غير مرئية على طول مسار السدادة (يسهل تحديدها وهي تدور بسرعة)
    const hitRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.17, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    e.scene.add(hitRing);
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0xb08d3c, metalness: 0.7, roughness: 0.35 })); e.scene.add(weight);
    const line = () => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0xffffff })); l.frustumCulled = false; e.scene.add(l); return l; };
    const str = line(), strLow = line();
    const setL = (l, a, b) => { const p = l.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; };
    let th = 0, omega = 7.2, whirl = true, armUp = 1;   // ≈ 1.1 دورة/ث: الخيط يميل قليلاً تحت الأفق
    // يُنفَّذ بعد تحديث الحركة: يضع اليد بالحل العكسي ثم يلحق الأنبوب باليد
    const arm = ch => {
      if (!ch.ready) return;
      const S = ch.bonePos('R_UpperArm'), Lsh = ch.bonePos('L_UpperArm');
      const side = S.clone().sub(Lsh).setY(0).normalize();                         // اتجاه اليمين لجسم الطالب
      const fwd = V(Math.sin(ch.root.rotation.y), 0, Math.cos(ch.root.rotation.y));
      // اليد فوق الرأس قليلاً وتدور في دائرة صغيرة متقدمة على السدادة بربع دورة (هي التي تسحبها)
      const up = V(0, 0.42 * armUp, 0).addScaledVector(side, 0.06).addScaledVector(fwd, 0.1 + (1 - armUp) * 0.22);
      const lead = th + Math.PI / 2, hr = whirl ? 0.045 : 0;
      const target = S.clone().add(up).add(V(Math.cos(lead) * hr, 0, -Math.sin(lead) * hr));
      ch.armIK('R', target, side.clone().add(V(0, -0.6, 0)));
    };
    student.overrides.push(arm);
    const spin = dt => {
      if (!student.ready) return;
      th += omega * dt;
      if (!whirl) { omega = Math.max(0, omega - 2.5 * dt); armUp = Math.max(0.15, armUp - dt * 0.8); }
      const hp = student.bonePos('R_Hand');
      tube.position.copy(hp).add(V(0, 0.06, 0)); tube.rotation.set(0, 0, 0);
      const top = tube.position.clone().add(V(0, 0.075, 0)), bot = tube.position.clone().add(V(0, -0.075, 0));
      // السدادة: بندول مخروطي حول فوهة الأنبوب (يتدلى حين تتوقف)
      const L = 0.55, w2 = omega * omega, sinP = w2 > 0 ? Math.min(1, G / (w2 * L)) : 1, cosP = Math.sqrt(1 - sinP * sinP);
      prop.position.set(top.x + Math.cos(th) * L * cosP, top.y - L * sinP, top.z - Math.sin(th) * L * cosP);
      hitRing.visible = whirl; hitRing.position.set(top.x, top.y - L * sinP, top.z); hitRing.scale.setScalar(Math.max(0.05, L * cosP));
      loose.rotation.z = Math.sin(e.time * 9) * 0.6;
      weight.position.copy(bot).add(V(0, -0.22, 0));
      setL(str, top, prop.position.clone().add(V(0, 0.015, 0))); setL(strLow, bot, weight.position.clone().add(V(0, 0.02, 0)));
    };
    e.addUpdate(spin);
    d.setStep('اكتشف خطرين في محطة الدوران وأشِر إلى كل منهما', 'اختر الإجراء الصحيح لكل خطر');
    await d.say('s0_2');
    const found = { mate: false, knot: false }; let hinted = false, lastFind = e.time;
    const rings = [];
    const showHint = () => {
      hinted = true;
      // حلقة على الأرض حول قدمي الزميل، وحلقة صغيرة حول السدادة (لا تحجبان شيئاً)
      const mk = (r0, r1) => new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: 0xff9f1a, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
      const fr = mk(0.3, 0.34); fr.rotation.x = -Math.PI / 2; fr.userData.floor = classmate.root; e.scene.add(fr); rings.push(fr);
      const sr = mk(0.07, 0.085); sr.userData.target = prop; e.scene.add(sr); rings.push(sr);
      d.setStep('تلميح: انظر إلى من يقف داخل الدائرة الصفراء، وإلى عقدة الخيط عند السدادة', 'اختر الإجراء الصحيح');
    };
    const ringUpd = () => {
      for (const r of rings) {
        const s = 1 + Math.sin(e.time * 5) * 0.08;
        if (r.userData.floor) { r.position.copy(r.userData.floor.position); r.position.y = 0.01; r.scale.set(s, s, s); }
        else { r.position.copy(r.userData.target.position); r.lookAt(e.headPos); r.scale.setScalar(s); r.visible = whirl; }
      }
    };
    e.addUpdate(ringUpd);
    const onWrong = (name) => { d.sub = `«${name}» ليس خطراً. ابحث مرة أخرى.`; d.guide.redraw(); audio.play('wrong'); };
    const sels = [];
    sels.push(e.addSelectable(classmate.root, { hint: 'انقر: هذا خطر؟', onSelect: () => handle('mate') }));
    sels.push(e.addSelectable(prop, { hint: 'انقر: هذا خطر؟', onSelect: () => handle('knot') }));
    sels.push(e.addSelectable(hitRing, { hint: 'انقر: هذا خطر؟', onSelect: () => handle('knot') }));
    for (const [obj, name] of [[this.st.stopwatch.object, 'ساعة الإيقاف'], [this.st.ruler.object, 'المسطرة'], [this.st.balDisp.mesh.parent, 'الميزان']])
      sels.push(e.addSelectable(obj, { hint: 'انقر: هذا خطر؟', onSelect: () => onWrong(name) }));
    let busy = false;
    const handle = async (which) => {
      if (busy || found[which]) return; busy = true; found[which] = true; lastFind = e.time; audio.play('correct');
      const pts = hinted ? 5 : 10;
      d.score.set('S0', which === 'mate' ? 'AM-03a' : 'AM-03b', pts, 10, { hint: hinted });
      const q = which === 'mate' ? Q.safetyAction1 : Q.safetyAction2;
      const r = await d.ask(q, { scene: 'S0', maxAttempts: 2, noScore: true, h: 0.75 });
      if (!r.correct) { d.score.d.critical.safety = true; d.score.save(); }
      if (which === 'mate') { classmate.walkTo(V(1.6, 0, 2.6)).then(() => { classmate.lookAtPlayer = true; }); }
      else { whirl = false; loose.visible = false; }   // يتوقف تدريجياً وتنخفض يده، ثم تُشد العقدة
      busy = false;
    };
    // تلميح بعد 6 ثوانٍ دون اكتشاف
    await d.until(() => { if (!hinted && e.time - lastFind > 6 && !(found.mate && found.knot)) showHint(); return found.mate && found.knot && !busy; });
    e.removeUpdate(ringUpd); rings.forEach(r => e.scene.remove(r)); sels.forEach(s => e.removeSelectable(s));
    whirl = false; await d.until(() => omega === 0 && armUp <= 0.15);
    e.removeUpdate(spin); e.scene.remove(prop, str, strLow, tube, weight, hitRing);
    student.overrides.splice(student.overrides.indexOf(arm), 1);
    d.say('s0_safe');
    student.walkTo(V(0.6, 0, 2.9)).then(() => { student.lookAtPlayer = true; });
    await d.wait(1.5);
  }

  // =============================================================
  // ارتداء النظارة الواقية والبالطو قبل دخول المختبر (الباب مغلق حتى يرتديهما الطالب)
  // =============================================================
  _buildWearables() {
    if (this.wear) return this.wear;
    const e = this.e, sc = e.scene, W = this.wear = { goggles: false, coat: false };
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.85 });
    // داخل المختبر مباشرة، على الجدار عن يسار الداخل: مشجب للبالطو ورف للنظارات ولافتة صغيرة
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.06), wood); rail.position.set(-2.3, 1.8, 5.96); sc.add(rail);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), wood); shelf.position.set(-3.25, 1.1, 5.85); sc.add(shelf);
    e.surfaces.push({ minX: -3.5, maxX: -3.0, minZ: 5.7, maxZ: 6.0, y: 1.115, kind: 'table' });
    const sign = new Label('ارتدِ النظارة الواقية والبالطو', { w: 0.9, h: 0.1, size: 54, bg: '#b3261e' });
    sign.mesh.position.set(-2.6, 2.2, 5.99); sign.mesh.rotation.y = Math.PI; sign.mesh.userData.billboard = false; sc.add(sign.mesh); W.sign = sign.mesh;
    // البالطو معلّق
    const coat = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.07), white); body.position.y = -0.45;
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.08), white); collar.position.y = -0.02;
    const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 12, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7 })); hanger.position.y = 0.04;
    coat.add(body, collar, hanger);
    for (const s of [-1, 1]) { const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.62, 10), white); sl.position.set(s * 0.29, -0.38, 0); sl.rotation.z = s * 0.08; coat.add(sl); }
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.01), new THREE.MeshStandardMaterial({ color: 0xe0e0da })); pocket.position.set(0.13, -0.3, 0.04); coat.add(pocket);
    coat.traverse(o => o.castShadow = true);
    coat.position.set(-2.0, 1.76, 5.9); coat.rotation.y = Math.PI; sc.add(coat);
    const gc = e.addGrabbable(new Grabbable(coat, { name: 'البالطو (معطف المختبر)', info: 'يحمي ملابسك وجلدك.', halfH: 0.45, radius: 0.3 }));
    gc.locked = true; gc.on('grab', () => { gc.locked = false; });
    // النظارة الواقية على الرف
    const gog = new THREE.Group();
    const lensM = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.5, roughness: 0.1 });
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.02), lensM); l.position.x = s * 0.042; gog.add(l); }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.012), new THREE.MeshStandardMaterial({ color: 0x223344, transparent: true, opacity: 0.85 })); frame.position.z = -0.012; gog.add(frame);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1d1d1d })); strap.rotation.x = Math.PI / 2; strap.position.z = -0.01; gog.add(strap);
    gog.position.set(-3.25, 1.145, 5.85); gog.rotation.y = Math.PI; sc.add(gog);
    const gg = e.addGrabbable(new Grabbable(gog, { name: 'النظارة الواقية', info: 'تحمي عينيك إن انفلتت السدادة.', halfH: 0.03, radius: 0.08 }));
    // الارتداء: الضغط بالزر أثناء الإمساك، أو تقريب القطعة من الرأس في النظارة
    // الارتداء بحركة: القطعة تنتقل من اليد إلى الوجه (النظارة) أو تُلبس على الكتفين (البالطو) ثم تصبح على الطالب
    const wear = (g, key, instant = false) => {
      if (W[key]) return; W[key] = true;
      for (const h of [e.desktop, ...e.xrHands]) if (h.held === g) h.held = null;
      g.held = null; g.enabled = false; g.locked = true; g.label.mesh.visible = false;
      const done = () => {
        g.object.visible = false;
        if (key === 'goggles') document.getElementById('goggles').classList.add('on');
        if (key === 'coat') this._showCoat();
      };
      if (instant) return done();
      audio.play('grab');
      const from = g.object.position.clone(), fromQ = g.object.quaternion.clone(); let t = 0;
      const fn = dt => {
        t = Math.min(1, t + dt / 0.6);
        const head = e.headPos, yaw = new THREE.Euler().setFromQuaternion(e.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
        const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw));
        // النظارة إلى أمام العينين، والبالطو يرتفع فوق الكتفين ثم ينزل خلفهما
        const to = key === 'goggles' ? head.clone().addScaledVector(fwd, 0.07) : head.clone().addScaledVector(fwd, -0.15).add(V(0, -0.55 + Math.sin(t * Math.PI) * 0.35, 0));
        const k = t * t * (3 - 2 * t);
        g.object.position.lerpVectors(from, to, k);
        g.object.quaternion.slerpQuaternions(fromQ, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + Math.PI, 0)), k);
        if (t >= 1) { e.removeUpdate(fn); done(); audio.play('correct'); }
      };
      e.addUpdate(fn);
    };
    gg.onUse = () => wear(gg, 'goggles'); gc.onUse = () => wear(gc, 'coat');
    e.addUpdate(() => {
      const head = e.headPos;
      for (const [g, key, r] of [[gg, 'goggles', 0.22], [gc, 'coat', 0.5]])
        if (g.held && g.held.id !== 'desktop' && g.object.getWorldPosition(V()).distanceTo(head) < r) wear(g, key);
    });
    W.wearFn = wear;
    W.items = { gg, gc };
    return W;
  }
  _showCoat() {
    const e = this.e; if (this.coatWorn) return;
    // ما يراه الطالب من البالطو حين ينظر إلى نفسه: جذع أبيض مفتوح من الأمام فوق قميص
    const g = this.coatWorn = new THREE.Group();
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.26, 0.95, 24, 1, true, Math.PI * 0.12, Math.PI * 1.76), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide, roughness: 0.85 }));
    const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.9, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x5b7fa6, roughness: 0.9, side: THREE.DoubleSide }));
    // الكتفان: حلقة بيضاء حول الرقبة مفتوحة من الأمام (طيّة الياقة)
    const yoke = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.2, 32, 1, Math.PI * 0.62, Math.PI * 1.76).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide, roughness: 0.85 }));
    yoke.position.y = 0.475; yoke.rotation.y = 0;
    const neck = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3e5f80 })); neck.position.y = 0.47;
    coat.rotation.y = Math.PI; g.add(coat, shirt, yoke, neck); g.scale.set(1.35, 1, 1); g.userData.keep = true; e.scene.add(g);
    const follow = e.addUpdate(() => {
      const head = e.headPos, yaw = new THREE.Euler().setFromQuaternion(e.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      g.position.set(head.x - Math.sin(yaw) * 0.1, head.y - 0.92, head.z - Math.cos(yaw) * 0.1); g.rotation.y = yaw;   // الصدر أمام الرأس قليلاً
    });
    follow.keep = true;   // يبقى البالطو على الطالب حتى لو تخطّى المشهد
  }
  _wearAll() { const W = this._buildWearables(); W.wearFn(W.items.gg, 'goggles', true); W.wearFn(W.items.gc, 'coat', true); W.sign.visible = false; }
  // أول ما يدخل الطالب المختبر: يذهب بنفسه إلى المشجب عن يساره، يمسك البالطو والنظارة ويلبسهما
  async dress() {
    const d = this.d, e = this.e, W = this._buildWearables();
    d.setStep('ادخل المختبر، ثم البس البالطو والنظارة الواقية المعلّقين على الجدار عن يسارك', 'اذهب إلى المعلم',
      isDesk(e) ? 'اقترب من القطعة، اضغط E لإمساكها، ثم انقر بالماوس لتلبسها.' : 'اقترب وامسك القطعة بزر Grip، ثم قرّبها من رأسك (أو اضغط الزناد) لتلبسها.');
    d.say('s0_dress');
    await d.until(() => {
      const left = [!W.coat && 'البالطو', !W.goggles && 'النظارة الواقية'].filter(Boolean);
      if (left.length && e.headPos.z < 6) d.step = 'البس ' + left.join(' و') + ' (على الجدار عن يسارك، بجانب الباب)';
      return W.goggles && W.coat;
    });
    W.sign.visible = false; audio.play('complete');
    d.sub = 'أحسنت: النظارة تحمي عينيك والبالطو يحمي ملابسك.';
    await d.wait(1);
  }

  // =============================================================
  // S1 · الفرضية
  // =============================================================
  async S1() {
    const d = this.d, e = this.e, st = this.st;
    this._resumePos(V(0, 0, 2.5));
    st.resetTools(); st.all.forEach(g => g.enabled = true);
    this.c.teacher.walkTo(V(1.0, 0, 0.75)).then(() => { this.c.teacher.lookAtPlayer = true; });
    d.setStep('امشِ إلى محطة الحركة الدائرية (الطاولة الزرقاء)', 'افحص الأدوات');
    d.say('s1_1');
    await d.until(() => this._nearStation(1.8));
    // --- فحص الأدوات ---
    const groups = [['الأنبوب', [st.tube]], ['السدادة', [st.stopper]], ['الخيط', [st.coil]], ['الحلقات والأوزان', st.weights], ['الميزان النابضي', [st.spring]], ['المسطرة', [st.ruler]], ['ساعة الإيقاف', [st.stopwatch]]];
    st.all.forEach(g => g.inspected = false);
    const info = new Panel({ w: 0.62, h: 0.26, ppm: 900 }); e.scene.add(info.mesh); info.mesh.visible = false;
    const infoUpd = () => {
      const h = e.hands.find(h => h.held); info.mesh.visible = !!h;
      if (h) {
        const g = h.held; if (info._g !== g) { info._g = g; info.set({ title: g.name, titleSize: 40, body: g.info, bodySize: 30 }); }
        info.mesh.position.copy(g.object.getWorldPosition(V())).add(V(0, 0.22, 0)); info.mesh.lookAt(e.headPos);
      }
      const n = groups.filter(([, gs]) => gs.some(g => g.inspected)).length;
      d.step = `امسك كل أداة وافحصها (${n}/7)`; d.next = n < 7 ? 'المتبقي: ' + groups.filter(([, gs]) => !gs.some(g => g.inspected)).map(x => x[0]).join('، ') : 'أعد الأدوات إلى الطاولة';
    };
    e.addUpdate(infoUpd);
    d.sub = isDesk(e) ? 'انظر إلى الأداة واضغط E لإمساكها، R/العجلة للتدوير، Shift+الماوس للتقليب، F للفحص عن قرب، ثم E لإفلاتها.' : 'اقترب من الأداة واضغط زر Grip لإمساكها، دوّر معصمك لفحصها، ثم اترك الزر لإفلاتها.';
    await d.until(() => groups.every(([, gs]) => gs.some(g => g.inspected)));
    e.removeUpdate(infoUpd);
    await d.until(() => {
      const off = st.all.filter(g => g.held || (g.object.position.y < STATION.top - 0.1 && g.object.visible));
      info.mesh.visible = false;
      d.step = off.length ? `أعد الأدوات إلى الطاولة (${off.map(g => g.name).join('، ')})` : ''; return off.length === 0;
    });
    e.scene.remove(info.mesh);
    // --- لماذا 30 دورة؟ نشاط توقيت تفاعلي ---
    d.setStep('جرّب قياس زمن دورة واحدة بنفسك', 'سؤال 30 دورة');
    d.say('s1_2');
    await this.timingDemo();
    d.setStep('أجب: لماذا 30 دورة؟', 'تصميم التجربة');
    await d.ask(Q.q1_1, { scene: 'S1' });
    d.setStep('صمّم التجربة: ما المتغير الثابت؟', 'الفرضية');
    d.say('s1_3');
    await d.ask(Q.q1_2, { scene: 'S1' });
    d.setStep('اختر فرضية قابلة للاختبار', 'المشهد S2');
    await d.ask(Q.q1_3, { scene: 'S1' });
  }

  // نشاط: الطالب يشغّل ويوقف ساعة الإيقاف لدورة واحدة (دورها 1.00 s) فيرى خطأه، ثم أثر توزيعه على 30 دورة
  timingDemo() {
    const d = this.d, e = this.e;
    return new Promise(done => {
      const p = new Panel({ w: 1.15, h: 0.9, ppm: 900 }); e.scene.add(p.mesh); e.registerPanel(p); d._placePanel(p, null);
      let state = 'idle', t0 = 0, trials = [];
      const T = 1.0;
      p.customDraw = (c, W, H, s, y, pad) => {
        const cx = 200 * s, cy = y + 150 * s, R = 120 * s, a = (e.time % T) / T * Math.PI * 2;
        c.strokeStyle = '#ffffff55'; c.lineWidth = 4 * s; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = '#ff3b30'; c.beginPath(); c.moveTo(cx, cy - R - 20 * s); c.lineTo(cx, cy - R + 20 * s); c.stroke();
        c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(cx + Math.sin(a) * R, cy - Math.cos(a) * R, 16 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#9fb0bf'; c.font = `${22 * s}px ${FONT}`; c.textAlign = 'center'; c.fillText('زمن الدورة الحقيقي 1.00 s', cx, cy + R + 22 * s); c.textAlign = 'right';
        c.font = `${28 * s}px ${FONT}`; c.fillStyle = '#e4ecf2';
        let yy = y + 10 * s;
        const tx = W - pad;
        c.fillText(state === 'run' ? `⏱ ${ltr((e.time - t0).toFixed(2) + ' s')} — اضغط «أوقف» عند عودة النقطة للخط الأحمر` : 'اضغط «ابدأ» لحظة مرور النقطة بالخط الأحمر', tx, yy); yy += 48 * s;
        trials.forEach((m, i) => { const err = Math.abs(m - T); c.fillText(`محاولة ${i + 1}: ${ltr(m.toFixed(2) + ' s')} · الخطأ ${ltr(err.toFixed(2) + ' s')} (${ltr((err / T * 100).toFixed(0) + '%')})`, tx, yy); yy += 42 * s; });
        if (trials.length) {
          const err = trials.reduce((s2, m) => s2 + Math.abs(m - T), 0) / trials.length;
          c.fillStyle = '#7dffb0'; c.font = `bold ${28 * s}px ${FONT}`;
          c.fillText(`لو قست 30 دورة بالخطأ نفسه (${ltr(err.toFixed(2) + ' s')}):`, tx, yy); yy += 42 * s;
          c.fillText(`زمن الدورة = ${ltr(`(30.00 ± ${err.toFixed(2)}) ÷ 30 = 1.000 ± ${(err / 30).toFixed(3)} s`)}`, tx, yy); yy += 42 * s;
          c.fillText(`أي أن الخطأ صار ${ltr((err / 30 * 100).toFixed(1) + '%')} فقط بدلاً من ${ltr((err * 100).toFixed(0) + '%')}`, tx, yy);
        }
        return y + 330 * s;
      };
      const render = () => p.set({ title: 'قِس زمن دورة واحدة', titleSize: 36, cols: 3, btnH: 66, buttons: [
        { id: 'go', label: state === 'run' ? 'أوقف' : 'ابدأ', bold: true, color: state === 'run' ? '#b04040' : '#2f7d5b' },
        { id: 'clr', label: 'مسح' }, { id: 'done', label: 'متابعة', color: '#3d79b8', disabled: trials.length < 1 } ] });
      p.onClick = id => {
        if (id === 'go') { if (state === 'run') { trials.push(e.time - t0); if (trials.length > 4) trials.shift(); state = 'idle'; audio.play('timer'); } else { state = 'run'; t0 = e.time; audio.play('timer'); } render(); }
        if (id === 'clr') { trials = []; render(); }
        if (id === 'done') { e.removeUpdate(anim); e.unregisterPanel(p); done(); }
      };
      const anim = () => p.redraw(); e.addUpdate(anim); render();
    });
  }

  // =============================================================
  // S2 · التجربة
  // =============================================================
  async S2() {
    const d = this.d, e = this.e, st = this.st;
    this._resumePos(V(2.6, 0, 1.2));
    if (this.c.teacher.root.position.distanceTo(V(1.0, 0, 0.75)) > 1) this.c.teacher.walkTo(V(1.0, 0, 0.75)).then(() => { this.c.teacher.lookAtPlayer = true; });
    if (st.s.threaded || st.tube.zone) st.resetTools();
    st.setAssembly(true);
    st.all.forEach(g => g.enabled = true);
    this.errors = 0;
    const T = d.score.d.table = { m: null, rows1: [], rows2: [] };
    const tablePanel = this.tablePanel = new Panel({ w: 1.7, h: 1.0, ppm: 1000, name: 'الجداول' });
    d.mountOnBoard(tablePanel, 'stationR');
    e.scene.add(tablePanel.mesh); e.registerPanel(tablePanel);
    tablePanel.customDraw = (c, W, H, s, y, pad) => drawTables(c, W, s, y, pad, T, this.calc || {});
    tablePanel.set({ title: 'جدول البيانات', titleSize: 34 });
    const redrawTables = () => tablePanel.redraw();

    // --- 1. قياس الكتلة ---
    d.setStep('ضع السدادة على الميزان الإلكتروني', 'سجّل الكتلة');
    d.say('s2_1');
    st.zStopper.accepts = g => g === st.stopper && T.m !== null;
    st.zStopper.onReject = () => this.st.emit('error', 'قِس كتلة السدادة على الميزان وسجّلها قبل ربطها بالخيط.');
    await d.until(() => st.stopper.zone === st.zBalance);
    await d.info({ title: 'قراءة الميزان: 20.0 g', body: 'كتلة السدادة مع الحلقة m = 20.0 g\nللتعويض في المعادلات نحوّلها إلى kg:  m = 20.0 ÷ 1000 = 0.020 kg' },
      { w: 0.95, h: 0.5, place: { pos: st.balPos.clone().add(V(0, 0.45, 0.3)), lookAt: e.headPos }, buttons: [{ id: 'rec', label: 'سجّل الكتلة m = 0.020 kg', bold: true, color: '#2f7d5b' }] });
    T.m = 0.020; redrawTables(); audio.play('correct');
    // --- 2. التركيب ---
    d.say('s2_2');
    const steps = [
      ['ضع الأنبوب في الحامل عند حافة الطاولة', () => st.s.inHolder],
      ['مرّر الخيط عبر الأنبوب: ضع لفّة الخيط على فوهة الأنبوب العلوية', () => st.s.threaded],
      ['اربط السدادة بالطرف العلوي للخيط (ضعها عند طرف الخيط على الطاولة)', () => st.s.stopperOn],
      ['علّق الميزان النابضي في الطرف السفلي للخيط', () => st.s.springOn],
      ['علّق الثقل 0.40 N في خطّاف الميزان النابضي', () => st.s.weight?.N === 0.4],
    ];
    let i = 0;
    while (i < steps.length) {
      d.setStep(`التركيب ${i + 1}/5: ${steps[i][0]}`, steps[i + 1] ? steps[i + 1][0] : 'قياس نصف القطر');
      // إن أزال الطالب جزءاً سابقاً نعود إلى تلك الخطوة
      await d.until(() => steps[i][1]() || steps.slice(0, i).some(s => !s[1]()));
      const back = steps.slice(0, i).findIndex(s => !s[1]());
      if (back >= 0) { i = back; continue; }
      audio.play('correct'); i++;
    }
    d.score.set('S2', 'assembly', Math.max(8, 20 - 2 * this.errors), 20, { errors: this.errors });
    // --- 3. نصف القطر ---
    d.say('s2_3');
    d.setStep('ضع المسطرة على الطاولة بجانب الخيط', 'اضبط نصف القطر');
    await d.until(() => st.s.rulerOn);
    await this.setRadius(0.5);
    // --- 4–6. المحاولات: الدوران وقياس 30 دورة وقراءة القوة ---
    st.panel.mesh.visible = true; st.refreshPanel();
    const runs = [
      { F: 0.4, r: 0.5, tbl: 'rows1' }, { F: 0.8, r: 0.5, tbl: 'rows1' }, { F: 1.6, r: 0.5, tbl: 'rows1' },
      { F: 0.8, r: 0.25, tbl: 'rows2' }, { F: 0.8, r: 0.75, tbl: 'rows2' },
    ];
    d.say('s2_4');
    for (let k = 0; k < runs.length; k++) {
      const R = runs[k];
      if (k === 3) await this.d.info({ title: 'التجربة الثانية: القوة ثابتة F = 0.80 N', body: 'سنغيّر الآن نصف القطر ونثبّت القوة. القراءة عند r = 0.50 m لديك من التجربة الأولى، فنقيس عند 0.25 m و 0.75 m.' }, { w: 0.95, h: 0.5 });
      await this.doRun(R, k, runs.length, T, redrawTables);
    }
    // التجربة الثانية تحتوي على قراءة r = 0.50 من التجربة الأولى
    T.rows2.splice(1, 0, { ...T.rows1[1], r: 0.5, shared: true }); redrawTables();
    st.panel.mesh.visible = false;
    d.setStep('أعد الأنبوب إلى الحامل', 'الحسابات');
    await d.until(() => st.tube.zone === st.zHolder);
    // --- 7. الحسابات ---
    d.say('s2_calc');
    await this.calculations(T, redrawTables);
  }

  async setRadius(target) {
    const d = this.d, e = this.e, st = this.st;
    d.setStep(`اضبط موضع المشبك ليكون نصف القطر r = ${target.toFixed(2)} m ثم أكّد`, 'تدوير السدادة');
    const p = new Panel({ w: 0.8, h: 0.42, ppm: 900 }); e.scene.add(p.mesh); e.registerPanel(p);
    p.mesh.position.set(STATION.x + 0.3, 1.25, STATION.z + 0.75); p.mesh.rotation.x = -0.5;
    let msg = '';
    const render = () => p.set({ title: `نصف القطر على المسطرة: r = ${st.s.L0.toFixed(2)} m`, titleSize: 36, body: msg || 'حرّك المشبك على الخيط فتتحرك السدادة على المسطرة.', bodySize: 26,
      cols: 5, btnH: 66, buttons: [{ id: '-5', label: '−5 cm' }, { id: '-1', label: '−1 cm' }, { id: '+1', label: '+1 cm' }, { id: '+5', label: '+5 cm' }, { id: 'ok', label: 'تأكيد', bold: true, color: '#2f7d5b' }] });
    render();
    await new Promise(res => {
      p.onClick = id => {
        if (id === 'ok') {
          if (Math.abs(st.s.L0 - target) < 0.005) { st.s.rConfirmed = true; audio.play('correct'); e.unregisterPanel(p); res(); return; }
          msg = `القياس ${st.s.L0.toFixed(2)} m لا يطابق المطلوب ${target.toFixed(2)} m. عدّل موضع المشبك.`; audio.play('wrong');
        } else { st.setL0(st.s.L0 + Number(id) / 100); msg = ''; audio.play('click'); }
        render();
      };
    });
  }

  async doRun(R, k, n, T, redraw) {
    const d = this.d, e = this.e, st = this.st;
    // تبديل الثقل إن لزم
    if (st.s.weight?.N !== R.F) {
      d.setStep(`أعد الأنبوب للحامل إن كان بيدك، ثم بدّل الثقل إلى ${R.F.toFixed(2)} N`, 'تدوير السدادة');
      await d.until(() => st.s.weight?.N === R.F && st.tube.zone === st.zHolder);
      audio.play('correct');
    }
    if (Math.abs(st.s.L0 - R.r) > 0.005) {
      await d.until(() => st.tube.zone === st.zHolder);
      await this.setRadius(R.r);
    }
    st.sim.allowSpin = true;
    const how = isDesk(e) ? 'اضغط E لرفع الأنبوب فوق رأسك، ثم حرّك الماوس في دوائر صغيرة منتظمة كأنك تدوّر يدك (أو استمر بالضغط على Space)' : 'امسك الأنبوب (Grip) وحرّك يدك في دوائر صغيرة (أو اضغط الزناد)';
    for (;;) {
      d.setStep(`المحاولة ${k + 1}/${n}: F = ${R.F.toFixed(2)} N · r = ${R.r.toFixed(2)} m — ${how}`, 'ابدأ المؤقت عند ثبات المشبك في المنطقة الخضراء', '');
      const rec = await new Promise(res => {
        const offRec = run => { if (run && !run.recorded) res(run); };
        st.listeners.record = [offRec];
        // تنبيه سلامة: يجب الوقوف داخل الدائرة الآمنة أثناء التدوير
        const warn = () => {
          if (!st.sim.active) return;
          const h = e.headPos, out = Math.hypot(h.x - SWING.x, h.z - SWING.z) > SAFE_R;
          if (out) { d.sub = '⚠ قف داخل الدائرة الآمنة الصفراء أثناء التدوير، بعيداً عن الطاولة والزملاء.'; }
        };
        st._warn && e.removeUpdate(st._warn); st._warn = e.addUpdate(warn);
      });
      e.removeUpdate(st._warn);
      if (rec.Fset !== R.F || Math.abs(rec.r - R.r) > 0.005) { d.sub = 'هذه القراءة لا تطابق المحاولة المطلوبة.'; continue; }
      if (rec.steady < 0.5) {
        audio.play('wrong');
        await d.info({ title: 'السرعة لم تكن منتظمة', body: `كان المشبك في المنطقة الخضراء ${(rec.steady * 100).toFixed(0)}% فقط من الوقت. القراءة غير موثوقة؛ أعد القياس وحافظ على سرعة ثابتة.` }, { w: 0.9, h: 0.45, buttons: [{ id: 'ok', label: 'أعد القياس' }] });
        st.resetTimer(); continue;
      }
      rec.recorded = true; st.refreshPanel();
      T[R.tbl].push({ F: rec.F, r: rec.r, t: rec.t, steady: rec.steady });
      d.score.set('S2', `run${k + 1}`, rec.steady >= 0.7 ? 6 : 4, 6, { t: rec.t, steady: rec.steady });
      redraw(); audio.play('correct');
      d.sub = `سُجّلت: F = ${rec.F.toFixed(2)} N · t(30) = ${rec.t.toFixed(1)} s · انتظام ${(rec.steady * 100).toFixed(0)}%`;
      st.resetTimer();
      break;
    }
    st.sim.allowSpin = k < n - 1 || true;
  }

  async calculations(T, redraw) {
    const d = this.d, n = 30;
    const vOf = row => 2 * Math.PI * row.r * n / row.t, f2 = x => x.toFixed(2), f1 = x => x.toFixed(1);
    this.calc = { v1: [], a1: [], v2: [] };
    const r0 = T.rows1[0], v = vOf(r0), a = v * v / r0.r;
    d.setStep('احسب سرعة السدادة في المحاولة الأولى', 'التسارع المركزي');
    // السؤال o3_2 — الخيار o3_2_2 فخ: سرعة دورة واحدة مقسومة على زمن الثلاثين دورة
    const qv = { id: 'o3_2', points: 10, title: `المحاولة 1: r = ${f2(r0.r)} m، n = 30، t = ${f1(r0.t)} s. ما سرعة السدادة v = 2πrn ÷ t ؟`,
      options: [
        { id: 'o3_2_2', t: `${f2(2 * Math.PI * r0.r / r0.t)} m/s` },
        { id: 'o3_2_1', t: `${f2(v)} m/s` },
        { id: 'o3_2_4', t: `${f2(2 * Math.PI * n / r0.t)} m/s` },
        { id: 'o3_2_3', t: `${f2(Math.PI * r0.r * n / r0.t)} m/s` },
      ], correct: 'o3_2_1', hint: 'المسافة الكلية = محيط الدائرة × عدد الدورات = 2πr × 30، ثم اقسم على الزمن الكلي.',
      fb: { ok: `صحيح: v = 2π × ${f2(r0.r)} × 30 ÷ ${f1(r0.t)} = ${f2(v)} m/s`, bad: `راجع: المسافة الكلية 2πr × n = ${f2(2 * Math.PI * r0.r * n)} m مقسومة على ${f1(r0.t)} s.` } };
    await d.ask(qv, { scene: 'S2', exactBad: { o3_2_2: 'نسيت الضرب في عدد الدورات n = 30؛ هذه سرعة دورة واحدة مقسومة على زمن الثلاثين دورة.', o3_2_4: 'نسيت نصف القطر r: محيط الدائرة 2πr وليس 2π.', o3_2_3: 'محيط الدائرة 2πr وليس πr.' } });
    this.calc.v1[0] = v; redraw();
    d.setStep('احسب التسارع المركزي في المحاولة الأولى', 'أكمل الجدولين');
    await d.ask({ id: 'o3_3', points: 10, title: `v = ${f2(v)} m/s و r = ${f2(r0.r)} m. ما التسارع المركزي aC ؟`,
      options: [{ id: 'o3_3_1', t: `${f1(v / r0.r)} m/s²` }, { id: 'o3_3_2', t: `${f1(a)} m/s²` }, { id: 'o3_3_3', t: `${f2(v * v * r0.r)} m/s²` }, { id: 'o3_3_4', t: `${f1(v * v / (2 * r0.r))} m/s²` }],
      correct: 'o3_3_2', hint: 'aC = v² ÷ r', fb: { ok: `صحيح: aC = ${f2(v)}² ÷ ${f2(r0.r)} = ${f1(a)} m/s²`, bad: `aC = v² ÷ r = ${f2(v * v)} ÷ ${f2(r0.r)} = ${f1(a)} m/s²` } }, { scene: 'S2' });
    this.calc.a1[0] = a; redraw();
    for (let i = 1; i < 3; i++) {
      const row = T.rows1[i], vi = vOf(row), ai = vi * vi / row.r, w = 2 * Math.PI * row.r / row.t;
      d.setStep(`أكمل الجدول الأول: المحاولة ${i + 1}`, i < 2 ? 'المحاولة التالية' : 'الجدول الثاني');
      await d.ask({ id: `o3_4_${i}`, points: 5, title: `المحاولة ${i + 1}: F = ${f2(row.F)} N، r = ${f2(row.r)} m، t = ${f1(row.t)} s. اختر v و aC:`,
        options: [{ id: 'x1', t: `v = ${f2(w)} m/s · aC = ${f1(w * w / row.r)} m/s²` }, { id: 'x2', t: `v = ${f2(vi)} m/s · aC = ${f1(vi / row.r)} m/s²` }, { id: 'ok', t: `v = ${f2(vi)} m/s · aC = ${f1(ai)} m/s²` }, { id: 'x3', t: `v = ${f2(vi)} m/s · aC = ${f2(vi * vi * row.r)} m/s²` }],
        correct: 'ok', fb: { ok: `صحيح: v = ${f2(vi)} m/s و aC = ${f1(ai)} m/s²`, bad: `v = 2πrn/t = ${f2(vi)} m/s، ثم aC = v²/r = ${f1(ai)} m/s².` } },
        { scene: 'S2', exactBad: { x1: 'نسيت الضرب في عدد الدورات n = 30؛ هذه سرعة دورة واحدة مقسومة على زمن الثلاثين دورة.' } });
      this.calc.v1[i] = vi; this.calc.a1[i] = ai; redraw();
    }
    let idx = 0;
    for (const i of [0, 2]) {
      const row = T.rows2[i], vi = vOf(row);
      d.setStep(`أكمل الجدول الثاني: r = ${f2(row.r)} m`, idx ? 'المشهد S3' : 'الصف التالي');
      await d.ask({ id: `o3_5_${i}`, points: 5, title: `F ثابتة = 0.80 N، r = ${f2(row.r)} m، t = ${f1(row.t)} s. ما السرعة v ؟`,
        options: [{ id: 'ok', t: `${f2(vi)} m/s` }, { id: 'x1', t: `${f2(2 * Math.PI * row.r / row.t)} m/s` }, { id: 'x2', t: `${f2(2 * Math.PI * n / row.t)} m/s` }, { id: 'x3', t: `${f2(vi * 2)} m/s` }].sort((a, b) => (a.id + i).localeCompare(b.id + i)),
        correct: 'ok', fb: { ok: `صحيح: v = 2π × ${f2(row.r)} × 30 ÷ ${f1(row.t)} = ${f2(vi)} m/s`, bad: `v = 2πrn ÷ t = ${f2(vi)} m/s` } },
        { scene: 'S2', exactBad: { x1: 'نسيت الضرب في عدد الدورات n = 30؛ هذه سرعة دورة واحدة مقسومة على زمن الثلاثين دورة.' } });
      this.calc.v2[i] = vi; redraw(); idx++;
    }
    this.calc.v2[1] = this.calc.v1[1]; redraw();
    await d.info({ title: 'لاحظ الجدولين', body: 'عند ثبات r: مضاعفة F ضاعفت aC = v²/r (≈ 20 ← 40 ← 80).\nعند ثبات F: زيادة r زادت السرعة v.' }, { w: 0.95, h: 0.5 });
  }

  // =============================================================
  // S3 · الاستنتاج: النموذج المكبر وقطع الخيط
  // =============================================================
  async S3() {
    const d = this.d, e = this.e, st = this.st;
    this._resumePos(V(SWING.x - 0.3, 0, SWING.z + 2.4));
    // جدول البيانات يبقى على سبورته عند المحطة (ظاهرة من منطقة النموذج)
    st.panel.mesh.visible = false;
    if (st.tube.held) { /* يبقى بيد الطالب */ }
    const C = V(SWING.x, 1.3, SWING.z), R = 0.85;
    const g = new THREE.Group(); e.scene.add(g);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 1.3, 12), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 })); post.position.set(C.x, 0.65, C.z);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.035), new THREE.MeshStandardMaterial({ color: 0xdddddd })); hub.position.copy(C);
    const path = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 6, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x334455 })); path.position.copy(C);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0x8a3b22 }));
    const string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0xffffff })); string.frustumCulled = false;
    const vA = arrow(COLORS.vel, 0.55, 0.02), fA = arrow(COLORS.force, 0.45, 0.02);
    const vL = new Label('متجه السرعة v — مماسي', { w: 0.46, h: 0.08, size: 40, bg: '#1d5a99' }), fL = new Label('القوة المركزية FC — نحو المركز', { w: 0.52, h: 0.08, size: 40, bg: '#a8401f' });
    vL.mesh.visible = fL.mesh.visible = false;
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 120 }, () => C.clone())), new THREE.LineBasicMaterial({ color: 0xffd34d })); trail.frustumCulled = false;
    const scaleLbl = new Label('نموذج مكبّر (منظر علوي مائل)', { w: 0.6, h: 0.08, size: 40, bg: '#333' }); scaleLbl.mesh.position.set(C.x, C.y + 0.55, C.z);
    g.add(post, hub, path, body, string, vA, fA, vL.mesh, fL.mesh, trail, scaleLbl.mesh);
    const sim = { th: 0.6, om: 2.0, running: true, cut: false, pos: V(), vel: V(), slow: 1, showV: true, showF: true, tCut: 0, cutTh: null, guides: [] };
    let cuts = 0, slowReplays = 0;
    const upd = (dt0) => {
      const dt = dt0 * sim.slow;
      if (!sim.cut) {
        if (sim.running) sim.th += sim.om * dt;
        if (sim.autoCutAt !== undefined && sim.th >= sim.autoCutAt) { doCut(); }
        sim.pos.set(C.x + Math.cos(sim.th) * R, C.y, C.z - Math.sin(sim.th) * R);
        sim.vel.set(-Math.sin(sim.th), 0, -Math.cos(sim.th)).multiplyScalar(sim.om * R);
        const p = string.geometry.attributes.position; p.setXYZ(0, C.x, C.y, C.z); p.setXYZ(1, sim.pos.x, sim.pos.y, sim.pos.z); p.needsUpdate = true;
      } else {
        if (sim.running) { sim.pos.addScaledVector(sim.vel, dt); sim.tCut += dt; }
        // بقية الخيط المقطوع تتدلى من المركز
        const p = string.geometry.attributes.position; p.setXYZ(1, C.x + 0.0, C.y - Math.min(0.4, sim.tCut * 0.8), C.z); p.needsUpdate = true;
        if (sim.tCut > 2.2) body.visible = false;
      }
      body.position.copy(sim.pos); body.rotation.y = sim.th;
      vA.visible = sim.showV && body.visible; fA.visible = sim.showF && !sim.cut;
      if (sim.vel.lengthSq() > 0) vA.point(sim.pos, sim.vel.clone().normalize());
      fA.point(sim.pos, C.clone().sub(sim.pos).normalize());
      vL.mesh.position.copy(sim.pos).addScaledVector(sim.vel.clone().normalize(), 0.62).y += 0.08;
      fL.mesh.position.copy(sim.pos).lerp(C, 0.5).y += 0.12;
      vL.mesh.lookAt(e.headPos); fL.mesh.lookAt(e.headPos); scaleLbl.mesh.lookAt(e.headPos);
      if (sim.running && body.visible) { const tp = trail.geometry.attributes.position; tp.array.copyWithin(3, 0, tp.count * 3 - 3); tp.setXYZ(0, sim.pos.x, sim.pos.y, sim.pos.z); tp.needsUpdate = true; }
    };
    e.addUpdate(upd);
    const doCut = () => {
      sim.cut = true; sim.tCut = 0; sim.autoCutAt = undefined; sim.cutTh = sim.th; audio.play('cut'); cuts++;
      const p0 = sim.pos.clone(), tdir = sim.vel.clone().normalize(), rdir = p0.clone().sub(C).normalize();
      const tl = thick(0x2f8fff, [p0, p0.clone().addScaledVector(tdir, 3)]), rl = thick(0xff4444, [p0, p0.clone().addScaledVector(rdir, 1.5)], { r: 0.006 });
      const rlab = new Label('✗ ليس هكذا (نصف قطري)', { w: 0.46, h: 0.075, size: 38, bg: '#7a1f1f' }); rlab.mesh.position.copy(p0).addScaledVector(rdir, 1.0).y += 0.1;
      const tlab = new Label('✓ مسار المماس', { w: 0.34, h: 0.075, size: 38, bg: '#1d5a99' }); tlab.mesh.position.copy(p0).addScaledVector(tdir, 1.4).y += 0.12;
      rlab.mesh.userData.billboardY = tlab.mesh.userData.billboardY = true;
      for (const o of [tl, rl, rlab.mesh, tlab.mesh]) { g.add(o); sim.guides.push(o); }
      fL.mesh.visible = false;
    };
    const reset = (slowMo = false) => {
      for (const o of sim.guides) g.remove(o); sim.guides = [];
      body.visible = true; sim.cut = false; sim.running = true; sim.slow = slowMo ? 0.25 : 1;
      if (slowMo && sim.cutTh !== null) { sim.th = sim.cutTh - Math.PI * 0.9; sim.autoCutAt = sim.cutTh; slowReplays++; } else sim.autoCutAt = undefined;
      const tp = trail.geometry.attributes.position; for (let i = 0; i < tp.count; i++) tp.setXYZ(i, sim.pos.x, sim.pos.y, sim.pos.z); tp.needsUpdate = true;
    };
    // لوحة التحكم
    const ctl = new Panel({ w: 1.05, h: 0.42, ppm: 900, name: 'التحكم' }); e.scene.add(ctl.mesh); e.registerPanel(ctl);
    ctl.mesh.position.set(C.x - 1.45, 1.35, C.z + 0.75); ctl.mesh.lookAt(C.x - 0.2, 1.45, C.z + 2.6);
    let cutEnabled = false;
    const renderCtl = () => ctl.set({ title: 'تحكم النموذج', titleSize: 32, cols: 3, btnH: 62, buttons: [
      { id: 'v', label: sim.showV ? 'إخفاء متجه السرعة' : 'إظهار متجه السرعة', size: 24 },
      { id: 'f', label: sim.showF ? 'إخفاء متجه القوة' : 'إظهار متجه القوة', size: 24 },
      { id: 'p', label: sim.running ? '⏸ إيقاف مؤقت' : '▶ تشغيل', size: 26 },
      { id: 'cut', label: '✂ قطع الخيط', bold: true, color: '#b04040', disabled: !cutEnabled || sim.cut },
      { id: 'r', label: '↻ إعادة', size: 26 },
      { id: 'slow', label: '🐢 إعادة بطيئة للحظة القطع', size: 22, disabled: sim.cutTh === null } ] });
    ctl.onClick = id => {
      if (id === 'v') sim.showV = !sim.showV; if (id === 'f') sim.showF = !sim.showF; if (id === 'p') sim.running = !sim.running;
      if (id === 'cut') { sim.running = true; doCut(); } if (id === 'r') reset(false); if (id === 'slow') reset(true);
      renderCtl();
    };
    renderCtl();
    // --- تحديد المتجهين ---
    d.setStep('اقترب من النموذج المكبر', 'حدّد المتجهين');
    d.say('s3_1');
    await d.until(() => e.headPos.distanceTo(C) < 3.2);
    for (const [want, arrowObj, lab, pts] of [['السرعة', vA, vL, 5], ['القوة المركزية', fA, fL, 5]]) {
      d.setStep(`أشِر إلى متجه ${want} وانقر عليه`, want === 'السرعة' ? 'متجه القوة' : 'قطع الخيط', 'يمكنك إيقاف الحركة مؤقتاً من لوحة التحكم لتسهيل التحديد.');
      let attempts = 0;
      await new Promise(res => {
        const s1 = e.addSelectable(vA, { hint: 'انقر لتحديد هذا المتجه', onSelect: () => pick(vA) });
        const s2 = e.addSelectable(fA, { hint: 'انقر لتحديد هذا المتجه', onSelect: () => pick(fA) });
        const pick = (o) => {
          attempts++;
          if (o === arrowObj) {
            audio.play('correct'); lab.mesh.visible = true;
            d.score.set('S3', 'vec-' + (want === 'السرعة' ? 'v' : 'f'), pts * RULES.attemptFactor[Math.min(attempts - 1, 2)], pts, { attempts });
            d.sub = want === 'السرعة' ? 'صحيح: متجه السرعة مماسي للمسار، عمودي على نصف القطر.' : 'صحيح: القوة المركزية تتجه دائماً نحو مركز الدائرة.';
            e.removeSelectable(s1); e.removeSelectable(s2); res();
          } else { audio.play('wrong'); d.sub = want === 'السرعة' ? 'هذا السهم يتجه نحو المركز؛ متجه السرعة يكون مماسياً للمسار.' : 'هذا السهم مماسي للمسار؛ القوة المركزية تتجه نحو المركز.'; }
          d.guide.redraw();
        };
      });
    }
    // --- قطع الخيط ---
    cutEnabled = true; renderCtl();
    d.setStep('اضغط «قطع الخيط» وراقب مسار السدادة', 'شاهد الإعادة البطيئة');
    d.say('s3_2');
    await d.until(() => cuts >= 1 && sim.tCut > 1.2);
    renderCtl();
    d.setStep('شاهد لحظة القطع ببطء: اضغط «إعادة بطيئة»', 'أسئلة الاستنتاج', 'لاحظ: السدادة تتابع على الخط الأزرق المماسي، لا على الخط الأحمر.');
    await d.until(() => slowReplays >= 1 && sim.cut && sim.tCut > 0.8);
    d.score.set('S3', 'cut', 10, 10);
    renderCtl();
    // --- أسئلة الاستنتاج ---
    d.say('s3_3');
    d.setStep('أجب عن أسئلة الاستنتاج', 'المشهد S4');
    if (this.tablePanel) { this.tablePanel.minimized = false; this.tablePanel.redraw(); }
    await d.ask(Q.q3_1, { scene: 'S3' });
    await d.ask(Q.q3_2, { scene: 'S3' });
    const r3 = await d.ask(Q.q3_3, { scene: 'S3' });
    if (!r3.correct) { d.score.d.critical.tangent = true; d.score.save(); }
    e.removeUpdate(upd); e.scene.remove(g); e.unregisterPanel(ctl);
    if (this.tablePanel) { this.tablePanel.mesh.visible = false; const b = this.W.boards.find(x => x.id === d.tableBoard); if (b) b.front.visible = true; d.tableBoard = null; }
  }

  // =============================================================
  // S4 · الاختبار الختامي والاستخلاص
  // =============================================================
  async S4() {
    const d = this.d, e = this.e, sc = d.score;
    this._resumePos(V(1.0, 0, 1.5));
    this.c.teacher.walkTo(V(0.2, 0, -0.6)).then(() => { this.c.teacher.lookAtPlayer = true; });
    d.say('s4_1');
    for (let i = 0; i < Q.q4.length; i++) {
      d.setStep(`الاختبار الختامي: السؤال ${i + 1} من 5`, i < 4 ? `السؤال ${i + 2}` : 'السؤال البعدي');
      const q = Q.q4[i];
      const r = await d.ask(q, { scene: 'S4', maxAttempts: 2 });
      if (q.closesCritical && r.correct && r.attempts === 1) { sc.d.critical[q.closesCritical] = false; sc.save(); }
    }
    d.setStep('السؤال البعدي', 'ملخص المفاهيم');
    const post = await d.ask(Q.post, { scene: 'S4', h: 1.2, draw: topViewDraw, maxAttempts: 1 });
    sc.d.post = { choice: post.choice, correct: post.correct };
    if (post.correct) sc.d.critical.tangent = false; sc.save();
    // ملخص المفاهيم
    d.setStep('ملخص ما تعلمته', 'التقييم الذاتي');
    d.say('s4_end');
    await d.info({ title: 'ملخص المفاهيم', body: SUMMARY.map(s => '• ' + s).join('\n'), bodySize: 29 }, { w: 1.2, h: 0.85 });
    // التقييم الذاتي
    d.setStep('قيّم فهمك بنفسك', 'النتيجة');
    const self = await d.info({ title: 'كيف تقيّم فهمك للحركة الدائرية الآن؟' }, { w: 1.0, h: 0.5, buttons: [
      { id: '4', label: 'ممتاز' }, { id: '3', label: 'جيد' }, { id: '2', label: 'متوسط' }, { id: '1', label: 'أحتاج مراجعة' }] });
    sc.d.self = Number(self); sc.d.scene = 5; sc.save();
    await this.results();
  }

  async results() {
    const d = this.d, sc = d.score, S = sc.summary(), pct = x => (x * 100).toFixed(0) + '%';
    const names = { 'S1:o1_1': 'تبرير قياس 30 دورة', 'S1:o1_2': 'تثبيت المتغير', 'S1:o1_3': 'صياغة الفرضية', 'S2:assembly': 'تركيب الجهاز', 'S2:o3_2': 'حساب السرعة v = 2πrn/t', 'S2:o3_3': 'حساب التسارع المركزي',
      'S3:vec-v': 'اتجاه متجه السرعة', 'S3:vec-f': 'اتجاه القوة المركزية', 'S3:o4_1': 'العلاقة بين F و v', 'S3:o4_2': 'العلاقة بين r و v', 'S3:o4_3': 'المسار عند زوال القوة',
      'S4:o5_1': 'اتجاه التسارع المركزي', 'S4:o5_2': 'حساب aC', 'S4:o5_3': 'أثر مضاعفة السرعة', 'S4:o5_4': 'تفسير المواقف الحياتية', 'S4:o5_5': 'شروط القياس والسلامة', 'S4:AM-12-post': 'السؤال البعدي' };
    const runs = Object.entries(sc.d.items).filter(([k]) => k.startsWith('S2:run'));
    const strong = [], weak = [];
    for (const [k, it] of Object.entries(sc.d.items)) { if (!names[k]) continue; const r = it.earned / it.max; if (r >= 0.99) strong.push(names[k]); else if (r < 0.5) weak.push(names[k]); }
    if (runs.length && runs.every(([, it]) => it.earned === it.max)) strong.push('انتظام الدوران والقياس'); else if (runs.length) weak.push('المحافظة على سرعة دوران ثابتة');
    const critNames = { safety: 'إخفاق حرج: إجراءات السلامة', tangent: 'إخفاق حرج: مسار الجسم عند زوال القوة المركزية' };
    const pre = sc.d.pre, post = sc.d.post;
    const lines = [
      `الأداء العملي: ${ltr(`${S.perf.e} / ${S.perf.m} = ${pct(S.p)}`)} · الحد الأدنى ${ltr('60%')}`,
      `الاختبار: ${ltr(`${S.test.e} / ${S.test.m} = ${pct(S.t)}`)} · الحد الأدنى ${ltr('50%')}`,
      `الدرجة المركبة: ${ltr(pct(S.comp))} · وهي ${ltr('60%')} أداء و${ltr('40%')} اختبار · حد النجاح ${ltr('70%')}`,
      `السؤال القبلي ${pre ? (pre.correct ? '✓' : '✗') : '—'} · السؤال البعدي ${post ? (post.correct ? '✓' : '✗') : '—'} · نقاط التهيئة ${ltr(sc.sceneTotal('S0').e + ' / 20')} لا تُحتسب`,
      `نقاط القوة: ${strong.slice(0, 5).join('، ') || '—'}`,
      `تحتاج إلى تحسين: ${weak.slice(0, 5).join('، ') || 'لا شيء — أحسنت'}`,
      S.crit.length ? S.crit.map(c => '⚠ ' + critNames[c] + ' — مفتوح').join('\n') :'لا توجد إخفاقات حرجة مفتوحة',
    ];
    d.setStep(S.pass ? 'ناجح — أحسنت!' : 'لم تتحقق شروط النجاح بعد', '');
    audio.play(S.pass ? 'complete' : 'wrong');
    const id = await d.info({ tag: 'النتيجة النهائية', title: S.pass ? '✓ ناجح' : '✗ غير ناجح بعد', body: lines.join('\n'), bodySize: 26, border: S.pass ? COLORS.ok : COLORS.bad }, { w: 1.35, h: 1.05, buttons: [{ id: 'cert', label: '🎓 استلم الشهادة', bold: true, color: '#b8860b' }, { id: 'again', label: '↻ أعد التجربة' }, { id: 'stay', label: 'البقاء في المختبر', color: '#3d79b8' }] });
    if (id === 'again') { sc.clear(); location.reload(); return; }
    if (id === 'cert') await this.certificate(S);
  }

  // شهادة الأمد في نهاية التجربة: تُعرض أمام الطالب داخل المختبر ويمكن تنزيلها صورةً
  async certificate(S) {
    const d = this.d, e = this.e, pct = x => (x * 100).toFixed(0) + '%';
    d.setStep('شهادة إتمام التجربة', '');
    audio.play('complete');
    const data = { name: studentName(), pass: S.pass, comp: pct(S.comp), perf: pct(S.p), test: pct(S.t), date: new Date() };
    const CW = 1.6, CH = CW * 1131 / 1600;
    const p = new Panel({ w: CW, h: CH + 0.2, ppm: 1000, name: 'الشهادة' });
    p.customDraw = (c, W) => { drawCertificate(c, W, W * 1131 / 1600, data); return W * 1131 / 1600 + 10; };
    const buttons = () => [
      { id: 'dl', label: '⬇ تنزيل الشهادة', bold: true, color: '#b8860b' },
      ...(e.isXR ? [] : [{ id: 'name', label: '✎ تعديل الاسم', color: '#3d79b8' }]),
      { id: 'again', label: '↻ أعد التجربة' }, { id: 'close', label: 'إغلاق', color: '#55606b' }];
    p.set({ bg: '#20262d', buttons: buttons(), cols: buttons().length, btnH: 62 });
    // أمام الطالب مباشرة على بعد مناسب لقراءتها كاملة
    const cam = e.camera, head = cam.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y, dist = 2.0;
    p.mesh.position.set(head.x - Math.sin(yaw) * dist, Math.max(1.3, head.y - 0.05), head.z - Math.cos(yaw) * dist);
    p.mesh.lookAt(head.x, p.mesh.position.y, head.z);
    e.scene.add(p.mesh); e.registerPanel(p);
    while (true) {
      const id = await new Promise(res => { p.onClick = res; });
      if (id === 'dl') downloadCertificate(data);
      else if (id === 'name') {
        const n = prompt('اكتب اسمك كما تريد أن يظهر في الشهادة:', data.name || '');
        if (n !== null) { data.name = n.trim(); saveStudentName(data.name); p.redraw(); }
      } else if (id === 'again') { d.score.clear(); location.reload(); return; }
      else if (id === 'close') { e.unregisterPanel(p); e.scene.remove(p.mesh); d.setStep('أحسنت — يمكنك البقاء في المختبر', ''); return; }
    }
  }

  // ---------- مساعدات ----------
  _nearStation(r) { const h = this.e.headPos; return Math.hypot(h.x - STATION.x, h.z - (STATION.z + 0.5)) < r; }
  _resumePos(p) {
    // عند الاستئناف من مشهد لاحق: إن كان الطالب خارج المختبر ننقله إلى المختبر
    const h = this.e.headPos; if (h.x < -20 || h.z > 6) this.e.teleportPlayer(p, yawTo(p, V(STATION.x, 0, STATION.z)));
  }
}

// منظر علوي لسؤال المسار (القبلي والبعدي)
function topViewDraw(c, W, H, s, y, pad) {
  const cx = W / 2, cy = y + 150 * s, R = 105 * s;
  c.strokeStyle = '#ffffff88'; c.setLineDash([10 * s, 8 * s]); c.lineWidth = 3 * s; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#ddd'; c.beginPath(); c.arc(cx, cy, 6 * s, 0, Math.PI * 2); c.fill();
  const px = cx + R, py = cy;
  c.strokeStyle = '#ffffff'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(px, py); c.stroke();
  c.fillStyle = '#c0603a'; c.beginPath(); c.arc(px, py, 13 * s, 0, Math.PI * 2); c.fill();
  const arr = (x2, y2, lab, col) => {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 5 * s; c.beginPath(); c.moveTo(px, py); c.lineTo(x2, y2); c.stroke();
    const a = Math.atan2(y2 - py, x2 - px); c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 16 * s * Math.cos(a - 0.4), y2 - 16 * s * Math.sin(a - 0.4)); c.lineTo(x2 - 16 * s * Math.cos(a + 0.4), y2 - 16 * s * Math.sin(a + 0.4)); c.fill();
    c.font = `bold ${30 * s}px ${FONT}`; c.textAlign = 'center'; c.fillText(lab, x2 + 22 * s * Math.cos(a), y2 + 22 * s * Math.sin(a) + 10 * s); c.textAlign = 'right';
  };
  arr(px, py - 120 * s, 'أ', '#7cc7ff'); arr(px + 130 * s, py, 'ب', '#ffb07c');
  c.strokeStyle = '#c9a0ff'; c.lineWidth = 4 * s; c.beginPath(); c.arc(cx, cy, R, 0, -0.9, true); c.stroke();
  c.fillStyle = '#c9a0ff'; c.font = `bold ${30 * s}px ${FONT}`; c.fillText('ج', cx + R * Math.cos(-0.9) + 30 * s, cy + R * Math.sin(-0.9) - 8 * s);
  c.strokeStyle = '#9dff9d'; c.beginPath(); for (let k = 0; k < 40; k++) { const a = -k * 0.08, rr = R + k * 2.2 * s; const x = cx + rr * Math.cos(a), yy = cy + rr * Math.sin(a); k ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.stroke();
  c.fillStyle = '#9dff9d'; c.fillText('د', cx + (R + 90 * s) * Math.cos(-3.1) + 0, cy + (R + 90 * s) * Math.sin(-3.1));
  c.fillStyle = '#9fb0bf'; c.font = `${22 * s}px ${FONT}`; c.fillText('السدادة تدور عكس عقارب الساعة، والخيط انقطع الآن', W - pad, cy + R + 30 * s);
  return cy + R + 70 * s;
}

// جدولا البيانات (يملأ الطالب الخانات)
function drawTables(c, W, s, y, pad, T, calc) {
  const f = (x, d = 2) => (x === undefined || x === null) ? '؟' : x.toFixed(d);
  c.font = `${24 * s}px ${FONT}`; c.fillStyle = '#c9d3dc'; c.textAlign = 'right';
  c.fillText(`كتلة السدادة m = ${T.m ? '0.020 kg (20.0 g)' : '؟'}`, W - pad, y); y += 40 * s;
  const table = (title, cols, rows) => {
    c.font = `bold ${26 * s}px ${FONT}`; c.fillStyle = '#ffcf4a'; c.fillText(title, W - pad, y); y += 38 * s;
    const cw = (W - 2 * pad) / cols.length;
    c.font = `bold ${22 * s}px ${FONT}`; c.fillStyle = '#9fb0bf'; c.textAlign = 'center';
    cols.forEach((h, i) => c.fillText(h, W - pad - cw * (i + 0.5), y)); y += 32 * s;
    c.font = `${24 * s}px Consolas, ${FONT}`; c.fillStyle = '#eef3f7';
    rows.forEach(r => { r.forEach((v, i) => { c.fillStyle = v === '؟' ? '#ff9f43' : '#eef3f7'; c.fillText(v, W - pad - cw * (i + 0.5), y); }); y += 34 * s; });
    c.textAlign = 'right'; y += 12 * s;
  };
  const r1 = [0, 1, 2].map(i => { const r = T.rows1[i]; return r ? [f(r.F) + ' N', f(r.t, 1) + ' s', f(calc.v1?.[i]) , f(calc.a1?.[i], 0)] : ['—', '—', '—', '—']; });
  table('التجربة 1: r = 0.50 m ثابت', ['F', 't (30 دورة)', 'v (m/s)', 'a (m/s²)'], r1);
  const r2 = [0, 1, 2].map(i => { const r = T.rows2[i]; return r ? [f(r.r) + ' m', f(r.t, 1) + ' s', f(calc.v2?.[i])] : ['—', '—', '—']; });
  table('التجربة 2: F = 0.80 N ثابتة', ['r', 't (30 دورة)', 'v (m/s)'], r2);
  return y;
}
