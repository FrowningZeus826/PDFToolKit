#!/usr/bin/env bash
# Builds every test fixture. Run once from the tests/ directory:  bash fixtures/make-fixtures.sh
# Needs: node (with tests/node_modules installed), qpdf, poppler-utils, openssl,
#        python3 with pikepdf + pillow + pyhanko.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p fx

echo "==> base PDFs (pages, rotation, offset boxes, forms, symbols, hostile input)"
node fixtures/fixtures.js
node fixtures/fixtures2.js

echo "==> scans for OCR (English + Spanish) and a photo-heavy PDF for the compressor"
node fixtures/mkscan.js
node fixtures/mkspa.js
node fixtures/mkphoto.js

echo "==> photos, for adding images as pages in Merge"
python3 - <<'PY'
from PIL import Image, ImageDraw
for name,(w,h),color in [('form-photo.jpg',(1200,1600),(250,248,240)),('wide-photo.png',(1600,900),(235,245,255))]:
    im=Image.new('RGB',(w,h),color); d=ImageDraw.Draw(im)
    d.rectangle([60,60,w-60,h-60],outline=(30,30,30),width=6)
    d.rectangle([int(w*0.2),int(h*0.35),int(w*0.8),int(h*0.5)],fill=(20,60,160))
    im.save('fx/'+name, quality=88)
PY

echo "==> encrypted PDFs: every revision of the standard security handler"
qpdf --encrypt user owner 256 -- fx/b.pdf fx/encrypted.pdf
qpdf --encrypt "" owner 256 -- fx/a.pdf fx/owner-only.pdf
qpdf --object-streams=generate --encrypt user owner 256 -- fx/form.pdf fx/aes256-objstm.pdf
qpdf --allow-weak-crypto --encrypt user owner 128 --use-aes=y -- fx/a.pdf fx/aes128.pdf
qpdf --allow-weak-crypto --encrypt user owner 128 --use-aes=n -- fx/a.pdf fx/rc4.pdf
qpdf --encrypt user2 owner2 256 --print=none --extract=n -- fx/a.pdf fx/restr-r6.pdf
qpdf --allow-weak-crypto --encrypt u4 o4 128 --use-aes=y --print=none -- fx/a.pdf fx/restr-r4.pdf
qpdf --allow-weak-crypto --encrypt u3 o3 128 --use-aes=n --print=none -- fx/a.pdf fx/restr-r3.pdf
qpdf --allow-weak-crypto --encrypt u2 o2 40 --print=n -- fx/a.pdf fx/restr-r2.pdf

echo "==> metadata-laden PDF with a hidden earlier revision"
python3 - <<'PY'
import pikepdf, re
from pikepdf import Name, String, Dictionary, Array
pdf = pikepdf.open('fx/a.pdf')
with pdf.open_metadata(set_pikepdf_as_editor=False) as m:
    m['dc:title']='Secret XMP Title'; m['dc:creator']=['Jane Secret']; m['xmp:CreatorTool']='SecretTool 9'
pdf.docinfo['/Title']='Original Secret Title'; pdf.docinfo['/Author']='Jane Secret'
pdf.docinfo['/Keywords']='secret, grades'; pdf.docinfo['/Creator']='SecretWriter'; pdf.docinfo['/Producer']='SecretProducer'
pdf.pages[0].obj['/PieceInfo']=Dictionary(Illustrator=Dictionary(Private=String('secret-private-data')))
pdf.Root.OpenAction=pdf.make_indirect(Dictionary(S=Name.JavaScript, JS=String('app.alert("secret js")')))
pdf.attachments['grades.csv']=pikepdf.AttachedFileSpec(pdf, b'name,grade\nSecret Student,A', mime_type='text/csv')
annot=pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Text, Rect=Array([100,100,120,120]),
                                   T=String('Principal Secret'), Contents=String('looks good')))
pdf.pages[0].obj['/Annots']=Array([annot])
pdf.save('/tmp/meta-base.pdf', object_stream_mode=pikepdf.ObjectStreamMode.disable)
b=open('/tmp/meta-base.pdf','rb').read()
sx=int(re.findall(rb'startxref\s+(\d+)', b)[-1])
p2=pikepdf.open('/tmp/meta-base.pdf'); size=int(p2.trailer.Size); root=p2.Root.objgen; idv=p2.trailer.ID
id0,id1=bytes(idv[0]).hex(), bytes(idv[1]).hex()
off=len(b)+1
obj=f"{size} 0 obj\n<< /Title (Revised Title) /Author (Jane Secret) >>\nendobj\n".encode()
xref_off=off+len(obj)
upd=b"\n"+obj+(f"xref\n{size} 1\n{off:010d} 00000 n \ntrailer\n<< /Size {size+1} /Root {root[0]} {root[1]} R "
                f"/Info {size} 0 R /Prev {sx} /ID [<{id0}><{id1}>] >>\nstartxref\n{xref_off}\n%%EOF\n").encode()
open('fx/meta.pdf','wb').write(b+upd)
print('   meta.pdf: visible title is "Revised Title"; "Original Secret Title" is still hidden inside')
PY

echo "==> signing material: an OpenSSL .pfx and a PDF signed by pyHanko"
openssl req -x509 -newkey rsa:2048 -nodes -keyout fx/ext.key -out fx/ext.crt -days 30 \
  -subj "/CN=External Signer/O=pyHanko Test" 2>/dev/null
openssl pkcs12 -export -inkey fx/ext.key -in fx/ext.crt -out fx/openssl.pfx -passout pass:ossl-pass-1
python3 sigtool.py sign fx/b.pdf fx/pyhanko-signed.pdf fx/ext.key fx/ext.crt

# the suites sign with this pair from /tmp; keep the copies in step with the fixtures,
# or a stale half silently fails signature trust checks
cp fx/ext.key fx/ext.crt /tmp/

echo
echo "Fixtures built in tests/fx. Next: npm test"
