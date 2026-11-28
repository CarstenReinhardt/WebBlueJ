/* Beispielprojekte für die Java-Werkbank */
(function (global) {
const bank = {
  name: 'Bankkonto',
  classes: [
    { name: 'Konto', x: 60, y: 60, code: `/**
 * Ein einfaches Bankkonto mit Inhaber und Kontostand.
 */
public class Konto {
    private String inhaber;
    protected double kontostand;

    /**
     * Erzeugt ein neues Konto.
     * @param inhaber Name der Kontoinhaberin oder des Kontoinhabers
     * @param startguthaben Betrag, mit dem das Konto eröffnet wird
     */
    public Konto(String inhaber, double startguthaben) {
        this.inhaber = inhaber;
        this.kontostand = startguthaben;
    }

    /**
     * Zahlt Geld auf das Konto ein.
     * @param betrag ein positiver Betrag in Euro
     */
    public void einzahlen(double betrag) {
        if (betrag <= 0) {
            System.out.println("Einzahlungen müssen positiv sein.");
            return;
        }
        kontostand = kontostand + betrag;
    }

    /**
     * Hebt Geld ab, wenn genug Guthaben vorhanden ist.
     * @return true, wenn die Abhebung geklappt hat
     */
    public boolean abheben(double betrag) {
        if (betrag > kontostand) {
            System.out.println("Nicht genug Guthaben auf dem Konto von " + inhaber);
            return false;
        }
        kontostand -= betrag;
        return true;
    }

    /** Liefert den aktuellen Kontostand. */
    public double getKontostand() {
        return kontostand;
    }

    /** Liefert den Namen des Inhabers. */
    public String getInhaber() {
        return inhaber;
    }

    public String toString() {
        return inhaber + ": " + kontostand + " EUR";
    }
}
` },
    { name: 'Sparkonto', x: 60, y: 260, code: `/**
 * Ein Sparkonto bekommt Zinsen gutgeschrieben.
 */
public class Sparkonto extends Konto {
    private double zinssatz;

    /**
     * @param zinssatz Zinssatz in Prozent, z. B. 1.5
     */
    public Sparkonto(String inhaber, double startguthaben, double zinssatz) {
        super(inhaber, startguthaben);
        this.zinssatz = zinssatz;
    }

    /** Schreibt die Jahreszinsen auf das Konto gut. */
    public void zinsenGutschreiben() {
        double zinsen = kontostand * zinssatz / 100;
        einzahlen(zinsen);
        System.out.println("Zinsen gutgeschrieben: " + zinsen + " EUR");
    }

    public double getZinssatz() {
        return zinssatz;
    }
}
` },
    { name: 'Bank', x: 330, y: 60, code: `import java.util.ArrayList;

/**
 * Eine Bank verwaltet beliebig viele Konten.
 */
public class Bank {
    private String name;
    private ArrayList<Konto> konten;

    public Bank(String name) {
        this.name = name;
        konten = new ArrayList<>();
    }

    /** Nimmt ein Konto in die Bank auf. */
    public void kontoHinzufuegen(Konto k) {
        konten.add(k);
    }

    /** Liefert die Summe aller Kontostände. */
    public double gesamtguthaben() {
        double summe = 0;
        for (Konto k : konten) {
            summe += k.getKontostand();
        }
        return summe;
    }

    /** Liefert das Konto mit dem höchsten Kontostand oder null. */
    public Konto reichstesKonto() {
        Konto bestes = null;
        for (Konto k : konten) {
            if (bestes == null || k.getKontostand() > bestes.getKontostand()) {
                bestes = k;
            }
        }
        return bestes;
    }

    /** Gibt alle Konten in der Konsole aus. */
    public void kontenAuflisten() {
        System.out.println("Konten der " + name + ":");
        for (int i = 0; i < konten.size(); i++) {
            System.out.println("  " + (i + 1) + ". " + konten.get(i));
        }
    }

    public int anzahlKonten() {
        return konten.size();
    }
}
` },
    { name: 'Demo', x: 330, y: 260, code: `/**
 * Startet ein kleines Beispiel. Rechtsklick auf die Klasse
 * und main(...) aufrufen.
 */
public class Demo {
    public static void main(String[] args) {
        Bank bank = new Bank("Stadtsparkasse");
        Konto a = new Konto("Ada", 250.0);
        Sparkonto b = new Sparkonto("Linus", 1000.0, 2.0);
        bank.kontoHinzufuegen(a);
        bank.kontoHinzufuegen(b);

        a.abheben(300);
        b.zinsenGutschreiben();
        bank.kontenAuflisten();
        System.out.printf("Gesamt: %.2f EUR%n", bank.gesamtguthaben());
    }
}
` },
  ],
  bench: [{ name: 'konto1', expr: 'new Konto("Ada", 150.0)' }],
};

const formen = {
  name: 'Formen',
  classes: [
    { name: 'Form', x: 230, y: 40, code: `/**
 * Oberklasse für alle geometrischen Formen.
 */
public abstract class Form {
    protected String name;

    public Form(String name) {
        this.name = name;
    }

    /** Jede Form muss ihren Flächeninhalt berechnen können. */
    public abstract double flaeche();

    public abstract double umfang();

    public String beschreibung() {
        return name + " mit Fläche " + Math.round(flaeche() * 100) / 100.0;
    }
}
` },
    { name: 'Skalierbar', x: 520, y: 40, code: `/**
 * Formen, die vergrößert oder verkleinert werden können.
 */
public interface Skalierbar {
    void skalieren(double faktor);
}
` },
    { name: 'Kreis', x: 100, y: 230, code: `public class Kreis extends Form implements Skalierbar {
    private double radius;

    public Kreis(double radius) {
        super("Kreis");
        this.radius = radius;
    }

    public double flaeche() {
        return Math.PI * radius * radius;
    }

    public double umfang() {
        return 2 * Math.PI * radius;
    }

    public void skalieren(double faktor) {
        radius = radius * faktor;
    }
}
` },
    { name: 'Rechteck', x: 360, y: 230, code: `public class Rechteck extends Form implements Skalierbar {
    protected double breite;
    protected double hoehe;

    public Rechteck(double breite, double hoehe) {
        super("Rechteck");
        this.breite = breite;
        this.hoehe = hoehe;
    }

    public double flaeche() {
        return breite * hoehe;
    }

    public double umfang() {
        return 2 * (breite + hoehe);
    }

    public void skalieren(double faktor) {
        breite *= faktor;
        hoehe *= faktor;
    }
}
` },
    { name: 'Quadrat', x: 360, y: 400, code: `public class Quadrat extends Rechteck {

    public Quadrat(double seite) {
        super(seite, seite);
        name = "Quadrat";
    }

    public boolean istGroesserAls(Form andere) {
        return flaeche() > andere.flaeche();
    }
}
` },
  ],
  bench: [{ name: 'kreis1', expr: 'new Kreis(2.0)' }, { name: 'quadrat1', expr: 'new Quadrat(3.0)' }],
};

const wuerfel = {
  name: 'Würfelspiel',
  classes: [
    { name: 'Wuerfel', x: 80, y: 60, code: `import java.util.Random;

/**
 * Ein Würfel mit einstellbarer Seitenzahl.
 */
public class Wuerfel {
    private int seiten;
    private int augen;
    private Random zufall;

    public Wuerfel(int seiten) {
        this.seiten = seiten;
        zufall = new Random();
        augen = 1;
    }

    /** Würfelt einmal und liefert die gewürfelte Zahl. */
    public int wuerfeln() {
        augen = zufall.nextInt(seiten) + 1;
        return augen;
    }

    public int getAugen() {
        return augen;
    }
}
` },
    { name: 'Statistik', x: 360, y: 60, code: `/**
 * Würfelt viele Male und zeigt, wie oft jede Zahl kam.
 */
public class Statistik {
    private Wuerfel wuerfel;
    private int[] haeufigkeit;

    public Statistik(Wuerfel wuerfel, int seiten) {
        this.wuerfel = wuerfel;
        haeufigkeit = new int[seiten + 1];
    }

    /** Würfelt n-mal und zählt die Ergebnisse. */
    public void wirfMal(int n) {
        for (int i = 0; i < n; i++) {
            int zahl = wuerfel.wuerfeln();
            haeufigkeit[zahl]++;
        }
        ausgeben();
    }

    /** Zeichnet ein Balkendiagramm aus Sternchen. */
    public void ausgeben() {
        int summe = 0;
        for (int h : haeufigkeit) {
            summe += h;
        }
        for (int zahl = 1; zahl < haeufigkeit.length; zahl++) {
            String balken = "*".repeat(haeufigkeit[zahl] * 40 / Math.max(summe, 1));
            System.out.printf("%2d | %-40s %d%n", zahl, balken, haeufigkeit[zahl]);
        }
    }

    /** Liefert den Durchschnitt aller Würfe. */
    public double durchschnitt() {
        int summe = 0, anzahl = 0;
        for (int zahl = 1; zahl < haeufigkeit.length; zahl++) {
            summe += zahl * haeufigkeit[zahl];
            anzahl += haeufigkeit[zahl];
        }
        if (anzahl == 0) {
            return 0;
        }
        return (double) summe / anzahl;
    }
}
` },
  ],
  bench: [{ name: 'wuerfel1', expr: 'new Wuerfel(6)' }],
};

const turtle = {
  name: 'Turtle-Grafik',
  classes: [
    { name: 'Zeichnerin', x: 80, y: 60, code: `import ch.aplu.turtle.*;
import java.awt.Color;

/**
 * Eine Turtle, die Figuren zeichnen kann.
 */
public class Zeichnerin extends Turtle {

    /** Zeichnet ein Quadrat mit der Seitenlänge s. */
    public void quadrat(double s) {
        for (int i = 0; i < 4; i++) {
            forward(s);
            right(90);
        }
    }

    /** Zeichnet ein regelmäßiges Vieleck mit n Ecken. */
    public void vieleck(int n, double s) {
        for (int i = 0; i < n; i++) {
            forward(s);
            right(360.0 / n);
        }
    }

    /** Zeichnet einen Stern mit 5 Zacken. */
    public void stern(double s) {
        for (int i = 0; i < 5; i++) {
            forward(s);
            right(144);
        }
    }
}` },
    { name: 'Blume', x: 380, y: 60, code: `import ch.aplu.turtle.*;
import java.awt.Color;

public class Blume {

    public static void main(String[] args) {
        Zeichnerin z = new Zeichnerin();
        z.speed(600);
        Color[] farben = { Color.red, Color.orange, Color.magenta, Color.blue };
        for (int i = 0; i < 12; i++) {
            z.setPenColor(farben[i % farben.length]);
            z.quadrat(80);
            z.right(30);
        }
        z.penUp();
        z.setPos(-150, -150);
        z.penDown();
        z.setPenColor(Color.green);
        z.stern(60);
    }
}` },
  ],
  bench: [{ name: 'zeichnerin1', expr: 'new Zeichnerin()' }],
};

const interaktiv = {
  name: 'Maus und Tastatur',
  classes: [
    { name: 'Malprogramm', x: 80, y: 60, code: `import ch.aplu.util.*;
import java.awt.Color;
import java.awt.event.*;

/**
 * Ein kleines Malprogramm: Mit gedrückter Maustaste malen.
 * Tasten r, g, b, s wählen die Farbe, c löscht das Bild.
 * (Zuerst in das Fenster klicken, damit es die Tasten bekommt.)
 */
public class Malprogramm implements MouseListener, MouseMotionListener, KeyListener {
    private GPanel p;

    public Malprogramm() {
        p = new GPanel("Malprogramm", 0, 100, 0, 100);
        p.lineWidth(3);
        p.addMouseListener(this);
        p.addMouseMotionListener(this);
        p.addKeyListener(this);
        p.text(2, 96, "Maustaste gedrückt halten: malen   r g b s: Farbe   c: löschen");
    }

    public void mousePressed(MouseEvent e) {
        p.move(p.toWindowX(e.getX()), p.toWindowY(e.getY()));
    }

    public void mouseDragged(MouseEvent e) {
        p.draw(p.toWindowX(e.getX()), p.toWindowY(e.getY()));
    }

    public void keyPressed(KeyEvent e) {
        char c = e.getKeyChar();
        if (c == 'r') p.color(Color.red);
        else if (c == 'g') p.color(Color.green);
        else if (c == 'b') p.color(Color.blue);
        else if (c == 's') p.color(Color.black);
        else if (c == 'c') p.clear();
    }

    // Diese Methoden verlangen die Interfaces, sie werden hier nicht gebraucht.
    public void mouseReleased(MouseEvent e) { }
    public void mouseClicked(MouseEvent e) { }
    public void mouseEntered(MouseEvent e) { }
    public void mouseExited(MouseEvent e) { }
    public void mouseMoved(MouseEvent e) { }
    public void keyReleased(KeyEvent e) { }
    public void keyTyped(KeyEvent e) { }

    public static void main(String[] args) {
        new Malprogramm();
    }
}` },
    { name: 'Steuerung', x: 380, y: 60, code: `import ch.aplu.turtle.*;
import java.awt.event.KeyEvent;

/**
 * Steuert eine Turtle mit den Pfeiltasten, Escape beendet.
 * Erzeuge ein Objekt und rufe starten() auf.
 */
public class Steuerung {
    private TurtleFrame fenster;
    private Turtle t;

    public Steuerung() {
        fenster = new TurtleFrame("Pfeiltasten steuern die Turtle");
        t = new Turtle(fenster);
    }

    public void starten() {
        while (true) {
            int taste = fenster.getKeyCodeWait();
            switch (taste) {
                case KeyEvent.VK_LEFT:  t.left(90); break;
                case KeyEvent.VK_RIGHT: t.right(90); break;
                case KeyEvent.VK_UP:    t.forward(20); break;
                case KeyEvent.VK_DOWN:  t.back(20); break;
                case KeyEvent.VK_ESCAPE:
                    t.sound(660, 200);
                    System.out.println("Steuerung beendet");
                    return;
            }
        }
    }
}` },
  ],
  bench: [],
};

const swing = {
  name: 'Fenster mit Swing',
  classes: [
    { name: 'Rechner', x: 80, y: 60, code: `import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

/**
 * Ein kleiner Rechner mit Swing: zwei Eingabefelder, Knöpfe und ein Protokoll.
 * Rufe main auf. Die Knöpfe melden sich bei actionPerformed (ActionListener).
 */
public class Rechner extends JFrame implements ActionListener {
    private JTextField zahl1 = new JTextField(6);
    private JTextField zahl2 = new JTextField(6);
    private JLabel ergebnis = new JLabel("Ergebnis: –");
    private JButton plus = new JButton("+");
    private JButton mal = new JButton("×");
    private JCheckBox runden = new JCheckBox("runden");
    private JTextArea protokoll = new JTextArea(5, 20);

    public Rechner() {
        super("Taschenrechner");
        setSize(360, 260);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        JPanel oben = new JPanel(new GridLayout(2, 2, 5, 5));
        oben.add(new JLabel("Zahl 1:")); oben.add(zahl1);
        oben.add(new JLabel("Zahl 2:")); oben.add(zahl2);
        JPanel knoepfe = new JPanel();
        knoepfe.add(plus); knoepfe.add(mal); knoepfe.add(runden); knoepfe.add(ergebnis);
        plus.addActionListener(this);
        mal.addActionListener(this);
        ergebnis.setFont(new Font("SansSerif", Font.BOLD, 14));
        protokoll.setEditable(false);
        add(oben, BorderLayout.NORTH);
        add(new JScrollPane(protokoll), BorderLayout.CENTER);
        add(knoepfe, BorderLayout.SOUTH);
        setVisible(true);
    }

    public void actionPerformed(ActionEvent e) {
        try {
            double a = Double.parseDouble(zahl1.getText()), b = Double.parseDouble(zahl2.getText());
            double r = e.getSource() == plus ? a + b : a * b;
            if (runden.isSelected()) r = Math.round(r);
            ergebnis.setText("Ergebnis: " + r);
            protokoll.append(a + " " + e.getActionCommand() + " " + b + " = " + r + "\\n");
        } catch (NumberFormatException ex) {
            JOptionPane.showMessageDialog(this, "Bitte zwei Zahlen eingeben.");
        }
    }

    public static void main(String[] args) {
        new Rechner();
    }
}` },
    { name: 'Zaehler', x: 380, y: 60, code: `import javax.swing.*;
import java.awt.*;

/**
 * Ein Zähler mit Knöpfen und einer Uhr (javax.swing.Timer).
 * Die Knöpfe bekommen ihre Aktion hier als Lambda-Ausdruck.
 * Erzeuge ein Objekt mit new Zaehler().
 */
public class Zaehler extends JFrame {
    private int stand = 0;
    private JLabel anzeige = new JLabel("0", SwingConstants.CENTER);
    private Timer uhr;

    public Zaehler() {
        super("Zähler");
        setSize(300, 170);
        anzeige.setFont(new Font("SansSerif", Font.BOLD, 40));
        add(anzeige, BorderLayout.CENTER);

        JButton plus = new JButton("+1");
        JButton zurueck = new JButton("Zurücksetzen");
        JButton startStopp = new JButton("Start");
        plus.addActionListener(e -> setStand(stand + 1));
        zurueck.addActionListener(e -> setStand(0));

        // Die Uhr ruft jede Sekunde actionPerformed auf
        uhr = new Timer(1000, e -> setStand(stand + 1));
        startStopp.addActionListener(e -> {
            if (uhr.isRunning()) {
                uhr.stop();
                startStopp.setText("Start");
            } else {
                uhr.start();
                startStopp.setText("Stopp");
            }
        });

        JPanel knoepfe = new JPanel(new FlowLayout());
        knoepfe.add(plus);
        knoepfe.add(startStopp);
        knoepfe.add(zurueck);
        add(knoepfe, BorderLayout.SOUTH);
        setVisible(true);
    }

    public void setStand(int neu) {
        stand = neu;
        anzeige.setText("" + stand);
    }

    public int getStand() {
        return stand;
    }
}` },
  ],
  bench: [],
};

global.WB_EXAMPLES = [bank, formen, wuerfel, turtle, interaktiv, swing];
})(typeof window !== 'undefined' ? window : globalThis);
