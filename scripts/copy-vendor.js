/**
 * Copies the barcode and QR code libraries into app/vendor, so the app works offline.
 * Runs automatically before `npm start`, `npm run dist` and `npm run web`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'app', 'vendor');
const files = [
  ['jsbarcode', 'dist/JsBarcode.all.min.js', 'JsBarcode.all.min.js'],
  ['qrcode-generator', 'qrcode.js', 'qrcode.js']
];

fs.mkdirSync(target, {recursive: true});
for (const [pkg, from, to] of files) {
  const source = path.join(root, 'node_modules', pkg, from);
  if (!fs.existsSync(source)) {
    console.error('Missing ' + pkg + '. Run "npm install" first.');
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(target, to));
  console.log('vendor: ' + to);
}
