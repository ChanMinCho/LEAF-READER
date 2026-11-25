/* PDF 보기·편집 (mdview). 흐름과 설계 이유: docs/pdf-flow.md
   보기는 pdf.js, 저장은 pdf-lib. 편집한 것은 저장 전까지 화면 위 층(객체)으로만 들고 있다가, 저장할 때 pdf-lib 로 PDF 에 그린다.
   좌표: 객체는 "배율 1·회전 적용 화면 좌표"(왼쪽 위 원점, 단위 pt)로 보관하고, 저장할 때 pdf.js 뷰포트로 PDF 좌표로 바꾼다. */

const BASE = new URL('.', import.meta.url).href;
const V = BASE + 'vendor/pdf/';
let pdfjs = null, host = null;

const loadScript = src => new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => no(new Error(src + ' 로드 실패'));
  document.head.appendChild(s);
});
async function libs() {
  if (!pdfjs) {
    pdfjs = await import(V + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
  }
  if (!window.PDFLib) await loadScript(V + 'pdf-lib.min.js');
  if (!window.fontkit) await loadScript(V + 'fontkit.umd.min.js');
}
const fontCache = {};
async function fontBytes(bold) {
  const k = bold ? 'Bold' : 'Regular';
  if (!fontCache[k]) fontCache[k] = fetch(V + `fonts/NanumGothic-${k}.ttf`).then(r => r.arrayBuffer());
  return fontCache[k];
}

/* ---------- 상태 ---------- */
const P = {
  root: null, pagesEl: null, meta: null,
  srcs: [],            // { bytes(Uint8Array), name, doc(pdf.js) }
  pages: [],           // { id, src, idx, rot, proxy, w, h, objs: [] }
  scale: 1.25, tool: 'select', sel: null, dirty: false,
  undo: [], redo: [], form: [], formVals: {}, textItems: new Map(), uid: 1,
  color: '#111111', size: 12, hl: '#ffd400',
};
const $ = (s, el = P.root) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nid = () => P.uid++;
const totalRot = pg => ((pg.proxy.rotate || 0) + pg.rot) % 360;
const viewport = (pg, scale = 1) => pg.proxy.getViewport({ scale, rotation: totalRot(pg) });


const CSS = `
#pdfView { --pv-line: var(--line, #ccc); padding-bottom: 80px; }
#pdfView .pv-bar { position: sticky; top: var(--pv-top, 0px); z-index: 30; margin: 0 0 16px; padding: 6px 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  background: color-mix(in srgb, var(--bg, #fff) 94%, transparent); backdrop-filter: blur(10px);
  border: 1px solid var(--pv-line); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.07); }
#pdfView .pv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
#pdfView .pv-tools, #pdfView .pv-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#pdfView .pv-grp { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: var(--bg-sub, #f4f4f5); }
#pdfView .pv-div { width: 1px; height: 30px; background: var(--pv-line); margin: 0 2px; }
#pdfView .pv-ic { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
#pdfView .pv-bar button { font: inherit; cursor: pointer; color: var(--fg, #222); background: transparent; border: 0; border-radius: 7px; transition: background .12s, color .12s; }
#pdfView .pv-bar button:hover { background: color-mix(in srgb, var(--fg, #222) 8%, transparent); }
#pdfView .pv-bar button:active { transform: translateY(.5px); }
#pdfView .pv-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; padding: 5px 5px 4px; font-size: 10.5px; color: var(--fg-mid, #555) !important; }
#pdfView .pv-tool span { white-space: nowrap; letter-spacing: -.02em; }
#pdfView .pv-tool.on { background: var(--bg, #fff) !important; color: var(--accent, #c55) !important; box-shadow: 0 1px 3px rgba(0,0,0,.12), inset 0 0 0 1px color-mix(in srgb, var(--accent, #c55) 35%, transparent); }
#pdfView .pv-ib { width: 32px; height: 32px; display: grid; place-items: center; color: var(--fg-mid, #555) !important; }
#pdfView .pv-ib:disabled { opacity: .35; cursor: default; }
#pdfView .pv-zoom { min-width: 46px; text-align: center; font-size: 12px; font-weight: 600; color: var(--fg-mid, #555); font-variant-numeric: tabular-nums; }
#pdfView .pv-savebox { background: transparent; gap: 4px; }
#pdfView .pv-savebox .pv-ib { background: var(--bg-sub, #f4f4f5); }
#pdfView .pv-save { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px 0 11px; font-size: 13px; font-weight: 600;
  background: var(--accent, #c55) !important; color: #fff !important; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
#pdfView .pv-save:hover { filter: brightness(1.07); }
#pdfView.dirty .pv-save span::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: #fff; vertical-align: 2px; }
#pdfView .pv-primary { background: var(--accent, #c55) !important; color: #fff !important; }
#pdfView .pv-props { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin: 6px -8px -6px; padding: 7px 12px; border-top: 1px solid var(--pv-line);
  border-radius: 0 0 12px 12px; background: var(--bg-sub, #f6f6f7); font-size: 12px; color: var(--fg-mid, #555); }
#pdfView .pv-props[hidden] { display: none; }
#pdfView .pv-props-h { font-weight: 700; color: var(--fg, #222); margin-right: 2px; min-width: 40px; }
#pdfView .pv-props label { display: inline-flex; gap: 5px; align-items: center; }
#pdfView .pv-props input[type=number] { width: 54px; height: 26px; padding: 0 6px; border: 1px solid var(--pv-line); border-radius: 6px; background: var(--bg, #fff); color: var(--fg, #222); font: inherit; }
#pdfView .pv-props input[type=color] { width: 26px; height: 26px; padding: 2px; border: 1px solid var(--pv-line); border-radius: 6px; background: var(--bg, #fff); cursor: pointer; }
#pdfView .pv-seg { display: inline-flex; gap: 1px; padding: 2px; border-radius: 7px; background: var(--pv-line); }
#pdfView .pv-seg button { padding: 3px 9px !important; font-size: 12px; background: var(--bg, #fff) !important; border-radius: 5px; }
#pdfView .pv-seg button:hover { color: var(--accent, #c55); }
#pdfView .pv-delobj { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 7px !important; font-size: 12px; color: #c62828 !important; }
#pdfView .pv-delobj .pv-ic { width: 16px; height: 16px; }
#pdfView .pv-delobj:hover { background: rgba(198,40,40,.1) !important; }
#pdfView .pv-props:not([data-type=fix]) .pv-only-fix, #pdfView .pv-props:not([data-type=text]):not([data-type=fix]) .pv-only-t,
#pdfView .pv-props:not([data-type=table]) .pv-only-tb, #pdfView .pv-props:not([data-type=line]):not([data-type=pen]):not([data-type=rect]) .pv-only-line { display: none; }
#pdfView .pv-props[data-type=table] label:has([data-p=color]) { display: none; }
#pdfView .pv-props[data-type=image] label:has([data-p=size]), #pdfView .pv-props[data-type=image] label:has([data-p=color]),
#pdfView .pv-props[data-type=hl] label:has([data-p=size]), #pdfView .pv-props[data-type=white] label:has([data-p=size]),
#pdfView .pv-props[data-type=rect] label:has([data-p=size]), #pdfView .pv-props[data-type=line] label:has([data-p=size]), #pdfView .pv-props[data-type=pen] label:has([data-p=size]) { display: none; }
#pdfView .pv-danger:hover:not(:disabled) { color: #c62828 !important; background: rgba(198,40,40,.1) !important; }
#pdfView .pv-ph { display: flex; gap: 8px; align-items: center; padding: 0 2px; font: 12px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; color: var(--fg-dim, #777); }
#pdfView .pv-no { font-weight: 700; color: var(--fg, #333); font-variant-numeric: tabular-nums; }
#pdfView .pv-no small { font-weight: 400; color: var(--fg-dim, #888); }
#pdfView .pv-phb { display: flex; gap: 1px; padding: 2px; border-radius: 8px; background: var(--bg, #fff); border: 1px solid var(--pv-line); opacity: .55; transition: opacity .15s; }
#pdfView .pv-page:hover .pv-phb { opacity: 1; }
#pdfView .pv-ph button { width: 26px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--fg-mid, #555); cursor: pointer; }
#pdfView .pv-ph button .pv-ic { width: 15px; height: 15px; }
#pdfView .pv-ph button:hover:not(:disabled) { background: color-mix(in srgb, var(--fg, #222) 8%, transparent); color: var(--fg, #222); }
#pdfView .pv-ph button:disabled { opacity: .3; cursor: default; }
#pdfView .pv-pick { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
#pdfView .pv-sp { flex: 1; }
#pdfView .pv-pages { display: flex; flex-direction: column; align-items: center; gap: 22px; }
#pdfView .pv-page { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
#pdfView .pv-ph { display: flex; gap: 5px; align-items: center; font-size: 12px; color: var(--fg-dim, #777); }
#pdfView .pv-ph button { padding: 2px 8px; border-radius: 5px; border: 1px solid var(--pv-line); background: var(--bg, #fff); color: var(--fg-dim, #666); font-size: 12px; cursor: pointer; }
#pdfView .pv-ph button:hover:not(:disabled) { color: var(--accent, #c55); border-color: var(--accent, #c55); }
#pdfView .pv-ph button:disabled { opacity: .35; cursor: default; }
#pdfView .pv-pick { display: inline-flex; gap: 3px; align-items: center; margin-left: 8px; cursor: pointer; }
#pdfView .pv-sp { flex: 1; }
#pdfView .pv-pc { position: relative; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
#pdfView .pv-pc canvas { display: block; }
#pdfView .pv-ov { position: absolute; inset: 0; }
#pdfView[data-tool=text] .pv-ov, #pdfView[data-tool=table] .pv-ov { cursor: text; }
#pdfView[data-tool=hl] .pv-ov, #pdfView[data-tool=rect] .pv-ov, #pdfView[data-tool=white] .pv-ov, #pdfView[data-tool=line] .pv-ov, #pdfView[data-tool=pen] .pv-ov { cursor: crosshair; }
#pdfView .pv-o { position: absolute; box-sizing: border-box; }
#pdfView[data-tool=select] .pv-o { cursor: move; }
#pdfView .pv-o.sel { outline: 1.5px dashed var(--accent, #c55); outline-offset: 2px; }
#pdfView .pv-t { white-space: pre; padding: 1px 2px; font-family: "MDPDF Nanum", "Apple SD Gothic Neo", sans-serif; outline: none; min-height: 1em; }
#pdfView .pv-fix .pv-t { padding: 0 1px; line-height: 1.1 !important; }
#pdfView .pv-t[contenteditable=true] { cursor: text; background: rgba(255,255,255,.6); }
#pdfView .pv-image img { width: 100%; height: 100%; display: block; pointer-events: none; }
#pdfView .pv-line, #pdfView .pv-pen { pointer-events: none; }
#pdfView .pv-line svg, #pdfView .pv-pen svg { overflow: visible; pointer-events: stroke; }
#pdfView[data-tool=select] .pv-line polyline, #pdfView[data-tool=select] .pv-pen polyline { pointer-events: stroke; cursor: move; }
#pdfView .pv-tb { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; font-family: "MDPDF Nanum", "Apple SD Gothic Neo", sans-serif; background: #fff; }
#pdfView .pv-tb td { padding: 0 4px; white-space: pre; overflow: hidden; line-height: 1.25; outline: none; vertical-align: middle; cursor: cell; position: relative; }
#pdfView .pv-tb td.csel { box-shadow: inset 0 0 0 9999px rgba(37, 99, 235, .14); outline: 2px solid #2563eb; outline-offset: -2px; z-index: 1; }
#pdfView .pv-tb td.editing, #pdfView .pv-tb td[contenteditable=true] { background: #fff !important; box-shadow: none; outline: 2px solid #2563eb; outline-offset: -2px; cursor: text; z-index: 2; }
#pdfView .pv-grip { position: absolute; left: -22px; top: -2px; width: 16px; height: 16px; border-radius: 4px; cursor: move; background: var(--bg, #fff) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%23666'%3E%3Ccircle cx='5' cy='4' r='1.3'/%3E%3Ccircle cx='11' cy='4' r='1.3'/%3E%3Ccircle cx='5' cy='8' r='1.3'/%3E%3Ccircle cx='11' cy='8' r='1.3'/%3E%3Ccircle cx='5' cy='12' r='1.3'/%3E%3Ccircle cx='11' cy='12' r='1.3'/%3E%3C/g%3E%3C/svg%3E") center/14px no-repeat; box-shadow: 0 0 0 1px var(--pv-line), 0 1px 3px rgba(0,0,0,.12); }
#pdfView .pv-colh { position: absolute; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 3; }
#pdfView .pv-rowh { position: absolute; left: 0; right: 0; height: 8px; cursor: row-resize; z-index: 3; }
#pdfView .pv-colh:hover, #pdfView .pv-rowh:hover { background: rgba(37, 99, 235, .35); }
#pdfView .pv-o.pv-table.sel { outline-style: solid; outline-color: rgba(37, 99, 235, .5); }
#pdfView .pv-hd { position: absolute; right: -6px; bottom: -6px; width: 10px; height: 10px; background: var(--accent, #c55); border: 2px solid #fff; border-radius: 3px; cursor: nwse-resize; }
#pdfView .pv-hit { position: absolute; border-radius: 2px; cursor: text; }
#pdfView .pv-hit:hover { background: rgba(255, 196, 0, .25); outline: 1px solid rgba(224, 168, 0, .9); }
#pdfView .pv-f { position: absolute; }
#pdfView .pv-f input[type=text], #pdfView .pv-f select { width: 100%; height: 100%; box-sizing: border-box; border: 1px solid rgba(60,110,220,.55); background: #e9f0ff; color: #111; padding: 0 4px; border-radius: 2px; font-family: "MDPDF Nanum", sans-serif; }
#pdfView .pv-f:has(input[type=checkbox]) { display: grid; place-items: center; background: #e9f0ff; outline: 1px solid rgba(60,110,220,.55); border-radius: 2px; }
#pdfView .pv-f input[type=checkbox] { width: 82%; height: 82%; margin: 0; accent-color: #2a5bd7; }
#pdfView .pv-sign { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,.45); display: grid; place-items: center; }
#pdfView .pv-sign[hidden] { display: none; }
#pdfView .pv-sign-box { background: var(--bg, #fff); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
#pdfView .pv-sign-h { font-weight: 600; color: var(--fg, #222); }
#pdfView .pv-sign canvas { width: 520px; max-width: 80vw; height: auto; background: #fff; border: 1px dashed #aaa; border-radius: 8px; touch-action: none; cursor: crosshair; }
#pdfView .pv-sign-b { display: flex; gap: 6px; }
#pdfView .pv-sign-b button { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--pv-line); background: var(--bg, #fff); color: var(--fg, #222); cursor: pointer; font: 13px -apple-system, "Apple SD Gothic Neo", sans-serif; }
@media print { #pdfView .pv-bar, #pdfView .pv-ph { display: none; } #pdfView .pv-pages { gap: 0; } }
`;
function injectCss() {
  if (document.getElementById('pv-style')) return;
  const st = document.createElement('style'); st.id = 'pv-style'; st.textContent = CSS; document.head.appendChild(st);
  const ff = new FontFace('MDPDF Nanum', `url(${V}fonts/NanumGothic-Regular.ttf)`, { weight: '400' });
  const fb = new FontFace('MDPDF Nanum', `url(${V}fonts/NanumGothic-Bold.ttf)`, { weight: '700' });
  ff.load().then(f => document.fonts.add(f)).catch(() => {}); fb.load().then(f => document.fonts.add(f)).catch(() => {});
}

/* ---------- 열기·닫기 ---------- */
export function init(h) { host = h; }
export function isOpen() { return !!P.root && P.root.isConnected; }
export function isDirty() { return isOpen() && P.dirty; }
export function confirmLeave() {
  return !isDirty() || confirm('PDF 에 저장하지 않은 편집이 있습니다. 버리고 나갈까요?');
}
export function close() {
  if (!P.root) return;
  P.observer?.disconnect();
  P.srcs.forEach(s => s.doc?.destroy?.());
  P.root.remove(); P.root = null;
  Object.assign(P, { srcs: [], pages: [], sel: null, dirty: false, undo: [], redo: [], form: [], formVals: {}, textItems: new Map(), tool: 'select' });
  document.body.classList.remove('pdf-mode');
  removeEventListener('keydown', onKey, true);
}

export async function open(meta, bytes, mountIn) {
  await libs();
  injectCss();
  close();
  P.meta = meta;
  P.root = document.createElement('div');
  P.root.id = 'pdfView';
  P.root.innerHTML = TOOLBAR;
  mountIn.appendChild(P.root);
  P.pagesEl = $('.pv-pages');
  document.body.classList.add('pdf-mode');
  bindToolbar();
  addEventListener('keydown', onKey, true);
  await addSource(bytes, meta.name, true);
  await loadForm();
  drawAll();
  host.onPages(P.pages.map((p, i) => i + 1));
  return P.pages.length;
}

async function addSource(bytes, name, first) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const keep = u8.slice();                        // pdf.js 가 버퍼를 넘겨받아 비우므로 저장용 사본을 둔다
  const doc = await pdfjs.getDocument({
    data: u8, cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', wasmUrl: V + 'wasm/',
  }).promise;
  const src = P.srcs.push({ bytes: keep, name, doc }) - 1;
  for (let i = 0; i < doc.numPages; i++) {
    const proxy = await doc.getPage(i + 1);
    P.pages.push({ id: nid(), src, idx: i, rot: 0, proxy, objs: [] });
  }
  if (!first) { markDirty(); host.toast(`${name} 의 ${doc.numPages}쪽을 뒤에 붙였습니다`); }
}

/* ---------- 양식(입력 칸) ---------- */
// pdf-lib 압축본은 클래스 이름이 바뀌어 있어 instanceof 로 가린다
function fieldType(f) {
  const L = PDFLib;
  return f instanceof L.PDFTextField ? 'text' : f instanceof L.PDFCheckBox ? 'check'
    : (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) ? 'select' : f instanceof L.PDFRadioGroup ? 'radio' : null;
}
async function loadForm() {
  P.form = [];
  try {
    const { PDFDocument } = PDFLib;
    const d = await PDFDocument.load(P.srcs[0].bytes, { ignoreEncryption: true });
    const pages = d.getPages(), orphan = new Set();
    for (const f of d.getForm().getFields()) {
      const type = fieldType(f);
      if (!type) continue;
      const name = f.getName();
      const value = type === 'text' ? (f.getText() || '') : type === 'check' ? f.isChecked() : type === 'select' ? (f.getSelected()[0] || '') : (f.getSelected() || '');
      const options = type === 'select' || type === 'radio' ? f.getOptions() : null;
      f.acroField.getWidgets().forEach((w, wi) => {
        const pRef = w.P();
        let pi = pages.findIndex(p => p.ref === pRef);
        if (pi < 0) pi = pages.findIndex(p => (p.node.Annots()?.asArray() || []).some(a => a === w.dict || d.context.lookup(a) === w.dict));
        if (pi < 0) { orphan.add(name); return; }          // 쪽에 붙지 않은 칸(다른 프로그램이 저장하며 끊긴 경우)
        const r = w.getRectangle();
        P.form.push({ name, type, value, options, page: pi, rect: [r.x, r.y, r.x + r.width, r.y + r.height], first: wi === 0 });
      });
    }
    const shown = new Set(P.form.map(f => f.name));
    const lost = [...orphan].filter(n => !shown.has(n));
    if (lost.length) host.toast(`쪽에 연결되지 않은 입력 칸 ${lost.length}개는 고칠 수 없어 그대로 둡니다`);
  } catch (e) { P.form = []; console.warn('양식 읽기 실패', e); }
}

/* ---------- 그리기 ---------- */
function drawAll() {
  P.observer?.disconnect();
  P.observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(e.target); }), { rootMargin: '600px 0px' });
  P.pagesEl.innerHTML = '';
  P.pages.forEach((pg, i) => {
    const vp = viewport(pg, P.scale);
    const box = document.createElement('section');
    box.className = 'pv-page'; box.dataset.id = pg.id; box.id = 'pv-p' + (i + 1);
    const hb = (a, t, dis) => `<button data-a="${a}" title="${t}" aria-label="${t}" ${dis ? 'disabled' : ''}${a === 'del' ? ' class="pv-danger"' : ''}>${ic(a)}</button>`;
    box.innerHTML = `<div class="pv-ph"><span class="pv-no">${i + 1}<small> / ${P.pages.length}</small></span>
      <label class="pv-pick" title="이 쪽 고르기(고른 쪽만 저장)"><input type="checkbox" data-a="pick"> 고르기</label>
      <span class="pv-sp"></span>
      <span class="pv-phb">${hb('rl', '왼쪽으로 돌리기')}${hb('rr', '오른쪽으로 돌리기')}${hb('up', '앞으로', !i)}${hb('down', '뒤로', i >= P.pages.length - 1)}${hb('dup', '이 쪽 복제')}${hb('del', '이 쪽 삭제')}</span></div>
      <div class="pv-pc" style="width:${vp.width}px;height:${vp.height}px"><canvas></canvas><div class="pv-ov"></div></div>`;
    box.querySelector('[data-a=pick]').checked = !!pg.pick;
    P.pagesEl.appendChild(box);
    drawObjs(pg, box);
    P.observer.observe(box);
  });
}
const boxOf = pg => P.pagesEl.querySelector(`.pv-page[data-id="${pg.id}"]`);
const pageOf = el => P.pages.find(p => p.id === +el.closest('.pv-page').dataset.id);

async function renderPage(box) {
  const pg = pageOf(box);
  if (!pg) return;
  const key = `${P.scale}|${totalRot(pg)}`;
  if (box.dataset.rendered === key) return;
  box.dataset.rendered = key;
  const vp = viewport(pg, P.scale), dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = box.querySelector('canvas');
  cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
  cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
  const ctx = cv.getContext('2d');
  try {
    // 양식 칸을 화면 위 입력 칸으로 덮는 쪽은 PDF 안의 칸 그림을 빼고 그린다(입력값이 두 번 겹쳐 보이지 않게)
    const hasForm = pg.src === 0 && P.form.some(f => f.page === pg.idx);
    await pg.proxy.render({ canvas: cv, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      annotationMode: hasForm ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE }).promise;
  } catch (e) { if (e?.name !== 'RenderingCancelledException') host.toast('이 쪽을 그리지 못했습니다: ' + (e?.message || e)); }
}

/* 객체 하나를 화면 요소로 */
function objEl(o) {
  const s = P.scale, el = document.createElement('div');
  el.className = 'pv-o pv-' + o.type + (P.sel === o.id ? ' sel' : '');
  el.dataset.oid = o.id;
  el.style.left = o.x * s + 'px'; el.style.top = o.y * s + 'px';
  if (o.type !== 'pen' && o.type !== 'line') { el.style.width = o.w * s + 'px'; el.style.height = o.h * s + 'px'; }
  if (o.type === 'text' || o.type === 'fix') {
    const t = document.createElement('div');
    t.className = 'pv-t'; t.textContent = o.text;
    Object.assign(t.style, { fontSize: o.size * s + 'px', color: o.color, fontWeight: o.bold ? 700 : 400, lineHeight: 1.25 });
    if (o.type === 'fix') el.style.background = o.bg;
    el.appendChild(t);
  } else if (o.type === 'hl') el.style.background = hexA(o.color, .38);
  else if (o.type === 'white') el.style.background = o.color || '#ffffff';
  else if (o.type === 'rect') el.style.border = `${Math.max(1, o.lw * s)}px solid ${o.color}`;
  else if (o.type === 'image') el.innerHTML = `<img src="${o.url}" draggable="false">`;
  else if (o.type === 'table') { el.appendChild(tableEl(o)); if (P.sel === o.id) tableHandles(o, el); }
  else if (o.type === 'line' || o.type === 'pen') {
    const pts = o.type === 'line' ? [[o.x, o.y], [o.x2, o.y2]] : o.pts;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = o.lw + 4;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
    el.style.left = x0 * s + 'px'; el.style.top = y0 * s + 'px'; el.style.width = (x1 - x0) * s + 'px'; el.style.height = (y1 - y0) * s + 'px';
    el.innerHTML = `<svg width="100%" height="100%" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${o.color}" stroke-width="${o.lw}" stroke-linecap="round" stroke-linejoin="round" ${o.type === 'line' && o.hl ? 'stroke-opacity=".38"' : ''}/></svg>`;
  }
  if (P.sel === o.id && !['pen', 'line'].includes(o.type)) el.insertAdjacentHTML('beforeend', '<i class="pv-hd" data-h="se"></i>');
  return el;
}
/* ---------- 표: 칸 고르기·합치기·정렬·칸 색·열/행 크기 ----------
   o.colW·o.rowH 는 비율(합 1), o.st["r,c"] = { align, bg, bold, color }, o.merges = [{ r, c, rs, cs }] */
function tbNorm(o) {
  const R = o.cells.length, C = o.cells[0].length;
  if (!o.rowH || o.rowH.length !== R) o.rowH = Array(R).fill(1 / R);
  if (!o.colW || o.colW.length !== C) o.colW = Array(C).fill(1 / C);
  o.st ??= {}; o.merges ??= []; o.lw ??= .8; o.line ??= '#333333';
  return o;
}
const tbMergeAt = (o, r, c) => o.merges.find(m => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
const tbCovered = (o, r, c) => { const m = tbMergeAt(o, r, c); return m && (m.r !== r || m.c !== c); };
function tbGrid(o) {                                   // 열·행 경계 좌표(화면 pt)
  let x = o.x, y = o.y;
  return { xs: [o.x, ...o.colW.map(w => (x += w * o.w))], ys: [o.y, ...o.rowH.map(h => (y += h * o.h))] };
}
function cellStyle(o, r, c) {
  const st = o.st[r + ',' + c] || {}, head = o.head && r === 0;
  return { align: st.align || (head ? 'center' : 'left'), bg: st.bg || (head ? hexA(o.line, .12) : ''), bgHex: st.bg || (head ? o.line : null), bgA: st.bg ? 1 : head ? .12 : 0,
    bold: st.bold ?? head, color: st.color || o.color };
}
function tableEl(o) {
  tbNorm(o);
  const s = P.scale, sel = P.cellSel?.oid === o.id ? P.cellSel : null;
  const inSel = (r, c) => sel && r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && c >= Math.min(sel.c0, sel.c1) && c <= Math.max(sel.c0, sel.c1);
  const t = document.createElement('table');
  t.className = 'pv-tb';
  Object.assign(t.style, { fontSize: o.size * s + 'px' });
  t.innerHTML = `<colgroup>${o.colW.map(w => `<col style="width:${w * 100}%">`).join('')}</colgroup>` + o.cells.map((row, r) =>
    `<tr style="height:${o.rowH[r] * o.h * s}px">${row.map((txt, c) => {
      if (tbCovered(o, r, c)) return '';
      const m = tbMergeAt(o, r, c), cs = cellStyle(o, r, c);
      return `<td data-r="${r}" data-c="${c}"${m ? ` rowspan="${m.rs}" colspan="${m.cs}"` : ''} class="${inSel(r, c) ? 'csel' : ''}" style="border:${Math.max(1, o.lw * s)}px solid ${o.line};text-align:${cs.align};color:${cs.color};font-weight:${cs.bold ? 700 : 400}${cs.bg ? ';background:' + cs.bg : ''}">${esc(txt)}</td>`;
    }).join('')}</tr>`).join('');
  return t;
}
/* 고른 표에만: 옮기기 손잡이, 열·행 경계 끌기 손잡이 */
function tableHandles(o, el) {
  const s = P.scale, { xs, ys } = tbGrid(o);
  let h = '<i class="pv-grip" title="끌어서 표 옮기기"></i>';
  xs.slice(1, -1).forEach((x, i) => (h += `<i class="pv-colh" data-ci="${i}" style="left:${(x - o.x) * s - 4}px" title="끌어서 열 너비 조절"></i>`));
  ys.slice(1, -1).forEach((y, i) => (h += `<i class="pv-rowh" data-ri="${i}" style="top:${(y - o.y) * s - 4}px" title="끌어서 행 높이 조절"></i>`));
  el.insertAdjacentHTML('beforeend', h);
}
function drawObjs(pg, box = boxOf(pg)) {
  if (!box) return;
  const ov = box.querySelector('.pv-ov');
  ov.innerHTML = '';
  pg.objs.forEach(o => ov.appendChild(objEl(o)));
  P.form.filter(f => P.pages[pageIndexOfSrc0(f.page)] === pg).forEach(f => ov.appendChild(formEl(pg, f)));
  if (P.tool === 'fix') drawTextHits(pg, ov);
}
const pageIndexOfSrc0 = i => P.pages.findIndex(p => p.src === 0 && p.idx === i);
function redrawPage(pg) { drawObjs(pg); }
function redrawAllObjs() { P.pages.forEach(pg => drawObjs(pg)); syncProps(); }

/* 양식 칸: PDF 좌표의 위젯 사각형을 화면 좌표로 */
function userRectToView(pg, r) {
  const vp = viewport(pg, 1);
  const a = vp.convertToViewportPoint(r[0], r[1]), b = vp.convertToViewportPoint(r[2], r[3]);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}
function formEl(pg, f) {
  const r = userRectToView(pg, f.rect), s = P.scale;
  const el = document.createElement('div');
  el.className = 'pv-f';
  Object.assign(el.style, { left: r.x * s + 'px', top: r.y * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' });
  const v = f.name in P.formVals ? P.formVals[f.name] : f.value;
  if (f.type === 'text') el.innerHTML = `<input type="text" value="${esc(v)}" style="font-size:${Math.min(r.h * .62, 12) * s}px">`;
  else if (f.type === 'check') el.innerHTML = `<input type="checkbox" ${v ? 'checked' : ''}>`;
  else if (f.first) el.innerHTML = `<select style="font-size:${Math.min(r.h * .62, 12) * s}px"><option value=""></option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else return document.createComment('');
  const inp = el.firstElementChild;
  inp.title = f.name; inp.dataset.fname = f.name;
  inp.addEventListener('focus', () => snapshot());              // 칸마다 되돌리기 한 단계
  const put = () => { P.formVals[f.name] = f.type === 'check' ? inp.checked : inp.value; markDirty(); };
  inp.addEventListener('input', put);                             // 칸을 벗어나지 않고 바로 저장(⌘S)해도 값이 들어가게
  inp.addEventListener('change', () => {                          // 같은 이름 칸(여러 곳에 놓인 칸)만 맞춘다. 다시 그리면 다음 칸 포커스가 사라진다
    put();
    P.root.querySelectorAll('.pv-f [data-fname]').forEach(o => { if (o !== inp && o.dataset.fname === f.name) o.type === 'checkbox' ? (o.checked = inp.checked) : (o.value = inp.value); });
  });
  return el;
}

/* ---------- 글자 고치기: 원래 글자 위치 ---------- */
async function textItems(pg) {
  const key = pg.id + '|' + totalRot(pg);
  if (P.textItems.has(key)) return P.textItems.get(key);
  const vp = viewport(pg, 1), tc = await pg.proxy.getTextContent();
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue;   // 화면에서 가로로 놓인 글자만
    const size = Math.hypot(m[2], m[3]) || Math.abs(m[3]);
    const w = it.width * (vp.scale || 1) * (Math.abs(m[0]) / Math.hypot(it.transform[0], it.transform[1]) || 1);
    out.push({ str: it.str, x: m[4], y: m[5] - size * .92, w: Math.max(w, size * .5), h: size * 1.22, size, font: tc.styles[it.fontName]?.fontFamily || '' });
  }
  P.textItems.set(key, out);
  return out;
}
async function drawTextHits(pg, ov) {
  const items = await textItems(pg), s = P.scale;
  if (P.tool !== 'fix') return;
  items.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'pv-hit'; d.dataset.ti = i; d.title = '눌러서 이 글자 고치기';
    Object.assign(d.style, { left: t.x * s + 'px', top: t.y * s + 'px', width: t.w * s + 'px', height: t.h * s + 'px' });
    ov.appendChild(d);
  });
}
/* 화면에 그려진 PDF 에서 글자 바탕색·글자색을 집어 온다 */
function sampleColors(pg, t) {
  const cv = boxOf(pg)?.querySelector('canvas');
  if (!cv || !cv.width) return { bg: '#ffffff', fg: '#111111' };
  const k = cv.width / (cv.style.width ? parseFloat(cv.style.width) : cv.width) * P.scale;
  const x = Math.max(0, Math.floor(t.x * k) - 2), y = Math.max(0, Math.floor(t.y * k)), w = Math.max(1, Math.floor(t.w * k) + 4), h = Math.max(1, Math.floor(t.h * k));
  let data;
  try { data = cv.getContext('2d').getImageData(x, y, Math.min(w, cv.width - x), Math.min(h, cv.height - y)).data; } catch { return { bg: '#ffffff', fg: '#111111' }; }
  const counts = new Map(); let dark = null, darkL = 999;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = counts.get(key) || [0, 0, 0, 0];
    c[0]++; c[1] += r; c[2] += g; c[3] += b; counts.set(key, c);
    const l = r * .3 + g * .59 + b * .11;
    if (l < darkL) { darkL = l; dark = [r, g, b]; }
  }
  const top = [...counts.values()].sort((a, b) => b[0] - a[0])[0];             // 가장 많은 색 무리의 평균 = 바탕색
  const bg = [top[1], top[2], top[3]].map(v => Math.round(v / top[0]));
  const hex = c => '#' + c.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg), fg: dark && darkL < 200 ? hex(dark) : '#111111' };
}

/* ---------- 실행 취소 ---------- */
const snapState = () => JSON.stringify({ pages: P.pages.map(p => ({ id: p.id, src: p.src, idx: p.idx, rot: p.rot, objs: p.objs })), formVals: P.formVals });
function snapshot() { P.undo.push(snapState()); if (P.undo.length > 80) P.undo.shift(); P.redo = []; }
function restore(json) {
  const d = JSON.parse(json);
  const proxyOf = (src, idx) => P.pages.find(p => p.src === src && p.idx === idx)?.proxy || P.allProxies?.get(src + ':' + idx);
  rememberProxies();
  P.pages = d.pages.map(p => ({ ...p, proxy: proxyOf(p.src, p.idx) }));
  P.formVals = d.formVals; P.sel = null;
  drawAll(); host.onPages(P.pages.map((p, i) => i + 1));
}
function rememberProxies() { P.allProxies ??= new Map(); P.pages.forEach(p => P.allProxies.set(p.src + ':' + p.idx, p.proxy)); }
function undo() { if (!P.undo.length) return; P.redo.push(snapState()); restore(P.undo.pop()); markDirty(); }
function redo() { if (!P.redo.length) return; P.undo.push(snapState()); restore(P.redo.pop()); markDirty(); }
function markDirty() { P.dirty = true; P.root?.classList.add('dirty'); host.onDirty?.(true); }

/* ---------- 도구 ---------- */
/* 선 아이콘(24 격자, 굵기 1.7). 글자 대신 아이콘 + 짧은 이름으로 편집 프로그램처럼 보이게 한다 */
const ICON = {
  select: 'M6 3.5l12 7.2-5.3 1.2-2.4 5.6z',
  fix: 'M4 7V5h10v2M9 5v11M6.5 16h5M14.5 19.5l5.8-5.8-2-2-5.8 5.8-.5 2.5z',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  hl: 'M8.5 15.5l-3 3h5l1.2-1.2M8.5 15.5l7.8-7.8 3 3-7.8 7.8zM13.5 10.5l3 3M4 21h16',
  line: 'M7 4v6.5a5 5 0 0010 0V4M5 20.5h14',
  rect: 'M4.5 6.5h15v11h-15z',
  pen: 'M4 20c3-1 4-5 7-5s3 3 6 2 2.5-6 3-10M17.5 4l2.5 2.5',
  white: 'M8 20h12M5 15.5l9.5-9.5 5 5-7 7H8z M10.5 10l5 5',
  image: 'M4 5h16v14H4zM4 16l5-5 4.5 4.5 2.5-2.5 4 4M15.5 9.2h.01',
  sign: 'M3 17c2.2 0 3-6.5 5.2-6.5S9 17 11 17s2.4-4.2 4.4-4.2S17.5 16 20 16M3 21h18',
  undo: 'M9 14l-5-5 5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  zout: 'M5 12h14', zin: 'M12 5v14M5 12h14',
  zfit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  merge: 'M7 3h7l5 5v13H7zM14 3v5h5M10 14.5h6M13 11.5v6',
  extract: 'M7 3h7l5 5v13H7zM14 3v5h5M10 15l3 3 3-3M13 10.5V18',
  save: 'M5 3h11.5L20 6.5V21H5zM8.5 3v5h7V3M8.5 21v-6.5h8V21',
  replace: 'M5 12a7 7 0 0112.2-4.7L19.5 9.5M19.5 4.5v5h-5M19 12a7 7 0 01-12.2 4.7L4.5 14.5M4.5 19.5v-5h5',
  download: 'M12 4v11.5M7 10.5l5 5 5-5M5 20h14',
  rl: 'M9 7H4.5V2.5M4.8 7A8 8 0 1112 20', rr: 'M15 7h4.5V2.5M19.2 7A8 8 0 1012 20',
  up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  dup: 'M8 8h11v12H8zM5 16V4h11', del: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5.5M13.5 11v5.5',
};
const ic = k => `<svg class="pv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
const TOOLS = [
  ['select', '선택', '고르기·옮기기·크기 바꾸기 (V)'], ['fix', '글자 수정', '원래 글자를 눌러 고친다 (E)'], ['text', '글자', '눌러서 글자 상자 넣기 (T)'],
  ['table', '표', '눌러서 표 넣기'], ['hl', '형광펜', '끌어서 칠하기 (H)'], ['line', '밑줄', '끌어서 줄 긋기 (U)'], ['rect', '사각형', '끌어서 테두리 (R)'],
  ['pen', '펜', '자유롭게 그리기 (P)'], ['white', '지우개', '끌어서 흰색으로 가리기 (W)'], ['image', '이미지', '그림 파일 넣기'], ['sign', '서명', '서명을 그려 넣기'],
];
const GROUPS = [['select', 'fix', 'text', 'table'], ['hl', 'line', 'rect', 'pen', 'white'], ['image', 'sign']];
const toolBtn = k => { const [, n, t] = TOOLS.find(x => x[0] === k); return `<button class="pv-tool" data-tool="${k}" title="${t}">${ic(k)}<span>${n}</span></button>`; };
const iconBtn = (act, title, extra = '') => `<button class="pv-ib" data-act="${act}" title="${title}" aria-label="${title}" ${extra}>${ic(act)}</button>`;
const TOOLBAR = `<div class="pv-bar">
  <div class="pv-row">
    <div class="pv-tools">${GROUPS.map(g => `<div class="pv-grp">${g.map(toolBtn).join('')}</div>`).join('<span class="pv-div"></span>')}</div>
    <span class="pv-sp"></span>
    <div class="pv-acts">
      <div class="pv-grp">${iconBtn('undo', '되돌리기 (⌘Z)')}${iconBtn('redo', '다시 (⌘⇧Z)')}</div>
      <div class="pv-grp pv-zoombox">${iconBtn('zout', '작게')}<span class="pv-zoom">125%</span>${iconBtn('zin', '크게')}${iconBtn('zfit', '폭 맞춤')}</div>
      <div class="pv-grp">${iconBtn('merge', '다른 PDF 를 뒤에 붙이기')}${iconBtn('extract', "'고르기' 한 쪽만 새 PDF 로 저장")}</div>
      <div class="pv-grp pv-savebox">
        <button class="pv-save" data-act="save" title="원본 옆에 '이름-편집.pdf' 로 저장 (⌘S)">${ic('save')}<span>저장</span></button>
        ${iconBtn('replace', '원본 파일에 덮어쓰기 (원본은 .bak 으로 남김)')}${iconBtn('download', '내려받기')}
      </div>
    </div>
  </div>
  <div class="pv-props" hidden>
    <span class="pv-props-h">고른 것</span>
    <label>크기 <input type="number" data-p="size" min="4" max="200" step="1"></label>
    <label>색 <input type="color" data-p="color"></label>
    <label class="pv-only-fix">바탕 <input type="color" data-p="bg"></label>
    <label class="pv-only-t pv-chk"><input type="checkbox" data-p="bold"> 굵게</label>
    <label class="pv-only-line">굵기 <input type="number" data-p="lw" min="0.5" max="20" step="0.5"></label>
    <span class="pv-only-tb pv-seg" title="행"><button data-tb="rowAbove">위에 행</button><button data-tb="rowBelow">아래에 행</button><button data-tb="rowDel">행 삭제</button></span>
    <span class="pv-only-tb pv-seg" title="열"><button data-tb="colLeft">왼쪽에 열</button><button data-tb="colRight">오른쪽에 열</button><button data-tb="colDel">열 삭제</button></span>
    <span class="pv-only-tb pv-seg"><button data-tb="merge" title="고른 칸 합치기">칸 합치기</button><button data-tb="split" title="합친 칸 나누기">나누기</button></span>
    <span class="pv-only-tb pv-seg" title="글자 정렬"><button data-tb="left">왼쪽</button><button data-tb="center">가운데</button><button data-tb="right">오른쪽</button><button data-tb="cellBold"><b>굵게</b></button></span>
    <label class="pv-only-tb">칸 색 <input type="color" data-cc="bg" value="#fff3bf"></label>
    <label class="pv-only-tb">칸 글자 <input type="color" data-cc="color" value="#111111"></label>
    <span class="pv-only-tb pv-seg"><button data-tb="distCols" title="열 너비 같게">열 너비 같게</button><button data-tb="distRows" title="행 높이 같게">행 높이 같게</button></span>
    <label class="pv-only-tb">선 <input type="color" data-p="line"></label>
    <label class="pv-only-tb">선 굵기 <input type="number" data-p="lw" min="0.2" max="6" step="0.2"></label>
    <label class="pv-only-tb pv-chk"><input type="checkbox" data-p="head"> 머리 행</label>
    <span class="pv-sp"></span>
    <button data-act="delobj" class="pv-delobj">${ic('del')}<span>지우기</span></button>
  </div>
  <input type="file" class="pv-file-img" accept="image/png,image/jpeg" hidden>
  <input type="file" class="pv-file-pdf" accept=".pdf,application/pdf" hidden>
</div>
<div class="pv-pages"></div>
<div class="pv-sign" hidden><div class="pv-sign-box"><div class="pv-sign-h">서명을 그려 주세요</div><canvas width="520" height="200"></canvas>
  <div class="pv-sign-b"><button data-sg="clear">지우기</button><span class="pv-sp"></span><button data-sg="cancel">취소</button><button data-sg="ok" class="pv-primary">넣기</button></div></div></div>`;

function setTool(t) {
  if (t === 'image') return $('.pv-file-img').click();
  if (t === 'sign') return openSign();
  P.tool = t;
  P.root.dataset.tool = t;
  P.root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'select') select(null);
  redrawAllObjs();
}
function bindToolbar() {
  P.root.querySelectorAll('[data-tool]').forEach(b => (b.onclick = () => setTool(b.dataset.tool)));
  P.root.querySelector('.pv-acts').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    ({ undo, redo, zout: () => zoom(P.scale / 1.2), zin: () => zoom(P.scale * 1.2), zfit: zoomFit, merge: () => $('.pv-file-pdf').click(),
      extract: () => save('extract'), save: () => save('copy'), replace: () => save('replace'), download: () => save('download') })[b.dataset.act]?.();
  });
  $('.pv-props [data-act=delobj]').onclick = () => deleteSel();
  P.root.querySelectorAll('.pv-props [data-p]').forEach(inp => inp.addEventListener('change', () => setProp(inp.dataset.p, inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value)));
  P.root.querySelectorAll('.pv-props [data-tb]').forEach(b => (b.onclick = () => tableOp(b.dataset.tb)));
  P.root.querySelectorAll('.pv-props [data-cc]').forEach(inp => inp.addEventListener('change', () => cellColor(inp.dataset.cc, inp.value)));
  $('.pv-file-img').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) addImageFile(f); };
  $('.pv-file-pdf').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    snapshot(); await addSource(new Uint8Array(await f.arrayBuffer()), f.name, false); drawAll(); host.onPages(P.pages.map((p, i) => i + 1));
  };
  P.pagesEl.addEventListener('click', onPageHeader);
  P.pagesEl.addEventListener('pointerdown', onDown);
  P.pagesEl.addEventListener('dblclick', onDbl);
  setTool('select');
  $('.pv-zoom').textContent = Math.round(P.scale * 100) + '%';
}

function zoom(k) {
  P.scale = Math.max(.4, Math.min(4, k));
  $('.pv-zoom').textContent = Math.round(P.scale * 100) + '%';
  const keep = scrollY / Math.max(1, document.documentElement.scrollHeight);
  drawAll();
  scrollTo({ top: keep * document.documentElement.scrollHeight });
}
function zoomFit() {
  const pg = P.pages[0]; if (!pg) return;
  zoom((P.pagesEl.clientWidth - 24) / viewport(pg, 1).width);
}

/* 쪽 머리 버튼 */
function onPageHeader(e) {
  const b = e.target.closest('.pv-ph [data-a]'); if (!b) return;
  const pg = pageOf(b), i = P.pages.indexOf(pg), a = b.dataset.a;
  if (a === 'pick') { pg.pick = b.checked; return; }
  snapshot();
  if (a === 'rl' || a === 'rr') rotatePage(pg, a === 'rr' ? 90 : 270);
  else if (a === 'up' && i > 0) [P.pages[i - 1], P.pages[i]] = [P.pages[i], P.pages[i - 1]];
  else if (a === 'down' && i < P.pages.length - 1) [P.pages[i + 1], P.pages[i]] = [P.pages[i], P.pages[i + 1]];
  else if (a === 'del') {
    if (P.pages.length === 1) { P.undo.pop(); return host.toast('마지막 한 쪽은 지울 수 없습니다'); }
    P.pages.splice(i, 1);
  } else if (a === 'dup') P.pages.splice(i + 1, 0, { ...pg, id: nid(), objs: JSON.parse(JSON.stringify(pg.objs)).map(o => ({ ...o, id: nid() })) });
  markDirty(); drawAll(); host.onPages(P.pages.map((p, k) => k + 1));
  document.getElementById('pv-p' + (Math.min(i + (a === 'down' ? 2 : a === 'up' ? 0 : 1), P.pages.length) || 1))?.scrollIntoView({ block: 'nearest' });
}
/* 쪽을 돌리면 그 위의 객체 좌표도 같이 돌린다 */
function rotatePage(pg, by) {
  const before = viewport(pg, 1);
  pg.rot = (pg.rot + by) % 360;
  const W = before.width, H = before.height;
  const rp = ([x, y]) => (by === 90 ? [H - y, x] : [y, W - x]);
  pg.objs.forEach(o => {
    if (o.type === 'pen') { o.pts = o.pts.map(rp); return; }
    if (o.type === 'line') { [o.x, o.y] = rp([o.x, o.y]); [o.x2, o.y2] = rp([o.x2, o.y2]); return; }
    const a = rp([o.x, o.y]), b = rp([o.x + o.w, o.y + o.h]);
    o.x = Math.min(a[0], b[0]); o.y = Math.min(a[1], b[1]);
    if (!['text', 'fix', 'table', 'image'].includes(o.type)) { o.w = Math.abs(a[0] - b[0]); o.h = Math.abs(a[1] - b[1]); }
  });
}

/* ---------- 마우스로 만들기·옮기기 ---------- */
function pointIn(ov, e) {
  const r = ov.getBoundingClientRect();
  return [(e.clientX - r.left) / P.scale, (e.clientY - r.top) / P.scale];
}
function onDown(e) {
  if (e.button !== 0) return;
  const ov = e.target.closest('.pv-ov'); if (!ov) return;
  if (e.target.closest('.pv-f')) return;                                   // 양식 칸은 그대로 입력
  const pg = pageOf(ov), p = pointIn(ov, e), oEl = e.target.closest('.pv-o');
  const editing = P.root.querySelector('[contenteditable=true]');
  if (editing?.contains(e.target)) return;                                   // 고치는 글자 안을 누름
  if (editing) editing.blur();                                               // 다른 곳을 누르면 먼저 고친 글을 반영한다(다시 그려 요소가 바뀌기 전에)
  if (P.tool === 'fix') {
    const hit = e.target.closest('.pv-hit');
    if (hit) { e.preventDefault(); return fixText(pg, +hit.dataset.ti); }
    return;
  }
  if (P.tool === 'select') {
    if (!oEl) { P.cellSel = null; return select(null); }
    const o = pg.objs.find(x => x.id === +oEl.dataset.oid); if (!o) return;
    const handle = e.target.closest('.pv-hd'), td = e.target.closest('td');
    if (o.type === 'table' && !handle && !e.target.closest('.pv-grip')) {
      e.preventDefault();
      if (e.target.closest('.pv-colh, .pv-rowh')) { select(o.id); return tableResize(e, ov, pg, o, e.target, p); }
      if (td) return cellPick(e, pg, o, td);
    }
    if (P.cellSel?.oid !== o.id) P.cellSel = null;
    select(o.id);
    e.preventDefault();
    return drag(e, ov, pg, o, handle ? 'resize' : 'move', p);
  }
  e.preventDefault();
  snapshot();
  const base = { id: nid(), color: P.color };
  let o;
  if (P.tool === 'text') o = { ...base, type: 'text', x: p[0], y: p[1] - P.size * .6, w: Math.max(80, P.size * 10), h: P.size * 1.5, text: '', size: P.size, bold: false };
  else if (P.tool === 'table') o = tbNorm({ ...base, type: 'table', x: p[0], y: p[1], w: 320, h: 88, size: 10, line: '#3a3f4b', lw: .8, head: true, cells: [['항목', '내용', '비고'], ['', '', ''], ['', '', ''], ['', '', '']] });
  else if (P.tool === 'pen') o = { ...base, type: 'pen', pts: [p], lw: 2 };
  else if (P.tool === 'line') o = { ...base, type: 'line', x: p[0], y: p[1], x2: p[0], y2: p[1], lw: 1.5 };
  else o = { ...base, type: P.tool, x: p[0], y: p[1], w: 0, h: 0, lw: 1.5, color: P.tool === 'hl' ? P.hl : P.tool === 'white' ? '#ffffff' : P.color };
  pg.objs.push(o);
  markDirty();
  if (o.type === 'text' || o.type === 'table') { drawObjs(pg); select(o.id); setTool('select'); select(o.id); return o.type === 'text' && editText(pg, o); }
  drag(e, ov, pg, o, 'draw', p);
}
function drag(e, ov, pg, o, mode, start) {
  const orig = JSON.parse(JSON.stringify(o));
  let moved = false;
  const mv = ev => {
    const p = pointIn(ov, ev), dx = p[0] - start[0], dy = p[1] - start[1];
    if (!moved && Math.hypot(dx, dy) < .8) return;
    if (!moved && mode !== 'draw') snapshot();
    moved = true;
    if (mode === 'move') {
      if (o.type === 'pen') o.pts = orig.pts.map(q => [q[0] + dx, q[1] + dy]);
      else { o.x = orig.x + dx; o.y = orig.y + dy; if (o.type === 'line') { o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; } }
    } else if (mode === 'resize') {
      o.w = Math.max(8, orig.w + dx); o.h = Math.max(6, orig.h + dy);
      if (o.type === 'image' && o.ratio && !ev.shiftKey) o.h = o.w / o.ratio;
    } else if (o.type === 'pen') o.pts.push(p);
    else if (o.type === 'line') { o.x2 = p[0]; o.y2 = ev.shiftKey ? p[1] : o.y; }
    else { o.x = Math.min(start[0], p[0]); o.y = Math.min(start[1], p[1]); o.w = Math.abs(dx); o.h = Math.abs(dy); }
    redrawOne(pg, o);
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (mode === 'draw') {
      const tiny = o.type === 'pen' ? o.pts.length < 2 : o.type === 'line' ? Math.abs(o.x2 - o.x) < 2 : (o.w < 2 || o.h < 2);
      if (tiny) { pg.objs.splice(pg.objs.indexOf(o), 1); P.undo.pop(); }
      drawObjs(pg);
    } else if (moved) markDirty();
    syncProps();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function redrawOne(pg, o) {
  const ov = boxOf(pg)?.querySelector('.pv-ov'); if (!ov) return;
  const old = ov.querySelector(`[data-oid="${o.id}"]`), el = objEl(o);
  old ? old.replaceWith(el) : ov.appendChild(el);
}
function onDbl(e) {
  const oEl = e.target.closest('.pv-o'); if (!oEl || P.tool !== 'select') return;
  const pg = pageOf(oEl), o = pg.objs.find(x => x.id === +oEl.dataset.oid); if (!o) return;
  if (o.type === 'text' || o.type === 'fix') editText(pg, o);
  else if (o.type === 'table') { const td = e.target.closest('td'); if (td) editCell(pg, o, +td.dataset.r, +td.dataset.c); }
}
function editText(pg, o) {
  const el = boxOf(pg)?.querySelector(`[data-oid="${o.id}"] .pv-t`); if (!el) return;
  snapshot();
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r);
  el.oninput = () => {                               // 치는 동안 상자(고친 글자는 덮는 바탕까지)를 글 길이에 맞춰 늘린다
    o.text = el.innerText.replace(/\n$/, ''); fitBox(o);
    const box = el.parentElement; box.style.width = o.w * P.scale + 'px'; box.style.height = o.h * P.scale + 'px';
  };
  el.onblur = () => {
    el.contentEditable = 'false';
    o.text = el.innerText.replace(/\n$/, '');
    if (o.type === 'text' && !o.text.trim()) { pg.objs.splice(pg.objs.indexOf(o), 1); select(null); }
    else fitBox(o);
    markDirty(); drawObjs(pg);
  };
}
function tdOf(pg, o, r, c) {
  const m = tbMergeAt(o, r, c); if (m) { r = m.r; c = m.c; }
  return boxOf(pg)?.querySelector(`[data-oid="${o.id}"] td[data-r="${r}"][data-c="${c}"]`);
}
function editCell(pg, o, r, c, initial, caretEnd) {
  const td = tdOf(pg, o, r, c); if (!td) return;
  r = +td.dataset.r; c = +td.dataset.c;
  P.cellSel = { oid: o.id, r0: r, c0: c, r1: r, c1: c };
  snapshot();
  td.classList.add('editing');
  td.contentEditable = 'true'; td.focus();
  if (initial != null) { td.textContent = initial; const rg = document.createRange(); rg.selectNodeContents(td); rg.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(rg); }
  else { const rg = document.createRange(); rg.selectNodeContents(td); if (caretEnd) rg.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(rg); }
  let moveTo = null;
  td.onblur = () => {
    td.contentEditable = 'false';
    o.cells[r][c] = td.innerText.replace(/\n$/, '');
    autoRowHeight(o, r);
    markDirty(); drawObjs(pg);
    if (moveTo) {
      const [nr, nc, edit] = moveTo; moveTo = null;
      if (nr >= o.cells.length) tableOp('rowBelow', o, pg, nr - 1);    // 마지막 칸에서 Tab 이면 행을 하나 늘린다
      edit ? editCell(pg, o, nr, nc) : cellGo(pg, o, nr, nc);
    }
  };
  td.onkeydown = ev => {
    const R = o.cells.length, C = o.cells[0].length;
    if (ev.key === 'Tab') {
      ev.preventDefault();
      let [nr, nc] = ev.shiftKey ? (c ? [r, c - 1] : [r - 1, C - 1]) : (c < C - 1 ? [r, c + 1] : [r + 1, 0]);
      if (nr < 0) return;
      moveTo = [nr, nc, true]; td.blur();
    } else if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); moveTo = [Math.min(r + 1, R - 1), c, true]; td.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); moveTo = [r, c, false]; td.blur(); }
    else if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.isComposing && !ev.shiftKey) {
      const nr = r + (ev.key === 'ArrowUp' ? -(1) : (tbMergeAt(o, r, c)?.rs || 1));
      if (nr >= 0 && nr < R) { ev.preventDefault(); moveTo = [nr, c, true]; td.blur(); }
    } else if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !ev.isComposing && !ev.shiftKey) {
      const sel = getSelection(), len = td.innerText.replace(/\n$/, '').length;
      const off = sel.rangeCount ? (() => { const rg = sel.getRangeAt(0).cloneRange(); rg.selectNodeContents(td); rg.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset); return rg.toString().length; })() : 0;
      if (sel.isCollapsed && ev.key === 'ArrowLeft' && off === 0 && c > 0) { ev.preventDefault(); moveTo = [r, c - 1, true]; td.blur(); }
      else if (sel.isCollapsed && ev.key === 'ArrowRight' && off >= len && c + (tbMergeAt(o, r, c)?.cs || 1) < C) { ev.preventDefault(); moveTo = [r, c + (tbMergeAt(o, r, c)?.cs || 1), true]; td.blur(); }
    }
  };
}
/* 글이 칸보다 길면 그 행을 늘린다(줄 수 × 글자 크기) */
function autoRowHeight(o, r) {
  const need = Math.max(...o.cells[r].map(t => (t.split('\n').length) * o.size * 1.3 + 6));
  const cur = o.rowH[r] * o.h;
  if (need > cur + .5) { const add = need - cur; o.rowH = o.rowH.map((h, i) => (h * o.h + (i === r ? add : 0))); o.h += add; o.rowH = o.rowH.map(h => h / o.h); }
}
function cellGo(pg, o, r, c) {
  const R = o.cells.length, C = o.cells[0].length;
  r = Math.max(0, Math.min(R - 1, r)); c = Math.max(0, Math.min(C - 1, c));
  P.cellSel = { oid: o.id, r0: r, c0: c, r1: r, c1: c };
  drawObjs(pg); syncProps();
}
/* 칸 누르기: 한 칸 고르기, 끌면 여러 칸, Shift 로 넓히기 */
function cellPick(e, pg, o, td) {
  const r = +td.dataset.r, c = +td.dataset.c;
  o = pg.objs.find(x => x.id === o.id) || o;
  if (P.sel !== o.id) select(o.id);
  if (e.shiftKey && P.cellSel?.oid === o.id) Object.assign(P.cellSel, { r1: r, c1: c });
  else P.cellSel = { oid: o.id, r0: r, c0: c, r1: r, c1: c };
  drawObjs(pg); syncProps();
  const mv = ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(`[data-oid="${o.id}"] td`); if (!el) return;
    const m = tbMergeAt(o, +el.dataset.r, +el.dataset.c);
    const nr = m ? m.r + m.rs - 1 : +el.dataset.r, nc = m ? m.c + m.cs - 1 : +el.dataset.c;
    if (nr !== P.cellSel.r1 || nc !== P.cellSel.c1) { P.cellSel.r1 = nr; P.cellSel.c1 = nc; drawObjs(pg); syncProps(); }
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    const s1 = P.cellSel;
    if (!e.shiftKey && s1 && s1.r0 === s1.r1 && s1.c0 === s1.c1) editCell(pg, o, r, c, null, true);   // 한 칸만 눌렀으면 바로 입력(한글 입력기도 그대로 된다)
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function tableResize(e, ov, pg, o, h, start) {
  snapshot();
  const isCol = h.classList.contains('pv-colh'), i = +(isCol ? h.dataset.ci : h.dataset.ri);
  const arr = isCol ? o.colW : o.rowH, total = isCol ? o.w : o.h, a0 = arr[i], b0 = arr[i + 1], min = 10 / total;
  const mv = ev => {
    const p = pointIn(ov, ev), d = ((isCol ? p[0] - start[0] : p[1] - start[1]) / total);
    const dd = Math.max(min - a0, Math.min(b0 - min, d));
    arr[i] = a0 + dd; arr[i + 1] = b0 - dd;
    redrawOne(pg, o);
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); markDirty(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
const selRange = () => { const s = P.cellSel; return s && { r0: Math.min(s.r0, s.r1), r1: Math.max(s.r0, s.r1), c0: Math.min(s.c0, s.c1), c1: Math.max(s.c0, s.c1) }; };
/* 행·열 넣기/빼기 때 합친 칸·칸 모양을 같이 옮긴다 */
function shiftTable(o, axis, at, delta) {
  const key = axis === 'r' ? 0 : 1;
  const st = {};
  for (const [k, v] of Object.entries(o.st)) {
    const rc = k.split(',').map(Number);
    if (delta < 0 && rc[key] === at) continue;
    if (rc[key] >= at + (delta < 0 ? 1 : 0)) rc[key] += delta;
    st[rc.join(',')] = v;
  }
  o.st = st;
  o.merges = o.merges.flatMap(m => {
    const p = axis === 'r' ? 'r' : 'c', sz = axis === 'r' ? 'rs' : 'cs';
    if (delta > 0) { if (m[p] >= at) m[p]++; else if (at < m[p] + m[sz]) m[sz]++; }
    else { if (m[p] > at) m[p]--; else if (at < m[p] + m[sz]) m[sz]--; }
    return m.rs * m.cs > 1 && m[sz] > 0 ? [m] : [];
  });
}
/* 글자 상자는 글 길이에 맞춰 넓힌다(측정은 화면 글꼴 기준) */
function fitBox(o) {
  const c = fitBox.cv ??= document.createElement('canvas').getContext('2d');
  c.font = `${o.bold ? 700 : 400} ${o.size}px "MDPDF Nanum", "Apple SD Gothic Neo", sans-serif`;
  const lines = o.text.split('\n');
  const w = Math.max(...lines.map(l => c.measureText(l).width)) + 4;
  if (o.type === 'text') o.w = Math.max(o.w, w);
  else o.w = Math.max(o.orig?.w || 0, w);
  o.h = Math.max(o.type === 'fix' ? o.orig?.h || 0 : 0, lines.length * o.size * 1.25 + 2);
}

async function fixText(pg, ti) {
  const t = (await textItems(pg))[ti]; if (!t) return;
  snapshot();
  const { bg, fg } = sampleColors(pg, t);
  const o = { id: nid(), type: 'fix', x: t.x - 1, y: t.y, w: t.w + 2, h: t.h, text: t.str, size: +t.size.toFixed(2), color: fg, bg, bold: /bold|black|heavy/i.test(t.font), orig: { x: t.x - 1, y: t.y, w: t.w + 2, h: t.h } };
  pg.objs.push(o); markDirty();
  setTool('select'); select(o.id); drawObjs(pg);
  editText(pg, o);
}

/* ---------- 고른 객체 속성 ---------- */
function curObj() {
  for (const pg of P.pages) { const o = pg.objs.find(x => x.id === P.sel); if (o) return [pg, o]; }
  return [];
}
function select(id) {
  if (P.sel === id) return syncProps();
  const prev = curObj()[0];
  P.sel = id;
  if (prev) drawObjs(prev);
  const [pg] = curObj(); if (pg && pg !== prev) drawObjs(pg);
  syncProps();
}
function syncProps() {
  const bar = P.root && $('.pv-props'); if (!bar) return;
  const [, o] = curObj();
  bar.hidden = !o;
  if (!o) return;
  bar.dataset.type = o.type;
  const set = (k, v) => bar.querySelectorAll(`[data-p=${k}]`).forEach(i => (i.type === 'checkbox' ? (i.checked = !!v) : (i.value = v ?? '')));
  set('size', o.size ?? ''); set('color', toHex(o.color || '#111111')); set('bg', toHex(o.bg || '#ffffff')); set('bold', o.bold); set('lw', o.lw ?? ''); set('head', o.head); set('line', toHex(o.line || '#333333'));
  const h = bar.querySelector('.pv-props-h');
  if (h) { const sr = o.type === 'table' && selRange(); h.textContent = o.type === 'table' ? (sr && P.cellSel.oid === o.id ? `표 · ${sr.r1 - sr.r0 + 1}×${sr.c1 - sr.c0 + 1}칸 고름` : '표') : ({ text: '글자', fix: '고친 글자', hl: '형광펜', line: '밑줄', rect: '사각형', pen: '펜', white: '덮기', image: '이미지' }[o.type] || '고른 것'); }
}
function setProp(k, v) {
  const [pg, o] = curObj(); if (!o) return;
  snapshot();
  if (k === 'size') { o.size = Math.max(4, v || o.size); if (o.type === 'text' || o.type === 'fix') fitBox(o); }
  else o[k] = v;
  if (k === 'color' && o.type === 'table') o.line = v;
  if (k === 'color') P.color = v;
  if (k === 'size') P.size = o.size;
  markDirty(); drawObjs(pg);
}
function tableOp(op, o0, pg0, at) {
  let [pg, o] = curObj();
  if (o0) { o = o0; pg = pg0; }
  if (!o || o.type !== 'table') return;
  tbNorm(o);
  if (!o0) snapshot();
  const R = o.cells.length, C = o.cells[0].length, sr = selRange() || { r0: R - 1, r1: R - 1, c0: C - 1, c1: C - 1 };
  const rowH = o.h / R, colW = o.w / C;
  const addRow = i => { o.cells.splice(i, 0, Array(C).fill('')); const hs = o.rowH.map(h => h * o.h); hs.splice(i, 0, rowH); o.h += rowH; o.rowH = hs.map(h => h / o.h); shiftTable(o, 'r', i, 1); };
  const addCol = i => { o.cells.forEach(r => r.splice(i, 0, '')); const ws = o.colW.map(w => w * o.w); ws.splice(i, 0, colW); o.w += colW; o.colW = ws.map(w => w / o.w); shiftTable(o, 'c', i, 1); };
  const delRow = i => { if (o.cells.length < 2) return; const hs = o.rowH.map(h => h * o.h); o.h -= hs[i]; hs.splice(i, 1); o.cells.splice(i, 1); o.rowH = hs.map(h => h / o.h); shiftTable(o, 'r', i, -1); };
  const delCol = i => { if (o.cells[0].length < 2) return; const ws = o.colW.map(w => w * o.w); o.w -= ws[i]; ws.splice(i, 1); o.cells.forEach(r => r.splice(i, 1)); o.colW = ws.map(w => w / o.w); shiftTable(o, 'c', i, -1); };
  const each = f => { for (let r = sr.r0; r <= sr.r1; r++) for (let c = sr.c0; c <= sr.c1; c++) f(r, c); };
  const stOf = (r, c) => (o.st[r + ',' + c] ??= {});
  if (op === 'rowAbove') addRow(sr.r0);
  else if (op === 'rowBelow') addRow((at ?? sr.r1) + 1);
  else if (op === 'colLeft') addCol(sr.c0);
  else if (op === 'colRight') addCol(sr.c1 + 1);
  else if (op === 'rowDel') { for (let r = sr.r1; r >= sr.r0; r--) delRow(r); P.cellSel = null; }
  else if (op === 'colDel') { for (let c = sr.c1; c >= sr.c0; c--) delCol(c); P.cellSel = null; }
  else if (op === 'merge') {
    if (sr.r0 === sr.r1 && sr.c0 === sr.c1) return host.toast('합칠 칸을 끌어서 두 칸 이상 고르세요');
    o.merges = o.merges.filter(m => m.r + m.rs <= sr.r0 || m.r > sr.r1 || m.c + m.cs <= sr.c0 || m.c > sr.c1);
    const txt = []; each((r, c) => { if (o.cells[r][c]) txt.push(o.cells[r][c]); if (r !== sr.r0 || c !== sr.c0) o.cells[r][c] = ''; });
    o.cells[sr.r0][sr.c0] = txt.join(' ');
    o.merges.push({ r: sr.r0, c: sr.c0, rs: sr.r1 - sr.r0 + 1, cs: sr.c1 - sr.c0 + 1 });
    P.cellSel = { oid: o.id, r0: sr.r0, c0: sr.c0, r1: sr.r1, c1: sr.c1 };
  } else if (op === 'split') o.merges = o.merges.filter(m => !(m.r >= sr.r0 && m.r <= sr.r1 && m.c >= sr.c0 && m.c <= sr.c1) && !tbMergeAtList([m], sr.r0, sr.c0));
  else if (op === 'left' || op === 'center' || op === 'right') each((r, c) => (stOf(r, c).align = op));
  else if (op === 'cellBold') { const on = !cellStyle(o, sr.r0, sr.c0).bold; each((r, c) => (stOf(r, c).bold = on)); }
  else if (op === 'clear') each((r, c) => (o.cells[r][c] = ''));
  else if (op === 'distCols') o.colW = o.colW.map(() => 1 / o.colW.length);
  else if (op === 'distRows') o.rowH = o.rowH.map(() => 1 / o.rowH.length);
  markDirty(); drawObjs(pg); syncProps();
}
const tbMergeAtList = (list, r, c) => list.find(m => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
function cellColor(k, v) {
  const [pg, o] = curObj(); if (!o || o.type !== 'table') return;
  const sr = selRange(); if (!sr) return host.toast('색을 바꿀 칸을 먼저 고르세요');
  snapshot();
  for (let r = sr.r0; r <= sr.r1; r++) for (let c = sr.c0; c <= sr.c1; c++) (o.st[r + ',' + c] ??= {})[k] = v;
  markDirty(); drawObjs(pg);
}
function deleteSel() {
  const [pg, o] = curObj(); if (!o) return;
  snapshot(); pg.objs.splice(pg.objs.indexOf(o), 1); P.sel = null; markDirty(); drawObjs(pg); syncProps();
}

/* ---------- 이미지·서명 ---------- */
function visiblePage() {
  const mid = innerHeight / 2;
  return P.pages.find(pg => { const r = boxOf(pg)?.getBoundingClientRect(); return r && r.top < mid && r.bottom > mid; }) || P.pages[0];
}
async function addImageFile(file) {
  const url = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(file); });
  addImage(url, file.type === 'image/png' ? 'png' : 'jpg');
}
async function addImage(url, kind, w0) {
  const img = new Image(); img.src = url; await img.decode();
  const pg = visiblePage(), vp = viewport(pg, 1);
  const w = Math.min(w0 || 180, vp.width * .6), h = w * img.naturalHeight / img.naturalWidth;
  snapshot();
  const o = { id: nid(), type: 'image', url, kind, ratio: w / h, x: (vp.width - w) / 2, y: (vp.height - h) / 2, w, h };
  pg.objs.push(o); markDirty(); setTool('select'); select(o.id); drawObjs(pg);
  host.toast('이미지를 쪽 가운데에 넣었습니다. 끌어서 옮기세요');
}
function openSign() {
  const box = $('.pv-sign'), cv = box.querySelector('canvas'), c = cv.getContext('2d');
  box.hidden = false;
  c.clearRect(0, 0, cv.width, cv.height); c.lineWidth = 3; c.lineCap = c.lineJoin = 'round'; c.strokeStyle = '#111';
  let drawing = false, any = false;
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { drawing = true; any = true; c.beginPath(); c.moveTo(...pt(e)); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (drawing) { c.lineTo(...pt(e)); c.stroke(); } };
  cv.onpointerup = () => (drawing = false);
  box.onclick = e => {
    const a = e.target.closest('[data-sg]')?.dataset.sg; if (!a) return;
    if (a === 'clear') { c.clearRect(0, 0, cv.width, cv.height); any = false; return; }
    box.hidden = true;
    if (a === 'ok' && any) addImage(trimCanvas(cv).toDataURL('image/png'), 'png', 140);
  };
}
function trimCanvas(cv) {
  const c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0 + 8); out.height = Math.max(1, y1 - y0 + 8);
  out.getContext('2d').drawImage(cv, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------- 키보드 ---------- */
function onKey(e) {
  if (!isOpen()) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable=true]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); return save('copy'); }
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); return e.shiftKey ? redo() : undo(); }
  const [cpg, co] = curObj();
  if (co?.type === 'table' && P.cellSel?.oid === co.id && !mod) {          // 칸을 고른 상태: 엑셀처럼
    const s0 = P.cellSel, stop = () => { e.preventDefault(); e.stopPropagation(); };
    const mvk = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (mvk) { stop(); if (e.shiftKey) { s0.r1 = Math.max(0, Math.min(co.cells.length - 1, s0.r1 + mvk[0])); s0.c1 = Math.max(0, Math.min(co.cells[0].length - 1, s0.c1 + mvk[1])); drawObjs(cpg); return syncProps(); } return cellGo(cpg, co, s0.r1 + mvk[0], s0.c1 + mvk[1]); }
    if (e.key === 'Tab') { stop(); return cellGo(cpg, co, s0.r1, s0.c1 + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Enter' || e.key === 'F2') { stop(); return editCell(cpg, co, s0.r1, s0.c1); }
    if (e.key === 'Delete' || e.key === 'Backspace') { stop(); return tableOp('clear'); }
    if (e.key === 'Escape') { stop(); P.cellSel = null; drawObjs(cpg); return syncProps(); }
    if (e.key.length === 1 && !e.altKey) { stop(); return editCell(cpg, co, s0.r1, s0.c1, e.key); }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && P.sel) { e.preventDefault(); e.stopPropagation(); return deleteSel(); }
  if (e.key === 'Escape') { select(null); return setTool('select'); }
  if (mod || e.altKey) return;
  const k = { v: 'select', e: 'fix', t: 'text', h: 'hl', u: 'line', r: 'rect', p: 'pen', w: 'white' }[e.key.toLowerCase()];
  if (k) { e.preventDefault(); e.stopPropagation(); setTool(k); }
}

/* ---------- 저장 ---------- */
function hexA(hex, a) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
function rgbOf(c) {
  const h = toHex(c).slice(1);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map(x => x + x).join('');
  return '#111111';
}
const pdfRgb = c => { const [r, g, b] = rgbOf(c); return PDFLib.rgb(r / 255, g / 255, b / 255); };

async function build(onlyPicked) {
  const { PDFDocument, degrees, LineCapStyle } = PDFLib;
  const keep = onlyPicked ? P.pages.filter(p => p.pick) : P.pages;
  if (!keep.length) throw new Error('고른 쪽이 없습니다. 쪽 위 "고르기"를 눌러 주세요');
  const docs = await Promise.all(P.srcs.map(s => PDFDocument.load(s.bytes, { ignoreEncryption: true })));
  const d0 = docs[0];
  // 한글 글꼴은 통째로 넣는다(약 2MB). 글자 추리기(subset)로 넣으면 한글 일부가 안 보인다(나눔고딕·Pretendard 둘 다 시험해 확인).
  // 영문·숫자만 쓰면 PDF 기본 글꼴(Helvetica)을 써서 크기가 늘지 않는다.
  const fontsFor = doc => {
    const cache = {};
    return async (b, str) => {
      const wide = /[^\x20-\x7e]/.test(str || '');
      const key = (wide ? 'k' : 'h') + (b ? 'b' : '');
      if (!cache[key]) {
        if (wide) { doc.registerFontkit(fontkit); cache[key] = doc.embedFont(await fontBytes(b), { subset: false }); }
        else cache[key] = doc.embedFont(b ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica);
      }
      return cache[key];
    };
  };
  const fonts = fontsFor(d0);
  // 양식 값
  const changed = Object.keys(P.formVals);
  if (changed.length) {
    const form = d0.getForm();
    for (const name of changed) {
      const v = P.formVals[name], f = form.getField(name), k = fieldType(f);
      if (k === 'text') f.setText(String(v));
      else if (k === 'check') v ? f.check() : f.uncheck();
      else if (k) { if (v) f.select(v); else if (f.clear) f.clear(); }
    }
    const anyWide = changed.some(n => typeof P.formVals[n] === 'string' && /[^\x20-\x7e]/.test(P.formVals[n]));
    form.updateFieldAppearances(anyWide ? await fonts(false, '가') : undefined);
  }
  const sameShape = !onlyPicked && P.srcs.length === 1 && keep.length === d0.getPageCount() && keep.every((p, i) => p.src === 0 && p.idx === i);
  let out = d0, outPages;
  if (sameShape) outPages = d0.getPages();
  else {
    if (changed.length || d0.getForm().getFields().length) { try { d0.getForm().flatten(); } catch {} }   // 쪽을 옮기면 양식 연결이 끊기므로 값을 그림으로 굳힌다
    out = await PDFDocument.create();
    outPages = [];
    for (const p of keep) { const [cp] = await out.copyPages(docs[p.src], [p.idx]); outPages.push(out.addPage(cp)); }
  }
  const embedFont = out === d0 ? fonts : fontsFor(out);
  const imgCache = new Map();
  for (let i = 0; i < keep.length; i++) {
    const pg = keep[i], page = outPages[i], r = totalRot(pg);
    page.setRotation(degrees(r));
    const vp = viewport(pg, 1);
    const U = (x, y) => vp.convertToPdfPoint(x, y);                 // 화면 좌표(pt) → PDF 좌표
    const rect = (x, y, w, h) => { const a = U(x, y), b = U(x + w, y + h); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }; };
    const text = async (str, x, y, size, color, b, maxW) => {
      const f = await embedFont(b, str);
      const lines = String(str).split('\n');
      lines.forEach((ln, li) => {
        if (!ln) return;
        let s = ln;
        if (maxW) while (s.length > 1 && f.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -1);
        const base = U(x, y + size * .93 + li * size * 1.25);
        page.drawText(s, { x: base[0], y: base[1], size, font: f, color: pdfRgb(color), rotate: degrees(r) });
      });
    };
    for (const o of pg.objs) {
      if (o.type === 'hl') page.drawRectangle({ ...rect(o.x, o.y, o.w, o.h), color: pdfRgb(o.color), opacity: .38 });
      else if (o.type === 'white') page.drawRectangle({ ...rect(o.x, o.y, o.w, o.h), color: pdfRgb(o.color || '#ffffff') });
      else if (o.type === 'rect') page.drawRectangle({ ...rect(o.x, o.y, o.w, o.h), borderColor: pdfRgb(o.color), borderWidth: o.lw });
      else if (o.type === 'line' || o.type === 'pen') {
        const pts = o.type === 'line' ? [[o.x, o.y], [o.x2, o.y2]] : o.pts;
        for (let k = 1; k < pts.length; k++) {
          const a = U(...pts[k - 1]), b = U(...pts[k]);
          page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: o.lw, color: pdfRgb(o.color), lineCap: LineCapStyle.Round, opacity: o.hl ? .38 : 1 });
        }
      } else if (o.type === 'text') await text(o.text, o.x + 2, o.y + 1, o.size, o.color, o.bold);
      else if (o.type === 'fix') {
        page.drawRectangle({ ...rect(o.x, o.y, o.w, o.h), color: pdfRgb(o.bg) });
        await text(o.text, o.x + 1, o.y - o.size * .01, o.size, o.color, o.bold);     // 원래 글자와 같은 기준선
      } else if (o.type === 'image') {
        let im = imgCache.get(o.url);
        if (!im) { im = o.kind === 'png' ? await out.embedPng(o.url) : await out.embedJpg(o.url); imgCache.set(o.url, im); }
        const a = U(o.x, o.y + o.h);
        page.drawImage(im, { x: a[0], y: a[1], width: o.w, height: o.h, rotate: degrees(r) });
      } else if (o.type === 'table') {
        tbNorm(o);
        const { xs, ys } = tbGrid(o);
        for (let ri = 0; ri < o.cells.length; ri++) for (let ci = 0; ci < o.cells[ri].length; ci++) {
          if (tbCovered(o, ri, ci)) continue;
          const m = tbMergeAt(o, ri, ci), r2 = m ? ri + m.rs : ri + 1, c2 = m ? ci + m.cs : ci + 1;
          const x = xs[ci], y = ys[ri], w = xs[c2] - x, h = ys[r2] - y, cs = cellStyle(o, ri, ci);
          if (cs.bgHex) page.drawRectangle({ ...rect(x, y, w, h), color: pdfRgb(cs.bgHex), opacity: cs.bgA });
          page.drawRectangle({ ...rect(x, y, w, h), borderColor: pdfRgb(o.line), borderWidth: o.lw });
          const cell = o.cells[ri][ci]; if (!cell) continue;
          const lines = cell.split('\n'), f = await embedFont(cs.bold, cell);
          const lw = Math.max(...lines.map(l => f.widthOfTextAtSize(l, o.size)));
          const tx = cs.align === 'center' ? x + (w - Math.min(lw, w - 8)) / 2 : cs.align === 'right' ? x + w - 4 - Math.min(lw, w - 8) : x + 4;
          await text(cell, tx, y + Math.max(1, (h - lines.length * o.size * 1.25) / 2), o.size, cs.color, cs.bold, w - 8);
        }
      }
    }
  }
  return out.save();
}

async function save(mode) {
  if (!isOpen()) return;
  document.activeElement?.blur?.();
  host.toast('PDF 를 만드는 중입니다…');
  let bytes;
  try { bytes = await build(mode === 'extract'); }
  catch (e) { return host.toast('PDF 를 만들지 못했습니다: ' + (e?.message || e)); }
  const base = (P.meta.name || '문서.pdf').replace(/\.pdf$/i, '');
  const fileName = base + (mode === 'extract' ? '-고른쪽.pdf' : '-편집.pdf');
  if (mode === 'download' || host.isStatic || (!P.meta.path && mode !== 'extract')) {
    downloadBytes(bytes, mode === 'download' ? base + '-편집.pdf' : fileName);
    if (mode !== 'extract') { P.dirty = false; P.root.classList.remove('dirty'); host.onDirty?.(false); }
    return host.toast(fileName + ' 으로 내려받았습니다');
  }
  if (mode === 'replace' && !confirm(`원본 ${P.meta.name} 에 덮어쓸까요? 원본은 ${P.meta.name}.bak 으로 남겨 둡니다.`)) return;
  const body = { path: P.meta.path, name: P.meta.name, data: b64(bytes), replace: mode === 'replace' };
  if (mode === 'extract') body.out = (P.meta.dir || '') + '/' + fileName;
  if (mode === 'extract' && !P.meta.path) { downloadBytes(bytes, fileName); return host.toast(fileName + ' 으로 내려받았습니다'); }
  let j = await host.post('/api/save-pdf-edit', body);
  if (j.exists) {
    if (!confirm(`${j.path} 가 이미 있습니다. 덮어쓸까요?`)) return host.toast('저장하지 않았습니다');
    j = await host.post('/api/save-pdf-edit', { ...body, overwrite: true });
  }
  if (j.error) return host.toast(j.error);
  if (mode !== 'extract') { P.dirty = false; P.root.classList.remove('dirty'); host.onDirty?.(false); }
  host.toast(`저장했습니다: ${j.path}`);
  host.onSaved?.(j, mode);
}
function downloadBytes(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* 시험용: 지금 편집 상태로 만든 PDF 바이트 */
export const _test = { P, build, setTool, select, rotatePage, drawAll, viewport, textItems, fixText };
export function scrollToPage(n) { document.getElementById('pv-p' + n)?.scrollIntoView({ block: 'start' }); }
