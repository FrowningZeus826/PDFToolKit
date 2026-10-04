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
 for (const f of ['index.html','manifest.webmanifest','sw.js','icon.svg','icon-maskable.svg'])
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
