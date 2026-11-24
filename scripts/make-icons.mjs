// Renders web/icon.svg into the PNG sources used by `npx capacitor-assets generate`.
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';

mkdirSync('assets', { recursive: true });
const svg = readFileSync('web/icon.svg', 'utf8');
// Full icon (legacy launchers) and a splash.
await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile('assets/icon-only.png');
// Adaptive icon: transparent foreground artwork + solid gradient background.
const fg = svg.replace(/<rect[^>]*\/>/, '').replace('viewBox="0 0 512 512"', 'viewBox="-128 -128 768 768"');
await sharp(Buffer.from(fg)).resize(1024, 1024).png().toFile('assets/icon-foreground.png');
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19c2c2"/><stop offset="1" stop-color="#2f4bff"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg)"/></svg>`;
await sharp(Buffer.from(bg)).resize(1024, 1024).png().toFile('assets/icon-background.png');
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#0b1020"/><g transform="translate(1110 1110) scale(1)">${svg.replace(/<\?xml[^>]*>/, '').replace('<svg', '<svg width="512" height="512"')}</g></svg>`;
await sharp(Buffer.from(splash)).png().toFile('assets/splash.png');
await sharp(Buffer.from(splash)).png().toFile('assets/splash-dark.png');
console.log('icons written to assets/');
