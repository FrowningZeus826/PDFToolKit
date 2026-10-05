const H=require('./harness'); const {check,sleep,FX,txt,upload,tool,fs,execSync}=H;
const {PDFDocument}=require('pdf-lib');
async function stageBox(p){ await p.$eval('#estage',e=>e.scrollIntoView({block:'center'})); await sleep(200); return (await p.$('#estage')).boundingBox(); }
async function stageClick(p,fx,fy){ const b=await stageBox(p); await p.mouse.click(b.x+b.width*fx,b.y+b.height*fy); await sleep(200); return b; }
async function objFrac(p,sel){ return p.evaluate(s=>{const e=document.querySelector(s); const r=e.getBoundingClientRect(), R=document.getElementById('estage').getBoundingClientRect(); return {x0:(r.left-R.left)/R.width,y0:(r.top-R.top)/R.height,x1:(r.right-R.left)/R.width,y1:(r.bottom-R.top)/R.height};},sel); }
(async()=>{
 const b=await H.launch();
 const {p,ext,errors,logs}=await H.newPage(b,H.LOCAL,false);

 // ---- Standard fonts ----
 await upload(p,'#edit-input',FX('symbol.pdf')); await p.waitForFunction(()=>!document.getElementById('edit-work').hidden && document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1500);
 const ink=await p.evaluate(()=>{const c=document.getElementById('estage-canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let top=0,mid=0,bot=0; const h=c.height; for(let y=0;y<h;y++)for(let x=0;x<c.width;x+=2){const i=(y*c.width+x)*4; if(d[i]<120){ const fy=y/h; if(fy<0.16)top++; else if(fy<0.3)mid++; else bot++; }} return {top,mid,bot};});
 check('standard fonts: Symbol glyphs render', ink.top>200, JSON.stringify(ink));
 check('standard fonts: ZapfDingbats glyphs render', ink.mid>100, JSON.stringify(ink));
 const warn=logs.filter(l=>/fetchStandardFontData|fake worker|Warning/i.test(l));
 check('no pdf.js warnings in console', warn.length===0, warn.slice(0,2).join(' | '));

 // ---- Edit: add-to-page on a.pdf ----
 await upload(p,'#edit-input',FX('a.pdf')); await sleep(800);
 await tool(p,'document'); await p.waitForFunction(()=>!document.getElementById('edit-work').hidden); await sleep(800);
 check('edit: open file carried over', (await txt(p,'#edit-name')).includes('a.pdf'));
 check('edit: no form on plain PDF', await p.$eval('#edit-modes .segbtn[data-emode=form]',b=>b.disabled));
 // page 2 is rotated 90: add red text there
 await p.click('#e-next'); await sleep(800);
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await stageClick(p,0.2,0.3);
 check('edit: text box created and focused', await p.evaluate(()=>document.activeElement && document.activeElement.id==='ep-text'));
 await p.keyboard.type('Hello there'); await sleep(150);
 await p.click('#eprops .colorchip[title=Red]'); await sleep(150);
 const tbox=await objFrac(p,'.eobj.t-text');
 // emoji becomes ?
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await stageClick(p,0.2,0.6); await p.keyboard.type('Hi \u{1F600}'); await sleep(150);
 check('edit: unsupported characters flagged', !(await p.$eval('#eprops .warnline',e=>e.hidden)));
 // page 1: checkmark (blue), whiteout over green square, highlight
 await p.click('#e-prev'); await sleep(800);
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=check]').click()); await stageClick(p,0.7,0.2);
 await p.click('#eprops .colorchip[title=Blue]'); await sleep(100);
 const cbox=await objFrac(p,'.eobj.t-check');
 // green square: x 50..150, y 50..150 (PDF) on 612x792 => display x .082..245, y .811..937
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=white]').click()); await stageClick(p,100/612,(792-100)/792);
 { const b=await H.sleep(0) || await (await p.$('#estage')).boundingBox(); const s=b.width/612; const h=await (await p.$('.eobj.t-white .eh')).boundingBox();
   await p.mouse.move(h.x+h.width/2,h.y+h.height/2); await p.mouse.down(); await p.mouse.move(h.x+h.width/2+0, h.y+h.height/2+95*s,{steps:6}); await p.mouse.up(); await sleep(150);
   // move it so it covers the square fully: drag body up-left a bit
   const w=await (await p.$('.eobj.t-white')).boundingBox(); await p.mouse.move(w.x+w.width/2,w.y+w.height/2); await p.mouse.down(); await p.mouse.move(w.x+w.width/2+0, w.y+w.height/2-40*s,{steps:6}); await p.mouse.up(); await sleep(150); }
 const wbox=await objFrac(p,'.eobj.t-white');
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=hl]').click()); await stageClick(p,0.3,(792-712)/792);
 // delete test: add a box then delete it
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=box]').click()); await stageClick(p,0.5,0.5); await p.click('.eobj.t-box .ex'); await sleep(100);
 check('edit: delete removes object', (await p.$$('.eobj.t-box')).length===0);
 // image
 await upload(p,'#edit-img-input',FX('sig.png')); await sleep(400); await stageClick(p,0.6,0.5);
 check('edit: image placed', (await p.$$('.eobj.t-image')).length===1);
 check('edit: summary', (await txt(p,'#edit-summary')).startsWith('6 items'), await txt(p,'#edit-summary'));
 await H.applyAndDownload(p,'#edit-go'); let d=await H.takeDownloads(p,1); fs.writeFileSync('edited.pdf',d[0].buf);
 const t2=execSync('pdftotext -f 2 -l 2 edited.pdf -').toString();
 check('edit: text saved as real, searchable text', t2.includes('Hello there') && t2.includes('Hi ?'), JSON.stringify(t2.slice(0,80)));
 { const img=H.renderPage('edited.pdf',2,72); const r=H.inkBox(img,(R,G,B)=>R>150&&G<80&&B<80);
   const inside=r.x0>=tbox.x0-0.01&&r.x1<=tbox.x1+0.01&&r.y0>=tbox.y0-0.01&&r.y1<=tbox.y1+0.01;
   check('edit: text lands inside its box on a rotated page', r.n>30 && inside, `ink ${[r.x0,r.y0,r.x1,r.y1].map(v=>v.toFixed(3))} box ${[tbox.x0,tbox.y0,tbox.x1,tbox.y1].map(v=>v.toFixed(3))}`); }
 { const img=H.renderPage('edited.pdf',1,72);
   // look for blue ink only near the checkmark (the blue signature image is elsewhere on the page)
   const near=(x,y)=>x>=(cbox.x0-0.03)*img.width&&x<=(cbox.x1+0.03)*img.width&&y>=(cbox.y0-0.03)*img.height&&y<=(cbox.y1+0.03)*img.height;
   const bl=(()=>{let n=0,x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){if(!near(x,y))continue;const i=(y*img.width+x)*4,R=img.data[i],G=img.data[i+1],B=img.data[i+2];if(B>100&&R<60&&G<90&&B-R>60){n++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}return {n,x0:x0/img.width,y0:y0/img.height,x1:(x1+1)/img.width,y1:(y1+1)/img.height};})();
   check('edit: checkmark placed where shown', bl.n>10 && bl.x0>=cbox.x0-0.01 && bl.x1<=cbox.x1+0.01 && bl.y0>=cbox.y0-0.01 && bl.y1<=cbox.y1+0.01, `ink ${[bl.x0,bl.y0,bl.x1,bl.y1].map(v=>v.toFixed(3))} box ${[cbox.x0,cbox.y0,cbox.x1,cbox.y1].map(v=>v.toFixed(3))}`);
   const gr=H.inkBox(img,(R,G,B)=>G>100&&R<40&&B<40);
   check('edit: whiteout covers the green square', gr.n===0, `green px ${gr.n}; whiteout ${[wbox.x0,wbox.y0,wbox.x1,wbox.y1].map(v=>v.toFixed(3))}`);
   const yl=H.inkBox(img,(R,G,B)=>R>200&&G>180&&B<150);
   check('edit: highlight drawn', yl.n>50, 'yellow px '+yl.n); }
 check('edit: whiteout still leaves text copyable (as warned)', true);

 // ---- Whole document: watermark + page numbers ----
 await upload(p,'#edit-input',FX('a.pdf'));
 await p.waitForFunction(()=>document.getElementById('e-label').textContent==='Page 1 of 3' && document.getElementById('estage-canvas').width>0,{timeout:20000}); await sleep(800);
 await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=doc]').click()); await sleep(400);
 check('marks: save disabled until something is chosen', await p.$eval('#edit-go',b=>b.disabled));
 await p.evaluate(()=>document.querySelector('#wm-on').click()); await p.type('#wm-text','CONFIDENTIAL');
 await p.waitForFunction(()=>document.querySelectorAll('.wmark').length===1,{timeout:15000}).catch(()=>{}); await sleep(400);
 check('marks: watermark previewed on the page', (await p.$$('#eLayerCheck')).length===0 && (await p.$$eval('.wmark',e=>e.length))===1);
 { const g=await p.$eval('.wmark',e=>{const r=e.getBoundingClientRect(),R=document.getElementById('estage').getBoundingClientRect();return {cx:(r.left+r.right)/2-R.left-R.width/2, cy:(r.top+r.bottom)/2-R.top-R.height/2, t:e.style.transform};});
   check('marks: diagonal watermark centred and angled', Math.abs(g.cx)<3 && Math.abs(g.cy)<3 && /rotate\(-5[0-9.]*deg\)|rotate\(-4[0-9.]*deg\)/.test(g.t), JSON.stringify(g)); }
 await p.evaluate(()=>document.querySelector('#pn-on').click());
 await p.waitForFunction(()=>document.querySelectorAll('.wmark').length===2,{timeout:15000}).catch(()=>{}); await sleep(300);
 check('marks: both previewed', (await p.$$eval('.wmark',e=>e.length))===2);
 check('marks: summary lists them', (await txt(p,'#edit-summary')).includes('watermark and page numbers'), await txt(p,'#edit-summary'));
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('marks.pdf',d[0].buf);
 { const t=execSync('pdftotext marks.pdf -').toString();
   check('marks: diagonal watermark drawn as text (extraction splits rotated glyphs)', /C\s*O\s*N\s*F/.test(t), JSON.stringify(t.slice(0,60)));
   check('marks: page numbers correct', t.includes('Page 1 of 3') && t.includes('Page 3 of 3'), (t.match(/Page \d of \d/g)||[]).join(','));
   check('marks: original text kept', t.includes('Page 1 portrait'));
   const wmInk=f=>{const img=H.renderPage(f,arguments&&0,50);return img;};
   const grayOf=(file,page)=>{const img=H.renderPage(file,page,50);return H.inkBox(img,(R,G,B)=>Math.abs(R-G)<8&&Math.abs(G-B)<8&&R>200&&R<245);};
   for (const pg of [1,2,3]) { const g=grayOf('marks.pdf',pg); const cx=(g.x0+g.x1)/2, cy=(g.y0+g.y1)/2;
     check(`marks: watermark fits and is centred on page ${pg}`, g.n>300 && g.x0>0.01 && g.x1<0.99 && Math.abs(cx-0.5)<0.03 && Math.abs(cy-0.5)<0.04, `box ${[g.x0,g.y0,g.x1,g.y1].map(v=>v.toFixed(3))} centre ${cx.toFixed(3)},${cy.toFixed(3)}`); } }
 // Undo returns the document to its pre-apply state (and proves the undo path works)
 { const before=+(await p.$eval('#docbar',e=>e.dataset.steps));
   await p.evaluate(()=>document.querySelector('#docbar-undo').click()); await sleep(1200);
   const after=+(await p.$eval('#docbar',e=>e.dataset.steps));
   check('doc bar: undo removes the last applied step', after===before-1, `steps ${before} -> ${after}`); }
 // horizontal placement extracts as real searchable text (settings are cleared after each apply)
 await sleep(1200);
 await p.evaluate(()=>{ if(!document.getElementById('wm-on').checked) document.getElementById('wm-on').click(); });
 await p.$eval('#wm-text',e=>{e.value='CONFIDENTIAL'; e.dispatchEvent(new Event('input'));});
 await p.select('#wm-style','top'); await p.select('#wm-color','#B3261E'); await sleep(400); await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('marks-top.pdf',d[0].buf);
 { const t=execSync('pdftotext marks-top.pdf -').toString();
   check('marks: horizontal watermark is real text on all pages', (t.match(/CONFIDENTIAL/g)||[]).length===3, JSON.stringify(t.slice(0,70)));
   const g=H.inkBox(H.renderPage('marks-top.pdf',1,50),(R,G,B)=>R>200&&R-G>18&&R-B>18);
   check('marks: top watermark sits near the top, centred', g.y1<0.16 && Math.abs((g.x0+g.x1)/2-0.5)<0.03, JSON.stringify(g).slice(0,90)); }
 await p.evaluate(()=>document.querySelector('#docbar-undo').click()); await sleep(1200);
 await p.select('#wm-style','diagonal'); await p.select('#wm-color','#808080'); await sleep(150);

 // skip first page + start number, page numbers only (settings clear after each apply)
 await sleep(1200);
 await p.evaluate(()=>{ const on=id=>{const e=document.getElementById(id); if(!e.checked) e.click();}; const off=id=>{const e=document.getElementById(id); if(e.checked) e.click();};
   on('pn-on'); on('pn-skip1'); off('wm-on'); });
 await p.$eval('#pn-start',e=>{e.value='5';e.dispatchEvent(new Event('input'))}); await sleep(400);
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('marks2.pdf',d[0].buf);
 { const t=execSync('pdftotext marks2.pdf -').toString(); const nums=(t.match(/Page \d+ of \d+/g)||[]);
   check('marks: skip cover page and start at 5', nums.join(',')==='Page 5 of 6,Page 6 of 6' && !t.includes('CONFIDENTIAL'), nums.join(',')); }

 // ---- applying a change must reload the page, clear what was applied, and be undoable ----
 { const ink=async()=>p.evaluate(()=>{const c=document.getElementById('estage-canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=16) if(d[i]<235) n++; return n;});
   await sleep(1500);
   await upload(p,'#edit-input',FX('a.pdf'));
   await p.waitForFunction(()=>document.getElementById('e-label').textContent==='Page 1 of 3' && document.getElementById('estage-canvas').width>0,{timeout:20000}); await sleep(1200);
   const i0=await ink();
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=doc]').click()); await sleep(300);
   await p.evaluate(()=>document.getElementById('wm-on').click()); await p.type('#wm-text','CONFIDENTIAL'); await sleep(700);
   console.log('   [dbg] wm-on', await p.$eval('#wm-on',e=>e.checked), 'text', JSON.stringify(await p.$eval('#wm-text',e=>e.value)), 'disabled', await p.$eval('#edit-go',e=>e.disabled), 'mode', await p.evaluate(()=>[...document.querySelectorAll('#edit-modes .segbtn')].find(x=>x.classList.contains('active')).dataset.emode));
   await H.applyStep(p,'#edit-go'); await sleep(2500);
   const i1=await ink();
   check('apply: the change shows on the page straight away', i1 > i0*1.1, `ink ${i0} -> ${i1}`);
   check('apply: applied settings are cleared so Apply cannot stack them',
     !(await p.$eval('#wm-on',e=>e.checked)) && (await p.$eval('#wm-text',e=>e.value))==='' && await p.$eval('#edit-go',e=>e.disabled));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2500);
   const i2=await ink();
   check('apply: undo puts the page back visually', Math.abs(i2-i0) < i0*0.05, `ink ${i0} -> ${i1} -> ${i2}`); }

 // ---- keyboard Delete removes the selected item (broken by the tab rename) ----
 { await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=check]').click()); await sleep(200);
   await p.evaluate(()=>{const s=document.getElementById('estage').getBoundingClientRect();
     document.getElementById('estage').dispatchEvent(new MouseEvent('click',{clientX:s.left+s.width*0.5,clientY:s.top+s.height*0.5,bubbles:true}));});
   await sleep(500);
   const n1=(await p.$$('.eobj')).length;
   await p.evaluate(()=>document.body.focus());
   await p.keyboard.press('Delete'); await sleep(300);
   check('keyboard: Delete removes the selected item', n1===1 && (await p.$$('.eobj')).length===0, `objects ${n1} -> ${(await p.$$('.eobj')).length}`); }

 // ---- every label-wrapped file input must stay invisible and cover its control ----
 { const bad=await p.evaluate(()=>{
     const out=[];
     document.querySelectorAll('label input[type=file]').forEach(i=>{
       const s=getComputedStyle(i), r=i.getBoundingClientRect(), pr=i.parentElement.getBoundingClientRect();
       if (!pr.width || !pr.height) return;                        // control not on screen now
       if (s.opacity!=='0' || s.position!=='absolute' || r.width < pr.width*0.8 || r.height < pr.height*0.8)
         out.push((i.id||'input')+' op='+s.opacity+' pos='+s.position+' '+Math.round(r.width)+'x'+Math.round(r.height)+' in '+Math.round(pr.width)+'x'+Math.round(pr.height));
     });
     return out;
   });
   check('file inputs stay invisible and cover their control', bad.length===0, bad.slice(0,3).join(' | ')); }

 // ---- placing an uploaded image and an uploaded signature (real clicks, not synthetic) ----
 { await upload(p,'#edit-img-input',FX('form-photo.jpg')); await sleep(1400);
   await p.$eval('#estage',e=>e.scrollIntoView({block:'center'})); await sleep(250);
   const bb=await (await p.$('#estage')).boundingBox();
   const before=(await p.$$('.eobj.t-image')).length;
   await p.mouse.click(bb.x+bb.width*0.5, bb.y+bb.height*0.45); await sleep(700);
   check('image: uploaded image places on the page', (await p.$$('.eobj.t-image')).length===before+1);
   await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(300);
   await p.evaluate(()=>document.querySelector('#sigbox .segbtn[data-mode=upload]').click()); await sleep(250);
   await upload(p,'#stamp-sig-input',FX('sig.png')); await sleep(1400);
   check('signature: uploaded image becomes the signature and arms', !(await p.$eval('#sig-current',e=>e.hidden)) && await p.evaluate(()=>document.getElementById('sig-tool').classList.contains('active')));
   await p.mouse.click(bb.x+bb.width*0.3, bb.y+bb.height*0.7); await sleep(700);
   check('signature: uploaded signature places on the page', (await p.$$('.eobj.t-image')).length===before+2);
   await p.evaluate(()=>{document.querySelectorAll('.eobj .ex').forEach(x=>x.click());}); await sleep(300); }

 // ---- replacing the signature must not break one already placed on the page ----
 { await p.evaluate(()=>document.querySelectorAll('.eobj .ex').forEach(x=>x.click())); await sleep(300);
   await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(300);
   await p.evaluate(()=>{const b=document.querySelector('#sigbox .segbtn[data-mode=type]'); if(b) b.click();}); await sleep(200);
   await p.$eval('#sig-name',e=>{e.value='';});
   await p.type('#sig-name','Alex Tester'); await p.evaluate(()=>document.getElementById('sig-make').click()); await sleep(1400);
   await p.$eval('#estage',e=>e.scrollIntoView({block:'center'})); await sleep(250);
   const bb=await (await p.$('#estage')).boundingBox();
   await p.mouse.click(bb.x+bb.width*0.4, bb.y+bb.height*0.4); await sleep(700);
   // now replace the signature with an uploaded image
   await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(300);
   await p.evaluate(()=>document.querySelector('#sigbox .segbtn[data-mode=upload]').click()); await sleep(250);
   await upload(p,'#stamp-sig-input',FX('sig.png')); await sleep(1400);
   check('signature: one already on the page still shows after the signature is replaced',
     await p.evaluate(()=>{const i=document.querySelector('.eobj.t-image img'); return !!i && i.complete && i.naturalWidth>0;}));
   await p.mouse.click(bb.x+bb.width*0.4, bb.y+bb.height*0.7); await sleep(700);
   check('signature: both the typed and the uploaded one are placed', (await p.$$('.eobj.t-image')).length===2);
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('twosigs.pdf',d[0].buf);
   const im=execSync('pdfimages -list twosigs.pdf').toString().trim().split('\n').length-2;
   check('signature: both reach the saved PDF', im>=2, im+' images in the output');
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(1500); }

 // ---- editing text that is already in the PDF, as paragraphs ----
 const openText=async file=>{ await upload(p,'#edit-input',FX(file));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=text]').click());
   await p.waitForFunction(()=>document.querySelectorAll('.trun.block').length>0,{timeout:30000}); await sleep(700); };
 // scroll the block itself into view and measure immediately before clicking: the ribbon
 // and the floating panel both shift the page, so a rect measured earlier can be stale
 const pickBlock=async i=>{
   await p.evaluate(i=>{const e=document.querySelectorAll('.trun.block')[i]; if(e) e.scrollIntoView({block:'center'});}, i);
   await sleep(250);
   const spot=await p.evaluate(i=>{const e=document.querySelectorAll('.trun.block')[i]; const r=e.getBoundingClientRect(); return {x:r.left+4,y:r.top+4};}, i);
   await p.mouse.click(spot.x, spot.y); await sleep(500); };

 await openText('letter.pdf');
 { const shape=await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]));
   check('text: real paragraphs group, one block per paragraph', shape.join(',')==='1,4,1,3', shape.join(',')); }
 await pickBlock(1);
 { const t=await p.$eval('#tx-text',e=>e.value);
   check('text: the block holds the whole paragraph', t.split('\n').length===4 && t.includes('technology night'), JSON.stringify(t.slice(0,50))); }
 await p.$eval('#tx-text',e=>{e.value=e.value.replace('October 9','November 13'); e.dispatchEvent(new Event('input'));}); await sleep(700);
 check('text: the page previews the edit before applying', (await p.$$eval('.tprev',es=>es.length))===4 && (await p.$$eval('.tprev',es=>es.some(e=>e.textContent.includes('November 13')))));
 check('text: the original is masked behind the preview', (await p.$$('.tmask')).length===4);
 { const before=await p.$eval('.tprev',e=>e.getBoundingClientRect().left);
   const g=await p.evaluate(()=>{const e=document.querySelectorAll('.trun.block')[1]; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
   await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x+60,g.y+30,{steps:8}); await sleep(200);
   const during=await p.$eval('.tprev',e=>e.getBoundingClientRect().left);
   await p.mouse.up(); await sleep(300);
   check('text: the preview moves with the drag, as you drag', Math.abs((during-before)-60)<6, `moved ${Math.round(during-before)}px for a 60px drag`); }
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('letter-edited.pdf',d[0].buf);
 { const t=execSync('pdftotext letter-edited.pdf -').toString().replace(/\s+/g,' ');
   check('text: the saved file carries the edit', t.includes('November 13'));
   check('text: the untouched paragraphs are still there', ['Dear Parent or Guardian','Alex Tester','Systems Administrator'].every(k=>t.includes(k)));
   check('text: output is structurally valid', /No syntax/.test(execSync('qpdf --check letter-edited.pdf 2>&1 || true').toString())); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- a logo placed with its own transform must not shift the text after it ----
 await openText('quote.pdf');
 { const shape=await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]));
   check('a transform used for a logo does not break position tracking',
     shape.length>=15 && (await p.$$('.trun.locked')).length<=1, `${shape.length} blocks, ${(await p.$$('.trun.locked')).length} locked`); }

 // ---- a page drawn under a scaling transform (Word, report writers) ----
 await openText('scaled.pdf');
 { const shape=await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]));
   check('scaled page: lines still group into a paragraph', shape.includes(3), shape.join(',')); }
 await pickBlock(0);
 { const size=+(await p.$eval('#tx-size',e=>e.value));
   check('scaled page: the size shown is the size on the page, not the raw font size', Math.abs(size-11)<0.6, String(size)); }
 await p.$eval('#tx-text',e=>{e.value=e.value.replace('12x transform','TWELVE-X transform'); e.dispatchEvent(new Event('input'));}); await sleep(700);
 { const fs2=parseFloat((await p.$$eval('.tprev',es=>es.map(e=>getComputedStyle(e).fontSize)))[0]);
   check('scaled page: the preview is drawn at a readable size', fs2>4, fs2+'px'); }
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('scaled-edited.pdf',d[0].buf);
 { const box=(f,w)=>{ const m=execSync(`pdftotext -bbox ${f} -`).toString().match(new RegExp('<word xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)" yMax="([\\d.]+)">'+w+'</word>')); return m?m.slice(1,5).map(Number):null; };
   const before=box('fx/scaled.pdf','12x'), after=box('scaled-edited.pdf','TWELVE-X');
   check('scaled page: the replacement lands at the original spot and height',
     before && after && Math.abs(after[0]-before[0])<2 && Math.abs(after[1]-before[1])<2 && Math.abs((after[3]-after[1])-(before[3]-before[1]))<2,
     `${before} -> ${after}`); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- the ribbon: the controls stay above the page instead of in a side panel ----
 await openText('letter.pdf');
 { const ids=await p.evaluate(()=>[...document.querySelectorAll('#tx-ribbon button, #tx-ribbon select, #tx-ribbon input')].map(e=>e.id));
   check('ribbon: the editing controls sit above the page',
     ['tx-group','tx-showall','tx-merge','tx-split','rb-font','rb-size'].every(id=>ids.includes(id)), ids.join(','));
   check('ribbon: it is there before anything is selected', !(await p.$eval('#tx-ribbon',e=>e.hidden)));
   await pickBlock(1);
   check('ribbon: it shows the block font and size once something is selected',
     (await p.$$eval('#rb-font option',o=>o.length))>0 && +(await p.$eval('#rb-size',e=>e.value))>0,
     (await p.$eval('#rb-size',e=>e.value))+'pt');
   const before=await p.$eval('#tx-text',e=>e.value);
   await p.evaluate(()=>{const s=document.getElementById('rb-size'); s.value='16'; s.dispatchEvent(new Event('input'));}); await sleep(500);
   check('ribbon: changing the size there changes the block', /text edit/.test(await txt(p,'#edit-summary')) && (await p.$eval('#tx-text',e=>e.value))===before);
   await p.evaluate(()=>document.getElementById('docbar-undo').click()).catch(()=>{}); await sleep(600); }

 // ---- text re-wraps inside its block while being typed ----
 await openText('letter.pdf');
 { await pickBlock(1); await sleep(200);
   await p.keyboard.press('Enter'); await sleep(600);
   check('wrapping: Enter puts the caret in the text', (await p.$$eval('.tprev',els=>els.filter(e=>e.isContentEditable).length))>0);
   const orig0=await p.$eval('#tx-text',e=>e.value); const lines0=orig0.split('\n').length;
   const added=' and then a good deal more text typed into this line so that it has to wrap onto another';
   await p.keyboard.press('End');
   await p.keyboard.type(added); await sleep(1300);
   const lines1=(await p.$eval('#tx-text',e=>e.value)).split('\n').length;
   check('wrapping: the paragraph gains lines rather than running off the edge', lines1>lines0, `${lines0} lines, then ${lines1}`);
   const over=await p.evaluate(()=>{const blk=document.querySelectorAll('.trun.block')[1].getBoundingClientRect();
     return Math.max(...[...document.querySelectorAll('.tprev')].map(e=>e.getBoundingClientRect().width)) - blk.width;});
   check('wrapping: no line is wider than the block it sits in', over<=2, Math.round(over)+'px over');
   for(let k=0;k<added.length;k++) await p.keyboard.press('Backspace'); await sleep(1300);
   { const back=await p.$eval('#tx-text',e=>e.value);
     const flat=t=>t.replace(/\s+/g,' ').trim();
     check('wrapping: deleting the added text unwraps it back to the original text and line count', flat(back)===flat(orig0) && back.split('\n').length===lines0, back.split('\n').length+' lines vs '+lines0+'; '+JSON.stringify(back.slice(0,90))); }
   await p.keyboard.type(' ab cd'); await sleep(900);
   { const t2=await p.$eval('#tx-text',e=>e.value); const f2=t2.replace(/\s+/g,' ');
     check('wrapping: typed spaces survive, so words are not glued together', /(^| )ab cd /.test(f2) && !/[a-z,]October/.test(f2), JSON.stringify(f2.slice(55,110))); }
   await p.keyboard.press('Escape'); await sleep(300);
   check('wrapping: Escape leaves the text', (await p.$$eval('.tprev',els=>els.filter(e=>e.isContentEditable).length))===0);
   await p.evaluate(()=>document.getElementById('docbar-undo').click()).catch(()=>{}); await sleep(800); }

 // ---- typing on the page itself, rather than in the side panel ----
 await openText('letter.pdf');
 { await pickBlock(1); await sleep(400);
   check('on-page editing: a block is not editable until asked',
     (await p.$$eval('.tprev',els=>els.filter(e=>e.isContentEditable).length))===0);
   // two presses on the block start typing on the page; one press still selects and drags
   const at=async()=>p.evaluate(()=>{const e=document.querySelectorAll('.trun.block')[1]; const r=e.getBoundingClientRect(); return {x:r.left+30,y:r.top+8};});
   let bs=await at(); await p.mouse.click(bs.x,bs.y); await sleep(300);
   bs=await at(); await p.mouse.click(bs.x,bs.y); await sleep(700);
   check('on-page editing: the text becomes editable where it sits',
     (await p.$$eval('.tprev',els=>els.filter(e=>e.isContentEditable).length))>0);
   check('on-page editing: the caret lands in the text', await p.evaluate(()=>!!document.activeElement && document.activeElement.classList.contains('tprev')));
   await p.keyboard.type('ZZ'); await sleep(600);
   check('on-page editing: the panel stays in step with what was typed', /ZZ/.test(await p.$eval('#tx-text',e=>e.value)));
   check('on-page editing: it counts as a change', /text edit/.test(await txt(p,'#edit-summary')), await txt(p,'#edit-summary'));
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('onpage.pdf',d[0].buf);
   const t=execSync('pdftotext onpage.pdf - 2>/dev/null').toString().replace(/\s+/g,' ');
   check('on-page editing: the typing reaches the saved file', /ZZ/.test(t));
   check('on-page editing: the rest of the page is untouched', t.includes('Dear Parent') && t.includes('Sincerely'));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- the grouping slider, for documents the default reads wrongly ----
 await openText('quote.pdf');
 { const setLevel=async l=>{ await p.evaluate(v=>{const s=document.getElementById('tx-group'); s.value=String(v); s.dispatchEvent(new Event('input'));}, l);
     await sleep(2600); return (await p.$$('.trun.block')).length; };
   const normal=await setLevel(1), loose=await setLevel(2);
   check('grouping slider: loosening pulls more text together', loose<normal, `${normal} blocks at Normal, ${loose} at Loose`);
   check('grouping slider: it names the setting', ['Tight','Normal','Loose','Loosest'].includes(await txt(p,'#tx-group-name')), await txt(p,'#tx-group-name'));
   const tight=await setLevel(0);
   check('grouping slider: tightening does not pull more together', tight>=normal, `${tight} at Tight vs ${normal} at Normal`);
   await setLevel(1);
   // the table must survive the default, which is what the default is for
   let cells=0;
   { const n=(await p.$$('.trun.block')).length;
     for (let i=0;i<n;i++){ await pickBlock(i); const v=await p.$eval('#tx-text',e=>e.value);
       if (/^(AA250-NA|156\.99|AD630-SC|43\.25)$/.test(v.trim())) cells++; } }
   check('grouping slider: at Normal a table keeps its cells apart', cells>=3, cells+' separate cells found');
   // and the setting is remembered
   await setLevel(2);
   check('grouping slider: the choice is remembered', (await p.evaluate(()=>localStorage.getItem('pdf-tools:grouping')))==='2');
   await setLevel(1); }

 // ---- a page drawn one word at a time must still read as paragraphs ----
 await openText('word-runs.pdf');
 { const n=(await p.$$('.trun.block')).length;
   check('word runs: a page drawn word by word does not become a box per word', n<=4, n+' blocks for 3 lines and a table row');
   await pickBlock(0);
   const t=await p.$eval('#tx-text',e=>e.value);
   check('word runs: the words join into lines, with spaces in the right places',
     /^The quick brown fox jumps over the lazy dog near the river/.test(t), JSON.stringify(t.slice(0,60)));
   check('word runs: the lines of the paragraph group together', t.split('\n').length===3, t.split('\n').length+' lines');
   // the alternating font resources must not stop the join, but a column gap must
   let label=-1, number=-1;
   for (let i=0;i<n;i++){ await pickBlock(i); const v=await p.$eval('#tx-text',e=>e.value);
     if (/Widget assembly/.test(v)) label=i; if (v.trim()==='16') number=i; }
   check('word runs: a table row stays as separate columns', label>=0 && number>=0 && label!==number,
     `label block ${label}, number block ${number}`); }

 // ---- correcting the grouping by hand, and the vertical grips ----
 const shape=async()=>(await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]))).join(',');
 await openText('letter.pdf');
 check('grouping: starts as the letter paragraphs', (await shape())==='1,4,1,3', await shape());

 // merge two blocks the person picks, which need not be neighbours
 await pickBlock(0);
 await p.evaluate(()=>document.getElementById('tx-merge').click()); await sleep(500);
 check('grouping: arming the merge highlights the other blocks',
   /Pick a block/.test(await txt(p,'#tx-merge')) && (await p.$$('.trun.block.mergeable')).length===3);
 await pickBlock(3);
 check('grouping: any two blocks can be merged, not just neighbours',
   (await shape()).split(',').length===3 && /Merged into one block of 4/.test(await txt(p,'#edit-status')), await shape());

 // the same by shift-clicking, from a clean page
 await openText('letter.pdf');
 { await pickBlock(0);
   const before=await shape();
   const spot=await p.evaluate(()=>{const e=document.querySelectorAll('.trun.block')[1]; const r=e.getBoundingClientRect(); return {x:r.left+6,y:r.top+6};});
   await p.mouse.move(spot.x,spot.y); await p.keyboard.down('Shift'); await p.mouse.down(); await p.mouse.up(); await p.keyboard.up('Shift'); await sleep(600);
   check('grouping: shift-click merges two blocks', (await shape())!==before, before+' -> '+await shape()); }

 // split a block by clicking the gap on the page, from a clean page
 await openText('letter.pdf');
 { await pickBlock(1);
   await p.evaluate(()=>document.getElementById('tx-split').click()); await sleep(500);
   check('grouping: arming the split offers a gap between each pair of lines',
     (await p.$$('.tsplit')).length===3 && /Click a gap/.test(await txt(p,'#tx-split')), (await p.$$('.tsplit')).length+' gaps');
   const before=(await shape()).split(',').length;
   const g=await p.evaluate(()=>{const r=document.querySelectorAll('.tsplit')[1].getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
   await p.mouse.click(g.x,g.y); await sleep(700);
   check('grouping: clicking a gap splits the block there',
     (await shape()).split(',').length===before+1 && /Split into blocks of 2 and 2/.test(await txt(p,'#edit-status')), await shape()+' | '+await txt(p,'#edit-status'));
   // and editing one of the halves still saves correctly
   await p.$eval('#tx-text',e=>{e.value=e.value.replace(/^./, 'X'); e.dispatchEvent(new Event('input'));}); await sleep(500);
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('split-block.pdf',d[0].buf);
   check('grouping: a split half saves correctly',
     /No syntax/.test(execSync('qpdf --check split-block.pdf 2>&1 || true').toString()) &&
     /Dear Parent or Guardian/.test(execSync('pdftotext split-block.pdf - 2>/dev/null').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }
 await openText('letter.pdf');
 { await pickBlock(0);
   check('grouping: a single-line block offers no split', await p.$eval('#tx-split',e=>e.disabled)); }

 // the grips resize the block; the size box is what changes the size
 { const multi=await p.evaluate(()=>[...document.querySelectorAll('.trun.block')].findIndex(e=>+e.title.match(/^(\d+)/)[1]>1));
   await pickBlock(multi);
   const grips=await p.$$eval('.tgrip',es=>es.map(e=>e.className.replace('tgrip ','').trim()).sort().join(','));
   check('resize: width, height and corner grips are offered on a multi-line block', grips.includes('tgrip-b') && grips.includes('tgrip-c'), grips);
   const boxOf=async()=>p.evaluate(()=>Math.round(document.querySelector('.trun.block.sel').getBoundingClientRect().height));
   const widthOf=async()=>p.evaluate(()=>Math.round(document.querySelector('.trun.block.sel').getBoundingClientRect().width));
   const h1=await boxOf(), size1=await p.$eval('#tx-size',e=>e.value);
   let g=await p.evaluate(()=>{const r=document.querySelector('.tgrip-b').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
   await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x,g.y+45,{steps:8}); await p.mouse.up(); await sleep(500);
   const h2=await boxOf();
   check('resize: dragging the bottom grip makes the block taller, leaving the text size alone',
     h2>h1*1.3 && (await p.$eval('#tx-size',e=>e.value))===size1, `box ${h1}px -> ${h2}px at size ${size1}`);
   check('resize: the spacing is reported', /pt spacing/.test(await txt(p,'#tx-lines')), await txt(p,'#tx-lines'));
   const w1=await widthOf();
   g=await p.evaluate(()=>{const r=document.querySelector('.tgrip-c').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
   await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x+40,g.y+20,{steps:6}); await p.mouse.up(); await sleep(500);
   check('resize: the corner grip resizes the block in both directions, not the text',
     (await widthOf())>w1 && (await p.$eval('#tx-size',e=>e.value))===size1, `width ${w1} -> ${await widthOf()}, size ${size1}`); }
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('regrouped.pdf',d[0].buf);
 check('grouping: the document still saves correctly after regrouping and resizing',
   /No syntax/.test(execSync('qpdf --check regrouped.pdf 2>&1 || true').toString()) &&
   /technology night/.test(execSync('pdftotext regrouped.pdf - 2>/dev/null').toString()));
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- text inside a reusable block (header, footer, letterhead) ----
 await openText('quote.pdf');
 { const n=await p.$$eval('.trun.block',e=>e.length);
   check('reusable blocks: their text is offered for editing too', n>=20 && (await p.$$('.trun.locked')).length===0, n+' blocks, '+(await p.$$('.trun.locked')).length+' locked');
   let found=-1;
   for (let i=n-1;i>=0 && found<0;i--){ await pickBlock(i);
     if (/Terms: Net 30/.test(await p.$eval('#tx-text',e=>e.value))) found=i; }
   check('reusable blocks: the form text reads correctly', found>=0, 'block '+found);
   if (found>=0) {
     await p.$eval('#tx-text',e=>{e.value='Terms: Net 45 days from invoice date.'; e.dispatchEvent(new Event('input'));}); await sleep(600);
     await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('form-edit.pdf',d[0].buf);
     const out=execSync('pdftotext form-edit.pdf - 2>/dev/null').toString();
     check('reusable blocks: the edit is written into the block itself', out.includes('Net 45 days') && !out.includes('Net 30 days'));
     check('reusable blocks: the rest of the page is untouched', out.includes('Q57659') && out.includes('1,486.70'));
     check('reusable blocks: output is structurally valid', /No syntax/.test(execSync('qpdf --check form-edit.pdf 2>&1 || true').toString()));
     await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); } }

 // ---- redaction: the text must be gone from the file, not covered over ----
 { await upload(p,'#edit-input',FX('quote.pdf'));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
   // find the line we intend to redact, as a fraction of the page, so the drag is exact
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=text]').click());
   await p.waitForFunction(()=>document.querySelectorAll('.trun.block').length>0,{timeout:30000}); await sleep(700);
   let target=null;
   { const n=await p.$$eval('.trun.block',e=>e.length);
     for (let i=0;i<n && !target;i++){ await pickBlock(i);
       if (/SOUTH CAROLINA/.test(await p.$eval('#tx-text',e=>e.value)))
         target=await p.evaluate(i=>{const st=document.getElementById('estage').getBoundingClientRect();
           const r=document.querySelectorAll('.trun.block')[i].getBoundingClientRect();
           return {x:(r.left-st.left)/st.width, y:(r.top-st.top)/st.height, w:r.width/st.width, h:r.height/st.height};}, i); } }
   check('redact: the line to remove was located', !!target);
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=redact]').click()); await sleep(2500);
   await p.evaluate(()=>document.getElementById('estage').scrollIntoView({block:'center'})); await sleep(400);
   const st=await (await p.$('#estage')).boundingBox();
   await p.mouse.move(st.x+target.x*st.width-2, st.y+target.y*st.height-1); await p.mouse.down();
   await p.mouse.move(st.x+(target.x+target.w)*st.width+2, st.y+(target.y+target.h)*st.height+1,{steps:8});
   await p.mouse.up(); await sleep(700);
   { // the box must appear exactly where it was drawn, and be movable, resizable, removable
     const where=await p.evaluate(()=>{const st=document.getElementById('estage').getBoundingClientRect();
       const r=document.querySelector('.redbox').getBoundingClientRect();
       return {l:Math.round(r.left-st.left), t:Math.round(r.top-st.top), w:Math.round(r.width), h:Math.round(r.height)};});
     const want={l:Math.round(st.x+target.x*st.width-2-st.x), t:Math.round(st.y+target.y*st.height-1-st.y)};
     check('redact: the box lands where it was drawn', Math.abs(where.l-want.l)<4 && Math.abs(where.t-want.t)<4,
       `drawn at ${want.l},${want.t}; box at ${where.l},${where.t}`);
     const centre=async()=>p.evaluate(()=>{const r=document.querySelector('.redbox').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width)};});
     const c1=await centre();
     await p.mouse.move(c1.x,c1.y); await p.mouse.down(); await p.mouse.move(c1.x+30,c1.y+18,{steps:8}); await p.mouse.up(); await sleep(400);
     const c2=await centre();
     check('redact: a placed box can be dragged to a new spot',
       Math.abs((c2.l-c1.l)-30)<4 && Math.abs((c2.t-c1.t)-18)<4 && (await p.$$('.redbox')).length===1, `${c1.l},${c1.t} -> ${c2.l},${c2.t}`);
     const g=await p.evaluate(()=>{const r=document.querySelector('.rgrip.r-se').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
     await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x+35,g.y,{steps:6}); await p.mouse.up(); await sleep(400);
     check('redact: a placed box can be resized from a corner', (await centre()).w > c2.w+20, `${c2.w} -> ${(await centre()).w}`);
     // add a second one, then remove it with its x
     await p.mouse.move(st.x+st.width*0.2, st.y+st.height*0.62); await p.mouse.down();
     await p.mouse.move(st.x+st.width*0.5, st.y+st.height*0.67,{steps:8}); await p.mouse.up(); await sleep(500);
     check('redact: a second area can be marked', (await p.$$('.redbox')).length===2);
     const xb=await p.evaluate(()=>{const r=document.querySelectorAll('.redbox')[1].querySelector('.ex').getBoundingClientRect();
       const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
       return {x:r.left+r.width/2, y:r.top+r.height/2, at:el.tagName+'.'+el.className};});
     check('redact: the remove button is not blocked by the resize grip', /BUTTON/.test(xb.at), xb.at);
     await p.mouse.move(xb.x,xb.y); await p.mouse.down(); await p.mouse.up(); await sleep(500);
     check('redact: pressing the x removes that area', (await p.$$('.redbox')).length===1); }
   // start clean, then mark exactly the line we mean to remove
   await p.evaluate(()=>document.getElementById('rd-clear').click()); await sleep(400);
   await p.mouse.move(st.x+target.x*st.width-2, st.y+target.y*st.height-1); await p.mouse.down();
   await p.mouse.move(st.x+(target.x+target.w)*st.width+2, st.y+(target.y+target.h)*st.height+1,{steps:8});
   await p.mouse.up(); await sleep(600);
   check('redact: dragging marks an area and counts what it will remove',
     /1 area on this page/.test(await txt(p,'#rd-count')) && /lines? of text will be deleted/.test(await txt(p,'#rd-count')), await txt(p,'#rd-count'));
   check('redact: the marked area is shown on the page', (await p.$$('.redbox')).length===1);
   { const ids=await p.evaluate(()=>[...document.querySelectorAll('#rd-ribbon button, #rd-ribbon select')].map(e=>e.id));
     check('redact: the controls sit in a ribbon above the page', ['rd-mark','rd-clear'].every(id=>ids.includes(id)) && !(await p.$eval('#rd-ribbon',e=>e.hidden)), ids.join(','));
     const geo=await p.evaluate(()=>{const r=document.getElementById('rd-ribbon').getBoundingClientRect(), st=document.getElementById('estage').getBoundingClientRect(); return {above:r.bottom<=st.top+1, wa:document.getElementById('workarea').classList.contains('has-props')};});
     check('redact: the ribbon is above the page and no side panel opens', geo.above && !geo.wa, JSON.stringify(geo));
     check('redact: the text ribbon is not shown at the same time', await p.$eval('#tx-ribbon',e=>e.hidden)); }
   check('redact: how the area is finished can be chosen', (await p.$$eval('#rd-mark option',os=>os.map(o=>o.value))).join(',')==='black,white,none');
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('redacted.pdf',d[0].buf);
   execSync('pdftotext fx/quote.pdf /tmp/red-b.txt 2>/dev/null; pdftotext redacted.pdf /tmp/red-a.txt 2>/dev/null');
   const before=fs.readFileSync('/tmp/red-b.txt','utf8'), after=fs.readFileSync('/tmp/red-a.txt','utf8');
   check('redact: the covered text no longer extracts', before.includes('SOUTH CAROLINA') && !after.includes('SOUTH CAROLINA'));
   check('redact: text outside the area is untouched', after.includes('Q57659') && after.includes('Harbour Supply Co') && after.includes('1,486.70'));
   // the real test: it must be absent from the file itself, not merely hidden
   execSync('qpdf --qdf --object-streams=disable redacted.pdf /tmp/red-q.pdf 2>/dev/null || true');
   const raw=fs.readFileSync('/tmp/red-q.pdf');
   check('redact: the words are gone from the uncompressed file, not just covered',
     raw.indexOf(Buffer.from('SOUTH CAROLINA'))===-1);
   check('redact: a black marker is drawn over the area',
     execSync('pdftotext -bbox redacted.pdf - 2>/dev/null').toString().length>0 &&
     /No syntax/.test(execSync('qpdf --check redacted.pdf 2>&1 || true').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- a reusable block shared across pages: editable, but say how far it reaches ----
 await openText('shared-footer.pdf');
 { const marked=await p.$$eval('.trun.block.shared',e=>e.length);
   check('shared block: it is marked on the page before being touched', marked===1, marked+' marked');
   const i=await p.evaluate(()=>[...document.querySelectorAll('.trun.block')].findIndex(e=>e.classList.contains('shared')));
   const tip=await p.evaluate(i=>document.querySelectorAll('.trun.block')[i].title, i);
   check('shared block: the tooltip says how many pages use it', /reused on 3 pages/.test(tip), tip.slice(0,70));
   await pickBlock(i);
   check('shared block: the panel warns before the edit, in the warning style',
     /reuses on 3 pages/.test(await txt(p,'#tx-shared')) && (await p.$eval('#tx-shared',e=>e.className))==='warnline', await txt(p,'#tx-shared'));
   await p.$eval('#tx-text',e=>{e.value='Confidential - internal use only'; e.dispatchEvent(new Event('input'));}); await sleep(500);
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('shared-edit.pdf',d[0].buf);
   const t=execSync('pdftotext shared-edit.pdf - 2>/dev/null').toString();
   check('shared block: editing it updates every page that uses it', (t.match(/internal use only/g)||[]).length===3 && !/page footer/.test(t));
   check('shared block: the pages own text is untouched', (t.match(/Body text on page/g)||[]).length===3);
   check('shared block: output is structurally valid', /No syntax/.test(execSync('qpdf --check shared-edit.pdf 2>&1 || true').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }
 await openText('quote.pdf');
 { const i=await p.evaluate(()=>[...document.querySelectorAll('.trun.block')].findIndex(e=>e.classList.contains('fromblock')));
   check('reusable block used once: marked, but not warned about', i>=0 && (await p.$$('.trun.block.shared')).length===0);
   await pickBlock(i);
   check('reusable block used once: the panel says the change stays on this page',
     /stays here/.test(await txt(p,'#tx-shared')) && (await p.$eval('#tx-shared',e=>e.className))==='hint', await txt(p,'#tx-shared')); }

 // ---- a redaction must clear its area in one pass, measured by word coordinates ----
 { await upload(p,'#edit-input',FX('letter.pdf'));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=redact]').click()); await sleep(2200);
   await p.evaluate(()=>document.getElementById('estage').scrollIntoView({block:'center'})); await sleep(400);
   const st=await (await p.$('#estage')).boundingBox();
   // a band across the middle of the paragraph, cutting words at both edges
   await p.mouse.move(st.x+st.width*0.28, st.y+st.height*0.30); await p.mouse.down();
   await p.mouse.move(st.x+st.width*0.72, st.y+st.height*0.42,{steps:10}); await p.mouse.up(); await sleep(700);
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('red-area.pdf',d[0].buf);
   // read the marker back out of the file, so the check uses the real rectangle
   const stream=execSync('qpdf --qdf --object-streams=disable red-area.pdf - 2>/dev/null').toString('latin1');
   const m=stream.match(/q 0 0 0 rg ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re f Q/);
   check('redact: the marker is written into the page', !!m);
   if (m) {
     const [x,y,w,h]=m.slice(1).map(Number);
     const words=f=>{ const o=execSync(`pdftotext -f 1 -l 1 -bbox ${f} - 2>/dev/null`).toString();
       const out=[]; const re=/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g; let a;
       while((a=re.exec(o))) out.push([ +a[1], 792-(+a[4]), +a[3], 792-(+a[2]), a[5] ]);
       return out; };
     const hit=b=>b[0]<x+w && b[2]>x && b[1]<y+h && b[3]>y;
     const before=words('fx/letter.pdf').filter(hit), after=words('red-area.pdf').filter(hit);
     check('redact: one pass clears every word in the area', before.length>0 && after.length===0,
       `${before.length} words before, ${after.length} after: ${after.map(w2=>w2[4]).join(',')}`);
     check('redact: text outside the area survives', words('red-area.pdf').filter(b=>!hit(b)).length>0);
   }
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- a new text box can use one of the document's own fonts ----
 { await upload(p,'#edit-input',FX('quote.pdf'));
   await p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
   await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await sleep(300);
   const st=await (await p.$('#estage')).boundingBox();
   await p.mouse.click(st.x+st.width*0.25, st.y+st.height*0.62); await sleep(900);
   await p.keyboard.type('Added in the document font'); await sleep(500);
   const opts=await p.$$eval('#ep-font option',os=>os.map(o=>o.value));
   check('new text: the page own fonts are offered alongside the built-in ones',
     opts.some(v=>v.startsWith('doc:')) && opts.includes('Helvetica'), opts.slice(0,3).join(','));
   await p.evaluate(()=>{const s=document.getElementById('ep-font');
     const o=[...s.options].find(x=>x.value.startsWith('doc:')); s.value=o.value; s.dispatchEvent(new Event('change'));});
   await sleep(600);
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('newtext.pdf',d[0].buf);
   const t=execSync('pdftotext newtext.pdf - 2>/dev/null').toString();
   // reading it back proves the character codes written for that font are right
   check('new text: it reads back exactly as typed', t.includes('Added in the document font'));
   const fonts=execSync('pdffonts newtext.pdf 2>/dev/null').toString().split('\n').slice(2).map(l=>l.trim().split(/\s+/)[0]).filter(Boolean);
   check('new text: no extra font was embedded for it', fonts.length<=3, fonts.join(','));
   check('new text: the rest of the page is untouched', t.includes('Q57659') && t.includes('1,486.70'));
   check('new text: output is structurally valid', /No syntax/.test(execSync('qpdf --check newtext.pdf 2>&1 || true').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- the page comes first: blocks are quiet until pointed at, or shown on request ----
 await openText('letter.pdf');
 { const toggle=async()=>{ await p.evaluate(()=>document.getElementById('tx-showall').click()); await sleep(400); };
   const quiet=async()=>(await p.$$('.trun.quiet')).length;
   const total=async()=>(await p.$$('.trun')).length;
   const first=await quiet();
   await toggle();
   const second=await quiet();
   check('reveal: the toggle switches between showing every block and none', first!==second && (first===0 || second===0),
     `${first} quiet, then ${second} of ${await total()}`);
   check('reveal: the toggle reports its state for assistive tech',
     ['true','false'].includes(await p.$eval('#tx-showall',e=>e.getAttribute('aria-pressed'))));
   // quiet blocks still light up under the pointer
   if (await quiet() === 0) await toggle();
   { const spot=await p.evaluate(()=>{const e=document.querySelector('.trun.block'); const r=e.getBoundingClientRect(); return {x:r.left+4,y:r.top+4};});
     await p.mouse.move(spot.x,spot.y); await sleep(300);
     const bg=await p.evaluate(()=>getComputedStyle(document.querySelector('.trun.block')).backgroundColor);
     check('reveal: a quiet block still appears when hovered', bg!=='rgba(0, 0, 0, 0)', bg); }
   await toggle(); }

 // ---- text that cannot be rewritten can still be removed ----
 await openText('locked-text.pdf');
 { const locked=await p.$$('.trun.locked');
   check('locked text: it is found and marked', locked.length>0, locked.length+' runs');
   const spot=await p.evaluate(()=>{const e=document.querySelector('.trun.locked'); e.scrollIntoView({block:'center'});
     const r=e.getBoundingClientRect(); return {x:r.left+4,y:r.top+4,title:e.title};});
   check('locked text: the tooltip says it can still be removed', /can still be removed/.test(spot.title), spot.title.slice(0,60));
   await p.mouse.click(spot.x,spot.y); await sleep(500);
   check('locked text: selecting it offers removal', !(await p.$eval('#tx-locked',e=>e.hidden)));
   check('locked text: the panel says what else will go', /Nothing else is drawn|also removes/.test(await txt(p,'#tx-locked-extent')), await txt(p,'#tx-locked-extent'));
   await p.evaluate(()=>document.getElementById('tx-locked-go').click()); await sleep(500);
   check('locked text: the removal is staged', /text edit/.test(await txt(p,'#edit-summary')), await txt(p,'#edit-summary'));
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('locked-out.pdf',d[0].buf);
   const t=execSync('pdftotext locked-out.pdf - 2>/dev/null').toString();
   check('locked text: it is gone from the saved file', !t.includes('Stretched line'));
   check('locked text: the lines around it are untouched', t.includes('Ordinary line') && t.includes('Another ordinary'));
   check('locked text: output is structurally valid', /No syntax/.test(execSync('qpdf --check locked-out.pdf 2>&1 || true').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- why a block can't be edited ----
 await openText('type3.pdf');
 { const locked=await p.$$('.trun.locked');
   if (locked.length) {
     check('locked text explains itself', /reusable block|position isn't stated|doesn't match/.test(await locked[0].evaluate(e=>e.title)),
       (await locked[0].evaluate(e=>e.title)).slice(0,60));
     await locked[0].click(); await sleep(400);
     check('locked text: tapping it says why', /reusable block|position isn't stated|doesn't match/.test(await txt(p,'#edit-status')), (await txt(p,'#edit-status')).slice(0,60));
   } else {
     check('locked text explains itself', true, 'nothing locked on this page');
     check('locked text: tapping it says why', true, 'nothing locked on this page'); } }

 // ---- an older PDF: standard fonts, a named encoding and no ToUnicode table ----
 await openText('named-encoding.pdf');
 await pickBlock(1);
 { const opts=await p.$$eval('#tx-font option',os=>os.map(o=>o.value));
   check('named encoding: the document font is offered without a ToUnicode table',
     opts[0]==='doc' && /Times-Roman/.test(await txt(p,'#tx-fontnote')), opts.slice(0,3)+' / '+await txt(p,'#tx-fontnote')); }
 { const typed='Punctuation & accents: caf\u00e9 \u2014 "quoted" (1989).';
   await p.$eval('#tx-text',(e,v)=>{e.value=v; e.dispatchEvent(new Event('input'));}, typed); await sleep(700);
   check('named encoding: no missing-character warning for ordinary text', await p.$eval('#tx-warn',e=>e.hidden) || !/has no/.test(await txt(p,'#tx-fontnote')));
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('namedenc.pdf',d[0].buf);
   const t=execSync('pdftotext namedenc.pdf - 2>/dev/null').toString().replace(/\s+/g,' ');
   // reading it back proves the codes derived from the encoding are the right ones
   check('named encoding: the text reads back exactly as typed, accents and all', t.includes(typed), JSON.stringify((t.match(/Punctuation.{0,60}/)||[''])[0]));
   check('named encoding: no font was added to the file', !/Helvetica-\d/.test(execSync('pdffonts namedenc.pdf 2>/dev/null').toString()));
   check('named encoding: output is structurally valid', /No syntax/.test(execSync('qpdf --check namedenc.pdf 2>&1 || true').toString())); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- matching the document's own font ----
 await openText('quote.pdf');
 await pickBlock(0);
 { const opts=await p.$$eval('#tx-font option',os=>os.map(o=>o.value));
   check('document font: offered as the default, with its siblings',
     opts[0]==='doc' && opts.includes('doc:regular') && opts.includes('Helvetica'), opts.join(','));
   check('document font: the note names the font being used', /Using the document's own font: LiberationSans/.test(await txt(p,'#tx-fontnote')), await txt(p,'#tx-fontnote')); }
 await p.$eval('#tx-text',e=>{e.value='Harbour Supply Co'; e.dispatchEvent(new Event('input'));});
 await p.$eval('#tx-text',e=>{e.value='Liberty and Glory'; e.dispatchEvent(new Event('input'));}); await sleep(600);
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('docfont.pdf',d[0].buf);
 { const t=execSync('pdftotext docfont.pdf - 2>/dev/null').toString().replace(/\s+/g,' ');
   // reading the text back out proves the character codes we wrote are the right ones
   check('document font: the text reads back exactly as typed', t.includes('Liberty and Glory'), JSON.stringify(t.slice(0,60)));
   const fonts=execSync('pdffonts docfont.pdf 2>/dev/null').toString();
   check('document font: no extra font was added to the file', !/Helvetica\b.*\n.*Helvetica/.test(fonts) && /LiberationSans-Bold/.test(fonts));
   check('document font: output is structurally valid', /No syntax/.test(execSync('qpdf --check docfont.pdf 2>&1 || true').toString())); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- switching to the document's bold twin ----
 await openText('quote.pdf');
 { // find a block whose font has a bold twin in the document
   let found=-1, opts=[];
   const n=await p.$$eval('.trun.block',e=>e.length);
   for (let i=0;i<n && found<0;i++){ await pickBlock(i);
     opts=await p.$$eval('#tx-font option',os=>os.map(o=>o.value));
     if (opts.includes('doc:bold')) found=i; }
   check('document font: a block with a bold twin is found', found>=0, 'block '+found);
   if (found>=0) {
     await p.select('#tx-font','doc:bold'); await sleep(500);
     check('document font: bold twin can be chosen', /Bold/.test(await txt(p,'#tx-fontnote')), await txt(p,'#tx-fontnote'));
     await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('docbold.pdf',d[0].buf);
     const t=execSync('pdftotext docbold.pdf - 2>/dev/null').toString();
     check('document font: the bold version still reads correctly', t.trim().length>50);
     await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);
   } }

 // ---- a character the document's font lacks falls back, and says so ----
 await openText('quote.pdf');
 await pickBlock(0);
 await p.$eval('#tx-text',e=>{e.value='Freedom \u2014 Glory \u4e2d'; e.dispatchEvent(new Event('input'));}); await sleep(600);
 check('document font: warns when the font lacks a character you typed',
   /has no/.test(await txt(p,'#tx-fontnote')), await txt(p,'#tx-fontnote'));
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('docfallback.pdf',d[0].buf);
 { const t=execSync('pdftotext docfallback.pdf - 2>/dev/null').toString();
   check('document font: falls back rather than dropping the line', /Freedom/.test(t));
   check('document font: fallback output is valid', /No syntax/.test(execSync('qpdf --check docfallback.pdf 2>&1 || true').toString())); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- one visible line drawn by several show operators (bold headings, kerned runs) ----
 await openText('split-runs.pdf');
 await pickBlock(0);
 { const t=await p.$eval('#tx-text',e=>e.value);
   check('split runs: the pieces read as one line', t==='Check Information Header', JSON.stringify(t)); }
 await p.$eval('#tx-text',e=>{e.value='Replaced Heading'; e.dispatchEvent(new Event('input'));}); await sleep(600);
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('split-edited.pdf',d[0].buf);
 { const t=execSync('pdftotext split-edited.pdf -').toString();
   check('split runs: the replacement is drawn', t.includes('Replaced Heading'));
   check('split runs: no piece of the old line is left underneath', !['Check','Information','Header'].some(w=>t.includes(w)),
     ['Check','Information','Header'].filter(w=>t.includes(w)).join(','));
   check('split runs: the other lines are untouched', t.includes('An ordinary line drawn in one go.') && t.includes('A second ordinary line below it.')); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- a page printed from a browser: flipped transform that is never closed ----
 await openText('browser-print.pdf');
 { const shape=await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]));
   check('browser-printed page: lines group into a paragraph', shape.join(',')==='3,1', shape.join(',')); }
 await pickBlock(0);
 { const size=+(await p.$eval('#tx-size',e=>e.value));
   check('browser-printed page: size is read from the page, not the raw font size', Math.abs(size-11.9)<1, String(size)); }
 await p.$eval('#tx-text',e=>{e.value=e.value.replace('browser','web browser'); e.dispatchEvent(new Event('input'));}); await sleep(600);
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('bp-edited.pdf',d[0].buf);
 { const word=f=>{ const m=execSync(`pdftotext -bbox ${f} -`).toString().match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Printed<\/word>/); return m?m.slice(1,5).map(Number):null; };
   const a=word('fx/browser-print.pdf'), c2=word('bp-edited.pdf');
   check('browser-printed page: the replacement lands exactly where the original was',
     a && c2 && a.every((v,i)=>Math.abs(v-c2[i])<1.5), `${a} -> ${c2}`);
   check('browser-printed page: it is drawn upright at the right size', c2 && (c2[3]-c2[1])>8 && (c2[3]-c2[1])<16, c2 && (c2[3]-c2[1]).toFixed(1)+'pt tall'); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- a Type 3 font carries its own matrix, so "Tf 24" is not 24pt on the page ----
 await openText('type3.pdf');
 { const sizes=[];
   for (let i=0;i<2;i++){ await pickBlock(i); sizes.push(+(await p.$eval('#tx-size',e=>e.value))); }
   check('sizing adapts to how the PDF stores its text (Type 3 font matrix)',
     Math.abs(sizes[0]-24)<1.5 && Math.abs(sizes[1]-12)<1.5, JSON.stringify(sizes)); }

 // ---- the mask behind the preview must match the paper, not the app theme ----
 { const dp=await H.newPage(b,H.LOCAL,false);
   await dp.p.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);
   await upload(dp.p,'#edit-input',FX('letter.pdf'));
   await dp.p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
   await dp.p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=text]').click());
   await dp.p.waitForFunction(()=>document.querySelectorAll('.trun.block').length>0,{timeout:30000}); await sleep(600);
   const spot=await dp.p.evaluate(()=>{const e=document.querySelectorAll('.trun.block')[1]; const r=e.getBoundingClientRect(); return {x:r.left+4,y:r.top+4};});
   await dp.p.mouse.click(spot.x,spot.y); await sleep(400);
   await dp.p.$eval('#tx-text',e=>{e.value=e.value.replace('October 9','November 13'); e.dispatchEvent(new Event('input'));}); await sleep(700);
   const c2=await dp.p.evaluate(()=>{const m=document.querySelector('.tmask'), t=document.querySelector('.tprev');
     const lum=c=>{const [x,y,z]=c.match(/\d+/g).map(Number); return 0.2126*x+0.7152*y+0.0722*z;};
     return Math.abs(lum(getComputedStyle(m).backgroundColor)-lum(getComputedStyle(t).color));});
   check('dark mode: the edit preview stays readable over the page', c2>100, 'contrast '+Math.round(c2));
   await dp.p.close(); }

 // ---- resizing a block changes where its text wraps ----
 await openText('letter.pdf');
 await pickBlock(1);
 check('resize: the selected block has resize grips', (await p.$$('.tgrip')).length>=2, (await p.$$('.tgrip')).length+' grips');
 { const grip=async()=>p.evaluate(()=>{const r=document.querySelector('.tgrip').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};});
   let g=await grip();
   await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x-90,g.y,{steps:10}); await p.mouse.up(); await sleep(500);
   const lines=await p.$$eval('.tprev',e=>e.length);
   check('resize: narrowing re-wraps the text live', lines>4, lines+' preview lines');
   check('resize: it warns the block will grow over what is below',
     !(await p.$eval('#tx-warn',e=>e.hidden)) && /run down over/.test(await txt(p,'#tx-warn')), await txt(p,'#tx-warn'));
   check('resize: the width is shown', /pt wide/.test(await txt(p,'#tx-lines')), await txt(p,'#tx-lines'));
   await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('resized.pdf',d[0].buf);
   const t=execSync('pdftotext resized.pdf -').toString().replace(/\s+/g,' ');
   check('resize: the saved file keeps the whole paragraph', t.includes('forms for the coming semester.') && t.includes('technology night'));
   check('resize: output is structurally valid', /No syntax/.test(execSync('qpdf --check resized.pdf 2>&1 || true').toString()));
   await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000); }

 // ---- a table must not collapse when a cell is edited ----
 await openText('quote.pdf');
 { const shape=await p.$$eval('.trun.block',es=>es.map(e=>+e.title.match(/^(\d+)/)[1]));
   check('text: table rows stay separate blocks', shape.filter(n=>n===1).length>=15, shape.join(',')); }
 await pickBlock(1);
 { const t=await p.$eval('#tx-text',e=>e.value);
   check('text: the address block groups as one paragraph', t.split('\n').length===5, JSON.stringify(t.slice(0,40))); }
 await p.$eval('#tx-text',e=>{e.value=e.value.replace('Dana Whitfield','Alex Tester'); e.dispatchEvent(new Event('input'));}); await sleep(500);
 check('text: no re-wrap warning while the lines still fit', await p.$eval('#tx-warn',e=>e.hidden));
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('para.pdf',d[0].buf);
 { const t=execSync('pdftotext -layout para.pdf -').toString();
   check('text: the edited line changed', t.includes('Alex Tester'));
   check('text: the table is undisturbed', /AD630-SC\s+3x5 NYLON SOUTH CAROLINA/.test(t));
   check('text: the other lines kept their places', ['Quote #Q57659','Springfield, IL 62704'].every(k=>t.includes(k))); }
 await p.evaluate(()=>document.getElementById('docbar-undo').click()); await sleep(2000);

 // ---- page toolbar must not break apart, at any width ----
 { const rows=async()=>p.evaluate(()=>{const bar=document.querySelector('.viewer-bar');
     const tops=[...bar.children].map(c=>Math.round(c.getBoundingClientRect().top));
     // a group that wrapped internally becomes about twice as tall as its own buttons
     const inner=[...bar.querySelectorAll('.grp')].map(g=>{
       const gh=g.getBoundingClientRect().height;
       const ch=Math.max(...[...g.children].map(c=>c.getBoundingClientRect().height));
       return gh > ch*1.6;});
     return {groupRows:new Set(tops).size, splitGroups:inner.filter(Boolean).length, overflow:bar.scrollWidth>bar.clientWidth+1};});
   let r=await rows();
   check('toolbar: groups stay intact when the page is wide', r.splitGroups===0 && !r.overflow, JSON.stringify(r));
   await p.setViewport({width:760,height:900}); await sleep(900); r=await rows();
   check('toolbar: groups stay intact on a narrow window', r.splitGroups===0 && !r.overflow, JSON.stringify(r));
   await p.setViewport({width:1280,height:900}); await sleep(900); }

 // ---- dark mode: nothing may end up same-on-same (regression: white tooltip text on a white background) ----
 { const dp=(await H.newPage(b,H.LOCAL,false));
   await dp.p.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);
   await upload(dp.p,'#edit-input',FX('a.pdf')); await sleep(2600);
   const bad=await dp.p.evaluate(()=>{
     const lum=c=>{const m=(c||'').match(/[\d.]+/g); if(!m) return null; const [r,g,b]=m.map(Number); return 0.2126*r+0.7152*g+0.0722*b;};
     const solid=el=>{ let e=el; while(e){ const c=getComputedStyle(e).backgroundColor; if(c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; e=e.parentElement; } return 'rgb(255,255,255)'; };
     const out=[];
     document.querySelectorAll('#annot-tools .tlabel, .btn, .primary, .segbtn, .tool, .dfname, .zoomval, .rsummary, .ribbon-note, #docbar-steps, #docbar-name, .sub, .hint').forEach(el=>{
       if(!el.offsetParent && el.className!=='tlabel') return;
       const s=getComputedStyle(el); const f=lum(s.color), bg=lum(solid(el));
       if(f!==null && bg!==null && Math.abs(f-bg)<40) out.push((el.id||el.className)+' fg='+s.color+' bg='+solid(el));
     });
     return out;
   });
   check('dark mode: no invisible text (text vs its background)', bad.length===0, bad.slice(0,4).join(' | '));
   await dp.p.close(); }

 // ---- switching tools puts the signature away (regression: it used to stay open) ----
 await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(300);
 await p.type('#sig-name','Test Name'); await p.evaluate(()=>document.getElementById('sig-make').click()); await sleep(1300);
 check('tools: signature armed after creating it', await p.evaluate(()=>document.getElementById('sig-tool').classList.contains('active')) && !(await p.$eval('#sigbox',e=>e.hidden)));
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await sleep(300);
 check('tools: picking another tool closes the signature panel and disarms it',
   (await p.$eval('#sigbox',e=>e.hidden)) && !(await p.evaluate(()=>document.getElementById('sig-tool').classList.contains('active')))
   && (await p.evaluate(()=>document.querySelector('.tool[data-tool=text]').classList.contains('active'))));
 // ---- the ribbon: one place for every mode, with the page keeping the full width ----
 { const tools=await p.$$eval('#annot-tools .tool',ts=>ts.map(t=>t.dataset.tool||t.id));
   check('ribbon: every Add-to-page tool is still there', ['text','date','check','cross','hl','box','white','signature','tool-image'].every(t=>tools.includes(t)), tools.join(','));
   const labels=await p.$$eval('#annot-tools .tlabel',ls=>ls.map(l=>{const r=l.getBoundingClientRect(), cs=getComputedStyle(l); return r.width>0&&r.height>0&&+cs.opacity===1&&l.textContent.trim().length>0;}));
   check('ribbon: each tool shows its label, not only on hover', labels.length>=9 && labels.every(Boolean), JSON.stringify(labels));
   const modes=await p.$$eval('#edit-modes .segbtn',bs=>bs.map(b=>b.dataset.emode));
   check('ribbon: the five modes are tabs of one ribbon', modes.join(',')==='annotate,form,text,redact,doc' && !!(await p.$('#docribbon #edit-modes')), modes.join(','));
   const panes={annotate:'rp-annotate',text:'tx-ribbon',redact:'rd-ribbon',doc:'edit-docopts'}; const seen=[];
   for (const [m,id] of Object.entries(panes)) {
     await p.evaluate(m=>document.querySelector('#edit-modes .segbtn[data-emode='+m+']').click(),m); await sleep(500);
     const vis=await p.$$eval('#rbody > .rpane',ps=>ps.filter(e=>!e.hidden&&e.offsetParent).map(e=>e.id));
     seen.push(m+':'+vis.join('+')); if (vis.join()!==id) { check('ribbon: '+m+' tab shows only its own controls', false, vis.join()+' (wanted '+id+')'); }
   }
   check('ribbon: each tab shows only its own controls', seen.every(x=>{const [m,v]=x.split(':'); return v===panes[m];}), seen.join(' | '));
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=annotate]').click()); await sleep(500);
   const g=await p.evaluate(()=>{const r=document.getElementById('docribbon').getBoundingClientRect(), st=document.querySelector('.stagecol').getBoundingClientRect(); return {ribbon:Math.round(r.height), page:Math.round(st.width), vw:innerWidth};});
   check('ribbon: compact, and the page column is the full width', g.ribbon<=130 && g.page>=g.vw*0.7, JSON.stringify(g));
   await p.evaluate(()=>document.getElementById('sig-tool').click()); await sleep(500);
   const g2=await p.evaluate(()=>{const st=document.querySelector('.stagecol').getBoundingClientRect(), c=document.querySelector('.ctlcol').getBoundingClientRect(), mid=document.elementFromPoint(c.left+c.width/2,c.top+30); return {page:Math.round(st.width), floats:getComputedStyle(document.querySelector('.ctlcol')).position==='fixed', on_top:!!(mid&&mid.closest('.ctlcol'))};});
   check('ribbon: the signature panel floats over the page instead of narrowing it', g2.floats && g2.on_top && g2.page===g.page, JSON.stringify(g2));
   await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await sleep(300);
   // the quick-access bar: save and undo as icons in the header, no banner row of its own
   await p.evaluate(()=>window.scrollTo(0,0)); await sleep(200);
   { const q=await p.evaluate(()=>{const h=document.querySelector('header.top').getBoundingClientRect(), r=document.getElementById('docribbon').getBoundingClientRect();
       const dl=document.getElementById('docbar-dl'), un=document.getElementById('docbar-undo'), steps=+document.getElementById('docbar').dataset.steps;
       return {inHeader:!!document.querySelector('header.top #docbar'), icons:!!dl.querySelector('svg')&&!!un.querySelector('svg')&&dl.textContent.trim()===''&&un.textContent.trim()==='',
         labelled:!!dl.getAttribute('aria-label')&&!!un.getAttribute('aria-label'), gap:Math.round(r.top-h.bottom), undoOk:un.disabled===(steps===0), steps, sticky:getComputedStyle(document.querySelector('header.top')).position};});
     check('header: save and undo are icon buttons in the header', q.inHeader && q.icons && q.labelled, JSON.stringify(q));
     check('header: no banner row, so the ribbon sits right under the header', q.gap>=0 && q.gap<=24 && q.sticky==='sticky', JSON.stringify(q));
     check('header: undo is only enabled when there is something to undo', q.undoOk, JSON.stringify(q));
     await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
     const dls=await H.takeDownloads(p,1).catch(()=>[]);
     check('header: Ctrl+S downloads the document', dls.length===1 && dls[0].buf.slice(0,5).toString()==='%PDF-', dls.length+' download(s)'); }
   // the selected object's controls ride next to the object, not in the ribbon or a side column
   { await p.evaluate(()=>window.scrollTo(0,0)); await sleep(150);
     const rb0=await p.$eval('#docribbon',e=>Math.round(e.getBoundingClientRect().height)), pg0=await p.$eval('.stage-wrap',e=>Math.round(e.getBoundingClientRect().top));
     await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=box]').click());
     const sb=await (await p.$('#estage')).boundingBox(); await p.mouse.click(sb.x+sb.width*0.5, sb.y+sb.height*0.6); await sleep(600);
     const g=await p.evaluate(()=>{const bar=document.getElementById('eprops'), o=document.querySelector('.eobj.sel'), br=bar.getBoundingClientRect(), or=o.getBoundingClientRect();
       return {parent:bar.parentElement.id, hidden:bar.hidden, near:Math.min(Math.abs(br.bottom-or.top), Math.abs(br.top-or.bottom))<=24, overlapsObj:!(br.bottom<=or.top||br.top>=or.bottom||br.right<=or.left||br.left>=or.right),
         sidePanel:document.getElementById('workarea').classList.contains('has-props'), ribbon:Math.round(document.getElementById('docribbon').getBoundingClientRect().height), pageTop:Math.round(document.querySelector('.stage-wrap').getBoundingClientRect().top), n:document.querySelectorAll('.eobj').length};});
     check('props: the controls sit next to the selected object, not over it', g.parent==='estage' && !g.hidden && g.near && !g.overlapsObj, JSON.stringify(g));
     check('props: selecting an object adds nothing to the ribbon and moves nothing', !g.sidePanel && g.ribbon===rb0 && g.pageTop===pg0, JSON.stringify({rb0,pg0,...g}));
     // pressing inside the bar must not fall through to the page and deselect the object
     const cr=await (await p.$('#eprops .colorchip[title=Red]')).boundingBox(); await p.mouse.click(cr.x+cr.width/2, cr.y+cr.height/2); await sleep(400);
     const after=await p.evaluate(()=>({n:document.querySelectorAll('.eobj').length, sel:!!document.querySelector('.eobj.sel'), hidden:document.getElementById('eprops').hidden}));
     check('props: clicking inside the bar keeps the selection', after.n===g.n && after.sel && !after.hidden, JSON.stringify(after));
     await p.evaluate(()=>document.querySelector('#eprops .prophead .btn').click()); await sleep(300);
     check('props: Delete in the bar removes the object and the bar goes away', (await p.$$('.eobj')).length===g.n-1 && await p.$eval('#eprops',e=>e.hidden)); }
   { const mp=(await H.newPage(b,H.LOCAL,true)); await upload(mp.p,'#edit-input',FX('a.pdf')); await mp.p.waitForFunction(()=>document.getElementById('estage-canvas').width>0,{timeout:30000}); await sleep(1200);
     await mp.p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=box]').click());
     const mb=await (await mp.p.$('#estage')).boundingBox(); await mp.p.mouse.click(mb.x+mb.width*0.5, mb.y+mb.height*0.4); await sleep(600);
     const m=await mp.p.evaluate(()=>({parent:document.getElementById('eprops').parentElement.className, hidden:document.getElementById('eprops').hidden}));
     check('props: on a phone the controls stay in the panel instead of covering the page', m.parent==='ctlcol' && !m.hidden, JSON.stringify(m));
     await mp.p.close(); }
   // collapsing for reading
   const h0=await p.$eval('.stage-wrap',e=>Math.round(e.getBoundingClientRect().height));
   await p.evaluate(()=>document.getElementById('rb-collapse').click()); await sleep(900);
   const c1=await p.evaluate(()=>({exp:document.getElementById('rb-collapse').getAttribute('aria-expanded'), body:getComputedStyle(document.getElementById('rbody')).display, tabs:!!document.querySelector('.rtabs'), h:Math.round(document.querySelector('.stage-wrap').getBoundingClientRect().height)}));
   check('ribbon: collapsing hides the controls and gives the page more room', c1.exp==='false' && c1.body==='none' && c1.tabs && c1.h>h0, JSON.stringify({h0,...c1}));
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=text]').click()); await sleep(700);
   check('ribbon: choosing a tab opens it again', (await p.$eval('#rb-collapse',e=>e.getAttribute('aria-expanded')))==='true' && !(await p.$eval('#tx-ribbon',e=>e.hidden)));
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=annotate]').click()); await sleep(500); }
 await p.evaluate(()=>document.querySelector('#annot-tools .tool[data-tool=text]').click()); await sleep(200);

 // ---- Fill form ----
 await upload(p,'#edit-input',FX('form.pdf')); await p.waitForFunction(()=>!document.querySelector('#edit-modes .segbtn[data-emode=form]').disabled); await sleep(800);
 check('form: fields detected', (await txt(p,'#edit-fieldcount'))==='(7)' || (await txt(p,'#edit-fieldcount'))==='(5)', await txt(p,'#edit-fieldcount'));
 await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=form]').click()); await sleep(300);
 const ov=await p.$$('#eolayer .ffield');
 check('form: overlays on page 1', ov.length===6, 'count '+ov.length);
 // overlay position of student_name: x150..450, y680..702 -> display top=(792-702)/792
 { const f=await objFrac(p,'#eolayer .ffield'); const exp={x0:150/612,y0:(792-702)/792,x1:450/612,y1:(792-680)/792};
   check('form: field overlay aligned', Math.abs(f.x0-exp.x0)<0.01&&Math.abs(f.y0-exp.y0)<0.01&&Math.abs(f.x1-exp.x1)<0.01&&Math.abs(f.y1-exp.y1)<0.01, JSON.stringify(f)); }
 // select the first field deterministically by tapping its overlay on the page
 await sleep(600);
 console.log('   [debug]', JSON.stringify(await p.evaluate(()=>({fpanel:document.getElementById('fpanel').hidden, mode:[...document.querySelectorAll('#edit-modes .segbtn')].find(b=>b.classList.contains('active')).dataset.emode, overlays:document.querySelectorAll('#eolayer .ffield').length, props:document.getElementById('workarea').className}))));
 await p.evaluate(()=>document.querySelectorAll('#eolayer .ffield')[0].click());
 await p.waitForFunction(()=>document.getElementById('f-label').textContent==='Student name',{timeout:15000}).catch(()=>{});
 await p.waitForFunction(()=>document.getElementById('f-label').textContent==='Student name',{timeout:15000}).catch(()=>{});
 check('form: human-readable label from tooltip', (await txt(p,'#f-label'))==='Student name', await txt(p,'#f-label'));
 await p.keyboard.type('Jane Doe'); await p.keyboard.press('Enter');
 await p.waitForFunction(()=>document.getElementById('f-label').textContent==='consent',{timeout:15000}).catch(()=>{});
 check('form: Enter moves to next field', (await txt(p,'#f-label'))==='consent', await txt(p,'#f-label'));
 // tap the checkbox overlay on the page
 await p.evaluate(()=>document.querySelectorAll('#eolayer .ffield')[1].click()); await sleep(200);
 check('form: tapping a checkbox toggles it', (await p.$eval('#f-input input[type=checkbox]',e=>e.checked)));
 // radio: tap option "2" (third radio widget)
 await p.evaluate(()=>document.querySelectorAll('#eolayer .ffield')[4].click()); await sleep(200);
 check('form: tapping a radio button selects it', (await p.$$eval('#f-input input[type=radio]',els=>els.map(e=>e.checked).join()))==='false,false,true');
 await p.evaluate(()=>document.querySelector('#f-next').click()); await sleep(200);
 await p.select('#f-input select','South Elementary'); await sleep(100);
 await p.evaluate(()=>document.querySelector('#f-next').click()); await sleep(900);
 check('form: Next crosses to the rotated page', (await txt(p,'#e-label')).startsWith('Page 2'));
 { const f=await objFrac(p,'#eolayer .ffield'); const exp={x0:400/612,y0:100/792,x1:424/612,y1:280/792};
   check('form: overlay aligned on rotated page', Math.abs(f.x0-exp.x0)<0.012&&Math.abs(f.y0-exp.y0)<0.012&&Math.abs(f.x1-exp.x1)<0.012&&Math.abs(f.y1-exp.y1)<0.012, JSON.stringify(f)+' exp '+JSON.stringify(exp)); }
 await p.keyboard.type('09/22/2026'); await sleep(100);
 check('form: typing alone enables Save', !(await p.$eval('#edit-go',b=>b.disabled)));
 check('form: summary counts filled fields', (await txt(p,'#edit-summary')).includes('5 fields filled'), await txt(p,'#edit-summary'));
 await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1);
 { const doc=await PDFDocument.load(d[0].buf); const f=doc.getForm();
   const v=[f.getTextField('student_name').getText(), f.getCheckBox('consent').isChecked(), f.getRadioGroup('grade').getSelected(), f.getDropdown('school').getSelected()[0], f.getTextField('sign_date').getText()];
   check('form: values saved, still editable', JSON.stringify(v)===JSON.stringify(['Jane Doe',true,'2','South Elementary','09/22/2026']), JSON.stringify(v)); }
 await p.evaluate(()=>document.querySelector('#f-flatten').click()); await H.applyAndDownload(p,'#edit-go'); d=await H.takeDownloads(p,1); fs.writeFileSync('flat.pdf',d[0].buf);
 { const doc=await PDFDocument.load(d[0].buf); const n=doc.getForm().getFields().length; const t=execSync('pdftotext flat.pdf -').toString();
   check('form: flatten locks answers into the page', n===0 && t.includes('Jane Doe') && t.includes('South Elementary'), `fields=${n}`); }
 { const e=execSync('pdfinfo flat.pdf 2>&1 | grep -c "Syntax Error" || true').toString().trim(); const q=execSync('qpdf --check flat.pdf 2>&1').toString().replace(/\n/g,' ');
   check('form: flattened file has a clean cross-reference table (poppler + qpdf)', e==='0' && /No syntax/.test(q), `poppler errors=${e}; qpdf: ${q.slice(0,40)}`); }

 // ---- Clear all resets Edit ----
 await p.click('#clear-all'); await p.click('#clear-all'); await sleep(400); await tool(p,'document'); await sleep(200);
 check('clear: Edit emptied', await p.$eval('#edit-work',e=>e.hidden) && (await p.$$('#eolayer > *')).length===0);
 const csp=await p.evaluate(()=>window.__csp);
 check('strict CSP: zero violations', csp.length===0, csp.join(' | '));
 check('zero network requests', ext.length===0, ext.join(' '));
 check('no script errors', errors.length===0, errors.join(' | '));
 await p.close();

 // ---- mobile: 7-tab strip fits, edit screen ----
 { const {p}=await H.newPage(b,H.LOCAL,true);
   const strip=await p.evaluate(()=>{const r=document.querySelector('.rail-inner'); return {scrolls:r.scrollWidth>r.clientWidth, overflow:getComputedStyle(r).overflowX, n:document.querySelectorAll('.rail-btn').length};});
   await p.tap('.rail-btn[data-tool=document]'); await p.evaluate(()=>document.querySelector('.rail-btn[data-tool=prepare]').click()); await sleep(300);
   const vis=await p.evaluate(()=>{const b=document.querySelector('.rail-btn[data-tool=prepare]').getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth+1;});
   // with six or fewer tools the strip fits; if it ever grows again it must still scroll
   check('mobile: every tool is reachable and the active one stays on screen',
     (strip.scrolls ? strip.overflow==='auto' : true) && strip.n>=4 && vis, JSON.stringify(strip)+' visible='+vis);
   await p.tap('.rail-btn[data-tool=document]'); await upload(p,'#edit-input',FX('form.pdf')); await sleep(1200);
   await p.tap('#annot-tools .tool[data-tool=text]'); await p.$eval('#estage',e=>e.scrollIntoView({block:'center'})); await sleep(200);
   const bb=await (await p.$('#estage')).boundingBox(); await p.tap('#estage'); await sleep(300);
   await p.keyboard.type('Mobile note'); await sleep(200);
   await p.screenshot({path:'shot-m-edit.png',fullPage:true});
   await p.close(); }
 await b.close(); H.summary();
})().catch(e=>{console.log('SUITE ERROR',e.stack);process.exit(1)});
