// Copies the Capacitor browser (IIFE) bundles into web/vendor so the single
// page works without a bundler — both as a plain website and inside the app.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'vendor');
mkdirSync(out, { recursive: true });

const files = [
  ['@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['@capacitor/network/dist/plugin.js', 'capacitor-network.js'],
  ['@capacitor/share/dist/plugin.js', 'capacitor-share.js'],
];
for (const [src, dest] of files) {
  copyFileSync(join(root, 'node_modules', src), join(out, dest));
  console.log(`vendor: ${src} -> web/vendor/${dest}`);
}
