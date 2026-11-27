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
      if (src.startsWith('"""', i)) err('Textblöcke (""") werden nicht unterstützt');
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
  constructor(src) { const r = lex(src); this.toks = r.toks; this.docs = r.docs; this.p = 0; }
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
    while (this.tok.t !== 'eof') { if (this.accept(';')) continue; classes.push(this.parseTypeDecl()); }
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
  parseTypeDecl() {
    const doc = this.docs[this.p];
    const mods = this.parseModifiers(); const line = this.tok.line;
    let kind;
    if (this.accept('class')) kind = 'class'; else if (this.accept('interface')) kind = 'interface'; else if (this.accept('enum')) kind = 'enum';
    else this.fail("'class' erwartet");
    const name = this.ident('Klassenname');
    const typeParams = this.is('<') ? this.parseTypeParams() : [];
    let superName = null, superArgs = null; const interfaces = [];
    if (kind === 'class' && this.accept('extends')) { const st = this.parseType(); superName = st.name; superArgs = st.args; }
    if (kind === 'interface' && this.accept('extends')) { do interfaces.push(this.parseType().name); while (this.accept(',')); }
    if (this.accept('implements')) { if (kind === 'interface') this.fail("Interfaces erweitern andere Interfaces mit 'extends'"); do interfaces.push(this.parseType().name); while (this.accept(',')); }
    const decl = { kind, name, superName, superArgs, interfaces, mods, typeParams, fields: [], methods: [], ctors: [], inits: [], enumConsts: [], line, doc };
    if (!this.is('{')) this.fail("'{' erwartet");
    this.p++;
    if (kind === 'enum') this.parseEnumConsts(decl);
    while (!this.is('}')) {
      if (this.tok.t === 'eof') throw new JavaError(`'}' am Ende der Klasse ${name} fehlt`, this.tok.line);
      this.parseMember(decl);
    }
    decl.endLine = this.tok.line;
    this.p++;
    return decl;
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
    if (this.is('class') || this.is('interface') || this.is('enum')) throw new JavaError('Innere Klassen werden nicht unterstützt – lege dafür eine eigene Klasse an', line);
    const typeParams = this.is('<') ? this.parseTypeParams() : [];
    if (this.tok.t === 'id' && this.tok.v === decl.name && this.isAt(1, '(')) {
      this.p++;
      const params = this.parseParams(); this.skipThrows();
      const body = this.parseBlock();
      decl.ctors.push({ name: decl.name, params, body, mods, line, doc, vis: visOf(mods), isCtor: true, typeParams, ret: VOID });
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
      this.skipThrows();
      let body = null;
      if (this.is('{')) body = this.parseBlock(); else this.expect(';', `oder Methodenrumpf { … }`);
      const isI = decl.kind === 'interface';
      const isAbstract = mods.has('abstract') || (isI && !body);
      if (!body && !isAbstract) throw new JavaError(`Methode ${name}: Rumpf { … } fehlt (oder die Methode als abstract kennzeichnen)`, line);
      if (body && mods.has('abstract')) throw new JavaError(`Abstrakte Methode ${name} darf keinen Rumpf haben`, line);
      decl.methods.push({ name, params, ret: type, body, mods, static: mods.has('static'), abstract: isAbstract, line, doc, vis: isI ? 'public' : visOf(mods), typeParams });
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
  skipThrows() { if (this.accept('throws')) { do this.parseType(); while (this.accept(',')); } }
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
    const t = this.tok; let name;
    if (t.t === 'kw' && PRIMS.has(t.v)) { name = t.v; this.p++; }
    else if (t.t === 'id') { name = t.v; this.p++; while (this.is('.') && this.peek().t === 'id') { this.p += 2; name = this.toks[this.p - 1].v; } }
    else this.fail('Typ erwartet');
    let args = null;
    if (this.is('<')) args = this.parseTypeArgs();
    let dims = 0; while (this.is('[') && this.isAt(1, ']')) { this.p += 2; dims++; }
    return { name, dims, args };
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
      case 'class': case 'interface': case 'enum': this.fail('Klassen können nicht innerhalb von Methoden definiert werden');
      case 'public': case 'private': case 'protected': case 'static':
        throw new JavaError(`'${t.v}' ist hier nicht erlaubt – fehlt vorher eine schließende Klammer '}'?`, line);
    }
    if (t.t === 'id' && this.isAt(1, ':')) { this.p += 2; return this.parseStmt(); }
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
      else { this.expect('case'); labels = []; do labels.push(this.parseTernary()); while (this.accept(',')); }
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
      if (t.v === '(') { const c = this.tryCast(); if (c) return c; }
    }
    let e = this.parsePostfix(this.parsePrimary());
    while (this.is('++') || this.is('--')) {
      if (!['Name', 'Field', 'Index'].includes(e.k)) throw new JavaError(`${this.tok.v} braucht eine Variable`, line);
      e = { k: 'PostInc', op: this.tok.v, e, line: this.tok.line }; this.p++;
    }
    return e;
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
        const nm = this.ident('Name nach dem Punkt');
        if (this.is('(')) e = { k: 'Call', obj: e, name: nm, args: this.parseArgs(), line };
        else e = { k: 'Field', obj: e, name: nm, line };
        continue;
      }
      if (this.is('[')) { const line = this.tok.line; this.p++; const idx = this.parseExpr(); this.expect(']'); e = { k: 'Index', arr: e, idx, line }; continue; }
      if (this.is('::')) this.fail('Methodenreferenzen (::) werden nicht unterstützt');
      if (this.is('->')) this.fail('Lambda-Ausdrücke werden nicht unterstützt');
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
    const t = this.tok; let name;
    if (t.t === 'kw' && PRIMS.has(t.v)) { name = t.v; this.p++; }
    else { name = this.ident('Klassenname nach new'); while (this.is('.') && this.peek().t === 'id') { this.p += 2; name = this.toks[this.p - 1].v; } }
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
    if (this.is('{')) this.fail('Anonyme Klassen werden nicht unterstützt');
    return { k: 'New', type: T(name, 0, targs), args, line };
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

const EXC = [['Exception', 'Throwable'], ['Error', 'Throwable'], ['RuntimeException', 'Exception'], ['ArithmeticException', 'RuntimeException'], ['NullPointerException', 'RuntimeException'], ['IllegalArgumentException', 'RuntimeException'], ['IllegalStateException', 'RuntimeException'], ['IndexOutOfBoundsException', 'RuntimeException'], ['ArrayIndexOutOfBoundsException', 'IndexOutOfBoundsException'], ['StringIndexOutOfBoundsException', 'IndexOutOfBoundsException'], ['ClassCastException', 'RuntimeException'], ['NumberFormatException', 'IllegalArgumentException'], ['UnsupportedOperationException', 'RuntimeException'], ['NegativeArraySizeException', 'RuntimeException'], ['StackOverflowError', 'Error'], ['NoSuchElementException', 'RuntimeException'], ['ConcurrentModificationException', 'RuntimeException'], ['InputMismatchException', 'RuntimeException'], ['CloneNotSupportedException', 'Exception'], ['InterruptedException', 'Exception']];
const UTIL_EXC = new Set(['NoSuchElementException', 'ConcurrentModificationException', 'InputMismatchException']);
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
    this.classes = new Map();
    this.installNatives();
    const decls = new Parser(PRELUDE).parseUnit();
    this.buildClasses(decls, true);
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
    try { this.buildClasses(decls, false, errors); }
    catch (e) { if (e instanceof JavaError) errors.push({ fileId: e.fileId, line: e.line, message: e.message }); else throw e; }
    if (errors.length) return { ok: false, errors };
    for (const c of this.userClasses) new Checker(this, c, errors).run();
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [] };
  }
  buildClasses(decls, builtin, errors) {
    const made = [];
    const fail = (d, line, msg) => { const e = new JavaError(msg, line); e.fileId = d.fileId; throw e; };
    for (const d of decls) {
      if (this.classes.has(d.name)) fail(d, d.line, this.builtinClasses && this.builtinClasses.has(d.name) ? `Der Klassenname '${d.name}' ist schon von Java belegt – wähle einen anderen Namen` : `Klasse '${d.name}' gibt es doppelt`);
      const c = new ClassInfo(d.name, d, { builtin, pkg: builtin ? (UTIL_EXC.has(d.name) ? 'java.util' : 'java.lang') : null });
      c.fileId = d.fileId;
      this.classes.set(d.name, c); made.push(c);
    }
    const obj = this.classes.get('Object');
    for (const c of made) {
      const d = c.decl;
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
        if (missing) { const e = new JavaError(`Klasse ${c.name} ist nicht abstract und überschreibt die abstrakte Methode ${missing.name}(${missing.params.map(p => typeStr(p.type)).join(', ')}) aus ${missing.cls.name} nicht`, c.decl.line); e.fileId = c.fileId; if (errors) errors.push({ fileId: c.fileId, line: c.decl.line, message: e.message }); else throw e; }
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
  run(fn) {
    this.steps = 0; this.depth = 0; this.callStack = [];
    try { const v = fn(); return { ok: true, value: v }; }
    catch (e) { return this.convertError(e); }
  }
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
    if (e instanceof ReturnSig) return { ok: true, value: e.value };
    throw e;
  }
  step() { if (++this.steps > this.maxSteps) this.rtError('Ausführung abgebrochen: Das Programm hat zu viele Schritte gebraucht (Endlosschleife?)'); }

  // ------------------------------------------------ Klassen-Initialisierung
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
        this.runCtor(cls, o, args, ec.line);
      });
      for (const f of d.fields) if (f.static && f.init) { this.line = f.line; cls.staticValues[f.name] = this.initValue(f.init, f.type, ctx); }
      for (const b of d.inits) if (b.static) this.exec(b.body, ctx);
    } finally { this.callStack.pop(); }
  }
  initValue(init, type, ctx) {
    if (init.k === 'ArrayInit') return this.arrayInit(init, type, ctx);
    return this.coerce(this.eval(init, ctx), type, init.line);
  }

  // ------------------------------------------------ Objekte erzeugen
  instantiate(cls, args, line, type) {
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
    this.runCtor(cls, obj, args, line);
    return obj;
  }
  runCtor(cls, obj, args, line) {
    if (!cls || cls.native || !cls.decl) return;
    let ctor = null;
    if (!cls.ctors.length) { if (args.length) this.rtError(`Klasse ${cls.name} hat keinen Konstruktor mit ${args.length} Parameter(n)`, line); }
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
        const cargs = first.e.args.map(a => this.eval(a, ctx));
        if (first.e.which === 'super') this.runCtor(cls.superClass, obj, cargs, first.line);
        else { explicitThis = true; this.runCtor(cls, obj, cargs, first.line); }
        stmts = stmts.slice(1);
      } else if (cls.superClass) this.runCtor(cls.superClass, obj, [], line);
      if (!explicitThis) {
        for (const f of cls.decl.fields) if (!f.static && f.init) { this.line = f.line; obj.fields[f.name] = this.initValue(f.init, f.type, { self: obj, cls, env: new Env(null), isStatic: false, ctor: true }); }
        for (const b of cls.decl.inits) if (!b.static) this.exec(b.body, ctx);
      }
      try { for (const s of stmts) this.exec(s, ctx); }
      catch (e) { if (!(e instanceof ReturnSig)) throw e; }
    } finally { this.depth--; this.callStack.pop(); this.line = line; }
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
  invoke(m, self, args, line) {
    if (m.abstract) this.rtError(`Abstrakte Methode ${m.name} kann nicht aufgerufen werden`, line);
    if (m.static) this.ensureStaticInit(m.cls);
    if (++this.depth > this.maxDepth) { this.depth = 0; this.throwJava('StackOverflowError'); }
    const env = new Env(null);
    for (let i = 0; i < m.params.length; i++) env.declare(m.params[i].name, m.params[i].type, this.coerce(args[i], m.params[i].type, line));
    const ctx = { self: m.static ? null : self, cls: m.cls, env, isStatic: m.static, method: m };
    this.callStack.push({ cls: m.cls.name, method: m.name, callLine: this.line });
    try {
      this.exec(m.body, ctx);
      if (m.ret.name !== 'void') this.rtError(`Methode ${m.name} endet ohne return`, m.body.endLine);
      return undefined;
    } catch (e) {
      if (e instanceof ReturnSig) return m.ret.name === 'void' ? undefined : this.coerce(e.value, m.ret, this.line);
      throw e;
    } finally { this.depth--; this.callStack.pop(); this.line = line; }
  }
  invokeVirtual(obj, m, args, line) {
    if (m.static || !(obj instanceof JObject) || obj.cls.native) return this.invoke(m, obj, args, line);
    const sig = m.params.map(p => typeStr(p.type)).join(',');
    const impl = this.lookupMethods(obj.cls, m.name).find(x => !x.abstract && x.params.map(p => typeStr(p.type)).join(',') === sig)
      || this.lookupMethods(obj.cls, m.name).find(x => !x.abstract && x.params.length === m.params.length) || m;
    return this.invoke(impl, obj, args, line);
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
  exec(s, ctx) {
    if (++this.steps > this.maxSteps) this.rtError('Ausführung abgebrochen: Das Programm hat zu viele Schritte gebraucht (Endlosschleife?)', s.line);
    this.line = s.line;
    switch (s.k) {
      case 'Block': {
        const c2 = { ...ctx, env: new Env(ctx.env) };
        for (const st of s.stmts) this.exec(st, c2);
        return;
      }
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
      case 'Expr': this.eval(s.e, ctx); return;
      case 'Empty': return;
      case 'If': if (this.cond(s.c, ctx)) this.exec(s.a, ctx); else if (s.b) this.exec(s.b, ctx); return;
      case 'While':
        while (this.cond(s.c, ctx)) {
          try { this.exec(s.body, ctx); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
          this.step();
        }
        return;
      case 'DoWhile':
        do {
          try { this.exec(s.body, ctx); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
          this.step();
        } while (this.cond(s.c, ctx));
        return;
      case 'For': {
        const c2 = { ...ctx, env: new Env(ctx.env) };
        for (const i of s.init) this.exec(i, c2);
        for (; !s.c || this.cond(s.c, c2); this.runUpdates(s.upd, c2)) {
          this.line = s.line; this.step();
          try { this.exec(s.body, c2); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        return;
      }
      case 'ForEach': {
        const coll = this.eval(s.it, ctx);
        if (coll === null) this.npe('for-each über null');
        let items, live = null;
        if (coll instanceof JArray) items = coll.data;
        else if (coll instanceof JObject && coll.native && coll.native.list) { items = coll.native.list; live = items.length; }
        else if (coll instanceof JObject && coll.native && coll.native.keys) this.rtError('Über eine Map kann nicht direkt iteriert werden – verwende keySet() oder values()', s.line);
        else this.rtError(`for-each geht nur über Arrays und Listen, nicht über ${this.typeNameOf(coll)}`, s.line);
        for (let i = 0; i < items.length; i++) {
          if (live !== null && items.length !== live) this.throwJava('ConcurrentModificationException', 'Liste wurde während der for-each-Schleife verändert');
          const c2 = { ...ctx, env: new Env(ctx.env) };
          const t = s.type.name === 'var' ? this.typeOfValue(items[i]) : s.type;
          c2.env.declare(s.name, t, s.type.name === 'var' ? items[i] : this.coerce(items[i], s.type, s.line));
          try { this.exec(s.body, c2); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        if (live !== null && items.length !== live) this.throwJava('ConcurrentModificationException', 'Liste wurde während der for-each-Schleife verändert');
        return;
      }
      case 'Return': throw new ReturnSig(s.e ? this.eval(s.e, ctx) : undefined);
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      case 'Throw': {
        const v = this.eval(s.e, ctx);
        if (v === null) this.npe('throw null');
        if (!(v instanceof JObject) || !v.cls.isSubclassOf(this.classes.get('Throwable'))) this.rtError('Nur Ausnahme-Objekte (Throwable) können geworfen werden', s.line);
        this.line = s.line;
        throw new JThrow(v, this.stackSnapshot());
      }
      case 'Try': {
        try { this.exec(s.block, ctx); }
        catch (e) {
          let ex = e;
          if (e instanceof RangeError) { try { ex = new JThrow(this.instantiate(this.classes.get('StackOverflowError'), [], this.line), this.stackSnapshot()); } catch (_) { throw e; } }
          if (!(ex instanceof JThrow)) throw e;
          const cc = s.catches.find(c => c.types.some(tn => { const k = this.classes.get(tn); return k && ex.obj.cls.isSubclassOf(k); }));
          if (!cc) throw ex;
          const c2 = { ...ctx, env: new Env(ctx.env) };
          c2.env.declare(cc.name, T(cc.types[0]), ex.obj);
          this.exec(cc.body, c2);
        } finally { if (s.fin) this.exec(s.fin, ctx); }
        return;
      }
      case 'Switch': {
        const v = this.eval(s.e, ctx);
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
        if (idx < 0) return;
        const c2 = { ...ctx, env: new Env(ctx.env) };
        try {
          if (s.arrow) { for (const st of s.cases[idx].stmts) this.exec(st, c2); }
          else for (let i = idx; i < s.cases.length; i++) for (const st of s.cases[i].stmts) this.exec(st, c2);
        } catch (e) { if (e === BREAK) return; throw e; }
        return;
      }
      default: this.rtError('Unbekannte Anweisung ' + s.k);
    }
  }
  runUpdates(upd, ctx) { for (const u of upd) this.eval(u, ctx); }
  enumConst(cls, name, line) { this.ensureStaticInit(cls); const o = cls.enumConsts.find(e => e.enumName === name); if (!o) this.rtError(`${cls.name} hat keine Konstante ${name}`, line); return o; }
  cond(e, ctx) {
    const v = this.eval(e, ctx);
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
      case 'Super': if (!ctx.self) this.rtError("'super' gibt es nicht in einer statischen Methode", e.line); return ctx.self;
      case 'Field': return this.evalField(e, ctx);
      case 'Index': {
        const a = this.eval(e.arr, ctx); const i = this.toInt(this.eval(e.idx, ctx), e.line);
        this.checkIndex(a, i, e.line); return a.data[i];
      }
      case 'Call': return this.evalCall(e, ctx);
      case 'New': {
        const cls = this.classes.get(e.type.name);
        if (!cls) this.rtError(`Klasse '${e.type.name}' nicht gefunden`, e.line);
        const args = e.args.map(a => this.eval(a, ctx));
        this.line = e.line;
        return this.instantiate(cls, args, e.line, e.type);
      }
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
      case 'PreInc': case 'PostInc': {
        const ref = this.lvalue(e.e, ctx); const old = ref.get();
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
      case 'Cond': return this.cond(e.c, ctx) ? this.eval(e.a, ctx) : this.eval(e.b, ctx);
      case 'Cast': return this.cast(this.eval(e.e, ctx), e.type, e.line);
      case 'InstanceOf': {
        const v = this.eval(e.e, ctx); const r = v !== null && this.isInstance(v, e.type);
        if (r && e.bind) ctx.env.declare(e.bind, e.type, v);
        return r;
      }
      case 'CtorCall': this.rtError(`${e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`, e.line);
    }
    this.rtError('Unbekannter Ausdruck ' + e.k, e.line);
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
    if (field.vis === 'private' && ctx.cls !== owner && !(ctx.cls && owner && ctx.cls.name === owner.name)) {
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
    const o = this.eval(e.obj, ctx);
    if (o instanceof JClassRef) {
      const f = this.findField(o.cls, e.name);
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
      const o = this.eval(t.obj, ctx);
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
    if (t.k === 'Index') {
      const a = this.eval(t.arr, ctx); const i = this.toInt(this.eval(t.idx, ctx), t.line);
      this.checkIndex(a, i, t.line);
      return { type: a.elemType, get() { return a.data[i]; }, set(x) { a.data[i] = x; } };
    }
    this.rtError('Hier kann nichts zugewiesen werden', t.line);
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
  evalAssign(e, ctx) {
    const ref = this.lvalue(e.target, ctx);
    let v;
    if (e.op === '=') v = this.coerce(this.eval(e.value, ctx), ref.type, e.line);
    else {
      const cur = ref.get(); const rhs = this.eval(e.value, ctx);
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
  evalCall(e, ctx) {
    const line = e.line;
    if (e.obj === null) {
      const ms = this.lookupMethods(ctx.cls, e.name);
      if (!ms.length && ctx.self && ['toString', 'equals', 'hashCode', 'getClass', 'name', 'ordinal', 'compareTo'].includes(e.name)) return this.objectMethod(ctx.self, e.name, e.args.map(a => this.eval(a, ctx)), line);
      if (!ms.length) this.rtError(`Methode '${e.name}' nicht gefunden`, line);
      const args = e.args.map(a => this.eval(a, ctx));
      this.line = line;
      const m = this.selectOverload(ms, args, e.name, line);
      if (m.static) return this.invoke(m, null, args, line);
      if (!ctx.self) this.rtError(`Die Methode ${e.name}() ist nicht statisch und kann nicht aus einer statischen Methode aufgerufen werden – erzeuge zuerst ein Objekt`, line);
      if (m.vis === 'private') return this.invoke(m, ctx.self, args, line);
      return this.invokeVirtual(ctx.self, m, args, line);
    }
    if (e.obj.k === 'Super') {
      if (!ctx.self) this.rtError("'super' gibt es nicht in einer statischen Methode", line);
      const sc = ctx.cls.superClass;
      const ms = this.lookupMethods(sc, e.name).filter(m => !m.abstract);
      const args = e.args.map(a => this.eval(a, ctx));
      this.line = line;
      if (!ms.length) {
        if (['toString', 'equals', 'hashCode', 'getClass'].includes(e.name)) return this.objectMethod(ctx.self, e.name, args, line, true);
        this.rtError(`Die Oberklasse hat keine (nicht-abstrakte) Methode '${e.name}'`, line);
      }
      const m = this.selectOverload(ms, args, e.name, line);
      return this.invoke(m, ctx.self, args, line);
    }
    const o = this.eval(e.obj, ctx);
    const args = e.args.map(a => this.eval(a, ctx));
    this.line = line;
    return this.callOn(o, e.name, args, line, ctx);
  }
  callOn(o, name, args, line, ctx) {
    if (o instanceof JClassRef) {
      const c = o.cls;
      if (c.native) {
        const f = c.native.statics && c.native.statics[name];
        if (!f) this.rtError(`Methode '${name}' gibt es in ${c.name} nicht (oder sie wird nicht unterstützt)`, line);
        return f(this, args, line);
      }
      if (c.isEnum && name === 'values' && !args.length) { this.ensureStaticInit(c); return new JArray(T(c.name), c.enumConsts.slice()); }
      if (c.isEnum && name === 'valueOf' && args.length === 1) { this.ensureStaticInit(c); const r = c.enumConsts.find(x => x.enumName === args[0]); if (!r) this.throwJava('IllegalArgumentException', `No enum constant ${c.name}.${args[0]}`); return r; }
      const ms = this.lookupMethods(c, name);
      if (!ms.length) this.rtError(`Klasse ${c.name} hat keine Methode '${name}'`, line);
      const m = this.selectOverload(ms, args, name, line);
      if (!m.static) this.rtError(`Methode ${name}() ist nicht statisch – rufe sie an einem Objekt auf`, line);
      if (ctx) this.checkAccess(m, m.cls, ctx, line, 'Methode');
      return this.invoke(m, null, args, line);
    }
    if (o === null) this.npe(`Methode ${name}() wurde auf null aufgerufen`);
    if (typeof o === 'string') return this.stringMethod(o, name, args, line);
    if (o instanceof JArray) {
      if (name === 'clone' && !args.length) return new JArray(o.elemType, o.data.slice());
      if (name === 'length') this.rtError('Bei Arrays heißt es length ohne Klammern', line);
      if (['equals', 'hashCode', 'toString', 'getClass'].includes(name)) return this.objectMethod(o, name, args, line);
      this.rtError(`Arrays haben keine Methode '${name}'`, line);
    }
    if (o instanceof JObject) {
      if (o.cls.native) {
        for (let c = o.cls; c; c = c.superClass) {
          const f = c.native && c.native.methods && c.native.methods[name];
          if (f) return f(this, o, args, line);
        }
        if (['equals', 'hashCode', 'toString', 'getClass'].includes(name)) return this.objectMethod(o, name, args, line);
        this.rtError(`Methode '${name}' gibt es für ${o.cls.name} nicht (oder sie wird nicht unterstützt)`, line);
      }
      const ms = this.lookupMethods(o.cls, name);
      if (!ms.length) {
        if (['equals', 'hashCode', 'toString', 'getClass', 'name', 'ordinal', 'compareTo'].includes(name)) return this.objectMethod(o, name, args, line);
        this.rtError(`Klasse ${o.cls.name} hat keine Methode '${name}'`, line);
      }
      const m = this.selectOverload(ms, args, name, line);
      if (ctx) this.checkAccess(m, m.cls, ctx, line, 'Methode');
      if (m.static) return this.invoke(m, null, args, line);
      return this.invokeVirtual(o, m, args, line);
    }
    this.rtError(`Auf einem Wert vom Typ ${this.typeNameOf(o)} kann keine Methode aufgerufen werden`, line);
  }
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
  evalSnippet(code, env) {
    const src = code.trim();
    const ctx = { self: null, cls: this.padClass, env, isStatic: true };
    if (!src) return { ok: true, hasValue: false };
    let expr = null;
    if (!src.endsWith(';')) {
      try { const p = new Parser(src); const e = p.parseExpr(); if (p.tok.t === 'eof') expr = e; } catch (e) { expr = null; }
    }
    if (expr && !(expr.k === 'Assign' || expr.k === 'PreInc' || expr.k === 'PostInc')) {
      const r = this.run(() => this.eval(expr, ctx));
      if (r.ok && r.value instanceof JClassRef) return { ok: false, message: `${r.value.cls.name} ist eine Klasse und kein Wert` };
      if (r.ok) return { ok: true, hasValue: r.value !== undefined, value: r.value };
      return r;
    }
    let stmts;
    try {
      const p = new Parser(src.endsWith(';') || src.endsWith('}') ? src : src + ';');
      stmts = [];
      while (p.tok.t !== 'eof') stmts.push(p.parseStmt());
    } catch (e) {
      if (e instanceof JavaError) return { ok: false, message: e.message, kind: 'compile' };
      throw e;
    }
    const r = this.run(() => { for (const s of stmts) this.exec(s, ctx); });
    if (!r.ok) return r;
    if (stmts.length === 1 && stmts[0].k === 'Expr' && stmts[0].e.k === 'Assign' && !src.endsWith(';')) return { ok: true, hasValue: false };
    return { ok: true, hasValue: false };
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
    const ifaceDefaults = [];
    const visit = (c) => { for (const i of c.interfaces) { for (const m of i.methodList) { const k = m.name + '(' + m.params.map(p => typeStr(p.type)).join(',') + ')'; if (!m.abstract && !m.static && !seen.has(k) && !i.builtin) { seen.add(k); ifaceDefaults.push({ m, label: this.sig(m), doc: m.doc }); } } visit(i); } };
    for (let c = o.cls; c; c = c.superClass) visit(c);
    if (ifaceDefaults.length) groups.push({ from: 'Interfaces', methods: ifaceDefaults, inherited: true });
    return groups;
  }
  callMethod(obj, m, args) {
    if (m.native) return this.callOn(obj, m.name, args, 0, null);
    if (m.isCtor) return this.instantiate(m.cls, args, 0);
    if (m.static) return this.invoke(m, null, args, 0);
    return this.invokeVirtual(obj, m, args, 0);
  }
  inspect(v) {
    const rows = [];
    if (v instanceof JArray) {
      v.data.forEach((x, i) => rows.push({ name: `[${i}]`, type: typeStr(v.elemType), value: x }));
      return { title: `${typeStr(v.elemType)}[${v.data.length}]`, rows };
    }
    if (!(v instanceof JObject)) return { title: this.typeNameOf(v), rows };
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
    const listSpec = {
      pkg: 'java.util', interfaces: ['List'],
      ctor(rt, args, line, type) {
        const o = new JObject(rt.classes.get(type && rt.classes.get(type.name) && rt.classes.get(type.name).native === listSpec ? type.name : 'ArrayList'));
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
        sort(rt, o, a) { if (a[0] !== null && a[0] !== undefined) rt.rtError('sort mit Comparator wird nicht unterstützt – verwende sort(null) oder Collections.sort'); o.native.list.sort((x, y) => rt.compareValues(x, y)); },
        toArray(rt, o) { return new JArray(T('Object'), o.native.list.slice()); },
        equals(rt, o, a) { return rt.javaEquals(o, a[0]); },
        subList(rt, o, a) { const n = rt.classes.get('ArrayList'); const r = new JObject(n); r.native = { list: o.native.list.slice(intArg(a[0]), intArg(a[1])), elemType: o.native.elemType }; return r; },
      },
      toString(rt, o) { return '[' + o.native.list.map(x => x === o ? '(this Collection)' : rt.str(x)).join(', ') + ']'; },
      ui: [{ name: 'add', params: [{ type: T('Object'), name: 'element' }], ret: BOOL }, { name: 'get', params: [{ type: INT, name: 'index' }], ret: T('Object') }, { name: 'size', params: [], ret: INT }, { name: 'remove', params: [{ type: INT, name: 'index' }], ret: T('Object') }, { name: 'contains', params: [{ type: T('Object'), name: 'o' }], ret: BOOL }, { name: 'isEmpty', params: [], ret: BOOL }, { name: 'clear', params: [], ret: VOID }],
    };
    def('Iterable', { isInterface: true, pkg: 'java.lang' });
    def('Collection', { isInterface: true, pkg: 'java.util', interfaces: ['Iterable'] });
    def('List', { isInterface: true, pkg: 'java.util', interfaces: ['Collection'] });
    def('ArrayList', listSpec); def('LinkedList', listSpec);
    const setSpec = {
      pkg: 'java.util', interfaces: ['Set'],
      ctor(rt, args, line, type) { const o = new JObject(rt.classes.get(type && type.name === 'TreeSet' ? 'TreeSet' : 'HashSet')); o.native = { list: [], elemType: type && type.args && type.args[0] || null, sorted: type && type.name === 'TreeSet' }; if (args.length === 1 && isColl(args[0])) for (const x of args[0].native.list) setSpec.methods.add(rt, o, [x]); return o; },
      methods: {
        add(rt, o, a, line) { const v = elem(o, a[0], line); if (o.native.list.some(x => rt.javaEquals(v, x))) return false; o.native.list.push(v); if (o.native.sorted) o.native.list.sort((x, y) => rt.compareValues(x, y)); return true; },
        remove(rt, o, a) { const k = o.native.list.findIndex(x => rt.javaEquals(a[0], x)); if (k >= 0) { o.native.list.splice(k, 1); return true; } return false; },
        contains(rt, o, a) { return o.native.list.some(x => rt.javaEquals(a[0], x)); },
        size(rt, o) { return o.native.list.length; }, isEmpty(rt, o) { return !o.native.list.length; }, clear(rt, o) { o.native.list.length = 0; },
        addAll(rt, o, a) { let ch = false; for (const x of a[0].native.list) ch = setSpec.methods.add(rt, o, [x]) || ch; return ch; },
      },
      toString: listSpec.toString,
      ui: [{ name: 'add', params: [{ type: T('Object'), name: 'element' }], ret: BOOL }, { name: 'contains', params: [{ type: T('Object'), name: 'o' }], ret: BOOL }, { name: 'size', params: [], ret: INT }],
    };
    def('Set', { isInterface: true, pkg: 'java.util', interfaces: ['Collection'] });
    def('HashSet', setSpec); def('TreeSet', setSpec);
    const mapFind = (o, k) => o.native.keys.findIndex(x => rt.javaEquals(k, x));
    const mapSpec = {
      pkg: 'java.util', interfaces: ['Map'],
      ctor(rt, args, line, type) { const o = new JObject(rt.classes.get(type && type.name === 'TreeMap' ? 'TreeMap' : 'HashMap')); o.native = { keys: [], vals: [], kType: type && type.args && type.args[0] || null, vType: type && type.args && type.args[1] || null, sorted: type && type.name === 'TreeMap' }; return o; },
      methods: {
        put(rt, o, a, line) { const k = o.native.kType ? rt.coerce(a[0], o.native.kType, line) : a[0]; const v = o.native.vType ? rt.coerce(a[1], o.native.vType, line) : a[1]; const i = mapFind(o, k); if (i >= 0) { const old = o.native.vals[i]; o.native.vals[i] = v; return old; } o.native.keys.push(k); o.native.vals.push(v); if (o.native.sorted) { const idx = o.native.keys.map((_, j) => j).sort((x, y) => rt.compareValues(o.native.keys[x], o.native.keys[y])); o.native.keys = idx.map(j => o.native.keys[j]); o.native.vals = idx.map(j => o.native.vals[j]); } return null; },
        get(rt, o, a) { const i = mapFind(o, a[0]); return i >= 0 ? o.native.vals[i] : null; },
        getOrDefault(rt, o, a) { const i = mapFind(o, a[0]); return i >= 0 ? o.native.vals[i] : a[1]; },
        containsKey(rt, o, a) { return mapFind(o, a[0]) >= 0; }, containsValue(rt, o, a) { return o.native.vals.some(v => rt.javaEquals(a[0], v)); },
        remove(rt, o, a) { const i = mapFind(o, a[0]); if (i < 0) return null; o.native.keys.splice(i, 1); return o.native.vals.splice(i, 1)[0]; },
        size(rt, o) { return o.native.keys.length; }, isEmpty(rt, o) { return !o.native.keys.length; }, clear(rt, o) { o.native.keys = []; o.native.vals = []; },
        keySet(rt, o) { const s = new JObject(rt.classes.get('HashSet')); s.native = { list: o.native.keys.slice(), elemType: o.native.kType }; return s; },
        values(rt, o) { const s = new JObject(rt.classes.get('ArrayList')); s.native = { list: o.native.vals.slice(), elemType: o.native.vType }; return s; },
      },
      toString(rt, o) { return '{' + o.native.keys.map((k, i) => rt.str(k) + '=' + rt.str(o.native.vals[i])).join(', ') + '}'; },
      ui: [{ name: 'put', params: [{ type: T('Object'), name: 'key' }, { type: T('Object'), name: 'value' }], ret: T('Object') }, { name: 'get', params: [{ type: T('Object'), name: 'key' }], ret: T('Object') }, { name: 'size', params: [], ret: INT }],
    };
    def('Map', { isInterface: true, pkg: 'java.util' });
    def('HashMap', mapSpec); def('TreeMap', mapSpec);

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
      sort(rt, a) { const arr = arrArg(a[0]); if (a.length === 3) { const s = intArg(a[1]), e = intArg(a[2]); const part = arr.data.slice(s, e).sort((x, y) => rt.compareValues(x, y)); arr.data.splice(s, e - s, ...part); } else arr.data.sort((x, y) => rt.compareValues(x, y)); },
      fill(rt, a, line) { const arr = arrArg(a[0]); const v = rt.coerce(a[a.length - 1], arr.elemType, line); if (a.length === 4) { for (let i = intArg(a[1]); i < intArg(a[2]); i++) arr.data[i] = v; } else arr.data.fill(v); },
      copyOf(rt, a) { const arr = arrArg(a[0]); const n = intArg(a[1]); const d = arr.data.slice(0, n); while (d.length < n) d.push(defaultValue(arr.elemType)); return new JArray(arr.elemType, d); },
      copyOfRange(rt, a) { const arr = arrArg(a[0]); return new JArray(arr.elemType, arr.data.slice(intArg(a[1]), intArg(a[2]))); },
      equals(rt, a) { if (a[0] === null || a[1] === null) return a[0] === a[1]; return a[0].data.length === a[1].data.length && a[0].data.every((x, i) => rt.javaEquals(x, a[1].data[i])); },
      asList(rt, a) { const o = new JObject(rt.classes.get('ArrayList')); o.native = { list: a.length === 1 && a[0] instanceof JArray ? a[0].data.slice() : a.slice(), elemType: null }; return o; },
      stream() { rt.rtError('Streams werden nicht unterstützt'); },
    } });
    const collArg = (v) => { if (!isColl(v)) rt.rtError('Liste erwartet'); return v.native.list; };
    def('Collections', { pkg: 'java.util', statics: {
      sort(rt, a) { if (a.length > 1) rt.rtError('sort mit Comparator wird nicht unterstützt'); collArg(a[0]).sort((x, y) => rt.compareValues(x, y)); },
      reverse(rt, a) { collArg(a[0]).reverse(); },
      shuffle(rt, a) { const L = collArg(a[0]); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } },
      max(rt, a) { const L = collArg(a[0]); if (!L.length) ex('NoSuchElementException'); return L.reduce((m, x) => rt.compareValues(x, m) > 0 ? x : m); },
      min(rt, a) { const L = collArg(a[0]); if (!L.length) ex('NoSuchElementException'); return L.reduce((m, x) => rt.compareValues(x, m) < 0 ? x : m); },
      swap(rt, a) { const L = collArg(a[0]); const i = intArg(a[1]), j = intArg(a[2]); listIdx(null, i, L.length); listIdx(null, j, L.length); [L[i], L[j]] = [L[j], L[i]]; },
      frequency(rt, a) { return collArg(a[0]).filter(x => rt.javaEquals(a[1], x)).length; },
    } });
    def('Thread', { statics: { sleep() { } } });
    def('Objects', { pkg: 'java.util', statics: { equals(rt, a) { return rt.javaEquals(a[0], a[1]); }, hash(rt, a) { let h = 1; for (const x of a) h = (Math.imul(31, h) + rt.hashOf(x)) | 0; return h; }, isNull(rt, a) { return a[0] === null; }, requireNonNull(rt, a) { if (a[0] === null) rt.npe(a[1] || null); return a[0]; } } });
    def('Scanner', { pkg: 'java.util', ctor(rt, a, line) { rt.rtError('Tastatureingabe mit Scanner wird hier nicht unterstützt. Übergib die Werte als Parameter (beim Methodenaufruf wird danach gefragt).', line); } });
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
        if (f.init) { this.ctx = { isStatic: f.static, method: null, loops: 0, tps: c.typeParams }; const sc = new Scope(null); const t = f.init.k === 'ArrayInit' ? this.arrayInit(f.init, f.type, sc) : this.expr(f.init, sc); this.assignCheck(f.type, t, f.init, f.line); }
      }
      for (const ec of d.enumConsts) { this.ctx = { isStatic: true, loops: 0, tps: [] }; this.ctorArgsCheck(c, ec.args.map(a => this.expr(a, new Scope(null))), ec.line); }
      for (const m of d.methods) {
        for (const p of m.params) this.checkType(p.type, m.line, m.typeParams);
        if (m.ret.name !== 'void') this.checkType(m.ret, m.line, m.typeParams);
        this.overrideCheck(m);
        if (m.body) this.body(m, false);
      }
      for (const k of d.ctors) { for (const p of k.params) this.checkType(p.type, k.line); this.body(k, true); }
      if (!d.ctors.length && c.superClass && !c.isInterface && !c.isEnum) this.implicitSuper(d.line);
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
    return PRIMS.has(name) || name === 'var' || this.rt.classes.has(name) || (this.cls.typeParams || []).includes(name) || (tps || []).includes(name) || (this.ctx && this.ctx.tps || []).includes(name);
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
    this.ctx = { isStatic: !!m.static, method: m, isCtor, loops: 0, switches: 0, tps: [...(this.cls.typeParams || []), ...(m.typeParams || [])] };
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
      if (i > 0 && ['Return', 'Break', 'Continue', 'Throw'].includes(stmts[i - 1].k)) this.err(s.line, 'Diese Anweisung wird nie erreicht (sie steht nach return/break/continue/throw)');
      this.stmt(s, sc);
    }
  }
  canComplete(s) {
    if (!s) return true;
    switch (s.k) {
      case 'Return': case 'Throw': return false;
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
    switch (s.k) {
      case 'Block': { const s2 = new Scope(sc); this.block(s.stmts, s2); return; }
      case 'Local':
        for (const d of s.decls) {
          let t = d.type;
          this.checkType(t, s.line);
          if (d.init) {
            const it = d.init.k === 'ArrayInit' ? (t.name === 'var' ? this.err(s.line, 'var kann nicht mit { … } verwendet werden') : this.arrayInit(d.init, t, sc)) : this.expr(d.init, sc);
            if (t.name === 'var') { if (it && it.name === 'void') this.err(s.line, 'Die Methode liefert keinen Wert (void)'); t = it && it.name !== 'null' ? it : null; }
            else this.assignCheck(t, it, d.init, s.line);
          } else if (t.name === 'var') this.err(s.line, 'var braucht einen Startwert');
          sc.declare(d.name, t, s.line, this);
        }
        return;
      case 'Expr':
        if (s.e.k === 'CtorCall') this.err(s.line, `${s.e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`);
        this.expr(s.e, sc); return;
      case 'Empty': return;
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
          else if (it.args && it.args.length === 1) et = it.args[0];
        }
        if (s.type.name !== 'var') { this.checkType(s.type, s.line); if (et) this.assignCheck(s.type, et, null, s.line); }
        s2.declare(s.name, s.type.name === 'var' ? et : s.type, s.line, this);
        this.loop(s.body, s2); return;
      }
      case 'Return': {
        const m = this.ctx.method;
        if (!m) this.err(s.line, 'return ist hier nicht erlaubt');
        if (this.ctx.isCtor) { if (s.e) this.err(s.line, 'Ein Konstruktor kann keinen Wert zurückgeben'); return; }
        if (m.ret.name === 'void') { if (s.e) this.err(s.line, `Die Methode ${m.name} ist void und kann keinen Wert zurückgeben`); return; }
        if (!s.e) this.err(s.line, `return braucht hier einen Wert vom Typ ${typeStr(m.ret)}`);
        const t = this.expr(s.e, sc); this.assignCheck(m.ret, t, s.e, s.line); return;
      }
      case 'Break': if (!this.ctx.loops && !this.ctx.switches) this.err(s.line, 'break außerhalb einer Schleife oder eines switch'); return;
      case 'Continue': if (!this.ctx.loops) this.err(s.line, 'continue außerhalb einer Schleife'); return;
      case 'Throw': { const t = this.expr(s.e, sc); const th = this.rt.classes.get('Throwable'); const c = t && this.rt.classes.get(t.name); if (t && !t.dims && c && !c.isSubclassOf(th)) this.err(s.line, `Nur Ausnahmen können geworfen werden, nicht ${typeStr(t)}`); return; }
      case 'Try': {
        this.stmt(s.block, sc);
        for (const c of s.catches) { for (const tn of c.types) { const k = this.rt.classes.get(tn); if (!k) this.err(s.line, `Ausnahmeklasse '${tn}' nicht gefunden` + suggest(tn, [...this.rt.classes.keys()].filter(n => /Exception|Error|Throwable/.test(n)))); } const s2 = new Scope(sc); s2.declare(c.name, T(c.types[0]), s.line, this); this.stmt(c.body, s2); }
        if (s.fin) this.stmt(s.fin, sc); return;
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
    if (member.vis === 'private' && owner !== this.cls) this.err(line, `${what} '${member.name}' ist private in ${owner.name} – Zugriff nur innerhalb dieser Klasse (verwende eine get-Methode)`);
  }
  visibleNames(sc) { const s = sc.allNames(); for (const f of this.rt.allFieldNames(this.cls)) s.push(f); return s; }
  expr(e, sc) {
    switch (e.k) {
      case 'Lit': return this.litType(e.v);
      case 'Paren': return this.expr(e.e, sc);
      case 'Name': {
        const v = sc.get(e.name);
        if (v !== undefined) return v;
        const f = this.rt.findField(this.cls, e.name);
        if (f) {
          if (!f.field.static && this.ctx.isStatic) this.err(e.line, `Das Attribut '${e.name}' gehört zu einem Objekt und kann in einer statischen Methode nicht verwendet werden`);
          if (f.owner !== this.cls && f.field.vis === 'private') this.err(e.line, `Attribut '${e.name}' ist private in ${f.owner.name} – Unterklassen können darauf nicht direkt zugreifen (protected oder get-Methode verwenden)`);
          return f.field.type;
        }
        if (this.rt.classes.has(e.name)) return { classRef: e.name };
        this.err(e.line, `Variable '${e.name}' nicht gefunden` + suggest(e.name, [...this.visibleNames(sc), ...this.rt.classes.keys()]));
      }
      case 'This': if (this.ctx.isStatic) this.err(e.line, "'this' kann in einer statischen Methode nicht verwendet werden"); return T(this.cls.name);
      case 'Super': return this.cls.superClass ? T(this.cls.superClass.name) : null;
      case 'Field': {
        if (e.obj.k === 'Super') { const f = this.rt.findField(this.cls.superClass, e.name); if (!f) this.err(e.line, `Die Oberklasse hat kein Attribut '${e.name}'`); this.accessCheck(f.field, f.owner, e.line, 'Attribut'); return f.field.type; }
        const t = this.expr(e.obj, sc);
        if (!t) return null;
        if (t.classRef) {
          const c = this.rt.classes.get(t.classRef);
          const f = this.rt.findField(c, e.name);
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
        if (c.isInterface) this.err(e.line, `${n} ist ein Interface – davon können keine Objekte erzeugt werden`);
        if (c.isAbstract) this.err(e.line, `${n} ist abstrakt – davon können keine Objekte erzeugt werden`);
        if (c.isEnum) this.err(e.line, 'Von einem enum können keine Objekte mit new erzeugt werden');
        if (n === 'Scanner') this.err(e.line, 'Tastatureingabe mit Scanner wird hier nicht unterstützt – übergib die Werte als Parameter');
        if (c.decl) this.ctorArgsCheck(c, at, e.line);
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
      case 'CtorCall': this.err(e.line, `${e.which}(…) ist nur als erste Anweisung in einem Konstruktor erlaubt`);
    }
    return null;
  }
  lval(t, sc) {
    const ty = this.expr(t, sc);
    if (ty && ty.classRef) this.err(t.line, 'Einer Klasse kann nichts zugewiesen werden');
    let f = null;
    if (t.k === 'Name' && sc.get(t.name) === undefined) f = this.rt.findField(this.cls, t.name);
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
    const ok = cands.filter(m => m.params.every((p, i) => this.assignable(this.norm(p.type) && !(m.typeParams || []).includes(p.type.name) && !(m.cls && (m.cls.typeParams || []).includes(p.type.name)) ? p.type : null, this.norm(at[i]), null)));
    if (!ok.length) this.err(line, `${label}(${cands[0].params.map(p => typeStr(p.type)).join(', ')}) passt nicht zu den Argumenten (${at.map(t => t ? (t.classRef ? t.classRef : typeStr(t)) : '?').join(', ')})`);
    const m = ok[0];
    if (!isCtor && m.vis === 'private' && m.cls !== this.cls) this.err(line, `Methode ${m.name}() ist private in ${m.cls.name}`);
    if (isCtor && m.vis === 'private' && owner !== this.cls) this.err(line, `Konstruktor ${owner.name}(…) ist private`);
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
    for (let i = 0; i < at.length; i++) { if (at[i] && at[i].name === 'void') this.err(e.line, 'Ein void-Methodenaufruf liefert keinen Wert und kann nicht als Argument verwendet werden'); if (at[i] && at[i].classRef) this.err(e.line, `${at[i].classRef} ist eine Klasse und kein Wert`); }
    const label = (c) => `Methode ${e.name}`;
    if (e.obj === null) {
      const ms = this.rt.lookupMethods(this.cls, e.name);
      if (!ms.length) {
        if (['toString', 'equals', 'hashCode', 'getClass'].includes(e.name) && !this.ctx.isStatic) return e.name === 'toString' ? STRING : e.name === 'equals' ? BOOL : e.name === 'hashCode' ? INT : null;
        if (this.cls.isEnum && ['values', 'ordinal', 'name'].includes(e.name)) return e.name === 'values' ? T(this.cls.name, 1) : e.name === 'ordinal' ? INT : STRING;
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
      if (!ms.length) { if (['toString', 'equals', 'hashCode'].includes(e.name)) return e.name === 'toString' ? STRING : e.name === 'equals' ? BOOL : INT; this.err(e.line, `Die Oberklasse hat keine (nicht-abstrakte) Methode '${e.name}'`); }
      return this.retType(this.pick(ms, at, e.line, label(), this.cls), null);
    }
    const t = this.norm(this.expr(e.obj, sc));
    if (!t) return null;
    if (t.classRef) {
      const c = this.rt.classes.get(t.classRef);
      if (c.native) {
        if (!c.native.statics || !c.native.statics[e.name]) {
          if (c.name === 'System' && e.name === 'println') this.err(e.line, "Es heißt System.out.println(…)");
          this.err(e.line, `Methode '${e.name}' gibt es in ${c.name} nicht (oder sie wird nicht unterstützt)` + suggest(e.name, Object.keys(c.native.statics || {})));
        }
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
    if (c && c.decl && !c.builtin) {
      const ms = this.rt.lookupMethods(c, e.name);
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
      if (!found && !['toString', 'equals', 'hashCode', 'getClass'].includes(e.name)) this.err(e.line, `Methode '${e.name}' gibt es für ${c.name} nicht (oder sie wird nicht unterstützt)` + suggest(e.name, Object.keys(c.native.methods || {})) + (e.name === 'length' && c.native.list ? ' – bei Listen heißt es size()' : ''));
      return listRet(c, e.name, t);
    }
    if (c && c.isInterface && c.native) return listRet(c, e.name, t);
    return null;
  }
}
function listRet(c, name, t) {
  const el = t.args && t.args[0] ? t.args[0] : null;
  if (['size', 'indexOf', 'lastIndexOf', 'length'].includes(name)) return INT;
  if (['isEmpty', 'contains', 'containsKey', 'containsValue', 'add'].includes(name) && !(name === 'add' && false)) return name === 'add' ? null : BOOL;
  if (['get', 'getFirst', 'getLast', 'removeFirst', 'removeLast'].includes(name)) { if (['HashMap', 'Map', 'TreeMap'].includes(c.name)) return t.args && t.args[1] || null; return el; }
  if (name === 'nextInt') return INT; if (name === 'nextDouble' || name === 'nextGaussian') return DOUBLE; if (name === 'nextBoolean') return BOOL;
  if (name === 'toString') return STRING;
  if (name === 'keySet' && t.args) return T('Set', 0, [t.args[0]]);
  if (name === 'values' && t.args) return T('Collection', 0, [t.args[1]]);
  return null;
}
const NATIVE_RET = {
  'Math.sqrt': DOUBLE, 'Math.pow': DOUBLE, 'Math.random': DOUBLE, 'Math.floor': DOUBLE, 'Math.ceil': DOUBLE, 'Math.sin': DOUBLE, 'Math.cos': DOUBLE, 'Math.tan': DOUBLE, 'Math.round': LONG, 'Math.cbrt': DOUBLE, 'Math.exp': DOUBLE, 'Math.log': DOUBLE, 'Math.log10': DOUBLE, 'Math.hypot': DOUBLE, 'Math.atan': DOUBLE, 'Math.atan2': DOUBLE, 'Math.toRadians': DOUBLE, 'Math.toDegrees': DOUBLE, 'Math.signum': DOUBLE, 'Math.rint': DOUBLE, 'Math.floorDiv': INT, 'Math.floorMod': INT,
  'Integer.parseInt': INT, 'Integer.valueOf': T('Integer'), 'Integer.toString': STRING, 'Integer.compare': INT, 'Integer.toBinaryString': STRING, 'Integer.toHexString': STRING,
  'Double.parseDouble': DOUBLE, 'Double.valueOf': T('Double'), 'Double.toString': STRING, 'Double.isNaN': BOOL, 'Double.compare': INT,
  'Long.parseLong': LONG, 'Boolean.parseBoolean': BOOL,
  'String.valueOf': STRING, 'String.format': STRING, 'String.join': STRING,
  'Character.isDigit': BOOL, 'Character.isLetter': BOOL, 'Character.isLetterOrDigit': BOOL, 'Character.isUpperCase': BOOL, 'Character.isLowerCase': BOOL, 'Character.isWhitespace': BOOL, 'Character.getNumericValue': INT, 'Character.toString': STRING,
  'Arrays.toString': STRING, 'Arrays.deepToString': STRING, 'Arrays.equals': BOOL, 'System.currentTimeMillis': LONG, 'System.nanoTime': LONG,
  'Math.abs': null,
};
class StopCheck { }
class Scope {
  constructor(parent) { this.parent = parent; this.vars = new Map(); }
  get(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s.vars.get(n); return undefined; }
  declare(n, t, line, ch) { if (this.get(n) !== undefined) ch.err(line, `Variable '${n}' ist hier bereits definiert`); this.vars.set(n, t === undefined ? null : t); }
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

global.JavaRT = { Runtime, Parser, lex, JavaError, JObject, JArray, JDouble, JChar, JClassRef, Env, typeStr, fmtDouble, quickInfo, T };
})(typeof window !== 'undefined' ? window : globalThis);
