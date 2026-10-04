"""Renders the picture-configurator layers from the 3D model.

Usage: python tools/render_views.py [view ...]
"""
import base64, io, json, os, subprocess, sys, time
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'views')
PORT = 8792
SIZE = (1600, 900)
SUPERSAMPLE = 1.25

DEFAULT_BUILD = {'paint': 'giallo-evros', 'wheels': 'silver', 'calipers': 'black', 'interior': 'nero-ade', 'lift': 'fitted'}

VIEWS = {
    'front34': {'label': 'Front ¾', 'pos': [3.9, 1.3, 5.0], 'target': [0, 0.5, 0.1], 'states': {'default': {}}},
    'side':    {'label': 'Side', 'pos': [6.7, 0.85, 0.05], 'target': [0, 0.52, 0.05],
                'states': {'lowered': {'lifted': False}, 'raised': {'lifted': True}}},
    'rear34':  {'label': 'Rear ¾', 'pos': [-3.7, 1.75, -4.9], 'target': [0, 0.62, -0.5],
                'states': {'stowed': {'wing': 'stowed'}, 'p4': {'wing': 'p4'}, 'p11': {'wing': 'p11'}}},
    'wheel':   {'label': 'Wheel', 'pos': ['fw.x+1.85', 0.6, 'fw.z+1.45'], 'target': ['fw.x', 'fw.y', 'fw.z'], 'states': {'default': {}}},
    'cabin':   {'label': 'Cabin', 'pos': [2.9, 2.2, -0.6], 'target': [0, 0.5, 0.5], 'states': {'default': {'doors': True}}, 'interior': True},
    'night':   {'label': 'Night', 'pos': [0.6, 0.95, 6.8], 'target': [0, 0.48, 0], 'states': {'default': {'lights': True}}},
}

RENDER_JS = r"""
async ([viewCfg, statePreview, jobs]) => {
  const THREE = await import('./vendor/three/build/three.module.js');
  const C = window.__configurator, v = C.viewer, fw = v.frontWheel;
  const ev = (x) => typeof x === 'string' ? Function('fw', `return ${x}`)(fw) : x;

  for (const [k, val] of Object.entries({ doors: false, lights: false, wing: 'stowed', lifted: false })) C.state.setPreview(k, val);
  for (const [k, val] of Object.entries(statePreview)) C.state.setPreview(k, val);
  const camera = () => {
    v.currentView = null;
    v.camera.fov = 30; v.camera.updateProjectionMatrix();
    v.camera.position.set(...viewCfg.pos.map(ev));
    v.controls.target.set(...viewCfg.target.map(ev));
    v.camera.lookAt(v.controls.target);
  };
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const isGround = (o) => o === v.floor || o.renderOrder === -1;

  const floorLayer = () => {
    const saved = [];
    v.scene.traverse((o) => {
      if (!o.isMesh) return;
      saved.push([o, o.material, o.visible, o.renderOrder]);
      if (isGround(o)) return;
      if (o.material.transparent) { o.visible = false; return; }
      o.material = depthOnly; o.renderOrder = -1000;
    });
    const url = v.snapshot('image/png');
    for (const [o, m, vis, ro] of saved) { o.material = m; o.visible = vis; o.renderOrder = ro; }
    return url;
  };

  const carOnly = () => {
    v.floor.visible = false;
    const url = v.snapshot('image/png');
    v.floor.visible = true;
    return url;
  };
  const layer = (materialNames) => {
    const saved = [];
    v.scene.traverse((o) => {
      if (!o.isMesh) return;
      saved.push([o, o.material, o.visible, o.renderOrder]);
      if (materialNames.includes(o.material.name)) { o.renderOrder = 1000; return; }
      if (o.material.transparent) { o.visible = false; return; }
      o.material = depthOnly;
      o.renderOrder = -1000;
    });
    const url = v.snapshot('image/png');
    for (const [o, m, vis, ro] of saved) { o.material = m; o.visible = vis; o.renderOrder = ro; }
    return url;
  };
  const out = {};
  for (const job of jobs) {
    C.setBuild(job.build);
    camera();
    out[job.name] = job.floor ? floorLayer() : job.layer ? layer(job.layer) : carOnly();
  }
  return out;
}
"""


def decode(data_url):
    im = Image.open(io.BytesIO(base64.b64decode(data_url.split(',')[1]))).convert('RGBA')
    return im.resize(SIZE, Image.LANCZOS)


def edge_fade(size, fx=0.16, fy=0.2):
    w, h = size
    def ramp(n, f):
        edge = max(1, int(n * f))
        vals = []
        for i in range(n):
            t = min(1.0, min(i, n - 1 - i) / edge)
            vals.append(t * t * (3 - 2 * t))
        return vals
    rx, ry = ramp(w, fx), ramp(h, fy)
    col = Image.new('L', (1, h)); col.putdata([int(255 * v) for v in ry])
    row = Image.new('L', (w, 1)); row.putdata([int(255 * v) for v in rx])
    return ImageChops.multiply(col.resize((w, h)), row.resize((w, h)))


def save_webp(im, path, quality):
    im.save(path, 'WEBP', quality=quality, alpha_quality=90, method=6)
    return os.path.getsize(path)


def main(view_ids):
    catalog = json.load(open(os.path.join(ROOT, 'data', 'options.json')))
    group = {g['id']: g for g in catalog['groups']}
    paints = [o['id'] for o in group['paint']['options']]
    wheel_layers = [o['id'] for o in group['wheels']['options'] if o['id'] != group['wheels']['default']]
    caliper_layers = [o['id'] for o in group['calipers']['options'] if o['id'] != group['calipers']['default']]
    interior_layers = [o['id'] for o in group['interior']['options'] if o['id'] != group['interior']['default']]
    os.makedirs(OUT, exist_ok=True)

    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    total_bytes, count, t0 = 0, 0, time.time()
    fade = edge_fade(SIZE)
    floor = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            page = browser.new_page(viewport={'width': round(SIZE[0] * SUPERSAMPLE / 1.25), 'height': round(SIZE[1] * SUPERSAMPLE / 1.25)},
                                    device_scale_factor=1.25, reduced_motion='reduce')
            page.goto(f'http://127.0.0.1:{PORT}/configure-3d.html?stills')
            page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=180000)
            for vid in view_ids:
                cfg = VIEWS[vid]
                for sid, preview in cfg['states'].items():
                    jobs = [{'name': 'floor', 'build': DEFAULT_BUILD, 'floor': True}]
                    jobs += [{'name': f'paint-{pid}', 'build': {**DEFAULT_BUILD, 'paint': pid}} for pid in paints]
                    jobs += [{'name': f'wheels-{w}', 'build': {**DEFAULT_BUILD, 'wheels': w}, 'layer': ['wheel_rim']} for w in wheel_layers]
                    jobs += [{'name': f'calipers-{c}', 'build': {**DEFAULT_BUILD, 'calipers': c}, 'layer': ['brake_caliper']} for c in caliper_layers]
                    if cfg.get('interior'):
                        jobs += [{'name': f'interior-{i}', 'build': {**DEFAULT_BUILD, 'interior': i}, 'layer': ['interior_leather', 'interior_leather_insert']} for i in interior_layers]
                    for k in range(0, len(jobs), 4):
                        batch = jobs[k:k + 4]
                        urls = page.evaluate(RENDER_JS, [cfg, preview, batch])
                        for job in batch:
                            im = decode(urls[job['name']])
                            if job.get('floor'):
                                im.putalpha(ImageChops.multiply(im.getchannel('A'), fade))
                                floor = im
                                continue
                            if not job.get('layer'):
                                base = floor.copy(); base.alpha_composite(im); im = base
                            path = os.path.join(OUT, f'{vid}-{sid}-{job["name"]}.webp')
                            size = save_webp(im, path, 80 if job.get('layer') is None else 85)
                            total_bytes += size; count += 1
                    print(f'{vid}/{sid}: {len(jobs) - 1} images  ({time.time() - t0:.0f}s, {total_bytes / 1e6:.1f} MB so far)', flush=True)
            browser.close()
    finally:
        srv.terminate()

    manifest = {
        'size': list(SIZE),
        'order': list(VIEWS),
        'views': {vid: {'label': cfg['label'], 'states': list(cfg['states']), 'interior': bool(cfg.get('interior'))} for vid, cfg in VIEWS.items()},
        'defaults': {'wheels': group['wheels']['default'], 'calipers': group['calipers']['default'], 'interior': group['interior']['default']},
        'path': 'assets/views/{view}-{state}-{layer}.webp',
    }
    json.dump(manifest, open(os.path.join(ROOT, 'data', 'views.json'), 'w'), indent=2, ensure_ascii=False)
    print(f'Done: {count} images, {total_bytes / 1e6:.1f} MB, {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main(sys.argv[1:] or list(VIEWS))
