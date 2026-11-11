// The Sternkatalog: every key figure of a Kosmos as an entry in a star catalogue — what it means, where it is read,
// who answers for it, its targets over time — beside the words of the business and the tables underneath. Each field
// says where it comes from: the company catalog in the source (a filled dot), an addition in Lumantic (a ring) or a
// guess from a column name (a dashed ring). What the company catalog says is shown, never changed here; what it leaves
// open can be added in place. In a Kosmos it shows that Kosmos; from the main menu every Kosmos, with one search.
import { api, ApiError, MAIN, type Katalog, type KatalogBound, type KatalogEntry, type KatalogTerm } from "./api";
import { $, h } from "./dom";

export interface CatalogHost {
  kosmos(): string; // the Kosmos the page shows; "" in the main menu
  kosmen(): { id: string; name: string }[];
  show(kosmos: string, kpi: string): void; // fly to the figure in the room, or go into its Kosmos
  still(): boolean;
}

const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const NUM = ["Kein", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
const FROM: Record<string, string> = { quelle: "aus dem Fachkatalog", lumantic: "in Lumantic ergänzt", vermutet: "vermutet, aus Typ und Spaltenname" };
const UNIT: Record<string, string> = { "%": "Prozent", Mio: "Mio. CHF", Mrd: "Mrd. CHF", Tsd: "Tsd. CHF", Stk: "Stück", Tage: "Tage", h: "Stunden", Zahl: "Zahl" };
const UNIT_SHORT: Record<string, string> = { "%": "%", Mio: "Mio. CHF", Mrd: "Mrd. CHF", Tsd: "Tsd. CHF", Stk: "Stk.", Tage: "Tage", h: "h", Zahl: "" };
// How a flow's annual target spreads over the year, and what time a target covers.
const PHASING: Record<string, string> = { monate: "gleich auf die Monate, im Monat auf die Arbeitstage", arbeitstage: "nach den Arbeitstagen des Jahres", kalendertage: "nach den Kalendertagen", profil: "nach einem eigenen Profil" };
const CHOICES: Record<string, [string, string][]> = {
  phasing: [["monate", "Gleich auf die Monate, im Monat auf die Arbeitstage (Standard)"], ["arbeitstage", "Nach den Arbeitstagen des Jahres"], ["kalendertage", "Nach den Kalendertagen"]],
  targetPer: [["monat", "Pro Monat"], ["jahr", "Pro Jahr, als Budget"]],
};
const PER: Record<string, string> = { monat: "pro Monat", jahr: "pro Jahr" };
const KIND: Record<string, string> = { stock: "Bestand am Stichtag", flow: "Summe im Monat", avg: "Durchschnitt der Monate", ratio: "Verhältnis aus Zähler und Nenner" };
const DIR: Record<string, string> = { "1": "höher ist besser", "-1": "tiefer ist besser", "0": "neutral" };
const ROLE: Record<string, string> = { time: "Zeit", dimension: "Dimension", measure: "Messwert" };
// The fields whose origin a row shows as its trace, in this order.
const TRACE = ["desc", "unit", "kind", "dir", "target", "owner"];

const month = (ym: string) => { const [y, m] = (ym || "").split("-").map(Number); return y && m ? `${MON[m - 1]} ${y}` : ""; };
const num = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’") : String(v));
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Der Server antwortet nicht.");
const mark = (from: string | undefined) => h("i", { class: "kt-o", "data-from": from || "lumantic", title: FROM[from || "lumantic"], "aria-label": FROM[from || "lumantic"] });

interface Loaded { kosmos: string; name: string; data: Katalog }
// One row of the list: an entry with the Kosmos it belongs to and its catalogue number.
interface Row { at: Loaded; e: KatalogEntry; no: string }
type Pick = { kind: "entry"; row: Row } | { kind: "terms"; at: Loaded } | { kind: "tables"; at: Loaded } | null;

export function createCatalog(host: CatalogHost) {
  const el = $("katalog");
  let loaded: Loaded[] = [], pick: Pick = null, query = "", editing = "", msg = "", busy = false, back: HTMLElement | null = null, narrowDetail = false;
  const search = h("input", { type: "search", class: "kt-search", placeholder: "Kennzahl, Begriff oder Spalte suchen", "aria-label": "Im Sternkatalog suchen", autocomplete: "off" });
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
  const list = h("nav", { class: "kt-list", "aria-label": "Sterne" });
  const detail = h("article", { class: "kt-entry", "aria-live": "polite" });
  const title = h("h1", { class: "kt-hl" });
  const eyebrow = h("p", { class: "kt-eye" });
  const close = h("button", { type: "button", class: "kt-x", "aria-label": "Sternkatalog schliessen", title: "Schliessen (Esc)", onclick: () => hide() }, "×");
  const legend = h("p", { class: "kt-legend" }, ...["quelle", "lumantic", "vermutet"].map((f) => h("span", {}, mark(f), FROM[f].replace(", aus Typ und Spaltenname", ""))));
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
    eyebrow.textContent = here ? `Sternkatalog · ${want[0].name}` : "Sternkatalog · alle Kosmen";
    title.textContent = "Der Katalog wird gelesen …";
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
  const termHits = (t: KatalogTerm) => !query || [t.term, t.definition, ...(t.synonyms || [])].some((x) => x.toLowerCase().includes(query));
  function draw() {
    const rows = allRows(), shown = rows.filter(hits);
    const n = rows.length, topics = new Set(rows.map((r) => r.at.kosmos + "|" + r.e.topic)).size;
    title.textContent = !loaded.length ? (msg || "Kein Katalog zu lesen.") : n === 0 ? "Noch keine Sterne." : `${NUM[n] || n} ${n === 1 ? "Stern" : "Sterne"}, ${NUM[topics]?.toLowerCase() || topics} ${topics === 1 ? "Thema" : "Themen"}.`;
    const kids: Node[] = [];
    for (const at of loaded) {
      const mine = shown.filter((r) => r.at === at);
      if (loaded.length > 1) kids.push(h("p", { class: "kt-kosmos", text: at.name }));
      if (at.data.problems.length) kids.push(h("details", { class: "kt-problems" }, h("summary", { text: `${at.data.problems.length === 1 ? "Ein Eintrag" : `${at.data.problems.length} Einträge`} des Fachkatalogs lassen sich nicht lesen` }),
        h("ul", {}, ...at.data.problems.map((p) => h("li", { text: p })))));
      let topic = "";
      for (const r of mine) {
        if (r.e.topic !== topic) { topic = r.e.topic; kids.push(h("p", { class: "kt-topic", text: topic || "Ohne Thema" })); }
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
          h("span", { class: "kt-no", text: "Wörter" }), h("span", { class: "kt-name", text: `Begriffe · ${terms.length}` })),
        h("button", { type: "button", class: "kt-row is-plain", "aria-current": String(pick?.kind === "tables" && pick.at === at), onclick: () => { pick = { kind: "tables", at }; editing = ""; narrowDetail = true; draw(); } },
          h("span", { class: "kt-no", text: "Quelle" }), h("span", { class: "kt-name", text: `Tabellen · ${tables.length}` }))));
    }
    if (loaded.length && !shown.length && query) kids.push(h("p", { class: "kt-none", text: `Zu «${search.value.trim()}» gibt es keinen Stern.` }));
    list.replaceChildren(...kids);
    el.classList.toggle("is-detail", narrowDetail && !!pick);
    const parts = pick?.kind === "entry" ? entry(pick.row) : pick?.kind === "terms" ? termsOf(pick.at) : pick?.kind === "tables" ? tablesOf(pick.at) : [h("p", { class: "kt-quiet", text: "Wähle einen Stern." })];
    detail.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  // ───────────── One entry ─────────────
  const backBtn = () => h("button", { type: "button", class: "kt-back", onclick: () => { narrowDetail = false; draw(); } }, "← Alle Sterne");
  function entry(r: Row): (Node | null)[] {
    const e = r.e, f = e.fields, can = r.at.data.editable, unit = String(f.unit?.value || "");
    const value = (v: number) => `${num(v)} ${UNIT_SHORT[unit] ?? ""}`.trim();
    const facts: Node[] = [];
    // One line of the fact sheet: label, origin, value, and a way to add what is open.
    const fact = (label: string, key: string, show: Node | string, editKey = "") => {
      const fl = f[key], from = fl?.from, open = !fl || fl.value === "" || fl.value === null;
      const mayEdit = can && editKey && from !== "quelle";
      if (editing === r.at.kosmos + "|" + e.id + "|" + editKey) { facts.push(h("dt", {}, label), h("dd", { class: "is-edit" }, editor(r, editKey, fl?.value))); return; }
      facts.push(h("dt", {}, label), h("dd", {}, open ? null : mark(from), h("span", { class: open ? "kt-open" : "" }, open ? "offen" : show),
        mayEdit ? h("button", { type: "button", class: "kt-add", onclick: () => { editing = r.at.kosmos + "|" + e.id + "|" + editKey; draw(); } }, open ? "Ergänzen" : "Ändern")
          : from === "quelle" && editKey ? h("span", { class: "kt-lock", title: "Nur im Fachkatalog zu ändern" }, "Fachkatalog") : null));
    };
    fact("Berechnung", "formula", String(f.formula?.value || ""), "formula");
    facts.push(h("dt", {}, "Quelle"), h("dd", {}, mark(f.source?.from), h("code", { text: String(f.source?.value || "") })));
    if (e.first) facts.push(h("dt", {}, "Daten"), h("dd", {}, `${month(e.first)} bis ${month(e.last)}`));
    fact("Einheit", "unit", UNIT[unit] || unit);
    fact("Art", "kind", KIND[String(f.kind?.value)] || String(f.kind?.value || ""));
    if (f.raster) fact("Raster", "raster", f.raster.value === "tag" ? "täglich erhoben, darum auch in Wochen und Tagen" : "monatlich erhoben");
    fact("Richtung", "dir", DIR[String(f.dir?.value)] || "");
    const bounds = (kind: "ziel" | "grenze") => e.bounds.filter((b) => b.kind === kind);
    // A flow's budget covers a year unless it says otherwise; its limit a month.
    const flow = f.kind?.value === "flow", perOf = (b: KatalogBound) => (flow ? " " + PER[b.per || (b.kind === "ziel" ? "jahr" : "monat")] : "");
    const boundList = (kind: "ziel" | "grenze") => h("ul", { class: "kt-bounds" }, ...bounds(kind).map((b) => h("li", {}, mark(b.origin),
      h("strong", { text: value(b.value) + perOf(b) }), " ", b.from && b.until ? `${month(b.from)} bis ${month(b.until)}` : b.from ? `ab ${month(b.from)}` : b.until ? `bis ${month(b.until)}` : "immer",
      b.name ? h("span", { class: "kt-bn", text: " · " + b.name }) : null)));
    if (bounds("ziel").length) facts.push(h("dt", {}, "Ziel"), h("dd", {}, boundList("ziel")));
    else fact("Ziel", "target", f.target ? value(Number(f.target.value)) + (f.targetPer ? " " + PER[String(f.targetPer.value)] : "") : "", "target");
    if (f.targetPer && !bounds("ziel").length) fact("Ziel gilt", "targetPer", PER[String(f.targetPer.value)] || "", "targetPer");
    if (f.phasing && (f.target || bounds("ziel").length)) fact("Verteilung", "phasing", PHASING[String(f.phasing.value)] || String(f.phasing.value), "phasing");
    if (bounds("grenze").length) facts.push(h("dt", {}, "Grenze"), h("dd", {}, boundList("grenze")));
    else fact("Grenze", "limit", f.limit ? value(Number(f.limit.value)) : "", "limit");
    fact("Eigner", "owner", String(f.owner?.value || ""), "owner");
    if (f.parts) facts.push(h("dt", {}, "Teile"), h("dd", {}, mark(f.parts.from), String(f.parts.value).includes(",") ? String(f.parts.value) : `nach ${f.parts.value}`));

    const desc = f.desc, descOpen = !desc || !desc.value;
    const words = r.at.data.terms.filter((t) => t.kpi === e.id);
    return [
      backBtn(),
      h("p", { class: "kt-eye" }, `Stern ${r.no} · ${e.topic || "Ohne Thema"}${loaded.length > 1 ? " · " + r.at.name : ""}`),
      h("h2", { class: "kt-title", tabindex: "-1", text: e.name }),
      editing === r.at.kosmos + "|" + e.id + "|desc" ? editor(r, "desc", desc?.value)
        : h("p", { class: "kt-def" + (descOpen ? " is-open" : "") }, descOpen ? null : mark(desc.from), descOpen ? "Noch ohne Definition." : String(desc.value),
          can && desc?.from !== "quelle" ? h("button", { type: "button", class: "kt-add", onclick: () => { editing = r.at.kosmos + "|" + e.id + "|desc"; draw(); } }, descOpen ? "Definition ergänzen" : "Ändern") : null),
      e.status ? h("p", { class: "kt-missing", text: `Im Goldlayer fehlt: ${e.status}. Lumantic zeigt den Stern erst, wenn er sich lesen lässt.` }) : null,
      words.length ? h("p", { class: "kt-syn" }, "Auch genannt: ", ...words.flatMap((t) => [t.term, ...(t.synonyms || [])]).map((w, i) => [i ? ", " : "", h("em", { text: w })]).flat()) : null,
      h("dl", { class: "kt-facts" }, ...facts),
      msg ? h("p", { class: "kt-msg", role: "status", text: msg }) : null,
      h("div", { class: "kt-acts" }, h("button", { type: "button", class: "kt-btn", onclick: () => { hide(); host.show(r.at.kosmos, e.id); } }, host.kosmos() ? "Im Raum zeigen" : `In «${r.at.name}» zeigen`)),
    ];
  }

  // An editor for one field: text for words, a number for target and limit, a choice for how a target spreads. Empty clears.
  function editor(r: Row, key: string, cur: unknown): HTMLElement {
    const long = key === "desc" || key === "formula", numeric = key === "target" || key === "limit", opts = CHOICES[key];
    const inp = opts ? h("select", { class: "kt-in-line", "aria-label": key === "phasing" ? "Verteilung" : "Ziel gilt" }, ...opts.map(([v, label]) => h("option", { value: v }, label)))
      : long ? h("textarea", { class: "kt-in-text", rows: "3" }) : h("input", { class: "kt-in-line", inputmode: numeric ? "decimal" : "text" });
    inp.value = cur === null || cur === undefined ? "" : String(cur);
    const save = async () => {
      if (busy) return;
      let v: string | number | null = inp.value.trim();
      if (numeric) {
        const n = v === "" ? null : Number(String(v).replace(/[’'\s]/g, "").replace(",", "."));
        if (n !== null && !Number.isFinite(n)) { msg = "Bitte eine Zahl, zum Beispiel 42.5."; draw(); return; }
        v = n;
      }
      busy = true;
      try {
        r.at.data = await api.saveKatalogEntry(r.at.kosmos, r.e.id, { [key]: v });
        const fresh = r.at.data.entries.find((x) => x.id === r.e.id);
        if (fresh && pick?.kind === "entry") pick = { kind: "entry", row: { ...r, e: fresh } };
        editing = ""; msg = "Gespeichert. Der Raum zeigt es beim nächsten Öffnen.";
      } catch (e) { msg = errText(e); }
      busy = false;
      draw();
    };
    inp.addEventListener("keydown", (ev) => { const e = ev as KeyboardEvent; if (e.key === "Enter" && (!long || e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } });
    queueMicrotask(() => inp.focus());
    return h("div", { class: "kt-edit" }, inp, h("div", { class: "kt-acts" },
      h("button", { type: "button", class: "kt-btn primary", onclick: () => void save() }, "Speichern"),
      h("button", { type: "button", class: "kt-btn quiet", onclick: () => { editing = ""; draw(); } }, "Abbrechen")));
  }

  // ───────────── Words ─────────────
  function termsOf(at: Loaded): Node[] {
    const terms = at.data.terms.filter(termHits), own = at.data.terms.filter((t) => t.origin !== "quelle");
    const name = (id: string) => at.data.entries.find((e) => e.id === id)?.name;
    const save = async (next: KatalogTerm[]) => {
      try { at.data = await api.saveKatalogTerms(at.kosmos, next); msg = "Gespeichert."; } catch (e) { msg = errText(e); }
      draw();
    };
    const out: Node[] = [backBtn(), h("p", { class: "kt-eye", text: `Begriffe · ${at.name}` }), h("h2", { class: "kt-title", text: "Die Wörter des Hauses" }),
      h("p", { class: "kt-def is-quiet", text: "Damit alle und Lumina dasselbe meinen: «Termintreue» findet die Liefertreue, wenn es so dasteht." })];
    out.push(h("dl", { class: "kt-terms" }, ...terms.flatMap((t) => [
      h("dt", {}, mark(t.origin), t.term, t.kpi && name(t.kpi) ? h("span", { class: "kt-bn", text: " → " + name(t.kpi) }) : null,
        at.data.editable && t.origin !== "quelle" ? h("button", { type: "button", class: "kt-add", title: `«${t.term}» entfernen`, onclick: () => void save(own.filter((x) => x !== t)) }, "Entfernen") : null),
      h("dd", {}, t.definition, t.synonyms?.length ? h("span", { class: "kt-syn" }, " Auch: ", t.synonyms.join(", ")) : null)])));
    if (!terms.length) out.push(h("p", { class: "kt-quiet", text: query ? "Kein Begriff passt." : "Noch keine Begriffe." }));
    if (at.data.editable) {
      const term = h("input", { class: "kt-in-line", placeholder: "Begriff, z. B. OTIF", "aria-label": "Begriff" });
      const def = h("input", { class: "kt-in-line", placeholder: "Was er bedeutet", "aria-label": "Erklärung" });
      const syn = h("input", { class: "kt-in-line", placeholder: "Andere Namen, mit Komma", "aria-label": "Synonyme" });
      const kpi = h("select", { class: "kt-in-line", "aria-label": "Kennzahl" }, h("option", { value: "" }, "zu keiner Kennzahl"), ...at.data.entries.map((e) => h("option", { value: e.id }, e.name)));
      out.push(h("div", { class: "kt-edit is-new" }, h("p", { class: "kt-eye", text: "Begriff ergänzen" }), term, def, syn, kpi, h("div", { class: "kt-acts" },
        h("button", { type: "button", class: "kt-btn primary", onclick: () => {
          if (!term.value.trim() || !def.value.trim()) { msg = "Ein Begriff braucht den Begriff und seine Erklärung."; draw(); return; }
          void save([...own, { term: term.value.trim(), definition: def.value.trim(), synonyms: syn.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean), kpi: kpi.value, origin: "lumantic" }]);
        } }, "Hinzufügen"))));
    }
    if (msg) out.push(h("p", { class: "kt-msg", role: "status", text: msg }));
    return out;
  }

  // ───────────── Tables ─────────────
  function tablesOf(at: Loaded): Node[] {
    const tables = at.data.tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)));
    const exp = (fmt: string) => `/api/katalog/export?${at.kosmos && at.kosmos !== MAIN ? `k=${encodeURIComponent(at.kosmos)}&` : ""}format=${fmt}`;
    return [backBtn(), h("p", { class: "kt-eye", text: `Quelle · ${at.name}` }), h("h2", { class: "kt-title", text: "Die Tabellen darunter" }),
      h("p", { class: "kt-def is-quiet" }, mark("quelle"), at.data.company ? `Die Bedeutung liest Lumantic aus ${at.data.company}; die Struktur aus der Datenbank selbst.` : "Die Struktur liest Lumantic aus der Datenbank. Einen Fachkatalog gibt es hier nicht; was ein Stern bedeutet, steht in Lumantic."),
      ...tables.map((t) => h("details", { class: "kt-table" }, h("summary", {}, h("code", { text: t.name }), h("span", { class: "kt-bn", text: ` · ${t.columns.length} Spalten` }), t.desc ? h("span", { class: "kt-tdesc", text: t.desc }) : null),
        h("ul", {}, ...t.columns.map((c) => h("li", {}, h("code", { text: c.name }), h("span", { class: "kt-role", text: [ROLE[c.role] || "", c.type].filter(Boolean).join(" · ") }),
          c.desc ? h("span", { class: "kt-tdesc", text: c.desc }) : null, c.values?.length ? h("span", { class: "kt-vals", text: c.values.slice(0, 6).join(", ") + (c.values.length > 6 ? " …" : "") }) : null))))),
      h("div", { class: "kt-acts" }, h("a", { class: "kt-btn", href: exp("sql"), download: "" }, "Als SQL für den Goldlayer"), h("a", { class: "kt-btn quiet", href: exp("json"), download: "" }, "Als Datei")),
      h("p", { class: "kt-quiet", text: "Das SQL legt die drei Views des Fachkatalogs an. Läuft es im Goldlayer, liest Lumantic den Katalog von dort." })];
  }

  return { open, close: hide, isOpen: () => !el.hidden };
}
