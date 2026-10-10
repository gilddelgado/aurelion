import { FINISH_LABELS, PART_LABELS } from './parts.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

export const STEPS = [
  { id: 'paint', title: 'Paint', view: 'front34' },
  { id: 'wheels', title: 'Wheels', view: 'wheel' },
  { id: 'aero', title: 'Wing', view: 'rear34' },
  { id: 'lighting', title: 'Lights', view: 'front' },
  { id: 'interior', title: 'Interior', view: 'cabin' },
  { id: 'performance', title: 'Performance', view: 'side' },
  { id: 'summary', title: 'Summary', view: 'front34' },
];

const tag = (availability) => availability ? h('span', { class: `tag tag-${availability}` }, availability === 'standard' ? 'Standard' : 'Option') : null;

export function createUI({ catalog, state, actions, mode = '3d' }) {
  const sectionsEl = document.getElementById('sections');
  const stepsEl = document.getElementById('steps');
  const announcer = document.getElementById('announcer');
  const readouts = {};
  const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // Step chips
  STEPS.forEach((s, i) => {
    stepsEl.append(h('a', { href: `#${s.id}`, class: 'step-chip', 'data-step': s.id, onclick: (e) => { e.preventDefault(); actions.goToStep(s.id); } },
      h('span', { class: 'step-num', 'aria-hidden': 'true' }, String(i + 1)), s.title));
  });

  const section = (id, title, note, ...body) => h('section', { class: 'opt-section', id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'opt-head' },
      h('h2', { id: `${id}-h`, class: 'opt-title' }, title),
      note ? h('p', { class: 'opt-note' }, note) : null),
    ...body);

  const readout = (groupId) => {
    const el = h('p', { class: 'readout', 'aria-hidden': 'true' });
    readouts[groupId] = el;
    return el;
  };

  const radio = (name, value, checked, label, extra = {}) => h('label', { class: `choice ${extra.class || ''}`, style: extra.style, 'data-value': value },
    h('input', { type: 'radio', name, value, checked: checked || false, class: 'sr-only', 'aria-describedby': extra.describedby }),
    ...label);

  const onGroupChange = (fieldset, groupId) => fieldset.addEventListener('change', (e) => {
    if (e.target.name === groupId) state.set(groupId, e.target.value, { source: 'ui' });
  });

  // Paint
  const paint = state.group('paint');
  const paintFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'sr-only' }, 'Paint colour'));
  for (const finish of ['solid', 'metallic', 'pearl', 'matte']) {
    paintFs.append(h('p', { class: 'finish-label' }, FINISH_LABELS[finish]));
    paintFs.append(h('div', { class: 'swatch-grid' }, paint.options.filter((o) => o.finish === finish).map((o) =>
      radio('paint', o.id, state.build.paint === o.id, [
        h('span', { class: `swatch finish-${finish}`, style: `--c:${o.hex}`, 'aria-hidden': 'true' }),
        h('span', { class: 'choice-name' }, o.name),
        h('span', { class: 'sr-only' }, `${FINISH_LABELS[finish]}, ${o.availability}`),
      ], { class: 'swatch-choice' }))));
  }
  onGroupChange(paintFs, 'paint');
  sectionsEl.append(section('paint', 'Paint', paint.note, readout('paint'), paintFs));

  // Wheels & calipers
  const wheels = state.group('wheels'), calipers = state.group('calipers');
  const wheelFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'fs-legend' }, wheels.label),
    h('div', { class: 'card-grid' }, wheels.options.map((o) => radio('wheels', o.id, state.build.wheels === o.id, [
      h('span', { class: 'card-media' }, h('img', { src: `assets/img/wheel-${o.id}.webp`, alt: '', width: 320, height: 200, loading: 'lazy', decoding: 'async' })),
      h('span', { class: 'card-body' }, h('span', { class: 'choice-name' }, o.name), tag(o.availability)),
    ], { class: 'card-choice' }))),
    h('p', { class: 'fs-note' }, wheels.note));
  onGroupChange(wheelFs, 'wheels');
  const calFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'fs-legend' }, calipers.label),
    h('div', { class: 'chip-row' }, calipers.options.map((o) => radio('calipers', o.id, state.build.calipers === o.id, [
      h('span', { class: 'swatch swatch-sm', style: `--c:${o.hex}`, 'aria-hidden': 'true' }),
      h('span', { class: 'choice-name' }, o.name), tag(o.availability),
    ], { class: 'chip-choice' }))),
    h('p', { class: 'fs-note' }, calipers.note));
  onGroupChange(calFs, 'calipers');
  sectionsEl.append(section('wheels', 'Wheels and brakes', null, readout('wheels'), wheelFs, readout('calipers'), calFs));

  // Wing
  const wingCfg = catalog.previews.wing;
  const wingFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'fs-legend' }, `${wingCfg.label} · preview`),
    h('div', { class: 'segmented' }, wingCfg.positions.map((p) => radio('wing', p.id, state.preview.wing === p.id, [h('span', {}, p.name)], { class: 'seg-choice' }))));
  wingFs.addEventListener('change', (e) => { if (e.target.name === 'wing') state.setPreview('wing', e.target.value); });
  sectionsEl.append(section('aero', 'Rear wing', wingCfg.note, wingFs,
    h('p', { class: 'fs-note' }, 'Previews are for looking around. They are not part of your build.')));

  // Lights
  const lightsBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', 'data-preview': 'lights', onclick: () => actions.togglePreview('lights') },
    h('span', { class: 'toggle-track', 'aria-hidden': 'true' }, h('span', { class: 'toggle-dot' })), h('span', { class: 'toggle-label' }, 'Lights on'));
  sectionsEl.append(section('lighting', 'Lights', catalog.previews.lights.note, lightsBtn));

  // Interior
  const interior = state.group('interior');
  const intFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'sr-only' }, interior.label),
    h('div', { class: 'leather-grid' }, interior.options.map((o) => radio('interior', o.id, state.build.interior === o.id, [
      h('span', { class: 'leather', style: `--c:${o.hex}`, 'aria-hidden': 'true' }),
      h('span', { class: 'choice-name' }, o.name), h('span', { class: 'choice-detail' }, o.detail),
    ], { class: 'leather-choice' }))));
  onGroupChange(intFs, 'interior');
  const doorsBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', 'data-preview': 'doors', onclick: () => actions.togglePreview('doors') },
    h('span', { class: 'toggle-track', 'aria-hidden': 'true' }, h('span', { class: 'toggle-dot' })), h('span', { class: 'toggle-label' }, mode === 'image' ? 'Show the cabin' : 'Doors open'));
  sectionsEl.append(section('interior', 'Interior', interior.note, readout('interior'), intFs, doorsBtn));

  // Performance
  const lift = state.group('lift');
  const specs = h('dl', { class: 'spec-grid' }, catalog.car.specs.map((s) => h('div', { class: 'spec' },
    h('dt', {}, s.label), h('dd', {}, h('span', { class: 'spec-value' }, s.value), ' ', h('span', { class: 'spec-unit' }, s.unit)))));
  const raiseBtn = h('button', { type: 'button', class: 'btn btn-ghost', id: 'raise-btn', 'aria-pressed': 'false', disabled: state.build.lift !== 'fitted', onclick: () => actions.togglePreview('lifted') }, 'Raise the front');
  const liftFs = h('fieldset', { class: 'fs' }, h('legend', { class: 'fs-legend' }, lift.label),
    h('div', { class: 'card-grid card-grid-text' }, lift.options.map((o) => radio('lift', o.id, state.build.lift === o.id, [
      h('span', { class: 'card-body' }, h('span', { class: 'choice-name' }, o.name), tag(o.availability)),
      o.detail ? h('span', { class: 'choice-detail' }, o.detail) : null,
    ], { class: 'card-choice text-card' }))),
    h('p', { class: 'fs-note' }, lift.note), raiseBtn);
  onGroupChange(liftFs, 'lift');
  sectionsEl.append(section('performance', 'Performance', 'Factory figures for the LP 700-4 coupé. There were no power upgrades.', specs, liftFs));

  // Summary
  const summaryList = h('dl', { class: 'summary-list' });
  const included = h('ul', { class: 'included' }, catalog.previews.included.map((i) => h('li', {}, h('strong', {}, i.name), ' ', i.detail)));
  const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.copySummary() }, 'Copy build');
  const saveBtn = framed ? null : h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.saveImage() }, 'Save image');
  const requestBtn = h('button', { type: 'button', class: 'btn btn-gold', onclick: () => actions.requestBuild() }, 'Request this build');
  const resetBtn = h('button', { type: 'button', class: 'btn btn-link', onclick: () => actions.reset() }, 'Start over');
  const copyFallback = h('textarea', { class: 'copy-fallback', readonly: true, rows: 6, 'aria-label': 'Build summary to copy', hidden: true });
  sectionsEl.append(section('summary', 'Your build', 'Colours are approximate on-screen renderings of the factory names.',
    summaryList, h('h3', { class: 'sub-h' }, 'Included in this model'), included,
    h('div', { class: 'btn-row' }, requestBtn, copyBtn, saveBtn, resetBtn), copyFallback,
    h('p', { class: 'fs-note' }, 'Request this build opens the booking form. It is a demo, so nothing is sent.')));

  // Sources and credits
  const foot = document.getElementById('panel-foot');
  foot.append(
    h('h3', { class: 'sub-h' }, 'Sources'),
    h('ul', { class: 'sources' }, catalog.sources.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)))),
    h('p', { class: 'credit' }, '3D model: ', h('a', { href: catalog.sources.find((s) => s.id === 'model').url, target: '_blank', rel: 'noopener' }, '“( FREE ) Lamborghini Aventador LP 700-4”'),
      ' by SDC PERFORMANCE™️, licensed under ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'),
      '. Modified: materials adjusted, rear wing separated, parts simplified and compressed.'),
    h('p', { class: 'credit' }, 'AURELION is not affiliated with or endorsed by Automobili Lamborghini S.p.A. Lamborghini and Aventador are trademarks of their owner.'),
  );

  // Updates
  const describe = (groupId) => {
    const g = state.group(groupId), o = state.option(groupId);
    if (groupId === 'paint') return `${o.name} · ${FINISH_LABELS[o.finish]} · ${o.availability === 'standard' ? 'Standard' : 'Option'}`;
    if (groupId === 'interior') return `${o.name} · ${o.detail}`;
    return `${g.label}: ${o.name}${o.availability ? ` · ${o.availability === 'standard' ? 'Standard' : 'Option'}` : ''}`;
  };

  const refresh = () => {
    for (const id of Object.keys(readouts)) readouts[id].textContent = describe(id);
    summaryList.replaceChildren(...state.groups.map((g) => {
      const o = state.option(g.id), step = g.step;
      return h('div', { class: 'summary-row' },
        h('dt', {}, g.label),
        h('dd', {}, h('span', { class: 'summary-val' },
          o.hex ? h('span', { class: 'swatch swatch-xs', style: `--c:${o.hex}`, 'aria-hidden': 'true' }) : null,
          `${o.name}${o.finish ? ` (${FINISH_LABELS[o.finish].toLowerCase()})` : ''}`),
          h('a', { href: `#${step}`, class: 'change-link', onclick: (e) => { e.preventDefault(); actions.goToStep(step); } }, 'Change', h('span', { class: 'sr-only' }, ` ${g.label}`))));
    }));
    document.getElementById('build-name').textContent = state.shortSummary();
    document.getElementById('stage-chip').textContent = `${state.option('paint').name} · ${FINISH_LABELS[state.option('paint').finish]}`;
    document.getElementById('stage-desc').textContent = `Aventador LP 700-4 shown with ${state.summaryLines().join('; ')}.`;
    raiseBtn.disabled = state.build.lift !== 'fitted';
    for (const g of state.groups) {
      const input = document.querySelector(`input[name="${g.id}"][value="${state.build[g.id]}"]`);
      if (input && !input.checked) input.checked = true;
    }
  };

  const syncPreview = () => {
    document.querySelectorAll('[data-preview]').forEach((b) => b.setAttribute('aria-pressed', String(!!state.preview[b.dataset.preview])));
    raiseBtn.textContent = state.preview.lifted ? 'Lower the front' : 'Raise the front';
    raiseBtn.setAttribute('aria-pressed', String(state.preview.lifted));
    const w = document.querySelector(`input[name="wing"][value="${state.preview.wing}"]`);
    if (w && !w.checked) w.checked = true;
  };

  const announce = (msg) => { announcer.textContent = ''; requestAnimationFrame(() => { announcer.textContent = msg; }); };

  state.subscribe((evt) => {
    if (evt.type === 'build') {
      refresh();
      const g = state.group(evt.groupId), o = state.option(evt.groupId);
      if (!evt.silent) announce(`${g.label}: ${o.name}. Only the ${PART_LABELS[evt.groupId]} changed.`);
    } else {
      syncPreview();
    }
  });

  const panelScroller = document.querySelector('.panel');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      stepsEl.querySelectorAll('.step-chip').forEach((c) => c.classList.toggle('is-active', c.dataset.step === en.target.id));
      const active = stepsEl.querySelector('.is-active');
      if (active) stepsEl.scrollTo({ left: active.offsetLeft - (stepsEl.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
    });
  }, matchMedia('(min-width: 960px)').matches
    ? { root: panelScroller, rootMargin: '-30% 0px -65% 0px' }
    : { root: null, rootMargin: '-62% 0px -30% 0px' });
  sectionsEl.querySelectorAll('.opt-section').forEach((s) => io.observe(s));

  refresh();
  syncPreview();
  return { refresh, announce, copyFallback, framed };
}
