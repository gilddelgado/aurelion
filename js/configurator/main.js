if (new URLSearchParams(location.search).has('stills')) document.documentElement.classList.add('stills');
import { createState } from './state.js';
import { createUI, STEPS } from './ui.js';

const MODE = document.querySelector('meta[name="stage"]')?.content === '3d' ? '3d' : 'image';

const MODEL_URL = document.querySelector('meta[name="model-src"]')?.content || 'assets/models/aventador-lp700-4.glb';
const statusEl = document.getElementById('stage-status');
const stage = document.getElementById('stage');

const showStatus = (html, kind = 'info') => { statusEl.hidden = false; statusEl.dataset.kind = kind; statusEl.innerHTML = html; };
const hideStatus = () => { statusEl.hidden = true; };

let catalog;
try {
  catalog = await fetch('data/options.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
} catch {
  showStatus('<p class="status-title">The option list didn’t load.</p><p>Reload the page to try again.</p>', 'error');
  throw new Error('options.json failed to load');
}

const state = createState(catalog);
const hash = location.hash.slice(1);
const initial = state.decode(hash);
if (initial) Object.assign(state.build, initial);
const initialStep = STEPS.find((s) => s.id === hash)?.id;

let viewer = null;
const ready = { value: false };

const writeHash = (token) => { try { history.replaceState(null, '', `#${token}`); } catch {} };

// Apply state to the stage
const apply = {
  paint: (o, opts) => viewer?.setPaint(o, opts),
  wheels: (o, opts) => viewer?.setWheelFinish(o, opts),
  calipers: (o, opts) => viewer?.setCalipers(o, opts),
  interior: (o, opts) => viewer?.setInterior(o, opts),
  lift: (o) => { if (o.id !== 'fitted' && state.preview.lifted) state.setPreview('lifted', false); },
};
const CLOSE_UPS = new Set(['wheel', 'cabin']);

function viewFor(groupId) {
  const g = state.group(groupId);
  if (!viewer || !ready.value) return;
  if (groupId === 'paint') { if (CLOSE_UPS.has(viewer.currentView)) viewer.goTo('front34'); return; }
  if (groupId === 'interior' && !state.preview.doors) state.setPreview('doors', true);
  if (viewer.currentView !== g.view) viewer.goTo(g.view);
}

state.subscribe((evt) => {
  if (evt.type === 'build') {
    apply[evt.groupId]?.(state.option(evt.groupId), evt.instant ? { duration: 0 } : undefined);
    if (evt.source === 'ui') viewFor(evt.groupId);
    writeHash(state.encode());
    return;
  }
  if (!viewer || !ready.value) return;
  const { key, value } = evt;
  const is3d = MODE === '3d';
  if (key === 'doors') viewer.setDoors(value);
  if (key === 'lights') {
    viewer.setLights(value);
    stage.classList.toggle('is-night', value);
    if (is3d && value && viewer.currentView !== 'front') viewer.goTo('front');
  }
  if (key === 'wing') {
    viewer.setWing(catalog.previews.wing.positions.find((p) => p.id === value));
    if (is3d && viewer.currentView !== 'rear34') viewer.goTo('rear34');
  }
  if (key === 'lifted') {
    viewer.setLift(value);
    if (is3d && viewer.currentView !== 'side') viewer.goTo('side');
  }
  syncViewButtons();
});

// Actions used by the panel
const summaryText = () => [
  'AURELION · Aventador LP 700-4 build',
  ...state.summaryLines(),
  ...catalog.previews.included.map((i) => `Included: ${i.name}`),
].join('\n');

const actions = {
  goToStep(id) {
    const step = STEPS.find((s) => s.id === id);
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (!viewer || !ready.value || !step) return;
    if (id === 'interior' && !state.preview.doors) state.setPreview('doors', true);
    if (viewer.currentView !== step.view) viewer.goTo(step.view);
  },
  togglePreview(key) {
    if (key === 'lifted' && state.build.lift !== 'fitted') return;
    state.setPreview(key, !state.preview[key]);
  },
  async copySummary() {
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      ui.announce('Build copied to the clipboard.');
      flash('Copied');
    } catch {
      ui.copyFallback.hidden = false;
      ui.copyFallback.value = text;
      ui.copyFallback.focus();
      ui.copyFallback.select();
      ui.announce('Copy is blocked here. The build text is selected so you can copy it.');
    }
  },
  saveImage() {
    if (!viewer) return;
    const a = document.createElement('a');
    a.href = viewer.snapshot();
    a.download = `aurelion-aventador-${state.encode()}.jpg`;
    a.click();
  },
  requestBuild() {
    try { sessionStorage.setItem('aventador.build', JSON.stringify({ code: state.encode(), lines: state.summaryLines() })); } catch {}
    location.href = 'index.html#reserve';
  },
  reset() {
    for (const g of state.groups) state.set(g.id, g.default, { source: 'reset', silent: true });
    state.setPreview('lifted', false);
    state.setPreview('wing', 'stowed');
    state.setPreview('lights', false);
    state.setPreview('doors', false);
    ui.announce('Build reset to the standard specification.');
    viewer?.goTo('front34');
  },
};

function flash(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.hidden = true; }, 1800);
}

const ui = createUI({ catalog, state, actions, mode: MODE });

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => goToView(b.dataset.view)));
document.querySelectorAll('[data-step-view]').forEach((b) => b.addEventListener('click', () => viewer?.step(Number(b.dataset.stepView))));
document.querySelectorAll('.stage-toggles [data-preview]').forEach((b) => b.addEventListener('click', () => actions.togglePreview(b.dataset.preview)));
document.getElementById('review-link').addEventListener('click', (e) => { e.preventDefault(); actions.goToStep('summary'); });
function syncViewButtons() {
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(viewer?.currentView === b.dataset.view)));
}

const syncModeLink = () => document.querySelectorAll('[data-keep-build]').forEach((a) => { a.hash = state.encode(); });
state.subscribe(syncModeLink);
syncModeLink();

// Boot the picture stage
async function bootImages() {
  const bar = document.getElementById('load-bar');
  const label = document.getElementById('load-label');
  let manifest;
  try {
    manifest = await fetch('data/views.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  } catch {
    showStatus('<p class="status-title">The car pictures didn’t load.</p><p>Check your connection, then reload the page.</p>', 'error');
    return;
  }
  const { ImageStage } = await import('./image-stage.js');
  viewer = new ImageStage(document.getElementById('stage-images'), manifest, state);
  try {
    await viewer.load((done, total) => { bar.style.transform = `scaleX(${done / total})`; label.textContent = 'Loading the car'; });
  } catch (err) {
    console.error(err);
    showStatus('<p class="status-title">The car pictures didn’t load.</p><p>Check your connection, then reload the page.</p>', 'error');
    return;
  }

  viewer.addEventListener('request-view', (e) => goToView(e.detail));
  viewer.addEventListener('viewchange', (e) => {
    const v = e.detail;
    if (v !== 'cabin' && state.preview.doors) state.setPreview('doors', false);
    if (v !== 'night' && state.preview.lights) state.setPreview('lights', false);
    if (v !== 'cabin' && v !== 'night') stage.classList.remove('is-night');
    syncViewButtons();
  });
  viewer.addEventListener('error', () => flash('A picture didn’t load. Try again.'));
  ready.value = true;
  hideStatus();
  stage.classList.add('is-ready');
  syncViewButtons();
  if (initialStep) {
    const step = STEPS.find((s) => s.id === initialStep);
    if (initialStep === 'interior') state.setPreview('doors', true);
    else viewer.goTo(step.view);
    document.getElementById(initialStep)?.scrollIntoView({ block: 'start' });
  }
}

function goToView(view) {
  if (!viewer || !ready.value) return;
  if (view === 'cabin' && !state.preview.doors) {
    state.setPreview('doors', true);
    if (MODE === '3d') viewer.goTo('cabin');
  } else viewer.goTo(view);
  syncViewButtons();
}

// Boot the 3D stage
async function boot() {
  if (MODE === 'image') return bootImages();
  const { CarViewer, webglAvailable } = await import('./viewer.js');
  if (!webglAvailable()) {
    stage.classList.add('no-webgl');
    showStatus('<p class="status-title">3D preview isn’t available in this browser.</p><p>Your choices still update the build summary. Try a recent Chrome, Edge, Firefox or Safari for the 3D view.</p>', 'error');
    return;
  }
  try {
    viewer = new CarViewer(document.getElementById('stage-canvas'));
  } catch {
    stage.classList.add('no-webgl');
    showStatus('<p class="status-title">3D preview couldn’t start.</p><p>Your graphics driver may have blocked WebGL. Your choices still update the build summary.</p>', 'error');
    return;
  }
  const bar = document.getElementById('load-bar');
  const label = document.getElementById('load-label');
  try {
    await viewer.load(MODEL_URL, (loaded, total) => {
      const mb = (loaded / 1e6).toFixed(1);
      if (total) { bar.style.transform = `scaleX(${loaded / total})`; label.textContent = `Loading the car · ${mb} of ${(total / 1e6).toFixed(1)} MB`; }
      else label.textContent = `Loading the car · ${mb} MB`;
    });
  } catch (err) {
    console.error(err);
    showStatus('<p class="status-title">The 3D model didn’t load.</p><p>Check your connection, then reload the page.</p>', 'error');
    return;
  }

  for (const g of state.groups) apply[g.id]?.(state.option(g.id), { duration: 0 });
  viewer.addEventListener('interact', syncViewButtons);
  const origGoTo = viewer.goTo.bind(viewer);
  viewer.goTo = (name, opts) => { const p = origGoTo(name, opts); syncViewButtons(); return p; };
  ready.value = true;
  hideStatus();
  stage.classList.add('is-ready');
  const firstView = initialStep ? STEPS.find((s) => s.id === initialStep).view : 'front34';
  if (initialStep === 'interior') state.setPreview('doors', true);
  viewer.camera.position.set(-7.5, 2.4, 7.5);
  viewer.controls.target.set(0, 0.5, 0);
  viewer.goTo(firstView, { duration: 1800 });
  if (initialStep) document.getElementById(initialStep)?.scrollIntoView({ block: 'start' });
}

boot();
writeHash(state.encode());
window.addEventListener('hashchange', () => {
  const next = state.decode(location.hash.slice(1));
  if (next) for (const [k, v] of Object.entries(next)) state.set(k, v, { source: 'hash' });
});

window.__configurator = {
  state, actions,
  get viewer() { return viewer; },
  get ready() { return ready.value; },
  setBuild(build) { for (const [k, v] of Object.entries(build)) state.set(k, v, { source: 'script', instant: true, silent: true }); },
};
