/* Java-Werkbank – einfaches Swing (javax.swing, java.awt-Layouts).
   Der Interpreter hält ein Modell der Komponenten (Text, Zustand, Layout, Kinder) und
   schickt Änderungen an das Grafikfenster (gfx.swingWindow / gfx.swing). Das Fenster
   meldet Klicks und Eingaben zurück; ActionListener laufen wie andere Ereignisse. */
(function (global) {
'use strict';
const R = global.JavaRT;
const { JObject, JDouble, T } = R;
const INT = T('int'), DOUBLE = T('double'), BOOL = T('boolean'), STRING = T('String'), VOID = T('void');

R.Runtime.preludes.push({ pkg: 'java.awt.event', code: `
public interface ActionListener { void actionPerformed(ActionEvent e); }
public interface ItemListener { void itemStateChanged(ItemEvent e); }
public interface WindowListener { void windowOpened(WindowEvent e); void windowClosing(WindowEvent e); void windowClosed(WindowEvent e); void windowIconified(WindowEvent e); void windowDeiconified(WindowEvent e); void windowActivated(WindowEvent e); void windowDeactivated(WindowEvent e); }
public abstract class WindowAdapter implements WindowListener {
  public void windowOpened(WindowEvent e) { } public void windowClosing(WindowEvent e) { } public void windowClosed(WindowEvent e) { } public void windowIconified(WindowEvent e) { }
  public void windowDeiconified(WindowEvent e) { } public void windowActivated(WindowEvent e) { } public void windowDeactivated(WindowEvent e) { }
}
` }, { pkg: 'javax.swing.event', code: `
public interface ChangeListener { void stateChanged(ChangeEvent e); }
public interface ListSelectionListener { void valueChanged(ListSelectionEvent e); }
` });

R.Runtime.extensions.push(function (rt) {
  const def = (name, spec) => rt._def(name, { lib: true, ...spec });
  const gfx = () => rt.io.gfx || null;
  const num = (v) => rt.num(v);
  const int = (v) => Math.trunc(rt.num(v));
  const str = (v) => rt.str(v);
  const noop = () => undefined;
  const awt = () => rt.awt || { toColor: (v) => ({ css: 'black', obj: v }), fontCss: () => '12px sans-serif' };

  // ------------------------------------------------------------ Modell
  let nextId = 1;
  const byId = new Map();     // Komponenten-Nummer -> JObject
  const frames = new Set();   // offene Fenster (für Timer und „letztes Fenster zu“)
  const timers = new Set();
  function comp(o, kind, extra) {
    o.native = { id: nextId++, kind, text: '', enabled: true, visible: true, editable: true, selected: false, fg: null, bg: null, font: null, fontObj: null,
      bounds: null, pref: null, align: null, tip: null, border: null, children: [], layout: null, cons: null, parent: null, listeners: [], cmd: null, cols: 0, rows: 0, wrap: false, name: null,
      L: { mouse: [], motion: [], key: [], item: [], change: [], sel: [], win: [] }, items: null, sel: -1, min: 0, max: 100, value: 0, icon: null, group: null, focusable: null, size: null, self: o, ...extra };
    byId.set(o.native.id, o);
    return o.native;
  }
  const N = (o, line) => { if (!(o instanceof JObject) || !o.native || !o.native.kind) rt.rtError('Diese Swing-Komponente wurde nicht richtig erzeugt (fehlt super(…)?)', line); return o.native; };
  function frameOf(o) {
    for (let x = o; x; x = x.native.parent) if (x.native.frameObj) return x.native.frameObj;
    return null;
  }
  function ser(o) {
    const n = o.native;
    return { id: n.id, kind: n.kind, ...props(n), layout: n.layout, cons: n.cons, children: n.children.map(ser) };
  }
  function props(n) {
    return { text: n.text, enabled: n.enabled, visible: n.visible, editable: n.editable, selected: n.selected, fg: n.fg, bg: n.bg, font: n.font,
      bounds: n.bounds, pref: n.pref, align: n.align, tip: n.tip, border: n.border, cols: n.cols, rows: n.rows, wrap: n.wrap, opaque: n.opaque !== false,
      paint: !!paintTarget(n.self), mouse: n.L.mouse.length > 0, motion: n.L.motion.length > 0, key: n.L.key.length > 0, focusable: n.focusable,
      items: itemsOf(n), sel: n.sel, min: n.min, max: n.max, value: n.value, orient: n.orient || 0, labels: !!n.paintLabels, ticks: n.major || 0, stringPainted: !!n.stringPainted, string: n.string || null,
      icon: n.icon ? { url: n.icon.url, w: n.icon.w, h: n.icon.h } : null, group: n.group ? n.group.native.gid : null, accel: n.accel || null };
  }
  function itemsOf(n) {
    if (n.model) return n.model.native.list.map(v => v === null ? 'null' : str(v));
    return n.items ? n.items.map(v => v === null ? 'null' : str(v)) : null;
  }
  // Eigenes Zeichnen: überschriebenes paintComponent(Graphics) bzw. paint(Graphics) (auch paint im JFrame)
  const paintCache = new Map();
  function paintTarget(o) {
    if (!o) return null;
    const n = o.native;
    const find = (obj, names) => {
      for (const nm of names) { const m = rt.lookupMethods(obj.cls, nm).find(x => !x.abstract && !x.static && x.params.length === 1 && x.cls && !x.cls.builtin); if (m) return { obj, m }; }
      return null;
    };
    if (n.kind === 'frame' || n.kind === 'menubar' || n.kind === 'menu' || n.kind === 'menuitem') return null;
    if (n.content && n.frameObj) { const t = find(n.frameObj, ['paint']); if (t) return t; }
    if (o.cls.builtin) return null;
    return find(o, ['paintComponent', 'paint']);
  }
  function framePaints(f) { const out = []; const walk = (o) => { if (paintTarget(o)) out.push(o); for (const c of o.native.children) walk(c); }; walk(f.native.content); return out; }
  function schedulePaint(o) {
    const n = o.native;
    if (n.paintTimer) return;
    n.paintTimer = setTimeout(() => { n.paintTimer = 0; doPaint(o); }, 0);
  }
  function doPaint(o) {
    const n = o.native;
    const f = frameOf(o); if (!f || !f.native.win || !f.native.shown) return;
    const t = paintTarget(o); if (!t || !n.size) return;
    if (n.painting && Date.now() - n.painting < 3000) { n.again = true; return; }
    n.painting = Date.now();
    const g = graphics(o);
    const win = f.native.win;
    const done = () => {
      n.painting = 0; g.native.done = true;
      const gx = gfx(); if (gx && gx.swing && f.native.win === win) gx.swing(win, { t: 'paint', id: n.id, ops: g.native.ops });
      if (n.again) { n.again = false; schedulePaint(o); }
    };
    rt.fireGen(() => (function* () { try { yield* rt.callMethodG(t.obj, t.m, [g]); } finally { done(); } })(), 'paintComponent');
  }
  // Änderung an das Fenster melden (nur wenn es gerade angezeigt wird)
  function changed(o, structural) {
    const f = frameOf(o); if (!f) return;
    const F = f.native; if (!F.win || !F.shown) return;
    const g = gfx(); if (!g || !g.swing) return;
    if (structural || o === f) g.swing(F.win, treeOp(F));
    else g.swing(F.win, { t: 'prop', id: o.native.id, props: props(o.native) });
  }
  function addChild(parent, child, cons, index, line) {
    const P = N(parent, line);
    if (child === null) rt.npe('Komponente ist null');
    const C = N(child, line);
    if (C.kind === 'frame') rt.throwJava('IllegalArgumentException', 'Ein Fenster (JFrame) kann nicht in einen Container gelegt werden');
    for (let x = parent; x; x = x.native.parent) if (x === child) rt.throwJava('IllegalArgumentException', 'Ein Container kann nicht in sich selbst gelegt werden');
    if (C.parent) { const L = C.parent.native.children; const i = L.indexOf(child); if (i >= 0) L.splice(i, 1); changed(C.parent, true); }
    C.parent = parent;
    if (P.layout && P.layout.k === 'border') {
      const where = cons === undefined || cons === null ? 'Center' : typeof cons === 'string' ? cons : null;
      if (!where || !['North', 'South', 'East', 'West', 'Center'].includes(where)) rt.throwJava('IllegalArgumentException', 'cannot add to layout: unknown constraint: ' + (typeof cons === 'string' ? cons : str(cons)));
      // BorderLayout: pro Bereich nur eine Komponente (die neue ersetzt die alte)
      for (const old of P.children.filter(k => (k.native.cons || 'Center') === where)) { P.children.splice(P.children.indexOf(old), 1); old.native.parent = null; }
      C.cons = where;
    } else C.cons = null;
    if (typeof index === 'number' && index >= 0 && index <= P.children.length) P.children.splice(index, 0, child); else P.children.push(child);
    changed(parent, true);
    return child;
  }
  const treeOp = (F) => ({ t: 'tree', root: ser(F.content), menu: F.menubar ? ser(F.menubar) : null });
  function layoutOf(v, line) {
    if (v === null) return { k: 'null' };
    if (!(v instanceof JObject) || !v.native || !v.native.layoutKind) rt.rtError('Hier wird ein Layout erwartet, z. B. new FlowLayout(), new BorderLayout() oder new GridLayout(2, 3)', line);
    return { ...v.native.spec };
  }
  function actionEvent(src, cmd) { const e = new JObject(rt.cls('ActionEvent')); e.native = { src, cmd }; return e; }
  function fireAction(o, cmd) {
    const n = o.native;
    for (const l of n.listeners.slice()) rt.fireEvent(l, 'actionPerformed', [actionEvent(o, cmd)], 'actionPerformed');
  }
  function addAction(o, v, line) {
    const iface = rt.cls('ActionListener');
    if (v === null || v === undefined) rt.npe('Listener ist null');
    if (v instanceof JObject && v.lambda) rt.coerce(v, T('ActionListener'), line);
    if (!(v instanceof JObject) || !v.cls.isSubclassOf(iface)) rt.rtError('Hier wird ein Objekt erwartet, das ActionListener implementiert (z. B. „implements ActionListener“ und dann „this“ übergeben, oder ein Lambda e -> …)', line);
    const L = N(o, line).listeners; if (!L.includes(v)) L.push(v);
  }
  const color = (v, line) => v === null ? null : awt().toColor(v, line);
  // Weitere Listener (Maus, Tastatur, Auswahl, Fenster …): Prüfung wie bei addActionListener
  const LKIND = { mouse: 'MouseListener', motion: 'MouseMotionListener', key: 'KeyListener', item: 'ItemListener', change: 'ChangeListener', sel: 'ListSelectionListener', win: 'WindowListener' };
  function addL(o, kind, v, line) {
    const name = LKIND[kind], iface = rt.cls(name);
    if (v === null || v === undefined) rt.npe('Listener ist null');
    if (v instanceof JObject && v.lambda) {
      if (!rt.functionalMethod(iface)) rt.rtError(`${name} hat mehrere Methoden – ein Lambda-Ausdruck geht nur bei Interfaces mit genau einer Methode; verwende eine (anonyme) Klasse, z. B. new ${name === 'MouseListener' || name === 'MouseMotionListener' ? 'MouseAdapter' : name === 'KeyListener' ? 'KeyAdapter' : name === 'WindowListener' ? 'WindowAdapter' : name}() { … }`, line);
      rt.coerce(v, T(name), line);
    }
    if (!(v instanceof JObject) || !v.cls.isSubclassOf(iface)) rt.rtError(`Hier wird ein Objekt erwartet, das ${name} implementiert`, line);
    const L = N(o, line).L[kind]; if (!L.includes(v)) L.push(v);
    if (kind === 'mouse' || kind === 'motion' || kind === 'key') changed(o, true);
  }
  function removeL(o, kind, v, line) { const L = N(o, line).L[kind]; const i = L.indexOf(v); if (i >= 0) L.splice(i, 1); }
  function fireList(o, kind, name, mkArgs) { const L = o.native.L[kind]; if (!L.length) return; for (const l of L.slice()) rt.fireEvent(l, name, mkArgs(), name); }
  const modMask = (ev) => (ev.shift ? 1 : 0) | (ev.ctrl ? 2 : 0) | (ev.meta ? 4 : 0) | (ev.alt ? 8 : 0);
  function mouseEvent(src, ev) { const e = new JObject(rt.cls('MouseEvent')); e.native = { x: ev.x, y: ev.y, button: ev.button || 0, clicks: ev.clicks || 0, mods: modMask(ev), src, when: Date.now() }; return e; }
  function keyEvent(src, ev, typed) { const e = new JObject(rt.cls('KeyEvent')); e.native = { code: typed ? 0 : ev.code, ch: ev.ch, mods: modMask(ev), src, when: Date.now() }; return e; }
  function simpleEvent(cls, src, extra) { const e = new JObject(rt.cls(cls)); e.native = { src, ...extra }; return e; }
  const windowEvent = (f, id) => simpleEvent('WindowEvent', f, { id });
  const itemEvent = (src, item, state) => simpleEvent('ItemEvent', src, { item, state });
  function selectRadio(o) {
    const n = o.native; n.selected = true;
    if (n.group) for (const b of n.group.native.buttons) if (b !== o && b.native.selected) { b.native.selected = false; changed(b); fireList(b, 'item', 'itemStateChanged', () => [itemEvent(b, b, 2)]); }
    changed(o);
  }
  const MOUSE = { press: 'mousePressed', release: 'mouseReleased', click: 'mouseClicked', enter: 'mouseEntered', exit: 'mouseExited' };

  // Ereignisse aus dem Fenster
  function onEvent(frame, ev) {
    const F = frame.native;
    const o = ev.id !== undefined ? byId.get(ev.id) : null;
    switch (ev.type) {
      case 'text': if (o) o.native.text = String(ev.text); return;
      case 'check': if (o) { o.native.selected = !!ev.value; fireList(o, 'item', 'itemStateChanged', () => [itemEvent(o, o, ev.value ? 1 : 2)]); fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'radio': if (o && !o.native.selected) { selectRadio(o); fireList(o, 'item', 'itemStateChanged', () => [itemEvent(o, o, 1)]); fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'menu': if (o && o.native.enabled) { if (o.native.kind === 'checkmenu') { o.native.selected = !o.native.selected; changed(o); } else if (o.native.kind === 'radiomenu') selectRadio(o); fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'select': if (o) setSel(o, ev.index, true); return;
      case 'slide': if (o && o.native.value !== ev.value) { o.native.value = ev.value; fireList(o, 'change', 'stateChanged', () => [simpleEvent('ChangeEvent', o)]); } return;
      case 'size': if (o) { o.native.size = { w: ev.w, h: ev.h }; if (paintTarget(o)) schedulePaint(o); } return;
      case 'mouse': {
        if (!o) return;
        const me = () => [mouseEvent(o, ev)];
        if (MOUSE[ev.kind]) fireList(o, 'mouse', MOUSE[ev.kind], me);
        else if (ev.kind === 'move') fireList(o, 'motion', 'mouseMoved', me);
        else if (ev.kind === 'drag') fireList(o, 'motion', 'mouseDragged', me);
        return;
      }
      case 'key': {
        // Taste an die Komponente mit Fokus; hat sie keinen KeyListener, an die übergeordneten (bis zum Fenster)
        let t = o || frame;
        const isText = t && ['textfield', 'password', 'textarea'].includes(t.native.kind);
        while (t && !t.native.L.key.length && !isText) t = t.native.parent || (t.native.frameObj && t.native.frameObj !== t ? t.native.frameObj : null);
        if (!t || !t.native.L.key.length) return;
        const name = ev.kind === 'keydown' ? 'keyPressed' : ev.kind === 'keyup' ? 'keyReleased' : 'keyTyped';
        fireList(t, 'key', name, () => [keyEvent(t, ev, ev.kind === 'typed')]);
        return;
      }
      case 'action': if (o && o.native.enabled) { if (ev.text !== undefined) o.native.text = String(ev.text); fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'closing':
        fireList(frame, 'win', 'windowClosing', () => [windowEvent(frame, 201)]);
        if (F.closeOp === 0) return true;   // DO_NOTHING_ON_CLOSE
        return false;
      case 'closed':
        F.shown = false; F.visible = false; F.win = null; frames.delete(frame);
        fireList(frame, 'win', 'windowClosed', () => [windowEvent(frame, 202)]);
        if (F.closeOp === 3 || !frames.size) stopTimers();   // EXIT_ON_CLOSE (bzw. letztes Fenster): Timer anhalten
        return;
    }
  }
  function stopTimers() { for (const t of timers) { clearInterval(t.native.handle); clearTimeout(t.native.handle); t.native.running = false; } timers.clear(); }
  function show(frame, on) {
    const F = frame.native;
    F.visible = on;
    const g = gfx();
    if (!g || !g.swingWindow) { F.shown = on; return; }
    if (on) {
      if (!F.win) {
        F.win = g.swingWindow({ title: F.title, w: F.w, h: F.h, packed: F.packed });
        if (g.listen) g.listen(F.win, (ev) => onEvent(frame, ev));
      }
      F.shown = true; frames.add(frame);
      g.swing(F.win, treeOp(F));
      g.swing(F.win, { t: 'show' });
      if (!F.opened) { F.opened = true; fireList(frame, 'win', 'windowOpened', () => [windowEvent(frame, 200)]); }
    } else if (F.win) { const w = F.win; F.win = null; F.shown = false; frames.delete(frame); g.swing(w, { t: 'close' }); }
  }

  // ------------------------------------------------------------ Gemeinsame Methoden
  const sizeOf = (n) => n.size ? n.size : n.bounds ? { w: n.bounds.w, h: n.bounds.h } : n.pref ? { w: n.pref.w, h: n.pref.h } : { w: 0, h: 0 };
  const componentMethods = {
    setBounds(rt, o, a, line) { const n = N(o, line); n.bounds = { x: int(a[0]), y: int(a[1]), w: int(a[2]), h: int(a[3]) }; changed(o); },
    setLocation(rt, o, a, line) { const n = N(o, line); const b = n.bounds || { x: 0, y: 0, w: sizeOf(n).w || 80, h: sizeOf(n).h || 24 }; n.bounds = { ...b, x: int(a[0]), y: int(a[1]) }; changed(o); },
    setSize(rt, o, a, line) { const n = N(o, line); const w = a.length === 1 ? dimOf(a[0], line).w : int(a[0]), h = a.length === 1 ? dimOf(a[0], line).h : int(a[1]); if (n.bounds) n.bounds = { ...n.bounds, w, h }; else n.pref = { w, h }; changed(o); },
    setPreferredSize(rt, o, a, line) { const n = N(o, line); n.pref = a[0] === null ? null : dimOf(a[0], line); changed(o); },
    setMinimumSize: noop, setMaximumSize: noop,
    getPreferredSize(rt, o, a, line) { const n = N(o, line); const s = n.pref || sizeOf(n); return dimension(s.w, s.h); },
    getSize(rt, o, a, line) { const s = sizeOf(N(o, line)); return dimension(s.w, s.h); },
    getWidth(rt, o, a, line) { return sizeOf(N(o, line)).w; }, getHeight(rt, o, a, line) { return sizeOf(N(o, line)).h; },
    getX(rt, o, a, line) { const b = N(o, line).bounds; return b ? b.x : 0; }, getY(rt, o, a, line) { const b = N(o, line).bounds; return b ? b.y : 0; },
    setForeground(rt, o, a, line) { const n = N(o, line); const c = color(a[0], line); n.fg = c && c.css; n.fgObj = a[0]; changed(o); },
    setBackground(rt, o, a, line) { const n = N(o, line); const c = color(a[0], line); n.bg = c && c.css; n.bgObj = a[0]; changed(o); },
    getForeground(rt, o, a, line) { return N(o, line).fgObj || null; }, getBackground(rt, o, a, line) { return N(o, line).bgObj || null; },
    setFont(rt, o, a, line) { const n = N(o, line); n.fontObj = a[0]; n.font = a[0] && a[0].native ? awt().fontCss(a[0].native) : null; changed(o); },
    getFont(rt, o, a, line) { return N(o, line).fontObj || null; },
    setEnabled(rt, o, a, line) { N(o, line).enabled = !!a[0]; changed(o); }, isEnabled(rt, o, a, line) { return N(o, line).enabled; },
    setVisible(rt, o, a, line) { N(o, line).visible = !!a[0]; changed(o); }, isVisible(rt, o, a, line) { return N(o, line).visible; },
    setToolTipText(rt, o, a, line) { N(o, line).tip = a[0] === null ? null : str(a[0]); changed(o); }, getToolTipText(rt, o, a, line) { return N(o, line).tip; },
    setOpaque(rt, o, a, line) { N(o, line).opaque = !!a[0]; changed(o); },
    setBorder(rt, o, a, line) { const n = N(o, line); n.border = a[0] && a[0].native ? { ...a[0].native.border } : null; changed(o); },
    setName(rt, o, a, line) { N(o, line).name = a[0] === null ? null : str(a[0]); }, getName(rt, o, a, line) { return N(o, line).name; },
    getParent(rt, o, a, line) { return N(o, line).parent; },
    requestFocus(rt, o, a, line) { const f = frameOf(o); const g = gfx(); if (f && f.native.win && g && g.swing) g.swing(f.native.win, { t: 'focus', id: N(o, line).id }); },
    requestFocusInWindow(rt, o, a, line) { componentMethods.requestFocus(rt, o, a, line); return true; },
    repaint(rt, o, a, line) { const n = N(o, line); if (n.kind === 'frame') { for (const p of framePaints(o)) schedulePaint(p); } else { if (paintTarget(o)) schedulePaint(o); const walk = (x) => { for (const c of x.native.children) { if (paintTarget(c)) schedulePaint(c); walk(c); } }; walk(o); } },
    revalidate: noop, validate: noop, invalidate: noop, setAlignmentX: noop, setAlignmentY: noop, setCursor: noop, setDoubleBuffered: noop, setIgnoreRepaint: noop,
    setFocusable(rt, o, a, line) { N(o, line).focusable = !!a[0]; changed(o); }, isFocusable(rt, o, a, line) { return N(o, line).focusable !== false; },
    addMouseListener(rt, o, a, line) { addL(o, 'mouse', a[0], line); }, removeMouseListener(rt, o, a, line) { removeL(o, 'mouse', a[0], line); },
    addMouseMotionListener(rt, o, a, line) { addL(o, 'motion', a[0], line); }, removeMouseMotionListener(rt, o, a, line) { removeL(o, 'motion', a[0], line); },
    addKeyListener(rt, o, a, line) { addL(o, 'key', a[0], line); }, removeKeyListener(rt, o, a, line) { removeL(o, 'key', a[0], line); },
    addMouseWheelListener() { rt.rtError('addMouseWheelListener() wird in der Web-Version nicht unterstützt'); },
    // super.paintComponent(g) / super.paint(g): Hintergrund füllen
    paintComponent(rt, o, a, line) { const g = a[0]; if (g && g.native && g.native.ops) { const n = N(o, line); g.native.ops.push(['bg', n.bg && n.opaque !== false ? n.bg : n.kind === 'panel' || n.content ? '#eeeeee' : null]); } },
    paint(rt, o, a, line) { componentMethods.paintComponent(rt, o, a, line); },
    paintComponents: noop, paintChildren: noop, paintBorder: noop, update(rt, o, a, line) { componentMethods.paintComponent(rt, o, a, line); },
    getGraphics() { rt.rtError('getGraphics() wird in der Web-Version nicht unterstützt – zeichne in paintComponent(Graphics g) und rufe repaint() auf'); },
  };
  const componentRet = { isFocusable: BOOL, getWidth: INT, getHeight: INT, getX: INT, getY: INT, isEnabled: BOOL, isVisible: BOOL, getToolTipText: STRING, getName: STRING, getForeground: T('Color'), getBackground: T('Color'), getFont: T('Font'), getParent: T('Container'), getPreferredSize: T('Dimension'), getSize: T('Dimension'), requestFocusInWindow: BOOL };
  const containerMethods = {
    add(rt, o, a, line) {
      // add(comp), add(comp, constraint), add(comp, index), add(String name, comp)
      if (typeof a[0] === 'string' && a.length === 2) return addChild(o, a[1], a[0], undefined, line);
      if (a.length === 2 && typeof a[1] === 'number') return addChild(o, a[0], undefined, a[1], line);
      return addChild(o, a[0], a[1], undefined, line);
    },
    remove(rt, o, a, line) {
      const P = N(o, line);
      const c = typeof a[0] === 'number' ? P.children[a[0]] : a[0];
      const i = P.children.indexOf(c); if (i >= 0) { P.children.splice(i, 1); c.native.parent = null; changed(o, true); }
    },
    removeAll(rt, o, a, line) { const P = N(o, line); for (const c of P.children) c.native.parent = null; P.children = []; changed(o, true); },
    setLayout(rt, o, a, line) { const P = N(o, line); P.layout = layoutOf(a[0], line); changed(o, true); },
    getComponentCount(rt, o, a, line) { return N(o, line).children.length; },
    getComponent(rt, o, a, line) { const L = N(o, line).children, i = int(a[0]); if (i < 0 || i >= L.length) rt.throwJava('ArrayIndexOutOfBoundsException', 'No such child: ' + i); return L[i]; },
    getComponents(rt, o, a, line) { return new R.JArray(T('Component'), N(o, line).children.slice()); },
  };
  const containerRet = { getComponentCount: INT, getComponent: T('Component'), getComponents: T('Component', 1), add: T('Component') };
  const textOf = { getText(rt, o, a, line) { return N(o, line).text; }, setText(rt, o, a, line) { N(o, line).text = a[0] === null ? '' : str(a[0]); changed(o); } };
  const SC = { LEFT: 2, CENTER: 0, RIGHT: 4, TOP: 1, BOTTOM: 3, LEADING: 10, TRAILING: 11, HORIZONTAL: 0, VERTICAL: 1 };
  const intTypes = (x) => { const t = {}; for (const k of Object.keys(x)) t[k] = INT; return t; };
  const alignName = (v) => ({ 2: 'left', 10: 'left', 0: 'center', 4: 'right', 11: 'right' })[v] || null;
  // Komponente mit eigenem Konstruktor (auch als Oberklasse: class MeinKnopf extends JButton)
  function compClass(name, superName, kind, init, spec) {
    def(name, {
      pkg: 'javax.swing', superName, extendable: true,
      ctor(rt, a, line) { const o = new JObject(rt.cls(name)); this.initInstance(rt, o, a, line); return o; },
      initInstance(rt, o, a, line) { const n = comp(o, kind); if (init) init(n, a, line, o); },
      toString(rt, o) { const n = o.native; return `${o.cls.fullName}[${n.text !== '' ? 'text=' + n.text : 'id=' + n.id}]`; },
      inspectRows(rt, o) { const n = o.native; const r = []; if (['label', 'button', 'textfield', 'textarea', 'checkbox'].includes(n.kind)) r.push({ name: 'Text', type: 'String', value: n.text }); if (n.kind === 'checkbox') r.push({ name: 'ausgewählt', type: 'boolean', value: n.selected }); r.push({ name: 'aktiv', type: 'boolean', value: n.enabled }); if (n.children.length) r.push({ name: 'Komponenten', type: 'int', value: n.children.length }); return r; },
      ...spec,
    });
  }

  // ------------------------------------------------------------ Klassen
  def('Component', { pkg: 'java.awt', isAbstract: true, methods: componentMethods, retTypes: componentRet });
  def('Container', { pkg: 'java.awt', superName: 'Component', isAbstract: true, methods: containerMethods, retTypes: containerRet });
  def('JComponent', { pkg: 'javax.swing', superName: 'Container', isAbstract: true });
  compClass('JPanel', 'JComponent', 'panel', (n, a, line) => { n.layout = a.length && a[0] !== true && a[0] !== false ? layoutOf(a[0], line) : { k: 'flow', align: 1, hgap: 5, vgap: 5 }; });
  compClass('JLabel', 'JComponent', 'label', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.icon = iconIn(a); const al = a.find(v => typeof v === 'number'); if (al !== undefined) n.align = alignName(al); }, {
    sfields: SC, sfieldTypes: intTypes(SC),
    methods: { ...textOf, setHorizontalAlignment(rt, o, a, line) { N(o, line).align = alignName(int(a[0])); changed(o); }, setVerticalAlignment: noop, setIcon(rt, o, a, line) { N(o, line).icon = a[0] === null ? null : iconOf(a[0], line); changed(o); }, getIcon(rt, o, a, line) { const n = N(o, line); return n.icon ? n.icon.obj : null; }, setLabelFor: noop, setHorizontalTextPosition: noop, setVerticalTextPosition: noop },
    retTypes: { getText: STRING, getIcon: T('ImageIcon') },
  });
  def('AbstractButton', { pkg: 'javax.swing', superName: 'JComponent', isAbstract: true,
    methods: { ...textOf, addActionListener(rt, o, a, line) { addAction(o, a[0], line); }, removeActionListener(rt, o, a, line) { const L = N(o, line).listeners; const i = L.indexOf(a[0]); if (i >= 0) L.splice(i, 1); },
      setActionCommand(rt, o, a, line) { N(o, line).cmd = a[0] === null ? null : str(a[0]); }, getActionCommand(rt, o, a, line) { const n = N(o, line); return n.cmd !== null ? n.cmd : n.text; },
      isSelected(rt, o, a, line) { return N(o, line).selected; },
      setSelected(rt, o, a, line) { const n = N(o, line); const v = !!a[0]; if (v === n.selected) return; if (v && n.group) selectRadio(o); else { n.selected = v; changed(o); } fireList(o, 'item', 'itemStateChanged', () => [itemEvent(o, o, v ? 1 : 2)]); },
      doClick(rt, o, a, line) { const n = N(o, line); if (n.kind === 'checkbox' || n.kind === 'toggle' || n.kind === 'checkmenu') { n.selected = !n.selected; changed(o); } else if (n.kind === 'radio' || n.kind === 'radiomenu') selectRadio(o); fireAction(o, n.cmd !== null ? n.cmd : n.text); },
      setMnemonic: noop, setIcon(rt, o, a, line) { N(o, line).icon = a[0] === null ? null : iconOf(a[0], line); changed(o); }, getIcon(rt, o, a, line) { const n = N(o, line); return n.icon ? n.icon.obj : null; },
      addItemListener(rt, o, a, line) { addL(o, 'item', a[0], line); }, removeItemListener(rt, o, a, line) { removeL(o, 'item', a[0], line); },
      setAccelerator(rt, o, a, line) { const k = a[0]; N(o, line).accel = k && k.native ? k.native.text : null; changed(o); }, setFocusPainted: noop, setBorderPainted: noop, setContentAreaFilled: noop, setHorizontalAlignment: noop },
    retTypes: { getText: STRING, getActionCommand: STRING, isSelected: BOOL } });
  compClass('JButton', 'AbstractButton', 'button', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.icon = iconIn(a); });
  compClass('JToggleButton', 'AbstractButton', 'toggle', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.icon = iconIn(a); n.selected = a.some(v => v === true); });
  compClass('JRadioButton', 'AbstractButton', 'radio', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.selected = a.some(v => v === true); });
  compClass('JCheckBox', 'AbstractButton', 'checkbox', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.selected = a.some(v => v === true); });
  def('JTextComponent', { pkg: 'javax.swing.text', superName: 'JComponent', isAbstract: true,
    methods: { ...textOf, setEditable(rt, o, a, line) { N(o, line).editable = !!a[0]; changed(o); }, isEditable(rt, o, a, line) { return N(o, line).editable; },
      selectAll(rt, o, a, line) { const f = frameOf(o); const g = gfx(); if (f && f.native.win && g && g.swing) g.swing(f.native.win, { t: 'select', id: N(o, line).id }); },
      setCaretPosition: noop, getCaretPosition(rt, o, a, line) { return N(o, line).text.length; }, setCaretColor: noop, setSelectionColor: noop, copy: noop, paste: noop, cut: noop },
    retTypes: { getText: STRING, isEditable: BOOL, getCaretPosition: INT } });
  compClass('JTextField', 'JTextComponent', 'textfield', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; const c = a.find(v => typeof v === 'number'); n.cols = c !== undefined ? c : 0; }, {
    sfields: SC, sfieldTypes: intTypes(SC),
    methods: { addActionListener(rt, o, a, line) { addAction(o, a[0], line); }, removeActionListener(rt, o, a, line) { const L = N(o, line).listeners; const i = L.indexOf(a[0]); if (i >= 0) L.splice(i, 1); },
      setActionCommand(rt, o, a, line) { N(o, line).cmd = a[0] === null ? null : str(a[0]); },
      setColumns(rt, o, a, line) { N(o, line).cols = int(a[0]); changed(o); }, getColumns(rt, o, a, line) { return N(o, line).cols; },
      setHorizontalAlignment(rt, o, a, line) { N(o, line).align = alignName(int(a[0])); changed(o); } },
    retTypes: { getColumns: INT } });
  compClass('JPasswordField', 'JTextField', 'password', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; const c = a.find(v => typeof v === 'number'); n.cols = c !== undefined ? c : 0; }, {
    methods: { getPassword(rt, o, a, line) { return new R.JArray(T('char'), [...N(o, line).text].map(ch => new R.JChar(ch.charCodeAt(0)))); }, setEchoChar: noop },
    retTypes: { getPassword: T('char', 1) } });
  compClass('JTextArea', 'JTextComponent', 'textarea', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; const ns = a.filter(v => typeof v === 'number'); if (ns.length >= 2) { n.rows = ns[0]; n.cols = ns[1]; } }, {
    methods: { append(rt, o, a, line) { const n = N(o, line); n.text += a[0] === null ? 'null' : str(a[0]); changed(o); },
      setLineWrap(rt, o, a, line) { N(o, line).wrap = !!a[0]; changed(o); }, setWrapStyleWord: noop, setTabSize: noop,
      setRows(rt, o, a, line) { N(o, line).rows = int(a[0]); changed(o); }, setColumns(rt, o, a, line) { N(o, line).cols = int(a[0]); changed(o); },
      getLineCount(rt, o, a, line) { return N(o, line).text.split('\n').length; } },
    retTypes: { getLineCount: INT } });
  compClass('JScrollPane', 'JComponent', 'scroll', (n, a, line, o) => { n.layout = { k: 'scroll' }; if (a[0] instanceof JObject && a[0].native && a[0].native.kind) addChild(o, a[0], undefined, undefined, line); }, {
    sfields: { VERTICAL_SCROLLBAR_ALWAYS: 22, VERTICAL_SCROLLBAR_AS_NEEDED: 20, VERTICAL_SCROLLBAR_NEVER: 21, HORIZONTAL_SCROLLBAR_ALWAYS: 32, HORIZONTAL_SCROLLBAR_AS_NEEDED: 30, HORIZONTAL_SCROLLBAR_NEVER: 31 },
    sfieldTypes: intTypes({ VERTICAL_SCROLLBAR_ALWAYS: 0, VERTICAL_SCROLLBAR_AS_NEEDED: 0, VERTICAL_SCROLLBAR_NEVER: 0, HORIZONTAL_SCROLLBAR_ALWAYS: 0, HORIZONTAL_SCROLLBAR_AS_NEEDED: 0, HORIZONTAL_SCROLLBAR_NEVER: 0 }),
    methods: { setViewportView(rt, o, a, line) { containerMethods.removeAll(rt, o, [], line); addChild(o, a[0], undefined, undefined, line); }, setVerticalScrollBarPolicy: noop, setHorizontalScrollBarPolicy: noop } });

  // JFrame: Fenster mit Inhaltsbereich (BorderLayout wie in Java)
  const WC = { DO_NOTHING_ON_CLOSE: 0, HIDE_ON_CLOSE: 1, DISPOSE_ON_CLOSE: 2, EXIT_ON_CLOSE: 3 };
  const FR = (o, line) => { const n = N(o, line); if (n.kind !== 'frame') rt.rtError('Kein Fenster', line); return n; };
  const frameMethods = {
    getContentPane(rt, o, a, line) { return FR(o, line).content; },
    setContentPane(rt, o, a, line) { const F = FR(o, line); const c = a[0]; N(c, line); F.content.native.frameObj = null; F.content = c; c.native.frameObj = o; c.native.parent = null; changed(o, true); },
    add(rt, o, a, line) { return containerMethods.add(rt, FR(o, line).content, a, line); },
    remove(rt, o, a, line) { return containerMethods.remove(rt, FR(o, line).content, a, line); },
    removeAll(rt, o, a, line) { return containerMethods.removeAll(rt, FR(o, line).content, a, line); },
    setLayout(rt, o, a, line) { return containerMethods.setLayout(rt, FR(o, line).content, a, line); },
    getComponentCount(rt, o, a, line) { return FR(o, line).content.native.children.length; },
    setTitle(rt, o, a, line) { const F = FR(o, line); F.title = a[0] === null ? '' : str(a[0]); const g = gfx(); if (F.win && g && g.swing) g.swing(F.win, { t: 'title', s: F.title }); },
    getTitle(rt, o, a, line) { return FR(o, line).title; },
    setSize(rt, o, a, line) { const F = FR(o, line); const d = a.length === 1 ? dimOf(a[0], line) : { w: int(a[0]), h: int(a[1]) }; F.w = Math.max(60, Math.min(1600, d.w)); F.h = Math.max(40, Math.min(1200, d.h)); F.packed = false; const g = gfx(); if (F.win && g && g.swing) g.swing(F.win, { t: 'size', w: F.w, h: F.h }); },
    setBounds(rt, o, a, line) { frameMethods.setSize(rt, o, [a[2], a[3]], line); },
    pack(rt, o, a, line) { const F = FR(o, line); F.packed = true; const g = gfx(); if (F.win && g && g.swing) g.swing(F.win, { t: 'size', packed: true }); },
    getWidth(rt, o, a, line) { return FR(o, line).w; }, getHeight(rt, o, a, line) { return FR(o, line).h; },
    setVisible(rt, o, a, line) { show(o, !!a[0]); }, isVisible(rt, o, a, line) { return FR(o, line).visible; },
    dispose(rt, o, a, line) { show(o, false); },
    setDefaultCloseOperation(rt, o, a, line) { const v = int(a[0]); if (v < 0 || v > 3) rt.throwJava('IllegalArgumentException', 'defaultCloseOperation must be one of: DO_NOTHING_ON_CLOSE, DISPOSE_ON_CLOSE, HIDE_ON_CLOSE, or EXIT_ON_CLOSE'); FR(o, line).closeOp = v; },
    getDefaultCloseOperation(rt, o, a, line) { return FR(o, line).closeOp; },
    setBackground(rt, o, a, line) { componentMethods.setBackground(rt, FR(o, line).content, a, line); },
    setLocationRelativeTo: noop, setLocation: noop, setResizable: noop, setAlwaysOnTop: noop, toFront: noop, setIconImage: noop, setExtendedState: noop, setUndecorated: noop,
    setJMenuBar(rt, o, a, line) { const F = FR(o, line); if (F.menubar) F.menubar.native.parent = null; F.menubar = a[0]; if (a[0]) { N(a[0], line); a[0].native.parent = o; } changed(o, true); },
    getJMenuBar(rt, o, a, line) { return FR(o, line).menubar || null; },
    addWindowListener(rt, o, a, line) { addL(o, 'win', a[0], line); }, removeWindowListener(rt, o, a, line) { removeL(o, 'win', a[0], line); },
    addMouseListener(rt, o, a, line) { addL(FR(o, line).content, 'mouse', a[0], line); }, addMouseMotionListener(rt, o, a, line) { addL(FR(o, line).content, 'motion', a[0], line); },
    addKeyListener(rt, o, a, line) { addL(o, 'key', a[0], line); },
    getRootPane(rt, o, a, line) { return FR(o, line).content; },
  };
  def('JFrame', { pkg: 'javax.swing', superName: 'Container', extendable: true, sfields: WC, sfieldTypes: intTypes(WC),
    ctor(rt, a, line) { const o = new JObject(rt.cls('JFrame')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a, line) {
      const F = comp(o, 'frame', { title: typeof a[0] === 'string' ? a[0] : '', w: 0, h: 0, packed: true, closeOp: 1, win: null, shown: false, frameObj: o });
      F.visible = false;
      const c = new JObject(rt.cls('JPanel')); const C = comp(c, 'panel'); C.layout = { k: 'border', hgap: 0, vgap: 0 }; C.frameObj = o; C.content = true;
      F.content = c;
    },
    methods: frameMethods,
    retTypes: { getJMenuBar: T('JMenuBar'), getContentPane: T('Container'), getTitle: STRING, getWidth: INT, getHeight: INT, isVisible: BOOL, getDefaultCloseOperation: INT, getComponentCount: INT, add: T('Component'), getRootPane: T('Container') },
    toString(rt, o) { const F = o.native; return `${o.cls.fullName}[title=${F.title},${F.visible ? 'sichtbar' : 'unsichtbar'}]`; },
    inspectRows(rt, o) { const F = o.native; return [{ name: 'Titel', type: 'String', value: F.title }, { name: 'sichtbar', type: 'boolean', value: F.visible }, { name: 'Komponenten', type: 'int', value: F.content.native.children.length }]; },
  });

  // Layouts
  const layout = (name, k, mk, sfields) => def(name, { pkg: 'java.awt', sfields, sfieldTypes: sfields ? Object.fromEntries(Object.keys(sfields).map(x => [x, typeof sfields[x] === 'string' ? STRING : INT])) : undefined,
    ctor(rt, a, line) { const o = new JObject(rt.cls(name)); o.native = { layoutKind: k, spec: { k, ...mk(a.map(v => typeof v === 'number' ? v : 0), line) } }; return o; },
    methods: { setHgap(rt, o, a) { o.native.spec.hgap = int(a[0]); }, setVgap(rt, o, a) { o.native.spec.vgap = int(a[0]); }, setAlignment(rt, o, a) { o.native.spec.align = int(a[0]); } },
    toString(rt, o) { const s = o.native.spec; return `java.awt.${name}[hgap=${s.hgap},vgap=${s.vgap}${s.k === 'grid' ? `,rows=${s.rows},cols=${s.cols}` : ''}]`; } });
  layout('FlowLayout', 'flow', (a) => ({ align: a.length ? a[0] : 1, hgap: a.length > 1 ? a[1] : 5, vgap: a.length > 2 ? a[2] : 5 }), { LEFT: 0, CENTER: 1, RIGHT: 2, LEADING: 3, TRAILING: 4 });
  layout('BorderLayout', 'border', (a) => ({ hgap: a[0] || 0, vgap: a[1] || 0 }), { NORTH: 'North', SOUTH: 'South', EAST: 'East', WEST: 'West', CENTER: 'Center', PAGE_START: 'North', PAGE_END: 'South', LINE_START: 'West', LINE_END: 'East' });
  layout('GridLayout', 'grid', (a, line) => {
    const rows = a.length ? a[0] : 1, cols = a.length > 1 ? a[1] : 0;
    if (rows === 0 && cols === 0) rt.throwJava('IllegalArgumentException', 'rows and cols cannot both be zero');
    return { rows, cols, hgap: a[2] || 0, vgap: a[3] || 0 };
  });

  // Dimension
  function dimension(w, h) { const o = new JObject(rt.cls('Dimension')); o.native = { w, h }; return o; }
  function dimOf(v, line) { if (!(v instanceof JObject) || !v.native || v.native.w === undefined) rt.rtError('Hier wird eine Größe erwartet: new Dimension(breite, höhe)', line); return { w: v.native.w, h: v.native.h }; }
  def('Dimension', { pkg: 'java.awt',
    ctor(rt, a) { return dimension(a.length ? int(a[0]) : 0, a.length > 1 ? int(a[1]) : 0); },
    methods: { getWidth(rt, o) { return new JDouble(o.native.w); }, getHeight(rt, o) { return new JDouble(o.native.h); }, setSize(rt, o, a) { o.native.w = int(a[0]); o.native.h = int(a[1]); },
      equals(rt, o, a) { const x = a[0]; return x instanceof JObject && !!x.native && x.native.w === o.native.w && x.native.h === o.native.h; } },
    retTypes: { getWidth: DOUBLE, getHeight: DOUBLE, equals: BOOL },
    toString(rt, o) { return `java.awt.Dimension[width=${o.native.w},height=${o.native.h}]`; } });

  // Rahmen (BorderFactory)
  const border = (b) => { const o = new JObject(rt.cls('Border')); o.native = { border: b }; return o; };
  def('Border', { pkg: 'javax.swing.border', isInterface: true });
  def('BorderFactory', { pkg: 'javax.swing', statics: {
    createEmptyBorder(rt, a) { return border({ k: 'empty', t: int(a[0] || 0), l: int(a[1] || 0), b: int(a[2] || 0), r: int(a[3] || 0) }); },
    createLineBorder(rt, a, line) { return border({ k: 'line', color: a.length ? awt().toColor(a[0], line).css : 'black', w: a.length > 1 ? int(a[1]) : 1 }); },
    createTitledBorder(rt, a) { return border({ k: 'titled', title: a.length ? str(a[a.length - 1] instanceof JObject ? '' : a[a.length - 1]) : '' }); },
    createEtchedBorder(rt) { return border({ k: 'line', color: '#b8b8b8', w: 1 }); },
    createBevelBorder(rt) { return border({ k: 'line', color: '#9a9a9a', w: 2 }); },
  }, staticRet: { createEmptyBorder: T('Border'), createLineBorder: T('Border'), createTitledBorder: T('Border'), createEtchedBorder: T('Border'), createBevelBorder: T('Border') } });

  // ActionEvent
  def('ActionEvent', { pkg: 'java.awt.event', sfields: { ACTION_PERFORMED: 1001 }, sfieldTypes: { ACTION_PERFORMED: INT },
    methods: { getSource(rt, o) { return o.native.src; }, getActionCommand(rt, o) { return o.native.cmd; }, getWhen() { return BigInt(Date.now()); }, getModifiers() { return 0; } },
    retTypes: { getSource: T('Object'), getActionCommand: STRING, getWhen: T('long'), getModifiers: INT },
    toString(rt, o) { return `java.awt.event.ActionEvent[ACTION_PERFORMED,cmd=${o.native.cmd}]`; } });

  // SwingConstants, SwingUtilities, WindowConstants
  def('SwingConstants', { pkg: 'javax.swing', isInterface: true, sfields: SC, sfieldTypes: intTypes(SC) });
  def('WindowConstants', { pkg: 'javax.swing', isInterface: true, sfields: WC, sfieldTypes: intTypes(WC) });
  def('SwingUtilities', { pkg: 'javax.swing', statics: {
    invokeLater(rt, a, line) { return new R.Delegate(rt.fnG(a[0], 'run', [], line)); },
    invokeAndWait(rt, a, line) { return new R.Delegate(rt.fnG(a[0], 'run', [], line)); },
    isEventDispatchThread() { return true; },
  }, staticRet: { invokeLater: VOID, invokeAndWait: VOID, isEventDispatchThread: BOOL }, lambdaStatics: { invokeLater: [T('Runnable')], invokeAndWait: [T('Runnable')] } });

  // JOptionPane (über die Dialoge der Werkbank)
  const OP = { YES_OPTION: 0, NO_OPTION: 1, CANCEL_OPTION: 2, OK_OPTION: 0, CLOSED_OPTION: -1, DEFAULT_OPTION: -1, YES_NO_OPTION: 0, YES_NO_CANCEL_OPTION: 1, OK_CANCEL_OPTION: 2,
    ERROR_MESSAGE: 0, INFORMATION_MESSAGE: 1, WARNING_MESSAGE: 2, QUESTION_MESSAGE: 3, PLAIN_MESSAGE: -1 };
  const msgText = (v) => v === null ? 'null' : str(v);
  // (parent, msg, …) oder (msg, …): der Elternteil ist eine Komponente oder null
  const dropParent = (a) => (a.length && (a[0] === null || (a[0] instanceof JObject && a[0].native && a[0].native.kind)) && a.length > 1) ? a.slice(1) : a;
  def('JOptionPane', { pkg: 'javax.swing', sfields: OP, sfieldTypes: intTypes(OP), statics: {
    showMessageDialog(rt, a) { const b = dropParent(a); const g = gfx(); if (g) g.message(msgText(b[0]), typeof b[1] === 'string' ? b[1] : 'Meldung'); },
    showInputDialog(rt, a, line) {
      const b = dropParent(a); const g = gfx(); if (!g) return null;
      const title = typeof b[1] === 'string' && b.length > 2 ? b[1] : 'Eingabe';
      const r = g.input(msgText(b[0]), title);
      return r === null || r === undefined ? null : String(r);
    },
    showConfirmDialog(rt, a) {
      const b = dropParent(a); const g = gfx(); if (!g) return 0;
      const opt = typeof b[2] === 'number' ? b[2] : 1;
      if (g.confirm) { const ok = g.confirm(msgText(b[0]), typeof b[1] === 'string' ? b[1] : 'Bitte wählen'); return ok ? 0 : opt === 2 ? 2 : 1; }
      return 0;
    },
  }, staticRet: { showMessageDialog: VOID, showInputDialog: STRING, showConfirmDialog: INT } });

  // javax.swing.Timer: ruft regelmäßig actionPerformed auf
  def('Timer', { pkg: 'javax.swing', lambdaCtor: [null, T('ActionListener')],
    ctor(rt, a, line) {
      const o = new JObject(rt.cls('Timer')); o.native = { delay: Math.max(0, int(a[0])), initial: Math.max(0, int(a[0])), repeats: true, running: false, handle: 0, listeners: [], kind: null };
      if (a[1] !== null && a[1] !== undefined) { if (a[1] instanceof JObject && a[1].lambda) rt.coerce(a[1], T('ActionListener'), line); o.native.listeners.push(a[1]); }
      return o;
    },
    methods: {
      start(rt, o) {
        const t = o.native; if (t.running) return; t.running = true; timers.add(o);
        const tick = () => { if (!t.running) return; for (const l of t.listeners.slice()) rt.fireEvent(l, 'actionPerformed', [actionEvent(o, null)], 'actionPerformed'); if (!t.repeats) { t.running = false; timers.delete(o); } };
        t.handle = setTimeout(function first() { tick(); if (t.running) t.handle = setInterval(tick, Math.max(10, t.delay)); }, Math.max(10, t.initial));
      },
      stop(rt, o) { const t = o.native; t.running = false; clearTimeout(t.handle); clearInterval(t.handle); timers.delete(o); },
      restart(rt, o) { this.stop(rt, o); this.start(rt, o); },
      isRunning(rt, o) { return o.native.running; },
      setDelay(rt, o, a) { o.native.delay = Math.max(0, int(a[0])); if (o.native.running) this.restart(rt, o); }, getDelay(rt, o) { return o.native.delay; },
      setInitialDelay(rt, o, a) { o.native.initial = Math.max(0, int(a[0])); },
      setRepeats(rt, o, a) { o.native.repeats = !!a[0]; }, isRepeats(rt, o) { return o.native.repeats; },
      addActionListener(rt, o, a, line) { if (a[0] instanceof JObject && a[0].lambda) rt.coerce(a[0], T('ActionListener'), line); o.native.listeners.push(a[0]); },
    },
    retTypes: { isRunning: BOOL, getDelay: INT, isRepeats: BOOL },
    toString(rt, o) { return `javax.swing.Timer[delay=${o.native.delay}]`; } });

  // ------------------------------------------------------------ Bilder: ImageIcon, Image, Toolkit
  function imageFor(name, line) {
    const a = rt.io.assets ? rt.io.assets(name) : null;
    if (!a || a.kind !== 'image') rt.rtError(`Bild „${name}“ nicht gefunden. Füge die Datei über „Projekt ▾ → Bilder und Klänge …“ zum Projekt hinzu.`, line);
    return { url: a.url, w: a.w || 0, h: a.h || 0 };
  }
  function imageObj(im) { const o = new JObject(rt.cls('Image')); o.native = { img: im }; return o; }
  function iconOf(v, line) {
    if (v instanceof JObject && v.native && v.native.img) return { ...v.native.img, obj: v };
    rt.rtError('Hier wird ein Bild erwartet, z. B. new ImageIcon("bild.png")', line);
  }
  function iconIn(a) { const v = a.find(x => x instanceof JObject && x.native && x.native.img && x.cls.name === 'ImageIcon'); return v ? { ...v.native.img, obj: v } : null; }
  def('ImageIcon', { pkg: 'javax.swing',
    ctor(rt, a, line) {
      const o = new JObject(rt.cls('ImageIcon'));
      if (a[0] instanceof JObject && a[0].native && a[0].native.img) o.native = { img: { ...a[0].native.img } };
      else o.native = { img: imageFor(str(a[0]), line) };
      return o;
    },
    methods: { getImage(rt, o) { return imageObj(o.native.img); }, getIconWidth(rt, o) { return o.native.img.w; }, getIconHeight(rt, o) { return o.native.img.h; }, setImage(rt, o, a, line) { o.native.img = { ...iconOf(a[0], line) }; delete o.native.img.obj; } },
    retTypes: { getImage: T('Image'), getIconWidth: INT, getIconHeight: INT },
    toString(rt, o) { return 'javax.swing.ImageIcon'; } });
  def('Image', { pkg: 'java.awt', isAbstract: true,
    methods: { getWidth(rt, o) { return o.native.img.w; }, getHeight(rt, o) { return o.native.img.h; },
      getScaledInstance(rt, o, a) { const im = { ...o.native.img }; const w = int(a[0]), h = int(a[1]); im.w = w < 0 ? Math.round(im.w * h / (im.h || 1)) : w; im.h = h < 0 ? Math.round(im.h * w / (o.native.img.w || 1)) : h; return imageObj(im); } },
    sfields: { SCALE_DEFAULT: 1, SCALE_SMOOTH: 4, SCALE_FAST: 2 }, sfieldTypes: { SCALE_DEFAULT: INT, SCALE_SMOOTH: INT, SCALE_FAST: INT },
    retTypes: { getWidth: INT, getHeight: INT, getScaledInstance: T('Image') } });
  def('Toolkit', { pkg: 'java.awt', statics: { getDefaultToolkit(rt) { const o = new JObject(rt.cls('Toolkit')); o.native = {}; return o; } }, staticRet: { getDefaultToolkit: T('Toolkit') },
    methods: { getImage(rt, o, a, line) { return imageObj(imageFor(str(a[0]), line)); }, createImage(rt, o, a, line) { return imageObj(imageFor(str(a[0]), line)); }, beep(rt) { const g = gfx(); if (g && g.op) g.op(0, { t: 'tone', freq: 880, ms: 120, vol: 0.5 }); }, sync: noop,
      getScreenSize(rt) { return dimension(global.innerWidth || 1280, global.innerHeight || 800); } },
    retTypes: { getImage: T('Image'), createImage: T('Image'), getScreenSize: T('Dimension') } });

  // ------------------------------------------------------------ Graphics / Graphics2D
  const DEFAULT_FONT = { family: 'Dialog', style: 0, size: 12 };
  function graphics(o) {
    const n = o.native;
    const g = new JObject(rt.cls('Graphics2D'));
    const fo = n.fontObj && n.fontObj.native ? n.fontObj.native : DEFAULT_FONT;
    g.native = { ops: [], colorObj: n.fgObj || awt().colorObj(0, 0, 0), font: n.fontObj || null, fontN: fo, comp: o, stroke: null };
    g.native.ops.push(['c', n.fg || 'black'], ['f', awt().fontCss(fo)]);
    return g;
  }
  const G = (o) => { if (o.native.done) rt.rtError('Dieses Graphics-Objekt gilt nur während paintComponent – zeichne in paintComponent und rufe repaint() auf'); return o.native; };
  const P = (o, op) => G(o).ops.push(op);
  const nums = (a, k) => a.slice(0, k).map(v => num(v));
  const arr = (v, line) => { if (!(v instanceof R.JArray)) rt.rtError('Hier wird ein Array mit Koordinaten erwartet', line); return v.data.map(x => num(x)); };
  function polyArgs(a, line) {
    if (a[0] instanceof JObject && a[0].native && a[0].native.xs) { const p = a[0].native; return [p.xs.slice(0, p.n), p.ys.slice(0, p.n)]; }
    const k = int(a[2]); return [arr(a[0], line).slice(0, k), arr(a[1], line).slice(0, k)];
  }
  function textWidth(fontN, s) { const g = gfx(); if (g && g.textWidth) return g.textWidth(awt().fontCss(fontN), s); return Math.round(s.length * fontN.size * 0.6); }
  function fontMetrics(fontN) { const o = new JObject(rt.cls('FontMetrics')); o.native = { f: fontN }; return o; }
  const gMethods = {
    setColor(rt, o, a, line) { if (a[0] === null) return; const c = awt().toColor(a[0], line); G(o).colorObj = a[0]; P(o, ['c', c.css]); },
    getColor(rt, o) { return G(o).colorObj; },
    setPaint(rt, o, a, line) { gMethods.setColor(rt, o, a, line); }, getPaint(rt, o) { return G(o).colorObj; },
    setBackground: noop,
    setFont(rt, o, a) { if (!a[0] || !a[0].native) return; const g = G(o); g.font = a[0]; g.fontN = a[0].native; P(o, ['f', awt().fontCss(a[0].native)]); },
    getFont(rt, o) { const g = G(o); if (g.font) return g.font; const f = new JObject(rt.cls('Font')); f.native = { ...g.fontN }; return f; },
    getFontMetrics(rt, o, a) { return fontMetrics(a[0] && a[0].native ? a[0].native : G(o).fontN); },
    drawLine(rt, o, a) { P(o, ['l', ...nums(a, 4)]); },
    drawRect(rt, o, a) { P(o, ['r', 0, ...nums(a, 4)]); }, fillRect(rt, o, a) { P(o, ['r', 1, ...nums(a, 4)]); },
    draw3DRect(rt, o, a) { P(o, ['r', 0, ...nums(a, 4)]); }, fill3DRect(rt, o, a) { P(o, ['r', 1, ...nums(a, 4)]); },
    clearRect(rt, o, a) { P(o, ['clr', ...nums(a, 4)]); },
    drawOval(rt, o, a) { P(o, ['o', 0, ...nums(a, 4)]); }, fillOval(rt, o, a) { P(o, ['o', 1, ...nums(a, 4)]); },
    drawArc(rt, o, a) { P(o, ['a', 0, ...nums(a, 6)]); }, fillArc(rt, o, a) { P(o, ['a', 1, ...nums(a, 6)]); },
    drawRoundRect(rt, o, a) { P(o, ['rr', 0, ...nums(a, 6)]); }, fillRoundRect(rt, o, a) { P(o, ['rr', 1, ...nums(a, 6)]); },
    drawPolygon(rt, o, a, line) { P(o, ['p', 0, ...polyArgs(a, line)]); }, fillPolygon(rt, o, a, line) { P(o, ['p', 1, ...polyArgs(a, line)]); },
    drawPolyline(rt, o, a, line) { P(o, ['pl', ...polyArgs(a, line)]); },
    drawString(rt, o, a) { P(o, ['s', a[0] === null ? 'null' : str(a[0]), num(a[1]), num(a[2])]); },
    drawImage(rt, o, a, line) {
      const im = a[0]; if (im === null) return false;
      if (!(im instanceof JObject) || !im.native || !im.native.img) rt.rtError('drawImage erwartet ein Bild (z. B. new ImageIcon("bild.png").getImage())', line);
      const ns = a.slice(1).filter(v => typeof v === 'number' || v instanceof JDouble).map(v => num(v));
      const i = im.native.img;
      P(o, ['i', i.url, ns[0] || 0, ns[1] || 0, ns.length >= 4 ? ns[2] : i.w || null, ns.length >= 4 ? ns[3] : i.h || null]);
      return true;
    },
    // Graphics2D
    setStroke(rt, o, a) { const s = a[0]; G(o).stroke = s; P(o, ['lw', s && s.native ? s.native.w : 1]); }, getStroke(rt, o) { return G(o).stroke; },
    setRenderingHint: noop, setRenderingHints: noop,
    translate(rt, o, a) { P(o, ['tr', num(a[0]), num(a[1])]); },
    rotate(rt, o, a) { P(o, ['rot', num(a[0]), a.length > 2 ? num(a[1]) : 0, a.length > 2 ? num(a[2]) : 0]); },
    scale(rt, o, a) { P(o, ['sc', num(a[0]), num(a[1])]); },
    create(rt, o) { const g = G(o); P(o, ['save']); const c = new JObject(o.cls); c.native = { ...g, ops: g.ops, child: true }; return c; },
    dispose(rt, o) { if (o.native.child && !o.native.disposed) { o.native.disposed = true; P(o, ['restore']); } },
    setClip(rt, o, a) { if (a.length >= 4) P(o, ['clip', ...nums(a, 4)]); }, clipRect(rt, o, a) { P(o, ['clip', ...nums(a, 4)]); },
  };
  def('Graphics', { pkg: 'java.awt', isAbstract: true, methods: gMethods, retTypes: { getColor: T('Color'), getPaint: T('Color'), getFont: T('Font'), getFontMetrics: T('FontMetrics'), drawImage: BOOL, create: T('Graphics'), getStroke: T('BasicStroke') },
    toString(rt, o) { return 'java.awt.Graphics2D'; } });
  def('Graphics2D', { pkg: 'java.awt', superName: 'Graphics', isAbstract: true, retTypes: { create: T('Graphics') } });
  def('BasicStroke', { pkg: 'java.awt', sfields: { CAP_BUTT: 0, CAP_ROUND: 1, CAP_SQUARE: 2, JOIN_MITER: 0, JOIN_ROUND: 1, JOIN_BEVEL: 2 }, sfieldTypes: intTypes({ CAP_BUTT: 0, CAP_ROUND: 0, CAP_SQUARE: 0, JOIN_MITER: 0, JOIN_ROUND: 0, JOIN_BEVEL: 0 }),
    ctor(rt, a) { const o = new JObject(rt.cls('BasicStroke')); o.native = { w: a.length ? num(a[0]) : 1 }; return o; },
    methods: { getLineWidth(rt, o) { return new JDouble(o.native.w); } }, retTypes: { getLineWidth: T('float') } });
  def('FontMetrics', { pkg: 'java.awt', isAbstract: true,
    methods: { stringWidth(rt, o, a) { return textWidth(o.native.f, a[0] === null ? 'null' : str(a[0])); }, charWidth(rt, o, a) { return textWidth(o.native.f, str(a[0])); },
      getHeight(rt, o) { return Math.round(o.native.f.size * 1.2); }, getAscent(rt, o) { return Math.round(o.native.f.size * 0.8); }, getDescent(rt, o) { return Math.round(o.native.f.size * 0.25); }, getLeading() { return 0; } },
    retTypes: { stringWidth: INT, charWidth: INT, getHeight: INT, getAscent: INT, getDescent: INT, getLeading: INT } });
  def('RenderingHints', { pkg: 'java.awt', sfields: { KEY_ANTIALIASING: 'antialias', VALUE_ANTIALIAS_ON: 'on', VALUE_ANTIALIAS_OFF: 'off', KEY_TEXT_ANTIALIASING: 'textantialias', VALUE_TEXT_ANTIALIAS_ON: 'on', KEY_RENDERING: 'render', VALUE_RENDER_QUALITY: 'quality' },
    sfieldTypes: { KEY_ANTIALIASING: T('Object'), VALUE_ANTIALIAS_ON: T('Object'), VALUE_ANTIALIAS_OFF: T('Object'), KEY_TEXT_ANTIALIASING: T('Object'), VALUE_TEXT_ANTIALIAS_ON: T('Object'), KEY_RENDERING: T('Object'), VALUE_RENDER_QUALITY: T('Object') } });
  def('Polygon', { pkg: 'java.awt',
    ctor(rt, a, line) { const o = new JObject(rt.cls('Polygon')); o.native = a.length >= 3 ? { xs: arr(a[0], line).slice(0, int(a[2])), ys: arr(a[1], line).slice(0, int(a[2])), n: int(a[2]) } : { xs: [], ys: [], n: 0 }; return o; },
    methods: { addPoint(rt, o, a) { const p = o.native; p.xs.length = p.n; p.ys.length = p.n; p.xs.push(int(a[0])); p.ys.push(int(a[1])); p.n++; }, translate(rt, o, a) { const p = o.native; for (let i = 0; i < p.n; i++) { p.xs[i] += int(a[0]); p.ys[i] += int(a[1]); } },
      contains(rt, o, a) { const p = o.native, x = num(a[0]), y = num(a[1]); let c = false; for (let i = 0, j = p.n - 1; i < p.n; j = i++) if ((p.ys[i] > y) !== (p.ys[j] > y) && x < (p.xs[j] - p.xs[i]) * (y - p.ys[i]) / (p.ys[j] - p.ys[i]) + p.xs[i]) c = !c; return c; },
      reset(rt, o) { o.native.xs = []; o.native.ys = []; o.native.n = 0; } },
    retTypes: { contains: BOOL } });
  compClass('Canvas', 'Component', 'panel', (n) => { n.layout = { k: 'null' }; });
  rt.classes.get('Canvas').pkg = 'java.awt';

  // ------------------------------------------------------------ Menüs
  def('JMenuBar', { pkg: 'javax.swing', superName: 'JComponent', extendable: true,
    ctor(rt, a, line) { const o = new JObject(rt.cls('JMenuBar')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o) { comp(o, 'menubar'); },
    methods: { add(rt, o, a, line) { return addChild(o, a[0], undefined, undefined, line); }, getMenu(rt, o, a) { return o.native.children[int(a[0])] || null; }, getMenuCount(rt, o) { return o.native.children.length; } },
    retTypes: { add: T('JMenu'), getMenu: T('JMenu'), getMenuCount: INT } });
  const menuAdd = {
    add(rt, o, a, line) { let it = a[0]; if (typeof it === 'string') { it = new JObject(rt.cls('JMenuItem')); comp(it, 'menuitem').text = a[0]; } return addChild(o, it, undefined, undefined, line); },
    addSeparator(rt, o, a, line) { const sp = new JObject(rt.cls('JSeparator')); comp(sp, 'sep'); addChild(o, sp, undefined, undefined, line); },
    getItemCount(rt, o) { return o.native.children.length; }, getItem(rt, o, a) { return o.native.children[int(a[0])] || null; },
  };
  compClass('JMenuItem', 'AbstractButton', 'menuitem', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.icon = iconIn(a); });
  compClass('JMenu', 'JMenuItem', 'menu', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; }, { methods: menuAdd, retTypes: { add: T('JMenuItem'), getItemCount: INT, getItem: T('JMenuItem') } });
  compClass('JPopupMenu', 'JComponent', 'menu', () => { }, { methods: { ...menuAdd, show() { rt.rtError('Kontextmenüs (JPopupMenu) werden in der Web-Version noch nicht unterstützt'); } } });
  compClass('JCheckBoxMenuItem', 'JMenuItem', 'checkmenu', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.selected = a.some(v => v === true); }, { methods: { getState(rt, o) { return o.native.selected; }, setState(rt, o, a) { o.native.selected = !!a[0]; changed(o); } }, retTypes: { getState: BOOL } });
  compClass('JRadioButtonMenuItem', 'JMenuItem', 'radiomenu', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; n.selected = a.some(v => v === true); });
  compClass('JSeparator', 'JComponent', 'sep', () => { });
  // KeyStroke für setAccelerator: wird nur als Text im Menü angezeigt
  def('KeyStroke', { pkg: 'javax.swing', statics: {
    getKeyStroke(rt, a) {
      const o = new JObject(rt.cls('KeyStroke'));
      let text = '';
      if (typeof a[0] === 'string') text = a[0];
      else { const code = int(a[0]), mods = a.length > 1 ? int(a[1]) : 0; const k = code >= 48 && code <= 90 ? String.fromCharCode(code) : code >= 112 && code <= 123 ? 'F' + (code - 111) : '';
        text = [(mods & 130) ? 'Strg' : '', (mods & 65) ? 'Umschalt' : '', (mods & 520) ? 'Alt' : ''].filter(Boolean).concat(k ? [k] : []).join('+'); }
      o.native = { text }; return o;
    } }, staticRet: { getKeyStroke: T('KeyStroke') }, toString(rt, o) { return o.native.text; } });

  // ------------------------------------------------------------ Auswahl: ButtonGroup, JComboBox, JList, JSlider, JProgressBar
  let gidN = 1;
  def('ButtonGroup', { pkg: 'javax.swing',
    ctor(rt) { const o = new JObject(rt.cls('ButtonGroup')); o.native = { buttons: [], gid: gidN++ }; return o; },
    methods: {
      add(rt, o, a, line) { const b = a[0]; N(b, line); if (!b.native.group) { b.native.group = o; o.native.buttons.push(b); if (b.native.selected) { for (const x of o.native.buttons) if (x !== b && x.native.selected) { x.native.selected = false; changed(x); } } changed(b); } },
      remove(rt, o, a) { const L = o.native.buttons, i = L.indexOf(a[0]); if (i >= 0) { L.splice(i, 1); a[0].native.group = null; changed(a[0]); } },
      clearSelection(rt, o) { for (const b of o.native.buttons) if (b.native.selected) { b.native.selected = false; changed(b); } },
      getButtonCount(rt, o) { return o.native.buttons.length; },
      isSelected(rt, o, a) { return !!(a[0] && a[0].native && a[0].native.selected && o.native.buttons.includes(a[0])); },
      getSelectedButton(rt, o) { return o.native.buttons.find(b => b.native.selected) || null; },
    },
    retTypes: { getButtonCount: INT, isSelected: BOOL, getSelectedButton: T('AbstractButton') } });
  // Auswahl ändern (vom Programm oder im Fenster); Ereignisse wie in Swing
  function setSel(o, i, fromUser) {
    const n = o.native; const items = n.model ? n.model.native.list : n.items || [];
    if (i < -1 || i >= items.length) { if (n.kind === 'combo') rt.throwJava('IllegalArgumentException', 'setSelectedIndex: ' + i + ' out of bounds'); return; }
    const old = n.sel; if (old === i && n.kind === 'list') return;
    n.sel = i;
    if (!fromUser) changed(o);
    if (n.kind === 'combo') {
      if (old !== i) { if (old >= 0 && old < items.length) fireList(o, 'item', 'itemStateChanged', () => [itemEvent(o, items[old], 2)]); if (i >= 0) fireList(o, 'item', 'itemStateChanged', () => [itemEvent(o, items[i], 1)]); }
      fireAction(o, 'comboBoxChanged');
    } else if (n.kind === 'list') fireList(o, 'sel', 'valueChanged', () => [simpleEvent('ListSelectionEvent', o, { first: Math.max(0, Math.min(old, i)), last: Math.max(old, i) })]);
  }
  const itemsOfObj = (o) => o.native.model ? o.native.model.native.list : o.native.items;
  def('JComboBox', { pkg: 'javax.swing', superName: 'JComponent', extendable: true,
    ctor(rt, a, line) { const o = new JObject(rt.cls('JComboBox')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a) { const n = comp(o, 'combo'); n.items = a[0] instanceof R.JArray ? a[0].data.slice() : a[0] instanceof JObject && a[0].native && a[0].native.list && a[0].native.views ? null : []; if (n.items === null) { n.model = a[0]; a[0].native.views.add(o); } n.sel = itemsOfObj(o).length ? 0 : -1; },
    methods: {
      addItem(rt, o, a) { const L = itemsOfObj(o); L.push(a[0]); const first = o.native.sel < 0; if (first) o.native.sel = 0; changed(o); if (first) fireAction(o, 'comboBoxChanged'); },
      insertItemAt(rt, o, a) { itemsOfObj(o).splice(int(a[1]), 0, a[0]); changed(o); },
      removeItem(rt, o, a) { const L = itemsOfObj(o); const i = L.findIndex(x => rt.javaEquals(x, a[0])); if (i >= 0) { L.splice(i, 1); if (o.native.sel >= L.length) o.native.sel = L.length - 1; changed(o); } },
      removeItemAt(rt, o, a) { const L = itemsOfObj(o); L.splice(int(a[0]), 1); if (o.native.sel >= L.length) o.native.sel = L.length - 1; changed(o); },
      removeAllItems(rt, o) { itemsOfObj(o).length = 0; o.native.sel = -1; changed(o); },
      getItemCount(rt, o) { return itemsOfObj(o).length; },
      getItemAt(rt, o, a) { const L = itemsOfObj(o); const i = int(a[0]); return i >= 0 && i < L.length ? L[i] : null; },
      getSelectedItem(rt, o) { const L = itemsOfObj(o); return o.native.sel >= 0 ? L[o.native.sel] : null; },
      getSelectedIndex(rt, o) { return o.native.sel; },
      setSelectedIndex(rt, o, a) { setSel(o, int(a[0]), false); },
      setSelectedItem(rt, o, a) { const i = itemsOfObj(o).findIndex(x => rt.javaEquals(x, a[0])); if (i >= 0) setSel(o, i, false); },
      addActionListener(rt, o, a, line) { addAction(o, a[0], line); }, removeActionListener(rt, o, a) { const L = o.native.listeners; const i = L.indexOf(a[0]); if (i >= 0) L.splice(i, 1); },
      addItemListener(rt, o, a, line) { addL(o, 'item', a[0], line); },
      setEditable: noop, setMaximumRowCount: noop, isEditable() { return false; },
      setModel(rt, o, a) { const n = o.native; if (n.model) n.model.native.views.delete(o); n.model = a[0]; n.items = null; a[0].native.views.add(o); n.sel = a[0].native.list.length ? 0 : -1; changed(o); },
    },
    retTypes: { getItemCount: INT, getSelectedIndex: INT, isEditable: BOOL },
    toString(rt, o) { return `javax.swing.JComboBox[${itemsOfObj(o).length} Einträge]`; },
    inspectRows(rt, o) { const L = itemsOfObj(o); return [{ name: 'Einträge', type: 'int', value: L.length }, { name: 'ausgewählt', type: 'int', value: o.native.sel }]; } });
  def('JList', { pkg: 'javax.swing', superName: 'JComponent', extendable: true,
    sfields: { SINGLE_SELECTION: 0, SINGLE_INTERVAL_SELECTION: 1, MULTIPLE_INTERVAL_SELECTION: 2, VERTICAL: 0, HORIZONTAL_WRAP: 2, VERTICAL_WRAP: 1 }, sfieldTypes: intTypes({ SINGLE_SELECTION: 0, SINGLE_INTERVAL_SELECTION: 0, MULTIPLE_INTERVAL_SELECTION: 0, VERTICAL: 0, HORIZONTAL_WRAP: 0, VERTICAL_WRAP: 0 }),
    ctor(rt, a, line) { const o = new JObject(rt.cls('JList')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a) { const n = comp(o, 'list'); n.rows = 8; if (a[0] instanceof JObject && a[0].native && a[0].native.views) { n.model = a[0]; a[0].native.views.add(o); } else n.items = a[0] instanceof R.JArray ? a[0].data.slice() : a[0] instanceof JObject && a[0].native && a[0].native.list ? a[0].native.list.slice() : []; },
    methods: {
      getSelectedValue(rt, o) { const L = itemsOfObj(o); return o.native.sel >= 0 && o.native.sel < L.length ? L[o.native.sel] : null; },
      getSelectedIndex(rt, o) { return o.native.sel; },
      setSelectedIndex(rt, o, a) { setSel(o, int(a[0]), false); },
      setSelectedValue(rt, o, a) { const i = itemsOfObj(o).findIndex(x => rt.javaEquals(x, a[0])); if (i >= 0) setSel(o, i, false); },
      clearSelection(rt, o) { if (o.native.sel !== -1) setSel(o, -1, false); },
      isSelectionEmpty(rt, o) { return o.native.sel < 0; },
      getModel(rt, o) { return o.native.model || null; },
      setModel(rt, o, a) { const n = o.native; if (n.model) n.model.native.views.delete(o); n.model = a[0]; n.items = null; a[0].native.views.add(o); n.sel = -1; changed(o); },
      setListData(rt, o, a) { const n = o.native; if (n.model) { n.model.native.views.delete(o); n.model = null; } n.items = a[0] instanceof R.JArray ? a[0].data.slice() : a[0] && a[0].native && a[0].native.list ? a[0].native.list.slice() : []; n.sel = -1; changed(o); },
      setVisibleRowCount(rt, o, a) { o.native.rows = int(a[0]); changed(o); }, getVisibleRowCount(rt, o) { return o.native.rows; },
      addListSelectionListener(rt, o, a, line) { addL(o, 'sel', a[0], line); }, removeListSelectionListener(rt, o, a, line) { removeL(o, 'sel', a[0], line); },
      setSelectionMode: noop, setLayoutOrientation: noop, ensureIndexIsVisible: noop, setFixedCellWidth: noop, setFixedCellHeight: noop,
    },
    retTypes: { getSelectedIndex: INT, isSelectionEmpty: BOOL, getModel: T('DefaultListModel'), getVisibleRowCount: INT },
    toString(rt, o) { return `javax.swing.JList[${itemsOfObj(o).length} Einträge]`; } });
  // DefaultListModel: Liste, die ihre JList/JComboBox bei Änderungen neu zeichnen lässt
  const lm = (o) => o.native.list;
  const lmChanged = (o) => { for (const v of o.native.views) { const n = v.native; const L = lm(o); if (n.sel >= L.length) n.sel = L.length - 1; if (n.kind === 'combo' && n.sel < 0 && L.length) n.sel = 0; changed(v); } };
  const idx = (o, i) => { const L = lm(o); if (i < 0 || i >= L.length) rt.throwJava('ArrayIndexOutOfBoundsException', i + ' >= ' + L.length); return i; };
  def('DefaultListModel', { pkg: 'javax.swing',
    ctor(rt) { const o = new JObject(rt.cls('DefaultListModel')); o.native = { list: [], views: new Set(), dlm: true }; return o; },
    methods: {
      addElement(rt, o, a) { lm(o).push(a[0]); lmChanged(o); },
      add(rt, o, a) { if (a.length === 2) lm(o).splice(int(a[0]), 0, a[1]); else lm(o).push(a[0]); lmChanged(o); },
      insertElementAt(rt, o, a) { lm(o).splice(int(a[1]), 0, a[0]); lmChanged(o); },
      get(rt, o, a) { return lm(o)[idx(o, int(a[0]))]; }, getElementAt(rt, o, a) { return lm(o)[idx(o, int(a[0]))]; }, elementAt(rt, o, a) { return lm(o)[idx(o, int(a[0]))]; },
      set(rt, o, a) { const i = idx(o, int(a[0])); const old = lm(o)[i]; lm(o)[i] = a[1]; lmChanged(o); return old; },
      setElementAt(rt, o, a) { lm(o)[idx(o, int(a[1]))] = a[0]; lmChanged(o); },
      remove(rt, o, a) { const i = idx(o, int(a[0])); const v = lm(o).splice(i, 1)[0]; lmChanged(o); return v; },
      removeElementAt(rt, o, a) { lm(o).splice(idx(o, int(a[0])), 1); lmChanged(o); },
      removeElement(rt, o, a) { const L = lm(o); const i = L.findIndex(x => rt.javaEquals(x, a[0])); if (i < 0) return false; L.splice(i, 1); lmChanged(o); return true; },
      removeAllElements(rt, o) { lm(o).length = 0; lmChanged(o); }, clear(rt, o) { lm(o).length = 0; lmChanged(o); },
      getSize(rt, o) { return lm(o).length; }, size(rt, o) { return lm(o).length; }, isEmpty(rt, o) { return !lm(o).length; },
      contains(rt, o, a) { return lm(o).some(x => rt.javaEquals(x, a[0])); }, indexOf(rt, o, a) { return lm(o).findIndex(x => rt.javaEquals(x, a[0])); },
      firstElement(rt, o) { if (!lm(o).length) rt.throwJava('NoSuchElementException'); return lm(o)[0]; }, lastElement(rt, o) { if (!lm(o).length) rt.throwJava('NoSuchElementException'); return lm(o)[lm(o).length - 1]; },
      toArray(rt, o) { return new R.JArray(T('Object'), lm(o).slice()); },
    },
    retTypes: { getSize: INT, size: INT, isEmpty: BOOL, contains: BOOL, indexOf: INT, removeElement: BOOL, toArray: T('Object', 1) },
    toString(rt, o) { return '[' + lm(o).map(x => x === null ? 'null' : rt.str(x)).join(', ') + ']'; } });
  def('JSlider', { pkg: 'javax.swing', superName: 'JComponent', extendable: true, sfields: { HORIZONTAL: 0, VERTICAL: 1 }, sfieldTypes: { HORIZONTAL: INT, VERTICAL: INT },
    ctor(rt, a, line) { const o = new JObject(rt.cls('JSlider')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a) {
      const n = comp(o, 'slider'); const v = a.map(x => int(x));
      // JSlider(), (orientation), (min, max), (min, max, value), (orientation, min, max, value)
      if (v.length === 4) { n.orient = v[0]; n.min = v[1]; n.max = v[2]; n.value = v[3]; }
      else if (v.length === 3) { n.min = v[0]; n.max = v[1]; n.value = v[2]; }
      else if (v.length === 2) { n.min = v[0]; n.max = v[1]; n.value = Math.round((v[0] + v[1]) / 2); }
      else { if (v.length === 1) n.orient = v[0]; n.min = 0; n.max = 100; n.value = 50; }
      if (n.min > n.max || n.value < n.min || n.value > n.max) rt.throwJava('IllegalArgumentException', 'invalid range properties');
    },
    methods: {
      getValue(rt, o) { return o.native.value; },
      setValue(rt, o, a) { const n = o.native; const v = Math.max(n.min, Math.min(n.max, int(a[0]))); if (v === n.value) return; n.value = v; changed(o); fireList(o, 'change', 'stateChanged', () => [simpleEvent('ChangeEvent', o)]); },
      getMinimum(rt, o) { return o.native.min; }, getMaximum(rt, o) { return o.native.max; },
      setMinimum(rt, o, a) { o.native.min = int(a[0]); changed(o); }, setMaximum(rt, o, a) { o.native.max = int(a[0]); changed(o); },
      setMajorTickSpacing(rt, o, a) { o.native.major = int(a[0]); changed(o); }, setMinorTickSpacing: noop,
      setPaintTicks(rt, o, a) { o.native.paintTicks = !!a[0]; changed(o); }, setPaintLabels(rt, o, a) { o.native.paintLabels = !!a[0]; changed(o); }, setSnapToTicks: noop,
      setOrientation(rt, o, a) { o.native.orient = int(a[0]); changed(o); },
      getValueIsAdjusting() { return false; },
      addChangeListener(rt, o, a, line) { addL(o, 'change', a[0], line); }, removeChangeListener(rt, o, a, line) { removeL(o, 'change', a[0], line); },
    },
    retTypes: { getValue: INT, getMinimum: INT, getMaximum: INT, getValueIsAdjusting: BOOL },
    toString(rt, o) { return `javax.swing.JSlider[value=${o.native.value}]`; },
    inspectRows(rt, o) { return [{ name: 'Wert', type: 'int', value: o.native.value }, { name: 'Bereich', type: '', value: `${o.native.min} … ${o.native.max}` }]; } });
  def('JProgressBar', { pkg: 'javax.swing', superName: 'JComponent', extendable: true, sfields: { HORIZONTAL: 0, VERTICAL: 1 }, sfieldTypes: { HORIZONTAL: INT, VERTICAL: INT },
    ctor(rt, a, line) { const o = new JObject(rt.cls('JProgressBar')); this.initInstance(rt, o, a, line); return o; },
    initInstance(rt, o, a) { const n = comp(o, 'progress'); const v = a.map(x => int(x)); if (v.length >= 2) { n.min = v[v.length - 2]; n.max = v[v.length - 1]; } n.value = n.min; },
    methods: {
      getValue(rt, o) { return o.native.value; }, setValue(rt, o, a) { const n = o.native; n.value = Math.max(n.min, Math.min(n.max, int(a[0]))); changed(o); },
      getMinimum(rt, o) { return o.native.min; }, getMaximum(rt, o) { return o.native.max; }, setMinimum(rt, o, a) { o.native.min = int(a[0]); changed(o); }, setMaximum(rt, o, a) { o.native.max = int(a[0]); changed(o); },
      setStringPainted(rt, o, a) { o.native.stringPainted = !!a[0]; changed(o); }, setString(rt, o, a) { o.native.string = a[0] === null ? null : str(a[0]); changed(o); }, setIndeterminate: noop,
      getPercentComplete(rt, o) { const n = o.native; return new JDouble(n.max > n.min ? (n.value - n.min) / (n.max - n.min) : 0); },
      addChangeListener(rt, o, a, line) { addL(o, 'change', a[0], line); },
    },
    retTypes: { getValue: INT, getMinimum: INT, getMaximum: INT, getPercentComplete: DOUBLE } });

  // Ereignisklassen
  const evBase = { getSource(rt, o) { return o.native.src; } };
  def('WindowEvent', { pkg: 'java.awt.event', sfields: { WINDOW_OPENED: 200, WINDOW_CLOSING: 201, WINDOW_CLOSED: 202 }, sfieldTypes: { WINDOW_OPENED: INT, WINDOW_CLOSING: INT, WINDOW_CLOSED: INT },
    methods: { ...evBase, getWindow(rt, o) { return o.native.src; }, getID(rt, o) { return o.native.id; } }, retTypes: { getSource: T('Object'), getWindow: T('JFrame'), getID: INT } });
  def('ItemEvent', { pkg: 'java.awt.event', sfields: { SELECTED: 1, DESELECTED: 2, ITEM_STATE_CHANGED: 701 }, sfieldTypes: { SELECTED: INT, DESELECTED: INT, ITEM_STATE_CHANGED: INT },
    methods: { ...evBase, getItem(rt, o) { return o.native.item; }, getStateChange(rt, o) { return o.native.state; }, getItemSelectable(rt, o) { return o.native.src; } }, retTypes: { getSource: T('Object'), getItem: T('Object'), getStateChange: INT } });
  def('ChangeEvent', { pkg: 'javax.swing.event', methods: evBase, retTypes: { getSource: T('Object') } });
  def('ListSelectionEvent', { pkg: 'javax.swing.event', methods: { ...evBase, getValueIsAdjusting() { return false; }, getFirstIndex(rt, o) { return o.native.first; }, getLastIndex(rt, o) { return o.native.last; } },
    retTypes: { getSource: T('Object'), getValueIsAdjusting: BOOL, getFirstIndex: INT, getLastIndex: INT } });

  rt.swingReset = () => { stopTimers(); frames.clear(); };
});
})(typeof window !== 'undefined' ? window : globalThis);
