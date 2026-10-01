const H=require('./harness'); const {check,sleep,FX,txt,upload,tool,fs,execSync}=H;
const sh=c=>{try{return execSync(c,{stdio:['ignore','pipe','pipe']}).toString()}catch(e){return 'ERR '+((e.stderr||'')+(e.stdout||'')).toString()}};
const seg=(p,g,m)=>p.click(`#${g} .segbtn[data-mode=${m}]`);
// a panel can hold more than one status box; report whichever has something to say
const statusOf=p=>p.evaluate(()=>{const all=[...document.querySelectorAll('.panel.active .status')];
  const s=all.filter(x=>x.textContent.trim()).pop()||all[0]; return s?{cls:s.className,text:s.textContent}:null;});
async function waitStatus(p,re,ms=60000){ await p.waitForFunction(r=>[...document.querySelectorAll('.panel.active .status')].some(s=>new RegExp(r).test(s.className) && s.textContent.trim()),{timeout:ms},re); return statusOf(p); }
async function type(p,sel,v){ await p.$eval(sel,e=>e.value=''); await p.type(sel,v); }
(async()=>{
 const b=await H.launch();
 const {p,ext,errors}=await H.newPage(b,H.LOCAL,false);
 const dl=async n=>H.takeDownloads(p,n||1,60000);
 // files open in the Document tab now; the other tabs work on whatever is open
 const openDoc=async(file, thenTool)=>{
   await tool(p,'document'); await sleep(300);
   await upload(p,'#edit-input', file.startsWith('/')?file:FX(file));
   await p.waitForFunction(()=>!document.getElementById('edit-work').hidden && document.getElementById('estage-canvas').width>0,{timeout:30000});
   await sleep(700);
   if (thenTool) { await tool(p,thenTool); await sleep(1200); }
 };


 // ================= PROTECT: metadata =================
 await openDoc('meta.pdf','prepare'); await p.waitForFunction(()=>document.querySelectorAll('#meta-table tr').length>0,{timeout:30000}); await sleep(400);
 const table=await p.$$eval('#meta-table tr',rs=>Object.fromEntries(rs.map(r=>[r.cells[0].textContent,r.cells[1].textContent])));
 check('meta: shows current title/author/creator', table.Title==='Revised Title'&&table.Author==='Jane Secret', JSON.stringify(table).slice(0,140));
 const finds=await p.$$eval('#meta-findings li',ls=>ls.map(l=>l.className+': '+l.textContent));
 const hit=re=>finds.some(f=>f.startsWith('hit')&&re.test(f));
 check('meta: finds XMP', hit(/XMP/)); check('meta: finds PieceInfo', hit(/PieceInfo/)); check('meta: finds JavaScript', hit(/JavaScript/));
 check('meta: finds attachment', hit(/attached file/)); check('meta: finds comment author', hit(/author names/));
 check('meta: finds hidden earlier revision', hit(/incremental/)); check('meta: finds unused objects', hit(/unused object/), finds.join(' | ').slice(0,300));
 await p.click('#meta-opt-att'); await H.applyAndDownload(p,'#meta-go'); let d=await dl(); fs.writeFileSync('clean.pdf',d[0].buf);
 const qdf=sh('qpdf --qdf --object-streams=disable clean.pdf - 2>/dev/null');
 check('meta: output valid (qpdf)', /No syntax/.test(sh('qpdf --check clean.pdf')));
 const leaks=['Secret','SecretTool','secret-private-data','Original Secret Title','Revised Title','grades.csv','app.alert','pdf-lib'].filter(s=>qdf.includes(s));
 check('meta: no secret string survives anywhere in the decompressed file (incl. old revision)', leaks.length===0, 'leaked: '+leaks.join(', '));
 const pk=sh(`python3 -c "
import pikepdf; p=pikepdf.open('clean.pdf'); print(len(p.docinfo.keys()), '/Metadata' in p.Root, '/OpenAction' in p.Root, '/Names' in p.Root and '/EmbeddedFiles' in p.Root.Names, '/PieceInfo' in p.pages[0].obj, '/T' in p.pages[0].Annots[0], len(p.pages))"`).trim();
 check('meta: pikepdf confirms info/XMP/JS/attachments/PieceInfo/author gone, pages kept', pk==='0 False False False False False 3', pk);
 check('meta: clean text still present', sh('pdftotext clean.pdf -').includes('Page 1 portrait'));
 check('meta: file saved as a single revision', (qdf.match(/startxref/g)||[]).length===1);
 const after=await p.$$eval('#meta-findings li.hit',ls=>ls.length);
 check('meta: re-inspection of cleaned copy shows nothing left', after===0, (await p.$$eval('#meta-findings li.hit',ls=>ls.map(l=>l.textContent))).join(' | '));

 // ================= FINISH: add password =================
 await openDoc('form.pdf','finish');
 await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=password]').click()); await sleep(200); await seg(p,'pw-modes','lock'); await sleep(150);
 await type(p,'#lock-user','Open-sesame-2026'); await type(p,'#lock-user2','Open-sesame-202');
 check('lock: mismatched confirmation blocked', /match/.test(await txt(p,'#lock-msg')) && await p.$eval('#lock-go',b=>b.disabled));
 await type(p,'#lock-user2','Open-sesame-2026'); await p.click('#lock-copy');
 check('lock: restriction without permissions password blocked', /permissions password/.test(await txt(p,'#lock-msg')));
 await type(p,'#lock-owner','Open-sesame-2026');
 check('lock: same open/permissions password blocked', /different/.test(await txt(p,'#lock-msg')));
 await type(p,'#lock-owner','Owner-Key-7781');
 check('lock: ready', !(await p.$eval('#lock-go',b=>b.disabled)), await txt(p,'#lock-msg'));
 await p.evaluate(()=>document.getElementById('lock-go').click()); d=await dl(); fs.writeFileSync('prot256.pdf',d[0].buf);
 { const e=sh('qpdf --password=Open-sesame-2026 --show-encryption prot256.pdf');
   check('lock: AES-256 (R6) per qpdf', /R = 6/.test(e)&&/AESv3/.test(e), e.split('\n').filter(l=>/^R =|file encr/.test(l)).join('|'));
   check('lock: copy blocked, print allowed', /extract for any purpose: not allowed/.test(e)&&/print high resolution: allowed/.test(e));
   check('lock: opening without password fails', /invalid password|password/i.test(sh('qpdf --check prot256.pdf')));
   check('lock: opens with password, form intact', sh('pdftotext -upw Open-sesame-2026 prot256.pdf -').includes('Enrollment form'));
   check('lock: owner password accepted', /No syntax/.test(sh('qpdf --password=Owner-Key-7781 --check prot256.pdf'))); }
 await p.select('#lock-alg','AES-128'); await p.evaluate(()=>document.getElementById('lock-go').click()); d=await dl(); fs.writeFileSync('prot128.pdf',d[0].buf);
 { const e=sh('qpdf --password=Open-sesame-2026 --show-encryption prot128.pdf'); check('lock: AES-128 (R4, AESv2) per qpdf', /R = 4/.test(e)&&/AESv2/.test(e)); }
 check('lock: weak password warned', await (async()=>{ await type(p,'#lock-user','abc'); return /Too short/.test(await txt(p,'#lock-user-str')); })());

 // ================= FINISH: remove password =================
 await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=password]').click()); await sleep(200); await seg(p,'pw-modes','unlock'); await sleep(150);
 check('unlock: has its own picker for protected files', !(await p.$eval('#unlock-dz',e=>e.offsetParent===null)));
 const unlock=async(file,pw)=>{ await upload(p,'#unlock-input',FX(file)); await p.waitForFunction(()=>!document.getElementById('unlock-work').hidden,{timeout:10000}).catch(()=>{}); await sleep(200); await type(p,'#unlock-pw',pw); await p.evaluate(()=>document.getElementById('unlock-go').click()); const st=await waitStatus(p,'success|error',30000);
   if(/success/.test(st.cls)) await H.downloadDoc(p);
   return st; };
 for (const [f,user,owner] of [['restr-r6.pdf','user2','owner2'],['restr-r4.pdf','u4','o4'],['restr-r3.pdf','u3','o3'],['restr-r2.pdf','u2','o2']]) {
   let s=await unlock(f,user); check(`unlock ${f}: open password refused for restricted file`, /error/.test(s.cls)&&/permissions/.test(s.text), s.text.slice(0,80));
   s=await unlock(f,'wrong-pass'); check(`unlock ${f}: wrong password refused`, /error/.test(s.cls)&&/isn't correct/.test(s.text));
   s=await unlock(f,owner); const out=await dl(); fs.writeFileSync('unl.pdf',out[0].buf);
   check(`unlock ${f}: owner password removes encryption`, /success/.test(s.cls) && /not encrypted/.test(sh('qpdf --show-encryption unl.pdf')) && sh('pdftotext unl.pdf -').includes('Page 1 portrait'));
 }
 { await upload(p,'#unlock-input',FX('restr-r6.pdf')); await sleep(400); check('unlock: shows what is restricted', /printing/.test(await txt(p,'#unlock-meta')), await txt(p,'#unlock-meta')); }
 { const s=await unlock('encrypted.pdf','user'); await dl(); check('unlock: unrestricted file opens with the user password', /success/.test(s.cls), s.text.slice(0,80)); }
 { await upload(p,'#unlock-input',FX('a.pdf')); await sleep(400); const s=await statusOf(p); check('unlock: unencrypted file explained', /isn't encrypted/.test(s.text)); }
 { await tool(p,'pages'); await upload(p,'#pages-input',FX('encrypted.pdf')); await sleep(900); const s=await statusOf(p); check('other tools point to Finish for encrypted files', /Remove a password/.test(s.text), s.text.slice(0,90)); }

 // ================= DIGITAL ID: create =================
 await tool(p,'finish'); await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=sign]').click()); await sleep(200); await seg(p,'dg-modes','create'); await sleep(150);
 await type(p,'#dg-name','Alex Tester'); await type(p,'#dg-email','alex@example.org'); await type(p,'#dg-pw','short');
 check('create: short password refused', /at least 10/.test(await txt(p,'#dg-create-msg')));
 await type(p,'#dg-pw','Correct-Horse-91'); await type(p,'#dg-pw2','Correct-Horse-91');
 const t0=Date.now(); await p.evaluate(()=>document.getElementById('dg-create-go').click()); await waitStatus(p,'success|error',60000);
 check('create: 2048-bit ID generated', !(await p.$eval('#dg-created',e=>e.hidden)), (Date.now()-t0)+'ms');
 await p.evaluate(()=>document.getElementById('dg-dl-pfx').click()); d=await dl(); fs.writeFileSync('/tmp/mine.pfx',d[0].buf);
 await p.evaluate(()=>document.getElementById('dg-dl-cer').click()); d=await dl(); fs.writeFileSync('/tmp/mine.cer',d[0].buf);
 { const info=sh('openssl pkcs12 -in /tmp/mine.pfx -passin pass:Correct-Horse-91 -nokeys -info 2>&1');
   check('create: .pfx opens in OpenSSL with AES-256 key protection', /AES-256-CBC/.test(info)&&/Alex Tester/.test(info), info.split('\n').filter(l=>/Shrouded|subject/.test(l)).join('|').slice(0,160));
   check('create: .pfx rejects wrong password (OpenSSL)', /invalid|error|Mac verify/i.test(sh('openssl pkcs12 -in /tmp/mine.pfx -passin pass:nope -nokeys 2>&1')));
   const c=sh('openssl x509 -inform DER -in /tmp/mine.cer -noout -text');
   check('create: cert is RSA-2048, signing key usage, document-signing EKU', /2048 bit/.test(c)&&/Digital Signature, Non Repudiation/.test(c)&&/1\.3\.6\.1\.5\.5\.7\.3\.36|Document Signing/i.test(c)&&/CA:FALSE/.test(c));
   execSync('openssl x509 -inform DER -in /tmp/mine.cer -out /tmp/mine.pem'); }

 // ================= DIGITAL ID: sign with the new ID =================
 await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=sign]').click()); await sleep(200); await seg(p,'dg-modes','sign'); await sleep(150);
 await openDoc('a.pdf','finish');
 check('sign: created ID loaded', (await txt(p,'#dg-id-who')).startsWith('Alex Tester'));
 await type(p,'#dg-reason','I approve this document'); await type(p,'#dg-location','Springfield, IL');
 await p.evaluate(()=>document.getElementById('dg-sign-go').click()); d=await dl(); fs.writeFileSync('signed.pdf',d[0].buf);
 { const v=JSON.parse(sh('python3 sigtool.py validate signed.pdf /tmp/mine.pem'))[0]||{};
   check('sign: pyHanko says intact + valid + trusted, whole file covered', v.intact&&v.valid&&v.trusted&&/ENTIRE_FILE/.test(v.coverage), JSON.stringify(v));
   const pv=sh(`python3 -c "
import re; b=open('signed.pdf','rb').read(); br=[int(x) for x in re.search(rb'/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)',b).groups()]
open('/tmp/sd.bin','wb').write(b[br[0]:br[1]]+b[br[2]:br[2]+br[3]]); h=b[br[1]+1:br[2]-1].rstrip(b'0'); h=h+b'0'*(len(h)%2); open('/tmp/sig.der','wb').write(bytes.fromhex(h.decode()))"; openssl cms -verify -binary -inform DER -in /tmp/sig.der -content /tmp/sd.bin -CAfile /tmp/mine.pem -purpose any -out /dev/null 2>&1`);
   check('sign: OpenSSL CMS verification succeeds', /Verification successful/.test(pv), pv.trim().slice(0,80));
   check('sign: visible signature block drawn', sh('pdftotext -f 3 -l 3 signed.pdf -').includes('Digitally signed by Alex Tester'));
   check('sign: output passes qpdf', /No syntax/.test(sh('qpdf --check signed.pdf'))); }

 // ================= DIGITAL ID: sign with an OpenSSL-made .pfx =================
 await upload(p,'#dg-pfx-input',FX('openssl.pfx')); await sleep(200);
 await type(p,'#dg-pfx-pw','wrong-one'); await p.evaluate(()=>document.getElementById('dg-pfx-open').click()); { const s=await statusOf(p); check('pfx: wrong password message', /doesn't unlock/.test(s.text)); }
 await type(p,'#dg-pfx-pw','ossl-pass-1'); await p.evaluate(()=>document.getElementById('dg-pfx-open').click()); await sleep(300);
 check('pfx: OpenSSL 3 .pfx (AES-256/PBKDF2) unlocks', (await txt(p,'#dg-id-who')).startsWith('External Signer'));
 await openDoc('form.pdf','finish');
 await p.click('#dg-visible'); await p.evaluate(()=>document.getElementById('dg-sign-go').click()); d=await dl(); fs.writeFileSync('signed2.pdf',d[0].buf);
 { const v=JSON.parse(sh('python3 sigtool.py validate signed2.pdf /tmp/ext.crt'))[0]||{}; check('pfx: invisible signature on a form PDF validates in pyHanko', v.intact&&v.valid&&v.trusted, JSON.stringify(v).slice(0,120)); }

 // ================= DIGITAL ID: verify =================
 await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=sign]').click()); await sleep(200); await seg(p,'dg-modes','verify'); await sleep(150);
 const verify=async f=>{ await p.$eval('#dgv-results',e=>e.innerHTML=''); await upload(p,'#dgv-input',typeof f==='string'&&f.startsWith('/')?f:FX(f)); await p.waitForFunction(()=>document.querySelectorAll('#dgv-results .vres').length>0,{timeout:15000}); return p.$$eval('#dgv-results .vres',rs=>rs.map(r=>({cls:r.className,head:(r.querySelector('.vhead')||r).textContent,body:r.textContent})));};
 let r=await verify(H.path.resolve('signed.pdf'));
 check('verify: our signature green', /good/.test(r[0].cls) && /Alex Tester/.test(r[0].body) && /Self-signed/.test(r[0].body), r[0].head);
 check('verify: shows fingerprint and reason', /SHA-256 fingerprint/.test(r[0].body) && /I approve this document/.test(r[0].body));
 r=await verify('pyhanko-signed.pdf');
 check('verify: pyHanko-signed PDF green, signer read', /good/.test(r[0].cls) && /External Signer/.test(r[0].body), r[0].head);
 { const buf=fs.readFileSync('signed.pdf'); buf[12]=buf[12]^1; fs.writeFileSync('/tmp/tampered.pdf',buf); }
 r=await verify('/tmp/tampered.pdf'); check('verify: 1 flipped byte -> red', /bad/.test(r[0].cls), r[0].head);
 { const buf=fs.readFileSync('signed.pdf'); const i=buf.indexOf('/MediaBox [ 0 0 612 792 ]'); buf.write('/MediaBox [ 0 0 612 700 ]',i); fs.writeFileSync('/tmp/tampered2.pdf',buf); check('verify: tamper target found', i>0); }
 r=await verify('/tmp/tampered2.pdf'); check('verify: page size edited after signing -> red', /bad/.test(r[0].cls), r[0].head);
 fs.writeFileSync('/tmp/appended.pdf', Buffer.concat([fs.readFileSync('signed.pdf'), Buffer.from('\n% appended after signing\n')]));
 r=await verify('/tmp/appended.pdf'); check('verify: content appended after signing -> amber', /warn/.test(r[0].cls) && /after/.test(r[0].head), r[0].head);
 { // second signature added by pyHanko on top of ours: both should be reported
   execSync('python3 sigtool.py sign signed.pdf /tmp/twosig.pdf /tmp/ext.key /tmp/ext.crt'); r=await verify('/tmp/twosig.pdf');
   check('verify: two signatures listed; first amber (later revision), second green', r.length===2 && /warn/.test(r[0].cls) && /good/.test(r[1].cls), r.map(x=>x.cls).join(',')); }
 r=await verify('a.pdf'); check('verify: unsigned file says so', /no digital signatures/.test(r[0].body));
 // signed file: rail warning + signing blocked
 { await p.evaluate(()=>document.querySelector('#fin-modes .segbtn[data-mode=sign]').click()); await sleep(200); await seg(p,'dg-modes','sign'); await openDoc(H.path.resolve('signed.pdf'),'finish');
   check('sign: re-signing a signed PDF is blocked', /already has a digital signature/.test(await txt(p,'#dg-sign-msg')) && await p.$eval('#dg-sign-go',b=>b.disabled));
   check('rail: signed-file warning shown', /Digitally signed/.test(await txt(p,'#rail-file'))); }

 // ---- the bar says whether a signature still holds, without digging ----
 { const barState=async(file)=>{ await openDoc(file); await p.waitForFunction(()=>{const e=document.getElementById('docbar-sig'); return !e.hidden && !/checking/.test(e.textContent);},{timeout:30000}).catch(()=>{});
     return p.evaluate(()=>{const e=document.getElementById('docbar-sig'); return {hidden:e.hidden, cls:e.className, text:e.textContent};}); };
   let st=await barState('pyhanko-signed.pdf');
   check('signed file: bar reports a valid signature', /sig-ok/.test(st.cls) && /valid/i.test(st.text), st.text.slice(0,70));
   st=await barState(H.path.resolve('/tmp/tampered2.pdf'));
   check('signed file: bar reports a broken signature in red', /sig-bad/.test(st.cls) && /broken/i.test(st.text), st.text.slice(0,70));
   st=await barState(H.path.resolve('/tmp/appended.pdf'));
   check('signed file: bar flags content added after signing', /sig-warn/.test(st.cls) && /changed after signing/i.test(st.text), st.text.slice(0,70));
   await openDoc('a.pdf');
   check('unsigned file: no signature notice', await p.$eval('#docbar-sig',e=>e.hidden));
   // editing a signed document must flip the bar to broken
   await openDoc('pyhanko-signed.pdf','document');
   await p.evaluate(()=>document.querySelector('#edit-modes .segbtn[data-emode=doc]').click()); await sleep(300);
   await p.evaluate(()=>document.getElementById('pn-on').click()); await sleep(400);
   await H.applyStep(p,'#edit-go'); await sleep(2500);
   await p.waitForFunction(()=>{const e=document.getElementById('docbar-sig'); return !e.hidden && !/checking/.test(e.textContent);},{timeout:30000}).catch(()=>{});
   const after=await p.evaluate(()=>document.getElementById('docbar-sig').className);
   check('editing a signed document immediately shows the signature is no longer valid', /sig-bad|sig-warn/.test(after), after); }

 // ================= OPTIMIZE: OCR =================
 await openDoc('scan.pdf','prepare'); await seg(p,'prep-modes','ocr'); await sleep(400);
 await p.evaluate(()=>{window.__dl=[];});   // drop anything left in the capture queue
 const o0=Date.now(); const ocrClick=p.evaluate(()=>document.getElementById('ocr-go').click());
 const sawProgress=await p.waitForFunction(()=>!document.getElementById('opt-progress').hidden && /page \d of \d/i.test(document.getElementById('opt-ptext').textContent),{timeout:20000}).then(()=>true).catch(()=>false);
 check('ocr: live "page X of Y" progress', sawProgress);
 await ocrClick; await p.waitForFunction(()=>(document.getElementById('docbar').dataset.steps||'0')!=='0',{timeout:180000}); await H.downloadDoc(p);
 d=await dl(); fs.writeFileSync('ocr.pdf',d[0].buf); const oms=Date.now()-o0;
 { const t=sh('pdftotext ocr.pdf -');
   check('ocr: page 1 text recognized', t.includes('Hartwell Lake Science Center') && t.includes('Jordan Smith'), JSON.stringify(t.slice(0,120)));
   check('ocr: page 2 text recognized', t.includes('Page two says hello world'), oms+'ms total');
   const bb=f=>{ const x=sh(`pdftotext -f 1 -l 1 -bbox ${f} -`); const m=x.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Hartwell<\/word>/); return m?m.slice(1).map(Number):null; };
   const src=bb('/tmp/src.pdf'), got=bb('ocr.pdf');
   const err=src&&got?Math.max(...src.map((v,i)=>Math.abs(v-got[i]))):999;
   check('ocr: invisible word box lines up with the scanned word (within 1.5pt)', err<1.5, `source ${src} ocr ${got} maxErr ${err.toFixed?err.toFixed(1):err}`);
   const a=H.renderPage('fx/scan.pdf',1,40), bq=H.renderPage('ocr.pdf',1,40); let diff=0; for(let i=0;i<a.data.length;i++) diff+=Math.abs(a.data[i]-bq.data[i]);
   check('ocr: page looks identical (text layer invisible)', diff===0, 'pixel diff '+diff); }
 // Spanish model (local build only)
 { const langs=await p.$$eval('#ocr-lang option',os=>os.map(o=>o.value+':'+o.textContent));
   check('ocr: language menu lists embedded models', langs.join('|')==='eng:English|spa:Spanish|eng+spa:English + Spanish', langs.join('|')); }
 await openDoc('scan-spa.pdf','prepare');
 await p.select('#ocr-lang','spa'); await H.applyAndDownload(p,'#ocr-go'); d=await dl(); fs.writeFileSync('ocr-spa.pdf',d[0].buf);
 { const t=sh('pdftotext ocr-spa.pdf -');
   check('ocr: Spanish recognized, accented characters preserved in the text layer', /Autorización para la excursión/.test(t) && /María González Peña/.test(t) && /miércoles/.test(t), JSON.stringify(t.slice(0,130))); }
 await openDoc('a.pdf','prepare'); await seg(p,'prep-modes','ocr'); await sleep(200); await p.evaluate(()=>document.getElementById('ocr-go').click()); { const s=await waitStatus(p,'info|success|error',30000); check('ocr: pages with text skipped, nothing saved', /already has text/.test(s.text) && (await p.evaluate(()=>window.__dl.length))===0, s.text.slice(0,80)); }

 // ================= OPTIMIZE: compress =================
 await openDoc('photo.pdf','prepare'); await seg(p,'prep-modes','compress'); await sleep(400);
 await H.applyAndDownload(p,'#cmp-go'); d=await dl(); fs.writeFileSync('cmp150.pdf',d[0].buf);
 const badge=await txt(p,'#cmp-badge');
 const orig=fs.statSync(FX('photo.pdf')).size, c150=d[0].buf.length;
 check('compress 150 DPI: meaningfully smaller + badge', c150<orig*0.6 && /Reduced from .* to .*\[\u2212\d+%\]/.test(badge), badge);
 check('compress: output valid (qpdf)', /No syntax/.test(sh('qpdf --check cmp150.pdf')));
 { const t=sh('pdftotext cmp150.pdf -'); check('compress: text untouched', t.includes('Photo page: text must stay sharp') && t.includes('Transparent image'));
   const im=sh('pdfimages -list cmp150.pdf'); check('compress: photo downsampled to <=1650px, transparency mask kept', /1650\s+1238\s+rgb/.test(im) && /smask/.test(im), im.split('\n').slice(2).join(' | ').replace(/\s+/g,' ').slice(0,220));
   const a=H.renderPage(FX('photo.pdf'),2,30), c=H.renderPage('cmp150.pdf',2,30); let dsum=0; for(let i=0;i<a.data.length;i+=4) dsum+=Math.abs(a.data[i]-c.data[i])+Math.abs(a.data[i+1]-c.data[i+1])+Math.abs(a.data[i+2]-c.data[i+2]);
   check('compress: transparent image still composites correctly', dsum/(a.data.length/4)<6, 'mean diff '+(dsum/(a.data.length/4)).toFixed(2)); }
 await p.click('input[name=cmp-dpi][value="72"]'); await p.$eval('#cmp-q',e=>{e.value=40;e.dispatchEvent(new Event('input'));}); await H.applyAndDownload(p,'#cmp-go'); d=await dl();
 check('compress 72 DPI / q40 smaller still', d[0].buf.length<c150, `${orig} -> 150dpi ${c150} -> 72dpi ${d[0].buf.length}`);
 await openDoc('a.pdf','prepare'); await p.evaluate(()=>document.getElementById('cmp-go').click()); { const s=await waitStatus(p,'info|success|error',30000); check('compress: already-small file reported, nothing saved', /couldn't be made meaningfully smaller/.test(s.text) && /Already compact/.test(await txt(p,'#cmp-badge'))); }
 check('compress: progress hidden when done', await p.$eval('#opt-progress',e=>e.hidden));

 // ================= global =================
 await p.click('#clear-all'); await p.click('#clear-all'); await sleep(300); await tool(p,'finish');
 check('clear: digital ID forgotten', await p.$eval('#dg-id-card',e=>e.hidden));
 const csp=await p.evaluate(()=>window.__csp);
 check('strict CSP (+wasm only): zero violations through OCR/PKI/crypto', csp.length===0, csp.join(' | '));
 check('zero network requests', ext.length===0, ext.join(' '));
 check('no script errors', errors.length===0, errors.join(' | ').slice(0,300));
 await p.close(); await b.close(); H.summary();
})().catch(e=>{console.log('SUITE ERROR',e.stack);process.exit(1)});
