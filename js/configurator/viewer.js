import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Tweens, ease, lerp } from './animations.js';
import { FINISHES } from './parts.js';

const REAL_LENGTH = 4.78;
const LIFT_HEIGHT = 0.04;
const DOOR_OPEN = 1.15;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export const STUDIO = { wall: 0.22, floor: 0.04, top: 10, side: 4.2, front: 2.4, rear: 1.4 };
function createStudioEnvironment(renderer, o = STUDIO) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.wall, o.wall, o.wall * 1.04), side: THREE.BackSide }));
  room.position.y = 6;
  env.add(room);
  const panel = (w, h, rgb, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot); env.add(m);
  };
  panel(4, 16, [o.top, o.top, o.top], [0, 13.5, 0], [Math.PI / 2, 0, 0]);
  panel(16, 1.4, [o.side, o.side, o.side], [-14.5, 4.5, 0], [0, Math.PI / 2, 0]);
  panel(16, 1.4, [o.side, o.side, o.side], [14.5, 4.5, 0], [0, -Math.PI / 2, 0]);
  panel(9, 3.5, [o.front, o.front * 0.8, o.front * 0.5], [0, 3, 14.5], [0, Math.PI, 0]);
  panel(9, 3.5, [o.rear * 0.85, o.rear * 0.9, o.rear], [0, 3, -14.5], [0, 0, 0]);
  panel(30, 30, [o.floor, o.floor, o.floor], [0, -1.9, 0], [-Math.PI / 2, 0, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function contactShadowTexture(width, length, wheels) {
  const W = 256, H = Math.round(256 * (length / width));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const blob = (cx, cy, rx, ry, a) => {
    g.save(); g.translate(cx, cy); g.scale(rx, ry);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(0,0,0,${a})`); grad.addColorStop(0.6, `rgba(0,0,0,${a * 0.55})`); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  };
  blob(W / 2, H / 2, W * 0.46, H * 0.47, 0.62);
  for (const w of wheels) blob(W / 2 + (w.x / width) * W * 0.8, H / 2 - (w.z / length) * H * 0.85, W * 0.09, H * 0.075, 0.55);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CarViewer extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);

    const scene = this.scene = new THREE.Scene();
    scene.environment = createStudioEnvironment(renderer);
    this.rebuildEnv = (o) => { scene.environment = createStudioEnvironment(renderer, { ...STUDIO, ...o }); this.needsRender = true; this.wake(); };
    scene.environmentIntensity = 1;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    this.camera.position.set(9, 3, 9);

    const controls = this.controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 1.4;
    controls.maxDistance = 12;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.52;
    controls.target.set(0, 0.5, 0);
    controls.addEventListener('start', () => { this.currentView = null; this.dispatchEvent(new CustomEvent('interact')); });
    controls.addEventListener('change', () => { this.needsRender = true; });

    this.tweens = new Tweens(() => this.wake());
    this.needsRender = true;
    this.currentView = null;
    this.running = false;

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(12, 96),
      new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.62, metalness: 0, transparent: true, depthWrite: false,
        alphaMap: radialTexture([[0, '#fff'], [0.18, '#fff'], [0.62, '#000'], [1, '#000']]) }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = -2;
    scene.add(this.floor);

    this.spots = [-1, 1].map(() => {
      const s = new THREE.SpotLight(0xfff4e6, 0, 0, 0.42, 0.65, 2);
      scene.add(s, s.target);
      return s;
    });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas.parentElement;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.needsRender = true;
      this.wake();
    };
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); });
    this.wake();
  }

  wake() {
    if (this.running || document.hidden) return;
    this.running = true;
    let idleFrames = 0;
    const loop = (now) => {
      if (document.hidden) { this.running = false; return; }
      const animating = this.tweens.step(now);
      const moved = this.controls.update();
      if (animating || moved || this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
        idleFrames = 0;
      } else if (++idleFrames > 30) { this.running = false; return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  renderNow() { this.controls.update(); this.renderer.render(this.scene, this.camera); }

  async load(url, onProgress) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    let data = await fetchWithProgress(url, onProgress);
    if (url.endsWith('.txt')) data = base64ToArrayBuffer(new TextDecoder().decode(data));
    const gltf = await loader.parseAsync(data, '');
    this.setupCar(gltf.scene);
    this.needsRender = true;
    this.wake();
  }

  setupCar(car) {
    const nodes = this.nodes = {};
    car.traverse((o) => { if (o.name && !nodes[o.name]) nodes[o.name] = o; });
    for (const n of ['doors_hinge', 'door_a_hinge', 'aero_wing']) if (!nodes[n]) throw new Error(`Model is missing the "${n}" part`);

    nodes.doors_hinge.rotation.set(0, 0, 0);
    nodes.door_a_hinge.rotation.set(0, 0, 0);
    nodes.door_b_hinge.rotation.set(0, -0.465, 0);

    car.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car);
    const size = box.getSize(V()), center = box.getCenter(V());
    const s = REAL_LENGTH / size.z;
    car.scale.setScalar(s);
    car.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    const root = this.root = new THREE.Group();
    root.add(car);
    this.scene.add(root);
    root.updateMatrixWorld(true);
    this.dims = { length: size.z * s, width: size.x * s, height: size.y * s };

    let paintSrc = null;
    car.traverse((o) => { if (o.isMesh && o.material.name === 'paint_body') paintSrc ||= o.material; });
    this.paint = new THREE.MeshPhysicalMaterial({
      name: 'paint_body', color: paintSrc.color.clone(), side: paintSrc.side,
      ...FINISHES.solid, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420],
    });
    car.traverse((o) => { if (o.isMesh && o.material.name === 'paint_body') o.material = this.paint; });

    this.materials = {};
    car.traverse((o) => { if (o.isMesh) (this.materials[o.material.name] ||= new Set()).add(o.material); });
    const mats = (name) => [...(this.materials[name] || [])];
    this.mats = mats;

    // Wheels
    const tyres = [];
    car.traverse((o) => { if (o.isMesh && o.material.name === 'tyre') tyres.push(o); });
    const centers = tyres.map((t) => new THREE.Box3().setFromObject(t).getCenter(V()));
    const SPIN = new Set(['tyre', 'wheel_rim', 'brake_disc', 'brake_disc_bell', 'chrome_dark']);
    const groups = centers.map(() => []);
    const calipers = [];
    const meshes = [];
    car.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      const b = new THREE.Box3().setFromObject(m);
      const c = b.getCenter(V()), sz = b.getSize(V());
      if (Math.max(sz.x, sz.y, sz.z) > 0.9) continue;
      let best = -1, bd = Infinity;
      centers.forEach((wc, i) => { const d = wc.distanceTo(c); if (d < bd) { bd = d; best = i; } });
      if (bd > 0.3) continue;
      if (m.material.name === 'brake_caliper') calipers.push(m);
      else if (SPIN.has(m.material.name)) groups[best].push(m);
    }
    this.wheels = centers.map((wc, i) => {
      const pivot = new THREE.Group();
      pivot.position.copy(wc);
      root.add(pivot);
      pivot.updateMatrixWorld(true);
      groups[i].forEach((m) => pivot.attach(m));
      return pivot;
    });
    calipers.forEach((m) => root.attach(m));
    this.wheelCenters = centers;

    const avg = (arr, k) => arr.reduce((a, v) => a + v[k], 0) / arr.length;
    const rear = centers.filter((c) => c.z < 0), front = centers.filter((c) => c.z >= 0);
    this.wheelbase = avg(front, 'z') - avg(rear, 'z');
    this.frontWheel = front.reduce((a, b) => (b.x > a.x ? b : a));

    const body = this.body = new THREE.Group();
    body.position.set(0, avg(centers, 'y'), avg(rear, 'z'));
    root.add(body);
    body.updateMatrixWorld(true);

    const wing = nodes.aero_wing;
    const wb = new THREE.Box3().setFromObject(wing);
    const wingPivot = this.wingPivot = new THREE.Group();
    wingPivot.position.set((wb.min.x + wb.max.x) / 2, wb.min.y, wb.max.z);
    root.add(wingPivot);
    wingPivot.updateMatrixWorld(true);
    wingPivot.attach(wing);
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.6, roughness: 0.35 });
    const depth = wb.max.z - wb.min.z, span = wb.max.x - wb.min.x;
    this.struts = [-1, 1].map((sx) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.07), strutMat);
      m.position.set(sx * span * 0.2, -0.5, -depth * 0.5);
      m.scale.y = 0.0001; m.visible = false;
      wingPivot.add(m);
      return m;
    });

    body.attach(car);
    body.attach(wingPivot);
    this.wingBaseY = wingPivot.position.y;

    // Lamps
    this.lampOff = {
      front: mats('lamp_front_emitter').map((m) => m.emissive.clone()),
      rear: mats('lamp_rear_emitter').map((m) => m.emissive.clone()),
    };
    const fz = this.dims.length / 2 - 0.45;
    this.spots.forEach((s, i) => {
      const x = (i ? 1 : -1) * 0.62;
      s.position.set(x, 0.62, fz);
      s.target.position.set(x * 1.4, 0, fz + 5);
    });

    // Ground contact shadow
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.dims.width * 1.25, this.dims.length * 1.18),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(this.dims.width * 1.25, this.dims.length * 1.18, centers), transparent: true, depthWrite: false, toneMapped: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.renderOrder = -1;
    this.scene.add(shadow);

    const fw = this.frontWheel;
    this.views = {
      front34: { pos: [3.9, 1.3, 5.0], target: [0, 0.5, 0.1] },
      side:    { pos: [6.7, 0.85, 0.05], target: [0, 0.52, 0.05] },
      rear34:  { pos: [-3.7, 1.75, -4.9], target: [0, 0.62, -0.5] },
      front:   { pos: [0.6, 0.95, 6.8], target: [0, 0.48, 0] },
      wheel:   { pos: [fw.x + 1.85, 0.6, fw.z + 1.45], target: [fw.x, fw.y, fw.z], closeUp: true },
      cabin:   { pos: [2.9, 2.2, -0.6], target: [0, 0.5, 0.5], closeUp: true },
    };
  }

  viewPose(name) {
    const v = this.views[name];
    const target = V(...v.target), pos = V(...v.pos);
    const aspect = this.camera.aspect || 1.6;
    let k = aspect < 1.5 ? Math.pow(1.5 / aspect, 0.9) : 1;
    if (v.closeUp) k = Math.min(k, 1.3);
    return { pos: target.clone().add(pos.sub(target).multiplyScalar(k)), target };
  }

  goTo(name, { duration = 1100 } = {}) {
    if (!this.views?.[name]) return Promise.resolve();
    this.currentView = name;
    const { pos, target } = this.viewPose(name);
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();

    const c0 = V(p0.x, 0, p0.z), c1 = V(pos.x, 0, pos.z);
    const a0 = Math.atan2(c0.x, c0.z), a1 = Math.atan2(c1.x, c1.z);
    let da = a1 - a0; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
    const r0 = c0.length(), r1 = c1.length();
    this.controls.enabled = false;
    return this.tweens.add({
      key: 'camera', duration,
      update: (p) => {
        const a = a0 + da * p, r = lerp(r0, r1, p) + Math.sin(Math.PI * p) * Math.abs(da) * 0.35;
        this.camera.position.set(Math.sin(a) * r, lerp(p0.y, pos.y, p), Math.cos(a) * r);
        this.controls.target.lerpVectors(t0, target, p);
        this.camera.lookAt(this.controls.target);
        this.needsRender = true;
      },
      complete: () => { this.controls.enabled = true; },
    }).then((done) => { if (!done) return; this.controls.enabled = true; });
  }

  // Options

  setPaint(option, { duration = 900 } = {}) {
    const m = this.paint;
    const to = { color: new THREE.Color(option.hex), ...FINISHES[option.finish] };
    const from = { color: m.color.clone(), metalness: m.metalness, roughness: m.roughness, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness, iridescence: m.iridescence };
    return this.tweens.add({
      key: 'paint', duration,
      update: (p) => {
        m.color.copy(from.color).lerp(to.color, p);
        for (const k of ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'iridescence']) m[k] = lerp(from[k], to[k], p);
        this.scene.environmentRotation.y = Math.sin(Math.PI * p) * 0.55;
        this.needsRender = true;
      },
    });
  }

  setWheelFinish(option, { duration = 1200 } = {}) {
    const rims = this.mats('wheel_rim');
    const to = new THREE.Color(option.hex);
    const from = rims.map((r) => ({ c: r.color.clone(), m: r.metalness, r: r.roughness }));
    const spin0 = this.wheels.map((w) => w.rotation.x);
    return this.tweens.add({
      key: 'wheels', duration,
      update: (p) => {
        rims.forEach((r, i) => { r.color.copy(from[i].c).lerp(to, p); r.metalness = lerp(from[i].m, option.metalness, p); r.roughness = lerp(from[i].r, option.roughness, p); });
        this.wheels.forEach((w, i) => { w.rotation.x = spin0[i] + p * Math.PI * 2; });
        this.needsRender = true;
      },
      complete: () => { this.wheels.forEach((w) => { w.rotation.x %= Math.PI * 2; }); },
    });
  }

  setCalipers(option, opts) { return this.tweenColor('calipers', this.mats('brake_caliper'), option.hex, opts); }

  setInterior(option, opts) {
    return this.tweenColor('interior', [...this.mats('interior_leather'), ...this.mats('interior_leather_insert')], option.hex, opts);
  }

  tweenColor(key, materials, hex, { duration = 700 } = {}) {
    const to = new THREE.Color(hex);
    const from = materials.map((m) => m.color.clone());
    return this.tweens.add({ key, duration, update: (p) => { materials.forEach((m, i) => m.color.copy(from[i]).lerp(to, p)); this.needsRender = true; } });
  }

  setLift(raised, { duration = 1400 } = {}) {
    const to = raised ? -Math.atan(LIFT_HEIGHT / this.wheelbase) : 0, from = this.body.rotation.x;
    return this.tweens.add({ key: 'lift', duration, easing: ease.inOutSine, update: (p) => { this.body.rotation.x = lerp(from, to, p); this.needsRender = true; } });
  }

  setWing(position, { duration = 1100 } = {}) {
    const rise0 = this.wingPivot.position.y - this.wingBaseY, rot0 = this.wingPivot.rotation.x;
    const rise1 = position.rise, rot1 = THREE.MathUtils.degToRad(position.deg);
    this.struts.forEach((s) => { s.visible = true; });
    return this.tweens.add({
      key: 'wing', duration,
      update: (p) => {
        const rise = lerp(rise0, rise1, p);
        this.wingPivot.position.y = this.wingBaseY + rise;
        this.wingPivot.rotation.x = lerp(rot0, rot1, p);
        this.struts.forEach((s) => { s.scale.y = Math.max(rise, 0.0001); s.position.y = -rise / 2; });
        this.needsRender = true;
      },
      complete: () => { this.struts.forEach((s) => { s.visible = rise1 > 0.001; }); },
    });
  }

  setDoors(open, { duration = 1500 } = {}) {
    const hinge = this.nodes.doors_hinge, from = hinge.rotation.z, to = open ? DOOR_OPEN : 0;
    return this.tweens.add({ key: 'doors', duration, easing: ease.inOutSine, update: (p) => { hinge.rotation.z = lerp(from, to, p); this.needsRender = true; } });
  }

  setLights(on, { duration = 900 } = {}) {
    const front = this.mats('lamp_front_emitter'), rear = this.mats('lamp_rear_emitter'), led = this.mats('lamp_rear_led');
    const env0 = this.scene.environmentIntensity, env1 = on ? 0.16 : 1;
    const spot0 = this.spots[0].intensity, spot1 = on ? 28 : 0;
    const white = new THREE.Color(1, 1, 1), red = new THREE.Color(1, 0.05, 0.04), black = new THREE.Color(0, 0, 0);
    const f0 = front.map((m) => [m.emissive.clone(), m.emissiveIntensity]);
    const r0 = rear.map((m) => [m.emissive.clone(), m.emissiveIntensity]);
    const l0 = led.map((m) => [m.emissive.clone(), m.emissiveIntensity]);
    return this.tweens.add({
      key: 'lights', duration,
      update: (p) => {
        this.scene.environmentIntensity = lerp(env0, env1, p);
        this.spots.forEach((s) => { s.intensity = lerp(spot0, spot1, p); });
        front.forEach((m, i) => { m.emissive.copy(f0[i][0]).lerp(on ? white : this.lampOff.front[i], p); m.emissiveIntensity = lerp(f0[i][1], on ? 5 : 1, p); });
        rear.forEach((m, i) => { m.emissive.copy(r0[i][0]).lerp(on ? red : this.lampOff.rear[i], p); m.emissiveIntensity = lerp(r0[i][1], on ? 5 : 1, p); });
        led.forEach((m, i) => { m.emissive.copy(l0[i][0]).lerp(on ? red : black, p); m.emissiveIntensity = lerp(l0[i][1], on ? 3 : 1, p); });
        this.needsRender = true;
      },
    });
  }

  snapshot(type = 'image/jpeg', quality = 0.92) {
    this.renderNow();
    return this.renderer.domElement.toDataURL(type, quality);
  }
}
