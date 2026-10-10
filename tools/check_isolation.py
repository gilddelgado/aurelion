"""Checks that every option changes only its own part, in both configurators.

Usage: python tools/check_isolation.py
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8790

PROBE = r"""
async () => {
  const C = window.__configurator, v = C.viewer, s = C.state;
  const allowed = { paint: ['paint_body'], wheels: ['wheel_rim'], calipers: ['brake_caliper'],
                    interior: ['interior_leather', 'interior_leather_insert'], lift: [] };
  const snap = () => {
    const mats = {};
    v.root.traverse((o) => { if (o.isMesh) { const m = o.material; mats[m.uuid] ||= { name: m.name,
      sig: [m.color?.getHexString(), (m.metalness ?? 0).toFixed(3), (m.roughness ?? 0).toFixed(3), m.emissive?.getHexString(),
            (m.emissiveIntensity ?? 0).toFixed(2), (m.clearcoat ?? 0).toFixed(3), (m.iridescence ?? 0).toFixed(3)].join('|') }; } });
    const r = (o) => [o.position.toArray(), o.rotation.toArray().slice(0, 3)].flat().map((x) => x.toFixed(4)).join(',');
    return { mats, nodes: { body: r(v.body), wing: r(v.wingPivot), doors: r(v.nodes.doors_hinge), wheels: v.wheels.map(r).join(';') } };
  };
  const report = [];
  for (const g of s.groups) {
    for (const o of g.options) {
      for (const g2 of s.groups) C.setBuild({ [g2.id]: g2.default });
      await new Promise((r) => setTimeout(r, 30));
      const before = snap();
      C.setBuild({ [g.id]: o.id });
      await new Promise((r) => setTimeout(r, 30));
      const after = snap();
      const changedMats = Object.keys(after.mats).filter((k) => after.mats[k].sig !== before.mats[k].sig).map((k) => after.mats[k].name);
      const changedNodes = Object.keys(after.nodes).filter((k) => after.nodes[k] !== before.nodes[k]);
      const stray = [...new Set(changedMats)].filter((n) => !allowed[g.id].includes(n));
      const isDefault = o.id === g.default;
      const ok = stray.length === 0 && changedNodes.filter((n) => n !== 'wheels' || g.id !== 'wheels').length === 0 && (isDefault || changedMats.length > 0 || g.id === 'lift');
      report.push({ group: g.id, option: o.id, ok, changed: [...new Set(changedMats)], stray, changedNodes });
    }
  }
  return report;
}
"""

PICTURE_PROBE = r"""
async () => {
  const C = window.__configurator, st = C.viewer, s = C.state;
  const defaults = Object.fromEntries(s.groups.map((g) => [g.id, g.default]));
  const ownPart = { paint: 'paint', wheels: 'wheels', calipers: 'calipers', interior: 'interior', lift: null };
  const report = [];
  const missing = new Set();
  const exists = async (url) => (await fetch(url, { method: 'HEAD' })).ok;
  for (const view of Object.keys(st.manifest.views)) {
    for (const viewState of st.manifest.views[view].states) {
      const base = st.layersFor(view, defaults, viewState);
      for (const g of s.groups) {
        for (const o of g.options) {
          const layers = st.layersFor(view, { ...defaults, [g.id]: o.id }, viewState);
          const byPart = (ls) => Object.fromEntries(ls.map((l) => [l.part, l.url]));
          const a = byPart(base), b = byPart(layers);
          const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
          const stray = changed.filter((p) => p !== ownPart[g.id]);
          for (const l of layers) if (!(await exists(l.url))) missing.add(l.url);
          report.push({ view: `${view}/${viewState}`, group: g.id, option: o.id, ok: stray.length === 0, changed, stray });
        }
      }
    }
  }
  return { report, missing: [...missing] };
}
"""

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': 960, 'height': 600}, reduced_motion='reduce')
        page.route('https://fonts.*/**', lambda r: r.abort())
        page.goto(f'http://127.0.0.1:{PORT}/configure-3d.html?stills', wait_until='domcontentloaded')
        page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=180000)
        report = page.evaluate(PROBE)
        page.close()
        page = browser.new_page(viewport={'width': 960, 'height': 600}, reduced_motion='reduce')
        page.route('https://fonts.*/**', lambda r: r.abort())
        page.goto(f'http://127.0.0.1:{PORT}/configure.html', wait_until='domcontentloaded')
        page.wait_for_function('window.__configurator && window.__configurator.ready', timeout=60000)
        picture_report = page.evaluate(PICTURE_PROBE)
        browser.close()
finally:
    srv.terminate()

pic_failed = [r for r in picture_report['report'] if not r['ok']]
print(f"Picture configurator: {len(picture_report['report']) - len(pic_failed)} of {len(picture_report['report'])} option/view checks change only their own layer.")
for r in pic_failed:
    print(f"FAIL  {r['view']:<16} {r['group']}/{r['option']}  stray layers: {r['stray']}")
if picture_report['missing']:
    print(f"MISSING {len(picture_report['missing'])} picture files, e.g. {picture_report['missing'][:3]}")
import glob
views_dir = os.path.join(ROOT, 'assets', 'views')
no_small = [f for f in glob.glob(os.path.join(views_dir, '*.webp')) if not f.endswith('-sm.webp') and not os.path.exists(f[:-5] + '-sm.webp')]
if no_small:
    print(f"MISSING {len(no_small)} phone-size copies, e.g. {[os.path.basename(f) for f in no_small[:3]]}")
print()
failed = [r for r in report if not r['ok']]
for r in report:
    print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['group']:<9} {r['option']:<16} changed: {', '.join(r['changed']) or '(no materials)'}"
          + (f"  STRAY: {r['stray']}" if r['stray'] else '') + (f"  NODES: {r['changedNodes']}" if r['changedNodes'] else ''))
print(f"\n{len(report) - len(failed)} of {len(report)} options change only their own parts.")
sys.exit(1 if failed or pic_failed or picture_report['missing'] or no_small else 0)
