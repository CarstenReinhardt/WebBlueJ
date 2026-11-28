/* Java-Werkbank – Hilfsfunktionen für den Editor (ohne Oberfläche):
   Bereiche für die Bereichsfärbung, Klammerpaare, automatisches Einrücken, Kommentieren. */
(function (root) {
'use strict';

// Für jedes Zeichen: 0 = Programmtext, 1 = Kommentar, 2 = String- oder char-Literal.
function codeMask(src) {
  const n = src.length, m = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') m[i++] = 1; }
    else if (c === '/' && d === '*') {
      m[i] = m[i + 1] = 1; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) m[i++] = 1;
      if (i < n) { m[i] = 1; if (i + 1 < n) m[i + 1] = 1; i += 2; }
    } else if (c === '"' && d === '"' && src[i + 2] === '"') {
      m[i] = m[i + 1] = m[i + 2] = 2; i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) { if (src[i] === '\\' && i + 1 < n) m[i++] = 2; m[i++] = 2; }
      for (let k = 0; k < 3 && i < n; k++) m[i++] = 2;
    } else if (c === '"' || c === "'") {
      m[i++] = 2;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') m[i++] = 2; m[i++] = 2; }
      if (i < n && src[i] === c) m[i++] = 2;
    } else i++;
  }
  return m;
}

function lineStarts(src) { const r = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') r.push(i + 1); return r; }
function lineOf(starts, pos) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; }
// Sichtbare Spalte (Tabulator = 4 Spalten) des Zeichens an Position idx innerhalb der Zeile.
function visCol(line, idx, tab = 4) { let c = 0; for (let i = 0; i < idx && i < line.length; i++) c = line[i] === '\t' ? c + tab - (c % tab) : c + 1; return c; }
function indentCols(line, tab = 4) { let c = 0; for (const ch of line) { if (ch === ' ') c++; else if (ch === '\t') c += tab - (c % tab); else break; } return c; }

function classify(header, parentKind) {
  const h = header.trim();
  if (/=\s*$/.test(h) || /\bnew\s+[\w.$<>\s,]+\[\s*\]\s*$/.test(h) || /\]\s*$/.test(h)) return 'init';
  if (/\b(class|interface|enum|record)\b/.test(h)) return 'class';
  if (/\bnew\s+[\w.$<>]+\s*(<[^>]*>)?\s*\([\s\S]*\)\s*$/.test(h)) return 'class';
  if (/^(for|while|do)\b/.test(h)) return 'loop';
  if (/^(if|else|switch|try|catch|finally|synchronized)\b/.test(h)) return 'cond';
  if (parentKind === 'class') return 'method';
  return 'block';
}

// Liefert die Blöcke { … } mit Art (class, method, loop, cond, block, init), Kopfzeile, Endzeile und Einrückung.
function scopes(src, mask) {
  mask = mask || codeMask(src);
  const starts = lineStarts(src), lines = src.split('\n');
  const res = [], stack = [];
  let stmtStart = 0, paren = 0; // Beginn der aktuellen Anweisung (nach ; { } ), Klammertiefe ( )
  for (let i = 0; i < src.length; i++) {
    if (mask[i]) continue;
    const ch = src[i];
    if (ch === '{') {
      let hs = stmtStart; while (hs < i && (mask[hs] || /\s/.test(src[hs]))) hs++;
      let header = ''; for (let k = hs; k < i; k++) if (!mask[k]) header += src[k];
      const parent = stack[stack.length - 1];
      const kind = classify(header, parent ? parent.kind : null);
      const startLine = lineOf(starts, hs);
      stack.push({ kind, startLine, col: indentCols(lines[startLine]), open: i, depth: stack.length });
      stmtStart = i + 1; paren = 0;
    } else if (ch === '}') {
      const s = stack.pop();
      if (s) { s.endLine = lineOf(starts, i); s.close = i; res.push(s); }
      stmtStart = i + 1; paren = 0;
    } else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === ';' && !paren) stmtStart = i + 1;
  }
  // nicht geschlossene Blöcke laufen bis zum Ende
  while (stack.length) { const s = stack.pop(); s.endLine = lines.length - 1; s.close = -1; res.push(s); }
  res.sort((a, b) => a.open - b.open);
  return res;
}

const PAIRS = { '(': ')', '[': ']', '{': '}' }, CLOSE = { ')': '(', ']': '[', '}': '{' };
function findMatch(src, mask, at) {
  const ch = src[at];
  if (mask[at]) return -1;
  if (PAIRS[ch]) {
    const cl = PAIRS[ch]; let d = 0;
    for (let i = at; i < src.length; i++) { if (mask[i]) continue; if (src[i] === ch) d++; else if (src[i] === cl && --d === 0) return i; }
  } else if (CLOSE[ch]) {
    const op = CLOSE[ch]; let d = 0;
    for (let i = at; i >= 0; i--) { if (mask[i]) continue; if (src[i] === ch) d++; else if (src[i] === op && --d === 0) return i; }
  }
  return -1;
}
// Klammer direkt vor oder hinter dem Cursor und ihr Gegenstück: { a, b } (b = -1: kein Gegenstück) oder null.
function bracketAt(src, mask, caret) {
  for (const at of [caret - 1, caret]) {
    if (at < 0 || at >= src.length || mask[at]) continue;
    const ch = src[at];
    if (PAIRS[ch] || CLOSE[ch]) return { a: at, b: findMatch(src, mask, at) };
  }
  return null;
}
function unbalancedBraces(src, mask) { let d = 0; for (let i = 0; i < src.length; i++) if (!mask[i]) { if (src[i] === '{') d++; else if (src[i] === '}') d--; } return d; }

// Rückt den ganzen Quelltext nach der Klammerstruktur neu ein (wie „Auto-Layout“ in BlueJ).
function reindent(src, unit) {
  unit = unit || '    ';
  const mask = codeMask(src);
  const lines = src.split('\n');
  const stack = []; // { isSwitch, inCase }
  let paren = 0, prevEnd = '', prevAnno = false, stmt = '';
  const out = [];
  let pos = 0;
  for (const raw of lines) {
    const lead = raw.length - raw.replace(/^[ \t]+/, '').length;
    const body = raw.slice(lead).replace(/[ \t]+$/, '');
    const first = pos + lead;
    let depth = 0; for (const f of stack) depth += 1 + (f.inCase ? 1 : 0);
    if (!body) { out.push(''); pos += raw.length + 1; continue; }
    const inBlockComment = mask[first] === 1 && !body.startsWith('//') && !body.startsWith('/*');
    if (inBlockComment) {
      out.push(unit.repeat(depth) + (body.startsWith('*') ? ' ' : '') + body);
      pos += raw.length + 1; continue;
    }
    // führende schließende Klammern
    let lineDepth = depth, k = 0, st = stack.length;
    while (k < body.length && (body[k] === '}' || body[k] === ')' || body[k] === ' ') && !mask[first + k]) {
      if (body[k] === '}' && st > 0) { st--; lineDepth -= 1 + (stack[st].inCase ? 1 : 0); }
      k++;
    }
    const top = stack[stack.length - 1];
    const isCase = top && top.isSwitch && /^(case\b|default\b\s*[:\-])/.test(body);
    if (isCase && top.inCase) lineDepth--;
    const startsComment = body.startsWith('//') || body.startsWith('/*');
    const cont = !startsComment && !isCase && body[0] !== '{' && body[0] !== '}' &&
      (paren > 0 || (prevEnd && !';{}:,'.includes(prevEnd) && !prevAnno));
    if (cont) lineDepth++;
    out.push(unit.repeat(Math.max(0, lineDepth)) + body);
    // Zeile auswerten
    let lastCode = '';
    for (let i = 0; i < body.length; i++) {
      const p = first + i; if (mask[p]) continue;
      const ch = body[i];
      if (ch === '{') { stack.push({ isSwitch: /\bswitch\b/.test(stmt), inCase: false }); stmt = ''; }
      else if (ch === '}') { stack.pop(); stmt = ''; }
      else if (ch === ';') stmt = '';
      else stmt += ch;
      if (ch === '(') paren++; else if (ch === ')') paren = Math.max(0, paren - 1);
      if (!/\s/.test(ch)) lastCode = ch;
    }
    if (isCase && top) top.inCase = true;
    if (lastCode) { prevEnd = lastCode; prevAnno = /^@\w+(\(.*\))?$/.test(body.replace(/\/\/.*$/, '').trim()); }
    pos += raw.length + 1;
  }
  return out.join('\n');
}

// Zeilen ein- oder auskommentieren. lines: Array von Zeilen; Rückgabe: neue Zeilen.
function toggleComment(lines) {
  const used = lines.filter(l => l.trim());
  if (!used.length) return lines;
  const all = used.every(l => /^\s*\/\//.test(l));
  if (all) return lines.map(l => l.replace(/^(\s*)\/\/ ?/, '$1'));
  const minInd = Math.min(...used.map(l => l.length - l.replace(/^[ \t]+/, '').length));
  return lines.map(l => l.trim() ? l.slice(0, minInd) + '// ' + l.slice(minInd) : l);
}

root.WBEd = { codeMask, lineStarts, lineOf, visCol, indentCols, scopes, bracketAt, findMatch, unbalancedBraces, reindent, toggleComment };
})(typeof window !== 'undefined' ? window : globalThis);
