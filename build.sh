#!/usr/bin/env bash
# Build everything from source, in one step.
#
#   ./build.sh              build, then run the test suites
#   ./build.sh --no-test    build only
#
# Produces two things from the same code:
#
#   dist/                   the site: index.html plus the manifest, icons and service
#                           worker that make it installable. Publish this directory.
#   dist/pdf-tool-kit.html  one self-contained file for offline use. Put it on a share,
#                           a USB stick, or deploy it to machines; open it and it works
#                           with no network and no server.
#
# Dependencies must be fetched first (./fetch-deps.sh). That only needs doing once, or
# after changing a pinned version.
set -euo pipefail
cd "$(dirname "$0")"

RUN_TESTS=1
[[ "${1:-}" == "--no-test" ]] && RUN_TESTS=0

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

# A missing dependency here means fetch-deps.sh has not been run; say so plainly rather
# than failing deep inside the build with a path nobody recognises.
for d in cantoo pdfjs4 vend fonts; do
  [[ -d "$d" ]] || { echo "Missing ./$d — run ./fetch-deps.sh first."; exit 1; }
done

echo "==> building"
rm -rf dist && mkdir -p dist
OUT_DIR=dist python3 build.py

# The offline copy is the same page without the installed-app pieces: a manifest link and
# a service worker are meaningless on a file:// copy, and a missing manifest logs an error
# in the console for no reason.
echo "==> writing the offline single-file copy"
python3 - <<'PY'
import re
src = open('dist/index.html', encoding='utf-8').read()
out = re.sub(r'\s*<link rel="manifest"[^>]*>', '', src)
out = out.replace('window.__PDFKIT_PWA=1;', '')
# the script hashes in the policy must match what is left, so re-derive them
import base64, hashlib
blocks = re.findall(r'<script(?:\s+type="module")?>(.*?)</script>', out, re.S)
hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(b.encode('utf-8')).digest()).decode() + "'" for b in blocks]
out = re.sub(r"(script-src )[^;]*(;)",
             lambda m: m.group(1) + " ".join(hashes) + " 'wasm-unsafe-eval'" + m.group(2), out, count=1)
out = out.replace("manifest-src 'self'; worker-src 'self'; connect-src 'self'",
                  "manifest-src 'none'; worker-src 'none'; connect-src 'none'")
open('dist/pdf-tool-kit.html', 'w', encoding='utf-8').write(out)
print('    dist/pdf-tool-kit.html  %.1f MB' % (len(out.encode()) / 1e6))
PY

echo
echo "built:"
ls -la dist | awk 'NR>1 && $5 > 0 {printf "    %-28s %8.1f kB\n", $9, $5/1024}'

if [[ $RUN_TESTS == 1 ]]; then
  if [[ -d tests ]]; then
    echo
    echo "==> testing (headless Chromium plus qpdf/pikepdf/pyHanko where available)"
    (cd tests && npm install --silent --no-audit --no-fund >/dev/null 2>&1 || true
     [[ -d fx ]] || bash fixtures/make-fixtures.sh >/dev/null
     node suite.js && node edits.js && node adv.js && node offline.js && node pwa.js)
    echo
    echo "All suites passed."
  fi
else
  echo
  echo "Skipped the tests. Run ./build.sh without --no-test before publishing."
fi

# GitHub Pages serves the repo root, so keep the published copies there in step with dist/.
# sw.js matters most: its cache name changes with every build, and that change is what makes
# a browser that already has the app fetch the new page instead of serving the cached one.
if [[ "${SYNC_ROOT:-1}" == "1" && -f index.html && -f sw.js ]]; then
  for f in index.html sw.js manifest.webmanifest icon.svg icon-maskable.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png favicon-32.png; do cp "dist/$f" "$f"; done
  echo "==> synced the site files to the repo root"
fi

echo
echo "Publish dist/ for the site. Hand out dist/pdf-tool-kit.html for offline use."
