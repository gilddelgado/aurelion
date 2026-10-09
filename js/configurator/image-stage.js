import { reducedMotion } from './animations.js';

const ALIASES = { front: 'front34' };

const SMALL = window.matchMedia('(max-width: 600px)').matches;
const decodeCache = new Map();
const LOGO = Object.assign(new Image(), { src: 'assets/brand/aurelion-logo.svg' });

function loadImage(url) {
  if (!decodeCache.has(url)) {
    decodeCache.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
      img.onerror = () => { decodeCache.delete(url); reject(new Error(`Image failed to load: ${url}`)); };
      img.src = url;
    }));
  }
  return decodeCache.get(url);
}

export class ImageStage extends EventTarget {
  constructor(container, manifest, state) {
    super();
    this.kind = 'image';
    this.container = container;
    this.manifest = manifest;
    this.state = state;
    this.currentView = null;
    this.order = manifest.order.filter((v) => v !== 'night');
    this.frame = null;
    this.token = 0;
    this.lights = false;
    this.attachGestures();
  }

  // Layers
  viewState(view) {
    if (view === 'side') return this.state.preview.lifted ? 'raised' : 'lowered';
    if (view === 'rear34') return this.wingState || this.state.preview.wing || 'stowed';
    return 'default';
  }

  layersFor(view, build = this.state.build, viewState = this.viewState(view)) {
    const d = this.manifest.defaults;
    const url = (layer) => this.manifest.path.replace('{view}', view).replace('{state}', viewState).replace('{layer}', layer)
      .replace(/\.webp$/, SMALL ? '-sm.webp' : '.webp');
    const layers = [{ part: 'paint', url: url(`paint-${build.paint}`) }];
    if (build.wheels !== d.wheels) layers.push({ part: 'wheels', url: url(`wheels-${build.wheels}`) });
    if (build.calipers !== d.calipers) layers.push({ part: 'calipers', url: url(`calipers-${build.calipers}`) });
    if (this.manifest.views[view]?.interior && build.interior !== d.interior) layers.push({ part: 'interior', url: url(`interior-${build.interior}`) });
    return layers;
  }

  async show(view, { transition = 'fade', duration = 450, sweep = false } = {}) {
    const token = ++this.token;
    const layers = this.layersFor(view);
    this.container.classList.add('is-busy');
    let images;
    try {
      images = await Promise.all(layers.map((l) => loadImage(l.url)));
    } catch (err) {
      if (token === this.token) this.container.classList.remove('is-busy');
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
      return false;
    }
    if (token !== this.token) return false;
    this.container.classList.remove('is-busy');

    const frame = document.createElement('div');
    frame.className = 'view-frame';
    frame.dataset.view = view;
    images.forEach((img, i) => {
      const el = img.cloneNode();
      el.alt = '';
      el.className = `layer layer-${layers[i].part}`;
      frame.append(el);
    });
    if (sweep && !reducedMotion()) {
      const s = document.createElement('span');
      s.className = 'layer-sweep';
      s.style.webkitMaskImage = s.style.maskImage = `url("${layers[0].url}")`;
      frame.append(s);
    }
    const old = this.frame;
    const instant = reducedMotion() || duration === 0 || !old;
    if (transition === 'slide' && !instant) frame.dataset.enter = this.slideDir || 'next';
    frame.style.transitionDuration = instant ? '0ms' : `${duration}ms`;
    this.container.append(frame);
    this.frame = frame;

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    frame.classList.add('is-in');
    if (old) {
      old.style.transitionDuration = instant ? '0ms' : `${duration}ms`;
      old.classList.add('is-out');
      setTimeout(() => old.remove(), instant ? 0 : duration + 50);
    }
    return true;
  }

  refresh(opts) { return this.currentView ? this.show(this.currentView, opts) : Promise.resolve(); }

  async load(onProgress) {
    const first = this.layersFor('front34');
    let done = 0;
    await Promise.all(first.map((l) => loadImage(l.url).then(() => onProgress?.(++done, first.length))));
    this.currentView = 'front34';
    if (!(await this.show('front34', { duration: 0 }))) throw new Error('The first picture did not load');
    this.idlePreload();
  }

  idlePreload() {
    const connection = navigator.connection || {};
    if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
    const queue = [
      ...this.order.map((v) => this.layersFor(v)).flat().map((l) => l.url),
      ...(SMALL ? [] : this.state.groups.find((g) => g.id === 'paint').options.map((o) => this.layersFor('front34', { ...this.state.build, paint: o.id })[0].url)),
    ];
    const next = () => {
      const url = queue.shift();
      if (!url) return;
      loadImage(url).catch(() => {}).finally(() => idle(next));
    };
    idle(next);
  }

  goTo(name, { duration = 450 } = {}) {
    const view = ALIASES[name] || name;
    if (!this.manifest.views[view]) return Promise.resolve();
    const from = this.order.indexOf(this.currentView), to = this.order.indexOf(view);
    this.slideDir = to >= from ? 'next' : 'prev';
    const changed = view !== this.currentView;
    this.currentView = view;
    if (changed) this.dispatchEvent(new CustomEvent('viewchange', { detail: view }));
    return this.show(view, { transition: 'slide', duration: changed ? duration + 150 : duration });
  }

  setPaint(option, { duration } = {}) { return this.refresh({ duration: duration ?? 550, sweep: true }); }
  setWheelFinish(option, { duration } = {}) { return this.refresh({ duration: duration ?? 450 }); }
  setCalipers(option, { duration } = {}) { return this.refresh({ duration: duration ?? 400 }); }
  setInterior(option, { duration } = {}) { return this.refresh({ duration: duration ?? 450 }); }

  async setLift() {
    if (this.currentView !== 'side') return this.goTo('side');
    return this.refresh({ duration: 700 });
  }

  async setWing(position) {
    const target = position.id;
    const steps = ['stowed', 'p4', 'p11'];
    const from = steps.indexOf(this.wingState || 'stowed'), to = steps.indexOf(target);
    if (this.currentView !== 'rear34') { this.wingState = target; return this.goTo('rear34'); }
    const path = from < to ? steps.slice(from + 1, to + 1) : steps.slice(to, from).reverse();
    for (const s of path) {
      this.wingState = s;
      if (!(await this.refresh({ duration: 380 }))) return;
    }
  }

  setDoors(open) {
    if (open && this.currentView !== 'cabin') return this.goTo('cabin');
    if (!open && this.currentView === 'cabin') return this.goTo('front34');
    return Promise.resolve();
  }

  setLights(on) {
    this.lights = on;
    if (on && this.currentView !== 'night') return this.goTo('night', { duration: 700 });
    if (!on && this.currentView === 'night') return this.goTo('front34', { duration: 700 });
    return Promise.resolve();
  }

  snapshot() {
    const first = this.frame?.querySelector('img');
    const [w, h] = first?.naturalWidth ? [first.naturalWidth, first.naturalHeight] : this.manifest.size;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.6);
    grad.addColorStop(0, this.currentView === 'night' ? '#0b0b0d' : '#1d1b16');
    grad.addColorStop(1, '#050505');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    this.frame?.querySelectorAll('img').forEach((img) => g.drawImage(img, 0, 0, w, h));
    if (LOGO.complete && LOGO.naturalWidth) {
      const lw = w * 0.16, lh = lw * LOGO.naturalHeight / LOGO.naturalWidth;
      g.globalAlpha = 0.9; g.drawImage(LOGO, w * 0.035, h - h * 0.05 - lh, lw, lh); g.globalAlpha = 1;
    }
    return c.toDataURL('image/jpeg', 0.92);
  }

  step(dir) {
    const i = this.order.indexOf(this.currentView === 'night' ? 'front34' : this.currentView);
    const view = this.order[(i + dir + this.order.length) % this.order.length];
    this.dispatchEvent(new CustomEvent('interact'));
    this.dispatchEvent(new CustomEvent('request-view', { detail: view }));
  }

  attachGestures() {
    let x0 = null, y0 = null;
    this.container.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
    this.container.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) this.step(dx < 0 ? 1 : -1);
    });
    this.container.addEventListener('pointercancel', () => { x0 = null; });
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
    });
  }
}
