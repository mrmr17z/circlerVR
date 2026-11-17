// أداة اختبار للمطور: تحاكي حركة الطالب ومدخلاته خطوة بخطوة دون نظارة.
// الاستخدام من وحدة تحكم المتصفح:  const T = await import('/tools/test-harness.js');
import { audio } from '/js/audio.js';
const L = window.__lab, e = L.engine;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const realRender = e.renderer.render.bind(e.renderer);
// تشغيل الإطارات يدوياً بزمن ثابت (1/30 s)
export async function step(sec) {
  e.renderer.render = s => s.updateMatrixWorld(); e.clock.getDelta = () => 1 / 30;
  for (let i = 0; i < sec * 30; i++) { e.scene.updateMatrixWorld(); e._tick(); if (i % 3 === 0) await Promise.resolve(); }
  e.renderer.render = realRender;
}
export async function until(fn, max = 60) { for (let i = 0; i < max * 10; i++) { if (fn()) return true; await step(0.1); await sleep(0); } return false; }
export function clickBtn(id) { const p = e.panels.find(p => p.mesh.visible && !p.minimized && p.buttons.some(b => b.id === id && !b.disabled)); if (!p) return 'no ' + id; p.click(id); return 'ok'; }
export async function walk(x, z, max = 20) {
  e.locked = true; let last = null, stuck = 0;
  for (let i = 0; i < max * 10; i++) {
    const h = e.headPos, dx = x - h.x, dz = z - h.z; if (Math.hypot(dx, dz) < 0.25) break;
    e.rig.rotation.y = Math.atan2(-dx, -dz); e.keys.KeyW = true; await step(0.1);
    if (last && last.distanceTo(e.headPos) < 0.005) { if (++stuck > 4) break; } else stuck = 0; last = e.headPos.clone();
  }
  e.keys.KeyW = false; return e.headPos.clone();
}
export function look(x, y, z) { const h = e.headPos; e.rig.rotation.y = Math.atan2(-(x - h.x), -(z - h.z)); e.pitch = Math.atan2(y - h.y, Math.hypot(x - h.x, z - h.z)); e.camera.rotation.x = e.pitch; }
export function key(c, hold = false) { window.dispatchEvent(new KeyboardEvent('keydown', { code: c })); if (!hold) window.dispatchEvent(new KeyboardEvent('keyup', { code: c })); }
export function click() { document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); }
export async function grab(g) {
  for (let i = 0; i < 40; i++) {
    const p = g.object.getWorldPosition(e.camera.position.clone()); look(p.x, p.y, p.z); await step(0.05);
    if (e.desktop.hover?.type === 'grab' && e.desktop.hover.g === g) { key('KeyE'); await step(0.3); return !!g.held; }
  }
  return false;
}
// وضع الأداة الممسوكة عند نقطة على سطح (بالنظر إليها) ثم إفلاتها
export async function placeAt(x, y, z) { look(x, y, z); await step(0.4); key('KeyE'); await step(0.8); }
export async function answer(id) {
  clickBtn('o:' + id); clickBtn('confirm'); await step(0.2);
  const fb = e.panels.find(p => p.content.border)?.content.body; clickBtn('next'); await step(0.3); return fb;
}
audio.speak = (id, t, cb) => setTimeout(() => cb && cb(), 30);
export const lab = L;
