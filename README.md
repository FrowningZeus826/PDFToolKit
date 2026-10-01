# PDF Tool Kit

A complete PDF toolkit in a single HTML file. View, edit, fill forms, sign, organise pages,
OCR, compress, protect and redact — all in the browser. No upload, no account, no server.

**[Open the tool](https://YOURUSERNAME.github.io/PDFToolKit/)**

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

### Redaction

Redaction **deletes the text from the file** rather than covering it. The words are gone
from the saved document, not hidden under a rectangle, and a test checks the uncompressed
output to prove it. Mark an area, see how many lines it will remove, then choose whether the
area is blacked out, left blank, or left as it was.

It removes *text*. Anything drawn as part of a picture, and any scanned page, needs the
image itself handled — the tool says so rather than letting you assume a scan is redacted.

## Running it offline

Download `index.html` and open it. It works with no network at all: every library, font and
the OCR engine are inside the file. That isn't an aspiration — a test blocks all network
access at the browser level and then exercises the tool end to end on every build.

## Building from source

```bash
./fetch-deps.sh                 # downloads each pinned library, verifying its SHA-512
python3 build.py                # assembles index.html
cd tests
npm install
bash fixtures/make-fixtures.sh  # generates the test PDFs
npm test                        # suite.js, edits.js, adv.js, offline.js
```

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
