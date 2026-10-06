// Adds files printed by headless Chromium (Skia/PDF) to the corpus and its manifest.
// Run after mkcorpus.py, from tests/:  node fixtures/mkchrome.js
const H = require('../harness'); const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, '..', 'fx', 'corpus');
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'))
  .filter(e => !/^chrome-/.test(e.name));
const PROBE = 'Zanzibar', CONTROL = 'Quokka';

const docs = {
  'chrome-article.pdf': {
    producer: 'Chromium print (Skia/PDF), article', notes: 'web fonts and CSS layout; Chromium writes text as Type 3 or CID TrueType runs',
    html: `<html><body style="font:14px/1.5 sans-serif;margin:40px"><h1>Island census</h1>
<p>The ${PROBE} report describes a census of the ${CONTROL} on the island. <b>Bold</b>, <i>italic</i> and <code>monospace</code> words.</p>
<p style="text-align:justify;width:420px">Counts were taken at dawn, at noon and again after dark, by three teams. Each team recorded the weather, the tide and the number of animals seen. Where the totals disagreed, the larger figure was kept.</p>
<ul><li>First item</li><li>Second item</li></ul><table border=1 cellpadding=4><tr><td>A</td><td>12</td></tr><tr><td>B</td><td>14</td></tr></table></body></html>`
  },
  'chrome-unicode.pdf': {
    producer: 'Chromium print, mixed scripts', editable: false, notes: 'Latin, Greek, Cyrillic, Hebrew, Arabic, CJK and Thai through shaped glyph runs',
    html: `<html><body style="font:16px/1.6 sans-serif;margin:40px"><p>${PROBE} ${CONTROL}</p><p>café Αθήνα Москва</p>
<p dir="rtl">שלום עולם — مرحبا بالعالم</p><p>日本語のテキスト 中文文本</p><p>สวัสดีชาวโลก</p></body></html>`
  },
  'chrome-landscape.pdf': {
    producer: 'Chromium print, landscape A4 with background', landscape: true, format: 'A4', background: true, notes: 'landscape A4, shaded cells and a coloured heading band',
    html: `<html><body style="font:13px sans-serif;margin:30px"><h2 style="background:#1B3A8C;color:#fff;padding:8px">${PROBE} ${CONTROL}</h2>
<table style="border-collapse:collapse;width:100%">${[...Array(8)].map((_, r) => `<tr style="background:${r % 2 ? '#eef' : '#fff'}">${[...Array(6)].map((_, c) => `<td style="border:1px solid #889;padding:6px">R${r}C${c}</td>`).join('')}</tr>`).join('')}</table></body></html>`
  },
  'chrome-multipage.pdf': {
    producer: 'Chromium print, long text over several pages', notes: 'paragraphs that break across page boundaries',
    html: `<html><body style="font:14px/1.6 serif;margin:50px"><h1>${PROBE} ${CONTROL}</h1>${[...Array(40)].map((_, i) => `<p>Paragraph ${i + 1}. Counts were taken at dawn, at noon and again after dark, by three teams, and every figure was written down twice.</p>`).join('')}</body></html>`
  },
  'chrome-image-text.pdf': {
    producer: 'Chromium print, text over an image', images: true, notes: 'a drawn canvas image with live text on top',
    html: `<html><body style="margin:0"><div style="position:relative;width:620px;height:400px;background:linear-gradient(135deg,#6E8BFA,#16181D)"><h1 style="position:absolute;left:40px;top:40px;color:#fff;font:28px sans-serif">${PROBE} ${CONTROL}</h1></div><p style="font:14px sans-serif;margin:30px">Caption text under the picture.</p></body></html>`
  }
};

(async () => {
  const b = await H.launch();
  for (const [name, d] of Object.entries(docs)) {
    const p = await b.newPage();
    await p.setContent(d.html, { waitUntil: 'load' });
    const buf = await p.pdf({ format: d.format || 'Letter', landscape: !!d.landscape, printBackground: !!d.background });
    fs.writeFileSync(path.join(OUT, name), buf);
    await p.close();
    manifest.push({ name, producer: d.producer, text: true, editable: d.editable !== false, expect: 'open', images: !!d.images, notes: d.notes, probe: PROBE, control: CONTROL, pages: null });
    console.log('   + %s  %s', name.padEnd(34), d.producer);
  }
  await b.close();
  // page counts from qpdf
  const { execSync } = require('child_process');
  for (const e of manifest) if (e.pages == null && e.expect === 'open') { try { e.pages = +execSync(`qpdf --show-npages "${path.join(OUT, e.name)}"`).toString().trim(); } catch (_) {} }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('==> %d files in the corpus', manifest.length);
})();
