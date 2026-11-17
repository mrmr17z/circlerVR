// نظام الأصوات: كل المؤثرات مولّدة بـ Web Audio (لا ملفات خارجية).
// لاستبدال أي صوت بملف حقيقي ضع الملف في assets/audio/<name>.mp3 وسيُستخدم تلقائياً.
// في ملف HTML الواحد يستبدل أمر البناء هذا السطر بالأصوات مضمّنة: { manifest, vo: { id: dataURL } }
const EMBED = null;

export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.volume = 0.6; this.files = {};
    this.whirl = null;
  }
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.manifest = { sfx: [], vo: [] };
    if (EMBED) { this.manifest = EMBED.manifest; return; }
    fetch('assets/audio/manifest.json').then(r => r.ok ? r.json() : null).then(m => { if (m) this.manifest = m; this._loadFiles(); }).catch(() => {});
  }
  _loadFiles() {
    for (const n of this.manifest.sfx || []) {
      fetch(`assets/audio/${n}.mp3`).then(r => r.ok ? r.arrayBuffer() : null)
        .then(b => b && this.ctx.decodeAudioData(b)).then(buf => { if (buf) this.files[n] = buf; }).catch(() => {});
    }
  }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.volume; }
  _tone(freq, dur, type = 'sine', gain = 0.25, when = 0, slideTo = null) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, freq, gain = 0.3, q = 1) {
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(this.master); s.start();
  }
  play(name, intensity = 1) {
    if (!this.ctx) return;
    if (this.files[name]) {
      const s = this.ctx.createBufferSource(); s.buffer = this.files[name];
      const g = this.ctx.createGain(); g.gain.value = Math.min(1, intensity);
      s.connect(g).connect(this.master); s.start(); return;
    }
    const k = Math.min(1, intensity);
    switch (name) {
      case 'grab': this._tone(520, 0.06, 'triangle', 0.12); this._noise(0.04, 3000, 0.08); break;
      case 'place': this._noise(0.09, 900, 0.25 * k, 2); this._tone(180, 0.08, 'sine', 0.12 * k); break;
      case 'drop': this._noise(0.18, 400, 0.45 * k, 1.5); this._tone(110, 0.15, 'sine', 0.2 * k); break;
      case 'start': this._tone(330, 0.25, 'sine', 0.15, 0, 660); break;
      case 'timer': this._tone(1200, 0.07, 'square', 0.06); break;
      case 'complete': [660, 880, 1100].forEach((f, i) => this._tone(f, 0.25, 'sine', 0.14, i * 0.12)); break;
      case 'correct': this._tone(660, 0.14, 'sine', 0.15); this._tone(990, 0.22, 'sine', 0.15, 0.12); break;
      case 'wrong': this._tone(220, 0.22, 'triangle', 0.12); this._tone(180, 0.25, 'triangle', 0.1, 0.12); break;
      case 'transition': this._noise(0.6, 1500, 0.12, 0.6); this._tone(300, 0.5, 'sine', 0.06, 0, 600); break;
      case 'cut': this._noise(0.05, 5000, 0.3, 3); this._tone(900, 0.05, 'square', 0.05); break;
      case 'click': this._tone(800, 0.04, 'triangle', 0.1); break;
    }
  }
  // صوت دوران السدادة المستمر: ضجيج مرشّح تتغير شدته وطبقته مع السرعة
  setWhirl(rate) {
    if (!this.ctx) return;
    if (!this.whirl) {
      const c = this.ctx, len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      const g = c.createGain(); g.gain.value = 0;
      const lfo = c.createOscillator(), lg = c.createGain(); lg.gain.value = 0;
      lfo.connect(lg).connect(g.gain);
      s.connect(f).connect(g).connect(this.master); s.start(); lfo.start();
      this.whirl = { f, g, lfo, lg };
    }
    const w = this.whirl, t = this.ctx.currentTime;
    const on = rate > 0.2;
    w.g.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.1);
    w.lg.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.1);
    w.lfo.frequency.setTargetAtTime(Math.max(0.1, rate), t, 0.1);
    w.f.frequency.setTargetAtTime(300 + rate * 260, t, 0.1);
  }
  // كلام المعلم: ملف صوتي إن وُجد (assets/audio/vo/<id>.wav مولّد من Gemini) وإلا تركيب الكلام العربي في المتصفح
  speak(id, text, onEnd) {
    if ((this.manifest?.vo || []).includes(id)) {
      this.stopSpeech();
      const a = new window.Audio(EMBED?.vo?.[id] || `assets/audio/vo/${id}.${this.manifest.voExt || 'mp3'}`); this.voEl = a; a.volume = this.volume; a.onended = onEnd; a.onerror = () => this._tts(text, onEnd); a.play().catch(() => this._tts(text, onEnd)); return;
    }
    this._tts(text, onEnd);
  }
  _tts(text, onEnd) {
    const ss = window.speechSynthesis;
    if (!ss) { setTimeout(() => onEnd && onEnd(), 1500 + text.length * 55); return; }
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ar-SA'; u.rate = 0.95; u.volume = this.volume;
    const v = ss.getVoices().find(v => v.lang && v.lang.startsWith('ar')); if (v) u.voice = v;
    let done = false; const fin = () => { if (!done) { done = true; onEnd && onEnd(); } };
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 3000 + text.length * 90); // احتياط إن لم يدعم الجهاز الصوت العربي
    ss.speak(u);
  }
  stopSpeech() { window.speechSynthesis && window.speechSynthesis.cancel(); const el = this.voEl; this.voEl = null;
    if (el) { const end = el.onended; el.onended = el.onerror = null; el.pause(); end && end(); } }   // الجملة المقطوعة تُعدّ منتهية
}
export const audio = new Audio();
