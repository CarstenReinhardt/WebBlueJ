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
    const el = document.createElement('section'); el.className = 'gfx-win'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title); el.tabIndex = -1;
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
    el.querySelector('.gfx-close').addEventListener('click', () => {
      // Mit ExitListener entscheidet das Programm (wie in APLU); beim zweiten Klick wird trotzdem geschlossen
      if (w.listener && !w.dead && !w.exitAsked && w.listener({ type: 'closing' }) === true) { w.exitAsked = true; return; }
      closeWin(w);
    });
    el.querySelector('.gfx-fast').addEventListener('click', () => { fast = true; finish(); });
    el.addEventListener('pointerdown', () => { el.style.zIndex = ++z; });
    dragHandle(el, el.querySelector('.gfx-head'));
    inputEvents(w, el.querySelector('.gfx-stage'));
    ensureLayer().appendChild(el);
    // gestaffelt oben rechts platzieren
    const n = [...wins.values()].filter(x => !x.closed).length;
    const vw = global.innerWidth, vh = global.innerHeight;
    const shown = Math.min(o.w, vw - 24);
    const left = Math.max(12, vw - shown - 24 - n * 28), top = Math.max(12, Math.min(64 + n * 28, vh - 120));
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.zIndex = ++z;
    wins.set(id, w);
    // Neues Fenster bekommt den Tastaturfokus (wie ein neues Java-Fenster)
    try { el.focus({ preventScroll: true }); } catch (e) { }
    return id;
  }
  // Maus- und Tastaturereignisse an das Programm weitergeben (listen(win, fn))
  const JAVA_KEY = { 13: 10, 46: 127, 45: 155, 91: 524, 93: 525, 173: 45, 189: 45, 187: 61, 188: 44, 190: 46, 191: 47, 186: 59, 219: 91, 221: 93, 220: 92, 222: 222, 192: 192 };
  function inputEvents(w, stage) {
    const el = w.el;
    const send = (ev) => { if (w.listener && !w.closed && !w.dead) { try { w.listener(ev); } catch (e) { setTimeout(() => { throw e; }); } } };
    const pos = (ev) => { const r = stage.getBoundingClientRect(); return { x: Math.round((ev.clientX - r.left) / r.width * w.w), y: Math.round((ev.clientY - r.top) / r.height * w.h) }; };
    const mods = (ev) => ({ shift: ev.shiftKey, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey });
    const btn = (ev) => ev.button === 2 ? 3 : ev.button === 1 ? 2 : 1;
    let down = 0;
    stage.addEventListener('pointerdown', (ev) => {
      try { el.focus({ preventScroll: true }); } catch (e) { }
      down = btn(ev); try { stage.setPointerCapture(ev.pointerId); } catch (e) { }
      ev.preventDefault();
      send({ type: 'press', ...pos(ev), button: down, clicks: Math.max(1, ev.detail || 1), ...mods(ev) });
    });
    stage.addEventListener('pointermove', (ev) => send({ type: down ? 'drag' : 'move', ...pos(ev), button: down, clicks: 0, ...mods(ev) }));
    const up = (ev) => { if (!down) return; const b = down; down = 0; send({ type: 'release', ...pos(ev), button: b, clicks: Math.max(1, ev.detail || 1), ...mods(ev) }); };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('click', (ev) => send({ type: 'click', ...pos(ev), button: btn(ev), clicks: Math.max(1, ev.detail || 1), ...mods(ev) }));
    stage.addEventListener('auxclick', (ev) => send({ type: 'click', ...pos(ev), button: btn(ev), clicks: 1, ...mods(ev) }));
    stage.addEventListener('dblclick', (ev) => send({ type: 'dblclick', ...pos(ev), button: 1, clicks: 2, ...mods(ev) }));
    stage.addEventListener('pointerenter', (ev) => send({ type: 'enter', ...pos(ev), button: 0, clicks: 0, ...mods(ev) }));
    stage.addEventListener('pointerleave', (ev) => send({ type: 'exit', ...pos(ev), button: 0, clicks: 0, ...mods(ev) }));
    stage.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const key = (type) => (ev) => {
      if (ev.target.closest && ev.target.closest('button')) { if (ev.key === 'Enter' || ev.key === ' ') return; }
      if (ev.ctrlKey && /^[a-z]$/i.test(ev.key) && type === 'keydown' && 'cvxsaz'.includes(ev.key.toLowerCase())) return; // Kopieren usw. nicht abfangen
      const code = JAVA_KEY[ev.keyCode] !== undefined ? JAVA_KEY[ev.keyCode] : ev.keyCode;
      let ch = 65535;
      if (ev.key.length === 1) ch = ev.key.charCodeAt(0);
      else if (ev.key === 'Enter') ch = 10; else if (ev.key === 'Backspace') ch = 8; else if (ev.key === 'Tab') ch = 9; else if (ev.key === 'Escape') ch = 27; else if (ev.key === 'Delete') ch = 127;
      if (type === 'keydown' && (ev.key.startsWith('Arrow') || ev.key === ' ' || ev.key === 'Tab' || ev.key === 'Backspace' || ev.key.length === 1 || ev.key === 'Enter')) ev.preventDefault();
      ev.stopPropagation();
      send({ type, code, ch, repeat: ev.repeat, ...mods(ev) });
      if (type === 'keydown' && ch !== 65535) send({ type: 'typed', code: 0, ch, ...mods(ev) });
    };
    el.addEventListener('keydown', key('keydown'));
    el.addEventListener('keyup', key('keyup'));
  }
  function listen(id, fn) { const w = wins.get(id); if (w) w.listener = fn; }
  // Nach „Beenden“: Fenster bleiben sichtbar, melden aber keine Ereignisse mehr
  function detach() { for (const w of wins.values()) w.dead = true; }
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
  function closeWin(w) { if (w.closed) return; w.closed = true; w.el.remove(); if (w.listener) { try { w.listener({ type: 'closed' }); } catch (e) { } } }
  function closeAll() { for (const w of wins.values()) closeWin(w); wins.clear(); cancel(); }
  // Noch nicht abgespielte Befehle verwerfen (Programm beendet)
  function cancel() { queue.length = 0; qi = 0; cur = null; timed = 0; if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; stopSounds(); idle(); }

  // ---------------------------------------------------------------- Bilder (aus dem Projekt, als data:-URL)
  const imgs = new Map();
  function image(url) {
    let im = imgs.get(url);
    if (!im) { im = new Image(); im.decoding = 'async'; im.src = url; imgs.set(url, im); }
    return im;
  }
  const imgReady = (im) => im.complete;
  function drawImg(g, op) {
    const im = image(op.url); if (!im.complete || !im.naturalWidth) return;
    const w = op.w || im.naturalWidth, h = op.h || im.naturalHeight;
    g.save(); g.translate(op.x, op.y); if (op.rot) g.rotate(op.rot * Math.PI / 180);
    if (op.anchor === 'center') g.drawImage(im, -w / 2, -h / 2, w, h); else g.drawImage(im, 0, 0, w, h);
    g.restore();
  }

  // ---------------------------------------------------------------- Töne und Klänge (Web Audio / <audio>)
  let actx = null;
  const voices = new Set();
  function audio() {
    if (!actx) { const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return null; try { actx = new AC(); } catch (e) { return null; } }
    if (actx.state === 'suspended') actx.resume().catch(() => { });
    return actx;
  }
  function tone(freq, ms, vol) {
    const ac = audio(); if (!ac || !(freq > 0) || !(ms > 0)) return;
    const t0 = ac.currentTime, dur = ms / 1000, v = Math.max(0, Math.min(1, vol)) * 0.25;
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    const ramp = Math.min(0.02, dur / 4);
    gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(v, t0 + ramp);
    gain.gain.setValueAtTime(v, t0 + dur - ramp); gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain).connect(ac.destination); osc.start(t0); osc.stop(t0 + dur + 0.02);
    voices.add(osc); osc.onended = () => voices.delete(osc);
  }
  const players = new Map();   // id → { el, waiters }
  function player(id) { let p = players.get(id); if (!p) { p = { el: null, waiters: [] }; players.set(id, p); } return p; }
  function sound(op) {
    const p = player(op.id);
    if (op.act === 'play' || op.act === 'loop' || op.act === 'replay') {
      if (!p.el || p.el.dataset.url !== op.url) {
        if (p.el) p.el.pause();
        p.el = new Audio(op.url); p.el.dataset.url = op.url;
        p.el.addEventListener('ended', () => { if (!p.el.loop) { const ws = p.waiters.splice(0); ws.forEach(f => f()); } });
        p.el.addEventListener('error', () => { const ws = p.waiters.splice(0); ws.forEach(f => f()); });
      }
      p.el.loop = op.act === 'loop';
      p.el.volume = Math.max(0, Math.min(1, op.vol));
      if (op.act === 'replay') p.el.currentTime = 0;
      const pr = p.el.play(); if (pr && pr.catch) pr.catch(() => { const ws = p.waiters.splice(0); ws.forEach(f => f()); });
    } else if (op.act === 'stop') { if (p.el) { p.el.pause(); p.el.currentTime = 0; } const ws = p.waiters.splice(0); ws.forEach(f => f()); }
    else if (op.act === 'pause') { if (p.el) p.el.pause(); }
    else if (op.act === 'volume') { if (p.el) p.el.volume = Math.max(0, Math.min(1, op.vol)); }
  }
  function soundPlaying(id) { const p = players.get(id); return !!(p && p.el && !p.el.paused && !p.el.ended); }
  function whenSoundEnds(id, cb) { if (!soundPlaying(id) && !(qi < queue.length)) { cb(); return; } player(id).waiters.push(cb); }
  function stopSounds() {
    for (const o of voices) { try { o.stop(); } catch (e) { } } voices.clear();
    for (const p of players.values()) { if (p.el) p.el.pause(); const ws = p.waiters.splice(0); ws.forEach(f => f()); }
    players.clear();
  }

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
    for (const t of w.turtles.values()) if (!t.hidden) { if (t.sprite) drawImg(c, { url: t.sprite, x: t.x, y: t.y, rot: t.h, anchor: 'center' }); else drawTurtle(c, t.x, t.y, t.h, t.color); }
  }

  // ---------------------------------------------------------------- Zeichenbefehle
  function stroke(g, op) { g.strokeStyle = op.color; g.lineWidth = op.width || 1; }
  function instant(w, op) {
    const g = w.g;
    switch (op.t) {
      case 'pose': { const t = tur(w, op.tid); Object.assign(t, { x: op.x, y: op.y, h: op.h, color: op.color, hidden: op.hidden, sprite: op.sprite || null }); return true; }
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
      case 'stamp': if (op.sprite) drawImg(g, { url: op.sprite, x: op.x, y: op.y, rot: op.h, anchor: 'center' }); else drawTurtle(g, op.x, op.y, op.h, op.color); return false;
      case 'image': drawImg(g, op); return false;
      case 'bkimage': { const im = image(op.url); if (im.naturalWidth) g.drawImage(im, (w.w - im.naturalWidth) / 2, (w.h - im.naturalHeight) / 2); return false; }
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
    if (o.t === 'tone') { if (!fast) tone(o.freq, o.ms, o.vol); return false; }
    if (o.t === 'sound') { sound(o); return false; }
    const w = wins.get(winId); if (!w || w.closed) return false;
    // Bild noch nicht geladen: Abspielen kurz anhalten (data:-URLs laden sehr schnell)
    const url = o.t === 'image' || o.t === 'bkimage' ? o.url : (o.t === 'pose' || o.t === 'stamp') ? o.sprite : null;
    if (url && !imgReady(image(url)) && !o.waited) { o.waited = true; qi--; if (isTimed(o)) timed++; cur = { kind: 'img', im: image(url), el: 0 }; return true; }
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
    if (c.kind === 'img') return (c.im.complete || c.el > 3000) ? 0 : -1;
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
    while (qi < queue.length) { const [id, o] = queue[qi++]; if (o.t === 'sleep' || o.t === 'tone') continue; o.waited = true; if (start(id, o)) { advance(cur, Infinity); cur = null; } }
    queue.length = 0; qi = 0; timed = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    redraw();
    idle();
  }

  // ---------------------------------------------------------------- Swing-Fenster (javax.swing)
  // Das Modell liegt im Interpreter (swing.js); hier wird es als HTML dargestellt.
  function swingWindow(o) {
    const id = nextId++;
    const w = { id, kind: 'swing', closed: false, els: new Map(), packed: !!o.packed };
    const el = document.createElement('section'); el.className = 'gfx-win sw-win'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'Fenster'); el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML = `<header class="gfx-head"><span class="gfx-title"></span><button type="button" class="gfx-btn gfx-close" title="Fenster schließen" aria-label="Fenster schließen">✕</button></header><div class="sw-body"></div>`;
    w.el = el; w.titleEl = el.querySelector('.gfx-title'); w.titleEl.textContent = o.title || '';
    w.body = el.querySelector('.sw-body');
    swingSize(w, o);
    el.querySelector('.gfx-close').addEventListener('click', () => {
      if (w.listener && !w.dead && !w.exitAsked && w.listener({ type: 'closing' }) === true) { w.exitAsked = true; return; }
      closeWin(w);
    });
    el.addEventListener('pointerdown', () => { el.style.zIndex = ++z; });
    el.addEventListener('keydown', (ev) => ev.stopPropagation());
    dragHandle(el, el.querySelector('.gfx-head'));
    ensureLayer().appendChild(el);
    wins.set(id, w);
    return id;
  }
  // Java zählt die Titelleiste zur Fenstergröße (setSize) – hier etwa 30 Pixel
  function swingSize(w, o) {
    if (o.packed || !o.w) { w.packed = true; w.el.style.setProperty('--gw', 'max-content'); w.el.style.width = 'auto'; w.el.style.maxWidth = 'calc(100vw - 24px)'; w.body.style.height = ''; w.body.style.minWidth = '120px'; }
    else { w.packed = false; w.el.style.width = ''; w.el.style.setProperty('--gw', o.w + 'px'); w.body.style.height = Math.max(30, o.h - 30) + 'px'; w.body.style.minWidth = ''; }
  }
  function swingPlace(w) {
    const n = [...wins.values()].filter(x => !x.closed && x !== w).length;
    const vw = global.innerWidth, vh = global.innerHeight;
    const r = w.el.getBoundingClientRect();
    w.el.style.left = Math.max(12, Math.min(vw - r.width - 24, (vw - r.width) / 2 + n * 28)) + 'px';
    w.el.style.top = Math.max(12, Math.min(vh - r.height - 12, 80 + n * 28)) + 'px';
  }
  const SW_AREA = { North: 'n', South: 's', East: 'e', West: 'w', Center: 'c' };
  function swingBuild(w, node, parentLayout) {
    const send = (ev) => { if (w.listener && !w.closed && !w.dead) { try { w.listener(ev); } catch (e) { setTimeout(() => { throw e; }); } } };
    let el;
    switch (node.kind) {
      case 'button': el = document.createElement('button'); el.type = 'button'; el.className = 'sw-btn'; el.addEventListener('click', () => send({ type: 'action', id: node.id })); break;
      case 'label': el = document.createElement('div'); el.className = 'sw-lbl'; break;
      case 'textfield': case 'password':
        el = document.createElement('input'); el.type = node.kind === 'password' ? 'password' : 'text'; el.className = 'sw-tf'; el.spellcheck = false; el.autocomplete = 'off';
        el.addEventListener('input', () => send({ type: 'text', id: node.id, text: el.value }));
        el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); send({ type: 'action', id: node.id, text: el.value }); } });
        break;
      case 'textarea': el = document.createElement('textarea'); el.className = 'sw-ta'; el.spellcheck = false; el.addEventListener('input', () => send({ type: 'text', id: node.id, text: el.value })); break;
      case 'checkbox': {
        el = document.createElement('label'); el.className = 'sw-cb';
        const box = document.createElement('input'); box.type = 'checkbox'; const span = document.createElement('span');
        el.append(box, span); box.addEventListener('change', () => send({ type: 'check', id: node.id, value: box.checked }));
        break;
      }
      case 'scroll': el = document.createElement('div'); el.className = 'sw-scroll'; break;
      default: el = document.createElement('div'); el.className = 'sw-panel';
    }
    el.dataset.swid = node.id;
    w.els.set(node.id, { el, node });
    if (node.children && node.children.length || node.kind === 'panel' || node.kind === 'scroll') {
      swingLayout(el, node.layout);
      for (const c of node.children) el.appendChild(swingBuild(w, c, node.layout));
    }
    const area = parentLayout && parentLayout.k === 'border' ? SW_AREA[node.cons || 'Center'] : null;
    if (area) el.style.gridArea = area;
    swingProps(el, node, parentLayout);
    return el;
  }
  function swingLayout(el, L) {
    const s = el.style; L = L || { k: 'flow', align: 1, hgap: 5, vgap: 5 };
    s.display = ''; s.position = '';
    if (L.k === 'flow') { s.display = 'flex'; s.flexWrap = 'wrap'; s.alignItems = 'center'; s.alignContent = 'flex-start'; s.justifyContent = ['flex-start', 'center', 'flex-end', 'flex-start', 'flex-end'][L.align] || 'center'; s.gap = `${L.vgap}px ${L.hgap}px`; s.padding = `${L.vgap}px ${L.hgap}px`; }
    else if (L.k === 'border') { s.display = 'grid'; s.gridTemplate = '"n n n" auto "w c e" 1fr "s s s" auto / auto 1fr auto'; s.gap = `${L.vgap}px ${L.hgap}px`; }
    else if (L.k === 'grid') { s.display = 'grid'; const n = Math.max(1, el.childElementCount); s.gridTemplateColumns = `repeat(${L.cols || Math.ceil(n / Math.max(1, L.rows))}, minmax(0, 1fr))`; s.gridAutoRows = '1fr'; s.gap = `${L.vgap}px ${L.hgap}px`; }
    else if (L.k === 'null') { s.position = 'relative'; }
    else if (L.k === 'scroll') { s.display = 'grid'; s.overflow = 'auto'; }
    el.dataset.layout = L.k;
  }
  function swingProps(el, n, parentLayout) {
    const s = el.style;
    if (n.kind === 'textfield' || n.kind === 'password') { if (el.value !== n.text) el.value = n.text; el.readOnly = !n.editable; el.size = n.cols > 0 ? n.cols : 12; if (n.cols > 0 && (!parentLayout || parentLayout.k === 'flow')) s.width = `calc(${n.cols}ch + 12px)`; s.textAlign = n.align || ''; }
    else if (n.kind === 'textarea') { if (el.value !== n.text) el.value = n.text; el.readOnly = !n.editable; if (n.rows) el.rows = n.rows; if (n.cols) el.cols = n.cols; el.wrap = n.wrap ? 'soft' : 'off'; s.whiteSpace = n.wrap ? 'pre-wrap' : 'pre'; }
    else if (n.kind === 'checkbox') { el.querySelector('span').textContent = n.text; el.querySelector('input').checked = n.selected; el.querySelector('input').disabled = !n.enabled; }
    else if (n.kind === 'button') { el.textContent = n.text; }
    else if (n.kind === 'label') {
      if (/^\s*<html>/i.test(n.text)) el.textContent = n.text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
      else el.textContent = n.text;
      s.textAlign = n.align || ''; s.justifyContent = n.align === 'center' ? 'center' : n.align === 'right' ? 'flex-end' : '';
    }
    if ('disabled' in el) el.disabled = !n.enabled;
    el.classList.toggle('sw-off', !n.enabled);
    s.color = n.fg || ''; s.font = n.font || '';
    s.background = n.bg && (n.opaque || n.kind !== 'label') ? n.bg : '';
    el.title = n.tip || '';
    s.visibility = n.visible ? '' : 'hidden';
    if (!n.visible && parentLayout && parentLayout.k !== 'null') s.display = 'none'; else if (s.display === 'none') s.display = '';
    if (parentLayout && parentLayout.k === 'null' && n.bounds) { s.position = 'absolute'; s.left = n.bounds.x + 'px'; s.top = n.bounds.y + 'px'; s.width = n.bounds.w + 'px'; s.height = n.bounds.h + 'px'; s.boxSizing = 'border-box'; }
    else if (n.pref) { s.width = n.pref.w + 'px'; s.height = n.pref.h + 'px'; s.boxSizing = 'border-box'; }
    const b = n.border;
    s.border = ''; s.padding = el.dataset.layout === 'flow' ? s.padding : '';
    el.querySelectorAll(':scope > .sw-legend').forEach(x => x.remove());
    if (b && b.k === 'empty') s.padding = `${b.t}px ${b.r}px ${b.b}px ${b.l}px`;
    else if (b && b.k === 'line') s.border = `${b.w}px solid ${b.color}`;
    else if (b && b.k === 'titled') { s.border = '1px solid #b8b8b8'; s.borderRadius = '4px'; s.paddingTop = '18px'; s.position = s.position || 'relative'; const lg = document.createElement('span'); lg.className = 'sw-legend'; lg.textContent = b.title; el.appendChild(lg); }
  }
  function swing(id, o) {
    const w = wins.get(id); if (!w || w.closed) return;
    switch (o.t) {
      case 'tree': {
        const keep = document.activeElement && w.el.contains(document.activeElement) ? document.activeElement.dataset.swid || (document.activeElement.closest('[data-swid]') || {}).dataset?.swid : null;
        w.els.clear(); w.body.innerHTML = '';
        const root = swingBuild(w, o.root, null); root.classList.add('sw-root'); w.body.appendChild(root);
        if (keep && w.els.has(+keep)) { const x = w.els.get(+keep).el; try { (x.querySelector('input') || x).focus({ preventScroll: true }); } catch (e) { } }
        break;
      }
      case 'prop': { const x = w.els.get(o.id); if (x) { Object.assign(x.node, o.props); const pl = x.el.parentElement && x.el.parentElement.dataset.layout ? { k: x.el.parentElement.dataset.layout } : null; swingProps(x.el, x.node, pl); } break; }
      case 'show': if (w.el.hidden) { w.el.hidden = false; swingPlace(w); w.el.style.zIndex = ++z; const f = w.body.querySelector('input, textarea, button'); try { (f || w.el).focus({ preventScroll: true }); } catch (e) { } } break;
      case 'title': w.titleEl.textContent = o.s; w.el.setAttribute('aria-label', o.s); break;
      case 'size': swingSize(w, o); break;
      case 'focus': { const x = w.els.get(o.id); if (x) try { (x.el.querySelector('input') || x.el).focus({ preventScroll: true }); } catch (e) { } break; }
      case 'select': { const x = w.els.get(o.id); if (x && x.el.select) { try { x.el.focus({ preventScroll: true }); x.el.select(); } catch (e) { } } break; }
      case 'close': closeWin(w); break;
    }
  }
  function confirmBox(text, title) {
    hooks.beforeDialog && hooks.beforeDialog(); finish();
    try { return global.confirm(text); } catch (e) { return true; }
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
    newWindow, op, input, message, confirm: confirmBox, swingWindow, swing, closeAll, finish, cancel, busy, whenIdle,
    listen, detach, image, soundPlaying, whenSoundEnds, stopSounds,
    skipping: () => fast, resetFast: () => { fast = false; },
    inputBlocked: () => blocked,
    lastLine: () => (hooks.lastLine ? hooks.lastLine() : ''),
    windowCount: () => [...wins.values()].filter(w => !w.closed).length,
  };
}
global.WBGfx = { create };
})(typeof window !== 'undefined' ? window : globalThis);
