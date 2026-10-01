const H=require('./harness'); const KEY=H.STORAGE_KEY; const LOCAL=H.LOCAL, PUB=H.PUB;
const chromium=require('@sparticuz/chromium'); const puppeteer=require('puppeteer-core');
const {PDFDocument}=require('pdf-lib'); const fs=require('fs'); const path=require('path'); const {execSync}=require('child_process');
const FX=p=>path.resolve('fx',p);
const results=[]; const check=(name,ok,detail='')=>{results.push({name,ok:!!ok,detail});console.log((ok?'PASS':'FAIL')+'  '+name+(detail?'  — '+detail:''));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const HOOK=`
  window.__dl=[]; window.__csp=[]; window.__alerted=false;
  document.addEventListener('securitypolicyviolation', e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));
  const oc=URL.createObjectURL.bind(URL); const blobs=new Map();
  URL.createObjectURL=function(b){const u=oc(b); blobs.set(u,b); return u;};
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){ if(this.download){ const b=blobs.get(this.href); const n=this.download; const r=new FileReader(); r.onload=()=>window.__dl.push({name:n,data:r.result}); r.readAsDataURL(b); return; } return click.call(this); };
  window.alert=()=>{window.__alerted=true;};
`;
async function newPage(b, file, mobile){
  const p=await b.newPage();
  if(mobile) await p.emulate(puppeteer.KnownDevices['iPhone 13']); else await p.setViewport({width:1280,height:900});
  const ext=[], errors=[];
  p.on('request',r=>{const u=r.url(); if(!/^(file|data|blob):/.test(u)) ext.push(u);});
  p.on('console',m=>{ if(m.type()==='error') errors.push(m.text().slice(0,200)); });
  p.on('pageerror',e=>errors.push('pageerror: '+String(e.message).slice(0,200)));
  p.on('dialog',async d=>{errors.push('dialog: '+d.message()); await d.dismiss();});
  await p.evaluateOnNewDocument(HOOK);
  await p.goto('file://'+file,{waitUntil:'load'});
  await sleep(400);
  return {p,ext,errors};
}
async function takeDownloads(p,n,timeout=8000){
  await p.waitForFunction(n=>window.__dl.length>=n,{timeout},n);
  const d=await p.evaluate(()=>{const x=window.__dl; window.__dl=[]; return x;});
  return d.map(x=>({name:x.name, buf:Buffer.from(x.data.split(',')[1],'base64')}));
}
const txt=(p,sel)=>p.$eval(sel,e=>e.textContent);
const upload=async(p,sel,...files)=>{const h=await p.$(sel); await h.uploadFile(...files);};
const tool=(p,name)=>p.click(`.rail-btn[data-tool=${name}]`);

(async()=>{
 const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});


 // ---------- 1. Mobile: every upload area opens the picker exactly once ----------
 {
  const {p,errors}=await newPage(b,LOCAL,true);
  const tapTest=async(label,dzSel,inSel)=>{
    await p.evaluate(s=>{window.__c=0; document.querySelector(s).addEventListener('click',()=>window.__c++);},inSel);
    let opened=false; const w=p.waitForFileChooser({timeout:2500}).then(c=>{opened=true; return c.cancel();}).catch(()=>{});
    await p.tap(dzSel); await w; await sleep(150);
    const c=await p.evaluate(()=>window.__c);
    check(`mobile tap opens picker once: ${label}`, opened && c===1, `opened=${opened}, input clicks=${c}`);
  };
  // the file input must be the tap target itself (label-only activation is unreliable on iOS)
  { const cover=await p.evaluate(()=>[...document.querySelectorAll('.dropzone')].map(d=>{
      const i=d.querySelector('input[type=file]'); if(!i) return 'no input';
      const dr=d.getBoundingClientRect(), ir=i.getBoundingClientRect();
      if (!dr.width || !dr.height) return 'ok';   // zone not on screen right now
      const s=getComputedStyle(i);
      return (ir.width>=dr.width*0.8 && ir.height>=dr.height*0.8 && s.pointerEvents!=='none') ? 'ok' : (d.id||'zone')+' w='+Math.round(ir.width)+'/'+Math.round(dr.width)+' pe='+s.pointerEvents;
    }).filter(v=>v!=='ok'));
    check('mobile: every drop zone has a tappable file input covering it', cover.length===0, cover.slice(0,3).join(' | ')); }
  await tapTest('Document','#edit-dz','#edit-input');
  await p.evaluate(()=>document.querySelector('.rail-btn[data-tool=pages]').click()); await tapTest('Pages','#pages-dz','#pages-input');
  await p.evaluate(()=>document.querySelector('.rail-btn[data-tool=document]').click()); await upload(p,'#edit-input',FX('a.pdf'));
  await p.waitForFunction(()=>!document.getElementById('edit-work').hidden,{timeout:20000}); await sleep(600);
  await tapTest('Document "Open another"','#edit-open','#edit-input2');
  await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(200);
  await p.tap('#sigbox .segbtn[data-mode=upload]'); await tapTest('Signature image','#stamp-sig-dz','#stamp-sig-input');
  // touch drag by handle in Pages
 await p.evaluate(()=>document.querySelector('.rail-btn[data-tool=pages]').click());
 await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length===3,{timeout:30000}); await sleep(700);
 await p.$eval('#pages-grid',e=>e.scrollIntoView({block:'center'})); await sleep(300);
 { const cs=await p.$$('#pages-grid .pcard'); const h=await (await cs[2].$('.pdrag')).boundingBox(); const t=await cs[0].boundingBox();
   await p.touchscreen.touchStart(h.x+h.width/2, h.y+h.height/2);
   for(let i=1;i<=10;i++){ await p.touchscreen.touchMove(h.x+(t.x+8-h.x)*i/10, h.y+(t.y+t.height/2-h.y)*i/10); await sleep(30); }
   await sleep(120); await p.touchscreen.touchEnd(); await sleep(300); }
 check('mobile: touch drag by handle reorders', (await p.$$eval('#pages-grid .plabel',els=>els.map(e=>e.textContent.trim()))).join('|')==='3|1|2', (await p.$$eval('#pages-grid .plabel',els=>els.map(e=>e.textContent.trim()))).join('|'));
 await p.screenshot({path:'shot-m-pages.png'});
 check('mobile: no script errors', errors.length===0, errors.join(' | '));
  await p.close();
 }

 // ---------- 2. Desktop, strict-CSP local build ----------
 const {p,ext,errors}=await newPage(b,LOCAL,false);
 // keyboard access
 { await p.evaluate(()=>{window.__kc=0; document.getElementById('edit-input').addEventListener('click',()=>window.__kc++);}); await p.focus('#edit-dz'); await sleep(100); let opened=false; const w=p.waitForFileChooser({timeout:2000}).then(c=>{opened=true;return c.cancel();}).catch(e=>{}); await sleep(100); await p.keyboard.press('Enter'); await w; const kc=await p.evaluate(()=>window.__kc); check('keyboard: Enter on upload area opens picker', opened || kc===1, `chooser=${opened}, input clicks=${kc}`); }
 check('embedded fonts registered', await p.evaluate(async()=>{await document.fonts.ready; return ['Inter','Barlow Condensed','Sig Vibes','Sig Apple'].every(f=>document.fonts.check(`16px "${f}"`));}));

 // Document workspace: page view, navigation, zoom
 await upload(p,'#edit-input',FX('a.pdf'));
 await p.waitForFunction(()=>!document.getElementById('edit-work').hidden && document.getElementById('estage-canvas').width>0,{timeout:30000});
 await sleep(1200);
 const pageInfo=async()=>p.evaluate(()=>{const st=document.getElementById('estage'); const c=document.getElementById('estage-canvas');
   let ink=0; if(c.width){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; for(let i=0;i<d.length;i+=16) if(d[i]<200) ink++;}
   return {w:st.offsetWidth,h:st.offsetHeight,cw:c.width,ink,label:document.getElementById('e-label').textContent};});
 let vi=await pageInfo();
 check('document: page 1 renders with content', vi.cw>0 && vi.ink>50 && vi.label==='Page 1 of 3', JSON.stringify(vi));
 await p.click('#e-next'); await sleep(1200); vi=await pageInfo();
 check('document: rotated page 2 displays portrait', vi.h>vi.w && vi.label==='Page 2 of 3', `${vi.w}x${vi.h} ${vi.label}`);
 await p.click('#e-next'); await sleep(1200); vi=await pageInfo();
 check('document: offset-box page 3 uses its crop size', Math.abs(vi.w/vi.h - 512/742)<0.03, `${vi.w}x${vi.h}`);
 check('rail shows open file', (await txt(p,'#rail-file')).includes('a.pdf'));
 { const w0=(await pageInfo()).w; await p.click('#e-zin'); await sleep(1200); const z=await txt(p,'#e-zoom'); const w1=(await pageInfo()).w;
   await p.click('#e-zout'); await sleep(1200);
   check('document: zoom in and back to fit', z==='125%' && w1>w0 && (await txt(p,'#e-zoom'))==='Fit', `${w0} -> ${w1} at ${z}`); }
 await p.click('#e-prev'); await p.click('#e-prev'); await sleep(1000);
 check('document: navigate back to page 1', (await txt(p,'#e-label'))==='Page 1 of 3');

 // opening a different file starts from a clean slate
 { await tool(p,'document'); await sleep(400);
   await upload(p,'#edit-input',FX('b.pdf'));
   await p.waitForFunction(()=>document.getElementById('docbar-name').textContent.includes('b.pdf'),{timeout:30000}); await sleep(600);
   check('opening another file clears the change list', (await p.$eval('#docbar',e=>e.dataset.steps))==='0' && /No changes yet/.test(await txt(p,'#docbar-steps')), await txt(p,'#docbar-steps'));
   await upload(p,'#edit-input',FX('a.pdf'));
   await p.waitForFunction(()=>document.getElementById('docbar-name').textContent.includes('a.pdf'),{timeout:30000}); await sleep(800); }

 // Pages: one grid for reorder, rotate, delete, combine and extract
 await tool(p,'pages'); await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length===3,{timeout:30000}); await sleep(900);
 // page identity only: the label also carries a rotation marker
 const labels=async()=>(await p.$$eval('#pages-grid .plabel',els=>els.map(e=>e.textContent.split('\u00b7')[0].trim().replace(/\s+/g,' ')))).join('|');
 check('pages: opens with the working document', (await labels())==='1|2|3' && (await txt(p,'#pages-info'))==='3 pages', await labels());
 check('pages: nothing to apply until something changes', await p.$eval('#pages-go',e=>e.disabled));
 await p.evaluate(()=>document.querySelector('#pages-grid .pcard').click()); await sleep(200);
 await p.evaluate(()=>document.getElementById('pages-rot-right').click()); await sleep(900);
 check('pages: rotate marks the page and enables Apply', /1 rotated/.test(await txt(p,'#pages-info')) && !(await p.$eval('#pages-go',e=>e.disabled)), await txt(p,'#pages-info'));
 { const shape=await p.evaluate(()=>{const c=document.querySelector('#pages-grid .pcard canvas'); return c.width>c.height;});
   check('pages: thumbnail previews the rotation', shape===true, 'landscape thumb: '+shape); }
 await p.evaluate(()=>document.querySelector('#pages-grid .pcard').click()); await sleep(200);   // deselect
 await upload(p,'#pages-add-input',FX('b.pdf')); await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length===5,{timeout:30000}); await sleep(600);
 await upload(p,'#pages-add-input',FX('form-photo.jpg')); await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length===6,{timeout:30000}); await sleep(800);
 check('pages: other files and photos add their pages', (await labels())==='A 1|A 2|A 3|B 1|B 2|C 1', await labels());
 { await p.$eval('#pages-grid',e=>e.scrollIntoView({block:'center'})); await sleep(200);
   const cs=await p.$$('#pages-grid .pcard'); const src=await cs[3].boundingBox(), dst=await cs[0].boundingBox();
   await p.mouse.move(src.x+src.width/2, src.y+src.height/2); await p.mouse.down();
   await p.mouse.move(dst.x+10, dst.y+dst.height/2, {steps:12}); await sleep(150); await p.mouse.up(); await sleep(250); }
 check('pages: drag to reorder (mouse)', (await labels())==='B 1|A 1|A 2|A 3|B 2|C 1', await labels());
 check('pages: drag did not toggle selection', (await p.$$('#pages-grid .pcard.sel')).length===0);
 { const cs=await p.$$('#pages-grid .pcard'); await cs[3].focus(); await p.keyboard.down('Control'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Control'); await sleep(200); }
 check('pages: keyboard reorder', (await labels())==='B 1|A 1|A 2|B 2|A 3|C 1', await labels());
 { const cs=await p.$$('#pages-grid .pcard'); await cs[5].hover(); await (await cs[5].$('.pdel')).click(); await sleep(250); }
 check('pages: remove a page', (await labels())==='B 1|A 1|A 2|B 2|A 3', await labels());
 { await p.evaluate(()=>{document.querySelectorAll('#pages-grid .pcard')[0].click(); document.querySelectorAll('#pages-grid .pcard')[1].click();}); await sleep(200);
   await p.evaluate(()=>document.getElementById('pages-extract-each').click());
   const dd=await takeDownloads(p,1,60000);
   check('pages: extract selected as separate PDFs (.zip)', /\.zip$/.test(dd[0].name) && dd[0].buf.slice(0,2).toString()==='PK', dd[0].name);
   check('pages: extracting files leaves the document alone', (await labels())==='B 1|A 1|A 2|B 2|A 3'); }
 await H.applyStep(p,'#pages-go'); await sleep(1800);
 await H.downloadDoc(p); d=await takeDownloads(p,1);
 { const doc=await PDFDocument.load(d[0].buf); const w=doc.getPages().map(x=>Math.round(x.getMediaBox().width));
   const rot=doc.getPages().map(x=>x.getRotation().angle);
   check('pages: output matches the grid exactly', doc.getPageCount()===5 && w.join()===[595,612,792,595,512].join(), JSON.stringify(w));
   check('pages: rotation applied to the right page', rot[1]===90, JSON.stringify(rot)); }
 check('pages: grid reloads from the applied document', (await labels())==='1|2|3|4|5' && await p.$eval('#pages-go',e=>e.disabled), await labels());
 { await tool(p,'document'); await sleep(2200);
   check('document view reflects a change applied in another tab', (await txt(p,'#e-label'))==='Page 1 of 5', await txt(p,'#e-label')); }
 await tool(p,'pages'); await sleep(1500);
 { await p.evaluate(()=>{document.querySelectorAll('#pages-grid .pcard')[0].click(); document.querySelectorAll('#pages-grid .pcard')[1].click();}); await sleep(200);
   await p.evaluate(()=>document.getElementById('pages-extract').click()); await sleep(400);
   check('pages: Keep only drops the rest', (await p.$$('#pages-grid .pcard')).length===2);
   await H.applyStep(p,'#pages-go'); await sleep(1800);
   check('pages: applied document is just those pages', (await txt(p,'#pages-info'))==='2 pages', await txt(p,'#pages-info'));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2800);
   check('pages: undo restores the pages', (await txt(p,'#pages-info'))==='5 pages', await txt(p,'#pages-info')); }
 await p.screenshot({path:'shot-d-pages.png'});

 // large uploads take a while to reach the page, so wait for the message rather than a fixed delay
 const hostile=async(file,expect,label)=>{ const before=await txt(p,'#pages-status');
   await upload(p,'#pages-input',FX(file));
   await p.waitForFunction(b=>{const e=document.getElementById('pages-status'); return e && e.textContent && e.textContent!==b;},{timeout:60000},before).catch(()=>{});
   const s=await txt(p,'#pages-status'); check(`reject ${label}`, s.includes(expect), s.slice(0,110)); };
 await hostile('encrypted.pdf','password-protected','password-protected PDF');
 await hostile('owner-only.pdf','password-protected','owner-password (permissions) PDF');
 await hostile('garbage.pdf','couldn\'t be opened','damaged PDF');
 await hostile('notpdf.pdf','doesn\'t look like a PDF','non-PDF renamed .pdf');
 await hostile('huge.pdf','limit','oversized (260 MB) file');
 await upload(p,'#pages-input',FX('junkprefix.pdf'));
 await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length===2,{timeout:30000}).catch(()=>{});
 check('accept PDF with junk before header', (await p.$$('#pages-grid .pcard')).length===2);
 await upload(p,'#pages-input',FX('<img src=x onerror=alert(1)>.pdf')); await sleep(1200);
 check('XSS filename rendered as text only', await p.evaluate(()=>!window.__alerted && !document.querySelector('img[src="x"]') && [document.getElementById('pages-name'), document.getElementById('docbar-name')].some(e=>e && e.textContent.includes('<img'))));

 // Signature: built and placed inside the Document workspace
 await tool(p,'document'); await sleep(600);
 check('signature: works on whatever document is open', (await txt(p,'#edit-name'))===(await txt(p,'#docbar-name')), await txt(p,'#edit-name'));
 await upload(p,'#edit-input2',FX('a.pdf')); await p.waitForFunction(()=>document.getElementById('edit-name').textContent.includes('a.pdf'),{timeout:20000}); await sleep(1200);
 await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(200);
 await p.type('#sig-name','Alex Tester'); await p.click('#sigbox .stylebtn:nth-child(2)'); await p.click('#sigbox .ink[data-ink="#1B3A8C"]');
 await p.click('#sig-make'); await p.waitForSelector('#sig-current:not([hidden])');
 const sigDims=await p.$eval('#sig-current-img',i=>[i.naturalWidth,i.naturalHeight]);
 check('signature: typed cursive signature generated', sigDims[0]>200 && sigDims[0]>sigDims[1], JSON.stringify(sigDims));
 check('signature: arms for placement once created', await p.evaluate(()=>document.getElementById('sig-tool').classList.contains('active')));
 // place it on the rotated page 2
 await p.click('#e-next'); await sleep(1300);
 await p.$eval('#estage',e=>e.scrollIntoView({block:'center'})); await sleep(300);
 const box=await (await p.$('#estage')).boundingBox();
 const tx=0.30, ty=0.40; await p.mouse.click(box.x+box.width*tx, box.y+box.height*ty); await sleep(400);
 check('signature: tap places it on the page', (await p.$$('.eobj.t-image')).length===1);
 { const o=await (await p.$('.eobj.t-image')).boundingBox();
   await p.mouse.move(o.x+o.width/2,o.y+o.height/2); await p.mouse.down();
   await p.mouse.move(o.x+o.width/2+box.width*0.1, o.y+o.height/2, {steps:6}); await p.mouse.up(); await sleep(300); }
 const placed=await p.evaluate(()=>{const s=document.querySelector('.eobj.t-image'); const r=s.getBoundingClientRect(), R=document.getElementById('estage').getBoundingClientRect(); return {cx:(r.left+r.width/2-R.left)/R.width, cy:(r.top+r.height/2-R.top)/R.height};});
 check('signature: drag moves it', Math.abs(placed.cx-(tx+0.1))<0.03, JSON.stringify(placed));
 await H.applyAndDownload(p,'#edit-go'); d=await takeDownloads(p,1);
 fs.writeFileSync('signed.pdf',d[0].buf); execSync('rm -f sg-*.png; pdftoppm -r 40 -f 2 -l 2 -png signed.pdf sg');
 { const {PNG}=require('pngjs'); const img=PNG.sync.read(fs.readFileSync(fs.readdirSync('.').find(f=>f.startsWith('sg-')))); let xs=[],ys=[];
   for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const i=(y*img.width+x)*4; const r=img.data[i],g=img.data[i+1],bb=img.data[i+2]; if(bb>100&&r<80&&g<110) {xs.push(x);ys.push(y);}}
   const cx=(Math.min(...xs)+Math.max(...xs))/2/img.width, cy=(Math.min(...ys)+Math.max(...ys))/2/img.height;
   check('signature: output lands where placed on a rotated page', xs.length>=40 && Math.abs(cx-placed.cx)<0.04 && Math.abs(cy-placed.cy)<0.04, `ink=${xs.length} expected ${placed.cx.toFixed(3)},${placed.cy.toFixed(3)} got ${cx.toFixed(3)},${cy.toFixed(3)}`); }
 await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(200);
 await p.click('#sig-download'); d=await takeDownloads(p,1);
 check('signature: Download PNG', d[0].name==='signature.png' && d[0].buf.slice(1,4).toString()==='PNG'); fs.writeFileSync(FX('sig.png'),d[0].buf);
 await p.click('#sig-remember'); await sleep(200);
 check('signature: saved on this device', await p.evaluate(k=>!!localStorage.getItem(k), KEY) && !(await p.$eval('#sig-saved',e=>e.hidden)));
 await p.reload({waitUntil:'load'}); await sleep(600);
 check('signature: saved one can be cleared from the empty screen', !(await p.$eval('#empty-saved-sig',e=>e.hidden)));
 await upload(p,'#edit-input',FX('a.pdf')); await p.waitForFunction(()=>!document.getElementById('edit-work').hidden,{timeout:20000}); await sleep(1000);
 await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(300);
 check('signature: saved one offered after reload', !(await p.$eval('#sig-saved',e=>e.hidden)));
 await p.click('#sig-use-saved'); await p.waitForSelector('#sig-current:not([hidden])',{timeout:5000});
 check('signature: saved one can be reused', await p.evaluate(()=>!!document.getElementById('sig-current-img').src));
 await p.click('#sig-forget'); await sleep(200);
 check('signature: Forget removes it', await p.evaluate(k=>!localStorage.getItem(k), KEY) && await p.$eval('#sig-saved',e=>e.hidden));
 await p.click('#sigbox .segbtn[data-mode=upload]'); await upload(p,'#stamp-sig-input',FX('sig.png')); await sleep(600);
 check('signature: upload an image instead', !(await p.$eval('#sig-current',e=>e.hidden)));
 // tampered storage
 await p.evaluate(k=>localStorage.setItem(k, JSON.stringify({png:'javascript:alert(1)'})), KEY);
 await p.reload({waitUntil:'load'}); await sleep(400);
 check('sign: tampered saved data ignored', await p.$eval('#sig-saved',e=>e.hidden) && await p.evaluate(()=>!window.__alerted));
 await p.evaluate(()=>localStorage.clear());

 // Clear all (two taps)
 await upload(p,'#edit-input',FX('a.pdf')).catch(()=>{});
 await tool(p,'document'); await upload(p,'#edit-input',FX('a.pdf')); await sleep(600);
 await tool(p,'pages'); await sleep(600);
 await p.waitForFunction(()=>document.querySelectorAll('#pages-grid .pcard').length>0,{timeout:30000}); await sleep(300);
 await p.click('#clear-all'); await sleep(100);
 check('clear: first tap only arms', (await txt(p,'#clear-all span'))==='Confirm' && (await p.$$('#pages-grid .pcard')).length>0);
 await p.click('#clear-all'); await sleep(400);
 const cleared=await p.evaluate(()=>({rail:document.getElementById('rail-file').textContent, workspace:document.getElementById('edit-work').hidden, docbar:document.getElementById('docbar').hidden, pages:document.querySelectorAll('#pages-grid .pcard').length, sigbox:document.getElementById('sigbox').hidden, active:document.querySelector('.rail-btn.active').dataset.tool}));
 check('clear: every tool emptied', cleared.rail==='No file open' && cleared.workspace && cleared.docbar && cleared.pages===0 && cleared.sigbox && cleared.active==='document', JSON.stringify(cleared));
 await tool(p,'pages'); await sleep(400);
 check('clear: tools stay empty afterwards', (await p.$$('#pages-grid .pcard')).length===0 && await p.$eval('#pages-work',e=>e.hidden));

 check('strict CSP: zero violations', (await p.evaluate(()=>window.__csp)).length===0, (await p.evaluate(()=>window.__csp)).join(' | '));
 check('zero network requests (local build)', ext.length===0, ext.slice(0,3).join(' '));
 check('desktop: no script errors', errors.length===0, errors.join(' | '));
 await p.screenshot({path:'shot-desktop.png'});
 await p.close();

 // ---------- 3. Published build smoke ----------
 { const {p,ext,errors}=await newPage(b,PUB,false);
   await upload(p,'#edit-input',FX('a.pdf'));
   await p.waitForFunction(()=>!document.getElementById('edit-work').hidden && document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(600);
   check('published build: opens and renders', (await p.$eval('#e-label',e=>e.textContent))==='Page 1 of 3');
   check('published build: zero external requests', ext.length===0, ext.join(' '));
   check('published build: no script errors', errors.length===0, errors.join(' | '));
   await p.close(); }

 // ---------- 4. Mobile screenshots ----------
 { const {p}=await newPage(b,LOCAL,true);
   await p.screenshot({path:'shot-m-home.png'});
   await p.evaluate(()=>document.querySelector('.rail-btn[data-tool=document]').click()); await upload(p,'#edit-input',FX('a.pdf')); await sleep(1200);
   await p.type('#sig-name','Alex'); await sleep(300); await p.screenshot({path:'shot-m-sign.png',fullPage:true});
   await p.close(); }

 await b.close();
 const f=results.filter(r=>!r.ok); console.log(`\n${results.length-f.length}/${results.length} passed`);
})().catch(e=>{console.log('SUITE ERROR',e.stack);process.exit(1)});
