# Lumantic · Designentwürfe

Die Entwicklungsstufen der Oberfläche, jede als eigenständige HTML-Datei. Alle Zahlen sind erfunden.
Die App in `web/` ist Kosmos (`07-kosmos.html`), siehe «Kosmos wird die App». Davor lief das Uhrwerk als App, siehe «Vom Uhrwerk zur ersten App».

| Datei | Inhalt |
|---|---|
| `01-sternatlas.html` | Erster Entwurf: Kennzahlen als Sterne in einem 3D-Atlas |
| `02-alco-entwuerfe.html` | Drei Konzepte mit ALCO-Kennzahlen: Instrumente, Zeitstrom, Sternbilder |
| `03-uhrwerk.html` | Zeitrad, Dashboards von Lumina, drei Designsprachen (Vorlage der App) |
| `04-raum.html` | Studie Raum: endlose Leinwand, Zoom als Detailgrad, Zeitlinse |
| `05-tiefe.html` | Studie Tiefe: jeder Monat als Scheibe hinter heute, Flug durch die Zeit |
| `06-seite.html` | Studie Seite: das Dashboard als Brief, Wörter als Bedienelemente |
| `07-kosmos.html` | Studie Kosmos: Raum und Seite zusammen. Seiten aus Blöcken liegen im Raum, jeder Block hat einen Stern |
| `archive/board-v1/` | Die erste Oberfläche (Fragen-Karten, Notizen), ersetzt durch die Uhrwerk-App |
| `archive/app-uhrwerk/` | Die Uhrwerk-App (Heute, Zeitreise, Dashboards), ersetzt durch Kosmos |

Die Dateien sind Artefakt-Quellen ohne eigenen `<!doctype>`. Sie laufen trotzdem direkt im Browser.

## Uhrwerk: was der Entwurf zeigt

- **Zeitrad.** Der Rand ist die Geschichte von Januar 2019 bis Oktober 2026, die gewählte Zeit steht unter dem festen Zeiger. Der Hitzering zeigt, in welchen Monaten etwas brannte. Rad ziehen, Mausrad, Pfeiltasten oder ▶ für die ganze Geschichte.
- **Sternbilder.** Fünf Themen (Liquidität, Kapital, Zinsrisiko, Bilanz, Wachstum). Helligkeit heisst Dringlichkeit. Der Ring zeigt den Weg zum Ziel. Weicht eine Kennzahl ab, driftet ihr Stern nach aussen.
- **Dashboards von Lumina.** Ein Klick auf ein Sternbild öffnet das Dashboard. Lumina erzeugt aus den Daten mögliche Diagramme, bewertet sie nach Dringlichkeit und Aussagekraft, wählt vor und begründet jede Wahl. Unter «Anpassen» lassen sich Typ, Zeitraum und Grösse ändern, Karten verschieben, entfernen und aus den Vorschlägen ergänzen.
- **Drei Designsprachen.** Atlas (Nacht, Messing), Zifferblatt (Porzellan, Kobalt), Messtisch (Blaupause, Plotter). Nur die Gestaltung wechselt, Daten und Statusfarben bleiben gleich.

## Drei Studien nach der App: Raum, Tiefe, Seite

Die App wurde als «okay, aber zu voll und zu wenig modular» beurteilt. Die Studien 04 bis 06 gehen darum einen Schritt zurück
und ordnen alles nach je einem einzigen Prinzip. Alle drei starten mit einem fast leeren Bildschirm, nutzen dieselben erfundenen
ALCO-Zahlen und dieselben Regeln, und alles auf dem Bildschirm ist ein Baustein, den man holen, bewegen und entfernen kann.

| Studie | Prinzip | Baustein | Zeit |
|---|---|---|---|
| **Raum** | Endlose Leinwand, Zoom bestimmt den Detailgrad (Punkt, Kachel, Diagramm) | Knoten, den man legt, weckt und in Ansichten verzweigt | Eine Glaslinse zeigt unter sich einen anderen Monat; «Eintauchen» versetzt alles dorthin |
| **Tiefe** | Jeder frühere Monat steht als Scheibe hinter dem heutigen Board | Kachel auf einem Board, das sich durch die Zeit wiederholt | Man fliegt in die Tiefe; hinter jeder Kachel zeigt eine Treppe aus Statuskanten, wie lange etwas schon brennt |
| **Seite** | Das Dashboard ist ein Brief, den Lumina schreibt | Satz oder Block; eigene Notizen mit lebenden `[[Kennzahlen]]` | Der Monat ist ein Wort, an dem man zieht; der Brief schreibt sich dabei um |

Gemeinsame Regeln: Leere ist der Normalzustand. Lumina wählt vor und begründet in einem Satz (✦), ein Klick übernimmt oder verwirft.
`Z` springt zwischen heute und dem letzten besuchten Moment. Spektakel dient der Navigation, Werte liest man in flachen Diagrammen.

Grundlagen:
- Raum: Bier et al. 1993, Toolglass and Magic Lenses: https://graphics.pixar.com/people/derose/publications/ToolGlass ·
  Robertson et al. 1998, Data Mountain (selbst Abgelegtes findet man schneller wieder): https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/ ·
  van Wijk & Nuij 2003, Smooth and Efficient Zooming and Panning: https://researchr.org/publication/WijkN03
- Tiefe: Mackinlay, Robertson, Card 1991, The Perspective Wall: https://www.ifs.tuwien.ac.at/~mlanzenberger/teaching/ps/ws06/stuff/p173-mackinlay.pdf ·
  Robertson et al. 2008 (mehrere Zeitpunkte gleichzeitig sehen hilft der Analyse mehr als reine Animation): https://faculty.cc.gatech.edu/~stasko/papers/infovis08-anim.pdf
- Seite: Victor 2011, Explorable Explanations: https://worrydream.com/ExplorableExplanations/ ·
  Goffin et al. 2014, Word-Scale Visualizations: https://hal.archives-ouvertes.fr/hal-01024278

Rückmeldung nach den drei Studien: Raum und Seite sollen zusammenkommen, das blockbasierte Dashboard gefällt. Daraus ist die
Studie Kosmos entstanden. Sie ist inzwischen die App (siehe «Kosmos wird die App»).

## Kosmos: Raum und Seite zusammen

**Eine Seite ist ein Sternbild aus der Nähe, ein Sternbild ist eine Seite aus der Ferne, und jeder Stern ist ein Block.**

- **Ein Mechanismus.** Der Zoom bestimmt die Form. Aus der Ferne zeigt eine Seite nur ihre Sterne. Beim Hineinzoomen gleiten sie an den linken Rand und daneben klappen die Blöcke auf. Der Zoom rastet ein: Ein Dreh am Mausrad faltet oder öffnet eine Seite ganz.
- **Blöcke.** Satz, Zeile, Zahl, Diagramm, Notiz. Die Form wechselt man am Block. Jede Aussage klappt ihren Beleg auf, mit Luminas Begründung und den anderen Ansichten zur Wahl.
- **Bauen.** Der Stern ist der Griff des Blocks. Man ordnet um, trägt ihn auf eine andere Seite oder legt ihn ins Leere, wo er eine eigene Seite beginnt. Am Seitenende holt `/` einen Baustein und `[[` eine lebende Kennzahl in eine Notiz.
- **Luminas Seiten.** «Heute» in der Mitte und je eine Seite pro Thema, für jeden Monat neu geschrieben. Sätze gibt es nur für das, was Handlung braucht. Was man von dort wegzieht, ist eine Kopie, damit kein Signal verschwindet.
- **Fäden.** Jeder Kennzahl-Block ausserhalb seines Themas ist mit seiner Heimat verbunden. So zeigt die Übersicht, woher die Signale von heute kommen und worauf sich eigene Seiten beziehen.
- **Zeit.** Der Raum hat einen Monat (Monatswort ziehen, Pfeiltasten, Leertaste, `Z`). Die Linse zeigt Block für Block einen anderen Monat. Ein Block kann einen Monat festhalten und steht dann neben dem heutigen Wert.

Was aus Raum stammt: Leinwand, Kamera, Flüge, Orte, Linse. Was aus Seite stammt: Luminas Sätze, Belege, Einfügezeile, Notizen mit Kennzahlen, Monatswort. Neu sind der Übergang zwischen Seite und Sternbild, die Linse pro Block und der festgehaltene Monat.

Grundlage zusätzlich zu Raum und Seite: Perlin & Fox 1993, Pad (semantisches Zoomen: ein Dokument zeigt klein seinen Titel und gross seinen Text): https://www.cs.umd.edu/projects/hcil/jazz/learn/papers/siggraph-93-origpad.pdf

Offen für die App:
- Das Mausrad zoomt. Lange Seiten verschiebt man durch Ziehen oder mit den Pfeiltasten. Ob das Rad auf einer offenen Seite besser scrollt, muss sich im Gebrauch zeigen.
- Mit elf Kennzahlen sind die Themenseiten dünn. Sie tragen erst mit einem echten Goldlayer.
- Seiten können sich überlappen, wenn eine wächst. Rückgängig gibt es nur nach dem Entfernen.
- Nicht geprüft: echter Touchscreen mit Zwei-Finger-Zoom.

## Kosmos wird die App

Nach den Farbblättern («sieht alles gut aus, kann man alles einbauen») ist Kosmos am 10. November 2026 die App in `web/`
geworden, auf den echten Kennzahlen des Go-Servers. Die Uhrwerk-App liegt in `archive/app-uhrwerk/`.

- **Fünf Designs, ein Satz Tokens.** Nacht (der bisherige Nachthimmel), Kreide, Nebel, Stein und Dämmerung. Jede Farbe, auch
  auf der Leinwand und in den Diagrammen, ist ein Token in `web/src/styles/themes.css`. Die hellen Designs haben ihr eigenes
  Glas, ihre eigenen Halos und Fäden; sie sind nicht die Nacht invertiert. Standard ist Nebel, weil die Nacht als zu dunkel
  empfunden wurde. Nacht behält Newsreader mit Kursiven, die anderen setzen IBM Plex Sans ohne Kursive.
- **Firmen-Design per Konfiguration.** Ein Firmen-Design nennt ein eingebautes Design als Basis und nur die Farben und
  Schriften, die abweichen (`config/lumantic.json`, Abschnitt `brand`). So bleiben Kontraste und Statusfarben geprüft, auch
  wenn nur Hintergrund, Schrift und Akzent der Hausfarben gesetzt sind.
- **Einstellungen am Ende der Orte.** Ein Zahnrad, kein neues Panel im Raum. Das Blatt kommt von rechts (auf dem Handy von
  unten), der Raum rückt so weit zur Seite, dass die offene Seite ganz sichtbar bleibt: Ein Designwechsel ist sofort auf der
  echten Seite zu sehen. Persönliches (Darstellung, Start) gilt für die Person, Daten und Lumina für alle.
- **Daten in der Sprache der Leute.** «Datenquelle», «Ordner mit Parquet- oder CSV-Dateien», «Wertspalte», nicht «Adapter»
  oder «Schema-Mapping». Eine neue Quelle wird erst geprüft und nur übernommen, wenn sie antwortet.
- **Lumina mit KI bleibt nachvollziehbar.** Claude bekommt die Frage und die ausgewerteten Kennzahlen des Monats, keine
  Datenzeilen. Die Antwort ist ein Block wie jeder andere und lässt sich entfernen; die vorgeschlagenen Diagramme sind normale
  Kennzahl-Blöcke. Ohne Token oder bei einem Fehler sucht Lumina wie bisher nach Stichwörtern und sagt das.
- **Schriften im Paket.** Alle Schriften kommen mit der App, damit sie in einem Banknetz ohne Google Fonts gleich aussieht.

Offen:
- Ein echter Aufruf an Claude ist noch nicht gemacht worden; getestet ist der Weg mit einem Testserver.
- Windmill ist nicht gegen eine echte Instanz geprüft.
- Alle teilen sich einen Arbeitsbereich, bis es eine Anmeldung gibt.

## Hauptmenü und Logo

Zwei Wünsche nach dem ersten Blick auf die App (10. November 2026): ein Logo, und ein Hauptmenü, weil manche Personen
mehr als einen Goldlayer sehen.

- **Ein Kosmos pro Datenquelle.** Das Wort war schon da: Die App heisst Kosmos, also ist jede Datenquelle einer. Jeder hat
  seine Kennzahlen und seine Seiten; Design, Lumina und Logo teilen sich alle. Plural: Kosmen.
- **Das Hauptmenü ist eine Stufe weiter draussen.** Eine Seite ist aus der Ferne ein Sternbild, ein Kosmos aus noch grösserer
  Ferne ein kleiner Himmel: ein Stern pro Kennzahl, nach Themen gruppiert, in denselben Formen wie im Raum (Raute braucht
  dich, Dreieck im Auge behalten, Ring mit Punkt gute Nachricht). Darunter steht der Satz, den Lumina in diesem Kosmos über
  «Heute» schreibt. Die Überschrift zählt: «Drei Kosmen. Zwei brauchen dich.» Kein Raster aus Kacheln, keine Seitenleiste.
- **Hinein und heraus sind Flüge.** Der gewählte Himmel wächst auf einen zu, die anderen fallen weg, und der Raum öffnet
  ohne die Pause über dem Überblick. Heraus führen das Logo oben links und die Taste `K`. Mit einem einzigen Kosmos gibt es
  das Menü nicht: Niemand soll durch eine Auswahl mit einem Eintrag müssen.
- **Die Leiste unten bleibt, was sie ist.** Im Raum nennt sie die Seiten, im Hauptmenü die Kosmen, am Ende immer das Zahnrad.
- **Logo «Baustein».** Aus fünf Vorschlägen (Sternbild, Punkt, Baustein, Faden, Linse) gewählt: zwei Blöcke und ein leuchtender Stern, in der Form eines L. Es sagt das Blockbasierte und «Quiet until it
  matters» in drei Formen und bleibt bei 16 Pixeln lesbar. Die Wortmarke ist Sora 600 als Umriss, damit sie in jedem
  Design und mit jeder Hausschrift gleich aussieht.
- **Fremdes Logo, leise Signatur.** Ein Unternehmen ersetzt das Logo per Konfiguration. Dann, und nur dann, steht oben
  rechts klein «powered by lumantic».

Offen:
- Wer welchen Kosmos sieht, braucht eine Anmeldung. Bis dahin sehen alle alle.
- Ein neuer Kosmos beginnt ohne Kennzahlen; man legt sie einzeln an. Vorschläge aus den Tabellen wären der nächste Schritt.
- Das Hauptmenü liest jeden Kosmos ganz, um seinen Himmel zu zeichnen. Bei sehr vielen Kosmen bräuchte es eine Kurzfassung vom Server.

## Katalog und Sternkatalog

Etappe 4 der Spezifikation, gebaut am 11. November 2026 als Version 0.8. Dominik wünschte dazu einen Beispiel-Kosmos mit
gemischter Herkunft und Daten aus dem Industrie-Controlling: Lumantic soll nicht nur für Banken sein.

- **Drei Herkünfte, Feld für Feld.** Fachkatalog in der Quelle vor Lumantic vor Vermutung. Das Feld weiss, woher es
  kommt; eine Kennzahl kann ihre Definition aus der Quelle, ihr Ziel aus Lumantic und ihre Einheit vermutet haben.
- **Marken statt Farben.** Gefüllter Punkt für den Fachkatalog, Ring für Lumantic, gestrichelter Ring für Vermutetes. Farbe
  bleibt dem Status vorbehalten. Jede Zeile der Liste trägt die Spur ihrer Felder, so sieht man auf einen Blick, wie viel
  einer Kennzahl schon beschrieben ist.
- **JSON statt YAML.** Die Spezifikation nannte YAML für Lumantics Teil. Er ist in die bestehende Kennzahlen-Datei gewandert
  (`extra`, `terms`, `formula`, `owner`, `bounds`): eine Datei pro Kosmos wie bisher, und keine fremde Bibliothek.
- **Der Sternkatalog ist eine Seite über dem Raum**, wie ein gedruckter Sternkatalog: links nummeriert nach Themen, rechts
  der Steckbrief. Was offen ist, steht als «offen» da, mit «Ergänzen» daneben; was aus dem Fachkatalog kommt, sagt
  «Fachkatalog» statt einer Schaltfläche. Im Hauptmenü sucht er über alle Kosmen.
- **Ziele mit Gültigkeit** gelten Monat für Monat: Oktober 2025 misst sich am Budget 2025, Oktober 2026 am Budget 2026.
- **Einheiten über Geld hinaus:** Stück, Tage, Stunden, Tausend CHF und Zahl, damit Industrie-Kennzahlen lesen, wie man sie
  spricht.
- **Beispiel «Industrie»:** die erfundene Musterwerk AG mit Werken in Aarau, Brno und Suzhou. Die Liefertreue fällt unter
  ihren Mindestwert, die Lagerreichweite steigt, die EBIT-Marge verfehlt das höhere Budget 2026, die OEE wird besser.

Offen:
- Die Studien zur Gestaltung des Sternkatalogs, die die Spezifikation vorsah, sind hier ein erster Entwurf in der echten App.
- Kataloge aus Werkzeugen (Unity-Catalog-Tags, Snowflake Semantic Views) und `filter` im Vertrag.

## Englisch

Wunsch vom 12. November 2026, gebaut als Version 0.11: die englische Sprache, alles auf einmal.

- **Die Wahl der Person, sonst die des Teams, sonst die des Browsers.** Unter Darstellung › Sprache, ganz oben. Ein
  Wechsel lädt die Seite einmal neu, denn manche Texte entstehen, wenn die Module laden. Der Browser merkt sich die
  Sprache und startet in ihr; ein Cookie sagt sie auch Seiten, die der Server selbst schreibt, wie der Anmeldung.
- **Texte stehen zweisprachig dort, wo sie gebraucht werden:** `tr("Heute", "Today")`. Kein Wörterbuch mit Schlüsseln,
  denn ein Satz liest sich am Ort besser, und eine vergessene Übersetzung fällt im Code auf. Die Sätze im Raum haben
  eine eigene Grammatik pro Sprache, nicht eine übersetzte.
- **International in Englisch, schweizerisch in Deutsch.** `CHF 92m`, `CHF 1.2bn`, `1,150.5`, `12.5%`, `Oct 2026`
  gegen `92 Mio. CHF`, `1’150.5`, `12.5 %`, `Okt 2026`. Eingaben lesen beides.
- **Der Server bleibt deutsch geschrieben und antwortet englisch.** Seine Meldungen stehen als deutsche Formate im Code;
  eine Tabelle (`internal/i18n`) hält jede auf Englisch mit denselben Platzhaltern. Am Rand der API geht jede
  JSON-Antwort durch sie hindurch, auch Meldungen, die aus mehreren zusammengesetzt sind. Ein Test liest den Code und
  schlägt fehl, wenn eine neue Meldung keine englische Zeile hat. Die erste Oberfläche (Karten, Engine) bleibt deutsch.
- **Lumantic übersetzt nur seine eigenen Texte.** Namen, Definitionen und Ereignisse eines Teams bleiben, wie das Team
  sie schreibt. Englische Wörter stehen daneben unter `en`, im Fachkatalog in Spalten mit `_en`; fehlt eines, steht das
  deutsche. Teile aus den Daten (Segmente, Werke) bleiben, wie die Daten sie nennen.
- **Lumina antwortet in der Sprache der Oberfläche,** mit den Zahlen, wie die App sie zeigt, und den Begriffen des
  Teams in dieser Sprache. Das deutsche Wort bleibt ein Synonym, damit «Termintreue» auch in Englisch trifft.

## Lesen mit dem Rad, Tasten auf einen Blick

Wunsch vom 12. November 2026: eine lange Seite scrollen statt ziehen, und eine kleine Legende der Tasten, die den
hochwertigen Auftritt hält.

- **Über der Seite liest das Rad, daneben zoomt es.** Ist eine Seite offen und länger als der Bildschirm, scrollt das
  Mausrad sie weich wie Text und hält an ihrem Anfang und Ende. Neben der Seite zoomt es wie bisher hinaus zum Sternbild.
  Eine Bewegung bleibt, was sie begann, bis die Hand ruht; so springt ein Zoom nicht mitten im Drehen ins Scrollen. Mit
  `Ctrl` (und beim Zusammenziehen auf dem Trackpad) zoomt es immer. Eine Seite, die ganz Platz hat, zoomt wie bisher.
- **«Tasten» neben «Idee».** Die Legende ist eine ruhige Karte mit Tastenkappen, die ein wenig Tiefe haben, in vier
  Gruppen: Orte, Zeit, Lesen und bauen, Überall. Drückt man eine Taste, gibt ihre Kappe nach und leuchtet in der
  Akzentfarbe auf, und die Taste tut, was sie tut. `K` steht nur dort, wo es mehrere Kosmen gibt. Auf Geräten ohne
  Tastatur fehlt die Schaltfläche.
- **`?` zeigt die Tasten,** wie in den meisten Anwendungen; die Idee hat jetzt `I`.

## Zeitraster: Quartal und Jahr

Etappe 5a der Spezifikation, gebaut am 11. November 2026 als Version 0.9. Woche und Tag (5b) brauchen Tagesdaten und ein
neues Zeitmodell und folgen getrennt.

- **Das Raster ist eine Leseart, kein Umbau.** Der Raum steht weiter auf einem Monat; im Quartal steht er auf dem letzten
  Monat des Quartals. Pfeile, Ziehen am Datum, Abspielen und die Zeitlinse gehen eine Periode, `Shift` ein Jahr.
- **Drei Wörter am Ende der Datumszeile** statt eines Schalters: Monat, Quartal, Jahr, das gewählte unterstrichen. Die Taste
  `G` geht reihum. Woche und Tag stehen erst da, wenn eine Kennzahl sie hergibt.
- **Der Status bleibt im Standardraster.** «Heute», seine Überschrift und das Hauptmenü urteilen im Raster des Kosmos. Was
  ein Baustein sagt, folgt dem gewählten Raster. So kippt beim Umschalten keine Seite von ruhig auf rot.
- **Zusammenfassen nach Art.** Bestand am Periodenende, Fluss summiert, Durchschnitt über die Monate mit Daten, Verhältnis
  aus summierten oder Stichtags-Teilen. Den Faktor eines Verhältnisses (×100 für Prozent) liest Lumantic aus den Daten
  selbst, damit niemand ihn einstellen muss.
- **Laufende Perioden** heissen «Q4 2026 bis Oktober». Ein Fluss darin misst sich am Ziel bis heute und an denselben
  Monaten des Vorjahrs.
- **Flussziele wachsen mit:** aus «Monatsplan» wird «Quartalsplan», aus dem Monatsziel das Quartalsziel, als Summe der
  Monate. Ein Bestandsziel gilt in jedem Raster gleich.
- **Die Zinsmarge ist ein Durchschnitt**, wie im Beispiel der Spezifikation; im Industrie-Kosmos sind die OEE und die
  Materialquote Durchschnitte und die Ausschussquote ein Verhältnis aus Ausschuss und gefertigten Teilen.

Offen:
- Die Gestaltungsstudien, die die Spezifikation für das Raster vorsah; gebaut ist ein erster Entwurf in der App.
- «Kumuliert» und «Brücke» bleiben monatlich.

## Zeitraster: Woche und Tag

Etappe 5b, gebaut am 11. November 2026 als Version 0.10. Entschieden: Wochen nach ISO 8601 ab Montag; Flussziele liegen
meist als Jahresbudget vor, und Lumantic nimmt den Branchenstandard, bis man umstellt.

- **Wochen nur aus Tagen.** Der Server baut die ISO-Wochen aus allen Tageswerten, nach der Art jeder Kennzahl, und schickt
  die letzten 104 Wochen und die Tage der letzten 90 Tage. Quartale und Jahre rechnet weiter der Browser aus den Monaten;
  so braucht keine Datenbank Wochenfunktionen.
- **Der Raum steht in Tagen und Wochen auf einem Tag oder einer Woche**, sein Monat folgt. Darum folgt auch der Status von
  «Heute» weiter dem Monat. Zeitlinse und «festhalten» gehen in Tagen und Wochen monatsweise.
- **Die Themen-Seiten urteilen im gelesenen Raster.** In 5a ordneten sie nach dem Status; eine Kennzahl, die in der Woche
  unter dem Plan liegt, stand dann in der Zeile «Ruhig» mit einer roten Marke. Fest bleiben, wie die Spezifikation sagt,
  «Heute» und das Hauptmenü.
- **Branchenstandard für Jahresbudgets:** ein Zwölftel pro Monat, im Monat gleichmässig auf Montag bis Freitag. Pro
  Kennzahl umstellbar auf Arbeitstage übers Jahr, Kalendertage oder ein eigenes Profil; im Sternkatalog als «Verteilung».
  Ein Budget im Fachkatalog gilt für ein Jahr, ausser die neue Spalte `periode` sagt «Monat». Ein Jahresbudget heisst in
  Monat, Woche und Tag «Monatsziel», «Wochenziel», «Tagesziel», im Jahr bei seinem Namen.
- **Ohne Tageswerte bleibt eine Kennzahl beim Monat** und sagt «nur monatlich erhoben», wie die Spezifikation es wollte.
  Tag und Woche sind blass, wenn keine Kennzahl eines Kosmos Tageswerte hat.
- **Beispiel:** Im Industrie-Kosmos fertigen die drei Werke jeden Arbeitstag seit November 2024; in KW 46 steht in Brno eine
  Presse still. Der Umsatz hat Budgets 2025 und 2026 im Fachkatalog.

Offen:
- Feiertage beim Verteilen auf Arbeitstage (kantonal verschieden).
- Ein Standardraster in Woche oder Tag für einen Kosmos, in dem alle Kennzahlen täglich sind.

## Anmeldung und Rechte

Etappe 3 der Spezifikation, gebaut am 11. November 2026 als Version 0.7. Grundlage: der Abschnitt «Anmeldung und Rechte»
der Spezifikation. Gewählt ist Weg 1 (Lumantic prüft die Gruppen), für Snowflake und Databricks, wo es passt, Weg 2
(die Datenbank prüft, weil Lumantic in deinem Namen fragt).

- **Keine eigenen Benutzer.** Lumantic nimmt Konto, Name und Gruppen aus der Anmeldung: über einen Proxy davor oder mit
  OpenID Connect. Eine eigene Kerberos-Anmeldung gibt es nicht; die Windows-Anmeldung übernimmt der Anbieter (Authentik
  mit Kerberos, Entra ID). So bleibt Lumantic ohne fremde Bibliotheken.
- **Ohne Anmeldung nur dieser Rechner.** Wer Lumantic ohne Anmeldung von aussen erreichbar macht, bekommt einen Satz statt
  eines Starts.
- **Rechte in drei Stufen:** Administratoren, wer einen Kosmos sieht, wer seine Kennzahlen pflegt; dazu Gruppen pro
  Kennzahl. Wer nicht ändern darf, bekommt keine Formulare, die nicht gehen, sondern einen Satz, wer es tut.
- **Weg 2 in den Adaptern.** Snowflake bekommt das Token der Anmeldung als OAuth-Token, Databricks tauscht es gegen ein
  eigenes. Die Zahlen gibt es dann pro Person, gelesen beim ersten Blick und gehalten bis zum nächsten Neulesen.
- **Eigene Seiten pro Person**, die mit den bisher geteilten beginnen; ein Zugriffsprotokoll ohne Zahlen.

Offen:
- Rechte auf Teile einer Kennzahl (Region Ost sieht nur Ost), denn ob dann die Summe nur über sichtbare Teile läuft, ist
  noch nicht entschieden. Rechte wie die Windows-Ordnerrechte kommen mit der eigenen Integration.
- Weg 2 und die Anmeldung sind gegen nachgebaute Anbieter getestet, nicht gegen Authentik, Snowflake oder Databricks.

## Aktualisierung: Anstoss, Zeitplan, Dateien

Etappe 2 der Spezifikation, gebaut am 11. November 2026 als Version 0.6.

- **Drei Auslöser, ein Weg.** Ein Ladeprozess stösst an (Token pro Kosmos), ein Zeitplan liest zu festen Zeiten, und bei
  Dateien schaut Lumantic auf Anzahl, Grösse und Zeit. Alle drei führen in denselben Lauf: den ganzen Kosmos neu lesen.
- **Ein Lauf zur Zeit.** Wer während eines Laufs anstösst, bekommt genau einen weiteren danach. Zehn Anstösse in einer
  Minute sind zwei Läufe, nicht zehn.
- **Warehouses werden nicht beobachtet.** Schon «hat sich etwas geändert?» weckt ein Snowflake- oder Databricks-Warehouse,
  und Views verraten keine Änderung. Darum für sie: Anstoss aus dem Ladeprozess oder ein fester Zeitpunkt, standardmässig
  06:00. Lumantic im Firmennetz ist von der Cloud aus meist nicht erreichbar; den Anstoss gibt deshalb ein Werkzeug im
  Netz (Windmill, Airflow, ein CI-Lauf).
- **Neue Zahlen werden angeboten, nicht untergeschoben.** Wer liest, sieht oben eine Zeile «Neue Zahlen · Stand 07:42»
  mit «Zeigen». Eine Seite im Hintergrund übernimmt sie still. Danach öffnet der Raum dort, wo man war. Ein Lauf ohne neue
  Zahlen meldet nichts.
- **Der Token erscheint einmal.** Gespeichert wird ein Hash mit den letzten vier Zeichen; «Neu erzeugen» macht den alten
  sofort ungültig und fragt darum ein zweites Mal.

## Datenquellen: Snowflake, Databricks, Ersteinrichtung

Erste Etappe der Spezifikation «Datenquellen, Katalog und Zeitraster», gebaut am 11. November 2026 als Version 0.5.

- **REST statt Treiber.** Die Spezifikation nannte die Go-Treiber gosnowflake und databricks-sql-go. Gebaut sind beide
  Adapter über die offiziellen REST-Schnittstellen: die Snowflake SQL API und die Databricks SQL Statement Execution API.
  Die Anmeldearten bleiben dieselben (Schlüsselpaar oder Token; Service Principal mit OAuth oder Token), aber Lumantic
  braucht nur die Standardbibliothek, bleibt ein kleines Programm und spricht über HTTPS wie jede andere Anwendung im Netz.
  Damit fällt auch der Preis weg, den die Spezifikation für «ein Download für alle» nannte.
- **Fragen als Struktur, SQL pro Datenbank.** Lumantic fragt nach Summen pro Monat oder Tag, nach den Werten einer Dimension
  und nach Zeilen pro Tabelle. Ein Dialekt pro Datenbank schreibt daraus das SQL (Anführungszeichen, Datumsformat, Text-Typ).
  Die Kennzahlen-Ladung kennt kein DuckDB-SQL mehr.
- **Nur lesen, doppelt.** Neben der Rolle mit Leserechten weisen die Adapter für Snowflake und Databricks selbst alles ab,
  was nicht eine einzelne Abfrage mit `SELECT` oder `WITH` ist.
- **Tokens gehören zum Kosmos.** Zwei Kosmen dürfen in verschiedene Warehouses schauen. Ihre Tokens liegen getrennt in
  `data/secrets.json` und gehen mit, wenn ein Kosmos entfernt wird. Im Formular für einen neuen Kosmos wird ein Token nur
  eingetippt und erst mit «Kosmos anlegen» gespeichert; ein Verbindungstest benutzt ihn einmal und behält nichts.
- **Ersteinrichtung.** Vor der ersten Konfiguration fragt die App «Wo liegt dein Goldlayer?» mit fünf Karten statt eines
  Fehlers über eine Datei, die niemand gewählt hat. Eine Karte öffnet das Formular dieser Art.

Offen:
- Beide Adapter sind gegen nachgebaute Antworten getestet, noch nicht gegen echte Konten.
- Anmeldung mit Windows-Konto und Rechte aus AD-Gruppen (Weg 1), für Snowflake und Databricks auch das Fragen im Namen
  der Person (Weg 2): Etappe 3 der Spezifikation.

## Vom Uhrwerk zur ersten App

Die erste App (heute in `archive/app-uhrwerk/`) übernahm das Uhrwerk und ergänzte eine Menüführung für den Alltag:

- **Heute** ist der Einstieg: Lagebericht, Signale, Tageswerte des laufenden Monats, alle Dashboards mit Stand heute.
- **Heute | Zeitreise** als Schalter oben, **Z** wechselt in jeder Ansicht zwischen jetzt und dem letzten Moment in der Vergangenheit. Im Dashboard bleibt man am Ort und sieht dieselben Diagramme damals und heute.
- **Navigator links** mit Live-Status pro Dashboard, Ereignissen und gemerkten Zeitpunkten; **Zeitleiste unten** auf jeder Seite; **Springe zu** (Ctrl K) versteht Daten wie «März 2023».
- **Modus sichtbar:** In der Vergangenheit sind Schalter, Ortsangabe, Zeitleiste und ein Banner markiert, und die Kacheln zeigen den heutigen Wert daneben.
- **Daten aus dem Goldlayer:** Die Kennzahlen kommen über die Go-API aus DuckDB (bzw. Windmill), die Regeln (Grenze, Ziel, Richtung) aus einer Definitionsdatei. Anpassungen an Dashboards werden gespeichert.

Zusätzliche Grundlagen für die Navigation:

- Shneiderman 1996, Overview first, zoom and filter, details on demand: https://drum.lib.umd.edu/items/cd983adb-568a-47d3-b43a-1d8d8b8c72f4/full
- NN/g, Modes in User Interfaces: https://www.nngroup.com/articles/modes/
- NN/g, UI Accelerators: https://www.nngroup.com/articles/ui-accelerators/

## Entscheidungen und ihre Grundlagen

1. **Ruhe als Normalzustand.** Nur Signale werden hell. Few: Wenn alles betont ist, sticht nichts hervor. Calm Technology: Information wandert vom Rand ins Zentrum und zurück.
2. **Bewegung nur für Aufmerksamkeit.** Im Augenwinkel wird Bewegung zuverlässiger bemerkt als Farbe (verpasste Farbsignale 6 bis 25 %, Bewegung unter 2 %, Bartram et al. 2003). Nur Signale pulsieren, langsam und an Ort.
3. **Drei Linien statt Ampel.** Regulatorisches Minimum, internes Ziel, Trendsignal. Ampeln verbergen Trends (NHS Making Data Count). Trendregel aus der statistischen Prozesskontrolle: sechs Bewegungen in Folge in die falsche Richtung.
4. **Hysterese.** Nach einem Alarm kommt die Entwarnung erst mit 2 % Sicherheitsabstand. Wiederholte Meldungen senken die Beachtung um rund 30 % pro Wiederholung (Ancker et al. 2017).
5. **Das Rad navigiert, Diagramme messen.** Lineare Zeitachsen sind genauer und schneller als radiale (Waldner et al. 2019). Werte stehen darum nur in linearen Diagrammen.
6. **Achsen springen beim Abspielen nicht.** Animierte Übergänge helfen beim Verfolgen, neu skalierte Achsen schaden (Heer & Robertson 2007). Beim Abspielen dürfen Achsen nur wachsen.
7. **Abspielen zum Zeigen, Pausieren zum Analysieren.** Animation ist im Vortrag stark, in der Analyse schwächer als statische Ansichten (Robertson et al. 2008). Pause ist immer einen Klick entfernt (WCAG 2.2.2).
8. **Lumina begründet und lässt sich korrigieren.** Jede Empfehlung sagt, warum, und behauptet keine Ursachen. Eine Alternative ist einen Klick entfernt, neue Empfehlungen werden angekündigt statt still getauscht (Microsoft HAX: G9, G11, G14, G18).
9. **Plan als Umriss.** Flüsse zeigen das Ziel pro Periode als Umrissbalken hinter dem Ist (IBCS).
10. **Schönheit mit Mass.** Attraktive Oberflächen wirken nutzbarer und halten Aufmerksamkeit länger (Tractinsky 2000; Cawthon & Vande Moere), Dekoration ermüdet (Few). Die Gestaltung schmückt die Daten selbst.

## Offene Punkte für die echte App

- Regeln pro Kennzahl im Katalog pflegen: Minimum, Ziel, Frühwarnung, Toleranz. Heute sind sie im Entwurf fest hinterlegt.
- Mehrfachvergleiche: Prüft Lumina monatlich viele Reihen auf Auffälligkeiten, braucht es eine Korrektur, sonst häufen sich Fehlalarme (Zgraggen et al. 2018).
- Varianzanalyse für den Zinserfolg (Volumen, Zins, Mix), sobald die Daten im Goldlayer liegen.
- Anpassungen pro Person und Team speichern, Änderungen von Lumina protokollieren.

## Quellen

- Few, Common Pitfalls in Dashboard Design: https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- Weiser & Brown, Designing Calm Technology: https://calmtech.com/papers/designing-calm-technology
- Bartram et al. 2003, Moticons: https://www.interruptions.net/literature/Bartram-IJHCS03.pdf
- NHS Making Data Count: https://www.wsh.nhs.uk/asset-library/making-data-count-the-essentials.pdf
- Ancker et al. 2017, Alert fatigue: https://pmc.ncbi.nlm.nih.gov/articles/PMC5387195/
- Waldner et al. 2019, Radial vs linear: https://arxiv.org/abs/1907.13534
- Heer & Robertson 2007, Animated transitions: https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf
- Robertson et al. 2008, Animation for trends: https://faculty.cc.gatech.edu/~stasko/papers/infovis08-anim.pdf
- WCAG 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Microsoft HAX Toolkit: https://www.microsoft.com/en-us/haxtoolkit/library/pattern/
- IBCS Standards: https://ibcs.com/standards/
- NN/g, Aesthetic-usability effect: https://www.nngroup.com/articles/aesthetic-usability-effect/
- NN/g, Animation duration: https://www.nngroup.com/articles/animation-duration/
- Zgraggen et al. 2018, False discovery in visual analysis: https://dspace.mit.edu/handle/1721.1/137892
- SR 10-6 Liquidity Risk Management: https://www.federalreserve.gov/boarddocs/srletters/2010/sr1006a1.pdf
- BCBS 239: https://www.bis.org/publ/bcbs239.pdf
