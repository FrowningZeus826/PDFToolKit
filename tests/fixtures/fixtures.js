const {PDFDocument, degrees, rgb, StandardFonts}=require('pdf-lib'); const fs=require('fs');
(async()=>{
  const a=await PDFDocument.create(); const f=await a.embedFont(StandardFonts.Helvetica);
  const p1=a.addPage([612,792]); p1.drawText('Page 1 portrait',{x:50,y:700,size:30,font:f}); p1.drawRectangle({x:50,y:50,width:100,height:100,color:rgb(0,0.5,0)});
  const p2=a.addPage([792,612]); p2.drawText('Page 2 rotated',{x:50,y:500,size:30,font:f}); p2.setRotation(degrees(90));
  const p3=a.addPage([612,792]); p3.drawText('Page 3 offset box',{x:150,y:600,size:30,font:f}); p3.setMediaBox(100,50,512,742);
  fs.writeFileSync('fx/a.pdf', await a.save());
  const b=await PDFDocument.create(); for(let i=0;i<2;i++){const p=b.addPage(); p.drawText('B'+(i+1),{x:50,y:700,size:40,font:f});}
  fs.writeFileSync('fx/b.pdf', await b.save());
  fs.writeFileSync('fx/garbage.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000, 0x41)]));
  fs.writeFileSync('fx/notpdf.pdf', 'hello world, I am not a pdf');
  fs.writeFileSync('fx/<img src=x onerror=alert(1)>.pdf', await b.save());
  // header after junk (spec allows first 1024 bytes)
  fs.writeFileSync('fx/junkprefix.pdf', Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from(await b.save())]));
})();
