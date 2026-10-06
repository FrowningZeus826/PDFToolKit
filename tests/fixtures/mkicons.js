// Renders the PNG icons from the SVG sources in ../../icons (the manifest, iPhones and the tab
// all need PNGs). Run from tests/:  node fixtures/mkicons.js
const H = require('../harness'); const fs = require('fs'); const path = require('path');
const DIR = path.join(__dirname, '..', '..', 'icons');
const jobs = [['icon.svg', 'icon-512.png', 512], ['icon.svg', 'icon-192.png', 192], ['icon-maskable.svg', 'icon-maskable-512.png', 512],
              ['icon-apple.svg', 'apple-touch-icon.png', 180], ['icon.svg', 'favicon-32.png', 32]];
(async () => {
  const b = await H.launch();
  for (const [src, out, px] of jobs) {
    const p = await b.newPage(); await p.setViewport({ width: px, height: px });
    const svg = fs.readFileSync(path.join(DIR, src), 'utf8').replace('<svg ', `<svg width="${px}" height="${px}" `);
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    fs.writeFileSync(path.join(DIR, out), await p.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } }));
    await p.close(); console.log('   +', out, px);
  }
  await b.close();
})();
