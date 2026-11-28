/* Java-Werkbank – Interpreter für eine Java-Teilmenge (Schulstoff) */
(function (global) {
'use strict';

// ---------------------------------------------------------------- Grundlagen
class JavaError extends Error {
  constructor(message, line, kind, className) { super(message); this.line = line || 0; this.kind = kind || 'compile'; this.className = className || null; }
}
class JThrow { constructor(obj, trace) { this.obj = obj; this.trace = trace; } }
class ExitSig { constructor(code) { this.code = code; } }
const BREAK = { sig: 'break' }, CONTINUE = { sig: 'continue' };
class ReturnSig { constructor(v) { this.value = v; } }
class YieldSig { constructor(v) { this.value = v; } }

// ---------------------------------------------------------------- Unterbrechbare Ausführung
// Anweisungen und Ausdrücke mit Methodenaufrufen laufen als Generator-Funktionen.
// Sie geben mit `yield TICK` regelmäßig die Kontrolle ab (Zeitscheiben) und mit
// `yield new Suspend(…)` warten sie auf etwas Äußeres (Eingabe, Thread.sleep).
// Ausdrücke ohne Aufrufe werden weiterhin direkt (synchron) und damit schnell berechnet.
const TICK = { tick: true }, NOFAST = { nofast: true };
class Suspend {
  // start(rt) → Promise mit dem Ergebnis (normaler Lauf);
  // sync(rt) → Ergebnis sofort (verschachtelter Lauf, z. B. toString() in einer Ausgabe)
  constructor(start, sync) { this.start = start; this.sync = sync; }
}
// Eingebaute Methode, die eigenen Code aufruft (z. B. forEach mit einem Lambda): Der
// Generator g wird an der Aufrufstelle mit yield* ausgeführt (unterbrechbar).
class Delegate extends Suspend { constructor(g) { super(() => Promise.reject(new Error('Delegate')), (rt) => rt.runSync(g)); this.g = g; } }
// Enthält ein Ausdruck keinen Aufruf von eigenem Java-Code, ist er „rein“ und wird
// ohne Generator ausgewertet. Aufrufstellen, die bisher immer bei einer eingebauten
// Methode landeten (z. B. s.length(), Math.random()), gelten als rein (e.$n === true).
// Das Ergebnis wird am Knoten gemerkt; lernt eine Aufrufstelle dazu, wird pureEpoch
// erhöht und alle Merker werden beim nächsten Zugriff neu berechnet.
let pureEpoch = 1;
function isPure(e) {
  if (e.$pe === pureEpoch) return e.$p;
  e.$pe = pureEpoch;
  return (e.$p = computePure(e));
}
function computePure(e) {
  if (e.k === 'New' || e.k === 'CtorCall') return false;
  if (e.k === 'Lambda') return true;
  if (e.k === 'SwitchExpr') return false;
  if (e.k === 'MethodRef') return isPure(e.target);
  if (e.k === 'Call' && e.$n !== true) return false;
  for (const key in e) {
    if (key === 'type' || key === 'elem' || key === 'line' || key[0] === '$') continue;
    const v = e[key];
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object' && x.k && !isPure(x)) return false; }
    else if (v.k && !isPure(v)) return false;
  }
  return true;
}
const allPure = (list) => { for (const x of list) if (!isPure(x)) return false; return true; };

class JDouble { constructor(v) { this.v = v; } }
class JChar { constructor(c) { this.c = c; } }
let nextId = 1;
class JObject { constructor(cls) { this.cls = cls; this.fields = Object.create(null); this.id = nextId++; this.native = null; } }
class JArray { constructor(elemType, data) { this.elemType = elemType; this.data = data; this.id = nextId++; } }
class JClassRef { constructor(cls) { this.cls = cls; } }
const UNINIT = { uninit: true };

const PRIMS = new Set(['int', 'double', 'boolean', 'char', 'long', 'float', 'short', 'byte']);
const INTLIKE = new Set(['int', 'short', 'byte']);
const WRAP = { Integer: 'int', Double: 'double', Boolean: 'boolean', Character: 'char', Long: 'long', Float: 'float', Short: 'short', Byte: 'byte' };
const T = (name, dims = 0, args = null) => ({ name, dims, args });
const INT = T('int'), DOUBLE = T('double'), BOOL = T('boolean'), CHAR = T('char'), LONG = T('long'), STRING = T('String'), VOID = T('void');

function typeStr(t) {
  if (!t) return '?';
  let s = t.name;
  if (t.args && t.args.length) s += '<' + t.args.map(typeStr).join(', ') + '>';
  for (let i = 0; i < t.dims; i++) s += '[]';
  return s;
}
function defaultValue(t) {
  if (!t || t.dims > 0) return null;
  switch (t.name) {
    case 'int': case 'short': case 'byte': return 0;
    case 'long': return 0n;
    case 'double': case 'float': return new JDouble(0);
    case 'boolean': return false;
    case 'char': return new JChar(0);
    default: return null;
  }
}
function fmtDouble(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return (1 / x < 0) ? '-0.0' : '0.0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) { let s = String(x); if (!s.includes('.') && !s.includes('e')) s += '.0'; return s; }
  let [m, ex] = x.toExponential().split('e');
  if (!m.includes('.')) m += '.0';
  return m + 'E' + (+ex);
}
function idHash(id) { return ((Math.imul(id + 7919, 0x9E3779B1) >>> 0) % 0x7fffffff).toString(16); }
function strHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
function cmpStr(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; } return a.length - b.length; }
function levenshtein(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function suggest(name, cands) {
  let best = null, bd = 3;
  for (const c of cands) {
    if (c === name) continue;
    const d = c.toLowerCase() === name.toLowerCase() ? 0 : levenshtein(name, c);
    if (d < bd && (d <= 1 || name.length > 3)) { bd = d; best = c; }
  }
  return best ? ` (meinten Sie '${best}'?)` : '';
}

// ---------------------------------------------------------------- Lexer
const KW = new Set(('abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false').split(' '));
const OPS = ['<<=', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<'];

function lex(src) {
  const toks = [], docs = {};
  let i = 0, line = 1; const n = src.length;
  const err = (m) => { throw new JavaError(m, line); };
  const idStart = /[A-Za-z_$À-ɏ]/, idPart = /[\w$À-ɏ]/;
  function readEscape() {
    const e = src[i + 1]; i += 2;
    switch (e) {
      case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r'; case 'b': return '\b'; case 'f': return '\f';
      case '0': return '\0'; case '"': return '"'; case "'": return "'"; case '\\': return '\\'; case 's': return ' ';
      case 'u': { while (src[i] === 'u') i++; const h = src.slice(i, i + 4); i += 4; if (!/^[0-9a-fA-F]{4}$/.test(h)) err('Ungültige Unicode-Escape-Sequenz'); return String.fromCharCode(parseInt(h, 16)); }
      default: err('Ungültige Escape-Sequenz: \\' + (e || ''));
    }
  }
  // Textblock """ … """ (Java 15): gemeinsame Einrückung und Leerzeichen am Zeilenende entfernen
  function textBlock(start, sl) {
    i += 3;
    while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i++;
    if (src[i] !== '\n') err('Nach """ muss der Text in einer neuen Zeile beginnen (Textblock)');
    i++; line++;
    const cs = i; let end = -1;
    while (i < n) {
      if (src[i] === '\\') { if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (src.startsWith('"""', i)) { end = i; break; }
      if (src[i] === '\n') line++;
      i++;
    }
    if (end < 0) { line = sl; err('Textblock wird nicht geschlossen: """ fehlt'); }
    i = end + 3;
    const lines = src.slice(cs, end).replace(/\r/g, '').split('\n');
    const lastOwn = /^[ \t]*$/.test(lines[lines.length - 1]);
    const ind = (l) => l.match(/^[ \t]*/)[0].length;
    const sig = lines.filter((l, k) => k === lines.length - 1 || l.trim() !== '');
    const cut = sig.length ? Math.min(...sig.map(ind)) : 0;
    let body = lines.map(l => (l.trim() === '' ? '' : l.slice(cut)).replace(/[ \t]+$/, ''));
    if (lastOwn) body[body.length - 1] = ''; 
    let raw = body.join('\n');
    // Escapes (auch \<Zeilenende> = Zeile fortsetzen)
    let out = '';
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if (c !== '\\') { out += c; continue; }
      const e = raw[++k];
      const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0', '"': '"', "'": "'", '\\': '\\', s: ' ', '\n': '' };
      if (e in map) out += map[e]; else err('Ungültige Escape-Sequenz im Textblock: \\' + (e || ''));
    }
    return { t: 'str', v: out, line: sl, pos: start, end: i };
  }
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === ' ') { i++; continue; }
    const start = i, sl = line;
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      if (i >= n) { line = sl; err('Kommentar wird nicht geschlossen: */ fehlt'); }
      i += 2;
      if (src[start + 2] === '*') docs[toks.length] = src.slice(start, i);
      continue;
    }
    if (idStart.test(ch)) {
      while (i < n && idPart.test(src[i])) i++;
      const w = src.slice(start, i);
      toks.push({ t: KW.has(w) ? 'kw' : 'id', v: w, line: sl, pos: start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let isD = false, isL = false, val;
      if (ch === '0' && /[xXbB]/.test(src[i + 1] || '')) {
        const base = /[xX]/.test(src[i + 1]) ? 16 : 2; i += 2; const s = i;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
        val = parseInt(src.slice(s, i).replace(/_/g, ''), base);
      } else {
        while (i < n && /[0-9_]/.test(src[i])) i++;
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) { isD = true; i++; while (i < n && /[0-9_]/.test(src[i])) i++; }
        else if (src[i] === '.' && !idStart.test(src[i + 1] || '') && src[i + 1] !== '.') { isD = true; i++; }
        if (/[eE]/.test(src[i] || '')) { isD = true; i++; if (/[+-]/.test(src[i])) i++; while (i < n && /[0-9]/.test(src[i])) i++; }
        val = src.slice(start, i).replace(/_/g, '');
      }
      if (/[lL]/.test(src[i] || '')) { isL = true; i++; }
      else if (/[dDfF]/.test(src[i] || '')) { isD = true; i++; }
      let v;
      if (isL) v = BigInt(typeof val === 'string' ? val : val);
      else if (isD) v = Number(val);
      else { v = Number(val); if (v > 2147483648) err('Zahl zu groß für int: ' + src.slice(start, i) + ' (für große Zahlen long mit L am Ende verwenden)'); }
      toks.push({ t: 'num', v, jt: isD ? 'double' : (isL ? 'long' : 'int'), line: sl, pos: start, end: i });
      continue;
    }
    if (ch === '"') {
      if (src.startsWith('"""', i)) { toks.push(textBlock(start, sl)); continue; }
      i++; let s = '';
      for (;;) {
        if (i >= n || src[i] === '\n') err('Zeichenkette wird nicht geschlossen: " fehlt');
        const c = src[i];
        if (c === '"') { i++; break; }
        if (c === '\\') { s += readEscape(); continue; }
        s += c; i++;
      }
      toks.push({ t: 'str', v: s, line: sl, pos: start, end: i });
      continue;
    }
    if (ch === "'") {
      i++; let c;
      if (src[i] === '\\') c = readEscape(); else { if (src[i] === "'" || src[i] === '\n' || i >= n) err("Leeres Zeichenliteral ''"); c = src[i]; i++; }
      if (src[i] !== "'") err("Zeichenliteral fehlerhaft: ' fehlt (Texte mit mehreren Zeichen gehören in \"...\")");
      i++;
      toks.push({ t: 'char', v: c, line: sl, pos: start, end: i });
      continue;
    }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) { if ('(){}[];,.@=<>!~?:+-*/&|^%'.includes(ch)) op = ch; else err('Unerwartetes Zeichen: ' + ch); }
    i += op.length;
    toks.push({ t: 'op', v: op, line: sl, pos: start, end: i });
  }
  toks.push({ t: 'eof', v: '<Ende>', line, pos: n, end: n });
  return { toks, docs };
}

// ---------------------------------------------------------------- Parser
const MODS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'native', 'synchronized', 'transient', 'volatile', 'default']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=']);
const EXPR_STMT = new Set(['Assign', 'PreInc', 'PostInc', 'Call', 'New', 'CtorCall']);
const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>=', 'instanceof'], ['<<', '>>', '>>>'], ['+', '-'], ['*', '/', '%']];
const visOf = (m) => m.has('public') ? 'public' : m.has('private') ? 'private' : m.has('protected') ? 'protected' : 'package';

class Parser {
  constructor(src) {
    const r = lex(src); this.toks = r.toks; this.docs = r.docs; this.p = 0;
    this.extra = [];      // verschachtelte, lokale und anonyme Klassen (werden hinter der äußeren Klasse eingereiht)
    this.clsStack = [];   // gerade gelesene Klassen (innen zuletzt)
    this.anonN = new Map();
  }
  get tok() { return this.toks[this.p]; }
  peek(k = 1) { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  is(v) { const t = this.tok; return (t.t === 'op' || t.t === 'kw') && t.v === v; }
  isAt(k, v) { const t = this.peek(k); return (t.t === 'op' || t.t === 'kw') && t.v === v; }
  adj(k, v) { const a = this.peek(k), b = this.peek(k - 1); return a.t === 'op' && a.v === v && a.pos === b.end; }
  accept(v) { if (this.is(v)) { this.p++; return true; } return false; }
  expect(v, hint) {
    if (this.is(v)) return this.toks[this.p++];
    if ((v === ';' || v === ')') && this.p > 0 && this.tok.line !== this.toks[this.p - 1].line) {
      throw new JavaError(`'${v}' erwartet` + (hint ? ' ' + hint : ''), this.toks[this.p - 1].line);
    }
    this.fail(`'${v}' erwartet` + (hint ? ' ' + hint : ''));
  }
  fail(msg, tok) {
    tok = tok || this.tok;
    const got = tok.t === 'eof' ? 'Ende der Datei' : `'${tok.t === 'str' ? '"' + tok.v + '"' : tok.t === 'num' ? String(tok.v) : tok.v}'`;
    throw new JavaError(`${msg}, gefunden: ${got}`, tok.line);
  }
  ident(what) {
    const t = this.tok;
    if (t.t === 'id') { this.p++; return t.v; }
    if (t.t === 'kw') this.fail(`Name erwartet${what ? ' (' + what + ')' : ''} – '${t.v}' ist ein reserviertes Wort`);
    this.fail(`Name erwartet${what ? ' (' + what + ')' : ''}`);
  }
  skipParens() { let d = 0; do { if (this.is('(')) d++; else if (this.is(')')) d--; if (this.tok.t === 'eof') this.fail("')' fehlt"); this.p++; } while (d > 0); }

  parseUnit() {
    const classes = [];
    while (this.is('package') || this.is('import')) { while (!this.is(';')) { if (this.tok.t === 'eof') this.fail("';' erwartet"); this.p++; } this.p++; }
    while (this.tok.t !== 'eof') { if (this.accept(';')) continue; classes.push(this.parseTypeDecl()); classes.push(...this.extra.splice(0)); }
    return classes;
  }
  parseModifiers() {
    const m = new Set();
    for (;;) {
      const t = this.tok;
      if (t.t === 'kw' && MODS.has(t.v) && !(t.v === 'default' && (this.isAt(1, ':') || this.isAt(1, '->')))) { m.add(t.v); this.p++; }
      else if (this.is('@')) { this.p++; this.ident('Annotation'); if (this.is('(')) this.skipParens(); }
      else break;
    }
    return m;
  }
  parseTypeParams() {
    this.expect('<'); const names = [];
    do { names.push(this.ident('Typparameter')); if (this.accept('extends')) { this.parseType(); while (this.accept('&')) this.parseType(); } } while (this.accept(','));
    this.expect('>'); return names;
  }
  isRecordStart() { return this.tok.t === 'id' && this.tok.v === 'record' && this.peek().t === 'id' && (this.isAt(2, '(') || this.isAt(2, '<')); }
  parseTypeDecl(pre) {
    const doc = pre ? pre.doc : this.docs[this.p];
    const mods = pre ? pre.mods : this.parseModifiers(); const line = pre ? pre.line : this.tok.line;
    let kind;
    if (this.accept('class')) kind = 'class'; else if (this.accept('interface')) kind = 'interface'; else if (this.accept('enum')) kind = 'enum';
    else if (this.isRecordStart()) { this.p++; kind = 'record'; }
    else this.fail("'class' erwartet");
    const name = this.ident('Klassenname');
    const typeParams = this.is('<') ? this.parseTypeParams() : [];
    let comps = null;
    if (kind === 'record') { comps = this.parseParams(); mods.add('final'); if (this.is('extends')) this.fail('Ein record kann nicht mit extends erben (nur implements)'); }
    let superName = null, superArgs = null; const interfaces = [];
    if (kind === 'class' && this.accept('extends')) { const st = this.parseType(); superName = st.name; superArgs = st.args; }
    if (kind === 'interface' && this.accept('extends')) { do interfaces.push(this.parseType().name); while (this.accept(',')); }
    if (this.accept('implements')) { if (kind === 'interface') this.fail("Interfaces erweitern andere Interfaces mit 'extends'"); do interfaces.push(this.parseType().name); while (this.accept(',')); }
    const decl = { kind: kind === 'record' ? 'class' : kind, name, superName, superArgs, interfaces, mods, typeParams, fields: [], methods: [], ctors: [], inits: [], enumConsts: [], line, doc };
    if (comps) decl.record = comps;
    if (!this.is('{')) this.fail("'{' erwartet");
    this.p++;
    this.clsStack.push(decl);
    if (kind === 'enum') this.parseEnumConsts(decl);
    while (!this.is('}')) {
      if (this.tok.t === 'eof') throw new JavaError(`'}' am Ende der Klasse ${name} fehlt`, this.tok.line);
      this.parseMember(decl);
    }
    this.clsStack.pop();
    decl.endLine = this.tok.line;
    this.p++;
    if (decl.record) this.completeRecord(decl);
    return decl;
  }
  // record: Attribute, kanonischer Konstruktor, Zugriffsmethoden, toString/equals/hashCode
  completeRecord(d) {
    const comps = d.record, line = d.line;
    for (const c of comps) {
      if (d.fields.some(f => f.name === c.name)) throw new JavaError(`Die Komponente '${c.name}' des records ist schon ein Attribut`, line);
      d.fields.push({ name: c.name, type: c.type, init: null, mods: new Set(['private', 'final']), static: false, final: true, line, doc: null, vis: 'private' });
    }
    if (d.fields.some(f => !f.static && !comps.some(c => c.name === f.name))) throw new JavaError('Ein record darf keine weiteren Objekt-Attribute haben (nur static)', line);
    const assign = comps.map(c => ({ k: 'Expr', e: { k: 'Assign', op: '=', target: { k: 'Field', obj: { k: 'This', line }, name: c.name, line }, value: { k: 'Name', name: c.name, line }, line }, line }));
    const sig = (ps) => ps.map(p => typeStr(p.type)).join(',');
    const canon = d.ctors.find(k => k.compact || sig(k.params) === sig(comps));
    for (const k of d.ctors) if (k.compact) { k.params = comps.map(c => ({ ...c })); k.body.stmts.push(...assign); }
    if (!canon) d.ctors.push({ name: d.name, params: comps.map(c => ({ ...c })), body: { k: 'Block', stmts: assign, line, endLine: line }, mods: new Set(['public']), line, doc: null, vis: 'public', isCtor: true, typeParams: [], ret: VOID, throws: [] });
    const has = (n, k) => d.methods.some(m => m.name === n && m.params.length === k);
    let code = '';
    for (const c of comps) if (!has(c.name, 0)) code += `public ${typeStr(c.type)} ${c.name}() { return this.${c.name}; }\n`;
    if (!has('toString', 0)) code += `public String toString() { return "${d.name}[" ${comps.map((c, i) => `+ "${i ? ', ' : ''}${c.name}=" + this.${c.name}`).join(' ')} + "]"; }\n`;
    if (!has('equals', 1)) code += `public boolean equals(Object o) { if (this == o) return true; if (!(o instanceof ${d.name})) return false; ${d.name} r = (${d.name}) o; return true${comps.map(c => ` && java.util.Objects.equals(this.${c.name}, r.${c.name})`).join('')}; }\n`;
    if (!has('hashCode', 0)) code += `public int hashCode() { return java.util.Objects.hash(${comps.map(c => 'this.' + c.name).join(', ')}); }\n`;
    const sp = new Parser(code); for (const t of sp.toks) t.line = line;
    sp.clsStack = [d];
    while (sp.tok.t !== 'eof') sp.parseMember(d);
  }
  // Klasse innerhalb einer anderen Klasse (kind: 'member'), in einer Methode ('local') oder anonym ('anon')
  nested(nd, kind) {
    const cur = this.clsStack[this.clsStack.length - 1];
    nd.$outerDecl = cur; nd.nestKind = kind; nd.simpleName = nd.name;
    this.extra.push(nd);
    return nd;
  }
  parseEnumConsts(decl) {
    while (this.tok.t === 'id') {
      const l = this.tok.line; const nm = this.ident();
      const args = this.is('(') ? this.parseArgs() : [];
      if (this.is('{')) this.fail('Enum-Konstanten mit eigenem Rumpf werden nicht unterstützt');
      decl.enumConsts.push({ name: nm, args, line: l });
      if (!this.accept(',')) break;
    }
    if (!this.accept(';') && !this.is('}')) this.fail("';' oder '}' erwartet");
  }
  parseMember(decl) {
    if (this.accept(';')) return;
    const doc = this.docs[this.p]; const line = this.tok.line;
    const mods = this.parseModifiers();
    if (this.is('{')) { decl.inits.push({ static: mods.has('static'), body: this.parseBlock(), line }); return; }
    if (this.is('class') || this.is('interface') || this.is('enum') || this.isRecordStart()) {
      const nd = this.nested(this.parseTypeDecl({ mods, doc, line }), 'member');
      nd.staticNested = mods.has('static') || nd.kind !== 'class' || !!nd.record || decl.kind === 'interface';
      return;
    }
    const typeParams = this.is('<') ? this.parseTypeParams() : [];
    if (decl.record && this.tok.t === 'id' && this.tok.v === decl.name && this.isAt(1, '{')) {
      // kompakter Konstruktor eines records
      this.p++;
      const body = this.parseBlock();
      decl.ctors.push({ name: decl.name, params: [], body, mods, line, doc, vis: visOf(mods), isCtor: true, typeParams, ret: VOID, throws: [], compact: true });
      return;
    }
    if (this.tok.t === 'id' && this.tok.v === decl.name && this.isAt(1, '(')) {
      this.p++;
      const params = this.parseParams(); const throws = this.parseThrows();
      const body = this.parseBlock();
      decl.ctors.push({ name: decl.name, params, body, mods, line, doc, vis: visOf(mods), isCtor: true, typeParams, ret: VOID, throws });
      return;
    }
    if (this.tok.t === 'id' && this.isAt(1, '(')) throw new JavaError(`Rückgabetyp fehlt bei '${this.tok.v}' (oder der Konstruktorname stimmt nicht mit dem Klassennamen '${decl.name}' überein)`, this.tok.line);
    let type;
    if (this.accept('void')) type = T('void'); else type = this.parseType();
    let name = this.ident('Name des Attributs oder der Methode');
    if (this.is('(')) {
      const params = this.parseParams();
      let dims = 0; while (this.accept('[')) { this.expect(']'); dims++; }
      if (dims) type = { ...type, dims: type.dims + dims };
      const throws = this.parseThrows();
      let body = null;
      if (this.is('{')) body = this.parseBlock(); else this.expect(';', `oder Methodenrumpf { … }`);
      const isI = decl.kind === 'interface';
      const isAbstract = mods.has('abstract') || (isI && !body);
      if (!body && !isAbstract) throw new JavaError(`Methode ${name}: Rumpf { … } fehlt (oder die Methode als abstract kennzeichnen)`, line);
      if (body && mods.has('abstract')) throw new JavaError(`Abstrakte Methode ${name} darf keinen Rumpf haben`, line);
      decl.methods.push({ name, params, ret: type, body, mods, static: mods.has('static'), abstract: isAbstract, line, doc, vis: isI ? 'public' : visOf(mods), typeParams, throws });
      return;
    }
    for (;;) {
      let dims = 0; while (this.accept('[')) { this.expect(']'); dims++; }
      const ft = dims ? { ...type, dims: type.dims + dims } : type;
      if (ft.name === 'void') throw new JavaError("Attribute können nicht den Typ 'void' haben", line);
      let init = null;
      const fl = this.tok.line;
      if (this.accept('=')) init = this.is('{') ? this.parseArrayInit() : this.parseExpr();
      const isI = decl.kind === 'interface';
      decl.fields.push({ name, type: ft, init, mods, static: mods.has('static') || isI, final: mods.has('final') || isI, line: fl, doc, vis: isI ? 'public' : visOf(mods) });
      if (!this.accept(',')) break;
      name = this.ident('Attributname');
    }
    this.expect(';');
  }
  parseThrows() { const r = []; if (this.accept('throws')) { do r.push(this.parseType().name); while (this.accept(',')); } return r; }
  parseParams() {
    this.expect('('); const ps = [];
    if (!this.is(')')) {
      do {
        this.parseModifiers();
        const type = this.parseType();
        if (this.is('...')) this.fail('Variable Parameterlisten (...) werden nicht unterstützt – verwende ein Array');
        const name = this.ident('Parametername');
        let dims = 0; while (this.accept('[')) { this.expect(']'); dims++; }
        ps.push({ type: dims ? { ...type, dims: type.dims + dims } : type, name });
      } while (this.accept(','));
    }
    this.expect(')');
    return ps;
  }
  parseType() {
    const t = this.tok; let name, qual = null;
    if (t.t === 'kw' && PRIMS.has(t.v)) { name = t.v; this.p++; }
    else if (t.t === 'id') { name = t.v; this.p++; while (this.is('.') && this.peek().t === 'id') { this.p += 2; qual = name; name = this.toks[this.p - 1].v; } }
    else this.fail('Typ erwartet');
    let args = null;
    if (this.is('<')) args = this.parseTypeArgs();
    let dims = 0; while (this.is('[') && this.isAt(1, ']')) { this.p += 2; dims++; }
    const r = { name, dims, args };
    if (qual && /^[A-Z]/.test(qual)) r.qual = qual;   // Aussen.Innen
    return r;
  }
  parseTypeArgs() {
    this.expect('<'); const args = [];
    if (this.accept('>')) return args;
    do {
      if (this.accept('?')) { if (this.accept('extends') || this.accept('super')) args.push(this.parseType()); else args.push(T('Object')); }
      else { const t = this.parseType(); if (PRIMS.has(t.name) && !t.dims) this.fail(`Generische Typen brauchen Klassen: statt ${t.name} z. B. ${t.name === 'int' ? 'Integer' : t.name === 'char' ? 'Character' : t.name[0].toUpperCase() + t.name.slice(1)}`, this.toks[this.p - 1]); args.push(t); }
    } while (this.accept(','));
    this.expect('>');
    return args;
  }
  tryType() { const save = this.p; try { return this.parseType(); } catch (e) { if (!(e instanceof JavaError)) throw e; this.p = save; return null; } }
  isLocalDecl() {
    const t = this.tok;
    if (t.t === 'kw' && (PRIMS.has(t.v) || t.v === 'final')) return !this.isAt(1, '.');
    if (t.t !== 'id') return false;
    const save = this.p; const ty = this.tryType();
    const ok = !!ty && this.tok.t === 'id';
    this.p = save; return ok;
  }
  parseBlock() {
    const line = this.tok.line; this.expect('{');
    const stmts = [];
    while (!this.is('}')) { if (this.tok.t === 'eof') throw new JavaError("'}' fehlt (Block wird nicht geschlossen)", this.tok.line); stmts.push(this.parseStmt()); }
    const endLine = this.tok.line; this.p++;
    return { k: 'Block', stmts, line, endLine };
  }
  parseStmt() {
    const t = this.tok, line = t.line;
    if (this.is('{')) return this.parseBlock();
    if (this.accept(';')) return { k: 'Empty', line };
    if (t.t === 'kw') switch (t.v) {
      case 'if': { this.p++; this.expect('(', "nach 'if'"); const c = this.parseExpr(); this.expect(')'); const a = this.parseStmt(); let b = null; if (this.accept('else')) b = this.parseStmt(); return { k: 'If', c, a, b, line }; }
      case 'while': { this.p++; this.expect('(', "nach 'while'"); const c = this.parseExpr(); this.expect(')'); const body = this.parseStmt(); return { k: 'While', c, body, line }; }
      case 'do': { this.p++; const body = this.parseStmt(); this.expect('while'); this.expect('('); const c = this.parseExpr(); this.expect(')'); this.expect(';'); return { k: 'DoWhile', c, body, line }; }
      case 'for': return this.parseFor();
      case 'return': { this.p++; let e = null; if (!this.is(';')) e = this.parseExpr(); this.expect(';'); return { k: 'Return', e, line }; }
      case 'break': { this.p++; if (this.tok.t === 'id') this.p++; this.expect(';'); return { k: 'Break', line }; }
      case 'continue': { this.p++; if (this.tok.t === 'id') this.p++; this.expect(';'); return { k: 'Continue', line }; }
      case 'throw': { this.p++; const e = this.parseExpr(); this.expect(';'); return { k: 'Throw', e, line }; }
      case 'try': return this.parseTry();
      case 'switch': return this.parseSwitch();
      case 'else': this.fail("'else' ohne passendes 'if'");
      case 'case': case 'default': this.fail("'case' außerhalb von switch");
      case 'class': case 'interface': case 'enum': {
        if (!this.clsStack.length) this.fail('Klassen können hier nicht definiert werden');
        const nd = this.nested(this.parseTypeDecl(), 'local');
        return { k: 'LocalClass', name: nd.name, line };
      }
      case 'public': case 'private': case 'protected': case 'static':
        throw new JavaError(`'${t.v}' ist hier nicht erlaubt – fehlt vorher eine schließende Klammer '}'?`, line);
    }
    if (t.t === 'id' && this.isAt(1, ':')) { this.p += 2; return this.parseStmt(); }
    if (t.t === 'id' && t.v === 'yield' && !['=', '.', '[', '++', '--', '+=', '-=', '(', ';'].some(o => this.isAt(1, o))) { this.p++; const e = this.parseExpr(); this.expect(';'); return { k: 'Yield', e, line }; }
    if (this.isRecordStart()) {
      if (!this.clsStack.length) this.fail('Records können hier nicht definiert werden');
      const nd = this.nested(this.parseTypeDecl(), 'local'); nd.staticNested = true;
      return { k: 'LocalClass', name: nd.name, line };
    }
    if (this.isLocalDecl()) { const s = this.parseLocalDecl(); this.expect(';'); return s; }
    const e = this.parseExpr();
    this.expect(';');
    if (!EXPR_STMT.has(e.k)) throw new JavaError('Keine gültige Anweisung: Der Ausdruck wird nicht verwendet (fehlt eine Zuweisung oder ein Methodenaufruf?)', line);
    return { k: 'Expr', e, line };
  }
  parseLocalDecl() {
    const line = this.tok.line;
    this.accept('final');
    let type;
    if (this.tok.t === 'id' && this.tok.v === 'var' && this.peek().t === 'id') { this.p++; type = T('var'); }
    else type = this.parseType();
    const decls = [];
    do {
      const name = this.ident('Variablenname');
      let dims = 0; while (this.accept('[')) { this.expect(']'); dims++; }
      let init = null;
      if (this.accept('=')) init = this.is('{') ? this.parseArrayInit() : this.parseExpr();
      decls.push({ name, type: dims ? { ...type, dims: type.dims + dims } : type, init });
    } while (this.accept(','));
    return { k: 'Local', decls, line };
  }
  parseArrayInit() {
    const line = this.tok.line; this.expect('{'); const elems = [];
    while (!this.is('}')) { elems.push(this.is('{') ? this.parseArrayInit() : this.parseExpr()); if (!this.accept(',')) break; }
    this.expect('}');
    return { k: 'ArrayInit', elems, line };
  }
  parseFor() {
    const line = this.tok.line; this.p++; this.expect('(', "nach 'for'");
    const save = this.p;
    if (this.isLocalDecl()) {
      this.accept('final');
      let type; if (this.tok.v === 'var' && this.peek().t === 'id') { this.p++; type = T('var'); } else type = this.parseType();
      const name = this.ident();
      if (this.accept(':')) { const it = this.parseExpr(); this.expect(')'); const body = this.parseStmt(); return { k: 'ForEach', type, name, it, body, line }; }
      this.p = save;
    }
    let init = [];
    if (!this.is(';')) {
      if (this.isLocalDecl()) init = [this.parseLocalDecl()];
      else { do { const l = this.tok.line; init.push({ k: 'Expr', e: this.parseExpr(), line: l }); } while (this.accept(',')); }
    }
    this.expect(';', "in der for-Schleife"); let c = null; if (!this.is(';')) c = this.parseExpr(); this.expect(';', 'in der for-Schleife');
    const upd = []; if (!this.is(')')) { do upd.push(this.parseExpr()); while (this.accept(',')); }
    this.expect(')');
    const body = this.parseStmt();
    return { k: 'For', init, c, upd, body, line };
  }
  parseTry() {
    const line = this.tok.line; this.p++;
    if (this.is('(')) this.fail('try-with-resources wird nicht unterstützt');
    const block = this.parseBlock(); const catches = [];
    while (this.accept('catch')) {
      this.expect('('); this.accept('final');
      const types = [this.parseType().name]; while (this.accept('|')) types.push(this.parseType().name);
      const name = this.ident(); this.expect(')');
      catches.push({ types, name, body: this.parseBlock() });
    }
    let fin = null; if (this.accept('finally')) fin = this.parseBlock();
    if (!catches.length && !fin) this.fail("'catch' oder 'finally' erwartet");
    return { k: 'Try', block, catches, fin, line };
  }
  parseSwitch() {
    const line = this.tok.line; this.p++;
    this.expect('('); const e = this.parseExpr(); this.expect(')'); this.expect('{');
    const cases = []; let arrow = false;
    while (!this.accept('}')) {
      if (this.tok.t === 'eof') this.fail("'}' fehlt");
      const cl = this.tok.line; let labels;
      if (this.accept('default')) labels = null;
      else { this.expect('case'); labels = []; this.noLambda = true; try { do labels.push(this.parseTernary()); while (this.accept(',')); } finally { this.noLambda = false; } }
      if (this.accept('->')) {
        arrow = true; let body;
        if (this.is('{')) body = this.parseBlock();
        else if (this.is('throw')) body = this.parseStmt();
        else { const ex = this.parseExpr(); this.expect(';'); body = { k: 'Expr', e: ex, line: cl }; }
        cases.push({ labels, stmts: [body], line: cl });
      } else {
        this.expect(':'); const stmts = [];
        while (!this.is('case') && !this.is('default') && !this.is('}')) { if (this.tok.t === 'eof') this.fail("'}' fehlt"); stmts.push(this.parseStmt()); }
        cases.push({ labels, stmts, line: cl });
      }
    }
    return { k: 'Switch', e, cases, arrow, line };
  }
  parseExpr() { return this.parseAssign(); }
  parseAssign() {
    const lhs = this.parseTernary();
    const t = this.tok;
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.p++;
      if (!['Name', 'Field', 'Index'].includes(lhs.k)) throw new JavaError(`Links von ${t.v} muss eine Variable stehen`, t.line);
      const rhs = this.parseAssign();
      return { k: 'Assign', op: t.v, target: lhs, value: rhs, line: t.line };
    }
    return lhs;
  }
  parseTernary() {
    const c = this.parseBin(0);
    if (this.is('?')) { const line = this.tok.line; this.p++; const a = this.parseTernary(); this.expect(':', 'im Bedingungsoperator ? :'); const b = this.parseTernary(); return { k: 'Cond', c, a, b, line }; }
    return c;
  }
  binOpHere(level) {
    const ops = BIN[level], t = this.tok;
    if (t.t === 'kw' && t.v === 'instanceof') return ops.includes('instanceof') ? 'instanceof' : null;
    if (t.t !== 'op') return null;
    if (level === 7) {
      if (t.v === '<<') return '<<';
      if (t.v === '>' && this.adj(1, '>')) return this.adj(2, '>') ? '>>>' : '>>';
      return null;
    }
    return ops.includes(t.v) ? t.v : null;
  }
  parseBin(level) {
    if (level === BIN.length) return this.parseUnary();
    let l = this.parseBin(level + 1);
    for (;;) {
      const op = this.binOpHere(level); if (!op) break;
      const line = this.tok.line;
      if (op === 'instanceof') { this.p++; const type = this.parseType(); let bind = null; if (this.tok.t === 'id') bind = this.ident(); l = { k: 'InstanceOf', e: l, type, bind, line }; continue; }
      this.p += op === '>>' ? 2 : op === '>>>' ? 3 : 1;
      const r = this.parseBin(level + 1);
      l = { k: 'Bin', op, l, r, line };
    }
    return l;
  }
  parseUnary() {
    const t = this.tok, line = t.line;
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') { this.p++; const e = this.parseUnary(); if (!['Name', 'Field', 'Index'].includes(e.k)) throw new JavaError(`${t.v} braucht eine Variable`, line); return { k: 'PreInc', op: t.v, e, line }; }
      if (t.v === '-' && this.peek().t === 'num' && this.peek().jt === 'int' && this.peek().v === 2147483648) { this.p += 2; return { k: 'Lit', v: -2147483648, line }; }
      if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~') { this.p++; const e = this.parseUnary(); return { k: 'Unary', op: t.v, e, line }; }
      if (t.v === '(') { const l = this.tryLambda(); if (l) return l; const c = this.tryCast(); if (c) return c; }
    }
    let e = this.parsePostfix(this.parsePrimary());
    while (this.is('++') || this.is('--')) {
      if (!['Name', 'Field', 'Index'].includes(e.k)) throw new JavaError(`${this.tok.v} braucht eine Variable`, line);
      e = { k: 'PostInc', op: this.tok.v, e, line: this.tok.line }; this.p++;
    }
    return e;
  }
  // Lambda-Ausdruck: (a, b) -> …, (int a) -> { … }, () -> …
  tryLambda() {
    let d = 0, k = this.p;
    for (; k < this.toks.length; k++) { const x = this.toks[k]; if (x.t === 'eof') return null; if (x.t === 'op' && x.v === '(') d++; else if (x.t === 'op' && x.v === ')') { if (--d === 0) break; } }
    const nx = this.toks[k + 1];
    if (!nx || nx.t !== 'op' || nx.v !== '->') return null;
    const line = this.tok.line; this.p++;
    const params = [];
    if (!this.is(')')) {
      do {
        if (this.tok.t === 'id' && (this.isAt(1, ',') || this.isAt(1, ')'))) params.push({ name: this.ident(), type: null });
        else { this.parseModifiers(); let type = this.parseType(); if (type.name === 'var') type = null; const name = this.ident('Parametername'); params.push({ name, type }); }
      } while (this.accept(','));
    }
    this.expect(')'); this.expect('->');
    return this.lambdaBody(params, line);
  }
  lambdaBody(params, line) {
    if (this.is('{')) return { k: 'Lambda', params, body: this.parseBlock(), expr: false, line };
    return { k: 'Lambda', params, body: this.parseExpr(), expr: true, line };
  }
  tryCast() {
    const save = this.p, line = this.tok.line; this.p++;
    const t = this.tok;
    if (t.t === 'kw' && PRIMS.has(t.v)) {
      const type = this.parseType();
      if (this.accept(')')) return { k: 'Cast', type, e: this.parseUnary(), line };
      this.p = save; return null;
    }
    if (t.t === 'id') {
      const type = this.tryType();
      if (type && this.is(')')) {
        const nx = this.peek();
        const ok = nx.t === 'id' || nx.t === 'str' || nx.t === 'num' || nx.t === 'char' ||
          (nx.t === 'kw' && ['this', 'new', 'super', 'true', 'false', 'null'].includes(nx.v)) ||
          (nx.t === 'op' && ['(', '!', '~'].includes(nx.v));
        if (ok) { this.p++; return { k: 'Cast', type, e: this.parseUnary(), line }; }
      }
    }
    this.p = save; return null;
  }
  parsePrimary() {
    const t = this.tok, line = t.line;
    switch (t.t) {
      case 'num': this.p++; return { k: 'Lit', v: t.jt === 'double' ? new JDouble(t.v) : t.v, line };
      case 'str': this.p++; return { k: 'Lit', v: t.v, line };
      case 'char': this.p++; return { k: 'Lit', v: new JChar(t.v.charCodeAt(0)), line };
      case 'id':
        if ((t.v === 'java' || t.v === 'javax') && this.isAt(1, '.')) {
          while (this.tok.t === 'id' && /^[a-z]/.test(this.tok.v) && this.isAt(1, '.') && this.peek(2).t === 'id') this.p += 2;
          return this.parsePrimary();
        }
        this.p++;
        if (this.is('->') && !this.noLambda) { this.p++; return this.lambdaBody([{ name: t.v, type: null }], line); }
        if (this.is('(')) return { k: 'Call', obj: null, name: t.v, args: this.parseArgs(), line };
        return { k: 'Name', name: t.v, line };
      case 'kw':
        switch (t.v) {
          case 'true': this.p++; return { k: 'Lit', v: true, line };
          case 'false': this.p++; return { k: 'Lit', v: false, line };
          case 'null': this.p++; return { k: 'Lit', v: null, line };
          case 'this': this.p++; if (this.is('(')) return { k: 'CtorCall', which: 'this', args: this.parseArgs(), line }; return { k: 'This', line };
          case 'super': {
            this.p++;
            if (this.is('(')) return { k: 'CtorCall', which: 'super', args: this.parseArgs(), line };
            this.expect('.'); const nm = this.ident();
            if (this.is('(')) return { k: 'Call', obj: { k: 'Super', line }, name: nm, args: this.parseArgs(), line };
            return { k: 'Field', obj: { k: 'Super', line }, name: nm, line };
          }
          case 'new': return this.parseNew();
          case 'switch': { const sw = this.parseSwitch(); sw.k = 'SwitchExpr'; return sw; }
        }
        break;
      case 'op':
        if (t.v === '(') { this.p++; const e = this.parseExpr(); this.expect(')'); return { k: 'Paren', e, line }; }
        if (t.v === '{') this.fail('Array-Initialisierer { … } nur bei der Deklaration erlaubt – verwende new Typ[] { … }');
    }
    if (t.t === 'eof') this.fail('Ausdruck unvollständig');
    this.fail('Ausdruck erwartet');
  }
  parsePostfix(e) {
    for (;;) {
      if (this.is('.')) {
        this.p++;
        if (this.is('<')) this.parseTypeArgs();
        const line = this.tok.line;
        if (this.is('class')) this.fail('.class wird nicht unterstützt');
        if (this.is('this') && e.k === 'Name') { this.p++; e = { k: 'OuterThis', name: e.name, line }; continue; }
        const nm = this.ident('Name nach dem Punkt');
        if (this.is('(')) e = { k: 'Call', obj: e, name: nm, args: this.parseArgs(), line };
        else e = { k: 'Field', obj: e, name: nm, line };
        continue;
      }
      if (this.is('[')) { const line = this.tok.line; this.p++; const idx = this.parseExpr(); this.expect(']'); e = { k: 'Index', arr: e, idx, line }; continue; }
      if (this.is('::')) {
        const line = this.tok.line; this.p++;
        const nm = this.accept('new') ? 'new' : this.ident('Methodenname nach ::');
        e = { k: 'MethodRef', target: e, name: nm, line };
        continue;
      }
      if (this.is('->') && !this.noLambda) this.fail('Lambda-Ausdruck an dieser Stelle nicht möglich');
      break;
    }
    return e;
  }
  parseArgs() {
    this.expect('('); const a = [];
    if (!this.is(')')) { do a.push(this.parseExpr()); while (this.accept(',')); }
    this.expect(')', 'am Ende der Parameterliste');
    return a;
  }
  parseNew() {
    const line = this.tok.line; this.p++;
    const t = this.tok; let name, qual = null;
    if (t.t === 'kw' && PRIMS.has(t.v)) { name = t.v; this.p++; }
    else { name = this.ident('Klassenname nach new'); while (this.is('.') && this.peek().t === 'id') { this.p += 2; qual = name; name = this.toks[this.p - 1].v; } }
    let targs = null; if (this.is('<')) targs = this.parseTypeArgs();
    if (this.is('[')) {
      const dims = []; let extra = 0;
      while (this.is('[')) {
        this.p++;
        if (this.is(']')) { this.p++; extra++; }
        else { if (extra) this.fail("']' erwartet"); dims.push(this.parseExpr()); this.expect(']'); }
      }
      let init = null;
      if (this.is('{')) { if (dims.length) this.fail('Bei einem Initialisierer { … } keine Arraygröße angeben'); init = this.parseArrayInit(); }
      else if (!dims.length) this.fail('Arraygröße fehlt');
      return { k: 'NewArray', elem: T(name, 0, targs), dims, total: dims.length + extra, init, line };
    }
    if (PRIMS.has(name)) this.fail("'[' erwartet");
    if (!this.is('(')) this.fail(`'(' erwartet nach new ${name}`);
    const args = this.parseArgs();
    const type = T(name, 0, targs); if (qual && /^[A-Z]/.test(qual)) type.qual = qual;
    if (this.is('{')) return { k: 'New', type, args, line, anon: this.parseAnonBody(name, line) };
    return { k: 'New', type, args, line };
  }
  // Rumpf einer anonymen Klasse: new Basis(…) { … }
  parseAnonBody(base, line) {
    if (!this.clsStack.length) this.fail('Anonyme Klassen sind hier nicht möglich (nur innerhalb einer Klasse)');
    const top = this.clsStack[0].name, n = (this.anonN.get(top) || 0) + 1; this.anonN.set(top, n);
    const name = top + '$' + n;
    const decl = { kind: 'class', name, superName: null, superArgs: null, anonBase: base, interfaces: [], mods: new Set(), typeParams: [], fields: [], methods: [], ctors: [], inits: [], enumConsts: [], line, doc: null };
    this.nested(decl, 'anon');
    this.p++;
    this.clsStack.push(decl);
    while (!this.is('}')) {
      if (this.tok.t === 'eof') throw new JavaError("'}' am Ende der anonymen Klasse fehlt", this.tok.line);
      if (this.is('{') || ((this.tok.t === 'kw') && MODS.has(this.tok.v) && false)) { }
      this.parseMember(decl);
    }
    this.clsStack.pop();
    decl.endLine = this.tok.line; this.p++;
    return name;
  }
}

// ---------------------------------------------------------------- Klassen
class ClassInfo {
  constructor(name, decl, opts = {}) {
    this.name = name; this.decl = decl;
    this.superName = decl ? decl.superName : null;
    this.superClass = null; this.interfaces = [];
    this.fieldMap = new Map(); this.fieldList = [];
    this.staticValues = Object.create(null);
    this.methods = new Map(); this.methodList = []; this.ctors = [];
    this.isInterface = !!(decl && decl.kind === 'interface');
    this.isEnum = !!(decl && decl.kind === 'enum');
    this.isAbstract = this.isInterface || !!(decl && decl.mods.has('abstract'));
    this.isFinal = !!(decl && decl.mods.has('final'));
    this.builtin = !!opts.builtin; this.native = opts.native || null; this.pkg = opts.pkg || null;
    this.staticInit = 0; this.typeParams = decl ? decl.typeParams : [];
    this.enumConsts = [];
  }
  isSubclassOf(other) {
    if (!other) return false;
    if (other.name === 'Object') return true;
    const seen = new Set();
    const walk = (c) => { if (!c || seen.has(c)) return false; seen.add(c); if (c === other) return true; return walk(c.superClass) || c.interfaces.some(walk); };
    return walk(this);
  }
  get fullName() { return this.builtin && this.pkg ? this.pkg + '.' + this.name : this.name; }
}

class Env {
  constructor(parent) { this.parent = parent; this.vars = new Map(); }
  lookup(n) { for (let e = this; e; e = e.parent) { const v = e.vars.get(n); if (v) return v; } return null; }
  declare(n, type, value) { this.vars.set(n, { type, value }); }
}

const EXC = [['Exception', 'Throwable'], ['Error', 'Throwable'], ['RuntimeException', 'Exception'], ['ArithmeticException', 'RuntimeException'], ['NullPointerException', 'RuntimeException'], ['IllegalArgumentException', 'RuntimeException'], ['IllegalStateException', 'RuntimeException'], ['IndexOutOfBoundsException', 'RuntimeException'], ['ArrayIndexOutOfBoundsException', 'IndexOutOfBoundsException'], ['StringIndexOutOfBoundsException', 'IndexOutOfBoundsException'], ['ClassCastException', 'RuntimeException'], ['NumberFormatException', 'IllegalArgumentException'], ['UnsupportedOperationException', 'RuntimeException'], ['NegativeArraySizeException', 'RuntimeException'], ['StackOverflowError', 'Error'], ['NoSuchElementException', 'RuntimeException'], ['ConcurrentModificationException', 'RuntimeException'], ['InputMismatchException', 'RuntimeException'], ['CloneNotSupportedException', 'Exception'], ['InterruptedException', 'Exception'], ['EmptyStackException', 'RuntimeException'], ['IOException', 'Exception'], ['FileNotFoundException', 'IOException']];
const UTIL_EXC = new Set(['NoSuchElementException', 'ConcurrentModificationException', 'InputMismatchException', 'EmptyStackException']);
const PRELUDE = `
public class Throwable {
  private String message;
  public Throwable() { }
  public Throwable(String message) { this.message = message; }
  public String getMessage() { return message; }
  public String toString() { String n = getClass().getName(); return message == null ? n : n + ": " + message; }
  public void printStackTrace() { System.err.println(this); }
}
public interface Comparable<T> { int compareTo(T o); }
public interface Runnable { void run(); }
` + EXC.map(([n, s]) => `public class ${n} extends ${s} { public ${n}() { super(); } public ${n}(String message) { super(message); } }`).join('\n');

const STRING_RET = { length: INT, charAt: CHAR, substring: STRING, indexOf: INT, lastIndexOf: INT, equals: BOOL, equalsIgnoreCase: BOOL, compareTo: INT, compareToIgnoreCase: INT, toUpperCase: STRING, toLowerCase: STRING, trim: STRING, strip: STRING, isEmpty: BOOL, isBlank: BOOL, contains: BOOL, startsWith: BOOL, endsWith: BOOL, replace: STRING, replaceAll: STRING, replaceFirst: STRING, split: T('String', 1), toCharArray: T('char', 1), concat: STRING, hashCode: INT, repeat: STRING, matches: BOOL, toString: STRING, chars: null, charCount: null, codePointAt: INT, intern: STRING, getClass: null };

// ---------------------------------------------------------------- Laufzeit
class Runtime {
  constructor(io) {
    this.io = io || {};
    this.maxSteps = 20000000; this.maxDepth = 1800;
    this.steps = 0; this.depth = 0; this.line = 0; this.callStack = [];
    this.nextYield = 0;      // bei diesem Schrittstand gibt der Generator die Kontrolle ab (yield TICK)
    this.task = null;        // laufendes (unterbrechbares) Programm, siehe runAsync
    this.classes = new Map();
    this.installNatives();
    for (const ext of Runtime.extensions) ext(this);
    const decls = new Parser(PRELUDE).parseUnit();
    // Weitere eingebaute Klassen als Java-Quelltext (z. B. Listener-Interfaces aus aplu.js)
    for (const p of Runtime.preludes) for (const d of new Parser(p.code).parseUnit()) { d.pkg = p.pkg; decls.push(d); }
    this.buildClasses(decls, true);
    // Eingebaute Klassen, die ein Interface aus dem Java-Vorspann haben (z. B. Iterator)
    for (const c of this.classes.values()) if (c.native && c.native.lateInterfaces) for (const n of c.native.lateInterfaces) { const i = this.classes.get(n); if (i && !c.interfaces.includes(i)) c.interfaces.push(i); }
    this.builtinClasses = new Map(this.classes);
    this.padClass = new ClassInfo('Direkteingabe', null, { builtin: true });
    this.padClass.superClass = this.classes.get('Object');
    this.userClasses = [];
  }
  cls(name) { return this.classes.get(name); }
  print(text, err) { if (this.io.out) this.io.out(text, !!err); }

  // ------------------------------------------------ Übersetzen
  compile(files) {
    this.classes = new Map(this.builtinClasses);
    for (const c of this.classes.values()) { if (!c.native) { c.staticInit = 0; c.staticValues = Object.create(null); } }
    this.userClasses = [];
    const errors = [], decls = [];
    for (const f of files) {
      try {
        const ds = new Parser(f.code).parseUnit();
        if (!ds.length) errors.push({ fileId: f.id, line: 1, message: 'Die Datei enthält keine Klasse' });
        for (const d of ds) { d.fileId = f.id; decls.push(d); }
      } catch (e) {
        if (e instanceof JavaError) errors.push({ fileId: f.id, line: e.line, message: e.message }); else throw e;
      }
    }
    if (errors.length) return { ok: false, errors };
    this.qualifyNested(decls);
    try { this.buildClasses(decls, false, errors); }
    catch (e) { if (e instanceof JavaError) errors.push({ fileId: e.fileId, line: e.line, message: e.message }); else throw e; }
    if (errors.length) return { ok: false, errors };
    for (const c of this.userClasses) if (c.nestKind !== 'local' && c.nestKind !== 'anon') new Checker(this, c, errors).run();
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [] };
  }
  // Verschachtelte Klassen werden unter ihrem einfachen Namen geführt. Gibt es den Namen
  // mehrfach (z. B. zwei Klassen mit je einer inneren Klasse Knoten) oder ist er schon von
  // Java belegt, heißt die innere Klasse „Aussen.Innen“; Verweise innerhalb der äußeren
  // Klasse und Verweise der Form Aussen.Innen werden darauf umgestellt.
  qualifyNested(decls) {
    const count = new Map();
    for (const d of decls) count.set(d.name, (count.get(d.name) || 0) + 1);
    const depth = (d) => { let n = 0; for (let x = d.$outerDecl; x; x = x.$outerDecl) n++; return n; };
    const todo = decls.filter(d => (d.nestKind === 'member' || d.nestKind === 'local') && (count.get(d.name) > 1 || (this.builtinClasses.has(d.name) && !(this.builtinClasses.get(d.name).native || {}).lib)));
    todo.sort((a, b) => depth(a) - depth(b));
    const walk = (x, fn) => {
      if (!x || typeof x !== 'object' || x instanceof Set) return;
      if (Array.isArray(x)) { for (const y of x) walk(y, fn); return; }
      fn(x);
      for (const k in x) { if (k[0] === '$') continue; const v = x[k]; if (v && typeof v === 'object') walk(v, fn); }
    };
    for (const d of todo) {
      const outer = d.$outerDecl, old = d.name, nw = outer.name + '.' + d.simpleName, oq = outer.simpleName || outer.name;
      const inFamily = (x) => { for (let y = x; y; y = y.$outerDecl) if (y === outer) return true; return false; };
      for (const x of decls) {
        const fam = inFamily(x);
        if (fam && x !== d) { if (x.superName === old) x.superName = nw; if (x.anonBase === old) x.anonBase = nw; x.interfaces = x.interfaces.map(n => n === old ? nw : n); }
        walk([x.fields, x.methods, x.ctors, x.inits, x.enumConsts, x.superArgs], (n) => {
          if (typeof n.name === 'string' && n.name === old && 'dims' in n && (fam ? (!n.qual || n.qual === oq) : n.qual === oq)) { n.name = nw; delete n.qual; }
          if (!fam) return;
          if ((n.k === 'Name' || n.k === 'LocalClass' || n.k === 'OuterThis') && n.name === old) n.name = nw;
          if (n.k === 'New' && n.anon === undefined && n.type && n.type.name === old) n.type.name = nw;
          if (Array.isArray(n.types) && n.body) n.types = n.types.map(t => t === old ? nw : t);
        });
      }
      d.name = nw;
    }
  }
  buildClasses(decls, builtin, errors) {
    const made = [];
    const fail = (d, line, msg) => { const e = new JavaError(msg, line); e.fileId = d.fileId; throw e; };
    for (const d of decls) {
      const prev = this.classes.get(d.name);
      if (prev && !builtin && prev.native && prev.native.lib) this.classes.delete(d.name);
      if (this.classes.has(d.name)) fail(d, d.line, this.builtinClasses && this.builtinClasses.has(d.name) ? `Der Klassenname '${d.name}' ist schon von Java belegt – wähle einen anderen Namen` : `Klasse '${d.name}' gibt es doppelt`);
      const c = new ClassInfo(d.name, d, { builtin, pkg: builtin ? (d.pkg || (UTIL_EXC.has(d.name) ? 'java.util' : /^(IO|FileNotFound)Exception$/.test(d.name) ? 'java.io' : 'java.lang')) : null });
      c.fileId = d.fileId;
      if (d.nestKind) { c.nestKind = d.nestKind; c.staticNested = !!d.staticNested; }
      this.classes.set(d.name, c); made.push(c);
    }
    const obj = this.classes.get('Object');
    for (const c of made) {
      const d = c.decl;
      if (d.$outerDecl) {
        c.outer = this.classes.get(d.$outerDecl.name);
        if (!c.outer.nestedMap) c.outer.nestedMap = new Map();
        c.outer.nestedMap.set(d.simpleName, c);
      }
      if (d.anonBase) {
        const b = this.classes.get(d.anonBase);
        if (!b) fail(d, d.line, `Klasse oder Interface '${d.anonBase}' nicht gefunden` + suggest(d.anonBase, [...this.classes.keys()]));
        if (b.isInterface) d.interfaces = [b.name]; else d.superName = b.name;
      }
      if (d.superName) {
        const s = this.classes.get(d.superName);
        if (!s) fail(d, d.line, `Oberklasse '${d.superName}' nicht gefunden` + suggest(d.superName, [...this.classes.keys()]));
        if (s.isInterface) fail(d, d.line, `'${s.name}' ist ein Interface – verwende 'implements' statt 'extends'`);
        if (s.isFinal || (s.native && !s.native.extendable)) fail(d, d.line, `Von '${s.name}' kann nicht geerbt werden`);
        if (s.isEnum) fail(d, d.line, `Von einem enum kann nicht geerbt werden`);
        c.superClass = s;
      } else c.superClass = c.isInterface ? null : obj;
      for (const iname of d.interfaces) {
        const ic = this.classes.get(iname);
        if (!ic) fail(d, d.line, `Interface '${iname}' nicht gefunden` + suggest(iname, [...this.classes.keys()]));
        if (!ic.isInterface) fail(d, d.line, `'${iname}' ist kein Interface – ${c.isInterface ? 'Interfaces können nur Interfaces erweitern' : "für Klassen 'extends' verwenden"}`);
        c.interfaces.push(ic);
      }
    }
    for (const c of made) {
      const seen = new Set(); let s = c;
      while (s) { if (seen.has(s)) fail(c.decl, c.decl.line, `Zyklische Vererbung bei Klasse ${c.name}`); seen.add(s); s = s.superClass; }
    }
    for (const c of made) {
      const d = c.decl;
      for (const ec of d.enumConsts) {
        const f = { name: ec.name, type: T(c.name), static: true, final: true, vis: 'public', enumConst: true, line: ec.line, mods: new Set(['public', 'static', 'final']) };
        c.fieldMap.set(ec.name, f); c.fieldList.push(f);
      }
      for (const f of d.fields) {
        if (c.fieldMap.has(f.name)) fail(d, f.line, `Attribut '${f.name}' ist in ${c.name} bereits definiert`);
        f.owner = c; c.fieldMap.set(f.name, f); c.fieldList.push(f);
      }
      const sigs = new Set();
      for (const m of d.methods) {
        m.cls = c;
        const sig = m.name + '(' + m.params.map(p => typeStr(p.type)).join(',') + ')';
        if (sigs.has(sig)) fail(d, m.line, `Methode ${sig} ist in ${c.name} bereits definiert`);
        sigs.add(sig);
        if (!c.methods.has(m.name)) c.methods.set(m.name, []);
        c.methods.get(m.name).push(m); c.methodList.push(m);
        if (m.abstract && !c.isAbstract && !c.isEnum) fail(d, m.line, `Klasse ${c.name} enthält die abstrakte Methode ${m.name} und muss deshalb selbst abstract sein`);
      }
      const csigs = new Set();
      for (const k of d.ctors) {
        k.cls = c;
        const sig = '(' + k.params.map(p => typeStr(p.type)).join(',') + ')';
        if (csigs.has(sig)) fail(d, k.line, `Konstruktor ${c.name}${sig} ist bereits definiert`);
        csigs.add(sig);
        if (c.isInterface) fail(d, k.line, 'Interfaces haben keine Konstruktoren');
        c.ctors.push(k);
      }
    }
    if (!builtin) {
      for (const c of made) {
        this.userClasses.push(c);
        if (c.isAbstract) continue;
        const missing = this.missingAbstract(c);
        if (missing) { const sig = `${missing.name}(${missing.params.map(p => typeStr(p.type)).join(', ')})`; const e = new JavaError(c.nestKind === 'anon' ? `Die anonyme Klasse new ${c.decl.anonBase}(…) { … } muss die Methode ${sig} aus ${missing.cls.name} implementieren` : `Klasse ${c.name} ist nicht abstract und überschreibt die abstrakte Methode ${sig} aus ${missing.cls.name} nicht`, c.decl.line); e.fileId = c.fileId; if (errors) errors.push({ fileId: c.fileId, line: c.decl.line, message: e.message }); else throw e; }
      }
    }
  }
  missingAbstract(c) {
    const abstracts = [];
    const seen = new Set();
    const visit = (k) => { if (!k || seen.has(k)) return; seen.add(k); for (const m of k.methodList) if (m.abstract) abstracts.push(m); visit(k.superClass); k.interfaces.forEach(visit); };
    visit(c);
    for (const a of abstracts) {
      const impl = this.lookupMethods(c, a.name).find(m => !m.abstract && m.params.length === a.params.length);
      if (!impl) return a;
    }
    return null;
  }
  lookupMethods(cls, name) {
    const out = []; const seen = new Set();
    const visit = (c) => { if (!c || seen.has(c)) return; seen.add(c); const ms = c.methods.get(name); if (ms) out.push(...ms); visit(c.superClass); c.interfaces.forEach(visit); };
    visit(cls);
    return out;
  }
  findField(cls, name) {
    const seen = new Set();
    const visit = (c) => {
      if (!c || seen.has(c)) return null; seen.add(c);
      const f = c.fieldMap.get(name); if (f) return { field: f, owner: c };
      if (c.native && c.native.sfields && Object.prototype.hasOwnProperty.call(c.native.sfields, name)) {
        return { field: { name, static: true, final: true, native: true, vis: 'public', type: (c.native.sfieldTypes || {})[name] || null }, owner: c };
      }
      return visit(c.superClass) || c.interfaces.map(visit).find(Boolean) || null;
    };
    return visit(cls);
  }
  allFieldNames(cls) { const s = []; for (let c = cls; c; c = c.superClass) for (const f of c.fieldMap.keys()) s.push(f); return s; }
  allMethodNames(cls) { const s = new Set(); const seen = new Set(); const v = (c) => { if (!c || seen.has(c)) return; seen.add(c); for (const k of c.methods.keys()) s.add(k); v(c.superClass); c.interfaces.forEach(v); }; v(cls); return [...s]; }

  // ------------------------------------------------ Fehler & Ausnahmen
  curClassName() { const f = this.callStack[this.callStack.length - 1]; return f ? f.cls : null; }
  rtError(msg, line) { throw new JavaError(msg, line || this.line, 'runtime', this.curClassName()); }
  stackSnapshot() {
    const tr = []; let line = this.line;
    for (let i = this.callStack.length - 1; i >= 0; i--) { const f = this.callStack[i]; tr.push({ cls: f.cls, method: f.method, line }); line = f.callLine; }
    return tr;
  }
  throwJava(name, msg) {
    const cls = this.classes.get(name);
    const trace = this.stackSnapshot();
    const obj = this.instantiate(cls, msg == null ? [] : [msg], this.line);
    throw new JThrow(obj, trace);
  }
  npe(what) { this.throwJava('NullPointerException', what); }

  // ------------------------------------------------ Ausführung von außen
  // Synchroner Lauf (für kurze Aufgaben der Oberfläche, z. B. toString() anzeigen).
  // Der Zustand eines evtl. pausierten Programms bleibt dabei erhalten.
  run(fn) {
    const saved = { steps: this.steps, depth: this.depth, callStack: this.callStack, line: this.line, nextYield: this.nextYield };
    this.steps = 0; this.depth = 0; this.callStack = []; this.nextYield = 0;
    try { const v = fn(); return { ok: true, value: v }; }
    catch (e) { return this.convertError(e); }
    finally { Object.assign(this, saved); }
  }
  // Treibt einen Generator ohne Pause bis zum Ende (verschachtelte Aufrufe aus
  // eingebauten Methoden heraus, z. B. compareTo beim Sortieren). Hier gilt weiter
  // die Schrittgrenze gegen Endlosschleifen, weil die Oberfläche währenddessen steht.
  runSync(g) {
    const base = this.steps;
    let send, err = null;
    for (;;) {
      const r = err !== null ? g.throw(err) : g.next(send);
      err = null; send = undefined;
      if (r.done) return r.value;
      const y = r.value;
      if (y === TICK) {
        if (this.steps - base > this.maxSteps) err = new JavaError('Ausführung abgebrochen: Das Programm hat zu viele Schritte gebraucht (Endlosschleife?)', this.line, 'runtime', this.curClassName());
        this.nextYield = this.steps + 50000;
      } else if (y instanceof Suspend) {
        try { send = y.sync ? y.sync(this) : undefined; } catch (e) { err = e; }
      }
    }
  }
  // Unterbrechbarer Lauf: makeGen() liefert einen Generator (z. B. callMethodG).
  // Ergebnis: Promise mit demselben Aufbau wie run(); bei „Beenden“ { ok: false, stopped: true }.
  // Zwischen den Zeitscheiben bleibt die Oberfläche bedienbar; Grafik wird live abgespielt.
  runAsync(makeGen) {
    if (this.task) return Promise.resolve({ ok: false, busy: true, message: 'Es läuft bereits ein Programm' });
    this.steps = 0; this.depth = 0; this.callStack = [];
    const task = { stopped: false, resolve: null, startedAt: Date.now() };
    this.task = task;
    const io = this.io;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return new Promise((resolve) => {
      let done = false, g = null, send, err = null, lastPaint = now();
      const finish = (res) => {
        if (done) return; done = true;
        if (this.task === task) this.task = null;
        this.nextYield = 0;
        if (io.onStop) { try { io.onStop(res); } catch (e) { } }
        resolve(res);
      };
      task.finish = finish;
      const fail = (e) => { let res; try { res = this.convertError(e); } catch (x) { res = { ok: false, message: 'Interner Fehler: ' + (x && x.message) }; } finish(res); };
      const later = (fn) => {
        // Kurze Pause, damit Klicks und Grafik dazwischen drankommen. Mindestens alle
        // 50 ms über setTimeout, damit der Browser sicher neu zeichnet.
        if (now() - lastPaint > 50 || typeof MessageChannel === 'undefined') { lastPaint = now(); setTimeout(fn, 0); return; }
        const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); fn(); }; ch.port2.postMessage(0);
      };
      const gfxBusy = () => { const gx = io.gfx; return !!(gx && gx.busy && gx.busy()); };
      const resume = () => {
        if (done || task.stopped) return;
        if (gfxBusy()) { io.gfx.whenIdle(() => later(resume)); return; }
        step();
      };
      const step = () => {
        if (done || task.stopped) return;
        const t0 = now();
        for (;;) {
          this.nextYield = this.steps + 20000;
          let r;
          try { r = err !== null ? g.throw(err) : g.next(send); }
          catch (e) { return fail(e); }
          err = null; send = undefined;
          if (r.done) return finish({ ok: true, value: r.value });
          const y = r.value;
          if (y instanceof Suspend) {
            if (io.onSlice) { try { io.onSlice(); } catch (e) { } }
            let p;
            try { p = Promise.resolve(y.start(this)); } catch (e) { err = e; continue; }
            p.then((v) => { send = v; later(resume); }, (e) => { err = e; later(resume); });
            return;
          }
          if (task.stopped) return;
          if (now() - t0 > 12 || gfxBusy()) break;
        }
        if (io.onSlice) { try { io.onSlice(); } catch (e) { } }
        later(resume);
      };
      try { g = makeGen(); } catch (e) { return fail(e); }
      step();
    });
  }
  get running() { return !!this.task; }
  // Ereignis aus der Oberfläche (Maus, Tastatur, Fenster schließen): die passende Methode
  // des Listener-Objekts aufrufen. Läuft gerade kein Programm, startet der Aufruf als eigener
  // unterbrechbarer Lauf (io.runEvent). Läuft eines (es ist zwischen zwei Zeitscheiben
  // pausiert), wird der Aufruf sofort dazwischen ausgeführt – wie im Java-Ereignis-Thread.
  fireEvent(obj, name, args, label) {
    let gen;
    if (obj.lambda) {
      const fm = this.functionalMethod(obj.cls);
      if (fm && fm.name !== name) return;
      gen = () => this.callLambdaG(obj, args, 0);
    } else {
      const m = this.lookupMethods(obj.cls, name).find(x => !x.abstract && !x.static && x.params.length === args.length);
      if (!m) return;
      gen = () => this.callMethodG(obj, m, args);
    }
    const io = this.io;
    if (this.task) {
      const r = this.run(() => this.runSync(gen()));
      if (io.onEvent) { try { io.onEvent(r, label || name); } catch (e) { } }
      return;
    }
    if (io.runEvent) { io.runEvent(gen, label || name); return; }
    this.runAsync(gen);
  }
  // Laufendes Programm beenden (Knopf „Beenden“). Der Generator wird einfach
  // nicht weiter ausgeführt; der Aufrufstapel wird zurückgesetzt.
  stop() {
    const t = this.task; if (!t) return false;
    t.stopped = true; this.task = null;
    this.depth = 0; this.callStack = [];
    t.finish({ ok: false, stopped: true, message: 'Programm wurde beendet' });
    return true;
  }
  // Beim nächsten Schritt die Kontrolle abgeben (z. B. wenn die Grafik hinterherhängt)
  yieldSoon() { this.nextYield = 0; }
  // Wartet, bis die Grafik alles abgespielt hat (Turtle-Bewegungen, Pausen).
  whenGfxIdle() {
    const gx = this.io.gfx;
    if (!gx || !gx.whenIdle) return Promise.resolve();
    return new Promise((res) => gx.whenIdle(res));
  }
  // Echte Pause (Thread.sleep, delay): im normalen Lauf wird gewartet; in einem
  // verschachtelten Lauf wird die Pause wie bisher als Grafikbefehl aufgezeichnet.
  sleep(ms, value) {
    ms = Math.max(0, Number(ms) || 0);
    return new Suspend(
      () => this.whenGfxIdle().then(() => new Promise((res) => { const gx = this.io.gfx; setTimeout(() => res(value), gx && gx.skipping && gx.skipping() ? 0 : ms); })),
      () => { const gx = this.io.gfx; if (gx && ms > 0) gx.op(0, { t: 'sleep', ms }); return value; });
  }
  // Eingabe o. Ä.: erst die Grafik fertig abspielen, dann fn() ausführen.
  afterGfx(fn) { return new Suspend(() => this.whenGfxIdle().then(() => fn()), () => fn()); }
  convertError(e) {
    if (e instanceof JThrow) {
      let msg; try { msg = this.str(e.obj); } catch (_) { msg = e.obj.cls.fullName; }
      const top = e.trace[0] || {};
      return { ok: false, exception: true, message: msg, trace: e.trace, line: top.line, className: top.cls };
    }
    if (e instanceof JavaError) return { ok: false, message: e.message, line: e.line, className: e.className, kind: e.kind };
    if (e instanceof ExitSig) return { ok: true, value: undefined, exited: e.code };
    if (e instanceof RangeError) {
      const tr = this.stackSnapshot().slice(0, 6);
      return { ok: false, exception: true, message: 'java.lang.StackOverflowError (Rekursion zu tief – fehlt eine Abbruchbedingung?)', trace: tr, line: tr[0] && tr[0].line, className: tr[0] && tr[0].cls };
    }
    if (e === BREAK || e === CONTINUE) return { ok: false, message: 'break/continue außerhalb einer Schleife' };
    if (e instanceof YieldSig) return { ok: false, message: 'yield außerhalb eines switch-Ausdrucks' };
    if (e instanceof ReturnSig) return { ok: true, value: e.value };
    throw e;
  }

  // ------------------------------------------------ Klassen-Initialisierung
  // Statische Initialisierung läuft ohne Pause (verschachtelt), wie ein Block.
  ensureStaticInit(cls) {
    if (!cls || cls.staticInit || cls.native) return;
    cls.staticInit = 1;
    if (cls.superClass) this.ensureStaticInit(cls.superClass);
    const d = cls.decl; if (!d) return;
    for (const f of d.fields) if (f.static) cls.staticValues[f.name] = defaultValue(f.type);
    this.callStack.push({ cls: cls.name, method: '<clinit>', callLine: this.line });
    try {
      const ctx = { self: null, cls, env: new Env(null), isStatic: true, clinit: true };
      d.enumConsts.forEach((ec, i) => {
        this.line = ec.line;
        const o = new JObject(cls);
        o.enumName = ec.name; o.ordinal = i;
        for (let c = cls; c; c = c.superClass) for (const f of c.fieldList) if (!f.static) o.fields[f.name] = defaultValue(f.type);
        cls.staticValues[ec.name] = o; cls.enumConsts.push(o);
        const args = ec.args.map(a => this.eval(a, ctx));
        this.runSync(this.runCtorG(cls, o, args, ec.line));
      });
      for (const f of d.fields) if (f.static && f.init) { this.line = f.line; cls.staticValues[f.name] = this.initValue(f.init, f.type, ctx); }
      for (const b of d.inits) if (b.static) this.runSync(this.exec(b.body, ctx));
    } finally { this.callStack.pop(); }
  }
  initValue(init, type, ctx) {
    if (init.k === 'ArrayInit') return this.arrayInit(init, type, ctx);
    return this.coerce(this.eval(init, ctx), type, init.line);
  }
  *initValueG(init, type, ctx) {
    if (isPure(init)) return this.initValue(init, type, ctx);
    if (init.k === 'ArrayInit') return yield* this.arrayInitG(init, type, ctx);
    return this.coerce(yield* this.geval(init, ctx), type, init.line);
  }

  // ------------------------------------------------ Lambdas und Methodenreferenzen
  // Ein Lambda ist ein Objekt des Ziel-Interfaces (z. B. Comparator) mit o.lambda:
  // { e, env, self, cls } (Lambda-Ausdruck), { ref } (Methodenreferenz) oder { native(rt, args) }.
  makeLambda(iface, L) {
    const o = new JObject(this.classes.get(iface) || this.classes.get('Object'));
    o.lambda = L;
    return o;
  }
  nativeLambda(iface, fn) { return this.makeLambda(iface, { native: fn }); }
  // Die eine abstrakte Methode eines funktionalen Interfaces (sonst null)
  functionalMethod(c) {
    if (!c || !c.isInterface) return null;
    if (c.$fm !== undefined) return c.$fm;
    const abs = new Map(), seen = new Set();
    const visit = (k) => { if (!k || seen.has(k)) return; seen.add(k); for (const m of k.methodList) if (m.abstract && !m.static && !['equals', 'hashCode', 'toString'].includes(m.name)) { const key = m.name + '/' + m.params.length; if (!abs.has(key)) abs.set(key, m); } k.interfaces.forEach(visit); };
    visit(c);
    return (c.$fm = abs.size === 1 ? [...abs.values()][0] : null);
  }
  *callLambdaG(o, args, line) {
    const L = o.lambda;
    if (L.native) { const r = L.native(this, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; }
    if (L.ref) return yield* this.callRefG(L.ref, args, line);
    const e = L.e;
    if (e.params.length !== args.length) this.rtError(`Der Lambda-Ausdruck erwartet ${e.params.length} Parameter, übergeben wurden ${args.length}`, line);
    if (++this.depth > this.maxDepth) { this.depth = 0; this.throwJava('StackOverflowError'); }
    const env = new Env(L.env);
    for (let i = 0; i < args.length; i++) { const p = e.params[i]; env.declare(p.name, p.type, p.type ? this.coerce(args[i], p.type, line) : args[i]); }
    const ctx = { self: L.self, cls: L.cls, env, isStatic: L.isStatic, method: null, lambda: true };
    this.callStack.push({ cls: L.cls ? L.cls.name : '?', method: 'lambda$', callLine: this.line });
    const fm = this.functionalMethod(o.cls);
    const ret = fm && fm.ret && fm.ret.name !== 'void' && (PRIMS.has(fm.ret.name) || fm.ret.name === 'String') ? fm.ret : null;
    try {
      if (++this.steps >= this.nextYield) yield TICK;
      let v;
      if (e.expr) { this.line = e.body.line; v = isPure(e.body) ? this.eval(e.body, ctx) : yield* this.geval(e.body, ctx); }
      else { this.line = e.body.line; yield* this.execList(e.body.stmts, ctx); v = undefined; }
      return ret && v !== undefined ? this.coerce(v, ret, this.line) : v;
    } catch (x) {
      if (x instanceof ReturnSig) return ret && x.value !== undefined ? this.coerce(x.value, ret, this.line) : x.value;
      throw x;
    } finally { this.depth--; this.callStack.pop(); this.line = line; }
  }
  // Klasse::methode, objekt::methode, Klasse::new
  *callRefG(R, args, line) {
    const t = R.target, name = R.name;
    if (t instanceof JClassRef) {
      const c = t.cls;
      if (name === 'new') return yield* this.instantiateG(c, args, line, T(c.name), null);
      if (c.native) {
        const f = c.native.statics && c.native.statics[name];
        if (f) { const r = f(this, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; }
      } else if (!(c.isEnum && ['values', 'valueOf'].includes(name))) {
        const ms = this.lookupMethods(c, name);
        const st = ms.filter(m => m.static && m.params.length === args.length);
        if (st.length) return yield* this.invokeG(this.selectOverload(st, args, name, line), null, args, line);
        if (!ms.length && !['toString', 'equals', 'hashCode', 'compareTo', 'name', 'ordinal'].includes(name)) this.rtError(`Klasse ${c.name} hat keine Methode '${name}'`, line);
      } else return yield* this.callOnG(t, name, args, line, null);
      // Objektmethode: das erste Argument ist das Objekt
      if (!args.length) this.rtError(`${c.name}::${name} braucht ein Objekt als ersten Wert`, line);
      return yield* this.callOnG(args[0], name, args.slice(1), line, null);
    }
    return yield* this.callOnG(t, name, args, line, null);
  }
  // Methode eines Lambda-Objekts: Methoden von Object, default-Methoden des Interfaces,
  // sonst die funktionale Methode
  *lambdaMethodG(o, name, args, line) {
    const ms = this.lookupMethods(o.cls, name).filter(m => !m.abstract && m.params.length === args.length);
    if (ms.length) { const m = this.selectOverload(ms, args, name, line); return yield* this.invokeG(m, m.static ? null : o, args, line); }
    if (['equals', 'hashCode', 'toString', 'getClass'].includes(name) && !this.lookupMethods(o.cls, name).length) return this.objectMethod(o, name, args, line);
    const fm = this.functionalMethod(o.cls);
    if (fm && fm.name !== name && o.cls.name !== 'Object') this.rtError(`Methode '${name}' gibt es für ${o.cls.name} nicht`, line);
    return yield* this.callLambdaG(o, args, line);
  }
  // Funktionales Objekt (Lambda oder Objekt einer eigenen Klasse) synchron aufrufen,
  // z. B. beim Sortieren mit einem Comparator
  callFn(f, name, args) {
    if (f === null || f === undefined) this.npe(name + '() auf null');
    if (f instanceof JObject && f.lambda) return this.runSync(this.lambdaMethodG(f, name, args, this.line));
    return this.runSync(this.callOnG(f, name, args, this.line, null));
  }
  *fnG(f, name, args, line) {
    if (f === null || f === undefined) this.npe(name + '() auf null');
    if (f instanceof JObject && f.lambda) return yield* this.lambdaMethodG(f, name, args, line || this.line);
    return yield* this.callOnG(f, name, args, line || this.line, null);
  }
  // Vergleichsfunktion für sort: natürliche Ordnung oder Comparator
  cmpOf(c) {
    if (c === null || c === undefined) return (x, y) => this.compareValues(x, y);
    return (x, y) => this.toInt(this.callFn(c, 'compare', [x, y]));
  }

  // ------------------------------------------------ Objekte erzeugen
  instantiate(cls, args, line, type) { return this.runSync(this.instantiateG(cls, args, line, type)); }
  topOf(c) { while (c && c.outer) c = c.outer; return c; }
  // Objekt der umgebenden Klasse, zu dem o (auf Ebene der Klasse c) gehört
  outerObj(o, c) { return o && o.outers ? o.outers.get(c) || null : null; }
  // Innere, lokale und anonyme Klassen: das umgebende Objekt und die eingefangenen
  // lokalen Variablen merken (je Klassenebene, falls eine solche Klasse erweitert wird)
  bindOuter(obj, cls, ctx) {
    for (let c = cls; c && c.decl; c = c.superClass) {
      if (!c.outer || c.staticNested) continue;
      if (!obj.outers) obj.outers = new Map();
      if (c.nestKind === 'member') {
        let o = ctx ? ctx.self : null, k = ctx ? ctx.cls : null;
        while (o && !o.cls.isSubclassOf(c.outer)) { o = this.outerObj(o, k); k = k && k.outer; }
        obj.outers.set(c, o || null);
      } else {
        obj.outers.set(c, ctx && !ctx.isStatic ? ctx.self : null);
        if (!obj.caps) obj.caps = new Map();
        obj.caps.set(c, ctx ? ctx.env : null);
      }
    }
  }
  // Name außerhalb der eigenen Klasse suchen: eingefangene lokale Variablen, dann die
  // Attribute der umgebenden Klassen (von innen nach außen)
  outerName(ctx, name) {
    let c = ctx.cls, o = ctx.self;
    while (c && c.outer) {
      const cap = o && o.caps ? o.caps.get(c) : null;
      if (cap) { const v = cap.lookup(name); if (v) return { local: v }; }
      o = this.outerObj(o, c); c = c.outer;
      const f = this.findField(c, name);
      if (f) return { f, self: o };
    }
    return null;
  }
  outerThis(e, ctx) {
    const target = this.classes.get(e.name);
    if (!target) this.rtError(`Klasse '${e.name}' nicht gefunden`, e.line);
    let o = ctx.self, k = ctx.cls;
    while (o && !o.cls.isSubclassOf(target)) { o = this.outerObj(o, k); k = k && k.outer; }
    if (!o) this.rtError(`${e.name}.this gibt es hier nicht`, e.line);
    return o;
  }
  *instantiateG(cls, args, line, type, ctx) {
    if (cls.native) {
      if (!cls.native.ctor) this.rtError(`Von ${cls.name} können keine Objekte mit new erzeugt werden`, line);
      return cls.native.ctor(this, args, line, type);
    }
    if (cls.isInterface) this.rtError(`${cls.name} ist ein Interface – davon können keine Objekte erzeugt werden`, line);
    if (cls.isAbstract) this.rtError(`${cls.name} ist abstrakt – davon können keine Objekte erzeugt werden`, line);
    if (cls.isEnum) this.rtError(`Von einem enum können keine Objekte mit new erzeugt werden`, line);
    this.ensureStaticInit(cls);
    const obj = new JObject(cls);
    for (let c = cls; c; c = c.superClass) for (const f of c.fieldList) if (!f.static) obj.fields[f.name] = defaultValue(f.type);
    if (cls.outer || (cls.superClass && cls.superClass.outer)) this.bindOuter(obj, cls, ctx);
    yield* this.runCtorG(cls, obj, args, line);
    return obj;
  }
  *runCtorG(cls, obj, args, line) {
    if (cls && cls.native) { if (cls.native.initInstance) cls.native.initInstance(this, obj, args, line); return; }
    if (!cls || !cls.decl) return;
    let ctor = null;
    const anon = !!cls.decl.anonBase;
    if (!cls.ctors.length) { if (args.length && !anon) this.rtError(`Klasse ${cls.name} hat keinen Konstruktor mit ${args.length} Parameter(n)`, line); }
    else ctor = this.selectOverload(cls.ctors, args, cls.name, line);
    if (++this.depth > this.maxDepth) { this.depth = 0; this.throwJava('StackOverflowError'); }
    this.callStack.push({ cls: cls.name, method: cls.name, callLine: this.line });
    const env = new Env(null);
    if (ctor) ctor.params.forEach((p, i) => env.declare(p.name, p.type, this.coerce(args[i], p.type, line)));
    const ctx = { self: obj, cls, env, isStatic: false, ctor: true };
    try {
      let stmts = ctor ? ctor.body.stmts : [];
      const first = stmts[0]; let explicitThis = false;
      if (first && first.k === 'Expr' && first.e.k === 'CtorCall') {
        this.line = first.line;
        const cargs = yield* this.argsG(first.e.args, ctx);
        if (first.e.which === 'super') yield* this.runCtorG(cls.superClass, obj, cargs, first.line);
        else { explicitThis = true; yield* this.runCtorG(cls, obj, cargs, first.line); }
        stmts = stmts.slice(1);
      } else if (cls.superClass) yield* this.runCtorG(cls.superClass, obj, anon ? args : [], line);
      if (!explicitThis) {
        for (const f of cls.decl.fields) if (!f.static && f.init) { this.line = f.line; obj.fields[f.name] = yield* this.initValueG(f.init, f.type, { self: obj, cls, env: new Env(null), isStatic: false, ctor: true }); }
        for (const b of cls.decl.inits) if (!b.static) yield* this.exec(b.body, ctx);
      }
      try { for (const s of stmts) yield* this.exec(s, ctx); }
      catch (e) { if (!(e instanceof ReturnSig)) throw e; }
    } finally { this.depth--; this.callStack.pop(); this.line = line; }
  }
  // Argumentliste auswerten (ohne Generator, wenn kein Argument einen Aufruf enthält)
  *argsG(list, ctx) {
    const n = list.length, out = new Array(n);
    for (let i = 0; i < n; i++) { const a = list[i]; out[i] = isPure(a) ? this.eval(a, ctx) : yield* this.geval(a, ctx); }
    return out;
  }
  // ------------------------------------------------ Methoden
  matchScore(v, t) {
    if (!t) return 1;
    if (t.dims > 0) return v === null ? 1 : (v instanceof JArray ? (v.elemType.dims === t.dims - 1 && (v.elemType.name === t.name || t.name === 'Object') ? 3 : (v.elemType.dims === t.dims - 1 && !PRIMS.has(t.name) ? 1 : -1e9)) : -1e9);
    const n = t.name;
    if (PRIMS.has(n) || WRAP[n]) {
      const p = WRAP[n] || n; const wrapped = !!WRAP[n];
      const k = this.kindOf(v);
      if (v === null) return wrapped ? 1 : -1e9;
      const s = (() => {
        if (p === 'boolean') return k === 'boolean' ? 3 : -1e9;
        if (k === 'boolean' || !k) return -1e9;
        const order = { char: 0, int: 1, long: 2, double: 3 };
        const pk = p === 'short' || p === 'byte' ? 'int' : p === 'float' ? 'double' : p;
        if (k === pk) return 3;
        if (pk === 'char') return -1e9;
        if (order[k] < order[pk]) return 2 - order[pk] * 0.1;
        return -1e9;
      })();
      return wrapped && s > 0 ? s - 0.5 : s;
    }
    if (n === 'Object') return v === undefined ? -1e9 : 0.5;
    if (n === 'String' || n === 'CharSequence') return typeof v === 'string' ? 3 : v === null ? 1 : -1e9;
    const c = this.classes.get(n);
    if (!c) return 0.5;
    if (v === null) return 1;
    if (v instanceof JObject && v.lambda && c.isInterface) {
      if (v.cls === c) return 3;
      const fm = this.functionalMethod(c); if (!fm) return -1e9;
      if (v.lambda.e && v.lambda.e.params.length !== fm.params.length) return -1e9;
      return v.cls.name === 'Object' ? 1 : 0.8;
    }
    if (v instanceof JObject && v.cls.isSubclassOf(c)) { let d = 0; for (let k = v.cls; k && k !== c; k = k.superClass) d++; return 3 - d * 0.01; }
    if (n === 'Comparable' && (typeof v === 'string' || this.kindOf(v))) return 1;
    return -1e9;
  }
  selectOverload(ms, args, name, line) {
    const cands = ms.filter(m => m.params.length === args.length);
    if (!cands.length) {
      const ar = [...new Set(ms.map(m => m.params.length))].join(' oder ');
      this.rtError(`${name} erwartet ${ar} Parameter, übergeben wurden ${args.length}`, line);
    }
    let best = null, bs = -Infinity;
    for (const m of cands) {
      let s = 0; for (let i = 0; i < args.length; i++) s += this.matchScore(args[i], m.params[i].type);
      if (m.abstract) s -= 0.001;
      if (s > bs) { bs = s; best = m; }
    }
    if (bs < -1e8) {
      const m = cands[0];
      this.rtError(`${name}(${m.params.map(p => typeStr(p.type)).join(', ')}) kann nicht mit (${args.map(a => this.typeNameOf(a)).join(', ')}) aufgerufen werden`, line);
    }
    return best;
  }
  invoke(m, self, args, line) { return this.runSync(this.invokeG(m, self, args, line)); }
  *invokeG(m, self, args, line) {
    if (m.abstract) this.rtError(`Abstrakte Methode ${m.name} kann nicht aufgerufen werden`, line);
    if (m.static) this.ensureStaticInit(m.cls);
    if (++this.depth > this.maxDepth) { this.depth = 0; this.throwJava('StackOverflowError'); }
    const env = new Env(null);
    for (let i = 0; i < m.params.length; i++) env.declare(m.params[i].name, m.params[i].type, this.coerce(args[i], m.params[i].type, line));
    const ctx = { self: m.static ? null : self, cls: m.cls, env, isStatic: m.static, method: m };
    this.callStack.push({ cls: m.cls.name, method: m.name, callLine: this.line });
    try {
      if (++this.steps >= this.nextYield) yield TICK;
      this.line = m.body.line;
      yield* this.execList(m.body.stmts, ctx);
      if (m.ret.name !== 'void') this.rtError(`Methode ${m.name} endet ohne return`, m.body.endLine);
      return undefined;
    } catch (e) {
      if (e instanceof ReturnSig) return m.ret.name === 'void' ? undefined : this.coerce(e.value, m.ret, this.line);
      throw e;
    } finally { this.depth--; this.callStack.pop(); this.line = line; }
  }
  invokeVirtual(obj, m, args, line) { return this.runSync(this.invokeVirtualG(obj, m, args, line)); }
  *invokeVirtualG(obj, m, args, line) {
    if (obj instanceof JObject && obj.lambda && !m.static) return m.abstract ? yield* this.callLambdaG(obj, args, line) : yield* this.invokeG(m, obj, args, line);
    if (m.static || !(obj instanceof JObject) || obj.cls.native) return yield* this.invokeG(m, obj, args, line);
    const sig = m.params.map(p => typeStr(p.type)).join(',');
    const impl = this.lookupMethods(obj.cls, m.name).find(x => !x.abstract && x.params.map(p => typeStr(p.type)).join(',') === sig)
      || this.lookupMethods(obj.cls, m.name).find(x => !x.abstract && x.params.length === m.params.length) || m;
    return yield* this.invokeG(impl, obj, args, line);
  }

  // ------------------------------------------------ Typen & Werte
  kindOf(v) {
    if (typeof v === 'number') return 'int';
    if (v instanceof JDouble) return 'double';
    if (typeof v === 'bigint') return 'long';
    if (v instanceof JChar) return 'char';
    if (typeof v === 'boolean') return 'boolean';
    return null;
  }
  typeNameOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'void';
    switch (typeof v) { case 'number': return 'int'; case 'bigint': return 'long'; case 'boolean': return 'boolean'; case 'string': return 'String'; }
    if (v instanceof JDouble) return 'double';
    if (v instanceof JChar) return 'char';
    if (v instanceof JArray) return typeStr(v.elemType) + '[]';
    if (v instanceof JObject) return v.cls.name;
    if (v instanceof JClassRef) return 'Klasse ' + v.cls.name;
    return '?';
  }
  typeOfValue(v) {
    if (v instanceof JArray) return { ...v.elemType, dims: v.elemType.dims + 1 };
    if (v instanceof JObject && v.native && v.native.elemType) return T(v.cls.name, 0, [v.native.elemType]);
    return T(this.typeNameOf(v) === 'null' ? 'Object' : this.typeNameOf(v));
  }
  isInstance(v, t) {
    if (v === null || v === undefined) return false;
    if (t.dims > 0) return v instanceof JArray && v.elemType.dims === t.dims - 1 && (t.name === 'Object' || v.elemType.name === t.name || (v.elemType.dims === 0 && !PRIMS.has(t.name)));
    if (t.name === 'Object') return true;
    if (t.name === 'String' || t.name === 'CharSequence') return typeof v === 'string';
    if (WRAP[t.name]) { const k = this.kindOf(v); return k === WRAP[t.name] || (k === 'int' && ['short', 'byte'].includes(WRAP[t.name])); }
    const c = this.classes.get(t.name);
    if (!c) return true;
    if (c.name === 'Comparable' && (typeof v === 'string' || this.kindOf(v))) return true;
    if (v instanceof JObject && v.lambda && c.isInterface && v.cls.name === 'Object') return true;
    return v instanceof JObject && v.cls.isSubclassOf(c);
  }
  num(v, line) {
    if (typeof v === 'number') return v;
    if (v instanceof JDouble) return v.v;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof JChar) return v.c;
    if (v === null) this.npe('Rechnen mit null nicht möglich');
    this.rtError(`Zahl erwartet, aber ${this.typeNameOf(v)} gefunden`, line);
  }
  toInt(v, line) {
    if (typeof v === 'number') return v;
    if (v instanceof JChar) return v.c;
    if (v === null) this.npe();
    this.rtError(`int erwartet, aber ${this.typeNameOf(v)} gefunden`, line);
  }
  coerce(v, t, line) {
    if (!t || t.name === 'var') return v;
    if (v === undefined) this.rtError('Die Methode liefert keinen Wert (void)', line);
    if (v === UNINIT) this.rtError('Variable wurde nicht initialisiert', line);
    if (t.dims > 0) {
      if (v === null) return v;
      if (v instanceof JArray && v.elemType.dims === t.dims - 1) {
        const en = v.elemType.name;
        if (en === t.name || t.name === 'Object' || (!PRIMS.has(en) && !PRIMS.has(t.name))) return v;
      }
    } else switch (t.name) {
      case 'int': case 'short': case 'byte':
        if (typeof v === 'number') return t.name === 'int' ? v : (t.name === 'short' ? (v << 16) >> 16 : (v << 24) >> 24);
        if (v instanceof JChar) return v.c; break;
      case 'long': if (typeof v === 'bigint') return v; if (typeof v === 'number') return BigInt(v); if (v instanceof JChar) return BigInt(v.c); break;
      case 'double': case 'float': if (v instanceof JDouble) return v; if (typeof v === 'number') return new JDouble(v); if (typeof v === 'bigint') return new JDouble(Number(v)); if (v instanceof JChar) return new JDouble(v.c); break;
      case 'char': if (v instanceof JChar) return v; if (typeof v === 'number' && v >= 0 && v <= 65535) return new JChar(v); break;
      case 'boolean': if (typeof v === 'boolean') return v; break;
      case 'Integer': case 'Short': case 'Byte': if (v === null || typeof v === 'number') return v; if (v instanceof JChar) return v.c; break;
      case 'Long': if (v === null || typeof v === 'bigint') return v; if (typeof v === 'number') return BigInt(v); break;
      case 'Double': case 'Float': if (v === null || v instanceof JDouble) return v; if (typeof v === 'number') return new JDouble(v); break;
      case 'Character': if (v === null || v instanceof JChar) return v; break;
      case 'Boolean': if (v === null || typeof v === 'boolean') return v; break;
      case 'String': if (v === null || typeof v === 'string') return v; break;
      case 'Object': if (!(v instanceof JClassRef)) return v; break;
      default: {
        const c = this.classes.get(t.name);
        if (!c) { if (!(v instanceof JClassRef)) return v; break; }
        if (v === null) return v;
        if (v instanceof JObject && v.lambda && c.isInterface && !v.cls.isSubclassOf(c)) { if (v.cls.name === 'Object' || !this.functionalMethod(v.cls)) v.cls = c; return v; }
        if (v instanceof JObject && v.cls.isSubclassOf(c)) {
          if (v.native && t.args && t.args.length) {
            if (v.native.list && !v.native.elemType) v.native.elemType = t.args[0];
            if (v.native.keys && !v.native.kType) { v.native.kType = t.args[0]; v.native.vType = t.args[1]; }
          }
          return v;
        }
        if ((c.name === 'Comparable' || c.name === 'CharSequence') && (typeof v === 'string' || this.kindOf(v))) return v;
      }
    }
    const from = this.typeNameOf(v), to = typeStr(t);
    const order = { byte: 0, short: 1, char: 1, int: 2, long: 3, float: 4, double: 5 };
    const lossy = order[from] !== undefined && order[t.name] !== undefined && t.dims === 0 && order[from] > order[t.name];
    this.rtError(lossy ? `Inkompatible Typen: möglicher Genauigkeitsverlust bei Umwandlung von ${from} nach ${to} (ggf. mit (${to}) umwandeln)` : `Inkompatible Typen: ${from} kann nicht in ${to} umgewandelt werden`, line);
  }
  cast(v, t, line) {
    if (t.dims === 0 && PRIMS.has(t.name)) {
      if (t.name === 'boolean') { if (typeof v === 'boolean') return v; this.rtError(`${this.typeNameOf(v)} kann nicht in boolean umgewandelt werden`, line); }
      if (v === null) this.npe();
      const k = this.kindOf(v);
      if (!k || k === 'boolean') this.rtError(`${this.typeNameOf(v)} kann nicht in ${t.name} umgewandelt werden`, line);
      switch (t.name) {
        case 'int': case 'short': case 'byte': {
          let r;
          if (k === 'double') { const x = v.v; r = Number.isNaN(x) ? 0 : x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : Math.trunc(x); }
          else if (k === 'long') r = Number(BigInt.asIntN(32, v));
          else r = k === 'char' ? v.c : v;
          if (t.name === 'short') r = (r << 16) >> 16; else if (t.name === 'byte') r = (r << 24) >> 24;
          return r;
        }
        case 'long': {
          if (k === 'double') { const x = v.v; if (Number.isNaN(x)) return 0n; if (x >= 9.223372036854776e18) return 9223372036854775807n; if (x <= -9.223372036854776e18) return -9223372036854775808n; return BigInt(Math.trunc(x)); }
          return k === 'long' ? v : BigInt(k === 'char' ? v.c : v);
        }
        case 'double': case 'float': { let x = this.num(v); if (t.name === 'float') x = Math.fround(x); return new JDouble(x); }
        case 'char': { const x = k === 'double' ? Math.trunc(v.v) : k === 'long' ? Number(BigInt.asUintN(16, v)) : (k === 'char' ? v.c : v); return new JChar(((x % 65536) + 65536) % 65536); }
      }
    }
    if (v === null) return null;
    if (WRAP[t.name] && t.dims === 0) return this.coerce(v, t, line);
    if (!this.isInstance(v, t)) this.throwJava('ClassCastException', `class ${this.typeNameOf(v)} cannot be cast to class ${typeStr(t)}`);
    return v;
  }

  // ------------------------------------------------ Strings & Vergleiche
  str(v) {
    if (v === null) return 'null';
    if (v === undefined) return '';
    switch (typeof v) { case 'string': return v; case 'number': return String(v); case 'bigint': return v.toString(); case 'boolean': return v ? 'true' : 'false'; }
    if (v instanceof JDouble) return fmtDouble(v.v);
    if (v instanceof JChar) return String.fromCharCode(v.c);
    if (v instanceof JArray) {
      const codes = { int: 'I', double: 'D', char: 'C', boolean: 'Z', long: 'J', float: 'F', short: 'S', byte: 'B' };
      const et = v.elemType;
      const code = '['.repeat(et.dims + 1) + (et.dims === 0 && codes[et.name] ? codes[et.name] : 'L' + (et.name === 'String' ? 'java.lang.String' : et.name) + ';');
      return code + '@' + idHash(v.id);
    }
    if (v instanceof JObject) return this.objToString(v);
    if (v instanceof JClassRef) return 'class ' + v.cls.name;
    return String(v);
  }
  objToString(o) {
    if (o.lambda) { const m = this.lookupMethods(o.cls, 'toString').find(x => x.params.length === 0 && !x.abstract && !x.static); if (!m) return (o.lambda.cls ? o.lambda.cls.name : 'Lambda') + '$$Lambda@' + idHash(o.id); }
    if (o.cls.native) { if (o.cls.native.toString) return o.cls.native.toString(this, o); return o.cls.fullName + '@' + idHash(o.id); }
    const m = this.lookupMethods(o.cls, 'toString').find(x => x.params.length === 0 && !x.abstract && !x.static);
    if (m) { const r = this.invoke(m, o, [], this.line); return r === null ? 'null' : this.str(r); }
    if (o.enumName !== undefined) return o.enumName;
    return o.cls.fullName + '@' + idHash(o.id);
  }
  javaEquals(a, b) {
    if (a === null || b === null) return a === b;
    const ka = this.kindOf(a), kb = this.kindOf(b);
    if (ka && kb) { if (ka === 'boolean' || kb === 'boolean') return a === b; return this.num(a) === this.num(b) && (ka === kb || (ka !== 'double' && kb !== 'double')); }
    if (typeof a === 'string') return a === b;
    if (a instanceof JObject) {
      if (!a.cls.native) {
        const m = this.lookupMethods(a.cls, 'equals').find(x => x.params.length === 1 && !x.abstract && !x.static);
        if (m) return this.invoke(m, a, [b], this.line) === true;
      } else if (a.native && a.native.list && b instanceof JObject && b.native && b.native.list) {
        const x = a.native.list, y = b.native.list;
        return x.length === y.length && x.every((e, i) => this.javaEquals(e, y[i]));
      }
    }
    return a === b;
  }
  compareValues(a, b) {
    if (a === null || b === null) this.npe('Vergleich mit null');
    if (typeof a === 'string' && typeof b === 'string') return cmpStr(a, b);
    const ka = this.kindOf(a), kb = this.kindOf(b);
    if (ka && kb && ka !== 'boolean') { const x = this.num(a), y = this.num(b); return x < y ? -1 : x > y ? 1 : 0; }
    if (ka === 'boolean' && kb === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    if (a instanceof JObject) {
      if (a.enumName !== undefined && b instanceof JObject) return a.ordinal - b.ordinal;
      const m = this.lookupMethods(a.cls, 'compareTo').find(x => x.params.length === 1 && !x.abstract);
      if (m) return this.toInt(this.invoke(m, a, [b], this.line));
    }
    this.throwJava('ClassCastException', `class ${this.typeNameOf(a)} cannot be cast to class java.lang.Comparable`);
  }
  hashOf(v) {
    if (v === null) return 0;
    if (typeof v === 'string') return strHash(v);
    if (typeof v === 'number') return v;
    if (v instanceof JObject && !v.cls.native) {
      const m = this.lookupMethods(v.cls, 'hashCode').find(x => x.params.length === 0 && !x.abstract);
      if (m) return this.toInt(this.invoke(m, v, [], this.line));
    }
    if (v instanceof JObject || v instanceof JArray) return parseInt(idHash(v.id), 16);
    return strHash(this.str(v));
  }

  // ------------------------------------------------ Anweisungen
  // exec ist ein Generator: Jede Anweisung zählt einen Schritt; ist die Zeitscheibe
  // verbraucht, wird mit `yield TICK` die Kontrolle abgegeben.
  *exec(s, ctx) {
    if (++this.steps >= this.nextYield) yield TICK;
    this.line = s.line;
    switch (s.k) {
      case 'Block': {
        const c2 = { ...ctx, env: new Env(ctx.env) };
        const stmts = s.stmts;
        for (let i = 0, n = stmts.length; i < n; i++) {
          const st = stmts[i];
          if (st.$se === pureEpoch ? st.$s : this.markSimple(st)) { this.execSimple(st, c2); if (this.steps >= this.nextYield) yield TICK; }
          else if (st.$c) {
            // Aufruf als Anweisung (z. B. liste.add(x)): eingebaute Methoden ohne Generator
            ++this.steps; this.line = st.line;
            const e = st.e, o = this.eval(e.obj, c2), args = e.args.map(a => this.eval(a, c2));
            this.line = e.line;
            const r = this.nativeFast(o, e.name, args, e.line);
            if (r === NOFAST) { if (e.$n === undefined) e.$n = false; yield* this.callOnG(o, e.name, args, e.line, c2); }
            else { this.learnNative(e, r); if (r instanceof Suspend) { if (r.g) yield* r.g; else yield r; } }
            if (this.steps >= this.nextYield) yield TICK;
          }
          else yield* this.exec(st, c2);
        }
        return;
      }
      case 'Local':
        for (const d of s.decls) {
          let v = UNINIT, t = d.type;
          if (d.init) {
            v = isPure(d.init) ? this.initValue(d.init, t.name === 'var' ? null : t, ctx) : yield* this.initValueG(d.init, t.name === 'var' ? null : t, ctx);
            if (t.name === 'var') { if (d.init.k === 'ArrayInit') this.rtError('var kann nicht mit { … } verwendet werden'); t = this.typeOfValue(v); }
          }
          ctx.env.declare(d.name, t, v);
        }
        return;
      case 'Expr': {
        const e = s.e;
        if (e.k === 'Call') {
          if (e.obj && e.obj.k !== 'Super' && isPure(e.obj) && allPure(e.args)) {
            // Aufruf als Anweisung, z. B. liste.add(x) oder t.forward(10)
            const o = this.eval(e.obj, ctx), args = e.args.map(a => this.eval(a, ctx));
            this.line = e.line;
            const r = this.nativeFast(o, e.name, args, e.line);
            if (r === NOFAST) { if (e.$n === undefined) e.$n = false; yield* this.callOnG(o, e.name, args, e.line, ctx); }
            else { this.learnNative(e, r); if (r instanceof Suspend) { if (r.g) yield* r.g; else yield r; } }
          } else yield* this.evalCallG(e, ctx);
        } else if (e.k === 'Assign') yield* this.evalAssignG(e, ctx); else yield* this.geval(e, ctx); return; }
      case 'Empty': return;
      case 'If': if (isPure(s.c) ? this.cond(s.c, ctx) : yield* this.condG(s.c, ctx)) yield* this.exec(s.a, ctx); else if (s.b) yield* this.exec(s.b, ctx); return;
      case 'While': {
        while (isPure(s.c) ? this.cond(s.c, ctx) : yield* this.condG(s.c, ctx)) {
          try { if (s.body.$se === pureEpoch ? s.body.$s : this.markSimple(s.body)) this.execSimple(s.body, ctx); else yield* this.exec(s.body, ctx); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
          if (++this.steps >= this.nextYield) yield TICK;
        }
        return;
      }
      case 'DoWhile': {
        do {
          try { if (s.body.$se === pureEpoch ? s.body.$s : this.markSimple(s.body)) this.execSimple(s.body, ctx); else yield* this.exec(s.body, ctx); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
          if (++this.steps >= this.nextYield) yield TICK;
        } while (isPure(s.c) ? this.cond(s.c, ctx) : yield* this.condG(s.c, ctx));
        return;
      }
      case 'For': {
        const c2 = { ...ctx, env: new Env(ctx.env) };
        for (const i of s.init) yield* this.exec(i, c2);
        for (; !s.c || (isPure(s.c) ? this.cond(s.c, c2) : yield* this.condG(s.c, c2));) {
          this.line = s.line;
          if (++this.steps >= this.nextYield) yield TICK;
          try { if (s.body.$se === pureEpoch ? s.body.$s : this.markSimple(s.body)) this.execSimple(s.body, c2); else yield* this.exec(s.body, c2); } catch (e) { if (e === BREAK) break; if (e !== CONTINUE) throw e; }
          if (allPure(s.upd)) this.runUpdates(s.upd, c2); else for (const u of s.upd) yield* this.geval(u, c2);
        }
        return;
      }
      case 'ForEach': {
        const coll = isPure(s.it) ? this.eval(s.it, ctx) : yield* this.geval(s.it, ctx);
        if (coll === null) this.npe('for-each über null');
        let items, live = null;
        if (coll instanceof JArray) items = coll.data;
        else if (coll instanceof JObject && coll.native && coll.native.list) { items = coll.native.list; live = items.length; }
        else if (coll instanceof JObject && coll.native && coll.native.keys) this.rtError('Über eine Map kann nicht direkt iteriert werden – verwende keySet(), values() oder entrySet()', s.line);
        else if (coll instanceof JObject && (coll.lambda || this.lookupMethods(coll.cls, 'iterator').some(m => !m.abstract && !m.params.length))) {
          // eigene Klasse, die Iterable implementiert: iterator(), hasNext(), next()
          const it = yield* this.fnG(coll, 'iterator', [], s.line);
          if (it === null) this.npe('iterator() hat null geliefert');
          for (;;) {
            const h = yield* this.fnG(it, 'hasNext', [], s.line);
            if (h !== true) break;
            const x = yield* this.fnG(it, 'next', [], s.line);
            const c2 = { ...ctx, env: new Env(ctx.env) };
            c2.env.declare(s.name, s.type.name === 'var' ? this.typeOfValue(x) : s.type, s.type.name === 'var' ? x : this.coerce(x, s.type, s.line));
            if (++this.steps >= this.nextYield) yield TICK;
            try { yield* this.exec(s.body, c2); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
          }
          return;
        }
        else this.rtError(`for-each geht nur über Arrays, Listen und Iterable-Objekte, nicht über ${this.typeNameOf(coll)}`, s.line);
        for (let i = 0; i < items.length; i++) {
          if (live !== null && items.length !== live) this.throwJava('ConcurrentModificationException', 'Liste wurde während der for-each-Schleife verändert');
          const c2 = { ...ctx, env: new Env(ctx.env) };
          const t = s.type.name === 'var' ? this.typeOfValue(items[i]) : s.type;
          c2.env.declare(s.name, t, s.type.name === 'var' ? items[i] : this.coerce(items[i], s.type, s.line));
          if (++this.steps >= this.nextYield) yield TICK;
          try { if (s.body.$se === pureEpoch ? s.body.$s : this.markSimple(s.body)) this.execSimple(s.body, c2); else yield* this.exec(s.body, c2); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        if (live !== null && items.length !== live) this.throwJava('ConcurrentModificationException', 'Liste wurde während der for-each-Schleife verändert');
        return;
      }
      case 'Return': throw new ReturnSig(s.e ? (isPure(s.e) ? this.eval(s.e, ctx) : yield* this.geval(s.e, ctx)) : undefined);
      case 'LocalClass': return;
      case 'Yield': throw new YieldSig(isPure(s.e) ? this.eval(s.e, ctx) : yield* this.geval(s.e, ctx));
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      case 'Throw': {
        const v = isPure(s.e) ? this.eval(s.e, ctx) : yield* this.geval(s.e, ctx);
        if (v === null) this.npe('throw null');
        if (!(v instanceof JObject) || !v.cls.isSubclassOf(this.classes.get('Throwable'))) this.rtError('Nur Ausnahme-Objekte (Throwable) können geworfen werden', s.line);
        this.line = s.line;
        throw new JThrow(v, this.stackSnapshot());
      }
      case 'Try': {
        try { yield* this.exec(s.block, ctx); }
        catch (e) {
          let ex = e;
          if (e instanceof RangeError) { try { ex = new JThrow(this.instantiate(this.classes.get('StackOverflowError'), [], this.line), this.stackSnapshot()); } catch (_) { throw e; } }
          if (!(ex instanceof JThrow)) throw e;
          const cc = s.catches.find(c => c.types.some(tn => { const k = this.classes.get(tn); return k && ex.obj.cls.isSubclassOf(k); }));
          if (!cc) throw ex;
          const c2 = { ...ctx, env: new Env(ctx.env) };
          c2.env.declare(cc.name, T(cc.types[0]), ex.obj);
          yield* this.exec(cc.body, c2);
        } finally { if (s.fin) yield* this.exec(s.fin, ctx); }
        return;
      }
      case 'Switch': {
        const v = isPure(s.e) ? this.eval(s.e, ctx) : yield* this.geval(s.e, ctx);
        const idx = this.switchIndex(s, v, ctx);
        if (idx < 0) return;
        const c2 = { ...ctx, env: new Env(ctx.env) };
        try {
          if (s.arrow) { for (const st of s.cases[idx].stmts) yield* this.exec(st, c2); }
          else for (let i = idx; i < s.cases.length; i++) for (const st of s.cases[i].stmts) yield* this.exec(st, c2);
        } catch (e) { if (e === BREAK) return; throw e; }
        return;
      }
      default: this.rtError('Unbekannte Anweisung ' + s.k);
    }
  }
  switchIndex(s, v, ctx) {
    if (v === null) this.npe('switch über null');
    let idx = -1;
    for (let i = 0; i < s.cases.length && idx < 0; i++) {
      const c = s.cases[i]; if (!c.labels) continue;
      for (const l of c.labels) {
        const lv = (v instanceof JObject && v.cls.isEnum && l.k === 'Name') ? this.enumConst(v.cls, l.name, l.line) : this.eval(l, ctx);
        if (this.javaEquals(v, lv)) { idx = i; break; }
      }
    }
    if (idx < 0) idx = s.cases.findIndex(c => !c.labels);
    return idx;
  }
  *switchExprG(s, ctx) {
    const v = isPure(s.e) ? this.eval(s.e, ctx) : yield* this.geval(s.e, ctx);
    const idx = this.switchIndex(s, v, ctx);
    if (idx < 0) this.rtError(`Kein case passt zu ${this.str(v)} (der switch-Ausdruck braucht default)`, s.line);
    const c2 = { ...ctx, env: new Env(ctx.env) };
    try {
      if (s.arrow) {
        const st = s.cases[idx].stmts[0];
        if (st.k === 'Expr') { this.line = st.line; return isPure(st.e) ? this.eval(st.e, c2) : yield* this.geval(st.e, c2); }
        yield* this.exec(st, c2);
      } else for (let i = idx; i < s.cases.length; i++) for (const st of s.cases[i].stmts) yield* this.exec(st, c2);
    } catch (e) { if (e instanceof YieldSig) return e.value; throw e; }
    this.rtError('Der switch-Ausdruck liefert keinen Wert (yield fehlt)', s.line);
  }
  // Anweisungsfolge; „einfache“ Anweisungen (ohne Aufrufe und Schleifen) laufen
  // ohne eigenen Generator, das spart Zeit und Stapelplatz.
  *execList(stmts, ctx) {
    for (let i = 0, n = stmts.length; i < n; i++) {
      const st = stmts[i];
      if (st.$se === pureEpoch ? st.$s : this.markSimple(st)) { this.execSimple(st, ctx); if (this.steps >= this.nextYield) yield TICK; }
      else yield* this.exec(st, ctx);
    }
  }
  markSimple(s) {
    let r = false;
    switch (s.k) {
      case 'Expr': {
        r = isPure(s.e);
        const e = s.e;
        s.$c = !r && e.k === 'Call' && !!e.obj && e.obj.k !== 'Super' && isPure(e.obj) && allPure(e.args);
        break;
      }
      case 'Local': r = s.decls.every(d => !d.init || isPure(d.init)); break;
      case 'Empty': case 'Break': case 'Continue': r = true; break;
      case 'Return': r = !s.e || isPure(s.e); break;
      case 'If': r = isPure(s.c) && this.markSimple(s.a) && (!s.b || this.markSimple(s.b)); break;
      case 'Block': r = s.stmts.every(x => this.markSimple(x)); break;
    }
    s.$se = pureEpoch;
    return (s.$s = r);
  }
  // Gegenstück zu exec für einfache Anweisungen (synchron)
  execSimple(s, ctx) {
    ++this.steps;
    this.line = s.line;
    switch (s.k) {
      case 'Expr': this.eval(s.e, ctx); return;
      case 'Local':
        for (const d of s.decls) {
          let v = UNINIT, t = d.type;
          if (d.init) {
            v = this.initValue(d.init, t.name === 'var' ? null : t, ctx);
            if (t.name === 'var') { if (d.init.k === 'ArrayInit') this.rtError('var kann nicht mit { … } verwendet werden'); t = this.typeOfValue(v); }
          }
          ctx.env.declare(d.name, t, v);
        }
        return;
      case 'Empty': return;
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      case 'Return': throw new ReturnSig(s.e ? this.eval(s.e, ctx) : undefined);
      case 'If': if (this.cond(s.c, ctx)) this.execSimple(s.a, ctx); else if (s.b) this.execSimple(s.b, ctx); return;
      case 'Block': { const c2 = { ...ctx, env: new Env(ctx.env) }; for (const st of s.stmts) this.execSimple(st, c2); return; }
    }
  }
  runUpdates(upd, ctx) { for (const u of upd) this.eval(u, ctx); }
  enumConst(cls, name, line) { this.ensureStaticInit(cls); const o = cls.enumConsts.find(e => e.enumName === name); if (!o) this.rtError(`${cls.name} hat keine Konstante ${name}`, line); return o; }
  cond(e, ctx) {
    const v = this.eval(e, ctx);
    if (typeof v !== 'boolean') this.rtError(`Bedingung muss vom Typ boolean sein, ist aber ${this.typeNameOf(v)}`, e.line);
    return v;
  }
  *condG(e, ctx) {
    const v = yield* this.geval(e, ctx);
    if (typeof v !== 'boolean') this.rtError(`Bedingung muss vom Typ boolean sein, ist aber ${this.typeNameOf(v)}`, e.line);
    return v;
  }

  // ------------------------------------------------ Ausdrücke
  eval(e, ctx) {
    switch (e.k) {
      case 'Lit': return e.v;
      case 'Paren': return this.eval(e.e, ctx);
      case 'Name': return this.evalName(e, ctx);
      case 'This': if (!ctx.self) this.rtError("'this' gibt es nicht in einer statischen Methode", e.line); return ctx.self;
      case 'OuterThis': return this.outerThis(e, ctx);
      case 'Lambda': return this.makeLambda(e.$iface, { e, env: ctx.env, self: ctx.self, cls: ctx.cls, isStatic: ctx.isStatic });
      case 'MethodRef': {
        let target;
        if (e.target.k === 'Name' && !ctx.env.lookup(e.target.name) && !this.findField(ctx.cls, e.target.name) && this.classes.has(e.target.name)) target = new JClassRef(this.classes.get(e.target.name));
        else target = this.eval(e.target, ctx);
        if (target === null) this.npe('Methodenreferenz auf null');
        if (e.name === 'new' && !(target instanceof JClassRef)) this.rtError('::new geht nur mit einem Klassennamen', e.line);
        return this.makeLambda(e.$iface, { ref: { target, name: e.name }, cls: ctx.cls });
      }
      case 'Super': if (!ctx.self) this.rtError("'super' gibt es nicht in einer statischen Methode", e.line); return ctx.self;
      case 'Field': return this.evalField(e, ctx);
      case 'Index': {
        const a = this.eval(e.arr, ctx); const i = this.toInt(this.eval(e.idx, ctx), e.line);
        this.checkIndex(a, i, e.line); return a.data[i];
      }
      case 'Call': return e.$n === true ? this.callFast(e, ctx) : this.runSync(this.evalCallG(e, ctx));
      case 'New': return this.runSync(this.geval(e, ctx));
      case 'SwitchExpr': return this.runSync(this.switchExprG(e, ctx));
      case 'NewArray': {
        const full = { ...e.elem, dims: e.total };
        if (e.init) return this.arrayInit(e.init, full, ctx);
        const sizes = e.dims.map(d => this.toInt(this.eval(d, ctx), e.line));
        return this.makeArray(e.elem, sizes, e.total);
      }
      case 'ArrayInit': this.rtError('Array-Initialisierer { … } ist hier nicht erlaubt', e.line);
      case 'Assign': return this.evalAssign(e, ctx);
      case 'Bin': {
        if (e.op === '&&') { const l = this.eval(e.l, ctx); this.boolCheck(l, '&&', e.line); if (!l) return false; const r = this.eval(e.r, ctx); this.boolCheck(r, '&&', e.line); return r; }
        if (e.op === '||') { const l = this.eval(e.l, ctx); this.boolCheck(l, '||', e.line); if (l) return true; const r = this.eval(e.r, ctx); this.boolCheck(r, '||', e.line); return r; }
        const l = this.eval(e.l, ctx), r = this.eval(e.r, ctx);
        return this.binop(e.op, l, r, e.line);
      }
      case 'Unary': return this.unop(e.op, this.eval(e.e, ctx), e.line);
      case 'PreInc': case 'PostInc': return this.incr(this.lvalue(e.e, ctx), e);
      case 'Cond': return this.cond(e.c, ctx) ? this.eval(e.a, ctx) : this.eval(e.b, ctx);
      case 'Cast': return this.cast(this.eval(e.e, ctx), e.type, e.line);
      case 'InstanceOf': return this.instanceOf(this.eval(e.e, ctx), e, ctx);
      case 'CtorCall': this.rtError(`${e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`, e.line);
    }
    this.rtError('Unbekannter Ausdruck ' + e.k, e.line);
  }
  // Ausdruck mit Aufrufen als Generator auswerten; reine Teilausdrücke synchron
  *geval(e, ctx) {
    if (isPure(e)) return this.eval(e, ctx);
    switch (e.k) {
      case 'Paren': return yield* this.geval(e.e, ctx);
      case 'Field': return this.fieldOf(yield* this.geval(e.obj, ctx), e, ctx);
      case 'Index': {
        const a = isPure(e.arr) ? this.eval(e.arr, ctx) : yield* this.geval(e.arr, ctx);
        const i = this.toInt(isPure(e.idx) ? this.eval(e.idx, ctx) : yield* this.geval(e.idx, ctx), e.line);
        this.checkIndex(a, i, e.line); return a.data[i];
      }
      case 'Call': return yield* this.evalCallG(e, ctx);
      case 'SwitchExpr': return yield* this.switchExprG(e, ctx);
      case 'New': {
        const cls = this.classes.get(e.anon || e.type.name);
        if (!cls) this.rtError(`Klasse '${e.type.name}' nicht gefunden`, e.line);
        const args = yield* this.argsG(e.args, ctx);
        this.line = e.line;
        return yield* this.instantiateG(cls, args, e.line, e.type, ctx);
      }
      case 'NewArray': {
        const full = { ...e.elem, dims: e.total };
        if (e.init) return yield* this.arrayInitG(e.init, full, ctx);
        const sizes = [];
        for (const d of e.dims) sizes.push(this.toInt(isPure(d) ? this.eval(d, ctx) : yield* this.geval(d, ctx), e.line));
        return this.makeArray(e.elem, sizes, e.total);
      }
      case 'Assign': return yield* this.evalAssignG(e, ctx);
      case 'Bin': {
        if (e.op === '&&' || e.op === '||') {
          const l = isPure(e.l) ? this.eval(e.l, ctx) : yield* this.geval(e.l, ctx); this.boolCheck(l, e.op, e.line);
          if (e.op === '&&' ? !l : l) return l;
          const r = isPure(e.r) ? this.eval(e.r, ctx) : yield* this.geval(e.r, ctx); this.boolCheck(r, e.op, e.line); return r;
        }
        const l = isPure(e.l) ? this.eval(e.l, ctx) : yield* this.geval(e.l, ctx);
        const r = isPure(e.r) ? this.eval(e.r, ctx) : yield* this.geval(e.r, ctx);
        return this.binop(e.op, l, r, e.line);
      }
      case 'Unary': return this.unop(e.op, yield* this.geval(e.e, ctx), e.line);
      case 'PreInc': case 'PostInc': return this.incr(yield* this.lvalueG(e.e, ctx), e);
      case 'Cond': return (isPure(e.c) ? this.cond(e.c, ctx) : yield* this.condG(e.c, ctx)) ? yield* this.geval(e.a, ctx) : yield* this.geval(e.b, ctx);
      case 'Cast': return this.cast(yield* this.geval(e.e, ctx), e.type, e.line);
      case 'InstanceOf': return this.instanceOf(yield* this.geval(e.e, ctx), e, ctx);
    }
    return this.eval(e, ctx);
  }
  instanceOf(v, e, ctx) {
    const r = v !== null && this.isInstance(v, e.type);
    if (r && e.bind) ctx.env.declare(e.bind, e.type, v);
    return r;
  }
  incr(ref, e) {
    {
        const old = ref.get();
        const d = e.op === '++' ? 1 : -1; let nv;
        if (typeof old === 'number') nv = ref.type && ref.type.name === 'byte' ? ((old + d) << 24) >> 24 : ref.type && ref.type.name === 'short' ? ((old + d) << 16) >> 16 : (old + d) | 0;
        else if (old instanceof JDouble) nv = new JDouble(old.v + d);
        else if (typeof old === 'bigint') nv = BigInt.asIntN(64, old + BigInt(d));
        else if (old instanceof JChar) nv = new JChar((old.c + d + 65536) % 65536);
        else if (old === null) this.npe();
        else this.rtError(`${e.op} geht nur mit Zahlen, nicht mit ${this.typeNameOf(old)}`, e.line);
        ref.set(nv);
        return e.k === 'PreInc' ? nv : old;
    }
  }
  boolCheck(v, op, line) { if (typeof v !== 'boolean') this.rtError(`Operator ${op} braucht boolean-Werte, nicht ${this.typeNameOf(v)}`, line); }
  evalName(e, ctx) {
    const v = ctx.env.lookup(e.name);
    if (v) { if (v.value === UNINIT) this.rtError(`Variable '${e.name}' wurde noch kein Wert zugewiesen`, e.line); return v.value; }
    const f = this.findField(ctx.cls, e.name);
    if (f) {
      if (f.field.static) return this.getStatic(f.owner, f.field);
      if (!ctx.self) this.rtError(`Auf das Attribut '${e.name}' kann in einer statischen Methode nicht zugegriffen werden`, e.line);
      return ctx.self.fields[e.name];
    }
    if (ctx.cls && ctx.cls.outer) {
      const r = this.outerName(ctx, e.name);
      if (r) {
        if (r.local) { if (r.local.value === UNINIT) this.rtError(`Variable '${e.name}' wurde noch kein Wert zugewiesen`, e.line); return r.local.value; }
        if (r.f.field.static) return this.getStatic(r.f.owner, r.f.field);
        if (!r.self) this.rtError(`Auf das Attribut '${e.name}' der äußeren Klasse kann hier nicht zugegriffen werden (kein Objekt der äußeren Klasse)`, e.line);
        return r.self.fields[e.name];
      }
    }
    const c = this.classes.get(e.name);
    if (c) return new JClassRef(c);
    this.rtError(`Variable '${e.name}' nicht gefunden`, e.line);
  }
  getStatic(owner, field) {
    if (field.native) { const v = owner.native.sfields[field.name]; return typeof v === 'function' ? v(this) : v; }
    this.ensureStaticInit(owner);
    return owner.staticValues[field.name];
  }
  checkAccess(field, owner, ctx, line, what) {
    if (field.vis === 'private' && ctx.cls !== owner && !(ctx.cls && owner && ctx.cls.name === owner.name) && !(ctx.cls && this.topOf(ctx.cls) === this.topOf(owner))) {
      this.rtError(`${what || 'Attribut'} '${field.name}' ist private in ${owner.name} – Zugriff nur innerhalb der Klasse`, line);
    }
  }
  evalField(e, ctx) {
    if (e.obj.k === 'Super') {
      const f = this.findField(ctx.cls.superClass, e.name);
      if (!f) this.rtError(`Oberklasse hat kein Attribut '${e.name}'`, e.line);
      this.checkAccess(f.field, f.owner, ctx, e.line);
      return f.field.static ? this.getStatic(f.owner, f.field) : ctx.self.fields[e.name];
    }
    return this.fieldOf(this.eval(e.obj, ctx), e, ctx);
  }
  fieldOf(o, e, ctx) {
    if (o instanceof JClassRef) {
      const f = this.findField(o.cls, e.name);
      if (!f && o.cls.nestedMap && o.cls.nestedMap.has(e.name)) return new JClassRef(o.cls.nestedMap.get(e.name));
      if (!f || !f.field.static) this.rtError(f ? `'${e.name}' ist kein statisches Attribut – Zugriff nur über ein Objekt` : `Klasse ${o.cls.name} hat kein Attribut '${e.name}'`, e.line);
      this.checkAccess(f.field, f.owner, ctx, e.line);
      return this.getStatic(f.owner, f.field);
    }
    if (o === null) this.npe(`Zugriff auf '${e.name}' bei null`);
    if (o instanceof JArray) { if (e.name === 'length') return o.data.length; this.rtError(`Arrays haben kein Attribut '${e.name}' (nur length)`, e.line); }
    if (o instanceof JObject && !o.cls.native) {
      const f = this.findField(o.cls, e.name);
      if (!f) this.rtError(`Klasse ${o.cls.name} hat kein Attribut '${e.name}'`, e.line);
      this.checkAccess(f.field, f.owner, ctx, e.line);
      return f.field.static ? this.getStatic(f.owner, f.field) : o.fields[e.name];
    }
    if (typeof o === 'string' && e.name === 'length') this.rtError("Bei Strings heißt es length() mit Klammern", e.line);
    this.rtError(`'${e.name}' kann bei einem Wert vom Typ ${this.typeNameOf(o)} nicht abgerufen werden`, e.line);
  }
  checkIndex(a, i, line) {
    if (a === null) this.npe('Array ist null');
    if (!(a instanceof JArray)) this.rtError(`[ ] geht nur bei Arrays, nicht bei ${this.typeNameOf(a)}` + (a instanceof JObject && a.native && a.native.list ? ' – bei Listen get(i) verwenden' : ''), line);
    if (i < 0 || i >= a.data.length) this.throwJava('ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${a.data.length}`);
  }
  makeArray(base, sizes, total) {
    const n = sizes[0];
    if (n < 0) this.throwJava('NegativeArraySizeException', String(n));
    const et = { ...base, dims: total - 1 };
    const data = new Array(n);
    if (sizes.length > 1) for (let i = 0; i < n; i++) data[i] = this.makeArray(base, sizes.slice(1), total - 1);
    else for (let i = 0; i < n; i++) data[i] = defaultValue(et);
    this.steps += n >> 4;
    return new JArray(et, data);
  }
  arrayInit(init, type, ctx) {
    if (!type) this.rtError('Typ für Array-Initialisierer unbekannt', init.line);
    if (type.dims < 1) this.rtError(`{ … } passt nicht zum Typ ${typeStr(type)}`, init.line);
    const et = { ...type, dims: type.dims - 1 };
    return new JArray(et, init.elems.map(x => x.k === 'ArrayInit' ? this.arrayInit(x, et, ctx) : this.coerce(this.eval(x, ctx), et, x.line)));
  }
  *arrayInitG(init, type, ctx) {
    if (isPure(init)) return this.arrayInit(init, type, ctx);
    if (!type) this.rtError('Typ für Array-Initialisierer unbekannt', init.line);
    if (type.dims < 1) this.rtError(`{ … } passt nicht zum Typ ${typeStr(type)}`, init.line);
    const et = { ...type, dims: type.dims - 1 };
    const out = [];
    for (const x of init.elems) out.push(x.k === 'ArrayInit' ? yield* this.arrayInitG(x, et, ctx) : this.coerce(yield* this.geval(x, ctx), et, x.line));
    return new JArray(et, out);
  }
  *lvalueG(t, ctx) {
    if (isPure(t)) return this.lvalue(t, ctx);
    if (t.k === 'Field') return this.fieldRef(yield* this.geval(t.obj, ctx), t, ctx);
    if (t.k === 'Index') {
      const a = isPure(t.arr) ? this.eval(t.arr, ctx) : yield* this.geval(t.arr, ctx);
      const i = this.toInt(isPure(t.idx) ? this.eval(t.idx, ctx) : yield* this.geval(t.idx, ctx), t.line);
      return this.indexRef(a, i, t);
    }
    return this.lvalue(t, ctx);
  }
  lvalue(t, ctx) {
    const rt = this;
    if (t.k === 'Name') {
      const v = ctx.env.lookup(t.name);
      if (v) return { type: v.type, get() { if (v.value === UNINIT) rt.rtError(`Variable '${t.name}' wurde noch kein Wert zugewiesen`, t.line); return v.value; }, set(x) { v.value = x; } };
      const f = this.findField(ctx.cls, t.name);
      if (f) {
        if (f.field.static) return this.staticRef(f, ctx, t.line);
        if (!ctx.self) this.rtError(`Auf das Attribut '${t.name}' kann in einer statischen Methode nicht zugegriffen werden`, t.line);
        this.finalCheck(f, ctx, t.line);
        const o = ctx.self;
        return { type: f.field.type, get() { return o.fields[t.name]; }, set(x) { o.fields[t.name] = x; } };
      }
      const r = ctx.cls && ctx.cls.outer ? this.outerName(ctx, t.name) : null;
      if (r) {
        if (r.local) this.rtError(`Die lokale Variable '${t.name}' kann hier nicht verändert werden (sie muss final oder effektiv final sein)`, t.line);
        if (r.f.field.static) return this.staticRef(r.f, ctx, t.line);
        if (!r.self) this.rtError(`Auf das Attribut '${t.name}' der äußeren Klasse kann hier nicht zugegriffen werden`, t.line);
        this.finalCheck(r.f, ctx, t.line);
        const o = r.self;
        return { type: r.f.field.type, get() { return o.fields[t.name]; }, set(x) { o.fields[t.name] = x; } };
      }
      this.rtError(`Variable '${t.name}' nicht gefunden`, t.line);
    }
    if (t.k === 'Field') {
      if (t.obj.k === 'Super' || t.obj.k === 'This') {
        const f = this.findField(t.obj.k === 'Super' ? ctx.cls.superClass : ctx.cls, t.name);
        if (!ctx.self) this.rtError("'this' gibt es nicht in einer statischen Methode", t.line);
        if (!f) this.rtError(`Attribut '${t.name}' nicht gefunden`, t.line);
        if (f.field.static) return this.staticRef(f, ctx, t.line);
        this.finalCheck(f, ctx, t.line);
        const o = ctx.self;
        return { type: f.field.type, get() { return o.fields[t.name]; }, set(x) { o.fields[t.name] = x; } };
      }
      return this.fieldRef(this.eval(t.obj, ctx), t, ctx);
    }
    if (t.k === 'Index') return this.indexRef(this.eval(t.arr, ctx), this.toInt(this.eval(t.idx, ctx), t.line), t);
    this.rtError('Hier kann nichts zugewiesen werden', t.line);
  }
  fieldRef(o, t, ctx) {
    {
      if (o instanceof JClassRef) {
        const f = this.findField(o.cls, t.name);
        if (!f || !f.field.static) this.rtError(`Klasse ${o.cls.name} hat kein statisches Attribut '${t.name}'`, t.line);
        this.checkAccess(f.field, f.owner, ctx, t.line);
        return this.staticRef(f, ctx, t.line);
      }
      if (o === null) this.npe(`Zugriff auf '${t.name}' bei null`);
      if (o instanceof JArray && t.name === 'length') this.rtError('length eines Arrays kann nicht verändert werden', t.line);
      if (!(o instanceof JObject) || o.cls.native) this.rtError(`'${t.name}' kann bei ${this.typeNameOf(o)} nicht gesetzt werden`, t.line);
      const f = this.findField(o.cls, t.name);
      if (!f) this.rtError(`Klasse ${o.cls.name} hat kein Attribut '${t.name}'`, t.line);
      this.checkAccess(f.field, f.owner, ctx, t.line);
      if (f.field.static) return this.staticRef(f, ctx, t.line);
      this.finalCheck(f, ctx, t.line);
      return { type: f.field.type, get() { return o.fields[t.name]; }, set(x) { o.fields[t.name] = x; } };
    }
  }
  indexRef(a, i, t) {
    this.checkIndex(a, i, t.line);
    return { type: a.elemType, get() { return a.data[i]; }, set(x) { a.data[i] = x; } };
  }
  finalCheck(f, ctx, line) {
    if (f.field.final && !(ctx.ctor && ctx.cls === f.owner) && !(ctx.clinit && ctx.cls === f.owner)) this.rtError(`'${f.field.name}' ist final und kann nicht verändert werden`, line);
  }
  staticRef(f, ctx, line) {
    const rt = this;
    if (f.field.native || f.field.enumConst) this.rtError(`'${f.field.name}' ist eine Konstante und kann nicht verändert werden`, line);
    this.finalCheck(f, ctx, line);
    this.ensureStaticInit(f.owner);
    return { type: f.field.type, get() { return f.owner.staticValues[f.field.name]; }, set(x) { f.owner.staticValues[f.field.name] = x; } };
  }
  *evalAssignG(e, ctx) {
    const ref = isPure(e.target) ? this.lvalue(e.target, ctx) : yield* this.lvalueG(e.target, ctx);
    if (e.op === '=') { const v = this.coerce(isPure(e.value) ? this.eval(e.value, ctx) : yield* this.geval(e.value, ctx), ref.type, e.line); ref.set(v); return v; }
    const cur = ref.get(); const rhs = isPure(e.value) ? this.eval(e.value, ctx) : yield* this.geval(e.value, ctx);
    return this.compound(ref, cur, rhs, e);
  }
  evalAssign(e, ctx) {
    const ref = this.lvalue(e.target, ctx);
    if (e.op === '=') { const v = this.coerce(this.eval(e.value, ctx), ref.type, e.line); ref.set(v); return v; }
    const cur = ref.get(); const rhs = this.eval(e.value, ctx);
    return this.compound(ref, cur, rhs, e);
  }
  compound(ref, cur, rhs, e) {
    let v;
    {
      const op = e.op.slice(0, -1);
      v = this.binop(op, cur, rhs, e.line);
      if (ref.type && ref.type.dims === 0 && PRIMS.has(ref.type.name)) v = this.cast(v, ref.type, e.line);
      else v = this.coerce(v, ref.type, e.line);
    }
    ref.set(v);
    return v;
  }
  binop(op, a, b, line) {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) {
      if (a === undefined || b === undefined) this.rtError('void-Wert kann nicht verkettet werden', line);
      return this.str(a) + this.str(b);
    }
    if (op === '==' || op === '!=') {
      let r;
      const ka = this.kindOf(a), kb = this.kindOf(b);
      if (ka && kb && ka !== 'boolean' && kb !== 'boolean') r = this.num(a) === this.num(b);
      else if (ka === 'boolean' || kb === 'boolean') { if (ka !== kb) this.rtError(`${this.typeNameOf(a)} und ${this.typeNameOf(b)} können nicht mit ${op} verglichen werden`, line); r = a === b; }
      else if ((ka && b !== null) || (kb && a !== null)) this.rtError(`${this.typeNameOf(a)} und ${this.typeNameOf(b)} können nicht mit ${op} verglichen werden`, line);
      else r = a === b;
      return op === '==' ? r : !r;
    }
    const ka = this.kindOf(a), kb = this.kindOf(b);
    if ((op === '&' || op === '|' || op === '^') && ka === 'boolean' && kb === 'boolean') return op === '&' ? a && b : op === '|' ? a || b : a !== b;
    if (!ka || !kb || ka === 'boolean' || kb === 'boolean') {
      if ((a === null || b === null) && (ka || kb)) this.npe();
      this.rtError(`Operator ${op} kann nicht auf ${this.typeNameOf(a)} und ${this.typeNameOf(b)} angewendet werden`, line);
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      const x = (ka === 'long') ? a : this.num(a), y = (kb === 'long') ? b : this.num(b);
      switch (op) { case '<': return x < y; case '>': return x > y; case '<=': return x <= y; default: return x >= y; }
    }
    if (op === '<<' || op === '>>' || op === '>>>') {
      if (ka === 'double' || kb === 'double') this.rtError(`Operator ${op} geht nur mit Ganzzahlen`, line);
      if (ka === 'long') { const x = a, s = BigInt(Number(this.num(b)) & 63); return op === '<<' ? BigInt.asIntN(64, x << s) : op === '>>' ? x >> s : BigInt.asIntN(64, BigInt.asUintN(64, x) >> s); }
      const x = this.num(a), s = this.num(b) & 31;
      return op === '<<' ? x << s : op === '>>' ? x >> s : (x >>> s) | 0;
    }
    if (ka === 'double' || kb === 'double') {
      const x = this.num(a), y = this.num(b);
      switch (op) { case '+': return new JDouble(x + y); case '-': return new JDouble(x - y); case '*': return new JDouble(x * y); case '/': return new JDouble(x / y); case '%': return new JDouble(x % y); }
      this.rtError(`Operator ${op} geht nicht mit double`, line);
    }
    if (ka === 'long' || kb === 'long') {
      const x = typeof a === 'bigint' ? a : BigInt(this.num(a)), y = typeof b === 'bigint' ? b : BigInt(this.num(b));
      switch (op) {
        case '+': return BigInt.asIntN(64, x + y); case '-': return BigInt.asIntN(64, x - y); case '*': return BigInt.asIntN(64, x * y);
        case '/': if (y === 0n) this.throwJava('ArithmeticException', '/ by zero'); return BigInt.asIntN(64, x / y);
        case '%': if (y === 0n) this.throwJava('ArithmeticException', '/ by zero'); return x % y;
        case '&': return x & y; case '|': return x | y; case '^': return x ^ y;
      }
    }
    const x = this.num(a), y = this.num(b);
    switch (op) {
      case '+': return (x + y) | 0; case '-': return (x - y) | 0; case '*': return Math.imul(x, y);
      case '/': if (y === 0) this.throwJava('ArithmeticException', '/ by zero'); return (x / y) | 0;
      case '%': if (y === 0) this.throwJava('ArithmeticException', '/ by zero'); return x % y;
      case '&': return x & y; case '|': return x | y; case '^': return x ^ y;
    }
    this.rtError(`Unbekannter Operator ${op}`, line);
  }
  unop(op, v, line) {
    const k = this.kindOf(v);
    if (op === '!') { if (k !== 'boolean') this.rtError(`! braucht einen boolean-Wert, nicht ${this.typeNameOf(v)}`, line); return !v; }
    if (!k || k === 'boolean') { if (v === null) this.npe(); this.rtError(`Operator ${op} geht nicht mit ${this.typeNameOf(v)}`, line); }
    if (op === '+') return k === 'char' ? v.c : v;
    if (op === '-') { if (k === 'double') return new JDouble(-v.v); if (k === 'long') return BigInt.asIntN(64, -v); return (-this.num(v)) | 0; }
    if (op === '~') { if (k === 'double') this.rtError('~ geht nur mit Ganzzahlen', line); if (k === 'long') return ~v; return ~this.num(v); }
  }

  // ------------------------------------------------ Methodenaufrufe
  *evalCallG(e, ctx) {
    const line = e.line;
    if (e.obj === null) {
      const ms = this.lookupMethods(ctx.cls, e.name);
      if (ctx.self && (!ms.length || !ms.some(m => m.params.length === e.args.length))) { const nf = this.nativeMethod(ctx.cls, e.name); if (nf) { const a = (yield* this.argsG(e.args, ctx)); this.line = line; { const r = nf(this, ctx.self, a, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; } } }
      if (!ctx.self && !ms.length) { const nsf = (() => { for (let c = ctx.cls; c; c = c.superClass) { const f = c.native && c.native.statics && c.native.statics[e.name]; if (f) return f; } return null; })(); if (nsf) { const r = nsf(this, (yield* this.argsG(e.args, ctx)), line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; } }
      if (!ms.length && ctx.self && ['toString', 'equals', 'hashCode', 'getClass', 'name', 'ordinal', 'compareTo'].includes(e.name)) return this.objectMethod(ctx.self, e.name, (yield* this.argsG(e.args, ctx)), line);
      if (!ms.length && ctx.cls && ctx.cls.outer) {
        // Methode einer umgebenden Klasse
        for (let c = ctx.cls, o = ctx.self; c.outer;) {
          o = this.outerObj(o, c); c = c.outer;
          const oms = this.lookupMethods(c, e.name);
          if (!oms.length) continue;
          const args = (yield* this.argsG(e.args, ctx));
          this.line = line;
          const m = this.selectOverload(oms, args, e.name, line);
          if (m.static) return yield* this.invokeG(m, null, args, line);
          if (!o) this.rtError(`Die Methode ${e.name}() der äußeren Klasse braucht ein Objekt – hier gibt es keins (statischer Kontext)`, line);
          return m.vis === 'private' ? yield* this.invokeG(m, o, args, line) : yield* this.invokeVirtualG(o, m, args, line);
        }
      }
      if (!ms.length) this.rtError(`Methode '${e.name}' nicht gefunden`, line);
      const args = (yield* this.argsG(e.args, ctx));
      this.line = line;
      const m = this.selectOverload(ms, args, e.name, line);
      if (m.static) return yield* this.invokeG(m, null, args, line);
      if (!ctx.self) this.rtError(`Die Methode ${e.name}() ist nicht statisch und kann nicht aus einer statischen Methode aufgerufen werden – erzeuge zuerst ein Objekt`, line);
      if (m.vis === 'private') return yield* this.invokeG(m, ctx.self, args, line);
      return yield* this.invokeVirtualG(ctx.self, m, args, line);
    }
    if (e.obj.k === 'Super') {
      if (!ctx.self) this.rtError("'super' gibt es nicht in einer statischen Methode", line);
      const sc = ctx.cls.superClass;
      const ms = this.lookupMethods(sc, e.name).filter(m => !m.abstract);
      const args = (yield* this.argsG(e.args, ctx));
      this.line = line;
      if (!ms.length) { const nf = this.nativeMethod(sc, e.name); if (nf) { const r = nf(this, ctx.self, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; } }
      if (!ms.length) {
        if (['toString', 'equals', 'hashCode', 'getClass'].includes(e.name)) return this.objectMethod(ctx.self, e.name, args, line, true);
        this.rtError(`Die Oberklasse hat keine (nicht-abstrakte) Methode '${e.name}'`, line);
      }
      const m = this.selectOverload(ms, args, e.name, line);
      return yield* this.invokeG(m, ctx.self, args, line);
    }
    const o = isPure(e.obj) ? this.eval(e.obj, ctx) : yield* this.geval(e.obj, ctx);
    const args = allPure(e.args) ? e.args.map(a => this.eval(a, ctx)) : yield* this.argsG(e.args, ctx);
    this.line = line;
    const r = this.nativeFast(o, e.name, args, line);
    if (r !== NOFAST) { this.learnNative(e, r); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; }
    if (e.$n === undefined) e.$n = false;
    return yield* this.callOnG(o, e.name, args, line, ctx);
  }
  // Aufrufstelle, die bisher immer eine eingebaute Methode traf, synchron ausführen.
  // Trifft sie doch einmal eigenen Code, wird sie dauerhaft als „nicht rein“ markiert.
  callFast(e, ctx) {
    const o = this.eval(e.obj, ctx), args = e.args.map(a => this.eval(a, ctx));
    this.line = e.line;
    const r = this.nativeFast(o, e.name, args, e.line);
    if (r === NOFAST) { e.$n = false; pureEpoch++; return this.runSync(this.callOnG(o, e.name, args, e.line, ctx)); }
    if (r instanceof Suspend) { e.$n = false; pureEpoch++; return r.sync ? r.sync(this) : undefined; }
    return r;
  }
  learnNative(e, r) { if (e.$n === undefined && !(r instanceof Suspend) && e.obj && e.obj.k !== 'Super') { e.$n = true; pureEpoch++; } }
  // Schneller Weg für eingebaute Klassen (String, ArrayList, Math …) ohne weiteren
  // Generator. Liefert NOFAST, wenn der normale Weg (callOnG) nötig ist.
  nativeFast(o, name, args, line) {
    if (typeof o === 'string') return this.stringMethod(o, name, args, line);
    if (o instanceof JObject) {
      if (!o.cls.native || o.lambda) return NOFAST;
      for (let c = o.cls; c; c = c.superClass) {
        const f = c.native && c.native.methods && c.native.methods[name];
        if (f) return f(this, o, args, line);
      }
    } else if (o instanceof JClassRef && o.cls.native) {
      const f = o.cls.native.statics && o.cls.native.statics[name];
      if (f) return f(this, args, line);
    }
    return NOFAST;
  }
  callOn(o, name, args, line, ctx) { return this.runSync(this.callOnG(o, name, args, line, ctx)); }
  *callOnG(o, name, args, line, ctx) {
    if (o instanceof JClassRef) {
      const c = o.cls;
      if (c.native) {
        const f = c.native.statics && c.native.statics[name];
        if (!f) this.rtError(`Methode '${name}' gibt es in ${c.name} nicht (oder sie wird nicht unterstützt)`, line);
        { const r = f(this, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; }
      }
      if (c.isEnum && name === 'values' && !args.length) { this.ensureStaticInit(c); return new JArray(T(c.name), c.enumConsts.slice()); }
      if (c.isEnum && name === 'valueOf' && args.length === 1) { this.ensureStaticInit(c); const r = c.enumConsts.find(x => x.enumName === args[0]); if (!r) this.throwJava('IllegalArgumentException', `No enum constant ${c.name}.${args[0]}`); return r; }
      const ms = this.lookupMethods(c, name);
      if (!ms.length) this.rtError(`Klasse ${c.name} hat keine Methode '${name}'`, line);
      const m = this.selectOverload(ms, args, name, line);
      if (!m.static) this.rtError(`Methode ${name}() ist nicht statisch – rufe sie an einem Objekt auf`, line);
      if (ctx) this.checkAccess(m, m.cls, ctx, line, 'Methode');
      return yield* this.invokeG(m, null, args, line);
    }
    if (o === null) this.npe(`Methode ${name}() wurde auf null aufgerufen`);
    if (typeof o === 'string') return this.stringMethod(o, name, args, line);
    if (this.kindOf(o)) return this.boxedMethod(o, name, args, line);
    if (o instanceof JArray) {
      if (name === 'clone' && !args.length) return new JArray(o.elemType, o.data.slice());
      if (name === 'length') this.rtError('Bei Arrays heißt es length ohne Klammern', line);
      if (['equals', 'hashCode', 'toString', 'getClass'].includes(name)) return this.objectMethod(o, name, args, line);
      this.rtError(`Arrays haben keine Methode '${name}'`, line);
    }
    if (o instanceof JObject) {
      if (o.lambda) return yield* this.lambdaMethodG(o, name, args, line);
      if (o.cls.native) {
        for (let c = o.cls; c; c = c.superClass) {
          const f = c.native && c.native.methods && c.native.methods[name];
          if (f) { const r = f(this, o, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; }
        }
        if (['equals', 'hashCode', 'toString', 'getClass'].includes(name)) return this.objectMethod(o, name, args, line);
        this.rtError(`Methode '${name}' gibt es für ${o.cls.name} nicht (oder sie wird nicht unterstützt)`, line);
      }
      const ms = this.lookupMethods(o.cls, name);
      if (!ms.length || !ms.some(m => m.params.length === args.length)) { const nf = this.nativeMethod(o.cls, name); if (nf) { const r = nf(this, o, args, line); return r instanceof Suspend ? (r.g ? yield* r.g : yield r) : r; } }
      if (!ms.length) {
        if (['equals', 'hashCode', 'toString', 'getClass', 'name', 'ordinal', 'compareTo'].includes(name)) return this.objectMethod(o, name, args, line);
        this.rtError(`Klasse ${o.cls.name} hat keine Methode '${name}'`, line);
      }
      const m = this.selectOverload(ms, args, name, line);
      if (ctx) this.checkAccess(m, m.cls, ctx, line, 'Methode');
      if (m.static) return yield* this.invokeG(m, null, args, line);
      return yield* this.invokeVirtualG(o, m, args, line);
    }
    this.rtError(`Auf einem Wert vom Typ ${this.typeNameOf(o)} kann keine Methode aufgerufen werden`, line);
  }
  // Methoden von Integer, Double, Character, Boolean … (Werte sind hier ausgepackt)
  boxedMethod(v, name, a, line) {
    const k = this.kindOf(v);
    switch (name) {
      case 'compareTo': if (a.length === 1) return this.compareValues(v, a[0]); break;
      case 'equals': if (a.length === 1) return this.kindOf(a[0]) === k && this.javaEquals(v, a[0]); break;
      case 'hashCode': if (!a.length) return k === 'boolean' ? (v ? 1231 : 1237) : k === 'double' ? strHash(this.str(v)) : k === 'long' ? Number(BigInt.asIntN(32, v ^ (v >> 32n))) : this.num(v); break;
      case 'toString': if (!a.length) return this.str(v); break;
      case 'intValue': if (k !== 'boolean') return this.cast(v, INT, line); break;
      case 'doubleValue': if (k !== 'boolean') return this.cast(v, DOUBLE, line); break;
      case 'longValue': if (k !== 'boolean') return this.cast(v, LONG, line); break;
      case 'charValue': if (k === 'char') return v; break;
      case 'booleanValue': if (k === 'boolean') return v; break;
      case 'isNaN': if (k === 'double') return Number.isNaN(v.v); break;
    }
    this.rtError(`Methode '${name}' gibt es für ${this.typeNameOf(v)}-Werte nicht`, line);
  }
  nativeMethod(cls, name) {
    for (let c = cls; c; c = c.superClass) { const f = c.native && c.native.methods && c.native.methods[name]; if (f) return f; }
    return null;
  }
  nativeOwner(cls) { for (let c = cls; c; c = c.superClass) if (c.native && c.native.initInstance) return c.name; return null; }
  nativeSpec(cls) { for (let c = cls; c; c = c.superClass) if (c.native && c.native.initInstance) return c.native; return null; }
  objectMethod(o, name, args, line, nonVirtual) {
    switch (name) {
      case 'toString': if (!args.length) { if (nonVirtual || o instanceof JArray) return (o instanceof JArray) ? this.str(o) : (o.enumName !== undefined ? o.enumName : o.cls.fullName + '@' + idHash(o.id)); return this.str(o); } break;
      case 'equals': if (args.length === 1) return o === args[0]; break;
      case 'hashCode': if (!args.length) return parseInt(idHash(o.id), 16); break;
      case 'getClass': if (!args.length) { const c = new JObject(this.classes.get('Class')); c.native = { of: o instanceof JArray ? null : o.cls, name: this.typeNameOf(o) }; return c; } break;
      case 'name': if (o.enumName !== undefined && !args.length) return o.enumName; break;
      case 'ordinal': if (o.enumName !== undefined && !args.length) return o.ordinal; break;
      case 'compareTo': if (o.enumName !== undefined && args.length === 1) return o.ordinal - args[0].ordinal; break;
    }
    this.rtError(`Methode ${name} mit ${args.length} Parameter(n) nicht gefunden`, line);
  }
  sIdx(s, i, max) { if (i < 0 || i > max) this.throwJava('StringIndexOutOfBoundsException', `index ${i}, length ${s.length}`); }
  stringMethod(s, name, a, line) {
    const argStr = (v) => { if (typeof v === 'string') return v; if (v instanceof JChar) return String.fromCharCode(v.c); if (v === null) this.npe(); this.rtError(`String erwartet, aber ${this.typeNameOf(v)} gefunden`, line); };
    const n = a.length;
    switch (name) {
      case 'length': if (!n) return s.length; break;
      case 'charAt': if (n === 1) { const i = this.toInt(a[0], line); if (i < 0 || i >= s.length) this.throwJava('StringIndexOutOfBoundsException', `Index ${i} out of bounds for length ${s.length}`); return new JChar(s.charCodeAt(i)); } break;
      case 'substring': {
        const b = this.toInt(a[0], line), e = n > 1 ? this.toInt(a[1], line) : s.length;
        if (b < 0 || e > s.length || b > e) this.throwJava('StringIndexOutOfBoundsException', `begin ${b}, end ${e}, length ${s.length}`);
        return s.substring(b, e);
      }
      case 'indexOf': if (n >= 1) return s.indexOf(argStr(a[0]), n > 1 ? this.toInt(a[1]) : 0); break;
      case 'lastIndexOf': if (n >= 1) return n > 1 ? s.lastIndexOf(argStr(a[0]), this.toInt(a[1])) : s.lastIndexOf(argStr(a[0])); break;
      case 'equals': if (n === 1) return typeof a[0] === 'string' && a[0] === s; break;
      case 'equalsIgnoreCase': if (n === 1) return typeof a[0] === 'string' && a[0].toLowerCase() === s.toLowerCase(); break;
      case 'compareTo': if (n === 1) { if (a[0] === null) this.npe(); return cmpStr(s, argStr(a[0])); } break;
      case 'compareToIgnoreCase': if (n === 1) return cmpStr(s.toLowerCase(), argStr(a[0]).toLowerCase()); break;
      case 'toUpperCase': return s.toUpperCase();
      case 'toLowerCase': return s.toLowerCase();
      case 'trim': return s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
      case 'strip': return s.trim();
      case 'isEmpty': return s.length === 0;
      case 'isBlank': return s.trim().length === 0;
      case 'contains': if (n === 1) return s.includes(argStr(a[0])); break;
      case 'startsWith': if (n === 1) return s.startsWith(argStr(a[0])); break;
      case 'endsWith': if (n === 1) return s.endsWith(argStr(a[0])); break;
      case 'replace': if (n === 2) return s.split(argStr(a[0])).join(argStr(a[1])); break;
      case 'replaceAll': if (n === 2) return s.replace(this.regex(argStr(a[0]), 'g'), argStr(a[1]).replace(/\$(\d)/g, '$$$1')); break;
      case 'replaceFirst': if (n === 2) return s.replace(this.regex(argStr(a[0]), ''), argStr(a[1])); break;
      case 'matches': if (n === 1) return this.regex('^(?:' + argStr(a[0]) + ')$', '').test(s); break;
      case 'split': if (n >= 1) {
        let parts = s.split(this.regex(argStr(a[0]), ''));
        if (parts.length > 1 && parts[0] === '' && s.length > 0 && this.regex(argStr(a[0]), '').exec(s)?.index === 0 && this.regex(argStr(a[0]), '').exec(s)[0].length === 0) parts.shift();
        if (!(n > 1 && this.toInt(a[1]) < 0)) while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
        if (s === '') parts = [''];
        return new JArray(STRING, parts);
      } break;
      case 'toCharArray': return new JArray(CHAR, [...s].map(c => new JChar(c.charCodeAt(0))));
      case 'concat': if (n === 1) return s + argStr(a[0]); break;
      case 'hashCode': return strHash(s);
      case 'repeat': if (n === 1) { const k = this.toInt(a[0]); if (k < 0) this.throwJava('IllegalArgumentException', 'count is negative: ' + k); return s.repeat(k); } break;
      case 'toString': case 'intern': return s;
      case 'codePointAt': return s.codePointAt(this.toInt(a[0]));
      case 'getClass': { const c = new JObject(this.classes.get('Class')); c.native = { of: this.classes.get('String'), name: 'String' }; return c; }
    }
    this.rtError(`Methode ${name}(${a.map(x => this.typeNameOf(x)).join(', ')}) gibt es für String nicht`, line);
  }
  regex(src, flags) { try { return new RegExp(src.replace(/\\p\{Alpha\}/g, '[A-Za-z]').replace(/\\p\{Punct\}/g, '[!-\\/:-@\\[-`{-~]'), flags); } catch (e) { this.throwJava('IllegalArgumentException', 'Ungültiger regulärer Ausdruck: ' + src); } }

  format(fmt, args, line) {
    if (typeof fmt !== 'string') this.rtError('Format-Text muss ein String sein', line);
    let ai = 0;
    return fmt.replace(/%(\d+\$)?([-#+ 0,(]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g, (m, pos, flags, width, prec, conv) => {
      if (conv === '%') return '%'; if (conv === 'n') return '\n';
      const a = pos ? args[parseInt(pos) - 1] : args[ai++];
      if (a === undefined) this.throwJava('IllegalArgumentException', `Format specifier '${m}' – es fehlt ein Wert`);
      let s; const k = this.kindOf(a);
      const group = (x) => { const [i, f] = x.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? '.' + f : ''); };
      switch (conv) {
        case 'd': if (k !== 'int' && k !== 'long') this.throwJava('IllegalArgumentException', `d != ${this.typeNameOf(a)} (für Kommazahlen %f verwenden)`); s = String(a); if (flags.includes(',')) s = group(s); if (flags.includes('+') && !s.startsWith('-')) s = '+' + s; break;
        case 'f': case 'e': case 'E': {
          if (k !== 'double') this.throwJava('IllegalArgumentException', `${conv} != ${this.typeNameOf(a)} (für Ganzzahlen %d verwenden)`);
          const x = a.v; const p = prec == null ? 6 : +prec;
          s = conv === 'f' ? x.toFixed(p) : x.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
          if (conv === 'E') s = s.toUpperCase();
          if (flags.includes(',')) s = group(s);
          if (flags.includes('+') && x >= 0) s = '+' + s; break;
        }
        case 's': case 'S': s = this.str(a); if (prec != null) s = s.slice(0, +prec); if (conv === 'S') s = s.toUpperCase(); break;
        case 'c': s = a instanceof JChar ? String.fromCharCode(a.c) : typeof a === 'number' ? String.fromCharCode(a) : this.throwJava('IllegalArgumentException', 'c != ' + this.typeNameOf(a)); break;
        case 'b': case 'B': s = a === null ? 'false' : typeof a === 'boolean' ? String(a) : 'true'; break;
        case 'x': case 'X': s = (typeof a === 'bigint' ? BigInt.asUintN(64, a) : (this.num(a) >>> 0)).toString(16); if (conv === 'X') s = s.toUpperCase(); break;
        default: this.throwJava('IllegalArgumentException', `Unbekanntes Format '%${conv}'`);
      }
      if (width) { const w = +width; if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : (flags.includes('0') && /[dfxX]/.test(conv) ? (s[0] === '-' ? '-' + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0')) : s.padStart(w)); }
      return s;
    });
  }

  // ------------------------------------------------ Schnittstelle für die Oberfläche
  // Direkteingabe: zerlegt den Text; liefert { error } oder { gen, post }.
  prepSnippet(code, env) {
    const src = code.trim();
    const ctx = { self: null, cls: this.padClass, env, isStatic: true };
    if (!src) return { done: { ok: true, hasValue: false } };
    let expr = null;
    if (!src.endsWith(';')) {
      try { const p = new Parser(src); const e = p.parseExpr(); if (p.tok.t === 'eof') expr = e; } catch (e) { expr = null; }
    }
    if (expr && !(expr.k === 'Assign' || expr.k === 'PreInc' || expr.k === 'PostInc')) {
      const rt = this;
      return {
        gen: function* () { return yield* rt.geval(expr, ctx); },
        post: (r) => {
          if (r.ok && r.value instanceof JClassRef) return { ok: false, message: `${r.value.cls.name} ist eine Klasse und kein Wert` };
          if (r.ok) return { ok: true, hasValue: r.value !== undefined, value: r.value };
          return r;
        },
      };
    }
    let stmts;
    try {
      const p = new Parser(src.endsWith(';') || src.endsWith('}') ? src : src + ';');
      stmts = [];
      while (p.tok.t !== 'eof') stmts.push(p.parseStmt());
    } catch (e) {
      if (e instanceof JavaError) return { done: { ok: false, message: e.message, kind: 'compile' } };
      throw e;
    }
    const rt = this;
    return {
      gen: function* () { for (const s of stmts) yield* rt.exec(s, ctx); },
      post: (r) => (r.ok ? { ok: true, hasValue: false } : r),
    };
  }
  evalSnippet(code, env) {
    const p = this.prepSnippet(code, env);
    if (p.done) return p.done;
    return p.post(this.run(() => this.runSync(p.gen())));
  }
  evalSnippetAsync(code, env) {
    const p = this.prepSnippet(code, env);
    if (p.done) return Promise.resolve(p.done);
    return this.runAsync(p.gen).then(r => (r.stopped || r.busy ? r : p.post(r)));
  }
  evalArg(text, type, env) {
    const src = text.trim();
    if (!src) throw new Error('Bitte einen Wert eingeben');
    const ctx = { self: null, cls: this.padClass, env, isStatic: true };
    let node;
    try {
      const p = new Parser(src);
      node = p.is('{') ? p.parseArrayInit() : p.parseExpr();
      if (p.tok.t !== 'eof') throw new JavaError('Unerwartetes Zeichen nach dem Wert', 1);
    } catch (e) {
      if (type && type.name === 'String' && !type.dims) throw new Error('Texte (String) bitte in Anführungszeichen schreiben, z. B. "Anna"');
      throw new Error(e.message.replace(/, gefunden: .*$/, ''));
    }
    const r = this.run(() => node.k === 'ArrayInit' ? this.arrayInit(node, type, ctx) : this.coerce(this.eval(node, ctx), type, 1));
    if (!r.ok) {
      if (type && type.name === 'String' && !type.dims && node.k === 'Name') throw new Error(`'${src}' ist keine bekannte Variable – Texte bitte in Anführungszeichen schreiben, z. B. "${src}"`);
      if (r.value instanceof JClassRef) throw new Error(`${src} ist eine Klasse und kein Wert`);
      throw new Error(r.message);
    }
    if (r.value instanceof JClassRef) throw new Error(`${src} ist eine Klasse und kein Wert`);
    return r.value;
  }
  sig(m) { return `${m.isCtor ? '' : typeStr(m.ret) + ' '}${m.name}(${m.params.map(p => typeStr(p.type) + ' ' + p.name).join(', ')})`; }
  describeClass(name) {
    const c = this.classes.get(name); if (!c) return null;
    const pub = (m) => m.vis !== 'private';
    return {
      name: c.name, isAbstract: c.isAbstract, isInterface: c.isInterface, isEnum: c.isEnum,
      ctors: (c.isAbstract || c.isEnum) ? [] : (c.ctors.length ? c.ctors.filter(pub) : [{ name: c.name, params: [], isCtor: true, cls: c, ret: VOID, implicit: true }]).map(m => ({ m, label: 'new ' + this.sig(m), doc: m.doc })),
      statics: c.methodList.filter(m => m.static && pub(m)).map(m => ({ m, label: this.sig(m), doc: m.doc })),
      hasStatics: c.fieldList.some(f => f.static),
    };
  }
  describeObject(o) {
    const groups = [];
    if (!(o instanceof JObject)) return groups;
    if (o.cls.native) {
      const ui = [];
      for (let c = o.cls; c; c = c.superClass) if (c.native && c.native.ui) ui.push(...c.native.ui);
      groups.push({ from: o.cls.name, methods: ui.map(u => ({ m: { name: u.name, params: u.params, ret: u.ret, native: true, cls: o.cls }, label: `${typeStr(u.ret)} ${u.name}(${u.params.map(p => typeStr(p.type) + ' ' + p.name).join(', ')})` })) });
      return groups;
    }
    const seen = new Set();
    for (let c = o.cls; c && c.decl; c = c.superClass) {
      const ms = [];
      for (const m of c.methodList) {
        if (m.static || m.vis === 'private' || m.abstract) continue;
        const k = m.name + '(' + m.params.map(p => typeStr(p.type)).join(',') + ')';
        if (seen.has(k)) continue; seen.add(k);
        ms.push({ m, label: this.sig(m), doc: m.doc });
      }
      if (ms.length) groups.push({ from: c.name, methods: ms, inherited: c !== o.cls });
    }
    for (let c = o.cls; c; c = c.superClass) if (c.native && c.native.ui) {
      const ms = c.native.ui.filter(u => !seen.has(u.name + '(' + u.params.map(p => typeStr(p.type)).join(',') + ')')).map(u => ({ m: { name: u.name, params: u.params, ret: u.ret, native: true, cls: c }, label: `${typeStr(u.ret)} ${u.name}(${u.params.map(p => typeStr(p.type) + ' ' + p.name).join(', ')})` }));
      if (ms.length) groups.push({ from: c.name, methods: ms, inherited: true });
      break;
    }
    const ifaceDefaults = [];
    const visit = (c) => { for (const i of c.interfaces) { for (const m of i.methodList) { const k = m.name + '(' + m.params.map(p => typeStr(p.type)).join(',') + ')'; if (!m.abstract && !m.static && !seen.has(k) && !i.builtin) { seen.add(k); ifaceDefaults.push({ m, label: this.sig(m), doc: m.doc }); } } visit(i); } };
    for (let c = o.cls; c; c = c.superClass) visit(c);
    if (ifaceDefaults.length) groups.push({ from: 'Interfaces', methods: ifaceDefaults, inherited: true });
    return groups;
  }
  callMethod(obj, m, args) { return this.runSync(this.callMethodG(obj, m, args)); }
  *callMethodG(obj, m, args) {
    if (m.native) return yield* this.callOnG(obj, m.name, args, 0, null);
    if (m.isCtor) return yield* this.instantiateG(m.cls, args, 0);
    if (m.static) return yield* this.invokeG(m, null, args, 0);
    return yield* this.invokeVirtualG(obj, m, args, 0);
  }
  inspect(v) {
    const rows = [];
    if (v instanceof JArray) {
      v.data.forEach((x, i) => rows.push({ name: `[${i}]`, type: typeStr(v.elemType), value: x }));
      return { title: `${typeStr(v.elemType)}[${v.data.length}]`, rows };
    }
    if (!(v instanceof JObject)) return { title: this.typeNameOf(v), rows };
    const ns = this.nativeSpec(v.cls);
    if (ns && ns.inspectRows) {
      const chain = []; for (let c = v.cls; c && c.decl; c = c.superClass) chain.unshift(c);
      for (const r of ns.inspectRows(this, v)) rows.push({ ...r, from: chain.length ? this.nativeOwner(v.cls) : undefined });
      for (const c of chain) for (const f of c.fieldList) if (!f.static) rows.push({ name: f.name, type: typeStr(f.type), vis: f.vis, value: v.fields[f.name], from: c.name });
      return { title: v.cls.name, rows };
    }
    if (v.native) {
      if (v.native.list) v.native.list.forEach((x, i) => rows.push({ name: `[${i}]`, type: v.native.elemType ? typeStr(v.native.elemType) : 'Object', value: x }));
      else if (v.native.keys) v.native.keys.forEach((k, i) => rows.push({ name: this.displayValue(k), type: '→', value: v.native.vals[i] }));
      else if (v.native.sb !== undefined) rows.push({ name: 'Inhalt', type: 'String', value: v.native.sb });
      return { title: v.cls.name + (v.native.list ? ` (${v.native.list.length} Elemente)` : v.native.keys ? ` (${v.native.keys.length} Einträge)` : ''), rows };
    }
    const chain = []; for (let c = v.cls; c && c.decl; c = c.superClass) chain.unshift(c);
    for (const c of chain) for (const f of c.fieldList) if (!f.static) rows.push({ name: f.name, type: typeStr(f.type), vis: f.vis, value: v.fields[f.name], from: c.name });
    return { title: v.cls.name, rows };
  }
  inspectStatic(cls) {
    this.ensureStaticInit(cls);
    return { title: 'Klasse ' + cls.name, rows: cls.fieldList.filter(f => f.static).map(f => ({ name: f.name, type: typeStr(f.type), vis: f.vis, value: cls.staticValues[f.name] })) };
  }
  displayValue(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof JChar) return "'" + String.fromCharCode(v.c) + "'";
    if (typeof v === 'bigint') return v.toString() + 'L';
    if (v instanceof JObject && v.enumName !== undefined) return v.cls.name + '.' + v.enumName;
    return this.str(v);
  }
  isRef(v) { return v instanceof JObject || v instanceof JArray; }

  // ------------------------------------------------ Eingebaute Klassen
  installNatives() {
    const rt = this;
    const def = (name, spec) => {
      const c = new ClassInfo(name, null, { builtin: true, native: spec, pkg: spec.pkg || 'java.lang' });
      c.isInterface = !!spec.isInterface; c.isAbstract = c.isInterface || !!spec.isAbstract;
      if (name !== 'Object') c.superClass = this.classes.get(spec.superName || 'Object');
      c.interfaces = (spec.interfaces || []).map(n => this.classes.get(n)).filter(Boolean);
      this.classes.set(name, c);
      return c;
    };
    const objOf = (name, nat) => { const o = new JObject(this.classes.get(name)); o.native = nat; return o; };
    this._def = def; this._objOf = objOf;
    const ex = (n, m) => rt.throwJava(n, m);
    const intArg = (v, line) => rt.toInt(v, line);
    def('Object', { extendable: true, ctor(rt) { return new JObject(rt.classes.get('Object')); } });
    def('Class', { methods: { getName(rt, o) { return o.native.of ? o.native.of.fullName : o.native.name; }, getSimpleName(rt, o) { return o.native.of ? o.native.of.name : o.native.name; } }, toString(rt, o) { return 'class ' + (o.native.of ? o.native.of.fullName : o.native.name); } });
    def('String', { statics: {
      valueOf(rt, a) { if (a[0] instanceof JArray) return a[0].data.map(c => rt.str(c)).join(''); return rt.str(a[0]); },
      format(rt, a, line) { return rt.format(a[0], a.slice(1), line); },
      join(rt, a) { const sep = rt.str(a[0]); let items = a.slice(1); if (items.length === 1 && items[0] instanceof JArray) items = items[0].data; else if (items.length === 1 && items[0] instanceof JObject && items[0].native && items[0].native.list) items = items[0].native.list; return items.map(x => rt.str(x)).join(sep); },
    } });
    def('CharSequence', { isInterface: true });
    const printSpec = (isErr) => ({
      println(rt, o, a) { rt.print((a.length ? rt.printArg(a[0]) : '') + '\n', o.native.err); },
      print(rt, o, a, line) { if (!a.length) rt.rtError('print braucht einen Wert', line); rt.print(rt.printArg(a[0]), o.native.err); },
      printf(rt, o, a, line) { rt.print(rt.format(a[0], a.slice(1), line), o.native.err); return o; },
      format(rt, o, a, line) { rt.print(rt.format(a[0], a.slice(1), line), o.native.err); return o; },
      flush() { },
    });
    def('PrintStream', { pkg: 'java.io', methods: printSpec() });
    let outObj = null, errObj = null;
    def('System', { sfields: { out: (rt) => outObj || (outObj = objOf('PrintStream', { err: false })), err: (rt) => errObj || (errObj = objOf('PrintStream', { err: true })), in: null }, sfieldTypes: { out: T('PrintStream'), err: T('PrintStream') },
      statics: {
        currentTimeMillis() { return BigInt(Date.now()); }, nanoTime() { return BigInt(Math.round(performance.now() * 1e6)); },
        exit(rt, a) { throw new ExitSig(a[0]); },
        arraycopy(rt, a, line) { const [src, sp, dst, dp, len] = a; if (src === null || dst === null) rt.npe(); const s = intArg(sp), d = intArg(dp), n = intArg(len); if (s < 0 || d < 0 || n < 0 || s + n > src.data.length || d + n > dst.data.length) ex('ArrayIndexOutOfBoundsException', 'arraycopy: last source index ' + (s + n) + ' out of bounds'); const tmp = src.data.slice(s, s + n); for (let i = 0; i < n; i++) dst.data[d + i] = tmp[i]; },
      } });
    const D = (x) => new JDouble(x);
    const dbl = (v) => rt.num(v);
    const promote = (a) => a.some(x => x instanceof JDouble) ? 'double' : a.some(x => typeof x === 'bigint') ? 'long' : 'int';
    def('Math', { sfields: { PI: D(Math.PI), E: D(Math.E) }, sfieldTypes: { PI: DOUBLE, E: DOUBLE }, statics: {
      abs(rt, a) { const v = a[0]; const k = rt.kindOf(v); if (k === 'double') return D(Math.abs(v.v)); if (k === 'long') return v < 0n ? -v : v; return Math.abs(rt.num(v)) | 0; },
      max(rt, a) { const p = promote(a); if (p === 'double') return D(Math.max(dbl(a[0]), dbl(a[1]))); if (p === 'long') { const x = BigInt(rt.str(a[0])), y = BigInt(rt.str(a[1])); return x > y ? x : y; } return Math.max(rt.num(a[0]), rt.num(a[1])); },
      min(rt, a) { const p = promote(a); if (p === 'double') return D(Math.min(dbl(a[0]), dbl(a[1]))); if (p === 'long') { const x = BigInt(rt.str(a[0])), y = BigInt(rt.str(a[1])); return x < y ? x : y; } return Math.min(rt.num(a[0]), rt.num(a[1])); },
      pow(rt, a) { return D(Math.pow(dbl(a[0]), dbl(a[1]))); }, sqrt(rt, a) { return D(Math.sqrt(dbl(a[0]))); }, cbrt(rt, a) { return D(Math.cbrt(dbl(a[0]))); },
      random() { return D(Math.random()); },
      round(rt, a) { const x = dbl(a[0]); if (Number.isNaN(x)) return 0n; return BigInt(Math.floor(x + 0.5)); },
      floor(rt, a) { return D(Math.floor(dbl(a[0]))); }, ceil(rt, a) { return D(Math.ceil(dbl(a[0]))); }, rint(rt, a) { const x = dbl(a[0]); const r = Math.round(x); return D(Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r); },
      sin(rt, a) { return D(Math.sin(dbl(a[0]))); }, cos(rt, a) { return D(Math.cos(dbl(a[0]))); }, tan(rt, a) { return D(Math.tan(dbl(a[0]))); },
      asin(rt, a) { return D(Math.asin(dbl(a[0]))); }, acos(rt, a) { return D(Math.acos(dbl(a[0]))); }, atan(rt, a) { return D(Math.atan(dbl(a[0]))); }, atan2(rt, a) { return D(Math.atan2(dbl(a[0]), dbl(a[1]))); },
      exp(rt, a) { return D(Math.exp(dbl(a[0]))); }, log(rt, a) { return D(Math.log(dbl(a[0]))); }, log10(rt, a) { return D(Math.log10(dbl(a[0]))); },
      hypot(rt, a) { return D(Math.hypot(dbl(a[0]), dbl(a[1]))); }, signum(rt, a) { return D(Math.sign(dbl(a[0]))); },
      toRadians(rt, a) { return D(dbl(a[0]) * Math.PI / 180); }, toDegrees(rt, a) { return D(dbl(a[0]) * 180 / Math.PI); },
      floorDiv(rt, a) { const y = rt.num(a[1]); if (!y) ex('ArithmeticException', '/ by zero'); return Math.floor(rt.num(a[0]) / y); },
      floorMod(rt, a) { const x = rt.num(a[0]), y = rt.num(a[1]); if (!y) ex('ArithmeticException', '/ by zero'); return ((x % y) + y) % y; },
    } });
    const parseIntJ = (s, radix = 10) => {
      if (s === null) ex('NumberFormatException', 'Cannot parse null string: null');
      const str = rt.str(s); const re = radix === 10 ? /^[+-]?\d+$/ : radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : /^[+-]?[0-9a-zA-Z]+$/;
      if (!re.test(str)) ex('NumberFormatException', `For input string: "${str}"`);
      const v = parseInt(str, radix);
      if (v > 2147483647 || v < -2147483648) ex('NumberFormatException', `For input string: "${str}"`);
      return v;
    };
    def('Number', { isAbstract: true });
    def('Integer', { superName: 'Number', sfields: { MAX_VALUE: 2147483647, MIN_VALUE: -2147483648 }, sfieldTypes: { MAX_VALUE: INT, MIN_VALUE: INT }, statics: {
      parseInt(rt, a) { return parseIntJ(a[0], a[1] ? rt.num(a[1]) : 10); }, valueOf(rt, a) { return typeof a[0] === 'string' ? parseIntJ(a[0]) : rt.toInt(a[0]); },
      toString(rt, a) { return a.length > 1 ? rt.num(a[0]).toString(rt.num(a[1])) : rt.str(a[0]); }, toBinaryString(rt, a) { return (rt.num(a[0]) >>> 0).toString(2); }, toHexString(rt, a) { return (rt.num(a[0]) >>> 0).toString(16); },
      compare(rt, a) { return Math.sign(rt.num(a[0]) - rt.num(a[1])); }, sum(rt, a) { return (rt.num(a[0]) + rt.num(a[1])) | 0; }, max(rt, a) { return Math.max(rt.num(a[0]), rt.num(a[1])); }, min(rt, a) { return Math.min(rt.num(a[0]), rt.num(a[1])); },
    } });
    def('Long', { superName: 'Number', sfields: { MAX_VALUE: 9223372036854775807n, MIN_VALUE: -9223372036854775808n }, sfieldTypes: { MAX_VALUE: LONG, MIN_VALUE: LONG }, statics: {
      parseLong(rt, a) { const s = rt.str(a[0]); if (!/^[+-]?\d+$/.test(s)) ex('NumberFormatException', `For input string: "${s}"`); return BigInt.asIntN(64, BigInt(s)); }, valueOf(rt, a) { return typeof a[0] === 'bigint' ? a[0] : BigInt(rt.str(a[0])); }, toString(rt, a) { return rt.str(a[0]); },
    } });
    def('Double', { superName: 'Number', sfields: { MAX_VALUE: D(Number.MAX_VALUE), MIN_VALUE: D(Number.MIN_VALUE), POSITIVE_INFINITY: D(Infinity), NEGATIVE_INFINITY: D(-Infinity), NaN: D(NaN) }, sfieldTypes: { MAX_VALUE: DOUBLE, MIN_VALUE: DOUBLE, POSITIVE_INFINITY: DOUBLE, NEGATIVE_INFINITY: DOUBLE, NaN: DOUBLE }, statics: {
      parseDouble(rt, a) { if (a[0] === null) rt.npe(); const s = rt.str(a[0]).trim(); if (!/^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[dDfF]?)$/.test(s)) ex('NumberFormatException', `For input string: "${rt.str(a[0])}"`); return D(parseFloat(s.replace(/[dDfF]$/, ''))); },
      valueOf(rt, a) { return typeof a[0] === 'string' ? this.parseDouble(rt, a) : D(dbl(a[0])); }, toString(rt, a) { return fmtDouble(dbl(a[0])); },
      isNaN(rt, a) { return Number.isNaN(dbl(a[0])); }, isInfinite(rt, a) { return !Number.isFinite(dbl(a[0])) && !Number.isNaN(dbl(a[0])); }, compare(rt, a) { return Math.sign(dbl(a[0]) - dbl(a[1])); },
    } });
    def('Float', { superName: 'Number', statics: { parseFloat(rt, a) { return D(Math.fround(parseFloat(rt.str(a[0])))); } } });
    def('Short', { superName: 'Number' }); def('Byte', { superName: 'Number' });
    def('Boolean', { statics: { parseBoolean(rt, a) { return typeof a[0] === 'string' && a[0].toLowerCase() === 'true'; }, valueOf(rt, a) { return typeof a[0] === 'boolean' ? a[0] : (typeof a[0] === 'string' && a[0].toLowerCase() === 'true'); }, toString(rt, a) { return rt.str(a[0]); } } });
    const ch = (v) => v instanceof JChar ? v.c : rt.num(v);
    const chs = (v) => String.fromCharCode(ch(v));
    def('Character', { statics: {
      isDigit(rt, a) { return /\d/.test(chs(a[0])); }, isLetter(rt, a) { return /\p{L}/u.test(chs(a[0])); }, isLetterOrDigit(rt, a) { return /[\p{L}\d]/u.test(chs(a[0])); },
      isUpperCase(rt, a) { const s = chs(a[0]); return s !== s.toLowerCase(); }, isLowerCase(rt, a) { const s = chs(a[0]); return s !== s.toUpperCase(); }, isWhitespace(rt, a) { return /\s/.test(chs(a[0])); },
      toUpperCase(rt, a) { return a[0] instanceof JChar ? new JChar(chs(a[0]).toUpperCase().charCodeAt(0)) : chs(a[0]).toUpperCase().charCodeAt(0); },
      toLowerCase(rt, a) { return a[0] instanceof JChar ? new JChar(chs(a[0]).toLowerCase().charCodeAt(0)) : chs(a[0]).toLowerCase().charCodeAt(0); },
      getNumericValue(rt, a) { const s = chs(a[0]); return /\d/.test(s) ? +s : /[a-z]/i.test(s) ? s.toLowerCase().charCodeAt(0) - 87 : -1; },
      toString(rt, a) { return chs(a[0]); }, valueOf(rt, a) { return a[0]; },
    } });

    // ---- Collections
    const listIdx = (o, i, size) => { if (i < 0 || i >= size) ex('IndexOutOfBoundsException', `Index ${i} out of bounds for length ${size}`); };
    const elem = (o, v, line) => o.native.elemType ? rt.coerce(v, o.native.elemType, line) : v;
    const isColl = (v) => v instanceof JObject && v.native && v.native.list;
    const LIST_NAMES = new Set(['ArrayList', 'LinkedList', 'ArrayDeque', 'Stack', 'Vector']);
    // Iterator über das Array einer Liste/Menge (remove entfernt dort, bei keySet() auch aus der Map)
    const mkIter = (L, owner) => { const it = new JObject(rt.classes.get('Itr')); it.native = { L, i: 0, last: -1, n: L.length, owner }; return it; };
    const collOps = {
      iterator(rt, o) { return mkIter(o.native.list, o); },
      containsAll(rt, o, a) { return collArg0(a[0]).every(x => o.native.list.some(y => rt.javaEquals(x, y))); },
      removeAll(rt, o, a) { const B = collArg0(a[0]); const L = o.native.list; const keep = L.filter(x => !B.some(y => rt.javaEquals(x, y))); const ch = keep.length !== L.length; dropFromMap(o, L.filter(x => !keep.includes(x))); L.length = 0; L.push(...keep); return ch; },
      retainAll(rt, o, a) { const B = collArg0(a[0]); const L = o.native.list; const keep = L.filter(x => B.some(y => rt.javaEquals(x, y))); const ch = keep.length !== L.length; dropFromMap(o, L.filter(x => !keep.includes(x))); L.length = 0; L.push(...keep); return ch; },
      toArray(rt, o) { return new JArray(T('Object'), o.native.list.slice()); },
    };
    const collArg0 = (v) => { if (v === null) rt.npe(); if (!isColl(v)) rt.rtError('Hier wird eine Liste oder Menge erwartet'); return v.native.list; };
    // keySet()/entrySet() einer Map: Entfernen wirkt auch auf die Map
    const dropFromMap = (o, keys) => { const m = o.native.mapOwner; if (!m) return; for (const k of keys) { const kk = o.native.entries ? k.native.key : k; const i = mapFind(m, kk); if (i >= 0) { m.native.keys.splice(i, 1); m.native.vals.splice(i, 1); } } };
    const listSpec = {
      pkg: 'java.util', interfaces: ['List'],
      ctor(rt, args, line, type) {
        const o = new JObject(rt.classes.get(type && LIST_NAMES.has(type.name) ? type.name : 'ArrayList'));
        o.native = { list: [], elemType: type && type.args && type.args[0] ? type.args[0] : null };
        if (args.length === 1 && isColl(args[0])) o.native.list = args[0].native.list.slice();
        return o;
      },
      methods: {
        add(rt, o, a, line) { if (a.length === 1) { o.native.list.push(elem(o, a[0], line)); return true; } const i = intArg(a[0], line); if (i < 0 || i > o.native.list.length) listIdx(o, i, o.native.list.length); o.native.list.splice(i, 0, elem(o, a[1], line)); },
        addAll(rt, o, a) { if (!isColl(a[0])) rt.rtError('addAll braucht eine Liste'); o.native.list.push(...a[0].native.list); return true; },
        get(rt, o, a, line) { const i = intArg(a[0], line); listIdx(o, i, o.native.list.length); return o.native.list[i]; },
        set(rt, o, a, line) { const i = intArg(a[0], line); listIdx(o, i, o.native.list.length); const old = o.native.list[i]; o.native.list[i] = elem(o, a[1], line); return old; },
        remove(rt, o, a, line) {
          const L = o.native.list;
          if (typeof a[0] === 'number' && !(o.native.elemType && o.native.elemType.name === 'Integer' && false)) { const i = a[0]; listIdx(o, i, L.length); return L.splice(i, 1)[0]; }
          const k = L.findIndex(x => rt.javaEquals(a[0], x)); if (k >= 0) { L.splice(k, 1); return true; } return false;
        },
        size(rt, o) { return o.native.list.length; }, isEmpty(rt, o) { return o.native.list.length === 0; }, clear(rt, o) { o.native.list.length = 0; },
        contains(rt, o, a) { return o.native.list.some(x => rt.javaEquals(a[0], x)); },
        indexOf(rt, o, a) { return o.native.list.findIndex(x => rt.javaEquals(a[0], x)); },
        lastIndexOf(rt, o, a) { const L = o.native.list; for (let i = L.length - 1; i >= 0; i--) if (rt.javaEquals(a[0], L[i])) return i; return -1; },
        getFirst(rt, o) { if (!o.native.list.length) ex('NoSuchElementException'); return o.native.list[0]; }, getLast(rt, o) { if (!o.native.list.length) ex('NoSuchElementException'); return o.native.list[o.native.list.length - 1]; },
        addFirst(rt, o, a, line) { o.native.list.unshift(elem(o, a[0], line)); }, addLast(rt, o, a, line) { o.native.list.push(elem(o, a[0], line)); },
        removeFirst(rt, o) { if (!o.native.list.length) ex('NoSuchElementException'); return o.native.list.shift(); }, removeLast(rt, o) { if (!o.native.list.length) ex('NoSuchElementException'); return o.native.list.pop(); },
        sort(rt, o, a) { o.native.list.sort(rt.cmpOf(a[0])); },
        forEach(rt, o, a, line) { const L = o.native.list; return new Delegate((function* () { const n = L.length; for (let i = 0; i < L.length; i++) { yield* rt.fnG(a[0], 'accept', [L[i]], line); if (L.length !== n) ex('ConcurrentModificationException'); } })()); },
        removeIf(rt, o, a, line) { const L = o.native.list; return new Delegate((function* () { const keep = []; let any = false; for (const x of L.slice()) { if ((yield* rt.fnG(a[0], 'test', [x], line)) === true) any = true; else keep.push(x); } L.length = 0; L.push(...keep); return any; })()); },
        replaceAll(rt, o, a, line) { const L = o.native.list; return new Delegate((function* () { for (let i = 0; i < L.length; i++) L[i] = elem(o, yield* rt.fnG(a[0], 'apply', [L[i]], line), line); })()); },
        toArray(rt, o) { return new JArray(T('Object'), o.native.list.slice()); },
        equals(rt, o, a) { return rt.javaEquals(o, a[0]); },
        ...collOps,
        subList(rt, o, a) { const n = rt.classes.get('ArrayList'); const r = new JObject(n); r.native = { list: o.native.list.slice(intArg(a[0]), intArg(a[1])), elemType: o.native.elemType }; return r; },
      },
      toString(rt, o) { return '[' + o.native.list.map(x => x === o ? '(this Collection)' : rt.str(x)).join(', ') + ']'; },
      ui: [{ name: 'add', params: [{ type: T('Object'), name: 'element' }], ret: BOOL }, { name: 'get', params: [{ type: INT, name: 'index' }], ret: T('Object') }, { name: 'size', params: [], ret: INT }, { name: 'remove', params: [{ type: INT, name: 'index' }], ret: T('Object') }, { name: 'contains', params: [{ type: T('Object'), name: 'o' }], ret: BOOL }, { name: 'isEmpty', params: [], ret: BOOL }, { name: 'clear', params: [], ret: VOID }],
    };
    def('Iterable', { isInterface: true, pkg: 'java.lang' });
    def('Collection', { isInterface: true, pkg: 'java.util', interfaces: ['Iterable'] });
    def('List', { isInterface: true, pkg: 'java.util', interfaces: ['Collection'] });
    def('ArrayList', listSpec);
    def('Itr', { pkg: 'java.util', lateInterfaces: ['Iterator'], methods: {
      hasNext(rt, o) { return o.native.i < o.native.L.length; },
      next(rt, o) { const n = o.native; if (n.L.length !== n.n) ex('ConcurrentModificationException'); if (n.i >= n.L.length) ex('NoSuchElementException'); n.last = n.i; return n.L[n.i++]; },
      remove(rt, o) {
        const n = o.native; if (n.last < 0) ex('IllegalStateException', 'remove() nur einmal nach next()');
        const [x] = n.L.splice(n.last, 1); n.i = n.last; n.last = -1; n.n = n.L.length;
        if (n.owner) { dropFromMap(n.owner, [x]); if (n.owner.native.pq) n.owner.native.heapify(); }
      },
    }, retTypes: { hasNext: BOOL } });
    // Warteschlangen: LinkedList und ArrayDeque (Deque), Stack, PriorityQueue
    const L0 = (o) => o.native.list;
    const dequeOps = {
      offer(rt, o, a, line) { L0(o).push(elem(o, a[0], line)); return true; }, offerLast(rt, o, a, line) { L0(o).push(elem(o, a[0], line)); return true; }, offerFirst(rt, o, a, line) { L0(o).unshift(elem(o, a[0], line)); return true; },
      poll(rt, o) { return L0(o).length ? L0(o).shift() : null; }, pollFirst(rt, o) { return L0(o).length ? L0(o).shift() : null; }, pollLast(rt, o) { return L0(o).length ? L0(o).pop() : null; },
      peek(rt, o) { return L0(o).length ? L0(o)[0] : null; }, peekFirst(rt, o) { return L0(o).length ? L0(o)[0] : null; }, peekLast(rt, o) { const L = L0(o); return L.length ? L[L.length - 1] : null; },
      element(rt, o) { if (!L0(o).length) ex('NoSuchElementException'); return L0(o)[0]; },
      push(rt, o, a, line) { L0(o).unshift(elem(o, a[0], line)); }, pop(rt, o) { if (!L0(o).length) ex('NoSuchElementException'); return L0(o).shift(); },
      remove(rt, o, a, line) { if (!a.length) { if (!L0(o).length) ex('NoSuchElementException'); return L0(o).shift(); } return listSpec.methods.remove(rt, o, a, line); },
      descendingIterator(rt, o) { return mkIter(L0(o).slice().reverse(), null); },
    };
    def('Queue', { isInterface: true, pkg: 'java.util', interfaces: ['Collection'] });
    def('Deque', { isInterface: true, pkg: 'java.util', interfaces: ['Queue'] });
    def('LinkedList', { ...listSpec, interfaces: ['List', 'Deque'], methods: { ...listSpec.methods, ...dequeOps } });
    const lm = listSpec.methods;
    def('ArrayDeque', { ...listSpec, interfaces: ['Deque'], methods: { add: (rt, o, a, line) => { L0(o).push(elem(o, a[0], line)); return true; }, addAll: lm.addAll, size: lm.size, isEmpty: lm.isEmpty, clear: lm.clear, contains: lm.contains, getFirst: lm.getFirst, getLast: lm.getLast, addFirst: lm.addFirst, addLast: lm.addLast, removeFirst: lm.removeFirst, removeLast: lm.removeLast, forEach: lm.forEach, removeIf: lm.removeIf, ...collOps, ...dequeOps } });
    def('Stack', { ...listSpec, interfaces: ['List'], methods: { ...listSpec.methods,
      push(rt, o, a, line) { const v = elem(o, a[0], line); L0(o).push(v); return v; },
      pop(rt, o) { if (!L0(o).length) ex('EmptyStackException'); return L0(o).pop(); },
      peek(rt, o) { const L = L0(o); if (!L.length) ex('EmptyStackException'); return L[L.length - 1]; },
      empty(rt, o) { return !L0(o).length; },
      search(rt, o, a) { const L = L0(o); for (let i = L.length - 1; i >= 0; i--) if (rt.javaEquals(a[0], L[i])) return L.length - i; return -1; },
    } });
    // PriorityQueue als Binärheap wie in Java (gleiche Reihenfolge bei toString und for-each)
    const pqSpec = {
      pkg: 'java.util', interfaces: ['Queue'],
      ctor(rt, args, line, type) {
        const o = new JObject(rt.classes.get('PriorityQueue'));
        const n = o.native = { list: [], elemType: type && type.args && type.args[0] || null, pq: true, cmp: null };
        for (const x of args) { if (isColl(x)) n.list = x.native.list.slice(); else if (x instanceof JObject) n.cmp = x; }
        n.heapify = () => { for (let i = (n.list.length >>> 1) - 1; i >= 0; i--) down(o, i, n.list[i]); };
        n.heapify();
        return o;
      },
      methods: {
        add(rt, o, a, line) { return pqSpec.methods.offer(rt, o, a, line); },
        offer(rt, o, a, line) { const v = elem(o, a[0], line); if (v === null) rt.npe(); const L = L0(o); L.push(v); up(o, L.length - 1, v); return true; },
        peek(rt, o) { return L0(o).length ? L0(o)[0] : null; },
        element(rt, o) { if (!L0(o).length) ex('NoSuchElementException'); return L0(o)[0]; },
        poll(rt, o) { const L = L0(o); if (!L.length) return null; const r = L[0], x = L.pop(); if (L.length) down(o, 0, x); return r; },
        remove(rt, o, a) {
          const L = L0(o);
          if (!a.length) { if (!L.length) ex('NoSuchElementException'); return pqSpec.methods.poll(rt, o); }
          const i = L.findIndex(x => rt.javaEquals(a[0], x)); if (i < 0) return false;
          const s2 = L.length - 1; if (s2 === i) { L.pop(); return true; }
          const moved = L.pop(); down(o, i, moved); if (L[i] === moved) up(o, i, moved); return true;
        },
        size: lm.size, isEmpty: lm.isEmpty, clear: lm.clear, contains: lm.contains, forEach: lm.forEach,
        addAll(rt, o, a, line) { for (const x of collArg0(a[0])) pqSpec.methods.offer(rt, o, [x], line); return true; },
        ...collOps,
      },
      toString: listSpec.toString,
      ui: [{ name: 'add', params: [{ type: T('Object'), name: 'element' }], ret: BOOL }, { name: 'poll', params: [], ret: T('Object') }, { name: 'peek', params: [], ret: T('Object') }, { name: 'size', params: [], ret: INT }],
    };
    const pqCmp = (o) => rt.cmpOf(o.native.cmp);
    const up = (o, k, x) => { const q = L0(o), c = pqCmp(o); while (k > 0) { const p = (k - 1) >>> 1, e = q[p]; if (c(x, e) >= 0) break; q[k] = e; k = p; } q[k] = x; };
    const down = (o, k, x) => { const q = L0(o), c = pqCmp(o), n = q.length, half = n >>> 1; while (k < half) { let ch = 2 * k + 1, cv = q[ch]; const r = ch + 1; if (r < n && c(cv, q[r]) > 0) cv = q[ch = r]; if (c(x, cv) <= 0) break; q[k] = cv; k = ch; } q[k] = x; };
    def('PriorityQueue', pqSpec);
    const setSpec = {
      pkg: 'java.util', interfaces: ['Set'],
      ctor(rt, args, line, type) { const o = new JObject(rt.classes.get(type && ['TreeSet', 'LinkedHashSet'].includes(type.name) ? type.name : 'HashSet')); o.native = { list: [], elemType: type && type.args && type.args[0] || null, sorted: type && type.name === 'TreeSet' }; if (args.length === 1 && isColl(args[0])) for (const x of args[0].native.list) setSpec.methods.add(rt, o, [x]); else if (args.length === 1 && args[0] instanceof JObject) o.native.cmp = args[0]; return o; },
      methods: {
        add(rt, o, a, line) { const v = elem(o, a[0], line); const c = o.native.cmp ? rt.cmpOf(o.native.cmp) : null; if (o.native.list.some(x => c ? c(v, x) === 0 : rt.javaEquals(v, x))) return false; o.native.list.push(v); if (o.native.sorted) o.native.list.sort(c || ((x, y) => rt.compareValues(x, y))); return true; },
        remove(rt, o, a) { const k = o.native.list.findIndex(x => rt.javaEquals(a[0], x)); if (k >= 0) { const [x] = o.native.list.splice(k, 1); dropFromMap(o, [x]); return true; } return false; },
        contains(rt, o, a) { return o.native.list.some(x => rt.javaEquals(a[0], x)); },
        size(rt, o) { return o.native.list.length; }, isEmpty(rt, o) { return !o.native.list.length; }, clear(rt, o) { o.native.list.length = 0; },
        addAll(rt, o, a) { let ch = false; for (const x of a[0].native.list) ch = setSpec.methods.add(rt, o, [x]) || ch; return ch; },
        forEach: listSpec.methods.forEach, removeIf: listSpec.methods.removeIf,
        ...collOps,
        first(rt, o) { if (!o.native.list.length) ex('NoSuchElementException'); return o.native.list[0]; },
        last(rt, o) { const L = o.native.list; if (!L.length) ex('NoSuchElementException'); return L[L.length - 1]; },
        pollFirst(rt, o) { return o.native.list.length ? o.native.list.shift() : null; },
        pollLast(rt, o) { return o.native.list.length ? o.native.list.pop() : null; },
        floor(rt, o, a) { return navig(o, a[0], (d) => d <= 0, true); }, lower(rt, o, a) { return navig(o, a[0], (d) => d < 0, true); },
        ceiling(rt, o, a) { return navig(o, a[0], (d) => d >= 0, false); }, higher(rt, o, a) { return navig(o, a[0], (d) => d > 0, false); },
      },
      toString: listSpec.toString,
      ui: [{ name: 'add', params: [{ type: T('Object'), name: 'element' }], ret: BOOL }, { name: 'contains', params: [{ type: T('Object'), name: 'o' }], ret: BOOL }, { name: 'size', params: [], ret: INT }],
    };
    def('Set', { isInterface: true, pkg: 'java.util', interfaces: ['Collection'] });
    def('HashSet', setSpec); def('TreeSet', setSpec); def('LinkedHashSet', setSpec);
    // TreeSet/TreeMap: nächstes Element (floor, ceiling …); L ist sortiert
    const navig = (o, v, ok, fromEnd) => { const L = o.native.list || o.native.keys, c = rt.cmpOf(o.native.cmp); if (fromEnd) { for (let i = L.length - 1; i >= 0; i--) if (ok(c(L[i], v))) return L[i]; } else for (const x of L) if (ok(c(x, v))) return x; return null; };
    const mkEntry = (m, k) => { const e = new JObject(rt.classes.get('Entry')); e.native = { map: m, key: k }; return e; };
    const entryVal = (e) => { const n = e.native; if (!n.map) return n.val; const i = mapFind(n.map, n.key); return i >= 0 ? n.map.native.vals[i] : null; };
    def('Entry', { pkg: 'java.util', methods: {
      getKey(rt, o) { return o.native.key; }, getValue(rt, o) { return entryVal(o); },
      setValue(rt, o, a, line) { const old = entryVal(o); if (o.native.map) mapSpec.methods.put(rt, o.native.map, [o.native.key, a[0]], line); else o.native.val = a[0]; return old; },
      equals(rt, o, a) { const b = a[0]; return b instanceof JObject && b.cls === o.cls && rt.javaEquals(o.native.key, b.native.key) && rt.javaEquals(entryVal(o), entryVal(b)); },
      hashCode(rt, o) { return rt.hashOf(o.native.key) ^ rt.hashOf(entryVal(o)); },
    }, toString(rt, o) { return rt.str(o.native.key) + '=' + rt.str(entryVal(o)); } });
    const mapFind = (o, k) => o.native.keys.findIndex(x => rt.javaEquals(k, x));
    const mapSpec = {
      pkg: 'java.util', interfaces: ['Map'],
      ctor(rt, args, line, type) { const o = new JObject(rt.classes.get(type && ['TreeMap', 'LinkedHashMap'].includes(type.name) ? type.name : 'HashMap')); o.native = { keys: [], vals: [], kType: type && type.args && type.args[0] || null, vType: type && type.args && type.args[1] || null, sorted: type && type.name === 'TreeMap' }; if (args.length === 1 && args[0] instanceof JObject && args[0].native && args[0].native.keys) { for (let i = 0; i < args[0].native.keys.length; i++) mapSpec.methods.put(rt, o, [args[0].native.keys[i], args[0].native.vals[i]]); } else if (args.length === 1 && args[0] instanceof JObject) o.native.cmp = args[0]; return o; },
      methods: {
        put(rt, o, a, line) { const k = o.native.kType ? rt.coerce(a[0], o.native.kType, line) : a[0]; const v = o.native.vType ? rt.coerce(a[1], o.native.vType, line) : a[1]; const i = mapFind(o, k); if (i >= 0) { const old = o.native.vals[i]; o.native.vals[i] = v; return old; } o.native.keys.push(k); o.native.vals.push(v); if (o.native.sorted) { const c = rt.cmpOf(o.native.cmp); const idx = o.native.keys.map((_, j) => j).sort((x, y) => c(o.native.keys[x], o.native.keys[y])); o.native.keys = idx.map(j => o.native.keys[j]); o.native.vals = idx.map(j => o.native.vals[j]); } return null; },
        putIfAbsent(rt, o, a, line) { const i = mapFind(o, a[0]); if (i >= 0 && o.native.vals[i] !== null) return o.native.vals[i]; mapSpec.methods.put(rt, o, a, line); return null; },
        forEach(rt, o, a, line) { const K = o.native.keys.slice(), V = o.native.vals.slice(); return new Delegate((function* () { for (let i = 0; i < K.length; i++) yield* rt.fnG(a[0], 'accept', [K[i], V[i]], line); })()); },
        computeIfAbsent(rt, o, a, line) { const i = mapFind(o, a[0]); if (i >= 0 && o.native.vals[i] !== null) return o.native.vals[i]; return new Delegate((function* () { const v = yield* rt.fnG(a[1], 'apply', [a[0]], line); if (v !== null) mapSpec.methods.put(rt, o, [a[0], v], line); return v; })()); },
        merge(rt, o, a, line) { const i = mapFind(o, a[0]); if (i < 0 || o.native.vals[i] === null) { mapSpec.methods.put(rt, o, [a[0], a[1]], line); return a[1]; } return new Delegate((function* () { const v = yield* rt.fnG(a[2], 'apply', [o.native.vals[i], a[1]], line); if (v === null) mapSpec.methods.remove(rt, o, [a[0]]); else mapSpec.methods.put(rt, o, [a[0], v], line); return v; })()); },
        get(rt, o, a) { const i = mapFind(o, a[0]); return i >= 0 ? o.native.vals[i] : null; },
        getOrDefault(rt, o, a) { const i = mapFind(o, a[0]); return i >= 0 ? o.native.vals[i] : a[1]; },
        containsKey(rt, o, a) { return mapFind(o, a[0]) >= 0; }, containsValue(rt, o, a) { return o.native.vals.some(v => rt.javaEquals(a[0], v)); },
        remove(rt, o, a) { const i = mapFind(o, a[0]); if (i < 0) return null; o.native.keys.splice(i, 1); return o.native.vals.splice(i, 1)[0]; },
        size(rt, o) { return o.native.keys.length; }, isEmpty(rt, o) { return !o.native.keys.length; }, clear(rt, o) { o.native.keys = []; o.native.vals = []; },
        keySet(rt, o) { const s = new JObject(rt.classes.get('HashSet')); s.native = { list: o.native.keys.slice(), elemType: o.native.kType, mapOwner: o }; return s; },
        entrySet(rt, o) { const s = new JObject(rt.classes.get('HashSet')); s.native = { list: o.native.keys.map(k => mkEntry(o, k)), elemType: null, mapOwner: o, entries: true }; return s; },
        putAll(rt, o, a, line) { const m = a[0]; if (m === null) rt.npe(); for (let i = 0; i < m.native.keys.length; i++) mapSpec.methods.put(rt, o, [m.native.keys[i], m.native.vals[i]], line); },
        replace(rt, o, a, line) { const i = mapFind(o, a[0]); if (i < 0) return null; const old = o.native.vals[i]; o.native.vals[i] = a[1]; return old; },
        firstKey(rt, o) { if (!o.native.keys.length) ex('NoSuchElementException'); return o.native.keys[0]; },
        lastKey(rt, o) { const K = o.native.keys; if (!K.length) ex('NoSuchElementException'); return K[K.length - 1]; },
        firstEntry(rt, o) { return o.native.keys.length ? mkEntry(o, o.native.keys[0]) : null; },
        lastEntry(rt, o) { const K = o.native.keys; return K.length ? mkEntry(o, K[K.length - 1]) : null; },
        floorKey(rt, o, a) { return navig(o, a[0], (d) => d <= 0, true); }, lowerKey(rt, o, a) { return navig(o, a[0], (d) => d < 0, true); },
        ceilingKey(rt, o, a) { return navig(o, a[0], (d) => d >= 0, false); }, higherKey(rt, o, a) { return navig(o, a[0], (d) => d > 0, false); },
        values(rt, o) { const s = new JObject(rt.classes.get('ArrayList')); s.native = { list: o.native.vals.slice(), elemType: o.native.vType }; return s; },
      },
      toString(rt, o) { return '{' + o.native.keys.map((k, i) => rt.str(k) + '=' + rt.str(o.native.vals[i])).join(', ') + '}'; },
      ui: [{ name: 'put', params: [{ type: T('Object'), name: 'key' }, { type: T('Object'), name: 'value' }], ret: T('Object') }, { name: 'get', params: [{ type: T('Object'), name: 'key' }], ret: T('Object') }, { name: 'size', params: [], ret: INT }],
    };
    const mkList = (items, cls = 'ArrayList') => { const o = new JObject(rt.classes.get(cls)); o.native = { list: items, elemType: null }; return o; };
    def('Map', { isInterface: true, pkg: 'java.util', statics: {
      of(rt, a) { const o = mapSpec.ctor(rt, [], 0, T('HashMap')); for (let i = 0; i + 1 < a.length; i += 2) mapSpec.methods.put(rt, o, [a[i], a[i + 1]]); return o; },
      entry(rt, a) { const e = new JObject(rt.classes.get('Entry')); e.native = { map: null, key: a[0], val: a[1] }; return e; },
    }, staticRet: { of: T('Map'), entry: T('Entry') } });
    def('HashMap', mapSpec); def('TreeMap', mapSpec); def('LinkedHashMap', mapSpec);
    rt.classes.get('List').native.statics = { of(rt, a) { return mkList(a.length === 1 && a[0] instanceof JArray ? a[0].data.slice() : a.slice()); }, copyOf(rt, a) { return mkList(collArg0(a[0]).slice()); } };
    rt.classes.get('List').native.staticRet = { of: T('List'), copyOf: T('List') };
    rt.classes.get('Set').native.statics = { of(rt, a) { const o = setSpec.ctor(rt, [], 0, T('LinkedHashSet')); for (const x of a) if (!setSpec.methods.add(rt, o, [x])) ex('IllegalArgumentException', 'duplicate element: ' + rt.str(x)); return o; } };
    rt.classes.get('Set').native.staticRet = { of: T('Set') };

    // ---- Random (Java-kompatibler Zufallsgenerator)
    const MULT = 0x5DEECE66Dn, MASK = (1n << 48n) - 1n;
    const next = (o, bits) => { o.native.seed = (o.native.seed * MULT + 0xBn) & MASK; return Number(BigInt.asIntN(32, o.native.seed >> BigInt(48 - bits))); };
    const nextInt = (o, bound) => {
      if (bound <= 0) ex('IllegalArgumentException', 'bound must be positive');
      let r = next(o, 31); const m = bound - 1;
      if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
      for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = next(o, 31));
      return r;
    };
    def('Random', { pkg: 'java.util',
      ctor(rt, a) { const o = new JObject(rt.classes.get('Random')); const s = a.length ? BigInt(rt.str(a[0])) : BigInt(Math.floor(Math.random() * 2 ** 48)); o.native = { seed: (s ^ MULT) & MASK }; return o; },
      methods: {
        nextInt(rt, o, a) { if (!a.length) return next(o, 32); if (a.length === 2) { const lo = rt.num(a[0]), hi = rt.num(a[1]); if (lo >= hi) ex('IllegalArgumentException', 'bound must be greater than origin'); return lo + nextInt(o, hi - lo); } return nextInt(o, rt.num(a[0])); },
        nextDouble(rt, o) { return D((next(o, 26) * 134217728 + next(o, 27)) * 2 ** -53); },
        nextBoolean(rt, o) { return next(o, 1) !== 0; },
        nextGaussian(rt, o) { let v1, v2, s; do { v1 = 2 * ((next(o, 26) * 134217728 + next(o, 27)) * 2 ** -53) - 1; v2 = 2 * ((next(o, 26) * 134217728 + next(o, 27)) * 2 ** -53) - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0); return D(v1 * Math.sqrt(-2 * Math.log(s) / s)); },
      },
      ui: [{ name: 'nextInt', params: [{ type: INT, name: 'bound' }], ret: INT }, { name: 'nextDouble', params: [], ret: DOUBLE }, { name: 'nextBoolean', params: [], ret: BOOL }],
    });
    def('StringBuilder', {
      ctor(rt, a) { const o = new JObject(rt.classes.get('StringBuilder')); o.native = { sb: a.length && typeof a[0] === 'string' ? a[0] : '' }; return o; },
      methods: {
        append(rt, o, a) { o.native.sb += rt.printArg(a[0]); return o; }, toString(rt, o) { return o.native.sb; }, length(rt, o) { return o.native.sb.length; },
        reverse(rt, o) { o.native.sb = [...o.native.sb].reverse().join(''); return o; },
        insert(rt, o, a) { const i = intArg(a[0]); if (i < 0 || i > o.native.sb.length) ex('StringIndexOutOfBoundsException', 'offset ' + i); o.native.sb = o.native.sb.slice(0, i) + rt.str(a[1]) + o.native.sb.slice(i); return o; },
        charAt(rt, o, a) { return rt.stringMethod(o.native.sb, 'charAt', a); },
        deleteCharAt(rt, o, a) { const i = intArg(a[0]); if (i < 0 || i >= o.native.sb.length) ex('StringIndexOutOfBoundsException', 'index ' + i); o.native.sb = o.native.sb.slice(0, i) + o.native.sb.slice(i + 1); return o; },
        setCharAt(rt, o, a) { const i = intArg(a[0]); if (i < 0 || i >= o.native.sb.length) ex('StringIndexOutOfBoundsException', 'index ' + i); o.native.sb = o.native.sb.slice(0, i) + rt.str(a[1]) + o.native.sb.slice(i + 1); },
        indexOf(rt, o, a) { return o.native.sb.indexOf(rt.str(a[0])); },
        delete(rt, o, a) { o.native.sb = o.native.sb.slice(0, intArg(a[0])) + o.native.sb.slice(intArg(a[1])); return o; },
        isEmpty(rt, o) { return !o.native.sb.length; },
      },
      toString(rt, o) { return o.native.sb; },
      ui: [{ name: 'append', params: [{ type: T('Object'), name: 'x' }], ret: T('StringBuilder') }, { name: 'toString', params: [], ret: STRING }, { name: 'length', params: [], ret: INT }],
    });
    const arrArg = (v) => { if (v === null) rt.npe(); if (!(v instanceof JArray)) rt.rtError('Array erwartet'); return v; };
    def('Arrays', { pkg: 'java.util', statics: {
      toString(rt, a) { if (a[0] === null) return 'null'; return '[' + arrArg(a[0]).data.map(x => rt.str(x)).join(', ') + ']'; },
      deepToString(rt, a) { const f = (x) => x instanceof JArray ? '[' + x.data.map(f).join(', ') + ']' : rt.str(x); return f(a[0]); },
      sort(rt, a) { const arr = arrArg(a[0]); if (a.length === 2) { if (arr.elemType.dims === 0 && PRIMS.has(arr.elemType.name)) rt.rtError('Arrays.sort mit Comparator geht nur bei Arrays von Objekten (z. B. Integer[] statt int[])'); arr.data.sort(rt.cmpOf(a[1])); return; } if (a.length === 3) { const s = intArg(a[1]), e = intArg(a[2]); const part = arr.data.slice(s, e).sort((x, y) => rt.compareValues(x, y)); arr.data.splice(s, e - s, ...part); } else arr.data.sort((x, y) => rt.compareValues(x, y)); },
      fill(rt, a, line) { const arr = arrArg(a[0]); const v = rt.coerce(a[a.length - 1], arr.elemType, line); if (a.length === 4) { for (let i = intArg(a[1]); i < intArg(a[2]); i++) arr.data[i] = v; } else arr.data.fill(v); },
      copyOf(rt, a) { const arr = arrArg(a[0]); const n = intArg(a[1]); const d = arr.data.slice(0, n); while (d.length < n) d.push(defaultValue(arr.elemType)); return new JArray(arr.elemType, d); },
      copyOfRange(rt, a) { const arr = arrArg(a[0]); return new JArray(arr.elemType, arr.data.slice(intArg(a[1]), intArg(a[2]))); },
      equals(rt, a) { if (a[0] === null || a[1] === null) return a[0] === a[1]; return a[0].data.length === a[1].data.length && a[0].data.every((x, i) => rt.javaEquals(x, a[1].data[i])); },
      binarySearch(rt, a) { return binSearch(arrArg(a[0]).data, a[1], rt.cmpOf(a[2])); },
      asList(rt, a) { const o = new JObject(rt.classes.get('ArrayList')); o.native = { list: a.length === 1 && a[0] instanceof JArray ? a[0].data.slice() : a.slice(), elemType: null }; return o; },
      stream() { rt.rtError('Streams werden nicht unterstützt'); },
    } });
    const collArg = (v) => { if (!isColl(v)) rt.rtError('Liste erwartet'); return v.native.list; };
    const binSearch = (L, key, c) => { let lo = 0, hi = L.length - 1; while (lo <= hi) { const mid = (lo + hi) >>> 1, d = c(L[mid], key); if (d < 0) lo = mid + 1; else if (d > 0) hi = mid - 1; else return mid; } return -(lo + 1); };
    def('Collections', { pkg: 'java.util', statics: {
      sort(rt, a) { collArg(a[0]).sort(rt.cmpOf(a[1])); },
      reverseOrder(rt, a) { if (a.length) { const c = a[0]; return rt.nativeLambda('Comparator', (rt, b) => rt.cmpOf(c)(b[1], b[0])); } return rt.nativeLambda('Comparator', (rt, b) => rt.compareValues(b[1], b[0])); },
      reverse(rt, a) { collArg(a[0]).reverse(); },
      shuffle(rt, a) { const L = collArg(a[0]); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } },
      max(rt, a) { const L = collArg(a[0]); if (!L.length) ex('NoSuchElementException'); const c = rt.cmpOf(a[1]); return L.reduce((m, x) => c(x, m) > 0 ? x : m); },
      min(rt, a) { const L = collArg(a[0]); if (!L.length) ex('NoSuchElementException'); const c = rt.cmpOf(a[1]); return L.reduce((m, x) => c(x, m) < 0 ? x : m); },
      swap(rt, a) { const L = collArg(a[0]); const i = intArg(a[1]), j = intArg(a[2]); listIdx(null, i, L.length); listIdx(null, j, L.length); [L[i], L[j]] = [L[j], L[i]]; },
      frequency(rt, a) { return collArg(a[0]).filter(x => rt.javaEquals(a[1], x)).length; },
      addAll(rt, a, line) { const o = a[0]; let ch = false; for (const x of a.slice(1)) ch = rt.callFn(o, 'add', [x]) !== false || ch; return ch; },
      nCopies(rt, a) { const n = intArg(a[0]); if (n < 0) ex('IllegalArgumentException', 'List length = ' + n); return mkList(new Array(n).fill(a[1])); },
      fill(rt, a) { collArg(a[0]).fill(a[1]); },
      emptyList() { return mkList([]); },
      unmodifiableList(rt, a) { return a[0]; }, unmodifiableSet(rt, a) { return a[0]; }, unmodifiableMap(rt, a) { return a[0]; },
      binarySearch(rt, a) { return binSearch(collArg(a[0]), a[1], rt.cmpOf(a[2])); },
    } });
    def('Thread', { statics: { sleep(rt, a) { return rt.sleep(a.length ? rt.num(a[0]) : 0); } } });
    def('Objects', { pkg: 'java.util', statics: { equals(rt, a) { return rt.javaEquals(a[0], a[1]); }, hash(rt, a) { let h = 1; for (const x of a) h = (Math.imul(31, h) + rt.hashOf(x)) | 0; return h; }, isNull(rt, a) { return a[0] === null; }, requireNonNull(rt, a) { if (a[0] === null) rt.npe(a[1] || null); return a[0]; } } });

  }
  printArg(v) { if (v instanceof JArray && v.elemType.name === 'char' && !v.elemType.dims) return v.data.map(c => String.fromCharCode(c.c)).join(''); return this.str(v); }
}

// ---------------------------------------------------------------- Prüfer (Übersetzungsfehler finden)
const NUM_ORDER = { byte: 0, short: 1, char: 1, int: 2, long: 3, float: 4, double: 5 };
class Checker {
  constructor(rt, cls, errors) { this.rt = rt; this.cls = cls; this.errors = errors; this.fileId = cls.fileId; this.count = 0; }
  err(line, msg) { if (this.count++ < 1) this.errors.push({ fileId: this.fileId, line, message: msg }); throw new StopCheck(); }
  run() {
    const c = this.cls, d = c.decl;
    try {
      for (const f of d.fields) {
        this.checkType(f.type, f.line);
        if (f.init) { this.ctx = { isStatic: f.static, method: null, loops: 0, tps: c.typeParams }; const sc = new Scope(null); this.diamond(f.type, f.init); const t = f.init.k === 'ArrayInit' ? this.arrayInit(f.init, f.type, sc) : this.expr(f.init, sc); this.assignCheck(f.type, t, f.init, f.line); this.flushLambdas(0); }
      }
      for (const ec of d.enumConsts) { this.ctx = { isStatic: true, loops: 0, tps: [] }; this.ctorArgsCheck(c, ec.args.map(a => this.expr(a, new Scope(null))), ec.line); }
      for (const m of d.methods) {
        for (const p of m.params) this.checkType(p.type, m.line, m.typeParams);
        if (m.ret.name !== 'void') this.checkType(m.ret, m.line, m.typeParams);
        this.overrideCheck(m);
        if (m.body) this.body(m, false);
      }
      for (const k of d.ctors) { for (const p of k.params) this.checkType(p.type, k.line); this.body(k, true); }
      if (!d.ctors.length && c.superClass && !c.isInterface && !c.isEnum && !d.anonBase) this.implicitSuper(d.line);
      for (const b of d.inits) { this.ctx = { isStatic: b.static, loops: 0, tps: c.typeParams }; this.stmt(b.body, new Scope(null)); }
    } catch (e) { if (!(e instanceof StopCheck)) throw e; }
  }
  overrideCheck(m) {
    if (m.static) return;
    for (let s = this.cls.superClass; s && s.decl; s = s.superClass) {
      const o = (s.methods.get(m.name) || []).find(x => x.params.length === m.params.length && x.params.every((p, i) => typeStr(p.type) === typeStr(m.params[i].type)));
      if (o) {
        if (o.mods.has('final')) this.err(m.line, `${m.name}() kann nicht überschrieben werden, weil die Methode in ${s.name} final ist`);
        if (o.vis === 'public' && m.vis !== 'public' && o.vis !== m.vis) this.err(m.line, `${m.name}() muss public sein, weil die überschriebene Methode in ${s.name} public ist`);
        if (typeStr(o.ret) !== typeStr(m.ret) && PRIMS.has(o.ret.name) | PRIMS.has(m.ret.name) | o.ret.name === 'void' | m.ret.name === 'void') this.err(m.line, `${m.name}() überschreibt die Methode aus ${s.name} mit anderem Rückgabetyp (${typeStr(o.ret)} statt ${typeStr(m.ret)})`);
        return;
      }
    }
    if (m.name === 'toString' && !m.params.length && m.vis !== 'public' && !this.cls.isInterface) this.err(m.line, 'toString() muss public sein');
  }
  implicitSuper(line) {
    const s = this.cls.superClass;
    if (!s || !s.decl || !s.ctors.length) return;
    if (!s.ctors.some(k => k.params.length === 0)) this.err(line, `Die Oberklasse ${s.name} hat keinen Konstruktor ohne Parameter – rufe im Konstruktor zuerst super(…) mit passenden Werten auf`);
  }
  knownType(name, tps) {
    if (PRIMS.has(name) || name === 'var' || this.rt.classes.has(name) || (tps || []).includes(name) || (this.ctx && this.ctx.tps || []).includes(name)) return true;
    for (let c = this.cls; c; c = c.outer) if ((c.typeParams || []).includes(name)) return true;
    for (let en = this.encl; en; en = en.checker.encl) if ((en.checker.ctx && en.checker.ctx.tps || []).includes(name)) return true;
    return false;
  }
  // ---- geprüfte Ausnahmen (wie javac: abfangen oder mit throws deklarieren)
  throwsOf(m, line) {
    const out = [];
    for (const n of (m && m.throws) || []) {
      const c = this.rt.classes.get(n);
      if (!c) this.err(line, `Ausnahmeklasse '${n}' nicht gefunden` + suggest(n, [...this.rt.classes.keys()].filter(k => /Exception|Error|Throwable/.test(k))));
      if (!c.isSubclassOf(this.rt.classes.get('Throwable'))) this.err(line, `Hinter throws dürfen nur Ausnahmeklassen stehen, ${n} ist keine`);
      out.push(c);
    }
    return out;
  }
  isChecked(c) {
    const k = (n) => this.rt.classes.get(n);
    return !!c && c.isSubclassOf(k('Throwable')) && !c.isSubclassOf(k('RuntimeException')) && !c.isSubclassOf(k('Error'));
  }
  thrown(c, line) {
    if (!this.isChecked(c) || !this.ctx) return;
    const tries = this.ctx.tries || [];
    for (let i = tries.length - 1; i >= 0; i--) {
      const f = tries[i];
      f.thrown.push(c);
      if (f.catches.some(k => c.isSubclassOf(k))) return;
    }
    if ((this.ctx.throwsDecl || []).some(k => c.isSubclassOf(k))) return;
    const where = this.ctx.method && this.ctx.method.lambda ? ' – in einem Lambda-Ausdruck geht nur try/catch' : this.ctx.method ? ` oder die Methode mit „throws ${c.name}“ kennzeichnen` : '';
    this.err(line, `Die Ausnahme ${c.name} muss abgefangen werden (try/catch)${where}`);
  }
  thrownBy(m, line) { for (const n of (m && m.throws) || []) this.thrown(this.rt.classes.get(n), line); }
  // ---- verschachtelte Klassen und eingefangene Variablen
  // Lokale und anonyme Klassen werden an ihrer Stelle im umgebenden Code geprüft (encl),
  // damit sie die lokalen Variablen dort sehen.
  inlineCheck(c, sc) {
    const sub = new Checker(this.rt, c, this.errors);
    sub.encl = { checker: this, sc, isStatic: this.ctx.isStatic };
    sub.run();
    if (sub.count) throw new StopCheck();
  }
  // Schritt nach außen: von einer lokalen/anonymen Klasse zum umgebenden Code, von einer
  // inneren Klasse zur äußeren. Liefert false am Ende.
  outward(st) {
    if (st.ch && st.ch.encl) { st.sc = st.ch.encl.sc; st.static = st.static || st.ch.encl.isStatic; st.ch = st.ch.encl.checker; st.cls = st.ch.cls; return true; }
    st.sc = null;
    if (st.cls.outer) { st.static = st.static || st.cls.staticNested; st.cls = st.cls.outer; st.ch = null; return true; }
    return false;
  }
  effFinal(inf) { return inf.init ? inf.assigns === 0 : inf.assigns <= 1; }
  capture(name, r, line) {
    const inf = r.scope.info.get(name); if (!inf) return;
    if (!this.effFinal(inf)) this.err(line, `Die lokale Variable '${name}' wird in einem Lambda-Ausdruck oder einer inneren Klasse verwendet und muss deshalb final oder effektiv final sein (sie wird an anderer Stelle verändert)`);
    if (!inf.captured) inf.captured = line;
  }
  assignedVar(name, r, line) {
    if (r.crossed) this.err(line, `Die lokale Variable '${name}' kann in einem Lambda-Ausdruck nicht verändert werden (sie muss final oder effektiv final sein)`);
    const inf = r.scope.info.get(name); if (!inf) return;
    inf.assigns++;
    if (inf.captured && !this.effFinal(inf)) this.err(line, `Die Variable '${name}' wird in einem Lambda-Ausdruck oder einer inneren Klasse verwendet (Zeile ${inf.captured}) und darf deshalb nicht verändert werden`);
  }
  outerLookup(name, line) {
    const st = { ch: this, cls: this.cls, static: !!this.ctx.isStatic };
    while (this.outward(st)) {
      if (st.sc) { const r = st.sc.find(name); if (r) { this.capture(name, r, line); return { t: r.t, local: true }; } }
      const f = this.rt.findField(st.cls, name);
      if (f) {
        if (!f.field.static && st.static) this.err(line, `Auf das Attribut '${name}' von ${st.cls.name} kann hier nicht zugegriffen werden – es gibt kein Objekt von ${st.cls.name} (statische Klasse oder statische Methode)`);
        return { t: f.field.type, f };
      }
    }
    return null;
  }
  outerMethod(name, at, line) {
    const st = { ch: this, cls: this.cls, static: !!this.ctx.isStatic };
    while (this.outward(st)) {
      const ms = this.rt.lookupMethods(st.cls, name);
      if (!ms.length) continue;
      const m = this.pick(ms, at, line, `Methode ${name}`, st.cls);
      if (!m.static && st.static) this.err(line, `Die Methode ${name}() von ${st.cls.name} braucht ein Objekt – hier gibt es keins (statische Klasse oder statische Methode)`);
      return this.retType(m, null);
    }
    return undefined;
  }
  hasOuterInstance(target) {
    const st = { ch: this, cls: this.cls, static: !!this.ctx.isStatic };
    do { if (!st.static && st.cls.isSubclassOf(target)) return true; } while (this.outward(st));
    return false;
  }
  checkType(t, line, tps) {
    if (!t || t.name === 'void') return;
    if (!this.knownType(t.name, tps)) {
      const lower = { string: 'String', integer: 'Integer', Int: 'int', Boolean: 'Boolean', Double: 'Double', bool: 'boolean', Arraylist: 'ArrayList', arraylist: 'ArrayList' };
      this.err(line, `Typ '${t.name}' nicht gefunden` + (lower[t.name] ? ` (meinten Sie '${lower[t.name]}'?)` : suggest(t.name, [...this.rt.classes.keys(), ...PRIMS])));
    }
    if (t.args) for (const a of t.args) this.checkType(a, line, tps);
  }
  body(m, isCtor) {
    this.ctx = { isStatic: !!m.static, method: m, isCtor, loops: 0, switches: 0, tps: [...(this.cls.typeParams || []), ...(m.typeParams || [])], tries: [], throwsDecl: this.throwsOf(m, m.line) };
    const sc = new Scope(null);
    for (const p of m.params) sc.declare(p.name, p.type, m.line, this);
    const stmts = m.body.stmts;
    if (isCtor) {
      const first = stmts[0];
      const hasCall = first && first.k === 'Expr' && first.e.k === 'CtorCall';
      if (hasCall) {
        const at = first.e.args.map(a => this.expr(a, sc));
        if (first.e.which === 'super') { const s = this.cls.superClass; if (s && s.decl) this.ctorArgsCheck(s, at, first.line); }
        else this.ctorArgsCheck(this.cls, at, first.line);
      } else this.implicitSuper(m.line);
      this.ctx.ctorBodyStart = hasCall ? 1 : 0;
    }
    this.block(stmts, sc, isCtor ? this.ctx.ctorBodyStart : 0);
    if (!isCtor && m.ret.name !== 'void' && this.canComplete(m.body)) this.err(m.body.endLine, `return-Anweisung fehlt: Die Methode ${m.name} muss einen Wert vom Typ ${typeStr(m.ret)} zurückgeben`);
  }
  block(stmts, sc, start = 0) {
    for (let i = start; i < stmts.length; i++) {
      const s = stmts[i];
      if (i > 0 && ['Return', 'Break', 'Continue', 'Throw', 'Yield'].includes(stmts[i - 1].k)) this.err(s.line, 'Diese Anweisung wird nie erreicht (sie steht nach return/break/continue/throw)');
      this.stmt(s, sc);
    }
  }
  canComplete(s) {
    if (!s) return true;
    switch (s.k) {
      case 'Return': case 'Throw': case 'Yield': return false;
      case 'Block': return s.stmts.length === 0 || s.stmts.every(x => this.canComplete(x));
      case 'If': return !s.b || this.canComplete(s.a) || this.canComplete(s.b);
      case 'While': return !(s.c.k === 'Lit' && s.c.v === true) || this.hasBreak(s.body);
      case 'DoWhile': return this.canComplete(s.body) && !(s.c.k === 'Lit' && s.c.v === true) || this.hasBreak(s.body);
      case 'For': return !(!s.c || (s.c.k === 'Lit' && s.c.v === true)) || this.hasBreak(s.body);
      case 'Try': return (this.canComplete(s.block) || s.catches.some(c => this.canComplete(c.body))) && (!s.fin || this.canComplete(s.fin)) || (s.fin && !this.canComplete(s.fin) ? false : (this.canComplete(s.block) || s.catches.some(c => this.canComplete(c.body))));
      case 'Switch': {
        if (!s.cases.some(c => !c.labels)) return true;
        if (s.arrow) return s.cases.some(c => c.stmts.some(x => this.canComplete(x)));
        if (s.cases.some(c => c.stmts.some(x => this.hasBreak(x, true)))) return true;
        const last = s.cases[s.cases.length - 1];
        return last.stmts.length === 0 || this.canComplete({ k: 'Block', stmts: last.stmts });
      }
      default: return true;
    }
  }
  hasBreak(s, inSwitch) {
    if (!s) return false;
    switch (s.k) {
      case 'Break': return true;
      case 'Block': return s.stmts.some(x => this.hasBreak(x, inSwitch));
      case 'If': return this.hasBreak(s.a, inSwitch) || this.hasBreak(s.b, inSwitch);
      case 'Try': return this.hasBreak(s.block, inSwitch) || s.catches.some(c => this.hasBreak(c.body, inSwitch)) || this.hasBreak(s.fin, inSwitch);
      case 'Switch': return false;
      case 'While': case 'DoWhile': case 'For': case 'ForEach': return false;
      default: return false;
    }
  }
  condCheck(e, sc) {
    const t = this.expr(e, sc);
    if (t && t.dims === 0 && t.name !== 'boolean' && t.name !== 'Boolean' && t.name !== 'null') {
      if (e.k === 'Assign' && e.op === '=') this.err(e.line, `Inkompatible Typen: ${typeStr(t)} kann nicht in boolean umgewandelt werden – für Vergleiche == statt = verwenden`);
      this.err(e.line, `Inkompatible Typen: Die Bedingung muss boolean sein, ist aber ${typeStr(t)}`);
    }
    if (t && t.dims > 0) this.err(e.line, 'Die Bedingung muss boolean sein');
  }
  stmt(s, sc) {
    const d = this.depth || 0;
    this.depth = d + 1;
    try { this.stmt0(s, sc); } finally { this.depth = d; }
    this.flushLambdas(d + 1);
  }
  stmt0(s, sc) {
    switch (s.k) {
      case 'Block': { const s2 = new Scope(sc); this.block(s.stmts, s2); return; }
      case 'Local':
        for (const d of s.decls) {
          let t = d.type;
          this.checkType(t, s.line);
          if (d.init) {
            this.diamond(t, d.init);
            const it = d.init.k === 'ArrayInit' ? (t.name === 'var' ? this.err(s.line, 'var kann nicht mit { … } verwendet werden') : this.arrayInit(d.init, t, sc)) : this.expr(d.init, sc);
            if (t.name === 'var') { if (it && it.name === 'void') this.err(s.line, 'Die Methode liefert keinen Wert (void)'); if (it && it.lambda) this.err(s.line, 'Bei var ist der Typ eines Lambda-Ausdrucks unbekannt – gib das Interface an, z. B. Runnable r = () -> …'); t = it && it.name !== 'null' ? it : null; }
            else this.assignCheck(t, it, d.init, s.line);
          } else if (t.name === 'var') this.err(s.line, 'var braucht einen Startwert');
          sc.declare(d.name, t, s.line, this, !!d.init);
        }
        return;
      case 'Expr':
        if (s.e.k === 'CtorCall') this.err(s.line, `${s.e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`);
        this.expr(s.e, sc); return;
      case 'Empty': return;
      case 'LocalClass': this.inlineCheck(this.rt.classes.get(s.name), sc); return;
      case 'If': this.condCheck(s.c, sc); this.stmt(s.a, new Scope(sc)); if (s.b) this.stmt(s.b, new Scope(sc)); return;
      case 'While': this.condCheck(s.c, sc); this.loop(s.body, sc); return;
      case 'DoWhile': this.loop(s.body, sc); this.condCheck(s.c, sc); return;
      case 'For': { const s2 = new Scope(sc); for (const i of s.init) this.stmt(i, s2); if (s.c) this.condCheck(s.c, s2); for (const u of s.upd) { this.expr(u, s2); if (!EXPR_STMT.has(u.k)) this.err(s.line, 'Im dritten Teil der for-Schleife muss eine Anweisung stehen (z. B. i++)'); } this.loop(s.body, s2); return; }
      case 'ForEach': {
        const it = this.expr(s.it, sc); const s2 = new Scope(sc);
        let et = null;
        if (it) {
          if (it.dims > 0) et = { ...it, dims: it.dims - 1 };
          else if (PRIMS.has(it.name) || it.name === 'String') this.err(s.line, `for-each geht nur über Arrays und Listen, nicht über ${typeStr(it)}`);
          else if (['Map', 'HashMap', 'TreeMap', 'LinkedHashMap'].includes(it.name)) this.err(s.line, 'Über eine Map geht for-each nicht direkt – verwende keySet(), values() oder entrySet()');
          else if (it.args && it.args.length === 1) et = it.args[0];
          else { const ic = this.userClass(it); if (ic && ic.decl && !ic.builtin) { const im = this.rt.lookupMethods(ic, 'iterator').find(m => !m.params.length); if (!im && !ic.isSubclassOf(this.rt.classes.get('Iterable'))) this.err(s.line, `for-each geht nur über Arrays, Listen und Objekte, die Iterable implementieren – ${ic.name} tut das nicht`); if (im && im.ret && im.ret.args && im.ret.args[0] && this.norm(im.ret.args[0])) et = im.ret.args[0]; } }
        }
        if (s.type.name !== 'var') { this.checkType(s.type, s.line); if (et) this.assignCheck(s.type, et, null, s.line); }
        s2.declare(s.name, s.type.name === 'var' ? et : s.type, s.line, this);
        this.loop(s.body, s2); return;
      }
      case 'Return': {
        const m = this.ctx.method;
        if (!m) this.err(s.line, 'return ist hier nicht erlaubt');
        if (m.lambda) {
          if (!m.ret) { if (s.e) this.expr(s.e, sc); return; }
          if (m.ret.name === 'void') { if (s.e) this.err(s.line, `Dieser Lambda-Ausdruck kann keinen Wert zurückgeben (${m.iface} ist void)`); return; }
          if (!s.e) this.err(s.line, `return braucht hier einen Wert vom Typ ${typeStr(m.ret)}`);
          this.assignCheck(m.ret, this.expr(s.e, sc), s.e, s.line); return;
        }
        if (this.ctx.isCtor) { if (s.e) this.err(s.line, 'Ein Konstruktor kann keinen Wert zurückgeben'); return; }
        if (m.ret.name === 'void') { if (s.e) this.err(s.line, `Die Methode ${m.name} ist void und kann keinen Wert zurückgeben`); return; }
        if (!s.e) this.err(s.line, `return braucht hier einen Wert vom Typ ${typeStr(m.ret)}`);
        const t = this.expr(s.e, sc); this.assignCheck(m.ret, t, s.e, s.line); return;
      }
      case 'Break': if (!this.ctx.loops && !this.ctx.switches) this.err(s.line, 'break außerhalb einer Schleife oder eines switch'); return;
      case 'Continue': if (!this.ctx.loops) this.err(s.line, 'continue außerhalb einer Schleife'); return;
      case 'Throw': { const t = this.expr(s.e, sc); const th = this.rt.classes.get('Throwable'); const c = t && this.rt.classes.get(t.name); if (t && !t.dims && c && !c.isSubclassOf(th)) this.err(s.line, `Nur Ausnahmen können geworfen werden, nicht ${typeStr(t)}`); if (t && !t.dims && c) this.thrown(c, s.line); return; }
      case 'Try': {
        const frame = { catches: [], thrown: [] };
        for (const c of s.catches) for (const tn of c.types) { const k = this.rt.classes.get(tn); if (k) frame.catches.push(k); }
        if (!this.ctx.tries) this.ctx.tries = [];
        this.ctx.tries.push(frame);
        try { this.stmt(s.block, sc); } finally { this.ctx.tries.pop(); }
        for (const k of frame.catches) {
          if (!this.isChecked(k) || k.name === 'Exception' || k.name === 'Throwable') continue;
          if (!frame.thrown.some(x => x.isSubclassOf(k) || k.isSubclassOf(x))) this.err(s.line, `Die Ausnahme ${k.name} wird im try-Block nie geworfen – dieses catch ist überflüssig`);
        }
        for (const c of s.catches) { for (const tn of c.types) { const k = this.rt.classes.get(tn); if (!k) this.err(s.line, `Ausnahmeklasse '${tn}' nicht gefunden` + suggest(tn, [...this.rt.classes.keys()].filter(n => /Exception|Error|Throwable/.test(n)))); } const s2 = new Scope(sc); s2.declare(c.name, T(c.types[0]), s.line, this); this.stmt(c.body, s2); }
        if (s.fin) this.stmt(s.fin, sc); return;
      }
      case 'Yield': {
        const ys = this.ctx.yields;
        if (!ys || !ys.length) this.err(s.line, 'yield ist nur in einem switch-Ausdruck erlaubt');
        ys[ys.length - 1].push({ t: this.expr(s.e, sc), e: s.e, line: s.line });
        return;
      }
      case 'Switch': {
        const t = this.expr(s.e, sc);
        const ec = t && !t.dims && this.rt.classes.get(t.name);
        const isEnum = ec && ec.isEnum;
        if (t && !t.dims && !isEnum && !['int', 'char', 'String', 'short', 'byte', 'Integer', 'Character'].includes(t.name)) this.err(s.line, `switch geht nicht mit ${typeStr(t)} (erlaubt: int, char, String, enum)`);
        const s2 = new Scope(sc);
        this.ctx.switches++;
        const seen = new Set();
        for (const c of s.cases) {
          if (c.labels) for (const l of c.labels) {
            if (isEnum && l.k === 'Name') { if (!ec.fieldMap.has(l.name)) this.err(c.line, `${ec.name} hat keine Konstante ${l.name}`); }
            else { this.expr(l, s2); if (l.k !== 'Lit' && !(l.k === 'Unary' && l.e.k === 'Lit') && !(l.k === 'Field' || l.k === 'Name')) this.err(c.line, 'Bei case muss ein konstanter Wert stehen'); }
            const key = JSON.stringify(l, (k, v) => (k === 'line' ? undefined : typeof v === 'bigint' ? String(v) : v));
            if (seen.has(key)) this.err(c.line, 'Dieser case-Wert kommt doppelt vor'); seen.add(key);
          }
          for (const st of c.stmts) this.stmt(st, s.arrow ? new Scope(s2) : s2);
        }
        this.ctx.switches--;
        return;
      }
    }
  }
  loop(body, sc) { this.ctx.loops++; this.stmt(body, new Scope(sc)); this.ctx.loops--; }
  arrayInit(init, t, sc) {
    if (!t || t.dims < 1) this.err(init.line, `{ … } passt nicht zum Typ ${typeStr(t)}`);
    const et = { ...t, dims: t.dims - 1 };
    for (const e of init.elems) { if (e.k === 'ArrayInit') this.arrayInit(e, et, sc); else this.assignCheck(et, this.expr(e, sc), e, e.line); }
    return t;
  }
  norm(t) {
    if (!t) return null;
    if (t.classRef) return t;
    if (t.name === 'null' || t.name === 'void') return t;
    if (!PRIMS.has(t.name) && !this.rt.classes.has(t.name)) return null;
    return t;
  }
  unbox(t) { if (t && !t.dims && WRAP[t.name]) return T(WRAP[t.name]); return t; }
  isNum(t) { t = this.unbox(t); return t && !t.dims && NUM_ORDER[t.name] !== undefined; }
  assignable(to, from, expr) {
    if (!to || !from || from.classRef) return true;
    if (from.name === 'void') return false;
    if (from.name === 'null') return to.dims > 0 || !PRIMS.has(to.name);
    if (to.name === 'Object' && !to.dims) return true;
    if (to.dims || from.dims) {
      if (to.dims !== from.dims) return false;
      if (PRIMS.has(to.name) || PRIMS.has(from.name)) return to.name === from.name;
      return this.assignable(T(to.name), T(from.name));
    }
    const tp = PRIMS.has(to.name), fp = PRIMS.has(from.name);
    if (tp || WRAP[to.name]) {
      const t = WRAP[to.name] || to.name, f = WRAP[from.name] || from.name;
      if (!PRIMS.has(f)) return from.name === 'Object' ? false : !this.rt.classes.has(from.name) || from.name === 'Number' ? true : false;
      if (t === 'boolean' || f === 'boolean') return t === f;
      if (t === f) return true;
      if (WRAP[to.name] && fp && t !== f) return f === 'int' && ['short', 'byte', 'char'].includes(t) && expr && this.isConst(expr);
      if (['char', 'short', 'byte'].includes(t) && f === 'int' && expr && this.isConst(expr)) return true;
      if (t === 'char') return false;
      if (f === 'char') return NUM_ORDER[t] >= 2;
      return NUM_ORDER[f] < NUM_ORDER[t];
    }
    if (fp) { return ['Number', 'Comparable'].includes(to.name) && from.name !== 'boolean' || (to.name === 'Comparable'); }
    if (to.name === from.name) return true;
    const tc = this.rt.classes.get(to.name), fc = this.rt.classes.get(from.name);
    if (!tc || !fc) return true;
    if (to.name === 'String') return from.name === 'String';
    if (from.name === 'String') return ['CharSequence', 'Comparable'].includes(to.name);
    if (WRAP[from.name]) return ['Number', 'Comparable'].includes(to.name);
    return fc.isSubclassOf(tc);
  }
  isConst(e) { return e.k === 'Lit' || (e.k === 'Unary' && e.e.k === 'Lit') || (e.k === 'Paren' && this.isConst(e.e)); }
  assignCheck(to, from, expr, line) {
    if (from && from.lambda) { this.lambdaCheck(from, to); return; }
    to = this.norm(to); from = this.norm(from);
    if (!to || !from) return;
    if (from.name === 'void') this.err(line, 'Die Methode liefert keinen Wert (void) – er kann nicht verwendet werden');
    if (!this.assignable(to, from, expr)) {
      const lossy = !to.dims && !from.dims && NUM_ORDER[this.unbox(from).name] !== undefined && NUM_ORDER[this.unbox(to).name] !== undefined && NUM_ORDER[this.unbox(from).name] > NUM_ORDER[this.unbox(to).name];
      if (lossy) this.err(line, `Inkompatible Typen: möglicher Genauigkeitsverlust bei Umwandlung von ${typeStr(from)} nach ${typeStr(to)} (ggf. mit (${typeStr(to)}) umwandeln)`);
      let hint = '';
      if (to.name === 'String' && !to.dims && PRIMS.has(from.name)) hint = ' (Tipp: "" + wert oder String.valueOf(wert))';
      if (PRIMS.has(to.name) && from.name === 'String') hint = to.name === 'int' ? ' (Tipp: Integer.parseInt(text))' : to.name === 'double' ? ' (Tipp: Double.parseDouble(text))' : to.name === 'char' ? " (Tipp: Zeichen in einfache Anführungszeichen 'a')" : '';
      this.err(line, `Inkompatible Typen: ${typeStr(from)} kann nicht in ${typeStr(to)} umgewandelt werden${hint}`);
    }
  }
  promote(a, b) { a = this.unbox(a); b = this.unbox(b); if (!a || !b) return null; if (a.name === 'double' || b.name === 'double' || a.name === 'float' || b.name === 'float') return DOUBLE; if (a.name === 'long' || b.name === 'long') return LONG; return INT; }
  litType(v) {
    if (v === null) return T('null');
    if (typeof v === 'number') return INT; if (typeof v === 'bigint') return LONG; if (v instanceof JDouble) return DOUBLE; if (v instanceof JChar) return CHAR; if (typeof v === 'boolean') return BOOL; if (typeof v === 'string') return STRING;
    return null;
  }
  userClass(t) { if (!t || t.dims || PRIMS.has(t.name)) return null; return this.rt.classes.get(t.name) || null; }
  accessCheck(member, owner, line, what) {
    if (member.vis === 'private' && owner !== this.cls && this.rt.topOf(owner) !== this.rt.topOf(this.cls)) this.err(line, `${what} '${member.name}' ist private in ${owner.name} – Zugriff nur innerhalb dieser Klasse (verwende eine get-Methode)`);
  }
  visibleNames(sc) { const s = sc.allNames(); for (const f of this.rt.allFieldNames(this.cls)) s.push(f); return s; }
  expr(e, sc) {
    switch (e.k) {
      case 'Lit': return this.litType(e.v);
      case 'Paren': return this.expr(e.e, sc);
      case 'Name': {
        const r = sc.find(e.name);
        if (r) { if (r.crossed) this.capture(e.name, r, e.line); return r.t; }
        const f = this.rt.findField(this.cls, e.name);
        if (f) {
          if (!f.field.static && this.ctx.isStatic) this.err(e.line, `Das Attribut '${e.name}' gehört zu einem Objekt und kann in einer statischen Methode nicht verwendet werden`);
          if (f.owner !== this.cls && f.field.vis === 'private' && this.rt.topOf(f.owner) !== this.rt.topOf(this.cls)) this.err(e.line, `Attribut '${e.name}' ist private in ${f.owner.name} – Unterklassen können darauf nicht direkt zugreifen (protected oder get-Methode verwenden)`);
          return f.field.type;
        }
        const o = this.outerLookup(e.name, e.line);
        if (o) return o.t;
        if (this.rt.classes.has(e.name)) return { classRef: e.name };
        this.err(e.line, `Variable '${e.name}' nicht gefunden` + suggest(e.name, [...this.visibleNames(sc), ...this.rt.classes.keys()]));
      }
      case 'This': if (this.ctx.isStatic) this.err(e.line, "'this' kann in einer statischen Methode nicht verwendet werden"); return T(this.cls.name);
      case 'OuterThis': {
        const c = this.rt.classes.get(e.name);
        if (!c) this.err(e.line, `Klasse '${e.name}' nicht gefunden`);
        if (!this.hasOuterInstance(c)) this.err(e.line, `${e.name}.this gibt es hier nicht (kein umgebendes Objekt von ${e.name})`);
        return T(c.name);
      }
      case 'Super': return this.cls.superClass ? T(this.cls.superClass.name) : null;
      case 'Field': {
        if (e.obj.k === 'Super') { const f = this.rt.findField(this.cls.superClass, e.name); if (!f) this.err(e.line, `Die Oberklasse hat kein Attribut '${e.name}'`); this.accessCheck(f.field, f.owner, e.line, 'Attribut'); return f.field.type; }
        const t = this.expr(e.obj, sc);
        if (!t) return null;
        if (t.classRef) {
          const c = this.rt.classes.get(t.classRef);
          const f = this.rt.findField(c, e.name);
          if (!f && c.nestedMap && c.nestedMap.has(e.name)) return { classRef: c.nestedMap.get(e.name).name };
          if (!f) this.err(e.line, `${c.name} hat kein Attribut '${e.name}'` + suggest(e.name, this.rt.allFieldNames(c).concat(c.native && c.native.sfields ? Object.keys(c.native.sfields) : [])) + (c.native && c.native.statics && c.native.statics[e.name] ? ` – ${e.name} ist eine Methode, also ${e.name}(…)` : ''));
          if (!f.field.static) this.err(e.line, `'${e.name}' ist nicht statisch – Zugriff nur über ein Objekt`);
          this.accessCheck(f.field, f.owner, e.line, 'Attribut');
          return f.field.type;
        }
        if (t.dims > 0) { if (e.name === 'length') return INT; this.err(e.line, `Arrays haben kein Attribut '${e.name}' (nur length)`); }
        if (t.name === 'String' && e.name === 'length') this.err(e.line, 'Bei Strings heißt es length() mit Klammern');
        if (PRIMS.has(t.name)) this.err(e.line, `Ein ${t.name}-Wert hat keine Attribute`);
        const c = this.userClass(t);
        if (c && !c.native) {
          const f = this.rt.findField(c, e.name);
          if (!f) this.err(e.line, `Klasse ${c.name} hat kein Attribut '${e.name}'` + suggest(e.name, this.rt.allFieldNames(c)));
          this.accessCheck(f.field, f.owner, e.line, 'Attribut');
          return f.field.type;
        }
        return null;
      }
      case 'Index': {
        const t = this.norm(this.expr(e.arr, sc)); const it = this.expr(e.idx, sc);
        if (it && it.name && !it.dims && !['int', 'short', 'byte', 'char', 'Integer'].includes(it.name) && it.name !== 'null' && !it.classRef) this.err(e.line, `Der Index muss eine Ganzzahl (int) sein, nicht ${typeStr(it)}`);
        if (!t) return null;
        if (!t.dims) this.err(e.line, `[ ] geht nur bei Arrays, nicht bei ${typeStr(t)}` + (t.name === 'String' ? ' – bei Strings charAt(i) verwenden' : ['ArrayList', 'List', 'LinkedList'].includes(t.name) ? ' – bei Listen get(i) verwenden' : ''));
        return { ...t, dims: t.dims - 1 };
      }
      case 'Call': return this.call(e, sc);
      case 'New': {
        const n = e.type.name;
        const c = this.rt.classes.get(n);
        if (!c) this.err(e.line, `Klasse '${n}' nicht gefunden` + suggest(n, [...this.rt.classes.keys()]));
        this.checkType(e.type, e.line);
        const at = e.args.map(a => this.expr(a, sc));
        if (e.anon) {
          if (c.isEnum) this.err(e.line, 'Von einem enum kann keine anonyme Klasse gebildet werden');
          if (c.isInterface) { if (at.length) this.err(e.line, `${n} ist ein Interface und hat keinen Konstruktor – bei new ${n}() { … } bleiben die Klammern leer`); }
          else if (c.decl) this.ctorArgsCheck(c, at, e.line);
          this.inlineCheck(this.rt.classes.get(e.anon), sc);
          return e.type;
        }
        if (c.nestKind === 'member' && !c.staticNested && !this.hasOuterInstance(c.outer)) this.err(e.line, `Für ein Objekt der inneren Klasse ${n} braucht man ein Objekt von ${c.outer.name} – erzeuge es in einer Objektmethode von ${c.outer.name} oder mache die Klasse ${n} static`);
        if (c.isInterface) this.err(e.line, `${n} ist ein Interface – davon können keine Objekte erzeugt werden`);
        if (c.isAbstract) this.err(e.line, `${n} ist abstrakt – davon können keine Objekte erzeugt werden`);
        if (c.isEnum) this.err(e.line, 'Von einem enum können keine Objekte mit new erzeugt werden');
        if (c.decl) this.ctorArgsCheck(c, at, e.line);
        else at.forEach((a, i) => {
          if (!a || !a.lambda) return;
          const el = e.type.args && e.type.args[0];
          const h = ['TreeMap', 'TreeSet', 'PriorityQueue'].includes(c.name) ? T('Comparator', 0, [el || T('Object')]) : (c.native && c.native.lambdaCtor ? c.native.lambdaCtor[i] : null);
          this.lambdaCheck(a, h || null);
        });
        return e.type;
      }
      case 'NewArray': {
        for (const d of e.dims) { const t = this.expr(d, sc); if (t && !t.classRef && !['int', 'short', 'byte', 'char', 'Integer'].includes(t.name)) this.err(e.line, `Die Arraygröße muss eine Ganzzahl sein, nicht ${typeStr(t)}`); }
        this.checkType(e.elem, e.line);
        const t = { ...e.elem, dims: e.total };
        if (e.init) this.arrayInit(e.init, t, sc);
        return t;
      }
      case 'ArrayInit': this.err(e.line, 'Array-Initialisierer { … } ist hier nicht erlaubt');
      case 'Assign': {
        const lt = this.lval(e.target, sc);
        if (e.op === '=') this.diamond(lt, e.value);
        const vt = this.expr(e.value, sc);
        if (e.op === '=') this.assignCheck(lt, vt, e.value, e.line);
        else if (e.op === '+=' && lt && lt.name === 'String' && !lt.dims) { }
        else if (lt && vt && !vt.classRef && (!this.isNum(lt) || !this.isNum(vt))) { const l = this.unbox(lt), r = this.unbox(vt); if (!(l.name === 'boolean' && r.name === 'boolean' && ['&=', '|=', '^='].includes(e.op))) this.err(e.line, `Operator ${e.op} geht nicht mit ${typeStr(lt)} und ${typeStr(vt)}`); }
        return lt;
      }
      case 'Bin': {
        const a = this.norm(this.expr(e.l, sc)), b = this.norm(this.expr(e.r, sc));
        if (a && a.name === 'void' || b && b.name === 'void') this.err(e.line, 'Ein void-Methodenaufruf liefert keinen Wert, mit dem man rechnen kann');
        if (a && a.classRef || b && b.classRef) this.err(e.line, `${(a && a.classRef) || b.classRef} ist eine Klasse und kein Wert`);
        const op = e.op;
        if (op === '+' && ((a && a.name === 'String' && !a.dims) || (b && b.name === 'String' && !b.dims))) return STRING;
        if (op === '&&' || op === '||') {
          for (const [t, x] of [[a, e.l], [b, e.r]]) if (t && (t.dims || this.unbox(t).name !== 'boolean')) this.err(e.line, `Operator ${op} braucht boolean-Werte, nicht ${typeStr(t)}`);
          return BOOL;
        }
        if (op === '==' || op === '!=') {
          if (a && b) {
            const an = this.isNum(a), bn = this.isNum(b);
            const ab = this.unbox(a).name === 'boolean' && !a.dims, bb = this.unbox(b).name === 'boolean' && !b.dims;
            if ((an && !bn && !(b.name === 'null' && WRAP[a.name])) || (bn && !an && !(a.name === 'null' && WRAP[b.name])) || (ab !== bb)) this.err(e.line, `${typeStr(a)} und ${typeStr(b)} können nicht mit ${op} verglichen werden`);
            if (PRIMS.has(a.name) && !a.dims && b.name === 'null' || PRIMS.has(b.name) && !b.dims && a.name === 'null') this.err(e.line, `Ein ${PRIMS.has(a.name) ? a.name : b.name}-Wert kann nicht null sein`);
          }
          return BOOL;
        }
        if (['<', '>', '<=', '>='].includes(op)) {
          for (const t of [a, b]) if (t && !this.isNum(t)) this.err(e.line, `Operator ${op} geht nicht mit ${typeStr(t)}` + (t.name === 'String' ? ' – Strings mit compareTo vergleichen' : ''));
          return BOOL;
        }
        if (['&', '|', '^'].includes(op) && a && b && this.unbox(a).name === 'boolean' && this.unbox(b).name === 'boolean') return BOOL;
        for (const t of [a, b]) if (t && !this.isNum(t)) this.err(e.line, `Operator ${op} kann nicht auf ${typeStr(a || T('?'))} und ${typeStr(b || T('?'))} angewendet werden` + (op === '-' && t.name === 'String' ? '' : ''));
        if (['<<', '>>', '>>>'].includes(op)) return a ? (this.unbox(a).name === 'long' ? LONG : INT) : null;
        return this.promote(a, b);
      }
      case 'Unary': {
        const t = this.norm(this.expr(e.e, sc));
        if (!t) return null;
        if (e.op === '!') { if (this.unbox(t).name !== 'boolean' || t.dims) this.err(e.line, `! braucht einen boolean-Wert, nicht ${typeStr(t)}`); return BOOL; }
        if (!this.isNum(t)) this.err(e.line, `Operator ${e.op} geht nicht mit ${typeStr(t)}`);
        const u = this.unbox(t); return ['char', 'short', 'byte'].includes(u.name) ? INT : u;
      }
      case 'PreInc': case 'PostInc': { const t = this.lval(e.e, sc); if (t && !this.isNum(t)) this.err(e.line, `${e.op} geht nur mit Zahlen, nicht mit ${typeStr(t)}`); return t; }
      case 'Cond': {
        this.condCheck(e.c, sc); const a = this.norm(this.expr(e.a, sc)), b = this.norm(this.expr(e.b, sc));
        if (a && b) { if (this.isNum(a) && this.isNum(b)) return this.promote(a, b); if (a.name === 'null') return b; return a; }
        return null;
      }
      case 'Cast': {
        const t = this.norm(this.expr(e.e, sc)); this.checkType(e.type, e.line);
        if (t && !t.classRef && t.name !== 'null') {
          const tp = PRIMS.has(e.type.name) && !e.type.dims, fp = PRIMS.has(t.name) && !t.dims;
          if (tp && (t.name === 'String' || (fp && (t.name === 'boolean') !== (e.type.name === 'boolean')))) this.err(e.line, `${typeStr(t)} kann nicht in ${typeStr(e.type)} umgewandelt werden` + (t.name === 'String' && e.type.name === 'int' ? ' (Tipp: Integer.parseInt(text))' : ''));
          if (!tp && fp && e.type.name === 'String') this.err(e.line, `${t.name} kann nicht mit (String) umgewandelt werden – verwende String.valueOf(wert)`);
        }
        return e.type;
      }
      case 'InstanceOf': { this.expr(e.e, sc); this.checkType(e.type, e.line); if (e.bind) sc.declare(e.bind, e.type, e.line, this); return BOOL; }
      case 'Lambda': case 'MethodRef': {
        // Der Typ ergibt sich erst aus dem Ziel (Variable, Parameter …), siehe lambdaCheck
        if (e.k === 'MethodRef') this.refTarget(e, sc);
        const lt = { name: '$lambda', dims: 0, lambda: e, sc };
        (this.pending || (this.pending = [])).push({ lt, depth: this.depth || 0 });
        return lt;
      }
      case 'CtorCall': this.err(e.line, `${e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`);
      case 'SwitchExpr': return this.switchExpr(e, sc);
    }
    return null;
  }
  switchExpr(s, sc) {
    const t = this.expr(s.e, sc);
    const ec = t && !t.dims && this.rt.classes.get(t.name);
    const isEnum = ec && ec.isEnum;
    if (t && !t.dims && !isEnum && !['int', 'char', 'String', 'short', 'byte', 'Integer', 'Character'].includes(t.name)) this.err(s.line, `switch geht nicht mit ${typeStr(t)} (erlaubt: int, char, String, enum)`);
    const covered = new Set();
    const results = [];
    if (!this.ctx.yields) this.ctx.yields = [];
    this.ctx.yields.push(results);
    const saved = { loops: this.ctx.loops, switches: this.ctx.switches };
    this.ctx.loops = 0; this.ctx.switches = 0;   // break/continue führen nicht aus dem switch-Ausdruck heraus
    try {
      for (const c of s.cases) {
        if (c.labels) for (const l of c.labels) {
          if (isEnum && l.k === 'Name') { if (!ec.fieldMap.has(l.name)) this.err(c.line, `${ec.name} hat keine Konstante ${l.name}`); covered.add(l.name); }
          else this.expr(l, new Scope(sc));
        }
        const s2 = new Scope(sc);
        if (s.arrow) {
          const st = c.stmts[0];
          if (st.k === 'Expr') results.push({ t: this.expr(st.e, s2), e: st.e, line: st.line });
          else { this.stmt(st, s2); if (st.k === 'Block' && this.canComplete(st)) this.err(st.endLine || st.line, 'Dieser Fall liefert keinen Wert – am Ende des Blocks fehlt yield'); }
        } else for (const st of c.stmts) this.stmt(st, s2);
      }
    } finally { this.ctx.yields.pop(); Object.assign(this.ctx, saved); }
    const hasDefault = s.cases.some(c => !c.labels);
    if (!hasDefault && !(isEnum && ec.enumConsts !== undefined && [...ec.fieldMap.values()].filter(f => f.enumConst).every(f => covered.has(f.name)))) this.err(s.line, isEnum ? `Der switch-Ausdruck deckt nicht alle Werte von ${ec.name} ab – ergänze die fehlenden Fälle oder default` : 'Der switch-Ausdruck braucht einen default-Fall');
    for (const r of results) if (r.t && r.t.name === 'void') this.err(r.line, 'Ein void-Methodenaufruf liefert keinen Wert für den switch-Ausdruck');
    const ts = results.map(r => this.norm(r.t)).filter(Boolean);
    if (!ts.length) return null;
    if (ts.every(x => this.isNum(x))) return ts.reduce((a, b) => this.promote(a, b));
    return ts.find(x => x.name !== 'null') || ts[0];
  }
  // Ziel einer Methodenreferenz prüfen; merkt die Zahl der Parameter, wenn sie feststeht
  refTarget(e, sc) {
    let cref = null, recv = null;
    if (e.target.k === 'Name' && sc.get(e.target.name) === undefined && !this.rt.findField(this.cls, e.target.name) && this.rt.classes.has(e.target.name)) cref = this.rt.classes.get(e.target.name);
    else { recv = this.norm(this.expr(e.target, sc)); if (recv && recv.classRef) { cref = this.rt.classes.get(recv.classRef); recv = null; } }
    e.$arity = null;
    if (cref) {
      if (e.name === 'new') { if (cref.isAbstract) this.err(e.line, `${cref.name} ist abstrakt – ${cref.name}::new geht nicht`); if (cref.decl) { const ar = new Set(cref.ctors.length ? cref.ctors.map(k => k.params.length) : [0]); if (ar.size === 1) e.$arity = [...ar][0]; } return; }
      if (cref.native) { if (!(cref.native.statics && cref.native.statics[e.name]) && !(cref.name === 'String' && e.name in STRING_RET) && !['Integer', 'Double', 'Character', 'Boolean', 'Long', 'Object'].includes(cref.name)) this.err(e.line, `Methode '${e.name}' gibt es in ${cref.name} nicht`); return; }
      const ms = this.rt.lookupMethods(cref, e.name);
      if (!ms.length && !['toString', 'equals', 'hashCode', 'compareTo', 'name', 'ordinal'].includes(e.name)) this.err(e.line, `Methode '${e.name}' gibt es in ${cref.name} nicht` + suggest(e.name, this.rt.allMethodNames(cref)));
      const ar = new Set(ms.map(m => m.static ? m.params.length : m.params.length + 1));
      if (ar.size === 1) e.$arity = [...ar][0];
      return;
    }
    if (recv && recv.name === 'String' && !recv.dims) { if (!(e.name in STRING_RET)) this.err(e.line, `Methode '${e.name}' gibt es für String nicht`); return; }
    const c = this.userClass(recv);
    if (c && c.decl) {
      const ms = this.rt.lookupMethods(c, e.name);
      if (!ms.length && !['toString', 'equals', 'hashCode'].includes(e.name)) this.err(e.line, `Methode '${e.name}' gibt es in Klasse ${c.name} nicht` + suggest(e.name, this.rt.allMethodNames(c)));
      const ar = new Set(ms.map(m => m.params.length)); if (ar.size === 1) e.$arity = [...ar][0];
    }
  }
  // Lambda/Methodenreferenz gegen den Zieltyp prüfen (to = null: unbekannt)
  // new X<>(…): Typargumente vom Ziel übernehmen
  diamond(to, e) {
    if (e && e.k === 'New' && e.type.args && !e.type.args.length && to && to.args && to.args.length && !e.anon) {
      const c = this.rt.classes.get(e.type.name);
      if (c && (!c.typeParams.length || c.typeParams.length === to.args.length)) e.type.args = to.args;
      else if (c && c.native && to.args.length <= 2) e.type.args = to.args;
    }
  }
  lambdaCheck(lt, to) {
    const e = lt.lambda, sc = lt.sc;
    if (e.$chk) return; e.$chk = true;
    let fm = null, tc = null; const subst = Object.create(null);
    if (to && this.norm(to) && to.name !== 'null') {
      tc = !to.dims ? this.rt.classes.get(to.name) : null;
      const what = e.k === 'Lambda' ? 'Ein Lambda-Ausdruck' : 'Eine Methodenreferenz';
      if (!tc || !tc.isInterface) this.err(e.line, `${what} passt nur zu einem funktionalen Interface (z. B. Runnable, Comparator, Consumer), nicht zu ${typeStr(to)}`);
      fm = this.rt.functionalMethod(tc);
      if (!fm) this.err(e.line, `${tc.name} ist kein funktionales Interface (es braucht genau eine abstrakte Methode) – ${what.toLowerCase()} passt nicht`);
      e.$iface = tc.name;
      (tc.typeParams || []).forEach((n, i) => { if (to.args && to.args[i]) subst[n] = to.args[i]; });
    }
    const tps = new Set([...(tc && tc.typeParams || []), ...(fm && fm.typeParams || []), ...(fm && fm.cls && fm.cls.typeParams || [])]);
    const sub = (t) => { if (!t) return null; if (subst[t.name] && !t.dims) return subst[t.name]; if (tps.has(t.name)) return null; return t; };
    if (e.k === 'MethodRef') {
      if (fm && e.$arity != null && e.$arity !== fm.params.length) this.err(e.line, `Die Methodenreferenz passt nicht zu ${tc.name}.${fm.name}(…) mit ${fm.params.length} Parameter(n)`);
      return;
    }
    if (fm && fm.params.length !== e.params.length) this.err(e.line, `Der Lambda-Ausdruck hat ${e.params.length} Parameter, ${tc.name}.${fm.name}(…) erwartet aber ${fm.params.length}`);
    const s2 = new Scope(sc, true);
    e.params.forEach((p, i) => {
      let t = p.type;
      if (t) this.checkType(t, e.line); else t = fm ? sub(fm.params[i].type) : null;
      if (sc.get(p.name) !== undefined) this.err(e.line, `Variable '${p.name}' ist hier bereits definiert – Lambda-Parameter brauchen einen neuen Namen`);
      s2.declare(p.name, t, e.line, this);
    });
    const ret = fm ? (fm.ret.name === 'void' ? VOID : sub(fm.ret)) : null;
    const saved = this.ctx, depth = this.depth;
    this.ctx = { ...saved, method: { name: 'Lambda', ret, lambda: true, iface: tc && fm ? tc.name + '.' + fm.name : null }, isCtor: false, loops: 0, switches: 0, tries: [], throwsDecl: fm ? (fm.throws || []).map(n => this.rt.classes.get(n)).filter(Boolean) : null };
    if (!fm) this.ctx.throwsDecl = [this.rt.classes.get('Throwable')];
    try {
      if (e.expr) {
        const t = this.expr(e.body, s2);
        if (ret && ret.name === 'void') { if (!EXPR_STMT.has(e.body.k)) this.err(e.line, `Hier wird kein Ergebnis erwartet (${tc.name}.${fm.name} ist void) – rechts vom Pfeil muss eine Anweisung stehen, z. B. ein Methodenaufruf`); }
        else if (ret) { if (t && t.name === 'void') this.err(e.line, `Der Lambda-Ausdruck muss einen Wert vom Typ ${typeStr(ret)} liefern (${tc.name}.${fm.name})`); this.assignCheck(ret, t, e.body, e.line); }
      } else {
        this.block(e.body.stmts, new Scope(s2));
        if (ret && ret.name !== 'void' && this.canComplete(e.body)) this.err(e.body.endLine, `return fehlt: Der Lambda-Ausdruck muss einen Wert vom Typ ${typeStr(ret)} zurückgeben`);
      }
      this.flushLambdas((depth || 0) + 1);
    } finally { this.ctx = saved; this.depth = depth; }
  }
  // Noch nicht geprüfte Lambdas (Ziel unbekannt) am Ende der Anweisung prüfen
  flushLambdas(depth) {
    if (!this.pending) return;
    const rest = [];
    for (const p of this.pending.splice(0)) { if (p.lt.lambda.$chk) continue; if (p.depth >= depth) this.lambdaCheck(p.lt, null); else rest.push(p); }
    this.pending.push(...rest);
  }
  // Zieltyp für Lambdas als Argument eingebauter Methoden
  lambdaHint(e, i, at) {
    const rtT = e.$recvT;
    const name = e.name;
    const fn = (n, ...args) => T(n, 0, args.map(a => a || T('Object')));
    if (rtT && rtT.classRef) {
      const cn = rtT.classRef, a0 = at[0];
      const el0 = a0 && a0.args && a0.args[0];
      if (cn === 'Collections' && ['sort', 'max', 'min'].includes(name) && i === 1) return fn('Comparator', el0);
      if (cn === 'Arrays' && name === 'sort' && i === 1) return fn('Comparator', a0 && a0.dims ? { ...a0, dims: a0.dims - 1 } : null);
      const c = this.rt.classes.get(cn);
      const la = c && c.native && c.native.lambdaStatics && c.native.lambdaStatics[name];
      return la ? la[i] || null : null;
    }
    if (!rtT || rtT.dims) return null;
    const c = this.rt.classes.get(rtT.name);
    if (!c) return null;
    const el = rtT.args && rtT.args[0], v = rtT.args && rtT.args[1];
    if (['Map', 'HashMap', 'TreeMap', 'LinkedHashMap'].includes(c.name)) {
      if (name === 'forEach') return fn('BiConsumer', el, v);
      if (name === 'computeIfAbsent' && i === 1) return fn('Function', el, v);
      if (name === 'merge' && i === 2) return fn('BinaryOperator', v);
      return null;
    }
    if (c.native && c.native.list || ['List', 'Collection', 'Set', 'Iterable', 'ArrayList', 'LinkedList', 'HashSet', 'TreeSet'].includes(c.name)) {
      if (name === 'forEach') return fn('Consumer', el);
      if (name === 'removeIf') return fn('Predicate', el);
      if (name === 'sort') return fn('Comparator', el);
      if (name === 'replaceAll') return fn('UnaryOperator', el);
    }
    for (let k = c; k; k = k.superClass) { const la = k.native && k.native.lambdaArgs && k.native.lambdaArgs[name]; if (la) return la[i] || null; }
    // addXyzListener(…) erwartet einen XyzListener
    const lm = /^(?:add|remove)(\w+Listener)$/.exec(name);
    if (lm && i === 0 && this.rt.classes.has(lm[1]) && this.rt.classes.get(lm[1]).isInterface) return T(lm[1]);
    return null;
  }
  lval(t, sc) {
    const ty = this.expr(t, sc);
    if (ty && ty.classRef) this.err(t.line, 'Einer Klasse kann nichts zugewiesen werden');
    let f = null;
    if (t.k === 'Name') {
      const r = sc.find(t.name);
      if (r) this.assignedVar(t.name, r, t.line);
      else {
        f = this.rt.findField(this.cls, t.name);
        if (!f) { const o = this.outerLookup(t.name, t.line); if (o && o.local) this.err(t.line, `Die lokale Variable '${t.name}' der umgebenden Methode kann hier nicht verändert werden (sie muss final oder effektiv final sein)`); if (o && o.f) f = o.f; }
      }
    }
    if (t.k === 'Field' && (t.obj.k === 'This' || t.obj.k === 'Super')) f = this.rt.findField(t.obj.k === 'This' ? this.cls : this.cls.superClass, t.name);
    if (t.k === 'Field' && t.obj.k === 'Name' && sc.get(t.obj.name) === undefined && !this.rt.findField(this.cls, t.obj.name) && this.rt.classes.has(t.obj.name)) f = this.rt.findField(this.rt.classes.get(t.obj.name), t.name);
    if (f && (f.field.final || f.field.native)) {
      const ok = f.owner === this.cls && ((this.ctx.isCtor && !f.field.static) || (!this.ctx.method && f.field.static && this.ctx.isStatic));
      if (!ok) this.err(t.line, `'${t.name}' ist final (konstant) und kann nicht verändert werden`);
    }
    if (t.k === 'Field' && ty === INT && t.name === 'length') { const at = this.expr(t.obj, sc); if (at && at.dims) this.err(t.line, 'Die Länge eines Arrays kann nicht verändert werden'); }
    return ty;
  }
  ctorArgsCheck(c, at, line) {
    const ks = c.ctors;
    if (!ks.length) { if (at.length) this.err(line, `${c.name} hat nur den Standardkonstruktor ${c.name}() ohne Parameter, übergeben wurden ${at.length}`); return; }
    this.pick(ks, at, line, `Konstruktor ${c.name}`, c, true);
  }
  pick(ms, at, line, label, owner, isCtor) {
    const cands = ms.filter(m => m.params.length === at.length);
    const sigs = () => ms.map(m => `${m.name}(${m.params.map(p => typeStr(p.type)).join(', ')})`).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    if (!cands.length) this.err(line, `${label} erwartet ${[...new Set(ms.map(m => m.params.length))].join(' oder ')} Parameter, übergeben wurden ${at.length}. Vorhanden: ${sigs()}`);
    const lamOk = (p, a) => {
      if (!a || !a.lambda) return true;
      const pc = !p.type.dims && this.rt.classes.get(p.type.name);
      if (!pc) return true;
      const fm = this.rt.functionalMethod(pc);
      if (!fm) return false;
      const n = a.lambda.k === 'Lambda' ? a.lambda.params.length : a.lambda.$arity;
      return n == null || n === fm.params.length;
    };
    const ok = cands.filter(m => m.params.every((p, i) => lamOk(p, at[i]) && this.assignable(this.norm(p.type) && !(m.typeParams || []).includes(p.type.name) && !(m.cls && (m.cls.typeParams || []).includes(p.type.name)) ? p.type : null, this.norm(at[i]), null)));
    if (!ok.length && at.some(a => a && a.lambda)) this.err(line, `${label}(${cands[0].params.map(p => typeStr(p.type)).join(', ')}): Der Lambda-Ausdruck bzw. die Methodenreferenz passt zu keinem Parameter`);
    if (!ok.length) this.err(line, `${label}(${cands[0].params.map(p => typeStr(p.type)).join(', ')}) passt nicht zu den Argumenten (${at.map(t => t ? (t.classRef ? t.classRef : typeStr(t)) : '?').join(', ')})`);
    const m = ok[0];
    at.forEach((a, i) => { if (a && a.lambda) this.lambdaCheck(a, m.params[i].type); });
    this.thrownBy(m, line);
    const top = this.rt.topOf(this.cls);
    if (!isCtor && m.vis === 'private' && m.cls !== this.cls && this.rt.topOf(m.cls) !== top) this.err(line, `Methode ${m.name}() ist private in ${m.cls.name}`);
    if (isCtor && m.vis === 'private' && owner !== this.cls && this.rt.topOf(owner) !== top) this.err(line, `Konstruktor ${owner.name}(…) ist private`);
    return m;
  }
  retType(m, recvType) {
    const r = m.ret;
    if (!r) return null;
    const tps = [...(m.typeParams || []), ...((m.cls && m.cls.typeParams) || [])];
    if (tps.includes(r.name)) {
      if (recvType && recvType.args && m.cls && m.cls.typeParams) { const i = m.cls.typeParams.indexOf(r.name); if (i >= 0 && recvType.args[i]) return { ...recvType.args[i], dims: recvType.args[i].dims + r.dims }; }
      return null;
    }
    return r;
  }
  call(e, sc) {
    const at = e.args.map(a => this.expr(a, sc));
    const r = this.call0(e, sc, at);
    at.forEach((a, i) => { if (a && a.lambda && !a.lambda.$chk) this.lambdaCheck(a, this.lambdaHint(e, i, at)); });
    return r;
  }
  call0(e, sc, at) {
    for (let i = 0; i < at.length; i++) { if (at[i] && at[i].name === 'void') this.err(e.line, 'Ein void-Methodenaufruf liefert keinen Wert und kann nicht als Argument verwendet werden'); if (at[i] && at[i].classRef) this.err(e.line, `${at[i].classRef} ist eine Klasse und kein Wert`); }
    const label = (c) => `Methode ${e.name}`;
    if (e.obj === null) {
      const ms = this.rt.lookupMethods(this.cls, e.name);
      if ((!ms.length || !ms.some(m => m.params.length === at.length)) && this.rt.nativeMethod(this.cls, e.name)) { if (this.ctx.isStatic) this.err(e.line, `Die Methode ${e.name}() ist nicht statisch und kann nicht aus einer statischen Methode aufgerufen werden – erzeuge zuerst ein Objekt`); return nativeRet(this.rt, this.cls, e.name); }
      if (!ms.length) { for (let c = this.cls; c; c = c.superClass) if (c.native && c.native.statics && c.native.statics[e.name]) return null; }
      if (!ms.length) {
        if (['toString', 'equals', 'hashCode', 'getClass'].includes(e.name) && !this.ctx.isStatic) return e.name === 'toString' ? STRING : e.name === 'equals' ? BOOL : e.name === 'hashCode' ? INT : null;
        if (this.cls.isEnum && ['values', 'ordinal', 'name'].includes(e.name)) return e.name === 'values' ? T(this.cls.name, 1) : e.name === 'ordinal' ? INT : STRING;
        const om = this.outerMethod(e.name, at, e.line);
        if (om !== undefined) return om;
        const known = { println: 'System.out.println(…)', print: 'System.out.print(…)', sqrt: 'Math.sqrt(…)', random: 'Math.random()' };
        this.err(e.line, `Methode '${e.name}' nicht gefunden` + (known[e.name] ? ` (meinten Sie '${known[e.name]}'?)` : suggest(e.name, this.rt.allMethodNames(this.cls))));
      }
      const m = this.pick(ms, at, e.line, label(), this.cls);
      if (!m.static && this.ctx.isStatic) this.err(e.line, `Die Methode ${e.name}() ist nicht statisch und kann nicht aus einer statischen Methode aufgerufen werden – erzeuge zuerst ein Objekt`);
      return this.retType(m, null);
    }
    if (e.obj.k === 'Super') {
      if (this.ctx.isStatic) this.err(e.line, "'super' gibt es nicht in einer statischen Methode");
      const ms = this.rt.lookupMethods(this.cls.superClass, e.name).filter(m => !m.abstract);
      if (!ms.length && this.rt.nativeMethod(this.cls.superClass, e.name)) return nativeRet(this.rt, this.cls.superClass, e.name);
      if (!ms.length) { if (['toString', 'equals', 'hashCode'].includes(e.name)) return e.name === 'toString' ? STRING : e.name === 'equals' ? BOOL : INT; this.err(e.line, `Die Oberklasse hat keine (nicht-abstrakte) Methode '${e.name}'`); }
      return this.retType(this.pick(ms, at, e.line, label(), this.cls), null);
    }
    const t = this.norm(this.expr(e.obj, sc));
    e.$recvT = t;
    if (!t) return null;
    if (t.classRef) {
      const c = this.rt.classes.get(t.classRef);
      if (c.native) {
        if (!c.native.statics || !c.native.statics[e.name]) {
          if (c.name === 'System' && e.name === 'println') this.err(e.line, "Es heißt System.out.println(…)");
          this.err(e.line, `Methode '${e.name}' gibt es in ${c.name} nicht (oder sie wird nicht unterstützt)` + suggest(e.name, Object.keys(c.native.statics || {})));
        }
        for (const n of NATIVE_THROWS[c.name + '.' + e.name] || []) this.thrown(this.rt.classes.get(n), e.line);
        if (c.native.staticRet && c.native.staticRet[e.name] !== undefined) return c.native.staticRet[e.name];
        return NATIVE_RET[c.name + '.' + e.name] || (c.name === 'Math' && ['abs', 'max', 'min'].includes(e.name) ? (at.length === 1 ? this.unbox(at[0]) : this.promote(at[0], at[1])) : null);
      }
      if (c.isEnum && e.name === 'values') return T(c.name, 1);
      if (c.isEnum && e.name === 'valueOf') return T(c.name);
      const ms = this.rt.lookupMethods(c, e.name);
      if (!ms.length) this.err(e.line, `Klasse ${c.name} hat keine Methode '${e.name}'` + suggest(e.name, this.rt.allMethodNames(c)));
      const m = this.pick(ms, at, e.line, label(), c);
      if (!m.static) this.err(e.line, `Die Methode ${e.name}() ist nicht statisch – rufe sie an einem Objekt auf, nicht an der Klasse ${c.name}`);
      return this.retType(m, null);
    }
    if (t.name === 'null') this.err(e.line, 'Methodenaufruf auf null');
    if (t.dims > 0) {
      if (e.name === 'length') this.err(e.line, 'Bei Arrays heißt es length ohne Klammern');
      if (['clone'].includes(e.name)) return t;
      if (['equals', 'hashCode', 'toString'].includes(e.name)) return e.name === 'equals' ? BOOL : e.name === 'hashCode' ? INT : STRING;
      this.err(e.line, `Arrays haben keine Methode '${e.name}'`);
    }
    if (PRIMS.has(t.name)) this.err(e.line, `Auf einem ${t.name}-Wert kann keine Methode aufgerufen werden`);
    if (t.name === 'String') {
      if (!(e.name in STRING_RET)) this.err(e.line, `Methode '${e.name}' gibt es für String nicht` + suggest(e.name, Object.keys(STRING_RET)) + (e.name === 'size' ? " – bei Strings heißt es length()" : ''));
      return STRING_RET[e.name];
    }
    const c = this.userClass(t);
    if (c && c.decl) {
      const ms = this.rt.lookupMethods(c, e.name);
      if ((!ms.length || !ms.some(m => m.params.length === at.length)) && this.rt.nativeMethod(c, e.name)) return nativeRet(this.rt, c, e.name);
      if (!ms.length) {
        if (['toString', 'equals', 'hashCode', 'getClass'].includes(e.name)) return e.name === 'toString' ? STRING : e.name === 'equals' ? BOOL : e.name === 'hashCode' ? INT : null;
        if (c.isEnum && ['name', 'ordinal', 'compareTo'].includes(e.name)) return e.name === 'name' ? STRING : INT;
        this.err(e.line, `Methode '${e.name}' gibt es in Klasse ${c.name} nicht` + suggest(e.name, this.rt.allMethodNames(c)));
      }
      return this.retType(this.pick(ms, at, e.line, label(), c), t);
    }
    if (c && c.native && !c.isInterface) {
      let found = false;
      for (let k = c; k; k = k.superClass) if (k.native && k.native.methods && k.native.methods[e.name]) found = true;
      if (!found && c.native.lib && c.native.unsupported && c.native.unsupported.test(e.name)) this.err(e.line, `${c.name}.${e.name}() wird in der Web-Version nicht unterstützt (Maus-/Tastatur-Ereignisse, Sound und Drucken fehlen)`);
      if (found && c.native.retTypes) return c.native.retTypes[e.name] || null;
      if (!found && !['toString', 'equals', 'hashCode', 'getClass'].includes(e.name)) this.err(e.line, `Methode '${e.name}' gibt es für ${c.name} nicht (oder sie wird nicht unterstützt)` + suggest(e.name, Object.keys(c.native.methods || {})) + (e.name === 'length' && c.native.list ? ' – bei Listen heißt es size()' : ''));
      return listRet(c, e.name, t);
    }
    if (c && c.isInterface && c.native) return listRet(c, e.name, t);
    return null;
  }
}
function nativeRet(rt, cls, name) { for (let c = cls; c; c = c.superClass) if (c.native && c.native.retTypes && c.native.retTypes[name] !== undefined) return c.native.retTypes[name]; return null; }
function listRet(c, name, t) {
  const el = t.args && t.args[0] ? t.args[0] : null;
  const isMap = ['HashMap', 'Map', 'TreeMap', 'LinkedHashMap'].includes(c.name);
  if (['size', 'indexOf', 'lastIndexOf', 'length', 'search'].includes(name)) return INT;
  if (['offer', 'offerFirst', 'offerLast', 'empty', 'hasNext', 'removeAll', 'retainAll', 'containsAll', 'addAll', 'removeIf'].includes(name)) return BOOL;
  if (name === 'iterator' && !isMap) return T('Iterator', 0, el ? [el] : null);
  if (['next', 'peek', 'poll', 'pop', 'push', 'element', 'first', 'last', 'pollFirst', 'pollLast', 'peekFirst', 'peekLast', 'floor', 'ceiling', 'higher', 'lower'].includes(name) && !isMap) return el;
  if (['firstKey', 'lastKey', 'floorKey', 'ceilingKey', 'higherKey', 'lowerKey', 'getKey'].includes(name)) return el;
  if (['getValue', 'setValue'].includes(name)) return t.args && t.args[1] || null;
  if (name === 'entrySet' && t.args) return T('Set', 0, [T('Entry', 0, t.args)]);
  if (['put', 'remove', 'getOrDefault', 'putIfAbsent', 'merge', 'computeIfAbsent'].includes(name) && isMap) return t.args && t.args[1] || null;
  if (['isEmpty', 'contains', 'containsKey', 'containsValue', 'add'].includes(name) && !(name === 'add' && false)) return name === 'add' ? null : BOOL;
  if (['get', 'getFirst', 'getLast', 'removeFirst', 'removeLast', 'set'].includes(name)) { if (isMap) return t.args && t.args[1] || null; return el; }
  if (name === 'nextInt') return INT; if (name === 'nextDouble' || name === 'nextGaussian') return DOUBLE; if (name === 'nextBoolean') return BOOL;
  if (name === 'toString') return STRING;
  if (name === 'keySet' && t.args) return T('Set', 0, [t.args[0]]);
  if (name === 'values' && t.args) return T('Collection', 0, [t.args[1]]);
  return null;
}
const NATIVE_THROWS = { 'Thread.sleep': ['InterruptedException'] };
const NATIVE_RET = {
  'Math.sqrt': DOUBLE, 'Math.pow': DOUBLE, 'Math.random': DOUBLE, 'Math.floor': DOUBLE, 'Math.ceil': DOUBLE, 'Math.sin': DOUBLE, 'Math.cos': DOUBLE, 'Math.tan': DOUBLE, 'Math.round': LONG, 'Math.cbrt': DOUBLE, 'Math.exp': DOUBLE, 'Math.log': DOUBLE, 'Math.log10': DOUBLE, 'Math.hypot': DOUBLE, 'Math.atan': DOUBLE, 'Math.atan2': DOUBLE, 'Math.toRadians': DOUBLE, 'Math.toDegrees': DOUBLE, 'Math.signum': DOUBLE, 'Math.rint': DOUBLE, 'Math.floorDiv': INT, 'Math.floorMod': INT,
  'Integer.parseInt': INT, 'Integer.valueOf': T('Integer'), 'Integer.toString': STRING, 'Integer.compare': INT, 'Integer.toBinaryString': STRING, 'Integer.toHexString': STRING,
  'Double.parseDouble': DOUBLE, 'Double.valueOf': T('Double'), 'Double.toString': STRING, 'Double.isNaN': BOOL, 'Double.compare': INT,
  'Long.parseLong': LONG, 'Boolean.parseBoolean': BOOL,
  'String.valueOf': STRING, 'String.format': STRING, 'String.join': STRING,
  'Character.isDigit': BOOL, 'Character.isLetter': BOOL, 'Character.isLetterOrDigit': BOOL, 'Character.isUpperCase': BOOL, 'Character.isLowerCase': BOOL, 'Character.isWhitespace': BOOL, 'Character.getNumericValue': INT, 'Character.toString': STRING,
  'Arrays.toString': STRING, 'Arrays.binarySearch': INT, 'Collections.binarySearch': INT, 'Collections.frequency': INT, 'Collections.addAll': BOOL, 'Arrays.deepToString': STRING, 'Arrays.equals': BOOL, 'System.currentTimeMillis': LONG, 'System.nanoTime': LONG,
  'Math.abs': null,
};
class StopCheck { }
class Scope {
  // boundary: Grenze eines Lambda-Rumpfs (Variablen von außen sind dort „eingefangen“)
  constructor(parent, boundary) { this.parent = parent; this.vars = new Map(); this.info = new Map(); this.boundary = !!boundary; }
  get(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s.vars.get(n); return undefined; }
  find(n) { let crossed = false; for (let s = this; s; s = s.parent) { if (s.vars.has(n)) return { t: s.vars.get(n), scope: s, crossed }; if (s.boundary) crossed = true; } return null; }
  declare(n, t, line, ch, init = true) { if (this.get(n) !== undefined) ch.err(line, `Variable '${n}' ist hier bereits definiert`); this.vars.set(n, t === undefined ? null : t); this.info.set(n, { init, assigns: 0, captured: 0 }); }
  allNames() { const s = []; for (let x = this; x; x = x.parent) s.push(...x.vars.keys()); return s; }
}

// ---------------------------------------------------------------- Schnell-Info für das Diagramm
function quickInfo(code) {
  let ids = null;
  try { ids = new Set(lex(code).toks.filter(t => t.t === 'id').map(t => t.v)); } catch (e) { ids = new Set((code.match(/\b[A-Z]\w*/g) || [])); }
  try {
    const ds = new Parser(code).parseUnit();
    if (ds.length) { const d = ds[0]; return { ok: true, name: d.name, kind: d.kind, abstract: d.mods.has('abstract'), superName: d.superName, interfaces: d.interfaces, ids }; }
  } catch (e) { }
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /\b(abstract\s+)?(class|interface|enum)\s+([A-Za-z_]\w*)(?:\s*<[^>{]*>)?(?:\s+extends\s+([A-Za-z_]\w*))?(?:\s+implements\s+([\w\s,<>]+?))?\s*\{/.exec(clean);
  if (!m) return { ok: false, name: null, ids };
  return { ok: false, name: m[3], kind: m[2], abstract: !!m[1], superName: m[2] === 'class' ? m[4] || null : null, interfaces: (m[5] || (m[2] === 'interface' ? m[4] || '' : '')).split(',').map(s => s.trim().replace(/<.*$/, '')).filter(Boolean), ids };
}

Runtime.extensions = [];
Runtime.preludes = [];   // { pkg, code }: eingebaute Klassen als Java-Quelltext
// Funktionale Interfaces (für Lambdas und Methodenreferenzen)
Runtime.preludes.push({ pkg: 'java.util.function', code: `
public interface Function<T, R> {
  R apply(T t);
  default <V> Function<T, V> andThen(Function<R, V> after) { return x -> after.apply(apply(x)); }
  default <V> Function<V, R> compose(Function<V, T> before) { return x -> apply(before.apply(x)); }
  static <T> Function<T, T> identity() { return x -> x; }
}
public interface BiFunction<T, U, R> { R apply(T t, U u); }
public interface UnaryOperator<T> { T apply(T t); }
public interface BinaryOperator<T> { T apply(T a, T b); }
public interface Consumer<T> {
  void accept(T t);
  default Consumer<T> andThen(Consumer<T> after) { return x -> { accept(x); after.accept(x); }; }
}
public interface BiConsumer<T, U> { void accept(T t, U u); }
public interface Supplier<T> { T get(); }
public interface Predicate<T> {
  boolean test(T t);
  default Predicate<T> negate() { return x -> !test(x); }
  default Predicate<T> and(Predicate<T> other) { return x -> test(x) && other.test(x); }
  default Predicate<T> or(Predicate<T> other) { return x -> test(x) || other.test(x); }
}
public interface BiPredicate<T, U> { boolean test(T t, U u); }
public interface ToIntFunction<T> { int applyAsInt(T t); }
public interface ToDoubleFunction<T> { double applyAsDouble(T t); }
public interface IntFunction<R> { R apply(int value); }
public interface IntPredicate { boolean test(int value); }
public interface IntUnaryOperator { int applyAsInt(int operand); }
public interface IntBinaryOperator { int applyAsInt(int left, int right); }
public interface IntConsumer { void accept(int value); }
public interface DoubleUnaryOperator { double applyAsDouble(double operand); }
public interface DoubleBinaryOperator { double applyAsDouble(double left, double right); }
` });
Runtime.preludes.push({ pkg: 'java.util', code: `
public interface Iterator<E> {
  boolean hasNext();
  E next();
  default void remove() { throw new UnsupportedOperationException("remove"); }
}
public interface Comparator<T> {
  int compare(T a, T b);
  default Comparator<T> reversed() { return (a, b) -> compare(b, a); }
  default Comparator<T> thenComparing(Comparator<T> other) { return (a, b) -> { int r = compare(a, b); return r != 0 ? r : other.compare(a, b); }; }
  default Comparator<T> thenComparing(Function<T, Comparable> key) { return thenComparing(Comparator.comparing(key)); }
  default Comparator<T> thenComparingInt(ToIntFunction<T> key) { return thenComparing(Comparator.comparingInt(key)); }
  default Comparator<T> thenComparingDouble(ToDoubleFunction<T> key) { return thenComparing(Comparator.comparingDouble(key)); }
  static <T> Comparator<T> comparing(Function<T, Comparable> key) { return (a, b) -> ((Comparable) key.apply(a)).compareTo(key.apply(b)); }
  static <T> Comparator<T> comparing(Function<T, Object> key, Comparator<Object> cmp) { return (a, b) -> cmp.compare(key.apply(a), key.apply(b)); }
  static <T> Comparator<T> comparingInt(ToIntFunction<T> key) { return (a, b) -> Integer.compare(key.applyAsInt(a), key.applyAsInt(b)); }
  static <T> Comparator<T> comparingDouble(ToDoubleFunction<T> key) { return (a, b) -> Double.compare(key.applyAsDouble(a), key.applyAsDouble(b)); }
  static <T> Comparator<T> naturalOrder() { return (a, b) -> ((Comparable) a).compareTo(b); }
  static <T> Comparator<T> reverseOrder() { return (a, b) -> ((Comparable) b).compareTo(a); }
}
` });
global.JavaRT = { Runtime, Suspend, Delegate, TICK, Parser, lex, JavaError, JObject, JArray, JDouble, JChar, JClassRef, Env, typeStr, fmtDouble, quickInfo, T };
})(typeof window !== 'undefined' ? window : globalThis);
