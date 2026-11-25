/* 워드(.docx) 보기·간단 편집 (리프). 흐름과 설계 이유: docs/docx-flow.md
   보기는 docx-preview, 저장은 원본 zip 의 word/document.xml 에서 고친 문단의 글자 묶음(w:r)만 바꿔 끼운다(JSZip).
   화면 문단(<p>)과 XML 문단(w:p)은 글자를 맞춰 짝짓고, 짝이 맞고 글자만 있는 문단만 고칠 수 있게 연다. */

const BASE = new URL('.', import.meta.url).href;
const V = BASE + 'vendor/docx/';
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
let host = null;

const loadScript = src => new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => no(new Error(src + ' 로드 실패'));
  document.head.appendChild(s);
});
async function libs() {
  if (!window.JSZip) await loadScript(V + 'jszip.min.js');
  if (!window.docx?.renderAsync) await loadScript(V + 'docx-preview.min.js');
}

/* ---------- 상태 ---------- */
const D = {
  root: null, pages: null, meta: null, bytes: null, xml: '',
  initSig: new Map(),   // XML 문단 번호 → 처음 화면의 글자 조각(바뀌었는지 비교)
  runs: new Map(),      // ref "문단.글자묶음" → { b, i, u } (처음 화면에서 잰 굵게·기울임·밑줄)
  paras: [],            // 고칠 수 있는 XML 문단 번호 → { keep(지우지 않음) }
  ro: [],               // 고칠 수 없게 막은 화면 요소(지워지면 되돌린다)
  base: '', zoom: 1, lastHost: null, find: { hits: [], i: -1 },
};
const $ = (s, el = D.root) => el.querySelector(s);
const $$ = (s, el = D.root) => [...el.querySelectorAll(s)];
const norm = s => String(s || '').replace(/[\s ​﻿]+/g, '');
const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.namespaceURI === WNS && (!name || n.localName === name));

const ICON = {
  bold: 'M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z',
  italic: 'M10 4h8M6 20h8M14 4l-4 16',
  under: 'M7 4v7a5 5 0 0010 0V4M5 20h14',
  delp: 'M4 6h16M4 10h10M4 14h16M14 18l6-6M20 18l-6-6',
  find: 'M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20',
  undo: 'M9 14l-5-5 5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  zout: 'M5 12h14', zin: 'M12 5v14M5 12h14',
  zfit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  save: 'M5 3h11.5L20 6.5V21H5zM8.5 3v5h7V3M8.5 21v-6.5h8V21',
  replace: 'M5 12a7 7 0 0112.2-4.7L19.5 9.5M19.5 4.5v5h-5M19 12a7 7 0 01-12.2 4.7L4.5 14.5M4.5 19.5v-5h5',
  download: 'M12 4v11.5M7 10.5l5 5 5-5M5 20h14',
};
const ic = k => `<svg class="dv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
const ib = (act, title) => `<button class="dv-ib" data-act="${act}" title="${title}" aria-label="${title}">${ic(act)}</button>`;
const tb = (act, name, title) => `<button class="dv-tool" data-act="${act}" title="${title}">${ic(act)}<span>${name}</span></button>`;

const TOOLBAR = `<div class="dv-bar">
  <div class="dv-row">
    <div class="dv-grp">${tb('bold', '굵게', '굵게 (⌘B)')}${tb('italic', '기울임', '기울임 (⌘I)')}${tb('under', '밑줄', '밑줄 (⌘U)')}</div>
    <span class="dv-div"></span>
    <div class="dv-grp">${tb('delp', '문단 삭제', '글자 커서가 있는 문단을 지운다')}${tb('find', '찾아 바꾸기', '찾아 바꾸기 (⌘F)')}</div>
    <span class="dv-sp"></span>
    <div class="dv-grp">${ib('undo', '되돌리기 (⌘Z)')}${ib('redo', '다시 (⌘⇧Z)')}</div>
    <div class="dv-grp">${ib('zout', '작게')}<span class="dv-zoom">100%</span>${ib('zin', '크게')}${ib('zfit', '폭 맞춤')}</div>
    <div class="dv-grp dv-savebox">
      <button class="dv-save" data-act="save" title="원본 옆에 '이름-편집.docx' 로 저장 (⌘S)">${ic('save')}<span>저장</span></button>
      ${ib('replace', '원본 파일에 덮어쓰기 (원본은 .bak 으로 남김)')}${ib('download', '내려받기')}
    </div>
  </div>
  <div class="dv-findbar" hidden>
    <input type="text" class="dv-q" placeholder="찾을 말" spellcheck="false">
    <input type="text" class="dv-r" placeholder="바꿀 말" spellcheck="false">
    <span class="dv-cnt"></span>
    <button data-f="prev" title="이전 (⇧Enter)">이전</button><button data-f="next" title="다음 (Enter)">다음</button>
    <button data-f="one">바꾸기</button><button data-f="all">모두 바꾸기</button>
    <span class="dv-sp"></span><button data-f="close" title="닫기 (Esc)">닫기</button>
  </div>
  <div class="dv-hint"></div>
</div>
<div class="dv-style"></div>
<div class="dv-pages"></div>`;

const STYLE = `
#docxView { --dv-line: var(--line, #ccc); padding-bottom: 80px; }
#docxView .dv-bar { position: sticky; top: var(--pv-top, 0px); z-index: 30; margin: 0 0 16px; padding: 6px 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  background: color-mix(in srgb, var(--bg, #fff) 94%, transparent); backdrop-filter: blur(10px);
  border: 1px solid var(--dv-line); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.07); }
#docxView .dv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
#docxView .dv-grp { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: var(--bg-sub, #f4f4f5); }
#docxView .dv-div { width: 1px; height: 30px; background: var(--dv-line); margin: 0 2px; }
#docxView .dv-sp { flex: 1; }
#docxView .dv-ic { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
#docxView .dv-bar button { font: inherit; cursor: pointer; color: var(--fg, #222); background: transparent; border: 0; border-radius: 7px; transition: background .12s, color .12s; }
#docxView .dv-bar button:hover { background: color-mix(in srgb, var(--fg, #222) 8%, transparent); }
#docxView .dv-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; padding: 5px 5px 4px; font-size: 10.5px; color: var(--fg-mid, #555) !important; }
#docxView .dv-tool span { white-space: nowrap; letter-spacing: -.02em; }
#docxView .dv-tool.on { background: var(--bg, #fff) !important; color: var(--accent, #c55) !important; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
#docxView .dv-ib { width: 32px; height: 32px; display: grid; place-items: center; color: var(--fg-mid, #555) !important; }
#docxView .dv-zoom { min-width: 46px; text-align: center; font-size: 12px; font-weight: 600; color: var(--fg-mid, #555); font-variant-numeric: tabular-nums; }
#docxView .dv-savebox { background: transparent; gap: 4px; }
#docxView .dv-savebox .dv-ib { background: var(--bg-sub, #f4f4f5); }
#docxView .dv-save { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px 0 11px; font-size: 13px; font-weight: 600;
  background: var(--accent, #c55) !important; color: #fff !important; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
#docxView .dv-save:hover { filter: brightness(1.07); }
#docxView.dirty .dv-save span::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: #fff; vertical-align: 2px; }
#docxView .dv-findbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px -8px -6px; padding: 7px 12px; border-top: 1px solid var(--dv-line);
  border-radius: 0 0 12px 12px; background: var(--bg-sub, #f6f6f7); font-size: 12px; color: var(--fg-mid, #555); }
#docxView .dv-findbar[hidden] { display: none; }
#docxView .dv-findbar input { width: 160px; height: 28px; padding: 0 8px; border: 1px solid var(--dv-line); border-radius: 6px; background: var(--bg, #fff); color: var(--fg, #222); font: inherit; font-size: 13px; }
#docxView .dv-findbar button { padding: 4px 10px; font-size: 12px; background: var(--bg, #fff) !important; border: 1px solid var(--dv-line) !important; }
#docxView .dv-cnt { min-width: 52px; font-variant-numeric: tabular-nums; }
#docxView .dv-hint { margin: 6px 2px -2px; font-size: 11.5px; color: var(--fg-dim, #888); }
#docxView .dv-pages { overflow-x: auto; }
#docxView .docx-wrapper { background: transparent !important; padding: 4px 0 30px !important; align-items: center; transform-origin: top center; }
#docxView .docx-wrapper > section.docx { background: #fff; color: #000; box-shadow: 0 2px 10px rgba(0,0,0,.18) !important; margin-bottom: 22px !important; }
#docxView section.docx article { outline: none; }
#docxView section.docx td[contenteditable=true] { outline: none; cursor: text; }
#docxView section.docx td[contenteditable=true]:focus-within { box-shadow: inset 0 0 0 2px rgba(37, 99, 235, .45); }
#docxView section.docx [data-src] { cursor: text; }
#docxView section.docx [data-src]:hover { background: rgba(255, 196, 0, .08); }
#docxView section.docx .dv-ro { cursor: default; }
#docxView section.docx p.dv-ro:hover { box-shadow: -6px 0 0 -3px rgba(150,150,150,.5); }
#docxView section.docx [data-tab] { user-select: none; }
#docxView ::highlight(dv-find) { background: #ffe066; color: #000; }
#docxView section.docx p, #docxView section.docx td { scroll-margin-top: 150px; }
@media print { #docxView .dv-bar { display: none; } #docxView .docx-wrapper { zoom: 1 !important; } }
`;
function injectCss() {
  if (document.getElementById('dv-css')) return;
  const st = document.createElement('style'); st.id = 'dv-css'; st.textContent = STYLE; document.head.appendChild(st);
}

/* ---------- 열기·닫기 ---------- */
export function init(h) { host = h; }
export function isOpen() { return !!D.root && D.root.isConnected; }
export function isDirty() { return isOpen() && sigAll() !== D.base; }
export function confirmLeave() {
  return !isDirty() || confirm('워드 문서에 저장하지 않은 편집이 있습니다. 버리고 나갈까요?');
}
export function close() {
  if (!D.root) return;
  D.root.remove(); D.root = null;
  Object.assign(D, { initSig: new Map(), runs: new Map(), paras: [], ro: [], base: '', lastHost: null, find: { hits: [], i: -1 } });
  CSS.highlights?.delete?.('dv-find');
  document.body.classList.remove('pdf-mode', 'docx-mode');
  removeEventListener('keydown', onKey, true);
}

export async function open(meta, bytes, mountIn) {
  await libs();
  injectCss();
  close();
  D.meta = meta;
  D.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const zip = await JSZip.loadAsync(D.bytes);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('워드(.docx) 문서가 아닙니다');
  D.xml = await f.async('string');
  D.styles = await readStyles(zip);
  D.root = document.createElement('div');
  D.root.id = 'docxView';
  D.root.innerHTML = TOOLBAR;
  mountIn.appendChild(D.root);
  document.body.classList.add('pdf-mode', 'docx-mode');
  bindToolbar();
  addEventListener('keydown', onKey, true);
  await window.docx.renderAsync(D.bytes, $('.dv-pages'), $('.dv-style'), {
    className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
    renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true,
  });
  const n = prepare();
  fitZoom(true);
  D.base = sigAll();
  sendToc();
  $('.dv-hint').textContent = n.edit
    ? `본문을 눌러 바로 고칩니다 · 고칠 수 있는 문단 ${n.edit}개` + (n.ro ? ` · 그림·링크·필드가 든 문단 ${n.ro}개와 머리글·바닥글은 보기만 됩니다` : '')
    : '이 문서에는 바로 고칠 수 있는 문단이 없습니다(보기만 됩니다)';
  return $$('.docx-wrapper > section.docx').length;
}

/* ---------- 제목 단계(목차용): 문단 개요 수준 → 스타일 이름 heading N·Title → 스타일 개요 수준 ---------- */
async function readStyles(zip) {
  const m = new Map();
  const f = zip.file('word/styles.xml');
  if (!f) return m;
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  for (const st of doc.getElementsByTagNameNS(WNS, 'style')) {
    const id = st.getAttributeNS(WNS, 'styleId');
    const name = (kids(st, 'name')[0]?.getAttributeNS(WNS, 'val') || '').toLowerCase();
    const lvl = kids(st, 'pPr')[0] && kids(kids(st, 'pPr')[0], 'outlineLvl')[0]?.getAttributeNS(WNS, 'val');
    const h = /^heading\s*(\d)$/.exec(name);
    m.set(id, { level: h ? +h[1] : name === 'title' ? 1 : lvl != null && +lvl < 9 ? +lvl + 1 : 0, based: kids(st, 'basedOn')[0]?.getAttributeNS(WNS, 'val') });
  }
  return m;
}
function headLevel(xp) {
  const pPr = kids(xp, 'pPr')[0];
  const own = pPr && kids(pPr, 'outlineLvl')[0]?.getAttributeNS(WNS, 'val');
  if (own != null) return +own < 9 ? +own + 1 : 0;
  let id = pPr && kids(pPr, 'pStyle')[0]?.getAttributeNS(WNS, 'val');
  for (let k = 0; id && k < 10; k++) {
    const st = D.styles?.get(id);
    if (!st) return 0;
    if (st.level) return st.level;
    id = st.based;
  }
  return 0;
}

/* ---------- 화면 문단 ↔ XML 문단 짝짓기 ---------- */
function xmlParas(doc) {
  const body = doc.getElementsByTagNameNS(WNS, 'body')[0];
  if (!body) return [];
  return [...body.getElementsByTagNameNS(WNS, 'p')].filter(p => {
    for (let a = p.parentNode; a && a !== body; a = a.parentNode)
      if (a.localName === 'txbxContent' || a.localName === 'AlternateContent' || a.localName === 'drawing' || a.localName === 'pict') return false;
    return true;
  });
}
const xmlText = p => {
  let s = '';
  for (const t of p.getElementsByTagNameNS(WNS, 't')) s += t.textContent;
  return s;
};
const RUN_OK = new Set(['rPr', 't', 'tab', 'br', 'lastRenderedPageBreak']);
const PARA_OK = new Set(['pPr', 'r', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd']);
function simplePara(xp) {
  for (const k of kids(xp)) {
    if (!PARA_OK.has(k.localName)) return false;
    if (k.localName !== 'r') continue;
    for (const c of kids(k)) {
      if (!RUN_OK.has(c.localName)) return false;
      if (c.localName === 'br' && c.getAttributeNS(WNS, 'type') && c.getAttributeNS(WNS, 'type') !== 'textWrapping') return false;
    }
  }
  return [...xp.childNodes].every(n => n.nodeType !== 1 || n.namespaceURI === WNS);
}
/* 화면의 글자 묶음(span) 하나가 XML 의 w:r 하나와 같은지: 글자·탭·줄바꿈 수가 같아야 한다 */
function runMatches(xr, span) {
  if (span.tagName !== 'SPAN') return false;
  let txt = '', tabs = 0, brs = 0;
  for (const c of kids(xr)) {
    if (c.localName === 't') txt += c.textContent;
    else if (c.localName === 'tab') tabs++;
    else if (c.localName === 'br') brs++;
  }
  const spanTabs = [...span.children].filter(e => e.tagName === 'SPAN');
  const spanBrs = [...span.children].filter(e => e.tagName === 'BR');
  if (spanTabs.length !== tabs || spanBrs.length !== brs) return false;
  let st = '';
  for (const n of span.childNodes) if (n.nodeType === 3) st += n.nodeValue;
  return st === txt;
}
function domParas() {
  return $$('.docx-wrapper > section.docx > article p').filter(p => !p.closest('ol.docx-footnotes, .docx-footnotes, .docx-endnotes'));
}
function align(xs, ds) {
  const xt = xs.map(p => norm(xmlText(p))), dt = ds.map(p => norm(p.textContent));
  const pairs = [];
  let i = 0, j = 0;
  while (i < xs.length && j < ds.length) {
    if (xt[i] === dt[j]) { pairs.push([i, j]); i++; j++; continue; }
    let skip = null;
    for (let k = 1; k <= 8 && !skip; k++) {
      if (j + k < ds.length && dt[j + k] === xt[i]) skip = ['d', k];
      else if (i + k < xs.length && xt[i + k] === dt[j]) skip = ['x', k];
    }
    if (!skip) { i++; j++; continue; }
    if (skip[0] === 'd') j += skip[1]; else i += skip[1];
  }
  return pairs;
}
const styleOf = el => {
  const cs = getComputedStyle(el);
  return { b: +cs.fontWeight >= 600, i: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique') };
};
function underOf(node, p) {
  for (let e = node.nodeType === 1 ? node : node.parentElement; e && e !== p.parentElement; e = e.parentElement) {
    if (e.tagName === 'U') return true;
    if (getComputedStyle(e).textDecorationLine.includes('underline')) return true;
  }
  return false;
}
function prepare() {
  const doc = new DOMParser().parseFromString(D.xml, 'application/xml');
  const xs = xmlParas(doc), ds = domParas();
  const pairs = align(xs, ds);
  let edit = 0;
  D.heads = [];
  for (const [xi, di] of pairs) {
    const xp = xs[xi], dp = ds[di];
    const lv = headLevel(xp);
    if (lv && lv <= 3 && dp.textContent.trim()) D.heads.push({ el: dp, level: lv, text: dp.textContent.replace(/\s+/g, ' ').trim() });
    if (!simplePara(xp)) continue;
    const xr = kids(xp, 'r');
    const spans = [...dp.children].filter(e => !(e.tagName === 'SPAN' && !e.childNodes.length && e.id));   // 책갈피 표시(빈 span#id)는 뺀다
    if (spans.length !== xr.length || !xr.every((r, k) => runMatches(r, spans[k]))) continue;
    dp.dataset.src = xi;
    D.paras[xi] = { keep: !!kids(xp, 'pPr')[0]?.getElementsByTagNameNS(WNS, 'sectPr').length };
    spans.forEach((s, k) => {
      const ref = xi + '.' + k;
      s.dataset.r = ref;
      [...s.children].forEach(c => { if (c.tagName === 'SPAN') { c.dataset.tab = '1'; c.contentEditable = 'false'; } });
      D.runs.set(ref, { ...styleOf(s), u: underOf(s, dp) });
    });
    D.initSig.set(xi, sigP(dp));
    edit++;
  }
  /* 고칠 수 있는 곳(본문 article·표 칸)만 편집 상태로 열고, 나머지는 막는다 */
  const lock = el => { el.contentEditable = 'false'; el.classList.add('dv-ro'); D.ro.push(el); };
  let ro = 0;
  for (const art of $$('.docx-wrapper > section.docx > article')) {
    art.contentEditable = 'true'; art.spellcheck = false;
    for (const el of [...art.children]) {
      if (el.tagName === 'P' && el.dataset.src != null) continue;
      if (el.tagName === 'P') ro++;
      lock(el);
    }
  }
  for (const td of $$('.docx-wrapper > section.docx > article td')) {
    const own = [...td.children];
    const ok = own.length && own.every(e => e.tagName === 'P' && e.dataset.src != null);
    if (ok) { td.contentEditable = 'true'; td.spellcheck = false; }
    else ro += own.filter(e => e.tagName === 'P').length;
  }
  for (const p of $$('.docx-wrapper > section.docx > article p:not([data-src])')) p.title = '그림·링크·필드가 든 문단은 고칠 수 없습니다';
  return { edit, ro };
}

/* ---------- 화면 → 글자 조각 ---------- */
function hostOf(n) { const e = n?.nodeType === 1 ? n : n?.parentElement; return e?.closest?.('#docxView [contenteditable=true]') || null; }
function segs(p) {
  const out = [];
  const src = p.dataset.src;
  let last = null;
  const firstRef = src + '.0';
  const refFor = el => el?.closest('[data-r]')?.dataset.r || last || (D.runs.has(firstRef) ? firstRef : null);
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        if (!c.nodeValue) continue;
        const el = c.parentElement, ref = refFor(el), st = styleOf(el);
        last = ref;
        out.push({ k: 't', v: c.nodeValue.replace(/ /g, ' '), ref, b: st.b, i: st.i, u: underOf(c, p) });
      } else if (c.nodeType === 1) {
        if (c.dataset.tab) { const ref = refFor(c); last = ref; out.push({ k: 'tab', ref }); }
        else if (c.tagName === 'BR') out.push({ k: 'br', ref: refFor(c) });
        else walk(c);
      }
    }
  };
  walk(p);
  if (out.length && out[out.length - 1].k === 'br') out.pop();   // 빈 문단에 브라우저가 넣는 자리 표시 줄바꿈
  return out;
}
const sigP = p => JSON.stringify(segs(p).map(s => [s.k, s.v || '', s.ref, s.b, s.i, s.u]));
function sigAll() {
  if (!D.root) return '';
  return $$('[data-src]', $('.dv-pages')).map(p => p.dataset.src + ':' + sigP(p)).join('\n');
}

/* ---------- 저장: 원본 document.xml 에서 바뀐 문단만 바꿔 끼운다 ---------- */
function onOff(rPr, doc, name, want, base) {
  if (want === base) return;
  [...rPr.getElementsByTagNameNS(WNS, name)].forEach(e => e.remove());
  const e = doc.createElementNS(WNS, 'w:' + name);
  if (name === 'u') e.setAttributeNS(WNS, 'w:val', want ? 'single' : 'none');
  else if (!want) e.setAttributeNS(WNS, 'w:val', '0');
  rPr.appendChild(e);
}
function runsFor(doc, xs, list) {
  const out = [];
  let cur = null;
  const key = s => [s.ref, s.b, s.i, s.u].join('|');
  for (const s of list) {
    if (!cur || cur.key !== key(s)) {
      const src = s.ref ? xs[+s.ref.split('.')[0]] && kids(xs[+s.ref.split('.')[0]], 'r')[+s.ref.split('.')[1]] : null;
      const base = (s.ref && D.runs.get(s.ref)) || { b: false, i: false, u: false };
      const r = doc.createElementNS(WNS, 'w:r');
      const srcPr = src && kids(src, 'rPr')[0];
      const rPr = srcPr ? srcPr.cloneNode(true) : doc.createElementNS(WNS, 'w:rPr');
      if (s.k === 't') {
        onOff(rPr, doc, 'b', s.b, base.b);
        if (s.b !== base.b) onOff(rPr, doc, 'bCs', s.b, base.b);
        onOff(rPr, doc, 'i', s.i, base.i);
        if (s.i !== base.i) onOff(rPr, doc, 'iCs', s.i, base.i);
        onOff(rPr, doc, 'u', s.u, base.u);
      }
      if (rPr.childNodes.length) r.appendChild(rPr);
      cur = { key: key(s), r };
      out.push(r);
    }
    if (s.k === 't') {
      const t = doc.createElementNS(WNS, 'w:t');
      t.setAttributeNS(XMLNS, 'xml:space', 'preserve');
      t.textContent = s.v;
      cur.r.appendChild(t);
    } else cur.r.appendChild(doc.createElementNS(WNS, 'w:' + s.k));
  }
  return out;
}
function rewrite(doc, xs, xp, list) {
  const marks = kids(xp).filter(k => k.localName === 'bookmarkStart' || k.localName === 'bookmarkEnd');
  kids(xp).filter(k => k.localName !== 'pPr').forEach(k => k.remove());
  marks.filter(m => m.localName === 'bookmarkStart').forEach(m => xp.appendChild(m));
  runsFor(doc, xs, list).forEach(r => xp.appendChild(r));
  marks.filter(m => m.localName === 'bookmarkEnd').forEach(m => xp.appendChild(m));
}
export async function build() {
  const doc = new DOMParser().parseFromString(D.xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('document.xml 을 읽지 못했습니다');
  const xs = xmlParas(doc);
  const srcRuns = xs.map(p => kids(p, 'r').map(r => r.cloneNode(true)));   // 앞 문단을 고친 뒤에도 원래 글자 묶음(rPr)을 찾을 수 있게 사본을 둔다
  const lookup = xs.map((p, i) => { const fake = doc.createElementNS(WNS, 'w:p'); srcRuns[i].forEach(r => fake.appendChild(r)); return fake; });
  const groups = new Map();
  for (const p of $$('[data-src]', $('.dv-pages'))) {
    const s = +p.dataset.src;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(p);
  }
  let changed = 0;
  D.paras.forEach((info, s) => {
    if (!info) return;
    const xp = xs[s], g = groups.get(s) || [];
    if (!g.length) {
      const cell = xp.parentNode?.localName === 'tc' && kids(xp.parentNode, 'p').length === 1;
      if (info.keep || cell) rewrite(doc, lookup, xp, []); else xp.remove();
      changed++;
      return;
    }
    if (g.length > 1 || sigP(g[0]) !== D.initSig.get(s)) { rewrite(doc, lookup, xp, segs(g[0])); changed++; }
    let after = xp;
    for (const extra of g.slice(1)) {
      const np = xp.cloneNode(true);
      [...np.getElementsByTagNameNS(WNS, 'sectPr')].forEach(e => e.remove());
      rewrite(doc, lookup, np, segs(extra));
      after.parentNode.insertBefore(np, after.nextSibling);
      after = np;
    }
  });
  const zip = await JSZip.loadAsync(D.bytes);
  if (changed) {
    let out = new XMLSerializer().serializeToString(doc);
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
    zip.file('word/document.xml', out, { createFolders: false });   // 폴더 항목(word/)을 새로 만들지 않게
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function save(mode) {
  if (!isOpen()) return;
  document.activeElement?.blur?.();
  host.toast('워드 문서를 만드는 중입니다…');
  let bytes;
  try { bytes = await build(); }
  catch (e) { return host.toast('워드 문서를 만들지 못했습니다: ' + (e?.message || e)); }
  const base = (D.meta.name || '문서.docx').replace(/\.docx$/i, '');
  const fileName = base + '-편집.docx';
  const done = async () => { await reloadFrom(bytes); };
  if (mode === 'download' || host.isStatic || !D.meta.path) {
    downloadBytes(bytes, fileName);
    await done();
    return host.toast(fileName + ' 으로 내려받았습니다');
  }
  if (mode === 'replace' && !confirm(`원본 ${D.meta.name} 에 덮어쓸까요? 원본은 ${D.meta.name}.bak 으로 남겨 둡니다.`)) return;
  const body = { path: D.meta.path, name: D.meta.name, data: b64(bytes), replace: mode === 'replace' };
  let j = await host.post('/api/save-docx-edit', body);
  if (j.exists) {
    if (!confirm(`${j.path} 가 이미 있습니다. 덮어쓸까요?`)) return host.toast('저장하지 않았습니다');
    j = await host.post('/api/save-docx-edit', { ...body, overwrite: true });
  }
  if (j.error) return host.toast(j.error);
  await done();
  host.toast(`저장했습니다: ${j.path}`);
  host.onSaved?.(j, mode);
}
/* 저장한 내용으로 다시 그린다: 다음 저장이 같은 편집을 두 번 넣지 않게 기준을 새 파일로 바꾼다 */
async function reloadFrom(bytes) {
  const y = scrollY, z = D.zoom, mount = D.root.parentNode, meta = D.meta;
  await open(meta, bytes, mount);
  setZoom(z);
  scrollTo({ top: y });
  host.onDirty?.(false);
}
function downloadBytes(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------- 편집 보호·표시 ---------- */
function markDirty() {
  const d = isDirty();
  D.root.classList.toggle('dirty', d);
  host.onDirty?.(d);
}
let dirtyT = 0;
function onInput(e) {
  if (!hostOf(e.target)) return;
  if (D.ro.some(el => !el.isConnected)) {          // 표·그림 같은 막은 요소가 지워졌으면 바로 되돌린다
    document.execCommand('undo');
    host.toast('표·그림·링크가 든 부분은 지울 수 없습니다');
  }
  for (const h of $$('[contenteditable=true]', $('.dv-pages'))) {   // 붙여넣기 등으로 생긴 새 문단에 짝 번호를 이어 준다
    let prev = null;
    for (const el of [...h.children]) {
      if (el.dataset.src != null) { prev = el.dataset.src; continue; }
      if (el.classList.contains('dv-ro')) continue;
      if (/^(P|DIV)$/.test(el.tagName)) { const nx = [...h.children].find(x => x.dataset.src != null); const s = prev ?? nx?.dataset.src; if (s != null) el.dataset.src = s; }
    }
  }
  clearTimeout(dirtyT); dirtyT = setTimeout(markDirty, 250);
  if (!$('.dv-findbar').hidden) refreshFind(false);
}
function onBeforeInput(e) {
  const h = hostOf(e.target);
  if (!h) return;
  if (/^(insertFromDrop|formatFontColor|formatBackColor|formatSetBlockTextDirection|insertOrderedList|insertUnorderedList|insertHorizontalRule|insertLink)$/.test(e.inputType)) { e.preventDefault(); return; }
  const r = e.getTargetRanges?.()[0];
  if (r && D.ro.some(el => h.contains(el) && rangeHits(r, el))) { e.preventDefault(); host.toast('표·그림·링크가 든 부분은 지울 수 없습니다'); return; }
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const p = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('[data-src]');
  if (!p) return;
  if (e.inputType === 'deleteContentBackward' && atEdge(p, sel, true) && !(p.previousElementSibling?.dataset.src != null)) e.preventDefault();
  if (e.inputType === 'deleteContentForward' && atEdge(p, sel, false) && !(p.nextElementSibling?.dataset.src != null)) e.preventDefault();
}
function rangeHits(r, el) {
  const rr = document.createRange();
  try { rr.setStart(r.startContainer, r.startOffset); rr.setEnd(r.endContainer, r.endOffset); } catch { return false; }
  return !rr.collapsed && rr.intersectsNode(el);
}
function atEdge(p, sel, start) {
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = sel.getRangeAt(0);
  if (start) r.setEnd(s.startContainer, s.startOffset); else r.setStart(s.endContainer, s.endOffset);
  return !r.toString().length;
}
function onPaste(e) {
  if (!hostOf(e.target)) return;
  e.preventDefault(); e.stopPropagation();       // 뷰어의 '붙여넣은 글을 새 문서로 열기'가 끼어들지 않게
  const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  lines.forEach((l, k) => { if (k) document.execCommand('insertParagraph'); if (l) document.execCommand('insertText', false, l.replace(/\t/g, ' ')); });
}

/* ---------- 도구 막대 ---------- */
function bindToolbar() {
  const bar = $('.dv-bar');
  bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // 단추를 눌러도 글자 커서·선택이 남게
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) return act(b.dataset.act);
    const f = e.target.closest('[data-f]');
    if (f) return findAct(f.dataset.f);
  });
  const pages = $('.dv-pages');
  pages.addEventListener('input', onInput);
  pages.addEventListener('beforeinput', onBeforeInput);
  pages.addEventListener('paste', onPaste);
  pages.addEventListener('drop', e => { if (hostOf(e.target)) e.preventDefault(); });
  pages.addEventListener('focusin', e => { const h = hostOf(e.target); if (h) D.lastHost = h; });
  pages.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); host.toast('링크는 ⌘(Ctrl)를 누른 채 누르면 열립니다'); }
    else if (a) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });
  document.addEventListener('selectionchange', syncFmt);
  const q = $('.dv-q'), rep = $('.dv-r');
  q.addEventListener('input', () => refreshFind(true));
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); findAct(e.shiftKey ? 'prev' : 'next'); } });
  rep.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); findAct('one'); } });
}
function syncFmt() {
  if (!isOpen()) return;
  const sel = getSelection();
  const inDoc = sel.anchorNode && hostOf(sel.anchorNode);
  for (const [a, c] of [['bold', 'bold'], ['italic', 'italic'], ['under', 'underline']]) {
    let on = false;
    try { on = !!inDoc && document.queryCommandState(c); } catch {}
    $(`[data-act=${a}]`).classList.toggle('on', on);
  }
}
function focusDoc() {
  const sel = getSelection();
  if (sel.anchorNode && hostOf(sel.anchorNode)) return true;
  if (D.lastHost?.isConnected) { D.lastHost.focus(); return true; }
  return false;
}
function act(a) {
  if (a === 'bold' || a === 'italic' || a === 'under') {
    if (!focusDoc()) return host.toast('먼저 고칠 글자를 고르세요');
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(a === 'under' ? 'underline' : a);
    return syncFmt();
  }
  if (a === 'undo' || a === 'redo') { if (focusDoc()) document.execCommand(a); return; }
  if (a === 'delp') return delPara();
  if (a === 'find') return openFind();
  if (a === 'zin') return setZoom(D.zoom + 0.1);
  if (a === 'zout') return setZoom(D.zoom - 0.1);
  if (a === 'zfit') return fitZoom(false);
  if (a === 'save') return save('copy');
  if (a === 'replace') return save('replace');
  if (a === 'download') return save('download');
}
function delPara() {
  const sel = getSelection();
  const p = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('#docxView [data-src]');
  if (!p) return host.toast('지울 문단 안을 먼저 누르세요');
  const next = p.nextElementSibling?.dataset.src != null ? p.nextElementSibling : null;
  const prev = p.previousElementSibling?.dataset.src != null ? p.previousElementSibling : null;
  const r = document.createRange();
  if (next) { r.setStart(p, 0); r.setEnd(next, 0); }
  else if (prev) { r.selectNodeContents(prev); r.collapse(false); r.setEnd(p, p.childNodes.length); }
  else r.selectNodeContents(p);
  sel.removeAllRanges(); sel.addRange(r);
  document.execCommand('delete');
}

/* ---------- 찾아 바꾸기 ---------- */
function openFind() {
  const bar = $('.dv-findbar');
  bar.hidden = false;
  const s = String(getSelection() || '').trim();
  const q = $('.dv-q');
  if (s && !s.includes('\n') && s.length <= 80) q.value = s;
  q.focus(); q.select();
  refreshFind(true);
}
function closeFind() {
  $('.dv-findbar').hidden = true;
  CSS.highlights?.delete?.('dv-find');
  D.find = { hits: [], i: -1 };
}
function textNodes(p) {
  const out = [];
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[data-tab]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
}
function refreshFind(jump) {
  const q = $('.dv-q').value;
  const hits = [];
  if (q) {
    const lq = q.toLowerCase();
    for (const p of $$('[data-src]', $('.dv-pages'))) {
      const nodes = textNodes(p);
      let all = '', map = [];
      for (const n of nodes) { map.push([n, all.length]); all += n.nodeValue; }
      const la = all.toLowerCase();
      for (let at = la.indexOf(lq); at >= 0; at = la.indexOf(lq, at + lq.length)) {
        const pos = off => { let k = map.length - 1; while (k > 0 && map[k][1] > off) k--; return [map[k][0], off - map[k][1]]; };
        const [sn, so] = pos(at), [en, eo] = pos(at + lq.length);
        const r = document.createRange();
        r.setStart(sn, so);
        if (eo === 0 && en !== sn) { const pr = map[map.findIndex(m => m[0] === en) - 1][0]; r.setEnd(pr, pr.nodeValue.length); } else r.setEnd(en, eo);
        hits.push(r);
      }
    }
  }
  D.find.hits = hits;
  if (jump || D.find.i >= hits.length) D.find.i = hits.length ? 0 : -1;
  if (window.Highlight && CSS.highlights) CSS.highlights.set('dv-find', new Highlight(...hits));
  $('.dv-cnt').textContent = q ? (hits.length ? `${D.find.i + 1}/${hits.length}` : '없음') : '';
  if (jump && hits.length) showHit();
}
function showHit() {
  const r = D.find.hits[D.find.i];
  if (!r) return;
  (r.startContainer.parentElement || r.startContainer).scrollIntoView({ block: 'center' });
  $('.dv-cnt').textContent = `${D.find.i + 1}/${D.find.hits.length}`;
}
function findAct(f) {
  if (f === 'close') return closeFind();
  refreshFind(false);
  const n = D.find.hits.length;
  if (!n) return host.toast('찾는 말이 없습니다');
  if (f === 'next' || f === 'prev') { D.find.i = (D.find.i + (f === 'next' ? 1 : -1) + n) % n; return showHit(); }
  const rep = $('.dv-r').value;
  const one = r => {
    const h = hostOf(r.startContainer);
    if (!h) return;
    h.focus();
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    if (rep) document.execCommand('insertText', false, rep); else document.execCommand('delete');
  };
  if (f === 'one') {
    one(D.find.hits[Math.max(0, D.find.i)]);
    refreshFind(false);
    if (D.find.hits.length) { D.find.i = Math.min(D.find.i, D.find.hits.length - 1); showHit(); }
    return;
  }
  if (f === 'all') {
    const list = [...D.find.hits].reverse();     // 뒤에서부터 바꿔야 앞 범위가 흔들리지 않는다
    list.forEach(one);
    refreshFind(false);
    host.toast(`${list.length}곳을 바꿨습니다`);
  }
}

/* ---------- 배율·목차·단축키 ---------- */
function setZoom(z) {
  D.zoom = Math.min(2.5, Math.max(0.4, Math.round(z * 100) / 100));
  const w = $('.docx-wrapper');
  if (w) w.style.zoom = D.zoom;
  $('.dv-zoom').textContent = Math.round(D.zoom * 100) + '%';
}
function fitZoom(onlyShrink) {
  const sec = $('.docx-wrapper > section.docx');
  if (!sec) return setZoom(1);
  const w = $('.docx-wrapper'); w.style.zoom = 1;
  const avail = $('.dv-pages').clientWidth - 8, need = sec.offsetWidth;
  const z = need > 0 ? avail / need : 1;
  setZoom(onlyShrink ? Math.min(1, z) : z);
}
function sendToc() {
  const hs = D.heads || [];
  const secs = $$('.docx-wrapper > section.docx');
  host.onToc?.(hs.length ? hs : secs.map((s, i) => ({ el: s, level: 1, text: `${i + 1}쪽` })));
}
export function scrollToEl(el) { el?.scrollIntoView({ block: 'start' }); }
function onKey(e) {
  if (!isOpen()) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  const inDoc = !!hostOf(e.target), inBar = !!e.target.closest?.('#docxView .dv-bar');
  if (mod && k === 's') { e.preventDefault(); e.stopPropagation(); return save(e.shiftKey ? 'replace' : 'copy'); }
  if (mod && k === 'f' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); return openFind(); }
  if (e.key === 'Escape' && !$('.dv-findbar').hidden && (inBar || !inDoc)) { e.preventDefault(); e.stopPropagation(); return closeFind(); }
  if (!inDoc) return;
  if (mod && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); e.stopPropagation(); return act(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'under'); }
  if (mod && (k === 'z' || k === 'y')) { e.stopPropagation(); return; }   // 브라우저 기본 되돌리기
  if (e.key === 'Escape') { e.target.blur?.(); getSelection().removeAllRanges(); return; }
  if (!mod) e.stopPropagation();                  // 글을 쓰는 중에는 뷰어 단축키(Home·End·? 등)가 끼어들지 않게
}

export const _test = { D, build, segs, sigAll, prepare, align, act, findAct, refreshFind };
