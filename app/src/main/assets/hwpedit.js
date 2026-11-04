// 한글(HWP/HWPX) 편집 모드 — rhwp-studio 편집기를 앱 안에 띄우고, 저장·내보내기 메뉴를 붙임
import { createEditor } from './vendor/rhwpeditor/index.js';

const q = new URLSearchParams(location.search);
const docId = q.get('doc');
const name = q.get('name') || '문서.hwp';
const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'hwp').toLowerCase();
const base = name.replace(/\.[^.]+$/, '') || '문서';

const A = window.Android || {
  setDoc() {}, setFillable() {}, setFillMode() {}, overwrite() { return false; },
  saveFile2(n, m, b, open) { window.__lastSave = { n, m, len: b.length }; setTimeout(() => window.onSaved(true), 30); },
  shareFile(n, m, b) { window.__lastShare = { n, m, len: b.length }; },
  printPdf(n, b) { window.__lastPrint = { n, len: b.length }; },
};

const $ = (s) => document.querySelector(s);
const MIME = { hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf' };
let editor = null, origSize = 0, dirty = false, saving = false;

function setDirty(v) {
  dirty = v;
  window.__dirty = v;
  $('#state').textContent = v ? '편집 중 · 저장 안 됨' : '편집 중';
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function busy(text) {
  $('#busy').hidden = !text;
  if (text) $('#busyText').textContent = text;
}

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ 시작

A.setDoc(docId, name);
A.setFillable(true);
A.setFillMode(true);
// 위쪽 연필 버튼 = 편집 끝내기
window.toggleFill = () => leave();

try {
  editor = await createEditor('#editor', { studioUrl: new URL('studio/', location.href).href });
  const buf = await (await fetch('/doc/' + docId)).arrayBuffer();
  origSize = buf.byteLength;
  await editor.loadFile(buf, name);
  busy('');
  watchChanges();
} catch (e) {
  console.error(e);
  busy('');
  $('#editor').innerHTML = `<div style="padding:40px 20px;text-align:center;color:#6b7280">편집기를 열지 못했어요.<br><small>${String(e.message || e)}</small></div>`;
}

function watchChanges() {
  try { editor.onDocumentChanged(() => setDirty(true)); } catch {}
  // 편집기 화면(같은 출처 iframe)에서 입력이 생기면 "저장 안 됨" 표시
  const hook = () => {
    const doc = document.querySelector('#editor iframe')?.contentDocument;
    if (!doc) return setTimeout(hook, 500);
    const mark = (e) => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
      setDirty(true);
    };
    for (const ev of ['keydown', 'beforeinput', 'paste', 'cut', 'drop', 'compositionend']) doc.addEventListener(ev, mark, true);
  };
  hook();
}

// ------------------------------------------------------------------ 내보내기

async function bytesOf(fmt) {
  return fmt === 'hwpx' ? editor.exportHwpx() : editor.exportHwp();
}

/** 원래 형식으로 꺼내기. HWPX 저장이 안 되면 HWP로 */
async function nativeBytes() {
  if (ext === 'hwpx') {
    try { return { bytes: await bytesOf('hwpx'), fmt: 'hwpx' }; }
    catch (e) { console.warn('hwpx export failed', e); return { bytes: await bytesOf('hwp'), fmt: 'hwp', fellBack: true }; }
  }
  return { bytes: await bytesOf('hwp'), fmt: 'hwp' };
}

let pdfLibReady = null;
function loadPdfLib() {
  pdfLibReady ||= new Promise((res, rej) => {
    if (window.PDFLib) return res(window.PDFLib);
    const sc = document.createElement('script');
    sc.src = 'vendor/pdflib/pdf-lib.min.js';
    sc.onload = () => res(window.PDFLib);
    sc.onerror = () => rej(new Error('pdf-lib 로드 실패'));
    document.head.appendChild(sc);
  });
  return pdfLibReady;
}
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('페이지 그림 변환 실패')); i.src = src; });
const canvasBytes = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => b ? b.arrayBuffer().then((ab) => res(new Uint8Array(ab))) : rej(new Error('이미지 변환 실패')), type, q));

function svgSize(svg) {
  const head = svg.slice(0, 2000);
  const vb = head.match(/viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (vb) return { w: +vb[1], h: +vb[2] };
  const w = head.match(/<svg[^>]*\swidth="([\d.]+)/), h = head.match(/<svg[^>]*\sheight="([\d.]+)/);
  return w && h ? { w: +w[1], h: +h[1] } : { w: 793.7, h: 1122.5 };
}

/** 지금 편집 상태를 PDF로 (페이지를 그림으로 그려서 합침) */
async function makePdf() {
  const hwp = await bytesOf('hwp');
  const m = await import('./vendor/rhwp/entry.js');
  if (!globalThis.measureTextWidth) {
    const ctx = document.createElement('canvas').getContext('2d');
    globalThis.measureTextWidth = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
  }
  await m.default({ module_or_path: m.WASM_URL });
  const doc = new m.HwpDocument(hwp);
  const n = doc.pageCount();
  const PL = await loadPdfLib();
  const out = await PL.PDFDocument.create();
  const PX = 1600;
  for (let i = 0; i < n; i++) {
    busy(`PDF 만드는 중… ${i + 1} / ${n}`);
    const svg = doc.renderPageSvg(i);
    const { w, h } = svgSize(svg);
    const c = document.createElement('canvas');
    c.width = PX; c.height = Math.round(PX * h / w);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { ctx.drawImage(await loadImg(url), 0, 0, c.width, c.height); } finally { URL.revokeObjectURL(url); }
    const jpg = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9));
    out.addPage([w * 0.75, h * 0.75]).drawImage(jpg, { x: 0, y: 0, width: w * 0.75, height: h * 0.75 });
    c.width = c.height = 0;
  }
  try { doc.free?.(); } catch {}
  return out.save();
}

// ------------------------------------------------------------------ 메뉴 동작

window.onSaved = (ok) => {
  saving = false;
  busy('');
  if (ok) { setDirty(false); toast('저장했어요'); try { editor.notifySaved(name); } catch {} }
};

async function run(label, fn) {
  if (saving || !editor) return;
  saving = true;
  busy(label);
  try { await fn(); }
  catch (e) { console.error(e); toast('실패했어요: ' + (e.message || e), 5000); saving = false; busy(''); }
}

const actions = {
  save: () => run('저장하는 중…', async () => {
    const { bytes, fmt, fellBack } = await nativeBytes();
    window.__lastBytes = bytes;
    const b64 = toB64(bytes);
    if (!fellBack && A.overwrite(b64)) { saving = false; busy(''); window.onSaved(true); return; }
    if (fellBack) toast('HWPX로는 아직 저장이 안 돼서 HWP로 저장해요', 4000);
    A.saveFile2(fellBack ? `${base}.hwp` : name, MIME[fmt], b64, false);
  }),
  saveAs: () => run('파일 만드는 중…', async () => {
    const { bytes, fmt, fellBack } = await nativeBytes();
    window.__lastBytes = bytes;
    if (fellBack) toast('HWPX로는 아직 저장이 안 돼서 HWP로 저장해요', 4000);
    A.saveFile2(`${base}_수정.${fmt}`, MIME[fmt], toB64(bytes), false);
  }),
  pdf: () => run('PDF 만드는 중…', async () => {
    const pdf = await makePdf();
    window.__lastBytes = pdf;
    A.saveFile2(`${base}.pdf`, MIME.pdf, toB64(pdf), false);
  }),
  asHwp: () => run('HWP로 만드는 중…', async () => {
    const b = await bytesOf('hwp');
    window.__lastBytes = b;
    A.saveFile2(`${base}.hwp`, MIME.hwp, toB64(b), false);
  }),
  asHwpx: () => run('HWPX로 만드는 중…', async () => {
    let b;
    try { b = await bytesOf('hwpx'); }
    catch (e) { throw new Error('이 문서는 아직 HWPX로 바꿀 수 없어요. HWP나 PDF로 저장해 주세요.'); }
    window.__lastBytes = b;
    A.saveFile2(`${base}.hwpx`, MIME.hwpx, toB64(b), false);
  }),
  share: () => run('공유 준비 중…', async () => {
    const { bytes, fmt } = await nativeBytes();
    A.shareFile(`${base}.${fmt}`, MIME[fmt], toB64(bytes));
    saving = false; busy('');
  }),
  sharePdf: () => run('PDF 만드는 중…', async () => {
    const pdf = await makePdf();
    A.shareFile(`${base}.pdf`, MIME.pdf, toB64(pdf));
    saving = false; busy('');
  }),
  print: () => run('인쇄 준비 중…', async () => {
    const pdf = await makePdf();
    A.printPdf(base, toB64(pdf));
    saving = false; busy('');
  }),
  info: async () => {
    let pages = '?';
    try { pages = await editor.pageCount(); } catch {}
    const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    $('#info').innerHTML = `<div class="box"><h3>문서 정보</h3><table>
      <tr><td>파일 이름</td><td></td></tr>
      <tr><td>형식</td><td>${ext.toUpperCase()}</td></tr>
      <tr><td>쪽 수</td><td>${pages}쪽</td></tr>
      <tr><td>원본 크기</td><td>${kb(origSize)}</td></tr>
      <tr><td>상태</td><td>${dirty ? '저장 안 된 수정 있음' : '수정 없음 / 저장됨'}</td></tr>
    </table><button>닫기</button></div>`;
    $('#info td:nth-child(2)').textContent = name;
    $('#info').hidden = false;
    $('#info button').onclick = () => { $('#info').hidden = true; };
  },
};

function openSheet() {
  const s = $('#sheet');
  const item = (a, icon, label, note = '') => `<button data-a="${a}"><i>${icon}</i>${label}${note ? `<span class="note">${note}</span>` : ''}</button>`;
  s.innerHTML = `<div class="box">
    ${item('save', '💾', '저장', ext === 'hwpx' ? 'HWPX는 HWP로 저장될 수 있음' : '원본에 덮어쓰기')}
    ${item('pdf', '📄', 'PDF로 내보내기')}
    ${item('saveAs', '📝', '다른 이름으로 저장')}
    <div class="h">다른 포맷으로 내보내기</div>
    ${item('asHwp', '🅷', 'HWP로 내보내기')}
    ${item('asHwpx', '🆇', 'HWPX로 내보내기', '안 될 수도 있음')}
    <div class="h">기타</div>
    ${item('share', '↗', '공유', '수정한 한글 파일')}
    ${item('sharePdf', '↗', 'PDF로 공유')}
    ${item('print', '🖨', '인쇄')}
    ${item('info', 'ⓘ', '문서 정보')}
  </div>`;
  s.hidden = false;
  s.onclick = (e) => {
    const b = e.target.closest('button');
    s.hidden = true;
    if (b) actions[b.dataset.a]?.();
  };
}

function leave() {
  if (dirty && !confirm('저장 안 한 수정 내용이 있어요. 그냥 나갈까요?')) return;
  setDirty(false);
  history.length > 1 ? history.back() : location.replace('viewer.html');
}

$('#bMenu').onclick = openSheet;
$('#bSave').onclick = () => actions.save();
$('#bDone').onclick = leave;
