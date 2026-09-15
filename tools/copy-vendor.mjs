import { cpSync, mkdirSync } from 'node:fs';
const files = [
  'LICENSE',
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/libs/meshopt_decoder.module.js',
];
for (const f of files) {
  const to = `vendor/three/${f}`;
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true });
  cpSync(`node_modules/three/${f}`, to);
}
console.log(`Copied ${files.length} three.js files to vendor/three`);
