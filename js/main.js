import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Engine } from './core.js';
import { buildWorld } from './lab.js';
import { loadCharacters } from './characters.js';
import { Station } from './station.js';
import { Director } from './director.js';
import { Scenes } from './scenes.js';
import { audio } from './audio.js';
import { BRAND, logoReady } from './brand.js';
import { studentName, saveStudentName } from './scenes.js';

// شعار الأمد في شاشة البداية وفي زاوية الشاشة أثناء التجربة
logoReady.then(img => {
  if (!img) return;
  for (const id of ['brandLogo', 'brandBadge']) {
    const el = document.getElementById(id), i = new Image(); i.src = img.src; i.alt = BRAND.name; el.appendChild(i); el.classList.add('has-img');
  }
});
// اسم الطالب للشهادة
{ const inp = document.getElementById('studentName'); inp.value = studentName();
  inp.addEventListener('input', () => saveStudentName(inp.value.trim()));
  inp.addEventListener('keydown', e => e.stopPropagation()); }

const engine = new Engine();
const world = buildWorld(engine);
const station = new Station(engine, world);
const $ = id => document.getElementById(id);

// نقطة الدخول: الممر أمام باب المختبر
engine.teleportPlayer({ x: 0, z: 9.4 }, 0);

const chars = await loadCharacters(engine.scene);
const director = new Director(engine, world, chars, station);
const scenes = new Scenes(engine, world, chars, station, director);
window.__lab = { engine, world, station, director, scenes, chars }; // للاختبار من وحدة التحكم

// التجربة تبدأ دائماً من أولها (ساحة رمي المطرقة). الاستئناف اختياري فقط إن وُجد تقدم محفوظ.
const saved = Math.min(director.score.d.scene || 0, 4);
let resumeAt = 0;
$('loading').textContent = 'جاهز — تبدأ التجربة من ساحة رمي المطرقة';
$('btnDesktop').disabled = false;
if (saved > 0) {
  $('btnReset').textContent = `أو تابع من حيث توقفت (المشهد S${saved})`;
  $('btnReset').onclick = () => {
    resumeAt = resumeAt ? 0 : saved;
    $('btnReset').textContent = resumeAt ? `✓ ستتابع من المشهد S${saved} (انقر للبدء من الأول)` : `أو تابع من حيث توقفت (المشهد S${saved})`;
  };
} else $('btnReset').style.display = 'none';

let running = false;
const begin = () => {
  engine.paused = false; $("start").style.display = "none";
  if (running) return; running = true; audio.init();
  if (resumeAt > 0) engine.teleportPlayer({ x: 1.0, z: 2.5 }, 0.6);
  else director.score.clear();
  $('btnReset').style.display = 'none';
  $('btnSkip').classList.add('on'); $('brandBadge').classList.add('on');
  scenes.run(resumeAt);
};
$("btnDesktop").onclick = () => { begin(); engine.locked = true; };

// زر النظارة
if (navigator.xr) {
  navigator.xr.isSessionSupported("immersive-vr").then(ok => {
    if (!ok) { $("btnVR").textContent = "النظارة غير متاحة على هذا الجهاز"; return; }
    $("btnVR").disabled = false;
    const vb = VRButton.createButton(engine.renderer); vb.style.display = "none"; document.body.appendChild(vb);
    $("btnVR").onclick = () => { begin(); vb.click(); };
  });
} else $("btnVR").textContent = "WebXR غير مدعوم (افتح عبر HTTPS في متصفح النظارة)";

// Esc على الكمبيوتر يوقف التجربة مؤقتاً (والضغط على «متابعة» يكملها)
addEventListener("keydown", e => {
  if (e.code !== "Escape" || !running || engine.isXR || engine.paused) return;
  $("start").style.display = "flex"; $("btnDesktop").textContent = "متابعة"; engine.paused = true; engine.locked = false;
});

// زر مؤقت: الانتقال للمشهد التالي (للمراجعة، يُزال لاحقاً) — أو المفتاح N
$('btnSkip').onclick = e => { e.stopPropagation(); e.currentTarget.blur(); scenes.skip(); };
addEventListener('keydown', e => { if (e.code === 'KeyN' && running && !engine.paused) scenes.skip(); });
