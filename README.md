# PDF Tool Kit

A complete PDF toolkit in a single HTML file. View, edit, fill forms, sign, organise pages,
OCR, compress, protect and redact — all in the browser. No upload, no account, no server.

**[Open the tool](https://frowningzeus826.github.io/PDFToolKit/)**

## What it does

| Tab | |
|---|---|
| **Document** | View, search, annotate, fill forms, place a signature, edit or redact the text already in the PDF |
| **Pages** | Reorder, rotate, delete, combine files, extract pages |
| **Prepare** | Strip hidden information, OCR a scan, compress |
| **Finish** | Save, add or remove a password, sign with a digital ID, check signatures |

### Editing text that is already in the PDF

A PDF stores glyphs at fixed positions, not words, so editing means finding the operators
behind a line and rewriting them. Lines are grouped into paragraphs you can retype, drag,
resize and re-wrap. Grouping is a guess, so you can merge two blocks or split one by
clicking the gap.

Where the document's own font can be reused, it is — including its bold or italic companion
— so an edit matches the page rather than approximating it. Fonts without a character map
are handled through the encoding they declare, which covers most older documents. Text that
can't be edited safely is marked and says why when you tap it.

### One look throughout

Every tab uses the same layout: a ribbon card across the top whose tabs pick what you are doing,
and the work underneath. **Document** puts its tools in the ribbon itself; **Pages**, **Prepare**
and **Finish** use the same card for their tabs (Prepare: *Remove hidden info*, *Make searchable*,
*Compress*; Finish: *Save*, *Password*, *Digital signature*) with their settings in a sheet below.
Light and dark themes follow the system setting.

### The Document ribbon

**Add to page**, **Fill form**, **Edit text**, **Redact** and **Whole document** are its tabs, and each
tab shows only its own controls. Page navigation and zoom sit beside the tabs and Apply is at the
right end of the ribbon. The page takes the full width; anything contextual (the signature builder,
a form field) floats over its edge instead of taking a column. For reading, the arrow at the end of
the tab row tucks the ribbon away (double-clicking the open tab does the same); picking a tab brings
it back. On a phone it starts tucked away so the document comes first.

Save and Undo are icons in the header, next to the file's name and what has changed (Ctrl+S
downloads what is open), so no row of the page is spent on them.

**Find** (the magnifier beside the zoom controls, or Ctrl/Cmd+F) searches the whole document:
matches are highlighted on the page, Enter and Shift+Enter step through them across pages, and
the count says where you are. It reads the same text layer the page is drawn from, so a scan has
nothing to search until OCR has run. The page box takes a typed page number.

### Adding to the page

Text added with **Add to page** is typed on the page itself, shown in the font it will be saved
in: a new box takes the typing at once, and double-clicking a box (or pressing Enter on it) types
in it again. While an item is selected its controls (font, size, alignment, colour, Done) replace the
tool buttons in the ribbon, so the ribbon never changes height and there is no popout over the page.
Colour is a palette plus a colour picker for any colour, and is saved exactly as chosen. Delete an
item with the X on its corner or the Delete key; Escape or Done finishes with it. An empty text box
is dropped when you click away.

A new text box can be set in one of the document's own fonts: the font list names what the page
already carries alongside the built-in faces, so added text matches the page and no extra font is
embedded in the file.

### Finding your way around

The page comes first. Editable blocks are not outlined until you point at one; **Show all**
outlines them all at once when you want to survey a document. Devices without a pointer start with
everything shown, since there is no hover to rely on.

### Editing in place

The Edit text tab's controls — grouping, show-all, merge, split, font, size, text colour and
alignment — sit in the ribbon, so the page keeps the full width. Press a block once to select it,
then press Enter (or press it a second time) to put a caret in the text and type where it sits.
The block is shown as it will be saved: laid out with the chosen font's real widths, in the
chosen colour. Text re-wraps inside its block as it grows, and the ribbon says when a block has
gained lines and will run down over what sits below. Escape leaves the text.

### How willingly text is grouped

Documents disagree about how they store text: some draw a line one word at a time, some
scatter it. A **Grouping** slider — Tight to Loosest — changes how readily pieces are joined
into lines and paragraphs, re-groups the page as it moves, and is remembered. Normal is what
measurement supports: word gaps run to about 0.3 em while the gap to the next table column
starts around 1.7 em, so tables keep their columns while sentences come together. If a page
comes out with more boxes than it has lines, the tool says so and suggests loosening.

### Removing text that cannot be rewritten

Rewriting text needs its position, size and the font's character codes. Removing it only
needs to know which instructions draw it — so text the tool refuses to rewrite can still be
deleted. Select it and the panel says why it cannot be rewritten, and what else will go: one
drawing instruction sometimes covers more than the line you pointed at, and anything sharing
it is outlined on the page before you commit.

### Redaction

Redaction **deletes the text from the file** rather than covering it. The words are gone
from the saved document, not hidden under a rectangle, and a test checks the uncompressed
output to prove it. Mark an area, see how many lines it will remove, then choose whether the
area is blacked out, left blank, or left as it was.

After applying, the saved result is read back and the marked areas are checked for
surviving text. If anything is still there the tool says so and names it, rather than
letting you believe a redaction worked. Anything the box touches is removed **in full**. Trimming inside a line looks tidier but is
unsafe: a single word is often drawn as several pieces, and partial trimming leaves
fragments behind. Half a redacted word is still a disclosure, so size the box to what should
go. A test measures this by word coordinates — it reads the marker rectangle back out of the
saved file and asserts that nothing inside it survives a single pass.

It removes *text*. Anything drawn as part of a picture, and any scanned page, needs the
image itself handled — the tool says so rather than letting you assume a scan is redacted.

## Installing it as an app

The hosted copy can be installed as an app (Chrome: the install icon in the address bar, or
menu → Cast, save and share → Install). Once installed it declares itself a handler for
`.pdf`, so:

- **Windows** — it appears under right-click → Open with, and in Settings → Apps → Default
  apps → `.pdf` if you want it as the default.
- **ChromeOS** — it appears in the Files app under Open with.

A PDF opened that way lands straight in the editor. The app also registers a service worker
that caches the page, so it keeps working after the network goes away — verified by a test
that loads it, removes the network, reloads, and then opens and renders a PDF.

The service worker caches this one page and refuses anything from another origin. The page
itself still makes no network requests of any kind.

Installing requires the hosted copy over HTTPS; a downloaded `index.html` opened from disk
cannot be installed, but works offline anyway without any of this.

## Running it offline

Download `index.html` and open it. It works with no network at all: every library, font and
the OCR engine are inside the file. That isn't an aspiration — a test blocks all network
access at the browser level and then exercises the tool end to end on every build.

## Checking it works in your browser

Press **Check this browser** on the opening screen, or add `#selftest` to the address. It
builds a PDF, renders it, rewrites a line, removes text and reads it back, generates a
signing key, and encrypts a file — in whatever browser is running it — then reports what
worked and what did not, along with the browser it ran in.

Development testing runs in headless Chromium. This is how you find out whether a
Chromebook, an iPad or Safari behaves the same, without taking anyone's word for it.

## Building from source

```bash
chmod +x *.sh       # once, after unpacking: the archive cannot carry the executable bit
./fetch-deps.sh     # downloads each pinned library, verifying its SHA-512 (once)
./build.sh          # builds everything, then runs every test suite
```

That produces:

```
dist/                      the site: index.html, manifest, icons, service worker
dist/pdf-tool-kit.html     one self-contained file for offline use
```

Publish `dist/` for GitHub Pages; hand out `dist/pdf-tool-kit.html` for a share, a USB
stick, or deployment to machines. The offline copy is the same page with the installed-app
pieces removed, since a manifest and a service worker mean nothing on a `file://` copy.

`./build.sh --no-test` skips the suites. `python3 build.py` still works on its own if you
only want the site.

### The PDF corpus

`tests/corpus.js` runs about 65 different PDFs through the tool's main flows: open and render, rotate a
page, remove hidden info, compress, edit a word in place and redact a line. Every saved result is
checked by tools that are not the code under test (`qpdf --check`, `pikepdf`, `pdftotext`, `pdftoppm`):
the structure must be valid, the page count unchanged, the edit present and the redacted word gone,
and bookmarks, form fields, layers, page labels and tags must survive a rotation.

The files come from `tests/fixtures/mkcorpus.py` and `mkchrome.js`, so nothing is a binary in the repo:

- **Producers:** reportlab (standard-14 and embedded TrueType, forms, outlines, 150 pages, CJK,
  Hebrew, Devanagari), LibreOffice Writer/Calc (plain, PDF/A-1b, tagged), headless Chromium, and
  poppler's Cairo.
- **Versions and structure:** PDF 1.3, 1.5 with object streams, 1.7 linearized, 2.0, uncompressed,
  and an incremental update with two revisions.
- **Content streams:** kerned `TJ` arrays, `Tc/Tw/Tz/Ts`, split streams, nested transforms, text
  matrices, Form XObjects, invisible OCR text, escapes, inline images, filter chains, and marked content.
- **Geometry:** CropBox (also offset), UserUnit, all rotations, negative and reversed MediaBoxes,
  inherited attributes, mixed page sizes.
- **Privacy and extras:** XMP, JavaScript, attachments, annotations, layers, page labels.
- **Damaged files:** truncated, wrong cross-reference offsets, missing `%%EOF`, bytes before the
  header, a lying `/Length`. These must open or be refused with a message, never hang.

```bash
python3 fixtures/mkcorpus.py && node fixtures/mkchrome.js   # build the corpus (skips what isn't installed)
node corpus.js                                              # run it  (CORPUS_ONLY='^lo-' to filter, CORPUS_JOBS=4)
```

Finding a new problem in a real file? Reproduce it as a small entry in `mkcorpus.py` so it stays fixed.

The other suites drive a real headless Chromium and check the output with external tools —
`qpdf`, `pikepdf`, `pyHanko`, `pdftotext` and OpenSSL — rather than trusting the code that
produced it.

### Continuous integration

`.github/workflows/test.yml` runs on every push to `main` and every pull request: it fetches the
pinned libraries (SHA-512 verified), builds, checks that the `index.html` and `sw.js` committed for
GitHub Pages are exactly what that build produces (a stale `sw.js` keeps returning visitors on the
old page), and runs all five suites in headless Chromium. If that check fails, run `./build.sh`
and commit the result.

### Keeping the embedded libraries current

Nothing updates itself at run time; the file you ship is the file that runs. Updating a
library means re-pinning, rebuilding and re-testing:

```bash
./check-updates.sh              # report what is pinned vs. what is released
./check-updates.sh --apply      # re-pin, fetch, rebuild, and run every suite
```

`--apply` stops at the first failure and keeps a timestamped backup of the pins, so a bad
upgrade never quietly becomes the published file.

pdf.js, the pdf-lib fork and the OCR engine are held to their current major version on
purpose: those change APIs across majors, and the OCR engine must stay in step with its
language data. Moving them is a deliberate decision, not an automatic one.

## Security

The page runs under a strict Content-Security-Policy with no network access and no `eval`, and
treats every PDF as hostile input. `SECURITY.md` has the latest assessment: what was found and
fixed, what was reviewed, and what is still open (notably that node-forge has no patched
release yet, so signature checking is done by the tool's own strict RSA check).

## Third-party components

| Component | Licence |
|---|---|
| @cantoo/pdf-lib (maintained pdf-lib fork) | MIT |
| pdf.js | Apache-2.0 |
| node-forge | BSD-3-Clause |
| tesseract.js-core and language data | Apache-2.0 |
| Inter, Barlow Condensed, Great Vibes, Dancing Script, Allura | OFL-1.1 |
| Homemade Apple | Apache-2.0 |

Each is named in a comment beside its inlined code in the built file.

## Known limits

- Redaction removes text, not pixels: scanned pages and text inside images are unaffected.
- A re-wrapped paragraph can grow downwards over what sits below it; the tool warns, but
  does not push later paragraphs down.
- Replacement text falls back to a built-in font when the document's own font lacks a
  character you typed, and says which character caused it.
- Edited (existing) text blocks keep their original colour unless you change it in the ribbon.
- Verified in Chromium. Safari, iOS and ChromeOS are untested.

## Licence

MIT — see `LICENSE`. The embedded third-party components keep their own licences.
