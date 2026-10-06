# Security

PDF Tool Kit runs entirely in the browser. There is no server, no account and no upload, so
the things worth protecting are the **files you open**, the **signing keys you load or create**,
and the **integrity of the page itself** (what is published and what the browser runs).

To report a problem, open a private security advisory on the repository
(Security → Report a vulnerability) rather than a public issue.

## Assessment (October 2026)

Method: manual review of `app.js`, `body.html`, `build.py`, `sw.js`, the manifest and the CI
workflow; `npm audit` against every pinned runtime library and the test dependencies; and the
existing suites, including a test that blocks all network access and one that checks the
Content-Security-Policy for violations.

### Fixed in this assessment

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | **Signature checking could be fooled.** *Check signatures* used node-forge's RSA verifier. node-forge 1.4.0 (the latest release; no patched version exists) accepts extra bytes inside the signature's DigestInfo — advisory GHSA-86w9-cpqp-85rv, an incomplete fix for CVE-2026-33894 — which lets someone forge a signature for a low-exponent RSA key. A document could be shown as validly signed when it was not. | RSA verification is now done in the tool: it recovers the padded block with the public key and compares **every byte** against the single permitted encoding (`00 01 FF… 00 ‖ DigestInfo ‖ hash`). Public exponents below 65537 and keys under 1024 bits are refused. node-forge is still used to parse certificates and build signatures, which this advisory does not touch. |
| 2 | Low | Digital-ID files (`.pfx`) were protected with forge's default 2,048 key-derivation iterations, which makes a stolen file cheap to brute-force. | Created `.pfx` files now use 100,000 iterations (AES-256). Existing IDs you load still open as before. |
| 3 | Low | **Compress** trusted an image's declared size. A crafted PDF declaring hundreds of megapixels could exhaust memory in the tab. | Images over 100 megapixels are skipped (left untouched), like other images the compressor can't handle. |

### Reviewed, no action needed

| Area | Result |
|---|---|
| **Script injection / XSS** | The page's CSP is `default-src 'none'`, scripts allowed only by SHA-256 hash of each inline script, **no `unsafe-eval`**, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `img-src data: blob:`. The offline build also sets `connect-src 'none'`; the hosted build allows `'self'` only, for its service worker. A test fails the build on any CSP violation. |
| **DOM injection** | Every `innerHTML` assignment is either a clear (`= ""`) or a constant string. Text that comes from a PDF (metadata, field values, signer names, file names) is always written with `textContent`. No `eval`, `new Function`, `document.write`, `postMessage` or `window.open`. |
| **Hostile PDFs** | pdf.js runs with `isEvalSupported: false`, `enableXfa: false` and scripting off; PDF JavaScript is never executed. Fonts come from the page, not the network. Files over 250 MB are refused up front. A malformed file can fail to open or exhaust the tab's own memory; it cannot reach anything outside the tab. |
| **Network exposure** | No requests are made by the page. The service worker handles same-origin GETs only and never fetches another origin. Verified by the offline suite. |
| **Stored data** | Only three things persist, all in this browser's `localStorage`: a saved signature image (validated as a PNG data URL of sane size before use), the grouping setting, and ribbon/outline preferences. Digital IDs live in memory only and are forgotten on close or **Clear**. |
| **Encryption** | PDF passwords use AES-256 (or AES-128 on request) per the PDF 2.0 key derivation. Signing keys are generated with WebCrypto (OS random source), 2048-bit RSA, with forge's generator as a fallback. |
| **Redaction** | Text is deleted from the file, then the saved result is read back and checked for survivors. Pixels are not touched — see *Known limits* in the README. |
| **Supply chain (runtime)** | Every library is pinned to an exact version and its tarball's SHA-512 is checked against the registry by `fetch-deps.sh` before use. `pdfjs-dist 4.10.38` is past the font-evaluation flaw fixed in 4.2.67 (CVE-2024-4367). `npm audit` reports nothing else for the runtime libraries. |

### Open items and recommendations

| Severity | Item | Notes |
|---|---|---|
| Medium | **node-forge has no patched release.** | Mitigated for signature checking (fix 1). Re-check with `./check-updates.sh` and upgrade when a fixed version ships. |
| Low | **Test-only dependencies** (`puppeteer-core`, `@sparticuz/chromium` and their transitive packages, e.g. `extract-zip`) have reported advisories. | They are never shipped or run by visitors, only by the test suites against local fixtures. Upgrading is a breaking change to the test harness; schedule it separately. |
| Low | `fetch-deps.sh` verifies a download against the registry's own hash. That catches corruption and a swapped tarball, not a compromised registry entry. | Commit the expected hashes (a lockfile for the vendored libraries) to close this. |
| Low | GitHub Actions are referenced by tag (`actions/checkout@v4` …). | Pin to commit SHAs and enable Dependabot for the workflow. |
| Info | **Clickjacking:** GitHub Pages cannot send `X-Frame-Options` / `frame-ancestors`, and a `<meta>` CSP ignores `frame-ancestors`. | The page holds no session or secret an attacker could trick you into acting on, so the impact is limited to a framed look-alike. Serving from a host that can set headers would add it. |
| Info | `style-src 'unsafe-inline'` is needed for the page's inline styles. | Nothing injects markup, so this is not currently exploitable. |
| Info | Self-signed IDs: Adobe shows "validity unknown" until the recipient trusts the `.cer`. | Expected; the tool says so. |

## Keeping it that way

- `./check-updates.sh` reports pinned vs. released versions of every embedded library.
- CI runs all suites on every pull request, including the CSP-violation and no-network checks.
- Run `npm audit` in `tests/` and against the pinned runtime set (`fetch-deps.sh` lists it) when
  changing dependencies.
