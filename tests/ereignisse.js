// Test für Maus-/Tastaturereignisse, Bilder, Töne und Terminal-Eingaben (Node.js, ohne Browser):
//   node tests/ereignisse.js
// Simuliert ein Grafikfenster, schickt Ereignisse und prüft die Ausgaben der Java-Programme.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..');
const ctx = { console, setTimeout, clearTimeout, setImmediate, performance, Date, Promise, MessageChannel, queueMicrotask, Math };
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['interp.js', 'aplu.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const R = ctx.JavaRT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FAELLE = [
{ name: 'GPanel: Listener, getKeyCodeWait, kbhit, Bild', code: [`
import ch.aplu.util.*;
import java.awt.event.*;
public class Main implements MouseListener, KeyListener {
  GPanel p;
  public Main() { p = new GPanel(0, 10, 0, 10); p.addMouseListener(this); p.addKeyListener(this); }
  public void mousePressed(MouseEvent e) { System.out.println("press " + p.toWindowX(e.getX()) + " b=" + e.getButton()); }
  public void mouseReleased(MouseEvent e) { System.out.println("release"); }
  public void mouseClicked(MouseEvent e) { System.out.println("click " + e.getClickCount()); }
  public void mouseEntered(MouseEvent e) { }
  public void mouseExited(MouseEvent e) { }
  public void keyPressed(KeyEvent e) {
    switch (e.getKeyCode()) { case KeyEvent.VK_LEFT: System.out.println("links"); break; default: System.out.println("code " + e.getKeyCode() + " " + KeyEvent.getKeyText(e.getKeyCode())); }
  }
  public void keyReleased(KeyEvent e) { }
  public void keyTyped(KeyEvent e) { System.out.println("typed " + e.getKeyChar()); }
  public static void main(String[] args) {
    Main m = new Main();
    int k = m.p.getKeyCodeWait();
    System.out.println("Taste " + k);
    while (!m.p.kbhit()) { m.p.delay(5); }
    System.out.println("kbhit " + m.p.getKey() + " danach " + (int) m.p.getKey());
    System.out.println(m.p.image("ball.png", 5, 5) + " " + m.p.imageWidth("ball.png"));
  }
}`], events: [{ type: 'press', x: 250, y: 250, button: 1, clicks: 1 }, { type: 'release', x: 250, y: 250, button: 1, clicks: 1 }, { type: 'click', x: 250, y: 250, button: 1, clicks: 1 }, { type: 'keydown', code: 37, ch: 65535 }, { type: 'keydown', code: 65, ch: 97 }, { type: 'typed', code: 0, ch: 97 }],
  expect: ['press 5.0 b=1', 'release', 'click 1', 'links', 'Taste 37', 'code 65 A', 'kbhit a danach 65535', 'OP {"t":"image","url":"data:bild","x":250,"y":241,"w":20,"h":10}', 'true 0.4', 'MAIN ok', 'typed a'] },
{ name: 'Turtle: TurtleFrame, MouseHitListener, MouseAdapter, ExitListener, Monitor, Sprite, Töne', code: [`
import ch.aplu.turtle.*;
import ch.aplu.util.*;
public class Main implements MouseHitListener, ExitListener {
  Turtle t;
  public Main() {
    TurtleFrame tf = new TurtleFrame("Test", 300, 200);
    t = new Turtle(tf);
    Turtle s = new Turtle(tf, "ball.png");
    tf.addMouseHitListener(this);
    t.addExitListener(this);
    t.addMouseListener(new Maus(t));
    t.sound(440, 20);
    System.out.println("frame " + (t.getFrame() == tf));
  }
  public void mouseHit(double x, double y) { System.out.println("hit " + x + " " + y); }
  public void notifyExit() { System.out.println("exit"); Monitor.wakeUp(); }
  public static void main(String[] args) {
    new Main();
    Monitor.putSleep();
    System.out.println("aufgewacht");
    new SoundPlayer("ton.wav").play();
  }
}`, `
import java.awt.event.*;
import ch.aplu.turtle.*;
public class Maus extends MouseAdapter {
  Turtle t;
  Maus(Turtle t) { this.t = t; }
  public void mousePressed(MouseEvent e) { System.out.println("Maus " + t.toTurtleX(e.getX()) + " " + e.getSource()); }
}`], events: [{ type: 'press', x: 200, y: 50, button: 1, clicks: 1 }, { type: 'closing' }],
  expect: ['"sprite":"data:bild"', 'OP {"t":"tone","freq":440,"ms":20,"vol":1}', 'frame true', 'Maus 50.0 TurtleFrame', 'hit 50.0 50.0', 'exit', 'closing true', 'aufgewacht', '"t":"sound"', 'MAIN ok'] },
{ name: 'Fehler: falscher Listener, Ausnahme im Ereignis', code: [`
import ch.aplu.util.*;
import java.awt.event.*;
public class Main extends GPanel implements MouseListener {
  String s;
  public Main() { addMouseListener(this); }
  public void mousePressed(MouseEvent e) { System.out.println(s.length()); }
  public void mouseReleased(MouseEvent e) { }
  public void mouseClicked(MouseEvent e) { }
  public void mouseEntered(MouseEvent e) { }
  public void mouseExited(MouseEvent e) { }
  public static void main(String[] args) { new Main(); new GPanel().addKeyListener(new Main()); }
}`], events: [{ type: 'press', x: 1, y: 1, button: 1, clicks: 1 }],
  expect: ['MAIN Hier wird ein Objekt erwartet, das KeyListener implementiert', 'EVENT-ERR mousePressed java.lang.NullPointerException'] },
{ name: 'Terminal: Scanner (Rest der Zeile wie in Java), hasNextInt, Console.readInt', input: ['3 4', 'Ada', 'abc', '12', 'x', '5', 'q'], code: [`
import java.util.Scanner;
import ch.aplu.util.Console;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int a = sc.nextInt(); int b = sc.nextInt();
    String rest = sc.nextLine();
    String name = sc.nextLine();
    System.out.println(a + b + " [" + rest + "] " + name);
    while (!sc.hasNextInt()) { System.out.println("keine Zahl: " + sc.next()); }
    System.out.println("Zahl " + sc.nextInt());
    System.out.println("Console " + Console.readInt());
    System.out.println("Taste " + Console.getKey());
  }
}`], events: [],
  expect: ['7 [] Ada', 'keine Zahl: abc', 'Zahl 12', 'Bitte eine ganze Zahl eingeben.', 'Console 5', 'Taste q', 'MAIN ok'] },
];

(async () => {
  let bad = 0;
  for (const f of FAELLE) {
    const L = {}; const out = [];
    const gfx = { n: 1, newWindow() { return this.n++; }, op(w, o) { if (o.t !== 'pose' || o.sprite) out.push('OP ' + JSON.stringify(o)); }, input() { return '7'; }, message() { }, lastLine() { return ''; }, busy() { return false; }, whenIdle(cb) { cb(); }, listen(w, fn) { L[w] = fn; } };
    const lines = [...(f.input || [])];
    const rt = new R.Runtime({ out: (s) => out.push(s.trimEnd()), gfx,
      ...(f.input ? { readLine: () => Promise.resolve(lines.length ? lines.shift() : null), readKey: () => Promise.resolve(lines.length ? lines.shift().charCodeAt(0) : null) } : {}),
      assets: (n) => /ball\.png$/.test(n) ? { kind: 'image', url: 'data:bild', w: 20, h: 10 } : n === 'ton.wav' ? { kind: 'audio', url: 'data:ton' } : null,
      runEvent: (g, label) => rt.runAsync(g).then(r => { if (!r.ok) out.push('EVENT-ERR ' + label + ' ' + r.message); }),
      onEvent: (r, label) => { if (!r.ok) out.push('EVENT-ERR ' + label + ' ' + r.message); } });
    const res = rt.compile(f.code.map((c, i) => ({ id: 'f' + i, code: c })));
    if (!res.ok) { bad++; console.log(f.name + ': ÜBERSETZUNGSFEHLER ' + JSON.stringify(res.errors)); continue; }
    const m = rt.cls('Main').methods.get('main')[0];
    rt.runAsync(() => rt.callMethodG(null, m, [new R.JArray(R.T('String'), [])])).then(r => out.push('MAIN ' + (r.ok ? 'ok' : r.message)));
    for (const e of f.events) { await sleep(30); const r = L[1] && L[1](e); if (e.type === 'closing') out.push('closing ' + r); }
    await sleep(80);
    if (rt.running) rt.stop();
    const text = out.join('\n'); let pos = 0; const missing = [];
    for (const x of f.expect) { const i = text.indexOf(x, pos); if (i < 0) missing.push(x); else pos = i + x.length; }
    if (missing.length) { bad++; console.log(f.name + ': FEHLT (in dieser Reihenfolge) ' + JSON.stringify(missing) + '\n' + text); } else console.log(f.name + ': OK');
  }
  process.exit(bad ? 1 : 0);
})();
