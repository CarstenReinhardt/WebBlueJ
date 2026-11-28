# WebBlueJ – Java-Werkbank im Browser

Eine Lernumgebung für Java, die komplett im Browser läuft. Keine Installation, kein Server, kein JDK nötig.

## Funktionen

- **Klassendiagramm**: Klassen anlegen und verschieben. Pfeile für Vererbung, Interfaces und Benutzung werden automatisch gezeichnet.
- **Editor**: Syntaxhervorhebung, farbige Bereiche wie in BlueJ (Klasse, Methode, Schleife, Verzweigung), Markierung der passenden Klammer, Klammern automatisch schließen, Suchen und Ersetzen (`Strg+F`, `Strg+H`), Gehe zu Zeile (`Strg+G`), ganzen Quelltext neu einrücken (`Strg+Umschalt+F`), Ein-/Auskommentieren (`Strg+#`), Übersetzen mit `Strg+S`. Fehler werden mit Zeile und deutschem Hinweis markiert.
- **Einstellungen** (⚙): Schriftgröße für Editor und Konsole (auch für den Beamer, im Editor mit `Strg` + `+`/`−`), helles oder dunkles Design, Einrückweite, Bereichsfärbung und automatisches Klammerschließen an/aus.
- **Objekte interaktiv**: Klick auf eine Klasse erzeugt Objekte (`new …`) oder ruft statische Methoden wie `main` auf.
- **Objektleiste**: Methoden an Objekten aufrufen und Objekte inspizieren.
- **Konsole und Direkteingabe**: Ausgaben von `System.out` ansehen und Java-Ausdrücke direkt ausprobieren.
- **Beispielprojekte**: Bankkonto, Formen (abstrakte Klasse und Interface), Würfelspiel und Turtle-Grafik.
- **Turtle-Grafik und GPanel**: `import ch.aplu.turtle.*;` und `import ch.aplu.util.*;` funktionieren wie mit der Bibliothek `aplu5.jar`, ohne dass eine JAR-Datei nötig ist. `Turtle` (auch als Oberklasse), `GPanel`, `Console`, `InputDialog`, `MessageDialog` sowie `java.awt.Color` und `Font`. Die Zeichnungen erscheinen in verschiebbaren Fenstern mit Animation.
- **Laufende Programme beenden**: Programme laufen in kleinen Zeitscheiben, die Oberfläche bleibt bedienbar und Ausgaben erscheinen sofort. Während ein Aufruf läuft, zeigt die Kopfzeile „Programm läuft …“ mit dem Knopf **■ Beenden** (z. B. bei Endlosschleifen). `Thread.sleep`, `delay` und Endlos-Animationen laufen live.
- **Tastatureingabe**: `Scanner`, `Console.readInt()` usw. fragen über einen Eingabedialog.
- **Projekte speichern**: Alle Projekte werden automatisch im Browser gespeichert und lassen sich unter „Projekt ▾ → Meine Projekte“ öffnen, kopieren oder löschen.
- **ZIP-Export und -Import**: „Als ZIP herunterladen“ erzeugt einen Projektordner mit den `.java`-Dateien und einer `package.bluej` (Klassenpositionen), der sich auch in BlueJ öffnen lässt. Beim Import werden ZIP-Dateien und einzelne `.java`-Dateien angenommen, auch echte BlueJ-Projektordner; die Positionen aus `package.bluej` werden übernommen.

## Unterstützte Java-Teilmenge

Klassen, Vererbung, abstrakte Klassen, Interfaces, `enum`, Arrays, Strings, `ArrayList`, `HashMap`, `HashSet`, `Random`, `Math`, `StringBuilder`, Ausnahmen mit `try`/`catch`, `switch`, alle Schleifen. Ganzzahldivision, `int`-Überlauf und `long` verhalten sich wie in echtem Java.

Nicht unterstützt: Lambdas, innere Klassen. Bei der Grafik fehlen Maus- und Tastatur-Ereignisse (Listener), Bilder und Sound.

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
| `lib/jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) 3.10.1 für ZIP-Dateien (MIT-Lizenz) |

Inspiriert von den didaktischen Ideen von BlueJ. Unabhängiges Projekt, nicht mit BlueJ verbunden.
