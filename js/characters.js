import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ================================================================
// جدول الشخصيات: لإضافة شخصية أو استبدالها عدّل هذا الجدول فقط
// file: مسار GLB · height: الطول المطلوب بالمتر · clips: أسماء الحركات داخل الملف
// ================================================================
export const CHARACTERS = {
  teacher:   { code: 'CHR-002 / CHR-0119', name: 'معلم الفيزياء',      file: 'assets/characters/teacher.glb',   height: 1.76 },
  thrower:   { code: 'CHR-0114',           name: 'متسابق رمي المطرقة', file: 'assets/characters/thrower.glb',   height: 1.86 },
  student:   { code: 'CHR-0043',           name: 'الطالب المنفّذ',      file: 'assets/characters/student.glb',   height: 1.64 },
  classmate: { code: 'CHR-0044',           name: 'الزميل',             file: 'assets/characters/classmate.glb', height: 1.60 },
};

const loader = new GLTFLoader();

export class Character {
  constructor(key, scene) {
    this.key = key; this.cfg = CHARACTERS[key];
    this.root = new THREE.Group(); this.root.name = key; scene.add(this.root);
    this.actions = {}; this.current = null; this.bones = {}; this.ready = false; this.overrides = [];
    // بديل مؤقت غير بشري (كبسولة بلا وجه) إلى أن يكتمل التحميل
    this.placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, this.cfg.height - 0.44, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a96a3, transparent: true, opacity: 0.6 }));
    this.placeholder.position.y = this.cfg.height / 2; this.root.add(this.placeholder);
  }
  async load() {
    try {
      const gltf = await loader.loadAsync(this.cfg.file);
      const model = gltf.scene;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } if (o.isBone || o.type === 'Bone' || /Bip0\d_/.test(o.name)) { this.bones[o.name.replace(/Bip0\d_/, '')] = o; const m = o.name.match(/^(Bip0\d)_/); if (m) this.prefix = m[1]; } });
      // توحيد الطول ووضع القدمين على الأرض
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true), h = box.max.y - box.min.y;
      const s = this.cfg.height / h; model.scale.multiplyScalar(s);
      model.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(model, true); model.position.y -= b2.min.y;
      this.model = model; this.root.add(model); this.root.remove(this.placeholder);
      this.mixer = new THREE.AnimationMixer(model);
      this.clips = gltf.animations;
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.ready = true;
      this.play(this._pending || 'idle');
    } catch (e) { console.warn('تعذّر تحميل الشخصية', this.key, e); }
    return this;
  }
  has(name) { return !!this.actions[name]; }
  play(name, { loop = true, fade = 0.35, onEnd = null, speed = 1 } = {}) {
    if (!this.ready) { this._pending = name; return; }
    const a = this.actions[name] || this.actions.idle; if (!a) return;
    if (this.current === a && loop) return;
    a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.timeScale = speed;
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false); a.play();
    this.current = a;
    if (!loop) {
      const fn = e => { if (e.action === a) { this.mixer.removeEventListener('finished', fn); onEnd ? onEnd() : this.play('idle'); } };
      this.mixer.addEventListener('finished', fn);
    }
  }
  // الشخصية تواجه نقطة (دوران أفقي سلس)
  face(target, dt = 1) {
    const p = this.root.position, yaw = Math.atan2(target.x - p.x, target.z - p.z);
    let d = yaw - this.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 4);
  }
  // مشي إلى نقطة بحركة walk الموجودة في الملف
  walkTo(target, speed = 0.9) {
    this.walkTarget = target.clone(); this.walkSpeed = speed;
    this.play(this.has('walk') ? 'walk' : 'idle');
    return new Promise(r => this._walkDone = r);
  }
  // حل عكسي لذراع من عظمتين (IK): يضع اليد عند target والمرفق باتجاه hint. لا يعتمد على محاور الهيكل.
  armIK(side, target, hint) {
    const U = this.bones[side + '_UpperArm'], F = this.bones[side + '_Forearm'], H = this.bones[side + '_Hand'];
    if (!U || !F || !H) return;
    this.model.updateMatrixWorld(true);
    const S = U.getWorldPosition(new THREE.Vector3()), E0 = F.getWorldPosition(new THREE.Vector3()), W0 = H.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(E0), b = E0.distanceTo(W0);
    const dirV = target.clone().sub(S); let d = Math.min(dirV.length(), a + b - 0.002); const dir = dirV.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const perp = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
    const elbow = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    aimBone(U, F, elbow); aimBone(F, H, S.clone().addScaledVector(dir, d));
  }
  bonePos(name, out = new THREE.Vector3()) { const b = this.bones[name]; return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out).setY(1.2); }
  update(dt) {
    if (this.walkTarget) {
      // مشي سلس: يلتفت أولاً، يتسارع تدريجياً، يتباطأ قرب الهدف، وسرعة الحركة تطابق إيقاع الخطوات
      const p = this.root.position, d = this.walkTarget.clone().sub(p); d.y = 0;
      const dist = d.length();
      if (dist < 0.04) { this.walkTarget = null; this.curSpeed = 0; this.play('idle', { fade: 0.5 }); this._walkDone?.(); }
      else {
        // حركة المشي لها الأولوية ما دام يمشي (لا يُستبدل بها الكلام أو غيره)
        if (this.has('walk') && this.current !== this.actions.walk) this.play('walk', { fade: 0.25 });
        const yaw = Math.atan2(d.x, d.z); let dy = yaw - this.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.root.rotation.y += dy * Math.min(1, dt * 5);
        const facing = Math.max(0, Math.cos(dy));                  // لا يمشي جانبياً قبل أن يلتفت
        const target = this.walkSpeed * facing * Math.min(1, dist / 0.5);
        this.curSpeed = (this.curSpeed || 0) + (target - (this.curSpeed || 0)) * Math.min(1, dt * 4);
        p.addScaledVector(d.normalize(), Math.min(dist, this.curSpeed * dt));
        if (this.current) this.current.timeScale = THREE.MathUtils.clamp(this.curSpeed / this.walkSpeed, 0.35, 1);
      }
    }
    this.mixer?.update(dt);
    for (const f of this.overrides) f(this);
  }
  setVisible(v) { this.root.visible = v; }
}

// يدوّر العظمة bone (في فضاء العالم) بحيث يتجه ابنها child نحو target
function aimBone(bone, child, target) {
  const bw = bone.getWorldPosition(new THREE.Vector3()), cw = child.getWorldPosition(new THREE.Vector3());
  const cur = cw.sub(bw).normalize(), des = target.clone().sub(bw).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, des);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(pq.multiply(wq)); bone.updateMatrixWorld(true);
}

export async function loadCharacters(scene) {
  const out = {};
  for (const k of Object.keys(CHARACTERS)) out[k] = new Character(k, scene);
  await Promise.all(Object.values(out).map(c => c.load()));
  // شخصية بلا حركة مشي (مثل المعلم): تستعير حركة walk من شخصية بالهيكل العظمي نفسه (Biped)
  // تُنقل الدورانات فقط (بلا الإزاحات) حتى تبقى نسب جسمها كما هي
  for (const c of Object.values(out)) {
    if (!c.ready || c.has('walk')) continue;
    const donor = out.thrower?.has('walk') ? out.thrower : Object.values(out).find(d => d.has('walk'));
    if (!donor) continue;
    const src = donor.clips.find(k => k.name === 'walk');
    const tracks = src.tracks.filter(t => t.name.endsWith('.quaternion') && /^Bip0\d_/.test(t.name))
      .filter(t => c.bones[t.name.split('.')[0].replace(/^Bip0\d_/, '')])
      .map(t => { const n = t.clone(); n.name = t.name.replace(/^Bip0\d_/, c.prefix + '_'); return n; });
    c.actions.walk = c.mixer.clipAction(new THREE.AnimationClip('walk', src.duration, tracks));
  }
  return out;
}
