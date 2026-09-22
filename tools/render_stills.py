"""Renders the landing-page stills from the 3D model.

Usage: python tools/render_stills.py [name ...]
"""
import base64, io, json, os, subprocess, sys, time
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'img')
PORT = 8791

ARGOS = {'paint': 'arancio-argos', 'wheels': 'glossy-black', 'calipers': 'yellow', 'interior': 'nero-ade', 'lift': 'fitted'}
DEFAULT = {'paint': 'giallo-evros', 'wheels': 'silver', 'calipers': 'black', 'interior': 'nero-ade', 'lift': 'not-fitted'}

STILLS = {
    'seq-paint':       ({**ARGOS, 'wheels': 'silver', 'calipers': 'black'}, {}, [4.25, 1.3, 5.45], [0.05, 0.5, 0.0], 30, (1600, 1200), 4 / 3, 'stage'),
    'seq-wheels':      (ARGOS, {}, ['fw.x+1.7', 0.62, 'fw.z+1.3'], ['fw.x', 'fw.y', 'fw.z'], 30, (1600, 1200), 4 / 3, 'stage'),
    'seq-doors':       (ARGOS, {'doors': True, 'lights': True}, [3.95, 1.25, 5.3], [0.05, 0.62, 0.05], 30, (1600, 1200), 4 / 3, 'night'),
    'seq-wing':        (ARGOS, {'wing': 'p11'}, [-4.0, 1.75, -5.1], [0.1, 0.6, -0.35], 30, (1600, 1200), 4 / 3, 'stage'),
    'starter-argos':   ({**DEFAULT, 'paint': 'arancio-argos', 'wheels': 'glossy-black'}, {}, [3.9, 1.1, 5.0], [0, 0.5, 0.1], 30, (1200, 900), 4 / 3, 'stage'),
    'starter-isis':    ({**DEFAULT, 'paint': 'bianco-isis', 'wheels': 'glossy-black', 'calipers': 'orange'}, {}, [3.9, 1.1, 5.0], [0, 0.5, 0.1], 30, (1200, 900), 4 / 3, 'stage'),
    'starter-nemesis': ({**DEFAULT, 'paint': 'nero-nemesis', 'calipers': 'yellow'}, {}, [3.9, 1.1, 5.0], [0, 0.5, 0.1], 30, (1200, 900), 4 / 3, 'stage'),
    'side-profile':    (DEFAULT, {}, [6.9, 0.7, 0.05], [0, 0.55, 0.05], 30, (1800, 1012), None, 'black'),
    'cabin':           ({**DEFAULT, 'interior': 'terra-dirce'}, {'doors': True}, [2.9, 2.2, -0.6], [0, 0.5, 0.5], 30, (2000, 1125), None, 'stage'),
    'rear34':          (DEFAULT, {}, [-3.9, 1.5, -4.9], [0, 0.6, -0.4], 30, (2000, 1125), None, 'stage'),
    'wheel-silver':    ({**DEFAULT, 'paint': 'grigio-estoque'}, {}, ['fw.x+1.15', 0.38, 'fw.z+0.25'], ['fw.x', 'fw.y', 'fw.z'], 30, (640, 400), 16 / 10, 'stage'),
    'wheel-glossy-black': ({**DEFAULT, 'paint': 'grigio-estoque', 'wheels': 'glossy-black'}, {}, ['fw.x+1.15', 0.38, 'fw.z+0.25'], ['fw.x', 'fw.y', 'fw.z'], 30, (640, 400), 16 / 10, 'stage'),
}


def background(kind, size):
    w, h = size
    if kind == 'black':
        return Image.new('RGB', size, (0, 0, 0))
    inner, outer = ((11, 11, 13), (2, 2, 2)) if kind == 'night' else ((29, 27, 22), (5, 5, 5))
    bg = Image.new('RGB', size, outer)
    glow = Image.new('L', size, 0)
    ImageDraw.Draw(glow).ellipse([w * 0.12, h * 0.25, w * 0.88, h * 1.0], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    bg.paste(Image.new('RGB', size, inner), (0, 0), glow)
    return bg


def main(names):
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            for name in names:
                build, preview, pos, target, fov, size, aspect, bg = STILLS[name]
                vw = round(size[0] / 1.5 * 1.25) if aspect is None else round(size[0] / 1.5 * 1.25 * (16 / 9) / aspect)
                vh = round(vw * 9 / 16)
                page = browser.new_page(viewport={'width': vw, 'height': vh}, device_scale_factor=1.5, reduced_motion='reduce')
                page.goto(f'http://127.0.0.1:{PORT}/configure.html?stills')
                page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=180000)
                data = page.evaluate("""([build, preview, pos, target, fov]) => {
                    const C = window.__configurator, v = C.viewer, fw = v.frontWheel;
                    const ev = (x) => typeof x === 'string' ? Function('fw', `return ${x}`)(fw) : x;
                    C.setBuild(build);
                    for (const [k, val] of Object.entries(preview)) C.state.setPreview(k, val);
                    v.currentView = null;
                    v.camera.fov = fov; v.camera.updateProjectionMatrix();
                    v.camera.position.set(...pos.map(ev));
                    v.controls.target.set(...target.map(ev));
                    v.camera.lookAt(v.controls.target);
                    return v.snapshot('image/png');
                }""", [build, preview, pos, target, fov])
                page.close()
                car = Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).convert('RGBA')
                if aspect:
                    cw = round(car.height * aspect)
                    left = (car.width - cw) // 2
                    car = car.crop((left, 0, left + cw, car.height))
                car = car.resize(size, Image.LANCZOS)
                out = background(bg, size).convert('RGBA')
                out.alpha_composite(car)
                path = os.path.join(OUT, f'{name}.jpg')
                out.convert('RGB').save(path, 'JPEG', quality=84, optimize=True, progressive=True)
                print(f'{name}.jpg  {size[0]}x{size[1]}  {os.path.getsize(path) // 1024} KB')
            browser.close()
    finally:
        srv.terminate()


if __name__ == '__main__':
    main(sys.argv[1:] or list(STILLS))
