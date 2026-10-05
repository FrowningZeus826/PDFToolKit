# Fixtures that look like real office output: embedded subset fonts, kerned runs, a table,
# and text inside a form XObject — cases that generated-by-one-library PDFs don't cover.
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import inch

pdfmetrics.registerFont(TTFont('Lib', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LibBold', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'))

c = canvas.Canvas('fx/quote.pdf', pagesize=letter)
# A logo placed with its own transform inside q/Q — exactly what a real vendor quote does,
# and what broke position tracking until the transform was saved and restored properly.
c.drawImage('fx/logo.png', 0.6*inch, 9.7*inch, width=1.9*inch, height=0.63*inch)
c.setFont('LibBold', 20); c.drawString(1*inch, 10*inch, 'Harbour Supply Co')
c.setFont('Lib', 11)
for i, line in enumerate(['Quote #Q57659', 'Date: 2/23/2023', 'Bill To: Dana Whitfield',
                          'Northfield Unit 5', 'Springfield, IL 62704']):
    c.drawString(1*inch, (9.6 - i*0.2)*inch, line)
rows = [('AA250-NA', '6x10 POLYESTER U.S. FLAG', '1', '156.99'),
        ('AD630-SC', '3x5 NYLON SOUTH CAROLINA FLAG', '10', '43.25'),
        ('AA140', '3x5 NYLON US FLAG', '10', '76.50')]
y = 8.0*inch
c.setFont('LibBold', 10)
for i, h in enumerate(['Item', 'Description', 'Qty', 'Rate']):
    c.drawString((1+i*1.7)*inch, y, h)
c.setFont('Lib', 10)
for r in rows:
    y -= 0.25*inch
    for i, cell in enumerate(r):
        c.drawString((1+i*1.7)*inch, y, cell)
c.setFont('LibBold', 12)
c.drawRightString(7.5*inch, y-0.6*inch, 'Total: $1,486.70')
t = c.beginText(1*inch, 5.5*inch); t.setFont('Lib', 11); t.setCharSpace(0.4)
t.textLine('Please return this signed quote to your account representative.')
c.drawText(t)
c.beginForm('block')
c.setFont('Lib', 10)
c.drawString(1*inch, 4.9*inch, 'Terms: Net 30 days from invoice date.')
c.endForm()
c.doForm('block')
c.showPage(); c.save()
print('wrote fx/quote.pdf')


# A plain letter: genuine multi-line paragraphs, the main case for editing text.
c = canvas.Canvas('fx/letter.pdf', pagesize=letter)
t = c.beginText(1*inch, 9.5*inch); t.setFont('Lib', 11); t.setLeading(13.2)
for line in ["Dear Parent or Guardian,", "",
             "Northfield Unit 5 will hold its annual technology night on Thursday,",
             "October 9 at the main office. Staff will demonstrate the tools students use",
             "each day, answer questions about device care, and collect signed permission",
             "forms for the coming semester.", "",
             "Please return the attached form by Friday, October 3.", "",
             "Sincerely,", "Alex Tester", "Systems Administrator"]:
    t.textLine(line)
c.drawText(t); c.showPage(); c.save()
print('wrote fx/letter.pdf')


# A page drawn under a scaling transform: tiny font sizes with a large CTM, which is how
# Word, Acrobat and several report writers lay pages out.
c = canvas.Canvas('fx/scaled.pdf', pagesize=letter)
c.saveState(); c.scale(12, 12)
t = c.beginText(6, 60); t.setFont('Lib', 11.0/12); t.setLeading(13.2/12)
for line in ["Scaled page: this text is drawn under a 12x transform,",
             "with a font size of about 0.9 units instead of 11 points.",
             "An editor that ignores the transform will get this wrong."]:
    t.textLine(line)
c.drawText(t); c.restoreState()
c.setFont('Lib', 11); c.drawString(1*inch, 3*inch, 'Normal text drawn without any transform.')
c.showPage(); c.save()
print('wrote fx/scaled.pdf')


# A Type 3 font: glyphs are drawn by little programs and the font carries its own matrix,
# so the number after "Tf" is not the size on the page. Sizing must come from the resolved
# text item, not from reading that number.
import pikepdf
from pikepdf import Name, Dictionary, Array, Page
_p = pikepdf.new()
_proc = _p.make_stream(b"1000 0 0 0 750 750 d1 0 0 750 750 re f")
_t3 = _p.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type3,
    FontBBox=Array([0,0,750,750]), FontMatrix=Array([0.001,0,0,0.001,0,0]),
    CharProcs=Dictionary(square=_proc),
    Encoding=Dictionary(Type=Name.Encoding, Differences=Array([97, Name('/square')])),
    FirstChar=97, LastChar=97, Widths=Array([1000])))
_f1 = _p.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica))
_content = _p.make_stream(b"BT /T3 24 Tf 1 0 0 1 72 700 Tm (aaa) Tj ET\n"
                          b"BT /F1 12 Tf 1 0 0 1 72 650 Tm (Normal 12pt text for comparison) Tj ET")
_p.pages.append(Page(_p.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(T3=_t3, F1=_f1)), Contents=_content))))
_p.save('fx/type3.pdf')
print('wrote fx/type3.pdf')


# A page as a browser prints it: a flipped page transform that is never closed, a nested
# scale, and each line drawn with its own flipped matrix. Anything appended to such a page
# inherits that transform unless it is explicitly undone.
_bp = pikepdf.new()
_f1 = _bp.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica))
_body = [b".24 0 0 -.24 0 792 cm", b"q 3.0889158 0 0 3.0889158 118.75 118.75 cm"]
for _x, _y, _size, _txt in [(8, 22, 16, b"Printed from a browser, which opens the page"),
                            (8, 41, 16, b"with a flipped transform it never closes, and"),
                            (8, 60, 16, b"draws every line with its own flipped matrix."),
                            (8, 140, 21, b"A heading further down the page")]:
    _body.append(b"BT /F1 %d Tf 1 0 0 -1 %d %d Tm (%s) Tj ET" % (_size, _x, _y, _txt))
_body.append(b"Q")
_bp.pages.append(Page(_bp.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(F1=_f1)), Contents=_bp.make_stream(b"\n".join(_body))))))
_bp.save('fx/browser-print.pdf')
print('wrote fx/browser-print.pdf')


# One visible line drawn by several show operators: only the first carries a position and
# the rest continue from it. Readers merge these into a single line, so deleting only the
# first operator leaves the rest of the line on the page under any replacement.
_sr = pikepdf.new()
_f1 = _sr.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica))
_fb = _sr.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/Helvetica-Bold')))
_c = _sr.make_stream(
    b"BT /FB 14 Tf 1 0 0 1 72 700 Tm (Check ) Tj (Information ) Tj (Header) Tj ET\n"
    b"BT /F1 11 Tf 1 0 0 1 72 680 Tm (An ordinary line drawn in one go.) Tj ET\n"
    b"BT /F1 11 Tf 1 0 0 1 72 666 Tm (A second ordinary line below it.) Tj ET")
_sr.pages.append(Page(_sr.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(F1=_f1, FB=_fb)), Contents=_c))))
_sr.save('fx/split-runs.pdf')
print('wrote fx/split-runs.pdf')


# An older PDF: the built-in fonts with a named encoding and no ToUnicode table, plus a
# font whose encoding remaps codes by glyph name. Character codes have to come from the
# published encoding tables for text like this to be rewritten in the document's own font.
_ne = pikepdf.new()
_times = _ne.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1,
    BaseFont=Name('/Times-Roman'), Encoding=Name('/MacRomanEncoding')))
_tbold = _ne.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1,
    BaseFont=Name('/Times-Bold'), Encoding=Name('/WinAnsiEncoding')))
_diff = _ne.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica,
    Encoding=Dictionary(Type=Name.Encoding, BaseEncoding=Name('/WinAnsiEncoding'),
                        Differences=Array([65, Name('/bullet'), Name('/Euro')]))))
_nec = _ne.make_stream(
    b"BT /FB 15 Tf 1 0 0 1 72 700 Tm (Older PDF, standard fonts) Tj ET\n"
    b"BT /FT 11 Tf 1 0 0 1 72 676 Tm (No ToUnicode table here, only a named encoding.) Tj ET\n"
    b"BT /FT 11 Tf 1 0 0 1 72 662 Tm (Punctuation and accents: caf\xd0 test.) Tj ET\n"
    b"BT /FD 11 Tf 1 0 0 1 72 630 Tm (AB) Tj ET")
_ne.pages.append(Page(_ne.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(FT=_times, FB=_tbold, FD=_diff)), Contents=_nec))))
_ne.save('fx/named-encoding.pdf')
print('wrote fx/named-encoding.pdf')


# Three pages whose footer is a single reusable block stamped onto each: editing it must
# change every page that draws it, and the tool must say so before the edit is made.
_sf = pikepdf.new()
_sff = _sf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica,
                                    Encoding=Name('/WinAnsiEncoding')))
_foot = _sf.make_stream(b"BT /F1 9 Tf 1 0 0 1 72 60 Tm (Confidential - Northfield Unit 5 - page footer) Tj ET")
_foot.Type = Name.XObject; _foot.Subtype = Name.Form
_foot.BBox = Array([0, 0, 612, 792])
_foot.Resources = Dictionary(Font=Dictionary(F1=_sff))
_fref = _sf.make_indirect(_foot)
for _n in range(1, 4):
    _body = _sf.make_stream(("BT /F1 12 Tf 1 0 0 1 72 700 Tm (Body text on page %d of three.) Tj ET\n/Fx Do" % _n).encode())
    _sf.pages.append(Page(_sf.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
        Resources=Dictionary(Font=Dictionary(F1=_sff), XObject=Dictionary(Fx=_fref)), Contents=_body))))
_sf.save('fx/shared-footer.pdf')
print('wrote fx/shared-footer.pdf')


# A line drawn with horizontal scaling, so what the file says about its size and how it
# appears on the page disagree. The tool refuses to rewrite such text, but must still be
# able to remove it.
_lt = pikepdf.new()
_ltf = _lt.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica,
                                    Encoding=Name('/WinAnsiEncoding')))
_ltc = _lt.make_stream(
    b"BT /F1 12 Tf 1 0 0 1 72 700 Tm (Ordinary line that can be rewritten.) Tj ET\n"
    b"BT /F1 12 Tf 240 Tz 1 0 0 1 72 660 Tm (Stretched line the tool will not rewrite.) Tj ET\n"
    b"BT /F1 12 Tf 100 Tz 1 0 0 1 72 620 Tm (Another ordinary line below it.) Tj ET")
_lt.pages.append(Page(_lt.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(F1=_ltf)), Contents=_ltc))))
_lt.save('fx/locked-text.pdf')
print('wrote fx/locked-text.pdf')


# A page drawn one word at a time, alternating between two identical font resources — how
# several exporters write — with a table row whose columns sit far apart. The words of a
# line must join into one block; the table columns must not.
from reportlab.pdfbase.pdfmetrics import stringWidth
_wr = pikepdf.new()
_wa = _wr.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name('/WinAnsiEncoding')))
_wb = _wr.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name('/WinAnsiEncoding')))
_ops = []
def _words(y, text, size=10):
    x = 72.0
    for i, w in enumerate(text.split(' ')):
        res = b'/FA' if i % 2 == 0 else b'/FB'
        _ops.append(b"BT " + res + (" %d Tf 1 0 0 1 %.2f %.1f Tm (%s) Tj ET" % (size, x, y, w)).encode())
        x += stringWidth(w, 'Helvetica', size) + stringWidth(' ', 'Helvetica', size)
for _n, _line in enumerate(["The quick brown fox jumps over the lazy dog near the river",
                            "and then returns along the bank before the afternoon light",
                            "fades behind the hills at the far end of the valley"]):
    _words(700 - _n * 14, _line)
_ops.append(b"BT /FA 10 Tf 1 0 0 1 72 640 Tm (Widget assembly left side doubled) Tj ET")
_ops.append(b"BT /FA 10 Tf 1 0 0 1 430 640 Tm (16) Tj ET")
_wr.pages.append(Page(_wr.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(FA=_wa, FB=_wb)), Contents=_wr.make_stream(b"\n".join(_ops))))))
_wr.save('fx/word-runs.pdf')
print('wrote fx/word-runs.pdf')

# Written the way Acrobat Distiller 2.x does: a font of size 1 scaled by the text matrix, with
# character and word spacing set per line. The reader reports each word of such a line as a
# piece of its own, but they are all drawn by one show operator and must stay one block. The
# last line is a row whose cells sit far apart inside one operator: those must NOT be joined.
_sp = pikepdf.new()
_f8 = _sp.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/Times-Bold'), Encoding=Name('/MacRomanEncoding')))
_f9 = _sp.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/Times-Roman'), Encoding=Name('/MacRomanEncoding')))
_ops = [
  b"BT /F8 1 Tf 18 0 0 18 152 554 Tm 0.048 Tc 0.476 Tw (An Introduction to Programming) Tj 5.222 -1.111 TD 0.046 Tc 0.464 Tw (with Threads) Tj ET",
  b"BT /F9 1 Tf 12 0 0 12 144 440 Tm 0.026 Tc 0.259 Tw 14 TL (This is an ordinary paragraph of body text that is) Tj T* (written with word spacing set on every line.) Tj ET",
  b"BT /F9 10 Tf 1 0 0 1 144 300 Tm [(Left cell) -20000 (Right cell)] TJ ET",
]
_sp.pages.append(Page(_sp.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(F8=_f8, F9=_f9)), Contents=_sp.make_stream(b"\n".join(_ops))))))
_sp.save('fx/split-ops.pdf')
print('wrote fx/split-ops.pdf')

# A ragged three-line paragraph, for alignment: every line starts at the same x and ends at
# a different one, so left, centre and right are all distinguishable in the saved file.
_al = pikepdf.new()
_alf = _al.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name('/WinAnsiEncoding')))
_al.pages.append(Page(_al.make_indirect(Dictionary(Type=Name.Page, MediaBox=Array([0,0,612,792]),
    Resources=Dictionary(Font=Dictionary(F1=_alf)),
    Contents=_al.make_stream(b"BT /F1 11 Tf 13.2 TL 72 700 Td (Short) Tj T* (A somewhat longer line of text here) Tj T* (Mid length line) Tj ET")))))
_al.save('fx/align.pdf')
print('wrote fx/align.pdf')
