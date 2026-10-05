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
def firstPath(*paths):
    # fetch-deps.sh unpacks the npm tarball, which puts everything under package/. An older
    # working tree had it under node_modules/. Accept either, so a fresh clone builds.
    for p in paths:
        if os.path.exists(p): return p
    raise SystemExit('missing dependency: ' + paths[0] + ' (run ./fetch-deps.sh first)')

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
         ('@cantoo/pdf-lib 2.11.1, maintained fork of pdf-lib (MIT)',lib(firstPath('cantoo/package/dist/pdf-lib.min.js',
                                      'cantoo/node_modules/@cantoo/pdf-lib/package/dist/pdf-lib.min.js',
                                      'cantoo/node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js'))),
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
           'badge': 'Everything runs in your browser', 'pwa': True,
           'storage_key': 'pdf-tool-kit:signature' },
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
    pre = [('installed-app flag', 'window.__PDFKIT_PWA=1;', 'classic')] if brand.get('pwa') else []
    sc = variant(['eng','spa'] if strict else ['eng'],
                 pre + scripts + [('PDF Tools app', app_src, 'module')])
    hashes=["'sha256-"+base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode()+"'" for _,s,_ in sc]
    head='<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
    if strict:
        # The installed app needs its manifest, its own service worker, and permission to
        # fetch this one page in order to cache it. No other origin is allowed, ever.
        extra = ("manifest-src 'self'; worker-src 'self'; connect-src 'self'"
                 if brand.get('pwa') else "manifest-src 'none'; worker-src 'none'; connect-src 'none'")
        csp=("default-src 'none'; script-src "+" ".join(hashes)+" 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; "
             "font-src data:; "+extra+"; media-src 'none'; object-src 'none'; frame-src 'none'; "
             "base-uri 'none'; form-action 'none'")
        head+='<meta http-equiv="Content-Security-Policy" content="'+csp+'">\n<meta name="referrer" content="no-referrer">\n'
    head+='<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>'+brand['title']+'</title>\n'
    if brand.get('pwa'):
        head+='<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#16181D">\n'
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

# ---------- Installed-app files (hosted build only) ----------
# A manifest, icons and a service worker. The file handler is what puts the app in Windows'
# "Open with" list and the ChromeOS Files app, so a PDF can be opened straight into it, or
# the app set as the default for .pdf.
def pwa_files(out_dir, brand, version):
    icon_svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>"
                "<rect width='512' height='512' rx='96' fill='#16181D'/>"
                "<rect x='136' y='96' width='208' height='272' rx='16' fill='#F7F8FA'/>"
                "<path d='M296 96v56h56' fill='none' stroke='#16181D' stroke-width='16'/>"
                "<rect x='168' y='200' width='144' height='16' rx='8' fill='#6E8BFA'/>"
                "<rect x='168' y='240' width='144' height='16' rx='8' fill='#6E8BFA'/>"
                "<rect x='168' y='280' width='96' height='16' rx='8' fill='#6E8BFA'/>"
                "<rect x='136' y='392' width='240' height='24' rx='12' fill='#6E8BFA'/></svg>")
    open(os.path.join(out_dir, 'icon.svg'), 'w', encoding='utf-8').write(icon_svg)
    # the maskable variant keeps the artwork inside the safe area, so it is simply padded
    open(os.path.join(out_dir, 'icon-maskable.svg'), 'w', encoding='utf-8').write(
        icon_svg.replace("viewBox='0 0 512 512'", "viewBox='-64 -64 640 640'"))

    manifest = {
        "name": brand['title'],
        "short_name": brand['title'],
        "description": "Edit, sign, redact and organise PDFs entirely in your browser.",
        "start_url": ".", "scope": ".", "display": "standalone",
        "background_color": "#16181D", "theme_color": "#16181D",
        "icons": [
            {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
            {"src": "icon-maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable"},
        ],
        # the part the operating system reads when offering an app for a .pdf
        "file_handlers": [{"action": ".", "accept": {"application/pdf": [".pdf"]},
                           "launch_type": "single-client"}],
        "launch_handler": {"client_mode": "focus-existing"},
    }
    open(os.path.join(out_dir, 'manifest.webmanifest'), 'w', encoding='utf-8').write(
        json.dumps(manifest, indent=2) + "\n")

    sw = ("// Service worker for the installed app: caches this one page so it keeps working\n"
          "// with no network. It never requests anything from another origin, and there is\n"
          "// nothing else to cache - the page carries its own libraries, fonts and OCR engine.\n"
          "const CACHE = 'pdf-tool-kit-" + version + "';\n"
          "const PAGE = './';\n\n"
          "self.addEventListener('install', e => {\n"
          "  e.waitUntil(caches.open(CACHE)\n"
          "    .then(c => c.addAll([PAGE, './manifest.webmanifest', './icon.svg']))\n"
          "    .then(() => self.skipWaiting()));\n"
          "});\n"
          "self.addEventListener('activate', e => {\n"
          "  e.waitUntil(caches.keys()\n"
          "    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))\n"
          "    .then(() => self.clients.claim()));\n"
          "});\n"
          "self.addEventListener('fetch', e => {\n"
          "  const url = new URL(e.request.url);\n"
          "  if (url.origin !== self.location.origin) return;   // nothing off this origin, ever\n"
          "  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit =>\n"
          "    hit || fetch(e.request).then(res => {\n"
          "      if (res && res.ok && e.request.method === 'GET') {\n"
          "        const copy = res.clone();\n"
          "        caches.open(CACHE).then(c => c.put(e.request, copy));\n"
          "      }\n"
          "      return res;\n"
          "    }).catch(() => caches.match(PAGE))));\n"
          "});\n")
    open(os.path.join(out_dir, 'sw.js'), 'w', encoding='utf-8').write(sw)

VERSION = hashlib.sha256(build(True, BRANDS['kit']).encode()).hexdigest()[:12]

# One output: the single strict Content-Security-Policy page, plus the files that make it
# installable as an app.
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(build(True, BRANDS['kit']))
pwa_files(OUT, BRANDS['kit'], VERSION)

print('built index.html:', len(build(True, BRANDS['kit']).encode()), 'bytes, plus manifest, icons and service worker')
for (label,s,k) in variant(['eng','spa'], scripts): print(k, label[:80])
