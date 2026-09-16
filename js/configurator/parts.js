export const PART_MATERIALS = {
  paint: ['paint_body'],
  wheels: ['wheel_rim'],
  calipers: ['brake_caliper'],
  interior: ['interior_leather', 'interior_leather_insert'],
  lift: [],
};

export const PART_LABELS = {
  paint: 'body paint',
  wheels: 'wheel rims',
  calipers: 'brake calipers',
  interior: 'leather',
  lift: 'lifting system',
};

export const FINISHES = {
  solid:    { metalness: 0.0,  roughness: 0.32, clearcoat: 1.0,   clearcoatRoughness: 0.04, iridescence: 0.001 },
  metallic: { metalness: 0.62, roughness: 0.34, clearcoat: 1.0,   clearcoatRoughness: 0.03, iridescence: 0.001 },
  pearl:    { metalness: 0.32, roughness: 0.28, clearcoat: 1.0,   clearcoatRoughness: 0.03, iridescence: 0.45 },
  matte:    { metalness: 0.08, roughness: 0.74, clearcoat: 0.001, clearcoatRoughness: 0.6,  iridescence: 0.001 },
};

export const FINISH_LABELS = { solid: 'Solid', metallic: 'Metallic', pearl: 'Pearl', matte: 'Matte' };
