/* Java-Werkbank – Grafikfenster für Turtle und GPanel.
   Der Interpreter zeichnet nicht selbst: Er legt Zeichenbefehle in eine Warteschlange,
   die hier Bild für Bild (mit Turtle-Animation) abgespielt wird. Während das Programm
   läuft, fragt der Interpreter mit busy() nach, ob er warten soll, bis die Grafik
   aufgeholt hat (whenIdle). So laufen auch endlose Animationen live. */
(function (global) {
'use strict';

function create(hooks) {
  const wins = new Map();
  const queue = [];
  let qi = 0, cur = null, raf = 0, lastT = 0, nextId = 1, z = 1, blocked = false;
  let fast = false;         // ⏩ gedrückt: bis zum nächsten Programmstart ohne Animation zeichnen
  let timed = 0;            // Befehle in der Warteschlange, die Zeit brauchen (Bewegung, Pause)
  const idleCbs = [];
  let layer = null;

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div'); layer.className = 'gfx-layer';
    document.body.appendChild(layer);
    return layer;
  }

  // ---------------------------------------------------------------- Fenster
  function newWindow(o) {
    const id = nextId++;
    const w = { id, kind: o.kind, w: o.w, h: o.h, bg: o.bg || 'white', turtles: new Map(), closed: false };
    const el = document.createElement('section'); el.className = 'gfx-win'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title);
    el.style.setProperty('--gw', o.w + 'px');
    el.innerHTML = `<header class="gfx-head"><span class="gfx-title"></span><button type="button" class="gfx-btn gfx-fast" title="Animation überspringen" aria-label="Animation überspringen">⏩</button><button type="button" class="gfx-btn gfx-close" title="Fenster schließen" aria-label="Fenster schließen">✕</button></header>
      <div class="gfx-stage" style="aspect-ratio:${o.w}/${o.h}"><canvas class="gfx-base"></canvas><canvas class="gfx-top"></canvas></div><div class="gfx-status" hidden></div>`;
    w.el = el; w.titleEl = el.querySelector('.gfx-title'); w.titleEl.textContent = o.title;
    w.statusEl = el.querySelector('.gfx-status');
    const dpr = Math.min(2, global.devicePixelRatio || 1); w.dpr = dpr;
    w.base = el.querySelector('.gfx-base'); w.top = el.querySelector('.gfx-top');
    for (const c of [w.base, w.top]) { c.width = Math.round(o.w * dpr); c.height = Math.round(o.h * dpr); }
    w.g = w.base.getContext('2d', { willReadFrequently: false }); w.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    w.t = w.top.getContext('2d'); w.t.setTransform(dpr, 0, 0, dpr, 0, 0);
    w.g.fillStyle = w.bg; w.g.fillRect(0, 0, o.w, o.h);
    w.g.lineCap = 'round'; w.g.lineJoin = 'round';
    el.querySelector('.gfx-close').addEventListener('click', () => closeWin(w));
    el.querySelector('.gfx-fast').addEventListener('click', () => { fast = true; finish(); });
    el.addEventListener('pointerdown', () => { el.style.zIndex = ++z; });
    dragHandle(el, el.querySelector('.gfx-head'));
    ensureLayer().appendChild(el);
    // gestaffelt oben rechts platzieren
    const n = [...wins.values()].filter(x => !x.closed).length;
    const vw = global.innerWidth, vh = global.innerHeight;
    const shown = Math.min(o.w, vw - 24);
    const left = Math.max(12, vw - shown - 24 - n * 28), top = Math.max(12, Math.min(64 + n * 28, vh - 120));
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.zIndex = ++z;
    wins.set(id, w);
    return id;
  }
  function dragHandle(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      on = true; sx = ev.clientX; sy = ev.clientY; ox = el.offsetLeft; oy = el.offsetTop; handle.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!on) return;
      const x = Math.min(global.innerWidth - 60, Math.max(-el.offsetWidth + 80, ox + ev.clientX - sx));
      const y = Math.min(global.innerHeight - 40, Math.max(0, oy + ev.clientY - sy));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    });
    const end = () => { on = false; };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  function closeWin(w) { if (w.closed) return; w.closed = true; w.el.remove(); }
  function closeAll() { for (const w of wins.values()) closeWin(w); wins.clear(); cancel(); }
  // Noch nicht abgespielte Befehle verwerfen (Programm beendet)
  function cancel() { queue.length = 0; qi = 0; cur = null; timed = 0; if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; idle(); }

  // ---------------------------------------------------------------- Turtle-Figur (eigene Zeichnung)
  function drawTurtle(ctx, x, y, h, color, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(h * Math.PI / 180); ctx.scale(s, s);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,30,25,.85)';
    ctx.fillStyle = color;
    // Beine
    for (const [lx, ly] of [[-6, -5], [6, -5], [-6, 6], [6, 6]]) { ctx.beginPath(); ctx.ellipse(lx, ly, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    // Kopf
    ctx.beginPath(); ctx.ellipse(0, -11, 3, 3.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Schwanz
    ctx.beginPath(); ctx.moveTo(-1.5, 9); ctx.lineTo(0, 13); ctx.lineTo(1.5, 9); ctx.fill(); ctx.stroke();
    // Panzer
    ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 8.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,30,25,.45)';
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(4, -3); ctx.moveTo(-4, 3); ctx.lineTo(4, 3); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    ctx.restore();
  }
  function drawTurtles(w) {
    const c = w.t; c.clearRect(0, 0, w.w, w.h);
    for (const t of w.turtles.values()) if (!t.hidden) drawTurtle(c, t.x, t.y, t.h, t.color);
  }

  // ---------------------------------------------------------------- Zeichenbefehle
  function stroke(g, op) { g.strokeStyle = op.color; g.lineWidth = op.width || 1; }
  function instant(w, op) {
    const g = w.g;
    switch (op.t) {
      case 'pose': { const t = tur(w, op.tid); Object.assign(t, { x: op.x, y: op.y, h: op.h, color: op.color, hidden: op.hidden }); return true; }
      case 'line': g.beginPath(); g.moveTo(op.x1, op.y1); g.lineTo(op.x2, op.y2); stroke(g, op); g.stroke(); return false;
      case 'poly': {
        if (!op.pts.length) return false;
        g.beginPath(); g.moveTo(op.pts[0].x, op.pts[0].y); for (const p of op.pts.slice(1)) g.lineTo(p.x, p.y); g.closePath();
        if (op.fill) { g.fillStyle = op.color; g.fill(); } else { stroke(g, op); g.stroke(); }
        return false;
      }
      case 'circle': g.beginPath(); g.ellipse(op.x, op.y, Math.max(0.01, op.rx), Math.max(0.01, op.ry), 0, 0, Math.PI * 2); if (op.fill) { g.fillStyle = op.color; g.fill(); } else { stroke(g, op); g.stroke(); } return false;
      case 'arc': {
        const a0 = -op.start * Math.PI / 180, a1 = -(op.start + op.ext) * Math.PI / 180;
        g.beginPath(); if (op.fill) g.moveTo(op.x, op.y);
        g.ellipse(op.x, op.y, Math.max(0.01, op.rx), Math.max(0.01, op.ry), 0, a0, a1, op.ext > 0);
        if (op.fill) { g.closePath(); g.fillStyle = op.color; g.fill(); } else { stroke(g, op); g.stroke(); }
        return false;
      }
      case 'text': g.font = op.font; g.fillStyle = op.color; g.textBaseline = 'alphabetic'; g.fillText(op.s, op.x, op.y); return false;
      case 'clear': w.bg = op.bg; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = op.bg; g.fillRect(0, 0, w.base.width, w.base.height); g.restore(); return false;
      case 'flood': flood(w, op.x, op.y, op.color); return false;
      case 'stamp': drawTurtle(g, op.x, op.y, op.h, op.color); return false;
      case 'title': w.titleEl.textContent = op.s; w.el.setAttribute('aria-label', op.s); return false;
      case 'status': w.statusEl.hidden = false; w.statusEl.textContent = op.s; return false;
      case 'close': closeWin(w); return false;
    }
    return false;
  }
  function tur(w, id) { let t = w.turtles.get(id); if (!t) { t = { x: w.w / 2, y: w.h / 2, h: 0, color: 'cyan', hidden: false }; w.turtles.set(id, t); } return t; }

  // Farbe → RGBA über eine 1×1-Leinwand
  let probe = null;
  function rgba(color) {
    if (!probe) probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = color; probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data;
  }
  function flood(w, x, y, color) {
    const W = w.base.width, H = w.base.height;
    const px = Math.floor(x * w.dpr), py = Math.floor(y * w.dpr);
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const img = w.g.getImageData(0, 0, W, H), d = img.data;
    const i0 = (py * W + px) * 4; const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
    const [fr, fg, fb] = rgba(color);
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 6) return;
    const tol = 90; // Kantenglättung der Linien berücksichtigen
    const same = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= tol;
    const seen = new Uint8Array(W * H);
    const stack = [px, py];
    while (stack.length) {
      const sy = stack.pop(); let sx = stack.pop();
      let p = sy * W + sx;
      while (sx > 0 && !seen[p - 1] && same((p - 1) * 4)) { sx--; p--; }
      let up = false, dn = false;
      for (; sx < W && !seen[p] && same(p * 4); sx++, p++) {
        seen[p] = 1; const i = p * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
        if (sy > 0) { const q = p - W; const ok = !seen[q] && same(q * 4); if (ok && !up) { stack.push(sx, sy - 1); up = true; } else if (!ok) up = false; }
        if (sy < H - 1) { const q = p + W; const ok = !seen[q] && same(q * 4); if (ok && !dn) { stack.push(sx, sy + 1); dn = true; } else if (!ok) dn = false; }
      }
    }
    w.g.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- Abspielen
  const isTimed = (o) => o.t === 'sleep' || ((o.t === 'move' || o.t === 'turn') && isFinite(o.speed));
  function op(winId, o) { if (isTimed(o)) timed++; queue.push([winId, o]); if (!raf) { lastT = 0; raf = requestAnimationFrame(tick); } }
  // true, wenn das Programm warten sollte, bis die Grafik aufgeholt hat
  function busy() { return timed > 40 || queue.length - qi > 4000; }
  function isIdle() { return !cur && qi >= queue.length; }
  function whenIdle(cb) { if (isIdle()) cb(); else idleCbs.push(cb); }
  function idle() { const cbs = idleCbs.splice(0); for (const cb of cbs) { try { cb(); } catch (e) { setTimeout(() => { throw e; }); } } }
  // Liefert true, wenn der Befehl Zeit braucht (dann wird cur gesetzt)
  function start(winId, o) {
    if (fast && isTimed(o)) { if (o.t === 'sleep') return false; o = { ...o, speed: Infinity }; }
    if (o.t === 'sleep') { cur = { kind: 'sleep', left: Math.max(0, o.ms) }; return true; }
    const w = wins.get(winId); if (!w || w.closed) return false;
    if (o.t === 'move') {
      const t = tur(w, o.tid); t.color = o.tcolor; t.hidden = o.hidden; t.h = o.h;
      const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      const dur = (!isFinite(o.speed) || len === 0) ? 0 : len / o.speed * 1000;
      if (dur <= 0) { segment(w, o, 0, 1); t.x = o.x2; t.y = o.y2; w.dirty = true; return false; }
      cur = { kind: 'move', w, o, t, dur, el: 0, done: 0 }; return true;
    }
    if (o.t === 'turn') {
      const t = tur(w, o.tid); let delta = ((o.h - t.h) % 360 + 540) % 360 - 180;
      const dur = isFinite(o.speed) ? Math.abs(delta) / (o.speed * 5) * 1000 : 0;
      if (dur < 8) { t.h = o.h; w.dirty = true; return false; }
      cur = { kind: 'turn', w, t, from: t.h, delta, dur, el: 0 }; return true;
    }
    instant(w, o); w.dirty = true; return false;
  }
  function segment(w, o, a, b) {
    if (!o.pen || b <= a) return;
    const g = w.g; const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
    g.beginPath(); g.moveTo(o.x1 + dx * a, o.y1 + dy * a); g.lineTo(o.x1 + dx * b, o.y1 + dy * b);
    g.strokeStyle = o.color; g.lineWidth = o.width || 1; g.lineCap = 'round'; g.stroke();
  }
  function advance(c, dt) { // gibt übrige Zeit zurück, wenn fertig; sonst -1
    c.el += dt;
    if (c.kind === 'sleep') { c.left -= dt; return c.left <= 0 ? -c.left : -1; }
    const f = Math.min(1, c.el / c.dur);
    if (c.kind === 'move') {
      segment(c.w, c.o, c.done, f); c.done = f;
      c.t.x = c.o.x1 + (c.o.x2 - c.o.x1) * f; c.t.y = c.o.y1 + (c.o.y2 - c.o.y1) * f;
    } else { c.t.h = c.from + c.delta * f; }
    c.w.dirty = true;
    return f >= 1 ? c.el - c.dur : -1;
  }
  function tick(now) {
    raf = 0;
    let dt = lastT ? Math.min(100, now - lastT) : 16; lastT = now;
    const t0 = performance.now();
    let ops = 0;
    while (true) {
      if (cur) { const rest = advance(cur, dt); if (rest < 0) break; dt = rest; cur = null; }
      if (qi >= queue.length) break;
      const [id, o] = queue[qi++]; if (isTimed(o)) timed--; start(id, o);
      if (++ops % 500 === 0 && performance.now() - t0 > 12) break;
    }
    if (qi > 5000 && qi >= queue.length / 2) { queue.splice(0, qi); qi = 0; }
    redraw();
    if (cur || qi < queue.length) raf = requestAnimationFrame(tick);
    else { queue.length = 0; qi = 0; lastT = 0; timed = 0; idle(); }
  }
  function redraw() { for (const w of wins.values()) if (w.dirty && !w.closed) { drawTurtles(w); w.dirty = false; } }
  // Alles sofort zeichnen (Knopf ⏩ und vor Eingabedialogen)
  function finish() {
    if (cur) { if (cur.kind !== 'sleep') advance(cur, Infinity); cur = null; }
    while (qi < queue.length) { const [id, o] = queue[qi++]; if (o.t === 'sleep') continue; if (start(id, o)) { advance(cur, Infinity); cur = null; } }
    queue.length = 0; qi = 0; timed = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    redraw();
    idle();
  }

  // ---------------------------------------------------------------- Ein- und Ausgabe
  function input(promptText, title) {
    hooks.beforeDialog && hooks.beforeDialog(); finish();
    const t0 = Date.now();
    let r = null;
    try { r = global.prompt(promptText, ''); } catch (e) { r = null; }
    blocked = r === null && Date.now() - t0 < 40;
    if (r !== null && hooks.echo && (title === 'Console' || title === 'Scanner')) hooks.echo(r + '\n');
    return r;
  }
  function message(text, title) {
    hooks.beforeDialog && hooks.beforeDialog(); finish();
    const t0 = Date.now();
    try { global.alert(text); } catch (e) { }
    if (Date.now() - t0 < 40 && hooks.note) hooks.note(`[${title || 'Meldung'}] ${text}\n`);
  }
  return {
    newWindow, op, input, message, closeAll, finish, cancel, busy, whenIdle,
    skipping: () => fast, resetFast: () => { fast = false; },
    inputBlocked: () => blocked,
    lastLine: () => (hooks.lastLine ? hooks.lastLine() : ''),
    windowCount: () => [...wins.values()].filter(w => !w.closed).length,
  };
}
global.WBGfx = { create };
})(typeof window !== 'undefined' ? window : globalThis);
