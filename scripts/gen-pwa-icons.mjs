// Generate PWA PNG icons from SVG
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const iconSvg = readFileSync('/home/z/my-project/public/icon.svg');
const maskableSvg = readFileSync('/home/z/my-project/public/maskable.svg');

// Standard icons
await sharp(iconSvg).resize(192, 192).png().toFile('/home/z/my-project/public/icon-192.png');
await sharp(iconSvg).resize(512, 512).png().toFile('/home/z/my-project/public/icon-512.png');
await sharp(maskableSvg).resize(512, 512).png().toFile('/home/z/my-project/public/maskable-512.png');
await sharp(iconSvg).resize(180, 180).png().toFile('/home/z/my-project/public/apple-touch-icon.png');
await sharp(iconSvg).resize(32, 32).png().toFile('/home/z/my-project/public/favicon-32.png');
await sharp(iconSvg).resize(16, 16).png().toFile('/home/z/my-project/public/favicon-16.png');

// Favicon.ico (multi-size)
await sharp(iconSvg).resize(32, 32).png().toFile('/home/z/my-project/public/favicon.ico');

console.log('✓ Generated: icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png, favicon.ico, favicon-32.png, favicon-16.png');
