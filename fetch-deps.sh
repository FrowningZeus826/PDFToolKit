#!/usr/bin/env bash
# Fetch and verify every third-party dependency for PDF Tool Kit.
#
# Each package is pinned to an exact version. After download, the tarball's SHA-512 is
# compared against the integrity hash published by the npm registry, so a tampered or
# corrupted download stops the build instead of ending up inside the tool.
#
# Usage:  ./fetch-deps.sh        (needs network + node/npm; run once, or after changing a version)
set -euo pipefail
cd "$(dirname "$0")"

PKGS=(
  "@cantoo/pdf-lib@2.11.1"
  "pdfjs-dist@4.10.38"
  "node-forge@1.4.0"
  "tesseract.js-core@6.1.2"
  "@tesseract.js-data/eng@1.0.0"
  "@tesseract.js-data/spa@1.0.0"
  "@fontsource/inter@5.3.0"
  "@fontsource/barlow-condensed@5.3.0"
  "@fontsource/great-vibes@5.3.0"
  "@fontsource/dancing-script@5.3.0"
  "@fontsource/allura@5.3.0"
  "@fontsource/homemade-apple@5.3.0"
)

# where each package's contents must end up (build.py expects these paths)
dest_for () {
  case "$1" in
    "@cantoo/pdf-lib")            echo "cantoo/node_modules/@cantoo/pdf-lib" ;;
    "pdfjs-dist")                 echo "pdfjs4" ;;
    "node-forge")                 echo "vend/node-forge-1.4.0" ;;
    "tesseract.js-core")          echo "vend/tesseract.js-core-6.1.2" ;;
    "@tesseract.js-data/eng")     echo "vend/tesseract.js-data-eng-1.0.0" ;;
    "@tesseract.js-data/spa")     echo "vend/spa" ;;
    "@fontsource/inter")          echo "fonts/fontsource-inter-5.3.0" ;;
    "@fontsource/barlow-condensed") echo "fonts/fontsource-barlow-condensed-5.3.0" ;;
    "@fontsource/great-vibes")    echo "fonts/fontsource-great-vibes-5.3.0" ;;
    "@fontsource/dancing-script") echo "fonts/fontsource-dancing-script-5.3.0" ;;
    "@fontsource/allura")         echo "fonts/fontsource-allura-5.3.0" ;;
    "@fontsource/homemade-apple") echo "fonts/fontsource-homemade-apple-5.3.0" ;;
  esac
}

mkdir -p .tarballs
for spec in "${PKGS[@]}"; do
  name="${spec%@*}"; [ "${spec:0:1}" = "@" ] && name="@${spec:1}" && name="${name%@*}"
  ver="${spec##*@}"
  echo "==> $name@$ver"
  want=$(npm view "$spec" dist.integrity)
  tgz=$(cd .tarballs && npm pack "$spec" 2>/dev/null | tail -1)
  got="sha512-$(openssl dgst -sha512 -binary ".tarballs/$tgz" | openssl base64 -A)"
  if [ "$want" != "$got" ]; then
    echo "INTEGRITY MISMATCH for $spec" >&2
    echo "  registry: $want" >&2
    echo "  download: $got" >&2
    exit 1
  fi
  echo "    integrity OK  ($want)"
  dest=$(dest_for "$name")
  rm -rf "$dest"; mkdir -p "$dest"
  tar xzf ".tarballs/$tgz" -C "$dest"
done

# @cantoo/pdf-lib is also used by the Node-side tests, so install it normally there too
if [ -d tests ]; then (cd tests && npm install --silent --no-audit --no-fund >/dev/null 2>&1 || true); fi

echo
echo "All dependencies fetched and verified. Next: python3 build.py"
