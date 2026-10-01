const {PDFDocument, degrees, rgb, StandardFonts, PDFName, PDFString}=require('pdf-lib'); const fs=require('fs');
(async()=>{
  // b.pdf again, with its own font this time
  const b=await PDFDocument.create(); const fb=await b.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<2;i++){const p=b.addPage(); p.drawText('B'+(i+1),{x:50,y:700,size:40,font:fb});}
  fs.writeFileSync('fx/b.pdf', await b.save());
  // form.pdf
  const d=await PDFDocument.create(); const f=await d.embedFont(StandardFonts.Helvetica);
  const p1=d.addPage([612,792]); const form=d.getForm();
  p1.drawText('Enrollment form',{x:50,y:740,size:20,font:f});
  const name=form.createTextField('student_name'); name.acroField.dict.set(PDFName.of('TU'), PDFString.of('Student name'));
  name.addToPage(p1,{x:150,y:680,width:300,height:22});
  const cons=form.createCheckBox('consent'); cons.addToPage(p1,{x:150,y:640,width:16,height:16});
  const grade=form.createRadioGroup('grade'); grade.addOptionToPage('K',p1,{x:150,y:600,width:14,height:14}); grade.addOptionToPage('1',p1,{x:200,y:600,width:14,height:14}); grade.addOptionToPage('2',p1,{x:250,y:600,width:14,height:14});
  const school=form.createDropdown('school'); school.addOptions(['North Elementary','South Elementary','Central High']); school.addToPage(p1,{x:150,y:550,width:200,height:22});
  const p2=d.addPage([792,612]); p2.setRotation(degrees(90));
  const dt=form.createTextField('sign_date'); dt.addToPage(p2,{x:100,y:400,width:180,height:24});
  fs.writeFileSync('fx/form.pdf', await d.save());
  // symbol.pdf: non-embedded standard fonts
  const s=await PDFDocument.create(); const ps=s.addPage([612,792]);
  const sym=await s.embedFont(StandardFonts.Symbol), zd=await s.embedFont(StandardFonts.ZapfDingbats), tr=await s.embedFont(StandardFonts.TimesRoman);
  ps.drawText('\u03b1\u03b2\u03b3 \u03a3 \u221e',{x:50,y:700,size:48,font:sym});
  ps.drawText('\u2713 \u2714 \u2717',{x:50,y:600,size:48,font:zd});
  ps.drawText('Times Roman text',{x:50,y:500,size:36,font:tr});
  fs.writeFileSync('fx/symbol.pdf', await s.save());
  console.log('ok');
})().catch(e=>console.log('ERR',e.message));
