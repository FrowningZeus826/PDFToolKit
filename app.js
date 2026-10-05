(function(){
  "use strict";
  const { PDFDocument, degrees, EncryptedPDFError } = PDFLib;
  const pdfjs = window.pdfjsLib;
  const $ = id => document.getElementById(id);

  // ================= Downloads =================
  // Inside claude.ai the platform save prompt is used; opened as a local file,
  // a normal browser download is used instead.
  let dlPromise = null;
  function getDownloads(){
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    if (!dlPromise) dlPromise = Promise.resolve(window.claude.use("downloads")).catch(() => null);
    return dlPromise;
  }
  getDownloads();

  async function saveFile(filename, bytes, mime){
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || "application/pdf" });
    const dl = await getDownloads();
    if (dl && typeof dl.save === "function") {
      try { await dl.save({ filename, data: blob }); return; }
      catch (e) {
        const code = e && e.code;
        if (code === "declined") throw new Error("Download cancelled.");
        if (code === "rate_limited") throw new Error("A download prompt is already open. Finish that one, then try again.");
        if (code === "extension_not_enabled" || code === "rejected_extension") throw new Error("This viewer doesn't allow that file type to download. Try saving as one PDF, or open the tool in your web browser.");
        throw new Error("The download couldn't be saved" + (code ? " (" + code + ")" : "") + ".");
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ================= Helpers =================
  function setStatus(el, kind, msg){ el.className = "status show " + kind; el.textContent = msg; }
  function clearStatus(el){ el.className = "status"; el.textContent = ""; }
  function fmtSize(b){
    if (b < 1024) return b + " B";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function plural(n, w){ return n + " " + w + (n === 1 ? "" : "s"); }
  function baseName(name){ return name.replace(/\.pdf$/i, "") || "document"; }
  function norm(deg){ return (((deg % 360) + 360) % 360); }
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  // Fonts are embedded in the file and registered from memory: no requests to Google or anyone else.
  function b64ToBytes(b64){
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const fontsReady = (async () => {
    const list = window.__PDFTOOLS_FONTS || [];
    await Promise.all(list.map(async ([family, weight, b64]) => {
      try {
        const face = new FontFace(family, b64ToBytes(b64).buffer, { weight: String(weight), style: "normal" });
        await face.load();
        document.fonts.add(face);
      } catch (e) { /* fall back to system fonts */ }
    }));
    window.__PDFTOOLS_FONTS = null;
  })();

  // The PDF spec allows the %PDF- header anywhere in the first 1024 bytes.
  async function isLikelyPdf(file){
    const b = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    for (let i = 0; i + 4 < b.length; i++) {
      if (b[i] === 0x25 && b[i+1] === 0x50 && b[i+2] === 0x44 && b[i+3] === 0x46 && b[i+4] === 0x2D) return true;
    }
    return false;
  }

  // Encrypted PDFs are rejected: pdf-lib can't decrypt, so output would be blank or broken.
  async function loadPdf(bytes, name){
    try {
      const doc = await PDFDocument.load(bytes);
      // pdf-lib is lenient on load; touching the page tree catches files with no usable pages.
      if (doc.getPageCount() < 1) throw new Error("no pages");
      return doc;
    } catch (err) {
      if ((EncryptedPDFError && err instanceof EncryptedPDFError) || /encrypt/i.test((err && err.message) || "")) {
        throw new Error("\"" + name + "\" is password-protected. Open Finish \u2192 Password \u2192 Remove a password first, then try again.");
      }
      throw new Error("\"" + name + "\" couldn't be opened. It may be damaged or not a real PDF.");
    }
  }

  // Photos of signed forms are common, so Merge accepts images: each becomes a one-page
  // PDF (fitted to Letter, portrait or landscape to match the photo) and then behaves
  // like any other page — reorderable, removable, mixable with real PDFs.
  const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/i;
  const isImageFile = f => IMAGE_TYPES.test(f.type || "") || /\.(jpe?g|png|webp)$/i.test(f.name);
  async function imageToPdfBytes(file){
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.create();
    let img;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
    if (isJpg) img = await doc.embedJpg(buf);
    else if (isPng) img = await doc.embedPng(buf);
    else {
      // WebP (and anything else the browser can decode) goes through a canvas as PNG.
      const bmp = await createImageBitmap(new Blob([buf], { type: file.type || "image/webp" }));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      c.width = c.height = 0;
      if (!blob) throw new Error("\"" + file.name + "\" couldn't be read as an image.");
      img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    }
    const landscape = img.width > img.height;
    const PW = landscape ? 792 : 612, PH = landscape ? 612 : 792, M = 18;
    const page = doc.addPage([PW, PH]);
    const s2 = Math.min((PW - 2 * M) / img.width, (PH - 2 * M) / img.height);
    const w = img.width * s2, h = img.height * s2;
    page.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
    return doc.save();
  }
  async function prepareImage(file){
    if (file.size > MAX_BYTES) throw new Error("\"" + file.name + "\" is " + fmtSize(file.size) + ". The limit is " + fmtSize(MAX_BYTES) + ".");
    let bytes;
    try { bytes = await imageToPdfBytes(file); }
    catch (err) { throw new Error("\"" + file.name + "\" couldn't be turned into a page. Try a JPG or PNG."); }
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { file: { name: file.name.replace(/\.[^.]+$/, "") + ".pdf", size: ab.byteLength }, bytes: ab, pages: 1, signed: false, fromImage: true };
  }

  // Validate a picked file once; every tool works from the result.
  const MAX_BYTES = 250 * 1024 * 1024;
  async function prepare(file){
    if (file.size > MAX_BYTES) throw new Error("\"" + file.name + "\" is " + fmtSize(file.size) + ". The limit is " + fmtSize(MAX_BYTES) + " to keep your browser from running out of memory.");
    if (!(await isLikelyPdf(file))) throw new Error("\"" + file.name + "\" doesn't look like a PDF.");
    const bytes = await file.arrayBuffer();
    const doc = await loadPdf(bytes.slice(0), file.name);
    return { file, bytes, pages: doc.getPageCount(), signed: hasSignature(bytes) };
  }

  // pdf.js keeps whatever buffer it's given, so it always gets its own copy.
  // The 14 standard PDF fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats) are embedded
  // and handed to pdf.js from memory. standardFontDataUrl stays unset on purpose: that keeps
  // pdf.js asking this factory instead of the network. System fonts are off so every device
  // renders the same way.
  const STD_FONTS = window.__PDFTOOLS_STD_FONTS || {};
  window.__PDFTOOLS_STD_FONTS = null;
  class EmbeddedStandardFonts {
    constructor(){}
    async fetch({ filename }){
      const b64 = STD_FONTS[filename];
      if (!b64) throw new Error("No embedded data for " + filename);
      return b64ToBytes(b64);
    }
  }
  function openPdfJs(bytes){
    return pdfjs.getDocument({
      data: new Uint8Array(bytes.slice(0)),
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      StandardFontDataFactory: EmbeddedStandardFonts,
      verbosity: 0 // errors only
    }).promise;
  }

  // One render at a time keeps the page responsive (pdf.js runs on the main thread here).
  const queue = [];
  let pumping = false;
  function enqueue(fn){
    return new Promise((res, rej) => { queue.push({ fn, res, rej }); pump(); });
  }
  async function pump(){
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const job = queue.shift();
      try { job.res(await job.fn()); } catch (e) { job.rej(e); }
      await new Promise(r => setTimeout(r, 0));
    }
    pumping = false;
  }

  // Render a page to fit inside a box (for thumbnails), with optional extra rotation.
  async function renderFit(doc, num, canvas, box, extraRot){
    const page = await doc.getPage(num);
    const rotation = norm(page.rotate + (extraRot || 0));
    const base = page.getViewport({ scale: 1, rotation });
    const s = box / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale: s * dpr(), rotation });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = Math.round(base.width * s) + "px";
    canvas.style.height = Math.round(base.height * s) + "px";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }

  function wireDropzone(dzId, inputId, onFiles){
    const dz = $(dzId), input = $(inputId);
    // The zone is a <label> wrapping the input, so a tap opens the picker natively.
    // Keyboard users get Enter/Space.
    dz.addEventListener("keydown", e => { if (e.target === dz && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.click(); } });
    input.addEventListener("change", async () => {
      const files = Array.from(input.files);
      input.value = "";
      if (files.length) await onFiles(files);
    });
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", async e => {
      e.preventDefault(); dz.classList.remove("drag");
      const files = Array.from(e.dataTransfer.files);
      if (files.length) await onFiles(files);
    });
  }


  // ================= Core document utilities =================
  const { PDFRef, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFNull, PDFNumber, PDFString, PDFHexString, PDFBool } = PDFLib;

  // Drop every object nothing points to (leftovers from earlier edits, flattened form
  // fields, old revisions) and renumber the rest 1..n. pdf-lib writes a slightly
  // malformed cross-reference table when objects have been deleted; renumbering avoids
  // gaps entirely, and garbage collection is what makes "scrub" and "compress" thorough.
  function compactDoc(doc){
    const ctx = doc.context;
    const all = ctx.enumerateIndirectObjects();
    const before = all.length;
    // Object streams and cross-reference streams are file-structure containers that nothing
    // references; they're rebuilt on save, so they don't count as "leftovers".
    const structural = all.filter(([, o]) => { const t = o instanceof PDFStream && o.dict.lookup(PDFLib.PDFName.of("Type")); return t && (t.asString() === "/ObjStm" || t.asString() === "/XRef"); }).length;
    const seen = new Set(), order = [], stack = [];
    const ti = ctx.trailerInfo;
    [ti.Root, ti.Info, ti.Encrypt].forEach(o => { if (o) stack.push(o); });
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) {
        if (seen.has(o)) continue;
        const target = ctx.lookup(o);
        if (target === undefined) continue;
        seen.add(o); order.push(o); stack.push(target);
      } else if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
      else if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) stack.push(o.get(i)); }
      else if (o instanceof PDFStream) stack.push(o.dict);
    }
    order.sort((a, b) => a.objectNumber - b.objectNumber || a.generationNumber - b.generationNumber);
    const map = new Map(order.map((r, i) => [r, PDFRef.of(i + 1, 0)]));
    // Each object's references must be remapped exactly once. Shared dictionaries and
    // arrays are reachable by more than one path, and remapping twice would look up an
    // already-new reference in the old map — quietly repointing or dropping it.
    const fixed = new Set();
    const fix = o => {
      if (!o || fixed.has(o)) return;
      fixed.add(o);
      if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) {
          if (v instanceof PDFRef) { const n = map.get(v); if (n) o.set(k, n); else o.delete(k); }
          else fix(v);
        }
      } else if (o instanceof PDFArray) {
        for (let i = 0; i < o.size(); i++) {
          const v = o.get(i);
          if (v instanceof PDFRef) o.set(i, map.get(v) || PDFNull);
          else fix(v);
        }
      } else if (o instanceof PDFStream) fix(o.dict);
    };
    const objs = order.map(r => [r, ctx.lookup(r)]);
    objs.forEach(([, o]) => fix(o));
    for (const [r] of ctx.enumerateIndirectObjects()) ctx.delete(r);
    ctx.largestObjectNumber = 0;
    objs.forEach(([r, o]) => ctx.assign(map.get(r), o));
    ["Root", "Info", "Encrypt"].forEach(k => { if (ti[k] instanceof PDFRef) ti[k] = map.get(ti[k]); });
    return { before, after: order.length, removed: Math.max(0, before - order.length - structural) };
  }

  // Every tool saves through here: embed pending fonts/images, compact, write.
  async function saveDoc(doc, opts){
    opts = opts || {};
    await doc.flush();
    const stats = compactDoc(doc);
    if (opts.beforeWrite) opts.beforeWrite(doc);
    const bytes = await doc.save({ useObjectStreams: opts.objectStreams !== false, updateFieldAppearances: false });
    if (opts.stats) Object.assign(opts.stats, stats);
    return bytes;
  }

  function bytesIndexOf(hay, needle, from){
    const n0 = needle[0];
    outer: for (let i = from || 0; i <= hay.length - needle.length; i++) {
      if (hay[i] !== n0) continue;
      for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }
  const enc8 = s => new TextEncoder().encode(s);
  const hasSignature = bytes => bytesIndexOf(new Uint8Array(bytes), enc8("/ByteRange")) >= 0;

  // Binary string <-> bytes, for node-forge.
  function bytesToBin(u8){
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return s;
  }
  function binToBytes(s){ const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
  const toHex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join("");

  // ---------- PDF standard security handler: password checks (ISO 32000-2 §7.6.4) ----------
  // Used so "Remove password" can require the owner (permissions) password when the
  // author restricted printing/copying/editing, instead of silently bypassing them.
  const PDF_PAD = binToBytes(atob("KL9OXk51ikFkAE5W//oBCC4uALbQaD6ALwyp/mRTaXo="));
  function rc4(key, data){
    const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const out = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
      out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
  }
  function md(name, ...parts){ const m = forge.md[name].create(); parts.forEach(p => m.update(bytesToBin(p))); return binToBytes(m.digest().getBytes()); }
  const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; a.forEach(x => { out.set(x, o); o += x.length; }); return out; };
  const eqBytes = (a, b, n) => { for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; };
  const pad32 = pw => { const b = new TextEncoder().encode(pw).slice(0, 32); return cat(b, PDF_PAD.slice(0, 32 - b.length)); };
  function aesCbcNoPad(key, iv, data){
    const c = forge.cipher.createCipher("AES-CBC", bytesToBin(key));
    c.start({ iv: bytesToBin(iv) }); c.update(forge.util.createBuffer(bytesToBin(data))); c.finish(() => true);
    return binToBytes(c.output.getBytes());
  }
  function hash2B(pw, salt, udata){ // Algorithm 2.B (R6)
    let K = md("sha256", pw, salt, udata), E;
    for (let round = 0; ; round++) {
      const K1 = cat(...new Array(64).fill(cat(pw, K, udata)));
      E = aesCbcNoPad(K.slice(0, 16), K.slice(16, 32), K1);
      let sum = 0; for (let i = 0; i < 16; i++) sum += E[i];
      K = md(["sha256", "sha384", "sha512"][sum % 3], E);
      if (round >= 63 && E[E.length - 1] <= round - 31) break;
    }
    return K.slice(0, 32);
  }
  function readSecurity(doc){
    const ctx = doc.context;
    const e = ctx.lookup(ctx.trailerInfo.Encrypt);
    if (!(e instanceof PDFDict)) return null;
    const num = k => { const v = e.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : undefined; };
    const str = k => { const v = e.lookup(PDFName.of(k)); return v && typeof v.asBytes === "function" ? v.asBytes() : new Uint8Array(0); };
    const filt = e.lookup(PDFName.of("Filter"));
    const idArr = ctx.trailerInfo.ID;
    const idv = idArr instanceof PDFArray ? idArr.lookup(0) : (idArr && idArr.get ? idArr.get(0) : null);
    const em = e.lookup(PDFName.of("EncryptMetadata"));
    return {
      standard: !filt || filt.asString() === "/Standard",
      R: num("R"), V: num("V"), P: num("P") | 0, length: num("Length") || 40,
      O: str("O"), U: str("U"), id0: idv && typeof idv.asBytes === "function" ? idv.asBytes() : new Uint8Array(0),
      encryptMetadata: !(em instanceof PDFBool && em.asBoolean() === false)
    };
  }
  function fileKeyR2to4(sec, pw32){
    const n = sec.R === 2 ? 5 : sec.length / 8;
    const P = new Uint8Array([sec.P & 255, (sec.P >> 8) & 255, (sec.P >> 16) & 255, (sec.P >>> 24) & 255]);
    let h = md("md5", pw32, sec.O, P, sec.id0, sec.R >= 4 && !sec.encryptMetadata ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0));
    if (sec.R >= 3) for (let i = 0; i < 50; i++) h = md("md5", h.slice(0, n));
    return h.slice(0, n);
  }
  function userMatches(sec, pw32){
    const key = fileKeyR2to4(sec, pw32);
    if (sec.R === 2) return eqBytes(rc4(key, PDF_PAD), sec.U, 32);
    let x = rc4(key, md("md5", PDF_PAD, sec.id0));
    for (let i = 1; i <= 19; i++) x = rc4(key.map(b => b ^ i), x);
    return eqBytes(x, sec.U, 16);
  }
  function checkPassword(sec, pw){
    // returns "owner", "user", or null
    if (sec.R >= 5) {
      const p = new TextEncoder().encode(pw).slice(0, 127);
      const h = sec.R === 5 ? (s, u) => md("sha256", p, s, u) : (s, u) => hash2B(p, s, u);
      if (eqBytes(h(sec.O.slice(32, 40), sec.U.slice(0, 48)), sec.O, 32)) return "owner";
      if (eqBytes(h(sec.U.slice(32, 40), new Uint8Array(0)), sec.U, 32)) return "user";
      return null;
    }
    const n = sec.R === 2 ? 5 : sec.length / 8;
    let h = md("md5", pad32(pw));
    if (sec.R >= 3) for (let i = 0; i < 50; i++) h = md("md5", h);
    const okey = h.slice(0, n);
    let upw = sec.O.slice(0, 32);
    if (sec.R === 2) upw = rc4(okey, upw);
    else for (let i = 19; i >= 0; i--) upw = rc4(okey.map(b => b ^ i), upw);
    if (userMatches(sec, upw)) return "owner";
    if (userMatches(sec, pad32(pw))) return "user";
    return null;
  }
  // Permission bits that matter to people (ISO 32000-2 Table 22).
  function restrictionsOf(sec){
    const P = sec.P, off = [];
    if (!(P & 4)) off.push("printing");
    if (!(P & 8)) off.push("changing the document");
    if (!(P & 16)) off.push("copying text");
    if (!(P & 32)) off.push("commenting");
    if (sec.R >= 3) {
      if (!(P & 256)) off.push("filling in forms");
      if (!(P & 1024)) off.push("assembling pages");
      if ((P & 4) && !(P & 2048)) off.push("high-quality printing");
    }
    return [...new Set(off)];
  }

  // ================= Shared open document & tool switching =================
  let current = null;
  const tools = {};
  let activeTool = "document";

  function setCurrent(info){
    current = info;
    renderDocBar();
    const rf = $("rail-file");
    rf.textContent = "Open file";
    const s = document.createElement("strong");
    s.textContent = info.file.name;
    rf.appendChild(s);
    if (info.signed) {
      const w = document.createElement("span");
      w.className = "rail-signed";
      w.textContent = "Digitally signed. Saving changes in any tool creates a copy without a valid signature.";
      rf.appendChild(w);
    }
  }

  async function syncTool(name){
    const t = tools[name];
    if (!t) return;
    try {
      if (current && t.info() !== current) await t.load(current);
      else if (t.onShow) await t.onShow();
    } catch (err) {
      if (t.status) setStatus(t.status, "error", err.message || "Couldn't open that PDF.");
    }
  }

  function showTool(name){
    activeTool = name;
    document.querySelectorAll(".rail-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === name));
    const ab = document.querySelector('.rail-btn[data-tool="' + name + '"]');
    if (ab && ab.scrollIntoView) ab.scrollIntoView({ inline: "nearest", block: "nearest" });
    document.querySelectorAll("section.panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
    window.scrollTo(0, 0);
    syncTool(name);
  }
  document.querySelectorAll(".rail-btn").forEach(b => b.addEventListener("click", () => showTool(b.dataset.tool)));

  // ================= The working document =================
  // Tools hand the document to each other instead of making the person download and
  // re-upload between every step: each tool applies its change to the document that's
  // open, the bar at the top tracks what's been done, and one Download saves the result.
  const work = { steps: [], undo: [] };

  function docBaseName(){ return (current && current.baseName) || (current ? baseName(current.file.name) : "document"); }
  function workDirty(){ return work.steps.length > 0; }

  function renderDocBar(){
    const bar = $("docbar");
    if (!current) { bar.hidden = true; return; }
    bar.hidden = false;
    $("docbar-name").textContent = current.file.name;
    const n = work.steps.length;
    $("docbar-steps").textContent = n ? n + " change" + (n > 1 ? "s" : "") + " not saved yet: " + work.steps.join(", ") : "No changes yet";
    $("docbar-steps").classList.toggle("dirty", !!n);
    $("docbar-undo").disabled = !n;
    $("docbar-steps").title = $("docbar-steps").textContent;     // the header may have to cut it short
    $("docbar-dl").disabled = false;           // downloading what's open is always allowed
    $("docbar").dataset.steps = n;             // hook for the test suite
    if (typeof renderFinish === "function") renderFinish();
    $("docbar-sig").hidden = !current.signed;
    if (current.signed) showSignatureState(current);
  }

  // A signed document says so in the bar, and says whether the signature still holds:
  // "digitally signed" is not much use if it is quietly broken.
  const SIG_STATE = {
    valid:   { cls: "sig-ok",   text: "Signature valid \u2014 unchanged since it was signed." },
    changed: { cls: "sig-warn", text: "Signed, but the file was changed after signing. Check signatures in Finish." },
    broken:  { cls: "sig-bad",  text: "Signature broken \u2014 this file was modified after it was signed. Check signatures in Finish." },
    unknown: { cls: "sig-warn", text: "Digitally signed; this tool couldn't check the signature. See Finish \u2192 Check signatures." }
  };
  async function signatureState(info){
    if (info.sigState) return info.sigState;
    let state = "unknown", signer = "";
    try {
      const doc = await PDFDocument.load(info.bytes.slice(0), { updateMetadata: false });
      const bytes = new Uint8Array(info.bytes);
      const results = [];
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;
        const br = obj.lookup(N("ByteRange")), ct = obj.lookup(N("Contents"));
        if (!(br instanceof PDFArray) || !ct || typeof ct.asBytes !== "function") continue;
        const sub = obj.lookup(N("SubFilter"));
        if (!/pkcs7\.detached|CAdES\.detached/i.test(sub instanceof PDFName ? sub.asString() : "")) { results.push({ ok: false, unknown: true }); continue; }
        results.push(verifyOne(bytes, br.asArray().map(x => x.asNumber()), ct.asBytes()));
      }
      if (results.length) {
        const bad = results.some(r => !r.unknown && !r.ok);
        const unk = results.some(r => r.unknown);
        const later = results.some(r => r.ok && !r.coversAll);
        state = bad ? "broken" : unk ? "unknown" : later ? "changed" : "valid";
        const withCert = results.find(r => r.cert);
        if (withCert) signer = withCert.cert.cn;
      }
    } catch (e) { state = "unknown"; }
    info.sigState = { state, signer };
    return info.sigState;
  }
  async function showSignatureState(info){
    const el = $("docbar-sig");
    el.className = "rail-signed";
    el.textContent = "Digitally signed \u2014 checking\u2026";
    const { state, signer } = await signatureState(info);
    if (info !== current) return;                 // a different document was opened meanwhile
    const s = SIG_STATE[state] || SIG_STATE.unknown;
    el.className = "rail-signed " + s.cls;
    el.textContent = (signer ? "Signed by " + signer + ". " : "") + s.text;
  }


  // Apply a tool's output to the open document and stay put.
  async function applyResult(bytes, label, opts){
    // stay on the page being worked on
    opts = opts || {};
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const doc = await loadPdf(ab.slice(0), opts.name || (current && current.file.name) || "document.pdf");
    const base = opts.base || docBaseName();
    const info = { file: { name: base + ".pdf", size: ab.byteLength }, bytes: ab, pages: doc.getPageCount(),
                   signed: hasSignature(ab), baseName: base, keepPage: true };
    if (opts.replace) { work.steps = []; work.undo = []; }
    else work.undo.push({ info: current, steps: work.steps.slice() });
    if (label) work.steps.push(label);
    setCurrent(info);
    await syncTool(activeTool);
    return info;
  }

  async function downloadWork(){
    if (!current) return;
    const name = docBaseName() + (workDirty() ? "_edited" : "") + ".pdf";
    await saveFile(name, new Uint8Array(current.bytes));
    return name;
  }

  $("docbar-dl").addEventListener("click", async () => {
    try {
      const name = await downloadWork();
      setStatus($("docbar-status"), "success", "Saved " + name + ". The document stays open here if you want to keep working on it.");
    } catch (err) { setStatus($("docbar-status"), "error", err.message); }
  });
  // Ctrl/Cmd+S downloads what is open, as in a word processor, rather than the browser saving the page
  document.addEventListener("keydown", ev => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.key.toLowerCase() !== "s") return;
    const dl = $("docbar-dl");
    if (!current || $("docbar").hidden || dl.disabled) return;
    ev.preventDefault(); dl.click();
  });
  // everything that sticks below the header needs to know how tall it is
  { const hdr = document.querySelector("header.top");
    const publish = () => document.documentElement.style.setProperty("--hdr", hdr.offsetHeight + "px");
    publish();
    if (window.ResizeObserver) new ResizeObserver(publish).observe(hdr); else window.addEventListener("resize", publish); }
  $("docbar-undo").addEventListener("click", async () => {
    const prev = work.undo.pop();
    if (!prev) return;
    work.steps = prev.steps;
    setCurrent(prev.info);
    await syncTool(activeTool);
    clearStatus($("docbar-status"));
  });

  // Single-file tools share this picker behaviour.
  function wireSingle(prefix, tool){
    wireDropzone(prefix + "-dz", prefix + "-input", async files => {
      clearStatus(tool.status);
      try {
        const info = await prepare(files[0]);
        // a newly opened file starts clean: the change list belongs to the old document
        work.steps = []; work.undo = [];
        setCurrent(info);
        await tool.load(info);
      } catch (err) {
        setStatus(tool.status, "error", err.message || "Couldn't open that PDF.");
      }
    });
  }

  // ================= Page grid (shared by Merge, Split, Rotate) =================
  // Thumbnails render lazily as they scroll into view. Cards can be selected (tap or
  // Space), reordered (mouse drag anywhere, touch drag by the handle, or Ctrl/Cmd+Arrow),
  // and removed (x button or Delete).
  const THUMB = 106;

  class PageGrid {
    constructor(el, opts){
      this.el = el;
      this.opts = Object.assign({ selectable: true, draggable: false, removable: false, label: () => {}, onChange: () => {} }, opts);
      this.items = []; this.sel = new Set(); this.cards = new Map();
      this.gen = 0; this.observer = null; this.justDragged = false;
      if (this.opts.draggable) el.classList.add("sortable");
      this.newObserver();
    }
    newObserver(){
      if (this.observer) this.observer.disconnect();
      const gen = this.gen;
      this.observer = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const c = this.cards.get(en.target.dataset.key);
          if (c && !c.rendered) this.renderCard(c, gen);
        });
      }, { rootMargin: "500px 0px" });
    }
    setItems(items){
      ++this.gen;
      this.newObserver();
      this.el.innerHTML = "";
      this.cards.clear();
      this.items = items.slice();
      const keys = new Set(items.map(i => i.key));
      [...this.sel].forEach(k => { if (!keys.has(k)) this.sel.delete(k); });
      items.forEach(it => this.el.appendChild(this.makeCard(it)));
      this.refresh();
    }
    append(items){
      items.forEach(it => { this.items.push(it); this.el.appendChild(this.makeCard(it)); });
      this.refresh();
    }
    reset(){ this.sel.clear(); this.setItems([]); }
    makeCard(it){
      const el = document.createElement("div");
      el.className = "pcard";
      el.tabIndex = 0;
      el.dataset.key = it.key;
      el.setAttribute("role", this.opts.selectable ? "checkbox" : "listitem");
      const th = document.createElement("div"); th.className = "pthumb";
      const canvas = document.createElement("canvas"); th.appendChild(canvas);
      const label = document.createElement("span"); label.className = "plabel";
      el.append(th, label);
      if (this.opts.draggable) {
        const h = document.createElement("span");
        h.className = "pdrag"; h.setAttribute("aria-hidden", "true"); h.textContent = "\u2807\u2807";
        el.appendChild(h);
      }
      if (this.opts.removable) {
        const x = document.createElement("button");
        x.type = "button"; x.className = "pdel"; x.textContent = "\u2715"; x.setAttribute("aria-label", "Remove this page");
        x.addEventListener("pointerdown", e => e.stopPropagation());
        x.addEventListener("click", e => { e.stopPropagation(); this.remove([it.key]); });
        el.appendChild(x);
      }
      const card = { el, canvas, label, item: it, rendered: false };
      this.cards.set(it.key, card);
      el.addEventListener("click", () => {
        if (this.justDragged) { this.justDragged = false; return; }
        if (this.opts.selectable) this.toggle(it.key);
      });
      el.addEventListener("keydown", e => {
        if (e.target !== el) return;
        if ((e.key === " " || e.key === "Enter") && this.opts.selectable) { e.preventDefault(); this.toggle(it.key); }
        else if (this.opts.draggable && (e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault(); this.moveBy(it.key, e.key === "ArrowLeft" ? -1 : 1); el.focus();
        } else if (this.opts.removable && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault(); const next = el.nextElementSibling || el.previousElementSibling; this.remove([it.key]); if (next) next.focus();
        }
      });
      if (this.opts.draggable) this.wireDrag(el, card);
      this.observer.observe(el);
      return card.el;
    }
    renderCard(card, gen){
      card.rendered = true;
      const it = card.item;
      enqueue(async () => {
        if (gen !== this.gen || !this.cards.has(it.key)) return;
        await renderFit(it.doc, it.page, card.canvas, THUMB, it.rot || 0);
      }).catch(() => {});
    }
    rerender(keys){ keys.forEach(k => { const c = this.cards.get(k); if (c) this.renderCard(c, this.gen); }); }
    toggle(k){ this.sel.has(k) ? this.sel.delete(k) : this.sel.add(k); this.refresh(); }
    selectAll(){ this.items.forEach(i => this.sel.add(i.key)); this.refresh(); }
    selectNone(){ this.sel.clear(); this.refresh(); }
    setSelection(keys){ this.sel = new Set(keys); this.refresh(); }
    selectedItems(){ return this.items.filter(i => this.sel.has(i.key)); }
    remove(keys){
      const ks = new Set(keys);
      this.items = this.items.filter(i => !ks.has(i.key));
      ks.forEach(k => {
        const c = this.cards.get(k);
        if (c) { this.observer.unobserve(c.el); c.el.remove(); this.cards.delete(k); }
        this.sel.delete(k);
      });
      this.refresh();
    }
    moveBy(k, d){
      const i = this.items.findIndex(x => x.key === k), j = i + d;
      if (i < 0 || j < 0 || j >= this.items.length) return;
      const [it] = this.items.splice(i, 1);
      this.items.splice(j, 0, it);
      const next = this.items[j + 1];
      this.el.insertBefore(this.cards.get(k).el, next ? this.cards.get(next.key).el : null);
      this.refresh();
    }
    syncFromDom(){
      const map = new Map(this.items.map(i => [i.key, i]));
      this.items = [...this.el.children].map(e => map.get(e.dataset.key)).filter(Boolean);
    }
    refresh(){
      this.items.forEach((it, idx) => {
        const c = this.cards.get(it.key); if (!c) return;
        const s = this.sel.has(it.key);
        c.el.classList.toggle("sel", s);
        if (this.opts.selectable) c.el.setAttribute("aria-checked", s ? "true" : "false");
        this.opts.label(it, idx, c.label);
        c.el.setAttribute("aria-label", c.label.textContent);
      });
      this.opts.onChange(this);
    }
    wireDrag(el, card){
      el.addEventListener("pointerdown", e => {
        if (e.button !== 0 || e.target.closest(".pdel")) return;
        const onHandle = !!e.target.closest(".pdrag");
        if (e.pointerType !== "mouse" && !onHandle) return; // touch: let the page scroll unless the handle is used
        if (onHandle) e.preventDefault();
        const sx = e.clientX, sy = e.clientY;
        let x = sx, y = sy, dragging = false, ghost = null, raf = 0, lastTgt = null, lastAfter = null;
        const place = () => {
          ghost.style.transform = "translate(" + (x - 44) + "px," + (y - 54) + "px)";
          const under = document.elementFromPoint(x, y);
          const tgt = under && under.closest(".pcard");
          if (!tgt || tgt === el || tgt.parentElement !== this.el) return;
          const r = tgt.getBoundingClientRect();
          const after = x > r.left + r.width / 2;
          if (tgt === lastTgt && after === lastAfter) return;
          lastTgt = tgt; lastAfter = after;
          const ref = after ? tgt.nextElementSibling : tgt;
          if (ref !== el) this.el.insertBefore(el, ref);
        };
        const tick = () => {
          if (!dragging) return;
          const edge = 70;
          if (y < edge) window.scrollBy(0, -14); else if (y > window.innerHeight - edge) window.scrollBy(0, 14);
          place();
          raf = requestAnimationFrame(tick);
        };
        const begin = () => {
          dragging = true;
          el.classList.add("dragging");
          ghost = document.createElement("div");
          ghost.className = "pghost";
          const g = document.createElement("canvas");
          g.width = card.canvas.width; g.height = card.canvas.height;
          if (g.width && g.height) g.getContext("2d").drawImage(card.canvas, 0, 0);
          g.style.width = card.canvas.style.width; g.style.height = card.canvas.style.height;
          ghost.appendChild(g);
          document.body.appendChild(ghost);
          raf = requestAnimationFrame(tick);
        };
        const move = ev => {
          x = ev.clientX; y = ev.clientY;
          if (!dragging && Math.hypot(x - sx, y - sy) > 6) begin();
          if (dragging) ev.preventDefault();
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          if (!dragging) return;
          dragging = false;
          cancelAnimationFrame(raf);
          ghost.remove();
          el.classList.remove("dragging");
          this.justDragged = true;
          setTimeout(() => { this.justDragged = false; }, 60);
          this.syncFromDom();
          this.refresh();
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      });
    }
  }


  // ---------- Minimal ZIP writer (stored, no compression: PDFs are already compressed) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf){ let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files){
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, p) => a + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  // ================= PAGES (organize, combine, rotate, extract) =================
  // One grid of the whole document: drag to reorder, select to rotate or delete, add other
  // files or photos to bring their pages in, extract a selection. Nothing is written until
  // Apply, which hands the result to the working document like every other tool.
  const FILE_COLORS = ["#E5A20F", "#2E6FD8", "#2F9E5B", "#C6423A", "#8A55C9", "#1C9AA0", "#D2691E", "#6B7A8F"];
  const ROT_TXT = { 90: "\u21bb 90\u00b0", 180: "180\u00b0", 270: "\u21ba 90\u00b0" };
  const pgs = { sources: [], seq: 0, base: null, busy: false, loaded: null };
  const pagesStatus = $("pages-status"), pagesGo = $("pages-go");

  function srcTag(s){
    const t = document.createElement("i");
    t.className = "ftag"; t.style.background = s.color; t.textContent = s.letter;
    return t;
  }
  const pagesGrid = new PageGrid($("pages-grid"), {
    selectable: true, draggable: true, removable: true,
    label: (it, idx, el) => {
      el.textContent = "";
      const s = pgs.sources.find(x => x.id === it.srcId);
      if (s && pgs.sources.length > 1) el.appendChild(srcTag(s));
      el.appendChild(document.createTextNode(" " + it.page));   // its page number in its own file
      if (it.rot) { const b = document.createElement("b"); b.textContent = " \u00b7 " + ROT_TXT[it.rot]; el.appendChild(b); }
    },
    onChange: () => pagesUi()
  });

  function pagesUi(){
    const n = pagesGrid.items.length, selN = pagesGrid.sel.size;
    const original = pgs.loaded ? pgs.loaded.pages : 0;
    const reordered = pagesGrid.items.some((it, i) => it.srcId !== (pgs.sources[0] || {}).id || it.page !== i + 1);
    const rotated = pagesGrid.items.filter(i => i.rot).length;
    const added = pgs.sources.length > 1;
    const changed = added || rotated > 0 || n !== original || reordered;
    ["pages-rot-left", "pages-rot-right", "pages-delete", "pages-extract", "pages-extract-each"].forEach(id => { $(id).disabled = selN === 0; });
    $("pages-info").textContent = n
      ? plural(n, "page") + (selN ? " \u00b7 " + selN + " selected" : "") + (rotated ? " \u00b7 " + rotated + " rotated" : "")
      : "No pages";
    pagesGo.disabled = pgs.busy || !changed || !n;
    pagesGo.textContent = changed ? "Apply changes" : "No changes yet";
  }

  async function pagesAddSource(info, isBase){
    const id = pgs.seq++;
    const doc = await openPdfJs(info.bytes);
    const src = { id, info, doc, letter: String.fromCharCode(65 + (id % 26)), color: FILE_COLORS[id % FILE_COLORS.length], name: info.file.name };
    pgs.sources.push(src);
    const items = [];
    for (let i = 1; i <= doc.numPages; i++) items.push({ key: "s" + id + "p" + i, srcId: id, doc, page: i, rot: 0 });
    if (isBase) pagesGrid.setItems(items); else pagesGrid.append(items);
    pagesUi();
  }

  function rotateSelected(delta){
    const touched = [];
    pagesGrid.items.forEach(it => {
      if (!pagesGrid.sel.has(it.key)) return;
      it.rot = (((it.rot || 0) + delta) % 360 + 360) % 360;
      touched.push(it.key);
    });
    pagesGrid.rerender(touched);   // thumbnails preview the rotation
    pagesGrid.refresh();
    pagesUi();
  }
  $("pages-rot-left").addEventListener("click", () => rotateSelected(-90));
  $("pages-rot-right").addEventListener("click", () => rotateSelected(90));
  $("pages-delete").addEventListener("click", () => {
    const keep = pagesGrid.items.filter(it => !pagesGrid.sel.has(it.key));
    pagesGrid.sel.clear();
    pagesGrid.setItems(keep);
    pagesUi();
  });
  $("pages-extract").addEventListener("click", () => {
    const keep = pagesGrid.items.filter(it => pagesGrid.sel.has(it.key));
    pagesGrid.sel.clear();
    pagesGrid.setItems(keep);
    pagesUi();
    setStatus(pagesStatus, "info", "Kept " + plural(keep.length, "page") + ". Apply to make that the document, or undo by choosing the file again.");
  });
  $("pages-select-all").addEventListener("click", () => {
    const all = pagesGrid.sel.size === pagesGrid.items.length;
    pagesGrid.sel.clear();
    if (!all) pagesGrid.items.forEach(it => pagesGrid.sel.add(it.key));
    pagesGrid.refresh(); pagesUi();
  });

  async function buildPagesDoc(items){
    const out = await PDFDocument.create();
    const bySrc = new Map();
    for (const it of items) {
      const src = pgs.sources.find(s => s.id === it.srcId);
      if (!bySrc.has(it.srcId)) bySrc.set(it.srcId, await loadPdf(src.info.bytes.slice(0), src.info.file.name));
    }
    for (const it of items) {
      const [copied] = await out.copyPages(bySrc.get(it.srcId), [it.page - 1]);
      if (it.rot) copied.setRotation(degrees(((copied.getRotation().angle + it.rot) % 360 + 360) % 360));
      out.addPage(copied);
    }
    return out;
  }

  pagesGo.addEventListener("click", async () => {
    if (!pagesGrid.items.length) return;
    pgs.busy = true; pagesUi();
    setStatus(pagesStatus, "info", "Applying\u2026");
    try {
      const out = await buildPagesDoc(pagesGrid.items);
      const label = [];
      if (pgs.sources.length > 1) label.push("combined " + pgs.sources.length + " files");
      if (pagesGrid.items.some(i => i.rot)) label.push("rotated pages");
      if (pgs.loaded && pagesGrid.items.length !== pgs.loaded.pages) label.push(plural(pagesGrid.items.length, "page") + " kept");
      await applyResult(await saveDoc(out), label.join(", ") || "reordered pages");
      setStatus(pagesStatus, "success", "Applied. The document is now " + plural(pagesGrid.items.length, "page") + " \u2014 use Download when you're finished.");
    } catch (err) {
      setStatus(pagesStatus, "error", err.message || "Couldn't apply those changes.");
    } finally { pgs.busy = false; pagesUi(); }
  });

  $("pages-extract-each").addEventListener("click", async () => {
    const sel = pagesGrid.items.filter(it => pagesGrid.sel.has(it.key));
    if (!sel.length) return;
    pgs.busy = true; pagesUi();
    setStatus(pagesStatus, "info", "Building the .zip\u2026");
    try {
      const files = [];
      for (let i = 0; i < sel.length; i++) {
        const one = await buildPagesDoc([sel[i]]);
        files.push({ name: (pgs.base || "pages") + "_p" + (i + 1) + ".pdf", data: await saveDoc(one) });
      }
      await saveFile((pgs.base || "pages") + "_pages.zip", makeZip(files));
      setStatus(pagesStatus, "success", "Saved " + plural(files.length, "file") + " in " + (pgs.base || "pages") + "_pages.zip. The document here is unchanged.");
    } catch (err) {
      setStatus(pagesStatus, "error", err.message || "Couldn't build the .zip.");
    } finally { pgs.busy = false; pagesUi(); }
  });

  // add other PDFs or photos
  wireDropzone("pages-add-dz", "pages-add-input", async files => {
    clearStatus(pagesStatus);
    for (const f of files) {
      try { await pagesAddSource(isImageFile(f) ? await prepareImage(f) : await prepare(f)); }
      catch (err) { setStatus(pagesStatus, "error", err.message); }
    }
  });

  wireSingle("pages", {
    info: () => pgs.loaded,
    status: pagesStatus,
    load: async info => tools.pages.load(info)
  });
  tools.pages = {
    info: () => pgs.loaded,
    status: pagesStatus,
    load: async info => {
      pgs.sources.forEach(s => s.doc.destroy().catch(() => {}));
      pgs.sources = []; pgs.seq = 0;
      pagesGrid.sel.clear();
      pgs.loaded = info;
      pgs.base = baseName(info.file.name);
      $("pages-name").textContent = info.file.name;
      $("pages-work").hidden = false;
      clearStatus(pagesStatus);
      await pagesAddSource(info, true);
    }
  };

  // ---------- Signature: type it, upload it, save it ----------
  // The signature is just an image the Document workspace places like any other, so this
  // section only builds and remembers it; placement, moving and resizing are the page tools.
  const sg = { sig: null, sigUrl: null, sigAspect: 1 };
  const stampStatus = $("edit-status");
  function updateSignUi(){
    $("sig-current").hidden = !sg.sig;
    $("sig-tool").classList.toggle("has-sig", !!sg.sig);
  }
  const SIG_KEY = "pdf-tool-kit:signature";
  const SIG_STYLES = [
    { family: "Sig Vibes", label: "Elegant" },
    { family: "Sig Dancing", label: "Flowing" },
    { family: "Sig Allura", label: "Classic" },
    { family: "Sig Apple", label: "Handwritten" }
  ];
  const sigUi = { style: 0, ink: "#141414" };

  function canvasToBlob(c){ return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Couldn't create the image.")), "image/png")); }
  function blobToDataUrl(b){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
  function loadImage(url){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That image couldn't be read.")); i.src = url; }); }

  // Crop to the inked area so the stamp has no dead space around it.
  function trimCanvas(c, pad){
    const ctx = c.getContext("2d");
    const { width: w, height: h } = c;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  async function makeTypedSignature(name, family, ink){
    await fontsReady;
    const size = 140;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = size + "px \"" + family + "\", cursive";
    const w = Math.ceil(ctx.measureText(name).width);
    c.width = Math.min(w + size * 2, 4000);
    c.height = Math.round(size * 2.4);
    ctx.font = size + "px \"" + family + "\", cursive";
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(name, size, Math.round(size * 1.45));
    const t = trimCanvas(c, 10);
    if (!t) throw new Error("Type a name first.");
    return canvasToBlob(t);
  }

  // Every signature is redrawn onto a fresh canvas and saved as PNG. That strips any
  // metadata from uploaded images and means only plain pixels ever reach the PDF.
  async function normalizeImage(blob){
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const scale = Math.min(1, 1600 / img.naturalWidth, 800 / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return canvasToBlob(c);
    } finally { URL.revokeObjectURL(url); }
  }

  async function setSignature(pngBlob, note){
    const url = URL.createObjectURL(pngBlob);
    const img = await loadImage(url);
    if (sg.sigUrl) URL.revokeObjectURL(sg.sigUrl);
    sg.sig = { blob: pngBlob };
    sg.sigUrl = url;
    sg.sigAspect = img.naturalHeight / img.naturalWidth;
    $("sig-current-img").src = url;
    $("sig-remember").disabled = false;
    $("sig-remember").textContent = "Save on this device";
    updateSignUi();
    if (ed.view) { armSignature(); setStatus(stampStatus, "info", note || "Tap the page where the signature should go."); }
    else setStatus(stampStatus, "info", note || "Open a PDF, then tap the page to place it.");
  }

  function readSaved(){
    try {
      const raw = localStorage.getItem(SIG_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      // Only accept what this tool itself writes: a PNG data URL of sane size.
      if (!v || typeof v.png !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.png) || v.png.length > 3000000) return null;
      return v;
    } catch (e) { return null; }
  }
  function savedToBlob(v){ return new Blob([b64ToBytes(v.png.split(",")[1])], { type: "image/png" }); }
  function refreshSaved(){
    const v = readSaved();
    $("sig-saved").hidden = !v;
    // Also offered on the empty screen, so a saved signature can be cleared on a shared
    // computer without opening a document first.
    $("empty-saved-sig").hidden = !v;
    if (v) { $("sig-saved-img").src = v.png; $("empty-saved-img").src = v.png; }
  }
  $("empty-sig-forget").addEventListener("click", () => {
    try { localStorage.removeItem(SIG_KEY); } catch (e) {}
    refreshSaved();
    setStatus($("doc-status"), "success", "Removed the saved signature from this browser.");
  });

  // Style picker
  const stylesEl = $("sig-styles");
  const nameIn = $("sig-name");
  SIG_STYLES.forEach((st, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stylebtn" + (i === 0 ? " active" : "");
    b.style.fontFamily = "\"" + st.family + "\", cursive";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", i === 0 ? "true" : "false");
    b.setAttribute("aria-label", st.label + " style");
    b.textContent = st.label;
    b.addEventListener("click", () => {
      sigUi.style = i;
      stylesEl.querySelectorAll(".stylebtn").forEach((o, j) => { o.classList.toggle("active", j === i); o.setAttribute("aria-checked", j === i ? "true" : "false"); });
    });
    stylesEl.appendChild(b);
  });
  function updatePreviews(){
    const t = nameIn.value.trim();
    stylesEl.querySelectorAll(".stylebtn").forEach((b, i) => { b.textContent = t || SIG_STYLES[i].label; b.style.color = sigUi.ink; });
    $("sig-make").disabled = !t;
  }
  nameIn.addEventListener("input", updatePreviews);
  document.querySelectorAll("#sigbox .ink").forEach(b => b.addEventListener("click", () => {
    sigUi.ink = b.dataset.ink;
    document.querySelectorAll("#sigbox .ink").forEach(o => o.classList.toggle("active", o === b));
    updatePreviews();
  }));
  // scoped to the signature box: other panels have their own segmented controls
  document.querySelectorAll("#sigbox .segbtn").forEach(b => b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    document.querySelectorAll("#sigbox .segbtn").forEach(o => { o.classList.toggle("active", o === b); o.setAttribute("aria-selected", o === b ? "true" : "false"); });
    $("sig-type-pane").hidden = mode !== "type";
    $("sig-upload-pane").hidden = mode !== "upload";
  }));

  $("sig-make").addEventListener("click", async () => {
    try { await setSignature(await makeTypedSignature(nameIn.value.trim(), SIG_STYLES[sigUi.style].family, sigUi.ink)); }
    catch (err) { setStatus(stampStatus, "error", err.message); }
  });

  wireDropzone("stamp-sig-dz", "stamp-sig-input", async files => {
    const f = files[0];
    clearStatus(stampStatus);
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setStatus(stampStatus, "error", "Choose a PNG or JPG image."); return; }
    if (f.size > 15 * 1024 * 1024) { setStatus(stampStatus, "error", "That image is too large. Use one under 15 MB."); return; }
    try { await setSignature(await normalizeImage(f)); }
    catch (err) { setStatus(stampStatus, "error", err.message || "That image couldn't be read."); }
  });

  $("sig-download").addEventListener("click", async () => {
    if (!sg.sig) return;
    try { await saveFile("signature.png", sg.sig.blob, "image/png"); setStatus(stampStatus, "success", "Saved signature.png. Next time, use Upload image to load it."); }
    catch (err) { setStatus(stampStatus, "error", err.message); }
  });

  $("sig-remember").addEventListener("click", async () => {
    if (!sg.sig) return;
    try {
      const png = await blobToDataUrl(sg.sig.blob);
      localStorage.setItem(SIG_KEY, JSON.stringify({ png, savedAt: Date.now() }));
      refreshSaved();
      $("sig-remember").disabled = true;
      $("sig-remember").textContent = "Saved";
      setStatus(stampStatus, "success", "Saved in this browser. It will be ready next time. On a shared computer, use Forget when you're done.");
    } catch (e) {
      setStatus(stampStatus, "error", "This browser won't let the tool save it. Use Download PNG instead.");
    }
  });

  $("sig-use-saved").addEventListener("click", async () => {
    const v = readSaved();
    if (!v) { refreshSaved(); return; }
    try { await setSignature(savedToBlob(v)); } catch (err) { setStatus(stampStatus, "error", err.message); }
  });

  $("sig-forget").addEventListener("click", () => {
    try { localStorage.removeItem(SIG_KEY); } catch (e) {}
    refreshSaved();
    $("sig-remember").disabled = !sg.sig;
    $("sig-remember").textContent = "Save on this device";
    setStatus(stampStatus, "info", "Removed the saved signature from this browser.");
    updateSignUi();
  });

  refreshSaved();
  fontsReady.then(updatePreviews);

  // ================= EDIT (add to page + fill forms) =================
  // Objects are stored in display points (page as viewed, rotation applied, 1pt = 1 unit)
  // and mapped to PDF space with the renderer's own viewport at save time, like signatures.
  // Text uses Helvetica in the PDF and Liberation Sans on screen. They share metrics, and line
  // breaks are computed once with Helvetica's widths, so what you see is what gets saved.
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, StandardFonts, rgb, BlendMode, LineCapStyle, PDFName } = PDFLib;
  const TPAD = 2, LINE = 1.2;
  const BASELINE = (LINE - 1.117) / 2 + 0.905; // baseline offset within a line box, in ems
  // How willingly pieces of text are joined. Tight keeps columns and labels apart on a
  // dense layout; loose pulls a paragraph together on a document that scatters its text.
  // Normal is what the measurements supported: word gaps run to about 0.3 em, the gap to
  // the next table column starts around 1.7 em.
  const GROUPING = [
    { name: "Tight",  join: 0.45, lead: 0.55, overlap: 0.70 },
    { name: "Normal", join: 0.80, lead: 0.75, overlap: 0.55 },
    { name: "Loose",  join: 1.30, lead: 1.10, overlap: 0.35 },
    { name: "Loosest", join: 1.60, lead: 1.60, overlap: 0.20 }
  ];
  function grouping(){ return GROUPING[ed.grouping != null ? ed.grouping : 1] || GROUPING[1]; }
  const INKS = { "#141414": "Black", "#1B3A8C": "Blue", "#B3261E": "Red" };
  // the same inks as PDF colour values, for text written as operators
  const INKS_RGB = { "#141414": [0.078, 0.078, 0.078], "#1B3A8C": [0.106, 0.227, 0.549], "#B3261E": [0.702, 0.149, 0.118] };
  const eStage = $("estage"), eCanvas = $("estage-canvas"), eLayer = $("eolayer");
  const editStatus = $("edit-status"), editGo = $("edit-go");

  const ed = {
    info: null, view: null, pageCount: 0, page: 0, mode: "annotate", tool: null,
    objs: [], seq: 0, sel: null, dims: {}, scale: 1,
    fields: [], fsel: -1, renderToken: 0, loadToken: 0, renderTask: null, needsRender: false, busy: false,
    runs: [], blocks: [], tsel: null, typing: null, textEdits: new Map(), vp: null, redactions: [], grouping: null,
    lockedSel: null, lockedAlso: [], showAll: null, editObj: null, focusEdit: false, lastPress: null,
    pendingImage: null
  };
  // The built-in faces a text box can be set in, loaded once so lines can be measured (wrapped,
  // aligned, sized) in the face that will actually be written, not always in Helvetica.
  const STD_FONT_NAMES = ["Helvetica", "Helvetica-Bold", "Times-Roman", "Times-Bold", "Courier"];
  const stdFonts = {};
  const stdFontsReady = (async () => { const d = await PDFDocument.create(); for (const n of STD_FONT_NAMES) stdFonts[n] = await d.embedFont(n); })();
  const helvReady = (async () => { const d = await PDFDocument.create(); return d.embedFont(StandardFonts.Helvetica); })();
  let helv = null;
  helvReady.then(f => { helv = f; });

  // Replace characters Helvetica can't encode (emoji, most non-Latin scripts) with "?".
  const encOk = new Map();
  function cleanText(s){
    let bad = false;
    const out = Array.from(String(s).replace(/\r\n?/g, "\n").replace(/\t/g, "    ")).map(ch => {
      if (ch === "\n") return ch;
      let ok = encOk.get(ch);
      if (ok === undefined) {
        // pdf-lib throws on characters Helvetica lacks; the maintained fork substitutes "?" (0x3F).
        try { ok = ch === "?" || helv.encodeText(ch).toString() !== "<3F>"; } catch (e) { ok = false; }
        encOk.set(ch, ok);
      }
      if (!ok) { bad = true; return "?"; }
      return ch;
    }).join("");
    return { text: out, bad };
  }
  function hexRgb(h){ const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
  function todayText(){ const d = new Date(); return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear(); }

  // How far in from the left a line of a text box starts, for its alignment: the spare width inside
  // the padding, times 0 (left), a half (centre) or all of it (right).
  function boxAlignShift(o, line, docFont, font){
    const f = o.align === "center" ? 0.5 : o.align === "right" ? 1 : 0;
    if (!f) return 0;
    let w;
    try { w = docFont && docFont.usable ? widthWithDocFont(docFont, line, o.size) : (font || helv).widthOfTextAtSize(line, o.size); } catch (err) { w = helv.widthOfTextAtSize(line, o.size); }
    return f * Math.max(0, o.w - 2 * TPAD - w);
  }
  // How wide a string is in the face this box will be written in: the document's own font where
  // that was chosen, otherwise the built-in face it names.
  function objMeasure(o){
    if (o.docFont && o.docFont.usable) return (t, sz) => { try { return widthWithDocFont(o.docFont, t, sz); } catch (err) { return helv.widthOfTextAtSize(t, sz); } };
    const f = stdFonts[o.fontKey] || helv;
    return (t, sz) => f.widthOfTextAtSize(t, sz);
  }
  function layoutText(o){
    const size = o.size, lineH = size * LINE;
    const W = ed.dims[o.page].W;
    const measure = objMeasure(o);
    const width = s => measure(s, size);
    const paras = o.text.split("\n");
    if (o.autoW) o.w = Math.min(Math.max(size, ...paras.map(width)) + 2 * TPAD + 1, W - o.x);
    o.w = Math.max(o.w, size + 2 * TPAD);
    const maxW = o.w - 2 * TPAD;
    const lines = [];
    for (const p of paras) {
      let line = "";
      for (const word of p.split(" ")) {
        const cand = line ? line + " " + word : word;
        if (width(cand) <= maxW || !line && !word) { line = cand; continue; }
        if (line) lines.push(line);
        if (width(word) <= maxW) { line = word; continue; }
        let chunk = "";
        for (const ch of word) {
          if (chunk && width(chunk + ch) > maxW) { lines.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      }
      lines.push(line);
    }
    o.lines = lines;
    o.h = 2 * TPAD + lines.length * lineH;
  }

  // ---------- Rendering the page, objects, and form fields ----------
  async function editRender(){
    if (!ed.view) return;
    // Fit the whole page on screen by default (width and height), so nothing needs
    // scrolling to reach; zoom goes bigger from there.
    const availW = Math.min(eStage.parentElement.clientWidth - 16, 1100);
    const topOffset = eStage.parentElement.getBoundingClientRect().top;
    const availH = Math.max(320, window.innerHeight - Math.max(0, topOffset) - 28);
    if (availW <= 0) { ed.needsRender = true; return; }
    ed.needsRender = false;
    const token = ++ed.renderToken;
    if (ed.renderTask) { try { ed.renderTask.cancel(); } catch (e) {} }
    const page = await ed.view.getPage(ed.page + 1);
    if (token !== ed.renderToken) return;
    const base = page.getViewport({ scale: 1 });
    ed.dims[ed.page] = { W: base.width, H: base.height };
    // "Page" fits the whole sheet on screen; "Width" fills the column and scrolls.
    const fitW = ed.fitWidth ? availW : Math.min(availW, base.width * (availH / base.height));
    const cssW = Math.max(220, fitW * (ed.zoom || 1));
    ed.scale = cssW / base.width;
    const vp = page.getViewport({ scale: ed.scale * dpr() });
    ed.vp = page.getViewport({ scale: ed.scale });
    eCanvas.width = Math.floor(vp.width);
    eCanvas.height = Math.floor(vp.height);
    eStage.style.width = cssW + "px";
    eStage.style.height = Math.round(base.height * ed.scale) + "px";
    // Form widgets are drawn by our own overlay so their current values show.
    ed.renderTask = page.render({ canvasContext: eCanvas.getContext("2d"), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS });
    try { await ed.renderTask.promise; }
    catch (e) { if (e && e.name === "RenderingCancelledException") return; throw e; }
    if (token !== ed.renderToken) return;
    // Field rectangles for this page, in display points.
    ed.fields.forEach(f => f.widgets.forEach(w => {
      if (w.page !== ed.page || w.box) return;
      const r = base.convertToViewportRectangle(w.rect);
      w.box = { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
    }));
    drawLayer();
    editUi();
    ensurePjsFonts(ed.page).then(found => { if (found && token === ed.renderToken) drawLayer(); });
  }

  // pdf.js loads every font the page uses into the browser under its own name (g_d0_f1 ...), even
  // a stand-in for one that is not embedded. Matching those to the fonts we describe (by base name)
  // lets typed text be shown in exactly the face the page itself is drawn with.
  const normFont = n => String(n || "").replace(/^[A-Z]{6}\+/, "").replace(/[\s_-]/g, "").toLowerCase();
  async function ensurePjsFonts(pageIndex){
    ed.pjsFonts = ed.pjsFonts || new Map();
    if (ed.pjsFonts.has(pageIndex) || !ed.view) return false;
    const map = new Map();
    ed.pjsFonts.set(pageIndex, map);
    try {
      const page = await ed.view.getPage(pageIndex + 1);
      const ops = await page.getOperatorList();
      const SET = pdfjs.OPS && pdfjs.OPS.setFont;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== SET) continue;
        const id = ops.argsArray[i][0];
        let f = null;
        try { f = page.commonObjs.has(id) ? page.commonObjs.get(id) : null; } catch (err) { f = null; }
        if (f && f.loadedName && f.name && !map.has(normFont(f.name))) map.set(normFont(f.name), f.loadedName);
      }
    } catch (err) { /* the bundled faces still work */ }
    return map.size > 0;
  }
  function pjsFamilyFor(baseFont, pageIndex){
    const m = ed.pjsFonts && ed.pjsFonts.get(pageIndex == null ? ed.page : pageIndex);
    if (!m || !baseFont) return null;
    const k = normFont(baseFont);
    if (m.has(k)) return m.get(k);
    for (const [key, v] of m) if (key.startsWith(k) || k.startsWith(key)) return v;
    return null;
  }
  const genericFor = n => /times|serif|georgia|garamond|minion|palatino|cambria/i.test(n) && !/sans/i.test(n) ? "serif" : /courier|mono|consolas|typewriter/i.test(n) ? "monospace" : "sans-serif";
  // The CSS font for text in a given face. A "doc" face comes from the page itself.
  function cssFontFor(fontKey, docInfo, px, lineHpx){
    const k = fontKey || "Helvetica";
    if (docInfo && docInfo.baseFont) {
      const fam = pjsFamilyFor(docInfo.baseFont);
      if (fam) return "normal normal " + px + "px/" + lineHpx + "px \"" + fam + "\", " + genericFor(docInfo.baseFont);
    }
    const bold = /Bold/i.test(k) || (docInfo && /bold|black|heavy/i.test(docInfo.baseFont || ""));
    const ital = docInfo && /italic|oblique/i.test(docInfo.baseFont || "");
    const w = (ital ? "italic " : "normal ") + (bold ? "bold " : "normal ");
    if (/^Times/i.test(k) || (docInfo && genericFor(docInfo.baseFont) === "serif")) return w + px + "px/" + lineHpx + "px \"Times New Roman\", Times, \"Liberation Serif\", serif";
    if (/^Courier/i.test(k) || (docInfo && genericFor(docInfo.baseFont) === "monospace")) return w + px + "px/" + lineHpx + "px \"Courier New\", Courier, \"Liberation Mono\", monospace";
    return w + px + "px/" + lineHpx + "px \"Std Sans\", Arial, Helvetica, sans-serif";
  }
  const objCssFont = (o, s) => cssFontFor(o.fontKey, o.docFont && o.docFont.usable ? o.docFont : null, o.size * s, o.size * LINE * s);

  const CHECK_PATH = "M15 55 L40 80 L88 20", CROSS_PATH = "M20 20 L80 80 M80 20 L20 80";
  function svgMark(path, color){
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", path); p.setAttribute("fill", "none"); p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", "12"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
  }

  function drawLayer(){
    eLayer.innerHTML = "";
    if (ed.editObj !== null && ed.editObj !== ed.sel) ed.editObj = null;       // typing ends when the selection moves on
    dropEmptyBoxes();
    drawFindMarks();
    if (ed.mode === "doc") { drawDocMarksPreview(); return; }
    if (ed.mode === "text") { drawTextOverlays(); return; }
    if (ed.mode === "redact") { drawRedactions(); return; }
    const s = ed.scale;
    // form fields first, so page objects sit on top
    ed.fields.forEach((f, fi) => f.widgets.forEach(w => {
      if (w.page !== ed.page || !w.box) return;
      const el = document.createElement("div");
      el.className = "ffield" + (fi === ed.fsel ? " cur" : "") + (f.readOnly ? " ro" : "");
      Object.assign(el.style, { left: w.box.x * s + "px", top: w.box.y * s + "px", width: w.box.w * s + "px", height: w.box.h * s + "px" });
      const fs = Math.max(6, Math.min(w.box.h * 0.72, 12) * s);
      el.style.fontSize = fs + "px";
      let shown = "";
      if (f.type === "text") { shown = f.value; if (f.multiline) { el.classList.add("multi"); } }
      else if (f.type === "check") { shown = f.value ? "\u2713" : ""; el.classList.add("center"); el.style.fontSize = Math.min(w.box.h, w.box.w) * 0.85 * s + "px"; }
      else if (f.type === "radio") { shown = f.value != null && f.value === f.options[w.wi] ? "\u25cf" : ""; el.classList.add("center"); el.style.fontSize = Math.min(w.box.h, w.box.w) * 0.7 * s + "px"; }
      else if (f.type === "dropdown") shown = f.value || "";
      else if (f.type === "list") shown = (f.value || []).join(", ");
      el.textContent = shown;
      el.title = f.label;
      el.addEventListener("click", e => {
        e.stopPropagation();
        if (ed.mode !== "form") return;
        if (!f.readOnly && f.type === "check") f.value = !f.value;
        if (!f.readOnly && f.type === "radio" && f.options[w.wi] != null) f.value = f.options[w.wi];
        selectField(fi, true);
      });
      eLayer.appendChild(el);
    }));

    let focusAfterDraw = null;
    ed.objs.filter(o => o.page === ed.page).forEach(o => {
      const el = document.createElement("div");
      el.className = "eobj t-" + o.type + (o.id === ed.sel ? " sel" : "");
      Object.assign(el.style, { left: o.x * s + "px", top: o.y * s + "px", width: o.w * s + "px", height: o.h * s + "px" });
      if (o.type === "text") {
        el.style.padding = TPAD * s + "px";
        el.style.color = o.color;
        const empty = !o.text.trim();
        if (empty) el.classList.add("empty");
        el.title = ed.editObj === o.id ? "" : "Double-click, or press Enter, to type";
        if (ed.editObj === o.id) {
          // typed on the page: one editable block, wrapped by the browser at the box's width
          const d = document.createElement("div");
          d.className = "tedit" + (o.autoW ? "" : " wrap");
          d.style.font = objCssFont(o, s);
          d.style.textAlign = o.align || "left";
          d.dataset.ph = "Type here";
          d.contentEditable = PLAINTEXT ? "plaintext-only" : "true";
          d.spellcheck = false;
          d.setAttribute("role", "textbox"); d.setAttribute("aria-label", "Text");
          d.textContent = o.raw;
          wireTextEdit(d, o);
          el.appendChild(d);
          if (ed.focusEdit) { ed.focusEdit = false; focusAfterDraw = d; }
        } else o.lines.forEach(l => {
          const d = document.createElement("div");
          d.className = "tl";
          d.style.font = objCssFont(o, s);
          d.textContent = l || "\u200b";
          d.style.textAlign = o.align || "left";
          el.appendChild(d);
        });
      } else if (o.type === "check" || o.type === "cross") {
        el.appendChild(svgMark(o.type === "check" ? CHECK_PATH : CROSS_PATH, o.color));
      } else if (o.type === "box") {
        el.style.border = 1.5 * s + "px solid " + o.color;
      } else if (o.type === "image") {
        const img = document.createElement("img"); img.src = o.url; img.alt = ""; img.draggable = false;
        el.appendChild(img);
      }
      const x = document.createElement("button");
      x.className = "ex"; x.type = "button"; x.textContent = "\u2715"; x.setAttribute("aria-label", "Delete");
      x.addEventListener("pointerdown", e => e.stopPropagation());
      x.addEventListener("click", e => { e.stopPropagation(); deleteObj(o.id); });
      const h = document.createElement("span"); h.className = "eh"; h.setAttribute("aria-hidden", "true");
      el.append(x, h);
      wireObj(el, h, o);
      eLayer.appendChild(el);
    });
    if (focusAfterDraw) caretToEnd(focusAfterDraw);       // a box that was just created or double-clicked takes the typing
  }

  // ---------- Object interaction ----------
  function clampObj(o){
    const d = ed.dims[o.page];
    o.w = Math.min(o.w, d.W); o.h = Math.min(o.h, d.H);
    o.x = Math.min(Math.max(0, o.x), d.W - o.w);
    o.y = Math.min(Math.max(0, o.y), d.H - o.h);
  }
  function wireObj(el, handle, o){
    el.addEventListener("click", e => e.stopPropagation());
    el.addEventListener("dblclick", e => { e.stopPropagation(); if (o.type === "text" && ed.editObj !== o.id) startObjEdit(o.id); });
    el.addEventListener("pointerdown", e => {
      if (ed.mode !== "annotate" || e.button !== 0) return;
      if (e.target.closest && e.target.closest(".tedit")) return;           // inside the text being typed: the caret's business
      e.preventDefault(); e.stopPropagation();
      // selecting redraws the box, so the browser's own double-click count does not survive:
      // a second press on the selected text box, soon after the first, is tracked here instead
      const now = Date.now(), again = o.type === "text" && ed.sel === o.id && ed.lastPress && ed.lastPress.id === o.id && now - ed.lastPress.t < 450 && e.target !== handle;
      ed.lastPress = { id: o.id, t: now };
      if (again) { ed.lastPress = null; startObjEdit(o.id); return; }
      const resizing = e.target === handle;
      if (ed.sel !== o.id) { ed.sel = o.id; ed.tool = null; drawLayer(); editUi(); }
      const target = eLayer.querySelector(".eobj.sel") || el;
      const sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y, ow = o.w, oh = o.h;
      const s = ed.scale;
      const move = ev => {
        const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
        if (resizing) {
          if (o.type === "text") { o.autoW = false; o.w = Math.max(o.size + 2 * TPAD, ow + dx); o.w = Math.min(o.w, ed.dims[o.page].W - o.x); layoutText(o); }
          else if (o.type === "check" || o.type === "cross" || o.type === "image") { const a = oh / ow; o.w = Math.max(8, ow + dx); o.h = o.w * a; }
          else { o.w = Math.max(8, ow + dx); o.h = Math.max(6, oh + dy); }
        } else { o.x = ox + dx; o.y = oy + dy; }
        clampObj(o);
        if (resizing && o.type === "text") { drawLayer(); return; }
        Object.assign(target.style, { left: o.x * s + "px", top: o.y * s + "px", width: o.w * s + "px", height: o.h * s + "px" });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (o.type === "text" && o.autoW) layoutText(o);
        drawLayer();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }
  function deleteObj(id){
    const o = ed.objs.find(x => x.id === id);
    if (o && o.type === "image" && !ed.objs.some(x => x !== o && x.url === o.url)) URL.revokeObjectURL(o.url);
    ed.objs = ed.objs.filter(x => x.id !== id);
    if (ed.sel === id) ed.sel = null;
    drawLayer(); editUi();
  }

  function createObj(type, cx, cy){
    const d = ed.dims[ed.page];
    const o = { id: ed.seq++, page: ed.page, type, color: "#141414", x: 0, y: 0, w: 0, h: 0 };
    if (type === "text" || type === "date") {
      o.type = "text"; o.size = 12; o.autoW = true;
      o.raw = type === "date" ? todayText() : ""; o.text = o.raw;
      o.x = cx - TPAD; o.y = cy - (o.size * LINE) / 2 - TPAD;
      layoutText(o);
    } else if (type === "check" || type === "cross") { o.w = o.h = 16; o.x = cx - 8; o.y = cy - 8; }
    else if (type === "hl") { o.w = 140; o.h = 16; o.x = cx - 70; o.y = cy - 8; }
    else if (type === "box") { o.w = 120; o.h = 60; o.x = cx - 60; o.y = cy - 30; }
    else if (type === "white") { o.w = 120; o.h = 24; o.x = cx - 60; o.y = cy - 12; }
    else if (type === "image") {
      const img = ed.pendingImage; ed.pendingImage = null;
      o.url = img.url; o.blob = img.blob;
      o.w = Math.min(160, d.W * 0.4); o.h = o.w * img.aspect;
      o.x = cx - o.w / 2; o.y = cy - o.h / 2;
    }
    clampObj(o);
    if (o.type === "text") layoutText(o);
    ed.objs.push(o);
    ed.sel = o.id;
    ed.tool = null;
    ed.editObj = o.type === "text" ? o.id : null; ed.focusEdit = o.type === "text";
    drawLayer(); editUi();
  }

  // drag a rectangle over what must go
  // The viewport already carries the zoom, so its own conversion does the scaling: the
  // pointer offsets must be handed over as they are, not divided first.
  function stagePoint(ev, rect){ return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }; }
  function toPdfRect(a, b){
    const p1 = ed.vp.convertToPdfPoint(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const p2 = ed.vp.convertToPdfPoint(Math.max(a.x, b.x), Math.max(a.y, b.y));
    return { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
             w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) };
  }
  eStage.addEventListener("pointerdown", e => {
    if (!ed.view || ed.mode !== "redact" || e.button > 0) return;
    if (e.target.closest && e.target.closest(".redbox")) return;   // moving or removing one
    const rect = eStage.getBoundingClientRect();
    const start = stagePoint(e, rect);
    const box = document.createElement("div");
    box.className = "redbox drawing";
    eLayer.appendChild(box);
    const draw = m => {
      const cur = stagePoint(m, rect);
      box.style.left = Math.min(start.x, cur.x) + "px";
      box.style.top = Math.min(start.y, cur.y) + "px";
      box.style.width = Math.abs(cur.x - start.x) + "px";
      box.style.height = Math.abs(cur.y - start.y) + "px";
    };
    const done = m => {
      window.removeEventListener("pointermove", draw);
      window.removeEventListener("pointerup", done);
      const cur = stagePoint(m, rect);
      if (Math.abs(cur.x - start.x) < 4 || Math.abs(cur.y - start.y) < 4) { drawLayer(); return; }
      const r = toPdfRect(start, cur);
      r.page = ed.page;
      ed.redactions.push(r);
      drawLayer(); editUi();
    };
    window.addEventListener("pointermove", draw);
    window.addEventListener("pointerup", done);
    e.preventDefault();
  });

  eStage.addEventListener("click", e => {
    if (!ed.view) return;
    if (ed.mode === "redact") return;
    if (ed.mode === "form") { ed.fsel = -1; drawLayer(); editUi(); return; }
    if (!ed.tool) { if (ed.sel !== null) { ed.sel = null; drawLayer(); editUi(); } return; }
    const r = eStage.getBoundingClientRect();
    createObj(ed.tool, (e.clientX - r.left) / ed.scale, (e.clientY - r.top) / ed.scale);
  });

  // ---------- Toolbar, properties, form panel ----------
  const TOOL_HINTS = {
    text: "Tap where the text should start.", date: "Tap where the date should go.",
    check: "Tap to place a checkmark.", cross: "Tap to place an X.",
    hl: "Tap over the text to highlight, then drag the corner to fit.",
    box: "Tap to place a box, then drag the corner to size it.",
    white: "Tap to place a white box. It only covers the content visually: the text underneath can still be copied, so never use it to hide private information.",
    image: "Tap where the image should go."
  };
  document.querySelectorAll("#annot-tools .tool[data-tool]:not(#sig-tool)").forEach(b => b.addEventListener("click", () => {
    if (!ed.view) return;
    ed.tool = ed.tool === b.dataset.tool ? null : b.dataset.tool;
    ed.sel = null;
    if (ed.pendingImage) URL.revokeObjectURL(ed.pendingImage.url);
    ed.pendingImage = null;          // drop an armed signature or image
    $("sigbox").hidden = true;       // and put the signature panel away
    drawLayer(); editUi();
  }));
  // The Signature tool arms the same placement path as an image: build one if needed,
  // otherwise tap the page to drop it.
  function armSignature(){
    if (!sg.sig || !ed.view) return;
    // Its own URL, not the signature panel's: replacing the signature revokes that one,
    // which would break the preview of anything already placed on the page.
    if (ed.pendingImage) URL.revokeObjectURL(ed.pendingImage.url);
    ed.pendingImage = { blob: sg.sig.blob, url: URL.createObjectURL(sg.sig.blob), aspect: sg.sigAspect, isSignature: true };
    ed.tool = "image"; ed.sel = null;
    $("sigbox").hidden = false;   // keep it visible: it shows which signature is in use
    drawLayer(); editUi();
  }
  $("sig-tool").addEventListener("click", () => {
    const armed = ed.tool === "image" && ed.pendingImage && ed.pendingImage.isSignature;
    if (armed) { URL.revokeObjectURL(ed.pendingImage.url); ed.tool = null; ed.pendingImage = null; $("sigbox").hidden = true; drawLayer(); editUi(); return; }
    if (sg.sig) { armSignature(); return; }
    $("sigbox").hidden = !$("sigbox").hidden;
    editUi();   // the properties column has to open for the signature box to be visible
    if (!$("sigbox").hidden) { $("sig-name").focus({ preventScroll: true }); $("sigbox").scrollIntoView({ block: "nearest" }); }
  });

  $("edit-img-input").addEventListener("change", async () => {
    $("sigbox").hidden = true;
    const f = $("edit-img-input").files[0];
    $("edit-img-input").value = "";
    if (!f || !ed.view) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setStatus(editStatus, "error", "Choose a PNG or JPG image."); return; }
    if (f.size > 15 * 1024 * 1024) { setStatus(editStatus, "error", "That image is too large. Use one under 15 MB."); return; }
    try {
      const blob = await normalizeImage(f);
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      ed.pendingImage = { blob, url, aspect: img.naturalHeight / img.naturalWidth };
      ed.tool = "image"; ed.sel = null;
      clearStatus(editStatus);
      drawLayer(); editUi();
    } catch (err) { setStatus(editStatus, "error", err.message || "That image couldn't be read."); }
  });

  const PALETTE = { "#141414": "Black", "#B3261E": "Red", "#E8710A": "Orange", "#2E7D32": "Green", "#1B3A8C": "Blue", "#7B1FA2": "Purple" };
  function inkRgb(h){ const c = hexRgb(/^#[0-9a-f]{6}$/i.test(h) ? h : "#141414"); return [c.red, c.green, c.blue]; }
  function colorChips(o){
    const row = document.createElement("div"); row.className = "proprow colorrow";
    const lab = document.createElement("span"); lab.className = "muted"; lab.textContent = "Color";
    row.appendChild(lab);
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    Object.entries(PALETTE).forEach(([hex, name]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "colorchip" + (same(o.color, hex) ? " active" : "");
      b.dataset.hex = hex; b.style.background = hex; b.setAttribute("aria-label", name); b.title = name;
      b.addEventListener("click", () => { o.color = hex; drawLayer(); editUi(); });
      row.appendChild(b);
    });
    const pick = document.createElement("input");
    pick.type = "color"; pick.className = "colorpick"; pick.id = "ep-color"; pick.value = /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : "#141414";
    pick.title = "More colors…"; pick.setAttribute("aria-label", "Custom color");
    pick.addEventListener("input", () => { o.color = pick.value.toUpperCase(); drawLayer(); syncProps(o); });
    row.appendChild(pick);
    return row;
  }

  // ---------- The selected item's controls, in the ribbon ----------
  // They take the place of the tool buttons in the Add-to-page row while something is selected,
  // so the ribbon is the same height and the page does not move. Text is typed on the page itself.
  const PLAINTEXT = (() => { const d = document.createElement("div"); try { d.contentEditable = "plaintext-only"; } catch (e) { return false; } return d.contentEditable === "plaintext-only"; })();
  const readTyped = d => PLAINTEXT ? d.textContent : d.innerText.replace(/\n$/, "");
  function caretToEnd(d){
    d.focus();
    const r = document.createRange(), sel = window.getSelection();
    r.selectNodeContents(d); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  }
  // Start typing in a text box on the page.
  function startObjEdit(id){
    const o = ed.objs.find(x => x.id === id);
    if (!o || o.type !== "text") return;
    ed.sel = id; ed.tool = null; ed.editObj = id; ed.focusEdit = true;
    drawLayer(); editUi();
  }
  // What was typed becomes the box's text; the box is re-measured and resized in place, without
  // redrawing, so the caret stays where it is.
  function onObjInput(o, d){
    o.raw = readTyped(d);
    const c = cleanText(o.raw);
    o.text = c.text;
    layoutText(o); clampObj(o); layoutText(o);
    const el = d.closest(".eobj"), s = ed.scale;
    if (el) {
      Object.assign(el.style, { left: o.x * s + "px", top: o.y * s + "px", width: o.w * s + "px", height: o.h * s + "px" });
      el.classList.toggle("empty", !o.text.trim());
    }
    d.classList.toggle("wrap", !o.autoW);
    const w = $("ep-warn"); if (w) w.hidden = !c.bad;
    editSummary();
  }
  function wireTextEdit(d, o){
    d.addEventListener("input", () => onObjInput(o, d));
    d.addEventListener("keydown", ev => {
      if (ev.key === "Escape") { ev.preventDefault(); ed.sel = null; ed.editObj = null; drawLayer(); editUi(); return; }
      if (!PLAINTEXT && ev.key === "Enter") { ev.preventDefault(); document.execCommand("insertLineBreak"); onObjInput(o, d); }
      if (!(ev.ctrlKey || ev.metaKey)) ev.stopPropagation();     // typing is not a page shortcut: Delete here is text, not the item
    });
    d.addEventListener("paste", ev => {
      if (PLAINTEXT) return;
      ev.preventDefault(); document.execCommand("insertText", false, (ev.clipboardData || window.clipboardData).getData("text"));
    });
    d.addEventListener("pointerdown", ev => ev.stopPropagation());
  }
  // An empty text box that is no longer selected was never meant to stay.
  function dropEmptyBoxes(){
    const keep = ed.objs.filter(o => !(o.type === "text" && !String(o.text).trim() && o.id !== ed.sel));
    if (keep.length !== ed.objs.length) ed.objs = keep;
  }
  function syncProps(o){
    const box = $("eprops");
    const f = $("ep-font"); if (f && document.activeElement !== f) f.value = o.fontKey || StandardFonts.Helvetica;
    const z = $("ep-size"); if (z && document.activeElement !== z) z.value = String(o.size);
    box.querySelectorAll(".alignbtn").forEach(bt => {
      const on = (o.align || "left") === bt.dataset.align;
      bt.classList.toggle("armed", on); bt.setAttribute("aria-pressed", on ? "true" : "false");
    });
    box.querySelectorAll(".colorchip").forEach(c => c.classList.toggle("active", String(c.dataset.hex).toLowerCase() === String(o.color).toLowerCase()));
    const cp = box.querySelector(".colorpick"); if (cp && /^#[0-9a-f]{6}$/i.test(o.color)) cp.value = o.color.toLowerCase();
    const w = $("ep-warn"); if (w) w.hidden = !(o.raw && cleanText(o.raw).bad);
  }
  function renderProps(){
    const box = $("eprops"), pane = $("rp-annotate");
    const o = ed.objs.find(x => x.id === ed.sel);
    if (!o || ed.mode !== "annotate") { box.hidden = true; box.innerHTML = ""; box.dataset.obj = ""; pane.classList.remove("has-obj"); return; }
    pane.classList.add("has-obj");
    // choosing an item means editing: bring the ribbon back if it was tucked away for reading
    if ($("docribbon").classList.contains("collapsed")) setRibbonCollapsed(false, false);
    if (box.dataset.obj === String(o.id) && !box.hidden) { syncProps(o); return; }
    box.hidden = false; box.dataset.obj = String(o.id); box.innerHTML = "";
    const names = { text: "Text", check: "Checkmark", cross: "X mark", hl: "Highlight", box: "Box", white: "Whiteout", image: "Image" };
    const nm = document.createElement("b"); nm.className = "objname"; nm.textContent = names[o.type];
    box.appendChild(nm);
    if (o.type === "text") {
      const fontRow = document.createElement("div"); fontRow.className = "proprow";
      const fl = document.createElement("span"); fl.className = "muted"; fl.textContent = "Font";
      const fsel = document.createElement("select"); fsel.id = "ep-font"; fsel.setAttribute("aria-label", "Font");
      const fillFonts = () => {
        fsel.innerHTML = "";
        const docOnes = [];
        (ed.docFonts || new Map()).forEach((info, key) => {
          if (info && info.usable) docOnes.push([key, info.baseFont || key.split("|")[0]]);
        });
        docOnes.sort((a, b) => a[1].localeCompare(b[1]));
        docOnes.forEach(([key, label]) => fsel.appendChild(new Option("From this PDF: " + label, "doc:" + key)));
        TEXT_FONTS.forEach(([label, v]) => fsel.appendChild(new Option(label, v)));
        fsel.value = o.fontKey || StandardFonts.Helvetica;
        if (!fsel.value) fsel.value = StandardFonts.Helvetica;
      };
      fillFonts();
      // the page's fonts take a moment to read, so fill them in once they are known
      ensureDocFonts().then(() => { if ($("ep-font") === fsel) fillFonts(); });
      fsel.addEventListener("change", () => {
        o.fontKey = fsel.value;
        o.docFont = fsel.value.indexOf("doc:") === 0 ? (ed.docFonts.get(fsel.value.slice(4)) || null) : null;
        o.fontRes = o.docFont ? fsel.value.slice(4).split("|")[0] : null;
        o.fontStream = o.docFont ? (fsel.value.slice(4).split("|")[1] || null) : null;
        layoutText(o); clampObj(o); layoutText(o); drawLayer();
      });
      fontRow.append(fl, fsel);

      const sizeRow = document.createElement("div"); sizeRow.className = "proprow";
      const sl = document.createElement("span"); sl.className = "muted"; sl.textContent = "Size";
      const sz = document.createElement("input"); sz.type = "number"; sz.id = "ep-size"; sz.min = "6"; sz.max = "40"; sz.step = "1"; sz.value = String(o.size);
      sz.setAttribute("aria-label", "Text size in points");
      sz.addEventListener("input", () => {
        const v = +sz.value; if (!(v >= 6 && v <= 40)) return;
        o.size = v; layoutText(o); clampObj(o); layoutText(o); drawLayer();
      });
      sizeRow.append(sl, sz);

      const alignRow = document.createElement("div"); alignRow.className = "proprow";
      const al = document.createElement("span"); al.className = "muted"; al.textContent = "Align";
      alignRow.appendChild(al);
      [["left", "Align left", "M4 6h16M4 12h10M4 18h13"], ["center", "Align centre", "M4 6h16M7 12h10M5.5 18h13"], ["right", "Align right", "M4 6h16M10 12h10M7 18h13"]].forEach(([v, label, path]) => {
        const bt = document.createElement("button");
        bt.type = "button"; bt.className = "btn icon alignbtn"; bt.dataset.align = v;
        bt.setAttribute("aria-label", label); bt.title = label;
        bt.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="' + path + '"/></svg>';
        bt.addEventListener("click", () => { o.align = v; syncProps(o); drawLayer(); });
        alignRow.appendChild(bt);
      });
      const warn = document.createElement("div"); warn.className = "warnline"; warn.id = "ep-warn"; warn.hidden = true;
      warn.textContent = "Some characters can't be used in PDF text and were replaced with ?.";
      box.append(fontRow, sizeRow, alignRow, colorChips(o), warn);
    } else if (o.type === "check" || o.type === "cross" || o.type === "box") {
      box.appendChild(colorChips(o));
    } else if (o.type === "white") {
      const n = document.createElement("span"); n.className = "muted";
      n.textContent = "Covers content visually only; the text underneath can still be copied.";
      box.appendChild(n);
    }
    // done with this item: the controls go and the item stays on the page
    const done = document.createElement("button");
    done.type = "button"; done.className = "btn propdone"; done.textContent = "Done";
    done.title = "Finish with this item (Esc)";
    done.addEventListener("click", () => { ed.sel = null; ed.editObj = null; drawLayer(); editUi(); });
    box.appendChild(done);
    syncProps(o);
  }

  function fieldPage(f){ return f.widgets.length ? f.widgets[0].page : -1; }
  async function selectField(i, fromTap){
    ed.fsel = i; ed.fpanelClosed = false;
    const f = ed.fields[i];
    if (f && fieldPage(f) >= 0 && fieldPage(f) !== ed.page) { ed.page = fieldPage(f); ed.sel = null; await editRender(); }
    else { drawLayer(); editUi(); }
    const inp = $("f-input").querySelector("input[type=text], textarea, select");
    if (inp && !fromTap) inp.focus();
    else if (inp && fromTap && f.type !== "check" && f.type !== "radio") inp.focus();
  }

  function renderFieldPanel(){
    const panel = $("fpanel");
    if (ed.mode !== "form" || !ed.fields.length || ed.fpanelClosed) { panel.hidden = true; return; }
    panel.hidden = false;
    const f = ed.fields[ed.fsel];
    $("f-prev").disabled = ed.fsel <= 0;
    $("f-next").disabled = ed.fsel >= ed.fields.length - 1;
    const holder = $("f-input");
    if (!f) {
      $("f-label").textContent = plural(ed.fields.length, "fillable field");
      $("f-pos").textContent = "";
      holder.innerHTML = "";
      const p = document.createElement("div"); p.className = "muted"; p.textContent = "Tap a highlighted field on the page, or use Next field to go through them in order.";
      holder.appendChild(p);
      $("f-next").textContent = "Start \u203a";
      $("f-next").disabled = false;
      return;
    }
    $("f-next").textContent = "Next field \u203a";
    $("f-label").textContent = f.label;
    $("f-pos").textContent = "Field " + (ed.fsel + 1) + " of " + ed.fields.length + (fieldPage(f) >= 0 ? " \u00b7 page " + (fieldPage(f) + 1) : "");
    if (holder.dataset.field === String(ed.fsel) && holder.contains(document.activeElement)) return;
    holder.dataset.field = String(ed.fsel);
    holder.innerHTML = "";
    const redraw = () => { drawLayer(); editSummary(); };
    if (f.readOnly) {
      const n = document.createElement("div"); n.className = "muted";
      n.textContent = "This field is locked by the form's author." + (f.type === "text" && f.value ? " Current value: " + f.value : "");
      holder.appendChild(n); return;
    }
    if (f.type === "text") {
      const el = document.createElement(f.multiline ? "textarea" : "input");
      if (!f.multiline) el.type = "text"; else el.rows = 3;
      el.value = f.value; el.setAttribute("aria-label", f.label);
      if (f.maxLen) el.maxLength = f.maxLen;
      const warn = document.createElement("div"); warn.className = "warnline"; warn.hidden = true;
      warn.textContent = "Some characters can't be used in this form and were replaced with ?.";
      el.addEventListener("input", () => { const c = cleanText(el.value); f.value = f.multiline ? c.text : c.text.replace(/\n/g, " "); warn.hidden = !c.bad; redraw(); });
      el.addEventListener("keydown", e => { if (e.key === "Enter" && !f.multiline) { e.preventDefault(); $("f-next").click(); } });
      holder.append(el, warn);
    } else if (f.type === "check") {
      const lab = document.createElement("label"); lab.className = "checkline";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!f.value;
      cb.addEventListener("change", () => { f.value = cb.checked; redraw(); });
      lab.append(cb, " Checked");
      holder.appendChild(lab);
    } else if (f.type === "radio") {
      const wrap = document.createElement("div"); wrap.className = "radio-opts";
      f.options.forEach(opt => {
        const lab = document.createElement("label");
        const r = document.createElement("input"); r.type = "radio"; r.name = "f-radio"; r.checked = f.value === opt;
        r.addEventListener("change", () => { f.value = opt; redraw(); });
        lab.append(r, " " + opt);
        wrap.appendChild(lab);
      });
      const clr = document.createElement("button"); clr.className = "btn"; clr.textContent = "Clear choice";
      clr.addEventListener("click", () => { f.value = null; holder.dataset.field = ""; renderFieldPanel(); redraw(); });
      holder.append(wrap, clr);
    } else {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", f.label);
      if (f.type === "list" && f.multi) { sel.multiple = true; sel.size = Math.min(6, f.options.length); }
      else { const none = document.createElement("option"); none.value = ""; none.textContent = "(none)"; sel.appendChild(none); }
      f.options.forEach(opt => {
        const o = document.createElement("option"); o.value = opt; o.textContent = opt;
        o.selected = f.type === "list" ? (f.value || []).includes(opt) : f.value === opt;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        if (f.type === "list") f.value = [...sel.selectedOptions].map(o => o.value).filter(Boolean);
        else f.value = sel.value;
        redraw();
      });
      holder.appendChild(sel);
    }
  }
  $("f-prev").addEventListener("click", () => { if (ed.fsel > 0) selectField(ed.fsel - 1); });
  $("f-next").addEventListener("click", () => { if (ed.fsel < ed.fields.length - 1) selectField(ed.fsel + 1); });

  function editUi(){
    const annot = ed.mode === "annotate";
    eStage.classList.toggle("mode-redact", ed.mode === "redact");   // crosshair while marking
    eStage.classList.toggle("mode-form", !annot);
    eStage.classList.toggle("mode-annot", annot);
    eStage.classList.toggle("tooling", annot && !!ed.tool);
    document.querySelectorAll("#annot-tools .tool[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === ed.tool));
    const sigArmed = ed.tool === "image" && ed.pendingImage && ed.pendingImage.isSignature;
    $("tool-image").classList.toggle("active", ed.tool === "image" && !sigArmed);
    $("sig-tool").classList.toggle("active", !!sigArmed);
    $("annot-tools").hidden = !annot;
    // the properties column only takes space when there is something to show
    // The panel exists only when it has something to say, so an unselected page is just
    // the page.
    // Text editing happens on the page and in the ribbon, so the side panel only opens for
    // the one case that needs it: removing text that cannot be rewritten.
    const textPanelNeeded = ed.mode === "text" && !!ed.lockedSel;
    const needsProps = (annot && !$("sigbox").hidden) ||
                       (ed.mode === "form" && !ed.fpanelClosed && ed.fields.length > 0) || textPanelNeeded;
    // contextual panels float over the page edge instead of taking a column, so the page
    // keeps its width whether or not one is showing
    $("workarea").classList.toggle("has-props", !!needsProps);
    $("rp-annotate").hidden = ed.mode !== "annotate";
    $("rp-form").hidden = ed.mode !== "form";
    $("edit-docopts").hidden = ed.mode !== "doc";
    $("edit-textpanel").hidden = ed.mode !== "text";
    const rib = $("tx-ribbon");
    if (rib) { rib.hidden = ed.mode !== "text" || !ed.view; renderRibbon(); }
    const rdRib = $("rd-ribbon");
    if (rdRib) rdRib.hidden = ed.mode !== "redact" || !ed.view;
    $("edit-hint").hidden = !annot;
    $("edit-hint").textContent = ed.tool ? TOOL_HINTS[ed.tool] : (ed.sel !== null ? "Drag to move. Drag the gold corner to resize." : "Pick a tool, then tap the page. Tap anything you've added to move, resize, or change it.");
    $("edit-hint").classList.toggle("warnline", ed.tool === "white");
    document.querySelectorAll("#edit-modes .segbtn").forEach(b => { const on = b.dataset.emode === ed.mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    const fb = document.querySelector("#edit-modes .segbtn[data-emode=form]");
    fb.disabled = !ed.fields.length;
    $("edit-fieldcount").textContent = ed.fields.length ? "(" + ed.fields.length + ")" : "(none)";
    $("flatten-line").hidden = !ed.fields.length;
    $("e-prev").disabled = ed.page <= 0;
    $("e-next").disabled = ed.page >= ed.pageCount - 1;
    $("e-label").textContent = "Page " + (ed.page + 1) + " of " + ed.pageCount;
    $("e-count").textContent = ed.pageCount;
    { const box = $("e-page");
      box.max = ed.pageCount;
      box.style.width = Math.max(3, String(ed.pageCount).length + 1.6) + "ch";
      if (document.activeElement !== box) box.value = ed.page + 1;      // never overwrite what is being typed
    }
    editSummary();
    renderProps();
    renderTextPanel();
    renderFieldPanel();
  }
  const TEXT_FONTS = [
    ["Helvetica", StandardFonts.Helvetica], ["Helvetica Bold", StandardFonts.HelveticaBold],
    ["Times", StandardFonts.TimesRoman], ["Times Bold", StandardFonts.TimesRomanBold],
    ["Courier", StandardFonts.Courier]
  ];
  function fillTextFonts(block){
    const sel = $("tx-font"), keep = sel.value;
    sel.innerHTML = "";
    const info = block ? docFontFor(block) : null;
    if (info && info.usable) {
      sel.appendChild(new Option("Match the document", "doc"));
      [["bold", "Match the document \u2014 Bold"], ["italic", "Match the document \u2014 Italic"],
       ["bolditalic", "Match the document \u2014 Bold Italic"], ["regular", "Match the document \u2014 Regular"]]
        .forEach(([want, label]) => { if (ed.docSiblings && ed.docSiblings.get(block.fontRes + ":" + want)) sel.appendChild(new Option(label, "doc:" + want)); });
    }
    TEXT_FONTS.forEach(([label, v]) => sel.appendChild(new Option(label, v)));
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : (info && info.usable ? "doc" : StandardFonts.Helvetica);
  }

  // What an edit records about its font: the choice, and for one of the document's own faces the
  // resource to write it with. A new edit starts in the document's font where it can be reused.
  function blockFontFields(b, value){
    const info = value === "doc" ? docFontFor(b)
      : (typeof value === "string" && value.indexOf("doc:") === 0) ? docSiblingFor(b, value.slice(4)) : null;
    return { fontName: value, docFontRes: info ? info.name : null, docFontCodes: info || null };
  }
  function blockEdit(i, patch){
    const b = ed.blocks[i];
    const cur = ed.textEdits.get(i) || Object.assign({ page: ed.page, stream: b.stream || null, ops: b.ops, text: b.text, fontName: StandardFonts.Helvetica,
      size: b.size, fill: b.fill, x: b.x, top: b.top, width: b.w, height: b.height, leading: b.leading,
      lineBoxes: b.lineBoxes, moved: false, dx: 0, dy: 0, align: "left",
      box: { x: b.x, y: b.minY, w: b.w, h: (b.maxY - b.minY) + b.h } }, blockFontFields(b, fontDefaultFor(b)));
    ed.textEdits.set(i, Object.assign(cur, patch));
    return cur;
  }
  // Widening or narrowing a block changes where its text wraps, so a resized block always
  // reflows rather than trying to sit back on its original lines.
  function startBlockResize(ev, i, axis){
    const b = ed.blocks[i], e0 = ed.textEdits.get(i);
    const startX = ev.clientX, startY = ev.clientY;
    const baseW = (e0 && e0.width) || b.w;
    const baseLead = (e0 && e0.leading) || b.leading || (b.size * LINE);
    const baseSize = (e0 && e0.size) || b.size;
    const scale = ed.scale || 1;
    const move = m => {
      if (axis === "h") {
        // line spacing: dragging down spreads the lines, and the block grows downwards
        const perLine = Math.max(1, b.runs.length - 1);
        const lead = Math.max(baseSize * 0.8, baseLead + (m.clientY - startY) / scale / perLine);
        blockEdit(i, { leading: lead, resized: true });
      } else if (axis === "both") {
        const perLine = Math.max(1, b.runs.length - 1);
        const lead = Math.max(baseSize * 0.8, baseLead + (m.clientY - startY) / scale / perLine);
        const w = Math.max((b.size || 8) * 2, baseW + (m.clientX - startX) / scale);
        blockEdit(i, { width: w, leading: lead, resized: true });
      } else {
        const w = Math.max((b.size || 8) * 2, baseW + (m.clientX - startX) / scale);
        blockEdit(i, { width: w, resized: true });
      }
      drawLayer(); editSummary(); renderTextPanel();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    ev.preventDefault();
  }

  // Double-click, or the button in the panel, puts a caret on the page.
  function beginOnPageEdit(i){
    ed.tsel = i;
    ed.typing = i;
    if (!ed.textEdits.get(i)) blockEdit(i, {});       // stage it so the preview exists
    drawLayer(); editUi();
    const first = eLayer.querySelector('.tprev[data-line="0"]');
    if (first) {
      first.focus();
      const r = document.createRange(), sel = window.getSelection();
      r.selectNodeContents(first); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
  }

  function startBlockDrag(ev, i, el){
    // One press selects or drags; two put a caret in the text. The browser's own count
    // can't be used: selecting rebuilds the overlay, so the second press lands on a new
    // element and the count starts again. Track it here instead.
    const now = Date.now();
    const quickSecond = ed.lastPress && ed.lastPress.i === i && now - ed.lastPress.t < 500;
    ed.lastPress = { i: i, t: now };
    if (quickSecond && !ed.mergeArmed && !ed.splitArmed) {
      ev.preventDefault(); beginOnPageEdit(i); return;
    }
    if (ev.button > 0) return;
    if (ed.tsel !== null && i !== ed.tsel && (ed.mergeArmed || ev.shiftKey)) { mergeBlocks(ed.tsel, i); return; }
    if (ed.mergeArmed && i === ed.tsel) { ed.mergeArmed = false; setStatus(editStatus, "info", "Merge cancelled."); }
    ed.tsel = i; drawLayer(); editUi();
    const b = ed.blocks[i], e = ed.textEdits.get(i);
    const startX = ev.clientX, startY = ev.clientY;
    const baseX = e && e.moved ? e.x : b.x, baseTop = e && e.moved ? e.top : b.top;
    let moved = false;
    const scale = ed.scale || 1;
    const move = m => {
      const dx = (m.clientX - startX) / scale, dy = (m.clientY - startY) / scale;
      if (!moved && Math.hypot(dx * scale, dy * scale) < 4) return;
      moved = true;
      blockEdit(i, { x: baseX + dx, top: baseTop - dy, dx: (baseX + dx) - b.x, dy: (baseTop - dy) - b.top, moved: true });
      drawLayer(); editSummary(); renderTextPanel();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) { drawLayer(); editUi(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    ev.preventDefault();
  }

  // Load what the page's own fonts can do. Used by the text editor, and by a new text box
  // that wants to match the document rather than approximate it.
  // The table of the page's own fonts is keyed by resource name when text mode builds it and
  // by "resource|stream" when the font menu for added text does. Anything that looks a font up
  // for a block must accept either, or the document's font quietly stops being offered.
  function docFontFor(b){
    if (!ed.docFonts || !b || !b.fontRes) return null;
    return ed.docFonts.get(b.fontRes + "|" + (b.stream || "")) || ed.docFonts.get(b.fontRes) || null;
  }
  function docSiblingFor(b, want){
    if (!ed.docSiblings || !b || !b.fontRes) return null;
    return ed.docSiblings.get(b.fontRes + "|" + (b.stream || "") + ":" + want) || ed.docSiblings.get(b.fontRes + ":" + want) || null;
  }
  async function ensureDocFonts(){
    if (ed.docFonts && ed.docFonts.size) return;
    ed.docFonts = new Map(); ed.docSiblings = new Map();
    docFontCache.clear();
    try {
      const d = await loadPdf(ed.info.bytes.slice(0), ed.info.file.name);
      const ops = await allPageOps(d, ed.page);
      const seen = new Map();
      ops.forEach(o => { if (o.font) seen.set(o.font + "|" + (o.stream || ""), o); });
      seen.forEach(o => {
        const sd = o.stream && ops.streams.get(o.stream) ? ops.streams.get(o.stream).dict : null;
        const info = documentFont(d, ed.page, o.font, sd);
        ed.docFonts.set(o.font + "|" + (o.stream || ""), info);
        if (info && info.usable) ["bold", "italic", "bolditalic", "regular"].forEach(want => {
          const sib = siblingFont(d, ed.page, info, want, sd);
          if (sib) ed.docSiblings.set(o.font + "|" + (o.stream || "") + ":" + want, sib);
        });
      });
    } catch (err) { /* the bundled fonts still work */ }
  }

  async function enterTextMode(){
    if (!ed.view || ed.runs.length) { drawLayer(); editUi(); return; }
    setStatus(editStatus, "info", "Looking at the text on this page\u2026");
    try {
      ed.runs = await loadTextRuns(ed.page);
      ed.blocks = groupRuns(ed.runs);
      // what the page's own fonts can do, so the menu only offers what will work
      ed.docFonts = new Map(); ed.docSiblings = new Map();
      docFontCache.clear();      // resource names like /F1 repeat across documents
      try {
        const d = await loadPdf(ed.info.bytes.slice(0), ed.info.file.name);
        const seen = new Set(ed.blocks.map(b => b.fontRes).filter(Boolean));
        seen.forEach(res => {
          const info = documentFont(d, ed.page, res.name || res, res.dict);
          ed.docFonts.set(res, info);
          if (info && info.usable) ["bold", "italic", "bolditalic", "regular"].forEach(want => {
            const sib = siblingFont(d, ed.page, info, want);
            if (sib) ed.docSiblings.set(res + ":" + want, sib);
          });
        });
      } catch (err) { /* fall back to the bundled fonts */ }
      const n = ed.blocks.length;
      const perLine = ed.runs.length ? (n / Math.max(1, new Set(ed.runs.map(r => Math.round(r.y))).size)) : 0;
      setStatus(editStatus, n ? "info" : "error",
        n ? "Tap a highlighted block to edit its text, or drag it to move it. " + plural(n, "block") +
            " on this page" + (perLine > 1.6 ? " \u2014 that looks like more than one box per line; try moving Grouping towards Loose." : ".")
          : "None of the text on this page can be edited directly. It may be a scan, or drawn inside a reusable block.");
    } catch (err) {
      setStatus(editStatus, "error", "Couldn't read the text on this page: " + (err.message || err));
    }
    drawLayer(); editUi();
  }

  // Text we cannot rewrite can still be removed: removal only needs to know which
  // operators draw it. The catch is that one operator may draw more than the line pointed
  // at, so the full extent is shown before anything is deleted.
  // The instructions that draw a piece of text: the ones matched to it, or failing that the one
  // found for it by its baseline. Empty when the text is not drawn by any (a scan, outlines).
  const lockSpans = r => (r.spans && r.spans.length ? r.spans : r.rmSpans) || [];
  function selectLocked(run){
    ed.tsel = null;
    ed.lockedSel = run;
    const mine = lockSpans(run);
    const share = (ed.runs || []).filter(o => o !== run &&
      lockSpans(o).some(s1 => mine.some(s2 => s1.opStart != null && s1.opStart === s2.opStart)));
    ed.lockedAlso = share;
    drawLayer(); editUi();
    setStatus(editStatus, "info", (LOCK_REASON[run.reason] || LOCK_REASON.unpositioned) +
      " Press Delete, or use Remove in the panel, to take it off the page.");
  }
  function deleteLocked(){
    const run = ed.lockedSel;
    if (!run) return;
    const spans = lockSpans(run).length ? lockSpans(run) : (run.opStart != null ? [{ opStart: run.opStart, opEnd: run.opEnd }] : []);
    if (!spans.length || spans[0].opStart == null) { setStatus(editStatus, "error", NO_REMOVE); return; }
    const key = "locked:" + spans[0].opStart;
    ed.textEdits.set(key, { page: ed.page, stream: run.stream || run.rmStream || null, ops: spans, text: "",
      fontName: "doc", docFontRes: run.fontRes, size: run.size, fill: run.fill,
      x: run.x, top: run.y + run.h, width: run.w, leading: run.size * LINE,
      lineBoxes: [{ x: run.x, y: run.y, w: run.w }], moved: false, dx: 0, dy: 0 });
    const extra = (ed.lockedAlso || []).length;
    ed.lockedSel = null; ed.lockedAlso = [];
    drawLayer(); editUi(); editSummary();
    setStatus(editStatus, "success", "Marked for removal." + (extra ? " " + plural(extra, "other line") + " drawn by the same instruction will go with it." : ""));
  }

  // The font and size controls live on the ribbon above the page, where they stay put
  // instead of appearing and disappearing with a side panel.
  function renderRibbon(){
    const sel = $("rb-font"), size = $("rb-size"), note = $("rb-note");
    if (!sel) return;
    const b = ed.tsel !== null && ed.blocks ? ed.blocks[ed.tsel] : null;
    sel.disabled = size.disabled = !b;
    syncRibbonColors(b, !!b);
    if (!b) {
      document.querySelectorAll("#tx-ribbon [data-align]").forEach(btn => { btn.disabled = true; btn.setAttribute("aria-pressed", "false"); btn.classList.remove("armed"); });
      note.textContent = ""; return;          // the status line below the page says how to start; a note here would make the ribbon taller
    }
    const e = ed.textEdits.get(ed.tsel) || {};
    const want = e.fontName || fontDefaultFor(b);
    const offers = ed.tsel + ":" + (docFontFor(b) && docFontFor(b).usable ? 1 : 0) + ":" + ["bold", "italic", "bolditalic", "regular"].filter(w => docSiblingFor(b, w)).join(",");
    const built = sel.dataset.forBlock === offers;
    if (!built) {
      sel.innerHTML = "";
      const dinfo = docFontFor(b);
      if (dinfo && dinfo.usable) sel.appendChild(new Option(dinfo.baseFont ? "Document: " + dinfo.baseFont : "Match the document", "doc"));
      [["doc:bold", "Document bold"], ["doc:italic", "Document italic"],
       ["doc:bolditalic", "Document bold italic"], ["doc:regular", "Document regular"]]
        .forEach(([v, label]) => { if (docSiblingFor(b, v.slice(4))) sel.appendChild(new Option(label, v)); });
      TEXT_FONTS.forEach(([label, v]) => sel.appendChild(new Option(label, v)));
      sel.dataset.forBlock = offers;
    }
    document.querySelectorAll("#tx-ribbon [data-align]").forEach(btn => {
      const on = (e.align || "left") === btn.dataset.align;
      btn.disabled = false; btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.classList.toggle("armed", on);
    });
    sel.value = want;
    sel.title = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "";
    if (document.activeElement !== size) size.value = String(Math.round((e.size || b.size) * 10) / 10);
    const e2 = ed.textEdits.get(ed.tsel) || {};
    const lines = (e2.text != null ? e2.text : b.text).split("\n").length;
    const grew = lines > (b.runs ? b.runs.length : lines);
    const bits = [];
    if (b.stream) {
      const pages = ed.formPages ? (ed.formPages.get(b.stream) || 1) : 1;
      bits.push(pages > 1
        ? "Shared block: editing this changes all " + pages + " pages that use it."
        : "From a reusable block; the change stays on this page.");
    }
    if (b.mixedFont) bits.push("This text mixes fonts; the first is used.");
    if (grew) bits.push("Now " + lines + " lines instead of " + b.runs.length + ", so it will run down over what sits below.");
    note.textContent = bits.join(" ");
    note.className = "ribbon-note" + (grew || (b.stream && ed.formPages && (ed.formPages.get(b.stream) || 1) > 1) ? " warn" : "");
  }
  function fontDefaultFor(b){
    const dinfo = docFontFor(b);
    return dinfo && dinfo.usable ? "doc" : StandardFonts.Helvetica;
  }
  document.querySelectorAll("#tx-ribbon [data-align]").forEach(btn => btn.addEventListener("click", () => {
    if (ed.tsel === null) return;
    blockEdit(ed.tsel, { align: btn.dataset.align });
    drawLayer(); editUi();
  }));
  const blockInk = e => "#" + (e.fill || [0, 0, 0]).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  function ribbonColors(){
    const host = $("rb-colors"); if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn icon colorbtn"; btn.id = "rb-colorbtn";
    btn.title = "Text color"; btn.setAttribute("aria-label", "Text color"); btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="colorA">A</span><span class="colorbar" id="rb-colorbar"></span>';
    const pop = document.createElement("div");
    pop.className = "colorpop"; pop.id = "rb-colorpop"; pop.hidden = true;
    Object.entries(PALETTE).forEach(([hex, name]) => {
      const bt = document.createElement("button");
      bt.type = "button"; bt.className = "colorchip"; bt.dataset.hex = hex; bt.style.background = hex;
      bt.title = name; bt.setAttribute("aria-label", name);
      bt.addEventListener("click", () => { setBlockInk(hex); closePop(); });
      pop.appendChild(bt);
    });
    const pick = document.createElement("input");
    pick.type = "color"; pick.className = "colorpick"; pick.id = "rb-color"; pick.title = "More colors\u2026"; pick.setAttribute("aria-label", "Custom text color");
    pick.addEventListener("input", () => setBlockInk(pick.value));
    pop.appendChild(pick);
    const closePop = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => {
      if (!pop.hidden) { closePop(); return; }
      const r = btn.getBoundingClientRect();
      pop.hidden = false; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px"; pop.style.top = (r.bottom + 4) + "px";
      btn.setAttribute("aria-expanded", "true");
    });
    document.addEventListener("pointerdown", ev => { if (!pop.hidden && !pop.contains(ev.target) && !btn.contains(ev.target)) closePop(); });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !pop.hidden) { closePop(); btn.focus(); } });
    host.append(btn, pop);
  }
  function setBlockInk(hex){
    if (ed.tsel === null) return;
    const c = inkRgb(hex);
    blockEdit(ed.tsel, { fill: c });
    drawLayer(); editUi();
  }
  function syncRibbonColors(b, on){
    const host = $("rb-colors"); if (!host) return;
    ribbonColors();
    const cur = b ? blockInk(ed.textEdits.get(ed.tsel) || b) : "";
    host.querySelectorAll(".colorchip").forEach(c => c.classList.toggle("active", on && c.dataset.hex.toLowerCase() === cur.toLowerCase()));
    $("rb-colorbtn").disabled = !on;
    $("rb-colorbar").style.background = on ? cur : "transparent";
    const pick = $("rb-color"); if (pick && on) pick.value = cur.toLowerCase();
    if (!on) { const pop = $("rb-colorpop"); if (pop) pop.hidden = true; }
  }
  { const sel = $("rb-font"), size = $("rb-size");
    if (sel) sel.addEventListener("change", () => { if (ed.tsel !== null) { blockEdit(ed.tsel, blockFontFields(ed.blocks[ed.tsel], sel.value)); drawLayer(); editUi(); } });
    if (size) size.addEventListener("input", () => { if (ed.tsel !== null && +size.value > 0) { blockEdit(ed.tsel, { size: +size.value }); drawLayer(); editUi(); } }); }

  function renderTextPanel(){
    const has = ed.tsel !== null && ed.blocks && ed.blocks[ed.tsel];
    const locked = !has && !!ed.lockedSel;
    $("tx-locked").hidden = !locked;
    if (locked) {
      const n = (ed.lockedAlso || []).length;
      $("tx-locked-why").textContent = LOCK_REASON[ed.lockedSel.reason] || LOCK_REASON.unpositioned;
      const removable = lockSpans(ed.lockedSel).length > 0 || ed.lockedSel.opStart != null;
      $("tx-locked-go").disabled = !removable;
      $("tx-locked-extent").textContent = !removable ? NO_REMOVE
        : n ? "Removing it also removes " + plural(n, "other line") + " drawn by the same instruction \u2014 shown outlined on the page."
        : "Nothing else is drawn by the same instruction, so only this goes.";
    }
    $("tx-empty").hidden = !!has || locked;
    $("tx-edit").hidden = !has;
    if (!has) return;
    const b = ed.blocks[ed.tsel], e = ed.textEdits.get(ed.tsel);
    if (document.activeElement !== $("tx-text")) $("tx-text").value = e ? e.text : b.text;
    fillTextFonts(b);
    if (e) $("tx-font").value = e.fontName;
    const dinfo = docFontFor(b);
    const usingDoc = $("tx-font").value.indexOf("doc") === 0;
    const missing = usingDoc && dinfo ? [...new Set(($("tx-text").value || "").replace(/\n/g, ""))]
      .filter(ch => ch.trim() && !activeDocFont(b).toCode.has(ch)) : [];
    $("tx-fontnote").hidden = !(usingDoc || (dinfo && !dinfo.usable) || b.mixedFonts);
    $("tx-fontnote").className = missing.length ? "warnline" : "hint";
    $("tx-fontnote").textContent = missing.length
      ? "The document's font has no " + missing.slice(0, 6).map(c => "\u201c" + c + "\u201d").join(", ") +
        ", so this line will be drawn in " + bundledLabel() + " instead."
      : dinfo && !dinfo.usable ? "This font can't be reused (the document doesn't say which characters its codes produce), so a built-in font is used."
      : b.mixedFonts ? "This line mixes fonts; the first one is used for the whole line."
      : "Using the document's own font: " + (dinfo ? dinfo.baseFont : "");
    // Text inside a reusable block is editable, but a block can be stamped onto several
    // pages, so say plainly how far a change will reach before it is made.
    const pages = b.stream && ed.formPages ? (ed.formPages.get(b.stream) || 1) : 0;
    $("tx-shared").hidden = !b.stream;
    $("tx-shared").className = pages > 1 ? "warnline" : "hint";
    $("tx-shared").textContent = pages > 1
      ? "Shared block: this text is drawn from a block the document reuses on " + pages +
        " pages. Editing it changes all " + pages + " of them, not just this page."
      : "This text comes from a reusable block (a header, footer or letterhead). This document only uses it on this page, so the change stays here.";
    $("tx-size").value = Math.round((e ? e.size : b.size) * 10) / 10;
    const orig = b.text.replace(/\n/g, " \u00b7 ");
    $("tx-original").textContent = orig.length > 80 ? orig.slice(0, 80) + "\u2026" : orig;
    $("tx-lines").textContent = plural(b.runs.length, "line") + (e && e.moved ? " \u00b7 moved" : "") +
      (e && e.resized ? " \u00b7 " + Math.round(e.width || b.w) + "pt wide" : "") +
      (e && e.leading && Math.abs(e.leading - (b.leading || b.size * LINE)) > 0.3 ? " \u00b7 " + (Math.round(e.leading * 10) / 10) + "pt spacing" : "");
    $("tx-revert").hidden = !e;
    $("tx-merge").textContent = ed.mergeArmed ? "Pick a block\u2026" : "Merge with\u2026";
    $("tx-merge").classList.toggle("armed", !!ed.mergeArmed);
    $("tx-split").textContent = ed.splitArmed ? "Click a gap\u2026" : "Split\u2026";
    $("tx-split").classList.toggle("armed", !!ed.splitArmed);
    $("tx-split").disabled = b.runs.length < 2;
    // How many lines the block will actually occupy, so growth over what sits below is
    // flagged before it happens rather than discovered in the saved file.
    const linesNow = (() => {
      if (!e || !helv) return b.runs.length;
      const width = e.resized ? e.width : Math.max(b.w, e.width || b.w);
      const typed = e.text.split("\n");
      const fits = !e.resized && typed.length === b.lineBoxes.length &&
        typed.every((ln, i) => helv.widthOfTextAtSize(ln, e.size) <= Math.max(b.lineBoxes[i].w, width) * 1.02);
      if (fits) return typed.length;
      let n = 0;
      typed.forEach(t => {
        let line = "", count = 1;
        for (const word of t.split(/\s+/).filter(Boolean)) {
          const cand = line ? line + " " + word : word;
          if (helv.widthOfTextAtSize(cand, e.size) <= Math.max(e.size, width) || !line) line = cand;
          else { count++; line = word; }
        }
        n += count;
      });
      return n;
    })();
    const grew = !!e && linesNow > b.runs.length;
    const reflowed = !!e && (e.resized || linesNow !== b.runs.length);
    $("tx-warn").hidden = !reflowed;
    $("tx-warn").textContent = grew
      ? "This block is now " + plural(linesNow, "line") + " instead of " + b.runs.length +
        ", so it will run down over whatever sits below it. Widen the block or use a smaller size to keep it the same height."
      : "The text no longer sits on its original lines, so the block re-wraps to its own width.";
  }
  function activeDocFont(b){
    const v = $("tx-font").value;
    if (v === "doc") return docFontFor(b);
    if (v.indexOf("doc:") === 0) return ed.docSiblings.get(b.fontRes + ":" + v.slice(4));
    return null;
  }
  const bundledLabel = () => "Helvetica";
  function stageTextEdit(){
    if (ed.tsel === null) return;
    const b = ed.blocks[ed.tsel];
    const value = $("tx-text").value, font = $("tx-font").value, size = +$("tx-size").value || b.size;
    const e = ed.textEdits.get(ed.tsel);
    const dflt = (docFontFor(b) || {}).usable ? "doc" : StandardFonts.Helvetica;
    const unchanged = value === b.text && font === dflt && Math.abs(size - b.size) < 0.05 && !(e && e.moved) && !(e && e.resized) && !(e && e.align && e.align !== "left");
    if (unchanged) ed.textEdits.delete(ed.tsel);
    else {
      const docFont = activeDocFont(b);
      blockEdit(ed.tsel, { text: value, autoWrapped: false, fontName: font, size,
        docFontRes: docFont ? docFont.name : null,
        docFontCodes: docFont ? docFont : null });
    }
    drawLayer(); renderTextPanel(); editSummary();
  }
  $("tx-size").addEventListener("input", stageTextEdit);
  $("tx-locked-go").addEventListener("click", deleteLocked);
  $("tx-showall").addEventListener("click", () => setShowAll(!showAllBlocks()));
  function setGrouping(level, redo){
    ed.grouping = Math.max(0, Math.min(GROUPING.length - 1, level | 0));
    try { localStorage.setItem("pdf-tools:grouping", String(ed.grouping)); } catch (e) {}
    const sl = $("tx-group"), lb = $("tx-group-name");
    if (sl) sl.value = String(ed.grouping);
    if (lb) lb.textContent = grouping().name;
    if (redo && ed.view && ed.mode === "text") {
      ed.runs = []; ed.blocks = []; ed.tsel = null; ed.lockedSel = null; ed.lockedAlso = [];
      ed.textEdits = new Map();
      enterTextMode();
    }
  }
  { const sl = $("tx-group");
    if (sl) sl.addEventListener("input", () => setGrouping(+sl.value, true));
    try { const v = localStorage.getItem("pdf-tools:grouping"); if (v !== null) ed.grouping = +v; } catch (e) {}
    setGrouping(ed.grouping != null ? ed.grouping : 1, false); }
  (function restoreShowAll(){
    try { const v = localStorage.getItem("pdf-tools:show-blocks"); if (v !== null) ed.showAll = v === "1"; } catch (e) {}
    const btn = $("tx-showall");
    if (btn) { const on = showAllBlocks(); btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.classList.toggle("armed", on); }
  })();
  document.addEventListener("keydown", e => {
    if (activeTool !== "document" || ed.mode !== "text") return;
    if (e.key === "Enter" && ed.tsel !== null && ed.typing === null &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) {
      e.preventDefault(); beginOnPageEdit(ed.tsel); return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && ed.lockedSel &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) {
      e.preventDefault(); deleteLocked();
    }
  });
  document.addEventListener("keydown", e => {
    if (activeTool !== "document" || ed.mode !== "annotate" || ed.sel === null || ed.editObj !== null) return;
    const o = ed.objs.find(x => x.id === ed.sel);
    if (e.key === "Enter" && o && o.type === "text" && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((document.activeElement || {}).tagName || "")) {
      e.preventDefault(); startObjEdit(o.id);
    }
  });
  $("tx-text").addEventListener("input", stageTextEdit);
  $("tx-font").addEventListener("change", stageTextEdit);
  $("tx-revert").addEventListener("click", () => { ed.textEdits.delete(ed.tsel); $("tx-text").value = ed.blocks[ed.tsel].text; drawLayer(); renderTextPanel(); editSummary(); });

  function editStepLabel(){
    const parts = [];
    if (ed.objs.length) parts.push(plural(ed.objs.length, "item") + " added");
    const cf = ed.fields.filter(fieldChanged).length;
    if (cf) parts.push(plural(cf, "field") + " filled");
    if (ed.textEdits.size) parts.push(plural(ed.textEdits.size, "text edit"));
    if ((ed.redactions || []).length) parts.push(plural(ed.redactions.length, "redaction"));
    if ($("wm-on").checked && $("wm-text").value.trim()) parts.push("watermark");
    if ($("pn-on").checked) parts.push("page numbers");
    if ($("f-flatten").checked && ed.fields.length) parts.push("form flattened");
    return parts.join(" + ") || "edits";
  }
  const ZOOMS = [1, 1.25, 1.5, 2, 3];
  function setEditZoom(dir){
    const i = ZOOMS.indexOf(ed.zoom || 1);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
    if (next === ed.zoom) return;
    ed.zoom = next;
    $("e-zoom").textContent = next === 1 ? "Fit" : Math.round(next * 100) + "%";
    $("e-zout").disabled = next === ZOOMS[0];
    $("e-zin").disabled = next === ZOOMS[ZOOMS.length - 1];
    editRender();
  }
  $("e-zin").addEventListener("click", () => setEditZoom(1));
  $("e-fit").addEventListener("click", () => {
    ed.fitWidth = !ed.fitWidth;
    $("e-fit").textContent = ed.fitWidth ? "Page" : "Width";
    editRender();
  });
  $("e-zout").addEventListener("click", () => setEditZoom(-1));

  function editSummary(){
    const changedFields = ed.fields.filter(fieldChanged).length;
    const n = ed.objs.length;
    const marks = [];
    if ((ed.redactions || []).length) marks.push(plural(ed.redactions.length, "redaction"));
    if (ed.textEdits.size) marks.push(plural(ed.textEdits.size, "text edit"));
    if ($("wm-on").checked && $("wm-text").value.trim()) marks.push("watermark");
    if ($("pn-on").checked) marks.push("page numbers");
    $("edit-summary").textContent = [n ? plural(n, "item") + " added" : "", changedFields ? plural(changedFields, "field") + " filled" : "", marks.join(" and ")].filter(Boolean).join(" \u00b7 ");
    editGo.disabled = ed.busy || !(n || changedFields || docMarksOn() || ed.textEdits.size || (ed.redactions || []).length || ($("f-flatten").checked && ed.fields.length));
  }
  $("f-flatten").addEventListener("change", editUi);
  ["wm-on", "wm-text", "wm-style", "wm-color", "wm-opacity", "pn-on", "pn-format", "pn-pos", "pn-start", "pn-skip1"].forEach(id => {
    $(id).addEventListener("input", () => { $("wm-opv").textContent = $("wm-opacity").value + "%"; drawLayer(); editSummary(); });
    $(id).addEventListener("change", () => { drawLayer(); editSummary(); });
  });

  document.querySelectorAll("#edit-modes .segbtn").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    ed.mode = b.dataset.emode; ed.tool = null; ed.sel = null; ed.fpanelClosed = false;
    if (ed.mode === "text") { enterTextMode(); return; }
    if (ed.mode === "redact") { enterRedactMode(); return; }
    drawLayer(); editUi();
  }));
  const turnPage = async d => {
    const next = ed.page + d;
    if (next < 0 || next >= ed.pageCount) return;
    ed.page = next; ed.sel = null; ed.tsel = null;
    await editRender();
    if (ed.mode === "text") { ed.runs = []; ed.blocks = []; ed.tsel = null; ed.lockedSel = null; ed.lockedAlso = []; await enterTextMode(); }
  };
  $("e-prev").addEventListener("click", () => turnPage(-1));
  $("e-next").addEventListener("click", () => turnPage(1));
  document.addEventListener("keydown", e => {
    if (activeTool !== "document" || ed.sel === null || ed.mode !== "annotate") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteObj(ed.sel); }
    else if (e.key === "Escape") { ed.sel = null; drawLayer(); editUi(); }
  });

  // ---------- Reading form fields ----------
  function fieldLabel(f){
    try {
      const tu = f.acroField.dict.lookup(PDFName.of("TU"));
      if (tu && typeof tu.decodeText === "function") { const t = tu.decodeText().trim(); if (t) return t; }
    } catch (e) {}
    const last = f.getName().split(".").pop().replace(/\[\d+\]/g, "").replace(/[_]+/g, " ").trim();
    return last || f.getName();
  }
  async function readFields(info){
    const doc = await loadPdf(info.bytes.slice(0), info.file.name);
    let form;
    try { form = doc.getForm(); } catch (e) { return []; }
    const pages = doc.getPages();
    const refIdx = new Map(pages.map((p, i) => [p.ref.toString(), i]));
    const out = [];
    for (const f of form.getFields()) {
      const type = f instanceof PDFTextField ? "text" : f instanceof PDFCheckBox ? "check" : f instanceof PDFRadioGroup ? "radio"
        : f instanceof PDFDropdown ? "dropdown" : f instanceof PDFOptionList ? "list" : null;
      if (!type) continue; // buttons and digital-signature fields aren't fillable here
      let widgets = [];
      try {
        widgets = f.acroField.getWidgets().map((w, wi) => {
          let page = -1;
          const P = w.P();
          if (P && refIdx.has(P.toString())) page = refIdx.get(P.toString());
          if (page < 0) {
            const ref = doc.context.getObjectRef(w.dict);
            if (ref) page = pages.findIndex(p => {
              const a = p.node.Annots(); if (!a) return false;
              for (let k = 0; k < a.size(); k++) { const r = a.get(k); if (r && r.toString() === ref.toString()) return true; }
              return false;
            });
          }
          const r = w.getRectangle();
          return { page, rect: [r.x, r.y, r.x + r.width, r.y + r.height], wi, box: null };
        }).filter(w => w.page >= 0 && w.rect[2] - w.rect[0] > 0.5 && w.rect[3] - w.rect[1] > 0.5);
      } catch (e) { widgets = []; }
      const e = { name: f.getName(), label: fieldLabel(f), type, readOnly: f.isReadOnly(), widgets };
      try {
        if (type === "text") { e.value = f.getText() || ""; e.multiline = f.isMultiline(); e.maxLen = f.getMaxLength(); }
        else if (type === "check") e.value = f.isChecked();
        else if (type === "radio") { e.options = f.getOptions(); e.value = f.getSelected() || null; }
        else if (type === "dropdown") { e.options = f.getOptions(); e.value = f.getSelected()[0] || ""; }
        else { e.options = f.getOptions(); e.value = f.getSelected(); e.multi = f.isMultiselect(); }
      } catch (err) { continue; }
      e.orig = JSON.stringify(e.value);
      out.push(e);
    }
    const key = e => {
      const w = e.widgets[0];
      return w ? [w.page, -Math.max(w.rect[1], w.rect[3]), Math.min(w.rect[0], w.rect[2])] : [1e9, 0, 0];
    };
    out.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
    return out;
  }
  function fieldChanged(f){ return JSON.stringify(f.value) !== f.orig; }

  // ---------- Load / save ----------
  function editResetObjects(){
    const urls = new Set(ed.objs.filter(o => o.url).map(o => o.url));
    urls.forEach(u => URL.revokeObjectURL(u));
    if (ed.pendingImage) { URL.revokeObjectURL(ed.pendingImage.url); ed.pendingImage = null; }
    ed.objs = []; ed.sel = null; ed.tool = null;
  }

  tools.document = {
    info: () => ed.info,
    status: editStatus,
    load: async info => {
      // Loads can overlap (apply, undo, then a new file). Anything older than the newest
      // request must bail out instead of overwriting the state the newer one has set up.
      const token = ++ed.loadToken;
      await helvReady; helv = await helvReady; await stdFontsReady;
      if (token !== ed.loadToken) return;
      if (ed.view) ed.view.destroy().catch(() => {});
      editResetObjects();
      ed.info = info;
      const view = await openPdfJs(info.bytes);
      if (token !== ed.loadToken) { view.destroy().catch(() => {}); return; }
      ed.view = view;
      find.index = null; find.indexToken++; find.matches = []; find.cur = -1;
      const wasOn = ed.page || 0, keepPage = info.keepPage;
      ed.pageCount = ed.view.numPages;
      ed.page = keepPage && wasOn < ed.pageCount ? wasOn : 0;
      ed.dims = {};
      // These are applied into the file, so clear them; otherwise pressing Apply again
      // would stamp a second watermark or another set of page numbers on top.
      $("pn-start").value = "1";
      ed.runs = []; ed.blocks = []; ed.tsel = null; ed.textEdits = new Map(); ed.mergeArmed = false; ed.splitArmed = false;
      ed.redactions = []; ed.lockedSel = null; ed.lockedAlso = [];
      $("wm-on").checked = false; $("wm-text").value = "";
      $("pn-on").checked = false; $("pn-skip1").checked = false;
      ed.fields = await readFields(info);
      if (token !== ed.loadToken) return;
      ed.fsel = -1;
      ed.mode = "annotate";
      $("f-flatten").checked = false;
      $("edit-name").textContent = info.file.name;
      $("edit-work").hidden = false;
      $("doc-empty").classList.add("has-doc");
      clearStatus(editStatus);
      if (ed.fields.length) setStatus(editStatus, "info", "This PDF has " + plural(ed.fields.length, "fillable field") + ". Use Fill form to complete them.");
      editUi();
      await editRender();
    },
    onShow: async () => { if (ed.needsRender) await editRender(); }
  };
  wireSingle("edit", tools.document);

  // ---------- Installed-app extras ----------
  // Only present in the hosted build. When the operating system opens a PDF with this app,
  // Chrome hands the file over here; it then takes exactly the same path as the picker.
  async function openLaunchedFile(file){
    try {
      work.steps = []; work.undo = [];
      const info = await prepare(file);
      setCurrent(info);
      await syncTool(activeTool);
      setStatus(editStatus, "info", "Opened " + file.name + " from your computer.");
      return true;
    } catch (err) {
      setStatus(editStatus, "error", err.message || "Couldn't open that file.");
      return false;
    }
  }
  window.__openLaunchedFile = openLaunchedFile;   // the suites exercise this path
  if (window.launchQueue && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(async launch => {
      if (!launch || !launch.files || !launch.files.length) return;
      await openLaunchedFile(await launch.files[0].getFile());
    });
  }
  // A service worker keeps the installed app working with no network. It caches this one
  // page and nothing else; it never fetches anything from anywhere else.
  if (window.__PDFKIT_PWA && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
  // second picker inside the workspace ("Open another")
  $("edit-input2").addEventListener("change", async () => {
    const f = $("edit-input2").files[0];
    $("edit-input2").value = "";
    if (!f) return;
    try { const info = await prepare(f); work.steps = []; work.undo = []; setCurrent(info); await syncTool(activeTool); }
    catch (err) { setStatus(editStatus, "error", err.message); }
  });

  // ================= Existing text: find it, replace it =================
  // A PDF draws text as glyph codes at absolute positions, so "editing" means finding the
  // exact show-text operator behind what was clicked, deleting it from the content stream,
  // and drawing the replacement in its place. Deleting the operator (rather than painting
  // over it) keeps the background, rules and logos underneath intact.
  const SHOW_OPS = { Tj: 1, TJ: 1, "'": 1, '"': 1 };

  // Tokenise a content stream far enough to track colour, font and the show-text operators.
  function parseContentOps(text, startCtm){
    const ops = [];
    ops.forms = [];
    let i = 0, n = text.length;
    let operands = [], opStart = 0;
    const state = { fill: [0, 0, 0], font: null, size: 0, ctm: (startCtm || [1, 0, 0, 1, 0, 0]).slice() };
    const stack = [];
    // text matrices, so each show-text operator can be located on the page
    let tm = null, tlm = null, leading = 0, placed = false;
    const mul = (a, b) => [
      a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
    const isWS = c => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
    const num = v => { const f = parseFloat(v); return isFinite(f) ? f : 0; };
    while (i < n) {
      const c = text[i];
      if (isWS(c)) { i++; continue; }
      if (!operands.length) opStart = i;
      if (c === "%") { while (i < n && text[i] !== "\n") i++; continue; }
      if (c === "(") {                      // literal string
        let depth = 1, j = i + 1;
        while (j < n && depth) { if (text[j] === "\\") j++; else if (text[j] === "(") depth++; else if (text[j] === ")") depth--; j++; }
        operands.push({ type: "str", start: i, end: j }); i = j; continue;
      }
      if (c === "<" && text[i + 1] !== "<") { const j = text.indexOf(">", i); operands.push({ type: "str", start: i, end: j + 1 }); i = j + 1; continue; }
      if (c === "<" && text[i + 1] === "<") { // dictionary: skip it
        let depth = 1, j = i + 2;
        while (j < n && depth) { if (text[j] === "<" && text[j + 1] === "<") { depth++; j += 2; } else if (text[j] === ">" && text[j + 1] === ">") { depth--; j += 2; } else j++; }
        operands.push({ type: "dict", start: i, end: j }); i = j; continue;
      }
      if (c === "[") { let depth = 1, j = i + 1;
        while (j < n && depth) { if (text[j] === "\\") j++; else if (text[j] === "(") { let d2 = 1; j++; while (j < n && d2) { if (text[j] === "\\") j++; else if (text[j] === "(") d2++; else if (text[j] === ")") d2--; j++; } continue; }
          else if (text[j] === "[") depth++; else if (text[j] === "]") depth--; j++; }
        operands.push({ type: "array", start: i, end: j }); i = j; continue;
      }
      if (c === "/") { let j = i + 1; while (j < n && !isWS(text[j]) && !"/[]<>(){}%".includes(text[j])) j++; operands.push({ type: "name", value: text.slice(i + 1, j) }); i = j; continue; }
      if (/[\d+\-.]/.test(c)) { let j = i; while (j < n && /[\d+\-.eE]/.test(text[j])) j++; operands.push({ type: "num", value: text.slice(i, j) }); i = j; continue; }
      // operator
      let j = i; while (j < n && !isWS(text[j]) && !"/[]<>(){}%".includes(text[j])) j++;
      const op = text.slice(i, j);
      const opEnd = j;
      // The transform is part of the graphics state: without saving and restoring it, a
      // "cm" used to place a logo keeps scaling every position after the matching Q.
      if (op === "q") stack.push({ fill: state.fill.slice(), font: state.font, size: state.size, ctm: state.ctm.slice() });
      else if (op === "Q") { const s = stack.pop(); if (s) Object.assign(state, s); }
      else if (op === "Tf" && operands.length >= 2) { state.font = operands[operands.length - 2].value; state.size = num(operands[operands.length - 1].value); }
      else if (op === "rg" && operands.length >= 3) state.fill = operands.slice(-3).map(o => num(o.value));
      else if (op === "g" && operands.length >= 1) { const v = num(operands[operands.length - 1].value); state.fill = [v, v, v]; }
      else if (op === "k" && operands.length >= 4) { const [cy, m, ye, k] = operands.slice(-4).map(o => num(o.value)); state.fill = [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - ye) * (1 - k)]; }
      else if (op === "cm" && operands.length >= 6) state.ctm = mul(operands.slice(-6).map(o => num(o.value)), state.ctm);
      else if (op === "BT") { tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); placed = true; }
      else if (op === "ET") { tm = tlm = null; }
      else if (op === "Tm" && operands.length >= 6) { tm = operands.slice(-6).map(o => num(o.value)); tlm = tm.slice(); placed = true; }
      else if ((op === "Td" || op === "TD") && operands.length >= 2 && tlm) {
        const [tx, ty] = operands.slice(-2).map(o => num(o.value));
        if (op === "TD") leading = -ty;
        tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm.slice(); placed = true;
      }
      else if (op === "TL" && operands.length) leading = num(operands[operands.length - 1].value);
      else if (op === "T*" && tlm) { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); placed = true; }
      else if (op === "Do") {
        ops.sawForm = true;
        const nm = operands.length ? operands[operands.length - 1].value : null;
        if (nm) ops.forms.push({ name: nm, ctm: state.ctm.slice() });
      }
      else if (SHOW_OPS[op]) {
        if ((op === "'" || op === '"') && tlm) { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); placed = true; }
        const m = tm ? mul([state.size, 0, 0, state.size, 0, 0], mul(tm, state.ctm)) : null;
        ops.push({ op, start: opStart, end: opEnd, fill: state.fill.slice(), font: state.font, size: state.size,
                   matrix: m, located: !!(m && placed) });
        placed = false;   // a following show op without repositioning sits at an unknown offset
      }
      operands = []; i = j;
      continue;
    }
    // Whatever transform is still in force at the end of the stream applies to anything
    // appended after it. Chrome's print-to-PDF, for one, opens the page with a flipped
    // scale that it never closes.
    ops.endCtm = state.ctm.slice();
    return ops;
  }

  // Decoded content of a page as one string, plus how to write it back.
  async function pageContent(doc, pageIndex){
    const page = doc.getPages()[pageIndex];
    const contents = page.node.get(N("Contents"));
    const ctx = doc.context;
    const refs = [];
    const obj = ctx.lookup(contents);
    if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) refs.push(obj.get(i)); }
    else if (contents instanceof PDFRef) refs.push(contents);
    const parts = refs.map(r => {
      const s = ctx.lookup(r);
      return s ? bytesToBin(PDFLib.decodePDFRawStream(s).decode()) : "";
    });
    return { page, refs, parts, text: parts.join("\n") };
  }

  // Replace one show-text operator with new text drawn in a chosen font.
  // The original operator is deleted from the stream, so whatever was behind it stays.
  // Rewrites whole paragraphs: every original line of the block is removed, and the new
  // text is laid out again inside the block's box (which the person may have moved).
  // Wrap that keeps every character: at each break exactly one space becomes the line break
  // and nothing else is dropped or collapsed, so offsets into the text are the same before
  // and after. Spaces left at the end of a line are allowed to hang past the edge. This is
  // what on-page typing needs; a caret counted in characters stays where it was.
  function wrapExact(font, text, size, maxW){
    const out = [];
    for (const para of String(text).split("\n")) {
      const parts = para.split(/(\s+)/);                  // words and the runs between them
      let line = "", pendingSep = "";
      for (let k = 0; k < parts.length; k++) {
        const part = parts[k];
        if (k % 2 === 1) { pendingSep = part; continue; }
        const word = part;
        if (k === 0) { line = word; continue; }
        const cand = line + pendingSep + word;
        if (!word || font.widthOfTextAtSize(cand.replace(/\s+$/, ""), size) <= maxW || !line.trim()) line = cand;
        else {
          out.push(line + pendingSep.slice(1));              // one space of the run is the break
          line = word;
        }
        pendingSep = "";
      }
      out.push(line + pendingSep);
    }
    return out;
  }
  function wrapToWidth(font, text, size, maxW){
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const cand = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(cand, size) <= maxW || !line) line = cand;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }
  async function applyTextEdits(doc, edits, rawDraw, rawPage){
    // edits: [{ page, stream, ops:[{opStart,opEnd}], text, fontName, size, fill, x, top, width, leading }]
    // rawDraw is operator text to append to rawPage — needed on its own when there is
    // nothing to delete, such as a redaction over blank space or a new text box.
    const byPage = new Map();
    edits.forEach(e => { if (!byPage.has(e.page)) byPage.set(e.page, []); byPage.get(e.page).push(e); });
    if (rawDraw && rawPage != null && !byPage.has(rawPage)) byPage.set(rawPage, []);
    docFontCache.clear();
    for (const [pageIndex, all] of byPage) {
      const streams = await allPageOps(doc, pageIndex);
      // edits inside a form are written into that form's own stream
      for (const [id, st] of streams.streams) {
        const list = all.filter(e => e.stream === id);
        if (!list.length) continue;
        await rewriteStream(doc, pageIndex, st.text, st.endCtm, list, out => {
          const s2 = doc.context.flateStream(enc8(out));
          const old = doc.context.lookup(st.ref);
          if (old && old.dict) { for (const [k, v] of old.dict.entries()) if (String(k) !== "/Length" && String(k) !== "/Filter") s2.dict.set(k, v); }
          doc.context.assign(st.ref, s2);
        }, st.dict);
      }
      const list = all.filter(e => !e.stream);
      // raw drawing belongs to one page only
      const drawHere = (rawDraw && (rawPage == null || rawPage === pageIndex)) ? rawDraw : "";
      if (!list.length && !drawHere) continue;
      const { page, text } = await pageContent(doc, pageIndex);
      await rewriteStream(doc, pageIndex, text, null, list, out => {
        const stream = doc.context.flateStream(enc8(out));
        page.node.set(N("Contents"), doc.context.register(stream));
      }, null, drawHere);
    }
  }

  // Remove the operators an edit replaces and append the new text, in whichever stream the
  // text lives in, drawn under the inverse of the transform in force where it is appended.
  async function rewriteStream(doc, pageIndex, text, knownEndCtm, list, commit, resDict, rawDraw){
    {
      const page = doc.getPages()[pageIndex];
      const endCtm = knownEndCtm || parseContentOps(text).endCtm || [1, 0, 0, 1, 0, 0];
      const det = endCtm[0] * endCtm[3] - endCtm[1] * endCtm[2];
      const inv = Math.abs(det) < 1e-9 ? null : [
        endCtm[3] / det, -endCtm[1] / det, -endCtm[2] / det, endCtm[0] / det,
        (endCtm[2] * endCtm[5] - endCtm[3] * endCtm[4]) / det,
        (endCtm[1] * endCtm[4] - endCtm[0] * endCtm[5]) / det];
      const reset = inv ? inv.map(v => Math.round(v * 100000) / 100000).join(" ") + " cm " : "";
      let out = text;
      const cuts = [];
      list.forEach(e => (e.ops || []).forEach(o => cuts.push(o)));
      // Matching reported lines to operators can miss pieces — a word drawn in two halves,
      // a stray repositioned fragment — and a missed piece shows through the replacement.
      // So anything standing inside the area being rewritten goes too.
      const boxes = list.map(e => e.box).filter(Boolean);
      if (boxes.length) {
        try {
          const all = await allPageOps(doc, pageIndex);
          all.forEach(o => {
            if (!o.located || !o.matrix || o.stream) return;
            const size = Math.hypot(o.matrix[0], o.matrix[1]) || 10;
            const px = o.matrix[4], py = o.matrix[5];
            const inside = boxes.some(q => px >= q.x - size * 0.5 && px <= q.x + q.w + size * 0.5 &&
                                           py >= q.y - size * 0.5 && py <= q.y + q.h + size * 0.5);
            if (inside) cuts.push({ opStart: o.start, opEnd: o.end });
          });
        } catch (err) { /* the matched operators still go */ }
      }
      cuts.sort((a, b) => b.opStart - a.opStart).forEach(o => {
        out = out.slice(0, o.opStart) + " ".repeat(o.opEnd - o.opStart) + out.slice(o.opEnd);
      });
      let add = rawDraw || "";
      for (const e of list) {
        // Prefer the document's own font: the resource is already on the page, and the
        // text is written in that font's character codes. If it lacks a character the
        // person typed, fall back to a bundled font for that line rather than dropping it.
        const wantDoc = typeof e.fontName === "string" && e.fontName.indexOf("doc") === 0 && e.docFontRes;
        const dinfo = wantDoc ? documentFont(doc, pageIndex, e.docFontRes, resDict) : null;
        const rawBody = (e.text || "").trim();
        const canDoc = dinfo && dinfo.usable && [...rawBody.replace(/\n/g, "")].every(ch => ch === " " || dinfo.toCode.has(ch));
        const body = canDoc ? rawBody : cleanText(e.text || "").text.trim();
        if (!body) continue;                          // emptying a block deletes its text
        let key, encode, measure;
        if (canDoc) {
          key = { asString: () => "/" + String(dinfo.name).replace(/^\//, "") };
          encode = t => encodeWithDocFont(dinfo, t) || "<>";
          measure = (t, sz) => widthWithDocFont(dinfo, t, sz);
        } else {
          const font = await doc.embedFont(/^doc/.test(e.fontName || "") ? StandardFonts.Helvetica : (e.fontName || StandardFonts.Helvetica));
          if (resDict) {
            const res = resourcesOf(doc, pageIndex, resDict);
            let fonts = res.lookup(N("Font"));
            if (!(fonts instanceof PDFDict)) { fonts = doc.context.obj({}); res.set(N("Font"), fonts); }
            fonts.set(N(font.name), font.ref);
            key = { asString: () => "/" + font.name };
          } else {
            key = page.node.newFontDictionary(font.name, font.ref);
          }
          encode = t => font.encodeText(t).toString();
          measure = (t, sz) => font.widthOfTextAtSize(t, sz);
        }
        const size = e.size || 11;
        const alignF = e.align === "center" ? 0.5 : e.align === "right" ? 1 : 0;      // how far along the spare width a line starts
        const typed = body.split("\n");
        const [r, g, b] = e.fill || [0, 0, 0];
        const head = "\nq " + reset + "BT 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr " + key.asString() + " " + size + " Tf " + r + " " + g + " " + b + " rg ";
        // Same number of lines as the original? Then each line keeps its own baseline, which
        // is what holds table columns and addresses together. Otherwise the block reflows.
        const boxes = e.lineBoxes || [];
        const maxW = Math.max(size, e.width || 200);
        // Keep the original baselines only while every line still fits; a line that has
        // outgrown its space has to re-wrap or it runs off the page.
        const fits = !e.resized && boxes.length === typed.length &&
          typed.every((ln, i) => measure(ln, size) <= Math.max(boxes[i].w, maxW) * 1.02);
        if (fits) {
          add += head;
          typed.forEach((ln, i) => {
            let bx = boxes[i].x + (e.dx || 0);
            const by = boxes[i].y + (e.dy || 0);
            if (alignF) bx = e.x + alignF * Math.max(0, maxW - measure(ln, size));     // aligned inside the block's width
            add += " 1 0 0 1 " + (Math.round(bx * 100) / 100) + " " + (Math.round(by * 100) / 100) + " Tm " +
                   encode(ln) + " Tj";
          });
          add += " ET Q";
        } else {
          const lines = [];
          const wrapW = e.resized ? Math.max(size, e.width) : maxW;
          typed.forEach(t => wrapToWidth({ widthOfTextAtSize: measure }, t, size, wrapW).forEach(l => lines.push(l)));
          const leading = e.leading && e.leading > size * 0.8 ? e.leading : size * LINE;
          if (alignF) {
            // each line starts at its own x, so every line is placed rather than stepped down with T*
            add += head;
            lines.forEach((ln, i) => {
              const lx = e.x + alignF * Math.max(0, wrapW - measure(ln, size)), ly = (e.top - size) - i * leading;
              add += " 1 0 0 1 " + (Math.round(lx * 100) / 100) + " " + (Math.round(ly * 100) / 100) + " Tm " + encode(ln) + " Tj";
            });
            add += " ET Q";
          } else {
            add += head + leading + " TL 1 0 0 1 " + (Math.round(e.x * 100) / 100) + " " +
                   (Math.round((e.top - size) * 100) / 100) + " Tm";
            lines.forEach((ln, i) => { add += (i ? " T* " : " ") + encode(ln) + " Tj"; });
            add += " ET Q";
          }
        }
      }
      commit(out + add);
    }
  }

  // ================= Using the document's own fonts =================
  // A PDF has no bold or italic switch: bold text is simply a different font resource. So
  // to match the document we reuse the very resource that drew the line, writing the new
  // text in that font's own character codes.
  // Standard text encodings, generated from the published tables (Adobe glyph list,
  // StandardEncoding, MacRomanEncoding, WinAnsiEncoding = cp1252 with PDF's tweaks).
  const ENCODINGS = {
    Standard: "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 !\"#$%&\u2019()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\u2018abcdefghijklmnopqrstuvwxyz{|}~\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u00a1\u00a2\u00a3\u2044\u00a5\u0192\u00a7\u00a4'\u201c\u00ab\u2039\u203a\u0000\u0000\u0000\u2013\u2020\u2021\u00b7\u0000\u00b6\u2022\u201a\u201e\u201d\u00bb\u2026\u2030\u0000\u00bf\u0000`\u00b4\u02c6\u02dc\u00af\u02d8\u02d9\u00a8\u0000\u02da\u00b8\u0000\u02dd\u02db\u02c7\u2014\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u00c6\u0000\u00aa\u0000\u0000\u0000\u0000\u0141\u00d8\u0152\u00ba\u0000\u0000\u0000\u0000\u0000\u00e6\u0000\u0000\u0000\u0131\u0000\u0000\u0142\u00f8\u0153\u00df\u0000\u0000\u0000\u0000",
    MacRoman: "\u0000\u00d0\u00f0\u0141\u0142\u0160\u0161\u00dd\u00fd\u0000\u0000\u00de\u00fe\u0000\u017d\u017e\u0000\u0000\u0000\u0000\u0000\u00bd\u00bc\u0000\u00be\u0000\u0000\u00a6\u2212\u00d7\u0000\u0000 !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u0000\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u2126\u00e6\u00f8\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u0000\u00c0\u00c3\u00d5\u0152\u0153\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u00a4\u2039\u203a\u0000\u0000\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4\u0000\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7",
    WinAnsi: "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u007f\u20ac\u0000\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u0000\u017d\u0000\u0000\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u0000\u017e\u0178 \u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac-\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff"
  };
  const GLYPH_NAMES = {"A": "A", "AE": "Æ", "AEacute": "Ǽ", "Aacute": "Á", "Abreve": "Ă", "Acircumflex": "Â", "Adieresis": "Ä", "Agrave": "À", "Alpha": "Α", "Alphatonos": "Ά", "Amacron": "Ā", "Aogonek": "Ą", "Aring": "Å", "Aringacute": "Ǻ", "Atilde": "Ã", "B": "B", "Beta": "Β", "C": "C", "Cacute": "Ć", "Ccaron": "Č", "Ccedilla": "Ç", "Ccircumflex": "Ĉ", "Cdotaccent": "Ċ", "Chi": "Χ", "D": "D", "Dcaron": "Ď", "Dcroat": "Đ", "Delta": "∆", "E": "E", "Eacute": "É", "Ebreve": "Ĕ", "Ecaron": "Ě", "Ecircumflex": "Ê", "Edieresis": "Ë", "Edotaccent": "Ė", "Egrave": "È", "Emacron": "Ē", "Eng": "Ŋ", "Eogonek": "Ę", "Epsilon": "Ε", "Epsilontonos": "Έ", "Eta": "Η", "Etatonos": "Ή", "Eth": "Ð", "Euro": "€", "F": "F", "G": "G", "Gamma": "Γ", "Gbreve": "Ğ", "Gcaron": "Ǧ", "Gcircumflex": "Ĝ", "Gdotaccent": "Ġ", "H": "H", "H18533": "●", "H18543": "▪", "H18551": "▫", "H22073": "□", "Hbar": "Ħ", "Hcircumflex": "Ĥ", "I": "I", "IJ": "Ĳ", "Iacute": "Í", "Ibreve": "Ĭ", "Icircumflex": "Î", "Idieresis": "Ï", "Idotaccent": "İ", "Ifraktur": "ℑ", "Igrave": "Ì", "Imacron": "Ī", "Iogonek": "Į", "Iota": "Ι", "Iotadieresis": "Ϊ", "Iotatonos": "Ί", "Itilde": "Ĩ", "J": "J", "Jcircumflex": "Ĵ", "K": "K", "Kappa": "Κ", "L": "L", "Lacute": "Ĺ", "Lambda": "Λ", "Lcaron": "Ľ", "Ldot": "Ŀ", "Lslash": "Ł", "M": "M", "Mu": "Μ", "N": "N", "Nacute": "Ń", "Ncaron": "Ň", "Ntilde": "Ñ", "Nu": "Ν", "O": "O", "OE": "Œ", "Oacute": "Ó", "Obreve": "Ŏ", "Ocircumflex": "Ô", "Odieresis": "Ö", "Ograve": "Ò", "Ohorn": "Ơ", "Ohungarumlaut": "Ő", "Omacron": "Ō", "Omega": "Ω", "Omegatonos": "Ώ", "Omicron": "Ο", "Omicrontonos": "Ό", "Oslash": "Ø", "Oslashacute": "Ǿ", "Otilde": "Õ", "P": "P", "Phi": "Φ", "Pi": "Π", "Psi": "Ψ", "Q": "Q", "R": "R", "Racute": "Ŕ", "Rcaron": "Ř", "Rfraktur": "ℜ", "Rho": "Ρ", "S": "S", "SF010000": "┌", "SF020000": "└", "SF030000": "┐", "SF040000": "┘", "SF050000": "┼", "SF060000": "┬", "SF070000": "┴", "SF080000": "├", "SF090000": "┤", "SF100000": "─", "SF110000": "│", "SF190000": "╡", "SF200000": "╢", "SF210000": "╖", "SF220000": "╕", "SF230000": "╣", "SF240000": "║", "SF250000": "╗", "SF260000": "╝", "SF270000": "╜", "SF280000": "╛", "SF360000": "╞", "SF370000": "╟", "SF380000": "╚", "SF390000": "╔", "SF400000": "╩", "SF410000": "╦", "SF420000": "╠", "SF430000": "═", "SF440000": "╬", "SF450000": "╧", "SF460000": "╨", "SF470000": "╤", "SF480000": "╥", "SF490000": "╙", "SF500000": "╘", "SF510000": "╒", "SF520000": "╓", "SF530000": "╫", "SF540000": "╪", "Sacute": "Ś", "Scaron": "Š", "Scedilla": "Ş", "Scircumflex": "Ŝ", "Sigma": "Σ", "T": "T", "Tau": "Τ", "Tbar": "Ŧ", "Tcaron": "Ť", "Theta": "Θ", "Thorn": "Þ", "U": "U", "Uacute": "Ú", "Ubreve": "Ŭ", "Ucircumflex": "Û", "Udieresis": "Ü", "Ugrave": "Ù", "Uhorn": "Ư", "Uhungarumlaut": "Ű", "Umacron": "Ū", "Uogonek": "Ų", "Upsilon": "Υ", "Upsilon1": "ϒ", "Upsilondieresis": "Ϋ", "Upsilontonos": "Ύ", "Uring": "Ů", "Utilde": "Ũ", "V": "V", "W": "W", "Wacute": "Ẃ", "Wcircumflex": "Ŵ", "Wdieresis": "Ẅ", "Wgrave": "Ẁ", "X": "X", "Xi": "Ξ", "Y": "Y", "Yacute": "Ý", "Ycircumflex": "Ŷ", "Ydieresis": "Ÿ", "Ygrave": "Ỳ", "Z": "Z", "Zacute": "Ź", "Zcaron": "Ž", "Zdotaccent": "Ż", "Zeta": "Ζ", "a": "a", "aacute": "á", "abreve": "ă", "acircumflex": "â", "acute": "´", "acutecomb": "́", "adieresis": "ä", "ae": "æ", "aeacute": "ǽ", "agrave": "à", "aleph": "ℵ", "alpha": "α", "alphatonos": "ά", "amacron": "ā", "ampersand": "&", "angle": "∠", "angleleft": "〈", "angleright": "〉", "anoteleia": "·", "aogonek": "ą", "approxequal": "≈", "aring": "å", "aringacute": "ǻ", "arrowboth": "↔", "arrowdblboth": "⇔", "arrowdbldown": "⇓", "arrowdblleft": "⇐", "arrowdblright": "⇒", "arrowdblup": "⇑", "arrowdown": "↓", "arrowleft": "←", "arrowright": "→", "arrowup": "↑", "arrowupdn": "↕", "arrowupdnbse": "↨", "asciicircum": "^", "asciitilde": "~", "asterisk": "*", "asteriskmath": "∗", "at": "@", "atilde": "ã", "b": "b", "backslash": "\\", "bar": "|", "beta": "β", "block": "█", "braceleft": "{", "braceright": "}", "bracketleft": "[", "bracketright": "]", "breve": "˘", "brokenbar": "¦", "bullet": "•", "c": "c", "cacute": "ć", "caron": "ˇ", "carriagereturn": "↵", "ccaron": "č", "ccedilla": "ç", "ccircumflex": "ĉ", "cdotaccent": "ċ", "cedilla": "¸", "cent": "¢", "chi": "χ", "circle": "○", "circlemultiply": "⊗", "circleplus": "⊕", "circumflex": "ˆ", "club": "♣", "colon": ":", "colonmonetary": "₡", "comma": ",", "congruent": "≅", "copyright": "©", "currency": "¤", "d": "d", "dagger": "†", "daggerdbl": "‡", "dcaron": "ď", "dcroat": "đ", "degree": "°", "delta": "δ", "diamond": "♦", "dieresis": "¨", "dieresistonos": "΅", "divide": "÷", "dkshade": "▓", "dnblock": "▄", "dollar": "$", "dong": "₫", "dotaccent": "˙", "dotbelowcomb": "̣", "dotlessi": "ı", "dotmath": "⋅", "e": "e", "eacute": "é", "ebreve": "ĕ", "ecaron": "ě", "ecircumflex": "ê", "edieresis": "ë", "edotaccent": "ė", "egrave": "è", "eight": "8", "element": "∈", "ellipsis": "…", "emacron": "ē", "emdash": "—", "emptyset": "∅", "endash": "–", "eng": "ŋ", "eogonek": "ę", "epsilon": "ε", "epsilontonos": "έ", "equal": "=", "equivalence": "≡", "estimated": "℮", "eta": "η", "etatonos": "ή", "eth": "ð", "exclam": "!", "exclamdbl": "‼", "exclamdown": "¡", "existential": "∃", "f": "f", "female": "♀", "figuredash": "‒", "filledbox": "■", "filledrect": "▬", "five": "5", "fiveeighths": "⅝", "florin": "ƒ", "four": "4", "fraction": "⁄", "franc": "₣", "g": "g", "gamma": "γ", "gbreve": "ğ", "gcaron": "ǧ", "gcircumflex": "ĝ", "gdotaccent": "ġ", "germandbls": "ß", "gradient": "∇", "grave": "`", "gravecomb": "̀", "greater": ">", "greaterequal": "≥", "guillemotleft": "«", "guillemotright": "»", "guilsinglleft": "‹", "guilsinglright": "›", "h": "h", "hbar": "ħ", "hcircumflex": "ĥ", "heart": "♥", "hookabovecomb": "̉", "house": "⌂", "hungarumlaut": "˝", "hyphen": "-", "i": "i", "iacute": "í", "ibreve": "ĭ", "icircumflex": "î", "idieresis": "ï", "igrave": "ì", "ij": "ĳ", "imacron": "ī", "infinity": "∞", "integral": "∫", "integralbt": "⌡", "integraltp": "⌠", "intersection": "∩", "invbullet": "◘", "invcircle": "◙", "invsmileface": "☻", "iogonek": "į", "iota": "ι", "iotadieresis": "ϊ", "iotadieresistonos": "ΐ", "iotatonos": "ί", "itilde": "ĩ", "j": "j", "jcircumflex": "ĵ", "k": "k", "kappa": "κ", "kgreenlandic": "ĸ", "l": "l", "lacute": "ĺ", "lambda": "λ", "lcaron": "ľ", "ldot": "ŀ", "less": "<", "lessequal": "≤", "lfblock": "▌", "lira": "₤", "logicaland": "∧", "logicalnot": "¬", "logicalor": "∨", "longs": "ſ", "lozenge": "◊", "lslash": "ł", "ltshade": "░", "m": "m", "macron": "¯", "male": "♂", "minus": "−", "minute": "′", "mu": "µ", "multiply": "×", "musicalnote": "♪", "musicalnotedbl": "♫", "n": "n", "nacute": "ń", "napostrophe": "ŉ", "ncaron": "ň", "nine": "9", "notelement": "∉", "notequal": "≠", "notsubset": "⊄", "ntilde": "ñ", "nu": "ν", "numbersign": "#", "o": "o", "oacute": "ó", "obreve": "ŏ", "ocircumflex": "ô", "odieresis": "ö", "oe": "œ", "ogonek": "˛", "ograve": "ò", "ohorn": "ơ", "ohungarumlaut": "ő", "omacron": "ō", "omega": "ω", "omega1": "ϖ", "omegatonos": "ώ", "omicron": "ο", "omicrontonos": "ό", "one": "1", "onedotenleader": "․", "oneeighth": "⅛", "onehalf": "½", "onequarter": "¼", "onethird": "⅓", "openbullet": "◦", "ordfeminine": "ª", "ordmasculine": "º", "orthogonal": "∟", "oslash": "ø", "oslashacute": "ǿ", "otilde": "õ", "p": "p", "paragraph": "¶", "parenleft": "(", "parenright": ")", "partialdiff": "∂", "percent": "%", "period": ".", "periodcentered": "·", "perpendicular": "⊥", "perthousand": "‰", "peseta": "₧", "phi": "φ", "phi1": "ϕ", "pi": "π", "plus": "+", "plusminus": "±", "prescription": "℞", "product": "∏", "propersubset": "⊂", "propersuperset": "⊃", "proportional": "∝", "psi": "ψ", "q": "q", "question": "?", "questiondown": "¿", "quotedbl": "\"", "quotedblbase": "„", "quotedblleft": "“", "quotedblright": "”", "quoteleft": "‘", "quotereversed": "‛", "quoteright": "’", "quotesinglbase": "‚", "quotesingle": "'", "r": "r", "racute": "ŕ", "radical": "√", "rcaron": "ř", "reflexsubset": "⊆", "reflexsuperset": "⊇", "registered": "®", "revlogicalnot": "⌐", "rho": "ρ", "ring": "˚", "rtblock": "▐", "s": "s", "sacute": "ś", "scaron": "š", "scedilla": "ş", "scircumflex": "ŝ", "second": "″", "section": "§", "semicolon": ";", "seven": "7", "seveneighths": "⅞", "shade": "▒", "sigma": "σ", "sigma1": "ς", "similar": "∼", "six": "6", "slash": "/", "smileface": "☺", "space": " ", "spade": "♠", "sterling": "£", "suchthat": "∋", "summation": "∑", "sun": "☼", "t": "t", "tau": "τ", "tbar": "ŧ", "tcaron": "ť", "therefore": "∴", "theta": "θ", "theta1": "ϑ", "thorn": "þ", "three": "3", "threeeighths": "⅜", "threequarters": "¾", "tilde": "˜", "tildecomb": "̃", "tonos": "΄", "trademark": "™", "triagdn": "▼", "triaglf": "◄", "triagrt": "►", "triagup": "▲", "two": "2", "twodotenleader": "‥", "twothirds": "⅔", "u": "u", "uacute": "ú", "ubreve": "ŭ", "ucircumflex": "û", "udieresis": "ü", "ugrave": "ù", "uhorn": "ư", "uhungarumlaut": "ű", "umacron": "ū", "underscore": "_", "underscoredbl": "‗", "union": "∪", "universal": "∀", "uogonek": "ų", "upblock": "▀", "upsilon": "υ", "upsilondieresis": "ϋ", "upsilondieresistonos": "ΰ", "upsilontonos": "ύ", "uring": "ů", "utilde": "ũ", "v": "v", "w": "w", "wacute": "ẃ", "wcircumflex": "ŵ", "wdieresis": "ẅ", "weierstrass": "℘", "wgrave": "ẁ", "x": "x", "xi": "ξ", "y": "y", "yacute": "ý", "ycircumflex": "ŷ", "ydieresis": "ÿ", "yen": "¥", "ygrave": "ỳ", "z": "z", "zacute": "ź", "zcaron": "ž", "zdotaccent": "ż", "zero": "0", "zeta": "ζ"};
  const docFontCache = new Map();

  function parseToUnicode(text){
    // Maps a font's character codes to the text they produce; we need it the other way
    // round, to turn typed text back into that font's codes.
    const toCode = new Map();
    const hex = h => parseInt(h, 16);
    const str = h => {
      // UTF-16BE, so surrogate pairs come out as one character
      let out = "";
      for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
      return out;
    };
    const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
    let m;
    while ((m = charRe.exec(text))) {
      const pairs = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
      pairs.forEach(pair => {
        const p = pair.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        const s = str(p[2]);
        if (s && !toCode.has(s)) toCode.set(s, { code: hex(p[1]), bytes: p[1].length / 2 });
      });
    }
    const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = rangeRe.exec(text))) {
      const body = m[1];
      const simple = body.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
      simple.forEach(r => {
        const p = r.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        const lo = hex(p[1]), hi = hex(p[2]), start = str(p[3]);
        if (!start || start.length !== 1) return;
        for (let c = lo; c <= hi && c - lo < 512; c++) {
          const ch = String.fromCharCode(start.charCodeAt(0) + (c - lo));
          if (!toCode.has(ch)) toCode.set(ch, { code: c, bytes: p[1].length / 2 });
        }
      });
    }
    return toCode;
  }

  // Fonts without a ToUnicode table usually still declare a standard encoding, which says
  // exactly which character each code produces. That covers the built-in fonts and most
  // older documents.
  function encodingMap(doc, fontDict){
    const ctx = doc.context;
    const enc = fontDict.lookup(N("Encoding"));
    let baseName = "Standard", diffs = null;
    const pick = nm => /WinAnsi/.test(nm) ? "WinAnsi" : /MacRoman/.test(nm) ? "MacRoman" : /Standard|PDFDoc/.test(nm) ? "Standard" : null;
    if (enc instanceof PDFName) baseName = pick(enc.asString()) || "Standard";
    else if (enc instanceof PDFDict) {
      const be = enc.lookup(N("BaseEncoding"));
      if (be instanceof PDFName) baseName = pick(be.asString()) || "Standard";
      const d = enc.lookup(N("Differences"));
      if (d instanceof PDFArray) diffs = d;
    } else if (!(enc instanceof PDFName)) {
      // a symbolic font with no encoding: its codes mean whatever the font says they do
      const fd = fontDict.lookup(N("FontDescriptor"));
      const flags = fd instanceof PDFDict ? fd.lookup(N("Flags")) : null;
      if (flags instanceof PDFNumber && (flags.asNumber() & 4) && !(flags.asNumber() & 32)) return null;
    }
    const table = ENCODINGS[baseName] || ENCODINGS.Standard;
    const toCode = new Map();
    for (let c = 0; c < 256; c++) {
      const ch = table[c];
      if (ch && ch !== "\u0000" && !toCode.has(ch)) toCode.set(ch, { code: c, bytes: 1 });
    }
    if (diffs) {                       // named glyphs that override the base encoding
      let code = 0;
      for (let i = 0; i < diffs.size(); i++) {
        const v = diffs.lookup(i);
        if (v instanceof PDFNumber) { code = v.asNumber(); continue; }
        if (v instanceof PDFName) {
          const nm = v.asString().replace(/^\//, "");
          const ch = GLYPH_NAMES[nm] || (/^uni([0-9A-Fa-f]{4})$/.test(nm) ? String.fromCharCode(parseInt(nm.slice(3), 16)) : null);
          if (ch) toCode.set(ch, { code, bytes: 1 });
          code++;
        }
      }
    }
    return toCode;
  }

  function readWidths(doc, fontDict){
    // Glyph widths in 1/1000 em, so wrapping measures with the real font.
    const ctx = doc.context, W = new Map();
    let dflt = 500;
    const sub = fontDict.lookup(N("Subtype"));
    const isType0 = sub instanceof PDFName && sub.asString() === "/Type0";
    if (isType0) {
      const desc = fontDict.lookup(N("DescendantFonts"));
      const d0 = desc instanceof PDFArray ? ctx.lookup(desc.get(0)) : null;
      if (d0 instanceof PDFDict) {
        const dw = d0.lookup(N("DW"));
        if (dw instanceof PDFNumber) dflt = dw.asNumber();
        const w = d0.lookup(N("W"));
        if (w instanceof PDFArray) {
          for (let i = 0; i < w.size();) {
            const first = w.lookup(i);
            const next = w.lookup(i + 1);
            if (next instanceof PDFArray) {
              const start = first.asNumber();
              for (let k = 0; k < next.size(); k++) W.set(start + k, next.lookup(k).asNumber());
              i += 2;
            } else if (next instanceof PDFNumber) {
              const lo = first.asNumber(), hi = next.asNumber(), val = w.lookup(i + 2);
              if (val instanceof PDFNumber) for (let c = lo; c <= hi && c - lo < 2048; c++) W.set(c, val.asNumber());
              i += 3;
            } else break;
          }
        }
      }
    } else {
      const fc = fontDict.lookup(N("FirstChar"));
      const widths = fontDict.lookup(N("Widths"));
      if (fc instanceof PDFNumber && widths instanceof PDFArray) {
        const start = fc.asNumber();
        for (let i = 0; i < widths.size(); i++) {
          const v = widths.lookup(i);
          if (v instanceof PDFNumber) W.set(start + i, v.asNumber());
        }
      }
      const fd = fontDict.lookup(N("FontDescriptor"));
      if (fd instanceof PDFDict) {
        const mw = fd.lookup(N("MissingWidth"));
        if (mw instanceof PDFNumber) dflt = mw.asNumber();
      }
    }
    return { W, dflt, isType0 };
  }

  // Everything needed to write new text in a font the document already carries.
  function resourcesOf(doc, pageIndex, streamDict){
    if (streamDict) {
      let r = streamDict.lookup(N("Resources"));
      if (!(r instanceof PDFDict)) { r = doc.context.obj({}); streamDict.set(N("Resources"), r); }
      return r;
    }
    return doc.getPages()[pageIndex].node.Resources();
  }
  function fontDictIn(res, name){
    const fonts = res && res.lookup(N("Font"));
    return fonts instanceof PDFDict ? fonts.lookup(N(String(name).replace(/^\//, ""))) : null;
  }
  function documentFont(doc, pageIndex, resourceName, streamDict){
    const key = pageIndex + "/" + (streamDict ? String(streamDict) : "page") + "/" + resourceName;
    if (docFontCache.has(key)) return docFontCache.get(key);
    let info = null;
    try {
      const fd = fontDictIn(resourcesOf(doc, pageIndex, streamDict), resourceName);
      if (fd instanceof PDFDict) {
        const tu = fd.lookup(N("ToUnicode"));
        let toCode = tu instanceof PDFRawStream ? parseToUnicode(bytesToBin(PDFLib.decodePDFRawStream(tu).decode())) : new Map();
        let source = toCode.size ? "map" : "";
        if (!toCode.size) {
          const sub = fd.lookup(N("Subtype"));
          const simple = !(sub instanceof PDFName && sub.asString() === "/Type0");
          const fromEnc = simple ? encodingMap(doc, fd) : null;
          if (fromEnc && fromEnc.size) { toCode = fromEnc; source = "encoding"; }
        }
        const base = fd.lookup(N("BaseFont"));
        const { W, dflt, isType0 } = readWidths(doc, fd);
        info = {
          name: resourceName, toCode, source, widths: W, defaultWidth: dflt, isType0,
          baseFont: base instanceof PDFName ? base.asString().replace(/^\/(\w{6}\+)?/, "") : "",
          usable: toCode.size > 0
        };
      }
    } catch (e) { info = null; }
    docFontCache.set(key, info);
    return info;
  }

  // Encode text in the font's own codes; returns null if it lacks any character.
  function encodeWithDocFont(info, text){
    let hex = "";
    for (const ch of String(text)) {
      const g = info.toCode.get(ch);
      if (!g) return null;
      hex += g.code.toString(16).toUpperCase().padStart((g.bytes || (info.isType0 ? 2 : 1)) * 2, "0");
    }
    return "<" + hex + ">";
  }
  function widthWithDocFont(info, text, size){
    if (!info.isType0 && !info.widths.size) {
      // Standard-14 fonts carry no /Widths; use the built-in metrics.
      const b = info.baseFont || "";
      const bold = /bold/i.test(b);
      const key = /courier/i.test(b) ? "Courier" : /times/i.test(b) ? (bold ? "Times-Bold" : "Times-Roman") : /helvetica|arial/i.test(b) ? (bold ? "Helvetica-Bold" : "Helvetica") : null;
      const f = key && stdFonts[key];
      if (f) { try { return f.widthOfTextAtSize(String(text), size); } catch (e) { /* fall through */ } }
    }
    let total = 0;
    for (const ch of String(text)) {
      const g = info.toCode.get(ch);
      const w = g && info.widths.has(g.code) ? info.widths.get(g.code) : info.defaultWidth;
      total += w;
    }
    return total * size / 1000;
  }
  // Bold and italic are separate resources; find the document's companion for one.
  function siblingFont(doc, pageIndex, info, want){
    if (!info || !info.baseFont) return null;
    const stem = info.baseFont.replace(/[-,]?(Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman)+$/i, "");
    const page = doc.getPages()[pageIndex];
    const fonts = page.node.Resources() && page.node.Resources().lookup(N("Font"));
    if (!(fonts instanceof PDFDict)) return null;
    for (const [k] of fonts.entries()) {
      const cand = documentFont(doc, pageIndex, k.asString());
      if (!cand || !cand.usable || cand.name === info.name) continue;
      const cstem = cand.baseFont.replace(/[-,]?(Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman)+$/i, "");
      if (cstem !== stem) continue;
      const isBold = /bold/i.test(cand.baseFont), isItal = /italic|oblique/i.test(cand.baseFont);
      if (want === "bold" && isBold && !isItal) return cand;
      if (want === "italic" && isItal && !isBold) return cand;
      if (want === "bolditalic" && isBold && isItal) return cand;
      if (want === "regular" && !isBold && !isItal) return cand;
    }
    return null;
  }


  // A page's own operators, plus those inside any form it draws. Forms are separate
  // streams — headers, footers and letterhead usually live in one — so each operator
  // remembers which stream it came from and gets edited there.
  async function allPageOps(doc, pageIndex){
    const { page, text } = await pageContent(doc, pageIndex);
    const ops = parseContentOps(text);
    ops.forEach(o => { o.stream = null; });
    const out = ops.slice();
    out.endCtm = ops.endCtm;
    out.sawForm = ops.sawForm;
    out.streams = new Map();
    const res = page.node.Resources();
    const xo = res && res.lookup(N("XObject"));
    if (xo instanceof PDFDict) {
      for (const form of ops.forms) {
        const key = N(String(form.name).replace(/^\//, ""));
        const ref = xo.get(key);
        const st = doc.context.lookup(ref);
        if (!(st instanceof PDFRawStream)) continue;
        const sub = st.dict.lookup(N("Subtype"));
        if (!(sub instanceof PDFName) || sub.asString() !== "/Form") continue;
        if (out.streams.has(String(ref))) continue;         // drawn more than once
        const mtx = st.dict.lookup(N("Matrix"));
        const m = mtx instanceof PDFArray ? mtx.asArray().map(x => x.asNumber()) : [1, 0, 0, 1, 0, 0];
        const mul = (a, b) => [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2],
                               a[2]*b[1]+a[3]*b[3], a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]];
        const body = bytesToBin(PDFLib.decodePDFRawStream(st).decode());
        const sub2 = parseContentOps(body, mul(m, form.ctm));
        const id = String(ref);
        sub2.forEach(o => { o.stream = id; });
        out.streams.set(id, { ref, text: body, endCtm: sub2.endCtm, dict: st.dict });
        sub2.forEach(o => out.push(o));
      }
    }
    return out;
  }

  // How many pages draw this form, so an edit can say what else it will change.
  function formPageCount(doc, streamId){
    let n = 0;
    doc.getPages().forEach(pg => {
      const res = pg.node.Resources();
      const xo = res && res.lookup(N("XObject"));
      if (!(xo instanceof PDFDict)) return;
      for (const [, v] of xo.entries()) if (String(v) === streamId) { n++; return; }
    });
    return n;
  }

  // ---------- Edit-text mode: overlays for the text already on the page ----------
  async function loadTextRuns(pageIndex){
    const doc = await loadPdf(ed.info.bytes.slice(0), ed.info.file.name);
    // Keep every show operator, not just the positioned ones: the unpositioned ones are the
    // continuation of a line and have to be deleted with it. This also reaches into the
    // forms the page draws, so headers and footers can be edited too.
    const ops = await allPageOps(doc, pageIndex);
    ed.formPages = new Map();
    ops.streams.forEach((_, id) => ed.formPages.set(id, formPageCount(doc, id)));
    const pg = await ed.view.getPage(pageIndex + 1);
    const tc = await pg.getTextContent();
    const runs = [];
    // The reader reports lines in the order they are drawn, and so does our parser, so the
    // two can be walked together. A line that doesn't state its own position is matched by
    // its place in that order and takes its position from the reader, which knows where the
    // text actually landed. Positioned operators re-synchronise the walk if it drifts.
    let cursor = 0;
    const reach = new Map();                      // operator index -> right edge of the text seen from it so far
    const takeOps = (e, f, size) => {
      // A run that begins with a space is reported from after the space, so the operator
      // sits slightly to the left of where the line is said to start. The baseline must
      // still agree exactly; only the along-the-line tolerance is loosened.
      const xtol = Math.max(0.6, (size || 10) * 0.9);
      const near = (o, ex, ey) => o.located && Math.abs(o.matrix[5] - ey) < 0.6 &&
        o.matrix[4] <= ex + 0.6 && o.matrix[4] >= ex - xtol;
      let hit = ops.findIndex((o, j) => j >= cursor && o.located &&
        Math.abs(o.matrix[4] - e) < 0.6 && Math.abs(o.matrix[5] - f) < 0.6);
      if (hit < 0) hit = ops.findIndex((o, j) => j >= cursor && near(o, e, f));
      let start;
      if (hit >= 0) start = hit;                         // position confirms the match
      else if (cursor < ops.length && !ops[cursor].located) start = cursor;   // continuation
      else {
        // the walk has drifted (readers don't always report in drawing order): resynchronise
        // on position anywhere in the stream
        const any = ops.findIndex(o => (o.located &&
          Math.abs(o.matrix[4] - e) < 0.6 && Math.abs(o.matrix[5] - f) < 0.6) || near(o, e, f));
        if (any < 0) {
          // The reader can report one show operator as several pieces (it splits at spaces when
          // word spacing is set). A piece that starts shortly after the right edge of text
          // already seen from an operator, on the same baseline, is part of that operator.
          const sz = size || 10; let share = -1;
          reach.forEach((right, j) => {
            const o = ops[j];
            if (!o.located || Math.abs(o.matrix[5] - f) > 0.6 || e < o.matrix[4] - 0.6) return;
            const gap = e - right;
            if (gap > sz * 3 || gap < -1.5 * sz) return;
            if (share < 0 || o.matrix[4] > ops[share].matrix[4]) share = j;
          });
          if (share >= 0) {
            const viaShare = [share]; viaShare.shared = true;    // matched as a continuation, not by its own position
            return viaShare;
          }
          // Pieces many ems apart (table cells, indented code) are not safe to rewrite, but the
          // operator that draws them is still the nearest one on this baseline that starts at or
          // before the piece, and that is all removal needs to know.
          let near = -1;
          reach.forEach((right, j) => {
            const o = ops[j];
            if (!o.located || Math.abs(o.matrix[5] - f) > 0.6 || e < o.matrix[4] - 0.6) return;
            if (near < 0 || o.matrix[4] > ops[near].matrix[4]) near = j;
          });
          if (near < 0) return null;
          const removalOnly = [near]; removalOnly.removalOnly = true;
          return removalOnly;
        }
        start = any;
      }
      const out = [start];
      for (let j = start + 1; j < ops.length && !ops[j].located; j++) out.push(j);
      cursor = out[out.length - 1] + 1;
      return out;
    };
    tc.items.forEach(it => {
      if (!it.str || !it.str.trim()) return;
      const [a, b, c, d, e, f] = it.transform;
      // One reported line can be drawn by several show operators: the first carries the
      // position, the rest continue from where it left off. Deleting only the first leaves
      // the remainder of the line on the page under the replacement.
      const idxs = takeOps(e, f, Math.hypot(a, b) || Math.hypot(c, d));
      const k = idxs ? idxs[0] : -1;
      const rmOp = idxs && idxs.removalOnly ? ops[k] : null;       // found for removal only, never for editing
      const op = k < 0 || rmOp ? null : ops[k];
      const viaShare = !!(idxs && idxs.shared);
      if (op) reach.set(k, Math.max(reach.has(k) ? reach.get(k) : -1e9, e + Math.abs(it.width)));
      const spans = [];
      if (op) {
        idxs.slice(1).forEach(j => { /* continuation pieces are collected below too */ });
        // a line and its continuations must all come from the same stream
        // Take every operator that draws part of this line: the one that carries the
        // position, any that continue from it, and any repositioned along the same
        // baseline within the line's width (writers reposition between words).
        const tol = Math.max(1.2, Math.hypot(a, b) * 0.35);
        for (let j = k; j < ops.length; j++) {
          const o = ops[j];
          if (o.stream !== op.stream) break;
          if (j > k && o.located) {
            const onLine = Math.abs(o.matrix[5] - f) <= tol &&
                           o.matrix[4] >= e - 1 && o.matrix[4] <= e + Math.abs(it.width) + tol;
            if (!onLine) break;
          }
          spans.push({ opStart: o.start, opEnd: o.end });
          cursor = Math.max(cursor, j + 1);
        }
      }
      // Size and position come from pdf.js, which has already resolved every layer that
      // can scale text: the page transform, a form's own matrix, and a font matrix (Type 3
      // fonts carry their own). Our parser is only used to know which bytes to delete, so
      // however the PDF stores its text, what we draw matches what is on the page.
      const shown = Math.hypot(a, b) || Math.hypot(c, d);
      const parsed = op && op.located ? Math.hypot(op.matrix[0], op.matrix[1]) : 0;
      // If the two disagree badly, our reading of the stream is wrong for this run; keep it
      // out of reach rather than redraw it at the wrong size.
      const trustworthy = !op || !parsed || (shown && Math.abs(parsed - shown) <= Math.max(0.6, shown * 0.2));
      // "sawForm" is true for any XObject, images included, so only blame a reusable block
      // when one with text in it was actually parsed.
      const reason = op ? (trustworthy ? null : "size")
        : (ops.streams && ops.streams.size ? "form" : "unpositioned");
      runs.push({
        str: it.str, x: e, y: f, w: it.width, h: it.height || shown,
        editable: !!op && trustworthy, primary: op ? op.start : null, viaShare,
        rmSpans: rmOp ? [{ opStart: rmOp.start, opEnd: rmOp.end }] : null, rmStream: rmOp ? rmOp.stream || null : null,
        opStart: op ? op.start : null, opEnd: op ? op.end : null, spans,
        fontRes: op ? op.font : null, reason, stream: op ? op.stream || null : null,
        matrix: op ? op.matrix : null, fill: op ? op.fill : [0, 0, 0],
        size: shown || parsed || 11
      });
    });
    return joinRuns(runs);
  }

  // Many writers draw a line one word at a time, so what the reader reports as separate
  // pieces is really one line. Join neighbours that share a baseline and sit a space apart:
  // measured on real documents, word gaps run to about 0.3 em while the gap to the next
  // table column starts around 1.7 em, so 0.8 em separates them with room to spare.
  function joinRuns(runs){
    const out = [];
    // Readers do not always report a line left to right, so order the pieces along the
    // baseline first; otherwise neighbouring words never meet and stay separate boxes.
    const ordered = runs.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
    ordered.forEach(r => {
      // glyphs that produce no character (icon placeholders and the like) are not text
      if (!r.str || !r.str.replace(/[\u0000-\u001f\ufffd]/g, "").trim()) return;
      const prev = out[out.length - 1];
      const size = r.size || 10;
      // Deliberately not requiring the same font resource: writers alternate between
      // identical subsets word by word (this document uses two for one sentence), and
      // refusing to join across them is what left a box per word. What must match is how
      // the text looks and where it sits — same size, same colour, same baseline.
      const sameInk = !prev || !prev.fill || !r.fill ||
        (Math.abs(prev.fill[0] - r.fill[0]) < 0.02 && Math.abs(prev.fill[1] - r.fill[1]) < 0.02 &&
         Math.abs(prev.fill[2] - r.fill[2]) < 0.02);
      // Pieces drawn by one operator must stay together whatever the grouping setting: editing
      // one would delete the operator, and with it the others.
      const sharesOp = !!prev && prev.editable && r.viaShare && prev.primary != null && prev.primary === r.primary;
      if (prev && prev.editable === r.editable && prev.stream === r.stream && sameInk &&
          Math.abs(prev.size - r.size) < 0.6 &&
          Math.abs(prev.y - r.y) < Math.max(0.5, size * 0.12)) {
        const gap = (r.x - (prev.x + prev.w)) / size;
        if (sharesOp || (gap <= grouping().join && gap > -1.5)) {
          // a real space between the pieces, or none where the writer split mid-word
          prev.str += (gap >= 0.12 && !/\s$/.test(prev.str) && !/^\s/.test(r.str) ? " " : "") + r.str;
          prev.w = (r.x + r.w) - prev.x;
          { const seen = new Set((prev.spans || []).map(s => s.opStart));
            prev.spans = (prev.spans || []).concat((r.spans || []).filter(s => !seen.has(s.opStart))); }
          prev.h = Math.max(prev.h, r.h);
          if (prev.fontRes !== r.fontRes) prev.mixedFont = true;
          return;
        }
      }
      out.push(Object.assign({}, r, { spans: (r.spans || []).slice() }));
    });
    return out;
  }

  // Lines that follow each other down the page at a consistent leading, in the same size,
  // and sharing a left edge or overlapping horizontally, are one paragraph.
  function groupRuns(runs){
    const items = runs.map((r, i) => ({ ...r, i })).filter(r => r.editable && r.str.trim());
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const blocks = [];
    for (const r of items) {
      const fit = blocks.find(b => {
        if (Math.abs(b.size - r.size) > Math.max(0.6, b.size * 0.2)) return false;
        const gap = b.minY - (r.y + r.h);
        // Paragraph lines sit almost on top of each other (leading ≈ 1.2 × size, so a gap of
        // roughly a fifth of the size). Table rows are spaced much further apart, and must
        // stay separate blocks or editing a cell would reflow the column.
        if (gap < -r.h * 0.5 || gap > b.size * grouping().lead) return false;
        if (b.leadingSeen && Math.abs((b.minY - r.y) - b.leadingSeen) > b.size * 0.35) return false;
        const overlap = Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x);
        const sharesLeft = Math.abs(b.x - r.x) < Math.max(2, b.size * 0.3);
        return overlap > Math.min(b.w, r.w) * grouping().overlap &&
               (sharesLeft || overlap > Math.min(b.w, r.w) * Math.min(0.95, grouping().overlap + 0.3));
      });
      if (fit) {
        fit.leadingSeen = fit.minY - r.y;
        fit.runs.push(r);
        fit.minY = Math.min(fit.minY, r.y);
        fit.w = Math.max(fit.x + fit.w, r.x + r.w) - Math.min(fit.x, r.x);
        fit.x = Math.min(fit.x, r.x);
        fit.leading = fit.runs.length > 1 ? (fit.maxY - fit.minY) / (fit.runs.length - 1) : fit.size * LINE;
      } else {
        blocks.push({ runs: [r], x: r.x, y: r.y, w: r.w, h: r.h, minY: r.y, maxY: r.y,
                      size: r.size, fill: r.fill, leading: r.size * LINE });
      }
    }
    blocks.forEach(b => finishBlock(b));
    return blocks;
  }
  function finishBlock(b){
    {
      b.runs.sort((p, q) => (q.y - p.y) || (p.x - q.x));
      b.text = b.runs.map(r => r.str.trim()).join("\n");
      b.lineBoxes = b.runs.map(r => ({ x: r.x, y: r.y, w: r.w }));
      b.top = b.maxY + b.h;
      b.height = (b.maxY - b.minY) + b.h;
      b.ops = b.runs.reduce((acc, r) => acc.concat(r.spans && r.spans.length ? r.spans : [{ opStart: r.opStart, opEnd: r.opEnd }]), []);
      b.matrix = b.runs[0].matrix;
      b.fontRes = b.runs[0].fontRes;
      b.stream = b.runs[0].stream || null;
      b.mixedFonts = b.runs.some(r => r.fontRes !== b.fontRes);
      b.x = Math.min(...b.runs.map(r => r.x));
      b.w = Math.max(...b.runs.map(r => r.x + r.w)) - b.x;
      b.minY = Math.min(...b.runs.map(r => r.y));
      b.maxY = Math.max(...b.runs.map(r => r.y));
      b.size = b.runs[0].size;
      b.h = b.runs[0].h;
      b.top = b.maxY + b.h;
      b.height = (b.maxY - b.minY) + b.h;
      b.leading = b.runs.length > 1 ? (b.maxY - b.minY) / (b.runs.length - 1) : b.size * LINE;
    }
    return b;
  }

  // Grouping is a guess; these let the person correct it on the page.
  function mergeBlocks(i, j2){
    const b = ed.blocks[i], other = ed.blocks[j2];
    if (!b || !other || i === j2) return;
    const merged = finishBlock({ runs: b.runs.concat(other.runs), fill: b.fill });
    ed.blocks = ed.blocks.filter((_, j) => j !== i && j !== j2);
    ed.blocks.push(merged);
    ed.textEdits = new Map();            // positions changed, so staged edits no longer line up
    ed.tsel = ed.blocks.length - 1;
    ed.mergeArmed = false; ed.splitArmed = false;
    drawLayer(); editUi();
    setStatus(editStatus, "success", "Merged into one block of " + plural(merged.runs.length, "line") + ".");
  }
  function splitBlockAt(i, lineIndex){
    const b = ed.blocks[i];
    if (lineIndex <= 0 || lineIndex >= b.runs.length) { setStatus(editStatus, "info", "Put the cursor on the line where the split should start."); return; }
    const top = finishBlock({ runs: b.runs.slice(0, lineIndex), fill: b.fill });
    const rest = finishBlock({ runs: b.runs.slice(lineIndex), fill: b.fill });
    ed.blocks = ed.blocks.filter((_, j) => j !== i).concat([top, rest]);
    ed.textEdits = new Map();
    ed.tsel = ed.blocks.length - 1;
    ed.splitArmed = false;
    drawLayer(); editUi();
    setStatus(editStatus, "success", "Split into blocks of " + top.runs.length + " and " + rest.runs.length + " lines.");
  }
  $("tx-merge").addEventListener("click", () => {
    if (ed.tsel === null) return;
    ed.mergeArmed = !ed.mergeArmed;
    setStatus(editStatus, "info", ed.mergeArmed
      ? "Now tap the other block you want to join with this one. (Shift-click works too.)"
      : "Merge cancelled.");
    drawLayer(); editUi();
  });
  $("tx-split").addEventListener("click", () => {
    if (ed.tsel === null) return;
    const b = ed.blocks[ed.tsel];
    if (!b || b.runs.length < 2) { setStatus(editStatus, "info", "This block is a single line, so there's nothing to split."); return; }
    ed.splitArmed = !ed.splitArmed;
    ed.mergeArmed = false;
    setStatus(editStatus, "info", ed.splitArmed
      ? "Click the gap on the page where the block should divide."
      : "Split cancelled.");
    drawLayer(); editUi();
  });

  const CSS_FONT = {
    "Helvetica": "Helvetica, Arial, sans-serif", "Helvetica-Bold": "Helvetica, Arial, sans-serif",
    "Times-Roman": "'Times New Roman', Times, serif", "Times-Bold": "'Times New Roman', Times, serif",
    "Courier": "'Courier New', Courier, monospace"
  };
  // What the edit will look like, drawn over the page: the original is masked out and the
  // new text laid out with the same rules the save uses.
  // The colour of the page right next to the text, so the mask matches the paper rather
  // than the app's theme (which is dark for some people, over a white page).
  function pageColourAt(px, py){
    try {
      const c = eCanvas.getContext("2d", { willReadFrequently: true });
      const d = dpr();
      const x = Math.max(0, Math.min(eCanvas.width - 1, Math.round(px * d)));
      const y = Math.max(0, Math.min(eCanvas.height - 1, Math.round(py * d)));
      const p = c.getImageData(x, y, 1, 1).data;
      return "rgb(" + p[0] + "," + p[1] + "," + p[2] + ")";
    } catch (err) { return "#fff"; }
  }
  // What is on the page is the truth while someone is typing there.
  function onPageEdit(i){
    const els = [...eLayer.querySelectorAll(".tprev[data-line]")]
      .sort((a, b2) => (+a.dataset.line) - (+b2.dataset.line));
    const lines = els.map(el => el.textContent.replace(/\u00a0/g, " "));
    if (!lines.length) return;
    const b = ed.blocks[i];
    // If a line has grown past the block's width, re-wrap the whole paragraph so the text
    // stays inside the box instead of running off the side. Where the caret is matters, so
    // it is put back at the same point in the text afterwards.
    const e0 = ed.textEdits.get(i) || {};
    const width = e0.width || b.w;
    const size = e0.size || b.size;
    const info = docFontFor(b);
    const measure = (t, sz) => info && info.usable ? widthWithDocFont(info, t, sz) : t.length * sz * 0.5;
    const overflowing = lines.length > 1 && lines.some(l => measure(l.replace(/\s+$/, ""), size) > width * 1.02);
    let text = lines.join("\n");
    // Once the tool has wrapped a block, the line breaks in it are its own doing and not the
    // writer's, so every edit re-flows it: text that shrinks (backspace, deleting a word)
    // comes back up onto the previous line instead of staying stranded where the wrap put it.
    const reflow = overflowing || e0.autoWrapped;
    if (reflow) {
      // Nothing is dropped or collapsed here, so the caret's character offset is unchanged.
      const caret = caretOffsetIn(els);
      const flowed = wrapExact({ widthOfTextAtSize: measure }, lines.join(" "), size, width).join("\n");
      if (flowed === text) { blockEdit(i, { text: text, autoWrapped: true }); editSummary(); editUi(); return; }
      text = flowed;
      blockEdit(i, { text: text, autoWrapped: true });
      drawLayer();
      restoreCaret(i, caret);
      editSummary(); editUi();
      return;
    }
    blockEdit(i, { text: text });
    const ta = $("tx-text");
    if (ta && document.activeElement !== ta) ta.value = lines.join("\n");
    editSummary(); editUi();
  }

  // A wrapped line is its own element, so Backspace at the start of one (or Delete at the
  // end of one) has nothing to act on. The break there was put in by the wrap and stands for
  // a space, so deleting it means joining the two lines; the reflow then redistributes them.
  function joinWrappedLines(ev, i, el){
    const e0 = ed.textEdits.get(i);
    if (!e0 || !e0.autoWrapped) return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || !(el === sel.anchorNode || el.contains(sel.anchorNode))) return;
    const li = +el.dataset.line;
    const lineEl = k => eLayer.querySelector('.tprev[data-line="' + k + '"]');
    let first = null, second = null;
    if (ev.key === "Backspace" && sel.anchorOffset === 0 && (first = lineEl(li - 1))) second = el;
    else if (ev.key === "Delete" && sel.anchorOffset >= el.textContent.length && (second = lineEl(li + 1))) first = el;
    if (!first || !second) return;
    ev.preventDefault();
    const at = first.textContent.length;
    first.textContent = first.textContent + second.textContent;
    second.remove();
    const r = document.createRange();
    r.setStart(first.firstChild || first, first.firstChild ? at : 0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    onPageEdit(i);
  }

  // Where the caret sits, counted in characters from the start of the block.
  function caretOffsetIn(els){
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const node = sel.anchorNode, off = sel.anchorOffset;
    let total = 0;
    for (const el of els) {
      if (el === node || el.contains(node)) return total + off;
      total += el.textContent.length + 1;              // the newline between lines
    }
    return null;
  }
  function restoreCaret(i, offset){
    if (offset == null) return;
    const els = [...eLayer.querySelectorAll(".tprev[data-line]")]
      .sort((a, b2) => (+a.dataset.line) - (+b2.dataset.line));
    let left = offset;
    for (const el of els) {
      const len = el.textContent.length;
      if (left <= len) {
        const node = el.firstChild || el;
        const r = document.createRange(), sel = window.getSelection();
        try { r.setStart(node, Math.min(left, node.length != null ? node.length : 0)); } catch (err) { return; }
        r.collapse(true); sel.removeAllRanges(); sel.addRange(r); el.focus();
        return;
      }
      left -= len + 1;
    }
  }

  function previewBlock(i, b, e){
    const vp = ed.vp, s = ed.scale;
    const x = e.moved ? e.x : b.x, top = e.moved ? e.top : b.top;
    const dx = e.dx || 0, dy = e.dy || 0;
    // mask the original lines
    b.lineBoxes.forEach(lb => {
      const p = vp.convertToViewportPoint(lb.x - 1, lb.y + b.size * 1.02);
      const q = vp.convertToViewportPoint(lb.x + lb.w + 2, lb.y - b.size * 0.28);
      const m = document.createElement("div");
      m.className = "tmask";
      const left = Math.min(p[0], q[0]), top = Math.min(p[1], q[1]);
      m.style.left = left + "px"; m.style.top = top + "px";
      m.style.width = Math.abs(q[0] - p[0]) + "px"; m.style.height = Math.abs(q[1] - p[1]) + "px";
      m.style.background = pageColourAt(left - 3, top + Math.abs(q[1] - p[1]) / 2);
      eLayer.appendChild(m);
    });
    // lay the new text out the same way the save will
    const typed = (e.text || "").split("\n");
    const size = e.size || b.size;
    const width = e.width || b.w;
    // measure with the font the save will use, so the lines break where they will in the file
    const dInfoM = e.docFontCodes && /^doc/.test(e.fontName || "") && e.docFontCodes.usable && [...(e.text || "").replace(/\n/g, "")].every(ch => ch === " " || e.docFontCodes.toCode.has(ch)) ? e.docFontCodes : null;
    const stdM = stdFonts[e.fontName] || helv;
    const meas = dInfoM ? (t, sz) => widthWithDocFont(dInfoM, t, sz) : stdM ? (t, sz) => stdM.widthOfTextAtSize(t, sz) : null;
    const fits = !e.resized && typed.length === b.lineBoxes.length &&
      (!meas || typed.every((ln, k) => meas(ln, size) <= Math.max(b.lineBoxes[k].w, width) * 1.02));
    const places = [];
    // While someone types on the page, the lines they see are the text; laying them out a
    // second time with different metrics would move words between lines and drop spaces.
    const exact = !fits && ed.typing === i && e.autoWrapped;
    if (exact) {
      const leading = b.leading > size * 0.8 ? b.leading : size * LINE;
      typed.forEach((ln, k) => places.push({ text: ln, x, y: top - size - k * leading }));
    } else if (fits) typed.forEach((ln, k) => places.push({ text: ln, x: b.lineBoxes[k].x + dx, y: b.lineBoxes[k].y + dy }));
    else {
      const lines = [];
      typed.forEach(t => {
        if (!meas) { lines.push(t); return; }
        let line = "";
        for (const word of t.split(/\s+/).filter(Boolean)) {
          const cand = line ? line + " " + word : word;
          if (meas(cand, size) <= Math.max(size, width) || !line) line = cand;
          else { lines.push(line); line = word; }
        }
        lines.push(line);
      });
      const leading = b.leading > size * 0.8 ? b.leading : size * LINE;
      lines.forEach((ln, k) => places.push({ text: ln, x, y: top - size - k * leading }));
    }
    places.forEach((pl, li) => {
      const p = vp.convertToViewportPoint(pl.x, pl.y);
      const el = document.createElement("div");
      el.className = "tprev";
      el.textContent = pl.text;
      if (ed.tsel === i && ed.typing === i && !ed.mergeArmed && !ed.splitArmed) {
        // typing happens here, over the page, with the panel as the fallback for anything
        // awkward: long paragraphs, phones, screen readers
        el.contentEditable = "true";
        el.spellcheck = false;
        el.dataset.line = li;
        el.addEventListener("input", () => onPageEdit(i));
        el.addEventListener("keydown", ev => {
          if (ev.key === "Escape") { ev.preventDefault(); ed.typing = null; el.blur(); drawLayer(); editUi(); }
          else if (ev.key === "Backspace" || ev.key === "Delete") joinWrappedLines(ev, i, el);
          ev.stopPropagation();          // Delete belongs to the text, not the block
        });
        el.addEventListener("pointerdown", ev => ev.stopPropagation());
      }
      el.style.left = p[0] + "px";
      el.style.top = p[1] + "px";
      if (e.align === "center" || e.align === "right") {
        // inside the block's own width: the box spans it and the browser places the line
        el.style.left = vp.convertToViewportPoint(x, pl.y)[0] + "px";
        el.style.width = Math.max(size, width) * s + "px";
        el.style.textAlign = e.align;
      }
      el.style.fontSize = (size * s) + "px";
      {
        const dInfo = e.docFontCodes && /^doc/.test(e.fontName || "") ? e.docFontCodes : null;
        const fam = dInfo ? pjsFamilyFor(dInfo.baseFont) : null;
        if (fam) { el.style.fontFamily = "\"" + fam + "\", " + genericFor(dInfo.baseFont); el.style.fontWeight = "normal"; el.style.fontStyle = "normal"; }
        else {
          el.style.fontFamily = CSS_FONT[e.fontName] || CSS_FONT.Helvetica;
          el.style.fontWeight = /Bold/i.test(e.fontName || "") ? "bold" : "normal";
        }
      }
      const [r, g, bl] = e.fill || [0, 0, 0];
      el.style.color = "rgb(" + Math.round(r * 255) + "," + Math.round(g * 255) + "," + Math.round(bl * 255) + ")";
      eLayer.appendChild(el);
    });
  }

  const NO_REMOVE = "This can't be removed either: it isn't drawn as text on this page (a scan, or letters turned into outlines). Use Redact to black it out instead.";
  const LOCK_REASON = {
    form: "This text is drawn inside a reusable block \u2014 a header, footer or letterhead that the page stamps in from elsewhere. Editing it would change every page that uses it, so it is left alone for now.",
    unpositioned: "This line's position isn't stated in the file; it continues from wherever the previous text ended, so its exact place can't be worked out reliably. Rewriting it could put the text in the wrong spot.",
    size: "What the file says about this text's size doesn't match how it appears on the page, so redrawing it would very likely come out wrong."
  };

  // Whether every editable block is outlined, or only the one under the pointer. Devices
  // without a pointer have no hover, so they start with everything shown.
  function showAllBlocks(){
    if (ed.showAll !== null && ed.showAll !== undefined) return ed.showAll;
    return !window.matchMedia || !window.matchMedia("(pointer: fine)").matches;
  }
  function setShowAll(on){
    ed.showAll = on;
    try { localStorage.setItem("pdf-tools:show-blocks", on ? "1" : "0"); } catch (e) {}
    const btn = $("tx-showall");
    if (btn) { btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.classList.toggle("armed", on); }
    drawLayer();
  }

  function drawTextOverlays(){
    const vp = ed.vp;
    if (!vp) return;
    const all = showAllBlocks();
    (ed.blocks || []).forEach((b, i) => {
      const e = ed.textEdits.get(i);
      if (e) previewBlock(i, b, e);
      else if (ed.tsel === i) previewBlock(i, b, {
        text: b.text, size: b.size, fill: b.fill, x: b.x, top: b.top, fontName: fontDefaultFor(b), docFontCodes: docFontFor(b),
        width: b.w, leading: b.leading, lineBoxes: b.lineBoxes, moved: false, dx: 0, dy: 0 });
      const x = e && e.moved ? e.x : b.x, top = e && e.moved ? e.top : b.top;
      const w = e && e.width ? e.width : b.w;
      const p1 = vp.convertToViewportPoint(x, top);
      const lines = e && e.text ? Math.max(1, e.text.split("\n").length) : b.runs.length;
      const lead = e && e.leading ? e.leading : (b.leading || b.size * LINE);
      const height = e && e.resized ? (lines - 1) * lead + (e.size || b.size) : b.height;
      const p2 = vp.convertToViewportPoint(x + w, top - height);
      const el = document.createElement("div");
      const shared = b.stream && ed.formPages && (ed.formPages.get(b.stream) || 1) > 1;
      el.className = "trun block" + (e ? " changed" : "") + (ed.tsel === i ? " sel" : "") +
        (ed.mergeArmed && ed.tsel !== i ? " mergeable" : "") + (b.stream ? " fromblock" : "") + (shared ? " shared" : "") +
        (all || e || ed.tsel === i || ed.mergeArmed ? "" : " quiet");
      el.style.left = Math.min(p1[0], p2[0]) - 2 + "px";
      el.style.top = Math.min(p1[1], p2[1]) - 2 + "px";
      el.style.width = (Math.abs(p2[0] - p1[0]) + 4) + "px";
      el.style.height = (Math.abs(p2[1] - p1[1]) + 4) + "px";
      el.title = plural(b.runs.length, "line") + " \u2014 tap to edit, drag to move" +
        (b.stream ? (shared ? " \u00b7 from a block reused on " + ed.formPages.get(b.stream) + " pages: editing changes all of them"
                            : " \u00b7 from a reusable block, used only on this page") : "");
      el.addEventListener("pointerdown", ev => startBlockDrag(ev, i, el));
      el.addEventListener("dblclick", ev => { ev.stopPropagation(); beginOnPageEdit(i); });
      eLayer.appendChild(el);
      if (ed.tsel === i && ed.splitArmed && b.runs.length > 1) {
        for (let k = 1; k < b.runs.length; k++) {
          const above = b.runs[k - 1], below = b.runs[k];
          const midY = (below.y + below.h + above.y) / 2;
          const q1 = vp.convertToViewportPoint(b.x, midY);
          const q2 = vp.convertToViewportPoint(b.x + b.w, midY);
          const gap = document.createElement("div");
          gap.className = "tsplit";
          gap.title = "Split the block here";
          gap.style.left = Math.min(q1[0], q2[0]) + "px";
          gap.style.top = (Math.min(q1[1], q2[1]) - 5) + "px";
          gap.style.width = Math.abs(q2[0] - q1[0]) + "px";
          gap.dataset.at = k;
          gap.addEventListener("pointerdown", ev => { ev.stopPropagation(); ed.splitArmed = false; splitBlockAt(i, k); });
          eLayer.appendChild(gap);
        }
      }
      if (ed.tsel === i) {
        const grips = [["tgrip", "w", "Drag to set how wide the text may run"],
                       ["tgrip-b", "h", "Drag to make the block taller or shorter (the lines spread out)"],
                       ["tgrip-c", "both", "Drag to resize the block in both directions"]];
        grips.forEach(([cls, axis, title]) => {
          if (axis === "h" && b.runs.length < 2) return;     // spacing needs at least two lines
          const h = document.createElement("div");
          h.className = "tgrip " + cls;
          h.title = title;
          h.addEventListener("pointerdown", ev => { ev.stopPropagation(); startBlockResize(ev, i, axis); });
          el.appendChild(h);
        });
      }
    });
    // text that can't be touched, so it's obvious why
    (ed.runs || []).filter(r => !r.editable && r.str.trim()).forEach(r => {
      const p1 = vp.convertToViewportPoint(r.x, r.y), p2 = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
      const el = document.createElement("div");
      el.className = "trun locked";
      el.style.left = Math.min(p1[0], p2[0]) + "px"; el.style.top = Math.min(p1[1], p2[1]) - 2 + "px";
      el.style.width = Math.abs(p2[0] - p1[0]) + "px"; el.style.height = (Math.abs(p2[1] - p1[1]) + 4) + "px";
      const picked = ed.lockedSel === r, along = (ed.lockedAlso || []).indexOf(r) >= 0;
      el.className += (picked ? " sel" : along ? " alongside" : all ? "" : " quiet");
      el.title = (LOCK_REASON[r.reason] || LOCK_REASON.unpositioned) + " It can still be removed.";
      el.addEventListener("click", () => selectLocked(r));
      eLayer.appendChild(el);
    });
  }

  // ================= Redaction =================
  // Covering text with a black box hides nothing: the words are still in the file and come
  // straight back out with copy-and-paste. Redacting here deletes the operators that draw
  // the text, redraws whatever part of a line survives outside the box, and only then
  // paints the box. Anything a redaction touches is gone from the file, not hidden.
  function boxesOverlap(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  // What a redaction rectangle will remove from this page.
  function redactionTargets(rect){
    const hits = [];
    (ed.runs || []).forEach(r => {
      if (!r.str || !r.str.trim()) return;
      const box = { x: r.x, y: r.y, w: r.w, h: r.h };
      if (!boxesOverlap(rect, box)) return;
      const covered = rect.x <= box.x + 0.5 && rect.x + rect.w >= box.x + box.w - 0.5;
      hits.push({ run: r, whole: covered });
    });
    return hits;
  }

  async function enterRedactMode(){
    if (!ed.view) { drawLayer(); editUi(); return; }
    if (!ed.runs.length) {
      setStatus(editStatus, "info", "Reading the text on this page\u2026");
      try { ed.runs = await loadTextRuns(ed.page); } catch (err) { ed.runs = []; }
    }
    setStatus(editStatus, "info", "Drag a box over anything that must be removed. The text under it is deleted from the file, not covered up.");
    drawLayer(); editUi();
  }

  function drawRedactions(){
    const vp = ed.vp;
    if (!vp) return;
    (ed.redactions || []).filter(r => r.page === ed.page).forEach((r, i) => {
      const p1 = vp.convertToViewportPoint(r.x, r.y + r.h);
      const p2 = vp.convertToViewportPoint(r.x + r.w, r.y);
      const el = document.createElement("div");
      el.className = "redbox";
      el.style.left = Math.min(p1[0], p2[0]) + "px";
      el.style.top = Math.min(p1[1], p2[1]) + "px";
      el.style.width = Math.abs(p2[0] - p1[0]) + "px";
      el.style.height = Math.abs(p2[1] - p1[1]) + "px";
      const n = redactionTargets(r).length;
      el.title = n ? plural(n, "line") + " of text will be removed" : "No text here; the area will still be blacked out";
      const x = document.createElement("button");
      x.className = "ex"; x.textContent = "\u00d7"; x.title = "Remove this redaction";
      // pointerdown, because redrawing on the way to a click would take the button away
      x.addEventListener("pointerdown", ev => { ev.stopPropagation(); ev.preventDefault();
        const at = ed.redactions.indexOf(r);
        if (at >= 0) ed.redactions.splice(at, 1);
        drawLayer(); editUi();
        setStatus(editStatus, "info", "Redaction removed."); });
      el.appendChild(x);
      ["nw", "ne", "sw", "se"].forEach(corner => {
        const g = document.createElement("div");
        g.className = "rgrip r-" + corner;
        g.addEventListener("pointerdown", ev => { ev.stopPropagation(); startRedactResize(ev, r, corner); });
        el.appendChild(g);
      });
      el.addEventListener("pointerdown", ev => startRedactMove(ev, r));
      eLayer.appendChild(el);
    });
    renderRedactPanel();
  }

  function startRedactMove(ev, r){
    if (ev.button > 0 || (ev.target.classList && (ev.target.classList.contains("ex") || ev.target.classList.contains("rgrip")))) return;
    ev.stopPropagation(); ev.preventDefault();
    const rect = eStage.getBoundingClientRect();
    const from = stagePoint(ev, rect), x0 = r.x, y0 = r.y;
    const move = m => {
      const cur = stagePoint(m, rect);
      const a = ed.vp.convertToPdfPoint(from.x, from.y), b = ed.vp.convertToPdfPoint(cur.x, cur.y);
      r.x = x0 + (b[0] - a[0]); r.y = y0 + (b[1] - a[1]);
      drawLayer();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); editUi(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function startRedactResize(ev, r, corner){
    ev.preventDefault();
    const rect = eStage.getBoundingClientRect();
    const fixed = { x: corner.indexOf("w") >= 0 ? r.x + r.w : r.x, y: corner.indexOf("n") >= 0 ? r.y : r.y + r.h };
    const move = m => {
      const cur = ed.vp.convertToPdfPoint(stagePoint(m, rect).x, stagePoint(m, rect).y);
      r.x = Math.min(fixed.x, cur[0]); r.y = Math.min(fixed.y, cur[1]);
      r.w = Math.max(2, Math.abs(cur[0] - fixed.x)); r.h = Math.max(2, Math.abs(cur[1] - fixed.y));
      drawLayer();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); editUi(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renderRedactPanel(){
    const mine = (ed.redactions || []).filter(r => r.page === ed.page);
    const lines = mine.reduce((a, r) => a + redactionTargets(r).length, 0);
    $("rd-count").textContent = mine.length
      ? plural(mine.length, "area") + " on this page \u00b7 " + plural(lines, "line") + " of text will be deleted"
      : "Nothing marked on this page yet.";
    $("rd-total").textContent = (ed.redactions || []).length ? plural(ed.redactions.length, "area") + " marked in total" : "";
    $("rd-clear").disabled = !(ed.redactions || []).length;
  }
  $("rd-clear").addEventListener("click", () => { ed.redactions = []; drawLayer(); editUi(); });

  // The ribbon can be tucked away to leave the page alone for reading. Clicking a tab opens
  // it again, as in a word processor, and double-clicking the open tab closes it.
  function setRibbonCollapsed(on, remember){
    const rib = $("docribbon"), btn = $("rb-collapse");
    if (!rib || !btn) return;
    rib.classList.toggle("collapsed", on);
    // Apply travels with the ribbon: down in the body when it is open, up beside the tabs
    // when it is tucked away, so pending changes can always be applied
    (on ? rib.querySelector(".rtabs") : $("rbody")).appendChild($("rapply"));
    btn.setAttribute("aria-expanded", on ? "false" : "true");
    btn.title = on ? "Show the ribbon" : "Hide the ribbon to read";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = on ? "&#8964;" : "&#8963;";
    if (remember) { try { localStorage.setItem("pdf-tools:ribbon-collapsed", on ? "1" : "0"); } catch (e) {} }
    if (ed.view) requestAnimationFrame(() => editRender());     // the page re-fits the space it now has
  }
  $("rb-collapse").addEventListener("click", () => setRibbonCollapsed(!$("docribbon").classList.contains("collapsed"), true));
  document.querySelectorAll("#edit-modes .segbtn").forEach(b => {
    b.addEventListener("click", () => { if ($("docribbon").classList.contains("collapsed")) setRibbonCollapsed(false, true); });
    b.addEventListener("dblclick", () => { if (b.classList.contains("active")) setRibbonCollapsed(true, true); });
  });
  // ---------- Closing the floating panel ----------
  // Whatever panel is showing goes away; nothing already done is undone by closing it.
  function closeSidePanel(){
    if (!$("sigbox").hidden) {
      if (ed.pendingImage && ed.pendingImage.isSignature) { URL.revokeObjectURL(ed.pendingImage.url); ed.pendingImage = null; ed.tool = null; }
      $("sigbox").hidden = true;
    }
    if (ed.lockedSel) { ed.lockedSel = null; ed.lockedAlso = []; }
    if (ed.mode === "form") { ed.fpanelClosed = true; ed.fsel = -1; }
    drawLayer(); editUi();
  }
  $("ctl-close").addEventListener("click", closeSidePanel);
  document.querySelector(".ctlcol").addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !ev.target.closest("textarea")) { ev.preventDefault(); closeSidePanel(); }
  });

  // ---------- Jump to a page ----------
  // Type a number and press Enter (or leave the box): out-of-range numbers are brought back into
  // range, and anything that is not a number puts the current page back.
  async function goToPage(raw){
    const n = parseInt(String(raw).replace(/[^\d-]/g, ""), 10);
    if (!ed.view || !isFinite(n)) { $("e-page").value = ed.page + 1; return; }
    const target = Math.min(ed.pageCount, Math.max(1, n)) - 1;
    $("e-page").value = target + 1;
    if (target === ed.page) return;
    ed.page = target; ed.sel = null;
    await editRender();
  }
  $("e-page").addEventListener("focus", () => $("e-page").select());
  $("e-page").addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); goToPage($("e-page").value); $("e-page").select(); }
    else if (ev.key === "Escape") { ev.preventDefault(); $("e-page").value = ed.page + 1; $("e-page").blur(); }
    else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") { ev.preventDefault(); goToPage((parseInt($("e-page").value, 10) || ed.page + 1) + (ev.key === "ArrowUp" ? 1 : -1)); }
    if (!(ev.ctrlKey || ev.metaKey)) ev.stopPropagation();      // typing here is not a page shortcut, but Ctrl+F, Ctrl+G and Ctrl+S still work
  });
  $("e-page").addEventListener("blur", () => { if ($("e-page").value !== String(ed.page + 1)) goToPage($("e-page").value); });
  document.addEventListener("keydown", ev => {                 // Ctrl/Cmd+G: "Go to page", as in a word processor
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || ev.key.toLowerCase() !== "g") return;
    if (!ed.view || $("edit-work").hidden || !$("panel-document").classList.contains("active")) return;
    ev.preventDefault(); $("e-page").focus();
  });

  // ---------- Find in the document ----------
  // Every page's text is read once (through the same reader that draws the page) and searched
  // as plain strings, so matches can cross the pieces a line is drawn in. Hits are highlighted
  // on the page in every mode, and Enter steps through them, across pages.
  const find = { open: false, query: "", index: null, indexToken: 0, matches: [], cur: -1, runToken: 0 };
  async function buildFindIndex(){
    if (find.index) return find.index;
    const token = ++find.indexToken, view = ed.view, pages = [];
    for (let i = 1; i <= view.numPages; i++) {
      const content = await (await view.getPage(i)).getTextContent();
      const items = content.items.filter(it => typeof it.str === "string");
      let full = ""; const spans = [];
      items.forEach(it => {
        const size = Math.hypot(it.transform[0], it.transform[1]) || 10;
        const x = it.transform[4], y = it.transform[5], len = it.str.length;
        const w = it.width > 0 ? it.width : size * 0.5 * len;
        const prev = spans[spans.length - 1];
        // pieces of one line touch; a gap, a line end or a new baseline means a space
        if (prev && full && !/\s$/.test(full) && !/^\s/.test(it.str) &&
            (prev.eol || x - (prev.x + prev.w) > size * 0.15 || Math.abs(y - prev.y) > size * 0.5)) full += " ";
        const start = full.length; full += it.str;
        const st = content.styles && content.styles[it.fontName];
        spans.push({ start, end: full.length, x, y, w, size, len, eol: !!it.hasEOL, str: it.str, family: (st && st.fontFamily) || "sans-serif" });
      });
      pages.push({ full, spans });
      if (token !== find.indexToken || view !== ed.view) return null;     // the document changed underneath
    }
    find.index = pages;
    return pages;
  }
  // Where inside a piece of text a match begins depends on the glyph widths, which differ a lot
  // in a proportional font, so the pieces are measured rather than split by character count.
  const findCtx = document.createElement("canvas").getContext("2d");
  function findRects(pg, s, e){
    const out = [];
    pg.spans.forEach(sp => {
      if (!sp.len || sp.end <= s || sp.start >= e) return;
      const a = Math.max(s, sp.start) - sp.start, z = Math.min(e, sp.end) - sp.start;
      let f0 = a / sp.len, f1 = z / sp.len;
      try {
        findCtx.font = "100px " + sp.family;
        const whole = findCtx.measureText(sp.str).width;
        if (whole > 0) { f0 = findCtx.measureText(sp.str.slice(0, a)).width / whole; f1 = findCtx.measureText(sp.str.slice(0, z)).width / whole; }
      } catch (err) { /* keep the even split */ }
      out.push({ x: sp.x + sp.w * f0, y: sp.y - sp.size * 0.22, w: Math.max(1, sp.w * (f1 - f0)), h: sp.size * 1.15 });
    });
    return out;
  }
  function findAll(pages, q){
    const out = [];
    pages.forEach((pg, pi) => {
      let hay = pg.full.toLowerCase(), nd = q.toLowerCase();
      if (hay.length !== pg.full.length) { hay = pg.full; nd = q; }       // case folding changed the length: stay exact
      for (let from = 0, i; out.length < 3000 && (i = hay.indexOf(nd, from)) >= 0; from = i + Math.max(1, nd.length))
        out.push({ page: pi, rects: findRects(pg, i, i + nd.length) });
    });
    return out;
  }
  function drawFindMarks(){
    if (!find.open || !find.matches.length || !ed.vp) return;
    find.matches.forEach((m, mi) => {
      if (m.page !== ed.page) return;
      m.rects.forEach(r => {
        const q = ed.vp.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]);
        const el = document.createElement("div");
        el.className = "fhit" + (mi === find.cur ? " cur" : "");
        el.style.left = Math.min(q[0], q[2]) + "px"; el.style.top = Math.min(q[1], q[3]) + "px";
        el.style.width = Math.abs(q[2] - q[0]) + "px"; el.style.height = Math.abs(q[3] - q[1]) + "px";
        eLayer.appendChild(el);
      });
    });
  }
  function findCount(text){ $("find-count").textContent = text; }
  async function findGo(i){
    const n = find.matches.length; if (!n) return;
    find.cur = (i + n) % n;
    const m = find.matches[find.cur];
    if (m.page !== ed.page) { ed.page = m.page; ed.sel = null; await editRender(); } else drawLayer();
    findCount((find.cur + 1) + " of " + n + (n >= 3000 ? "+" : ""));
    const hit = eLayer.querySelector(".fhit.cur");
    if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  async function runFind(){
    const q = $("find-input").value, token = ++find.runToken;
    find.query = q;
    if (!q) { find.matches = []; find.cur = -1; findCount(""); drawLayer(); return; }
    if (!find.index) findCount("Searching\u2026");
    const pages = await buildFindIndex();
    if (!pages || token !== find.runToken) return;
    find.matches = findAll(pages, q);
    if (!find.matches.length) {
      find.cur = -1; drawLayer();
      findCount(pages.some(p => p.full.trim()) ? "No matches" : "No text to search");
      return;
    }
    // start from the first hit on this page or after it
    const first = find.matches.findIndex(m => m.page >= ed.page);
    await findGo(first < 0 ? 0 : first);
  }
  function openFind(){
    if (!ed.view) return;
    find.open = true; $("findbar").hidden = false;
    const inp = $("find-input"); inp.focus(); inp.select();
    if (inp.value) runFind();
  }
  function closeFind(){
    find.open = false; $("findbar").hidden = true; find.runToken++;
    drawLayer();
  }
  let findTimer = null;
  $("find-input").addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(runFind, 160); });
  $("find-input").addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); findGo(find.cur + (ev.shiftKey ? -1 : 1)); }
    else if (ev.key === "Escape") { ev.preventDefault(); closeFind(); }
    if (!(ev.ctrlKey || ev.metaKey)) ev.stopPropagation();     // typing here is not a page shortcut, but Ctrl+G and Ctrl+S still work
  });
  $("find-next").addEventListener("click", () => findGo(find.cur + 1));
  $("find-prev").addEventListener("click", () => findGo(find.cur - 1));
  $("find-close").addEventListener("click", closeFind);
  $("e-find").addEventListener("click", () => { find.open ? closeFind() : openFind(); });
  document.addEventListener("keydown", ev => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || ev.key.toLowerCase() !== "f") return;
    if (!ed.view || $("edit-work").hidden || !$("panel-document").classList.contains("active")) return;
    ev.preventDefault(); openFind();       // Ctrl/Cmd+F searches the document, not the web page
  });

  // Reading comes first on a phone: the ribbon starts tucked away there unless it was left open
  { let saved = null; try { saved = localStorage.getItem("pdf-tools:ribbon-collapsed"); } catch (e) {}
    const narrow = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    if (saved === "1" || (saved === null && narrow)) setRibbonCollapsed(true, false); }

  // Delete the text a redaction covers, put back whatever part of a line survives outside
  // it, then paint the box. The order matters: the box is only ever a visual marker.
  async function applyRedactions(doc){
    const byPage = new Map();
    ed.redactions.forEach(r => { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); });
    for (const [pageIndex, rects] of byPage) {
      const runs = pageIndex === ed.page && ed.runs.length ? ed.runs : await loadTextRuns(pageIndex);
      const edits = [];
      runs.forEach(r => {
        if (!r.str || !r.str.trim() || !r.editable) return;
        const box = { x: r.x, y: r.y, w: r.w, h: r.h };
        const hit = rects.filter(q => boxesOverlap(q, box));
        if (!hit.length) return;
        // Anything the box touches goes, in full. Trimming inside a run looked tidier but
        // is unsafe: a single word is often drawn as several runs, so partial trimming left
        // fragments like "proces" behind. Half a redacted word is still a disclosure, so the
        // rule is the blunt one — if the box touches this piece of text, the whole piece is
        // removed. Size the box to what should go.
        edits.push({
          page: pageIndex, stream: r.stream || null, ops: r.spans && r.spans.length ? r.spans : [{ opStart: r.opStart, opEnd: r.opEnd }],
          text: "", fontName: "doc", docFontRes: r.fontRes,
          size: r.size, fill: r.fill, x: r.x, top: r.y + r.h, width: r.w, leading: r.size * LINE,
          lineBoxes: [{ x: r.x, y: r.y, w: r.w }], moved: false, dx: 0, dy: 0
        });
      });
      // The marker is written as operators in the same rewrite as the text removal. Using
      // the library's own drawing helper here would restructure the page's contents into a
      // form the parser can no longer read, and doing it afterwards fails for the mirror
      // image of that reason. One mechanism, one predictable order: box first, then
      // whatever survived of a partly covered line, drawn over it.
      const mark = $("rd-mark").value;
      let draw = "";
      if (mark !== "none") {
        const col = mark === "white" ? "1 1 1" : "0 0 0";
        rects.forEach(q => {
          draw += "\nq " + col + " rg " + (Math.round(q.x * 100) / 100) + " " + (Math.round(q.y * 100) / 100) +
                  " " + (Math.round(q.w * 100) / 100) + " " + (Math.round(q.h * 100) / 100) + " re f Q";
        });
      }
      // Backstop: sweep the operators themselves. Matching reported lines to operators is
      // good enough for editing, but redaction cannot rely on it — anything it misses stays
      // on the page. Any text operator whose own position falls inside a rectangle is
      // removed here regardless of whether a line was matched to it.
      try {
        const ops = await allPageOps(doc, pageIndex);
        const { text: pageText } = await pageContent(doc, pageIndex);
        // How far does this operator's text actually reach? An operator that starts to the
        // left of the box can still draw into it, so its width decides, measured with the
        // font's own table where one is available.
        const opWidth = (o, size) => {
          const src = o.stream ? (ops.streams.get(o.stream) || {}).text : pageText;
          if (!src) return size * 4;
          const frag = src.slice(o.start, o.end);
          const info = documentFont(doc, pageIndex, o.font,
                                    o.stream && ops.streams.get(o.stream) ? ops.streams.get(o.stream).dict : null);
          let codes = [];
          const hex = frag.match(/<([0-9A-Fa-f\s]*)>/g) || [];
          hex.forEach(h => { const d = h.replace(/[^0-9A-Fa-f]/g, "");
            const step = info && info.isType0 ? 4 : 2;
            for (let i = 0; i + step <= d.length; i += step) codes.push(parseInt(d.substr(i, step), 16)); });
          const lit = frag.match(/\((?:\\.|[^)])*\)/g) || [];
          lit.forEach(l => { for (const ch of l.slice(1, -1)) codes.push(ch.charCodeAt(0)); });
          if (!codes.length) return size * 4;
          let total = 0;
          codes.forEach(c => { total += info && info.widths.has(c) ? info.widths.get(c) : (info ? info.defaultWidth : 500); });
          return total * size / 1000;
        };
        ops.forEach(o => {
          if (!o.located || !o.matrix) return;
          const size = Math.hypot(o.matrix[0], o.matrix[1]) || 10;
          const px = o.matrix[4], py = o.matrix[5];
          const w = opWidth(o, size);
          // Compare the glyphs' own extent, not just the baseline: a heading whose baseline
          // sits above the box can still have its body inside it.
          const top = py + size * 0.9, bottom = py - size * 0.25;
          const inside = rects.some(q => px < q.x + q.w && px + w > q.x &&
                                         bottom < q.y + q.h && top > q.y);
          if (!inside) return;
          edits.push({ page: pageIndex, stream: o.stream || null,
                       ops: [{ opStart: o.start, opEnd: o.end }], text: "",
                       fontName: "doc", docFontRes: o.font, size, fill: o.fill,
                       x: px, top: py + size, width: size, leading: size * LINE,
                       lineBoxes: [{ x: px, y: py, w: size }], moved: false, dx: 0, dy: 0 });
        });
      } catch (err) { /* the run-based pass still stands */ }
      if (edits.length || draw) await applyTextEdits(doc, edits, draw, pageIndex);
    }
    ed.lastRedactions = ed.redactions.slice();
    ed.redactions = [];
  }

  // Check our own work. A redaction that quietly leaves something behind is the worst
  // failure this tool can have, so the saved result is read back and the marked areas are
  // checked for surviving text. Anything still there is reported plainly rather than left
  // for someone to discover.
  async function verifyRedactions(bytes){
    const rects = ed.lastRedactions || [];
    if (!rects.length) return null;
    let view = null;
    try {
      view = await openPdfJs(bytes.buffer ? bytes.buffer.slice(0) : bytes.slice(0));
      const left = [];
      const byPage = new Map();
      rects.forEach(r => { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); });
      for (const [pageIndex, qs] of byPage) {
        const page = await view.getPage(pageIndex + 1);
        const items = (await page.getTextContent()).items.filter(i => i.str && i.str.trim());
        items.forEach(it => {
          const size = Math.hypot(it.transform[0], it.transform[1]) || 10;
          const x = it.transform[4], y = it.transform[5], w = it.width || size;
          const top = y + size * 0.9, bottom = y - size * 0.25;
          if (qs.some(q => x < q.x + q.w && x + w > q.x && bottom < q.y + q.h && top > q.y))
            left.push(it.str.trim());
        });
      }
      return left;
    } catch (err) {
      return null;                       // could not check; say nothing rather than reassure
    } finally {
      if (view) view.destroy().catch(() => {});
    }
  }

  // ---------- Whole-document marks: watermark + page numbers ----------
  // Everything is positioned in display space (what you see on the page, upright even if the
  // page is rotated), then mapped into PDF space at save time — the same approach the
  // add-to-page tools use, so the preview and the output agree.
  const PN_FORMATS = {
    n: n => String(n),
    page: n => "Page " + n,
    pageof: (n, total) => "Page " + n + " of " + total,
    dash: n => "\u2013 " + n + " \u2013"
  };
  function docMarksOn(){ return ($("wm-on").checked && $("wm-text").value.trim()) || $("pn-on").checked; }

  // Returns items in display coordinates: {text, cx, cy, size, angle, color, opacity}
  function docMarksFor(pageIndex, W, H){
    const items = [];
    const wmText = cleanText($("wm-text").value.trim()).text.replace(/\n/g, " ");
    if ($("wm-on").checked && wmText) {
      const style = $("wm-style").value;
      const opacity = +$("wm-opacity").value / 100;
      const color = $("wm-color").value;
      if (style === "diagonal") {
        const angle = -Math.atan2(H, W) * 180 / Math.PI; // along the page diagonal
        const span = Math.hypot(W, H) * 0.8;
        const size = fitSize(wmText, span, Math.min(W, H) * 0.25);
        items.push({ text: wmText, cx: W / 2, cy: H / 2, size, angle, color, opacity });
      } else {
        const size = fitSize(wmText, W * 0.8, 28);
        items.push({ text: wmText, cx: W / 2, cy: style === "top" ? H * 0.05 : H * 0.95, size, angle: 0, color, opacity });
      }
    }
    if ($("pn-on").checked && !(pageIndex === 0 && $("pn-skip1").checked)) {
      const start = Math.max(0, parseInt($("pn-start").value, 10) || 1);
      const total = ed.pageCount - ($("pn-skip1").checked ? 1 : 0) + (start - 1);
      const num = start + pageIndex - ($("pn-skip1").checked ? 1 : 0);
      const text = cleanText(PN_FORMATS[$("pn-format").value](num, total)).text;
      const size = 10, m = 30;
      const pos = $("pn-pos").value;
      const cy = pos.startsWith("top") ? m : H - m;
      const w = helv ? helv.widthOfTextAtSize(text, size) : text.length * size * 0.5;
      const cx = pos.endsWith("left") ? m + w / 2 : pos.endsWith("right") ? W - m - w / 2 : W / 2;
      items.push({ text, cx, cy, size, angle: 0, color: "#000000", opacity: 1 });
    }
    return items;
  }
  function fitSize(text, targetWidth, cap){
    if (!helv) return Math.min(cap, 36);
    const at100 = helv.widthOfTextAtSize(text, 100) / 100;
    return Math.max(6, Math.min(cap, targetWidth / Math.max(0.01, at100)));
  }

  function drawDocMarksPreview(){
    if (ed.mode !== "doc" || !ed.dims[ed.page]) return;
    const { W, H } = ed.dims[ed.page], s = ed.scale;
    docMarksFor(ed.page, W, H).forEach(it => {
      const el = document.createElement("div");
      el.className = "wmark";
      el.textContent = it.text;
      el.style.left = it.cx * s + "px";
      el.style.top = it.cy * s + "px";
      el.style.fontSize = it.size * s + "px";
      el.style.color = it.color;
      el.style.opacity = it.opacity;
      el.style.transform = "translate(-50%, -50%) rotate(" + it.angle + "deg)";
      eLayer.appendChild(el);
    });
  }

  async function applyDocMarks(doc, font){
    const libPages = doc.getPages();
    for (let i = 0; i < libPages.length; i++) {
      const page = await ed.view.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const items = docMarksFor(i, vp.width, vp.height);
      if (!items.length) continue;
      const rot = page.rotate || 0;
      for (const it of items) {
        const a = it.angle * Math.PI / 180;
        const w = font.widthOfTextAtSize(it.text, it.size);
        // From the centre back to the baseline-left start, in display space (y grows downward):
        // half the text width against the writing direction, then half a cap-height along the
        // perpendicular, since the baseline sits below the visual centre of the text.
        const sx = it.cx - (w / 2) * Math.cos(a) + 0.34 * it.size * -Math.sin(a);
        const sy = it.cy - (w / 2) * Math.sin(a) + 0.34 * it.size * Math.cos(a);
        const [x, y] = vp.convertToPdfPoint(sx, sy);
        libPages[i].drawText(it.text, {
          x, y, size: it.size, font, color: hexRgb(it.color),
          opacity: it.opacity, rotate: degrees(rot - it.angle)
        });
      }
    }
  }

  editGo.addEventListener("click", async () => {
    if (!ed.info) return;
    ed.busy = true; editUi();
    setStatus(editStatus, "info", "Saving\u2026");
    try {
      const doc = await loadPdf(ed.info.bytes.slice(0), ed.info.file.name);
      const flatten = $("f-flatten").checked && ed.fields.length;
      const changed = ed.fields.filter(fieldChanged);
      if (changed.length || flatten) {
        const form = doc.getForm();
        for (const e of changed) {
          const f = form.getField(e.name);
          if (e.type === "text") f.setText(e.value ? e.value : undefined);
          else if (e.type === "check") e.value ? f.check() : f.uncheck();
          else if (e.type === "radio") e.value ? f.select(e.value) : f.clear();
          else if (e.type === "dropdown") e.value ? f.select(e.value) : f.clear();
          else if (e.type === "list") (e.value && e.value.length) ? f.select(e.value) : f.clear();
        }
        // Hybrid XFA forms would keep showing their old XFA data in Adobe Reader; drop it so the filled fields are what shows.
        try { if (form.acroForm.dict.has(PDFName.of("XFA")) && typeof form.deleteXFA === "function") form.deleteXFA(); } catch (e) {}
        if (flatten) form.flatten();
        else if (changed.length) form.updateFieldAppearances();
      }
      const docText = [];        // new text boxes written in one of the document's own fonts
      if (ed.objs.length) {
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const stdCache = new Map();
        const stdFontFor = async k => { const n = STD_FONT_NAMES.includes(k) ? k : "Helvetica"; if (!stdCache.has(n)) stdCache.set(n, await doc.embedFont(n)); return stdCache.get(n); };
        const libPages = doc.getPages();
        const images = new Map();
        for (const o of ed.objs) {
          const page = await ed.view.getPage(o.page + 1);
          const vp = page.getViewport({ scale: 1 });
          const rot = degrees(page.rotate || 0);
          const lp = libPages[o.page];
          const pt = (x, y) => { const [a, b] = vp.convertToPdfPoint(x, y); return { x: a, y: b }; };
          const color = hexRgb(o.color);
          if (o.type === "text") {
            if (o.docFont && o.docFont.usable && !rot.angle) {
              // written in one of the document's own fonts, the same way an edit to existing
              // text is written, so a new box matches the page instead of approximating it
              o.lines.forEach((line, i) => {
                if (!line) return;
                const p = pt(o.x + TPAD + boxAlignShift(o, line, o.docFont), o.y + TPAD + i * o.size * LINE + BASELINE * o.size);
                docText.push({ page: o.page, res: o.fontRes, stream: o.fontStream || null,
                               text: line, size: o.size, x: p.x, y: p.y, color: inkRgb(o.color) });
              });
            } else {
              const face = await stdFontFor(o.fontKey);
              o.lines.forEach((line, i) => {
                if (!line) return;
                const p = pt(o.x + TPAD + boxAlignShift(o, line, null, face), o.y + TPAD + i * o.size * LINE + BASELINE * o.size);
                lp.drawText(line, { x: p.x, y: p.y, size: o.size, font: face, color, rotate: rot });
              });
            }
          } else if (o.type === "check" || o.type === "cross") {
            const segs = o.type === "check" ? [[[15, 55], [40, 80]], [[40, 80], [88, 20]]] : [[[20, 20], [80, 80]], [[80, 20], [20, 80]]];
            segs.forEach(([a, b]) => lp.drawLine({
              start: pt(o.x + o.w * a[0] / 100, o.y + o.h * a[1] / 100),
              end: pt(o.x + o.w * b[0] / 100, o.y + o.h * b[1] / 100),
              thickness: o.w * 0.12, color, lineCap: LineCapStyle.Round
            }));
          } else if (o.type === "image") {
            if (!images.has(o.url)) images.set(o.url, await doc.embedPng(await o.blob.arrayBuffer()));
            const p = pt(o.x, o.y + o.h);
            lp.drawImage(images.get(o.url), { x: p.x, y: p.y, width: o.w, height: o.h, rotate: rot });
          } else {
            const inset = o.type === "box" ? 0.75 : 0;
            const p = pt(o.x + inset, o.y + o.h - inset);
            const opts = { x: p.x, y: p.y, width: o.w - 2 * inset, height: o.h - 2 * inset, rotate: rot };
            if (o.type === "hl") Object.assign(opts, { color: rgb(1, 0.88, 0), opacity: 0.4, blendMode: BlendMode.Multiply });
            else if (o.type === "white") Object.assign(opts, { color: rgb(1, 1, 1) });
            else Object.assign(opts, { borderColor: color, borderWidth: 1.5 });
            lp.drawRectangle(opts);
          }
        }
      }
      if ((ed.redactions || []).length) await applyRedactions(doc);
      if (docText.length) {
        // New text asked to match the document: written as operators in the page's own font,
        // the same way an edit to existing text is, so no extra font is embedded.
        const byPage = new Map();
        docText.forEach(t => { if (!byPage.has(t.page)) byPage.set(t.page, []); byPage.get(t.page).push(t); });
        for (const [pageIndex, items] of byPage) {
          const streams = await allPageOps(doc, pageIndex);
          let draw = "";
          for (const t of items) {
            const sd = t.stream && streams.streams.get(t.stream) ? streams.streams.get(t.stream).dict : null;
            const info = documentFont(doc, pageIndex, t.res, sd);
            const hex = info && info.usable ? encodeWithDocFont(info, t.text) : null;
            if (!hex) continue;              // a character this font lacks: fall through silently
            draw += "\nq BT 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr /" + String(info.name).replace(/^\//, "") +
                    " " + t.size + " Tf " + t.color.join(" ") + " rg 1 0 0 1 " +
                    (Math.round(t.x * 100) / 100) + " " + (Math.round(t.y * 100) / 100) + " Tm " + hex + " Tj ET Q";
          }
          if (draw) await applyTextEdits(doc, [], draw, pageIndex);
        }
      }
      if (ed.textEdits.size) await applyTextEdits(doc, [...ed.textEdits.values()]);
      ed.redactCheck = null;
      if (docMarksOn()) await applyDocMarks(doc, await doc.embedFont(StandardFonts.Helvetica));
      const saved = await saveDoc(doc);
      await applyResult(saved, editStepLabel());
      // read the result back and check the redacted areas really are empty
      const leftover = await verifyRedactions(saved);
      ed.lastRedactions = [];
      if (leftover && leftover.length) {
        setStatus(editStatus, "error", "Redaction incomplete: " + plural(leftover.length, "piece") +
          " of text is still inside a marked area (" + leftover.slice(0, 4).join(", ") +
          "). This text is drawn in a way the tool cannot remove \u2014 do not share this file. " +
          "Flatten the page to an image instead.");
      } else {
        setStatus(editStatus, "success", "Changes applied." +
          (flatten ? " The form answers are locked in." : "") +
          (leftover ? " The redacted areas were checked and hold no text." : ""));
      }
    } catch (err) {
      setStatus(editStatus, "error", err.message || "Something went wrong while saving.");
    } finally {
      ed.busy = false; editUi();
    }
  });

  // ================= PROTECT: metadata scrubber + passwords =================
  const pr = { info: null, report: null };
  const protStatus = $("prep-status");

  function segWire(groupId, onChange){
    document.querySelectorAll("#" + groupId + " .segbtn").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll("#" + groupId + " .segbtn").forEach(o => { o.classList.toggle("active", o === b); o.setAttribute("aria-selected", o === b ? "true" : "false"); });
      onChange(b.dataset.mode);
    }));
  }
  segWire("prep-modes", mode => {
    $("prot-meta").hidden = mode !== "meta";
    $("opt-ocr").hidden = mode !== "ocr";
    $("opt-compress").hidden = mode !== "compress";
    clearStatus(protStatus); clearStatus(optStatus);
  });
  // Sections moved between panels keep whatever hidden flag their old markup had, so set
  // the starting state of every segmented group here instead of trusting the markup.
  function initSegments(){
    const pick = (group, mode) => {
      const b = document.querySelector("#" + group + " .segbtn[data-mode=" + mode + "]");
      if (b) b.click();
    };
    pick("prep-modes", "meta");
    pick("fin-modes", "save");
    pick("pw-modes", "lock");
    pick("dg-modes", "sign");
  }

  // ---------- Metadata inspection ----------
  const INFO_FIELDS = [["Title", "getTitle"], ["Author", "getAuthor"], ["Subject", "getSubject"], ["Keywords", "getKeywords"], ["Creator", "getCreator"], ["Producer", "getProducer"], ["Created", "getCreationDate"], ["Modified", "getModificationDate"]];
  const N = s => PDFName.of(s);

  function walkAll(doc, fn){ for (const [ref, obj] of doc.context.enumerateIndirectObjects()) { const d = obj instanceof PDFStream ? obj.dict : obj; if (d instanceof PDFDict) fn(d, ref, obj); } }
  function nameTreeHas(doc, key){
    const names = doc.catalog.lookup(N("Names"));
    return names instanceof PDFDict && !!names.lookup(N(key));
  }
  function countNameTree(doc, key){
    const names = doc.catalog.lookup(N("Names"));
    if (!(names instanceof PDFDict)) return 0;
    const root = names.lookup(N(key));
    let n = 0;
    const walk = node => {
      if (!(node instanceof PDFDict)) return;
      const arr = node.lookup(N("Names"));
      if (arr instanceof PDFArray) n += Math.floor(arr.size() / 2);
      const kids = node.lookup(N("Kids"));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i));
    };
    walk(root);
    return n;
  }
  function countOccurrences(bytes, needle){ let n = 0, i = 0; const nb = enc8(needle); while ((i = bytesIndexOf(bytes, nb, i)) >= 0) { n++; i += nb.length; } return n; }

  async function inspectMeta(info){
    const doc = await PDFDocument.load(info.bytes.slice(0), { updateMetadata: false });
    const rep = { fields: [], xmp: 0, xmpBytes: 0, piece: 0, thumbs: 0, js: 0, attachments: 0, authors: 0, revisions: 0, unused: 0 };
    INFO_FIELDS.forEach(([label, getter]) => {
      let v; try { v = doc[getter](); } catch (e) { v = undefined; }
      if (v instanceof Date) v = v.toLocaleString();
      rep.fields.push([label, v ? String(v) : ""]);
    });
    walkAll(doc, (d, ref, obj) => {
      const m = d.lookup(N("Metadata"));
      if (m instanceof PDFRawStream) { rep.xmp++; rep.xmpBytes += m.getContentsSize(); }
      if (d.has(N("PieceInfo"))) rep.piece++;
      if (d.has(N("Thumb"))) rep.thumbs++;
      const s = d.lookup(N("S"));
      if (s instanceof PDFName && s.asString() === "/JavaScript") rep.js++;
      const st = d.lookup(N("Subtype"));
      if (st instanceof PDFName && d.lookup(N("Type")) instanceof PDFName && d.lookup(N("Type")).asString() === "/Annot") {
        if (st.asString() !== "/Widget" && st.asString() !== "/Popup" && d.has(N("T"))) rep.authors++;
        if (st.asString() === "/FileAttachment") rep.attachments++;
      }
    });
    if (!rep.js && nameTreeHas(doc, "JavaScript")) rep.js = Math.max(1, countNameTree(doc, "JavaScript"));
    rep.attachments += countNameTree(doc, "EmbeddedFiles");
    // PDF 2.0 / PDF-A3 "associated files" live in /AF as well, and newer writers record an
    // attachment there in addition to the name tree; count it only if it adds files.
    { const af = doc.catalog.lookup(N("AF")); if (af instanceof PDFArray && af.size() > rep.attachments) rep.attachments = af.size(); }
    const raw = new Uint8Array(info.bytes);
    rep.revisions = Math.max(1, countOccurrences(raw, "startxref"));
    // dry-run garbage collection on a throwaway copy to count unused objects
    const probe = await PDFDocument.load(info.bytes.slice(0), { updateMetadata: false });
    rep.unused = compactDoc(probe).removed;
    return rep;
  }

  function renderMetaReport(rep){
    const tb = $("meta-table"); tb.innerHTML = "";
    rep.fields.forEach(([k, v]) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th"); th.textContent = k;
      const td = document.createElement("td"); td.textContent = v || "\u2014"; if (!v) td.className = "muted";
      tr.append(th, td); tb.appendChild(tr);
    });
    const list = $("meta-findings"); list.innerHTML = "";
    const add = (txt, on) => { const li = document.createElement("li"); li.textContent = txt; li.className = on ? "hit" : "clean"; list.appendChild(li); };
    add(rep.xmp ? "XMP metadata: " + plural(rep.xmp, "stream") + " (" + fmtSize(rep.xmpBytes) + "), which often repeats the author, software and edit history" : "No XMP metadata", rep.xmp);
    add(rep.piece ? "Private application data (PieceInfo) on " + plural(rep.piece, "object") : "No private application data", rep.piece);
    add(rep.thumbs ? "Embedded page thumbnails: " + rep.thumbs : "No embedded thumbnails", rep.thumbs);
    add(rep.authors ? plural(rep.authors, "comment") + " with author names" : "No comment author names", rep.authors);
    add(rep.js ? "JavaScript: present (" + plural(rep.js, "script") + ")" : "No JavaScript", rep.js);
    add(rep.attachments ? plural(rep.attachments, "attached file") : "No attached files", rep.attachments);
    add(rep.revisions > 1 ? "Saved " + rep.revisions + " times as incremental updates; earlier versions may still be inside the file" : "Single revision", rep.revisions > 1);
    add(rep.unused ? plural(rep.unused, "unused object") + " (leftovers from earlier edits)" : "No unused objects", rep.unused);
    $("meta-opt-js-line").hidden = !rep.js;
    $("meta-opt-att-line").hidden = !rep.attachments;
    $("meta-opt-authors-line").hidden = !rep.authors;
  }

  function stripJavaScript(doc){
    const names = doc.catalog.lookup(N("Names"));
    if (names instanceof PDFDict) names.delete(N("JavaScript"));
    const oa = doc.catalog.lookup(N("OpenAction"));
    if (oa instanceof PDFDict && (oa.lookup(N("S")) || {}).asString && oa.lookup(N("S")).asString() === "/JavaScript") doc.catalog.delete(N("OpenAction"));
    walkAll(doc, d => {
      d.delete(N("AA"));
      const a = d.lookup(N("A"));
      if (a instanceof PDFDict && a.lookup(N("S")) instanceof PDFName && a.lookup(N("S")).asString() === "/JavaScript") d.delete(N("A"));
    });
  }
  function stripAttachments(doc){
    const names = doc.catalog.lookup(N("Names"));
    if (names instanceof PDFDict) names.delete(N("EmbeddedFiles"));
    // associated files (/AF) can hang off the catalog, pages, annotations and form objects
    walkAll(doc, d => d.delete(N("AF")));
    doc.getPages().forEach(pg => {
      const annots = pg.node.lookup(N("Annots"));
      if (!(annots instanceof PDFArray)) return;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookup(i);
        if (a instanceof PDFDict && a.lookup(N("Subtype")) instanceof PDFName && a.lookup(N("Subtype")).asString() === "/FileAttachment") annots.remove(i);
      }
    });
  }

  $("meta-go").addEventListener("click", async () => {
    const info = pr.info; if (!info) return;
    $("meta-go").disabled = true;
    setStatus(protStatus, "info", "Cleaning\u2026");
    try {
      const doc = await PDFDocument.load(info.bytes.slice(0), { updateMetadata: false });
      // Document info dictionary: replace with an empty one.
      doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
      walkAll(doc, d => {
        d.delete(N("Metadata")); d.delete(N("PieceInfo")); d.delete(N("LastModified")); d.delete(N("Thumb"));
        if ($("meta-opt-authors").checked && d.lookup(N("Type")) instanceof PDFName && d.lookup(N("Type")).asString() === "/Annot") {
          const st = d.lookup(N("Subtype"));
          if (st instanceof PDFName && st.asString() !== "/Widget") d.delete(N("T"));
        }
      });
      if ($("meta-opt-js").checked) stripJavaScript(doc);
      if ($("meta-opt-att").checked) stripAttachments(doc);
      const stats = {};
      const bytes = await saveDoc(doc, { stats });
      await applyResult(bytes, "hidden info removed");
      setStatus(protStatus, "success", "Hidden information removed: document properties and XMP, " + plural(stats.removed, "unused object") + " dropped, and the file rewritten as a single clean revision.");
      // show what the clean file now contains
      renderMetaReport(await inspectMeta({ file: info.file, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
      $("meta-after").hidden = false;
    } catch (err) {
      setStatus(protStatus, "error", err.message || "Something went wrong while cleaning.");
    } finally { $("meta-go").disabled = !pr.info; }
  });

  tools.prepare = {
    info: () => pr.info,
    status: protStatus,
    load: async info => {
      pr.info = info; op.info = info;
      $("prep-work").hidden = false;
      $("prep-empty").hidden = true;
      $("meta-after").hidden = true;
      $("cmp-badge").hidden = true;
      clearStatus(protStatus); clearStatus(optStatus);
      optBusy(false);
      renderMetaReport(await inspectMeta(info));
      $("meta-go").disabled = false;
    }
  };

  const pwStatus = $("fin-status");   // password messages belong on the Finish tab
  // ---------- Add a password ----------
  function pwStrength(pw){
    if (!pw) return "";
    let classes = 0; [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].forEach(r => { if (r.test(pw)) classes++; });
    if (pw.length < 8) return "Too short: anyone with the file can guess this offline.";
    if (pw.length < 12 && classes < 3) return "Weak: use 12+ characters, or a few unrelated words.";
    if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return "Strong";
    return "OK";
  }
  function lockUi(){
    const u = $("lock-user").value, u2 = $("lock-user2").value, o = $("lock-owner").value;
    const restricted = ["lock-print", "lock-copy", "lock-annot", "lock-edit"].some(id => !$(id).checked);
    $("lock-user-str").textContent = pwStrength(u);
    $("lock-user-str").className = "hint" + (/Too short|Weak/.test(pwStrength(u)) ? " warnline" : "");
    let msg = "";
    if (!u && !o) msg = "Set a password to open the file, a permissions password, or both.";
    else if (u !== u2) msg = "The two open passwords don't match.";
    else if (restricted && !o) msg = "Restrictions need a permissions password, so you can change them later.";
    else if (u && o && u === o) msg = "Use different open and permissions passwords; otherwise anyone who can open the file can also remove the restrictions.";
    $("lock-msg").textContent = msg;
    $("lock-go").disabled = !current || !!msg;
  }
  ["lock-user", "lock-user2", "lock-owner", "lock-print", "lock-copy", "lock-annot", "lock-edit"].forEach(id => $(id).addEventListener("input", lockUi));
  ["lock-print", "lock-copy", "lock-annot", "lock-edit"].forEach(id => $(id).addEventListener("change", lockUi));

  $("lock-go").addEventListener("click", async () => {
    const info = current; if (!info) return;
    $("lock-go").disabled = true;
    setStatus(pwStatus, "info", "Encrypting\u2026");
    try {
      const doc = await loadPdf(info.bytes.slice(0), info.file.name);
      const u = $("lock-user").value, o = $("lock-owner").value;
      const edit = $("lock-edit").checked;
      await saveDoc(doc, { beforeWrite: d => d.encrypt({
        userPassword: u || "",
        ownerPassword: o || u,
        algorithm: $("lock-alg").value,
        permissions: {
          printing: $("lock-print").checked ? "highResolution" : false,
          copying: $("lock-copy").checked,
          annotating: $("lock-annot").checked,
          fillingForms: $("lock-annot").checked || edit,
          modifying: edit,
          documentAssembly: edit,
          contentAccessibility: true
        }
      }) }).then(async bytes => {
        const name = baseName(info.file.name) + "_protected.pdf";
        await saveFile(name, bytes);
        setStatus(pwStatus, "success", "Saved " + name + " with " + $("lock-alg").selectedOptions[0].textContent + " encryption." + (u ? " It needs the open password to view." : " It opens without a password; the restrictions need the permissions password to change."));
      });
    } catch (err) {
      setStatus(pwStatus, "error", err.message || "Something went wrong while encrypting.");
    } finally { lockUi(); }
  });

  // ---------- Remove a password (works on files the other tools can't open) ----------
  const ul = { file: null, bytes: null, sec: null };
  wireDropzone("unlock-dz", "unlock-input", async files => {
    const f = files[0];
    clearStatus(pwStatus);
    try {
      if (f.size > MAX_BYTES) throw new Error("\"" + f.name + "\" is larger than " + fmtSize(MAX_BYTES) + ".");
      if (!(await isLikelyPdf(f))) throw new Error("\"" + f.name + "\" doesn't look like a PDF.");
      const bytes = await f.arrayBuffer();
      let doc;
      try { doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true, updateMetadata: false }); }
      catch (e) { throw new Error("\"" + f.name + "\" couldn't be opened. It may be damaged."); }
      const sec = readSecurity(doc);
      Object.assign(ul, { file: f, bytes, sec });
      $("unlock-name").textContent = f.name;
      if (!sec) { $("unlock-meta").textContent = "Not password-protected"; $("unlock-work").hidden = true; setStatus(pwStatus, "info", "This PDF isn't encrypted, so there's nothing to remove."); return; }
      if (!sec.standard) { $("unlock-work").hidden = true; setStatus(pwStatus, "error", "This PDF uses certificate-based encryption, which needs the recipient's digital ID. It can't be unlocked with a password."); return; }
      const restr = restrictionsOf(sec);
      const alg = sec.R >= 5 ? "AES-256" : sec.V === 4 ? "AES-128 or RC4-128" : "RC4 (outdated)";
      $("unlock-meta").textContent = alg + (restr.length ? " \u00b7 blocks " + restr.join(", ") : " \u00b7 no restrictions");
      $("unlock-work").hidden = false;
      $("unlock-pw").value = "";
      $("unlock-hint").textContent = restr.length
        ? "The author restricted this file, so removing the protection needs the permissions (owner) password."
        : "Enter the password used to open the file.";
      $("unlock-pw").focus();
    } catch (err) { setStatus(pwStatus, "error", err.message); }
  });
  async function unlockGo(){
    if (!ul.sec) return;
    const pw = $("unlock-pw").value;
    $("unlock-go").disabled = true;
    setStatus(pwStatus, "info", "Checking password\u2026");
    await new Promise(r => setTimeout(r, 30));
    try {
      const who = checkPassword(ul.sec, pw);
      if (!who) throw new Error("That password isn't correct.");
      if (who === "user" && restrictionsOf(ul.sec).length) throw new Error("That's the open password. Removing the author's restrictions needs the permissions (owner) password.");
      let doc;
      try { doc = await PDFDocument.load(ul.bytes.slice(0), { password: pw, updateMetadata: false }); }
      catch (e) { throw new Error(/password/i.test(e.message) ? "That password isn't correct." : "The file couldn't be decrypted: " + e.message); }
      const bytes = await saveDoc(doc);
      await applyResult(bytes, null, { base: baseName(ul.file.name) + "_unlocked", replace: true });
      setStatus(pwStatus, "success", "Unlocked and opened as the working document. Use Download to save it \u2014 anyone with that copy can open it without a password.");
    } catch (err) {
      setStatus(pwStatus, "error", err.message);
    } finally { $("unlock-go").disabled = false; }
  }
  $("unlock-go").addEventListener("click", unlockGo);
  $("unlock-pw").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); unlockGo(); } });
  $("unlock-show").addEventListener("change", () => { $("unlock-pw").type = $("unlock-show").checked ? "text" : "password"; });

  // ================= DIGITAL ID: create, sign, verify =================
  const dg = { info: null, id: null, verifyInfo: null };
  const dgStatus = $("dg-status");
  const OIDS = forge.pki.oids;
  segWire("fin-modes", mode => {
    ["save", "password", "sign"].forEach(m => { $("fin-" + m).hidden = m !== mode; });
    if (mode === "sign" && current && !dg.verifyInfo && !$("dg-verify").hidden) verifyLoad(current).catch(() => {});
    renderFinish();
  });
  segWire("pw-modes", mode => {
    $("prot-lock").hidden = mode !== "lock";
    $("prot-unlock").hidden = mode !== "unlock";
    clearStatus(protStatus);
  });
  function renderFinish(){
    $("fin-name").textContent = current ? current.file.name : "No document open";
    const n = work.steps.length;
    $("fin-steps").textContent = current ? (n ? n + " change" + (n > 1 ? "s" : "") + " applied: " + work.steps.join(", ") : "No changes applied") : "";
    $("fin-download").disabled = !current;
  }
  $("fin-download").addEventListener("click", async () => {
    try { const name = await downloadWork(); setStatus($("fin-status"), "success", "Saved " + name + "."); }
    catch (err) { setStatus($("fin-status"), "error", err.message); }
  });
  tools.finish = {
    info: () => dg.info,
    status: dgStatus,
    load: async info => {
      dg.info = info;
      $("dg-doc-name").textContent = info.file.name;
      dg.verifyInfo = null;
      renderFinish();
      lockUi();
      updateSignUi2();
      if (!$("dg-verify").hidden && !$("fin-sign").hidden) await verifyLoad(info);
    }
  };
  segWire("dg-modes", mode => {
    ["create", "sign", "verify"].forEach(m => { $("dg-" + m).hidden = m !== mode; });
    clearStatus(dgStatus);
    if (mode === "verify" && current && !dg.verifyInfo) verifyLoad(current).catch(err => setStatus(dgStatus, "error", err.message));
  });

  function certSummary(cert){
    const g = (attrs, n) => { const a = attrs.getField(n); return a ? a.value : ""; };
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fp = forge.md.sha256.create(); fp.update(der);
    return {
      cn: g(cert.subject, "CN") || "(no name)", org: g(cert.subject, "O"), email: g(cert.subject, "E") || g(cert.subject, "emailAddress"),
      issuer: g(cert.issuer, "CN") || g(cert.issuer, "O") || "(unknown)",
      selfSigned: cert.isIssuer(cert),
      serial: cert.serialNumber.toUpperCase(),
      from: cert.validity.notBefore, to: cert.validity.notAfter,
      fingerprint: fp.digest().toHex().toUpperCase().match(/.{2}/g).join(":")
    };
  }

  // ---------- A. Create a digital ID ----------
  function createUi(){
    const pw = $("dg-pw").value, pw2 = $("dg-pw2").value, name = $("dg-name").value.trim();
    let msg = "";
    if (!name) msg = "Enter the name to show on signatures.";
    else if (pw.length < 10) msg = "Use a password of at least 10 characters. It protects your private signing key.";
    else if (pw !== pw2) msg = "The two passwords don't match.";
    $("dg-create-msg").textContent = msg;
    $("dg-create-go").disabled = !!msg;
  }
  ["dg-name", "dg-pw", "dg-pw2"].forEach(id => $(id).addEventListener("input", createUi));

  async function generateRsa(){
    // WebCrypto is fast and uses the OS random source; forge is the fallback.
    if (window.crypto && crypto.subtle) {
      try {
        const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
        const pk8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
        const priv = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(bytesToBin(pk8)));
        return { privateKey: priv, publicKey: forge.pki.setRsaPublicKey(priv.n, priv.e) };
      } catch (e) { /* fall through */ }
    }
    return forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  }

  $("dg-create-go").addEventListener("click", async () => {
    $("dg-create-go").disabled = true;
    setStatus(dgStatus, "info", "Creating a 2048-bit key\u2026");
    await new Promise(r => setTimeout(r, 30));
    try {
      const keys = await generateRsa();
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(15));
      const now = new Date();
      cert.validity.notBefore = new Date(now.getTime() - 5 * 60000);
      cert.validity.notAfter = new Date(now.getTime() + (+$("dg-years").value) * 365.25 * 864e5);
      const attrs = [{ name: "commonName", value: $("dg-name").value.trim() }];
      if ($("dg-org").value.trim()) attrs.push({ name: "organizationName", value: $("dg-org").value.trim() });
      if ($("dg-email").value.trim()) attrs.push({ name: "emailAddress", value: $("dg-email").value.trim() });
      cert.setSubject(attrs); cert.setIssuer(attrs);
      cert.setExtensions([
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
        { name: "extKeyUsage", emailProtection: true, "1.3.6.1.5.5.7.3.36": true },
        { name: "subjectKeyIdentifier" }
      ]);
      cert.sign(keys.privateKey, forge.md.sha256.create());
      const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], $("dg-pw").value, { algorithm: "aes256", count: 100000, friendlyName: $("dg-name").value.trim(), generateLocalKeyId: true });
      const pfx = binToBytes(forge.asn1.toDer(p12).getBytes());
      const certDer = binToBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
      const base = $("dg-name").value.trim().replace(/[^\w.-]+/g, "_").slice(0, 40) || "digital-id";
      dg.id = { key: keys.privateKey, cert, chain: [cert], label: "the digital ID you just created" };
      dg.created = { pfx, certDer, base };
      $("dg-created").hidden = false;
      $("dg-created-fp").textContent = certSummary(cert).fingerprint;
      $("dg-pw").value = ""; $("dg-pw2").value = ""; createUi();
      setStatus(dgStatus, "success", "Digital ID created. Download the .pfx now: this is the only copy of the private key, and it isn't kept anywhere.");
      updateSignUi2();
    } catch (err) {
      setStatus(dgStatus, "error", "Couldn't create the digital ID: " + (err.message || err));
    }
  });
  $("dg-dl-pfx").addEventListener("click", async () => {
    try { await saveFile(dg.created.base + ".pfx", new Blob([dg.created.pfx], { type: "application/x-pkcs12" })); setStatus(dgStatus, "success", "Saved " + dg.created.base + ".pfx. Store it like a key: anyone with the file and password can sign as you."); }
    catch (err) { setStatus(dgStatus, "error", err.message); }
  });
  $("dg-dl-cer").addEventListener("click", async () => {
    try { await saveFile(dg.created.base + ".cer", new Blob([dg.created.certDer], { type: "application/pkix-cert" })); setStatus(dgStatus, "success", "Saved " + dg.created.base + ".cer. Share it with people who need to trust your signatures; it contains no private key."); }
    catch (err) { setStatus(dgStatus, "error", err.message); }
  });

  // ---------- B. Sign ----------
  let pendingPfx = null;
  wireDropzone("dg-pfx-dz", "dg-pfx-input", async files => {
    const f = files[0];
    if (!/\.(pfx|p12)$/i.test(f.name) || f.size > 200000) { setStatus(dgStatus, "error", "Choose a .pfx or .p12 digital ID file."); return; }
    pendingPfx = new Uint8Array(await f.arrayBuffer());
    $("dg-pfx-name").textContent = f.name;
    $("dg-pfx-pw").value = "";
    $("dg-pfx-unlock").hidden = false;
    $("dg-pfx-pw").focus();
    clearStatus(dgStatus);
  });
  function openPfx(){
    try {
      const asn1 = forge.asn1.fromDer(bytesToBin(pendingPfx));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, $("dg-pfx-pw").value);
      const keyBag = (p12.getBags({ bagType: OIDS.pkcs8ShroudedKeyBag })[OIDS.pkcs8ShroudedKeyBag] || []).concat(p12.getBags({ bagType: OIDS.keyBag })[OIDS.keyBag] || [])[0];
      const certs = (p12.getBags({ bagType: OIDS.certBag })[OIDS.certBag] || []).map(b => b.cert).filter(Boolean);
      if (!keyBag || !keyBag.key) throw new Error("This file has no private key, so it can't be used to sign. (A .cer file is only the public half.)");
      if (!keyBag.key.n) throw new Error("This digital ID uses an elliptic-curve key, which this tool can't sign with yet. Use an RSA digital ID.");
      const cert = certs.find(c => c.publicKey && c.publicKey.n && c.publicKey.n.equals(keyBag.key.n));
      if (!cert) throw new Error("The certificate matching the private key isn't in this file.");
      dg.id = { key: keyBag.key, cert, chain: [cert].concat(certs.filter(c => c !== cert)), label: $("dg-pfx-name").textContent };
      $("dg-pfx-pw").value = "";
      $("dg-pfx-unlock").hidden = true;
      pendingPfx = null;
      clearStatus(dgStatus);
      updateSignUi2();
    } catch (err) {
      const m = String(err.message || err);
      setStatus(dgStatus, "error", /MAC|password|decrypt/i.test(m) ? "That password doesn't unlock this digital ID." : m);
    }
  }
  $("dg-pfx-open").addEventListener("click", openPfx);
  $("dg-pfx-pw").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); openPfx(); } });

  function updateSignUi2(){
    const box = $("dg-id-card");
    if (dg.id) {
      const s = certSummary(dg.id.cert);
      box.hidden = false;
      $("dg-id-who").textContent = s.cn + (s.org ? ", " + s.org : "");
      const expired = s.to < new Date();
      $("dg-id-meta").textContent = (s.selfSigned ? "Self-signed" : "Issued by " + s.issuer) + " \u00b7 valid until " + s.to.toLocaleDateString() + (expired ? " (EXPIRED)" : "");
      $("dg-id-meta").className = expired ? "warnline" : "muted";
    } else box.hidden = true;
    let msg = "";
    if (!dg.info) msg = "Choose the PDF to sign.";
    else if (!dg.id) msg = "Load your digital ID (.pfx), or create one first.";
    else if (dg.info.signed) msg = "This PDF already has a digital signature. Signing it here would rewrite the file and break that signature, so it's blocked.";
    else if (certSummary(dg.id.cert).to < new Date()) msg = "This digital ID has expired.";
    $("dg-sign-msg").textContent = msg;
    $("dg-sign-go").disabled = !!msg;
  }

  const SIG_SPACE = 12288; // bytes reserved for the PKCS#7 signature
  $("dg-sign-go").addEventListener("click", async () => {
    const info = dg.info, id = dg.id; if (!info || !id) return;
    $("dg-sign-go").disabled = true;
    setStatus(dgStatus, "info", "Signing\u2026");
    try {
      const doc = await loadPdf(info.bytes.slice(0), info.file.name);
      const ctx = doc.context;
      const s = certSummary(id.cert);
      const pages = doc.getPages();
      const page = pages[$("dg-visible").checked ? pages.length - 1 : 0];
      let rect = [0, 0, 0, 0];
      if ($("dg-visible").checked) {
        // A small signature block at the bottom-right of the last page (in the page's own coordinates).
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const { x: bx, y: by, width: bw } = page.getCropBox();
        const w = 220, h = 46, x = bx + bw - w - 36, y = by + 30;
        page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.1, 0.23, 0.55), borderWidth: 1, color: rgb(0.96, 0.97, 1) });
        const line1 = "Digitally signed by " + s.cn, line2 = new Date().toLocaleString();
        const fit = t => cleanText(t).text.replace(/\n/g, " ");
        page.drawText(fit(line1).slice(0, 48), { x: x + 8, y: y + 28, size: 9, font, color: rgb(0.1, 0.23, 0.55) });
        page.drawText(fit(line2), { x: x + 8, y: y + 14, size: 8, font, color: rgb(0.25, 0.25, 0.3) });
        rect = [x, y, x + w, y + h];
      }
      const byteRange = PDFArray.withContext(ctx);
      [0, 9999999999, 9999999999, 9999999999].forEach(n => byteRange.push(PDFNumber.of(n)));
      const txt = t => PDFHexString.fromText(t);
      const sigDict = ctx.obj({
        Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached",
        ByteRange: byteRange,
        Contents: PDFHexString.of("0".repeat(SIG_SPACE * 2)),
        M: PDFString.fromDate(new Date()),
        Name: txt(s.cn)
      });
      if ($("dg-reason").value.trim()) sigDict.set(N("Reason"), txt($("dg-reason").value.trim()));
      if ($("dg-location").value.trim()) sigDict.set(N("Location"), txt($("dg-location").value.trim()));
      if (s.email) sigDict.set(N("ContactInfo"), txt(s.email));
      const sigRef = ctx.register(sigDict);
      const acro = doc.catalog.getOrCreateAcroForm();
      const n = acro.getAllFields().length + 1;
      const widget = ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: rect, V: sigRef, T: txt("Signature" + n), F: 132, P: page.ref });
      const widgetRef = ctx.register(widget);
      page.node.addAnnot(widgetRef);
      acro.addField(widgetRef);
      acro.dict.set(N("SigFlags"), PDFNumber.of(3));
      // Signatures need the placeholder in plain text, so no object streams here.
      const pdf = await saveDoc(doc, { objectStreams: false });

      const zeros = enc8("<" + "0".repeat(SIG_SPACE * 2) + ">");
      const start = bytesIndexOf(pdf, zeros);
      if (start < 0 || bytesIndexOf(pdf, zeros, start + 1) >= 0) throw new Error("Couldn't prepare the signature space in this file.");
      const end = start + zeros.length;
      const brKey = bytesIndexOf(pdf, enc8("/ByteRange"));
      const brOpen = pdf.indexOf(91, brKey), brClose = pdf.indexOf(93, brOpen); // [ and ]
      const brText = "[0 " + start + " " + end + " " + (pdf.length - end) + "]";
      const slot = brClose - brOpen + 1;
      if (brText.length > slot) throw new Error("Couldn't write the byte range.");
      pdf.set(enc8(brText.padEnd(slot, " ")), brOpen);
      const signedPart = cat(pdf.subarray(0, start), pdf.subarray(end));

      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(bytesToBin(signedPart));
      id.chain.forEach(c => p7.addCertificate(c));
      p7.addSigner({
        key: id.key, certificate: id.cert, digestAlgorithm: OIDS.sha256,
        authenticatedAttributes: [
          { type: OIDS.contentType, value: OIDS.data },
          { type: OIDS.messageDigest },
          { type: OIDS.signingTime, value: new Date() }
        ]
      });
      p7.sign({ detached: true });
      const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
      if (der.length > SIG_SPACE) throw new Error("This digital ID's certificate chain is too large to embed.");
      pdf.set(enc8(forge.util.bytesToHex(der).toUpperCase()), start + 1);
      const name = baseName(info.file.name) + "_signed.pdf";
      await saveFile(name, pdf);
      setStatus(dgStatus, "success", "Saved " + name + ", signed by " + s.cn + ". Any change to the file from now on will show up as a broken signature.");
    } catch (err) {
      setStatus(dgStatus, "error", err.message || "Signing failed.");
    } finally { updateSignUi2(); }
  });

  // ---------- C. Verify ----------
  const DIGESTS = { [OIDS.sha1]: ["sha1", "SHA-1"], [OIDS.sha256]: ["sha256", "SHA-256"], [OIDS.sha384]: ["sha384", "SHA-384"], [OIDS.sha512]: ["sha512", "SHA-512"] };
  // RSA PKCS#1 v1.5 check done here instead of in node-forge: forge <= 1.4.0 tolerates extra bytes
  // inside the DigestInfo (GHSA-86w9-cpqp-85rv), which lets a low-exponent key's signature be
  // forged. This rebuilds the one exact encoding that is allowed and compares every byte.
  const DIGESTINFO_PREFIX = {
    sha1: "3021300906052b0e03021a05000414", sha256: "3031300d060960864801650304020105000420",
    sha384: "3041300d060960864801650304020205000430", sha512: "3051300d060960864801650304020305000440"
  };
  function strictRsaVerify(pub, digestBin, sigBin, hashName){
    const BI = forge.jsbn.BigInteger, prefix = DIGESTINFO_PREFIX[hashName];
    if (!prefix || !pub || !pub.n || !pub.e) return false;
    if (pub.e.compareTo(new BI("65537")) < 0) return false;               // low exponents are what the forgery needs
    const k = Math.ceil(pub.n.bitLength() / 8);
    if (k < 128 || sigBin.length > k) return false;                       // 1024-bit keys and up
    const hex = forge.util.bytesToHex(sigBin);
    const sig = new BI(hex || "0", 16);
    if (sig.compareTo(pub.n) >= 0) return false;
    let em = sig.modPow(pub.e, pub.n).toString(16);
    em = em.padStart(k * 2, "0");
    const dh = forge.util.bytesToHex(digestBin);
    const padLen = k - 3 - (prefix.length + dh.length) / 2;
    if (padLen < 8) return false;
    return em === "0001" + "ff".repeat(padLen) + "00" + prefix + dh;
  }
  function asn1Find(node, pred){ if (pred(node)) return node; if (Array.isArray(node.value)) for (const c of node.value) { const r = asn1Find(c, pred); if (r) return r; } return null; }

  function verifyOne(fileBytes, br, contents){
    const r = { ok: false, integrity: "unknown", coversAll: false, problems: [] };
    const [a, b, c, d] = br;
    if (a !== 0 || b <= 0 || c <= b || c + d > fileBytes.length) { r.problems.push("The signature's byte range is malformed."); return r; }
    let trailing = fileBytes.length - (c + d);
    // tolerate trailing whitespace after %%EOF
    for (let i = c + d; i < fileBytes.length && trailing > 0; i++) { const ch = fileBytes[i]; if (ch === 10 || ch === 13 || ch === 32 || ch === 0) trailing--; else break; }
    r.coversAll = trailing === 0;
    const signed = cat(fileBytes.subarray(a, a + b), fileBytes.subarray(c, c + d));
    let msg;
    try {
      const asn = forge.asn1.fromDer(forge.util.createBuffer(bytesToBin(contents)), { strict: false, parseAllBytes: false });
      msg = forge.pkcs7.messageFromAsn1(asn);
    } catch (e) { r.problems.push("The signature data couldn't be read (" + (e.message || e) + ")."); return r; }
    const certs = msg.certificates || [];
    const signerInfos = msg.rawCapture && msg.rawCapture.signerInfos;
    if (!signerInfos || !signerInfos.length) { r.problems.push("No signer information found."); return r; }
    const si = signerInfos[0];
    // SignerInfo: version, issuerAndSerial, digestAlg, [0] authAttrs?, sigAlg, signature
    const parts = si.value;
    const serialHex = forge.util.bytesToHex(parts[1].value[1].value).replace(/^0+/, "").toUpperCase();
    const digestOid = forge.asn1.derToOid(parts[2].value[0].value);
    let idx = 3, auth = null;
    if (parts[idx] && parts[idx].tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && parts[idx].type === 0) { auth = parts[idx]; idx++; }
    const sigAlgOid = forge.asn1.derToOid(parts[idx].value[0].value);
    const sigBytes = parts[idx + 1].value;
    const cert = certs.find(cc => cc.serialNumber.replace(/^0+/, "").toUpperCase() === serialHex) || certs[0];
    r.cert = cert ? certSummary(cert) : null;
    const dg0 = DIGESTS[digestOid];
    if (!dg0) { r.problems.push("Unsupported digest algorithm (" + digestOid + ")."); return r; }
    r.digestName = dg0[1];
    const mdSigned = forge.md[dg0[0]].create(); mdSigned.update(bytesToBin(signed));
    const docDigest = mdSigned.digest().getBytes();
    if (auth) {
      const mdAttr = asn1Find(auth, n => n.type === forge.asn1.Type.OID && forge.asn1.derToOid(n.value) === OIDS.messageDigest);
      const holder = mdAttr && auth.value.find(attr => attr.value[0] === mdAttr);
      const val = holder && holder.value[1].value[0].value;
      r.integrity = val === docDigest ? "match" : "mismatch";
      const tAttr = auth.value.find(attr => forge.asn1.derToOid(attr.value[0].value) === OIDS.signingTime);
      if (tAttr) { try { const t = tAttr.value[1].value[0]; r.signedAt = t.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(t.value) : forge.asn1.generalizedTimeToDate(t.value); } catch (e) {} }
    }
    if (!cert) { r.problems.push("The signer's certificate isn't included."); return r; }
    if (!cert.publicKey || !cert.publicKey.n) { r.problems.push("This signature uses an elliptic-curve key, which this tool can't check yet."); return r; }
    if (![OIDS.rsaEncryption, OIDS.sha256WithRSAEncryption, OIDS.sha1WithRSAEncryption, OIDS.sha384WithRSAEncryption, OIDS.sha512WithRSAEncryption].includes(sigAlgOid)) {
      r.problems.push("Unsupported signature algorithm (" + sigAlgOid + ")."); return r;
    }
    let toVerify;
    if (auth) {
      const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, auth.value);
      const m = forge.md[dg0[0]].create(); m.update(forge.asn1.toDer(set).getBytes()); toVerify = m.digest().getBytes();
    } else { toVerify = docDigest; r.integrity = "match"; }
    let sigOk = false;
    try { sigOk = strictRsaVerify(cert.publicKey, toVerify, sigBytes, dg0[0]); } catch (e) { sigOk = false; }
    r.sigOk = sigOk;
    if (!auth && !sigOk) r.integrity = "mismatch";
    r.ok = sigOk && r.integrity === "match";
    if (r.cert && r.signedAt && (r.signedAt < r.cert.from || r.signedAt > r.cert.to)) r.problems.push("The certificate wasn't valid at the claimed signing time.");
    return r;
  }

  async function verifyLoad(info){
    dg.verifyInfo = info;
    $("dgv-name").textContent = info.file.name + " \u00b7 choose another";
    const out = $("dgv-results"); out.innerHTML = "";
    const doc = await PDFDocument.load(info.bytes.slice(0), { updateMetadata: false });
    const bytes = new Uint8Array(info.bytes);
    const sigs = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const br = obj.lookup(N("ByteRange")), ct = obj.lookup(N("Contents"));
      if (!(br instanceof PDFArray) || !ct || typeof ct.asBytes !== "function") continue;
      const sub = obj.lookup(N("SubFilter"));
      sigs.push({ br: br.asArray().map(x => x.asNumber()), contents: ct.asBytes(), sub: sub instanceof PDFName ? sub.asString().slice(1) : "", name: obj.lookup(N("Name")), reason: obj.lookup(N("Reason")) });
    }
    sigs.sort((a, b) => a.br[2] - b.br[2]);
    if (!sigs.length) {
      const p = document.createElement("div"); p.className = "vres none"; p.textContent = "This PDF has no digital signatures.";
      out.appendChild(p); return;
    }
    sigs.forEach((sg0, i) => {
      const card = document.createElement("div");
      let r;
      if (!/pkcs7\.detached|CAdES\.detached|pkcs7\.sha1/i.test(sg0.sub)) r = { ok: false, problems: ["Signature format \u201c" + sg0.sub + "\u201d isn't supported by this checker."], integrity: "unknown" };
      else r = verifyOne(bytes, sg0.br, sg0.contents);
      const later = !r.coversAll && r.ok;
      card.className = "vres " + (r.ok ? (later ? "warn" : "good") : (r.integrity === "unknown" ? "warn" : "bad"));
      const h = document.createElement("div"); h.className = "vhead";
      h.textContent = r.ok ? (later ? "Signature valid, but the file was changed after this signature" : "Valid: the document hasn't changed since it was signed")
        : r.integrity === "mismatch" || r.sigOk === false ? "Invalid: the document was modified after signing, or the signature is broken"
        : "Couldn't check this signature";
      card.appendChild(h);
      const dl = document.createElement("dl");
      const row = (k, v) => { if (!v) return; const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
      row("Signature", (i + 1) + " of " + sigs.length);
      if (r.cert) {
        row("Signed by", r.cert.cn + (r.cert.org ? ", " + r.cert.org : "") + (r.cert.email ? " <" + r.cert.email + ">" : ""));
        row("Issued by", r.cert.selfSigned ? "Self-signed (the signer vouched for themselves)" : r.cert.issuer);
        row("Serial number", r.cert.serial);
        row("Certificate valid", r.cert.from.toLocaleDateString() + " to " + r.cert.to.toLocaleDateString());
        row("SHA-256 fingerprint", r.cert.fingerprint);
      }
      if (r.signedAt) row("Signed at", r.signedAt.toLocaleString() + " (signer's clock)");
      if (sg0.reason && sg0.reason.decodeText) row("Reason", sg0.reason.decodeText());
      if (r.digestName) row("Hash", r.digestName);
      card.appendChild(dl);
      const notes = [...(r.problems || [])];
      if (later) notes.push("Content was added after this signature (for example another signature, form entries, or comments). The signed version itself is intact.");
      if (r.ok) notes.push("Identity: this tool can't check certificate authorities offline, so it can't confirm who owns this certificate. Compare the fingerprint above with one the signer gives you directly.");
      notes.forEach(t => { const n = document.createElement("div"); n.className = "vnote"; n.textContent = t; card.appendChild(n); });
      out.appendChild(card);
    });
  }
  wireDropzone("dgv-dz", "dgv-input", async files => {
    clearStatus(dgStatus);
    try { await verifyLoad(await prepare(files[0])); } catch (err) { setStatus(dgStatus, "error", err.message); }
  });



  // ================= OPTIMIZE: OCR + compress =================
  const op = { info: null, cancel: false };
  const optStatus = $("opt-status");
  (function fillOcrLangs(){
    const sel = $("ocr-lang"), assets = window.__PDFTOOLS_OCR;
    const codes = assets && assets.langs ? Object.keys(assets.langs) : [];
    sel.innerHTML = "";
    if (!codes.length) { sel.appendChild(new Option("Not available in this build", "")); sel.disabled = true; return; }
    codes.forEach(c => sel.appendChild(new Option(assets.langs[c].name, c)));
    if (codes.length > 1) sel.appendChild(new Option(codes.map(c => assets.langs[c].name).join(" + "), codes.join("+")));
    sel.disabled = codes.length === 1;
  })();

  function progress(pct, text){
    $("opt-progress").hidden = pct === null;
    if (pct !== null) { $("opt-bar").style.width = Math.max(2, Math.min(100, pct)) + "%"; $("opt-ptext").textContent = text; }
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  $("opt-cancel").addEventListener("click", () => { op.cancel = true; $("opt-ptext").textContent = "Stopping after this step\u2026"; });
  function optBusy(on){
    op.cancel = false;
    $("ocr-go").disabled = on || !op.info; $("cmp-go").disabled = on || !op.info;
    document.querySelectorAll("#opt-modes .segbtn").forEach(b => { b.disabled = on; });
    if (!on) progress(null);
  }

  // ---------- F. OCR ----------
  // The Tesseract engine (WebAssembly) and English model are embedded in this file.
  // It runs on the page itself (no worker), is started only when needed, and is shut
  // down and released as soon as each job finishes.
  async function startOcrEngine(langs){
    const assets = window.__PDFTOOLS_OCR;
    if (!assets || typeof TesseractCore !== "function") throw new Error("The OCR engine isn't included in this copy of the tool.");
    const codes = langs.filter(c => assets.langs && assets.langs[c]);
    if (!codes.length) throw new Error("That language isn't included in this copy of the tool.");
    const models = [];
    for (const c of codes) {
      const gz = b64ToBytes(assets.langs[c].data);
      models.push([c, new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer())]);
    }
    let M;
    try { M = await TesseractCore({ wasmBinary: b64ToBytes(assets.wasm), print: () => {}, printErr: () => {} }); }
    catch (e) {
      const m = String(e && e.message || e);
      if (/WebAssembly|wasm|unsafe-eval|CompileError/i.test(m)) throw new Error("OCR needs WebAssembly, which this viewer's security settings block. Use the downloadable copy of this page for OCR.");
      throw e;
    }
    models.forEach(([c, data]) => M.FS.writeFile("./" + c + ".traineddata", data));
    const api = new M.TessBaseAPI();
    if (api.Init(null, codes.join("+"), 1, "") !== 0) { api.delete && api.delete(); throw new Error("The OCR engine couldn't start."); }
    return { M, api, codes };
  }
  function stopOcrEngine(eng){
    if (!eng) return;
    try { eng.api.End(); } catch (e) {}
    try { eng.api.delete && eng.api.delete(); } catch (e) {}
    (eng.codes || []).forEach(c => { try { eng.M.FS.unlink("./" + c + ".traineddata"); } catch (e) {} });
    eng.M = null; eng.api = null;
  }
  function canvasPng(c){ return new Promise((res, rej) => c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error("Couldn't capture the page.")), "image/png")); }

  // hOCR gives each line's true baseline and font size (x_size is ~0.9 of the em size),
  // which places the invisible text far more precisely than word boxes alone.
  function parseHocr(html){
    const dom = new DOMParser().parseFromString(html, "text/html"); // inert: no scripts run, nothing loads
    const num = (t, k) => { const m = new RegExp(k + " ([-\\d.]+)(?: ([-\\d.]+))?(?: ([-\\d.]+))?(?: ([-\\d.]+))?").exec(t || ""); return m ? m.slice(1).filter(v => v !== undefined).map(Number) : null; };
    const words = [];
    dom.querySelectorAll(".ocr_line, .ocr_textfloat, .ocr_header, .ocr_caption").forEach(line => {
      const lt = line.getAttribute("title");
      const lb = num(lt, "bbox"); if (!lb) return;
      const bl = num(lt, "baseline") || [0, 0];
      const xs = (num(lt, "x_size") || [lb[3] - lb[1]])[0];
      line.querySelectorAll(".ocrx_word").forEach(w => {
        const wb = num(w.getAttribute("title"), "bbox"); const conf = (num(w.getAttribute("title"), "x_wconf") || [0])[0];
        const text = (w.textContent || "").trim();
        if (!wb || !text || conf <= 0) return;
        words.push({ l: wb[0], r: wb[2], baseY: lb[3] + bl[0] * (wb[0] - lb[0]) + bl[1], em: xs / 0.9, text });
      });
    });
    return words;
  }

  $("ocr-go").addEventListener("click", async () => {
    const info = op.info; if (!info) return;
    optBusy(true);
    let eng = null, pdfv = null;
    const canvas = document.createElement("canvas");
    try {
      progress(3, "Starting the OCR engine\u2026");
      await tick();
      eng = await startOcrEngine($("ocr-lang").value.split("+"));
      await helvReady; helv = await helvReady; await stdFontsReady;
      const doc = await loadPdf(info.bytes.slice(0), info.file.name);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      pdfv = await openPdfJs(info.bytes);
      const pages = doc.getPages();
      const skipText = $("ocr-skip").checked;
      const dpi = 300;
      let done = 0, skipped = 0, words = 0;
      const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, showText } = PDFLib;
      for (let i = 0; i < pages.length; i++) {
        if (op.cancel) throw new Error("Stopped. No file was saved.");
        progress(5 + 90 * i / pages.length, "Reading page " + (i + 1) + " of " + pages.length + "\u2026");
        await tick();
        const pg = await pdfv.getPage(i + 1);
        if (skipText) {
          const tc = await pg.getTextContent();
          const chars = tc.items.reduce((n, it) => n + (it.str ? it.str.replace(/\s/g, "").length : 0), 0);
          if (chars > 0) { skipped++; continue; }
        }
        const base = pg.getViewport({ scale: 1 });
        let scale = dpi / 72;
        const maxSide = 5000;
        if (Math.max(base.width, base.height) * scale > maxSide) scale = maxSide / Math.max(base.width, base.height);
        const vp = pg.getViewport({ scale });
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        const c2 = canvas.getContext("2d");
        c2.fillStyle = "#fff"; c2.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: c2, viewport: vp }).promise;
        const png = await canvasPng(canvas);
        eng.M.FS.writeFile("/input", png);
        if (eng.api.SetImageFile(1, 0) === 1) throw new Error("The OCR engine couldn't read page " + (i + 1) + ".");
        eng.api.Recognize(null);
        const found = parseHocr(eng.api.GetHOCRText(0));
        try { eng.M.FS.unlink("/input"); } catch (e) {}
        if (!found.length) { done++; continue; }
        // Invisible text (render mode 3), each word stretched to its box so selection lines up with the scan.
        const rot = (pg.rotate || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        const page = pages[i];
        const key = page.node.newFontDictionary(font.name, font.ref);
        const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
        for (const w of found) {
          const t = cleanText(w.text).text.replace(/\n/g, " ");
          if (!t) continue;
          const size = Math.max(2, w.em / scale);
          const nat = font.widthOfTextAtSize(t, size);
          if (!nat) continue;
          const sx = ((w.r - w.l) / scale) / nat;
          const [x, y] = base.convertToPdfPoint(w.l / scale, w.baseY / scale);
          ops.push(setFontAndSize(key, size), setTextMatrix(sx * cos, sx * sin, -sin, cos, x, y), showText(font.encodeText(t)));
          words++;
        }
        ops.push(endText(), popGraphicsState());
        page.pushOperators(...ops);
        done++;
        c2.clearRect(0, 0, canvas.width, canvas.height);
      }
      progress(97, "Saving\u2026"); await tick();
      if (!done) { setStatus(optStatus, "info", "Every page already has text, so there was nothing to read. (Turn off \u201cSkip pages that already have text\u201d to re-read them.)"); return; }
      const bytes = await saveDoc(doc);
      await applyResult(bytes, "OCR text layer");
      setStatus(optStatus, "success", "Text added: found " + plural(words, "word") + " on " + plural(done, "page") + (skipped ? " (" + plural(skipped, "page") + " already had text and were left alone)" : "") + ". The pages look the same; the text is now searchable and selectable. OCR can misread words, so check anything important.");
    } catch (err) {
      setStatus(optStatus, "error", err.message || "OCR failed.");
    } finally {
      stopOcrEngine(eng);
      if (pdfv) pdfv.destroy().catch(() => {});
      canvas.width = 0; canvas.height = 0;
      optBusy(false);
    }
  });

  // ---------- G. Compress ----------
  $("cmp-q").addEventListener("input", () => { $("cmp-qv").textContent = $("cmp-q").value + "%"; });

  function imageInfo(doc, obj){
    const d = obj.dict;
    const name = k => { const v = d.lookup(N(k)); return v instanceof PDFName ? v.asString() : null; };
    const num = k => { const v = d.lookup(N(k)); return v instanceof PDFNumber ? v.asNumber() : null; };
    let filter = d.lookup(N("Filter"));
    if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : "multi";
    const f = filter instanceof PDFName ? filter.asString() : filter === undefined ? "none" : "multi";
    let cs = d.lookup(N("ColorSpace")), comps = null, palette = null;
    if (cs instanceof PDFName) comps = { "/DeviceGray": 1, "/DeviceRGB": 3, "/CalGray": 1, "/CalRGB": 3 }[cs.asString()] || null;
    else if (cs instanceof PDFArray) {
      const kind = cs.lookup(0) instanceof PDFName ? cs.lookup(0).asString() : "";
      if (kind === "/ICCBased") { const s = cs.lookup(1); const n = s && s.dict && s.dict.lookup(N("N")); comps = n instanceof PDFNumber && n.asNumber() !== 4 ? n.asNumber() : null; }
      else if (kind === "/Indexed") {
        const baseCs = cs.lookup(1); const hival = cs.lookup(2); let lut = cs.lookup(3);
        const baseN = baseCs instanceof PDFName ? { "/DeviceRGB": 3, "/DeviceGray": 1 }[baseCs.asString()] : null;
        if (baseN && hival instanceof PDFNumber && lut) {
          lut = lut instanceof PDFStream ? PDFLib.decodePDFRawStream(lut).decode() : typeof lut.asBytes === "function" ? lut.asBytes() : null;
          if (lut) { comps = 1; palette = { lut, n: baseN }; }
        }
      }
    }
    return {
      w: num("Width"), h: num("Height"), bpc: num("BitsPerComponent"), filter: f, comps, palette,
      imageMask: d.lookup(N("ImageMask")) instanceof PDFBool && d.lookup(N("ImageMask")).asBoolean(),
      colorKey: d.lookup(N("Mask")) instanceof PDFArray, decode: d.has(N("Decode")),
      predictor: (() => { const p = d.lookup(N("DecodeParms")); const v = p instanceof PDFDict ? p.lookup(N("Predictor")) : null; return v instanceof PDFNumber ? v.asNumber() : 1; })(),
      size: obj.getContentsSize()
    };
  }

  async function toBitmapSource(obj, im){
    if (im.filter === "/DCTDecode") return createImageBitmap(new Blob([obj.getContents()], { type: "image/jpeg" }));
    const raw = PDFLib.decodePDFRawStream(obj).decode();
    const px = im.w * im.h;
    if (raw.length < px * (im.palette ? 1 : im.comps)) throw new Error("short image data");
    const data = new ImageData(im.w, im.h);
    const out = data.data;
    for (let i = 0, o = 0; i < px; i++, o += 4) {
      if (im.palette) { const k = raw[i] * im.palette.n, L = im.palette.lut; if (im.palette.n === 3) { out[o] = L[k]; out[o + 1] = L[k + 1]; out[o + 2] = L[k + 2]; } else { out[o] = out[o + 1] = out[o + 2] = L[k]; } }
      else if (im.comps === 3) { out[o] = raw[i * 3]; out[o + 1] = raw[i * 3 + 1]; out[o + 2] = raw[i * 3 + 2]; }
      else { out[o] = out[o + 1] = out[o + 2] = raw[i]; }
      out[o + 3] = 255;
    }
    return createImageBitmap(data);
  }

  $("cmp-go").addEventListener("click", async () => {
    const info = op.info; if (!info) return;
    optBusy(true);
    const canvas = document.createElement("canvas");
    try {
      progress(3, "Looking for images\u2026"); await tick();
      const doc = await loadPdf(info.bytes.slice(0), info.file.name);
      const ctx = doc.context;
      const dpi = +document.querySelector("input[name=cmp-dpi]:checked").value;
      const q = +$("cmp-q").value / 100;
      // Never shrink an image below what's needed to fill the largest page at the chosen DPI.
      const longest = Math.max(...doc.getPages().map(p => { const { width, height } = p.getSize(); return Math.max(width, height); }));
      const maxPx = Math.ceil(longest / 72 * dpi);
      const maskRefs = new Set();
      for (const [, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFStream)) continue;
        ["SMask", "Mask"].forEach(k => { const v = obj.dict.get(N(k)); if (v instanceof PDFRef) maskRefs.add(v); });
      }
      const images = [];
      for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const st = obj.dict.lookup(N("Subtype"));
        if (!(st instanceof PDFName) || st.asString() !== "/Image" || maskRefs.has(ref)) continue;
        images.push([ref, obj]);
      }
      let changed = 0, skipped = 0;
      for (let i = 0; i < images.length; i++) {
        if (op.cancel) throw new Error("Stopped. No file was saved.");
        progress(5 + 85 * i / Math.max(1, images.length), "Processing image " + (i + 1) + " of " + images.length + "\u2026");
        await tick();
        const [ref, obj] = images[i];
        const im = imageInfo(doc, obj);
        const supported = im.w && im.h && im.bpc === 8 && !im.imageMask && !im.colorKey && !im.decode && im.comps &&
          (im.filter === "/DCTDecode" || ((im.filter === "/FlateDecode" || im.filter === "none") && im.predictor === 1));
        if (!supported || im.size < 20000 || im.w * im.h > 100e6) { skipped++; continue; }     // a declared size in the hundreds of megapixels would only exhaust memory
        let src;
        try { src = await toBitmapSource(obj, im); } catch (e) { skipped++; continue; }
        const s = Math.min(1, maxPx / Math.max(im.w, im.h));
        canvas.width = Math.max(1, Math.round(im.w * s)); canvas.height = Math.max(1, Math.round(im.h * s));
        const c2 = canvas.getContext("2d");
        c2.fillStyle = "#fff"; c2.fillRect(0, 0, canvas.width, canvas.height);
        c2.imageSmoothingQuality = "high";
        c2.drawImage(src, 0, 0, canvas.width, canvas.height);
        if (src.close) src.close();
        const jpg = await new Promise(r => canvas.toBlob(b => r(b), "image/jpeg", q));
        const jb = new Uint8Array(await jpg.arrayBuffer());
        if (jb.length >= im.size * 0.9) { skipped++; continue; }
        const nd = { Type: "XObject", Subtype: "Image", Width: canvas.width, Height: canvas.height, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" };
        const keep = {};
        ["SMask", "Interpolate", "Intent", "OC", "Metadata"].forEach(k => { const v = obj.dict.get(N(k)); if (v !== undefined) keep[k] = v; });
        const ns = ctx.stream(jb, nd);
        Object.entries(keep).forEach(([k, v]) => ns.dict.set(N(k), v));
        ctx.assign(ref, ns);
        changed++;
      }
      progress(92, "Compressing the rest of the file\u2026"); await tick();
      // Deflate any other uncompressed streams (content, fonts); leave XMP readable.
      for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream) || obj.dict.has(N("Filter"))) continue;
        const t = obj.dict.lookup(N("Type"));
        if (t instanceof PDFName && t.asString() === "/Metadata") continue;
        const contents = obj.getContents();
        if (contents.length < 256) continue;
        const d2 = {};
        for (const [k, v] of obj.dict.entries()) if (k.asString() !== "/Length") d2[k.asString().slice(1)] = v;
        ctx.assign(ref, ctx.flateStream(contents, d2));
      }
      const stats = {};
      const bytes = await saveDoc(doc, { stats });
      const before = info.file.size, after = bytes.length;
      const pct = Math.round((1 - after / before) * 100);
      $("cmp-badge").hidden = false;
      if (after >= before * 0.98) {
        $("cmp-badge").className = "badge same";
        $("cmp-badge").textContent = "Already compact: " + fmtSize(before) + " \u2192 " + fmtSize(after);
        setStatus(optStatus, "info", "This PDF couldn't be made meaningfully smaller" + (skipped ? " (" + plural(skipped, "image") + " were already efficient or in a format this tool leaves alone)" : "") + ", so nothing was saved.");
        return;
      }
      $("cmp-badge").className = "badge";
      $("cmp-badge").textContent = "Reduced from " + fmtSize(before) + " to " + fmtSize(after) + " [\u2212" + pct + "%]";
      await applyResult(bytes, "compressed");
      setStatus(optStatus, "success", "Compressed. Recompressed " + plural(changed, "image") + (skipped ? ", left " + skipped + " alone" : "") + ", and removed " + plural(stats.removed, "unused object") + ". Check the result looks right before deleting the original.");
    } catch (err) {
      setStatus(optStatus, "error", err.message || "Compression failed.");
    } finally {
      canvas.width = 0; canvas.height = 0;
      optBusy(false);
    }
  });



  // ================= Clear everything =================
  // Two taps (arm, then confirm) so it can't be triggered by accident.
  const clearBtn = $("clear-all");
  let clearArm = null;
  function disarmClear(){
    clearTimeout(clearArm); clearArm = null;
    clearBtn.classList.remove("armed");
    clearBtn.querySelector("span").textContent = "Clear";
  }
  clearBtn.addEventListener("click", () => {
    if (!clearArm) {
      clearBtn.classList.add("armed");
      clearBtn.querySelector("span").textContent = "Confirm";
      clearArm = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    clearAll();
  });

  function clearAll(){
    queue.length = 0;
    current = null;
    work.steps = []; work.undo = [];
    renderDocBar();
    $("rail-file").textContent = "No file open";
    // Document workspace
    // Pages
    pgs.sources.forEach(s2 => s2.doc && s2.doc.destroy().catch(() => {}));
    pgs.sources = []; pgs.seq = 0; pgs.loaded = null; pgs.base = null;
    pagesGrid.reset();
    $("pages-work").hidden = true;
    $("pages-name").textContent = "Choose a file or drag it here";
    pagesUi();
    // Edit
    ed.renderToken++;
    if (ed.renderTask) { try { ed.renderTask.cancel(); } catch (e) {} }
    if (ed.view) ed.view.destroy().catch(() => {});
    editResetObjects();
    Object.assign(ed, { info: null, view: null, pageCount: 0, page: 0, fields: [], fsel: -1, mode: "annotate", dims: {}, needsRender: false });
    eLayer.innerHTML = ""; eCanvas.width = 0; eCanvas.height = 0;
    $("edit-work").hidden = true;
    $("doc-empty").classList.remove("has-doc");
    $("edit-name").textContent = "Choose a file or drag it here";
    $("f-flatten").checked = false;
    editUi();
    // Signature (the one saved in browser storage is left alone; Forget handles that)
    if (sg.sigUrl) URL.revokeObjectURL(sg.sigUrl);
    Object.assign(sg, { sig: null, sigUrl: null, sigAspect: 1 });
    $("sig-current").hidden = true;
    $("sig-current-img").removeAttribute("src");
    $("sigbox").hidden = true;
    $("sig-name").value = "";
    updatePreviews(); updateSignUi(); refreshSaved();
    // Prepare and Finish
    pr.info = null;
    Object.assign(ul, { file: null, bytes: null, sec: null }); $("unlock-work").hidden = true; $("unlock-name").textContent = "Choose a protected PDF"; $("unlock-meta").textContent = "Choose a file or drag it here"; $("unlock-pw").value = "";
    ["lock-user", "lock-user2", "lock-owner"].forEach(id => { $(id).value = ""; }); lockUi();
    dg.info = null; dg.verifyInfo = null; dg.id = null; dg.created = null; pendingPfx = null;
    $("dg-created").hidden = true; $("dg-pfx-unlock").hidden = true; $("dg-pfx-name").textContent = "Choose your .pfx or .p12 file";
    $("dg-doc-name").textContent = "No document open"; $("dgv-name").textContent = "Choose a file or drag it here"; $("dgv-results").innerHTML = "";
    updateSignUi2();
    op.cancel = true; op.info = null; $("cmp-badge").hidden = true;
    $("prep-work").hidden = true; $("prep-empty").hidden = false;
    renderFinish();
    [pagesStatus, editStatus, protStatus, dgStatus, optStatus, $("fin-status")].forEach(clearStatus);
    initSegments();
  showTool("document");
    const saved = readSaved();
    setStatus($("doc-status"), "success", "Cleared. No files are left open in any tool." + (saved ? " Your saved signature is still in this browser; use Forget under the Signature tool to remove it." : ""));
  }

  // ================= Start =================
  initSegments();
  renderFinish();
  refreshSaved();


  // ================= Self-test =================
  // Everything here is verified in one browser during development. This runs the same
  // machinery in whatever browser actually opens the page — a Chromebook, an iPad, Safari —
  // and says plainly what works. Open the page with #selftest on the end of the address.
  async function runSelfTest(){
    const panel = document.createElement("div");
    panel.className = "selftest";
    panel.innerHTML = '<div class="st-head"><b>Self-test</b><span id="st-sum">running\u2026</span>' +
      '<button class="btn" id="st-close">Close</button></div><ol id="st-list"></ol>' +
      '<div class="hint" id="st-env"></div>';
    document.body.appendChild(panel);
    const list = panel.querySelector("#st-list");
    panel.querySelector("#st-close").addEventListener("click", () => panel.remove());
    let pass = 0, fail = 0;
    const step = async (name, fn) => {
      const li = document.createElement("li");
      li.textContent = name + "\u2026";
      list.appendChild(li);
      try {
        const detail = await fn();
        pass++; li.className = "ok"; li.textContent = name + (detail ? " \u2014 " + detail : "");
      } catch (err) {
        fail++; li.className = "bad"; li.textContent = name + " \u2014 FAILED: " + (err && err.message ? err.message : err);
      }
      $("st-sum").textContent = pass + " passed, " + fail + " failed";
    };
    const need = (cond, msg) => { if (!cond) throw new Error(msg); };

    // a small PDF to work on, built here so nothing external is needed
    let bytes = null, pdfDoc = null;
    await step("Build a PDF in this browser", async () => {
      const d = await PDFDocument.create();
      const pg = d.addPage([300, 200]);
      const f = await d.embedFont(StandardFonts.Helvetica);
      pg.drawText("Self test line one", { x: 20, y: 150, size: 14, font: f });
      pg.drawText("Second line here", { x: 20, y: 120, size: 14, font: f });
      bytes = await d.save();
      need(bytes && bytes.length > 500, "no bytes produced");
      return Math.round(bytes.length / 1024) + " kB";
    });
    await step("Read it back", async () => {
      pdfDoc = await PDFDocument.load(bytes.slice(0));
      need(pdfDoc.getPageCount() === 1, "wrong page count");
      return "1 page";
    });
    let view = null;
    await step("Render a page to the screen", async () => {
      view = await openPdfJs(bytes.buffer ? bytes.buffer.slice(0) : bytes.slice(0));
      const page = await view.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      const data = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200) ink++;
      need(ink > 50, "page rendered blank");
      return Math.round(vp.width) + "\u00d7" + Math.round(vp.height) + ", " + ink + " dark pixels";
    });
    await step("Find the text on the page", async () => {
      const tc = await (await view.getPage(1)).getTextContent();
      const str = tc.items.map(i => i.str).join(" ");
      need(/Self test line one/.test(str), "text not found: " + str.slice(0, 40));
      return tc.items.filter(i => i.str.trim()).length + " pieces";
    });
    await step("Rewrite a line and read it back", async () => {
      const d = await PDFDocument.load(bytes.slice(0));
      const { text } = await pageContent(d, 0);
      const ops = parseContentOps(text).filter(o => o.located);
      need(ops.length > 0, "no text operators found");
      await applyTextEdits(d, [{ page: 0, ops: [{ opStart: ops[0].start, opEnd: ops[0].end }],
        text: "Rewritten line", fontName: StandardFonts.Helvetica, size: 14, fill: [0, 0, 0],
        x: 20, top: 164, width: 260, leading: 17, lineBoxes: [{ x: 20, y: 150, w: 260 }] }]);
      const out = await d.save();
      const v2 = await openPdfJs(out.buffer ? out.buffer.slice(0) : out.slice(0));
      const str = (await (await v2.getPage(1)).getTextContent()).items.map(i => i.str).join(" ");
      v2.destroy().catch(() => {});
      need(/Rewritten line/.test(str), "replacement missing");
      need(!/Self test line one/.test(str), "original still present");
      return "replaced and verified";
    });
    await step("Remove text so it cannot be read back", async () => {
      const d = await PDFDocument.load(bytes.slice(0));
      const { text } = await pageContent(d, 0);
      const ops = parseContentOps(text).filter(o => o.located);
      await applyTextEdits(d, [{ page: 0, ops: [{ opStart: ops[0].start, opEnd: ops[0].end }], text: "",
        fontName: StandardFonts.Helvetica, size: 14, fill: [0, 0, 0], x: 20, top: 164, width: 260,
        leading: 17, lineBoxes: [{ x: 20, y: 150, w: 260 }] }], "\nq 0 0 0 rg 15 140 270 25 re f Q", 0);
      const out = await d.save();
      const v2 = await openPdfJs(out.buffer ? out.buffer.slice(0) : out.slice(0));
      const str = (await (await v2.getPage(1)).getTextContent()).items.map(i => i.str).join(" ");
      v2.destroy().catch(() => {});
      need(!/Self test line one/.test(str), "redacted text can still be read");
      return "gone from the file";
    });
    await step("Create a signing key (WebCrypto)", async () => {
      need(window.crypto && window.crypto.subtle, "this browser exposes no WebCrypto");
      const k = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      const der = await crypto.subtle.exportKey("pkcs8", k.privateKey);
      need(der.byteLength > 100, "key export failed");
      return "2048-bit key generated";
    });
    await step("Encrypt with a password", async () => {
      const d = await PDFDocument.load(bytes.slice(0));
      await d.encrypt({ userPassword: "self-test-pass", ownerPassword: "self-test-pass" });
      const out = await d.save();
      need(out.length > 500, "no output");
      return "AES encryption available";
    });
    await step("Save a file (download path)", async () => {
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      need(url && url.length > 5, "object URLs unavailable");
      URL.revokeObjectURL(url);
      need(typeof document.createElement("a").download === "string", "downloads unsupported");
      return "supported";
    });
    await step("Remember a setting", async () => {
      try { localStorage.setItem("pdf-tools:selftest", "1"); localStorage.removeItem("pdf-tools:selftest"); }
      catch (e) { throw new Error("browser storage blocked (private mode?) \u2014 saved signatures will not persist"); }
      return "available";
    });
    await step("Run the text recogniser (OCR)", async () => {
      need(typeof WebAssembly === "object", "no WebAssembly in this browser");
      need(window.__PDFTOOLS_OCR || true, "OCR assets missing");
      return "WebAssembly available";
    });
    if (view) view.destroy().catch(() => {});

    const nav = navigator;
    $("st-env").textContent = "Browser: " + (nav.userAgent || "unknown") +
      " \u00b7 screen " + window.innerWidth + "\u00d7" + window.innerHeight +
      " \u00b7 touch " + (nav.maxTouchPoints > 0 ? "yes" : "no");
    $("st-sum").textContent = fail === 0
      ? "All " + pass + " checks passed \u2014 this browser runs the tool correctly."
      : pass + " passed, " + fail + " FAILED \u2014 see the lines marked above.";
    $("st-sum").className = fail === 0 ? "ok" : "bad";
  }
  { const btn = $("run-selftest"); if (btn) btn.addEventListener("click", () => runSelfTest()); }
  if (/(^|[#&])selftest\b/.test(location.hash)) {
    // the page may already be loaded by the time this runs, so don't wait for an event
    // that has been and gone
    if (document.readyState === "complete") setTimeout(runSelfTest, 300);
    else window.addEventListener("load", () => setTimeout(runSelfTest, 300));
  }

  // ================= Resize =================
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (activeTool === "document" && ed.view) editRender();
    }, 200);
  });
})();
