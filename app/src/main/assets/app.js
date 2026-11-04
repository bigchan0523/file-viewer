// 파일 뷰어 — PDF(pdf.js) / HWP·HWPX(rhwp) 렌더링

const params = new URLSearchParams(location.search);
const docId = params.get('doc');
const docName = params.get('name') || '';

const A = window.Android || {
  setDoc() {}, setPageInfo() {}, pickFile() {}, getRecent() { return '[]'; },
  openRecent() {}, removeRecent() {},
};

const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
const pagesEl = $('#pages');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showStatus(html) { statusEl.innerHTML = html; statusEl.hidden = false; }
function hideStatus() { statusEl.hidden = true; }
function showError(msg, err) {
  if (err) console.error(err);
  const detail = err ? `<div class="err">${esc(err && (err.message || err))}</div>` : '';
  showStatus(`<div class="big">😵</div><div>${esc(msg)}</div>${detail}`);
}

// 채우기 기능이 쓰는 현재 문서 정보
const D = window.__D = { kind: null, name: docName, orig: null, pdf: null, hwp: null, slots: [], W: 0 };

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// =================================================================== 처음 화면

function home() {
  A.setDoc('', '');
  $('#home').hidden = false;
  $('#openBtn').onclick = () => A.pickFile();
  renderRecent();
  addEventListener('pageshow', renderRecent);
}
window.refreshRecent = renderRecent;

function fmtTime(t) {
  const d = new Date(t), now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `오늘 ${p(d.getHours())}:${p(d.getMinutes())}`
                 : `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function renderRecent() {
  let list = [];
  try { list = JSON.parse(A.getRecent() || '[]'); } catch {}
  const box = $('#recent');
  if (!list.length) {
    box.innerHTML = '<div class="empty">최근 연 파일이 없어요.<br>위 버튼으로 열거나, 파일 앱·카톡에서<br>"다른 앱으로 열기" → 파일 뷰어를 골라보세요.</div>';
    return;
  }
  box.innerHTML = list.map((r, i) => {
    const e = extOf(r.name);
    const cls = e === 'pdf' ? 'pdf' : (e === 'hwp' || e === 'hwpx') ? 'hwp'
      : (SHEET_EXT.includes(e) || e === 'csv' || e === 'tsv') ? 'xls'
      : TEXT_EXT.includes(e) ? 'txt' : 'etc';
    const label = (e || 'FILE').toUpperCase().slice(0, 4);
    return `<div class="item" data-i="${i}">
      <div class="badge ${cls}">${esc(label)}</div>
      <div class="meta"><div class="name">${esc(r.name)}</div><div class="time">${fmtTime(r.time)}</div></div>
      <button class="del" data-del="${i}" aria-label="목록에서 지우기">×</button></div>`;
  }).join('');
  box.onclick = (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { A.removeRecent(list[+del.dataset.del].key); renderRecent(); return; }
    const it = ev.target.closest('.item');
    if (it) A.openRecent(list[+it.dataset.i].key);
  };
}

// =================================================================== 문서 열기

async function openDoc() {
  A.setDoc(docId, docName);
  showStatus('<div class="spinner"></div><div>여는 중…</div>');

  let buf;
  try {
    const r = await fetch('/doc/' + docId);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    buf = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    return showError('파일을 읽지 못했어요. 다시 열어주세요.', e);
  }

  const kind = detect(buf, docName);
  try {
    if (kind === 'pdf') await openPdf(buf);
    else if (kind === 'hwpx') await openHwp(buf);
    else if (kind === 'hwp') {
      // 확장자 없는 OLE 파일은 한글일 수도, 옛날 엑셀(xls)일 수도 있음
      try { await openHwp(buf); }
      catch (e) { if (extOf(docName) === 'hwp') throw e; pagesEl.replaceChildren(); await openSheet(buf, 'sheet'); }
    }
    else if (kind === 'sheet' || kind === 'csv') await openSheet(buf, kind);
    else if (kind === 'text') openText(buf);
    else if (kind === 'docx') await openDocx(buf);
    else if (kind === 'pptx') await openPptx(buf);
    else if (kind === 'office') showError('옛날 형식(doc·ppt)은 아직 못 열어요. docx·pptx로 저장된 파일은 열 수 있어요.');
    else showError('지원하지 않는 파일이에요. (PDF, 한글, 워드, PPT, 엑셀, TXT)');
  } catch (e) {
    showError('문서를 표시하지 못했어요.', e);
  }

  // 화면 회전하면 폭에 맞춰 다시 그림
  const mq = matchMedia('(orientation: portrait)');
  mq.addEventListener?.('change', () => location.reload());
}

const SHEET_EXT = ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods'];
const TEXT_EXT = ['txt', 'text', 'md', 'log', 'json', 'xml', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'srt', 'smi',
  'html', 'htm', 'js', 'css', 'py', 'java', 'c', 'h', 'cpp', 'kt', 'sql', 'lua', 'sh', 'bat'];

function detect(b, name) {
  const ext = extOf(name);
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (SHEET_EXT.includes(ext)) return 'sheet';
  if (TEXT_EXT.includes(ext)) return 'text';
  if (ext === 'docx' || ext === 'docm') return 'docx';
  if (ext === 'pptx' || ext === 'ppsx' || ext === 'pptm') return 'pptx';
  // PDF: 앞쪽 1KB 안에 "%PDF"
  for (let i = 0; i < Math.min(b.length - 4, 1024); i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return 'pdf';
  }
  // OLE 복합 문서: HWP 5.0 / xls / doc / ppt
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) {
    if (ext === 'doc' || ext === 'ppt') return 'office';
    return 'hwp';
  }
  // ZIP: HWPX / xlsx / docx / pptx — 끝부분(파일 목록)에서 안쪽 파일 이름으로 구분
  if (b[0] === 0x50 && b[1] === 0x4B) {
    const head = new TextDecoder('latin1').decode(b.subarray(0, 200));
    if (head.includes('hwp+zip') || ext === 'hwpx') return 'hwpx';
    const tail = new TextDecoder('latin1').decode(b.subarray(Math.max(0, b.length - 65536)));
    if (tail.includes('xl/workbook') || head.includes('xl/')) return 'sheet';
    if (tail.includes('Contents/section')) return 'hwpx';
    if (tail.includes('opendocument.spreadsheet') || head.includes('opendocument.spreadsheet')) return 'sheet';
    if (tail.includes('word/document')) return 'docx';
    if (tail.includes('ppt/presentation')) return 'pptx';
    return 'hwpx';
  }
  if (ext === 'pdf') return 'pdf';
  if (ext === 'hwp') return 'hwp';
  if (looksLikeText(b)) return 'text';
  return 'unknown';
}

function looksLikeText(b) {
  const n = Math.min(b.length, 8192);
  if (n === 0) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return b[0] === 0xFF || b[0] === 0xFE; // UTF-16 BOM이면 텍스트
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) bad++;
  }
  return bad / n < 0.02;
}

/** UTF-8 / UTF-16 / EUC-KR(CP949) 자동 판별 — 저장할 때 같은 인코딩으로 되돌리려고 D.enc 에 기록 */
function decodeText(b) {
  let enc, text;
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { enc = 'utf-8-bom'; text = new TextDecoder('utf-8').decode(b.subarray(3)); }
  else if (b[0] === 0xFF && b[1] === 0xFE) { enc = 'utf-16le'; text = new TextDecoder('utf-16le').decode(b.subarray(2)); }
  else if (b[0] === 0xFE && b[1] === 0xFF) { enc = 'utf-16be'; text = new TextDecoder('utf-16be').decode(b.subarray(2)); }
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); enc = 'utf-8'; }
    catch { text = new TextDecoder('euc-kr').decode(b); enc = 'euc-kr'; }
  }
  D.enc = enc;
  return text;
}

let eucMap = null;
function encodeText(str, enc) {
  if (enc === 'euc-kr') {
    if (!eucMap) {
      eucMap = new Map();
      const dec = new TextDecoder('euc-kr'), two = new Uint8Array(2);
      for (let a = 0x81; a <= 0xFE; a++) for (let b = 0x41; b <= 0xFE; b++) {
        two[0] = a; two[1] = b;
        const ch = dec.decode(two);
        if (ch.length === 1 && ch !== '\uFFFD' && !eucMap.has(ch)) eucMap.set(ch, (a << 8) | b);
      }
    }
    const out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else { const v = eucMap.get(ch); if (v) out.push(v >> 8, v & 255); else out.push(0x3F); }
    }
    return new Uint8Array(out);
  }
  if (enc === 'utf-16le' || enc === 'utf-16be') {
    const le = enc === 'utf-16le';
    const out = new Uint8Array(2 + str.length * 2);
    out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF;
    for (let i = 0; i < str.length; i++) {
      const u = str.charCodeAt(i);
      out[2 + i * 2] = le ? u & 255 : u >> 8;
      out[3 + i * 2] = le ? u >> 8 : u & 255;
    }
    return out;
  }
  const u8 = new TextEncoder().encode(str);
  if (enc !== 'utf-8-bom') return u8;
  const out = new Uint8Array(u8.length + 3);
  out.set([0xEF, 0xBB, 0xBF]); out.set(u8, 3);
  return out;
}

// =================================================================== 저장 공통

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

let toastEl = null, toastTimer = 0;
function toast(msg, ms = 2500) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

window.onSaved = (ok) => { if (ok) { window.__dirty = false; toast('저장했어요'); } };

/** overwrite=true 면 원본에 덮어쓰기를 먼저 시도하고, 권한이 없으면 저장 위치를 고르게 함 */
function saveBytes(bytes, { name, mime, overwrite }) {
  const b64 = toB64(bytes);
  window.__lastSaved = bytes; // 테스트용
  if (overwrite && A.overwrite && A.overwrite(b64)) { window.__dirty = false; toast('원본에 저장했어요'); return; }
  if (A.saveFile) A.saveFile(name, mime, b64);
  else window.onSaved(true);
}

function pageWidth() {
  return Math.min(document.documentElement.clientWidth - 16, 1000);
}

/** 화면 근처 페이지만 그리고, 멀어진 페이지는 메모리에서 지움 */
function lazyPages(slots, render, release) {
  const map = new Map(slots.map((s) => [s.el, s]));
  const near = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) render(map.get(e.target));
  }, { rootMargin: '150% 0px' });
  const far = new IntersectionObserver((es) => {
    for (const e of es) if (!e.isIntersecting) release(map.get(e.target));
  }, { rootMargin: '500% 0px' });
  for (const s of slots) { near.observe(s.el); far.observe(s.el); }
}

/** 상단바에 "3 / 12" 표시 */
function trackPages(slots) {
  const n = slots.length;
  let last = '';
  let queued = false;
  const update = () => {
    queued = false;
    const vv = window.visualViewport;
    const mid = vv ? vv.pageTop + vv.height / 2 : scrollY + innerHeight / 2;
    let cur = 1;
    for (const s of slots) { if (s.el.offsetTop <= mid) cur = s.n; else break; }
    const t = `${cur} / ${n}`;
    if (t !== last) { last = t; A.setPageInfo(t); }
  };
  const q = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', q, { passive: true });
  window.visualViewport?.addEventListener('scroll', q);
  window.visualViewport?.addEventListener('resize', q);
  update();
}

function makeSlots(n, W, ratio) {
  const slots = [];
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= n; i++) {
    const el = document.createElement('div');
    el.className = 'page';
    el.style.width = W + 'px';
    el.style.height = Math.round(W * ratio) + 'px';
    el.innerHTML = '<div class="pc"></div><div class="ann"></div>';
    frag.appendChild(el);
    slots.push({ el, pc: el.firstChild, ann: el.lastChild, n: i, state: 0, gen: 0 });
  }
  pagesEl.appendChild(frag);
  D.slots = slots;
  D.W = W;
  return slots;
}

// =================================================================== PDF

async function openPdf(data) {
  const pdfjs = await import('./vendor/pdfjs/pdf.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.js', location.href).href;

  D.kind = 'pdf';
  D.orig = data.slice();
  const task = pdfjs.getDocument({
    data: data.slice(),
    cMapUrl: new URL('vendor/pdfjs/cmaps/', location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('vendor/pdfjs/standard_fonts/', location.href).href,
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
  });
  task.onPassword = (giveBack, reason) => {
    const pw = prompt(reason === 2 ? '비밀번호가 틀렸어요. 다시 입력하세요' : '비밀번호가 걸린 PDF예요. 비밀번호를 입력하세요');
    if (pw === null) { task.destroy(); showError('비밀번호를 입력하지 않아서 열 수 없어요.'); }
    else giveBack(pw);
  };
  const pdf = await task.promise;
  D.pdf = pdf;

  const first = await pdf.getPage(1);
  const v1 = first.getViewport({ scale: 1 });
  const W = pageWidth();
  const slots = makeSlots(pdf.numPages, W, v1.height / v1.width);
  hideStatus();

  const dpr = window.devicePixelRatio || 1;

  async function render(s) {
    if (s.state) return;
    s.state = 1;
    const gen = ++s.gen;
    try {
      const page = await pdf.getPage(s.n);
      const base = page.getViewport({ scale: 1 });
      const css = W / base.width;
      s.el.style.height = Math.round(base.height * css) + 'px';
      // 확대해도 선명하게: 화면 밀도 × 2배, 단 페이지당 픽셀 수는 제한
      let scale = css * dpr * 2;
      const maxPx = 14e6;
      if (base.width * base.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (base.width * base.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      s.task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      await s.task.promise;
      if (gen !== s.gen || s.state !== 1) { c.width = c.height = 0; return; }
      s.pc.replaceChildren(c);
      s.canvas = c;
      s.state = 2;
    } catch (e) {
      if (gen === s.gen) s.state = 0;
      if (e?.name !== 'RenderingCancelledException') console.error(e);
    }
  }

  function release(s) {
    if (!s.state) return;
    s.gen++;
    try { s.task?.cancel(); } catch {}
    if (s.canvas) { s.canvas.width = s.canvas.height = 0; s.canvas = null; }
    s.pc.replaceChildren();
    s.state = 0;
  }

  lazyPages(slots, render, release);
  trackPages(slots);
  A.setFillable?.(true);
}

// =================================================================== HWP / HWPX

let rhwpReady = null;
async function loadRhwp() {
  if (!rhwpReady) {
    rhwpReady = (async () => {
      const m = await import('./vendor/rhwp/entry.js');
      if (!globalThis.measureTextWidth) {
        const ctx = document.createElement('canvas').getContext('2d');
        globalThis.measureTextWidth = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
      }
      await m.default({ module_or_path: m.WASM_URL });
      return m;
    })();
  }
  return rhwpReady;
}

function countPages(doc) {
  const keys = ['pageCount', 'page_count', 'getPageCount', 'get_page_count', 'numPages', 'totalPages', 'total_pages'];
  for (const k of keys) {
    try {
      const v = doc[k];
      const r = typeof v === 'function' ? v.call(doc) : v;
      if (Number.isFinite(r) && r > 0) return r;
    } catch {}
  }
  return null;
}

/** 페이지마다 SVG 안의 id가 겹치지 않게 접두어를 붙임 */
function prefixIds(svg, p) {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${p}$1"`)
    .replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g, `url(#${p}$1)`)
    .replace(/((?:xlink:)?href)="#([^"]+)"/g, `$1="#${p}$2"`);
}

/** SVG를 넣고 폭에 맞게 늘어나게 만든 뒤 원래 크기(w,h)를 돌려줌 */
function mountSvg(el, str, n) {
  el.innerHTML = prefixIds(str, `p${n}_`);
  const svg = el.querySelector('svg');
  if (!svg) return null;
  let w = parseFloat(svg.getAttribute('width'));
  let h = parseFloat(svg.getAttribute('height'));
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (vb && vb.width && vb.height) { w = vb.width; h = vb.height; }
  else if (w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return w && h ? { w, h } : null;
}

async function openHwp(buf) {
  const m = await loadRhwp();
  const doc = new m.HwpDocument(buf);
  D.kind = 'hwp';
  D.hwp = doc;
  const W = pageWidth();

  // 첫 페이지로 비율 파악
  const probe = document.createElement('div');
  const size = mountSvg(probe, doc.renderPageSvg(0), 1) || { w: 210, h: 297 };
  const ratio = size.h / size.w;

  let n = countPages(doc);
  if (!n) {
    // 페이지 수 함수가 없으면 하나씩 그려보면서 셈
    n = 1;
    while (n < 3000) { try { doc.renderPageSvg(n); n++; } catch { break; } }
  }

  const slots = makeSlots(n, W, ratio);
  slots[0].pc.replaceChildren(...probe.childNodes);
  slots[0].state = 2;
  hideStatus();

  // 한 프레임에 한 페이지씩 그려서 버벅임 줄이기
  const queue = [];
  let running = false;
  const pump = () => {
    const s = queue.shift();
    if (!s) { running = false; return; }
    if (s.state === 1) {
      try {
        const sz = mountSvg(s.pc, doc.renderPageSvg(s.n - 1), s.n);
        if (sz) s.el.style.height = Math.round(W * sz.h / sz.w) + 'px';
        s.state = 2;
      } catch (e) {
        console.error(e);
        s.pc.innerHTML = `<div class="empty">${s.n}쪽을 그리지 못했어요</div>`;
        s.state = 2;
      }
    }
    requestAnimationFrame(pump);
  };
  const render = (s) => {
    if (s.state) return;
    s.state = 1;
    queue.push(s);
    if (!running) { running = true; requestAnimationFrame(pump); }
  };
  const release = (s) => {
    if (!s.state) return;
    s.pc.replaceChildren();
    s.state = 0;
  };

  lazyPages(slots, render, release);
  trackPages(slots);
  A.setFillable?.(true);
}

// =================================================================== 텍스트

function openText(buf) {
  let text = decodeText(buf);
  const CHUNK = 300000;
  let shown = 0;
  let size = 15;
  try { size = +localStorage.getItem('textSize') || 15; } catch {}

  const bar = document.createElement('div');
  bar.className = 'tbar';
  bar.innerHTML = '<button data-d="-1">가 −</button><button data-d="1">가 +</button>';
  const box = document.createElement('div');
  box.className = 'textdoc';
  box.style.fontSize = size + 'px';
  const more = document.createElement('button');
  more.className = 'more';

  bar.onclick = (e) => {
    const d = +e.target.dataset.d;
    if (!d) return;
    size = Math.max(10, Math.min(30, size + d));
    box.style.fontSize = size + 'px';
    try { localStorage.setItem('textSize', size); } catch {}
  };
  const showMore = () => {
    const pre = document.createElement('pre');
    pre.textContent = text.slice(shown, shown + CHUNK);
    box.appendChild(pre);
    shown += CHUNK;
    more.hidden = shown >= text.length;
    more.textContent = `더 보기 (${Math.round(shown / text.length * 100)}% 표시됨)`;
  };
  more.onclick = showMore;

  pagesEl.append(bar, box, more);
  if (!text.length) box.innerHTML = '<div class="note">빈 파일이에요</div>';
  else showMore();
  const lines = text ? text.split('\n').length : 0;
  A.setPageInfo(`${lines.toLocaleString()}줄`);
  hideStatus();

  // ---- 연필: 바로 고쳐 쓰기
  D.kind = 'text';
  let ta = null, ebar = null;
  const exitEdit = () => {
    ta?.remove(); ebar?.remove(); ta = ebar = null;
    box.hidden = false; more.hidden = shown >= text.length;
    document.body.classList.remove('editing');
    A.setFillMode?.(false);
  };
  D.toggleEdit = () => {
    if (ta) { if (window.__dirty && !confirm('저장 안 한 내용이 사라져요. 수정을 종료할까요?')) return; window.__dirty = false; exitEdit(); return; }
    ta = document.createElement('textarea');
    ta.className = 'textedit';
    ta.value = text;
    ta.style.fontSize = size + 'px';
    ta.spellcheck = false;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; };
    ta.addEventListener('input', () => { window.__dirty = true; grow(); });
    box.hidden = true; more.hidden = true;
    box.after(ta);
    ebar = editBar([['cancel', '수정 종료'], ['save', '저장', 'save']], (a) => {
      if (a === 'cancel') D.toggleEdit();
      else if (a === 'save') {
        saveBytes(encodeText(ta.value, D.enc), { name: docName || '메모.txt', mime: 'text/plain', overwrite: true });
        text = ta.value;
        box.replaceChildren(); shown = 0; showMore();
      }
    });
    document.body.classList.add('editing');
    A.setFillMode?.(true);
    grow();
    ta.focus();
  };
  A.setFillable?.(true);
}

/** 화면 아래 고정 버튼줄 (텍스트·엑셀 수정용) */
function editBar(buttons, onClick) {
  const b = document.createElement('div');
  b.id = 'editbar';
  b.innerHTML = buttons.map(([a, label, cls]) => `<button data-a="${a}" class="${cls || ''}">${label}</button>`).join('');
  b.onclick = (e) => { const t = e.target.closest('button'); if (t) onClick(t.dataset.a); };
  document.body.appendChild(b);
  return b;
}

// =================================================================== 엑셀 (xlsx / xls / csv / ods)

let xlsxReady = null;
function loadXlsx() {
  if (!xlsxReady) {
    xlsxReady = (async () => {
      const X = await import('./vendor/xlsx/xlsx.mjs');
      try { const cp = await import('./vendor/xlsx/cpexcel.full.mjs'); X.set_cptable(cp); } catch {}
      return X;
    })();
  }
  return xlsxReady;
}

async function openSheet(buf, kind) {
  const X = await loadXlsx();
  const ext = extOf(docName);
  const wb = kind === 'csv'
    ? X.read(decodeText(buf), { type: 'string', raw: true, ...(ext === 'tsv' ? { FS: '\t' } : {}) })
    : X.read(buf, { type: 'array', cellStyles: true });


  const sheets = wb.SheetNames
    .map((name, i) => ({ name, i, hidden: wb.Workbook?.Sheets?.[i]?.Hidden }))
    .filter((s) => !s.hidden);
  if (!sheets.length) throw new Error('시트가 없어요');

  // 위: 시트 탭 + 확대/축소, 아래: 표 전용 스크롤 영역(행·열 머리글 고정)
  document.body.classList.add('sheetmode');
  const top = document.createElement('div');
  top.className = 'sheettop';
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const zoomBox = document.createElement('div');
  zoomBox.className = 'zoom';
  zoomBox.innerHTML = '<button data-z="-1" aria-label="축소">−</button><button data-z="1" aria-label="확대">+</button>';
  top.append(tabs, zoomBox);
  const holder = document.createElement('div');
  holder.className = 'sheet';
  const more = document.createElement('button');
  more.className = 'more';
  const cellbar = $('#cellbar');
  pagesEl.append(top, holder);
  if (sheets.length > 1) {
    tabs.innerHTML = sheets.map((s, k) => `<button class="tab" data-k="${k}">${esc(s.name)}</button>`).join('');
  }

  let zoom = 1;
  try { zoom = +localStorage.getItem('sheetZoom') || 1; } catch {}
  const applyZoom = () => { const t = holder.querySelector('table'); if (t) t.style.zoom = zoom; };
  zoomBox.onclick = (e) => {
    const d = +e.target.dataset.z;
    if (!d) return;
    zoom = Math.round(Math.max(0.4, Math.min(2.2, zoom + d * 0.15)) * 100) / 100;
    applyZoom();
    try { localStorage.setItem('sheetZoom', zoom); } catch {}
  };

  const STEP = 500, MAXCOL = 200;
  let cur = 0, rowsShown = STEP;
  let editing = false;
  D.kind = 'sheet';

  function colWidth(c) {
    if (!c || c.hidden) return c && c.hidden ? 0 : 84;
    const px = c.wpx || (c.wch ? c.wch * 7 + 12 : c.width ? c.width * 7 + 12 : 84);
    return Math.max(36, Math.min(420, Math.round(px)));
  }

  function draw() {
    const ws = wb.Sheets[sheets[cur].name];
    cellbar.hidden = true;
    for (const t of tabs.children) t.classList.toggle('on', +t.dataset.k === cur);
    A.setPageInfo(sheets.length > 1 ? `${cur + 1} / ${sheets.length} 시트` : '');
    if (ws && !ws['!ref'] && editing) ws['!ref'] = 'A1:A1';
    if (!ws || !ws['!ref']) { holder.innerHTML = '<div class="empty">빈 시트예요</div>'; return; }

    const r = X.utils.decode_range(ws['!ref']);
    if (editing) { r.s.r = r.s.c = 0; r.e.r += 20; r.e.c += 5; } // 수정 중엔 빈 칸도 조금 더 보여줌
    const lastRow = Math.min(r.e.r, r.s.r + rowsShown - 1);
    const lastCol = Math.min(r.e.c, r.s.c + MAXCOL - 1);

    const span = new Map(), skip = new Set();
    for (const m of ws['!merges'] || []) {
      span.set(m.s.r + ',' + m.s.c, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]);
      for (let rr = m.s.r; rr <= m.e.r; rr++)
        for (let cc = m.s.c; cc <= m.e.c; cc++)
          if (rr !== m.s.r || cc !== m.s.c) skip.add(rr + ',' + cc);
    }

    const cols = ws['!cols'] || [];
    const rowsInfo = ws['!rows'] || [];
    let total = 44;
    let html = '<colgroup><col style="width:44px">';
    for (let c = r.s.c; c <= lastCol; c++) { const w = colWidth(cols[c]); total += w; html += `<col style="width:${w}px">`; }
    html += '</colgroup><thead><tr><th class="corner"></th>';
    for (let c = r.s.c; c <= lastCol; c++) html += `<th>${X.utils.encode_col(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (let rr = r.s.r; rr <= lastRow; rr++) {
      if (rowsInfo[rr]?.hidden) continue;
      html += `<tr><th>${rr + 1}</th>`;
      for (let c = r.s.c; c <= lastCol; c++) {
        const key = rr + ',' + c;
        if (skip.has(key)) continue;
        const cell = ws[X.utils.encode_cell({ r: rr, c })];
        let text = '';
        if (cell) text = cell.w != null ? cell.w : cell.v != null ? String(cell.v) : '';
        const sp = span.get(key);
        const attrs = sp ? `${sp[0] > 1 ? ` rowspan="${sp[0]}"` : ''}${sp[1] > 1 ? ` colspan="${sp[1]}"` : ''}` : '';
        const cls = cell && cell.t === 'n' ? ' class="num"' : '';
        html += `<td${cls}${attrs} data-a="${X.utils.encode_col(c)}${rr + 1}">${esc(text)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
    holder.innerHTML = `<table class="grid" style="width:${total}px">${html}</table>`;
    holder.appendChild(more);
    applyZoom();

    const totalRows = r.e.r - r.s.r + 1;
    more.hidden = lastRow >= r.e.r;
    more.textContent = `행 더 보기 (${(lastRow - r.s.r + 1).toLocaleString()} / ${totalRows.toLocaleString()})`;
    if (r.e.c > lastCol) holder.insertAdjacentHTML('beforeend', `<div class="note">열이 많아서 앞 ${MAXCOL}개만 보여줘요</div>`);
  }

  tabs.onclick = (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    cur = +t.dataset.k;
    rowsShown = STEP;
    draw();
    holder.scrollTo(0, 0);
  };
  more.onclick = () => { rowsShown += STEP; draw(); };

  // 셀을 누르면 아래에 전체 내용 표시 (잘린 글자 확인용)
  let sel = null;
  holder.onclick = (e) => {
    const td = e.target.closest('td');
    if (sel) sel.classList.remove('sel');
    if (!td || td === sel) { sel = null; cellbar.hidden = true; return; }
    sel = td;
    td.classList.add('sel');
    if (editing) { openCellEditor(td); return; }
    cellbar.innerHTML = `<b>${esc(td.dataset.a)}</b>${esc(td.textContent) || '<span style="opacity:.5">(빈 칸)</span>'}`;
    cellbar.hidden = false;
  };

  // ---- 연필: 칸 값 고치기
  function openCellEditor(td) {
    const ws = wb.Sheets[sheets[cur].name];
    const addr = td.dataset.a;
    const cell = ws[addr];
    const val = cell ? (cell.f ? '=' + cell.f : cell.w != null && cell.t !== 'n' ? cell.w : cell.v != null ? String(cell.v) : '') : '';
    cellbar.innerHTML = `<div class="ced"><b>${esc(addr)}</b><textarea rows="1"></textarea><button>적용</button></div>`;
    cellbar.hidden = false;
    const inp = cellbar.querySelector('textarea');
    inp.value = val;
    inp.focus();
    inp.select();
    const apply = () => {
      const v = inp.value;
      if (v === val) { cellbar.hidden = true; return; }
      setCell(ws, addr, v);
      const c2 = ws[addr];
      td.textContent = c2 ? (c2.f ? (c2.w ?? '') : c2.w ?? String(c2.v ?? '')) : '';
      td.classList.toggle('num', !!c2 && c2.t === 'n');
      window.__dirty = true;
      cellbar.hidden = true;
    };
    cellbar.querySelector('button').onclick = apply;
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } };
  }

  function setCell(ws, addr, v) {
    const t = v.trim();
    if (t === '') delete ws[addr];
    else if (t.startsWith('=') && kind !== 'csv') ws[addr] = { t: 'n', f: t.slice(1), v: 0, w: '' };
    else if (/^-?\d+(\.\d+)?$/.test(t.replace(/,/g, '')) && !/^0\d/.test(t)) ws[addr] = { t: 'n', v: +t.replace(/,/g, ''), w: t };
    else ws[addr] = { t: 's', v, w: v };
    // 범위 밖이면 시트 범위 늘리기
    const rg = X.utils.decode_range(ws['!ref'] || 'A1:A1');
    const c = X.utils.decode_cell(addr);
    rg.s.r = Math.min(rg.s.r, c.r); rg.s.c = Math.min(rg.s.c, c.c);
    rg.e.r = Math.max(rg.e.r, c.r); rg.e.c = Math.max(rg.e.c, c.c);
    ws['!ref'] = X.utils.encode_range(rg);
  }

  let ebar = null;
  D.toggleEdit = () => {
    if (editing) {
      if (window.__dirty && !confirm('저장 안 한 내용이 사라져요. 수정을 종료할까요?')) return;
      if (window.__dirty) { location.reload(); return; } // 고친 내용 버리기
      editing = false; ebar?.remove(); ebar = null;
      document.body.classList.remove('editing');
      A.setFillMode?.(false); draw(); return;
    }
    editing = true;
    document.body.classList.add('editing');
    A.setFillMode?.(true);
    ebar = editBar([['cancel', '수정 종료'], ['save', '저장', 'save']], (a) => {
      if (a === 'cancel') D.toggleEdit();
      else if (a === 'save') saveSheet();
    });
    draw();
    toast('고칠 칸을 누르세요');
  };

  function saveSheet() {
    cellbar.hidden = true;
    const base = (docName || '표').replace(/\.[^.]+$/, '');
    if (kind === 'csv') {
      const ws = wb.Sheets[sheets[cur].name];
      const csv = X.utils.sheet_to_csv(ws, ext === 'tsv' ? { FS: '\t' } : {});
      saveBytes(encodeText(csv, D.enc), { name: docName || base + '.csv', mime: 'text/csv', overwrite: true });
      return;
    }
    const bt = ext === 'xls' ? 'biff8' : ext === 'ods' ? 'ods' : ext === 'xlsm' ? 'xlsm' : 'xlsx';
    const outExt = ext === 'xls' ? 'xls' : ext === 'ods' ? 'ods' : ext === 'xlsm' ? 'xlsm' : 'xlsx';
    const mime = { xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet' }[outExt]
      || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const out = X.write(wb, { bookType: bt, type: 'array', cellStyles: true });
    toast('엑셀은 글자색·칸 색 같은 서식이 빠질 수 있어서 사본으로 저장해요', 4000);
    saveBytes(new Uint8Array(out), { name: `${base}_수정.${outExt}`, mime, overwrite: false });
  }
  A.setFillable?.(true);

  draw();
  hideStatus();
}

// =================================================================== 워드 (docx)

async function openDocx(buf) {
  const m = await import('./vendor/office/entry-docx.js');
  const host = document.createElement('div');
  host.className = 'docxhost';
  pagesEl.appendChild(host);
  await m.renderAsync(buf, host, null, {
    inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
    useBase64URL: true, renderComments: false, experimental: true,
  });
  const secs = [...host.querySelectorAll('section.docx')];
  if (!secs.length) throw new Error('내용이 없어요');
  // 화면 폭에 맞춰 축소
  const pw = Math.max(...secs.map((s) => s.offsetWidth));
  const avail = document.documentElement.clientWidth - 16;
  if (pw > avail) host.style.zoom = avail / pw;
  hideStatus();
  A.setPageInfo(secs.length > 1 ? `${secs.length}쪽` : '');

  // 채우기용 덧그림 층
  D.kind = 'docx';
  D.W = pw;
  D.slots = secs.map((el, i) => {
    el.style.position = 'relative';
    const ann = document.createElement('div');
    ann.className = 'ann';
    el.appendChild(ann);
    return { el, ann, n: i + 1 };
  });
  // 워드 진짜 편집은 아직 → 연필 숨김
}

// =================================================================== PPT (pptx) — 보기 전용

async function openPptx(buf) {
  const host = document.createElement('div');
  host.className = 'pptxhost';
  host.style.width = pageWidth() + 'px';
  pagesEl.appendChild(host);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const m = await import('./vendor/office/entry-pptx.js');
    const v = await m.PptxViewer.open(ab, host, { fitMode: 'contain', listOptions: { windowed: true } });
    hideStatus();
    A.setPageInfo(`${v.slideCount}장`);
  } catch (e) {
    // 예비 라이브러리
    console.warn('pptx-renderer failed, fallback', e);
    host.replaceChildren();
    const m2 = await import('./vendor/office/entry-pptx2.js');
    const pres = await m2.loadPresentation(ab.slice(0));
    const n = pres.slides?.length || 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'slide2';
      host.appendChild(el);
      m2.renderSlideToElement(pres, i, el);
    }
    hideStatus();
    A.setPageInfo(`${n}장`);
  }
}

// =================================================================== 서류 채우기

let fillMod = null;
window.toggleFill = async () => {
  if (D.toggleEdit) { D.toggleEdit(); return; }
  // 한글: 진짜 편집 모드(편집기 화면)로
  if (D.kind === 'hwp') { location.href = `hwpedit.html?doc=${encodeURIComponent(docId)}&name=${encodeURIComponent(docName)}`; return; }
  try {
    fillMod ||= await import('./fill.js');
    fillMod.toggle(D, A);
  } catch (e) { showError('채우기 기능을 열지 못했어요.', e); }
};

// =================================================================== 시작

if (docId) openDoc(); else home();
