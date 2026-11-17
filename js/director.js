import * as THREE from 'three';
import { Panel, COLORS, FONT, wrap, bidi } from './ui.js';
import { audio } from './audio.js';
import { SCENES, RULES, VO, Q } from './content.js';

// ================================================================
// أنظمة مشتركة بين المشاهد: الدرجات والحفظ، لوحة الإرشاد، الأسئلة، كلام المعلم، الانتظار
// ================================================================

const SAVE_KEY = 'circular-motion-vr-v1';

export class Score {
  constructor() { this.reset(); this.load(); }
  reset() {
    this.d = { scene: 0, items: {}, critical: { safety: false, tangent: false }, pre: null, post: null, self: null, table: {}, log: [] };
  }
  load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.items) this.d = { ...this.d, ...s }; } catch (e) { } }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.d)); } catch (e) { } }
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } this.reset(); }
  // يسجّل بنداً: scene, id, earned, max
  set(scene, id, earned, max, meta = {}) { this.d.items[`${scene}:${id}`] = { scene, id, earned: Math.round(earned * 10) / 10, max, ...meta }; this.save(); }
  clearScene(scene) { for (const k of Object.keys(this.d.items)) if (k.startsWith(scene + ':')) delete this.d.items[k]; this.save(); }
  sceneTotal(scene) { let e = 0, m = 0; for (const it of Object.values(this.d.items)) if (it.scene === scene) { e += it.earned; m += it.max; } return { e, m }; }
  summary() {
    const perf = { e: 0, m: 0 }, test = { e: 0, m: 0 };
    for (const sc of SCENES) {
      if (!sc.counted) continue; const t = this.sceneTotal(sc.id), tgt = sc.kind === 'perf' ? perf : test;
      tgt.e += t.e; tgt.m += sc.max;
    }
    const p = perf.e / perf.m, t = test.e / test.m, comp = RULES.weights.perf * p + RULES.weights.test * t;
    const crit = Object.entries(this.d.critical).filter(([, v]) => v).map(([k]) => k);
    const pass = comp >= RULES.pass.composite && p >= RULES.pass.perf && t >= RULES.pass.test && crit.length === 0;
    return { perf, test, p, t, comp, crit, pass, total: perf.e + test.e };
  }
}

export class Director {
  constructor(engine, world, chars, station) {
    this.e = engine; this.W = world; this.c = chars; this.st = station;
    this.score = new Score(); this.waiters = []; this.sceneStart = 0; this.cur = null;
    this.step = ''; this.next = ''; this.sub = '';
    this._guide(); engine.addUpdate((dt, t) => this._update(dt, t));
  }

  // ---------- الانتظار ----------
  wait(sec) { const until = this.e.time + sec; return this.until(() => this.e.time >= until); }
  until(pred) { return new Promise(res => this.waiters.push({ pred, res })); }
  _update(dt) {
    for (const w of [...this.waiters]) if (w.pred()) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(); }
    for (const ch of Object.values(this.c)) ch.update(dt);
    this._followGuide(dt);
    if ((this._gT = (this._gT || 0) + dt) > 1) { this._gT = 0; this.guide.redraw(); }
  }

  // ---------- لوحة الإرشاد (تتبع نظر الطالب بلطف ويمكن تصغيرها) ----------
  _guide() {
    const p = this.guide = new Panel({ w: 3.2, h: 1.8, ppm: 500, name: 'التعليمات', textScale: 1.3 });
    this.e.scene.add(p.mesh); this.e.registerPanel(p);
    p.customDraw = (c, W, H, s, y, pad) => {
      // شريط التقدم: المشاهد الخمسة
      const n = SCENES.length, gw = (W - 2 * pad - 140 * s) / n;
      SCENES.forEach((sc, i) => {
        const x = W - pad - (i + 1) * gw, idx = SCENES.indexOf(this.cur);
        c.fillStyle = i < idx ? '#2f9e6e' : i === idx ? '#ffcf4a' : '#3b4a58'; c.fillRect(x + 4 * s, 22 * s, gw - 8 * s, 10 * s);
        c.fillStyle = i === idx ? '#ffcf4a' : '#9fb0bf'; c.font = `${20 * s}px ${FONT}`; c.textAlign = 'center'; c.fillText(sc.id, x + gw / 2, 38 * s);
      });
      c.textAlign = 'right';
      if (this.cur) {
        const el = this.e.time - this.sceneStart, m = Math.floor(el / 60), sec = Math.floor(el % 60);
        c.font = `${22 * s}px ${FONT}`; c.fillStyle = '#9fb0bf';
        c.fillText(`${this.cur.name} · ${m}:${String(sec).padStart(2, '0')} / ${this.cur.dur} (مدة إرشادية)`, W - pad, 70 * s);
      }
      c.font = `bold ${34 * s}px ${FONT}`; c.fillStyle = '#ffcf4a';
      let yy = 106 * s;
      for (const l of wrap(c, bidi('▸ ' + (this.step || '')), W - 2 * pad)) { c.fillText(l, W - pad, yy); yy += 44 * s; }
      if (this.sub) { c.font = `${27 * s}px ${FONT}`; c.fillStyle = '#e4ecf2'; for (const l of wrap(c, bidi(this.sub), W - 2 * pad).slice(0, 2)) { c.fillText(l, W - pad, yy); yy += 37 * s; } }
      if (this.next) { c.font = `${23 * s}px ${FONT}`; c.fillStyle = '#8fa3b5'; c.fillText('التالي: ' + this.next, W - pad, H - 130 * s); }
      return yy;
    };
    p.onClick = id => {
      if (id === 'vdn') audio.setVolume(audio.volume - 0.15);
      if (id === 'vup') audio.setVolume(audio.volume + 0.15);
      if (id === 'rep' && this.lastVO) this.say(this.lastVO);
      if (id === 'turn') { this.e.settings.snapTurn = !this.e.settings.snapTurn; this._guideButtons(); }
      if (id === 'skip') this.onSkip?.();
      p.redraw();
    };
    this._guideButtons();
    this.guideAnchor = new THREE.Vector3(); this.guideYaw = null;
  }
  _guideButtons() {
    this.guide.set({ cols: 5, btnH: 52, buttons: [
      { id: 'rep', label: '↻ أعد الكلام', size: 24 }, { id: 'vdn', label: 'صوت −', size: 24 }, { id: 'vup', label: 'صوت +', size: 24 },
      { id: 'turn', label: this.e.settings.snapTurn ? 'التفاف: متقطع' : 'التفاف: سلس', size: 22 },
      { id: 'skip', label: '⏭ المشهد التالي (مؤقت)', size: 20, color: '#8a5a12' } ] });   // زر مؤقت للمراجعة
  }
  setStep(step, next = '', sub = null) { this.step = step; this.next = next; if (sub !== null) this.sub = sub; this.guide.redraw(); }
  // لوحة الإرشاد مثبّتة على سبورة في المشهد (لا تتبع الطالب): تُعرض على أقرب سبورة في المنطقة التي هو فيها
  // التعليمات ثابتة: في ساحة الرمي على لوحتها، وفي المختبر على شاشة العرض الكبيرة (لا تتبع الطالب ولا تتحرك حين يلتفت)
  _followGuide(dt) {
    const head = this.e.headPos, m = this.guide.mesh;
    const where = head.x < -30 ? 'field' : 'screen';
    if (where === this.guideWhere) return;
    this.guideWhere = where;
    const fb = (this.W.boards || []).find(b => b.id === 'field');
    if (where === 'field' && fb) {
      fb.front.visible = false; m.position.copy(fb.pos); m.rotation.set(0, fb.yaw, 0); m.scale.setScalar(fb.w / 3.2);
      this.W.screen.mesh.visible = true; this.guideBoard = fb;
    } else {
      // فوق شاشة العرض مباشرة وبحجمها
      const s = this.W.screen.mesh; s.updateWorldMatrix(true, false);
      m.position.setFromMatrixPosition(s.matrixWorld).add(new THREE.Vector3(0, 0, 0.005)); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
      s.visible = false; this.guideBoard = { id: 'screen' };
    }
  }
  // يضع لوحة (مثل جدول البيانات) على سبورة بعينها؛ لا تُستخدم السبورة نفسها للتعليمات
  mountOnBoard(panel, id) {
    const b = (this.W.boards || []).find(b => b.id === id); if (!b) return;
    const old = (this.W.boards || []).find(x => x.id === this.tableBoard); if (old) old.front.visible = true;
    this.tableBoard = id; b.front.visible = false; if (this.guideBoard === b) this.guideBoard = null;
    panel.mesh.position.copy(b.pos); panel.mesh.rotation.set(0, b.yaw, 0);
  }

  // ---------- كلام المعلم: ترجمة نصية + صوت + حركة كلام ----------
  say(key, text = VO[key]) {
    this.lastVO = key; this.sub = '🗣 المعلم: ' + text; this.guide.redraw();
    const t = this.c.teacher;
    if (t?.ready && !t.walkTarget) t.play(Math.random() > 0.5 ? 'talk1' : 'talk2');
    const tok = this.token;
    return new Promise(res => audio.speak(key, text, () => { if (tok !== this.token) return; if (t?.ready && !t.walkTarget) t.play('idle'); res(); }));
  }
  // إلغاء المشهد الجاري (عند التخطي): كل الانتظارات المعلّقة لا تكتمل أبداً، فيتوقف كود المشهد القديم
  abort() { this.token = (this.token || 0) + 1; this.waiters = []; }

  // ---------- لوحة سؤال (اختيار ← تأكيد ← تغذية راجعة ← إعادة المحاولة) ----------
  // يعيد { correct, attempts, earned, choice }
  ask(q, { scene, place = null, w = 1.15, h = 0.85, maxAttempts = RULES.maxAttempts, draw = null, scoreId = q.id, noScore = false, exactBad = null } = {}) {
    return new Promise(resolve => {
      const p = new Panel({ w, h, ppm: 900, name: 'السؤال' });
      this.e.scene.add(p.mesh); this.e.registerPanel(p);
      this._placePanel(p, place);
      let sel = null, attempts = 0, hintUsed = false, state = 'choose', fb = '', fbOk = false;
      const opts = q.options.map((o, i) => ({ ...o, letter: 'أبجد'[i] }));
      if (draw) p.customDraw = draw;
      const render = () => {
        const buttons = opts.map(o => ({ id: 'o:' + o.id, label: `${o.letter}) ${o.t}`, size: 27,
          state: state === 'feedback' && o.id === sel ? (fbOk ? 'ok' : 'bad') : (o.id === sel ? 'sel' : null), disabled: state === 'feedback' }));
        if (state === 'choose') {
          buttons.push({ id: 'confirm', label: 'تأكيد الإجابة', bold: true, color: '#2f7d5b', disabled: !sel });
          if (q.hint && !q.pre) buttons.push({ id: 'hint', label: hintUsed ? 'تلميح: ' + q.hint : 'تلميح (يخصم ربع النقاط)', size: hintUsed ? 21 : 26, disabled: hintUsed });
        } else buttons.push({ id: 'next', label: fbOk || attempts >= maxAttempts || q.pre ? 'متابعة' : 'حاول مرة أخرى', bold: true, color: '#3d79b8' });
        p.set({ tag: (q.tag || '') + (attempts && !q.pre ? `  ·  المحاولة ${Math.min(attempts + (state === 'choose' ? 1 : 0), maxAttempts)} من ${maxAttempts}` : ''), title: q.title, titleSize: 34,
          body: state === 'feedback' ? fb : (q.body || ''), bodyColor: state === 'feedback' ? (fbOk ? '#7dffb0' : '#ffb3a8') : undefined, bodySize: 28,
          buttons, cols: opts.length > 3 || buttons.length > 5 ? 2 : 1, btnH: 70, btnTop: true,
          border: state === 'feedback' ? (fbOk ? COLORS.ok : COLORS.bad) : null });
      };
      p.onClick = id => {
        if (id.startsWith('o:') && state === 'choose') { sel = id.slice(2); render(); }
        else if (id === 'hint') { hintUsed = true; render(); }
        else if (id === 'confirm' && sel) {
          attempts++; fbOk = sel === q.correct;
          fb = fbOk ? q.fb.ok : (exactBad && exactBad[sel]) || q.fb.bad;
          if (!q.pre) { audio.play(fbOk ? 'correct' : 'wrong'); const t = this.c.teacher; if (t?.ready && !t.walkTarget) t.play(fbOk ? 'nod' : 'shake', { loop: false }); }
          state = 'feedback'; this.score.d.log.push({ q: q.id, choice: sel, ok: fbOk, t: Date.now() }); render();
        } else if (id === 'next') {
          if (fbOk || attempts >= maxAttempts || q.pre) {
            const factor = fbOk ? RULES.attemptFactor[Math.min(attempts - 1, 2)] * (hintUsed ? 1 - RULES.hintPenalty : 1) : 0;
            const earned = (q.points || 0) * factor;
            if (!noScore && scene && q.points) this.score.set(scene, scoreId, earned, q.points, { attempts, hint: hintUsed, ok: fbOk });
            this.e.unregisterPanel(p);
            resolve({ correct: fbOk, attempts, earned, choice: sel, hint: hintUsed });
          } else { state = 'choose'; sel = null; render(); }
        }
      };
      render();
    });
  }
  // يضع اللوحة أمام الطالب (أو في مكان محدد)
  _placePanel(p, place) {
    if (place && place.pos) { p.mesh.position.copy(place.pos); if (place.lookAt) p.mesh.lookAt(place.lookAt); else p.mesh.rotation.set(0, place.yaw || 0, 0); return; }
    const cam = this.e.camera, head = cam.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    // تظهر اللوحة إلى يمين مجال النظر وأسفله قليلاً، فيبقى ما ينظر إليه الطالب مكشوفاً
    const d = (place && place.dist) || 1.5, a = yaw - 0.4, dy = this.e.isXR ? 0.2 : 0.18;
    p.mesh.position.set(head.x - Math.sin(a) * d, head.y - dy, head.z - Math.cos(a) * d);
    p.mesh.lookAt(head.x, head.y - dy * 0.5, head.z);
  }
  // لوحة معلومات/متابعة بسيطة (زر واحد أو أكثر)
  info(content, { place = null, w = 1.0, h = 0.6, buttons = [{ id: 'ok', label: 'متابعة', bold: true, color: '#3d79b8' }] } = {}) {
    return new Promise(res => {
      const p = new Panel({ w, h, ppm: 900 }); this.e.scene.add(p.mesh); this.e.registerPanel(p); this._placePanel(p, place);
      p.set({ ...content, buttons, cols: buttons.length });
      p.onClick = id => { this.e.unregisterPanel(p); res(id); };
    });
  }

  startScene(i) {
    this.cur = SCENES[i]; this.sceneStart = this.e.time; this.score.d.scene = i; this.score.save();
    this.score.clearScene(this.cur.id); this.sub = ''; audio.play('transition');
  }
}
