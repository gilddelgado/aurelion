export function createState(catalog) {
  const groups = catalog.groups;
  const build = Object.fromEntries(groups.map((g) => [g.id, g.default]));
  const preview = { doors: false, lights: false, wing: 'stowed', lifted: false };
  const listeners = new Set();

  const api = {
    groups,
    build,
    preview,
    group: (id) => groups.find((g) => g.id === id),
    option: (groupId, optionId = build[groupId]) => api.group(groupId)?.options.find((o) => o.id === optionId),
    set(groupId, optionId, meta = {}) {
      if (!api.option(groupId, optionId) || build[groupId] === optionId) return false;
      const prev = build[groupId];
      build[groupId] = optionId;
      listeners.forEach((fn) => fn({ type: 'build', groupId, optionId, prev, ...meta }));
      return true;
    },
    setPreview(key, value) {
      if (preview[key] === value) return false;
      preview[key] = value;
      listeners.forEach((fn) => fn({ type: 'preview', key, value }));
      return true;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    encode() {
      return 'build-' + groups.map((g) => Math.max(0, g.options.findIndex((o) => o.id === build[g.id]))).join('.');
    },

    decode(token) {
      const m = /^build-([\d.]+)$/.exec(token || '');
      if (!m) return null;
      const parts = m[1].split('.').map(Number);
      if (parts.length !== groups.length) return null;
      const out = {};
      for (let i = 0; i < groups.length; i++) {
        const opt = groups[i].options[parts[i]];
        if (!opt) return null;
        out[groups[i].id] = opt.id;
      }
      return out;
    },
    summaryLines() {
      return groups.map((g) => {
        const o = api.option(g.id);
        const finish = o.finish ? ` (${o.finish})` : o.detail ? ` (${o.detail})` : '';
        return `${g.label}: ${o.name}${finish}`;
      });
    },
    shortSummary() {
      const p = api.option('paint'), w = api.option('wheels'), c = api.option('calipers');
      return `${p.name} · ${w.name} wheels · ${c.name} calipers`;
    },
  };
  return api;
}
