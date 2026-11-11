// "Warum so?": the decisions behind Lumantic, each with its source.
import { h } from "./dom";

const PRINCIPLES: [string, string, string, string][] = [
  ["Zwei Orte, ein Schalter", "Heute zeigt die Tagesübersicht, die Zeitreise das Rad. Z wechselt zwischen jetzt und dem letzten Moment in der Vergangenheit, in jeder Ansicht. So vergleicht man mit einem Tastendruck, ohne den Ort zu verlieren.", "https://drum.lib.umd.edu/items/cd983adb-568a-47d3-b43a-1d8d8b8c72f4/full", "Shneiderman 1996: Overview first, zoom and filter, details on demand"],
  ["Der Modus ist immer sichtbar", "Wer in der Vergangenheit ist, sieht es oben, links, unten und als Banner. Alte Zahlen dürfen nie für heutige gehalten werden. Zurück zu heute ist immer ein Klick.", "https://www.nngroup.com/articles/modes/", "NN/g: Modes in User Interfaces"],
  ["Schnell für alle, die jeden Tag hier sind", "Alles geht mit der Maus. Wer täglich arbeitet, springt mit Tasten und «Springe zu» an jeden Ort und jedes Datum. Die Kürzel stehen neben den Befehlen, damit man sie nebenbei lernt.", "https://www.nngroup.com/articles/ui-accelerators/", "NN/g: UI Accelerators"],
  ["Ruhe ist der Normalzustand", "Nur was ein Signal auslöst, wird hell. Few: Wenn alles betont ist, sticht nichts hervor. Calm Technology: Information wandert vom Rand ins Zentrum und zurück.", "https://calmtech.com/papers/designing-calm-technology", "Weiser & Brown"],
  ["Bewegung nur für Aufmerksamkeit", "Im Augenwinkel wird Bewegung viel zuverlässiger bemerkt als Farbe: Verpasste Farbsignale stiegen von 6 auf 25 %, bei Bewegung blieben sie unter 2 %. Darum pulsieren nur Signale, langsam und an Ort.", "https://www.interruptions.net/literature/Bartram-IJHCS03.pdf", "Bartram et al. 2003"],
  ["Drei Linien statt Ampel", "Regulatorisches Minimum, internes Ziel und Trendsignal. Ampeln verbergen Trends. Die Trendregel aus der statistischen Prozesskontrolle meldet sechs Bewegungen in Folge, auch innerhalb der Grenzen.", "https://www.wsh.nhs.uk/asset-library/making-data-count-the-essentials.pdf", "NHS Making Data Count"],
  ["Hysterese gegen Flackern", "Nach einem Alarm kommt die Entwarnung erst mit 2 % Sicherheitsabstand. Wiederholte Meldungen senken die Beachtung um rund 30 % pro Wiederholung.", "https://pmc.ncbi.nlm.nih.gov/articles/PMC5387195/", "Ancker et al. 2017"],
  ["Das Rad navigiert, Diagramme messen", "Lineare Zeitachsen sind genauer und schneller als radiale (5.2 s statt 7.4 s, 14 % statt 41 % Fehler). Darum steht im Rad nur die Zeit, die Zeitleiste unten ist linear, und alle Werte liest man in linearen Diagrammen.", "https://arxiv.org/abs/1907.13534", "Waldner et al. 2019"],
  ["Übergänge animieren, Achsen nicht springen lassen", "Animierte Übergänge verbessern das Verfolgen von Veränderungen; neu skalierte Achsen erschweren das Schätzen. Beim Abspielen dürfen Achsen nur wachsen.", "https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf", "Heer & Robertson 2007"],
  ["Abspielen zum Zeigen, Pausieren zum Analysieren", "Animation ist im Vortrag am schnellsten und beliebtesten, für die Analyse aber langsamer und ungenauer. Pause ist darum immer einen Klick entfernt.", "https://faculty.cc.gatech.edu/~stasko/papers/infovis08-anim.pdf", "Robertson et al. 2008"],
  ["Lumina begründet und lässt sich korrigieren", "Jede Empfehlung sagt, warum, und behauptet keine Ursachen. Eine andere Ansicht ist einen Klick entfernt, neue Empfehlungen werden angekündigt statt still getauscht. Was du anpasst, bleibt so.", "https://www.microsoft.com/en-us/haxtoolkit/library/pattern/", "Microsoft HAX"],
  ["Plan als Umriss", "Flüsse zeigen das Ziel pro Periode als Umrissbalken hinter dem Ist, wie in der IBCS-Notation.", "https://ibcs.com/standards/", "IBCS"],
  ["Schönheit mit Mass", "Attraktive Oberflächen wirken nutzbarer und halten die Aufmerksamkeit länger, aber Dekoration ermüdet. Die Gestaltung schmückt die Daten selbst.", "https://www.nngroup.com/articles/aesthetic-usability-effect/", "NN/g, Tractinsky 2000"],
];

export function openPrinciples() {
  if (document.querySelector(".drawer")) return;
  const scrim = h("div", { class: "scrim" });
  const close = () => { scrim.remove(); drawer.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const drawer = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Warum Lumantic so gebaut ist" },
    h("div", { class: "drawer-head" }, h("h2", { text: "Warum so?" }), h("button", { class: "btn", type: "button", onclick: close }, "Schliessen")),
    h("p", { text: `${PRINCIPLES.length} Entscheidungen hinter Lumantic, jede mit ihrer Quelle.` }),
    PRINCIPLES.map(([t, d, url, src]) => h("div", { class: "pr" }, h("b", { text: t }), h("span", { text: d }), h("a", { href: url, target: "_blank", rel: "noopener" }, src + " ↗"))));
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim, drawer);
  (drawer.querySelector("button") as HTMLElement).focus();
}
