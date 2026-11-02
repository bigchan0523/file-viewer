#!/usr/bin/env bash
# pdf.js 와 rhwp 를 npm 에서 받아 app/src/main/assets/vendor 에 넣는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/src/main/assets/vendor"
PDFJS_VERSION="${PDFJS_VERSION:-4.10.38}"
RHWP_VERSION="${RHWP_VERSION:-latest}"

TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm install --no-audit --no-fund "pdfjs-dist@$PDFJS_VERSION" "@rhwp/core@$RHWP_VERSION"

rm -rf "$OUT"
mkdir -p "$OUT/pdfjs" "$OUT/rhwp"

# ---------- pdf.js (구형 WebView 호환 legacy 빌드) ----------
P=node_modules/pdfjs-dist
SRC="$P/legacy/build"; [ -f "$SRC/pdf.mjs" ] || SRC="$P/build"
cp "$SRC/pdf.mjs" "$OUT/pdfjs/pdf.js"
cp "$SRC/pdf.worker.mjs" "$OUT/pdfjs/pdf.worker.js"
cp -r "$P/cmaps" "$P/standard_fonts" "$OUT/pdfjs/"
[ -d "$P/wasm" ] && cp -r "$P/wasm" "$OUT/pdfjs/" || true

# ---------- rhwp ----------
R=node_modules/@rhwp/core
echo "===== @rhwp/core package ====="
cat "$R/package.json"
find "$R" -type f | sed "s#^$R/##" | sort
du -sh "$R"

cp -r "$R/." "$OUT/rhwp/"
rm -rf "$OUT/rhwp/node_modules"

MAIN="$(node -e "const p=require('./$R/package.json'); const m=(p.module||p.main||'rhwp.js'); console.log(require('path').posix.normalize(m).replace(/^\.\//,''))")"
WASM="$(cd "$R" && find . -name '*.wasm' | head -1 | sed 's#^\./##')"
[ -n "$WASM" ] || { echo "rhwp wasm not found"; exit 1; }

cat > "$OUT/rhwp/entry.js" <<EOF
export { default } from './$MAIN';
export * from './$MAIN';
export const WASM_URL = new URL('./$WASM', import.meta.url).href;
EOF
echo "entry -> $MAIN , wasm -> $WASM"

echo "===== @rhwp/core API (d.ts) ====="
find "$R" -name '*.d.ts' -exec cat {} \; | head -400 || true

echo "===== vendor size ====="
du -sh "$OUT"/*
