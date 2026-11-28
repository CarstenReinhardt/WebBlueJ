# WebBlueJ – Java-Werkbank im Browser

Eine Lernumgebung für Java, die komplett im Browser läuft. Keine Installation, kein Server, kein JDK nötig.

## Funktionen

- **Klassendiagramm**: Klassen anlegen und verschieben. Pfeile für Vererbung, Interfaces und Benutzung werden automatisch gezeichnet.
- **Editor**: Syntaxhervorhebung, farbige Bereiche wie in BlueJ (Klasse, Methode, Schleife, Verzweigung), Markierung der passenden Klammer, Klammern automatisch schließen, Suchen und Ersetzen (`Strg+F`, `Strg+H`), Gehe zu Zeile (`Strg+G`), ganzen Quelltext neu einrücken (`Strg+Umschalt+F`), Ein-/Auskommentieren (`Strg+#`), Übersetzen mit `Strg+S`. Fehler werden mit Zeile und deutschem Hinweis markiert.
- **Einstellungen** (⚙): Schriftgröße für Editor und Terminal (auch für den Beamer, im Editor mit `Strg` + `+`/`−`), helles oder dunkles Design, Einrückweite, Bereichsfärbung und automatisches Klammerschließen an/aus.
- **Objekte interaktiv**: Klick auf eine Klasse erzeugt Objekte (`new …`) oder ruft statische Methoden wie `main` auf.
- **Objektleiste**: Methoden an Objekten aufrufen und Objekte inspizieren.
- **Terminal wie in BlueJ**: Ausgaben von `System.out` (`System.err` rot) in einem eigenen, verschiebbaren Fenster, das bei Ausgabe oder Eingabe von selbst erscheint (oder unten angedockt). Eingaben für `Scanner` und `Console.readInt()` usw. werden direkt im Terminal getippt. Optionen: bei jedem Methodenaufruf leeren, Methodenaufrufe protokollieren, kopieren, als Textdatei speichern.
- **Direkteingabe**: Java-Ausdrücke und Anweisungen direkt ausprobieren.
- **Beispielprojekte**: Bankkonto, Formen (abstrakte Klasse und Interface), Würfelspiel, Turtle-Grafik und ein Malprogramm mit Maus und Tastatur.
- **Turtle-Grafik und GPanel**: `import ch.aplu.turtle.*;` und `import ch.aplu.util.*;` funktionieren wie mit der Bibliothek `aplu5.jar`, ohne dass eine JAR-Datei nötig ist. `Turtle` (auch als Oberklasse), `GPanel`, `Console`, `InputDialog`, `MessageDialog` sowie `java.awt.Color` und `Font`. Die Zeichnungen erscheinen in verschiebbaren Fenstern mit Animation.
- **Laufende Programme beenden**: Programme laufen in kleinen Zeitscheiben, die Oberfläche bleibt bedienbar und Ausgaben erscheinen sofort. Während ein Aufruf läuft, zeigt die Kopfzeile „Programm läuft …“ mit dem Knopf **■ Beenden** (z. B. bei Endlosschleifen). `Thread.sleep`, `delay` und Endlos-Animationen laufen live.
- **Maus und Tastatur in der Grafik**: `GPanel` und `TurtleFrame` kennen `kbhit()`, `getKey()`, `getKeyCode()` und `getKeyCodeWait()`. Listener wie in Java und APLU: `MouseListener`, `MouseMotionListener`, `KeyListener`, `MouseAdapter`/`KeyAdapter`, `MouseHitListener`, `TurtleHitListener`, `MouseDoubleClickListener`, `ExitListener` (mit `MouseEvent`/`KeyEvent` und den `KeyEvent.VK_…`-Konstanten). `Monitor.putSleep()`/`wakeUp()` lässt das Hauptprogramm auf Ereignisse warten.
- **Bilder und Klänge**: Dateien kommen über „Projekt ▾ → Bilder und Klänge …“ ins Projekt, werden mitgespeichert und im ZIP exportiert/importiert. `GPanel.image(…)`, `new Turtle("hase.gif")` (Sprite), `drawImage`, `drawBkImage`; Töne mit `Turtle.sound(…)`, `beep()` und `SoundPlayer.playSine(…)`, Klangdateien mit `new SoundPlayer("ton.wav")`.
- **Eingabedialoge**: `InputDialog` und `MessageDialog` aus `ch.aplu.util` erscheinen als Dialog.
- **Projekte speichern**: Alle Projekte werden automatisch im Browser gespeichert und lassen sich unter „Projekt ▾ → Meine Projekte“ öffnen, kopieren oder löschen.
- **ZIP-Export und -Import**: „Als ZIP herunterladen“ erzeugt einen Projektordner mit den `.java`-Dateien und einer `package.bluej` (Klassenpositionen), der sich auch in BlueJ öffnen lässt. Beim Import werden ZIP-Dateien und einzelne `.java`-Dateien angenommen, auch echte BlueJ-Projektordner; die Positionen aus `package.bluej` werden übernommen.

## Unterstützte Java-Teilmenge

Klassen, Vererbung, abstrakte Klassen, Interfaces, `enum`, Arrays, Strings, `ArrayList`, `HashMap`, `HashSet`, `Random`, `Math`, `StringBuilder`, Ausnahmen mit `try`/`catch`, `switch`, alle Schleifen. Ganzzahldivision, `int`-Überlauf und `long` verhalten sich wie in echtem Java.

- **java.util**: `ArrayList`, `LinkedList`, `ArrayDeque`, `Stack`, `PriorityQueue` (mit Comparator), `HashSet`/`LinkedHashSet`/`TreeSet` (mit `first`, `floor`, `ceiling` …), `HashMap`/`LinkedHashMap`/`TreeMap` (mit `entrySet`, `Map.Entry`, `getOrDefault`, `merge` …), `Iterator` (auch `remove`), eigene Klassen mit `Iterable` in der for-each-Schleife, `List.of`, `Set.of`, `Map.of`, `Collections` und `Arrays` mit den üblichen Hilfsmethoden. Die Interfaces `List`, `Set`, `Map`, `Queue`, `Deque`, `Collection` lassen sich als Variablentyp verwenden.
- **Geprüfte Ausnahmen** wie in Java: `throws`-Klauseln werden geprüft („Die Ausnahme IOException muss abgefangen oder mit throws weitergegeben werden“), ebenso ein `catch` für eine geprüfte Ausnahme, die im `try` gar nicht auftreten kann. Eigene Ausnahmeklassen mit `extends Exception` bzw. `RuntimeException`.
- **Neuere Sprachmittel**: `switch` mit Pfeil (`case 1, 2 -> …`) als Anweisung und als Ausdruck mit `yield`, `record` (mit kompaktem Konstruktor, `toString`, `equals`, `hashCode`), `var` für lokale Variablen und Textblöcke mit `"""`.

- **Verschachtelte Klassen**: statische und innere Klassen (mit Zugriff auf das äußere Objekt, auch `Aussen.this`), lokale Klassen in Methoden und anonyme Klassen (`new Runnable() { … }`, `new MouseAdapter() { … }`). Eingefangene lokale Variablen müssen wie in Java final oder effektiv final sein.
- **Lambdas und Methodenreferenzen**: `(a, b) -> a + b`, `x -> { … }`, `String::length`, `System.out::println`, `this::methode`, `Klasse::new`. Funktionale Interfaces aus `java.util.function` (`Function`, `Consumer`, `Predicate`, `Supplier`, `BiFunction`, `UnaryOperator` …) und `Comparator` mit `comparing`, `thenComparing`, `reversed`. Listen kennen `sort`, `forEach`, `removeIf`, `replaceAll`; Maps `forEach`, `merge`, `computeIfAbsent`; `Collections.sort`, `Arrays.sort`, `TreeSet`/`TreeMap` nehmen einen Comparator.

## Starten

- Online: https://carstenreinhardt.github.io/WebBlueJ/, oder
- lokal: `index.html` im Browser öffnen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche und Gestaltung |
| `app.js` | Logik der Oberfläche (Diagramm, Editor, Dialoge) |
| `interp.js` | Java-Interpreter: Lexer, Parser, Fehlerprüfung, Laufzeit (unterbrechbar über Generator-Funktionen) |
| `aplu.js` | Nachbildung von `ch.aplu.turtle`, `ch.aplu.util`, `java.awt.Color`/`Font` und `Scanner` |
| `gfx.js` | Grafikfenster: spielt die Zeichenbefehle mit Animation ab |
| `examples.js` | Beispielprojekte |
| `edtools.js` | Editor-Hilfen: Bereiche, Klammerpaare, automatisches Einrücken, Kommentieren |
| `tests/regression.js` | Regressionstest für den Interpreter: `node tests/regression.js` (vergleicht mit `tests/erwartet.txt`) |
| `tests/ereignisse.js` | Test für Maus-/Tastaturereignisse, Bilder und Töne: `node tests/ereignisse.js` |
| `lib/jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) 3.10.1 für ZIP-Dateien (MIT-Lizenz) |

Inspiriert von den didaktischen Ideen von BlueJ. Unabhängiges Projekt, nicht mit BlueJ verbunden.
