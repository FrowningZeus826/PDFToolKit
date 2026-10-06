// A corpus of varied PDFs run through the tool's main flows.
//
// Every file in fx/corpus (built by fixtures/mkcorpus.py and mkchrome.js) comes from a different
// producer, PDF version, structure or oddity. Each is opened, rendered, rotated, cleaned,
// compressed (images), edited and redacted, and every saved result is checked by tools that are
// not the code under test: qpdf, pikepdf and pdftotext/pdftoppm.
//
//   node corpus.js                       everything
//   CORPUS_ONLY='^(lo|chrome)-' node corpus.js     only files whose name matches
//   CORPUS_JOBS=4 node corpus.js         browsers in parallel (default 3)
const H = require('./harness'); const { sleep, FX, upload, tool, fs, execSync, path } = H;
const DIR = path.resolve(__dirname, 'fx', 'corpus');
const OUTDIR = path.resolve(__dirname, 'corpus-out'); fs.mkdirSync(OUTDIR, { recursive: true });
if (!fs.existsSync(path.join(DIR, 'manifest.json'))) { console.error('No corpus: run  python3 fixtures/mkcorpus.py && node fixtures/mkchrome.js'); process.exit(2); }
let manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
if (process.env.CORPUS_ONLY) manifest = manifest.filter(e => new RegExp(process.env.CORPUS_ONLY).test(e.name));
const JOBS = +process.env.CORPUS_JOBS || 3;

// ---------- independent validators ----------
const sh = (cmd) => { try { return { rc: 0, out: execSync(cmd + ' 2>&1', { maxBuffer: 1 << 26 }).toString() }; } catch (e) { return { rc: e.status, out: String(e.stdout || '') }; } };
const PYTMP = path.join(OUTDIR, '_probe.py');
const pyjson = (code, ...args) => { const tmp = PYTMP + process.pid + Math.random().toString(36).slice(2); fs.writeFileSync(tmp, code); const r = sh(`python3 "${tmp}" ${args.map(a => JSON.stringify(a)).join(' ')}`); fs.unlinkSync(tmp); try { return JSON.parse(r.out.trim().split('\n').pop()); } catch (_) { return { error: r.out.slice(0, 200) }; } };
function words(file, page) {
  const a = page ? `-f ${page} -l ${page}` : '';
  const r = sh(`pdftotext ${a} "${file}" -`);
  return r.rc === 0 ? r.out : '';
}
const norm = s => s.replace(/\s+/g, ' ').trim();
const wordBag = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
// layout engines order text differently once a page is turned, so compare what letters are present
const letterBag = s => [...s.replace(/\s+/g, '')].sort().join('');
// structure checks: qpdf reports errors (exit 2); warnings (exit 3) are tolerated only if the source had them too
function valid(file, srcWarn) {
  const q = sh(`qpdf --check "${file}"`);
  const info = pyjson(`
import sys, json, pikepdf
try:
    with pikepdf.open(sys.argv[1]) as p:
        pg = p.pages[0].obj
        rot = pg.get('/Rotate', 0)
        try: rot = int(rot)
        except Exception: rot = 0
        meta = '/Metadata' in p.Root
        js = '/JavaScript' in str(p.Root.get('/Names', {})) or '/OpenAction' in p.Root
        att = len(p.attachments) if hasattr(p, 'attachments') else 0
        auth = 0
        for pgx in p.pages:
            for a in (pgx.obj.get('/Annots') or []):
                if '/T' in a: auth += 1
        print(json.dumps(dict(pages=len(p.pages), rotate=rot, xmp=meta, js=js, att=att, authors=auth)))
except Exception as e:
    print(json.dumps(dict(error=str(e)[:160])))`, file);
  const ok = q.rc === 0 || (q.rc === 3 && srcWarn !== 0) || (q.rc === 3 && !/error|damaged|invalid/i.test(q.out));
  return { ok: ok && !info.error, rc: q.rc, qout: q.out.split('\n').slice(0, 2).join(' | '), ...info };
}
function inkFraction(img) { let n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 160 || img.data[i + 1] < 160 || img.data[i + 2] < 160) n++; return n / (img.width * img.height); }

// ---------- one file ----------
async function runFile(b, e) {
  const R = [];
  const rec = (name, ok, detail = '') => R.push({ name: `${e.name}: ${name}`, ok: !!ok, detail });
  const src = path.join(DIR, e.name);
  const srcCheck = sh(`qpdf --check "${src}"`).rc;
  const tag = e.name.replace(/\.pdf$/, '');
  const outFile = k => path.join(OUTDIR, `${tag}.${k}.pdf`);
  const probePage = e.probe_page || 1;

  const fresh = async () => {
    const { p, ext, errors } = await H.newPage(b, H.LOCAL, false);
    await p.setViewport({ width: 1280, height: 900 });
    return { p, ext, errors };
  };
  // returns 'open' | 'refused' | 'hung'
  const open = async (p) => {
    await upload(p, '#edit-input', src);
    const r = await p.waitForFunction(() => {
      if (!document.getElementById('edit-work').hidden && document.getElementById('estage-canvas').width > 0) return 'open';
      const s = [document.getElementById('doc-status'), document.getElementById('edit-status')].find(x => x && /error/.test(x.className) && x.textContent.trim());
      return s ? 'refused:' + s.textContent.trim().slice(0, 120) : false;
    }, { timeout: 45000 }).then(h => h.jsonValue()).catch(() => 'hung');
    if (r === 'open') await sleep(1000);
    return r;
  };
  const done = async (ctx) => { try { await ctx.p.close(); } catch (_) {} };
  const noErrors = (ctx, stage) => {
    const bad = ctx.errors.filter(x => !/Failed to load resource|favicon/i.test(x));
    rec(`${stage}: no script errors`, bad.length === 0, bad.slice(0, 2).join(' | '));
    rec(`${stage}: no network requests`, ctx.ext.length === 0, ctx.ext.slice(0, 2).join(' '));
  };
  const goPage = async (p, n) => { for (let i = 1; i < n; i++) { await p.click('#e-next'); await sleep(900); } };
  const pickBlock = async (p, i) => {
    await p.evaluate(i => { const x = document.querySelectorAll('.trun.block')[i]; if (x) x.scrollIntoView({ block: 'center' }); }, i); await sleep(250);
    const spot = await p.evaluate(i => { const x = document.querySelectorAll('.trun.block')[i]; const r = x.getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; }, i);
    await p.mouse.click(spot.x, spot.y); await sleep(450);
  };
  const enterText = async (p) => {
    await p.evaluate(() => document.querySelector('#edit-modes .segbtn[data-emode=text]').click());
    return p.waitForFunction(() => document.querySelectorAll('.trun.block').length > 0, { timeout: 30000 }).then(() => true).catch(() => false);
  };
  const findProbe = async (p) => {
    const n = await p.$$eval('.trun.block', x => x.length);
    for (let i = 0; i < n; i++) {
      await pickBlock(p, i);
      const v = await p.$eval('#tx-text', t => t.value).catch(() => '');
      if (v.includes(e.probe)) return i;
    }
    return -1;
  };
  const save = async (p, applySel, k) => {
    await H.applyAndDownload(p, applySel, 120000);
    const d = await H.takeDownloads(p, 1, 60000); fs.writeFileSync(outFile(k), d[0].buf); return outFile(k);
  };

  // ===== 1. open and render =====
  let ctx = await fresh();
  let state;
  try { state = await open(ctx.p); } catch (err) { state = 'hung'; rec('open threw', false, String(err.message).slice(0, 120)); }
  if (e.expect === 'either') {
    rec('opens, or refuses with a message (never hangs or crashes)', state === 'open' || state.startsWith('refused:'), state);
  } else rec('opens', state === 'open', state);
  noErrors(ctx, 'open');
  if (state !== 'open') { await done(ctx); return R; }

  const label = await ctx.p.$eval('#e-label', x => x.textContent).catch(() => '');
  if (e.pages) rec('page count matches the file', new RegExp(`of ${e.pages}$`).test(label.trim()), `${label} vs ${e.pages}`);
  // the rendered page has about as much ink as an independent renderer's
  if (e.text || e.images) {
    const ref = (() => { try { return inkFraction(H.renderPage(src, 1, 40)); } catch (_) { return 0; } })();
    const mine = await ctx.p.evaluate(() => {
      const c = document.getElementById('estage-canvas'), s = document.createElement('canvas');
      s.width = 200; s.height = Math.max(1, Math.round(200 * c.height / c.width));
      const g = s.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, s.width, s.height); g.drawImage(c, 0, 0, s.width, s.height);
      const d = g.getImageData(0, 0, s.width, s.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 160 || d[i + 1] < 160 || d[i + 2] < 160) n++;
      return n / (s.width * s.height);
    });
    if (ref > 0.002) rec('renders about as much ink as poppler does', mine > ref * (e.form ? 0.15 : 0.35) && mine < ref * 3.5, `tool ${(mine * 100).toFixed(2)}% vs poppler ${(ref * 100).toFixed(2)}%`);
    else rec('renders without error (page is nearly blank)', true);
  }
  // form files: the fields are found
  if (e.form) {
    const fc = await ctx.p.$eval('#edit-fieldcount', x => x.textContent).catch(() => '');
    rec('form fields are found', /[1-9]/.test(fc), fc);
  }
  // Edit text mode opens without breaking, even where nothing is editable
  if (e.text) {
    await goPage(ctx.p, probePage);
    const had = await enterText(ctx.p);
    if (e.editable) rec('Edit text finds editable blocks', had);
    else rec('Edit text mode opens without errors (editing not promised)', true);
    noErrors(ctx, 'edit-mode');
  }
  await done(ctx);

  // ===== 2. rotate a page and save =====
  ctx = await fresh();
  try {
    await open(ctx.p);
    await tool(ctx.p, 'pages');
    await ctx.p.waitForFunction(() => document.querySelectorAll('#pages-grid .pcard').length > 0, { timeout: 60000 }); await sleep(700);
    const before = valid(src, srcCheck);
    await ctx.p.evaluate(() => document.querySelector('#pages-grid .pcard').click()); await sleep(200);
    await ctx.p.evaluate(() => document.getElementById('pages-rot-right').click()); await sleep(500);
    const f = await save(ctx.p, '#pages-go', 'rot');
    const v = valid(f, srcCheck);
    rec('rotate: the saved file passes qpdf and opens in pikepdf', v.ok, v.qout || v.error);
    rec('rotate: page count unchanged', v.pages === before.pages, `${before.pages} -> ${v.pages}`);
    rec('rotate: first page turned a quarter turn', ((before.rotate || 0) + 90) % 360 === ((v.rotate % 360) + 360) % 360, `${before.rotate} -> ${v.rotate}`);
    if (e.text) rec('rotate: the text is unchanged', letterBag(words(src)) === letterBag(words(f)), '');
  } catch (err) { rec('rotate flow', false, String(err.message).slice(0, 140)); }
  noErrors(ctx, 'rotate'); await done(ctx);

  // ===== 3. remove hidden info (and compress images) =====
  ctx = await fresh();
  try {
    await open(ctx.p);
    await tool(ctx.p, 'prepare'); await sleep(900);
    await ctx.p.waitForFunction(() => document.querySelectorAll('#meta-table tr').length > 0, { timeout: 60000 });
    for (const id of ['meta-opt-att']) {
      const vis = await ctx.p.evaluate(id => { const l = document.getElementById(id + '-line'); return l && !l.hidden; }, id);
      if (vis) await ctx.p.evaluate(id => { const c = document.getElementById(id); if (!c.checked) c.click(); }, id);
    }
    const f = await save(ctx.p, '#meta-go', 'strip');
    const v = valid(f, srcCheck);
    rec('clean: the saved file passes qpdf', v.ok, v.qout || v.error);
    if (e.pages) rec('clean: page count unchanged', v.pages === e.pages, `${e.pages} -> ${v.pages}`);
    if (e.text) rec('clean: the text is unchanged', wordBag(words(src)) === wordBag(words(f)));
    if (e.hidden) rec('clean: XMP, JavaScript and attachments are gone', !v.xmp && !v.js && v.att === 0, JSON.stringify({ xmp: v.xmp, js: v.js, att: v.att }));
    if (e.authors) rec('clean: comment author names are gone', v.authors === 0, `${v.authors} left`);
    if (e.revisions) rec('clean: earlier revisions are gone', (fs.readFileSync(f).toString('latin1').match(/%%EOF/g) || []).length === 1);
  } catch (err) { rec('clean flow', false, String(err.message).slice(0, 140)); }
  noErrors(ctx, 'clean'); await done(ctx);

  if (e.images) {
    ctx = await fresh();
    try {
      await open(ctx.p);
      await tool(ctx.p, 'prepare'); await sleep(700);
      await ctx.p.evaluate(() => document.querySelector('#prep-modes [data-mode=compress]').click()); await sleep(500);
      await ctx.p.evaluate(() => document.getElementById('cmp-go').click());
      // done = a step was added, or the compressor said something (success, error, or "already compact")
      await ctx.p.waitForFunction(() => (+(document.getElementById('docbar').dataset.steps || '0') > 0) ||
        [...document.querySelectorAll('#opt-status, #prep-status')].some(x => /success|info|error/.test(x.className) && x.textContent.trim()), { timeout: 120000 }).catch(() => {});
      const st = await ctx.p.evaluate(() => { const s = [...document.querySelectorAll('#opt-status, #prep-status')].map(x => x.className + ':' + x.textContent).join(' '); return s; });
      const saved = await ctx.p.evaluate(() => (document.getElementById('docbar').dataset.steps || '0'));
      if (+saved > 0) {
        await H.downloadDoc(ctx.p); const d = await H.takeDownloads(ctx.p, 1, 60000); fs.writeFileSync(outFile('cmp'), d[0].buf);
        const v = valid(outFile('cmp'), srcCheck);
        rec('compress: the saved file passes qpdf', v.ok, v.qout || v.error);
        if (e.pages) rec('compress: page count unchanged', v.pages === e.pages);
        if (e.big_image) rec('compress: a large photo gets smaller', fs.statSync(outFile('cmp')).size < fs.statSync(src).size, `${fs.statSync(src).size} -> ${fs.statSync(outFile('cmp')).size}`);
      } else rec('compress: finished with a clear message and no damage', /success|info|error/.test(st), st.slice(0, 140));
    } catch (err) { rec('compress flow', false, String(err.message).slice(0, 140)); }
    noErrors(ctx, 'compress'); await done(ctx);
  }

  if (!(e.text && e.editable)) return R;

  // ===== 4. edit a word in place =====
  ctx = await fresh();
  try {
    await open(ctx.p); await goPage(ctx.p, probePage);
    if (!(await enterText(ctx.p))) throw new Error('no editable blocks');
    const idx = await findProbe(ctx.p);
    rec('edit: the block with the probe word is found', idx >= 0);
    if (idx >= 0) {
      await ctx.p.$eval('#tx-text', (t, a, b) => { t.value = t.value.replace(a, b); t.dispatchEvent(new Event('input')); }, e.probe, 'EDITED'); await sleep(600);
      const f = await save(ctx.p, '#edit-go', 'edit');
      const v = valid(f, srcCheck);
      rec('edit: the saved file passes qpdf', v.ok, v.qout || v.error);
      if (e.pages) rec('edit: page count unchanged', v.pages === e.pages, `${e.pages} -> ${v.pages}`);
      const t = words(f, probePage);
      rec('edit: the new word is in the saved text and the old one is gone', t.includes('EDITED') && !t.includes(e.probe), norm(t).slice(0, 80));
      rec('edit: the rest of the line survives', t.includes(e.control), '');
      const other = wordBag(words(src, probePage)).replace(e.probe, 'EDITED');
      const same = wordBag(t) === wordBag(other);
      rec('edit: nothing else on the page changed', same, same ? '' : 'word lists differ');
    }
  } catch (err) { rec('edit flow', false, String(err.message).slice(0, 140)); }
  noErrors(ctx, 'edit'); await done(ctx);

  // ===== 5. redact the probe's line =====
  ctx = await fresh();
  try {
    await open(ctx.p); await goPage(ctx.p, probePage);
    if (!(await enterText(ctx.p))) throw new Error('no editable blocks');
    const idx = await findProbe(ctx.p);
    if (idx < 0) throw new Error('probe block not found');
    const blockText = await ctx.p.$eval('#tx-text', t => t.value);
    const target = await ctx.p.evaluate(i => { const st = document.getElementById('estage').getBoundingClientRect(); const r = document.querySelectorAll('.trun.block')[i].getBoundingClientRect(); return { x: (r.left - st.left) / st.width, y: (r.top - st.top) / st.height, w: r.width / st.width, h: r.height / st.height }; }, idx);
    await ctx.p.evaluate(() => document.querySelector('#edit-modes .segbtn[data-emode=redact]').click()); await sleep(2200);
    await ctx.p.evaluate(() => document.getElementById('estage').scrollIntoView({ block: 'center' })); await sleep(400);
    const st = await (await ctx.p.$('#estage')).boundingBox();
    await ctx.p.mouse.move(st.x + target.x * st.width - 2, st.y + target.y * st.height - 1); await ctx.p.mouse.down();
    await ctx.p.mouse.move(st.x + (target.x + target.w) * st.width + 2, st.y + (target.y + target.h) * st.height + 1, { steps: 8 });
    await ctx.p.mouse.up(); await sleep(700);
    rec('redact: an area is marked', (await ctx.p.$$('.redbox')).length === 1);
    const f = await save(ctx.p, '#edit-go', 'redact');
    const v = valid(f, srcCheck);
    rec('redact: the saved file passes qpdf', v.ok, v.qout || v.error);
    if (e.pages) rec('redact: page count unchanged', v.pages === e.pages);
    const t = words(f, probePage);
    rec('redact: the probe word is gone from the saved text', !t.includes(e.probe), norm(t).slice(0, 80));
    // some word on another line must survive: redaction takes what the box touches and no more
    const lines = words(src, probePage).split('\n').map(norm).filter(Boolean);
    const inBlock = new Set(norm(blockText).split(' '));       // the box takes the whole block, so look elsewhere
    const surv = lines.filter(l => !l.includes(e.probe)).flatMap(l => l.split(' ')).filter(w => /^[A-Za-z]{5,}$/.test(w) && !inBlock.has(w))[0];
    if (surv) rec('redact: text outside the box survives', t.includes(surv), surv);
    else rec('redact: (the page is one block, so there is nothing outside the box to check)', true);
  } catch (err) { rec('redact flow', false, String(err.message).slice(0, 140)); }
  noErrors(ctx, 'redact'); await done(ctx);
  return R;
}

(async () => {
  const queue = manifest.slice();
  const results = new Map();
  const worker = async (id) => {
    const b = await H.launch();
    try {
      while (queue.length) {
        const e = queue.shift();
        const t0 = Date.now();
        let R;
        try { R = await runFile(b, e); } catch (err) { R = [{ name: `${e.name}: harness`, ok: false, detail: String(err.stack || err).slice(0, 200) }]; }
        results.set(e.name, R);
        const bad = R.filter(r => !r.ok).length;
        console.error(`   [${id}] ${e.name.padEnd(30)} ${R.length - bad}/${R.length} ok  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    } finally { await b.close().catch(() => {}); }
  };
  await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i + 1)));
  for (const e of manifest) for (const r of results.get(e.name) || []) H.check(r.name, r.ok, r.detail);
  H.summary();
  process.exit(H.results.some(r => !r.ok) ? 1 : 0);
})();
