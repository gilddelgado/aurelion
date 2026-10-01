"""Renders the hero test-drive video from the 3D model (needs ffmpeg).

Usage: python tools/render_drive.py [--test N] [--from N] [--encode]
"""
import base64, os, subprocess, sys, time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = os.path.join(ROOT, 'tools', '.drive-frames')
OUT = os.path.join(ROOT, 'assets', 'video')
PORT = 8793
W, H = 1280, 720
FPS, SECONDS = 24, 8
SUB = {'A': 12, 'B': 2, 'C': 8}

SETUP_JS = r"""
async ({ fps, seconds, sub }) => {
  const THREE = await import('./vendor/three/build/three.module.js');
  const C = window.__configurator, v = C.viewer, r = v.renderer, scene = v.scene;
  C.setBuild({ paint: 'giallo-evros', wheels: 'silver', calipers: 'black', interior: 'nero-ade', lift: 'fitted' });
  C.state.setPreview('lights', true);
  await new Promise((res) => setTimeout(res, 1600));
  v.controls.enabled = false;
  v.floor.visible = false;
  v.spots.forEach((s) => { s.visible = false; });
  const carObjs = scene.children.filter((o) => o !== v.floor && !v.spots.includes(o) && !o.isLight);

  const SPEED = 24, P = 4;
  const WHEEL_REVS = 91.4;
  const X0 = -3.2, X1 = 7.1, TOP = 5.3;
  const Z0 = -152, Z1 = 40, LEN = Z1 - Z0;
  const LAMP_Y = 3.45, LIGHT = new THREE.Color(1, 0.96, 0.9);
  const BG = 0x060608;

  const canvasTex = (w, h, draw, srgb = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = r.capabilities.getMaxAnisotropy(); return t;
  };
  const noise = (g, w, h, amt) => {
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * amt; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
  };
  const glow = (g, x, y, rx, ry, stops) => {
    g.save(); g.translate(x, y); g.scale(rx / 100, ry / 100);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 100);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(-100, -100, 200, 200); g.restore();
  };

  // Main scene
  const tunnel = new THREE.Group(); scene.add(tunnel);
  const roadW = X1 - X0;
  const roadTex = canvasTex(1024, 1024, (g, w, h) => {
    const X = (x) => (x - X0) / roadW * w, Y = (m) => m / 16 * h;
    g.fillStyle = '#151518'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 14);
    g.globalCompositeOperation = 'lighter';
    for (const zc of [2, 6, 10, 14]) {
      glow(g, X(X0 + 0.9), Y(zc), 250, 170, [[0, 'rgba(255,246,232,0.28)'], [1, 'rgba(255,246,232,0)']]);
      glow(g, X(X1 - 0.9), Y(zc), 250, 170, [[0, 'rgba(255,246,232,0.28)'], [1, 'rgba(255,246,232,0)']]);
      glow(g, X(1.95), Y(zc), 560, 230, [[0, 'rgba(255,246,232,0.10)'], [1, 'rgba(255,246,232,0)']]);
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(226,224,214,0.85)';
    const lw = 0.15 / roadW * w;
    g.fillRect(X(-1.95) - lw / 2, 0, lw, h);
    g.fillRect(X(5.85) - lw / 2, 0, lw, h);
    for (const z0 of [0, 8]) g.fillRect(X(1.95) - lw / 2, Y(z0), lw, Y(3));
    g.fillStyle = '#18181b'; g.fillRect(0, 0, X(-2.6), h); g.fillRect(X(6.5), 0, w - X(6.5), h);
  });
  roadTex.wrapS = THREE.ClampToEdgeWrapping; roadTex.wrapT = THREE.RepeatWrapping; roadTex.repeat.set(1, LEN / 16);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, LEN), new THREE.MeshBasicMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2; road.position.set((X0 + X1) / 2, -0.004, (Z0 + Z1) / 2);
  tunnel.add(road);

  const wallTex = canvasTex(512, 672, (g, w, h) => {
    const Y = (m) => h - m / 5.25 * h, Xm = (m) => m / 4 * w;
    g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c2e32'; g.fillRect(0, Y(3.2), w, Y(0.85) - Y(3.2));
    noise(g, w, h, 8);
    g.fillStyle = '#1e1f23'; g.fillRect(0, Y(0.85), w, h - Y(0.85));
    g.fillStyle = '#3a3b40'; g.fillRect(0, Y(0.85) - 3, w, 4);
    g.fillStyle = 'rgba(10,10,12,0.55)';
    for (const x of [0, 2]) g.fillRect(Xm(x) - 2, Y(3.2), 4, Y(0.85) - Y(3.2));
    g.fillRect(0, Y(2.05) - 1, w, 3);
    g.globalCompositeOperation = 'lighter';
    for (const dx of [-4, 0, 4]) {
      glow(g, Xm(2 + dx), Y(LAMP_Y - 0.25), 300, 380, [[0, 'rgba(255,246,230,0.40)'], [0.45, 'rgba(255,246,230,0.14)'], [1, 'rgba(255,246,230,0)']]);
      glow(g, Xm(2 + dx), Y(LAMP_Y), 120, 40, [[0, 'rgba(255,250,240,0.45)'], [1, 'rgba(255,250,240,0)']]);
    }
  });
  wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(LEN / P, 1);
  const wallTexR = wallTex.clone(); wallTexR.needsUpdate = true;
  const wallGeo = new THREE.PlaneGeometry(LEN, 5.25);
  const wallL = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ map: wallTex }));
  wallL.rotation.y = Math.PI / 2; wallL.position.set(X0, 5.25 / 2, (Z0 + Z1) / 2);
  const wallR = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ map: wallTexR }));
  wallR.rotation.y = -Math.PI / 2; wallR.position.set(X1, 5.25 / 2, (Z0 + Z1) / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(roadW, LEN), new THREE.MeshBasicMaterial({ color: 0x0a0a0c }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set((X0 + X1) / 2, TOP, (Z0 + Z1) / 2);
  tunnel.add(wallL, wallR, ceil);

  const lampMat = new THREE.MeshBasicMaterial({ color: LIGHT.clone().multiplyScalar(6) });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.9, 2.4) });
  const fixtures = new THREE.Group(); tunnel.add(fixtures);
  const lampGeo = new THREE.BoxGeometry(0.12, 0.16, 1.5), ledGeo = new THREE.BoxGeometry(0.04, 0.05, 0.28);
  for (let z = Z0 + 2; z < Z1 + P; z += P) {
    for (const x of [X0 + 0.06, X1 - 0.06]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat); lamp.position.set(x, LAMP_Y, z); fixtures.add(lamp);
      for (const dz of [0, 2]) { const led = new THREE.Mesh(ledGeo, ledMat); led.position.set(x, 0.95, z + dz); fixtures.add(led); }
    }
  }

  const niches = new THREE.Group(); tunnel.add(niches);
  const nicheTex = canvasTex(256, 256, (g, w, h) => glow(g, 128, 128, 128, 128, [[0, 'rgba(70,255,170,0.6)'], [0.25, 'rgba(40,220,140,0.22)'], [1, 'rgba(20,200,120,0)']]));
  for (let z = Z0; z < Z1 + 48; z += 48) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.62), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.7, 0.95) }));
    box.position.set(X0 + 0.04, 1.65, z); niches.add(box);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), new THREE.MeshBasicMaterial({ map: nicheTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.rotation.y = Math.PI / 2; halo.position.set(X0 + 0.02, 1.65, z); niches.add(halo);
  }

  const fz = v.spots[0].position.z;
  const beamTex = canvasTex(256, 512, (g, w, h) => {
    for (const x of [0.32, 0.68]) glow(g, x * w, h * 0.16, 0.2 * w, 0.8 * h, [[0, 'rgba(240,244,255,0.24)'], [0.45, 'rgba(240,244,255,0.09)'], [1, 'rgba(240,244,255,0)']]);
    g.globalCompositeOperation = 'destination-in';
    const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.25, '#000'); gx.addColorStop(0.75, '#000'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
    const gy = g.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.06, '#000'); gy.addColorStop(0.6, '#000'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
  });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 18), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.003, fz + 9.3); tunnel.add(beam);
  scene.fog = new THREE.Fog(BG, 30, 120);
  const bgColor = new THREE.Color(BG);

  // Reflections and car lighting
  const env = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(roadW, TOP, 300), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.012, 0.013), side: THREE.BackSide }));
  box.position.set((X0 + X1) / 2, TOP / 2, 0); env.add(box);
  const clad = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.068, 0.065), side: THREE.DoubleSide });
  for (const x of [X0 + 0.01, X1 - 0.01]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(300, 2.35), clad); m.rotation.y = Math.PI / 2; m.position.set(x, 2.02, 0); env.add(m);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(300, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.95, 1.2), side: THREE.DoubleSide }));
    led.rotation.y = Math.PI / 2; led.position.set(x * 0.999, 0.95, 0); env.add(led);
  }
  const envLamps = new THREE.Group(); env.add(envLamps);
  const envLampMat = new THREE.MeshBasicMaterial({ color: LIGHT.clone().multiplyScalar(16), side: THREE.DoubleSide });
  const envCeilMat = new THREE.MeshBasicMaterial({ color: LIGHT.clone().multiplyScalar(9), side: THREE.DoubleSide });
  for (let z = -150 + 2; z <= 150; z += P) {
    for (const x of [X0 + 0.03, X1 - 0.03]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.22), envLampMat); m.rotation.y = Math.PI / 2; m.position.set(x, LAMP_Y, z); envLamps.add(m); }
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.1), envCeilMat); c.rotation.x = Math.PI / 2; c.position.set(1.95, TOP - 0.02, z); envLamps.add(c);
  }
  const pmrem = new THREE.PMREMGenerator(r);
  const envCache = new Map(), STEPS = 32, envPos = new THREE.Vector3(0, 0.7, 0);
  const envFor = (d) => {
    const k = Math.round(((d % P) / P) * STEPS) % STEPS;
    if (!envCache.has(k)) { envLamps.position.z = -(k / STEPS) * P; envCache.set(k, pmrem.fromScene(env, 0, 0.1, 200, { size: 256, position: envPos }).texture); }
    return envCache.get(k);
  };
  scene.environmentIntensity = 1.55;

  // Car parts for the passes
  const meshes = []; carObjs.forEach((o) => o.traverse((m) => { if (m.isMesh) meshes.push(m); }));
  const orig = new Map(meshes.map((m) => [m, [m.material, m.visible, m.renderOrder]]));
  const rims = meshes.filter((m) => m.material.name === 'wheel_rim');
  const OCCLUDERS = ['tyre', 'brake_caliper', 'brake_disc', 'brake_disc_bell', 'paint_body'];
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const restore = () => { for (const [m, [mat, vis, ro]] of orig) { m.material = mat; m.visible = vis; m.renderOrder = ro; } };
  const mode = (p) => {
    restore();
    tunnel.visible = p === 'A';
    carObjs.forEach((o) => { o.visible = p !== 'A'; });
    scene.background = p === 'A' ? bgColor : null;
    if (p === 'B') rims.forEach((m) => { m.visible = false; });
    if (p === 'C') for (const m of meshes) {
      if (rims.includes(m)) { m.renderOrder = 1000; continue; }
      if (orig.get(m)[1] && !m.material.transparent && OCCLUDERS.includes(m.material.name)) { m.material = depthOnly; m.renderOrder = -1000; }
      else m.visible = false;
    }
  };

  // Motion
  const cam = v.camera, base = { pos: new THREE.Vector3(4.75, 0.8, 5.85), target: new THREE.Vector3(-0.46, 0.5, 0.67) };
  cam.fov = 26; cam.far = 200; cam.updateProjectionMatrix();
  v.controls.target.copy(base.target);
  const bodyY = v.body.position.y, wheel0 = v.wheels.map((w) => w.rotation.x);
  v.currentView = null;
  const TAU = Math.PI * 2;
  let envOn = true;
  const setTime = (t) => {
    const u = t / seconds, d = SPEED * t;
    roadTex.offset.y = -((d / 16) % 1);
    wallTex.offset.x = -((d / P) % 1);
    wallTexR.offset.x = (d / P) % 1;
    fixtures.position.z = -(d % P);
    niches.position.z = -(d % 48);
    if (envOn) scene.environment = envFor(d);
    v.wheels.forEach((w, i) => { w.rotation.x = wheel0[i] + TAU * WHEEL_REVS * u; });
    v.body.position.y = bodyY + 0.0022 * Math.sin(TAU * 24 * u) + 0.0012 * Math.sin(TAU * 42 * u + 1.3);
    v.body.rotation.z = 0.0012 * Math.sin(TAU * 10 * u);
    cam.position.copy(base.pos).add(new THREE.Vector3(0.16 * Math.sin(TAU * u), 0.035 * Math.sin(TAU * 2 * u + 0.5), 0.06 * Math.sin(TAU * u + 1)));
    cam.lookAt(base.target);
  };

  // Accumulation and compositing
  const gl = r.getContext();
  const w = r.domElement.width, h = r.domElement.height, n = w * h;
  const px = new Uint8Array(n * 4);
  const acc = { A: new Float32Array(n * 4), B: new Float32Array(n * 4), C: new Float32Array(n * 4) };
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d'); const id = octx.createImageData(w, h);
  const pass = (p, f) => {
    const a = acc[p], count = sub[p]; a.fill(0); mode(p); envOn = p !== 'A';
    for (let s = 0; s < count; s++) {
      setTime((f + ((s + 0.5) / count) * 0.5) / fps);
      r.render(scene, cam);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < px.length; i++) a[i] += px[i];
    }
    for (let i = 0; i < a.length; i++) a[i] /= count * 255;
  };
  window.__drive = {
    frame(f) {
      const t0 = performance.now(), T = {};
      for (const p of ['A', 'B', 'C']) { const t = performance.now(); pass(p, f); T[p] = Math.round(performance.now() - t); }
      restore();
      const A = acc.A, B = acc.B, Cc = acc.C, d = id.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = ((h - 1 - y) * w + x) * 4, k = (y * w + x) * 4;
          const ca = Cc[i + 3], ba = B[i + 3] * (1 - ca) + ca;
          for (let c = 0; c < 3; c++) {
            const car = Cc[i + c] + (1 - ca) * B[i + c];
            d[k + c] = Math.min(255, (car + (1 - ba) * A[i + c]) * 255 + 0.5);
          }
          d[k + 3] = 255;
        }
      }
      octx.putImageData(id, 0, 0);
      T.total = Math.round(performance.now() - t0);
      return { url: out.toDataURL('image/jpeg', 0.94), T };
    },
  };
  return [w, h, rims.length, meshes.length];
}
"""


def main():
    test = int(sys.argv[sys.argv.index('--test') + 1]) if '--test' in sys.argv else None
    start = int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 0
    total = FPS * SECONDS
    end = min(total, start + test) if test else total
    os.makedirs(FRAMES, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    if '--encode' in sys.argv:
        return encode(total, time.time())
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    t0 = time.time()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1, reduced_motion='reduce')
            page.route('https://fonts.*/**', lambda r: r.abort())
            page.goto(f'http://127.0.0.1:{PORT}/configure-3d.html?stills', wait_until='domcontentloaded')
            page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=180000)
            print('setup', page.evaluate(SETUP_JS, {'fps': FPS, 'seconds': SECONDS, 'sub': SUB}), flush=True)
            for f in range(start, end):
                res = page.evaluate('f => window.__drive.frame(f)', f)
                with open(os.path.join(FRAMES, f'{f:04d}.jpg'), 'wb') as fh:
                    fh.write(base64.b64decode(res['url'].split(',')[1]))
                if f % 12 == 0 or test:
                    print(f'frame {f + 1}/{total}  {res["T"]}  ({time.time() - t0:.0f}s)', flush=True)
            browser.close()
    finally:
        srv.terminate()
    if test:
        return
    encode(total, t0)


def encode(total, t0):
    missing = [f for f in range(total) if not os.path.exists(os.path.join(FRAMES, f'{f:04d}.jpg'))]
    if missing:
        sys.exit(f'missing frames: {missing[:10]}...')
    enc = lambda args: subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(FRAMES, '%04d.jpg'), *args], check=True)
    x264 = ['-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'film', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']
    enc([*x264, '-crf', '23', os.path.join(OUT, 'test-drive-1280.mp4')])
    enc(['-vf', 'scale=854:-2:flags=lanczos', *x264, '-crf', '25', os.path.join(OUT, 'test-drive-854.mp4')])
    enc(['-c:v', 'libsvtav1', '-preset', '4', '-crf', '38', '-g', '96', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
         os.path.join(OUT, 'test-drive-1280-av1.mp4')])
    from PIL import Image
    Image.open(os.path.join(FRAMES, '0000.jpg')).save(os.path.join(OUT, 'test-drive-poster.webp'), 'WEBP', quality=78, method=6)
    Image.open(os.path.join(FRAMES, '0000.jpg')).resize((854, 480), Image.LANCZOS).save(os.path.join(OUT, 'test-drive-poster-854.webp'), 'WEBP', quality=76, method=6)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
    print(f'Done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
