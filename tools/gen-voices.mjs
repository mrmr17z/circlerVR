// يولّد صوت المعلم لكل جمل التجربة (VO في js/content.js) عبر Gemini TTS
// الاستخدام:  node tools/gen-voices.mjs            ← يولّد الجمل الجديدة أو التي تغيّر نصها فقط
//             node tools/gen-voices.mjs --force    ← يعيد توليد الكل
//             node tools/gen-voices.mjs s0_1 s2_3  ← جمل محددة
// المفتاح يُقرأ من ملف .env (GEMINI_API_KEY) ولا يُكتب في أي ملف آخر.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TTS_MODEL || env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const VOICE = process.env.GEMINI_VOICE || env.GEMINI_VOICE || 'Charon';
const STYLE = process.env.GEMINI_STYLE || env.GEMINI_STYLE || '';
const OUT_RATE = 16000;   // نحفظ بتردد 16kHz (كافٍ للكلام ويصغّر ملف HTML الواحد)
if (!KEY) { console.error('✗ ضع مفتاحك في ملف .env:  GEMINI_API_KEY=...'); process.exit(1); }

const { VO } = await import('../js/content.js');
const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter(a => !a.startsWith('--'));
const voDir = path.join(root, 'assets/audio/vo'); fs.mkdirSync(voDir, { recursive: true });
const manPath = path.join(root, 'assets/audio/manifest.json');
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
man.sfx ||= []; man.voExt = 'wav'; man.voHash ||= {};
const hash = t => crypto.createHash('sha1').update(VOICE + '|' + STYLE + '|' + t).digest('hex').slice(0, 12);

async function tts(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = { contents: [{ parts: [{ text: STYLE ? `${STYLE}\n${text}` : text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } };
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    if (r.ok) {
      const j = await r.json(), part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part) throw new Error('لا يوجد صوت في الرد: ' + JSON.stringify(j).slice(0, 300));
      const rate = +(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] || 24000);
      return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate };
    }
    const msg = await r.text();
    const quota = msg.match(/"quotaId":\s*"([^"]+)"/)?.[1], delay = +(msg.match(/"retryDelay":\s*"(\d+)/)?.[1] || 0);
    if (r.status === 429 && /PerDay/i.test(quota || '')) throw new Error(`انتهت الحصة اليومية (${quota}) — أعد التشغيل غداً أو فعّل الفوترة`);
    if ((r.status === 429 || r.status >= 500) && attempt < 6) { const w = Math.min(60000, Math.max(delay * 1000 + 1000, 5000 * attempt)); console.log(`  … ${r.status}${quota ? ' ' + quota : ''}، إعادة بعد ${Math.round(w / 1000)}s`); await new Promise(s => setTimeout(s, w)); continue; }
    throw new Error(`HTTP ${r.status}${quota ? ' (' + quota + ')' : ''}: ${msg.slice(0, 300)}`);
  }
}

// PCM 16-bit أحادي → تغيير التردد (خطي) + قص الصمت في الطرفين + ترويسة WAV
function toWav(pcm, rate) {
  const n = pcm.length >> 1, src = new Int16Array(n);
  for (let i = 0; i < n; i++) src[i] = pcm.readInt16LE(i * 2);
  let a = 0, b = n - 1; const th = 300;
  while (a < b && Math.abs(src[a]) < th) a++; while (b > a && Math.abs(src[b]) < th) b--;
  a = Math.max(0, a - Math.round(rate * 0.05)); b = Math.min(n - 1, b + Math.round(rate * 0.15));
  const k = rate / OUT_RATE, m = Math.floor((b - a) / k), out = Buffer.alloc(44 + m * 2);
  for (let i = 0; i < m; i++) {
    const x = a + i * k, i0 = Math.floor(x), f = x - i0, s0 = src[i0], s1 = src[Math.min(i0 + 1, b)];
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * f), 44 + i * 2);
  }
  out.write('RIFF', 0); out.writeUInt32LE(36 + m * 2, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(OUT_RATE, 24);
  out.writeUInt32LE(OUT_RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(m * 2, 40);
  return { wav: out, sec: m / OUT_RATE };
}

console.log(`النموذج: ${MODEL} · الصوت: ${VOICE} · عدد الجمل: ${Object.keys(VO).length}`);
let made = 0, failed = 0;
for (const [id, text] of Object.entries(VO)) {
  if (only.length && !only.includes(id)) continue;
  const file = path.join(voDir, id + '.wav'), h = hash(text);
  if (!force && !only.length && fs.existsSync(file) && man.voHash[id] === h) { console.log(`= ${id} (موجود)`); continue; }
  process.stdout.write(`→ ${id} … `);
  try {
    const { pcm, rate } = await tts(text), { wav, sec } = toWav(pcm, rate);
    fs.writeFileSync(file, wav); man.voHash[id] = h; made++;
    console.log(`${sec.toFixed(1)}s · ${(wav.length / 1024).toFixed(0)} KB`);
  } catch (e) { failed++; console.log('✗ ' + e.message); }
}
// القائمة = الملفات الموجودة لجمل ما زالت في النص
man.vo = Object.keys(VO).filter(id => fs.existsSync(path.join(voDir, id + '.wav')));
for (const id of Object.keys(man.voHash)) if (!VO[id]) delete man.voHash[id];
man._note = 'يُحدَّث تلقائياً بواسطة tools/gen-voices.mjs';
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
console.log(`\nتم: ${made} جديد · ${failed} فشل · ${man.vo.length}/${Object.keys(VO).length} جاهز. بعدها: node tools/build-single.cjs`);
if (failed) process.exit(1);
