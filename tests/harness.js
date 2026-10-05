const chromium=require('@sparticuz/chromium'); const puppeteer=require('puppeteer-core');
const fs=require('fs'); const path=require('path'); const {execSync}=require('child_process'); const {PNG}=require('pngjs');
const FX=p=>path.resolve(__dirname,'fx',p);
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
async function launch(){ return puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||await chromium.executablePath(),args:chromium.args,headless:true,protocolTimeout:240000}); }
async function newPage(b, file, mobile){
  const p=await b.newPage();
  if(mobile) await p.emulate(puppeteer.KnownDevices['iPhone 13']); else await p.setViewport({width:1280,height:900});
  const ext=[], errors=[], logs=[];
  p.on('request',r=>{const u=r.url(); if(!/^(file|data|blob):/.test(u)) ext.push(u);});
  p.on('console',m=>{ logs.push(m.type()+': '+m.text().slice(0,200)); if(m.type()==='error') errors.push(m.text().slice(0,200)); });
  p.on('pageerror',e=>errors.push('pageerror: '+String(e.message).slice(0,200)));
  p.on('dialog',async d=>{errors.push('dialog: '+d.message()); await d.dismiss();});
  await p.evaluateOnNewDocument(HOOK);
  await p.goto('file://'+file,{waitUntil:'load'});
  await sleep(400);
  return {p,ext,errors,logs};
}
async function takeDownloads(p,n,timeout=15000){
  await p.waitForFunction(n=>window.__dl.length>=n,{timeout},n);
  const d=await p.evaluate(()=>{const x=window.__dl; window.__dl=[]; return x;});
  return d.map(x=>({name:x.name, buf:Buffer.from(x.data.split(',')[1],'base64')}));
}
const txt=(p,sel)=>p.$eval(sel,e=>e.textContent);
// Tools now apply their change to the open document; the doc bar downloads it.
async function applyStep(p, sel, timeout=180000){
  // A tool either adds a step to the working document or replaces it (merge, unlock),
  // so wait for whichever signal arrives: a step count change or a finished status.
  const before=await p.evaluate(()=>{const st=document.querySelector('.panel.active .status');
    return {steps:document.getElementById('docbar').dataset.steps||'0', status:st?st.textContent:''};});
  await p.evaluate(s=>document.querySelector(s).click(), sel);
  await p.waitForFunction(b=>{
    const d=document.getElementById('docbar'), st=document.querySelector('.panel.active .status');
    if ((d.dataset.steps||'0')!==b.steps) return true;
    return st && st.textContent && st.textContent!==b.status && /success|error/.test(st.className);
  },{timeout},before);
}
async function downloadDoc(p){ await p.evaluate(()=>document.getElementById('docbar-dl').click()); }
async function applyAndDownload(p, sel, timeout){ await applyStep(p, sel, timeout); await downloadDoc(p); }
const upload=async(p,sel,...files)=>{const h=await p.$(sel); await h.uploadFile(...files);};
const tool=(p,name)=>p.click(`.rail-btn[data-tool=${name}]`);
function renderPage(pdfPath,page,dpi=50){ const pre=path.join(__dirname,'rp'); execSync(`pdftoppm -f ${page} -l ${page} -singlefile -r ${dpi} -png "${pdfPath}" "${pre}"`); return PNG.sync.read(fs.readFileSync(pre+'.png')); }
function inkBox(img,pred){ let n=0,x0=1e9,y0=1e9,x1=-1,y1=-1; for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const i=(y*img.width+x)*4; if(pred(img.data[i],img.data[i+1],img.data[i+2])){n++; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;}} return {n,x0:x0/img.width,y0:y0/img.height,x1:(x1+1)/img.width,y1:(y1+1)/img.height}; }
// BRAND=plain runs the same suites against the unbranded build, which is the same code
const STORAGE_KEY = 'pdf-tool-kit:signature';
const LOCAL=path.resolve(__dirname,'../index.html'), PUB=LOCAL;
function summary(){ const f=results.filter(r=>!r.ok); console.log(`\n${results.length-f.length}/${results.length} passed`); }
module.exports={applyStep,downloadDoc,applyAndDownload,puppeteer,fs,path,execSync,PNG,FX,check,sleep,launch,newPage,takeDownloads,txt,upload,tool,renderPage,inkBox,LOCAL,PUB,STORAGE_KEY,summary,results};
