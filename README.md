# PDF Tool Kit

A complete PDF toolkit in a single HTML file. View, edit, fill forms, sign, organise pages,
OCR, compress, protect and redact — all in the browser. No upload, no account, no server.

**[Open the tool](https://frowningzeus826.github.io/PDFToolKit/)**

## What it does

| Tab | |
|---|---|
| **Document** | View, annotate, fill forms, place a signature, edit the text already in the PDF |
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

### One ribbon

Everything on the Document tab lives in a single ribbon, like a word processor's: **Add to page**,
**Fill form**, **Edit text**, **Redact** and **Whole document** are its tabs, and each tab shows
only its own controls. Page navigation and zoom sit beside the tabs and Apply is at the right end of the ribbon. The page takes the
full width; anything contextual (the signature builder, a selected object's properties, a form
field) floats over its edge instead of taking a column. For reading, the arrow at the end of the
tab row tucks the ribbon away (double-click the open tab does the same); picking a tab brings it
back. On a phone it starts tucked away so the document comes first.

**Find** (the magnifier beside the zoom controls, or Ctrl/Cmd+F) searches the whole document:
matches are highlighted on the page, Enter and Shift+Enter step through them across pages, and
the count says where you are. It reads the same text layer the page is drawn from, so a scan has
nothing to search until OCR has run.

Save and Undo are icons in the header, next to the file's name and what has changed (Ctrl+S
downloads what is open), so no row of the page is spent on them.

### Finding your way around

The page comes first. Editable blocks are not outlined until you point at one; a toggle in
the panel outlines them all at once when you want to survey a document. Devices without a
pointer start with everything shown, since there is no hover to rely on. The properties
panel only exists when something is selected, and floats beside the page rather than taking
a third of the width from it.

### Typing on the page

The controls sit in a ribbon above the page — grouping, show-all, merge, split, font and
size — so they stay in one place and the page keeps the full width. There is no side panel
for ordinary editing.

Press a block once to select it, then press Enter (or press it a second time) to put a caret
in the text and type where it sits. Text re-wraps inside its block as it grows, measured with
the document's own glyph widths, and the ribbon says when a block has gained lines and will
run down over what sits below. Escape leaves the text.

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

### Adding new text

A new text box can be set in one of the document's own fonts — the picker lists what the
page already carries alongside the built-in faces — so added text matches the page instead
of approximating it, and no extra font is embedded in the file.

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

The tests drive a real headless Chromium and check the output with external tools —
`qpdf`, `pikepdf`, `pyHanko`, `pdftotext` and OpenSSL — rather than trusting the code that
produced it.

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
- Verified in Chromium. Safari, iOS and ChromeOS are untested.

## Licence

MIT — see `LICENSE`. The embedded third-party components keep their own licences.
