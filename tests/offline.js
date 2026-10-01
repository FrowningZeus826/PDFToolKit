const H=require('./harness'); const {FX,sleep,upload,tool}=H; const fs=require('fs');
(async()=>{
 const b=await H.launch(); const p=await b.newPage();
 const attempted=[];
 await p.setRequestInterception(true);
 p.on('request',r=>{ const u=r.url();
   if(/^(file|data|blob):/.test(u)) return r.continue();
   attempted.push(u); r.abort();                    // nothing outside the file may load
 });
 await p.setOfflineMode(true);                      // and the browser itself is offline
 const errors=[]; p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push(m.text().slice(0,120)); });
 await p.evaluateOnNewDocument(()=>{ window.__dl=[]; const oc=URL.createObjectURL.bind(URL); const blobs=new Map();
   URL.createObjectURL=b=>{const u=oc(b); blobs.set(u,b); return u;};
   const click=HTMLAnchorElement.prototype.click;
   HTMLAnchorElement.prototype.click=function(){ if(this.download){const r=new FileReader(); r.onload=()=>window.__dl.push({name:this.download,data:r.result}); r.readAsDataURL(blobs.get(this.href)); return;} return click.call(this); }; });
 await p.goto('file://'+H.LOCAL,{waitUntil:'load'}); await sleep(800);
 let failures=0;
 const step=async(label,fn)=>{ try{ await fn(); console.log('  OK   '+label); }catch(e){ failures++; console.log('  FAIL '+label+' -> '+e.message.slice(0,80)); } };

 await step('open a PDF and render it', async()=>{ await upload(p,'#edit-input',FX('a.pdf'));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); });
 await step('add text to the page', async()=>{ await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click());
   const bb=await (await p.$('#estage')).boundingBox(); await p.mouse.click(bb.x+bb.width*0.3,bb.y+bb.height*0.3); await sleep(500);
   await p.keyboard.type('Offline'); await sleep(300);
   await p.evaluate(()=>document.getElementById('edit-go').click()); await sleep(2500); });
 await step('create a digital ID (RSA keygen)', async()=>{ await tool(p,'finish'); await sleep(900);
   await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=sign]').click()); await sleep(200);
   await p.evaluate(()=>document.querySelector('#dg-modes .segbtn[data-mode=create]').click()); await sleep(300);
   await p.type('#dg-name','Offline Test'); await p.type('#dg-pw','Correct-Horse-91'); await p.type('#dg-pw2','Correct-Horse-91');
   await p.evaluate(()=>document.getElementById('dg-create-go').click());
   await p.waitForFunction(()=>!document.getElementById('dg-created').hidden,{timeout:60000}); });
 await step('sign the document', async()=>{ await p.evaluate(()=>document.querySelector('#dg-modes .segbtn[data-mode=sign]').click()); await sleep(400);
   await p.evaluate(()=>document.getElementById('dg-sign-go').click());
   await p.waitForFunction(()=>window.__dl.length>0,{timeout:60000}); });
 await step('OCR a scan (WebAssembly)', async()=>{ await tool(p,'document'); await sleep(400);
   await upload(p,'#edit-input',FX('scan.pdf')); await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(600);
   await tool(p,'prepare'); await sleep(1200);
   await p.evaluate(()=>document.querySelector('#prep-modes .segbtn[data-mode=ocr]').click()); await sleep(300);
   await p.evaluate(()=>document.getElementById('ocr-go').click());
   await p.waitForFunction(()=>(document.getElementById('docbar').dataset.steps||'0')!=='0',{timeout:180000}); });
 await step('edit existing text in the document\'s own font', async()=>{
   await tool(p,'document'); await sleep(400);
   await upload(p,'#edit-input',FX('quote.pdf'));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(900);
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=text]').click());
   await p.waitForFunction(()=>document.querySelectorAll('.trun.block').length>0,{timeout:30000}); await sleep(600);
   const spot=await p.evaluate(()=>{const e=document.querySelectorAll('.trun.block')[0]; const r=e.getBoundingClientRect(); return {x:r.left+4,y:r.top+4};});
   await p.mouse.click(spot.x,spot.y); await sleep(500);
   await p.$eval('#tx-text',e=>{e.value='Offline edit'; e.dispatchEvent(new Event('input'));}); await sleep(500);
   await p.evaluate(()=>document.getElementById('edit-go').click());
   await p.waitForFunction(()=>(document.getElementById('docbar').dataset.steps||'0')!=='0',{timeout:60000}); });

 await step('redact an area', async()=>{
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=redact]').click()); await sleep(2000);
   await p.evaluate(()=>document.getElementById('estage').scrollIntoView({block:'center'})); await sleep(400);
   const st=await (await p.$('#estage')).boundingBox();
   await p.mouse.move(st.x+st.width*0.2, st.y+st.height*0.3); await p.mouse.down();
   await p.mouse.move(st.x+st.width*0.6, st.y+st.height*0.36,{steps:8}); await p.mouse.up(); await sleep(600);
   await p.evaluate(()=>{window.__dl=[]; document.getElementById('edit-go').click();});
   await p.waitForFunction(()=>(document.getElementById('docbar').dataset.steps||'0')!=='0',{timeout:60000}); });

 await step('encrypt with a password (AES-256)', async()=>{ await tool(p,'finish'); await sleep(600);
   await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=password]').click()); await sleep(300);
   await p.type('#lock-user','Open-sesame-2026'); await p.type('#lock-user2','Open-sesame-2026'); await sleep(300);
   await p.evaluate(()=>{window.__dl=[]; document.getElementById('lock-go').click();});
   await p.waitForFunction(()=>window.__dl.length>0,{timeout:60000}); });
 const dl=await p.evaluate(()=>window.__dl.map(d=>d.name));
 console.log('\nfiles produced while offline:', dl.join(', '));
 console.log('network requests attempted:', attempted.length ? attempted : 'NONE');
 console.log('script errors:', errors.length ? errors.slice(0,3) : 'none');
 const ok = failures===0 && attempted.length===0 && errors.length===0;
 console.log(ok ? '\nPASS: fully offline — every feature worked with the network blocked' : '\nFAIL: see above');
 await b.close();
 process.exit(ok?0:1);
})();
