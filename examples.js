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

global.WB_EXAMPLES = [bank, formen, wuerfel];
})(typeof window !== 'undefined' ? window : globalThis);
