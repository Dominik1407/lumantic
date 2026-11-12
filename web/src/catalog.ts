// The Sternkatalog: every key figure of a Kosmos as an entry in a star catalogue — what it means, where it is read,
// who answers for it, its targets over time — beside the words of the business and the tables underneath. Each field
// says where it comes from: the company catalog in the source (a filled dot), an addition in Lumantic (a ring) or a
// guess from a column name (a dashed ring). What the company catalog says is shown, never changed here; what it leaves
// open can be added in place. In a Kosmos it shows that Kosmos; from the main menu every Kosmos, with one search.
import { isEn, tr } from "./i18n";
import { api, ApiError, MAIN, type Katalog, type KatalogBound, type KatalogEntry, type KatalogTerm } from "./api";
import { $, h } from "./dom";

export interface CatalogHost {
  kosmos(): string; // the Kosmos the page shows; "" in the main menu
  kosmen(): { id: string; name: string }[];
  show(kosmos: string, kpi: string): void; // fly to the figure in the room, or go into its Kosmos
  still(): boolean;
}

const EN = isEn();
const MON = EN ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] : ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const NUM = EN ? ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"] : ["Kein", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
const FROM: Record<string, string> = EN ? { quelle: "from the company catalogue", lumantic: "added in Lumantic", vermutet: "guessed, from type and column name" }
  : { quelle: "aus dem Fachkatalog", lumantic: "in Lumantic ergänzt", vermutet: "vermutet, aus Typ und Spaltenname" };
const FROM_SHORT: Record<string, string> = { ...FROM, vermutet: EN ? "guessed" : "vermutet" };
const UNIT: Record<string, string> = EN ? { "%": "Percent", Mio: "CHF millions", Mrd: "CHF billions", Tsd: "CHF thousands", Stk: "Pieces", Tage: "Days", h: "Hours", Zahl: "Number" }
  : { "%": "Prozent", Mio: "Mio. CHF", Mrd: "Mrd. CHF", Tsd: "Tsd. CHF", Stk: "Stück", Tage: "Tage", h: "Stunden", Zahl: "Zahl" };
const UNIT_SHORT: Record<string, string> = EN ? { "%": "%", Mio: "CHF m", Mrd: "CHF bn", Tsd: "CHF k", Stk: "pcs", Tage: "days", h: "h", Zahl: "" }
  : { "%": "%", Mio: "Mio. CHF", Mrd: "Mrd. CHF", Tsd: "Tsd. CHF", Stk: "Stk.", Tage: "Tage", h: "h", Zahl: "" };
// How a flow's annual target spreads over the year, and what time a target covers.
const PHASING: Record<string, string> = EN ? { monate: "evenly over the months, within a month over its working days", arbeitstage: "by the working days of the year", kalendertage: "by the calendar days", profil: "by a profile of its own" }
  : { monate: "gleich auf die Monate, im Monat auf die Arbeitstage", arbeitstage: "nach den Arbeitstagen des Jahres", kalendertage: "nach den Kalendertagen", profil: "nach einem eigenen Profil" };
const CHOICES: Record<string, [string, string][]> = EN ? {
  phasing: [["monate", "Evenly over the months, within a month over its working days (standard)"], ["arbeitstage", "By the working days of the year"], ["kalendertage", "By the calendar days"]],
  targetPer: [["monat", "Per month"], ["jahr", "Per year, as a budget"]],
} : {
  phasing: [["monate", "Gleich auf die Monate, im Monat auf die Arbeitstage (Standard)"], ["arbeitstage", "Nach den Arbeitstagen des Jahres"], ["kalendertage", "Nach den Kalendertagen"]],
  targetPer: [["monat", "Pro Monat"], ["jahr", "Pro Jahr, als Budget"]],
};
const PER: Record<string, string> = EN ? { monat: "per month", jahr: "per year" } : { monat: "pro Monat", jahr: "pro Jahr" };
const KIND: Record<string, string> = EN ? { stock: "Balance at the reporting date", flow: "Sum over the month", avg: "Average of the months", ratio: "Ratio of numerator and denominator" }
  : { stock: "Bestand am Stichtag", flow: "Summe im Monat", avg: "Durchschnitt der Monate", ratio: "Verhältnis aus Zähler und Nenner" };
const DIR: Record<string, string> = EN ? { "1": "higher is better", "-1": "lower is better", "0": "neutral" } : { "1": "höher ist besser", "-1": "tiefer ist besser", "0": "neutral" };
const ROLE: Record<string, string> = EN ? { time: "Time", dimension: "Dimension", measure: "Measure" } : { time: "Zeit", dimension: "Dimension", measure: "Messwert" };
// The fields whose origin a row shows as its trace, in this order.
const TRACE = ["desc", "unit", "kind", "dir", "target", "owner"];

const month = (ym: string) => { const [y, m] = (ym || "").split("-").map(Number); return y && m ? `${MON[m - 1]} ${y}` : ""; };
const num = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, EN ? "," : "’") : String(v));
// A value with its unit: «92 Mio. CHF» in German, «CHF 92m» in English.
const withUnit = (v: number, unit: string) => {
  const ch = EN && { Mio: "m", Mrd: "bn", Tsd: "k" }[unit];
  return ch ? `CHF ${num(v)}${ch}` : EN && unit === "%" ? `${num(v)}%` : `${num(v)} ${UNIT_SHORT[unit] ?? ""}`.trim();
};
// A word of the business in the language of the interface: its English words where the team wrote them. What is
// saved stays the German, so the English only ever shows.
const word = (t: KatalogTerm) => (EN && t.en?.term) || t.term;
const meaning = (t: KatalogTerm) => (EN && t.en?.definition) || t.definition;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : tr("Der Server antwortet nicht.", "The server does not answer."));
const mark = (from: string | undefined) => h("i", { class: "kt-o", "data-from": from || "lumantic", title: FROM[from || "lumantic"], "aria-label": FROM[from || "lumantic"] });

interface Loaded { kosmos: string; name: string; data: Katalog }
// One row of the list: an entry with the Kosmos it belongs to and its catalogue number.
interface Row { at: Loaded; e: KatalogEntry; no: string }
type Pick = { kind: "entry"; row: Row } | { kind: "terms"; at: Loaded } | { kind: "tables"; at: Loaded } | null;

export function createCatalog(host: CatalogHost) {
  const el = $("katalog");
  let loaded: Loaded[] = [], pick: Pick = null, query = "", editing = "", msg = "", busy = false, back: HTMLElement | null = null, narrowDetail = false;
  const search = h("input", { type: "search", class: "kt-search", placeholder: tr("Kennzahl, Begriff oder Spalte suchen", "Search a figure, a word or a column"), "aria-label": tr("Im Sternkatalog suchen", "Search the star catalogue"), autocomplete: "off" });
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
  const list = h("nav", { class: "kt-list", "aria-label": tr("Sterne", "Stars") });
  const detail = h("article", { class: "kt-entry", "aria-live": "polite" });
  const title = h("h1", { class: "kt-hl" });
  const eyebrow = h("p", { class: "kt-eye" });
  const close = h("button", { type: "button", class: "kt-x", "aria-label": tr("Sternkatalog schliessen", "Close the star catalogue"), title: tr("Schliessen (Esc)", "Close (Esc)"), onclick: () => hide() }, "×");
  const legend = h("p", { class: "kt-legend" }, ...["quelle", "lumantic", "vermutet"].map((f) => h("span", {}, mark(f), FROM_SHORT[f])));
  el.replaceChildren(h("div", { class: "kt-in" },
    h("header", { class: "kt-head" }, h("div", { class: "kt-titles" }, eyebrow, title), close),
    h("div", { class: "kt-tools" }, search, legend),
    h("div", { class: "kt-body" }, list, detail)));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); if (editing) { editing = ""; draw(); } else hide(); }
  });

  // ───────────── Open and close ─────────────
  async function open(kpi = "") {
    if (!el.hidden && !kpi) { hide(); return; }
    back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.hidden = false;
    document.documentElement.classList.add("kt-open");
    editing = ""; msg = ""; narrowDetail = !!kpi;
    const here = host.kosmos();
    const want = here ? [{ id: here, name: host.kosmen().find((k) => k.id === here)?.name || "" }] : host.kosmen();
    eyebrow.textContent = here ? tr(`Sternkatalog · ${want[0].name}`, `Star catalogue · ${want[0].name}`) : tr("Sternkatalog · alle Kosmen", "Star catalogue · all Kosmen");
    title.textContent = tr("Der Katalog wird gelesen …", "Reading the catalogue …");
    list.replaceChildren(); detail.replaceChildren();
    const got = await Promise.all(want.map(async (k) => { try { return { kosmos: k.id, name: k.name, data: await api.katalog(k.id) }; } catch (e) { msg = errText(e); return null; } }));
    loaded = got.filter((x): x is Loaded => !!x);
    const rows = allRows();
    pick = kpi ? (rows.find((r) => r.e.id === kpi && r.at.kosmos === (here || r.at.kosmos)) ? { kind: "entry", row: rows.find((r) => r.e.id === kpi)! } : null) : null;
    if (!pick && rows.length && matchMedia("(min-width: 861px)").matches) pick = { kind: "entry", row: rows[0] };
    draw();
    (kpi ? detail : search).focus({ preventScroll: true });
  }
  function hide(): boolean {
    if (el.hidden) return false;
    el.hidden = true;
    document.documentElement.classList.remove("kt-open");
    if (back && back.isConnected) back.focus({ preventScroll: true });
    return true;
  }

  // ───────────── The list ─────────────
  function allRows(): Row[] {
    const out: Row[] = [];
    for (const at of loaded) at.data.entries.forEach((e, i) => out.push({ at, e, no: String(i + 1).padStart(2, "0") }));
    return out;
  }
  // A row matches the search by its name, words, source, owner, and the synonyms of the words that name it.
  function hits(r: Row): boolean {
    if (!query) return true;
    const f = r.e.fields, syn = r.at.data.terms.filter((t) => t.kpi === r.e.id).flatMap((t) => [t.term, ...(t.synonyms || [])]);
    return [r.e.name, r.e.topic, f.desc?.value, f.formula?.value, f.source?.value, f.owner?.value, ...syn].some((x) => String(x ?? "").toLowerCase().includes(query));
  }
  const termHits = (t: KatalogTerm) => !query || [t.term, t.definition, word(t), meaning(t), ...(t.synonyms || [])].some((x) => x.toLowerCase().includes(query));
  function draw() {
    const rows = allRows(), shown = rows.filter(hits);
    const n = rows.length, topics = new Set(rows.map((r) => r.at.kosmos + "|" + r.e.topic)).size;
    title.textContent = !loaded.length ? (msg || tr("Kein Katalog zu lesen.", "No catalogue to read.")) : n === 0 ? tr("Noch keine Sterne.", "No stars yet.")
      : EN ? `${NUM[n] || n} ${n === 1 ? "star" : "stars"}, ${NUM[topics]?.toLowerCase() || topics} ${topics === 1 ? "topic" : "topics"}.` : `${NUM[n] || n} ${n === 1 ? "Stern" : "Sterne"}, ${NUM[topics]?.toLowerCase() || topics} ${topics === 1 ? "Thema" : "Themen"}.`;
    const kids: Node[] = [];
    for (const at of loaded) {
      const mine = shown.filter((r) => r.at === at);
      if (loaded.length > 1) kids.push(h("p", { class: "kt-kosmos", text: at.name }));
      if (at.data.problems.length) kids.push(h("details", { class: "kt-problems" }, h("summary", { text: EN ? `${at.data.problems.length === 1 ? "One entry" : `${at.data.problems.length} entries`} of the company catalogue cannot be read` : `${at.data.problems.length === 1 ? "Ein Eintrag" : `${at.data.problems.length} Einträge`} des Fachkatalogs lassen sich nicht lesen` }),
        h("ul", {}, ...at.data.problems.map((p) => h("li", { text: p })))));
      let topic = "";
      for (const r of mine) {
        if (r.e.topic !== topic) { topic = r.e.topic; kids.push(h("p", { class: "kt-topic", text: topic || tr("Ohne Thema", "Without a topic") })); }
        const on = pick?.kind === "entry" && pick.row.e.id === r.e.id && pick.row.at === at;
        kids.push(h("button", { type: "button", class: "kt-row" + (r.e.status ? " is-missing" : ""), "aria-current": String(on), style: `--i:${kids.length}`,
          onclick: () => { pick = { kind: "entry", row: r }; editing = ""; narrowDetail = true; draw(); detail.focus({ preventScroll: true }); } },
          h("span", { class: "kt-no", text: r.no }),
          h("span", { class: "kt-star", "aria-hidden": "true" }),
          h("span", { class: "kt-name", text: r.e.name }),
          h("span", { class: "kt-trace", "aria-hidden": "true" }, ...TRACE.filter((f) => r.e.fields[f]).map((f) => mark(r.e.fields[f].from)))));
      }
      const terms = at.data.terms.filter(termHits), tables = at.data.tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)));
      kids.push(h("div", { class: "kt-more" },
        h("button", { type: "button", class: "kt-row is-plain", "aria-current": String(pick?.kind === "terms" && pick.at === at), onclick: () => { pick = { kind: "terms", at }; editing = ""; narrowDetail = true; draw(); } },
          h("span", { class: "kt-no", text: tr("Wörter", "Words") }), h("span", { class: "kt-name", text: tr(`Begriffe · ${terms.length}`, `Terms · ${terms.length}`) })),
        h("button", { type: "button", class: "kt-row is-plain", "aria-current": String(pick?.kind === "tables" && pick.at === at), onclick: () => { pick = { kind: "tables", at }; editing = ""; narrowDetail = true; draw(); } },
          h("span", { class: "kt-no", text: tr("Quelle", "Source") }), h("span", { class: "kt-name", text: tr(`Tabellen · ${tables.length}`, `Tables · ${tables.length}`) }))));
    }
    if (loaded.length && !shown.length && query) kids.push(h("p", { class: "kt-none", text: tr(`Zu «${search.value.trim()}» gibt es keinen Stern.`, `No star for «${search.value.trim()}».`) }));
    list.replaceChildren(...kids);
    el.classList.toggle("is-detail", narrowDetail && !!pick);
    const parts = pick?.kind === "entry" ? entry(pick.row) : pick?.kind === "terms" ? termsOf(pick.at) : pick?.kind === "tables" ? tablesOf(pick.at) : [h("p", { class: "kt-quiet", text: tr("Wähle einen Stern.", "Pick a star.") })];
    detail.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  // ───────────── One entry ─────────────
  const backBtn = () => h("button", { type: "button", class: "kt-back", onclick: () => { narrowDetail = false; draw(); } }, tr("← Alle Sterne", "← All stars"));
  function entry(r: Row): (Node | null)[] {
    const e = r.e, f = e.fields, can = r.at.data.editable, unit = String(f.unit?.value || "");
    const value = (v: number) => withUnit(v, unit);
    const facts: Node[] = [];
    // One line of the fact sheet: label, origin, value, and a way to add what is open.
    const fact = (label: string, key: string, show: Node | string, editKey = "") => {
      const fl = f[key], from = fl?.from, open = !fl || fl.value === "" || fl.value === null;
      const mayEdit = can && editKey && from !== "quelle";
      if (editing === r.at.kosmos + "|" + e.id + "|" + editKey) { facts.push(h("dt", {}, label), h("dd", { class: "is-edit" }, editor(r, editKey, fl?.value))); return; }
      facts.push(h("dt", {}, label), h("dd", {}, open ? null : mark(from), h("span", { class: open ? "kt-open" : "" }, open ? tr("offen", "open") : show),
        mayEdit ? h("button", { type: "button", class: "kt-add", onclick: () => { editing = r.at.kosmos + "|" + e.id + "|" + editKey; draw(); } }, open ? tr("Ergänzen", "Add") : tr("Ändern", "Change"))
          : from === "quelle" && editKey ? h("span", { class: "kt-lock", title: tr("Nur im Fachkatalog zu ändern", "Only to be changed in the company catalogue") }, tr("Fachkatalog", "Company catalogue")) : null));
    };
    fact(tr("Berechnung", "Calculation"), "formula", String(f.formula?.value || ""), "formula");
    facts.push(h("dt", {}, tr("Quelle", "Source")), h("dd", {}, mark(f.source?.from), h("code", { text: String(f.source?.value || "") })));
    if (e.first) facts.push(h("dt", {}, tr("Daten", "Data")), h("dd", {}, tr(`${month(e.first)} bis ${month(e.last)}`, `${month(e.first)} to ${month(e.last)}`)));
    fact(tr("Einheit", "Unit"), "unit", UNIT[unit] || unit);
    fact(tr("Art", "Kind"), "kind", KIND[String(f.kind?.value)] || String(f.kind?.value || ""));
    if (f.raster) fact(tr("Raster", "Raster"), "raster", f.raster.value === "tag" ? tr("täglich erhoben, darum auch in Wochen und Tagen", "collected daily, so also in weeks and days") : tr("monatlich erhoben", "collected monthly"));
    fact(tr("Richtung", "Direction"), "dir", DIR[String(f.dir?.value)] || "");
    const bounds = (kind: "ziel" | "grenze") => e.bounds.filter((b) => b.kind === kind);
    // A flow's budget covers a year unless it says otherwise; its limit a month.
    const flow = f.kind?.value === "flow", perOf = (b: KatalogBound) => (flow ? " " + PER[b.per || (b.kind === "ziel" ? "jahr" : "monat")] : "");
    const boundList = (kind: "ziel" | "grenze") => h("ul", { class: "kt-bounds" }, ...bounds(kind).map((b) => h("li", {}, mark(b.origin),
      h("strong", { text: value(b.value) + perOf(b) }), " ", b.from && b.until ? tr(`${month(b.from)} bis ${month(b.until)}`, `${month(b.from)} to ${month(b.until)}`) : b.from ? tr(`ab ${month(b.from)}`, `from ${month(b.from)}`) : b.until ? tr(`bis ${month(b.until)}`, `until ${month(b.until)}`) : "immer",
      b.name ? h("span", { class: "kt-bn", text: " · " + b.name }) : null)));
    if (bounds("ziel").length) facts.push(h("dt", {}, tr("Ziel", "Target")), h("dd", {}, boundList("ziel")));
    else fact(tr("Ziel", "Target"), "target", f.target ? value(Number(f.target.value)) + (f.targetPer ? " " + PER[String(f.targetPer.value)] : "") : "", "target");
    if (f.targetPer && !bounds("ziel").length) fact(tr("Ziel gilt", "Target holds"), "targetPer", PER[String(f.targetPer.value)] || "", "targetPer");
    if (f.phasing && (f.target || bounds("ziel").length)) fact(tr("Verteilung", "Spread"), "phasing", PHASING[String(f.phasing.value)] || String(f.phasing.value), "phasing");
    if (bounds("grenze").length) facts.push(h("dt", {}, tr("Grenze", "Limit")), h("dd", {}, boundList("grenze")));
    else fact(tr("Grenze", "Limit"), "limit", f.limit ? value(Number(f.limit.value)) : "", "limit");
    fact(tr("Eigner", "Owner"), "owner", String(f.owner?.value || ""), "owner");
    if (f.parts) facts.push(h("dt", {}, tr("Teile", "Parts")), h("dd", {}, mark(f.parts.from), String(f.parts.value).includes(",") ? String(f.parts.value) : tr(`nach ${f.parts.value}`, `by ${f.parts.value}`)));

    const desc = f.desc, descOpen = !desc || !desc.value;
    const words = r.at.data.terms.filter((t) => t.kpi === e.id);
    return [
      backBtn(),
      h("p", { class: "kt-eye" }, tr(`Stern ${r.no} · ${e.topic || "Ohne Thema"}${loaded.length > 1 ? " · " + r.at.name : ""}`, `Star ${r.no} · ${e.topic || "Without a topic"}${loaded.length > 1 ? " · " + r.at.name : ""}`)),
      h("h2", { class: "kt-title", tabindex: "-1", text: e.name }),
      editing === r.at.kosmos + "|" + e.id + "|desc" ? editor(r, "desc", desc?.value)
        : h("p", { class: "kt-def" + (descOpen ? " is-open" : "") }, descOpen ? null : mark(desc.from), descOpen ? tr("Noch ohne Definition.", "No definition yet.") : String(desc.value),
          can && desc?.from !== "quelle" ? h("button", { type: "button", class: "kt-add", onclick: () => { editing = r.at.kosmos + "|" + e.id + "|desc"; draw(); } }, descOpen ? tr("Definition ergänzen", "Add a definition") : tr("Ändern", "Change")) : null),
      e.status ? h("p", { class: "kt-missing", text: tr(`Im Goldlayer fehlt: ${e.status}. Lumantic zeigt den Stern erst, wenn er sich lesen lässt.`, `Missing in the gold layer: ${e.status}. Lumantic shows the star once it can be read.`) }) : null,
      words.length ? h("p", { class: "kt-syn" }, tr("Auch genannt: ", "Also called: "), ...words.flatMap((t) => [...new Set([word(t), t.term, ...(t.synonyms || [])])]).map((w, i) => [i ? ", " : "", h("em", { text: w })]).flat()) : null,
      h("dl", { class: "kt-facts" }, ...facts),
      msg ? h("p", { class: "kt-msg", role: "status", text: msg }) : null,
      h("div", { class: "kt-acts" }, h("button", { type: "button", class: "kt-btn", onclick: () => { hide(); host.show(r.at.kosmos, e.id); } }, host.kosmos() ? tr("Im Raum zeigen", "Show in the room") : tr(`In «${r.at.name}» zeigen`, `Show in «${r.at.name}»`))),
    ];
  }

  // An editor for one field: text for words, a number for target and limit, a choice for how a target spreads. Empty clears.
  function editor(r: Row, key: string, cur: unknown): HTMLElement {
    const long = key === "desc" || key === "formula", numeric = key === "target" || key === "limit", opts = CHOICES[key];
    const inp = opts ? h("select", { class: "kt-in-line", "aria-label": key === "phasing" ? tr("Verteilung", "Spread") : tr("Ziel gilt", "Target holds") }, ...opts.map(([v, label]) => h("option", { value: v }, label)))
      : long ? h("textarea", { class: "kt-in-text", rows: "3" }) : h("input", { class: "kt-in-line", inputmode: numeric ? "decimal" : "text" });
    inp.value = cur === null || cur === undefined ? "" : String(cur);
    const save = async () => {
      if (busy) return;
      let v: string | number | null = inp.value.trim();
      if (numeric) {
        const n = v === "" ? null : Number(EN ? String(v).replace(/[,\s]/g, "") : String(v).replace(/[’'\s]/g, "").replace(",", "."));
        if (n !== null && !Number.isFinite(n)) { msg = tr("Bitte eine Zahl, zum Beispiel 42.5.", "Please enter a number, for example 42.5."); draw(); return; }
        v = n;
      }
      busy = true;
      try {
        r.at.data = await api.saveKatalogEntry(r.at.kosmos, r.e.id, { [key]: v });
        const fresh = r.at.data.entries.find((x) => x.id === r.e.id);
        if (fresh && pick?.kind === "entry") pick = { kind: "entry", row: { ...r, e: fresh } };
        editing = ""; msg = tr("Gespeichert. Der Raum zeigt es beim nächsten Öffnen.", "Saved. The room shows it the next time it opens.");
      } catch (e) { msg = errText(e); }
      busy = false;
      draw();
    };
    inp.addEventListener("keydown", (ev) => { const e = ev as KeyboardEvent; if (e.key === "Enter" && (!long || e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } });
    queueMicrotask(() => inp.focus());
    return h("div", { class: "kt-edit" }, inp, h("div", { class: "kt-acts" },
      h("button", { type: "button", class: "kt-btn primary", onclick: () => void save() }, tr("Speichern", "Save")),
      h("button", { type: "button", class: "kt-btn quiet", onclick: () => { editing = ""; draw(); } }, tr("Abbrechen", "Cancel"))));
  }

  // ───────────── Words ─────────────
  function termsOf(at: Loaded): Node[] {
    const terms = at.data.terms.filter(termHits), own = at.data.terms.filter((t) => t.origin !== "quelle");
    const name = (id: string) => at.data.entries.find((e) => e.id === id)?.name;
    const save = async (next: KatalogTerm[]) => {
      try { at.data = await api.saveKatalogTerms(at.kosmos, next); msg = tr("Gespeichert.", "Saved."); } catch (e) { msg = errText(e); }
      draw();
    };
    const out: Node[] = [backBtn(), h("p", { class: "kt-eye", text: tr(`Begriffe · ${at.name}`, `Terms · ${at.name}`) }), h("h2", { class: "kt-title", text: tr("Die Wörter des Hauses", "The words of the house") }),
      h("p", { class: "kt-def is-quiet", text: tr("Damit alle und Lumina dasselbe meinen: «Termintreue» findet die Liefertreue, wenn es so dasteht.", "So that everyone and Lumina mean the same: «on-time delivery» finds the delivery reliability when it says so.") })];
    out.push(h("dl", { class: "kt-terms" }, ...terms.flatMap((t) => [
      h("dt", {}, mark(t.origin), word(t), t.kpi && name(t.kpi) ? h("span", { class: "kt-bn", text: " → " + name(t.kpi) }) : null,
        at.data.editable && t.origin !== "quelle" ? h("button", { type: "button", class: "kt-add", title: tr(`«${t.term}» entfernen`, `Remove «${word(t)}»`), onclick: () => void save(own.filter((x) => x !== t)) }, tr("Entfernen", "Remove")) : null),
      h("dd", {}, meaning(t), t.synonyms?.length ? h("span", { class: "kt-syn" }, tr(" Auch: ", " Also: "), t.synonyms.join(", ")) : null)])));
    if (!terms.length) out.push(h("p", { class: "kt-quiet", text: query ? tr("Kein Begriff passt.", "No term fits.") : tr("Noch keine Begriffe.", "No terms yet.") }));
    if (at.data.editable) {
      const term = h("input", { class: "kt-in-line", placeholder: tr("Begriff, z. B. OTIF", "Term, e.g. OTIF"), "aria-label": tr("Begriff", "Term") });
      const def = h("input", { class: "kt-in-line", placeholder: tr("Was er bedeutet", "What it means"), "aria-label": tr("Erklärung", "Explanation") });
      const syn = h("input", { class: "kt-in-line", placeholder: tr("Andere Namen, mit Komma", "Other names, with commas"), "aria-label": tr("Synonyme", "Synonyms") });
      const kpi = h("select", { class: "kt-in-line", "aria-label": tr("Kennzahl", "Key figure") }, h("option", { value: "" }, tr("zu keiner Kennzahl", "to no key figure")), ...at.data.entries.map((e) => h("option", { value: e.id }, e.name)));
      out.push(h("div", { class: "kt-edit is-new" }, h("p", { class: "kt-eye", text: tr("Begriff ergänzen", "Add a term") }), term, def, syn, kpi, h("div", { class: "kt-acts" },
        h("button", { type: "button", class: "kt-btn primary", onclick: () => {
          if (!term.value.trim() || !def.value.trim()) { msg = tr("Ein Begriff braucht den Begriff und seine Erklärung.", "A term needs the term and its explanation."); draw(); return; }
          void save([...own, { term: term.value.trim(), definition: def.value.trim(), synonyms: syn.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean), kpi: kpi.value, origin: "lumantic" }]);
        } }, tr("Hinzufügen", "Add")))));
    }
    if (msg) out.push(h("p", { class: "kt-msg", role: "status", text: msg }));
    return out;
  }

  // ───────────── Tables ─────────────
  function tablesOf(at: Loaded): Node[] {
    const tables = at.data.tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)));
    const exp = (fmt: string) => `/api/katalog/export?${at.kosmos && at.kosmos !== MAIN ? `k=${encodeURIComponent(at.kosmos)}&` : ""}format=${fmt}`;
    return [backBtn(), h("p", { class: "kt-eye", text: tr(`Quelle · ${at.name}`, `Source · ${at.name}`) }), h("h2", { class: "kt-title", text: tr("Die Tabellen darunter", "The tables beneath") }),
      h("p", { class: "kt-def is-quiet" }, mark("quelle"), at.data.company ? tr(`Die Bedeutung liest Lumantic aus ${at.data.company}; die Struktur aus der Datenbank selbst.`, `Lumantic reads the meaning from ${at.data.company}; the structure from the database itself.`) : tr("Die Struktur liest Lumantic aus der Datenbank. Einen Fachkatalog gibt es hier nicht; was ein Stern bedeutet, steht in Lumantic.", "Lumantic reads the structure from the database. There is no company catalogue here; what a star means is kept in Lumantic.")),
      ...tables.map((t) => h("details", { class: "kt-table" }, h("summary", {}, h("code", { text: t.name }), h("span", { class: "kt-bn", text: tr(` · ${t.columns.length} Spalten`, ` · ${t.columns.length} columns`) }), t.desc ? h("span", { class: "kt-tdesc", text: t.desc }) : null),
        h("ul", {}, ...t.columns.map((c) => h("li", {}, h("code", { text: c.name }), h("span", { class: "kt-role", text: [ROLE[c.role] || "", c.type].filter(Boolean).join(" · ") }),
          c.desc ? h("span", { class: "kt-tdesc", text: c.desc }) : null, c.values?.length ? h("span", { class: "kt-vals", text: c.values.slice(0, 6).join(", ") + (c.values.length > 6 ? " …" : "") }) : null))))),
      h("div", { class: "kt-acts" }, h("a", { class: "kt-btn", href: exp("sql"), download: "" }, tr("Als SQL für den Goldlayer", "As SQL for the gold layer")), h("a", { class: "kt-btn quiet", href: exp("json"), download: "" }, tr("Als Datei", "As a file"))),
      h("p", { class: "kt-quiet", text: tr("Das SQL legt die drei Views des Fachkatalogs an. Läuft es im Goldlayer, liest Lumantic den Katalog von dort.", "The SQL creates the three views of the company catalogue. Once it runs in the gold layer, Lumantic reads the catalogue from there.") })];
  }

  return { open, close: hide, isOpen: () => !el.hidden };
}
