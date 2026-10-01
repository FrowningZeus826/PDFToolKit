#!/usr/bin/env bash
# Check whether any embedded library has a newer release, and optionally move to it.
#
# Everything this tool runs on is baked into the HTML file, so "updating" means changing a
# pinned version here, re-fetching, rebuilding and re-testing. Nothing updates itself at
# run time, by design — the file you ship is the file that runs.
#
#   ./check-updates.sh              report what is pinned and what is available
#   ./check-updates.sh --apply      rewrite the pins in fetch-deps.sh to the newest
#                                   compatible release, then fetch, build and test
#
# --apply stops at the first failure and leaves a backup of fetch-deps.sh, so a bad
# upgrade never silently becomes the thing you hand to people.
set -euo pipefail
cd "$(dirname "$0")"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# Packages whose major version must not move without a human reading the release notes:
# pdf.js and the pdf-lib fork both change their APIs across majors, and the OCR engine must
# stay in step with its language data.
PIN_MAJOR=("pdfjs-dist" "@cantoo/pdf-lib" "tesseract.js-core")

current_pins() { grep -oE '"[^"]+@[0-9][^"]*"' fetch-deps.sh | tr -d '"'; }

newest_for() {                      # newest release, respecting a major-version pin
  local name="$1" major="$2" pinned=0
  for p in "${PIN_MAJOR[@]}"; do [[ "$p" == "$name" ]] && pinned=1; done
  if [[ $pinned == 1 ]]; then
    npm view "${name}@^${major}" version 2>/dev/null | tail -1 | awk '{print $NF}' | tr -d "'"
  else
    npm view "$name" version 2>/dev/null
  fi
}

command -v npm >/dev/null || { echo "npm is needed to check versions"; exit 1; }

echo "Embedded libraries"
echo "------------------"
updates=()
while read -r pin; do
  [[ -z "$pin" ]] && continue
  name="${pin%@*}"; [[ "$pin" == @*/*@* ]] && name="@${pin#@}" && name="${name%@*}"
  have="${pin##*@}"
  want="$(newest_for "$name" "${have%%.*}")"
  [[ -z "$want" ]] && want="$have"
  if [[ "$want" != "$have" ]]; then
    printf '  %-34s %-12s -> %s  UPDATE AVAILABLE\n' "$name" "$have" "$want"
    updates+=("$name|$have|$want")
  else
    printf '  %-34s %-12s   up to date\n' "$name" "$have"
  fi
done < <(current_pins)

if [[ ${#updates[@]} -eq 0 ]]; then
  echo
  echo "Everything is current. Nothing to do."
  exit 0
fi

echo
echo "${#updates[@]} update(s) available."
if [[ $APPLY == 0 ]]; then
  echo "Re-run with --apply to update the pins, rebuild and test."
  exit 0
fi

cp fetch-deps.sh "fetch-deps.sh.bak.$(date +%Y%m%d%H%M%S)"
for u in "${updates[@]}"; do
  IFS='|' read -r name have want <<< "$u"
  sed -i "s|\"${name}@${have}\"|\"${name}@${want}\"|" fetch-deps.sh
  echo "pinned ${name} -> ${want}"
done

echo
echo "==> fetching (each tarball's SHA-512 is checked against the registry)"
./fetch-deps.sh

echo
echo "==> rebuilding"
python3 build.py

echo
echo "==> testing (this is the part that decides whether the upgrade is good)"
cd tests
npm install --silent --no-audit --no-fund
node suite.js
node edits.js
node adv.js
node offline.js
cd ..

echo
echo "All suites passed on the updated libraries."
echo "Check the version strings in the page comments, then re-read the licence list:"
grep -o '<!-- [^>]*(\(MIT\|Apache-2.0\|BSD-3-Clause\|OFL-1.1\)[^>]*-->' dist/index.html | head -20 || true
echo
echo "If anything failed above, restore the newest fetch-deps.sh.bak.* and re-run ./fetch-deps.sh."
