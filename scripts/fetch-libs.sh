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

# ---------- 한글 편집기: rhwp-studio 를 직접 빌드해서 assets/studio 에 넣음 (인터넷 없이 동작) ----------
STUDIO_OUT="$ROOT/app/src/main/assets/studio"
rm -rf "$STUDIO_OUT"
(
  set +e
  RV="$(node -p "require('$TMP/node_modules/@rhwp/core/package.json').version")"
  ED="$(mktemp -d)"; cd "$ED"
  npm init -y >/dev/null
  npm install --no-audit --no-fund "@rhwp/editor@$RV" >/dev/null 2>&1 || npm install --no-audit --no-fund @rhwp/editor >/dev/null 2>&1
  mkdir -p "$OUT/rhwpeditor"
  cp node_modules/@rhwp/editor/*.js "$OUT/rhwpeditor/"
  echo "===== editor methods ====="
  grep -oE "(async )?[a-zA-Z]+\([a-zA-Z, ={}]*\) ?\{" node_modules/@rhwp/editor/index.js | sort -u | head -80
  grep -oE "'[a-zA-Z]+(:[a-zA-Z]+)?'" node_modules/@rhwp/editor/index.js | sort -u | head -80
  # 저장소가 매우 커서(문서·샘플 이미지 수만 개) 편집기 빌드에 필요 없는 폴더는 받지 않음
  git clone -q --depth 1 --filter=blob:none --sparse --branch "v$RV" https://github.com/edwardkim/rhwp.git rhwp \
    || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/edwardkim/rhwp.git rhwp
  ( cd rhwp && git sparse-checkout set --no-cone '/*' '!/mydocs/' '!/saved/' '!/samples/' '!/tests/' '!/fuzz/' \
      '!/gym/' '!/pdf/' '!/output/' '!/crates/' '!/src/' '!/bindings/' '!/rhwp-chrome/' '!/rhwp-firefox/' '!/rhwp-safari/' \
      '!/rhwp-ios/' '!/rhwp-desk/' '!/rhwp-vscode/' '!/fixtures/' '!/rhwp-studio/e2e/' '!/rhwp-studio/tests/' )
  du -sh rhwp
  echo "===== studio vite alias ====="
  grep -nE "alias|@wasm|pkg|base:|VitePWA\(|outDir|input" rhwp/rhwp-studio/vite.config.* | head -40
  mkdir -p rhwp/pkg
  cp "$TMP/node_modules/@rhwp/core/"*.js "$TMP/node_modules/@rhwp/core/"*.wasm "$TMP/node_modules/@rhwp/core/"*.d.ts rhwp/pkg/
  cd rhwp/rhwp-studio
  npm install --no-audit --no-fund 2>&1 | tail -3
  RHWP_WITHOUT_HWPCTRL=1 npx vite build --base=./ --outDir "$STUDIO_OUT" --emptyOutDir 2>&1 | tail -40
  # 앱에 필요 없는 것 정리 (예제 문서, 오프라인 캐시용 서비스워커)
  rm -rf "$STUDIO_OUT/samples" "$STUDIO_OUT/sw.js" "$STUDIO_OUT"/workbox-*.js "$STUDIO_OUT/registerSW.js" "$STUDIO_OUT/manifest.webmanifest"
  sed -i -e '/registerSW\.js/d' -e '/manifest\.webmanifest/d' "$STUDIO_OUT/index.html"
  cd "$ED/.." && rm -rf "$ED"
  echo "===== studio out ====="
  ls -la "$STUDIO_OUT" 2>&1 | head -30
  du -sh "$STUDIO_OUT" 2>&1
)

echo "===== vendor size ====="
du -sh "$OUT"/*
