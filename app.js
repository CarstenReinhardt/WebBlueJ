/* Java-Werkbank – Oberfläche */
(function () {
'use strict';
const { Runtime, Env, JObject, JArray, typeStr, quickInfo, T } = window.JavaRT;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STORE = 'javawerkbank.project.v1';
const BOX_W = 156, BOX_H = 70;

// ------------------------------------------------------------ Zustand
const outBuf = [];
const gfx = window.WBGfx.create({
  echo: (s) => outBuf.push({ s, err: false }),
  note: (s) => outBuf.push({ s, err: false }),
  lastLine: () => { const t = outBuf.filter(o => !o.err).map(o => o.s).join(''); return t.slice(t.lastIndexOf('\n') + 1).trim(); },
});
// Während ein Programm läuft, wird die Ausgabe zwischen den Zeitscheiben angezeigt
let liveOut = null;
const rt = new Runtime({ out: (s, err) => outBuf.push({ s, err }), gfx, onSlice: () => { if (liveOut) liveOut(); else flushOutput(); },
  assets: (name) => findAsset(name),
  // Maus-/Tastaturereignis, während kein Programm läuft: als eigener Lauf
  runEvent: (makeGen, label) => {
    setRunning(true);
    rt.runAsync(makeGen).then((r) => { setRunning(false); flushOutput(); eventResult(r, label); });
  },
  // Ereignis, das zwischen zwei Zeitscheiben eines laufenden Programms ausgeführt wurde
  onEvent: (r, label) => { flushOutput(); eventResult(r, label); },
});
const S = {
  project: null,        // { name, classes: [{ id, name, code, x, y }] }
  status: {},           // id -> { dirty, error: {line, message} }
  info: {},             // id -> quickInfo
  compiledOnce: false,
  bench: [],            // { name, value }
  benchEnv: new Env(null),
  padEnv: null,
  editing: null,
  selected: null,
};
S.padEnv = new Env(S.benchEnv);
let uid = 1; const newId = () => 'c' + Date.now().toString(36) + (uid++);

const LIB = 'javawerkbank.library.v1';
function projectData() { return { id: S.project.id, name: S.project.name, savedAt: Date.now(), classes: S.project.classes.map(c => ({ id: c.id, name: c.name, code: c.code, x: c.x, y: c.y })), files: (S.project.files || []).map(f => ({ ...f })) }; }
function readLib() { try { const l = JSON.parse(localStorage.getItem(LIB) || 'null'); if (l && l.projects) return l; } catch (e) { } return { projects: {} }; }
function writeLib(l) { try { localStorage.setItem(LIB, JSON.stringify(l)); return true; } catch (e) { return false; } }
let quotaWarned = false;
function save() {
  const d = projectData();
  try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) { }
  const l = readLib(); l.projects[d.id] = d; l.current = d.id;
  const ok = writeLib(l);
  if (!ok && !quotaWarned) { quotaWarned = true; toast('Der Browser-Speicher ist voll – das Projekt konnte nicht gespeichert werden. Lösche große Bilder/Klänge oder alte Projekte und sichere als ZIP.', true); }
  if (ok) quotaWarned = false;
  return ok;
}
function loadSaved() {
  try { const p = JSON.parse(localStorage.getItem(STORE) || 'null'); if (p && Array.isArray(p.classes)) return p; } catch (e) { }
  return null;
}

// ------------------------------------------------------------ Hilfen
function toast(msg, isErr) {
  const t = document.createElement('div'); t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 4200 : 2400);
}
function cleanDoc(doc) {
  if (!doc) return '';
  return doc.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n').trim()
    .replace(/@param\s+(\w+)/g, '• $1:').replace(/@return/g, '↩ Rückgabe:');
}
function classById(id) { return S.project.classes.find(c => c.id === id); }
function classByName(n) { return S.project.classes.find(c => c.name === n); }

// ------------------------------------------------------------ Konsole
const consoleEl = $('console');
function writeConsole(text, cls) {
  const span = document.createElement('span'); if (cls) span.className = cls; span.textContent = text;
  consoleEl.appendChild(span);
  while (consoleEl.childNodes.length > 4000) consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function flushOutput() {
  if (!outBuf.length) return false;
  let text = '', err = null;
  const parts = [];
  for (const o of outBuf) { if (err !== null && o.err !== err) { parts.push({ s: text, err }); text = ''; } err = o.err; text += o.s; }
  parts.push({ s: text, err });
  outBuf.length = 0;
  for (const p of parts) writeConsole(p.s, p.err ? 'err' : null);
  showTab('console');
  return true;
}
function showTab(which) {
  const isPad = which === 'pad';
  $('tabConsole').setAttribute('aria-selected', String(!isPad)); $('tabPad').setAttribute('aria-selected', String(isPad));
  consoleEl.hidden = isPad; $('pad').hidden = !isPad;
  if (isPad) $('padInput').focus({ preventScroll: true });
}

// ------------------------------------------------------------ Diagramm
function refreshInfo(c) { S.info[c.id] = quickInfo(c.code); const n = S.info[c.id].name; if (n && n !== c.name) c.name = n; }
function renderDiagram() {
  const boxes = $('boxes'); boxes.innerHTML = '';
  let maxX = 600, maxY = 400;
  for (const c of S.project.classes) {
    const info = S.info[c.id] || {}; const st = S.status[c.id] || {};
    const el = document.createElement('div');
    el.className = 'cbox' + (st.dirty ? ' dirty' : '') + (st.error ? ' has-error' : '') + (info.abstract ? ' abstract' : '') + (S.selected === c.id ? ' selected' : '');
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.dataset.id = c.id;
    el.tabIndex = 0; el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Klasse ${c.name}${st.dirty ? ', nicht übersetzt' : ''}${st.error ? ', enthält Fehler' : ''}`);
    const stereo = info.kind === 'interface' ? '«interface»' : info.kind === 'enum' ? '«enum»' : info.abstract ? '«abstract»' : '';
    el.innerHTML = `<div class="chead">${stereo}</div><div class="cname">${esc(c.name)}</div>${st.error ? '<span class="badge">Fehler</span>' : ''}`;
    attachBoxEvents(el, c);
    boxes.appendChild(el);
    maxX = Math.max(maxX, c.x + BOX_W + 80); maxY = Math.max(maxY, c.y + BOX_H + 80);
  }
  const canvas = $('canvas'); canvas.style.width = maxX + 'px'; canvas.style.height = maxY + 'px';
  $('arrows').setAttribute('width', maxX); $('arrows').setAttribute('height', maxY);
  if (!S.project.classes.length) boxes.innerHTML = '<p class="hint-empty">Noch keine Klassen. Lege mit „+ Neue Klasse“ die erste an.</p>';
  renderArrows();
}
function boxRect(c) { const el = document.querySelector(`.cbox[data-id="${c.id}"]`); const h = el ? el.offsetHeight : BOX_H; return { x: c.x, y: c.y, w: BOX_W, h }; }
function edgePoint(r, tx, ty) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2; const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = (r.w / 2 + 3) / Math.abs(dx || 1e-9), sy = (r.h / 2 + 3) / Math.abs(dy || 1e-9); const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
function renderArrows() {
  const layer = $('arrowLayer'); layer.innerHTML = '';
  const names = new Map(S.project.classes.map(c => [c.name, c]));
  const drawn = new Set();
  const line = (from, to, kind) => {
    const a = boxRect(from), b = boxRect(to);
    const p1 = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2), p2 = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', p1.x); l.setAttribute('y1', p1.y); l.setAttribute('x2', p2.x); l.setAttribute('y2', p2.y);
    l.setAttribute('stroke-width', '1.5');
    l.style.stroke = kind === 'uses' ? 'var(--muted)' : 'var(--ink)';
    if (kind !== 'extends') l.setAttribute('stroke-dasharray', '6 4');
    l.setAttribute('marker-end', kind === 'uses' ? 'url(#mUses)' : 'url(#mInherit)');
    layer.appendChild(l);
  };
  for (const c of S.project.classes) {
    const info = S.info[c.id]; if (!info) continue;
    if (info.superName && names.has(info.superName)) { line(c, names.get(info.superName), 'extends'); drawn.add(c.name + '>' + info.superName); }
    for (const i of info.interfaces || []) if (names.has(i)) { line(c, names.get(i), 'implements'); drawn.add(c.name + '>' + i); }
  }
  for (const c of S.project.classes) {
    const info = S.info[c.id]; if (!info || !info.ids) continue;
    for (const n of info.ids) {
      if (n === c.name || !names.has(n) || drawn.has(c.name + '>' + n)) continue;
      drawn.add(c.name + '>' + n); line(c, names.get(n), 'uses');
    }
  }
}
function attachBoxEvents(el, c) {
  let start = null, moved = false;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    start = { x: ev.clientX, y: ev.clientY, cx: c.x, cy: c.y }; moved = false;
    el.setPointerCapture(ev.pointerId);
  });
  el.addEventListener('pointermove', (ev) => {
    if (!start) return;
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true; hideMenu();
    c.x = Math.max(0, Math.round((start.cx + dx) / 4) * 4); c.y = Math.max(0, Math.round((start.cy + dy) / 4) * 4);
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    renderArrows();
  });
  el.addEventListener('pointerup', (ev) => {
    if (!start) return;
    const wasMoved = moved; start = null;
    if (wasMoved) { save(); renderDiagram(); return; }
    selectClass(c.id);
    classMenu(c, ev.clientX, ev.clientY);
  });
  el.addEventListener('dblclick', (ev) => { ev.preventDefault(); hideMenu(); openEditor(c.id); });
  el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selectClass(c.id); classMenu(c, ev.clientX, ev.clientY); });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); openEditor(c.id); }
    else if (ev.key === ' ' || ev.key === 'ContextMenu') { ev.preventDefault(); const r = el.getBoundingClientRect(); classMenu(c, r.left + 20, r.bottom); }
  });
}
function selectClass(id) {
  S.selected = id;
  document.querySelectorAll('.cbox').forEach(b => b.classList.toggle('selected', b.dataset.id === id));
}

// ------------------------------------------------------------ Menüs
const menuEl = $('menu');
function showMenu(x, y, items) {
  menuEl.innerHTML = '';
  for (const it of items) {
    if (it.sep) { menuEl.appendChild(document.createElement('hr')); continue; }
    if (it.header) { const h = document.createElement('div'); h.className = 'mh'; h.textContent = it.header; menuEl.appendChild(h); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.textContent = it.label; if (it.title) b.title = it.title;
    b.className = (it.plain ? 'plain ' : '') + (it.danger ? 'danger' : '');
    b.addEventListener('click', () => { hideMenu(); it.action(); });
    menuEl.appendChild(b);
  }
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menuEl.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';
  const first = menuEl.querySelector('button'); if (first) first.focus({ preventScroll: true });
}
function hideMenu() { menuEl.hidden = true; }
document.addEventListener('pointerdown', (ev) => { if (!menuEl.hidden && !menuEl.contains(ev.target) && !ev.target.closest('.cbox, .obj, #btnProject')) hideMenu(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { if (!menuEl.hidden) hideMenu(); else if (modals.length) modals[modals.length - 1].close(); }
  if (!menuEl.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    const bs = [...menuEl.querySelectorAll('button')]; const i = bs.indexOf(document.activeElement);
    const n = ev.key === 'ArrowDown' ? (i + 1) % bs.length : (i - 1 + bs.length) % bs.length; bs[n].focus(); ev.preventDefault();
  }
});

function canUse(c) { const st = S.status[c.id] || {}; return S.compiledOnce && !st.dirty && !st.error && rt.cls(c.name) && !rt.cls(c.name).builtin; }
function classMenu(c, x, y) {
  const items = [];
  if (canUse(c)) {
    const d = rt.describeClass(c.name);
    for (const k of d.ctors) items.push({ label: k.label, title: cleanDoc(k.doc), action: () => callDialog({ kind: 'ctor', cls: c.name, entry: k }) });
    if (d.statics.length) { if (items.length) items.push({ sep: true }); for (const m of d.statics) items.push({ label: m.label, title: cleanDoc(m.doc), action: () => callDialog({ kind: 'static', cls: c.name, entry: m }) }); }
    if (d.hasStatics) items.push({ label: 'Klassenvariablen inspizieren', plain: true, action: () => runUI(() => rt.inspectStatic(rt.cls(c.name)), (r) => inspectorModal(r, null, 'Klasse ' + c.name)) });
    if (items.length) items.push({ sep: true });
  } else {
    items.push({ header: (S.status[c.id] || {}).error ? 'Klasse enthält Fehler' : 'Noch nicht übersetzt' });
    items.push({ label: 'Übersetzen', plain: true, action: () => compileAll() });
  }
  items.push({ label: 'Bearbeiten', plain: true, action: () => openEditor(c.id) });
  items.push({ label: 'Entfernen', plain: true, danger: true, action: () => confirmModal(`Klasse ${c.name} entfernen?`, 'Der Quelltext wird gelöscht. Objekte auf der Objektleiste werden beim nächsten Übersetzen entfernt.', 'Entfernen', () => removeClass(c.id)) });
  showMenu(x, y, items);
}
function objectMenu(b, x, y) {
  const items = [];
  const groups = rt.describeObject(b.value);
  for (const g of groups) {
    if (groups.length > 1 || g.inherited) items.push({ header: g.inherited ? `geerbt von ${g.from}` : g.from });
    for (const m of g.methods) items.push({ label: m.label, title: cleanDoc(m.doc), action: () => callDialog({ kind: 'method', obj: b, entry: m }) });
  }
  if (items.length) items.push({ sep: true });
  items.push({ label: 'Inspizieren', plain: true, action: () => inspectorModal(rt.inspect(b.value), b.value, `${b.name} : ${rt.typeNameOf(b.value)}`) });
  items.push({ label: 'Entfernen', plain: true, danger: true, action: () => removeBench(b.name) });
  showMenu(x, y, items);
}

// ------------------------------------------------------------ Dialoge
const modals = [];
function openModal({ title, body, actions, wide }) {
  const back = document.createElement('div'); back.className = 'modal-back';
  const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  if (wide) m.style.width = 'min(720px, 100%)';
  const h = document.createElement('header'); h.innerHTML = `<h3>${esc(title)}</h3>`;
  const x = document.createElement('button'); x.className = 'btn small ghost'; x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Schließen'); h.appendChild(x);
  const mb = document.createElement('div'); mb.className = 'mbody';
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
  const f = document.createElement('footer');
  const prevFocus = document.activeElement;
  const ctl = { el: m, body: mb, close() { back.remove(); const i = modals.indexOf(ctl); if (i >= 0) modals.splice(i, 1); if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } };
  for (const a of actions || []) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (a.primary ? ' primary' : ''); b.textContent = a.label;
    b.addEventListener('click', () => { const keep = a.action ? a.action(ctl) : false; if (keep !== true) ctl.close(); });
    if (a.primary) ctl.primary = b;
    f.appendChild(b);
  }
  x.addEventListener('click', () => ctl.close());
  back.addEventListener('pointerdown', (e) => { if (e.target === back) ctl.close(); });
  m.append(h, mb); if (actions && actions.length) m.appendChild(f);
  back.appendChild(m); $('modalRoot').appendChild(back);
  modals.push(ctl);
  setTimeout(() => { const inp = mb.querySelector('input, select, textarea'); (inp || ctl.primary || x).focus({ preventScroll: true }); if (inp && inp.select) inp.select(); }, 0);
  return ctl;
}
function confirmModal(title, text, okLabel, onOk) {
  const p = document.createElement('p'); p.style.margin = '0'; p.textContent = text;
  openModal({ title, body: p, actions: [{ label: 'Abbrechen' }, { label: okLabel, primary: true, action: onOk }] });
}

function nextObjName(cls) {
  const base = cls.charAt(0).toLowerCase() + cls.slice(1);
  let i = 1; while (S.bench.some(b => b.name === base + i) || S.padEnv.vars.has(base + i)) i++;
  return base + i;
}
function callDialog({ kind, cls, obj, entry }) {
  const m = entry.m;
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  const doc = cleanDoc(entry.doc);
  if (doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = doc; wrap.appendChild(d); }
  const sig = document.createElement('div'); sig.className = 'sig';
  sig.textContent = kind === 'method' ? `${obj.name}.${entry.label}` : kind === 'static' ? `${cls}.${entry.label}` : entry.label;
  wrap.appendChild(sig);
  const form = document.createElement('form'); form.className = 'field';
  const inputs = [];
  let nameInput = null;
  if (kind === 'ctor') {
    const l = document.createElement('label'); l.htmlFor = 'dlgObjName'; l.innerHTML = 'Name des Objekts';
    nameInput = document.createElement('input'); nameInput.id = 'dlgObjName'; nameInput.value = nextObjName(cls); nameInput.spellcheck = false;
    form.append(l, nameInput);
  }
  m.params.forEach((p, i) => {
    const l = document.createElement('label'); l.htmlFor = 'dlgP' + i; l.innerHTML = `${esc(typeStr(p.type))} <b>${esc(p.name)}</b>`;
    const inp = document.createElement('input'); inp.id = 'dlgP' + i; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.placeholder = placeholderFor(p.type);
    if (typeStr(p.type) === 'String[]' && m.name === 'main') inp.value = '{}';
    const remembered = lastArgs[argKey(m, i)]; if (remembered !== undefined) inp.value = remembered;
    form.append(l, inp); inputs.push(inp);
  });
  if (kind === 'ctor' || m.params.length) wrap.appendChild(form);
  const errBox = document.createElement('div'); errBox.className = 'formerr'; errBox.hidden = true; wrap.appendChild(errBox);
  const title = kind === 'ctor' ? `Objekt der Klasse ${cls} erzeugen` : `Methode ${m.name} aufrufen`;
  const submit = (ctl) => {
    errBox.hidden = true;
    let objName = null;
    if (nameInput) {
      objName = nameInput.value.trim();
      if (!/^[A-Za-z_$À-ɏ][\w$À-ɏ]*$/.test(objName)) { errBox.textContent = 'Der Objektname muss ein gültiger Java-Name sein (Buchstaben, Ziffern, _; nicht mit Ziffer beginnen).'; errBox.hidden = false; nameInput.focus(); return true; }
      if (S.bench.some(b => b.name === objName)) { errBox.textContent = `Es gibt schon ein Objekt namens ${objName}.`; errBox.hidden = false; nameInput.focus(); return true; }
    }
    if (rt.running) { busyNote(); return true; }
    const args = [];
    for (let i = 0; i < m.params.length; i++) {
      try { args.push(rt.evalArg(inputs[i].value, m.params[i].type, S.padEnv)); flushOutput(); }
      catch (e) { flushOutput(); errBox.textContent = `${m.params[i].name}: ${e.message}`; errBox.hidden = false; inputs[i].focus(); return true; }
      lastArgs[argKey(m, i)] = inputs[i].value;
    }
    ctl.close();
    const callText = (kind === 'method' ? obj.name + '.' : kind === 'static' ? cls + '.' : 'new ' + cls) + (kind === 'ctor' ? '' : m.name) + '(' + inputs.map(x => x.value.trim()).join(', ') + ')';
    runProgram(() => rt.callMethodG(kind === 'method' ? obj.value : null, m, args)).then((r) => {
      if (!r) return;
      flushOutput();
      if (r.stopped) { writeConsole(`[${callText} wurde beendet]\n`, 'note'); return; }
      if (r.exited !== undefined) writeConsole(`[Programm mit System.exit(${r.exited}) beendet]\n`, 'note');
      if (!r.ok) { showRuntimeError(r, callText); return; }
      if (kind === 'ctor') { if (S.bench.some(b => b.name === objName)) objName = nextObjName(r.value.cls.name); addBench(objName, r.value); return; }
      renderBench();
      if (m.ret && m.ret.name !== 'void' && r.value !== undefined) resultModal(callText, m.ret, r.value);
    });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const ctl = modals[modals.length - 1]; if (submit(ctl) !== true) { /* geschlossen */ } } });
  if (!m.params.length && kind !== 'ctor') {
    // Ohne Parameter sofort ausführen (wie in BlueJ-ähnlichen Umgebungen üblich)
    submit({ close() { } });
    return;
  }
  openModal({ title, body: wrap, actions: [{ label: 'Abbrechen' }, { label: 'OK', primary: true, action: submit }] });
}
const lastArgs = {};
function argKey(m, i) { return (m.cls ? m.cls.name : '') + '.' + m.name + '/' + m.params.length + '#' + i; }
function placeholderFor(t) {
  if (t.dims) return '{1, 2, 3}';
  switch (t.name) { case 'int': case 'long': case 'short': case 'byte': case 'Integer': return 'z. B. 42'; case 'double': case 'float': case 'Double': return 'z. B. 3.5'; case 'boolean': return 'true oder false'; case 'char': return "z. B. 'a'"; case 'String': return 'z. B. "Text"'; default: return 'Objektname oder null'; }
}
function resultModal(callText, retType, value) {
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  const sig = document.createElement('div'); sig.className = 'sig'; sig.textContent = callText; wrap.appendChild(sig);
  const res = document.createElement('div'); res.className = 'result';
  const actions = [];
  if (rt.isRef(value)) {
    res.innerHTML = `<span class="t">${esc(typeStr(retType))}</span>`;
    const b = document.createElement('button'); b.className = 'refbtn'; b.type = 'button'; b.textContent = '→ ' + rt.typeNameOf(value) + '-Objekt';
    b.addEventListener('click', () => inspectorModal(rt.inspect(value), value, rt.typeNameOf(value)));
    res.appendChild(b);
    const str = document.createElement('span'); str.className = 't'; const r = rt.run(() => rt.str(value)); flushOutput(); str.textContent = r.ok ? r.value : ''; res.appendChild(str);
    actions.push({ label: 'Inspizieren', action: () => { inspectorModal(rt.inspect(value), value, rt.typeNameOf(value)); } });
    actions.push({ label: 'Auf Objektleiste legen', action: () => { if (value instanceof JObject) addBench(nextObjName(value.cls.name), value); else addBench(nextObjName('array'), value); } });
  } else {
    res.innerHTML = `<span class="t">${esc(rt.typeNameOf(value) === 'null' ? typeStr(retType) : typeStr(retType))}</span><span>${esc(rt.displayValue(value))}</span>`;
  }
  wrap.appendChild(res);
  actions.push({ label: 'Schließen', primary: true });
  writeConsole(`${callText} → ${rt.isRef(value) ? '<' + rt.typeNameOf(value) + '-Objekt>' : rt.displayValue(value)}\n`, 'val');
  openModal({ title: 'Rückgabewert', body: wrap, actions });
}
function inspectorModal(data, value, title) {
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  if (!data.rows.length) { const p = document.createElement('p'); p.className = 'doc'; p.style.margin = '0'; p.textContent = value instanceof JArray ? 'Das Array ist leer.' : 'Keine Attribute.'; wrap.appendChild(p); }
  else {
    const scroller = document.createElement('div'); scroller.style.overflowX = 'auto';
    const tbl = document.createElement('table'); tbl.className = 'insp';
    let lastFrom = null;
    const multiple = new Set(data.rows.map(r => r.from)).size > 1;
    for (const r of data.rows) {
      if (multiple && r.from !== lastFrom) { lastFrom = r.from; const tr = document.createElement('tr'); tr.className = 'from'; tr.innerHTML = `<td colspan="4">aus ${esc(r.from)}</td>`; tbl.appendChild(tr); }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="vis">${esc(r.vis && r.vis !== 'package' ? r.vis : '')}</td><td class="ty">${esc(r.type)}</td><td class="nm">${esc(r.name)}</td><td class="v"></td>`;
      const td = tr.lastChild;
      if (rt.isRef(r.value)) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'refbtn'; b.textContent = '→ ' + (r.value instanceof JArray ? rt.typeNameOf(r.value) + ' [' + r.value.data.length + ']' : rt.typeNameOf(r.value) + (r.value.enumName !== undefined ? '.' + r.value.enumName : ''));
        b.addEventListener('click', () => inspectorModal(rt.inspect(r.value), r.value, `${r.name} : ${rt.typeNameOf(r.value)}`));
        td.appendChild(b);
      } else td.textContent = r.value === undefined ? '' : rt.displayValue(r.value);
      tbl.appendChild(tr);
    }
    scroller.appendChild(tbl); wrap.appendChild(scroller);
  }
  const actions = [];
  if (value && rt.isRef(value) && !S.bench.some(b => b.value === value)) actions.push({ label: 'Auf Objektleiste legen', action: () => addBench(nextObjName(value instanceof JObject ? value.cls.name : 'array'), value) });
  actions.push({ label: 'Schließen', primary: true });
  openModal({ title: 'Inspektor: ' + title + (data.title && !title.includes(data.title) ? '  ·  ' + data.title : ''), body: wrap, actions, wide: true });
}
// Fehler in einem Maus-/Tastatur-Ereignis: wie in Java nur in der Konsole melden
// (sonst käme z. B. bei mouseMoved ein Dialog nach dem anderen)
let lastEventErr = 0;
function eventResult(r, label) {
  if (!r || r.ok || r.stopped || r.busy) return;
  if (r.exited !== undefined) { writeConsole(`[Programm mit System.exit(${r.exited}) beendet]\n`, 'note'); gfx.closeAll(); return; }
  showRuntimeError(r, `Fehler beim Ereignis ${label}()`, { quiet: true });
  if (Date.now() - lastEventErr > 4000) toast(`Fehler beim Ereignis ${label}() – siehe Konsole`, true);
  lastEventErr = Date.now();
}
function showRuntimeError(r, callText, opts = {}) {
  const isEx = r.exception;
  writeConsole((callText ? callText + '\n' : '') + (isEx ? 'Exception: ' : 'Fehler: ') + r.message + '\n', 'err');
  if (r.trace) for (const f of r.trace.slice(0, 8)) writeConsole(`    bei ${f.cls}.${f.method === '<clinit>' ? '<Klasseninitialisierung>' : f.method}  (Zeile ${f.line})\n`, 'err');
  showTab('console');
  if (opts.quiet) return;
  const cls = r.className && classByName(r.className);
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  const p = document.createElement('div'); p.className = 'formerr'; p.style.fontFamily = 'var(--mono)'; p.textContent = r.message; wrap.appendChild(p);
  if (r.trace && r.trace.length) { const t = document.createElement('div'); t.className = 'trace'; t.textContent = r.trace.slice(0, 8).map(f => `bei ${f.cls}.${f.method} (Zeile ${f.line})`).join('\n'); wrap.appendChild(t); }
  const actions = [];
  if (cls && r.line) actions.push({ label: `Zeile ${r.line} in ${cls.name} zeigen`, action: () => { openEditor(cls.id); markErrorLine(r.line, r.message); } });
  actions.push({ label: 'OK', primary: true });
  openModal({ title: isEx ? 'Ausnahme bei der Ausführung' : 'Fehler bei der Ausführung', body: wrap, actions });
}
// ------------------------------------------------------------ Programm ausführen (unterbrechbar)
let runShowTimer = 0;
function setRunning(on) {
  clearTimeout(runShowTimer);
  document.body.classList.toggle('running', on);
  // Anzeige erst nach kurzer Zeit, damit kurze Aufrufe nicht flackern
  if (on) runShowTimer = setTimeout(() => { $('runBar').hidden = false; }, 150);
  else $('runBar').hidden = true;
}
function busyNote() { toast('Es läuft noch ein Programm. Beende es zuerst mit „Beenden“.', true); }
// Führt makeGen() unterbrechbar aus; liefert das Ergebnis (wie rt.run) oder null, wenn schon etwas läuft
async function runProgram(makeGen, opts = {}) {
  if (rt.running) { busyNote(); return null; }
  if (gfx.resetFast) gfx.resetFast();
  setRunning(true);
  liveOut = opts.liveOut || null;
  let r;
  try { r = opts.snippet !== undefined ? await rt.evalSnippetAsync(opts.snippet, opts.env) : await rt.runAsync(makeGen); }
  finally { liveOut = null; setRunning(false); }
  return r;
}
function stopProgram() {
  if (!rt.running) return;
  rt.stop(); gfx.cancel(); gfx.detach();
}
function runUI(fn, ok) { const r = rt.run(fn); flushOutput(); if (!r.ok) showRuntimeError(r); else ok(r.value); }

// ------------------------------------------------------------ Objektleiste
function addBench(name, value) {
  S.bench.push({ name, value });
  S.benchEnv.declare(name, rt.typeOfValue(value), value);
  renderBench();
  const el = document.querySelector(`.obj[data-name="${CSS.escape(name)}"]`); if (el) el.focus({ preventScroll: true });
}
function removeBench(name) { S.bench = S.bench.filter(b => b.name !== name); S.benchEnv.vars.delete(name); renderBench(); }
function clearBench() { S.bench = []; S.benchEnv.vars.clear(); renderBench(); }
function renderBench() {
  const el = $('bench'); el.innerHTML = '';
  if (!S.bench.length) { el.innerHTML = '<p class="bench-empty">Hier erscheinen deine Objekte. Klicke im Diagramm auf eine Klasse und wähle <b>new …</b>, um eines zu erzeugen.</p>'; return; }
  for (const b of S.bench) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'obj'; btn.dataset.name = b.name;
    btn.innerHTML = `<b>${esc(b.name)}</b><span>: ${esc(rt.typeNameOf(b.value))}</span>`;
    btn.setAttribute('aria-label', `Objekt ${b.name} vom Typ ${rt.typeNameOf(b.value)}`);
    btn.addEventListener('click', (ev) => { const r = btn.getBoundingClientRect(); objectMenu(b, ev.clientX || r.left, ev.clientY || r.bottom); });
    btn.addEventListener('contextmenu', (ev) => { ev.preventDefault(); objectMenu(b, ev.clientX, ev.clientY); });
    btn.addEventListener('dblclick', (ev) => { ev.preventDefault(); hideMenu(); inspectorModal(rt.inspect(b.value), b.value, `${b.name} : ${rt.typeNameOf(b.value)}`); });
    el.appendChild(btn);
  }
}

// ------------------------------------------------------------ Übersetzen
function compileAll(opts = {}) {
  syncEditor();
  if (rt.running) { stopProgram(); flushOutput(); writeConsole('[Laufendes Programm wurde zum Übersetzen beendet]\n', 'note'); }
  for (const c of S.project.classes) refreshInfo(c);
  const res = rt.compile(S.project.classes.map(c => ({ id: c.id, code: c.code })));
  const hadBench = S.bench.length > 0;
  for (const c of S.project.classes) S.status[c.id] = { dirty: !res.ok, error: null };
  if (!res.ok) {
    S.compiledOnce = false;
    for (const e of res.errors) if (e.fileId && S.status[e.fileId] && !S.status[e.fileId].error) S.status[e.fileId].error = { line: e.line, message: e.message };
    renderDiagram();
    const first = res.errors[0];
    const c = classById(first.fileId);
    if (!opts.silent && c) { openEditor(c.id); markErrorLine(first.line, first.message); }
    if (!opts.silent) toast(`Übersetzen fehlgeschlagen${c ? ' in ' + c.name : ''}: Zeile ${first.line}`, true);
    return false;
  }
  S.compiledOnce = true;
  gfx.closeAll();
  clearBench(); S.padEnv = new Env(S.benchEnv);
  renderDiagram();
  if (S.editing) setStatus('Übersetzt – keine Fehler.', 'ok');
  if (!opts.silent) toast(hadBench ? 'Übersetzt. Die Objektleiste wurde geleert.' : 'Übersetzt – keine Fehler.');
  return true;
}
function markDirty(id) {
  const st = S.status[id] || (S.status[id] = {});
  if (!st.dirty || st.error) { st.dirty = true; st.error = null; const el = document.querySelector(`.cbox[data-id="${id}"]`); if (el) { el.classList.add('dirty'); el.classList.remove('has-error'); const bd = el.querySelector('.badge'); if (bd) bd.remove(); } }
}

// ------------------------------------------------------------ Einstellungen
const SETTINGS = 'javawerkbank.settings.v1';
const SET_DEFAULT = { fontSize: 13, theme: 'auto', scopes: true, autoClose: true, indent: 4 };
const SET = (() => { try { return { ...SET_DEFAULT, ...(JSON.parse(localStorage.getItem(SETTINGS) || 'null') || {}) }; } catch (e) { return { ...SET_DEFAULT }; } })();
const FONT_SIZES = [11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32];
const LH = () => Math.round(SET.fontSize * 1.54);
const IND = () => ' '.repeat(SET.indent);
let charW = 7.8;
function measureChar() {
  const cv = document.createElement('canvas').getContext('2d');
  cv.font = `${SET.fontSize}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
  const w = cv.measureText('M'.repeat(50)).width / 50; if (w > 0) charW = w;
}
function applySettings(persist) {
  const r = document.documentElement;
  r.style.setProperty('--ed-fs', SET.fontSize + 'px'); r.style.setProperty('--ed-lh', LH() + 'px');
  if (SET.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', SET.theme);
  measureChar();
  if (persist) { try { localStorage.setItem(SETTINGS, JSON.stringify(SET)); } catch (e) { } }
  if (S.editing) renderEditor();
}
applySettings(false);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureChar(); if (S.editing) renderEditor(); });
function changeFontSize(dir) {
  let i = FONT_SIZES.indexOf(SET.fontSize); if (i < 0) i = FONT_SIZES.indexOf(13);
  i = Math.max(0, Math.min(FONT_SIZES.length - 1, i + dir)); SET.fontSize = FONT_SIZES[i]; applySettings(true);
  toast(`Schriftgröße ${SET.fontSize} pt`);
}
function settingsDialog() {
  const f = document.createElement('form'); f.className = 'settings';
  f.innerHTML = `<label for="stFs">Schriftgröße</label><select id="stFs">${FONT_SIZES.map(n => `<option value="${n}"${n === SET.fontSize ? ' selected' : ''}>${n}${n === 13 ? ' (Standard)' : n >= 20 ? ' (Beamer)' : ''}</option>`).join('')}</select>
  <label for="stTheme">Darstellung</label><select id="stTheme"><option value="auto">wie das System</option><option value="light">hell</option><option value="dark">dunkel</option></select>
  <label for="stInd">Einrückung</label><select id="stInd"><option value="2">2 Leerzeichen</option><option value="4">4 Leerzeichen</option></select>
  <label class="chk"><input type="checkbox" id="stScopes"> Bereiche farbig hinterlegen (Klasse grün, Methode gelb, Schleife blau, Verzweigung rosa)</label>
  <label class="chk"><input type="checkbox" id="stClose"> Klammern automatisch schließen</label>
  <p class="hint">Im Editor ändert <code>Strg</code> + <code>+</code> / <code>−</code> die Schriftgröße. Schriftgröße gilt für Editor und Konsole.</p>`;
  const q = (id) => f.querySelector('#' + id);
  q('stTheme').value = SET.theme; q('stInd').value = String(SET.indent); q('stScopes').checked = SET.scopes; q('stClose').checked = SET.autoClose;
  f.addEventListener('change', () => {
    SET.fontSize = +q('stFs').value; SET.theme = q('stTheme').value; SET.indent = +q('stInd').value;
    SET.scopes = q('stScopes').checked; SET.autoClose = q('stClose').checked; applySettings(true);
  });
  f.addEventListener('submit', (e) => e.preventDefault());
  openModal({ title: 'Einstellungen', body: f, actions: [{ label: 'Fertig', primary: true }] });
}

// ------------------------------------------------------------ Editor
const edText = $('edText'), edHl = $('edHl'), edGutter = $('edGutter'), edLines = $('edLines'), edDeco = $('edDeco');
let errLine = 0;
const KWS = new Set('abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static super switch synchronized this throw throws transient try volatile while var'.split(' '));
const LITS = new Set(['true', 'false', 'null']);
const PRIMS = new Set(['int', 'double', 'boolean', 'char', 'long', 'float', 'short', 'byte', 'void']);
function highlight(code) {
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|('(?:[^'\\\n]|\\.)*'?)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[lLdDfF]?\b)|([A-Za-z_$À-ɏ][\w$À-ɏ]*)/g;
  const lines = [''];
  const push = (text, cls) => {
    const parts = text.split('\n');
    parts.forEach((p, i) => { if (i > 0) lines.push(''); if (p) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p); });
  };
  let last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index > last) push(code.slice(last, m.index), null);
    let cls = null;
    if (m[1] || m[2]) cls = 'tk-com'; else if (m[3] || m[4]) cls = 'tk-str'; else if (m[5]) cls = 'tk-num';
    else if (m[6]) { const w = m[6]; cls = KWS.has(w) || PRIMS.has(w) || LITS.has(w) ? 'tk-kw' : /^[A-Z]/.test(w) ? 'tk-typ' : null; }
    push(m[0], cls);
    last = re.lastIndex;
  }
  if (last < code.length) push(code.slice(last), null);
  return lines;
}
// Zwischenspeicher für Analyse des aktuellen Texts
const ana = { text: null, mask: null, starts: null, lines: null, scopes: [], maxCols: 0 };
function analyse() {
  const v = edText.value; if (ana.text === v) return ana;
  ana.text = v; ana.mask = WBEd.codeMask(v); ana.starts = WBEd.lineStarts(v); ana.lines = v.split('\n');
  ana.scopes = WBEd.scopes(v, ana.mask).filter(s => s.kind !== 'init');
  ana.maxCols = ana.lines.reduce((m, l) => Math.max(m, WBEd.visCol(l, l.length)), 0);
  return ana;
}
const PAD_X = 12, PAD_Y = 8;
function posBox(pos, len, cls) {
  const a = analyse(); const ln = WBEd.lineOf(a.starts, pos); const line = a.lines[ln]; const off = pos - a.starts[ln];
  const c0 = WBEd.visCol(line, off), c1 = WBEd.visCol(line, off + len);
  return `<div class="${cls}" style="left:${PAD_X + c0 * charW}px;top:${PAD_Y + ln * LH()}px;width:${Math.max(2, (c1 - c0) * charW)}px;height:${LH()}px"></div>`;
}
function renderDeco() {
  if (!S.editing) return;
  const a = analyse(); const lh = LH(); let h = '';
  if (SET.scopes) {
    const full = Math.max(edText.clientWidth - 4, PAD_X * 2 + a.maxCols * charW + 16);
    for (const s of a.scopes) {
      const left = Math.max(2, PAD_X + s.col * charW - 6);
      const right = full - s.depth * 3;
      h += `<div class="sc ${s.kind}" style="left:${left}px;top:${PAD_Y + s.startLine * lh}px;width:${Math.max(10, right - left)}px;height:${(s.endLine - s.startLine + 1) * lh}px"></div>`;
    }
  }
  if (find.open && find.q) find.matches.forEach((p, i) => { h += posBox(p, find.qLen, 'mk' + (i === find.cur ? ' cur' : '')); });
  if (document.activeElement === edText && edText.selectionStart === edText.selectionEnd) {
    const b = WBEd.bracketAt(a.text, a.mask, edText.selectionStart);
    if (b) { h += posBox(b.a, 1, 'br' + (b.b < 0 ? ' bad' : '')); if (b.b >= 0) h += posBox(b.b, 1, 'br'); }
  }
  edDeco.innerHTML = h;
}
function renderEditor() {
  const lines = highlight(edText.value);
  edLines.innerHTML = lines.map((l, i) => `<div class="l${i + 1 === errLine ? ' err' : ''}">${l || '​'}</div>`).join('') + '<div class="l">​</div>';
  let g = ''; for (let i = 1; i <= lines.length; i++) g += `<div${i === errLine ? ' class="err"' : ''}>${i}</div>`;
  edGutter.innerHTML = g + '<div>&nbsp;</div>';
  if (find.open) computeMatches(false);
  renderDeco();
  syncScroll();
}
function syncScroll() { edHl.scrollTop = edText.scrollTop; edHl.scrollLeft = edText.scrollLeft; edGutter.scrollTop = edText.scrollTop; }
function setStatus(text, kind, lineBtn) {
  const s = $('edStatus'); s.className = 'ed-status' + (kind ? ' ' + kind : ''); s.textContent = text;
  if (lineBtn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Zur Zeile ' + lineBtn; b.addEventListener('click', () => gotoLine(lineBtn)); s.appendChild(b); }
}
function openEditor(id) {
  syncEditor();
  const c = classById(id); if (!c) return;
  S.editing = id; errLine = 0;
  $('editorPane').hidden = false;
  $('edTitle').innerHTML = `${esc(c.name)}<small>Quelltext</small>`;
  edText.value = c.code;
  const st = S.status[id] || {};
  if (st.error) { errLine = st.error.line; setStatus(`Zeile ${st.error.line}: ${st.error.message}`, 'err', st.error.line); }
  else setStatus(st.dirty ? 'Geändert – noch nicht übersetzt.' : 'Übersetzt.', st.dirty ? '' : 'ok');
  renderEditor();
  selectClass(id);
  setTimeout(() => { edText.focus({ preventScroll: true }); if (errLine) gotoLine(errLine); }, 0);
  renderArrows();
}
function closeEditor() { syncEditor(); closeFind(false); S.editing = null; $('editorPane').hidden = true; renderDiagram(); }
function syncEditor() {
  if (!S.editing) return;
  const c = classById(S.editing); if (!c) return;
  if (c.code !== edText.value) { c.code = edText.value; markDirty(c.id); }
  const old = c.name; refreshInfo(c);
  if (old !== c.name) { $('edTitle').innerHTML = `${esc(c.name)}<small>Quelltext</small>`; }
  save();
}
function markErrorLine(line, msg) { errLine = line; setStatus(`Zeile ${line}: ${msg}`, 'err', line); renderEditor(); gotoLine(line); }
function scrollToLine(line) {
  const lh = LH(), top = (line - 1) * lh, vis = edText.clientHeight;
  if (top < edText.scrollTop + lh || top > edText.scrollTop + vis - 3 * lh) edText.scrollTop = Math.max(0, top - Math.floor(vis / 3));
  syncScroll();
}
function scrollToPos(pos) {
  const a = analyse(); const ln = WBEd.lineOf(a.starts, pos); scrollToLine(ln + 1);
  const x = PAD_X + WBEd.visCol(a.lines[ln], pos - a.starts[ln]) * charW;
  if (x < edText.scrollLeft + 20 || x > edText.scrollLeft + edText.clientWidth - 40) edText.scrollLeft = Math.max(0, x - edText.clientWidth / 2);
  syncScroll();
}
function gotoLine(line) {
  const lines = edText.value.split('\n'); line = Math.max(1, Math.min(lines.length, line)); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  edText.focus({ preventScroll: true }); edText.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  scrollToLine(line); renderDeco();
}
function gotoLineDialog() {
  const n = edText.value.split('\n').length;
  const cur = edText.value.slice(0, edText.selectionStart).split('\n').length;
  const form = document.createElement('form'); form.className = 'field';
  form.innerHTML = `<label for="glLine">Zeilennummer (1 bis ${n})</label><input id="glLine" inputmode="numeric" autocomplete="off">`;
  form.querySelector('input').value = cur;
  const ok = () => { const v = parseInt(form.querySelector('input').value, 10); if (v > 0) setTimeout(() => gotoLine(v), 0); };
  form.addEventListener('submit', (e) => { e.preventDefault(); ok(); modals[modals.length - 1].close(); });
  openModal({ title: 'Gehe zu Zeile', body: form, actions: [{ label: 'Abbrechen' }, { label: 'Springen', primary: true, action: ok }] });
}
let edTimer = null;
edText.addEventListener('input', () => {
  if (errLine) { errLine = 0; }
  renderEditor();
  const c = classById(S.editing); if (c) { markDirty(c.id); setStatus('Geändert – noch nicht übersetzt.'); }
  clearTimeout(edTimer); edTimer = setTimeout(() => { const before = c && c.name; syncEditor(); if (c && (before !== c.name)) renderDiagram(); else renderArrows(); }, 400);
});
edText.addEventListener('scroll', syncScroll);
for (const ev of ['keyup', 'mouseup', 'focus', 'blur']) edText.addEventListener(ev, () => renderDeco());
window.addEventListener('resize', () => { if (S.editing) renderDeco(); });
function insertText(t) { if (!document.execCommand('insertText', false, t)) { const s = edText.selectionStart, e = edText.selectionEnd; edText.setRangeText(t, s, e, 'end'); edText.dispatchEvent(new Event('input')); } }
function deleteSel() { if (!document.execCommand('delete', false)) { const s = edText.selectionStart, e = edText.selectionEnd; edText.setRangeText('', s, e, 'end'); edText.dispatchEvent(new Event('input')); } }
// Ganze Zeilen der Auswahl durch neue ersetzen (rückgängig machbar)
function replaceLines(fn) {
  const v = edText.value, s = edText.selectionStart, e = edText.selectionEnd;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e); if (le < 0) le = v.length;
  const old = v.slice(ls, le); const nw = fn(old.split('\n')).join('\n');
  if (nw === old) return;
  edText.focus({ preventScroll: true }); edText.setSelectionRange(ls, le); insertText(nw);
  edText.setSelectionRange(ls, ls + nw.length);
}
function toggleComment() { replaceLines(WBEd.toggleComment); }
function autoIndent() {
  const v = edText.value; const nv = WBEd.reindent(v, IND());
  if (nv === v) { setStatus('Einrückung ist schon in Ordnung.', 'ok'); return; }
  const line = v.slice(0, edText.selectionStart).split('\n').length; const top = edText.scrollTop;
  edText.focus({ preventScroll: true }); edText.setSelectionRange(0, v.length); insertText(nv);
  const ls = nv.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  const ind = (nv.slice(ls).match(/^[ \t]*/) || [''])[0].length;
  edText.setSelectionRange(ls + ind, ls + ind); edText.scrollTop = top; syncScroll();
  setStatus('Quelltext neu eingerückt. Strg+Z macht es rückgängig.');
}
const OPEN_CLOSE = { '(': ')', '[': ']' };
edText.addEventListener('keydown', (ev) => {
  const v = edText.value, s = edText.selectionStart, e = edText.selectionEnd;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && !ev.altKey) {
    const k = ev.key.toLowerCase();
    if (k === 's') { ev.preventDefault(); compileAll(); return; }
    if (k === 'f' && ev.shiftKey) { ev.preventDefault(); autoIndent(); return; }
    if (k === 'f') { ev.preventDefault(); openFind(false); return; }
    if (k === 'h' || k === 'r') { ev.preventDefault(); openFind(true); return; }
    if (k === 'g') { ev.preventDefault(); gotoLineDialog(); return; }
    if (k === '/' || k === '#' || ev.code === 'Slash') { ev.preventDefault(); toggleComment(); return; }
    if (k === '+' || k === '=' || ev.code === 'NumpadAdd') { ev.preventDefault(); changeFontSize(1); return; }
    if (k === '-' || ev.code === 'NumpadSubtract') { ev.preventDefault(); changeFontSize(-1); return; }
  }
  if (ev.key === 'F3') { ev.preventDefault(); if (find.q) findStep(ev.shiftKey ? -1 : 1); else openFind(false); return; }
  if (ev.key === 'Escape' && find.open) { ev.preventDefault(); ev.stopPropagation(); closeFind(true); return; }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (s !== e && v.slice(s, e).includes('\n') || ev.shiftKey) {
      const le = v.indexOf('\n', e - 1) === -1 ? v.length : v.indexOf('\n', e - (e > s && v[e - 1] === '\n' ? 1 : 0));
      const block = v.slice(ls, le);
      const nb = ev.shiftKey ? block.replace(new RegExp(`^( {1,${SET.indent}}|\\t)`, 'gm'), '') : block.replace(/^/gm, IND());
      edText.setSelectionRange(ls, le); insertText(nb); edText.setSelectionRange(ls, ls + nb.length);
    } else insertText(IND());
    return;
  }
  if (ev.key === 'Enter' && !ctrl && !ev.altKey) {
    ev.preventDefault();
    const ls = v.lastIndexOf('\n', s - 1) + 1; const cur = v.slice(ls, s);
    let ind = (cur.match(/^[ \t]*/) || [''])[0];
    const before = v.slice(0, s).trimEnd(); const after = v.slice(e);
    if (before.endsWith('{')) {
      const inner = ind + IND();
      if (/^[ \t]*\}/.test(after)) { insertText('\n' + inner + '\n' + ind); const p = edText.selectionStart - ind.length - 1; edText.setSelectionRange(p, p); return; }
      const a = analyse();
      if (SET.autoClose && !after.split('\n')[0].trim() && WBEd.unbalancedBraces(a.text, a.mask) > 0) {
        insertText('\n' + inner + '\n' + ind + '}'); const p = edText.selectionStart - ind.length - 2; edText.setSelectionRange(p, p); return;
      }
      ind = inner;
    } else if (/^\s*\/?\*\*?/.test(cur) && !cur.includes('*/')) { insertText('\n' + ind.replace(/\/$/, '') + (cur.trim().startsWith('/*') ? ' * ' : '* ')); return; }
    insertText('\n' + ind); return;
  }
  if (ev.key === '}') {
    const ls = v.lastIndexOf('\n', s - 1) + 1; const cur = v.slice(ls, s);
    if (/^[ \t]+$/.test(cur) && s === e) { ev.preventDefault(); edText.setSelectionRange(Math.max(ls, s - SET.indent), s); insertText('}'); }
    return;
  }
  if (SET.autoClose && !ctrl && !ev.altKey) {
    const a = analyse(); const inCode = !(s > 0 && a.mask[s - 1]);
    if (OPEN_CLOSE[ev.key] && inCode) {
      const nxt = v[e] || '';
      if (s !== e) { ev.preventDefault(); const sel = v.slice(s, e); insertText(ev.key + sel + OPEN_CLOSE[ev.key]); edText.setSelectionRange(s + 1, s + 1 + sel.length); return; }
      if (!nxt || /[\s)\];,]/.test(nxt)) { ev.preventDefault(); insertText(ev.key + OPEN_CLOSE[ev.key]); edText.setSelectionRange(s + 1, s + 1); return; }
    }
    if ((ev.key === ')' || ev.key === ']') && s === e && v[s] === ev.key) {
      const m = a.mask[s] ? -1 : WBEd.findMatch(v, a.mask, s);
      if (m >= 0) { ev.preventDefault(); edText.setSelectionRange(s + 1, s + 1); renderDeco(); return; }
    }
    if (ev.key === 'Backspace' && s === e && s > 0 && OPEN_CLOSE[v[s - 1]] === v[s]) { ev.preventDefault(); edText.setSelectionRange(s - 1, s + 1); deleteSel(); return; }
  }
});
$('edCompile').addEventListener('click', () => compileAll());
$('edClose').addEventListener('click', closeEditor);
$('edMenu').addEventListener('click', () => {
  if (!menuEl.hidden) { hideMenu(); return; }
  const r = $('edMenu').getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: 'Suchen …   Strg+F', plain: true, action: () => openFind(false) },
    { label: 'Suchen und Ersetzen …   Strg+H', plain: true, action: () => openFind(true) },
    { label: 'Gehe zu Zeile …   Strg+G', plain: true, action: gotoLineDialog },
    { sep: true },
    { label: 'Automatisch einrücken   Strg+Umschalt+F', plain: true, action: autoIndent },
    { label: 'Ein-/Auskommentieren   Strg+#', plain: true, action: toggleComment },
    { sep: true },
    { label: 'Schrift größer   Strg++', plain: true, action: () => changeFontSize(1) },
    { label: 'Schrift kleiner   Strg+−', plain: true, action: () => changeFontSize(-1) },
    { label: (SET.scopes ? 'Bereichsfärbung ausschalten' : 'Bereichsfärbung einschalten'), plain: true, action: () => { SET.scopes = !SET.scopes; applySettings(true); } },
  ]);
});

// ------------------------------------------------------------ Suchen und Ersetzen
const find = { open: false, q: '', qLen: 0, matches: [], cur: -1 };
const fdText = $('fdText'), fdRep = $('fdRep');
function computeMatches(keepNear) {
  const q = fdText.value; find.q = q; find.qLen = q.length; find.matches = [];
  if (q) {
    const cs = $('fdCase').checked; const hay = cs ? edText.value : edText.value.toLowerCase(); const needle = cs ? q : q.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(1, needle.length))) find.matches.push(i);
  }
  if (keepNear) { const s = edText.selectionStart; find.cur = find.matches.findIndex(p => p >= s); if (find.cur < 0) find.cur = find.matches.length ? 0 : -1; }
  else if (find.cur >= find.matches.length) find.cur = find.matches.length - 1;
  const n = find.matches.length;
  $('fdCount').textContent = !q ? '' : n ? `${find.cur + 1} von ${n}` : 'keine Treffer';
  fdText.classList.toggle('none', !!q && !n);
}
function selectMatch() {
  if (find.cur < 0) { renderDeco(); return; }
  const p = find.matches[find.cur]; edText.setSelectionRange(p, p + find.qLen); scrollToPos(p);
  $('fdCount').textContent = `${find.cur + 1} von ${find.matches.length}`; renderDeco();
}
function findStep(dir) {
  if (!find.matches.length) return;
  find.cur = (find.cur + dir + find.matches.length) % find.matches.length; selectMatch();
}
function openFind(withReplace) {
  if (!S.editing) return;
  const v = edText.value, s = edText.selectionStart, e = edText.selectionEnd;
  find.open = true; $('edFind').hidden = false;
  if (withReplace) $('fdRepRow').hidden = false;
  if (e > s && !v.slice(s, e).includes('\n')) fdText.value = v.slice(s, e);
  edText.setSelectionRange(s, s);
  computeMatches(true); selectMatch();
  (withReplace && fdText.value ? fdRep : fdText).focus(); (withReplace && fdText.value ? fdRep : fdText).select();
}
function closeFind(focusEditor) {
  if (!find.open) return;
  find.open = false; $('edFind').hidden = true; $('fdRepRow').hidden = true; renderDeco();
  if (focusEditor) { const p = find.cur >= 0 ? find.matches[find.cur] : null; edText.focus({ preventScroll: true }); if (p !== null && p !== undefined) edText.setSelectionRange(p, p + find.qLen); }
}
function replaceOne() {
  if (find.cur < 0) return;
  const p = find.matches[find.cur], rep = fdRep.value;
  edText.focus({ preventScroll: true }); edText.setSelectionRange(p, p + find.qLen); insertText(rep);
  computeMatches(false);
  find.cur = find.matches.findIndex(x => x >= p + rep.length); if (find.cur < 0) find.cur = find.matches.length ? 0 : -1;
  selectMatch(); fdRep.focus();
}
function replaceAll() {
  computeMatches(false); const n = find.matches.length; if (!n) return;
  const v = edText.value, rep = fdRep.value; let out = '', last = 0;
  for (const p of find.matches) { out += v.slice(last, p) + rep; last = p + find.qLen; }
  out += v.slice(last);
  const top = edText.scrollTop;
  edText.focus({ preventScroll: true }); edText.setSelectionRange(0, v.length); insertText(out); edText.setSelectionRange(0, 0); edText.scrollTop = top;
  computeMatches(true); renderDeco(); fdRep.focus();
  setStatus(`${n} ${n === 1 ? 'Stelle' : 'Stellen'} ersetzt. Strg+Z macht es rückgängig.`);
}
fdText.addEventListener('input', () => { computeMatches(true); selectMatch(); });
$('fdCase').addEventListener('change', () => { computeMatches(true); selectMatch(); });
for (const inp of [fdText, fdRep]) inp.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeFind(true); }
  else if (ev.key === 'Enter' && inp === fdText) { ev.preventDefault(); findStep(ev.shiftKey ? -1 : 1); }
  else if (ev.key === 'Enter' && inp === fdRep) { ev.preventDefault(); if (ctrl) replaceAll(); else replaceOne(); }
  else if (ev.key === 'F3') { ev.preventDefault(); findStep(ev.shiftKey ? -1 : 1); }
  else if (ctrl && (ev.key === 'h' || ev.key === 'r')) { ev.preventDefault(); $('fdRepRow').hidden = false; fdRep.focus(); }
  else if (ctrl && ev.key === 'f') { ev.preventDefault(); fdText.focus(); fdText.select(); }
});
$('fdNext').addEventListener('click', () => findStep(1));
$('fdPrev').addEventListener('click', () => findStep(-1));
$('fdClose').addEventListener('click', () => closeFind(true));
$('fdToggle').addEventListener('click', () => { const r = $('fdRepRow'); r.hidden = !r.hidden; (r.hidden ? fdText : fdRep).focus(); });
$('fdRepOne').addEventListener('click', replaceOne);
$('fdRepAll').addEventListener('click', replaceAll);

// ------------------------------------------------------------ Klassen anlegen/entfernen
function template(name, kind) {
  if (kind === 'interface') return `/**\n * Beschreibe hier das Interface ${name}.\n */\npublic interface ${name} {\n    /**\n     * Jede Klasse, die ${name} implementiert, muss diese Methode haben.\n     */\n    void beispielMethode();\n}\n`;
  if (kind === 'enum') return `/**\n * Aufzählung ${name}.\n */\npublic enum ${name} {\n    ERSTER, ZWEITER, DRITTER\n}\n`;
  if (kind === 'abstract') return `/**\n * Beschreibe hier die abstrakte Klasse ${name}.\n */\npublic abstract class ${name} {\n    protected String name;\n\n    public ${name}(String name) {\n        this.name = name;\n    }\n\n    /**\n     * Unterklassen müssen diese Methode implementieren.\n     */\n    public abstract void beispielMethode();\n}\n`;
  if (kind === 'main') return `/**\n * Klasse mit einer main-Methode zum Starten eines Programms.\n */\npublic class ${name} {\n    public static void main(String[] args) {\n        System.out.println("Hallo Welt!");\n        for (int i = 1; i <= 5; i++) {\n            System.out.println(i + " zum Quadrat ist " + i * i);\n        }\n    }\n}\n`;
  return `/**\n * Beschreibe hier die Klasse ${name}.\n *\n * @author (dein Name)\n */\npublic class ${name} {\n    // Attribute\n    private int x;\n\n    /**\n     * Konstruktor für Objekte der Klasse ${name}.\n     */\n    public ${name}() {\n        x = 0;\n    }\n\n    /**\n     * Ein Beispiel für eine Methode.\n     *\n     * @param y ein Parameter\n     * @return die Summe aus x und y\n     */\n    public int beispielMethode(int y) {\n        return x + y;\n    }\n}\n`;
}
function freeSpot() {
  const taken = S.project.classes;
  for (let row = 0; row < 30; row++) for (let col = 0; col < 6; col++) {
    const x = 40 + col * 200, y = 40 + row * 140;
    if (!taken.some(c => Math.abs(c.x - x) < 170 && Math.abs(c.y - y) < 100)) return { x, y };
  }
  return { x: 40, y: 40 };
}
function newClassDialog() {
  const form = document.createElement('form'); form.className = 'field';
  form.innerHTML = `<label for="ncName">Klassenname</label><input id="ncName" placeholder="z. B. Schueler" spellcheck="false" autocomplete="off">
    <label for="ncKind">Art</label><select id="ncKind"><option value="class">Klasse</option><option value="abstract">Abstrakte Klasse</option><option value="interface">Interface</option><option value="enum">Enum (Aufzählung)</option><option value="main">Klasse mit main-Methode</option></select>`;
  const err = document.createElement('div'); err.className = 'formerr'; err.hidden = true;
  const wrap = document.createElement('div'); wrap.style.display = 'contents'; wrap.append(form, err);
  const ok = (ctl) => {
    const name = form.querySelector('#ncName').value.trim(); const kind = form.querySelector('#ncKind').value;
    let msg = '';
    if (!/^[A-Za-z_$À-ɏ][\w$À-ɏ]*$/.test(name)) msg = 'Bitte einen gültigen Namen eingeben: Buchstaben, Ziffern und _, nicht mit einer Ziffer beginnen.';
    else if (classByName(name)) msg = `Die Klasse ${name} gibt es schon.`;
    else if (rt.builtinClasses.has(name)) msg = `${name} ist schon von Java belegt. Wähle einen anderen Namen.`;
    if (msg) { err.textContent = msg; err.hidden = false; return true; }
    const p = freeSpot();
    const c = { id: newId(), name, code: template(name, kind), x: p.x, y: p.y };
    S.project.classes.push(c); refreshInfo(c); S.status[c.id] = { dirty: true };
    save(); renderDiagram();
    if (!/^[A-ZÄÖÜ]/.test(name)) toast('Tipp: Klassennamen beginnen in Java mit einem Großbuchstaben.');
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); const ctl = modals[modals.length - 1]; if (ok(ctl) !== true) ctl.close(); });
  openModal({ title: 'Neue Klasse', body: wrap, actions: [{ label: 'Abbrechen' }, { label: 'Anlegen', primary: true, action: ok }] });
}
function removeClass(id) {
  if (S.editing === id) { S.editing = null; $('editorPane').hidden = true; }
  S.project.classes = S.project.classes.filter(c => c.id !== id);
  delete S.status[id]; delete S.info[id];
  for (const c of S.project.classes) S.status[c.id] = { ...(S.status[c.id] || {}), dirty: true };
  S.compiledOnce = false;
  save(); renderDiagram();
}

// ------------------------------------------------------------ Projekte
function loadProject(p, { benchFrom } = {}) {
  S.project = { id: p.id || ('p' + newId()), name: p.name, classes: p.classes.map(c => ({ id: c.id || newId(), name: c.name, code: c.code, x: c.x ?? 40, y: c.y ?? 40 })), files: (p.files || []).map(f => ({ ...f })) };
  preloadAssets();
  S.status = {}; S.info = {}; S.editing = null; $('editorPane').hidden = true;
  for (const c of S.project.classes) { refreshInfo(c); S.status[c.id] = { dirty: true }; }
  clearBench();
  $('projName').textContent = '· ' + p.name;
  save();
  const ok = compileAll({ silent: true });
  if (ok && benchFrom) {
    for (const b of benchFrom) { const r = rt.evalSnippet(b.expr, S.padEnv); if (r.ok && r.value) addBench(b.name, r.value); }
    flushOutput();
  }
  renderDiagram(); renderBench();
}
function projectMenu() {
  const r = $('btnProject').getBoundingClientRect();
  const items = [{ header: 'Projekte' }];
  items.push({ label: 'Meine Projekte öffnen …', plain: true, action: libraryDialog });
  items.push({ label: 'Neues leeres Projekt', plain: true, action: () => { syncEditor(); save(); newProjectDialog(); } });
  items.push({ label: 'Projekt umbenennen', plain: true, action: renameProjectDialog });
  items.push({ label: 'Kopie speichern unter …', plain: true, action: saveAsDialog });
  items.push({ header: 'Datei' });
  items.push({ label: 'Als ZIP herunterladen', plain: true, action: exportZip });
  items.push({ label: 'ZIP- oder .java-Dateien importieren …', plain: true, action: () => $('fileInput').click() });
  items.push({ label: 'Quelltext anzeigen (kopieren)', plain: true, action: exportDialog });
  items.push({ label: `Bilder und Klänge … ${S.project.files && S.project.files.length ? '(' + S.project.files.length + ')' : ''}`, plain: true, action: assetsDialog });
  items.push({ header: 'Beispiel öffnen' });
  for (const ex of window.WB_EXAMPLES) items.push({ label: ex.name, plain: true, action: () => { syncEditor(); save(); loadProject({ ...ex, name: uniqueProjectName(ex.name), classes: ex.classes.map(c => ({ ...c })) }, { benchFrom: ex.bench }); toast(`Beispiel „${ex.name}“ geöffnet. Dein vorheriges Projekt liegt unter „Meine Projekte“.`); } });
  showMenu(r.left, r.bottom + 4, items);
}
function renameProjectDialog() {
  const form = document.createElement('form'); form.className = 'field';
  form.innerHTML = '<label for="pjName">Projektname</label><input id="pjName" autocomplete="off">';
  form.querySelector('input').value = S.project.name;
  const ok = () => { const v = form.querySelector('input').value.trim(); if (v) { S.project.name = v; $('projName').textContent = '· ' + v; save(); } };
  form.addEventListener('submit', (e) => { e.preventDefault(); ok(); modals[modals.length - 1].close(); });
  openModal({ title: 'Projekt umbenennen', body: form, actions: [{ label: 'Abbrechen' }, { label: 'Speichern', primary: true, action: ok }] });
}
function exportDialog() {
  syncEditor();
  const ta = document.createElement('textarea'); ta.className = 'export'; ta.readOnly = true; ta.id = 'exportText';
  ta.value = S.project.classes.map(c => `// ===== ${c.name}.java =====\n${c.code.trimEnd()}\n`).join('\n');
  const p = document.createElement('p'); p.className = 'doc'; p.style.margin = '0';
  p.textContent = 'Jede Klasse gehört in eine eigene Datei mit dem Klassennamen, z. B. Konto.java. Über „.java-Dateien importieren“ kannst du sie später wieder laden.';
  const wrap = document.createElement('div'); wrap.style.display = 'contents'; wrap.append(p, ta);
  openModal({ title: 'Quelltext exportieren', body: wrap, wide: true, actions: [{ label: 'Schließen' }, { label: 'Alles kopieren', primary: true, action: () => {
    navigator.clipboard.writeText(ta.value).then(() => toast('In die Zwischenablage kopiert.'), () => { ta.focus(); ta.select(); toast('Text markiert – jetzt mit Strg+C kopieren.'); });
    return true;
  } }] });
}
// ---- Mehrere Projekte im Browser
function uniqueProjectName(base) {
  const names = new Set(Object.values(readLib().projects).map(p => p.name));
  if (!names.has(base)) return base;
  let i = 2; while (names.has(`${base} (${i})`)) i++; return `${base} (${i})`;
}
function newProjectDialog() {
  const form = document.createElement('form'); form.className = 'field';
  form.innerHTML = '<label for="npName">Projektname</label><input id="npName" autocomplete="off">';
  form.querySelector('input').value = uniqueProjectName('Neues Projekt');
  const ok = () => { const v = form.querySelector('input').value.trim() || 'Neues Projekt'; loadProject({ name: uniqueProjectName(v), classes: [] }); toast('Neues Projekt angelegt. Das vorherige liegt unter „Meine Projekte“.'); };
  form.addEventListener('submit', (e) => { e.preventDefault(); ok(); modals[modals.length - 1].close(); });
  openModal({ title: 'Neues Projekt', body: form, actions: [{ label: 'Abbrechen' }, { label: 'Anlegen', primary: true, action: ok }] });
}
function saveAsDialog() {
  syncEditor(); save();
  const form = document.createElement('form'); form.className = 'field';
  form.innerHTML = '<label for="saName">Name der Kopie</label><input id="saName" autocomplete="off">';
  form.querySelector('input').value = uniqueProjectName(S.project.name + ' Kopie');
  const ok = () => { const v = form.querySelector('input').value.trim(); if (!v) return true; const d = projectData(); loadProject({ name: uniqueProjectName(v), classes: d.classes.map(c => ({ ...c, id: undefined })), files: d.files }); toast(`Kopie „${S.project.name}“ gespeichert und geöffnet.`); };
  form.addEventListener('submit', (e) => { e.preventDefault(); if (ok() !== true) modals[modals.length - 1].close(); });
  openModal({ title: 'Kopie speichern unter', body: form, actions: [{ label: 'Abbrechen' }, { label: 'Speichern', primary: true, action: ok }] });
}
function libraryDialog() {
  syncEditor(); save();
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  const p = document.createElement('p'); p.className = 'doc'; p.style.margin = '0';
  p.textContent = 'Projekte werden automatisch in diesem Browser gespeichert. Zum Sichern oder Weitergeben „Als ZIP herunterladen“ verwenden.';
  const list = document.createElement('div'); list.className = 'plist';
  wrap.append(p, list);
  let ctl;
  const render = () => {
    const projects = Object.values(readLib().projects).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    list.innerHTML = '';
    for (const pr of projects) {
      const row = document.createElement('div'); row.className = 'prow' + (pr.id === S.project.id ? ' current' : '');
      const when = pr.savedAt ? new Date(pr.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const nf = (pr.files || []).length;
      row.innerHTML = `<div class="pinfo"><b>${esc(pr.name)}</b><span>${pr.classes.length} Klasse${pr.classes.length === 1 ? '' : 'n'}${nf ? ` · ${nf} Datei${nf === 1 ? '' : 'en'}` : ''} · ${esc(when)}${pr.id === S.project.id ? ' · geöffnet' : ''}</span></div>`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'btn small' + (pr.id === S.project.id ? '' : ' primary'); open.textContent = 'Öffnen';
      open.disabled = pr.id === S.project.id;
      open.addEventListener('click', () => { ctl.close(); loadProject(pr); toast(`Projekt „${pr.name}“ geöffnet.`); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small ghost'; del.textContent = 'Löschen';
      del.addEventListener('click', () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Wirklich löschen?'; del.style.color = 'var(--err)'; return; }
        const l = readLib(); delete l.projects[pr.id]; writeLib(l);
        if (pr.id === S.project.id) { const rest = Object.values(l.projects).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); if (rest.length) loadProject(rest[0]); else loadProject({ name: 'Neues Projekt', classes: [] }); }
        render();
      });
      row.append(open, del); list.appendChild(row);
    }
  };
  render();
  ctl = openModal({ title: 'Meine Projekte', body: wrap, wide: true, actions: [{ label: 'Neues Projekt', action: () => { newProjectDialog(); } }, { label: 'Schließen', primary: true }] });
}

// ---- Bilder und Klänge im Projekt (als data:-URL gespeichert, im ZIP als Dateien)
const IMG_EXT = /\.(png|gif|jpe?g|bmp|webp|svg)$/i, SND_EXT = /\.(wav|mp3|ogg|oga|m4a|aac|flac)$/i;
const assetKind = (n) => IMG_EXT.test(n) ? 'image' : SND_EXT.test(n) ? 'audio' : null;
function mimeOf(n) {
  const e = n.split('.').pop().toLowerCase();
  return { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }[e] || 'application/octet-stream';
}
const normPath = (n) => String(n).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').toLowerCase();
// Sucht eine Datei wie Java relativ zum Projektordner; der Ordner darf auch fehlen ("sprites/ball.gif" findet "ball.gif")
function findAsset(name) {
  const files = (S.project && S.project.files) || []; if (!files.length) return null;
  const n = normPath(name), base = n.split('/').pop();
  const f = files.find(x => normPath(x.name) === n) || files.find(x => normPath(x.name).split('/').pop() === base);
  return f ? { kind: assetKind(f.name), url: f.data, w: f.w || 0, h: f.h || 0, name: f.name } : null;
}
function preloadAssets() { for (const f of (S.project && S.project.files) || []) if (assetKind(f.name) === 'image' && gfx.image) gfx.image(f.data); }
function imageSize(url) { return new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 0, h: 0 }); im.src = url; }); }
async function assetFromData(name, data) {
  const f = { name, data, size: Math.round((data.length - data.indexOf(',') - 1) * 0.75) };
  if (assetKind(name) === 'image') Object.assign(f, await imageSize(data));
  return f;
}
const readDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
const MAX_ASSET = 2 * 1024 * 1024;
async function addAssetFiles(list) {
  let n = 0;
  for (const file of list) {
    if (!assetKind(file.name)) { toast(`„${file.name}“ ist kein Bild oder Klang (png, gif, jpg, wav, mp3, ogg …).`, true); continue; }
    if (file.size > MAX_ASSET) { toast(`„${file.name}“ ist zu groß (${Math.round(file.size / 1024)} KB, höchstens 2 MB). Bitte verkleinern.`, true); continue; }
    let data; try { data = await readDataUrl(file); } catch (e) { toast(`„${file.name}“ konnte nicht gelesen werden.`, true); continue; }
    if (!data.startsWith('data:' + mimeOf(file.name))) data = 'data:' + mimeOf(file.name) + data.slice(data.indexOf(';'));
    const f = await assetFromData(file.name, data);
    const files = S.project.files || (S.project.files = []);
    const i = files.findIndex(x => x.name.toLowerCase() === file.name.toLowerCase());
    if (i >= 0) files[i] = f; else files.push(f);
    n++;
  }
  if (n) { preloadAssets(); if (save()) toast(`${n} Datei${n === 1 ? '' : 'en'} zum Projekt hinzugefügt.`); }
  return n;
}
function assetsDialog() {
  const wrap = document.createElement('div'); wrap.style.display = 'contents';
  const p = document.createElement('p'); p.className = 'doc'; p.style.margin = '0';
  p.innerHTML = 'Bilder und Klänge werden mit dem Projekt gespeichert und im ZIP mitexportiert. Im Programm nennst du sie beim Dateinamen, z. B. <code>p.image("ball.png", 0.5, 0.5)</code>, <code>new Turtle("hase.gif")</code> oder <code>new SoundPlayer("ton.wav").play()</code>.';
  const list = document.createElement('div'); list.className = 'plist';
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,audio/*,.wav,.mp3,.ogg,.gif,.png,.jpg'; inp.multiple = true; inp.hidden = true;
  inp.addEventListener('change', async () => { const fs = [...inp.files]; inp.value = ''; await addAssetFiles(fs); render(); });
  wrap.append(p, list, inp);
  const render = () => {
    const files = S.project.files || [];
    list.innerHTML = '';
    if (!files.length) { const e = document.createElement('div'); e.className = 'prow'; e.innerHTML = '<div class="pinfo"><span>Noch keine Dateien. Mit „Datei hinzufügen …“ wählst du Bilder (png, gif, jpg) oder Klänge (wav, mp3, ogg) aus.</span></div>'; list.appendChild(e); }
    for (const f of files) {
      const row = document.createElement('div'); row.className = 'prow';
      const kind = assetKind(f.name);
      const prev = document.createElement(kind === 'image' ? 'img' : 'button');
      if (kind === 'image') { prev.src = f.data; prev.alt = ''; prev.className = 'athumb'; }
      else { prev.type = 'button'; prev.className = 'btn small'; prev.textContent = '▶'; prev.title = 'Anhören'; prev.setAttribute('aria-label', 'Anhören'); prev.addEventListener('click', () => { const a = new Audio(f.data); a.play().catch(() => { }); }); }
      const info = document.createElement('div'); info.className = 'pinfo';
      info.innerHTML = `<b>${esc(f.name)}</b><span>${kind === 'image' ? `Bild ${f.w || '?'} × ${f.h || '?'} px` : 'Klang'} · ${Math.max(1, Math.round((f.size || 0) / 1024))} KB</span>`;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small ghost'; del.textContent = 'Löschen';
      del.addEventListener('click', () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Wirklich löschen?'; del.style.color = 'var(--err)'; return; }
        S.project.files = files.filter(x => x !== f); save(); render();
      });
      row.append(prev, info, del); list.appendChild(row);
    }
  };
  render();
  openModal({ title: 'Bilder und Klänge im Projekt', body: wrap, wide: true, actions: [{ label: 'Datei hinzufügen …', action: () => { inp.click(); return true; } }, { label: 'Schließen', primary: true }] });
}

// ---- ZIP (BlueJ-kompatibel: .java-Dateien + package.bluej)
function zipLib() { if (!window.JSZip) { toast('ZIP-Funktion konnte nicht geladen werden (Internetverbindung?).', true); return null; } return window.JSZip; }
function safeFileName(s) { return (s || 'Projekt').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt'; }
function packageBluej() {
  const typeOf = (c) => { const i = S.info[c.id] || {}; return i.kind === 'interface' ? 'InterfaceTarget' : i.kind === 'enum' ? 'EnumTarget' : i.abstract ? 'AbstractTarget' : 'ClassTarget'; };
  const lines = ['#BlueJ package file', '#Erstellt mit der Java-Werkbank', 'package.editor.height=600', 'package.editor.width=900', 'package.numDependencies=0', `package.numTargets=${S.project.classes.length}`, 'package.showExtends=true', 'package.showUses=true'];
  S.project.classes.forEach((c, i) => {
    const n = i + 1;
    lines.push(`target${n}.height=${BOX_H}`, `target${n}.name=${c.name}`, `target${n}.showInterface=false`, `target${n}.type=${typeOf(c)}`, `target${n}.width=${BOX_W}`, `target${n}.x=${Math.round(c.x)}`, `target${n}.y=${Math.round(c.y)}`);
  });
  return lines.join('\n') + '\n';
}
async function exportZip() {
  syncEditor(); save();
  const Z = zipLib(); if (!Z) return;
  const zip = new Z(); const dir = safeFileName(S.project.name);
  const folder = zip.folder(dir);
  for (const c of S.project.classes) folder.file(`${c.name}.java`, c.code);
  for (const f of S.project.files || []) { const i = f.data.indexOf(','); folder.file(f.name, f.data.slice(i + 1), { base64: true }); }
  folder.file('package.bluej', packageBluej());
  folder.file('README.TXT', `Projekt: ${S.project.name}\nErstellt mit der Java-Werkbank (WebBlueJ).\nDiese ZIP-Datei kann in der Java-Werkbank über „Projekt ▾ → ZIP- oder .java-Dateien importieren“ wieder geöffnet werden.\nDer Ordner lässt sich nach dem Entpacken auch in BlueJ öffnen.\n`);
  try {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = dir + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`„${dir}.zip“ wird heruntergeladen.`);
  } catch (e) { toast('ZIP konnte nicht erstellt werden: ' + e.message, true); }
}
function parseBluej(text) {
  const props = {}; for (const line of text.split(/\r?\n/)) { const m = /^([^#=][^=]*)=(.*)$/.exec(line.trim()); if (m) props[m[1].trim()] = m[2].trim(); }
  const pos = {};
  for (const k of Object.keys(props)) { const m = /^target(\d+)\.name$/.exec(k); if (m) { const x = parseInt(props[`target${m[1]}.x`]), y = parseInt(props[`target${m[1]}.y`]); if (!isNaN(x) && !isNaN(y)) pos[props[k]] = { x, y }; } }
  return pos;
}
async function importZip(file) {
  const Z = zipLib(); if (!Z) return;
  let zip;
  try { zip = await Z.loadAsync(file); } catch (e) { toast(`„${file.name}“ ist keine gültige ZIP-Datei.`, true); return; }
  const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)__MACOSX\//.test(f.name) && !/(^|\/)\./.test(f.name.split('/').pop()));
  const javas = entries.filter(f => /\.java$/i.test(f.name));
  if (!javas.length) { toast(`In „${file.name}“ wurden keine .java-Dateien gefunden.`, true); return; }
  const dirOf = (n) => n.includes('/') ? n.slice(0, n.lastIndexOf('/') + 1) : '';
  const bluejs = entries.filter(f => /(^|\/)package\.bluej$/i.test(f.name)).sort((a, b) => a.name.length - b.name.length);
  let root = bluejs.length ? dirOf(bluejs[0].name) : null;
  if (root === null) { const counts = {}; for (const j of javas) counts[dirOf(j.name)] = (counts[dirOf(j.name)] || 0) + 1; root = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.length - b.length)[0]; }
  const pos = bluejs.length ? parseBluej(await bluejs[0].async('string')) : {};
  const chosen = javas.filter(j => j.name.startsWith(root));
  const skipped = javas.length - chosen.length;
  const classes = [];
  let i = 0;
  for (const j of chosen) {
    const code = (await j.async('string')).replace(/^\uFEFF/, '');
    const info = quickInfo(code); const name = info.name || j.name.split('/').pop().replace(/\.java$/i, '');
    if (classes.some(c => c.name === name)) continue;
    const p = pos[name] || { x: 40 + (i % 4) * 200, y: 40 + Math.floor(i / 4) * 140 };
    classes.push({ name, code, x: Math.max(0, p.x), y: Math.max(0, p.y) }); i++;
  }
  const files = [];
  for (const e of entries.filter(f => f.name.startsWith(root) && assetKind(f.name))) {
    const nm = e.name.slice(root.length);
    if (files.some(f => f.name === nm)) continue;
    files.push(await assetFromData(nm, `data:${mimeOf(nm)};base64,` + await e.async('base64')));
  }
  const folderName = root.replace(/\/$/, '').split('/').pop();
  const name = uniqueProjectName(folderName || file.name.replace(/\.zip$/i, ''));
  syncEditor(); save();
  loadProject({ name, classes, files });
  toast(`Projekt „${name}“ mit ${classes.length} Klasse${classes.length === 1 ? '' : 'n'}${files.length ? ` und ${files.length} Bild-/Klangdatei${files.length === 1 ? '' : 'en'}` : ''} importiert.` + (skipped ? ` ${skipped} Datei(en) aus Unterordnern wurden übersprungen.` : ''));
  if (!S.compiledOnce && classes.length) toast('Hinweis: Das Projekt enthält Fehler oder nicht unterstützte Java-Teile. Klicke auf „Übersetzen“, um sie zu sehen.', true);
}

$('fileInput').addEventListener('change', async (ev) => {
  const all = [...ev.target.files]; ev.target.value = '';
  for (const z of all.filter(f => /\.zip$/i.test(f.name))) await importZip(z);
  const media = all.filter(f => assetKind(f.name));
  if (media.length) await addAssetFiles(media);
  const files = all.filter(f => !/\.zip$/i.test(f.name) && !assetKind(f.name));
  let added = 0;
  for (const f of files) {
    const code = await f.text();
    const info = quickInfo(code); const name = info.name || f.name.replace(/\.java$/i, '');
    const existing = classByName(name);
    if (existing) { existing.code = code; refreshInfo(existing); S.status[existing.id] = { dirty: true }; }
    else { const p = freeSpot(); const c = { id: newId(), name, code, x: p.x, y: p.y }; S.project.classes.push(c); refreshInfo(c); S.status[c.id] = { dirty: true }; }
    added++;
  }
  if (added) { save(); compileAll({ silent: true }); renderDiagram(); toast(`${added} Datei(en) importiert.`); }
});

function helpDialog() {
  const d = document.createElement('div'); d.className = 'helpgrid';
  d.innerHTML = `<p><b>Klassendiagramm:</b> Klick auf eine Klasse öffnet ihr Menü (Objekte erzeugen, statische Methoden aufrufen). Doppelklick öffnet den Quelltext. Klassen lassen sich verschieben.</p>
  <p><b>Übersetzen:</b> Nach jeder Änderung neu übersetzen (Knopf oder <code>Strg+S</code> im Editor). Schraffierte Klassen sind noch nicht übersetzt. Fehler werden mit Zeile im Editor markiert.</p>
  <p><b>Editor:</b> Farbige Bereiche zeigen die Struktur (Klasse grün, Methode gelb, Schleife blau, Verzweigung rosa). Steht der Cursor an einer Klammer, wird die passende Klammer markiert. Über „Bearbeiten ▾“ oder Tastenkürzel: <code>Strg+F</code> Suchen, <code>Strg+H</code> Ersetzen, <code>Strg+G</code> Gehe zu Zeile, <code>Strg+Umschalt+F</code> automatisch einrücken, <code>Strg+#</code> ein-/auskommentieren, <code>Strg</code> + <code>+</code>/<code>−</code> Schriftgröße. Weitere Einstellungen (Beamer-Schrift, dunkles Design) unter ⚙.</p>
  <p><b>Objektleiste:</b> Erzeugte Objekte erscheinen unten. Klick darauf zeigt die Methoden, „Inspizieren“ zeigt die Attributwerte.</p>
  <p><b>Direkteingabe:</b> Java-Ausdrücke direkt ausprobieren, z. B. <code>konto1.getKontostand()</code> oder <code>int x = 6 * 7;</code>. Objekte der Objektleiste stehen dort mit ihrem Namen zur Verfügung.</p>
  <p><b>Unterstützt:</b> Klassen, Vererbung, abstrakte Klassen, Interfaces, enums, Arrays, Strings, <code>ArrayList</code>, <code>HashMap</code>, <code>Random</code>, <code>Math</code>, Ausnahmen mit try/catch, switch, Schleifen. Eingaben mit <code>Scanner</code> erscheinen als Eingabedialog. Nicht unterstützt: Lambdas, innere Klassen.</p>
  <p><b>Grafik:</b> Mit <code>import ch.aplu.turtle.*;</code> zeichnest du mit <code>Turtle</code> (auch <code>extends Turtle</code>), mit <code>import ch.aplu.util.*;</code> stehen <code>GPanel</code>, <code>Console</code>, <code>InputDialog</code> und <code>MessageDialog</code> bereit. Die Bilder erscheinen in eigenen Fenstern; ⏩ überspringt die Animation. <code>Thread.sleep</code>, <code>delay</code> und Endlos-Animationen laufen live.</p>
  <p><b>Maus und Tastatur:</b> Klicke in ein Grafikfenster, damit es die Tasten bekommt. Abfragen ohne Listener: <code>p.kbhit()</code>, <code>p.getKey()</code>, <code>p.getKeyCode()</code>, <code>p.getKeyCodeWait()</code> (bei Turtles über <code>TurtleFrame</code>). Listener wie in Java: eine Klasse schreibt <code>implements MouseListener</code> (oder <code>KeyListener</code>, <code>MouseMotionListener</code>, <code>MouseHitListener</code>) bzw. <code>extends MouseAdapter</code> und meldet sich mit <code>p.addMouseListener(this)</code> an. <code>Monitor.putSleep()</code> wartet, bis ein Ereignis <code>Monitor.wakeUp()</code> aufruft.</p>
  <p><b>Bilder und Klänge:</b> Über „Projekt ▾ → Bilder und Klänge …“ kommen Dateien ins Projekt (auch im ZIP). Dann z. B. <code>p.image("ball.png", x, y)</code>, <code>new Turtle("hase.gif")</code>, <code>t.drawImage("stern.png")</code>, Töne mit <code>t.sound(440, 500)</code> oder <code>SoundPlayer.playSine(440, 500)</code>, Klangdateien mit <code>new SoundPlayer("ton.wav").play()</code>.</p>
  <p><b>Laufende Programme:</b> Dauert ein Aufruf länger, erscheint oben „Programm läuft …“. Die Oberfläche bleibt bedienbar, die Ausgabe erscheint sofort. Mit <b>■ Beenden</b> brichst du das Programm ab, z. B. bei einer Endlosschleife.</p>
  <p><b>Speichern:</b> Alle Projekte werden automatisch in diesem Browser gespeichert („Projekt ▾ → Meine Projekte“). Zum Sichern, Weitergeben oder für BlueJ: „Projekt ▾ → Als ZIP herunterladen“. ZIP-Dateien (auch BlueJ-Projektordner) öffnest du mit „ZIP- oder .java-Dateien importieren“.</p>`;
  openModal({ title: 'So funktioniert die Java-Werkbank', body: d, wide: true, actions: [{ label: 'Alles klar', primary: true }] });
}

// ------------------------------------------------------------ Direkteingabe
const padLog = $('padLog'); const padHist = []; let padPos = 0;
function padWrite(text, cls, value) {
  const line = document.createElement('div'); if (cls) line.className = cls; line.textContent = text;
  if (value && rt.isRef(value)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-ref'; b.textContent = 'inspizieren';
    b.addEventListener('click', () => inspectorModal(rt.inspect(value), value, rt.typeNameOf(value)));
    const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'chip-ref'; b2.textContent = 'auf Objektleiste';
    b2.addEventListener('click', () => addBench(nextObjName(value instanceof JObject ? value.cls.name : 'array'), value));
    line.append(b, b2);
  }
  padLog.appendChild(line); padLog.scrollTop = padLog.scrollHeight;
}
$('padForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('padInput'); const code = inp.value; if (!code.trim()) return;
  if (rt.running) { busyNote(); return; }
  padHist.push(code); padPos = padHist.length; inp.value = '';
  padWrite('> ' + code, 'in');
  if (!S.compiledOnce && S.project.classes.length) padWrite('Hinweis: Das Projekt ist nicht übersetzt – eigene Klassen sind erst nach dem Übersetzen verfügbar.', 'note');
  const padOut = () => { if (outBuf.length) { const txt = outBuf.map(o => o.s).join(''); outBuf.length = 0; padWrite(txt.replace(/\n$/, ''), null); } };
  const env = S.padEnv;
  runProgram(null, { snippet: code, env, liveOut: padOut }).then((r) => {
    if (!r) return;
    padOut();
    if (r.stopped) { padWrite('[beendet]', 'note'); return; }
    padResult(r);
  });
});
function padResult(r) {
  if (!r.ok) { padWrite((r.exception ? 'Exception: ' : 'Fehler: ') + r.message + (r.trace && r.trace.length ? `  (bei ${r.trace[0].cls}.${r.trace[0].method}, Zeile ${r.trace[0].line})` : ''), 'err'); return; }
  if (r.hasValue) padWrite(rt.isRef(r.value) ? `<${rt.typeNameOf(r.value)}-Objekt>   ${safeStr(r.value)}` : `${rt.displayValue(r.value)}   (${rt.typeNameOf(r.value)})`, 'val', r.value);
}
function safeStr(v) { const r = rt.run(() => rt.str(v)); outBuf.length = 0; return r.ok ? r.value : ''; }
$('padInput').addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowUp' && padPos > 0) { padPos--; ev.target.value = padHist[padPos]; ev.preventDefault(); }
  else if (ev.key === 'ArrowDown') { padPos = Math.min(padHist.length, padPos + 1); ev.target.value = padHist[padPos] || ''; ev.preventDefault(); }
});

// ------------------------------------------------------------ Verdrahtung
$('btnNewClass').addEventListener('click', newClassDialog);
$('btnStop').addEventListener('click', stopProgram);
$('btnCompile').addEventListener('click', () => compileAll());
$('btnProject').addEventListener('click', () => { if (!menuEl.hidden) { hideMenu(); return; } projectMenu(); });
$('btnHelp').addEventListener('click', helpDialog);
$('btnSettings').addEventListener('click', settingsDialog);
$('btnClearBench').addEventListener('click', clearBench);
$('btnClearConsole').addEventListener('click', () => { if ($('pad').hidden) consoleEl.innerHTML = ''; else padLog.innerHTML = ''; });
$('tabConsole').addEventListener('click', () => showTab('console'));
$('tabPad').addEventListener('click', () => showTab('pad'));
$('diagram').addEventListener('pointerdown', (ev) => { if (ev.target.closest('.cbox')) return; selectClass(null); });
window.addEventListener('resize', hideMenu);

// ------------------------------------------------------------ Start
let saved = loadSaved();
{ const l = readLib(); if (l.current && l.projects[l.current]) saved = l.projects[l.current]; }
if (saved && saved.classes.length) loadProject(saved);
else { const ex = window.WB_EXAMPLES[0]; loadProject(ex, { benchFrom: ex.bench }); }
writeConsole('Willkommen! Klicke im Diagramm auf eine Klasse, um Objekte zu erzeugen oder Methoden aufzurufen.\n', 'note');
padWrite('Hier kannst du Java direkt ausprobieren. Pfeiltasten ↑/↓ holen frühere Eingaben zurück.', 'note');
renderBench();
})();
