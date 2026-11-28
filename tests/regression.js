// Regressionstest für den Interpreter (Node.js, ohne Browser):
//   node tests/regression.js            vergleicht mit tests/erwartet.txt (normaler und unterbrechbarer Lauf)
//   node tests/regression.js --update   schreibt tests/erwartet.txt neu (nur nach geprüften Änderungen!)
// Durchläuft alle Beispielprojekte und tests/programme.js: Objekte der Objektleiste erzeugen,
// statische Methoden und Methoden ohne Parameter aufrufen, Direkteingaben auswerten.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..');
let seed = 12345;
const ctx = { console, setTimeout, clearTimeout, setImmediate, performance, Date, Promise, MessageChannel, queueMicrotask };
ctx.Math = Object.create(Math); ctx.Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['interp.js', 'aplu.js', 'swing.js', 'examples.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const R = ctx.JavaRT;
const log = [];
const gfx = { n: 1, newWindow(o) { log.push('WIN ' + JSON.stringify(o)); return this.n++; }, op(w, o) { log.push('OP ' + w + ' ' + JSON.stringify(o)); }, input() { return '7'; }, message(t) { log.push('MSG ' + t); }, lastLine() { return ''; }, busy() { return false; }, whenIdle(cb) { cb(); } };
const rt = new R.Runtime({ out: (s, e) => log.push((e ? 'ERR ' : 'OUT ') + s), gfx });
const progs = [...ctx.WB_EXAMPLES, ...require('./programme.js')];
let mode = 'sync';
async function call(fn, gfn) {
  if (mode === 'async') return await rt.runAsync(gfn);
  return rt.run(fn);
}
function show(r) { const c = { ...r }; if (c.value !== undefined) c.value = rt.isRef(c.value) ? '<' + rt.typeNameOf(c.value) + '>' : rt.displayValue(c.value); return JSON.stringify(c); }
async function runAll() {
  log.length = 0;
  for (const p of progs) {
    seed = 12345;
    log.push('=== ' + p.name);
    const res = rt.compile(p.classes.map((c, i) => ({ id: 'f' + i, code: c.code, pkg: c.pkg })));
    log.push('compile ' + JSON.stringify(res));
    if (!res.ok) continue;
    const env = new R.Env(null);
    const bench = [];
    for (const b of p.bench || []) {
      const r = mode === 'async' ? await rt.evalSnippetAsync(b.expr, env) : rt.evalSnippet(b.expr, env);
      log.push('bench ' + b.name + ' ' + show(r));
      if (r.ok) { env.declare(b.name, rt.typeOfValue(r.value), r.value); bench.push(r.value); }
    }
    for (const c of p.classes) {
      const d = rt.describeClass(c.name); if (!d) continue;
      for (const s of d.statics) {
        const m = s.m; let args;
        if (!m.params.length) args = []; else if (m.params.length === 1 && m.params[0].type.dims === 1 && m.params[0].type.name === 'String') args = [new R.JArray(R.T('String'), [])]; else continue;
        log.push('call ' + c.name + '.' + m.name);
        log.push(show(await call(() => rt.callMethod(null, m, args), () => rt.callMethodG(null, m, args))));
      }
    }
    for (const o of bench) {
      for (const g of rt.describeObject(o)) for (const mm of g.methods) {
        const m = mm.m; if (m.params.length) {
          if (m.params.every(p => ['int', 'double'].includes(p.type.name) && !p.type.dims)) {
            const args = m.params.map(p => p.type.name === 'int' ? 3 : new R.JDouble(2.5));
            log.push('call obj.' + m.name + '(3/2.5)');
            log.push(show(await call(() => rt.callMethod(o, m, args), () => rt.callMethodG(o, m, args))));
          }
          continue;
        }
        log.push('call obj.' + m.name);
        log.push(show(await call(() => rt.callMethod(o, m, []), () => rt.callMethodG(o, m, []))));
      }
      log.push('str ' + JSON.stringify(rt.run(() => rt.str(o))));
    }
    for (const snip of ['1 + 2 * 3', 'int q = 5; q * q', '"a".length() + Math.abs(-3)', 'new java.util.ArrayList<String>()', 'for (int i = 0; i < 3; i++) System.out.print(i);']) {
      const r = mode === 'async' ? await rt.evalSnippetAsync(snip, env) : rt.evalSnippet(snip, env);
      log.push('snip ' + snip + ' ' + show(r));
    }
  }
  return log.join('\n') + '\n';
}
(async () => {
  // Jede Variante läuft in einem eigenen Prozess (gleiche Objekt-Nummern für toString)
  const raw = process.argv.indexOf('--raw');
  if (raw >= 0) { mode = process.argv[raw + 1]; process.stdout.write(await runAll()); return; }
  const { execFileSync } = require('child_process');
  const runMode = (m) => execFileSync(process.execPath, [__filename, '--raw', m], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const file = path.join(__dirname, 'erwartet.txt');
  const sync = runMode('sync'), asyn = runMode('async');
  if (process.argv.includes('--update')) { fs.writeFileSync(file, sync); console.log('erwartet.txt neu geschrieben'); return; }
  // Im unterbrechbaren Lauf warten Turtle.sleep/delay wirklich, statt einen Grafikbefehl aufzuzeichnen
  const noSleep = (t) => t.split('\n').filter(l => !/^OP 0 \{"t":"sleep"/.test(l)).join('\n');
  const exp = fs.readFileSync(file, 'utf8');
  let bad = 0;
  const cmp = (name, got, want) => {
    if (got === want) { console.log(name + ': OK'); return; }
    bad++; const g = got.split('\n'), w = want.split('\n');
    const i = g.findIndex((l, k) => l !== w[k]);
    console.log(name + `: ABWEICHUNG ab Zeile ${i + 1}\n  erwartet: ${w[i]}\n  erhalten: ${g[i]}`);
  };
  cmp('Normaler Lauf', sync, exp);
  cmp('Unterbrechbarer Lauf', noSleep(asyn), noSleep(exp));
  process.exit(bad ? 1 : 0);
})();
