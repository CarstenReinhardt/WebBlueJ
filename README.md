# WebBlueJ – Java-Werkbank im Browser

Eine Lernumgebung für Java, die komplett im Browser läuft. Keine Installation, kein Server, kein JDK nötig.

## Funktionen

- **Klassendiagramm**: Klassen anlegen und verschieben. Pfeile für Vererbung, Interfaces und Benutzung werden automatisch gezeichnet.
- **Editor**: Syntaxhervorhebung, automatisches Einrücken, Übersetzen mit `Strg+S`. Fehler werden mit Zeile und deutschem Hinweis markiert.
- **Objekte interaktiv**: Klick auf eine Klasse erzeugt Objekte (`new …`) oder ruft statische Methoden wie `main` auf.
- **Objektleiste**: Methoden an Objekten aufrufen und Objekte inspizieren.
- **Konsole und Direkteingabe**: Ausgaben von `System.out` ansehen und Java-Ausdrücke direkt ausprobieren.
- **Beispielprojekte**: Bankkonto, Formen (abstrakte Klasse und Interface), Würfelspiel und Turtle-Grafik.
- **Turtle-Grafik und GPanel**: `import ch.aplu.turtle.*;` und `import ch.aplu.util.*;` funktionieren wie mit der Bibliothek `aplu5.jar`, ohne dass eine JAR-Datei nötig ist. `Turtle` (auch als Oberklasse), `GPanel`, `Console`, `InputDialog`, `MessageDialog` sowie `java.awt.Color` und `Font`. Die Zeichnungen erscheinen in verschiebbaren Fenstern mit Animation.
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
| `interp.js` | Java-Interpreter: Lexer, Parser, Fehlerprüfung, Laufzeit |
| `aplu.js` | Nachbildung von `ch.aplu.turtle`, `ch.aplu.util`, `java.awt.Color`/`Font` und `Scanner` |
| `gfx.js` | Grafikfenster: spielt die Zeichenbefehle mit Animation ab |
| `examples.js` | Beispielprojekte |
| `lib/jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) 3.10.1 für ZIP-Dateien (MIT-Lizenz) |

Inspiriert von den didaktischen Ideen von BlueJ. Unabhängiges Projekt, nicht mit BlueJ verbunden.
