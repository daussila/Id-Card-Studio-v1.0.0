/**
 * Mac only: gives the app a free "ad-hoc" signature right after it is put together. Apple silicon Macs
 * (M1 and newer) refuse to open an app with no signature at all. This is not a paid Apple
 * Developer signature, so the first opening still needs "Open Anyway" (see README).
 */
'use strict';
const {execFileSync} = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {stdio: 'inherit'});
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {stdio: 'inherit'});
};
