const {PDFDocument, StandardFonts, rgb}=require('pdf-lib'); const fs=require('fs'); const {execSync}=require('child_process');
(async()=>{
  const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.TimesRoman);
  const lines=['Northfield Unit 5','Field Trip Permission Form','Student name: Jordan Smith','Destination: Hartwell Lake Science Center','Please return this form by Friday, October 2.'];
  const p=d.addPage([612,792]); lines.forEach((l,i)=>p.drawText(l,{x:72,y:700-i*40,size:i<2?22:16,font:f}));
  const p2=d.addPage([612,792]); p2.drawText('Page two says hello world',{x:72,y:700,size:18,font:f});
  fs.writeFileSync('/tmp/src.pdf', await d.save());
  execSync('pdftoppm -r 150 -gray -png /tmp/src.pdf /tmp/scan');
  const s=await PDFDocument.create();
  for (const n of ['1','2']) { const img=await s.embedPng(fs.readFileSync(`/tmp/scan-${n}.png`)); const pg=s.addPage([612,792]); pg.drawImage(img,{x:0,y:0,width:612,height:792}); }
  fs.writeFileSync('fx/scan.pdf', await s.save());
  console.log('scan.pdf', fs.statSync('fx/scan.pdf').size, 'text in scan:', JSON.stringify(execSync('pdftotext fx/scan.pdf -').toString().trim()));
})();
