// "Springe zu …": one search box for places, key figures, moments and
// actions. Understands dates like "März 2023", "Q1 2023" or "2020".
import { h, icon } from "./dom";
import { levelCounts } from "./engine";
import { EVENTS, KPIS, N, PERIODS, SCOPES, monthFromKey, scopeOrder, ym } from "./model";
import { goLive, jumpTo, openDashboard, showHeute, showZeit, toggleTime } from "./nav";
import { openPrinciples } from "./principles";
import { setDesign, togglePin } from "./shell";
import { S, isLive, month, play, togglePlay } from "./time";
import { scopeIcon } from "./views/today";
import { W } from "./workspace";

interface Item {
  group: string;
  label: string;
  hint?: string;
  ic: string;
  keys?: string;
  words?: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").trim();
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
const MONTH_ALT: Record<string, number> = { may: 4, oct: 9, dec: 11, maer: 2 };

// Reads a moment out of free text; returns a month index or null.
export function parseMoment(q: string): number | null {
  const s = norm(q).replace(/\s+/g, " ");
  if (!s) return null;
  if (/^(heute|jetzt|aktuell|now)$/.test(s)) return N - 1;
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const inRange = (t: number) => (Number.isFinite(t) && t >= 0 ? Math.min(t, N - 1) : null);
  let m: RegExpExecArray | null;
  if ((m = /^(19|20)\d{2}$/.exec(s))) return inRange(ym(Number(s), 12));
  if ((m = /^q([1-4])\s*[/.-]?\s*(\d{2}|\d{4})$/.exec(s))) return inRange(ym(year(m[2]), Number(m[1]) * 3));
  if ((m = /^(\d{4})\s*[/.-]?\s*q([1-4])$/.exec(s))) return inRange(ym(Number(m[1]), Number(m[2]) * 3));
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return inRange(monthFromKey(s));
  if ((m = /^(\d{1,2})[./-](\d{2}|\d{4})$/.exec(s)) && Number(m[1]) >= 1 && Number(m[1]) <= 12) return inRange(ym(year(m[2]), Number(m[1])));
  if ((m = /^([a-z]+)\.?\s*(\d{2}|\d{4})$/.exec(s))) {
    const word = m[1], idx = MONTH_ALT[word] ?? MONTH_KEYS.findIndex((k) => word.startsWith(k) || (word.length >= 3 && k.startsWith(word.slice(0, 3))));
    if (idx >= 0) return inRange(ym(year(m[2]), idx + 1));
  }
  return null;
}

function staticItems(): Item[] {
  const items: Item[] = [
    { group: "Ansichten", label: "Heute", hint: "Tagesübersicht mit den aktuellen Werten", ic: "heute", keys: "H", words: "tagesuebersicht start home aktuell", run: () => showHeute() },
    { group: "Ansichten", label: "Zeitreise", hint: S.memo !== null ? `weiter bei ${PERIODS.monat[S.memo].long}` : "das Zeitrad, ein Jahr zurück", ic: "zeit", keys: "Z", words: "rad historie geschichte uhrwerk", run: () => showZeit() },
  ];
  scopeOrder().forEach((scope, i) => items.push({ group: "Dashboards", label: SCOPES[scope], ic: scopeIcon(scope), keys: String(i + 1), words: "dashboard", run: () => openDashboard(scope) }));
  for (const k of KPIS) items.push({ group: "Kennzahlen", label: k.name, hint: `${k.long} · ${SCOPES[k.group]}`, ic: scopeIcon(k.group), words: `${k.short} ${k.long} ${k.desc}`, run: () => openDashboard(k.group, k.id) });
  for (const p of W.pins.map(monthFromKey).filter((t) => t >= 0 && t < N)) items.push({ group: "Zeitpunkte", label: PERIODS.monat[p].long, hint: "gemerkt", ic: "pin", words: "gemerkt pin", run: () => jumpTo(p) });
  for (const e of [...EVENTS].sort((a, b) => b.t - a.t)) items.push({ group: "Zeitpunkte", label: e.title, hint: PERIODS.monat[e.t].long, ic: "event", words: e.text, run: () => jumpTo(e.t) });
  items.push(
    { group: "Aktionen", label: S.playing ? "Anhalten" : "Geschichte abspielen", ic: "play", keys: "Leertaste", words: "play abspielen animation", run: () => (S.view === "heute" ? (showZeit({ t: 0, instant: true }), play()) : togglePlay()) },
    { group: "Aktionen", label: S.view === "heute" || S.view === "zeit" ? "Zwischen Heute und Zeitreise wechseln" : isLive() ? "Zum gemerkten Moment springen" : "Zurück zu heute", ic: "zeit", keys: "Z", words: "toggle wechseln", run: () => toggleTime() },
    { group: "Aktionen", label: "Diesen Zeitpunkt merken", ic: "pin", keys: "M", words: "merken pin lesezeichen", run: () => togglePin() },
    { group: "Aktionen", label: "Zurück zu heute", ic: "last", words: "live aktuell gegenwart", run: () => goLive() },
    { group: "Aktionen", label: "Warum so? Die Entscheidungen und Quellen", ic: "why", words: "forschung quellen prinzipien", run: () => openPrinciples() },
    { group: "Aktionen", label: "Tastenkürzel", ic: "keys", keys: "?", words: "shortcuts tastatur hilfe", run: () => openShortcuts() },
    { group: "Design", label: "Design Atlas", hint: "Nacht, Messing", ic: "heute", words: "dunkel theme", run: () => setDesign("atlas") },
    { group: "Design", label: "Design Zifferblatt", hint: "Porzellan, Kobalt", ic: "heute", words: "hell theme", run: () => setDesign("zifferblatt") },
    { group: "Design", label: "Design Messtisch", hint: "Blaupause, Plotter", ic: "heute", words: "blau theme", run: () => setDesign("messtisch") });
  return items;
}

function score(it: Item, q: string) {
  const label = norm(it.label), words = norm(`${it.hint || ""} ${it.words || ""} ${it.group}`);
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s·:-]+/).some((w) => w.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  if (q.length >= 3 && words.includes(q)) return 1;
  return 0;
}

let open: HTMLElement | null = null;
export const paletteOpen = () => open !== null;

export function openPalette(initial = "") {
  if (open) return;
  const input = h("input", { class: "pal-input", type: "text", placeholder: "Springe zu … Dashboard, Kennzahl, «März 2023», «Q1 2024»", "aria-label": "Suchen", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "pal-list", role: "listbox" });
  const scrim = h("div", { class: "scrim scrim--pal" });
  const box = h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Springe zu" },
    h("div", { class: "pal-field" }, icon("search", 18), input, h("kbd", { text: "Esc" })), list,
    h("div", { class: "pal-foot label" }, "↑ ↓ wählen · Enter öffnet · Daten wie «Juni 2023», «2020», «Q3 2025»"));
  const base = staticItems();
  let shown: Item[] = [], active = 0;
  const close = () => { scrim.remove(); box.remove(); open = null; };
  const run = (it: Item) => { close(); it.run(); };
  const render = () => {
    const q = norm(input.value);
    const items: Item[] = [];
    const t = parseMoment(input.value);
    if (t !== null) {
      const c = levelCounts(t);
      items.push({ group: "Zeitpunkt", label: t === N - 1 ? "Heute" : `Springe zu ${PERIODS.monat[t].long}`, hint: c.alert || c.watch ? `${c.alert} brauchten Aufmerksamkeit, ${c.watch} im Auge` : "ruhiger Monat", ic: "zeit",
        run: () => (t === N - 1 ? (S.view === "zeit" || S.view === "dash" ? goLive() : showHeute()) : jumpTo(t)) });
    }
    if (q) items.push(...base.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it).slice(0, 12));
    else items.push(...base.filter((it) => it.group !== "Design" && it.group !== "Kennzahlen").slice(0, 12));
    shown = items;
    active = Math.min(active, Math.max(0, items.length - 1));
    let group = "";
    list.replaceChildren(...(items.length ? items.flatMap((it, i) => {
      const head = it.group !== group ? h("div", { class: "pal-group label", text: it.group }) : null;
      group = it.group;
      const row = h("button", { class: "pal-item" + (i === active ? " is-active" : ""), type: "button", role: "option", "aria-selected": String(i === active), onclick: () => run(it) },
        icon(it.ic), h("span", { class: "pal-label", text: it.label }), it.hint ? h("span", { class: "pal-hint", text: it.hint }) : null, it.keys ? h("kbd", { text: it.keys }) : null);
      row.addEventListener("pointermove", () => { if (active !== i) { active = i; paint(); } });
      return head ? [head, row] : [row];
    }) : [h("p", { class: "pal-empty voice", text: `Nichts gefunden für «${input.value}». Versuch einen Monat wie «März 2023» oder eine Kennzahl.` })]));
  };
  const paint = () => list.querySelectorAll(".pal-item").forEach((el, i) => { el.classList.toggle("is-active", i === active); el.setAttribute("aria-selected", String(i === active)); if (i === active) (el as HTMLElement).scrollIntoView({ block: "nearest" }); });
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) run(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  scrim.addEventListener("click", close);
  document.body.append(scrim, box);
  open = box;
  input.value = initial;
  render();
  input.focus();
}

const SHORTCUTS: [string, string][] = [
  ["H", "Heute: die Tagesübersicht"],
  ["Z", "Zwischen heute und dem letzten Moment in der Vergangenheit wechseln"],
  ["1 bis 6", "Dashboard öffnen"],
  ["Ctrl K oder /", "Springe zu: Ansicht, Kennzahl, Datum"],
  ["← →", "Einen Monat zurück oder vor, mit Shift ein Jahr"],
  ["Leertaste", "Geschichte abspielen oder anhalten"],
  ["M", "Diesen Zeitpunkt merken"],
  ["Esc", "Zurück zur Übersicht, Fenster schliessen"],
  ["?", "Diese Liste"],
];

export function openShortcuts() {
  const scrim = h("div", { class: "scrim" });
  const close = () => { scrim.remove(); box.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); e.stopPropagation(); close(); } };
  const box = h("div", { class: "keys", role: "dialog", "aria-modal": "true", "aria-label": "Tastenkürzel" },
    h("div", { class: "keys-head" }, h("h2", { text: "Tastenkürzel" }), h("button", { class: "btn", type: "button", onclick: close }, "Schliessen")),
    h("p", { class: "voice muted", text: `Alles geht auch mit der Maus. Die Tasten sind für alle, die jeden Morgen hier sind. Aktuell: ${isLive() ? "heute" : PERIODS.monat[month()].long}.` }),
    h("dl", {}, SHORTCUTS.map(([k, d]) => [h("dt", {}, k.split(" oder ").flatMap((x, i) => (i ? [" oder ", h("kbd", { text: x })] : [h("kbd", { text: x })]))), h("dd", { text: d })])));
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim, box);
  (box.querySelector("button") as HTMLElement).focus();
}

