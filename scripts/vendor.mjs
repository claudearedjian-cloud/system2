// Vendors Three.js build + OrbitControls into public/vendor so the app is
// fully self-contained (no CDN, no bundler) — important for shop-floor
// workstations that may be offline.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = resolve(root, 'public', 'vendor');
mkdirSync(vendorDir, { recursive: true });

const files = [
  ['node_modules/three/build/three.module.js', 'public/vendor/three.module.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'public/vendor/OrbitControls.js'],
];

for (const [src, dst] of files) {
  const from = resolve(root, src);
  const to = resolve(root, dst);
  if (!existsSync(from)) {
    console.error(`[vendor] missing ${src} — run "npm install" first.`);
    process.exit(1);
  }
  copyFileSync(from, to);
  console.log(`[vendor] ${src} -> ${dst}`);
}
