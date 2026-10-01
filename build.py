import os, re, base64, hashlib, json
css=open('style.css',encoding='utf-8').read()
body=open('body.html',encoding='utf-8').read()
app=open('app.js',encoding='utf-8').read()
logo=base64.b64encode(open('logo.png','rb').read()).decode() if os.path.exists('logo.png') else ''
F='fonts/fontsource-{p}-5.3.0/package/files/{n}-normal.woff2'
fonts=[('Inter',w,F.format(p='inter',n=f'inter-latin-{w}')) for w in (400,500,600,700)]
fonts+=[('Barlow Condensed',w,F.format(p='barlow-condensed',n=f'barlow-condensed-latin-{w}')) for w in (600,700)]
fonts+=[('Sig Vibes',400,F.format(p='great-vibes',n='great-vibes-latin-400')),
        ('Sig Dancing',400,F.format(p='dancing-script',n='dancing-script-latin-400')),
        ('Sig Allura',400,F.format(p='allura',n='allura-latin-400')),
        ('Sig Apple',400,F.format(p='homemade-apple',n='homemade-apple-latin-400'))]
SF='pdfjs4/package/standard_fonts/'
fonts+=[('Std Sans',400,SF+'LiberationSans-Regular.ttf')]
fontjs='window.__PDFTOOLS_FONTS='+json.dumps([[f,w,base64.b64encode(open(p,'rb').read()).decode()] for f,w,p in fonts])+';'
import os
std={n:base64.b64encode(open(SF+n,'rb').read()).decode() for n in sorted(os.listdir(SF)) if n.endswith(('.pfb','.ttf'))}
fontjs+='window.__PDFTOOLS_STD_FONTS='+json.dumps(std)+';'
def lib(p):
    s=open(p,encoding='utf-8').read().replace('\ufffd','\\uFFFD')
    s=re.sub(r'//# sourceMappingURL=.*$','',s,flags=re.M)
    # A regex in @cantoo/pdf-lib's HTML parser contains '<!--', which would put the HTML
    # parser into escaped-script state. '<[!]--' matches the same text in any regex mode.
    if s.count('/<!--[^]*?(?=-->)-->|')==1: s=s.replace('/<!--[^]*?(?=-->)-->|','/<[!]--[^]*?(?=-->)-->|')
    # ASP.NET parses <% ... %> anywhere in a page, including inside client-side <script>.
    # node-forge has a lone "<%" in a string literal, which would break an .aspx build.
    # Splitting the literal keeps the JS value identical.
    if s.count('"<%"')==1: s=s.replace('"<%"','"<"+"%"')
    assert not re.search(r'</script',s,re.I) and '<!--' not in s
    return s

def mjs(path, glob, names=None):
    """Inline an ES-module bundle and bridge its exports onto a global.

    pdf.js 4.x ships only as ES modules. Inline <script type="module"> blocks can still be
    pinned by CSP hash, so the integrity guarantee is unchanged; we just have to re-expose
    the exports, because module scope is not global scope.
    """
    src = lib(path)
    m = re.search(r'export\{([^}]*)\};?\s*$', src)
    assert m, 'no export statement in ' + path
    pairs = []
    for part in m.group(1).split(','):
        local, _, exported = part.partition(' as ')
        exported = (exported or local).strip()
        if names is None or exported in names:
            pairs.append(exported + ':' + local.strip())
    assert names is None or len(pairs) == len(names), (path, len(pairs))
    return src + '\nglobalThis.' + glob + ' = {' + ','.join(pairs) + '};\n'

scripts=[('fonts: Inter, Barlow Condensed, Great Vibes, Dancing Script, Allura (OFL-1.1); Homemade Apple (Apache-2.0); PDF standard fonts: Foxit (BSD-style, see pdf.js), Liberation Sans (OFL-1.1)',fontjs),
         ('@cantoo/pdf-lib 2.11.1, maintained fork of pdf-lib (MIT)',lib('cantoo/node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js')),
         ('pdf.js 4.10.38 worker, run in-page (Apache-2.0)',mjs('pdfjs4/package/legacy/build/pdf.worker.min.mjs','pdfjsWorker',['WorkerMessageHandler']),'module'),
         ('pdf.js 4.10.38 (Apache-2.0)',mjs('pdfjs4/package/legacy/build/pdf.min.mjs','pdfjsLib'),'module'),
         ('node-forge 1.4.0 (BSD-3-Clause)',lib('vend/node-forge-1.4.0/package/dist/forge.min.js')),
         ('tesseract.js-core 6.1.2 loader (Apache-2.0)',lib('vend/tesseract.js-core-6.1.2/package/tesseract-core-lstm.js')),
         ('OCR_ASSETS',None)]
scripts=[(t if len(t)==3 else (t[0],t[1],'classic')) for t in scripts]

def b64file(p): return base64.b64encode(open(p,'rb').read()).decode()

# OCR languages. Spanish ships only in the local build: the published page is very likely to
# block WebAssembly anyway, and this keeps that file well under the 16 MB publishing limit.
LANGS={'eng':('English','vend/tesseract.js-data-eng-1.0.0/package/4.0.0_best_int/eng.traineddata.gz'),
       'spa':('Spanish','vend/spa/package/4.0.0_best_int/spa.traineddata.gz')}
def ocr_assets(langs):
    parts=['wasm:"'+b64file('vend/tesseract.js-core-6.1.2/package/tesseract-core-lstm.wasm')+'"']
    parts.append('langs:{'+','.join(k+':{name:"'+LANGS[k][0]+'",data:"'+b64file(LANGS[k][1])+'"}' for k in langs)+'}')
    label=('OCR engine (tesseract-core-lstm.wasm, Apache-2.0) and models (tessdata 4.0.0_best_int, Apache-2.0): '
           +', '.join(LANGS[k][0] for k in langs))
    return label,'window.__PDFTOOLS_OCR={'+','.join(parts)+'};'

def variant(langs, base):
    out=[]
    for label,src,kind in base:
        if label=='OCR_ASSETS':
            l,s2=ocr_assets(langs); out.append((l,s2,'classic'))
        else: out.append((label,src,kind))
    return out

PLAIN_THEME = '''
  /* ---------- Neutral theme (unbranded build) ---------- */
  :root {
    --black: #16181D;
    --rail: #1B1E24;
    --rail-hover: #272B33;
    --gold: #6E8BFA;
    --gold-dim: #5872E0;
    --paper: #F7F8FA;
    --panel: #FFFFFF;
    --canvas: #E3E6EB;
    --line: #DFE3E9;
    --ink: #15181D;
    --ink-soft: #5A6372;
    --good: #2E7D5B;
    --bad: #C2453C;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16181D; --panel: #1D2026; --canvas: #101216; --line: #2E333B;
      --ink: #EDEFF3; --ink-soft: #A6AEBC;
    }
  }
  :root[data-theme="dark"] {
    --paper: #16181D; --panel: #1D2026; --canvas: #101216; --line: #2E333B;
    --ink: #EDEFF3; --ink-soft: #A6AEBC;
  }
  header.top { border-bottom-width: 2px; }
  h1, h2 { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; letter-spacing: -0.01em; font-weight: 650; }
'''

# Branding is applied at build time so an unbranded copy is the same code, not a fork.
BRANDS = {
  'kit': { 'title': 'PDF Tool Kit', 'org': '', 'logo_alt': '', 'location': 'e.g. Springfield, IL',
           'logo': False, 'file': 'index', 'theme': PLAIN_THEME,
           'badge': 'Everything runs in your browser' },
}

def brandify(markup, brand):
    if not brand['logo']:
        # drop the logo image entirely rather than ship an empty one
        i = markup.index('<img src="data:image/png;base64,__LOGO_B64__"')
        j = markup.index('>', i) + 1
        markup = markup[:i] + markup[j:]
    for token, value in (('__TITLE__', brand['title']),
                         ('__ORG__', brand['org']),
                         ('__ORG_DEFAULT__', brand.get('org_default', '')),
                         ('__LOGO_ALT__', brand['logo_alt']),
                         ('__LOCATION__', brand['location']),
                         ('__BADGE__', brand.get('badge', 'Files stay on this device'))):
        markup = markup.replace(token, value)
    if brand['org'] == '':
        markup = re.sub(r'\s*<p></p>', '', markup)
    return markup

def build(strict, brand=None):
    brand = brand or BRANDS['kit']
    app_src = app
    if brand.get('storage_key'):
        app_src = app_src.replace('"pdf-tool-kit:signature"', '"%s"' % brand['storage_key'])
    sc = variant(['eng','spa'] if strict else ['eng'],
                 scripts + [('PDF Tools app', app_src, 'module')])
    hashes=["'sha256-"+base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode()+"'" for _,s,_ in sc]
    head='<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
    if strict:
        csp=("default-src 'none'; script-src "+" ".join(hashes)+" 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; "
             "font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; "
             "base-uri 'none'; form-action 'none'")
        head+='<meta http-equiv="Content-Security-Policy" content="'+csp+'">\n<meta name="referrer" content="no-referrer">\n'
    head+='<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>'+brand['title']+'</title>\n'
    sheet = css
    if brand.get('theme'):
        sheet = sheet.replace('</style>', brand['theme'] + '</style>') if '</style>' in sheet else sheet + '<style>' + brand['theme'] + '</style>'
    html=head+sheet+'\n</head>\n<body>\n'+brandify(body, brand).replace('__LOGO_B64__',logo)
    for label,s,kind in sc:
        tag='<script type="module">' if kind=='module' else '<script>'
        html+='\n<!-- '+label+' -->\n'+tag+s+'</script>'
    html+='\n</body>\n</html>\n'
    assert '\ufffd' not in html and 'googleapis' not in html
    assert '<%' not in html, 'ASP.NET would treat <% as a server tag'
    return html
OUT=os.environ.get('OUT_DIR','dist')
os.makedirs(OUT,exist_ok=True)
# One output: the single strict Content-Security-Policy file that gets published.
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(build(True, BRANDS['kit']))

print('built index.html:', len(build(True, BRANDS['kit']).encode()), 'bytes')
for (label,s,k) in variant(['eng','spa'], scripts): print(k, label[:80])
