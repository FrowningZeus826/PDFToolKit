// The hosted build is installable as an app, which is what lets the operating system offer
// it for a .pdf. That needs a manifest, a file handler, a service worker and a page that
// still works once the network is gone — all of which are checked here against the file as
// a browser would actually receive it, over HTTP.
const H=require('./harness'); const {check,sleep,summary,FX}=H;
const fs=require('fs'); const path=require('path'); const {execSync,spawn}=require('child_process');

const OUT=process.env.OUT_DIR||'..';
const PORT=8750+Math.floor(Math.random()*120);
const DIR='/tmp/pwa-serve-'+PORT;

(async()=>{
 fs.mkdirSync(DIR,{recursive:true});
 for (const f of ['index.html','manifest.webmanifest','sw.js','icon.svg','icon-maskable.svg','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-32.png'])
   fs.copyFileSync(path.join(OUT,f), path.join(DIR,f));
 const server=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore',detached:true});
 await sleep(1500);
 const base='http://localhost:'+PORT+'/index.html';
 const b=await H.launch();
 try {
   // --- the manifest itself ---
   const m=JSON.parse(fs.readFileSync(path.join(DIR,'manifest.webmanifest'),'utf8'));
   check('manifest: names the app and runs standalone', m.name==='PDF Tool Kit' && m.display==='standalone', m.name+'/'+m.display);
   check('manifest: declares a file handler for PDFs',
     !!m.file_handlers && JSON.stringify(m.file_handlers[0].accept)==='{"application/pdf":[".pdf"]}', JSON.stringify(m.file_handlers&&m.file_handlers[0]));
   check('manifest: offers a maskable icon as well as a plain one',
     m.icons.some(i=>i.purpose==='maskable') && m.icons.some(i=>i.purpose==='any'));
   { // every icon the manifest names exists, and a PNG is the size it says
     const png=f=>{ const b=fs.readFileSync(path.join(DIR,f)); return b.slice(0,8).toString('hex')==='89504e470d0a1a0a' ? {w:b.readUInt32BE(16),h:b.readUInt32BE(20)} : null; };
     const bad=[]; for (const i of m.icons) { if (!fs.existsSync(path.join(DIR,i.src))) { bad.push(i.src+' missing'); continue; }
       if (/png$/.test(i.src)) { const d=png(i.src); const want=+i.sizes.split('x')[0]; if (!d || d.w!==want || d.h!==want) bad.push(i.src+' is '+(d?d.w+'x'+d.h:'not a PNG')+', manifest says '+i.sizes); } }
     check('manifest: every icon exists and is the size it claims', bad.length===0, bad.join('; '));
     check('manifest: has PNG icons at 192 and 512 (what installers use) plus a maskable one',
       [192,512].every(n=>m.icons.some(i=>i.type==='image/png' && i.sizes===n+'x'+n && i.purpose==='any')) && m.icons.some(i=>i.type==='image/png' && i.purpose==='maskable'));
     const a=png('apple-touch-icon.png'); check('page: an iPhone home-screen icon (180x180 PNG) exists', a && a.w===180 && a.h===180);
     const html=fs.readFileSync(path.join(DIR,'index.html'),'utf8');
     check('page: links its tab icon and the iPhone icon', /rel="icon" href="icon.svg"/.test(html) && /rel="apple-touch-icon" href="apple-touch-icon.png"/.test(html));
     check('page: the service worker precaches the icons', ['icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'].every(f=>fs.readFileSync(path.join(DIR,'sw.js'),'utf8').includes('./'+f))); }
   check('manifest: reuses an open window rather than stacking them', m.launch_handler && m.launch_handler.client_mode==='focus-existing');

   const p=await b.newPage();
   const errors=[]; p.on('pageerror',e=>errors.push(e.message));
   const offOrigin=[];
   p.on('request',r=>{ const u=r.url();
     if(!/^(data|blob):/.test(u) && !u.includes('localhost:'+PORT)) offOrigin.push(u); });
   await p.goto(base,{waitUntil:'load'}); await sleep(2500);

   check('page: the manifest loads despite the strict security policy',
     await p.evaluate(async()=>{ const l=document.querySelector('link[rel=manifest]');
       if(!l) return false; const r=await fetch(l.href); return r.ok; }));
   await p.evaluate(()=>navigator.serviceWorker.ready);
   check('page: the service worker registers and takes over',
     (await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); return r&&r.active?'active':'no';}))==='active');
   check('page: nothing is requested from any other origin', offOrigin.length===0, offOrigin.slice(0,2).join(','));

   // --- a PDF handed over by the operating system ---
   const b64=fs.readFileSync(FX('quote.pdf')).toString('base64');
   const launch=async name=>p.evaluate(async(data,n)=>{
     const bin=atob(data); const arr=new Uint8Array(bin.length);
     for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
     return await window.__openLaunchedFile(new File([arr],n,{type:'application/pdf'}));
   }, b64, name);
   check('launch: a PDF opened by the operating system loads', await launch('launched.pdf'));
   await sleep(2000);
   check('launch: it is the document now being worked on',
     (await H.txt(p,'#docbar-name'))==='launched.pdf' && await p.$eval('#estage-canvas',e=>e.width>0));

   // --- and it must survive the network going away ---
   await p.setOfflineMode(true);
   await p.reload({waitUntil:'load'}); await sleep(3000);
   check('offline: the installed app still loads with no network', await p.evaluate(()=>!!document.getElementById('edit-input')));
   check('offline: and still opens and renders a PDF', await launch('offline.pdf') && await p.$eval('#estage-canvas',e=>e.width>0));
   check('offline: no script errors', errors.length===0, errors.slice(0,2).join(' | '));
 } finally {
   await b.close();
   try { process.kill(-server.pid); } catch(e) {}
   fs.rmSync(DIR,{recursive:true,force:true});
 }
 summary('pwa');
})();
