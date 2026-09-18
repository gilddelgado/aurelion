import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weldPrimitive, simplifyPrimitive, compactPrimitive, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node tools/prep-model.mjs <input.glb> <output.glb>'); process.exit(1); }

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// 1. Material names
const RENAME = {
  'carpaint_BABY_BLUE': 'paint_body',
  'jante': 'wheel_rim',
  'etrier': 'brake_caliper',
  'Pneu': 'tyre',
  'DISQUE': 'brake_disc',
  'disque': 'brake_disc_bell',
  'plastiquenoir': 'interior_leather',
  'siege': 'interior_leather_insert',
  'plastique.001': 'steering_wheel_rim',
  'tapis': 'interior_carpet',
  'ceinture': 'interior_headliner',
  'light': 'lamp_front_emitter',
  'backlight': 'lamp_rear_emitter',
  'pharearriere.002': 'lamp_rear_led',
  'pharearriere.001': 'lamp_rear_housing',
  'pharearriere': 'trim_black_mesh',
  'phareavant': 'lamp_front_reflector',
  'holdout': 'lamp_front_housing',
  'vitrephare': 'lamp_front_lens',
  'vitrephare.001': 'lamp_rear_lens',
  'Vitre': 'glass',
  'vitre.001': 'glass_door',
  'noirvitre': 'glass_frit',
  'Metal_noire': 'roof_black',
  'plastique': 'trim_black',
  'plastique.002': 'door_trim',
  'grille': 'grille_mesh',
  'logo': 'badge_dark',
  'etiquette': 'label_dark',
  'retro': 'mirror_glass_door',
  'Material.005': 'mirror_glass',
  'cran': 'screen',
  'rougeplastique': 'start_button_cover',
  'chrome': 'chrome_dark',
  'material_0': 'trim_dark_metal',
};
const byName = {};
for (const m of root.listMaterials()) {
  const src = m.getName();
  const name = RENAME[src] || src;
  m.setName(name).setExtras({ ...m.getExtras(), sourceName: src });
  byName[name] = m;
}

// 2. Material fixes
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255), a]; };
const FIX = {
  paint_body:              { color: '#e8b10f', metal: 0.0, rough: 0.35 },
  wheel_rim:               { color: '#b8bbbe', metal: 1.0, rough: 0.30 },
  brake_caliper:           { color: '#141414', metal: 0.2, rough: 0.50 },
  interior_leather:        { color: '#151413', metal: 0.0, rough: 0.60 },
  interior_leather_insert: { color: '#1b1a19', metal: 0.0, rough: 0.65 },
  steering_wheel_rim:      { color: '#161616', metal: 0.0, rough: 0.55 },
  interior_carpet:         { color: '#1d1d1d', metal: 0.0, rough: 0.95 },
  interior_headliner:      { color: '#141414', metal: 0.0, rough: 0.85 },
  mirror_glass_door:       { color: '#ffffff', metal: 1.0, rough: 0.05 },
  brake_disc_bell:         { color: '#5f6063', metal: 0.9, rough: 0.45 },
  lamp_front_emitter:      { color: '#ffffff', metal: 0.0, rough: 0.30 },
  trim_black_mesh:         { color: '#0c0c0c', metal: 0.6, rough: 0.45 },
  lamp_rear_led:           { color: '#2a0404', metal: 0.0, rough: 0.25 },
  lamp_rear_housing:       { color: '#1a1a1a', metal: 0.8, rough: 0.35 },
  lamp_rear_emitter:       { color: '#330303', metal: 0.0, rough: 0.30 },
  lamp_front_reflector:    { color: '#c8c8c8', metal: 1.0, rough: 0.12 },
  lamp_front_housing:      { color: '#0b0b0b', metal: 0.5, rough: 0.45 },
  lamp_rear_lens:          { rough: 0.10 },
  trim_black:              { color: '#0a0a0a', metal: 0.15, rough: 0.42 },
  roof_black:              { color: '#0b0b0b', metal: 0.10, rough: 0.28 },
  grille_mesh:             { color: '#0a0a0a', metal: 0.30, rough: 0.50 },
  screen:                  { color: '#050607', metal: 0.0, rough: 0.12 },
  start_button_cover:      { color: '#b3121a', metal: 0.0, rough: 0.30 },
};
for (const [name, f] of Object.entries(FIX)) {
  const m = byName[name];
  if (!m) throw new Error(`Material not found: ${name}`);
  if (f.color) m.setBaseColorFactor(hex(f.color, m.getBaseColorFactor()[3]));
  if (f.metal !== undefined) m.setMetallicFactor(f.metal);
  if (f.rough !== undefined) m.setRoughnessFactor(f.rough);
}

byName.lamp_front_emitter.setEmissiveFactor([0.35, 0.35, 0.35]);
byName.lamp_rear_emitter.setEmissiveFactor([0.25, 0.0, 0.0]);

const bodyNode = root.listNodes().find((n) => n.getName() === 'Object_65');
const carNode = root.listNodes().find((n) => n.getName() === 'car_29');
if (!bodyNode || !carNode) throw new Error('Body node not found');
const prim = bodyNode.getMesh().listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices().getArray();
const key = (i) => { const p = pos.getElement(i, []); return `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`; };
const canon = new Map(); const rep = new Int32Array(pos.getCount());
for (let i = 0; i < rep.length; i++) { const k = key(i); if (!canon.has(k)) canon.set(k, i); rep[i] = canon.get(k); }
const parent = Int32Array.from({ length: rep.length }, (_, i) => i);
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (let t = 0; t < idx.length; t += 3) {
  const a = find(rep[idx[t]]), b = find(rep[idx[t + 1]]), c = find(rep[idx[t + 2]]);
  parent[a] = c; parent[find(b)] = c;
}
const islands = new Map();
for (let t = 0; t < idx.length; t += 3) { const r = find(rep[idx[t]]); if (!islands.has(r)) islands.set(r, []); islands.get(r).push(t / 3); }

const wingIsland = [...islands.values()].filter((tris) => tris.length === 3264);
if (wingIsland.length !== 1) throw new Error(`Expected one wing island, found ${wingIsland.length}`);
const wingSet = new Set(wingIsland[0]);
const wingIdx = [], restIdx = [];
for (let t = 0; t < idx.length / 3; t++) (wingSet.has(t) ? wingIdx : restIdx).push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);

const wingPrim = doc.createPrimitive().setMaterial(prim.getMaterial())
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(wingIdx)).setBuffer(buffer));
for (const sem of prim.listSemantics()) wingPrim.setAttribute(sem, prim.getAttribute(sem));
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(restIdx)).setBuffer(buffer));
compactPrimitive(wingPrim);
compactPrimitive(prim);
const wingNode = doc.createNode('aero_wing').setMesh(doc.createMesh('aero_wing').addPrimitive(wingPrim));
carNode.addChild(wingNode);
bodyNode.setName('body_main');

const NODE_RENAME = { 'Bone_9': 'doors_hinge', 'Bone.001_4': 'door_a_hinge', 'Bone.002_8': 'door_b_hinge' };
for (const n of root.listNodes()) if (NODE_RENAME[n.getName()]) n.setName(NODE_RENAME[n.getName()]);

// 4. Selective simplification
const SIMPLIFY = { tyre: 0.5, wheel_rim: 0.55, brake_caliper: 0.5, brake_disc: 0.5, brake_disc_bell: 0.5, interior_headliner: 0.45, badge_dark: 0.4, chrome_dark: 0.5, steering_wheel_rim: 0.6 };
const triCount = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
let before = 0, after = 0;
for (const mesh of root.listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    const n0 = triCount(p); before += n0;
    const ratio = SIMPLIFY[p.getMaterial()?.getName()];
    if (ratio && n0 > 3000) {
      weldPrimitive(p);
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.0008, lockBorder: true });
    }
    after += triCount(p);
  }
}
console.log(`Triangles: ${before} -> ${after}`);

// 5. Clean up and compress
await doc.transform(
  prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER_VIEW ?? 'BufferView'].filter(Boolean), keepLeaves: true, keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
doc.getRoot().getAsset().extras = {
  ...doc.getRoot().getAsset().extras,
  modifiedBy: 'AURELION: materials renamed and adjusted, rear wing split into its own node, selected parts simplified, meshopt compression.',
};
await io.write(output, doc);
const fs = await import('node:fs');
console.log(`Wrote ${output}: ${(fs.statSync(output).size / 1e6).toFixed(2)} MB, ${root.listMeshes().length} meshes, ${root.listMaterials().length} materials, ${root.listNodes().length} nodes`);
