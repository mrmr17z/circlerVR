// يبني ملف HTML واحداً مستقلاً يحتوي كل شيء (الكود + Three.js + الشخصيات)
// الاستخدام: node tools/build-single.cjs   ←  الناتج: dist/circular-motion-lab.html
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const map = {};               // مفتاح الوحدة ← مصدرها بعد إعادة كتابة الاستيرادات
let voScript = '';            // أصوات المعلم المضمّنة
const keyOf = abs => '@lab/' + path.relative(root, abs).split(path.sep).join('/');

function resolveSpec(spec, fromAbs) {
  if (spec === 'three') return path.join(root, 'vendor/three/three.module.js');
  if (spec.startsWith('three/addons/')) return path.join(root, 'vendor/three/addons', spec.slice(13));
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromAbs), spec);
  throw new Error('استيراد غير معروف: ' + spec + ' في ' + fromAbs);
}
function addModule(abs) {
  const key = keyOf(abs); if (map[key] !== undefined) return key;
  map[key] = null;
  let src = fs.readFileSync(abs, 'utf8');
  src = src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g, (m, pre, q, spec) => {
    if (!/^(\.|three)/.test(spec)) return m;
    return pre + q + addModule(resolveSpec(spec, abs)) + q;
  });
  // الشخصيات: تضمين ملفات GLB كروابط data
  if (abs.endsWith('characters.js')) {
    src = src.replace(/file: '(assets\/characters\/[^']+\.glb)'/g, (m, f) =>
      `file: 'data:model/gltf-binary;base64,${fs.readFileSync(path.join(root, f)).toString('base64')}'`);
  }
  // شعار الأمد: يُضمَّن إن وُجد ملفه
  if (abs.endsWith('brand.js')) {
    const dir = path.join(root, 'assets/brand');
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find(n => /^logo\.(png|jpe?g|webp|svg)$/i.test(n));
    if (f) {
      const ext = f.split('.').pop().toLowerCase(), mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      src = src.replace(/logo: '[^']+'/, `logo: 'data:${mime};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}'`);
      console.log('logo:', f);
    } else console.log('logo: none (text fallback)');
  }
  // صوت المعلم المولّد (assets/audio/vo/*.wav): يُضمَّن مع القائمة
  if (abs.endsWith('audio.js')) {
    const manPath = path.join(root, 'assets/audio/manifest.json');
    const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { vo: [] };
    const ext = man.voExt || 'mp3', mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg', vo = {};
    for (const id of man.vo || []) { const f = path.join(root, 'assets/audio/vo', `${id}.${ext}`); if (fs.existsSync(f)) vo[id] = `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`; }
    // تُوضع في وسم script عادي مستقل (لا داخل الوحدة) حتى لا تُرمَّز base64 مرتين
    voScript = `<script>window.__LAB_VO=${JSON.stringify({ manifest: { sfx: [], vo: Object.keys(vo), voExt: ext }, vo })};</script>`;
    src = src.replace('const EMBED = null;', 'const EMBED = window.__LAB_VO || null;');
    console.log('voices:', Object.keys(vo).length);
  }
  map[key] = src; return key;
}
const mainKey = addModule(path.join(root, 'js/main.js'));

const imports = {};
for (const [k, src] of Object.entries(map)) imports[k] = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${fs.readFileSync(path.join(root, 'css/style.css'), 'utf8')}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">${JSON.stringify({ imports })}</script>`);
html = html.replace('<script type="module" src="js/main.js"></script>', `${voScript}<script type="module">import '${mainKey}';</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/circular-motion-lab.html');
fs.writeFileSync(out, html);
console.log('modules:', Object.keys(map).length, '· size:', (fs.statSync(out).size / 1048576).toFixed(1), 'MB →', out);
