"""Traces the car's side and plan outlines from the 3D model into data/outlines.json.

Usage: python tools/render_outlines.py
"""
import base64, json, os, subprocess, sys, time
import cv2
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8806
PX = 8
SCALE = 110

MASK_JS = r"""
async ({ scale, px }) => {
  const THREE = await import('./vendor/three/build/three.module.js');
  const C = window.__configurator, v = C.viewer, r = v.renderer, scene = v.scene;
  C.setBuild({ paint: 'giallo-evros', wheels: 'silver', calipers: 'black', interior: 'nero-ade', lift: 'not-fitted' });
  for (const [k, val] of Object.entries({ doors: false, lights: false, wing: 'stowed', lifted: false })) C.state.setPreview(k, val);
  await new Promise((res) => setTimeout(res, 1500));
  const carObjs = scene.children.filter((o) => o !== v.floor && !v.spots.includes(o) && !o.isLight && !(o.isMesh && o.renderOrder === -1));
  const meshes = []; carObjs.forEach((o) => o.traverse((m) => { if (m.isMesh && m.visible) meshes.push(m); }));
  const box = new THREE.Box3(); carObjs.forEach((o) => box.expandByObject(o));
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const saved = meshes.map((m) => [m, m.material, m.renderOrder]);
  const restore = () => saved.forEach(([m, mat, ro]) => { m.material = mat; m.renderOrder = ro; });
  const bg = scene.background, env = scene.environment; scene.background = null;
  const others = []; scene.traverse((o) => { if (o.isMesh && o.visible && !meshes.includes(o)) { others.push(o); o.visible = false; } });

  const wheels = v.wheels.map((w) => {
    const b = new THREE.Box3();
    w.traverse((m) => { if (m.isMesh && m.material.name === 'tyre') b.expandByObject(m); });
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    return { x: c.x, y: c.y, z: c.z, r: Math.max(s.y, s.z) / 2, rim: 0 };
  });
  v.wheels.forEach((w, i) => {
    const b = new THREE.Box3();
    w.traverse((m) => { if (m.isMesh && m.material.name === 'wheel_rim') b.expandByObject(m); });
    const s = b.getSize(new THREE.Vector3()); wheels[i].rim = Math.max(s.y, s.z) / 2;
  });

  const wingMeshes = []; v.wingPivot.traverse((m) => { if (m.isMesh) wingMeshes.push(m); });
  const byName = (names) => (m) => names.includes(m.material.name);

  const render = (cam, w, h, pick) => {
    meshes.forEach((m) => {
      if (!pick || pick(m)) { m.material = white; m.renderOrder = 1000; }
      else { m.material = depthOnly; m.renderOrder = -1000; }
    });
    const rt = new THREE.WebGLRenderTarget(w, h);
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf); rt.dispose();
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4, k = (y * w + x) * 4; const a = buf[i + 3]; id.data[k] = id.data[k + 1] = id.data[k + 2] = a; id.data[k + 3] = 255; }
    g.putImageData(id, 0, 0); restore();
    return c.toDataURL('image/png');
  };

  const len = box.max.z - box.min.z, wid = box.max.x - box.min.x, hei = box.max.y - box.min.y;
  const k = scale * px;
  const out = { box: { min: box.min.toArray(), max: box.max.toArray() }, wheels, masks: {} };

  const sw = Math.round(600 * px), sh = Math.round(260 * px);
  const side = new THREE.OrthographicCamera(-sw / k / 2, sw / k / 2, sh / k / 2, -sh / k / 2, 0.1, 100);
  const cz = (box.min.z + box.max.z) / 2, ground = box.min.y;
  side.position.set(50, ground + (233 - 130) / scale, cz); side.lookAt(0, ground + (233 - 130) / scale, cz); side.updateProjectionMatrix();
  out.side = { cz, ground, px: sw, py: sh };
  out.masks.side = render(side, sw, sh, null);
  const WHEEL_PARTS = ['tyre', 'wheel_rim', 'brake_disc', 'brake_disc_bell', 'brake_caliper'];
  out.masks.sideBody = render(side, sw, sh, (m) => !WHEEL_PARTS.includes(m.material.name) && !wingMeshes.includes(m));
  out.masks.sideWing = render(side, sw, sh, (m) => wingMeshes.includes(m));
  out.masks.sideGlass = render(side, sw, sh, byName(['glass', 'glass_door']));
  const pv = new THREE.Vector3(); v.wingPivot.getWorldPosition(pv); out.wingPivot = [pv.z, pv.y];

  const tw = Math.round(600 * px), th = Math.round(330 * px);
  const top = new THREE.OrthographicCamera(-tw / k / 2, tw / k / 2, th / k / 2, -th / k / 2, 0.1, 100);
  const cx = wheels.reduce((a, w) => a + w.x, 0) / wheels.length;
  top.up.set(-1, 0, 0); top.position.set(cx, 50, cz); top.lookAt(cx, 0, cz); top.updateProjectionMatrix();
  out.top = { cx, cz };
  out.masks.top = render(top, tw, th, null);
  out.masks.topGlass = render(top, tw, th, byName(['glass', 'glass_door']));
  scene.background = bg; scene.environment = env; others.forEach((o) => { o.visible = true; });
  out.dims = { len, wid, hei };
  return out;
}
"""


def decode(url):
    arr = np.frombuffer(base64.b64decode(url.split(',')[1]), np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)


def paths(mask, eps=1.2, min_area=40, holes=False, smooth=1):
    m = cv2.GaussianBlur(mask, (0, 0), PX * 0.35) if smooth else mask
    _, m = cv2.threshold(m, 127, 255, cv2.THRESH_BINARY)
    mode = cv2.RETR_CCOMP if holes else cv2.RETR_EXTERNAL
    contours, _ = cv2.findContours(m, mode, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in contours:
        if cv2.contourArea(c) < min_area * PX * PX:
            continue
        a = cv2.approxPolyDP(c, eps * PX, True).reshape(-1, 2) / PX
        out.append('M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in a) + ' Z')
    return out


def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            page = browser.new_page(viewport={'width': 800, 'height': 450}, reduced_motion='reduce')
            page.route('https://fonts.*/**', lambda r: r.abort())
            page.goto(f'http://127.0.0.1:{PORT}/configure-3d.html?stills', wait_until='domcontentloaded')
            page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=180000)
            res = page.evaluate(MASK_JS, {'scale': SCALE, 'px': PX})
            browser.close()
    finally:
        srv.terminate()

    masks = {k: decode(v) for k, v in res['masks'].items()}
    debug = os.environ.get('OUTLINE_DEBUG')
    if debug:
        os.makedirs(debug, exist_ok=True)
        for k, m in masks.items():
            cv2.imwrite(os.path.join(debug, f'{k}.png'), cv2.resize(m, (m.shape[1] // 4, m.shape[0] // 4)))

    side, top = res['side'], res['top']
    def side_xy(z, y):
        return 300 - (z - side['cz']) * SCALE, 233 - (y - side['ground']) * SCALE
    def top_xy(z, x):
        return 300 - (z - top['cz']) * SCALE, 165 + (x - top['cx']) * SCALE
    wheels = []
    for w in res['wheels']:
        sx, sy = side_xy(w['z'], w['y'])
        tx, ty = top_xy(w['z'], w['x'])
        wheels.append({'side': [round(sx, 1), round(sy, 1)], 'top': [round(tx, 1), round(ty, 1)], 'r': round(w['r'] * SCALE, 1)})
    import math
    fw, rw = sorted(wheels, key=lambda w: w['top'][0])[:2], sorted(wheels, key=lambda w: w['top'][0])[2:]
    f = np.mean([w['top'] for w in fw], axis=0); r_ = np.mean([w['top'] for w in rw], axis=0)
    angle = math.degrees(math.atan2(r_[1] - f[1], r_[0] - f[0]))
    pivot = (f + r_) / 2
    M = cv2.getRotationMatrix2D((float(pivot[0]), float(pivot[1])), angle, 1.0)
    M[1, 2] += 165 - pivot[1]
    for w in wheels:
        x, y = w['top']
        w['top'] = [round(M[0, 0] * x + M[0, 1] * y + M[0, 2], 1), round(M[1, 0] * x + M[1, 1] * y + M[1, 2], 1)]
    Mpx = M.copy(); Mpx[:, 2] *= PX
    for k in ('top', 'topGlass'):
        masks[k] = cv2.warpAffine(masks[k], Mpx, (masks[k].shape[1], masks[k].shape[0]), flags=cv2.INTER_LINEAR)
    data = {
        'plan_view_levelled_by_deg': round(angle, 2),
        'wheels': wheels,
        'side': {'silhouette': paths(masks['side'], eps=0.9), 'body': paths(masks['sideBody'], eps=0.9, min_area=400),
                 'wing': paths(masks['sideWing'], eps=0.5, min_area=4), 'glass': paths(masks['sideGlass'], eps=0.8, min_area=8)},
        'wing_pivot': [round(c, 1) for c in side_xy(*res['wingPivot'])],
        'top': {'body': paths(masks['top'], eps=0.9), 'glass': paths(masks['topGlass'], eps=0.8, min_area=8)},
    }
    json.dump(data, open(os.path.join(ROOT, 'data', 'outlines.json'), 'w'), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else {kk: len(vv) for kk, vv in v.items()} if isinstance(v, dict) and k in ('side', 'top') else v) for k, v in data.items() if k != 'note'}, indent=1))


if __name__ == '__main__':
    main()
