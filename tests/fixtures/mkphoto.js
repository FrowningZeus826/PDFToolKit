const {PDFDocument,StandardFonts}=require('pdf-lib'); const fs=require('fs');
(async()=>{ const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
 const jpg=await d.embedJpg(fs.readFileSync('fx/photo-src.jpg')); const png=await d.embedPng(fs.readFileSync('fx/alpha-src.png'));
 const p1=d.addPage([612,792]); p1.drawImage(jpg,{x:36,y:300,width:540,height:405}); p1.drawText('Photo page: text must stay sharp',{x:36,y:260,size:16,font:f});
 const p2=d.addPage([612,792]); p2.drawRectangle({x:0,y:0,width:612,height:792,color:{type:'RGB',red:0.9,green:0.9,blue:1}}); p2.drawImage(png,{x:106,y:196,width:400,height:400}); p2.drawText('Transparent image over a colored page',{x:36,y:100,size:16,font:f});
 fs.writeFileSync('fx/photo.pdf', await d.save()); console.log('photo.pdf', (fs.statSync('fx/photo.pdf').size/1e6).toFixed(2),'MB'); })();
