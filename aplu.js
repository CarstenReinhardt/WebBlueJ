/* Java-Werkbank – Nachbildung der Bibliotheken ch.aplu.turtle und ch.aplu.util
   sowie java.awt.Color/Font und java.util.Scanner (Eingabe über Dialoge). */
(function (global) {
'use strict';
const R = global.JavaRT;
const { JObject, JArray, JDouble, JChar, T } = R;
const INT = T('int'), DOUBLE = T('double'), BOOL = T('boolean'), STRING = T('String'), VOID = T('void');
const NOGFX = { win: 1, newWindow() { return this.win++; }, op() { }, input() { return null; }, message() { }, lastLine() { return ''; } };

// Listener-Interfaces und Adapter wie in java.awt.event und ch.aplu.turtle (als Java-Quelltext,
// damit „implements MouseListener“ wie in echtem Java geprüft wird)
R.Runtime.preludes.push({ pkg: 'java.awt.event', code: `
public interface MouseListener { void mouseClicked(MouseEvent e); void mousePressed(MouseEvent e); void mouseReleased(MouseEvent e); void mouseEntered(MouseEvent e); void mouseExited(MouseEvent e); }
public interface MouseMotionListener { void mouseDragged(MouseEvent e); void mouseMoved(MouseEvent e); }
public interface KeyListener { void keyPressed(KeyEvent e); void keyReleased(KeyEvent e); void keyTyped(KeyEvent e); }
public abstract class MouseAdapter implements MouseListener, MouseMotionListener {
  public void mouseClicked(MouseEvent e) { } public void mousePressed(MouseEvent e) { } public void mouseReleased(MouseEvent e) { }
  public void mouseEntered(MouseEvent e) { } public void mouseExited(MouseEvent e) { } public void mouseDragged(MouseEvent e) { } public void mouseMoved(MouseEvent e) { }
}
public abstract class MouseMotionAdapter implements MouseMotionListener { public void mouseDragged(MouseEvent e) { } public void mouseMoved(MouseEvent e) { } }
public abstract class KeyAdapter implements KeyListener { public void keyPressed(KeyEvent e) { } public void keyReleased(KeyEvent e) { } public void keyTyped(KeyEvent e) { } }
` }, { pkg: 'ch.aplu.turtle', code: `
public interface MouseHitListener { void mouseHit(double x, double y); }
public interface MouseHitXListener { void mouseHitX(double x, double y); }
public interface TurtleHitListener { void turtleHit(Turtle t, double x, double y); }
public interface MouseDoubleClickListener { void notifyClick(MouseEvent e); void notifyDoubleClick(MouseEvent e); }
public interface ExitListener { void notifyExit(); }
` });

R.Runtime.extensions.push(function (rt) {
  const def = (name, spec) => rt._def(name, { lib: true, ...spec });
  const gfx = () => rt.io.gfx || NOGFX;
  const D = (x) => new JDouble(x);
  const num = (v) => rt.num(v);
  const int = (v) => Math.trunc(rt.num(v));
  const str = (v) => rt.str(v);
  const unsupported = (cls, name) => () => rt.rtError(`${cls}.${name}() wird in der Web-Version nicht unterstützt`);
  const noop = () => undefined;

  // ------------------------------------------------------------ Farben
  const NAMED = { black: [0, 0, 0], blue: [0, 0, 255], cyan: [0, 255, 255], darkGray: [64, 64, 64], gray: [128, 128, 128], green: [0, 255, 0], lightGray: [192, 192, 192], magenta: [255, 0, 255], orange: [255, 200, 0], pink: [255, 175, 175], red: [255, 0, 0], white: [255, 255, 255], yellow: [255, 255, 0] };
  const colorObj = (r, g, b, a = 255) => { const o = new JObject(rt.cls('Color')); o.native = { r, g, b, a }; return o; };
  const css = (c) => c.a === 255 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  // Farbe aus Color-Objekt oder X11/CSS-Namen
  function toColor(v, line) {
    if (v instanceof JObject && v.native && v.native.r !== undefined) return { css: css(v.native), obj: v };
    if (typeof v === 'string') {
      const key = v.replace(/\s+/g, '').toLowerCase();
      const hit = Object.keys(NAMED).find(k => k.toLowerCase() === key);
      return { css: key, obj: hit ? colorObj(...NAMED[hit]) : null, name: v };
    }
    if (v === null) rt.npe('Farbe ist null');
    rt.rtError('Farbe erwartet (z. B. Color.red oder "red")', line);
  }
  const sf = {}; const sfT = {};
  for (const [k, c] of Object.entries(NAMED)) {
    const o = colorObj(...c); sf[k] = o; sf[k.replace(/([A-Z])/g, '_$1').toUpperCase()] = o;
  }
  for (const k of Object.keys(sf)) sfT[k] = T('Color');
  def('Color', { pkg: 'java.awt', sfields: sf, sfieldTypes: sfT,
    ctor(rt, a, line) {
      if (a.length === 1) { const x = int(a[0]); return colorObj((x >> 16) & 255, (x >> 8) & 255, x & 255); }
      if (a.length < 3) rt.rtError('new Color(rot, grün, blau) erwartet', line);
      const isF = a.slice(0, 3).some(x => x instanceof JDouble);
      const f = (v) => isF ? clamp(num(v) * 255) : int(v);
      for (const v of a) { const x = num(v); if (x < 0 || x > (isF ? 1 : 255)) rt.throwJava('IllegalArgumentException', 'Color parameter outside of expected range'); }
      return colorObj(f(a[0]), f(a[1]), f(a[2]), a[3] !== undefined ? f(a[3]) : 255);
    },
    methods: {
      getRed(rt, o) { return o.native.r; }, getGreen(rt, o) { return o.native.g; }, getBlue(rt, o) { return o.native.b; }, getAlpha(rt, o) { return o.native.a; },
      getRGB(rt, o) { const c = o.native; return ((c.a << 24) | (c.r << 16) | (c.g << 8) | c.b) | 0; },
      brighter(rt, o) { const c = o.native; return colorObj(clamp(Math.max(c.r, 3) / 0.7), clamp(Math.max(c.g, 3) / 0.7), clamp(Math.max(c.b, 3) / 0.7), c.a); },
      darker(rt, o) { const c = o.native; return colorObj(clamp(c.r * 0.7), clamp(c.g * 0.7), clamp(c.b * 0.7), c.a); },
      equals(rt, o, a) { const x = a[0]; return x instanceof JObject && !!x.native && x.native.r === o.native.r && x.native.g === o.native.g && x.native.b === o.native.b && x.native.a === o.native.a; },
      hashCode(rt, o) { return this.getRGB(rt, o); },
    },
    retTypes: { getRed: INT, getGreen: INT, getBlue: INT, getAlpha: INT, getRGB: INT, brighter: T('Color'), darker: T('Color'), equals: BOOL },
    toString(rt, o) { const c = o.native; return `java.awt.Color[r=${c.r},g=${c.g},b=${c.b}]`; },
    inspectRows: undefined,
    ui: [{ name: 'getRed', params: [], ret: INT }, { name: 'getGreen', params: [], ret: INT }, { name: 'getBlue', params: [], ret: INT }],
  });
  for (const o of Object.values(sf)) o.cls = rt.cls('Color');
  def('Font', { pkg: 'java.awt', sfields: { PLAIN: 0, BOLD: 1, ITALIC: 2 }, sfieldTypes: { PLAIN: INT, BOLD: INT, ITALIC: INT },
    ctor(rt, a) { const o = new JObject(rt.cls('Font')); o.native = { family: a.length ? str(a[0]) : 'SansSerif', style: a.length > 1 ? int(a[1]) : 0, size: a.length > 2 ? int(a[2]) : 12 }; return o; },
    methods: { getSize(rt, o) { return o.native.size; }, getName(rt, o) { return o.native.family; }, getStyle(rt, o) { return o.native.style; } },
    toString(rt, o) { return `java.awt.Font[family=${o.native.family},style=${o.native.style},size=${o.native.size}]`; },
  });
  const fontCss = (f) => `${f.style & 2 ? 'italic ' : ''}${f.style & 1 ? 'bold ' : ''}${f.size}px ${/^(serif)$/i.test(f.family) ? 'Georgia, serif' : /mono/i.test(f.family) ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;

  // ------------------------------------------------------------ Eingabe
  function ask(promptText, title) {
    const g = gfx();
    const t0 = Date.now();
    const r = g.input(promptText, title);
    if (r === null || r === undefined) {
      if (Date.now() - t0 < 40 && g.inputBlocked && g.inputBlocked()) rt.rtError('Eingabedialoge funktionieren in dieser Vorschau nicht. Öffne die App über die GitHub-Seite, dann klappt die Eingabe.');
      rt.rtError('Eingabe abgebrochen');
    }
    return String(r);
  }
  function askInt(p, title) {
    let msg = p;
    for (let i = 0; i < 6; i++) { const s = ask(msg, title).trim(); if (/^[+-]?\d+$/.test(s) && Math.abs(+s) <= 2147483647) return +s; msg = `Bitte eine ganze Zahl eingeben.\n${p}`; }
    rt.throwJava('InputMismatchException', 'Keine ganze Zahl eingegeben');
  }
  function askDouble(p, title) {
    let msg = p;
    for (let i = 0; i < 6; i++) { const s = ask(msg, title).trim().replace(',', '.'); if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return D(parseFloat(s)); msg = `Bitte eine Zahl eingeben (z. B. 3.5).\n${p}`; }
    rt.throwJava('InputMismatchException', 'Keine Zahl eingegeben');
  }
  function askBool(p, title) {
    let msg = p;
    for (let i = 0; i < 6; i++) { const s = ask(msg, title).trim().toLowerCase(); if (['true', 'ja', 'j', 'yes', 'y'].includes(s)) return true; if (['false', 'nein', 'n', 'no'].includes(s)) return false; msg = `Bitte true oder false eingeben.\n${p}`; }
    rt.throwJava('InputMismatchException', 'Kein Wahrheitswert eingegeben');
  }

  // ------------------------------------------------------------ Projektdateien (Bilder, Klänge)
  const asset = (name) => (rt.io.assets ? rt.io.assets(name) : null);
  function needAsset(name, kind, line) {
    const a = asset(name);
    if (a && a.kind === kind) return a;
    rt.rtError(`${kind === 'image' ? 'Bild' : 'Klang'} „${name}“ nicht gefunden. Füge die Datei über „Projekt ▾ → Bilder und Klänge …“ zum Projekt hinzu.`, line);
  }
  const isImageName = (s) => typeof s === 'string' && (/\.(png|gif|jpe?g|bmp|webp|svg)$/i.test(s) || !!(asset(s) && asset(s).kind === 'image'));

  // ------------------------------------------------------------ Töne
  // Der Ton wird wie ein Zeichenbefehl abgespielt, also passend zur Animation.
  function tone(freq, ms, vol, blocking, value) {
    push(0, { t: 'tone', freq: num(freq), ms: Math.max(0, num(ms)), vol: vol });
    return blocking ? rt.sleep(num(ms), value) : value;
  }

  // ------------------------------------------------------------ Maus- und Tastaturereignisse
  // Jedes Grafikfenster hat einen Zustand: letzte Taste (für kbhit/getKey) und Listener.
  const KEYNAMES = { 8: 'Backspace', 9: 'Tab', 10: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 20: 'Caps Lock', 27: 'Escape', 32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 127: 'Delete', 155: 'Insert' };
  const evs = new Map();
  function winState(win, src) {
    let s = evs.get(win);
    if (!s) {
      s = { win, got: false, ch: 65535, code: 65535, mods: 0, waiters: [], src: src || null, pg: null, dblTimer: 0, L: { mouse: [], motion: [], key: [], hit: [], hitX: [], turtleHit: [], dbl: [], exit: [] } };
      evs.set(win, s);
      const g = gfx(); if (g.listen) g.listen(win, (ev) => onWinEvent(s, ev));
    }
    if (src && !s.src) s.src = src;
    return s;
  }
  const modMask = (ev) => (ev.shift ? 1 : 0) | (ev.ctrl ? 2 : 0) | (ev.meta ? 4 : 0) | (ev.alt ? 8 : 0);
  function mouseEvent(s, ev) { const o = new JObject(rt.cls('MouseEvent')); o.native = { x: ev.x, y: ev.y, button: ev.button || 0, clicks: ev.clicks || 0, mods: modMask(ev), src: s.src, when: Date.now() }; return o; }
  function keyEvent(s, ev, typed) { const o = new JObject(rt.cls('KeyEvent')); o.native = { code: typed ? 0 : ev.code, ch: ev.ch, mods: modMask(ev), src: s.src, when: Date.now() }; return o; }
  const fire = (list, name, args) => { for (const l of list.slice()) rt.fireEvent(l, name, args); };
  function onWinEvent(s, ev) {
    const L = s.L;
    switch (ev.type) {
      case 'keydown': {
        s.got = true; s.ch = ev.ch; s.code = ev.code; s.mods = modMask(ev);
        const ws = s.waiters.splice(0); for (const f of ws) f();
        if (L.key.length) fire(L.key, 'keyPressed', [keyEvent(s, ev)]);
        return;
      }
      case 'keyup': if (L.key.length) fire(L.key, 'keyReleased', [keyEvent(s, ev)]); return;
      case 'typed': if (L.key.length) fire(L.key, 'keyTyped', [keyEvent(s, ev, true)]); return;
      case 'press': {
        if (L.mouse.length) fire(L.mouse, 'mousePressed', [mouseEvent(s, ev)]);
        if (s.pg && ev.button === 1) {
          const pg = s.pg, tx = D(ev.x - pg.w / 2), ty = D(pg.h / 2 - ev.y);
          if (L.hit.length) fire(L.hit, 'mouseHit', [tx, ty]);
          if (L.hitX.length) fire(L.hitX, 'mouseHitX', [tx, ty]);
          if (L.turtleHit.length) {
            const hitT = pg.turtles.filter(t => !t.hidden && t.obj && Math.hypot(t.x - tx.v, t.y - ty.v) <= 14);
            for (const t of hitT) fire(L.turtleHit, 'turtleHit', [t.obj, tx, ty]);
          }
        }
        return;
      }
      case 'release': if (L.mouse.length) fire(L.mouse, 'mouseReleased', [mouseEvent(s, ev)]); return;
      case 'click':
        if (L.mouse.length) fire(L.mouse, 'mouseClicked', [mouseEvent(s, ev)]);
        if (L.dbl.length && ev.clicks === 1) { clearTimeout(s.dblTimer); const me = mouseEvent(s, ev); s.dblTimer = setTimeout(() => fire(L.dbl, 'notifyClick', [me]), 260); }
        return;
      case 'dblclick': if (L.dbl.length) { clearTimeout(s.dblTimer); fire(L.dbl, 'notifyDoubleClick', [mouseEvent(s, ev)]); } return;
      case 'move': if (L.motion.length) fire(L.motion, 'mouseMoved', [mouseEvent(s, ev)]); return;
      case 'drag': if (L.motion.length) fire(L.motion, 'mouseDragged', [mouseEvent(s, ev)]); return;
      case 'enter': if (L.mouse.length) fire(L.mouse, 'mouseEntered', [mouseEvent(s, ev)]); return;
      case 'exit': if (L.mouse.length) fire(L.mouse, 'mouseExited', [mouseEvent(s, ev)]); return;
      case 'closing': if (L.exit.length) { fire(L.exit, 'notifyExit', []); return true; } return false;
      case 'closed': evs.delete(s.win); clearTimeout(s.dblTimer); { const ws = s.waiters.splice(0); for (const f of ws) f(); } return;
    }
  }
  const LISTENER = { mouse: 'MouseListener', motion: 'MouseMotionListener', key: 'KeyListener', hit: 'MouseHitListener', hitX: 'MouseHitXListener', turtleHit: 'TurtleHitListener', dbl: 'MouseDoubleClickListener', exit: 'ExitListener' };
  function addListener(s, kind, v, line) {
    const iface = rt.cls(LISTENER[kind]);
    if (v === null || v === undefined) rt.npe('Listener ist null');
    if (!(v instanceof JObject) || !v.cls.isSubclassOf(iface)) rt.rtError(`Hier wird ein Objekt erwartet, das ${LISTENER[kind]} implementiert (z. B. „implements ${LISTENER[kind]}“ und dann „this“ übergeben)`, line);
    if (!s.L[kind].includes(v)) s.L[kind].push(v);
  }
  // getKey()/getKeyCode(): letzte Taste abholen (65535, wenn seit dem letzten Abholen keine gedrückt wurde)
  const takeKey = (s) => { if (!s.got) return new JChar(65535); s.got = false; return new JChar(s.ch); };
  const takeCode = (s) => { if (!s.got) return 65535; s.got = false; return s.code; };
  // ...Wait(): auf die nächste Taste warten (das Programm pausiert, die Oberfläche bleibt bedienbar)
  const waitKey = (s, take) => new R.Suspend(
    () => rt.whenGfxIdle().then(() => new Promise((res) => { s.got = false; s.waiters.push(res); })).then(() => take(s)),
    () => rt.rtError('Hier kann nicht auf eine Taste gewartet werden (das geht nur in einem normal gestarteten Programm)'));
  const keyMethods = (S) => ({
    kbhit(rt, o) { return S(o).got; },
    getKey(rt, o) { return takeKey(S(o)); }, getKeyInt(rt, o) { return takeKey(S(o)).c; }, getKeyCode(rt, o) { return takeCode(S(o)); },
    getKeyWait(rt, o) { return waitKey(S(o), takeKey); }, getKeyWaitInt(rt, o) { return waitKey(S(o), (s) => takeKey(s).c); }, getKeyCodeWait(rt, o) { return waitKey(S(o), takeCode); },
    getModifiers(rt, o) { return S(o).mods; },
    getModifiersText(rt, o) { const m = S(o).mods; return [m & 1 ? 'Shift' : '', m & 2 ? 'Ctrl' : '', m & 4 ? 'Meta' : '', m & 8 ? 'Alt' : ''].filter(Boolean).join('+'); },
  });
  const keyRet = { kbhit: BOOL, getKey: T('char'), getKeyInt: INT, getKeyCode: INT, getKeyWait: T('char'), getKeyWaitInt: INT, getKeyCodeWait: INT, getModifiers: INT, getModifiersText: STRING };
  const listenerMethods = (S, kinds) => {
    const m = {};
    const names = { mouse: 'addMouseListener', motion: 'addMouseMotionListener', key: 'addKeyListener', hit: 'addMouseHitListener', hitX: 'addMouseHitXListener', turtleHit: 'addTurtleHitListener', dbl: 'addMouseDoubleClickListener', exit: 'addExitListener' };
    for (const k of kinds) m[names[k]] = (rt, o, a, line) => { addListener(S(o), k, a[0], line); };
    return m;
  };

  // MouseEvent / KeyEvent (java.awt.event)
  const inputMethods = {
    getModifiers(rt, o) { return o.native.mods; }, getModifiersEx(rt, o) { const m = o.native.mods; return (m & 1 ? 64 : 0) | (m & 2 ? 128 : 0) | (m & 4 ? 256 : 0) | (m & 8 ? 512 : 0); },
    isShiftDown(rt, o) { return !!(o.native.mods & 1); }, isControlDown(rt, o) { return !!(o.native.mods & 2); }, isMetaDown(rt, o) { return !!(o.native.mods & 4); }, isAltDown(rt, o) { return !!(o.native.mods & 8); },
    getWhen(rt, o) { return BigInt(o.native.when); }, getSource(rt, o) { return o.native.src; }, consume() { }, isConsumed() { return false; },
  };
  const inputRet = { getModifiers: INT, getModifiersEx: INT, isShiftDown: BOOL, isControlDown: BOOL, isMetaDown: BOOL, isAltDown: BOOL, getWhen: T('long'), getSource: T('Object'), isConsumed: BOOL };
  const maskF = { SHIFT_MASK: 1, CTRL_MASK: 2, META_MASK: 4, ALT_MASK: 8, SHIFT_DOWN_MASK: 64, CTRL_DOWN_MASK: 128, META_DOWN_MASK: 256, ALT_DOWN_MASK: 512, BUTTON1_DOWN_MASK: 1024, BUTTON2_DOWN_MASK: 2048, BUTTON3_DOWN_MASK: 4096 };
  const mouseF = { ...maskF, NOBUTTON: 0, BUTTON1: 1, BUTTON2: 2, BUTTON3: 3, MOUSE_CLICKED: 500, MOUSE_PRESSED: 501, MOUSE_RELEASED: 502, MOUSE_MOVED: 503, MOUSE_ENTERED: 504, MOUSE_EXITED: 505, MOUSE_DRAGGED: 506 };
  const intTypes = (o) => { const t = {}; for (const k of Object.keys(o)) t[k] = INT; return t; };
  def('MouseEvent', { pkg: 'java.awt.event', sfields: mouseF, sfieldTypes: intTypes(mouseF),
    methods: { ...inputMethods, getX(rt, o) { return o.native.x; }, getY(rt, o) { return o.native.y; }, getButton(rt, o) { return o.native.button; }, getClickCount(rt, o) { return o.native.clicks; }, isPopupTrigger(rt, o) { return o.native.button === 3; } },
    retTypes: { ...inputRet, getX: INT, getY: INT, getButton: INT, getClickCount: INT, isPopupTrigger: BOOL },
    toString(rt, o) { return `java.awt.event.MouseEvent[x=${o.native.x},y=${o.native.y},button=${o.native.button},clickCount=${o.native.clicks}]`; } });
  const VK = { VK_ENTER: 10, VK_BACK_SPACE: 8, VK_TAB: 9, VK_SHIFT: 16, VK_CONTROL: 17, VK_ALT: 18, VK_PAUSE: 19, VK_CAPS_LOCK: 20, VK_ESCAPE: 27, VK_SPACE: 32, VK_PAGE_UP: 33, VK_PAGE_DOWN: 34, VK_END: 35, VK_HOME: 36, VK_LEFT: 37, VK_UP: 38, VK_RIGHT: 39, VK_DOWN: 40, VK_COMMA: 44, VK_MINUS: 45, VK_PERIOD: 46, VK_SLASH: 47, VK_SEMICOLON: 59, VK_EQUALS: 61, VK_DELETE: 127, VK_INSERT: 155, VK_PLUS: 521, VK_UNDEFINED: 0 };
  for (let i = 0; i < 10; i++) VK['VK_' + i] = 48 + i;
  for (let i = 0; i < 26; i++) VK['VK_' + String.fromCharCode(65 + i)] = 65 + i;
  for (let i = 1; i <= 12; i++) VK['VK_F' + i] = 111 + i;
  for (let i = 0; i < 10; i++) VK['VK_NUMPAD' + i] = 96 + i;
  def('KeyEvent', { pkg: 'java.awt.event', sfields: { ...VK, ...maskF, CHAR_UNDEFINED: new JChar(65535), KEY_PRESSED: 401, KEY_RELEASED: 402, KEY_TYPED: 400 }, sfieldTypes: { ...intTypes(VK), ...intTypes(maskF), CHAR_UNDEFINED: T('char'), KEY_PRESSED: INT, KEY_RELEASED: INT, KEY_TYPED: INT },
    methods: { ...inputMethods, getKeyCode(rt, o) { return o.native.code; }, getKeyChar(rt, o) { return new JChar(o.native.ch); }, isActionKey(rt, o) { return o.native.ch === 65535; } },
    retTypes: { ...inputRet, getKeyCode: INT, getKeyChar: T('char'), isActionKey: BOOL },
    statics: { getKeyText(rt, a) { const c = int(a[0]); if (KEYNAMES[c]) return KEYNAMES[c]; if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) return String.fromCharCode(c); if (c >= 112 && c <= 123) return 'F' + (c - 111); return 'Unknown keyCode: 0x' + c.toString(16); } },
    staticRet: { getKeyText: STRING },
    toString(rt, o) { return `java.awt.event.KeyEvent[keyCode=${o.native.code},keyChar='${o.native.ch === 65535 ? 'Undefined keyChar' : String.fromCharCode(o.native.ch)}']`; } });
  rt._def('InputEvent', { lib: true, pkg: 'java.awt.event', sfields: maskF, sfieldTypes: intTypes(maskF) });

  // Monitor.putSleep()/wakeUp(): Hauptprogramm schlafen legen, bis ein Ereignis es weckt (APLU)
  const sleepers = [];
  const monitorStatics = {
    putSleep() { return new R.Suspend(() => new Promise((res) => sleepers.push(res)), () => rt.rtError('Monitor.putSleep() kann hier nicht warten (das geht nur in einem normal gestarteten Programm)')); },
    wakeUp() { const ws = sleepers.splice(0); for (const f of ws) f(); },
  };

  // ------------------------------------------------------------ Turtle
  const TURTLE_COLORS = ['cyan', 'yellow', 'magenta', 'lime', 'orange', 'deeppink', 'deepskyblue', 'gold'];
  let pgCount = 0;
  function newPlayground(rt, opt = {}) {
    const pg = { w: opt.w || 400, h: opt.h || 400, bg: opt.bg || 'white', turtles: [], n: 0, frameObj: null };
    pg.win = gfx().newWindow({ kind: 'turtle', title: opt.title || 'Java Playground', w: pg.w, h: pg.h, bg: pg.bg });
    winState(pg.win).pg = pg;
    pgCount++;
    return pg;
  }
  // Das TurtleFrame-Objekt eines Turtle-Fensters (für getFrame() und MouseEvent.getSource())
  function frameOf(pg) {
    if (!pg.frameObj) { const f = new JObject(rt.cls('TurtleFrame')); f.native = { pg, frame: true }; pg.frameObj = f; }
    const s = winState(pg.win); if (!s.src) s.src = pg.frameObj;
    return pg.frameObj;
  }
  const P = (t, x, y) => ({ x: t.pg.w / 2 + x, y: t.pg.h / 2 - y });
  // Zeichenbefehl abgeben; hängt die Grafik hinterher, pausiert das Programm bald (live statt Aufzeichnung)
  const push = (win, op) => { const g = gfx(); g.op(win, op); if (g.busy && g.busy()) rt.yieldSoon(); };
  const emit = (t, op) => push(t.pg.win, op);
  function pose(t) { const p = P(t, t.x, t.y); emit(t, { t: 'pose', tid: t.id, x: p.x, y: p.y, h: t.h, color: t.color, hidden: t.hidden, ...(t.sprite ? { sprite: t.sprite } : {}) }); }
  function turtleState(rt, a, line) {
    let pg = null, colorArg = null;
    for (const v of a) {
      if (v instanceof JObject && v.native && v.native.pg) pg = v.native.pg;
      else if (v !== undefined) colorArg = v;
    }
    if (!pg) pg = newPlayground(rt);
    const id = (pg.win * 1000) + (++pg.n);
    // new Turtle("hase.gif"): Bild aus dem Projekt statt der Schildkröte (Sprite)
    let sprite = null;
    if (isImageName(colorArg)) { sprite = needAsset(colorArg, 'image', line).url; colorArg = null; }
    const c = colorArg !== null ? toColor(colorArg, line) : { css: TURTLE_COLORS[(pg.n - 1) % TURTLE_COLORS.length], obj: null };
    const t = { pg, id, sprite, x: 0, y: 0, h: 0, pen: true, erase: false, penColor: 'blue', penObj: sf.blue, color: c.css, colorObj: c.obj, width: 1, hidden: false, speed: 200, fillColor: null, fillObj: null, path: null, fan: null, states: [], font: { family: 'SansSerif', style: 0, size: 12 } };
    pg.turtles.push(t);
    return t;
  }
  function move(t, nx, ny, draw) {
    const a = P(t, t.x, t.y), b = P(t, nx, ny);
    if (t.fan) {
      const f = t.fan.kind === 'point' ? [P(t, t.fan.x, t.fan.y)] : t.fan.kind === 'h' ? [P(t, nx, t.fan.v), P(t, t.x, t.fan.v)] : [P(t, t.fan.v, ny), P(t, t.fan.v, t.y)];
      emit(t, { t: 'poly', pts: [a, b, ...f], fill: true, color: t.fillColor || t.penColor });
    }
    emit(t, { t: 'move', tid: t.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, h: t.h, pen: draw && t.pen, color: t.erase ? t.pg.bg : t.penColor, width: t.width, speed: t.speed, tcolor: t.color, hidden: t.hidden });
    t.x = nx; t.y = ny;
    if (t.path) t.path.push([nx, ny]);
  }
  function forward(t, d) { const r = t.h * Math.PI / 180; move(t, t.x + d * Math.sin(r), t.y + d * Math.cos(r), true); }
  function turn(t, a) { t.h = ((t.h + a) % 360 + 360) % 360; emit(t, { t: 'turn', tid: t.id, h: t.h, speed: t.speed }); }
  function arc(t, r, angle, left) {
    const n = Math.max(1, Math.ceil(Math.abs(angle) / 6)); const s = angle / n; const sgn = left ? -1 : 1;
    const chord = 2 * Math.abs(r) * Math.sin(Math.abs(s) * Math.PI / 360);
    for (let i = 0; i < n; i++) { t.h = ((t.h + sgn * s / 2) % 360 + 360) % 360; forward(t, chord * Math.sign(r || 1)); t.h = ((t.h + sgn * s / 2) % 360 + 360) % 360; }
    emit(t, { t: 'turn', tid: t.id, h: t.h, speed: Infinity });
  }
  const self = (o) => { if (!o.native || !o.native.pg) rt.rtError('Turtle wurde nicht richtig erzeugt'); return o.native; };
  const ret = (o) => o;
  const xy = (a, i = 0) => {
    if (a[i] instanceof JObject && a[i].native && a[i].native.pg) return [a[i].native.x, a[i].native.y];
    if (a[i] instanceof JObject && a[i].fields && 'x' in a[i].fields) return [num(a[i].fields.x), num(a[i].fields.y)];
    return [num(a[i]), num(a[i + 1])];
  };
  const tm = {
    forward(rt, o, a) { forward(self(o), num(a[0])); return ret(o); }, fd(rt, o, a) { return tm.forward(rt, o, a); },
    back(rt, o, a) { forward(self(o), -num(a[0])); return ret(o); }, bk(rt, o, a) { return tm.back(rt, o, a); },
    left(rt, o, a) { turn(self(o), -num(a[0])); return ret(o); }, lt(rt, o, a) { return tm.left(rt, o, a); },
    right(rt, o, a) { turn(self(o), num(a[0])); return ret(o); }, rt(rt, o, a) { return tm.right(rt, o, a); },
    penUp(rt, o) { self(o).pen = false; return ret(o); }, pu(rt, o) { return tm.penUp(rt, o); },
    penDown(rt, o) { const t = self(o); t.pen = true; t.erase = false; return ret(o); }, pd(rt, o) { return tm.penDown(rt, o); },
    penErase(rt, o) { const t = self(o); t.pen = true; t.erase = true; return ret(o); }, pe(rt, o) { return tm.penErase(rt, o); },
    isPenUp(rt, o) { return !self(o).pen; },
    hideTurtle(rt, o) { const t = self(o); t.hidden = true; pose(t); return ret(o); }, ht(rt, o) { return tm.hideTurtle(rt, o); },
    showTurtle(rt, o) { const t = self(o); t.hidden = false; pose(t); return ret(o); }, st(rt, o) { return tm.showTurtle(rt, o); },
    isHidden(rt, o) { return self(o).hidden; },
    home(rt, o) { const t = self(o); t.x = 0; t.y = 0; t.h = 0; pose(t); return ret(o); },
    setPos(rt, o, a) { const t = self(o); [t.x, t.y] = xy(a); pose(t); if (t.path) t.path.push([t.x, t.y]); return ret(o); },
    setX(rt, o, a) { const t = self(o); t.x = num(a[0]); pose(t); return ret(o); }, setY(rt, o, a) { const t = self(o); t.y = num(a[0]); pose(t); return ret(o); },
    setScreenPos(rt, o, a) { const t = self(o); t.x = num(a[0]) - t.pg.w / 2; t.y = t.pg.h / 2 - num(a[1]); pose(t); return ret(o); },
    moveTo(rt, o, a) { const t = self(o); const [x, y] = xy(a); const dx = x - t.x, dy = y - t.y; if (dx || dy) { t.h = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360; } move(t, x, y, true); return ret(o); },
    getX(rt, o) { return D(self(o).x); }, getY(rt, o) { return D(self(o).y); },
    heading(rt, o, a) { const t = self(o); if (a.length) { t.h = ((num(a[0]) % 360) + 360) % 360; pose(t); return ret(o); } return D(t.h); },
    setHeading(rt, o, a) { const t = self(o); t.h = ((num(a[0]) % 360) + 360) % 360; pose(t); return ret(o); }, setH(rt, o, a) { return tm.setHeading(rt, o, a); },
    setRandomHeading(rt, o) { const t = self(o); t.h = Math.floor(Math.random() * 360); pose(t); return ret(o); },
    setRandomPos(rt, o, a) { const t = self(o); const w = num(a[0]), h = num(a[1]); t.x = (Math.random() - 0.5) * w; t.y = (Math.random() - 0.5) * h; pose(t); return ret(o); },
    towards(rt, o, a) { const t = self(o); const [x, y] = xy(a); return D(((Math.atan2(x - t.x, y - t.y) * 180 / Math.PI) + 360) % 360); },
    distance(rt, o, a) { const t = self(o); const [x, y] = xy(a); return D(Math.hypot(x - t.x, y - t.y)); },
    speed(rt, o, a) { const t = self(o); const s = num(a[0]); t.speed = s <= 0 ? Infinity : s; return ret(o); },
    getSpeed(rt, o) { const s = self(o).speed; return s === Infinity ? -1 : Math.round(s); },
    setColor(rt, o, a, line) { const t = self(o); const c = toColor(a[0], line); t.color = c.css; t.colorObj = c.obj; pose(t); return ret(o); },
    setPenColor(rt, o, a, line) { const t = self(o); const c = toColor(a[0], line); t.penColor = c.css; t.penObj = c.obj; return ret(o); },
    setFillColor(rt, o, a, line) { const t = self(o); const c = toColor(a[0], line); t.fillColor = c.css; t.fillObj = c.obj; return ret(o); },
    getColor(rt, o) { return self(o).colorObj; }, getPenColor(rt, o) { return self(o).penObj; }, getFillColor(rt, o) { return self(o).fillObj; },
    getColorStr(rt, o) { return self(o).color; }, getPenColorStr(rt, o) { return self(o).penColor; }, getFillColorStr(rt, o) { return self(o).fillColor; },
    setPenWidth(rt, o, a) { self(o).width = Math.max(1, num(a[0])); return ret(o); }, setLineWidth(rt, o, a) { return tm.setPenWidth(rt, o, a); }, penWidth(rt, o, a) { if (a.length) return tm.setPenWidth(rt, o, a); return self(o).width; },
    getPenWidth(rt, o) { return Math.round(self(o).width); },
    dot(rt, o, a) { const t = self(o); const p = P(t, t.x, t.y); emit(t, { t: 'circle', x: p.x, y: p.y, rx: num(a[0]) / 2, ry: num(a[0]) / 2, fill: true, color: t.penColor }); return ret(o); },
    openDot(rt, o, a) { const t = self(o); const p = P(t, t.x, t.y); emit(t, { t: 'circle', x: p.x, y: p.y, rx: num(a[0]) / 2, ry: num(a[0]) / 2, fill: false, color: t.penColor, width: 1 }); return ret(o); },
    spray(rt, o, a) { const t = self(o); const dens = int(a[0]), spread = num(a[1]), size = a.length > 2 ? num(a[2]) : 1; for (let i = 0; i < dens; i++) { const r = Math.random() * spread, w = Math.random() * 2 * Math.PI; const p = P(t, t.x + r * Math.cos(w), t.y + r * Math.sin(w)); emit(t, { t: 'circle', x: p.x, y: p.y, rx: size / 2, ry: size / 2, fill: true, color: t.penColor }); } return ret(o); },
    label(rt, o, a) { const t = self(o); const p = P(t, t.x, t.y); emit(t, { t: 'text', x: p.x, y: p.y, s: str(a[0]), color: t.penColor, font: fontCss(t.font) }); return ret(o); },
    setFont(rt, o, a) { const t = self(o); if (a[0] instanceof JObject && a[0].native) t.font = { ...a[0].native }; return ret(o); },
    setFontSize(rt, o, a) { self(o).font.size = int(a[0]); return ret(o); }, setFontStyle(rt, o, a) { self(o).font.style = int(a[0]); return ret(o); },
    getFont(rt, o) { const f = self(o).font; const x = new JObject(rt.cls('Font')); x.native = { ...f }; return x; },
    getTextWidth(rt, o, a) { const f = self(o).font; return Math.round(str(a[0]).length * f.size * 0.55); }, getTextHeight(rt, o) { return Math.round(self(o).font.size * 1.2); }, getTextAscent(rt, o) { return Math.round(self(o).font.size * 0.9); }, getTextDescent(rt, o) { return Math.round(self(o).font.size * 0.25); },
    clear(rt, o, a, line) { const t = self(o); if (a.length) t.pg.bg = toColor(a[0], line).css; emit(t, { t: 'clear', bg: t.pg.bg }); return ret(o); },
    clean(rt, o, a, line) { return tm.clear(rt, o, a, line); },
    fill(rt, o, a, line) { const t = self(o); const [x, y] = a.length >= 2 ? xy(a) : [t.x, t.y]; const p = P(t, x, y); emit(t, { t: 'flood', x: p.x, y: p.y, color: t.fillColor || t.penColor }); return ret(o); },
    fillToPoint(rt, o, a) { const t = self(o); const [x, y] = a.length >= 2 ? xy(a) : [t.x, t.y]; t.fan = { kind: 'point', x, y }; return ret(o); },
    fillToHorizontal(rt, o, a) { const t = self(o); t.fan = { kind: 'h', v: a.length ? num(a[0]) : t.y }; return ret(o); },
    fillToVertical(rt, o, a) { const t = self(o); t.fan = { kind: 'v', v: a.length ? num(a[0]) : t.x }; return ret(o); },
    fillOff(rt, o) { self(o).fan = null; return ret(o); },
    startPath(rt, o) { const t = self(o); t.path = [[t.x, t.y]]; return ret(o); },
    fillPath(rt, o, a, line) { const t = self(o); if (!t.path) rt.rtError('fillPath() ohne vorheriges startPath()', line); const c = a.length ? toColor(a[0], line).css : (t.fillColor || t.penColor); emit(t, { t: 'poly', pts: t.path.map(([x, y]) => P(t, x, y)), fill: true, color: c }); t.path = null; return ret(o); },
    leftArc(rt, o, a) { arc(self(o), num(a[0]), num(a[1]), true); return ret(o); }, rightArc(rt, o, a) { arc(self(o), num(a[0]), num(a[1]), false); return ret(o); },
    leftCircle(rt, o, a) { arc(self(o), num(a[0]), 360, true); return ret(o); }, rightCircle(rt, o, a) { arc(self(o), num(a[0]), 360, false); return ret(o); },
    stampTurtle(rt, o, a, line) { const t = self(o); const p = P(t, t.x, t.y); const c = a.length ? toColor(a[0], line).css : t.color; emit(t, { t: 'stamp', x: p.x, y: p.y, h: t.h, color: c, ...(!a.length && t.sprite ? { sprite: t.sprite } : {}) }); return ret(o); },
    drawImage(rt, o, a, line) { const t = self(o); const im = needAsset(str(a[0]), 'image', line); const p = P(t, t.x, t.y); emit(t, { t: 'image', url: im.url, x: p.x, y: p.y, w: im.w, h: im.h, rot: t.h, anchor: 'center' }); return ret(o); },
    drawBkImage(rt, o, a, line) { const t = self(o); const im = needAsset(str(a[0]), 'image', line); emit(t, { t: 'bkimage', url: im.url }); return ret(o); },
    sound(rt, o, a) { return a.length >= 4 ? tone(a[1], a[2], num(a[0]) / 100, !!a[3]) : tone(a[0], a[1], 1, true); },
    beep(rt, o) { push(0, { t: 'tone', freq: 880, ms: 120, vol: 0.8 }); return ret(o); },
    ...keyMethods((o) => winState(self(o).pg.win)),
    ...listenerMethods((o) => { frameOf(self(o).pg); return winState(self(o).pg.win); }, ['mouse', 'motion', 'key', 'hit', 'hitX', 'turtleHit', 'dbl', 'exit']),
    pushState(rt, o) { const t = self(o); t.states.push({ x: t.x, y: t.y, h: t.h, pen: t.pen, penColor: t.penColor, penObj: t.penObj, width: t.width }); return ret(o); },
    popState(rt, o) { const t = self(o); const s = t.states.pop(); if (s) { Object.assign(t, s); pose(t); } return ret(o); },
    clearStates(rt, o) { self(o).states = []; return ret(o); },
    sleep(rt, o, a) { return rt.sleep(num(a[0]), ret(o)); },
    setTitle(rt, o, a) { const t = self(o); emit(t, { t: 'title', s: str(a[0]) }); return ret(o); },
    setStatusText(rt, o, a) { const t = self(o); emit(t, { t: 'status', s: str(a[0]) }); return ret(o); },
    addStatusBar(rt, o) { return ret(o); }, showStatusBar(rt, o) { return ret(o); },
    isInPlayground(rt, o) { const t = self(o); return Math.abs(t.x) <= t.pg.w / 2 && Math.abs(t.y) <= t.pg.h / 2; },
    wrap: ret, clip: ret, isClip() { return false; }, isWrap() { return false; }, antiAliasing: ret, enableRepaint: ret, repaint: ret, toTop: ret, toBottom: ret, setCursor: ret, setCustomCursor: ret, setAngleResolution: ret, print: ret, printScreen: ret,
    savePlayground() { return false; },
    viewingMoveTo(rt, o, a) { return tm.moveTo(rt, o, a); }, viewingSetPos(rt, o, a) { return tm.setPos(rt, o, a); },
    toTurtlePos(rt, o, a) { rt.rtError('toTurtlePos() wird nicht unterstützt'); },
    toTurtleX(rt, o, a) { return D(num(a[0]) - self(o).pg.w / 2); }, toTurtleY(rt, o, a) { return D(self(o).pg.h / 2 - num(a[0])); },
    clone(rt, o) { const t = self(o); const c = new JObject(rt.cls('Turtle')); c.native = turtleState(rt, [o], 0); Object.assign(c.native, { x: t.x, y: t.y, h: t.h, pen: t.pen, penColor: t.penColor, penObj: t.penObj, color: t.color, colorObj: t.colorObj, width: t.width, speed: t.speed, sprite: t.sprite, obj: c }); pose(c.native); return c; },
    dispose(rt, o) { emit(self(o), { t: 'close' }); }, getFrame(rt, o) { return frameOf(self(o).pg); }, getPlayground() { return null; }, getPen() { return null; },
    getPixelColor() { rt.rtError('getPixelColor() wird in der Web-Version nicht unterstützt'); }, getPixelColorStr() { rt.rtError('getPixelColorStr() wird in der Web-Version nicht unterstützt'); },
  };
  for (const n of ['addFocusListener', 'addComponentListener', 'addWindowListener', 'addWindowFocusListener', 'getTurtleImage', 'getTurtleFactory'])
    tm[n] = () => rt.rtError(`Turtle.${n}() wird in der Web-Version nicht unterstützt`);
  // Tastaturabfragen gibt es in APLU nur bei TurtleFrame (tf.getKeyCodeWait()), nicht bei Turtle
  for (const n of Object.keys(keyRet)) delete tm[n];
  const TT = T('Turtle');
  const tRet = {};
  for (const k of Object.keys(tm)) tRet[k] = TT;
  for (const n of [...Object.keys(tm)].filter(n => /^add\w+Listener$/.test(n))) tRet[n] = VOID;
  Object.assign(tRet, { sound: VOID, getFrame: T('TurtleFrame'), getX: DOUBLE, getY: DOUBLE, towards: DOUBLE, distance: DOUBLE, isPenUp: BOOL, isHidden: BOOL, getSpeed: INT, getColor: T('Color'), getPenColor: T('Color'), getFillColor: T('Color'), getColorStr: STRING, getPenColorStr: STRING, getFillColorStr: STRING, getPenWidth: INT, isInPlayground: BOOL, isClip: BOOL, isWrap: BOOL, getFont: T('Font'), getTextWidth: INT, getTextHeight: INT, getTextAscent: INT, getTextDescent: INT, toTurtleX: DOUBLE, toTurtleY: DOUBLE, savePlayground: BOOL, dispose: VOID, heading: null, penWidth: null });
  const p = (type, name) => ({ type: T(type), name });
  def('Turtle', { pkg: 'ch.aplu.turtle', extendable: true,
    ctor(rt, a, line, type) { const o = new JObject(rt.cls('Turtle')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a, line) { o.native = turtleState(rt, a, line); o.native.obj = o; pose(o.native); },
    methods: tm, retTypes: tRet,
    statics: { sleep(rt, a) { return rt.sleep(num(a[0])); }, setFramePosition: noop, setPlaygroundSize: noop, clear: noop },
    toString(rt, o) { const t = o.native; return `Turtle(x=${+t.x.toFixed(2)}, y=${+t.y.toFixed(2)}, Richtung=${+t.h.toFixed(2)})`; },
    inspectRows(rt, o) { const t = o.native; return [
      { name: 'x', type: 'double', value: D(t.x) }, { name: 'y', type: 'double', value: D(t.y) }, { name: 'Richtung', type: 'double', value: D(t.h) },
      { name: 'Stift', type: 'String', value: t.erase ? 'radiert' : t.pen ? 'unten (zeichnet)' : 'oben' }, { name: 'Stiftfarbe', type: 'String', value: t.penColor },
      { name: 'Farbe', type: 'String', value: t.color }, { name: 'Linienbreite', type: 'double', value: D(t.width) }, { name: 'versteckt', type: 'boolean', value: t.hidden }]; },
    ui: [{ name: 'forward', params: [p('double', 'distance')], ret: TT }, { name: 'back', params: [p('double', 'distance')], ret: TT }, { name: 'left', params: [p('double', 'angle')], ret: TT }, { name: 'right', params: [p('double', 'angle')], ret: TT },
      { name: 'penUp', params: [], ret: TT }, { name: 'penDown', params: [], ret: TT }, { name: 'setColor', params: [p('String', 'color')], ret: TT }, { name: 'setPenColor', params: [p('String', 'color')], ret: TT },
      { name: 'setPenWidth', params: [p('int', 'width')], ret: TT }, { name: 'leftCircle', params: [p('double', 'radius')], ret: TT }, { name: 'rightArc', params: [p('double', 'radius'), p('double', 'angle')], ret: TT },
      { name: 'moveTo', params: [p('double', 'x'), p('double', 'y')], ret: TT }, { name: 'setPos', params: [p('double', 'x'), p('double', 'y')], ret: TT }, { name: 'home', params: [], ret: TT }, { name: 'dot', params: [p('double', 'diameter')], ret: TT },
      { name: 'fill', params: [], ret: TT }, { name: 'label', params: [p('String', 'text')], ret: TT }, { name: 'speed', params: [p('double', 'speed')], ret: TT }, { name: 'hideTurtle', params: [], ret: TT }, { name: 'showTurtle', params: [], ret: TT },
      { name: 'clear', params: [], ret: TT }, { name: 'getX', params: [], ret: DOUBLE }, { name: 'getY', params: [], ret: DOUBLE }, { name: 'heading', params: [], ret: DOUBLE }],
  });
  // TurtleFrame: eigenes Turtle-Fenster, in das mehrere Turtles gesetzt werden (new Turtle(tf)); hat die Tastaturabfragen
  const F = (o) => { if (!o.native || !o.native.pg) rt.rtError('TurtleFrame wurde nicht richtig erzeugt'); return o.native.pg; };
  const FS = (o) => winState(F(o).win, o);
  def('TurtleFrame', { pkg: 'ch.aplu.turtle', extendable: true,
    ctor(rt, a, line) { const o = new JObject(rt.cls('TurtleFrame')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a, line) {
      const opt = {};
      const strs = a.filter(v => typeof v === 'string'), ints = a.filter(v => typeof v === 'number');
      const col = a.find(v => v instanceof JObject && v.native && v.native.r !== undefined);
      if (strs.length) opt.title = strs[0];
      if (col) opt.bg = toColor(col, line).css;
      // (titel, breite, höhe) bzw. (x, y, titel, breite, höhe …): die Größe steht hinter dem Titel
      const si = a.findIndex(v => typeof v === 'string');
      if (si >= 0 && typeof a[si + 1] === 'number' && typeof a[si + 2] === 'number') { opt.w = Math.max(50, Math.min(1600, int(a[si + 1]))); opt.h = Math.max(50, Math.min(1200, int(a[si + 2]))); }
      else if (ints.length === 1 && a.length === 1) { /* Modus – ohne Bedeutung im Browser */ }
      o.native = { pg: newPlayground(rt, opt), frame: true };
      o.native.pg.frameObj = o; winState(o.native.pg.win, o);
    },
    methods: {
      ...keyMethods(FS),
      ...listenerMethods(FS, ['mouse', 'motion', 'key', 'hit', 'hitX', 'dbl', 'exit']),
      addMouseWheelListener() { rt.rtError('addMouseWheelListener() wird in der Web-Version nicht unterstützt'); },
      setStatusText(rt, o, a) { push(F(o).win, { t: 'status', s: str(a[0]) }); }, addStatusBar: noop, showStatusBar: noop,
      setTitle(rt, o, a) { push(F(o).win, { t: 'title', s: str(a[0]) }); },
      drawBkImage(rt, o, a, line) { const im = needAsset(str(a[0]), 'image', line); push(F(o).win, { t: 'bkimage', url: im.url }); },
      dispose(rt, o) { push(F(o).win, { t: 'close' }); }, getPlayground() { return null; }, setCursor: noop, setClosingMode: noop, setDoubleClickDelay: noop, getDoubleClickDelay() { return 260; }, getMouseHitButton() { return 1; },
      setVisible: noop, toFront: noop, repaint: noop,
    },
    retTypes: { ...keyRet, getDoubleClickDelay: INT, getMouseHitButton: INT },
    statics: { isDisposed() { return false; }, getLastFrame() { return null; } }, staticRet: { isDisposed: BOOL },
    toString(rt, o) { return 'TurtleFrame'; },
  });
  rt._def('Playground', { lib: true, pkg: 'ch.aplu.turtle' }); rt._def('Pen', { lib: true, pkg: 'ch.aplu.turtle' });

  // ------------------------------------------------------------ GPanel
  function gpState(rt, a, line) {
    const g = { w: 501, h: 501, xmin: 0, xmax: 1, ymin: 0, ymax: 1, px: 0, py: 0, color: 'black', colorObj: sf.black, width: 1, bg: 'white', font: { family: 'SansSerif', style: 0, size: 12 }, title: 'GPanel' };
    const nums = a.filter(v => typeof v === 'number' || v instanceof JDouble || typeof v === 'bigint');
    const strs = a.filter(v => typeof v === 'string');
    if (strs.length) g.title = strs[0];
    if (nums.length >= 4) [g.xmin, g.xmax, g.ymin, g.ymax] = nums.slice(0, 4).map(num);
    if (g.xmax === g.xmin || g.ymax === g.ymin) rt.rtError('GPanel: Koordinatenbereich darf nicht leer sein', line);
    g.win = gfx().newWindow({ kind: 'gpanel', title: g.title, w: g.w, h: g.h, bg: g.bg });
    winState(g.win);
    return g;
  }
  const G = (o) => { if (!o.native || o.native.xmin === undefined) rt.rtError('GPanel wurde nicht richtig erzeugt'); return o.native; };
  const GS = (o) => winState(G(o).win, o);
  const gx = (g, x) => (num(x) - g.xmin) / (g.xmax - g.xmin) * (g.w - 1);
  const gy = (g, y) => (g.ymax - num(y)) / (g.ymax - g.ymin) * (g.h - 1);
  const sx = (g, d) => Math.abs(num(d) / (g.xmax - g.xmin) * (g.w - 1));
  const sy = (g, d) => Math.abs(num(d) / (g.ymax - g.ymin) * (g.h - 1));
  const gop = (g, op) => push(g.win, op);
  const rectArgs = (g, a) => a.length >= 4 ? [num(a[0]), num(a[1]), num(a[2]), num(a[3])] : [g.px - num(a[0]) / 2, g.py - num(a[1]) / 2, g.px + num(a[0]) / 2, g.py + num(a[1]) / 2];
  const rect = (g, a, fill) => { const [x1, y1, x2, y2] = rectArgs(g, a); const X1 = gx(g, x1), X2 = gx(g, x2), Y1 = gy(g, y1), Y2 = gy(g, y2); gop(g, { t: 'poly', pts: [{ x: X1, y: Y1 }, { x: X2, y: Y1 }, { x: X2, y: Y2 }, { x: X1, y: Y2 }], fill, color: g.color, width: g.width }); };
  const ellipse = (g, rx, ry, fill) => gop(g, { t: 'circle', x: gx(g, g.px), y: gy(g, g.py), rx: sx(g, rx), ry: sy(g, ry), fill, color: g.color, width: g.width });
  const tri = (g, a, fill) => { const pts = [[a[0], a[1]], [a[2], a[3]], [a[4], a[5]]].map(([x, y]) => ({ x: gx(g, x), y: gy(g, y) })); gop(g, { t: 'poly', pts, fill, color: g.color, width: g.width }); };
  const poly = (g, a, fill) => {
    let xs, ys;
    if (a.length === 2 && a[0] instanceof JArray) { xs = a[0].data; ys = a[1].data; }
    else if (a.length === 1 && a[0] instanceof JArray) { xs = a[0].data.map(p => p.fields ? p.fields.x : 0); ys = a[0].data.map(p => p.fields ? p.fields.y : 0); }
    else rt.rtError('polygon(double[] x, double[] y) erwartet');
    gop(g, { t: 'poly', pts: xs.map((x, i) => ({ x: gx(g, x), y: gy(g, ys[i]) })), fill, color: g.color, width: g.width });
  };
  const arcOp = (g, r, start, ext, fill) => gop(g, { t: 'arc', x: gx(g, g.px), y: gy(g, g.py), rx: sx(g, r), ry: sy(g, r), start: num(start), ext: num(ext), fill, color: g.color, width: g.width });
  const gm = {
    window(rt, o, a) { const g = G(o); [g.xmin, g.xmax, g.ymin, g.ymax] = a.map(num); },
    move(rt, o, a) { const g = G(o); [g.px, g.py] = [num(a[0]), num(a[1])]; }, pos(rt, o, a) { return gm.move(rt, o, a); },
    draw(rt, o, a) { const g = G(o); const nx = num(a[0]), ny = num(a[1]); gop(g, { t: 'line', x1: gx(g, g.px), y1: gy(g, g.py), x2: gx(g, nx), y2: gy(g, ny), color: g.color, width: g.width }); g.px = nx; g.py = ny; },
    line(rt, o, a) { const g = G(o); gop(g, { t: 'line', x1: gx(g, a[0]), y1: gy(g, a[1]), x2: gx(g, a[2]), y2: gy(g, a[3]), color: g.color, width: g.width }); },
    point(rt, o, a) { const g = G(o); if (a.length >= 2) [g.px, g.py] = [num(a[0]), num(a[1])]; gop(g, { t: 'circle', x: gx(g, g.px), y: gy(g, g.py), rx: Math.max(0.6, g.width / 2), ry: Math.max(0.6, g.width / 2), fill: true, color: g.color }); },
    circle(rt, o, a) { ellipse(G(o), a[0], a[0], false); }, fillCircle(rt, o, a) { ellipse(G(o), a[0], a[0], true); },
    ellipse(rt, o, a) { ellipse(G(o), a[0], a[1], false); }, fillEllipse(rt, o, a) { ellipse(G(o), a[0], a[1], true); },
    rectangle(rt, o, a) { rect(G(o), a, false); }, fillRectangle(rt, o, a) { rect(G(o), a, true); },
    triangle(rt, o, a) { tri(G(o), a, false); }, fillTriangle(rt, o, a) { tri(G(o), a, true); },
    polygon(rt, o, a) { poly(G(o), a, false); }, fillPolygon(rt, o, a) { poly(G(o), a, true); },
    arc(rt, o, a) { arcOp(G(o), a[0], a[1], a[2], false); }, fillArc(rt, o, a) { arcOp(G(o), a[0], a[1], a[2], true); },
    text(rt, o, a) { const g = G(o); let x = g.px, y = g.py, s; if (a.length >= 3) { x = num(a[0]); y = num(a[1]); s = str(a[2]); } else s = str(a[0]); gop(g, { t: 'text', x: gx(g, x), y: gy(g, y), s, color: g.color, font: fontCss(g.font) }); },
    font(rt, o, a) { const g = G(o); if (a[0] instanceof JObject && a[0].native) g.font = { ...a[0].native }; },
    color(rt, o, a, line) { const g = G(o); const c = toColor(a[0], line); const old = g.colorObj; g.color = c.css; g.colorObj = c.obj; return old; },
    setColor(rt, o, a, line) { return gm.color(rt, o, a, line); },
    lineWidth(rt, o, a) { const g = G(o); const old = g.width; g.width = Math.max(1, num(a[0])); return Math.round(old); },
    bgColor(rt, o, a, line) { const g = G(o); g.bg = toColor(a[0], line).css; gop(g, { t: 'clear', bg: g.bg }); },
    clear(rt, o, a, line) { const g = G(o); if (a.length) g.bg = toColor(a[0], line).css; gop(g, { t: 'clear', bg: g.bg }); g.px = g.xmin; g.py = g.ymin; },
    erase(rt, o) { const g = G(o); gop(g, { t: 'clear', bg: g.bg }); },
    fill(rt, o, a, line) { const g = G(o); const c = toColor(a[a.length - 1], line).css; gop(g, { t: 'flood', x: gx(g, a[0]), y: gy(g, a[1]), color: c }); },
    delay(rt, o, a) { return rt.sleep(num(a[0])); },
    title(rt, o, a) { gop(G(o), { t: 'title', s: str(a[0]) }); }, setTitle(rt, o, a) { return gm.title(rt, o, a); },
    getPosX(rt, o) { return D(G(o).px); }, getPosY(rt, o) { return D(G(o).py); },
    toWindowX(rt, o, a) { const g = G(o); return D(g.xmin + num(a[0]) / (g.w - 1) * (g.xmax - g.xmin)); }, toWindowY(rt, o, a) { const g = G(o); return D(g.ymax - num(a[0]) / (g.h - 1) * (g.ymax - g.ymin)); },
    toPixelX(rt, o, a) { return Math.round(gx(G(o), a[0])); }, toPixelY(rt, o, a) { return Math.round(gy(G(o), a[0])); },
    enableRepaint: noop, repaint: noop, refresh: noop, setPaintMode: noop, setXORMode: noop, visible: noop, dispose(rt, o) { gop(G(o), { t: 'close' }); }, showStatusBar: noop, setStatusText(rt, o, a) { gop(G(o), { t: 'status', s: str(a[0]) }); },
    windowPosition: noop, windowCenter: noop,
    // Bild aus dem Projekt; (x, y) ist die linke untere Ecke (wie in APLU)
    image(rt, o, a, line) { const g = G(o); const im = needAsset(str(a[0]), 'image', line); const [x, y] = xy(a, 1); gop(g, { t: 'image', url: im.url, x: gx(g, x), y: gy(g, y) - im.h + 1, w: im.w, h: im.h }); return true; },
    imageWidth(rt, o, a, line) { const g = G(o); const im = needAsset(str(a[0]), 'image', line); return D(im.w / (g.w - 1) * Math.abs(g.xmax - g.xmin)); },
    imageHeight(rt, o, a, line) { const g = G(o); const im = needAsset(str(a[0]), 'image', line); return D(im.h / (g.h - 1) * Math.abs(g.ymax - g.ymin)); },
    ...keyMethods(GS),
    ...listenerMethods(GS, ['mouse', 'motion', 'key', 'dbl', 'exit']),
    addMouseWheelListener() { rt.rtError('addMouseWheelListener() wird in der Web-Version nicht unterstützt'); },
  };
  for (const n of ['getPixelColor', 'print', 'saveGraphics', 'restoreGraphics'])
    gm[n] = () => rt.rtError(`GPanel.${n}() wird in der Web-Version nicht unterstützt`);
  def('GPanel', { pkg: 'ch.aplu.util', extendable: true,
    ctor(rt, a, line) { const o = new JObject(rt.cls('GPanel')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a, line) { o.native = gpState(rt, a, line); winState(o.native.win, o); },
    methods: gm,
    retTypes: { ...keyRet, color: T('Color'), setColor: T('Color'), lineWidth: INT, getPosX: DOUBLE, getPosY: DOUBLE, toWindowX: DOUBLE, toWindowY: DOUBLE, toPixelX: INT, toPixelY: INT, image: BOOL, imageWidth: DOUBLE, imageHeight: DOUBLE },
    statics: { delay(rt, a) { return rt.sleep(num(a[0])); } },
    toString(rt, o) { return 'GPanel[' + o.native.title + ']'; },
    inspectRows(rt, o) { const g = o.native; return [{ name: 'x-Bereich', type: '', value: `${g.xmin} … ${g.xmax}` }, { name: 'y-Bereich', type: '', value: `${g.ymin} … ${g.ymax}` }, { name: 'Position', type: '', value: `(${+g.px.toFixed(3)}, ${+g.py.toFixed(3)})` }, { name: 'Farbe', type: '', value: g.color }]; },
    ui: [{ name: 'move', params: [p('double', 'x'), p('double', 'y')], ret: VOID }, { name: 'draw', params: [p('double', 'x'), p('double', 'y')], ret: VOID }, { name: 'line', params: [p('double', 'x1'), p('double', 'y1'), p('double', 'x2'), p('double', 'y2')], ret: VOID },
      { name: 'circle', params: [p('double', 'radius')], ret: VOID }, { name: 'fillCircle', params: [p('double', 'radius')], ret: VOID }, { name: 'rectangle', params: [p('double', 'width'), p('double', 'height')], ret: VOID },
      { name: 'text', params: [p('String', 'text')], ret: VOID }, { name: 'color', params: [p('String', 'color')], ret: T('Color') }, { name: 'clear', params: [], ret: VOID }],
  });

  // ------------------------------------------------------------ Console, InputDialog, MessageDialog
  const conPrint = {
    print(rt, o, a) { rt.print(a.length ? rt.printArg(a[0]) : ''); }, println(rt, o, a) { rt.print((a.length ? rt.printArg(a[0]) : '') + '\n'); },
    printf(rt, o, a, line) { rt.print(rt.format(a[0], a.slice(1), line)); return o; },
  };
  const conRead = {
    readInt() { return askInt(gfx().lastLine() || 'Ganze Zahl eingeben:', 'Console'); },
    readDouble() { return askDouble(gfx().lastLine() || 'Zahl eingeben:', 'Console'); },
    readLong() { return BigInt(askInt(gfx().lastLine() || 'Ganze Zahl eingeben:', 'Console')); },
    readLine() { return ask(gfx().lastLine() || 'Text eingeben:', 'Console'); },
    readString() { return ask(gfx().lastLine() || 'Text eingeben:', 'Console'); },
    readChar() { const s = ask(gfx().lastLine() || 'Zeichen eingeben:', 'Console'); return new JChar(s.length ? s.charCodeAt(0) : 10); },
    readBoolean() { return askBool(gfx().lastLine() || 'true oder false eingeben:', 'Console'); },
    getKey() { const s = ask('Taste drücken (Zeichen eingeben):', 'Console'); return new JChar(s.length ? s.charCodeAt(0) : 10); },
    getKeyWait() { return conRead.getKey(); },
    kbhit() { return false; },
  };
  const conStatics = { init(rt) { return new JObject(rt.cls('Console')); }, clear() { }, end() { }, terminate() { }, delay(rt, a) { return rt.sleep(num(a[0])); } };
  // Eingaben warten, bis die Grafik fertig abgespielt ist (das Programm pausiert so lange)
  for (const k of Object.keys(conRead)) { if (k === 'kbhit') continue; const f = conRead[k]; conRead[k] = () => rt.afterGfx(f); }
  for (const [k, f] of Object.entries(conRead)) conStatics[k] = (rt, a) => f();
  const conMethods = { ...conPrint, clear() { }, end() { }, terminate() { }, showCursor() { }, hideCursor() { }, setTitle() { }, setPos() { } };
  for (const [k, f] of Object.entries(conRead)) conMethods[k] = (rt, o, a) => f();
  def('Console', { pkg: 'ch.aplu.util', ctor(rt) { const o = new JObject(rt.cls('Console')); o.native = {}; return o; }, methods: conMethods, statics: conStatics,
    retTypes: { readInt: INT, readDouble: DOUBLE, readLong: T('long'), readLine: STRING, readString: STRING, readChar: T('char'), readBoolean: BOOL, getKey: T('char'), getKeyWait: T('char'), kbhit: BOOL },
    staticRet: { readInt: INT, readDouble: DOUBLE, readLong: T('long'), readLine: STRING, readString: STRING, readChar: T('char'), readBoolean: BOOL, getKey: T('char'), getKeyWait: T('char'), kbhit: BOOL, init: T('Console') } });

  const dlg = (o) => o.native || { title: 'Eingabe', prompt: 'Wert eingeben:' };
  def('InputDialog', { pkg: 'ch.aplu.util',
    ctor(rt, a) { const o = new JObject(rt.cls('InputDialog')); o.native = a.length >= 2 ? { title: str(a[0]), prompt: str(a[1]) } : { title: 'Eingabe', prompt: a.length ? str(a[0]) : 'Wert eingeben:' }; return o; },
    methods: {
      readInt(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => askInt(a.length ? str(a[0]) : d.prompt, d.title)); },
      readDouble(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => askDouble(a.length ? str(a[0]) : d.prompt, d.title)); },
      readLong(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => BigInt(askInt(a.length ? str(a[0]) : d.prompt, d.title))); },
      readString(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => ask(a.length ? str(a[0]) : d.prompt, d.title)); },
      readBoolean(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => askBool(a.length ? str(a[0]) : d.prompt, d.title)); },
      readChar(rt, o, a) { const d = dlg(o); return rt.afterGfx(() => { const s = ask(a.length ? str(a[0]) : d.prompt, d.title); return new JChar(s.length ? s.charCodeAt(0) : 32); }); },
      isCancelled() { return false; }, dispose() { },
    },
    retTypes: { readInt: INT, readDouble: DOUBLE, readLong: T('long'), readString: STRING, readBoolean: BOOL, readChar: T('char'), isCancelled: BOOL },
    statics: { readInt(rt, a) { return rt.afterGfx(() => askInt(a.length ? str(a[a.length - 1]) : 'Ganze Zahl eingeben:', 'Eingabe')); }, readDouble(rt, a) { return rt.afterGfx(() => askDouble(a.length ? str(a[a.length - 1]) : 'Zahl eingeben:', 'Eingabe')); }, readString(rt, a) { return rt.afterGfx(() => ask(a.length ? str(a[a.length - 1]) : 'Text eingeben:', 'Eingabe')); } },
    staticRet: { readInt: INT, readDouble: DOUBLE, readString: STRING },
  });
  const showMsg = (title, text) => rt.afterGfx(() => { gfx().message(text, title); });
  def('MessageDialog', { pkg: 'ch.aplu.util',
    ctor(rt, a) { const o = new JObject(rt.cls('MessageDialog')); const s = a.filter(v => typeof v === 'string'); o.native = s.length >= 2 ? { title: s[0], text: s[1] } : { title: 'Meldung', text: s.length ? s[0] : (a.length ? str(a[a.length - 1]) : '') }; return o; },
    methods: { show(rt, o) { return showMsg(o.native.title, o.native.text); }, setText(rt, o, a) { o.native.text = str(a[0]); }, setTitle(rt, o, a) { o.native.title = str(a[0]); }, close() { }, dispose() { }, showModal(rt, o) { return showMsg(o.native.title, o.native.text); } },
    statics: { show(rt, a) { return showMsg('Meldung', str(a[a.length - 1])); } },
  });
  def('ModelessOptionPane', { pkg: 'ch.aplu.util', ctor(rt, a) { const s = a.filter(v => typeof v === 'string'); gfx().message(s.length ? s[s.length - 1] : '', 'Meldung'); const o = new JObject(rt.cls('ModelessOptionPane')); o.native = {}; return o; }, methods: { setText(rt, o, a) { return showMsg('Meldung', str(a[0])); }, dispose() { } } });
  def('Monitor', { pkg: 'ch.aplu.util', statics: monitorStatics });

  // ------------------------------------------------------------ SoundPlayer (ch.aplu.util): Klangdatei aus dem Projekt
  let sndId = 0;
  const SP = (o) => { if (!o.native || !o.native.sid) rt.rtError('SoundPlayer wurde nicht richtig erzeugt'); return o.native; };
  const sndOp = (p, act) => push(0, { t: 'sound', id: p.sid, url: p.url, act, vol: p.muted ? 0 : p.vol / 1000 });
  def('SoundPlayer', { pkg: 'ch.aplu.util',
    ctor(rt, a, line) {
      const name = a.find(v => typeof v === 'string');
      if (name === undefined) rt.rtError('new SoundPlayer("datei.wav") erwartet', line);
      const f = needAsset(name, 'audio', line);
      const o = new JObject(rt.cls('SoundPlayer')); o.native = { sid: ++sndId, url: f.url, name, vol: 1000, muted: false }; return o;
    },
    methods: {
      play(rt, o) { sndOp(SP(o), 'play'); return 0; }, replay(rt, o) { sndOp(SP(o), 'replay'); }, playLoop(rt, o) { sndOp(SP(o), 'loop'); },
      blockingPlay(rt, o) { const p = SP(o); sndOp(p, 'play'); return new R.Suspend(() => rt.whenGfxIdle().then(() => new Promise((res) => { const g = gfx(); if (g.whenSoundEnds) g.whenSoundEnds(p.sid, res); else res(); })), () => undefined); },
      stop(rt, o) { sndOp(SP(o), 'stop'); }, pause(rt, o) { sndOp(SP(o), 'pause'); }, release() { },
      isPlaying(rt, o) { const g = gfx(); return g.soundPlaying ? g.soundPlaying(SP(o).sid) : false; },
      setVolume(rt, o, a) { const p = SP(o); p.vol = Math.max(0, Math.min(1000, int(a[0]))); sndOp(p, 'volume'); }, getVolume(rt, o) { return SP(o).vol; },
      mute(rt, o, a) { const p = SP(o); p.muted = !!a[0]; sndOp(p, 'volume'); },
    },
    retTypes: { play: INT, isPlaying: BOOL, getVolume: INT },
    statics: {
      playSine(rt, a) { return a.length >= 4 ? tone(a[1], a[2], num(a[0]) / 100, !!a[3]) : tone(a[0], a[1], 1, true); },
      delay(rt, a) { return rt.sleep(num(a[0])); },
    },
    toString(rt, o) { return 'SoundPlayer[' + o.native.name + ']'; },
  });

  // ------------------------------------------------------------ Scanner (java.util) über Eingabedialog
  def('Scanner', { pkg: 'java.util', lib: false,
    ctor(rt, a) { const o = new JObject(rt.cls('Scanner')); o.native = { buf: [], src: typeof a[0] === 'string' ? a[0] : null }; if (o.native.src !== null) o.native.buf = o.native.src.split('\n'); return o; },
    methods: (() => {
      const line = (o, what) => { if (o.native.src !== null) { if (!o.native.buf.length) rt.throwJava('NoSuchElementException', 'No line found'); return o.native.buf.shift(); } return ask(gfx().lastLine() || what, 'Scanner'); };
      const token = (o, what) => {
        if (!o.native.tokens || !o.native.tokens.length) { let l; do { l = line(o, what); } while (!l.trim() && o.native.src === null && false); o.native.tokens = l.trim().split(/\s+/).filter(Boolean); if (!o.native.tokens.length) o.native.tokens = ['']; }
        return o.native.tokens.shift();
      };
      return {
        nextLine(rt, o) { if (o.native.tokens && o.native.tokens.length) { const r = o.native.tokens.join(' '); o.native.tokens = []; return r; } return line(o, 'Text eingeben:'); },
        next(rt, o) { return token(o, 'Wort eingeben:'); },
        nextInt(rt, o) { const s = token(o, 'Ganze Zahl eingeben:'); if (!/^[+-]?\d+$/.test(s)) rt.throwJava('InputMismatchException', `For input string: "${s}"`); return +s; },
        nextLong(rt, o) { const s = token(o, 'Ganze Zahl eingeben:'); if (!/^[+-]?\d+$/.test(s)) rt.throwJava('InputMismatchException', `For input string: "${s}"`); return BigInt(s); },
        nextDouble(rt, o) { const s = token(o, 'Zahl eingeben:').replace(',', '.'); if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) rt.throwJava('InputMismatchException', `For input string: "${s}"`); return D(parseFloat(s)); },
        nextBoolean(rt, o) { const s = token(o, 'true oder false eingeben:').toLowerCase(); if (s !== 'true' && s !== 'false') rt.throwJava('InputMismatchException', `For input string: "${s}"`); return s === 'true'; },
        hasNext(rt, o) { return o.native.src === null || o.native.buf.length > 0 || !!(o.native.tokens && o.native.tokens.length); },
        hasNextLine(rt, o) { return this.hasNext(rt, o); }, hasNextInt(rt, o) { return o.native.src === null || (o.native.tokens && /^[+-]?\d+$/.test(o.native.tokens[0] || '')) || /^\s*[+-]?\d+/.test(o.native.buf[0] || ''); }, hasNextDouble(rt, o) { return true; },
        close() { },
      };
    })(),
    retTypes: { nextLine: STRING, next: STRING, nextInt: INT, nextLong: T('long'), nextDouble: DOUBLE, nextBoolean: BOOL, hasNext: BOOL, hasNextLine: BOOL, hasNextInt: BOOL, hasNextDouble: BOOL, close: VOID },
  });
  { // Scanner über System.in: Eingabe erst, wenn die Grafik fertig ist (Programm pausiert)
    const sm = rt.cls('Scanner').native.methods;
    for (const k of ['nextLine', 'next', 'nextInt', 'nextLong', 'nextDouble', 'nextBoolean']) {
      const f = sm[k];
      sm[k] = function (rt, o, a, line) { return o.native.src !== null ? f.call(this, rt, o, a, line) : rt.afterGfx(() => f.call(this, rt, o, a, line)); };
    }
  }
  def('InputStream', { pkg: 'java.io', lib: false });
});
})(typeof window !== 'undefined' ? window : globalThis);
