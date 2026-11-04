// 서류 채우기: 문서 위에 글자·체크·서명을 올리고 새 PDF로 저장
// 위치·크기는 페이지 크기 대비 비율(0~1)로 저장 → 화면 크기와 상관없이 같은 자리에 찍힘

let D, A;
let inited = false, on = false, tool = 'move', sel = null, grip = null;
let bar, tip, pad = null, tipTimer = 0, pendingSign = null, saving = false;
const items = []; // { type:'text'|'check'|'sign', page, x, y, fs, w, ratio, src, el }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEF_FS = { text: 0.02, check: 0.03 };

export function toggle(d, a) {
  D = d; A = a;
  if (!inited) init();
  on = !on;
  document.body.classList.toggle('fill', on);
  bar.hidden = !on;
  if (on) {
    setTool('move');
    showTip('아래에서 도구를 고르고, 문서에서 넣을 곳을 누르세요', 3500);
  } else {
    select(null);
    pendingSign = null;
    hideTip();
  }
  A.setFillMode?.(on);
  pin();
}

function init() {
  inited = true;
  bar = document.createElement('div');
  bar.id = 'fillbar';
  bar.hidden = true;
  tip = document.createElement('div');
  tip.id = 'filltip';
  tip.hidden = true;
  document.body.append(bar, tip);
  bar.addEventListener('click', onBar);
  for (const s of D.slots) s.ann.addEventListener('click', (e) => onPageTap(e, s));
  const vv = window.visualViewport;
  vv?.addEventListener('resize', pin);
  vv?.addEventListener('scroll', pin);
  addEventListener('resize', pin);
  addEventListener('scroll', pin, { passive: true });
  window.onSaved = (ok) => {
    saving = false;
    if (ok) { window.__dirty = false; showTip('저장했어요'); } else hideTip();
  };
  const st = document.createElement('style');
  st.textContent = 'body.fill #pages{padding-bottom:110px}';
  document.head.appendChild(st);
}

// ------------------------------------------------------------------ 화면 고정 (확대해도 아래에 붙게)

function pin() {
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
  const vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight;
  const Wpx = vw * s, Hpx = vh * s;
  if (bar && !bar.hidden) {
    bar.style.width = Wpx + 'px';
    bar.style.transform = `translate(${ox}px, ${oy + vh}px) scale(${1 / s}) translateY(-100%)`;
  }
  if (tip && !tip.hidden) {
    tip.style.width = Wpx + 'px';
    tip.style.transform = `translate(${ox}px, ${oy}px) scale(${1 / s})`;
  }
  if (pad) {
    pad.style.width = Wpx + 'px';
    pad.style.height = Hpx + 'px';
    pad.style.transform = `translate(${ox}px, ${oy}px) scale(${1 / s})`;
  }
}

function showTip(text, ms = 2500) {
  clearTimeout(tipTimer);
  tip.innerHTML = '<span></span>';
  tip.firstChild.textContent = text;
  tip.hidden = false;
  pin();
  if (ms) tipTimer = setTimeout(hideTip, ms);
}
function hideTip() { clearTimeout(tipTimer); if (tip) tip.hidden = true; }

// ------------------------------------------------------------------ 도구바

const btn = (a, icon, label, cls = '') =>
  `<button data-a="${a}" class="${cls}"><b>${icon}</b>${label}</button>`;

function renderBar() {
  if (!bar) return;
  if (sel) {
    bar.innerHTML = btn('smaller', '−', '작게') + btn('bigger', '+', '크게') +
      btn('delete', '✕', '삭제', 'del') + btn('done', '✓', '완료', 'on');
  } else {
    const t = (a, i, l) => btn(a, i, l, tool === a ? 'on' : '');
    bar.innerHTML = t('move', '✋', '이동') + t('text', '가', '글자') + t('check', '✓', '체크') +
      t('sign', '✍', '서명') + btn('save', '⤓', '저장', 'save');
  }
  pin();
}

function setTool(t) {
  tool = t;
  renderBar();
}

function onBar(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'move') { pendingSign = null; setTool('move'); }
  else if (a === 'text') { setTool('text'); showTip('글자를 넣을 곳을 누르세요'); }
  else if (a === 'check') { setTool('check'); showTip('체크할 곳을 누르세요 (여러 번 가능)'); }
  else if (a === 'sign') openPad((src, ratio) => {
    pendingSign = { src, ratio };
    setTool('sign');
    showTip('서명을 넣을 곳을 누르세요', 0);
  });
  else if (a === 'smaller' || a === 'bigger') resize(a === 'bigger' ? 1.15 : 1 / 1.15);
  else if (a === 'delete') { if (sel) { const it = sel; select(null, true); removeItem(it); } }
  else if (a === 'done') select(null);
  else if (a === 'save') save();
}

// ------------------------------------------------------------------ 배치

function onPageTap(e, s) {
  if (!on || e.target !== s.ann) return;
  const r = s.ann.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const pageH = s.el.offsetHeight;
  if (tool === 'move') { select(null); return; }
  if (tool === 'text') {
    const fs = DEF_FS.text;
    addItem({ type: 'text', page: s.n, x: x - fs * 0.2, y: y - (fs * D.W * 0.65) / pageH, fs }, s);
    setTool('move');
  } else if (tool === 'check') {
    const fs = DEF_FS.check;
    addItem({ type: 'check', page: s.n, x: x - fs * 0.4, y: y - (fs * D.W * 0.65) / pageH, fs }, s, false);
  } else if (tool === 'sign' && pendingSign) {
    const w = 0.25;
    const h = (w * D.W * pendingSign.ratio) / pageH;
    addItem({ type: 'sign', page: s.n, x: x - w / 2, y: y - h / 2, w, ratio: pendingSign.ratio, src: pendingSign.src }, s);
    pendingSign = null;
    hideTip();
    setTool('move');
  }
}

function addItem(it, s, doSelect = true) {
  let el;
  if (it.type === 'sign') {
    el = document.createElement('img');
    el.src = it.src;
    el.className = 'it sig';
    el.draggable = false;
  } else {
    el = document.createElement('div');
    el.className = 'it ' + (it.type === 'text' ? 'txt' : 'chk');
    if (it.type === 'check') el.textContent = '✓';
    el.spellcheck = false;
    el.addEventListener('input', () => { window.__dirty = true; });
  }
  it.el = el;
  el.addEventListener('pointerdown', (e) => {
    if (!on) return;
    e.stopPropagation();
    if (sel !== it) select(it);
    if (it.type !== 'text') startDrag(e, it, el);
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  s.ann.appendChild(el);
  items.push(it);
  layout(it);
  window.__dirty = true;
  if (doSelect) select(it);
}

function layout(it) {
  const el = it.el;
  el.style.left = it.x * 100 + '%';
  el.style.top = it.y * 100 + '%';
  if (it.type === 'sign') el.style.width = it.w * 100 + '%';
  else el.style.fontSize = it.fs * D.W + 'px';
  placeGrip();
}

function placeGrip() {
  if (!grip || !sel) return;
  grip.style.left = `calc(${sel.x * 100}% - 26px)`;
  grip.style.top = `calc(${sel.y * 100}% - 26px)`;
  grip.style.position = 'absolute';
}

function select(it, keepEmpty = false) {
  if (sel) {
    const prev = sel;
    prev.el.classList.remove('on');
    if (prev.type === 'text') {
      prev.el.contentEditable = 'false';
      if (!keepEmpty && !prev.el.innerText.trim()) { sel = null; removeItem(prev); }
    }
  }
  grip?.remove();
  grip = null;
  sel = it;
  if (it) {
    it.el.classList.add('on');
    grip = document.createElement('div');
    grip.className = 'grip';
    grip.textContent = '✥';
    grip.addEventListener('pointerdown', (e) => { e.stopPropagation(); startDrag(e, it, grip); });
    grip.addEventListener('click', (e) => e.stopPropagation());
    it.el.parentElement.appendChild(grip);
    placeGrip();
    if (it.type === 'text') {
      it.el.contentEditable = 'true';
      setTimeout(() => {
        it.el.focus();
        const r = document.createRange();
        r.selectNodeContents(it.el);
        r.collapse(false);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }, 0);
    }
  } else if (document.activeElement && document.activeElement.isContentEditable) {
    document.activeElement.blur();
  }
  renderBar();
}

function removeItem(it) {
  it.el.remove();
  const i = items.indexOf(it);
  if (i >= 0) items.splice(i, 1);
  window.__dirty = items.length > 0;
}

function resize(f) {
  if (!sel) return;
  if (sel.type === 'sign') sel.w = clamp(sel.w * f, 0.03, 1);
  else sel.fs = clamp(sel.fs * f, 0.006, 0.2);
  layout(sel);
  window.__dirty = true;
}

function startDrag(e, it, handle) {
  e.preventDefault();
  const page = it.el.parentElement.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y;
  try { handle.setPointerCapture(e.pointerId); } catch {}
  const mv = (ev) => {
    it.x = clamp(ox + (ev.clientX - sx) / page.width, -0.05, 1);
    it.y = clamp(oy + (ev.clientY - sy) / page.height, -0.05, 1);
    layout(it);
    window.__dirty = true;
  };
  const up = () => {
    handle.removeEventListener('pointermove', mv);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
  };
  handle.addEventListener('pointermove', mv);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------------ 서명 패드

function openPad(done) {
  select(null);
  pad = document.createElement('div');
  pad.id = 'sigpad';
  pad.innerHTML = `<div class="box"><p class="t">서명하세요</p><canvas></canvas>
    <div class="row"><button data-p="clear">지우기</button><button data-p="cancel">취소</button><button data-p="ok" class="ok">완료</button></div></div>`;
  document.body.appendChild(pad);
  pin();
  const cv = pad.querySelector('canvas');
  const k = 2;
  cv.width = cv.clientWidth * k;
  cv.height = cv.clientHeight * k;
  const ctx = cv.getContext('2d');
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 3.2 * k;
  ctx.strokeStyle = '#111';
  let box = null, last = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; };
  const grow = ([x, y]) => {
    if (!box) box = [x, y, x, y];
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  };
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); last = pt(e); grow(last); ctx.beginPath(); ctx.arc(last[0], last[1], ctx.lineWidth / 2, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = pt(e);
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    last = p; grow(p);
  });
  const end = () => { last = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  pad.addEventListener('click', (e) => {
    const a = e.target.dataset?.p;
    if (a === 'clear') { ctx.clearRect(0, 0, cv.width, cv.height); box = null; }
    else if (a === 'cancel') closePad();
    else if (a === 'ok') {
      if (!box) { closePad(); return; }
      const m = ctx.lineWidth;
      const x0 = Math.max(0, box[0] - m), y0 = Math.max(0, box[1] - m);
      const w = Math.min(cv.width, box[2] + m) - x0, h = Math.min(cv.height, box[3] + m) - y0;
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
      const src = out.toDataURL('image/png');
      closePad();
      done(src, h / w);
    }
  });
}
function closePad() { pad?.remove(); pad = null; }

// ------------------------------------------------------------------ 저장

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지 로드 실패')); i.src = src; });
}

function canvasBytes(c, type, q) {
  return new Promise((res, rej) => c.toBlob((b) => b ? b.arrayBuffer().then((ab) => res(new Uint8Array(ab))) : rej(new Error('이미지 변환 실패')), type, q));
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

/** 해당 페이지의 글자·체크·서명만 투명 캔버스에 그림 */
async function overlayCanvas(n, cw, ch, base) {
  const c = base || document.createElement('canvas');
  if (!base) { c.width = cw; c.height = ch; }
  const ctx = c.getContext('2d');
  for (const it of items) {
    if (it.page !== n) continue;
    const x = it.x * cw, y = it.y * ch;
    if (it.type === 'sign') {
      const img = await loadImg(it.src);
      const w = it.w * cw;
      ctx.drawImage(img, x, y, w, w * img.naturalHeight / img.naturalWidth);
    } else {
      const fpx = it.fs * cw;
      ctx.font = `${fpx}px system-ui, "Noto Sans KR", sans-serif`;
      ctx.fillStyle = '#111';
      ctx.textBaseline = 'middle';
      const lh = fpx * 1.3;
      const padX = it.type === 'text' ? fpx * 0.2 : fpx * 0.1;
      const padY = it.type === 'text' ? fpx * 0.1 : 0;
      const lines = it.type === 'check' ? ['✓'] : it.el.innerText.replace(/\n$/, '').split('\n');
      lines.forEach((ln, i) => ctx.fillText(ln, x + padX, y + padY + lh * i + lh / 2));
    }
  }
  return c;
}

/** PDF 원본은 그대로 두고 위에 덧그림만 올림 (원래 글자는 선명하게 유지) */
async function savePdfVector() {
  const PL = await loadPdfLib();
  const doc = await PL.PDFDocument.load(D.orig);
  const pages = doc.getPages();
  const used = [...new Set(items.map((i) => i.page))];
  for (const n of used) {
    const page = pages[n - 1];
    const vp = (await D.pdf.getPage(n)).getViewport({ scale: 1 });
    const cw = 2000, ch = Math.round(cw * vp.height / vp.width);
    const png = await doc.embedPng(await canvasBytes(await overlayCanvas(n, cw, ch), 'image/png'));
    const cb = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, ...page.getSize() };
    const rot = (((page.getRotation()?.angle || 0) % 360) + 360) % 360;
    const W = rot % 180 === 0 ? cb.width : cb.height;
    const H = rot % 180 === 0 ? cb.height : cb.width;
    const opt = { width: W, height: H };
    if (rot === 0) Object.assign(opt, { x: cb.x, y: cb.y });
    else if (rot === 90) Object.assign(opt, { x: cb.x + cb.width, y: cb.y, rotate: PL.degrees(90) });
    else if (rot === 180) Object.assign(opt, { x: cb.x + cb.width, y: cb.y + cb.height, rotate: PL.degrees(180) });
    else Object.assign(opt, { x: cb.x, y: cb.y + cb.height, rotate: PL.degrees(270) });
    page.drawImage(png, opt);
  }
  return doc.save();
}

function svgSize(svg) {
  const head = svg.slice(0, 2000);
  const vb = head.match(/viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (vb) return { w: +vb[1], h: +vb[2] };
  const w = head.match(/<svg[^>]*\swidth="([\d.]+)/), h = head.match(/<svg[^>]*\sheight="([\d.]+)/);
  return w && h ? { w: +w[1], h: +h[1] } : { w: 793.7, h: 1122.5 };
}

/** 한글(또는 암호 걸린 PDF): 페이지를 그림으로 만들고 덧그림을 합쳐 새 PDF 생성 */
async function saveRaster() {
  const PL = await loadPdfLib();
  const out = await PL.PDFDocument.create();
  const total = D.slots.length;
  const PX = 1600;
  for (const s of D.slots) {
    showTip(`PDF 만드는 중… ${s.n} / ${total}`, 0);
    const c = document.createElement('canvas');
    let ptW, ptH;
    if (D.kind === 'pdf') {
      const pg = await D.pdf.getPage(s.n);
      const v1 = pg.getViewport({ scale: 1 });
      ptW = v1.width; ptH = v1.height;
      const vp = pg.getViewport({ scale: PX / v1.width });
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    } else {
      const svg = D.hwp.renderPageSvg(s.n - 1);
      const { w, h } = svgSize(svg);
      ptW = w * 0.75; ptH = h * 0.75;
      c.width = PX; c.height = Math.round(PX * h / w);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try { ctx.drawImage(await loadImg(url), 0, 0, c.width, c.height); } finally { URL.revokeObjectURL(url); }
    }
    await overlayCanvas(s.n, c.width, c.height, c);
    const jpg = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9));
    out.addPage([ptW, ptH]).drawImage(jpg, { x: 0, y: 0, width: ptW, height: ptH });
    c.width = c.height = 0;
  }
  return out.save();
}

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function save() {
  if (saving) return;
  select(null);
  if (!items.length) { showTip('아직 넣은 게 없어요'); return; }
  saving = true;
  showTip('PDF 만드는 중…', 0);
  let bytes;
  try {
    if (D.kind === 'pdf') {
      try { bytes = await savePdfVector(); }
      catch (e) { console.warn('vector save failed, raster fallback', e); bytes = await saveRaster(); }
    } else bytes = await saveRaster();
  } catch (e) {
    saving = false;
    console.error(e);
    showTip('저장 실패: ' + (e.message || e), 5000);
    return;
  }
  window.__lastSaved = bytes; // 테스트용
  const base = (D.name || '문서').replace(/\.[^.]+$/, '');
  showTip('저장할 곳을 고르세요', 0);
  if (A.saveFile) A.saveFile(base + '_작성.pdf', 'application/pdf', toB64(bytes));
  else window.onSaved(true);
}
