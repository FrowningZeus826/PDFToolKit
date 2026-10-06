#!/usr/bin/env python3
"""A corpus of varied PDFs for tests/corpus.js.

Each file comes from a different producer, PDF version, structure or oddity, so the suite
exercises what real-world documents look like instead of only files the tool itself writes.
Output goes to tests/fx/corpus/ with a manifest.json describing what each file should do.

Producers used when available (anything missing is skipped and left out of the manifest):
  reportlab, LibreOffice, headless Chromium (see mkchrome.js), poppler's pdftocairo,
  ImageMagick, qpdf (re-writes: linearized, object streams, versions), and pikepdf for
  deliberately unusual structure.

Run from tests/:  python3 fixtures/mkcorpus.py
"""
import json, os, shutil, subprocess, sys, tempfile, zlib, io, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'fx', 'corpus')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    p = os.path.join(OUT, f)
    if os.path.isfile(p): os.remove(p)

import pikepdf
from pikepdf import Name, Dictionary, Array, Stream, String
from reportlab.pdfgen import canvas as rlcanvas
from reportlab.lib.pagesizes import letter, A4, A6, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

MANIFEST = []
PROBE, CONTROL = 'Zanzibar', 'Quokka'      # edit/redact tests replace the first, expect the second to survive


def have(cmd): return shutil.which(cmd) is not None
def path(name): return os.path.join(OUT, name)
def font_file(*cands):
    for c in cands:
        if os.path.exists(c): return c
    return None


def reg(name, producer, text=True, editable=True, pages=None, expect='open', images=False, notes='', **extra):
    """Record a file in the manifest. `editable` means the Edit-text tab should find the probe word."""
    if not os.path.exists(path(name)):
        print('   (skipped %s: not produced)' % name); return
    entry = dict(name=name, producer=producer, text=text, editable=editable and text, expect=expect,
                 images=images, notes=notes, probe=PROBE if text else None, control=CONTROL if text else None)
    entry.update(extra)
    if pages is None and expect == 'open':
        try:
            with pikepdf.open(path(name)) as pdf: pages = len(pdf.pages)
        except Exception:
            try: pages = int(subprocess.check_output(['qpdf', '--show-npages', path(name)]).strip())
            except Exception: pages = None
    entry['pages'] = pages
    MANIFEST.append(entry)
    print('   + %-34s %s' % (name, producer))


LINES = [
    'The %s report describes a census of the %s on the island.' % (PROBE, CONTROL),
    'Counts were taken at dawn, at noon and again after dark, by three teams.',
    'Each team recorded the weather, the tide and the number of animals seen.',
    'Where the totals disagreed, the larger figure was kept and noted below.',
]


FILLER = ['A second pass over the northern shore found the same pattern.',
          'Heavy rain on the final day cut the afternoon count short.',
          'All figures were checked against the harbour log before filing.']


def body_lines(n=4):
    """Distinct lines; the probe word appears in the first line only."""
    return (LINES + FILLER)[:max(1, min(n + 2, len(LINES) + len(FILLER)))]


# ---------------------------------------------------------------- reportlab
def rl_std14(name, version=(1, 4), pagesize=letter, pages=2, **kw):
    c = rlcanvas.Canvas(path(name), pagesize=pagesize, pdfVersion=version[1] if hasattr(rlcanvas.Canvas, 'pdfVersion') else None) \
        if False else rlcanvas.Canvas(path(name), pagesize=pagesize)
    w, h = pagesize
    for pg in range(pages):
        c.setFont('Helvetica-Bold', 18); c.drawString(72, h - 72, 'Island census, part %d' % (pg + 1))
        y = h - 110
        for font, size in (('Helvetica', 11), ('Times-Roman', 12), ('Courier', 10)):
            c.setFont(font, size)
            for ln in (body_lines(4) if font == 'Helvetica' else LINES[1:]):
                if pg == 0 or font == 'Helvetica': c.drawString(72, y, ln)
                y -= size * 1.5
            y -= 10
        c.showPage()
    c.setTitle('Island census'); c.setAuthor('Corpus Generator')
    c.save()


def rl_ttf(name, ttf, family, lines, size=12, rtl=False):
    pdfmetrics.registerFont(TTFont(family, ttf))
    c = rlcanvas.Canvas(path(name), pagesize=letter)
    c.setFont(family, size)
    y = 700
    for ln in lines:
        (c.drawRightString(540, y, ln) if rtl else c.drawString(72, y, ln)); y -= 22
    c.showPage(); c.save()


print('==> reportlab')
rl_std14('rl-std14.pdf')
reg('rl-std14.pdf', 'reportlab, standard-14 fonts', notes='Helvetica, Times and Courier, two pages, document info')

dejavu = font_file('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
if dejavu:
    rl_ttf('rl-ttf-dejavu.pdf', dejavu, 'DejaVuSans', body_lines() + ['Accents: café naïve façade über ñ',
           'Greek: Αθήνα περιγράφει', 'Cyrillic: Москва большой город'])
    reg('rl-ttf-dejavu.pdf', 'reportlab, embedded TrueType subset', notes='Latin, Greek and Cyrillic in an embedded subset with a ToUnicode map')

# a longer report: table, outline, links, page labels
c = rlcanvas.Canvas(path('rl-report.pdf'), pagesize=letter)
for i in range(1, 6):
    c.bookmarkPage('p%d' % i); c.addOutlineEntry('Section %d' % i, 'p%d' % i, level=0)
    c.setFont('Helvetica-Bold', 16); c.drawString(72, 720, 'Section %d: findings' % i)
    c.setFont('Helvetica', 11); y = 690
    for ln in body_lines(): c.drawString(72, y, ln); y -= 16
    for r in range(5):
        for col in range(4): c.drawString(72 + col * 110, 560 - r * 18, 'R%dC%d %s' % (r, col, 'x' * (r + col)))
    c.linkURL('https://example.invalid/section%d' % i, (72, 700, 300, 716), relative=0)
    c.showPage()
c.save()
reg('rl-report.pdf', 'reportlab, report', notes='five pages with an outline, a table-like grid and link annotations')

# AcroForm: text, checkbox, radio, choice, list
c = rlcanvas.Canvas(path('rl-form.pdf'), pagesize=letter)
c.setFont('Helvetica', 12); c.drawString(72, 720, 'Application form for %s %s' % (PROBE, CONTROL))
f = c.acroForm
c.drawString(72, 690, 'Name'); f.textfield(name='name', tooltip='Name', x=140, y=682, width=220, height=20, borderStyle='inset', value='')
c.drawString(72, 650, 'Agree'); f.checkbox(name='agree', x=140, y=646, size=16, checked=False)
c.drawString(72, 620, 'Size'); f.radio(name='size', value='S', x=140, y=616, size=14, selected=True)
f.radio(name='size', value='L', x=180, y=616, size=14, selected=False)
c.drawString(72, 590, 'Country'); f.choice(name='country', value='FR', options=['FR', 'DE', 'ES'], x=140, y=582, width=120, height=20, fieldFlags='combo')
c.drawString(72, 550, 'Notes'); f.textfield(name='notes', x=140, y=500, width=300, height=60, fieldFlags='multiline')
c.showPage(); c.save()
reg('rl-form.pdf', 'reportlab, AcroForm', form=True, notes='text, checkbox, radio group, combo and multiline fields')

# page sizes in one file
c = rlcanvas.Canvas(path('rl-mixed-sizes.pdf'))
for size in (letter, A4, A6, landscape(letter), (900, 1200)):
    c.setPageSize(size); c.setFont('Helvetica', 12)
    c.drawString(40, size[1] - 50, 'Page %dx%d: %s %s' % (size[0], size[1], PROBE, CONTROL)); c.showPage()
c.save()
reg('rl-mixed-sizes.pdf', 'reportlab, mixed page sizes', notes='five pages, each a different size and orientation')

c = rlcanvas.Canvas(path('rl-many-pages.pdf'), pagesize=letter)
for i in range(1, 151):
    c.setFont('Helvetica', 12); c.drawString(72, 700, 'Page %d: the %s report on the %s' % (i, PROBE, CONTROL)); c.drawString(72, 680, 'Row %d of the census.' % i); c.showPage()
c.save()
reg('rl-many-pages.pdf', 'reportlab, 150 pages', notes='a long document, for speed and page-grid handling', many=True)

# CJK with a non-embedded CID font, and embedded
try:
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))
    c = rlcanvas.Canvas(path('rl-cjk-cid.pdf'), pagesize=letter)
    c.setFont('Helvetica', 12); c.drawString(72, 720, '%s %s' % (PROBE, CONTROL))
    c.setFont('HeiseiMin-W3', 14); c.drawString(72, 690, '日本語のテキストを表示します')
    c.showPage(); c.save()
    reg('rl-cjk-cid.pdf', 'reportlab, non-embedded CID font (Japanese)', editable=False, notes='a CJK font that is not embedded: must open and save without damage')
except Exception as e: print('   (no CID fonts: %s)' % e)

ipa = font_file('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
if ipa:
    rl_ttf('rl-cjk-embedded.pdf', ipa, 'IPAGothic', [PROBE + ' ' + CONTROL, '日本語のテキスト', 'こんにちは世界'])
    reg('rl-cjk-embedded.pdf', 'reportlab, embedded CJK TrueType', editable=False, notes='Japanese text in an embedded subset; editing is not promised, damage is not allowed')

fs = font_file('/usr/share/fonts/truetype/freefont/FreeSerif.ttf')
if fs:
    rl_ttf('rl-hebrew.pdf', fs, 'FreeSerif', [PROBE + ' ' + CONTROL, 'שלום עולם', 'בדיקת קידוד'], rtl=True)
    reg('rl-hebrew.pdf', 'reportlab, Hebrew (right to left)', editable=False, notes='right-to-left text must survive open, apply and save')
    rl_ttf('rl-devanagari.pdf', fs, 'FreeSerif', [PROBE + ' ' + CONTROL, 'नमस्ते दुनिया', 'भारत एक देश है'])
    reg('rl-devanagari.pdf', 'reportlab, Devanagari', editable=False, notes='a complex script drawn glyph by glyph')

loma = font_file('/usr/share/fonts/opentype/tlwg/Loma.otf')
# (OpenType/CFF fonts are not TrueType; reportlab can't embed them, so Thai goes through LibreOffice below)

# ---------------------------------------------------------------- content-stream oddities
print('==> unusual content streams (pikepdf)')


def std_font(pdf, base='Helvetica'):
    return pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/' + base), Encoding=Name.WinAnsiEncoding))


def make_pdf(contents, media=(0, 0, 612, 792), fonts=('Helvetica',), extra_page=None):
    pdf = pikepdf.new()
    res = Dictionary(Font=Dictionary({('/F%d' % (i + 1)): std_font(pdf, f) for i, f in enumerate(fonts)}))
    page = pdf.add_blank_page(page_size=(media[2] - media[0], media[3] - media[1]))
    page.MediaBox = Array(list(media))
    page.Resources = res
    if isinstance(contents, (list, tuple)):
        page.Contents = Array([pdf.make_stream(c.encode('latin-1')) for c in contents])
    else:
        page.Contents = pdf.make_stream(contents.encode('latin-1'))
    if extra_page: extra_page(pdf, page)
    return pdf


def text_ops(lines, font='F1', size=12, x=72, y=700, lead=16):
    s = ['BT /%s %g Tf %g TL %g %g Td' % (font, size, lead, x, y)]
    for i, ln in enumerate(lines):
        s.append('(%s) Tj' % ln.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)'))
        s.append('T*')
    s.append('ET'); return '\n'.join(s)


BASE = body_lines()
pdf = make_pdf(text_ops(BASE)); pdf.save(path('st-simple-tj.pdf'))
reg('st-simple-tj.pdf', 'pikepdf, hand-written content', notes='one Tj per line with T*')

# word-by-word TJ with kerning adjustments, the way InDesign/LaTeX write text
ops = ['BT /F1 12 Tf 72 700 Td']
y = 700
for ln in BASE:
    ops.append('[' + ' '.join('(%s) -%d' % (w, 30 + (i * 7) % 60) if i < len(ln.split()) - 1 else '(%s)' % w for i, w in enumerate(ln.split())) + '] TJ')
    ops.append('0 -16 Td')
ops.append('ET')
make_pdf('\n'.join(ops)).save(path('st-kerned-tj.pdf'))
reg('st-kerned-tj.pdf', 'pikepdf, TeX-style kerned TJ arrays', notes='every word its own string with a kern between')

# text state operators: Tc, Tw, Tz, Ts, ' and "  (the first line stays plain so edits to it are easy to judge)
ops = ['BT /F1 12 Tf 72 700 Td 14 TL', '(%s)Tj T*' % BASE[0], '1.2 Tc (%s)Tj T*' % BASE[1], '0 Tc 6 Tw (%s)Tj T*' % BASE[2],
       '0 Tw 85 Tz (%s)Tj T*' % BASE[3], '100 Tz (Quote operator line)\' 2 1 (Double quote operator line)" 0 Tw 0 Tc 4 Ts (Raised line)Tj 0 Ts ET']
make_pdf('\n'.join(ops)).save(path('st-text-state.pdf'))
reg('st-text-state.pdf', 'pikepdf, Tc/Tw/Tz/Ts and quote operators', normalizes=True, notes='character and word spacing, horizontal scaling, rise, and the \' and " operators')

# the content stream is split into several streams in the middle of a text object
parts = [text_ops(BASE).replace('(%s) Tj' % BASE[1].replace('(', '\\('), '(%s) Tj' % BASE[1])]
sp = text_ops(BASE).split('\n')
make_pdf(['\n'.join(sp[:3]), '\n'.join(sp[3:6]), '\n'.join(sp[6:])]).save(path('st-split-streams.pdf'))
reg('st-split-streams.pdf', 'pikepdf, content split across streams', notes='/Contents is an array and a text object spans two of its streams')

# marked content whose dictionary ends in a hex string ("<feff0041>>>"): Word and LibreOffice write this,
# and a tokenizer that stops the dictionary at the first ">>" is left on a stray ">" (it once hung the editor)
ops = ['/Span<</ActualText<feff0041>>>BDC EMC', text_ops(BASE), '/P<</MCID 0/Alt(paren \\) in (nested) string)>>BDC EMC']
make_pdf('\n'.join(ops)).save(path('st-actualtext-dict.pdf'))
reg('st-actualtext-dict.pdf', 'pikepdf, marked content with ActualText hex ending the dictionary', notes='regression: ">>>" after a hex string inside a BDC dictionary froze Edit text')

# nested graphics state with transforms
ops = ['q 1 0 0 1 0 0 cm', 'q 0.9 0 0 0.9 40 40 cm', 'q', text_ops(BASE, x=40, y=640), 'Q', 'Q', '0.5 g 72 72 200 20 re f', 'Q']
make_pdf('\n'.join(ops)).save(path('st-nested-cm.pdf'))
reg('st-nested-cm.pdf', 'pikepdf, nested q/cm', notes='text inside nested transforms (0.9 scale + offset)')

# rotated and scaled text through the text matrix
ops = ['BT /F1 12 Tf 0.966 0.259 -0.259 0.966 72 500 Tm (%s) Tj ET' % BASE[0], 'BT /F1 12 Tf 1 0 0 1 72 700 Tm (%s) Tj ET' % BASE[1],
       'BT /F1 1 Tf 12 0 0 12 72 660 Tm (%s) Tj ET' % BASE[2]]
make_pdf('\n'.join(ops)).save(path('st-tm-matrices.pdf'))
reg('st-tm-matrices.pdf', 'pikepdf, text matrices', editable=False, notes='tilted text, plus a 1pt font scaled to 12pt through Tm')

# text in a form XObject (shared header/footer style)
def add_form(pdf, page):
    form = pdf.make_stream(text_ops(BASE, x=0, y=0).encode('latin-1'))
    form.Type = Name.XObject; form.Subtype = Name.Form; form.BBox = Array([0, 0, 500, 120]); form.Resources = page.Resources
    page.Resources.XObject = Dictionary(Fm1=form)
make_pdf('q 1 0 0 1 72 600 cm /Fm1 Do Q', extra_page=add_form).save(path('st-form-xobject.pdf'))
reg('st-form-xobject.pdf', 'pikepdf, text inside a Form XObject', editable=False, notes='text drawn by a reusable form: protected from editing, must survive')

# invisible OCR-style layer over an image
def add_img(pdf, page):
    img = pdf.make_stream(bytes([240] * (200 * 100)))
    img.Type = Name.XObject; img.Subtype = Name.Image; img.Width = 200; img.Height = 100
    img.ColorSpace = Name.DeviceGray; img.BitsPerComponent = 8
    page.Resources.XObject = Dictionary(Im1=img)
make_pdf('q 400 0 0 200 72 560 cm /Im1 Do Q\nBT 3 Tr /F1 12 Tf 72 700 Td (%s) Tj ET' % BASE[0], extra_page=add_img).save(path('st-invisible-text.pdf'))
reg('st-invisible-text.pdf', 'pikepdf, invisible text (Tr 3) over an image', editable=False, images=True, notes='a searchable-scan layout: text exists but is not drawn')

# escapes, octal and hex strings
ops = ['BT /F1 12 Tf 72 700 Td 16 TL',
       '(%s \\(paren\\) back\\\\slash \\101\\102\\103 octal) Tj T*' % BASE[0], '<48656C6C6F20686578> Tj T*', '(%s) Tj T*' % BASE[1], 'ET']
make_pdf('\n'.join(ops)).save(path('st-string-escapes.pdf'))
reg('st-string-escapes.pdf', 'pikepdf, escaped, octal and hex strings', notes='parentheses, backslash, octal escapes and a hex string in one page')

# inline image + text
ops = 'q 100 0 0 50 72 600 cm BI /W 4 /H 2 /CS /G /BPC 8 ID ' + 'AAAAAAAA' + ' EI Q\n' + text_ops(BASE)
make_pdf(ops).save(path('st-inline-image.pdf'))
reg('st-inline-image.pdf', 'pikepdf, inline image', images=True, notes='BI/ID/EI inside the content stream')

# empty page and a page with no /Contents at all
pdf = pikepdf.new(); pdf.add_blank_page(); pdf.add_blank_page()
pg = pdf.add_blank_page(); pg.Resources = Dictionary(Font=Dictionary(F1=std_font(pdf))); pg.Contents = pdf.make_stream(text_ops(BASE).encode())
pdf.save(path('st-empty-pages.pdf'))
reg('st-empty-pages.pdf', 'pikepdf, blank pages with and without /Contents', notes='the first two pages are empty; text only on page 3', probe_page=3)

# ASCIIHex / ASCII85 + Flate filter chain
pdf = make_pdf(text_ops(BASE))
raw = pdf.pages[0].Contents.read_bytes()
import base64
a85 = base64.a85encode(zlib.compress(raw), adobe=False) + b'~>'
s = pdf.make_stream(a85, Filter=Array([Name.ASCII85Decode, Name.FlateDecode]))
pdf.pages[0].Contents = s
pdf.save(path('st-filter-chain.pdf'))
reg('st-filter-chain.pdf', 'pikepdf, ASCII85 + Flate filter chain', notes='a content stream behind two filters')

# ---------------------------------------------------------------- geometry
print('==> page geometry (pikepdf)')


def geom(name, mutate, **kw):
    pdf = make_pdf(text_ops(BASE)); mutate(pdf, pdf.pages[0]); pdf.save(path(name)); return pdf


geom('geo-cropbox.pdf', lambda pdf, pg: setattr(pg, 'CropBox', Array([36, 36, 576, 756])))
reg('geo-cropbox.pdf', 'pikepdf, CropBox inside MediaBox', notes='the visible area is smaller than the page')
geom('geo-cropbox-offset.pdf', lambda pdf, pg: setattr(pg, 'CropBox', Array([40, 300, 572, 760])))
reg('geo-cropbox-offset.pdf', 'pikepdf, CropBox offset from the origin', notes='visible region does not start at 0,0, so coordinates must be translated')
geom('geo-userunit.pdf', lambda pdf, pg: setattr(pg, 'UserUnit', 2))
reg('geo-userunit.pdf', 'pikepdf, UserUnit 2', notes='a page whose unit is 2/72 inch')
for rot in (90, 180, 270):
    geom('geo-rotate-%d.pdf' % rot, lambda pdf, pg, r=rot: setattr(pg, 'Rotate', r))
    reg('geo-rotate-%d.pdf' % rot, 'pikepdf, /Rotate %d' % rot, notes='whole page rotated')
pdf = make_pdf(text_ops(BASE, y=600), media=(-100, -100, 512, 692)); pdf.save(path('geo-negative-origin.pdf'))
reg('geo-negative-origin.pdf', 'pikepdf, MediaBox with a negative origin', notes='the page starts at -100,-100')
geom('geo-reversed-box.pdf', lambda pdf, pg: setattr(pg, 'MediaBox', Array([612, 792, 0, 0])))
reg('geo-reversed-box.pdf', 'pikepdf, MediaBox given corners reversed', notes='legal but unusual: upper right first')


def inherit(pdf, pg):
    pages = pdf.Root.Pages
    pages.MediaBox = pg.MediaBox; pages.Resources = pg.Resources; pages.Rotate = 0
    del pg['/MediaBox']; del pg['/Resources']
geom('geo-inherited.pdf', inherit)
reg('geo-inherited.pdf', 'pikepdf, MediaBox and Resources inherited from the Pages node', notes='the page itself carries neither')

pdf = pikepdf.new()
for i in range(6):
    pg = pdf.add_blank_page(page_size=(612, 792))
    pg.Resources = Dictionary(Font=Dictionary(F1=std_font(pdf)))
    pg.Contents = pdf.make_stream(text_ops(['Page %d of six' % (i + 1)] + BASE).encode())
    pg.Rotate = [0, 90, 180, 270, 0, 90][i]
pdf.save(path('geo-rotated-mix.pdf'))
reg('geo-rotated-mix.pdf', 'pikepdf, six pages with different rotations', notes='each page rotated differently in one file')

# ---------------------------------------------------------------- structure and versions
print('==> versions and structure (qpdf)')
SRC = path('rl-report.pdf')


def qpdf(name, *args, src=SRC):
    r = subprocess.run(['qpdf', *args, src, path(name)], capture_output=True)
    if r.returncode not in (0, 3): print('   qpdf failed for', name, r.stderr.decode()[:120]); return False
    return True


qpdf('ver-1.3.pdf', '--force-version=1.3', '--object-streams=disable')
reg('ver-1.3.pdf', 'qpdf, PDF 1.3, no object streams', notes='classic cross-reference table, version 1.3 header')
qpdf('ver-1.5-objstm.pdf', '--force-version=1.5', '--object-streams=generate')
reg('ver-1.5-objstm.pdf', 'qpdf, PDF 1.5 with object streams and an xref stream', notes='compressed objects and a cross-reference stream')
qpdf('ver-1.7-linearized.pdf', '--linearize', '--force-version=1.7')
reg('ver-1.7-linearized.pdf', 'qpdf, PDF 1.7 linearized (fast web view)', notes='linearized file; saving must not leave a stale hint table')
qpdf('ver-2.0.pdf', '--force-version=2.0', '--object-streams=generate')
reg('ver-2.0.pdf', 'qpdf, PDF 2.0 header', notes='newest version number')
qpdf('ver-uncompressed.pdf', '--qdf', '--object-streams=disable')
reg('ver-uncompressed.pdf', 'qpdf, fully uncompressed (QDF)', notes='readable streams and comments between objects')
qpdf('ver-no-compression.pdf', '--compress-streams=n', '--object-streams=disable')
reg('ver-no-compression.pdf', 'qpdf, streams stored without compression', notes='plain streams')
qpdf('ver-linearized-objstm.pdf', '--linearize', '--object-streams=generate')
reg('ver-linearized-objstm.pdf', 'qpdf, linearized with object streams', notes='both at once, as Acrobat writes')

# incremental update: a second revision appended after %%EOF
base = open(path('rl-std14.pdf'), 'rb').read()
with pikepdf.open(path('rl-std14.pdf')) as p:
    p.docinfo['/Title'] = 'Revised title'; p.save(path('_tmp.pdf'), linearize=False, object_stream_mode=pikepdf.ObjectStreamMode.disable)
shutil.copy(path('rl-std14.pdf'), path('inc-two-revisions.pdf'))
# hand-built update: replace the Info dictionary
m = re.search(rb'startxref\s+(\d+)\s+%%EOF\s*$', base)
prev = int(m.group(1))
with pikepdf.open(path('rl-std14.pdf')) as p:
    size = int(p.trailer['/Size']); root = p.trailer['/Root'].objgen; info_ref = p.trailer['/Info'].objgen
newobj = ('%d 0 obj\n<< /Title (Second revision) /Author (Corpus Generator) /Producer (incremental) >>\nendobj\n' % info_ref[0]).encode()
off = len(base) + 1
upd = b'\n' + newobj
xref_off = len(base) + len(upd)
upd += ('xref\n%d 1\n%010d 00000 n \ntrailer\n<< /Size %d /Root %d 0 R /Info %d 0 R /Prev %d >>\nstartxref\n%d\n%%%%EOF\n' %
        (info_ref[0], off, size, root[0], info_ref[0], prev, xref_off)).encode()
open(path('inc-two-revisions.pdf'), 'wb').write(base + upd)
os.remove(path('_tmp.pdf'))
reg('inc-two-revisions.pdf', 'incremental update (two revisions)', notes='the Info dictionary was replaced by an appended revision; the old one is still in the file', revisions=2)

# ---------------------------------------------------------------- privacy / metadata / annotations
print('==> metadata, annotations, attachments')
pdf = pikepdf.open(path('rl-std14.pdf'))
pdf.Root.Metadata = pdf.make_stream(b'<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Secret Author</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>', Type=Name.Metadata, Subtype=Name.XML)
pdf.Root.OpenAction = Dictionary(S=Name.JavaScript, JS=String('app.alert("hello");'))
pdf.docinfo['/Author'] = 'Secret Author'; pdf.docinfo['/Keywords'] = 'private, draft'
pdf.pages[0].PieceInfo = Dictionary(Acme=Dictionary(Private=Dictionary(Note=String('internal note'))))
pdf.attachments['notes.txt'] = pikepdf.AttachedFileSpec(pdf, b'attached secret', mime_type='text/plain', description='attached')
pdf.save(path('meta-everything.pdf'))
reg('meta-everything.pdf', 'pikepdf, XMP + JavaScript + attachment + PieceInfo', notes='every kind of hidden information the cleaner looks for', hidden=True)

pdf = pikepdf.open(path('rl-std14.pdf'))
pg = pdf.pages[0]
annots = [
    Dictionary(Type=Name.Annot, Subtype=Name.Highlight, Rect=Array([72, 690, 300, 705]), QuadPoints=Array([72, 705, 300, 705, 72, 690, 300, 690]), C=Array([1, 1, 0]), T=String('Reviewer One'), Contents=String('highlighted')),
    Dictionary(Type=Name.Annot, Subtype=Name.Text, Rect=Array([400, 700, 420, 720]), Contents=String('A note'), T=String('Reviewer Two'), Name=Name.Comment),
    Dictionary(Type=Name.Annot, Subtype=Name.FreeText, Rect=Array([72, 300, 300, 340]), Contents=String('Free text'), DA=String('/Helv 12 Tf 0 g'), T=String('Reviewer One')),
    Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=Array([72, 650, 200, 665]), Border=Array([0, 0, 0]), A=Dictionary(S=Name.URI, URI=String('https://example.invalid/'))),
    Dictionary(Type=Name.Annot, Subtype=Name.Square, Rect=Array([350, 300, 450, 360]), C=Array([1, 0, 0]), T=String('Reviewer Two')),
    Dictionary(Type=Name.Annot, Subtype=Name.Ink, Rect=Array([72, 200, 200, 260]), InkList=Array([Array([72, 200, 120, 260, 200, 210])]), C=Array([0, 0, 1])),
]
pg.Annots = Array([pdf.make_indirect(a) for a in annots])
pdf.save(path('ann-mixed.pdf'))
reg('ann-mixed.pdf', 'pikepdf, six annotation types', notes='highlight, note, free text, link, square and ink, with reviewer names', authors=True)

# optional content (layers)
pdf = pikepdf.open(path('st-simple-tj.pdf'))
ocg_on = pdf.make_indirect(Dictionary(Type=Name.OCG, Name=String('Visible layer')))
ocg_off = pdf.make_indirect(Dictionary(Type=Name.OCG, Name=String('Hidden layer')))
pdf.Root.OCProperties = Dictionary(OCGs=Array([ocg_on, ocg_off]), D=Dictionary(Order=Array([ocg_on, ocg_off]), OFF=Array([ocg_off])))
pg = pdf.pages[0]
pg.Resources.Properties = Dictionary(OC1=ocg_on, OC2=ocg_off)
data = pg.Contents.read_bytes().decode('latin-1') + '\n/OC /OC2 BDC BT /F1 14 Tf 72 300 Td (HIDDEN LAYER TEXT) Tj ET EMC\n'
pg.Contents = pdf.make_stream(data.encode('latin-1'))
pdf.save(path('struct-layers.pdf'))
reg('struct-layers.pdf', 'pikepdf, optional content (layers)', notes='one layer switched off by default, with text on it')

# tagged, outlines, page labels, metadata language
pdf = pikepdf.open(path('rl-report.pdf'))
pdf.Root.MarkInfo = Dictionary(Marked=True); pdf.Root.Lang = String('en-US')
pdf.Root.ViewerPreferences = Dictionary(DisplayDocTitle=True)
pdf.Root.PageLabels = Dictionary(Nums=Array([0, Dictionary(S=Name.r), 2, Dictionary(S=Name.D, St=1)]))
pdf.save(path('struct-labels-lang.pdf'))
reg('struct-labels-lang.pdf', 'pikepdf, page labels, language and marked content flag', notes='roman then decimal page labels')

# ---------------------------------------------------------------- images
print('==> images (ImageMagick, Pillow)')
from PIL import Image, ImageDraw
import random
random.seed(3)
noise = Image.effect_noise((1800, 1200), 80).convert('RGB')
noise.save(path('_n.jpg'), quality=92)
noise.convert('L').save(path('_g.png'))
bw = Image.new('1', (1200, 1600), 1); d = ImageDraw.Draw(bw)
for i in range(40): d.line([(0, i * 40), (1200, i * 40 + 20)], fill=0, width=3)
bw.save(path('_bw.png'))
cm = Image.effect_noise((1200, 900), 70).convert('CMYK'); cm.save(path('_c.jpg'), quality=90)
if have('convert'):
    for out, src, extra in (('img-jpeg.pdf', '_n.jpg', []), ('img-gray-png.pdf', '_g.png', []), ('img-1bit.pdf', '_bw.png', ['-compress', 'Group4']),
                            ('img-cmyk-jpeg.pdf', '_c.jpg', [])):
        r = subprocess.run(['convert', path(src), *extra, path(out)], capture_output=True)
        if r.returncode: print('   convert failed:', out, r.stderr.decode()[:100])
    reg('img-jpeg.pdf', 'ImageMagick, one large JPEG page', text=False, images=True, big_image=True, notes='a photo page; the compressor should shrink it')
    reg('img-gray-png.pdf', 'ImageMagick, grayscale image', text=False, images=True, notes='8-bit gray, Flate')
    reg('img-1bit.pdf', 'ImageMagick, 1-bit CCITT scan-like image', text=False, images=True, notes='black-and-white fax-style image')
    reg('img-cmyk-jpeg.pdf', 'ImageMagick, CMYK JPEG', text=False, images=True, notes='four-component DCT image (the compressor must leave or convert it safely)')
    r = subprocess.run(['convert', path('_n.jpg'), path('_g.png'), path('_bw.png'), path('img-multi.pdf')], capture_output=True)
    reg('img-multi.pdf', 'ImageMagick, three image pages', text=False, images=True, notes='three pages, each a different image type')
for f in ('_n.jpg', '_g.png', '_bw.png', '_c.jpg'):
    try: os.remove(path(f))
    except FileNotFoundError: pass

# ---------------------------------------------------------------- other producers
print('==> LibreOffice')
if have('soffice'):
    with tempfile.TemporaryDirectory() as td:
        html = os.path.join(td, 'lo-writer.html')
        open(html, 'w', encoding='utf-8').write('''<html><head><meta charset="utf-8"><title>Island census</title></head><body>
<h1>Island census</h1><p>The %s report describes a census of the %s on the island. <b>Bold words</b>, <i>italic words</i> and <u>underlined words</u>.</p>
<p>Counts were taken at dawn, at noon and again after dark, by three teams.</p>
<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>
<table border="1" cellpadding="4"><tr><th>Team</th><th>Dawn</th><th>Noon</th></tr><tr><td>A</td><td>12</td><td>9</td></tr><tr><td>B</td><td>14</td><td>8</td></tr></table>
<p>Unicode: café naïve über ñ Αθήνα Москва 日本語</p>
<p>สวัสดีชาวโลก</p>
</body></html>''' % (PROBE, CONTROL))
        csv = os.path.join(td, 'lo-calc.csv')
        open(csv, 'w').write('Team,Dawn,Noon,Dusk\n' + '\n'.join('%s,%d,%d,%d' % (n, a, b, c) for n, a, b, c in
                                [(PROBE, 12, 9, 7), (CONTROL, 14, 8, 6), ('Alpha', 3, 4, 5), ('Beta', 8, 7, 6)]) + '\n')
        def lo(src, outname, flt):
            r = subprocess.run(['soffice', '--headless', '--norestore', '-env:UserInstallation=file://' + td + '/profile', '--convert-to', flt, '--outdir', td, src],
                               capture_output=True, timeout=240)
            made = os.path.join(td, os.path.splitext(os.path.basename(src))[0] + '.pdf')
            if os.path.exists(made): shutil.move(made, path(outname)); return True
            print('   LibreOffice failed for', outname, r.stderr.decode()[:160]); return False
        if lo(html, 'lo-writer.pdf', 'pdf:writer_web_pdf_Export'):
            reg('lo-writer.pdf', 'LibreOffice Writer', notes='headings, lists, a table, bold/italic/underline, Greek, Cyrillic, Japanese and Thai')
        if lo(html, 'lo-writer-pdfa.pdf', 'pdf:writer_web_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"1"}}'):
            reg('lo-writer-pdfa.pdf', 'LibreOffice Writer, PDF/A-1b', notes='an archival file with XMP metadata and an output intent')
        if lo(html, 'lo-writer-tagged.pdf', 'pdf:writer_web_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}'):
            reg('lo-writer-tagged.pdf', 'LibreOffice Writer, tagged PDF', notes='a structure tree with marked content')
        if lo(csv, 'lo-calc.pdf', 'pdf:calc_pdf_Export'):
            reg('lo-calc.pdf', 'LibreOffice Calc', notes='a spreadsheet printed to PDF (separate cells, no paragraphs)')
else:
    print('   (LibreOffice not installed: skipping)')

print('==> poppler / cairo')
if have('pdftocairo'):
    for src, out in (('rl-ttf-dejavu.pdf', 'cairo-dejavu.pdf'), ('rl-report.pdf', 'cairo-report.pdf')):
        if os.path.exists(path(src)):
            subprocess.run(['pdftocairo', '-pdf', path(src), path(out)], capture_output=True)
    reg('cairo-dejavu.pdf', 'poppler pdftocairo (Cairo)', notes='Cairo writes subset fonts as CID TrueType with ToUnicode and one string per run')
    reg('cairo-report.pdf', 'poppler pdftocairo (Cairo), multi-page', notes='Cairo output of a five-page report')

# ---------------------------------------------------------------- damaged files
print('==> damaged files')
good = open(path('rl-std14.pdf'), 'rb').read()
open(path('bad-truncated.pdf'), 'wb').write(good[:int(len(good) * 0.8)])
reg('bad-truncated.pdf', 'damaged: last 20% cut off', text=True, editable=False, expect='either',
    notes='no xref or trailer; the tool may recover it or must say clearly that it can\'t')
open(path('bad-xref-offsets.pdf'), 'wb').write(re.sub(rb'(\n)(\d{10}) (\d{5}) n', lambda m: m.group(1) + (b'%010d' % (int(m.group(2)) + 7)) + b' ' + m.group(3) + b' n', good))
reg('bad-xref-offsets.pdf', 'damaged: wrong cross-reference offsets', editable=False, expect='either', notes='every offset is 7 bytes off')
open(path('bad-no-eof.pdf'), 'wb').write(good.rstrip()[:-5])
reg('bad-no-eof.pdf', 'damaged: missing %%EOF', editable=False, expect='either', notes='the end marker is cut away')
open(path('bad-garbage-prefix.pdf'), 'wb').write(b'GARBAGE\r\n' * 40 + good)
reg('bad-garbage-prefix.pdf', 'damaged: 360 bytes before the header', editable=False, expect='either', notes='the header is not at byte 0')
open(path('bad-wrong-length.pdf'), 'wb').write(re.sub(rb'/Length (\d+)', lambda m: b'/Length %d' % (int(m.group(1)) + 40), good, count=1))
reg('bad-wrong-length.pdf', 'damaged: a stream /Length that lies', editable=False, expect='either', notes='the first stream claims to be 40 bytes longer')

with open(path('manifest.json'), 'w') as f:
    json.dump(MANIFEST, f, indent=1)
print('==> %d files in the corpus' % len(MANIFEST))
