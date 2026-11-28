// Zusätzliche Testprogramme für den Regressionstest
module.exports = [
{ name: 'Grundlagen', classes: [{ name: 'Main', code: `
import java.util.*;
public class Main {
  static int zaehler = 5;
  static final String[] NAMEN = { "a", "b" };
  static { zaehler = zaehler * 2; }
  int x;
  public Main(int x) { this.x = x; }
  public String toString() { return "Main(" + x + ")"; }
  public boolean equals(Object o) { return o instanceof Main && ((Main) o).x == x; }
  public int hashCode() { return x; }
  static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
  static int tief(int n) { if (n == 0) return 0; return 1 + tief(n - 1); }
  static int teile(int a, int b) { return a / b; }
  public static void main(String[] args) {
    System.out.println("zaehler=" + zaehler + " " + NAMEN.length);
    int s = 0; for (int i = 0; i < 100; i++) { if (i % 7 == 0) continue; if (i > 90) break; s += i; }
    System.out.println("s=" + s);
    System.out.println("fib=" + fib(18));
    System.out.println("tief=" + tief(300));
    Main m = new Main(3);
    System.out.println(m + " " + m.equals(new Main(3)) + " " + ("x" + new Main(4)));
    ArrayList<Main> l = new ArrayList<>(); l.add(new Main(1)); l.add(new Main(2));
    System.out.println(l + " " + l.contains(new Main(2)) + " " + l.indexOf(new Main(2)));
    HashMap<Main, String> hm = new HashMap<>(); hm.put(new Main(7), "sieben"); System.out.println(hm.get(new Main(7)));
    try { teile(1, 0); } catch (ArithmeticException e) { System.out.println("Fehler: " + e.getMessage()); } finally { System.out.println("finally"); }
    try { throw new IllegalStateException("kaputt"); } catch (RuntimeException e) { System.out.println(e); }
    int[] a = { 5, 3, 9, 1 }; Arrays.sort(a); System.out.println(Arrays.toString(a));
    int[][] g = new int[3][4]; g[1][2] = 7; System.out.println(g[1][2] + g.length * g[0].length);
    String t = ""; for (char c = 'a'; c <= 'e'; c++) t += c; System.out.println(t.toUpperCase() + t.length());
    long big = 1L << 40; System.out.println(big + " " + (big * 3));
    double d = 10 / 4.0; System.out.printf("%.2f %d %s%n", d, 42, "ok");
    StringBuilder sb = new StringBuilder(); for (int i = 0; i < 5; i++) sb.append(i).append(','); System.out.println(sb.toString());
    int k = 0; while (true) { k++; if (k >= 10) break; } System.out.println("k=" + k);
    do { k--; } while (k > 3); System.out.println("k=" + k);
    for (String n : NAMEN) System.out.print(n); System.out.println();
    switch (k) { case 1: System.out.println("eins"); break; case 3: System.out.println("drei"); default: System.out.println("fall"); }
    Object o = m; if (o instanceof Main mm) System.out.println("pattern " + mm.x);
    int y = k > 2 ? fib(5) : fib(6); System.out.println("y=" + y);
    int[] arr = new int[3]; arr[fib(3)] = fib(4); System.out.println(arr[1] + " " + arr[2]);
    arr[0] += fib(6); System.out.println(arr[0]);
    System.out.println(Math.max(fib(5), fib(6)) + " " + Math.sqrt(16));
  }
}` }] },
{ name: 'Vererbung', classes: [
 { name: 'Tier', code: `public abstract class Tier implements Comparable<Tier> {
  protected String name; private static int anzahl;
  public Tier(String name) { this.name = name; anzahl++; }
  public abstract String laut();
  public String beschreibung() { return name + " macht " + laut(); }
  public int compareTo(Tier o) { return name.compareTo(o.name); }
  public static int getAnzahl() { return anzahl; }
}` },
 { name: 'Hund', code: `public class Hund extends Tier { public Hund(String n) { super(n); } public String laut() { return "Wuff"; } public String beschreibung() { return "Hund " + super.beschreibung(); } }` },
 { name: 'Katze', code: `public class Katze extends Tier { public Katze() { this("Mieze"); } public Katze(String n) { super(n); } public String laut() { return "Miau"; } }` },
 { name: 'Farbe', code: `public enum Farbe { ROT("r"), GRUEN("g"); private String k; Farbe(String k) { this.k = k; } public String kurz() { return k; } }` },
 { name: 'Zoo', code: `import java.util.*;
public class Zoo {
  public static void main(String[] args) {
    ArrayList<Tier> t = new ArrayList<>(); t.add(new Katze()); t.add(new Hund("Bello")); t.add(new Hund("Amy"));
    for (Tier x : t) System.out.println(x.beschreibung());
    Collections.sort(t); for (Tier x : t) System.out.print(x.name + " "); System.out.println();
    TreeSet<Tier> ts = new TreeSet<>(t); System.out.println(ts.size());
    System.out.println(Tier.getAnzahl());
    for (Farbe f : Farbe.values()) System.out.println(f + " " + f.kurz() + " " + f.ordinal());
    Farbe f = Farbe.GRUEN; switch (f) { case ROT: System.out.println("rot!"); break; case GRUEN: System.out.println("gruen!"); break; }
    Object o = t.get(0); Hund h = (Hund) o; System.out.println(h.laut());
    try { Katze k = (Katze) o; } catch (ClassCastException e) { System.out.println("CCE"); }
  }
}` }] },
{ name: 'Ausnahme', classes: [{ name: 'A', code: `public class A {
  static void f(int n) { if (n == 0) { int[] a = new int[2]; a[5] = 1; } f(n - 1); }
  public static void main(String[] args) { System.out.println("vor"); f(3); System.out.println("nie"); }
}` }] },
{ name: 'Rekursion', classes: [{ name: 'R', code: `public class R {
  static int r(int n) { return r(n + 1); }
  public static void main(String[] args) { try { r(0); } catch (StackOverflowError e) { System.out.println("SOE gefangen"); } System.out.println("weiter"); r(0); }
}` }] },
{ name: 'Exit', classes: [{ name: 'E', code: `public class E { public static void main(String[] args) { System.out.println("a"); System.exit(3); System.out.println("b"); } }` }] },
{ name: 'Turtle', classes: [{ name: 'T', code: `import ch.aplu.turtle.*;
public class T { public static void main(String[] args) { Turtle t = new Turtle(); t.setColor(java.awt.Color.red); for (int i = 0; i < 4; i++) { t.forward(50); t.left(90); } t.speed(-1); t.fillToPoint(0,0); t.label("hi"); Turtle.sleep(100); t.home(); } }` }] },
{ name: 'GPanel', classes: [{ name: 'G', code: `import ch.aplu.util.*;
public class G { public static void main(String[] args) { GPanel p = new GPanel(0, 10, 0, 10); p.move(1, 1); p.draw(9, 9); p.circle(2); p.fillRectangle(3, 3); p.text("x"); GPanel.delay(50); p.color(java.awt.Color.blue); p.line(0, 0, 10, 0); } }` }] },
{ name: 'Statisch', classes: [{ name: 'S', code: `public class S {
  static int[] tab = mach(); static int calls = 0;
  static int[] mach() { int[] t = new int[5]; for (int i = 0; i < 5; i++) t[i] = i * i; return t; }
  int id = ++calls;
  { System.out.println("init " + id); }
  public static void main(String[] args) { System.out.println(tab[4]); new S(); new S(); System.out.println(calls); }
}` }] },
];
