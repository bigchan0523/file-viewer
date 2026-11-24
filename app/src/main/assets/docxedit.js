// 워드(docx) 편집 모드 — eigenpal docx-editor(Apache-2.0) + 저장·내보내기 메뉴
const q = new URLSearchParams(location.search);
const docId = q.get('doc');
const name = q.get('name') || '문서.docx';
const base = name.replace(/\.[^.]+$/, '') || '문서';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const A = window.Android || {
  setDoc() {}, setFillable() {}, setFillMode() {}, overwrite() { return false; },
  saveFile2(n, m, b) { window.__lastSave = { n, m, len: b.length }; setTimeout(() => window.onSaved(true), 30); },
  shareFile(n, m, b) { window.__lastShare = { n, m, len: b.length }; },
  printPdf(n, b) { window.__lastPrint = { n, len: b.length }; },
};
const $ = (s) => document.querySelector(s);
let sd = null, origSize = 0, dirty = false, saving = false, ready = false;

function setDirty(v) { dirty = v; window.__dirty = v; $('#state').textContent = v ? '편집 중 · 저장 안 됨' : '편집 중'; }
let tt = 0;
function toast(m, ms = 2600) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms); }
function busy(t) { $('#busy').hidden = !t; if (t) $('#busyText').textContent = t; }
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function failed(e) {
  console.error(e); busy('');
  $('#editor').innerHTML = '<div style="padding:40px 20px;text-align:center;color:#6b7280;line-height:1.6">편집기를 열지 못했어요.<br><small style="display:block;margin-top:10px;color:#b42318;word-break:break-all"></small><button id="retry" style="margin-top:16px;border:0;border-radius:10px;padding:10px 18px;background:#2f6bff;color:#fff;font-size:15px">다시 시도</button></div>';
  $('#editor small').textContent = String(e?.message || e);
  $('#retry').onclick = () => location.reload();
}

A.setDoc(docId, name);
A.setFillable(true);
A.setFillMode(true);
window.toggleFill = () => leave();

let ref = null;
try {
  const buf = await (await fetch('/doc/' + docId)).arrayBuffer();
  origSize = buf.byteLength;
  const { mountDocxEditor } = await import('./vendor/docxeditor/editor.js');
  const W = document.documentElement.clientWidth;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('편집기 시작 시간 초과')), 60000);
    ref = mountDocxEditor($('#editor'), {
      documentBuffer: buf,
      author: '나',
      showToolbar: true,
      showFileOpen: false,
      showHelpMenu: false,
      showRuler: false,
      initialZoom: Math.max(0.35, Math.min(1, (W - 16) / 816)),
      onChange: () => { if (ready) setDirty(true); },
      onError: (e) => { clearTimeout(to); reject(e); },
    });
    const poll = setInterval(() => {
      try { if (ref.current && ref.current.getDocument()) { clearInterval(poll); clearTimeout(to); resolve(); } } catch {}
    }, 200);
  });
  sd = ref.current;
  window.__sd = sd;
  busy('');
  setTimeout(() => { ready = true; }, 800);
  for (const ev of ['beforeinput', 'paste', 'cut', 'drop', 'compositionend'])
    $('#editor').addEventListener(ev, () => { if (ready) setDirty(true); }, true);
} catch (e) { failed(e); }

async function docxBytes() {
  let ab = await ref.current.save();
  if (!ab) ab = await ref.current.save({ selective: false });
  if (!ab) throw new Error('워드 파일을 만들지 못했어요');
  return new Uint8Array(ab);
}

// PDF: 화면에 그려진 페이지를 그림으로 떠서 합침
let pdfLib = null, h2i = null;
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' 로드 실패')); document.head.appendChild(s); });
async function makePdf() {
  if (!window.PDFLib) await loadScript('vendor/pdflib/pdf-lib.min.js');
  h2i ||= await import('./vendor/office/entry-h2i.js');
  const pages = [...document.querySelectorAll('#editor [data-page-number], #editor .layout-page, #editor .docx-page, #editor [class*="page-"][style*="height"]')]
    .filter((el, i, arr) => !arr.some((o) => o !== el && o.contains(el)));
  const targets = pages.length ? pages : [document.querySelector('#editor .ProseMirror') || $('#editor')];
  const out = await PDFLib.PDFDocument.create();
  let i = 0;
  for (const el of targets) {
    busy(`PDF 만드는 중… ${++i} / ${targets.length}`);
    const w = el.offsetWidth, h = el.offsetHeight;
    const c = await h2i.toCanvas(el, { pixelRatio: 1600 / w, backgroundColor: '#ffffff' });
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const pw = 595.28, ph = pw * h / w;
    out.addPage([pw, ph]).drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
    c.width = c.height = 0;
  }
  return out.save();
}

window.onSaved = (ok) => { saving = false; busy(''); if (ok) { setDirty(false); toast('저장했어요'); } };
async function run(label, fn) {
  if (saving || !sd) return;
  saving = true; busy(label);
  try { await fn(); } catch (e) { console.error(e); toast('실패했어요: ' + (e.message || e), 5000); saving = false; busy(''); }
}
const done = () => { saving = false; busy(''); };

const actions = {
  save: () => run('저장하는 중…', async () => {
    const b = await docxBytes(); window.__lastBytes = b;
    const b64 = toB64(b);
    if (name.toLowerCase().endsWith('.docx') && A.overwrite(b64)) { done(); window.onSaved(true); return; }
    A.saveFile2(base + '.docx', DOCX, b64, false);
  }),
  saveAs: () => run('파일 만드는 중…', async () => { const b = await docxBytes(); window.__lastBytes = b; A.saveFile2(`${base}_수정.docx`, DOCX, toB64(b), false); }),
  pdf: () => run('PDF 만드는 중…', async () => { const p = await makePdf(); window.__lastBytes = p; A.saveFile2(base + '.pdf', 'application/pdf', toB64(p), false); }),
  share: () => run('공유 준비 중…', async () => { A.shareFile(base + '.docx', DOCX, toB64(await docxBytes())); done(); }),
  sharePdf: () => run('PDF 만드는 중…', async () => { A.shareFile(base + '.pdf', 'application/pdf', toB64(await makePdf())); done(); }),
  print: () => run('인쇄 준비 중…', async () => { A.printPdf(base, toB64(await makePdf())); done(); }),
  info: () => {
    let pages = '?'; try { pages = sd.getTotalPages(); } catch {}
    const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    $('#info').innerHTML = `<div class="box"><h3>문서 정보</h3><table><tr><td>파일 이름</td><td></td></tr><tr><td>형식</td><td>DOCX</td></tr><tr><td>쪽 수</td><td>${pages}</td></tr><tr><td>원본 크기</td><td>${kb(origSize)}</td></tr><tr><td>상태</td><td>${dirty ? '저장 안 된 수정 있음' : '수정 없음 / 저장됨'}</td></tr></table><button>닫기</button></div>`;
    $('#info td:nth-child(2)').textContent = name;
    $('#info').hidden = false;
    $('#info button').onclick = () => { $('#info').hidden = true; };
  },
};

function openSheet() {
  const s = $('#sheet');
  const item = (a, icon, label, note = '') => `<button data-a="${a}"><i>${icon}</i>${label}${note ? `<span class="note">${note}</span>` : ''}</button>`;
  s.innerHTML = `<div class="box">${item('save', '💾', '저장', '원본에 덮어쓰기')}${item('pdf', '📄', 'PDF로 내보내기')}${item('saveAs', '📝', '다른 이름으로 저장')}
    <div class="h">기타</div>${item('share', '↗', '공유', '수정한 워드 파일')}${item('sharePdf', '↗', 'PDF로 공유')}${item('print', '🖨', '인쇄')}${item('info', 'ⓘ', '문서 정보')}</div>`;
  s.hidden = false;
  s.onclick = (e) => { const b = e.target.closest('button'); s.hidden = true; if (b) actions[b.dataset.a]?.(); };
}
function leave() {
  if (dirty && !confirm('저장 안 한 수정 내용이 있어요. 수정을 종료할까요?')) return;
  setDirty(false);
  history.length > 1 ? history.back() : location.replace('viewer.html');
}
$('#bMenu').onclick = openSheet;
$('#bSave').onclick = () => actions.save();
$('#bDone').onclick = leave;
