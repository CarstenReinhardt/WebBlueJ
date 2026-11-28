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
      bounds: null, pref: null, align: null, tip: null, border: null, children: [], layout: null, cons: null, parent: null, listeners: [], cmd: null, cols: 0, rows: 0, wrap: false, name: null, ...extra };
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
      bounds: n.bounds, pref: n.pref, align: n.align, tip: n.tip, border: n.border, cols: n.cols, rows: n.rows, wrap: n.wrap, opaque: n.opaque !== false };
  }
  // Änderung an das Fenster melden (nur wenn es gerade angezeigt wird)
  function changed(o, structural) {
    const f = frameOf(o); if (!f) return;
    const F = f.native; if (!F.win || !F.shown) return;
    const g = gfx(); if (!g || !g.swing) return;
    if (structural || o === f) g.swing(F.win, { t: 'tree', root: ser(F.content) });
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

  // Ereignisse aus dem Fenster
  function onEvent(frame, ev) {
    const F = frame.native;
    const o = ev.id !== undefined ? byId.get(ev.id) : null;
    switch (ev.type) {
      case 'text': if (o) o.native.text = String(ev.text); return;
      case 'check': if (o) { o.native.selected = !!ev.value; fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'action': if (o && o.native.enabled) { if (ev.text !== undefined) o.native.text = String(ev.text); fireAction(o, o.native.cmd !== null ? o.native.cmd : o.native.text); } return;
      case 'closing':
        if (F.closeOp === 0) return true;   // DO_NOTHING_ON_CLOSE
        return false;
      case 'closed':
        F.shown = false; F.visible = false; F.win = null; frames.delete(frame);
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
      g.swing(F.win, { t: 'tree', root: ser(F.content) });
      g.swing(F.win, { t: 'show' });
    } else if (F.win) { const w = F.win; F.win = null; F.shown = false; frames.delete(frame); g.swing(w, { t: 'close' }); }
  }

  // ------------------------------------------------------------ Gemeinsame Methoden
  const sizeOf = (n) => n.bounds ? { w: n.bounds.w, h: n.bounds.h } : n.pref ? { w: n.pref.w, h: n.pref.h } : { w: 0, h: 0 };
  const componentMethods = {
    setBounds(rt, o, a, line) { const n = N(o, line); n.bounds = { x: int(a[0]), y: int(a[1]), w: int(a[2]), h: int(a[3]) }; changed(o); },
    setLocation(rt, o, a, line) { const n = N(o, line); const b = n.bounds || { x: 0, y: 0, w: sizeOf(n).w || 80, h: sizeOf(n).h || 24 }; n.bounds = { ...b, x: int(a[0]), y: int(a[1]) }; changed(o); },
    setSize(rt, o, a, line) { const n = N(o, line); const w = a.length === 1 ? dimOf(a[0], line).w : int(a[0]), h = a.length === 1 ? dimOf(a[0], line).h : int(a[1]); if (n.bounds) n.bounds = { ...n.bounds, w, h }; else n.pref = { w, h }; changed(o); },
    setPreferredSize(rt, o, a, line) { const n = N(o, line); n.pref = a[0] === null ? null : dimOf(a[0], line); changed(o); },
    setMinimumSize: noop, setMaximumSize: noop,
    getPreferredSize(rt, o, a, line) { const s = sizeOf(N(o, line)); return dimension(s.w, s.h); },
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
    repaint: noop, revalidate: noop, validate: noop, invalidate: noop, setAlignmentX: noop, setAlignmentY: noop, setCursor: noop, setFocusable: noop, setDoubleBuffered: noop,
  };
  const componentRet = { getWidth: INT, getHeight: INT, getX: INT, getY: INT, isEnabled: BOOL, isVisible: BOOL, getToolTipText: STRING, getName: STRING, getForeground: T('Color'), getBackground: T('Color'), getFont: T('Font'), getParent: T('Container'), getPreferredSize: T('Dimension'), getSize: T('Dimension'), requestFocusInWindow: BOOL };
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
  compClass('JLabel', 'JComponent', 'label', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; const al = a.find(v => typeof v === 'number'); if (al !== undefined) n.align = alignName(al); }, {
    sfields: SC, sfieldTypes: intTypes(SC),
    methods: { ...textOf, setHorizontalAlignment(rt, o, a, line) { N(o, line).align = alignName(int(a[0])); changed(o); }, setVerticalAlignment: noop, setIcon() { rt.rtError('Bilder in JLabel werden in der Web-Version noch nicht unterstützt'); }, setLabelFor: noop },
    retTypes: { getText: STRING },
  });
  def('AbstractButton', { pkg: 'javax.swing', superName: 'JComponent', isAbstract: true,
    methods: { ...textOf, addActionListener(rt, o, a, line) { addAction(o, a[0], line); }, removeActionListener(rt, o, a, line) { const L = N(o, line).listeners; const i = L.indexOf(a[0]); if (i >= 0) L.splice(i, 1); },
      setActionCommand(rt, o, a, line) { N(o, line).cmd = a[0] === null ? null : str(a[0]); }, getActionCommand(rt, o, a, line) { const n = N(o, line); return n.cmd !== null ? n.cmd : n.text; },
      isSelected(rt, o, a, line) { return N(o, line).selected; }, setSelected(rt, o, a, line) { N(o, line).selected = !!a[0]; changed(o); },
      doClick(rt, o, a, line) { const n = N(o, line); if (n.kind === 'checkbox') { n.selected = !n.selected; changed(o); } fireAction(o, n.cmd !== null ? n.cmd : n.text); },
      setMnemonic: noop, setIcon() { rt.rtError('Bilder auf Knöpfen werden in der Web-Version noch nicht unterstützt'); }, setFocusPainted: noop, setBorderPainted: noop, setContentAreaFilled: noop, setHorizontalAlignment: noop },
    retTypes: { getText: STRING, getActionCommand: STRING, isSelected: BOOL } });
  compClass('JButton', 'AbstractButton', 'button', (n, a) => { n.text = typeof a[0] === 'string' ? a[0] : ''; });
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
    setLocationRelativeTo: noop, setLocation: noop, setResizable: noop, setAlwaysOnTop: noop, toFront: noop, setIconImage: noop, setExtendedState: noop, setUndecorated: noop, setJMenuBar() { rt.rtError('Menüleisten (JMenuBar) werden in der Web-Version noch nicht unterstützt'); },
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
    retTypes: { getContentPane: T('Container'), getTitle: STRING, getWidth: INT, getHeight: INT, isVisible: BOOL, getDefaultCloseOperation: INT, getComponentCount: INT, add: T('Component'), getRootPane: T('Container') },
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

  rt.swingReset = () => { stopTimers(); frames.clear(); };
});
})(typeof window !== 'undefined' ? window : globalThis);
