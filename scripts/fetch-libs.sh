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

# ---------- SheetJS (엑셀: xlsx/xls/csv/ods) — 공식 배포처에서 받음 ----------
XLSX_VERSION="${XLSX_VERSION:-0.20.3}"
npm install --no-audit --no-fund "https://cdn.sheetjs.com/xlsx-$XLSX_VERSION/xlsx-$XLSX_VERSION.tgz"
X=node_modules/xlsx
mkdir -p "$OUT/xlsx"
cp "$X/xlsx.mjs" "$OUT/xlsx/xlsx.mjs"
if [ -f "$X/dist/cpexcel.full.mjs" ]; then cp "$X/dist/cpexcel.full.mjs" "$OUT/xlsx/"; else echo "cpexcel not found"; fi
cp "$X/LICENSE" "$OUT/xlsx/" 2>/dev/null || true
ls -la "$OUT/xlsx"

# ---------- pdf-lib (채운 서류를 PDF로 저장) ----------
npm install --no-audit --no-fund "pdf-lib@1.17.1"
mkdir -p "$OUT/pdflib"
cp node_modules/pdf-lib/dist/pdf-lib.min.js "$OUT/pdflib/"
cp node_modules/pdf-lib/LICENSE.md "$OUT/pdflib/" 2>/dev/null || true

# ---------- 워드(docx-preview) · PPT(pptx-renderer / pptx-viewer) — 별도 폴더에서 esbuild 로 한 파일씩 묶음 ----------
OFFDIR="$(mktemp -d)"
(
  set +e
  cd "$OFFDIR"
  npm init -y >/dev/null
  npm install --no-audit --no-fund --legacy-peer-deps docx-preview jszip html-to-image @aiden0z/pptx-renderer pptx-viewer esbuild
  mkdir -p "$OUT/office"
  echo "export { renderAsync } from 'docx-preview';" > entry-docx.mjs
  echo "export * from '@aiden0z/pptx-renderer';" > entry-pptx.mjs
  echo "export * from 'pptx-viewer';" > entry-pptx2.mjs
  echo "export { toCanvas } from 'html-to-image';" > entry-h2i.mjs
  for e in entry-docx entry-pptx entry-pptx2 entry-h2i; do
    npx esbuild "$e.mjs" --bundle --format=esm --minify --target=es2020 --outdir="$OUT/office" \
      --loader:.woff2=dataurl --loader:.woff=dataurl --loader:.ttf=dataurl --loader:.wasm=binary || echo "esbuild failed: $e"
  done
  for pkg in docx-preview html-to-image @aiden0z/pptx-renderer pptx-viewer; do
    echo "===== $pkg ====="
    node -e "const p=require('$OFFDIR/node_modules/$pkg/package.json'); console.log(p.version, p.license, p.main, p.module, p.types||p.typings)"
  done
  echo "===== pptx-renderer d.ts ====="
  find node_modules/@aiden0z/pptx-renderer -name '*.d.ts' | head -20
  for f in $(find node_modules/@aiden0z/pptx-renderer -name 'index.d.ts' | head -2); do
    grep -nE "export|open|setFitMode|setZoom|renderList|Options|fitMode|windowed|zoom|width" "$f" | head -120
  done
  echo "===== pptx-viewer d.ts ====="
  for f in $(find node_modules/pptx-viewer -name 'index.d.ts' | head -2); do
    grep -nE "export|renderSlide|loadPresentation|width|height" "$f" | head -60
  done
  ls -la "$OUT/office"
)

# ---------- (조사) 한글 편집기 rhwp-studio 를 앱 안에 넣을 수 있는지 ----------
(
  set +e
  ED="$(mktemp -d)"; cd "$ED"
  npm init -y >/dev/null
  npm install --no-audit --no-fund @rhwp/editor >/dev/null 2>&1
  echo "===== @rhwp/editor files ====="
  find node_modules/@rhwp/editor -type f | sed 's#node_modules/@rhwp/editor/##' | sort
  cat node_modules/@rhwp/editor/package.json
  find node_modules/@rhwp/editor -name '*.d.ts' -exec cat {} \; | head -150
  echo "===== rhwp repo ====="
  RV="$(node -p "require('$TMP/node_modules/@rhwp/core/package.json').version")"
  git clone --depth 1 --branch "v$RV" https://github.com/edwardkim/rhwp.git rhwp 2>&1 | tail -2 || true
  [ -d rhwp ] || git clone --depth 1 https://github.com/edwardkim/rhwp.git rhwp 2>&1 | tail -2
  cd rhwp && git log -1 --format='%H %d %s' && ls
  echo "--- studio package.json"; cat rhwp-studio/package.json
  echo "--- studio vite config"; cat rhwp-studio/vite.config.* 2>/dev/null | head -60
  echo "--- wasm imports"; grep -rn "pkg/\|@rhwp/core\|rhwp_bg\|from '.*rhwp" rhwp-studio/src | head -20
  echo "--- tags"; git ls-remote --tags https://github.com/edwardkim/rhwp.git | tail -10
)

echo "===== vendor size ====="
du -sh "$OUT"/*
