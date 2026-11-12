// The settings: a sheet beside the room, in five parts. Darstellung and Start are personal and always work.
// Daten, Lumina and Über come from the server; when it cannot answer, the part says so in one sentence.
// «Daten» is about the Kosmos the page shows: its source and its key figures. In the main menu, where the page is in
// no Kosmos, the same place is «Kosmen»: the list of all, and the form for one more.
// Every change applies at once. New figures or a new source rebuild the room when the sheet closes.
import { isEn, switchLang, tr } from "./i18n";
import type { KosmosRoom } from "virtual:kosmos";
import { api, ApiError, type Catalog, type DataSource, type Grain, type KosmosInfo, type KpiDef, type KpiList, type SecretKey, type SecretState, type Settings, type SourceSecrets, type TestResult } from "./api";
import { $, h } from "./dom";
import { logo } from "./logo";
import { P, flush, setPref, uiOnly, type Prefs } from "./prefs";
import { ACCENT_NAMES, FONTS, allDesigns, designOf, type DesignInfo } from "./themes";

export type Tab = "darstellung" | "start" | "daten" | "lumina" | "ueber";
export type LookChange = "design" | "font" | "accent" | "motion" | "size" | "lens" | "hints";

export interface SettingsHost {
  settings(): Settings | null;
  setSettings(s: Settings): void;
  room(): KosmosRoom | null;
  look(what: LookChange): void;
  reload(): Promise<void>;
  kosmos(): string; // the Kosmos the page shows; "" in the main menu
  kosmen(): KosmosInfo[];
  enter(id: string): void; // go into a Kosmos
  menu(what?: string): void; // go to the main menu; "neu" opens the form for a new Kosmos there
  catalog(kpi?: string): void; // the Sternkatalog, at a figure's entry if one is named
}

// A figure's or topic's name in the language of the interface: the English one where the team wrote it.
const say = (o: { name: string; en?: Record<string, string> }) => (isEn() && o.en?.name) || o.name;
const TABS: [Tab, string][] = [["darstellung", tr("Darstellung", "Look")], ["start", tr("Start", "Start")], ["daten", tr("Daten", "Data")], ["lumina", "Lumina"], ["ueber", tr("Über", "About")]];
const REOPEN = "lumantic.reopen";
const MON = isEn() ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] : ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const TYPES = [
  { v: "duckdb", name: tr("DuckDB-Datei", "DuckDB file"), note: tr("Eine .duckdb-Datei mit dem Goldlayer", "A .duckdb file with the gold layer") },
  { v: "files", name: tr("Ordner mit Parquet- oder CSV-Dateien", "Folder of Parquet or CSV files"), note: tr("Jede Datei wird eine Tabelle", "Every file becomes a table") },
  { v: "snowflake", name: "Snowflake", note: tr("Über die SQL-API, mit Schlüsselpaar oder Token", "Through the SQL API, with a key pair or a token") },
  { v: "databricks", name: "Databricks", note: tr("Ein SQL-Warehouse, Tabellen aus dem Unity Catalog", "A SQL warehouse, tables from the Unity Catalog") },
  { v: "windmill", name: "Windmill", note: tr("Der Goldlayer über zwei Windmill-Skripte", "The gold layer through two Windmill scripts") },
] as const;
const SF_AUTH = [{ v: "keypair", name: tr("Schlüsselpaar", "Key pair"), note: tr("Empfohlen: ein technischer Benutzer mit eigenem Schlüssel", "Recommended: a technical user with a key of its own") }, { v: "token", name: "Token", note: tr("Ein Programmatic Access Token oder ein OAuth-Token", "A programmatic access token or an OAuth token") }] as const;
const DB_AUTH = [{ v: "oauth", name: "Service Principal", note: tr("Empfohlen: OAuth mit Client-ID und Secret", "Recommended: OAuth with client ID and secret") }, { v: "token", name: tr("Persönliches Token", "Personal token"), note: tr("Zum Ausprobieren", "For trying it out") }] as const;
const DIRS = [{ v: 1, name: tr("Höher ist besser", "Higher is better") }, { v: -1, name: tr("Tiefer ist besser", "Lower is better") }, { v: 0, name: "Neutral" }] as const;
const UNITS = [{ v: "%", name: "%" }, { v: "Mio", name: tr("Mio. CHF", "CHF m") }, { v: "Mrd", name: tr("Mrd. CHF", "CHF bn") }, { v: "Tsd", name: tr("Tsd. CHF", "CHF k") },
  { v: "Stk", name: tr("Stück", "Pieces") }, { v: "Tage", name: tr("Tage", "Days") }, { v: "h", name: tr("Stunden", "Hours") }, { v: "Zahl", name: tr("Zahl", "Number") }] as const;
const KINDS = [{ v: "stock", name: tr("Bestand am Monatsende", "Balance at the end of the month") }, { v: "flow", name: tr("Summe im Monat", "Sum over the month") }, { v: "avg", name: tr("Durchschnitt der Monate", "Average of the months") }] as const;

const monthLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return y && m ? `${MON[m - 1]} ${y}` : ym; };
const thousands = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, tr("’", ","));
function ago(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return min === 1 ? tr("vor einer Minute", "a minute ago") : tr(`vor ${min} Minuten`, `${min} minutes ago`);
  const hrs = Math.round(min / 60);
  if (hrs < 24) return hrs === 1 ? tr("vor einer Stunde", "an hour ago") : tr(`vor ${hrs} Stunden`, `${hrs} hours ago`);
  const d = new Date(t);
  return tr(`am ${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`, `on ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`);
}
const errText = (e: unknown) => (e instanceof ApiError ? e.message : tr("Der Server antwortet nicht.", "The server does not answer."));
// Without a login everyone may change everything; an older server says nothing about it either.
const admin = (s: Settings | null) => s?.me?.admin !== false;
// «1’250,5», «1 250.5» or «1,250.5» → 1250.5 · empty → null · anything else → NaN
function parseNum(s: string): number | null {
  const u = s.replace(/[’'\s]/g, ""), t = u.includes(",") && u.includes(".") ? u.replace(/,/g, "") : u.replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
const showNum = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
// Amounts are kept in Mio. CHF, also for figures shown in Mrd.
const unitOf = (u: string) => ({ "%": tr("in %", "in %"), Tsd: tr("in Tsd. CHF", "in CHF thousands"), Stk: tr("in Stück", "in pieces"), Tage: tr("in Tagen", "in days"), h: tr("in Stunden", "in hours"), Zahl: tr("als Zahl", "as a number") } as Record<string, string>)[u] || tr("in Mio. CHF", "in CHF millions");

// ───────────── Controls ─────────────
let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

// Arrow keys move the choice inside a group of radio buttons.
function radioKeys(group: HTMLElement) {
  group.addEventListener("keydown", (e) => {
    const items = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (i < 0 || !d) return;
    e.preventDefault();
    const next = items[(i + d + items.length) % items.length];
    next.focus();
    next.click();
  });
}

interface Opt<T> { v: T; name: string; note?: string; face?: string; swatch?: string }
function choice<T extends string | number>(label: string, options: readonly Opt<T>[], current: T, pick: (v: T) => void, opt: { stacked?: boolean; disabled?: boolean } = {}) {
  const group = h("div", { class: "s-choice" + (opt.stacked ? " is-stacked" : ""), role: "radiogroup", "aria-label": label });
  const buttons = options.map((o) => h("button", { type: "button", role: "radio", disabled: opt.disabled, onclick: () => { if (o.v === current) return; current = o.v; sync(); pick(o.v); } },
    o.swatch ? h("i", { class: "s-dot", style: `background:${o.swatch}`, "aria-hidden": "true" }) : null,
    h("span", { class: "s-cn", text: o.name, style: o.face ? `font-family:${o.face}` : null }),
    o.note ? h("span", { class: "s-cnote", text: o.note }) : null));
  const sync = () => {
    const at = Math.max(0, options.findIndex((o) => o.v === current));
    buttons.forEach((b, i) => { b.setAttribute("aria-checked", String(options[i].v === current)); b.tabIndex = i === at ? 0 : -1; });
  };
  sync();
  group.append(...buttons);
  radioKeys(group);
  return group;
}

function toggle(label: string, on: boolean, change: (v: boolean) => void, disabled = false) {
  const id = nextId("sw");
  const b = h("button", { type: "button", class: "s-switch", role: "switch", "aria-checked": String(on), "aria-labelledby": id, disabled,
    onclick: () => { on = !on; b.setAttribute("aria-checked", String(on)); change(on); } }, h("span", { class: "s-knob", "aria-hidden": "true" }));
  return h("div", { class: "s-row" }, h("span", { class: "s-label", id, text: label }), b);
}

interface Field { wrap: HTMLElement; err(msg: string): void }
function field(label: string, control: HTMLElement, note?: string): Field {
  const id = nextId("f");
  control.id = id;
  const err = h("p", { class: "s-err", role: "alert", hidden: true });
  const wrap = h("div", { class: "s-field" }, h("label", { for: id, text: label }), control, note ? h("p", { class: "s-note", text: note }) : null, err);
  return { wrap, err: (msg) => { err.textContent = msg; err.hidden = !msg; control.setAttribute("aria-invalid", String(!!msg)); } };
}
const textInput = (value: string, attrs: Record<string, string | boolean> = {}) =>
  h("input", { class: "s-in", type: "text", value, spellcheck: "false", autocomplete: "off", ...attrs });
function select(options: [string, string][], value: string) {
  const s = h("select", { class: "s-in" }, ...options.map(([v, name]) => h("option", { value: v, text: name })));
  s.value = value;
  return s;
}

interface Msg { el: HTMLElement; set(text: string, tone?: "" | "ok" | "bad"): void }
function msgLine(): Msg {
  const el = h("p", { class: "s-msg", role: "status" });
  return { el, set: (text, tone = "") => { el.textContent = text; el.dataset.tone = tone; } };
}
// A button that shows it is working and cannot be pressed twice meanwhile.
function btn(label: string, run: () => Promise<unknown> | void, kind = "") {
  const b = h("button", { type: "button", class: "s-btn" + (kind ? " " + kind : "") }, label);
  b.addEventListener("click", async () => {
    if (b.getAttribute("aria-busy") === "true") return;
    b.setAttribute("aria-busy", "true");
    try { await run(); } finally { b.removeAttribute("aria-busy"); }
  });
  return b;
}
const note = (text: string) => h("p", { class: "s-note", text });
const group = (title: string, ...kids: (Node | null)[]) => h("section", { class: "s-group" }, h("h3", { text: title }), ...kids);
const actions = (...kids: (Node | null)[]) => h("div", { class: "s-actions" }, ...kids);

// ───────────── The sheet ─────────────
export function createSettings(host: SettingsHost) {
  const el = $("settings");
  let tab: Tab = "darstellung", back: HTMLElement | null = null, dataChanged = false;
  // Daten: the source being edited and the last connection test of each form
  let draft: DataSource | null = null;
  const tests = new Map<string, TestResult>();
  // Kosmen: the form for a new one, with the tokens typed into it
  let adding = false, fresh: DataSource | null = null, freshSecrets: SourceSecrets = {};
  let kpis: KpiList | null = null, kpisErr = "", kpisLoading = false, catalog: Catalog | null = null, editing = "";
  let confirmReset = false;
  // A message line that keeps its last words for a few seconds, also when the part is drawn again meanwhile
  // (saving a source reloads the figures list, which draws the part a second time).
  const flashes = new Map<string, [string, "" | "ok" | "bad", number]>();
  const flashed = (key: string): Msg => {
    const m = msgLine(), f = flashes.get(key), show = m.set;
    if (f && f[2] > Date.now()) show(f[0], f[1]);
    m.set = (text, tone = "") => { flashes.set(key, [text, tone, Date.now() + 8000]); show(text, tone); };
    return m;
  };
  const flash = (key: string, text: string, tone: "" | "ok" | "bad") => flashes.set(key, [text, tone, Date.now() + 8000]);

  const tabs = TABS.map(([id, name]) => h("button", { type: "button", role: "tab", id: "st-" + id, "aria-controls": "set-body", onclick: () => show(id) }, name));
  const tablist = h("nav", { class: "s-tabs", role: "tablist", "aria-label": tr("Bereiche", "Sections") }, ...tabs);
  tablist.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement), d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (i < 0 || !d) return;
    e.preventDefault();
    const j = (i + d + tabs.length) % tabs.length;
    tabs[j].focus();
    show(TABS[j][0]);
  });
  const body = h("div", { class: "s-body", id: "set-body", role: "tabpanel", tabindex: "-1" });
  el.append(h("header", { class: "s-head" }, h("h2", { id: "set-title", text: tr("Einstellungen", "Settings") }),
    h("button", { type: "button", class: "s-x", "aria-label": tr("Einstellungen schliessen", "Close the settings"), title: tr("Schliessen (Esc)", "Close (Esc)"), onclick: () => close() }, "×")), tablist, body);

  function show(t: Tab) {
    if (t !== tab) { confirmReset = false; editing = ""; adding = false; }
    tab = t;
    tabs.forEach((b, i) => { const on = TABS[i][0] === t; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (TABS[i][0] === "daten") b.textContent = host.kosmos() ? tr("Daten", "Data") : "Kosmen"; });
    body.setAttribute("aria-labelledby", "st-" + t);
    render();
    body.scrollTop = 0;
  }
  function render() {
    const s = host.settings();
    const parts = tab === "darstellung" ? look(s) : tab === "start" ? start() : tab === "ueber" ? about(s) : !s ? [offline()] : tab === "daten" ? (host.kosmos() ? data(s) : kosmenPart(s)) : lumina(s);
    body.replaceChildren(...parts);
  }
  const offline = () => note(tr("Die Einstellungen des Servers sind gerade nicht erreichbar. Darstellung und Start funktionieren trotzdem.", "The server's settings cannot be reached right now. Look and Start still work."));
  // The gear says whether the sheet is open, and the page makes room for it (the room by itself, the main menu by this class).
  const syncGear = () => {
    document.querySelectorAll("[data-settings]").forEach((b) => b.setAttribute("aria-expanded", String(!el.hidden)));
    document.documentElement.classList.toggle("sheet-open", !el.hidden);
  };

  // want opens a form at once: «kennzahl» the one for a new key figure, «kosmos» the one for a new Kosmos.
  function open(at?: Tab, want: "" | "kennzahl" | "kosmos" = "") {
    const wasOpen = !el.hidden;
    if (!wasOpen) back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.hidden = false;
    show(at || tab);
    syncGear();
    host.room()?.setSheet(el.offsetWidth + 12);
    tabs[TABS.findIndex(([id]) => id === tab)].focus({ preventScroll: true });
    if (want === "kennzahl" && host.kosmos()) editing = "new";
    if (want === "kosmos" && !host.kosmos()) adding = true;
    if (want) { render(); body.querySelector(".is-new")?.scrollIntoView({ block: "nearest" }); }
  }
  function close(): boolean {
    if (el.hidden) return false;
    el.hidden = true;
    // A new token is shown once: the sheet forgets it as it closes.
    if (freshToken) { freshToken = ""; render(); }
    syncGear();
    host.room()?.setSheet(0);
    if (dataChanged) { void host.reload(); return true; }
    if (back && back.isConnected) back.focus({ preventScroll: true });
    back = null;
    return true;
  }
  // With no room yet, a working source is shown at once; the sheet opens again where it was.
  function reloadNow(at: Tab) {
    try { sessionStorage.setItem(REOPEN, at); } catch { /* the sheet just stays closed */ }
    void host.reload();
  }
  function reopenAfterReload() {
    let at: string | null = null;
    try { at = sessionStorage.getItem(REOPEN); sessionStorage.removeItem(REOPEN); } catch { /* nothing to reopen */ }
    if (at && TABS.some(([id]) => id === at)) { if (at === "daten") flash("src", tr("Verbunden. Die Seiten zeigen jetzt die Zahlen dieser Quelle.", "Connected. The pages now show the figures of this source."), "ok"); open(at as Tab); }
  }

  // ───────────── Darstellung ─────────────
  function pickDesign(id: string) {
    setPref("design", id);
    setPref("accent", "");
    host.look("design");
    render();
  }
  function designCard(d: DesignInfo) {
    const sw = d.swatch;
    const prev = h("span", { class: "s-prev", style: `background:${sw.bg}`, "aria-hidden": "true" },
      h("span", { class: "s-prev-page" + (sw.sheet ? " has-sheet" : ""), style: sw.sheet ? `background:${sw.sheet}` : null },
        h("span", { class: "s-prev-l", style: `background:${sw.ink}` }), h("span", { class: "s-prev-l short", style: `background:${sw.ink}` }),
        h("span", { class: "s-prev-dots" }, ...[sw.accent, sw.alert, sw.watch, sw.good].map((c) => h("i", { style: `background:${c}` })))));
    return h("button", { type: "button", class: "s-dcard", role: "radio", "aria-checked": String(P.design === d.id), tabindex: P.design === d.id ? 0 : -1, "data-id": d.id, onclick: () => pickDesign(d.id) },
      prev, h("span", { class: "s-dn", text: d.name }), h("span", { class: "s-dnote", text: d.note }));
  }
  function look(s: Settings | null): Node[] {
    const d = designOf(P.design);
    const designs = h("div", { class: "s-designs", role: "radiogroup", "aria-label": "Design" }, ...allDesigns().map(designCard));
    if (!designs.querySelector('[tabindex="0"]')) designs.firstElementChild?.setAttribute("tabindex", "0");
    radioKeys(designs);
    const own = d.serif ? "var(--f-design-text)" : "var(--f-design-ui)";
    const fonts = choice(tr("Schrift", "Font"), FONTS.map((f) => ({ v: f.id, name: f.name, face: f.family || own })), P.font, (v) => { setPref("font", v); host.look("font"); }, { stacked: true });
    const def = d.accents[0], current = P.accent && P.accent.toLowerCase() !== def.toLowerCase() ? P.accent.toLowerCase() : "";
    const accents = choice(tr("Akzent", "Accent"), d.accents.map((hex, i) => ({ v: i === 0 ? "" : hex.toLowerCase(), name: (ACCENT_NAMES[hex] || hex) + (i === 0 ? tr(" (wie im Design)", " (as in the design)") : ""), swatch: hex })),
      current, (v) => { setPref("accent", v); host.look("accent"); }, { stacked: true });
    const motion = choice(tr("Bewegung", "Motion"), [{ v: "voll", name: tr("Voll", "Full") }, { v: "ruhig", name: tr("Ruhig", "Calm") }], P.motion, (v) => { setPref("motion", v as Prefs["motion"]); host.look("motion"); });
    const size = choice(tr("Textgrösse", "Text size"), [{ v: "normal", name: "Normal" }, { v: "gross", name: tr("Gross", "Large") }], P.textSize, (v) => { setPref("textSize", v as Prefs["textSize"]); host.look("size"); });
    const systemStill = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The language: a change keeps the choice and opens the page again in it, with the sheet where it was.
    const lang = choice(tr("Sprache", "Language"), [{ v: "", name: tr("Wie der Browser", "As the browser") }, { v: "de", name: "Deutsch" }, { v: "en", name: "English" }], P.language, (v) => {
      setPref("language", v as Prefs["language"]);
      try { sessionStorage.setItem(REOPEN, "darstellung"); } catch { /* the sheet just stays closed */ }
      void flush().then(() => switchLang(v));
    });
    const out: Node[] = [
      group(tr("Sprache", "Language"), lang),
      group("Design", designs, s && !s.brand.designs.length ? note(tr("Ein Firmen-Design mit Hausfarben und Hausschrift trägst du in der Konfiguration unter «brand» ein. Es erscheint dann hier.", "A corporate design with house colours and house font goes into the configuration under «brand». It then appears here.")) : null),
      group(tr("Schrift", "Font"), fonts),
      group(tr("Akzent", "Accent"), accents, d.corporate ? note(tr("Das Firmen-Design bringt seinen Akzent mit.", "The corporate design brings its own accent.")) : null),
      group(tr("Bewegung", "Motion"), motion, note(systemStill ? tr("Dein System wünscht wenig Bewegung. Lumantic hält sich daran.", "Your system asks for little motion. Lumantic keeps to that.") : tr("Ruhig zeigt jede Änderung sofort, ohne Flüge und Übergänge.", "Calm shows every change at once, without flights or transitions."))),
      group(tr("Textgrösse", "Text size"), size),
    ];
    if (s && admin(s)) {
      const m = msgLine();
      out.push(h("div", { class: "s-foot" }, note(tr("Was du hier wählst, gilt für dich. «Für alle speichern» macht es zum Standard für alle, die Lumantic neu öffnen.", "What you choose here holds for you. «Save for everyone» makes it the default for everyone who opens Lumantic afresh.")),
        btn(tr("Für alle speichern", "Save for everyone"), async () => {
          try { host.setSettings(await api.saveSettings({ ui: uiOnly() })); m.set(tr("Gespeichert. Das ist jetzt der Standard für alle.", "Saved. This is now the default for everyone."), "ok"); } catch (e) { m.set(errText(e), "bad"); }
        }, "quiet"), m.el));
    }
    return out;
  }

  // ───────────── Start ─────────────
  function start(): Node[] {
    return [
      group(tr("Beim Öffnen", "On opening"), choice(tr("Beim Öffnen", "On opening"), [{ v: "heute", name: tr("Heute", "Today") }, { v: "ueberblick", name: tr("Überblick", "Overview") }, { v: "zuletzt", name: tr("Wo ich war", "Where I was") }], P.start,
        (v) => setPref("start", v as Prefs["start"])), note(tr("Gilt ab dem nächsten Öffnen.", "Holds from the next opening."))),
      group(tr("Zeitlinse zeigt", "The time lens shows"), choice(tr("Zeitlinse zeigt", "The time lens shows"), [{ v: "1M", name: tr("1 Monat zurück", "1 month back") }, { v: "1Q", name: tr("1 Quartal zurück", "1 quarter back") }, { v: "1J", name: tr("1 Jahr zurück", "1 year back") }], P.lens,
        (v) => { setPref("lens", v as Prefs["lens"]); host.look("lens"); }), note(tr("Welchen Monat die Linse zeigt, wenn du sie aufnimmst.", "Which month the lens shows when you pick it up."))),
      group(tr("Hinweise", "Hints"), toggle(tr("Hinweise zu Gesten", "Hints on gestures"), P.hints, (v) => { setPref("hints", v); host.look("hints"); })),
    ];
  }

  // ───────────── Daten ─────────────
  function statusText(s: Settings) {
    const st = s.status;
    // Before the first save the source is only the built-in example; its error would talk about a file nobody chose.
    if (!st.ok && !s.configExists) return tr("Noch keine Datenquelle eingerichtet. Wähle die Art, trag die Verbindung ein und prüf sie.", "No data source set up yet. Pick the kind, enter the connection and test it.");
    if (!st.ok) return st.error || tr("Die Datenquelle antwortet nicht.", "The data source does not answer.");
    const figs = st.kpisLoaded < st.kpis ? tr(`${st.kpisLoaded} von ${st.kpis} Kennzahlen`, `${st.kpisLoaded} of ${st.kpis} key figures`) : tr(`${st.kpis} Kennzahlen`, `${st.kpis} key figures`);
    return [tr(`${st.tables} Tabellen`, `${st.tables} tables`), figs, st.first && st.last ? tr(`${monthLabel(st.first)} bis ${monthLabel(st.last)}`, `${monthLabel(st.first)} to ${monthLabel(st.last)}`) : "", st.refreshedAt ? tr(`Stand ${ago(st.refreshedAt)}`, `as of ${ago(st.refreshedAt)}`) : ""].filter(Boolean).join(" · ");
  }
  // The data object for the server: everything but the token states, which are not settings.
  function payload(d: DataSource) {
    const { token: _w, ...windmill } = d.windmill;
    const { token: _s, ...snowflake } = d.snowflake;
    const { token: _d, secret: _ds, ...databricks } = d.databricks;
    void [_w, _s, _d, _ds];
    return { ...d, windmill, snowflake, databricks };
  }
  // Where a server sentence about a data source belongs.
  function fieldOf(text: string, type: DataSource["type"]): string {
    if (/Namen/i.test(text)) return "name";
    if (type === "snowflake") {
      if (/Schlüssel/i.test(text)) return "snowflake.keyFile";
      if (/Konto/i.test(text)) return "snowflake.account";
      if (/Benutzer/i.test(text)) return "snowflake.user";
      if (/Warehouse/i.test(text)) return "snowflake.warehouse";
      if (/Datenbank/i.test(text)) return "snowflake.database";
    }
    if (type === "databricks") {
      if (/Adresse/i.test(text)) return "databricks.host";
      if (/Warehouse/i.test(text)) return "databricks.warehouse";
      if (/Client-ID/i.test(text)) return "databricks.clientId";
      if (/Katalog/i.test(text)) return "databricks.catalog";
    }
    if (/Windmill|Adresse|URL/i.test(text) && type === "windmill") return "windmill.url";
    if (/Schema/i.test(text)) return "schema";
    if (/DuckDB-Programm|CLI/i.test(text)) return "duckdb";
    if (/Datei|Ordner|Pfad|gibt es nicht|nicht gefunden/i.test(text) && (type === "duckdb" || type === "files")) return "path";
    return "";
  }
  // The fields of a data source: its kind and what that kind needs. The same form serves the Kosmos at hand («src»)
  // and a new one («new»); key names its message line and its last connection test.
  interface SourceForm { nodes: Node[]; msg: Msg; found: HTMLElement; clear(): void; err(msg: string): void; showTest(): void }
  // secret draws the field for one token: in a Kosmos it is stored at once, in the form for a new one it waits for «Kosmos anlegen».
  type SecretField = (key: SecretKey, label: string, what: string) => HTMLElement;
  function sourceForm(dr: DataSource, key: string, locked: (k: string) => boolean, secret: SecretField): SourceForm {
    const fields = new Map<string, Field>();
    const msg = flashed(key), found = h("div", { class: "s-found" });
    const txt = (name: string, label: string, get: () => string, set: (v: string) => void, attrs: Record<string, string> = {}, hint?: string) => {
      const inp = textInput(get(), { disabled: locked(name), ...attrs });
      inp.addEventListener("input", () => { set(inp.value); tests.delete(key); found.replaceChildren(); });
      const f = field(label, inp, locked(name) ? tr("Durch eine Umgebungsvariable festgelegt.", "Set by an environment variable.") : hint);
      fields.set(name, f);
      return f.wrap;
    };
    const clear = () => { for (const f of fields.values()) f.err(""); };
    // A server sentence goes under the field it is about, otherwise under the buttons.
    const err = (text: string) => {
      const f = fields.get(fieldOf(text, dr.type));
      if (f) { f.err(text); msg.set(""); } else msg.set(text, "bad");
    };
    const showTest = () => {
      const tested = tests.get(key);
      if (!tested) { found.replaceChildren(); return; }
      if (!tested.ok) { found.replaceChildren(); err(tested.error || tr("Die Verbindung klappt nicht.", "The connection does not work.")); return; }
      const n = tested.tables.length;
      msg.set(tr(`Verbunden. ${n} ${n === 1 ? "Tabelle" : "Tabellen"} gefunden.`, `Connected. ${n} ${n === 1 ? "table" : "tables"} found.`), "ok");
      found.replaceChildren(h("ul", { class: "s-tables" }, ...tested.tables.slice(0, 40).map((t) => h("li", {},
        h("span", { class: "s-tn", text: t.name }),
        h("span", { class: "s-tm", text: [t.rows >= 0 ? tr(`${thousands(t.rows)} Zeilen`, `${thousands(t.rows)} rows`) : "", t.time ? tr(`Zeit: ${t.time}`, `Time: ${t.time}`) : tr("ohne Zeitspalte", "without a time column"), tr(`${t.columns.length} Spalten`, `${t.columns.length} columns`)].filter(Boolean).join(" · ") })))),
        ...(n > 40 ? [note(tr(`und ${n - 40} weitere`, `and ${n - 40} more`))] : []));
    };
    const nodes: Node[] = [
      txt("name", tr("Name des Kosmos", "Name of the Kosmos"), () => dr.name, (v) => (dr.name = v), { placeholder: tr("Firmenkunden", "Corporate clients") }, tr("So heisst er im Hauptmenü und oben links.", "That is its name in the main menu and at the top left.")),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Art der Datenquelle", "Kind of data source") }),
        choice(tr("Art der Datenquelle", "Kind of data source"), TYPES, dr.type, (v) => { dr.type = v; tests.delete(key); render(); }, { stacked: true, disabled: locked("type") })),
    ];
    if (dr.type === "duckdb") nodes.push(
      txt("path", tr("Datei", "File"), () => dr.path, (v) => (dr.path = v), { placeholder: "goldlayer/gold.duckdb" }, tr("Pfad zur .duckdb-Datei, absolut oder vom Programmordner aus.", "Path to the .duckdb file, absolute or from the program folder.")),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, tr("Lumantic zeigt nur Tabellen aus Schemas, die so beginnen.", "Lumantic shows only tables from schemas that begin like this.")));
    if (dr.type === "files") nodes.push(
      txt("path", tr("Ordner", "Folder"), () => dr.path, (v) => (dr.path = v), { placeholder: "goldlayer/tabellen" }, tr("Jede .parquet- oder .csv-Datei wird eine Tabelle, ebenso jeder Unterordner mit Parquet-Dateien.", "Every .parquet or .csv file becomes a table, as does every subfolder of Parquet files.")),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, tr("Unter diesem Namen erscheinen die Tabellen, zum Beispiel gold.kredite.", "The tables appear under this name, for example gold.loans.")));
    const sf = dr.snowflake, db = dr.databricks;
    if (dr.type === "snowflake") nodes.push(
      txt("snowflake.account", tr("Konto", "Account"), () => sf.account, (v) => (sf.account = v), { placeholder: "myorg-myaccount" }, tr("Der Teil vor .snowflakecomputing.com.", "The part before .snowflakecomputing.com.")),
      txt("snowflake.user", tr("Benutzer", "User"), () => sf.user, (v) => (sf.user = v), { placeholder: "LUMANTIC" }),
      txt("snowflake.warehouse", "Warehouse", () => sf.warehouse, (v) => (sf.warehouse = v), { placeholder: "LUMANTIC_XS" }, tr("So geschrieben, wie Snowflake es führt, meist in Grossbuchstaben. Jede Abfrage kostet Credits; ein kleines Warehouse mit Auto-Suspend reicht.", "Written the way Snowflake keeps it, mostly in capitals. Every query costs credits; a small warehouse with auto-suspend is enough.")),
      txt("snowflake.database", tr("Datenbank", "Database"), () => sf.database, (v) => (sf.database = v), { placeholder: "ANALYTICS" }, tr("Auch sie so geschrieben, wie Snowflake sie führt.", "It too written the way Snowflake keeps it.")),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "GOLD" }, tr("Lumantic zeigt nur Tabellen aus Schemas, die so beginnen. Leer heisst alle.", "Lumantic shows only tables from schemas that begin like this. Empty means all.")),
      txt("snowflake.role", tr("Rolle (optional)", "Role (optional)"), () => sf.role, (v) => (sf.role = v), { placeholder: "LUMANTIC_READER" }, tr("Am besten eine Rolle, die nur lesen darf.", "Best a role that may only read.")),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Anmeldung", "Sign-in") }),
        choice(tr("Anmeldung bei Snowflake", "Sign-in to Snowflake"), SF_AUTH, sf.auth, (v) => { sf.auth = v; tests.delete(key); render(); }, { stacked: true })),
      sf.auth === "keypair"
        ? txt("snowflake.keyFile", tr("Schlüsseldatei", "Key file"), () => sf.keyFile, (v) => (sf.keyFile = v), { placeholder: "config/keys/lumantic.p8" }, tr("PEM-Datei mit dem privaten Schlüssel, unverschlüsselt (PKCS#8). Sie bleibt auf dem Server; schütze die Datei.", "PEM file with the private key, unencrypted (PKCS#8). It stays on the server; protect the file."))
        : secret("snowflakeToken", "Token", tr("Das Snowflake-Token", "The Snowflake token")));
    if (dr.type === "databricks") nodes.push(
      txt("databricks.host", tr("Adresse des Workspace", "Workspace address"), () => db.host, (v) => (db.host = v), { placeholder: "https://adb-1234567890123456.7.azuredatabricks.net", inputmode: "url" }),
      txt("databricks.warehouse", "SQL-Warehouse", () => db.warehouse, (v) => (db.warehouse = v), { placeholder: "1a2b3c4d5e6f7a8b" }, tr("Die ID aus den Verbindungsdetails des Warehouse.", "The ID from the warehouse's connection details.")),
      txt("databricks.catalog", tr("Katalog", "Catalog"), () => db.catalog, (v) => (db.catalog = v), { placeholder: "main" }, tr("Der Katalog im Unity Catalog. Leer heisst der Standard des Warehouse.", "The catalog in the Unity Catalog. Empty means the warehouse's default.")),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, tr("Lumantic zeigt nur Tabellen aus Schemas, die so beginnen. Leer heisst alle.", "Lumantic shows only tables from schemas that begin like this. Empty means all.")),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Anmeldung", "Sign-in") }),
        choice(tr("Anmeldung bei Databricks", "Sign-in to Databricks"), DB_AUTH, db.auth, (v) => { db.auth = v; tests.delete(key); render(); }, { stacked: true })),
      ...(db.auth === "oauth"
        ? [txt("databricks.clientId", tr("Client-ID", "Client ID"), () => db.clientId, (v) => (db.clientId = v), { placeholder: tr("Application-ID des Service Principal", "Application ID of the service principal") }), secret("databricksSecret", "Secret", tr("Das Secret des Service Principal", "The service principal's secret"))]
        : [secret("databricksToken", "Token", tr("Das Databricks-Token", "The Databricks token"))]));
    if (dr.type === "windmill") nodes.push(
      txt("windmill.url", tr("Adresse", "Address"), () => dr.windmill.url, (v) => (dr.windmill.url = v), { placeholder: "https://windmill.example.ch", inputmode: "url" }),
      txt("windmill.workspace", "Workspace", () => dr.windmill.workspace, (v) => (dr.windmill.workspace = v), { placeholder: "lumantic" }),
      secret("windmillToken", "Token", tr("Das Windmill-Token", "The Windmill token")),
      txt("windmill.describe", tr("Skript für die Struktur", "Script for the structure"), () => dr.windmill.describe, (v) => (dr.windmill.describe = v), { placeholder: "f/lumantic/describe" }),
      txt("windmill.query", tr("Skript für Abfragen", "Script for queries"), () => dr.windmill.query, (v) => (dr.windmill.query = v), { placeholder: "f/lumantic/query" }));
    else if (dr.type === "duckdb" || dr.type === "files") nodes.push(h("details", { class: "s-more", open: locked("duckdb") || !!dr.duckdb }, h("summary", { text: tr("DuckDB-Programm", "DuckDB program") }),
      txt("duckdb", tr("Pfad zum DuckDB-Programm", "Path to the DuckDB program"), () => dr.duckdb, (v) => (dr.duckdb = v), { placeholder: "duckdb" }, host.settings()?.duckdbBuiltIn ? tr("Leer lassen: DuckDB ist in Lumantic eingebaut. Mit einem Pfad nimmt Lumantic stattdessen dieses Programm.", "Leave empty: DuckDB is built into Lumantic. With a path Lumantic takes that program instead.")
      : tr("Leer lassen, wenn DuckDB im Systempfad liegt.", "Leave empty when DuckDB is on the system path."))));
    return { nodes, msg, found, clear, err, showTest };
  }
  const NO_TOKEN: SecretState = { set: false, hint: "", source: "" };
  const tryTest = (f: SourceForm, key: string, d: DataSource, given: SourceSecrets = {}) => btn(tr("Verbindung prüfen", "Test the connection"), async () => {
    f.clear();
    f.msg.set(tr("Lumantic prüft die Verbindung …", "Lumantic is testing the connection …"));
    try { tests.set(key, await api.testData(payload(d), given)); } catch (e) { tests.delete(key); f.msg.set(errText(e), "bad"); return; }
    f.showTest();
  });
  // The token states of the Kosmos at hand, for its stored-secret fields.
  const stateOf = (s: Settings, k: SecretKey): SecretState =>
    (k === "windmillToken" ? s.data.windmill.token : k === "snowflakeToken" ? s.data.snowflake?.token : k === "databricksToken" ? s.data.databricks?.token : k === "databricksSecret" ? s.data.databricks?.secret : s.ai.token) || NO_TOKEN;
  // In the form for a new Kosmos a warehouse token is only typed in; it goes along with the test and with «Kosmos anlegen».
  function typedSecret(store: SourceSecrets, k: SecretKey, label: string): HTMLElement {
    const inp = textInput(store[k as keyof SourceSecrets] || "", { type: "password", placeholder: "Token", autocomplete: "off" });
    inp.addEventListener("input", () => { store[k as keyof SourceSecrets] = inp.value.trim(); tests.delete("new"); });
    return field(label, inp, tr("Wird erst mit «Kosmos anlegen» auf dem Server gespeichert, nicht in der Konfiguration.", "Is stored on the server with «Create the Kosmos», not in the configuration.")).wrap;
  }

  function data(s: Settings): Node[] {
    // Only admins change a source and its schedule; the others see how it is doing and its key figures.
    if (!admin(s)) return [
      h("p", { class: "s-status", "data-tone": s.status.ok ? "ok" : "bad" }, h("i", { class: "s-led", "aria-hidden": "true" }), statusText(s)),
      note(tr("Datenquelle und Aktualisierung richten Administratoren ein.", "Administrators set up the data source and its refresh.")),
      group(tr("Kennzahlen", "Key figures"), kpiPart(s)),
      ...(s.kosmos.count > 1 ? [group("Kosmos", actions(h("button", { type: "button", class: "s-btn", onclick: () => host.menu() }, tr("Alle Kosmen", "All Kosmen"))))] : []),
    ];
    if (!draft) draft = structuredClone(s.data);
    const dr = draft, f = sourceForm(dr, "src", (k) => s.locked.includes("data." + k), (k, label, what) => secretBlock(k, label, stateOf(s, k), what));
    const save = btn(tr("Speichern", "Save"), async () => {
      f.clear();
      f.msg.set(tr("Lumantic verbindet die Datenquelle …", "Lumantic is connecting the data source …"));
      let next: Settings;
      try { next = await api.saveSettings({ data: payload(dr) }); } catch (e) { f.err(errText(e)); return; }
      host.setSettings(next);
      draft = structuredClone(next.data);
      tests.delete("src");
      kpis = null;
      dataChanged = true;
      if (!host.room() && next.status.ok) { reloadNow("daten"); return; }
      flash("src", next.status.ok ? tr("Gespeichert. Die Seiten zeigen die neuen Zahlen, sobald du die Einstellungen schliesst.", "Saved. The pages show the new figures once you close the settings.") : next.status.error, next.status.ok ? "ok" : "bad");
      render();
    }, "primary");
    const refresh = btn(tr("Neu laden", "Read again"), async () => {
      f.clear();
      f.msg.set(tr("Lumantic liest die Datenquelle neu …", "Lumantic is reading the data source again …"));
      let st;
      try { st = await api.refresh(); } catch (e) { f.msg.set(errText(e), "bad"); return; }
      host.setSettings({ ...s, status: st });
      kpis = null;
      dataChanged = true;
      if (!host.room() && st.ok) { reloadNow("daten"); return; }
      flash("src", st.ok ? tr("Neu geladen.", "Read again.") : st.error, st.ok ? "ok" : "bad");
      render();
    });
    if (tests.has("src")) queueMicrotask(f.showTest);
    return [
      h("p", { class: "s-status", "data-tone": s.status.ok ? "ok" : s.configExists ? "bad" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), statusText(s)),
      // The examples of a first start: whoever connects a gold layer here replaces them.
      ...(s.data.example ? [note(tr("Beispieldaten, die Lumantic jeden Tag neu schreibt. Verbindest du hier deinen Goldlayer, ersetzt er das Beispiel.", "Example data that Lumantic writes anew each day. Connect your gold layer here and it replaces the example."))] : []),
      group(tr("Datenquelle", "Data source"), ...f.nodes, actions(tryTest(f, "src", dr), save, refresh), f.msg.el, f.found),
      ...(s.refresh ? [refreshGroup(s)] : []),
      rasterGroup(s),
      group(tr("Kennzahlen", "Key figures"), kpiPart(s)),
      kosmosGroup(s),
    ];
  }

  // ───────────── Aktualisierung ─────────────
  // When the Kosmos is read again by itself, and the token a loading job sends to say there is new data.
  const BY: Record<string, string> = { start: tr("beim Start", "on start"), hand: tr("von Hand", "by hand"), anstoss: tr("auf Anstoss", "on a nudge"), zeitplan: tr("nach Zeitplan", "on schedule"), aenderung: tr("nach einer Änderung der Dateien", "after the files changed") };
  const MODES = [
    { v: "zeiten", name: tr("Zu festen Zeiten", "At set times"), note: tr("Zum Beispiel täglich um 06:00, nach dem nächtlichen Laden", "For example daily at 06:00, after the nightly load") },
    { v: "dateien", name: tr("Wenn sich die Dateien ändern", "When the files change"), note: tr("Lumantic schaut alle paar Minuten auf die Dateien, ohne die Datenbank zu fragen", "Lumantic looks at the files every few minutes, without asking the database") },
    { v: "anstoss", name: tr("Nur auf Anstoss", "Only on a nudge"), note: tr("Ein Ladeprozess meldet neue Daten, mit dem Token unten", "A loading job reports new data, with the token below") },
  ] as const;
  const EVERY = [{ v: 1, name: tr("jede Minute", "every minute") }, { v: 5, name: tr("alle 5 Minuten", "every 5 minutes") }, { v: 15, name: tr("alle 15 Minuten", "every 15 minutes") }, { v: 60, name: tr("jede Stunde", "every hour") }] as const;
  let freshToken = ""; // a token just made: shown this once
  const dayLabel = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return dd ? `${dd}. ${MON[m - 1]} ${y}` : monthLabel(d); };
  function whenNext(iso: string) {
    const t = new Date(iso);
    if (Number.isNaN(+t)) return "";
    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    const same = (d: Date) => d.toDateString() === t.toDateString();
    return same(new Date()) ? tr(`heute um ${hm}`, `today at ${hm}`) : same(new Date(Date.now() + 864e5)) ? tr(`morgen um ${hm}`, `tomorrow at ${hm}`) : tr(`am ${t.getDate()}. ${MON[t.getMonth()]} um ${hm}`, `on ${t.getDate()} ${MON[t.getMonth()]} at ${hm}`);
  }
  const copyBtn = (label: string, text: string) => h("button", { type: "button", class: "s-btn", onclick: (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    void navigator.clipboard?.writeText(text).then(() => { b.textContent = tr("Kopiert", "Copied"); setTimeout(() => (b.textContent = label), 1600); }, () => {});
  } }, label);

  function refreshGroup(s: Settings): Node {
    const rf = s.refresh, st = s.status, m = flashed("refresh");
    const mode = rf.watch > 0 ? "dateien" : rf.daily.length ? "zeiten" : "anstoss";
    const put = async (refresh: { daily: string[]; watch: number } | null, text: string) => {
      try { host.setSettings(await api.saveSettings({ refresh })); flash("refresh", text, "ok"); } catch (e) { flash("refresh", errText(e), "bad"); }
      render();
    };
    const line = [st.until ? tr(`Daten bis ${dayLabel(st.until)}`, `Data up to ${dayLabel(st.until)}`) : "", st.refreshedAt ? tr(`gelesen ${ago(st.refreshedAt)}${st.by && BY[st.by] ? " " + BY[st.by] : ""}`, `read ${ago(st.refreshedAt)}${st.by && BY[st.by] ? " " + BY[st.by] : ""}`) : "",
      st.refreshing ? "liest gerade neu" : st.next ? tr(`nächstes Mal ${whenNext(st.next)}`, `next time ${whenNext(st.next)}`) : ""].filter(Boolean).join(" · ");
    const kids: Node[] = [note(line || tr("Noch nicht gelesen.", "Not read yet.")),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Von selbst neu lesen", "Read again by itself") }),
        choice(tr("Von selbst neu lesen", "Read again by itself"), MODES.filter((o) => o.v !== "dateien" || rf.watchable), mode, (v) => void put(
          v === "zeiten" ? { daily: rf.daily.length ? rf.daily : ["06:00"], watch: 0 } : v === "dateien" ? { daily: [], watch: rf.watch || 5 } : { daily: [], watch: 0 },
          v === "zeiten" ? tr("Lumantic liest zu festen Zeiten neu.", "Lumantic reads again at set times.") : v === "dateien" ? tr("Lumantic schaut auf die Dateien.", "Lumantic watches the files.") : tr("Lumantic liest nur noch auf Anstoss und von Hand.", "Lumantic now reads again only on a nudge and by hand.")), { stacked: true }))];
    if (mode === "zeiten") {
      const inp = textInput(rf.daily.join(", "), { placeholder: "06:00, 12:30", inputmode: "numeric" });
      const fld = field(tr("Uhrzeiten", "Times"), inp, tr("Mehrere mit Komma. Es gilt die Uhr des Servers.", "Several with commas. The server's clock holds."));
      inp.addEventListener("change", () => {
        const daily = inp.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
        if (!daily.length) { fld.err(tr("Mindestens eine Uhrzeit, zum Beispiel 06:00.", "At least one time, for example 06:00.")); return; }
        void put({ daily, watch: 0 }, tr("Gespeichert.", "Saved."));
      });
      kids.push(fld.wrap);
    }
    if (mode === "dateien") kids.push(h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Wie oft schauen", "How often to look") }),
      choice(tr("Wie oft schauen", "How often to look"), EVERY, rf.watch, (v) => void put({ daily: [], watch: v }, tr("Gespeichert.", "Saved.")))));
    if (rf.own) kids.push(actions(h("button", { type: "button", class: "s-btn quiet", onclick: () => void put(null, tr("Wieder wie üblich für diese Datenquelle.", "Back to the usual for this data source.")) }, tr("Zurück zum Üblichen", "Back to the usual"))));
    kids.push(m.el, h("h4", { class: "s-sub", text: tr("Anstoss durch einen Ladeprozess", "A nudge from a loading job") }), ...tokenPart(s));
    return group(tr("Aktualisierung", "Refresh"), ...kids);
  }

  // ───────────── Raster ─────────────
  // The standard raster: «Heute» and the main menu judge in it. Everyone may still read the pages in another one.
  const RASTERS = [
    { v: "monat", name: tr("Monat", "Month"), note: tr("Wie bisher: der Status gilt für den laufenden Monat", "As before: the status holds for the running month") },
    { v: "quartal", name: tr("Quartal", "Quarter"), note: tr("Für Gremien, die vierteljährlich berichten", "For committees that report quarterly") },
    { v: "jahr", name: tr("Jahr", "Year"), note: tr("Für Ziele, die erst am Jahresende zählen", "For targets that only count at the end of the year") },
  ] as const;
  function rasterGroup(s: Settings): Node {
    const m = flashed("grain");
    return group("Raster",
      note(tr("Danach urteilen «Heute» und das Hauptmenü. Lesen kann jede Person jede Seite auch in einem anderen Raster, mit der Wahl neben dem Datum oder der Taste G.", "«Today» and the main menu judge in it. Everyone can still read any page in another raster, with the choice beside the date or the key G.")),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Standardraster", "Standard raster") }),
        choice(tr("Standardraster", "Standard raster"), RASTERS, s.grain || "monat", (v) => void (async () => {
          try { host.setSettings(await api.saveSettings({ grain: v as Grain })); dataChanged = true; flash("grain", tr("Gespeichert. Der Kosmos urteilt jetzt im neuen Raster, sobald du die Einstellungen schliesst.", "Saved. The Kosmos judges in the new raster once you close the settings."), "ok"); }
          catch (e) { flash("grain", errText(e), "bad"); }
          render();
        })(), { stacked: true })),
      m.el);
  }

  function tokenPart(s: Settings): Node[] {
    const tok = s.refresh.token, m = flashed("token"), k = s.kosmos.id;
    const where = `${location.origin}/api/refresh${s.kosmos.main ? "" : `?k=${encodeURIComponent(k)}`}`;
    const after = async (text: string) => {
      try { host.setSettings(await api.settings()); } catch { /* the line below still says what happened */ }
      flash("token", text, "ok");
      render();
    };
    const make = async () => {
      try { freshToken = (await api.refreshToken()).token; } catch (e) { flash("token", errText(e), "bad"); render(); return; }
      await after(tr("Token erzeugt. Er erscheint nur jetzt; kopier ihn.", "Token created. It shows only now; copy it."));
    };
    const out: Node[] = [note(tr("Was den Goldlayer lädt, etwa ein Windmill-Flow, kann Lumantic nach jedem Lauf anstossen. Lumantic antwortet sofort und liest im Hintergrund neu.", "Whatever loads the gold layer, a Windmill flow for instance, can nudge Lumantic after every run. Lumantic answers at once and reads again in the background."))];
    if (freshToken) {
      const call = `curl -X POST -H "Authorization: Bearer ${freshToken}" ${where}`;
      out.push(h("pre", { class: "s-code" }, freshToken), actions(copyBtn(tr("Token kopieren", "Copy the token"), freshToken), copyBtn(tr("Aufruf kopieren", "Copy the call"), call)),
        h("pre", { class: "s-code is-small" }, call),
        note(tr("Leg den Token in Windmill als Secret ab. Eine Vorlage für den letzten Schritt eines Flows liegt in adapters/windmill/refresh.py.", "Keep the token in Windmill as a secret. A template for the last step of a flow is in adapters/windmill/refresh.py.")));
    } else if (tok.source === "umgebung") out.push(h("p", { class: "s-sec", text: tr(`Durch die Umgebungsvariable LUMANTIC_REFRESH_TOKEN gesetzt${tok.hint ? `, endet auf ${tok.hint}` : ""}.`, `Set by the environment variable LUMANTIC_REFRESH_TOKEN${tok.hint ? `, ends in ${tok.hint}` : ""}.`) }));
    else if (tok.set) out.push(h("p", { class: "s-sec" }, h("i", { class: "s-led ok", "aria-hidden": "true" }), tr(`Token gesetzt, endet auf ${tok.hint}`, `Token set, ends in ${tok.hint}`)),
      actions(twice(tr("Neu erzeugen", "Create anew"), tr("Wirklich neu erzeugen", "Really create anew"), m, tr("Der alte Token gilt dann sofort nicht mehr. Nochmals klicken.", "The old token stops working at once. Click again."), make),
        twice(tr("Entfernen", "Remove"), tr("Wirklich entfernen", "Really remove"), m, tr("Ohne Token kann kein Ladeprozess mehr anstossen. Nochmals klicken.", "Without a token no loading job can nudge any more. Click again."), async () => {
          try { await api.removeRefreshToken(); } catch (e) { flash("token", errText(e), "bad"); render(); return; }
          await after(tr("Token entfernt.", "Token removed."));
        })));
    else out.push(actions(btn(tr("Token erzeugen", "Create a token"), make, "primary")));
    out.push(note(tr(`Adresse: POST ${where}`, `Address: POST ${where}`)), m.el);
    return out;
  }

  // ───────────── Kosmen ─────────────
  // A button that asks once more before it does something that cannot be taken back.
  function twice(label: string, sure: string, m: Msg, warning: string, run: () => Promise<void>) {
    let armed = false;
    const b = btn(label, async () => {
      if (!armed) { armed = true; b.textContent = sure; m.set(warning); return; }
      await run();
    }, "danger");
    return b;
  }
  const removeKosmos = (id: string, name: string, m: Msg) => twice(tr("Entfernen", "Remove"), tr("Wirklich entfernen", "Really remove"), m,
    tr(`«${name}» verschwindet aus dem Hauptmenü, mit den Seiten, die darin gebaut wurden. Datenquelle und Kennzahlen-Datei bleiben. Nochmals klicken zum Entfernen.`, `«${name}» disappears from the main menu, with the pages built in it. Data source and key figure file stay. Click again to remove.`),
    async () => { try { await api.removeKosmos(id); } catch (e) { m.set(errText(e), "bad"); return; } el.hidden = true; host.menu(); });

  // Inside a Kosmos: where it stands among the others.
  function kosmosGroup(s: Settings): Node {
    const n = s.kosmos.count, m = flashed("kosmos"), name = s.data.name || tr("Dieser Kosmos", "This Kosmos");
    const acts: Node[] = [];
    if (n > 1) acts.push(h("button", { type: "button", class: "s-btn", onclick: () => host.menu() }, tr("Alle Kosmen", "All Kosmen")));
    acts.push(h("button", { type: "button", class: "s-btn", onclick: () => host.menu("neu") }, tr("Weiteren Kosmos anlegen", "Create a further Kosmos")));
    if (!s.kosmos.main) acts.push(removeKosmos(s.kosmos.id, name, m));
    return group("Kosmos", note(n > 1 ? tr(`«${name}» ist einer von ${n} Kosmen. Jeder hat seine eigene Datenquelle, seine Kennzahlen und seine Seiten.`, `«${name}» is one of ${n} Kosmen. Each has its own data source, its key figures and its pages.`)
      : tr("Ein Kosmos ist ein Raum über einer Datenquelle. Hast du Zugriff auf weitere Goldlayer, bekommt jeder seinen eigenen Kosmos, und ein Hauptmenü führt zu allen.", "A Kosmos is a room over one data source. If you have access to further gold layers, each gets a Kosmos of its own, and a main menu leads to all.")), actions(...acts), m.el);
  }

  // In the main menu: every Kosmos, and the form for one more.
  function kosmenPart(s: Settings): Node[] {
    const list = host.kosmen(), m = flashed("kosmen");
    const rows = list.map((k) => {
      const st = k.status, line = st.ok ? [`${st.kpisLoaded} ${st.kpisLoaded === 1 ? tr("Kennzahl", "key figure") : tr("Kennzahlen", "key figures")}`, st.last ? tr(`bis ${monthLabel(st.last)}`, `to ${monthLabel(st.last)}`) : ""].filter(Boolean).join(" · ") : st.error;
      return h("li", { class: "s-krow" }, h("div", { class: "s-khead is-plain" },
        h("span", { class: "s-kn", text: k.name || k.id }),
        h("span", { class: "s-km", text: `${TYPES.find((t) => t.v === k.type)?.name || k.type} · ${line}` }),
        h("span", { class: "s-kst", "data-tone": st.ok ? "ok" : "bad", text: st.ok ? tr("bereit", "ready") : st.tables > 0 && st.kpis === 0 ? tr("ohne Kennzahlen", "without key figures") : tr("antwortet nicht", "not answering") })),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => host.enter(k.id) }, tr("Öffnen", "Open")), k.main || !admin(s) ? null : removeKosmos(k.id, k.name, m)));
    });
    return [
      group("Kosmen", note(tr("Jeder Kosmos ist ein Raum über einer Datenquelle, mit eigenen Kennzahlen und eigenen Seiten. Datenquelle und Kennzahlen eines Kosmos änderst du in seinen Einstellungen unter «Daten».", "Every Kosmos is a room over one data source, with its own key figures and its own pages. You change a Kosmos's data source and key figures in its settings under «Data».")),
        h("ul", { class: "s-klist is-kosmen" }, ...rows), m.el),
      !admin(s) ? note(tr("Weitere Kosmen legen Administratoren an.", "Administrators add further Kosmen."))
        : adding ? newKosmos(s) : actions(h("button", { type: "button", class: "s-btn primary", onclick: () => { adding = true; render(); body.querySelector(".is-new")?.scrollIntoView({ block: "nearest" }); } }, tr("Kosmos hinzufügen", "Add a Kosmos"))),
    ];
  }
  function newKosmos(s: Settings): HTMLElement {
    if (!fresh) fresh = { type: "duckdb", name: "", path: "", schema: "gold", duckdb: s.data.duckdb,
      snowflake: { account: "", user: "", role: "", warehouse: "", database: "", auth: "keypair", keyFile: "" },
      databricks: { host: "", warehouse: "", catalog: "", auth: "oauth", clientId: "" },
      windmill: { url: "", workspace: "lumantic", describe: "f/lumantic/describe", query: "f/lumantic/query" } };
    const dr = fresh, given = freshSecrets;
    const f = sourceForm(dr, "new", (k) => k === "duckdb" && s.locked.includes("data.duckdb"),
      (k, label, what) => (k === "windmillToken" ? secretBlock(k, label, stateOf(s, k), what) : typedSecret(given, k, label)));
    const create = btn(tr("Kosmos anlegen", "Create the Kosmos"), async () => {
      f.clear();
      if (!dr.name.trim()) { f.err(tr("Der Kosmos braucht einen Namen.", "The Kosmos needs a name.")); return; }
      f.msg.set(tr("Lumantic verbindet die Datenquelle …", "Lumantic is connecting the data source …"));
      let made;
      try { made = await api.addKosmos(payload(dr), given); } catch (e) { f.err(errText(e)); return; }
      fresh = null;
      freshSecrets = {};
      adding = false;
      tests.delete("new");
      el.hidden = true;
      host.enter(made.id);
    }, "primary");
    if (tests.has("new")) queueMicrotask(f.showTest);
    return h("div", { class: "s-kedit is-new" }, h("h4", { text: tr("Neuer Kosmos", "New Kosmos") }), note(tr("Verbinde einen weiteren Goldlayer. Seine Kennzahlen legst du danach im neuen Kosmos fest.", "Connect a further gold layer. You set its key figures afterwards in the new Kosmos.")),
      ...f.nodes, actions(tryTest(f, "new", dr, given), create, h("button", { type: "button", class: "s-btn quiet", onclick: () => { adding = false; render(); } }, tr("Abbrechen", "Cancel"))), f.msg.el, f.found);
  }

  async function loadKpis() {
    kpisLoading = true;
    const [k, c] = await Promise.allSettled([api.kpis(), api.catalog()]);
    kpisLoading = false;
    kpis = k.status === "fulfilled" ? k.value : null;
    kpisErr = k.status === "rejected" ? errText(k.reason) : "";
    catalog = c.status === "fulfilled" && c.value && Array.isArray(c.value.tables) ? c.value : null;
    if (!el.hidden && tab === "daten") render();
  }
  function kpiPart(s: Settings): Node {
    if (!kpis && !kpisErr && !kpisLoading) void loadKpis();
    if (!kpis) return note(kpisErr || tr("Lumantic liest die Kennzahlen …", "Lumantic is reading the key figures …"));
    const list = kpis, groups = new Map(list.groups.map((g) => [g.id, say(g)])), mayEdit = s.me?.editor !== false;
    const m = flashed("kpi");
    const rows = list.kpis.map((k) => {
      const ok = k.status === "ok", open = editing === k.id;
      const row = h("li", { class: "s-krow" + (open ? " is-open" : "") },
        h("button", { type: "button", class: "s-khead", "aria-expanded": String(open), onclick: () => { editing = open ? "" : k.id; render(); } },
          h("span", { class: "s-kn", text: say(k) }),
          h("span", { class: "s-km", text: `${groups.get(k.group) || k.group} · ${k.monthly.table}.${k.monthly.value}` }),
          h("span", { class: "s-kst", "data-tone": ok ? "ok" : "bad", text: ok ? (k.origin === "quelle" ? tr("Fachkatalog", "Company catalogue") : tr("bereit", "ready")) : k.status || "" })));
      // A figure of the company catalog is changed there; what it leaves open is added in the Sternkatalog.
      if (open && k.origin === "quelle") row.append(h("div", { class: "s-kedit" }, note(tr("Diese Kennzahl kommt aus dem Fachkatalog in der Quelle. Was dort offen ist, ergänzt du im Sternkatalog.", "This key figure comes from the company catalogue in the source. What is open there you add in the star catalogue.")),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => { close(); host.catalog(k.id); } }, tr("Im Sternkatalog öffnen", "Open in the star catalogue")))));
      else if (open) row.append(mayEdit ? kpiEdit(k) : note(k.desc || tr("Ohne Beschreibung.", "Without a description.")));
      return row;
    });
    return h("div", { class: "s-kpis" },
      note(list.builtIn ? tr("Das sind die eingebauten ALCO-Kennzahlen. Mit der ersten Änderung legt Lumantic eine eigene Datei an.", "These are the built-in ALCO key figures. With the first change Lumantic creates a file of its own.")
        : list.file ? tr(`Gespeichert in ${list.file}.`, `Saved in ${list.file}.`) : tr("Dieser Kosmos hat noch keine Kennzahlen. Mit der ersten legt Lumantic eine Datei für ihn an.", "This Kosmos has no key figures yet. With the first one Lumantic creates a file for it.")),
      h("ul", { class: "s-klist" }, ...rows),
      !mayEdit ? note(tr("Die Kennzahlen dieses Kosmos pflegen andere.", "Others look after the key figures of this Kosmos."))
        : editing === "new" ? kpiAdd(list, s) : actions(h("button", { type: "button", class: "s-btn", onclick: () => { editing = "new"; render(); } }, tr("Kennzahl hinzufügen", "Add a key figure"))),
      m.el);
  }
  // Server sentences about a figure: name, table and column, or the topic, each under its own field.
  const routeKpiErr = (msg: string, f: { name: Field; where?: Field; topic?: Field }, m: Msg) => {
    if (/Namen|gibt es schon|ID/i.test(msg)) f.name.err(msg);
    else if (f.where && /Spalte|Tabelle|fehlt|Zahl/i.test(msg)) f.where.err(msg);
    else if (f.topic && /Thema/i.test(msg)) f.topic.err(msg);
    else m.set(msg, "bad");
  };
  function kpiEdit(k: KpiDef): HTMLElement {
    // In English the English name is edited, where the definition has one.
    const enName = isEn() && !!k.en?.name, name = textInput(say(k)), tgt = textInput(showNum(k.target), { inputmode: "decimal" }), lim = textInput(showNum(k.limit), { inputmode: "decimal" });
    let dir: number = k.dir;
    const fN = field(tr("Name", "Name"), name), fT = field(tr(`Ziel ${unitOf(k.unit)}`, `Target ${unitOf(k.unit)}`), tgt, tr("Das interne Ziel. Leer lassen, wenn es keines gibt.", "The internal target. Leave empty when there is none.")),
      fL = field(tr(`Limit ${unitOf(k.unit)}`, `Limit ${unitOf(k.unit)}`), lim, tr("Die Grenze, die nicht verletzt werden darf, zum Beispiel ein regulatorisches Minimum.", "The bound that must not be breached, for example a regulatory minimum."));
    const m = msgLine();
    let confirmDel = false;
    const del = btn(tr("Entfernen", "Remove"), async () => {
      if (!confirmDel) { confirmDel = true; del.textContent = tr("Wirklich entfernen", "Really remove"); m.set(tr(`${k.name} verschwindet aus allen Seiten. Nochmals klicken zum Entfernen.`, `${say(k)} disappears from all pages. Click again to remove.`)); return; }
      try { await api.removeKpi(k.id); } catch (e) { m.set(errText(e), "bad"); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", tr(`${k.name} ist entfernt.`, `${say(k)} is removed.`), "ok");
      await loadKpis();
    }, "danger");
    const save = btn(tr("Speichern", "Save"), async () => {
      for (const f of [fN, fT, fL]) f.err("");
      const t = parseNum(tgt.value), l = parseNum(lim.value);
      if (!name.value.trim()) return fN.err(tr("Die Kennzahl braucht einen Namen.", "The key figure needs a name."));
      if (Number.isNaN(t)) return fT.err(tr("Bitte eine Zahl eingeben, zum Beispiel 125 oder 1’200.", "Please enter a number, for example 125 or 1,200."));
      if (Number.isNaN(l)) return fL.err(tr("Bitte eine Zahl eingeben, zum Beispiel 100.", "Please enter a number, for example 100."));
      const named = enName ? { en: { ...k.en, name: name.value.trim() } } : { name: name.value.trim() };
      try { await api.updateKpi(k.id, { ...named, target: t, limit: l, dir: dir as KpiDef["dir"] }); } catch (e) { routeKpiErr(errText(e), { name: fN }, m); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", tr(`${name.value.trim()} ist gespeichert. Die Seiten zeigen es, sobald du die Einstellungen schliesst.`, `${name.value.trim()} is saved. The pages show it once you close the settings.`), "ok");
      await loadKpis();
    }, "primary");
    return h("div", { class: "s-kedit" }, fN.wrap, h("div", { class: "s-pair" }, fT.wrap, fL.wrap),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Richtung", "Direction") }), choice(tr("Richtung", "Direction"), DIRS, dir, (v) => (dir = v))),
      actions(save, h("button", { type: "button", class: "s-btn quiet", onclick: () => { editing = ""; render(); } }, tr("Abbrechen", "Cancel")), del), m.el);
  }
  function kpiAdd(list: KpiList, s: Settings): HTMLElement {
    const tables = (catalog?.tables || []).filter((t) => t.columns.some((c) => c.role === "time") && t.columns.some((c) => c.role === "measure"));
    const cancel = h("button", { type: "button", class: "s-btn quiet", onclick: () => { editing = ""; render(); } }, tr("Abbrechen", "Cancel"));
    if (!tables.length) return h("div", { class: "s-kedit" }, note(s.status.ok ? tr("Die Datenquelle hat keine Tabelle mit einer Datumsspalte und Zahlen. Eine Kennzahl braucht beides.", "The data source has no table with a date column and numbers. A key figure needs both.") : tr("Zuerst muss die Datenquelle antworten.", "The data source has to answer first.")), actions(cancel));
    const tableSel = select(tables.map((t) => [t.name, t.name]), tables[0].name), valueSel = select([], "");
    const name = textInput("", { placeholder: tr("Kreditvolumen", "Loan volume") }), tgt = textInput("", { inputmode: "decimal" }), lim = textInput("", { inputmode: "decimal" }), topicName = textInput("", { placeholder: tr("Neues Thema", "New topic") });
    let unit: string = "Mio", kind: string = "stock", dir: number = 1;
    const unitBox = h("div", {});
    const drawUnit = () => unitBox.replaceChildren(choice(tr("Einheit", "Unit"), UNITS, unit, (v) => (unit = v)));
    const fillValues = () => {
      const t = tables.find((x) => x.name === tableSel.value)!;
      valueSel.replaceChildren(...t.columns.filter((c) => c.role === "measure").map((c) => h("option", { value: c.name, text: c.name })));
      guessUnit();
    };
    // The column's name says its unit: lcr_pct is a percentage, kredite_mio an amount.
    const guessUnit = () => {
      const c = valueSel.value;
      unit = /_pct$|_quote$|_ratio$/i.test(c) ? "%" : /_stk$|_stueck$/i.test(c) ? "Stk" : /_tage$/i.test(c) ? tr("Tage", "Days") : /_h$|_std$/i.test(c) ? "h" : /_tsd$/i.test(c) ? "Tsd" : "Mio";
      drawUnit();
    };
    tableSel.addEventListener("change", fillValues);
    valueSel.addEventListener("change", guessUnit);
    fillValues();
    // Topic ids are slugs, so this value cannot be one of them.
    const NEW = "+neu";
    const topicSel = select([...list.groups.map((g) => [g.id, say(g)] as [string, string]), [NEW, tr("Neues Thema …", "New topic …")]], list.groups[0]?.id || NEW);
    const topicWrap = h("div", { class: "s-newtopic", hidden: topicSel.value !== NEW }, topicName);
    topicSel.addEventListener("change", () => { topicWrap.hidden = topicSel.value !== NEW; if (!topicWrap.hidden) topicName.focus(); });
    const fTable = field(tr("Tabelle", "Table"), tableSel), fValue = field(tr("Wertspalte", "Value column"), valueSel, tr("Spalten mit Zahlen aus dieser Tabelle.", "Columns with numbers from this table.")), fName = field(tr("Name", "Name"), name),
      fT = field(tr("Ziel (optional)", "Target (optional)"), tgt), fL = field(tr("Limit (optional)", "Limit (optional)"), lim), fTopic = field(tr("Thema", "Topic"), topicSel);
    fTopic.wrap.append(topicWrap);
    const m = msgLine();
    const add = btn(tr("Hinzufügen", "Add"), async () => {
      for (const f of [fTable, fValue, fName, fT, fL, fTopic]) f.err("");
      const t = parseNum(tgt.value), l = parseNum(lim.value), newTopic = topicSel.value === NEW;
      if (!name.value.trim()) return fName.err(tr("Die Kennzahl braucht einen Namen.", "The key figure needs a name."));
      if (Number.isNaN(t)) return fT.err(tr("Bitte eine Zahl eingeben.", "Please enter a number."));
      if (Number.isNaN(l)) return fL.err(tr("Bitte eine Zahl eingeben.", "Please enter a number."));
      if (newTopic && !topicName.value.trim()) return fTopic.err(tr("Bitte das neue Thema benennen.", "Please name the new topic."));
      const def: KpiDef = { id: "", name: name.value.trim(), unit: unit as KpiDef["unit"], dec: unit === "%" ? 1 : 0, kind: kind as KpiDef["kind"], dir: dir as KpiDef["dir"],
        target: t, limit: l, group: newTopic ? "" : topicSel.value, groupName: newTopic ? topicName.value.trim() : "", monthly: { table: tableSel.value, value: valueSel.value } };
      let made: KpiDef;
      try { made = await api.addKpi(def); } catch (e) { routeKpiErr(errText(e), { name: fName, where: fValue, topic: fTopic }, m); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", tr(`${made.name} ist dazugekommen${made.status && made.status !== "ok" ? ", aber " + made.status : ""}. Die Seiten zeigen sie, sobald du die Einstellungen schliesst.`, `${made.name} has been added${made.status && made.status !== "ok" ? ", but " + made.status : ""}. The pages show it once you close the settings.`), made.status && made.status !== "ok" ? "bad" : "ok");
      await loadKpis();
    }, "primary");
    return h("div", { class: "s-kedit is-new" },
      h("h4", { text: tr("Neue Kennzahl", "New key figure") }), fTable.wrap, fValue.wrap, fName.wrap,
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Einheit", "Unit") }), unitBox),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Art", "Kind") }), choice(tr("Art", "Kind"), KINDS, kind, (v) => (kind = v), { stacked: true })),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: tr("Richtung", "Direction") }), choice(tr("Richtung", "Direction"), DIRS, dir, (v) => (dir = v))),
      h("div", { class: "s-pair" }, fT.wrap, fL.wrap), note(tr("Ziel und Limit in der Einheit der Wertspalte, Beträge in Mio. CHF.", "Target and limit in the value column's unit, amounts in CHF millions.")),
      fTopic.wrap, actions(add, cancel), m.el);
  }

  // ───────────── Secrets: never shown again, only whether one is set and how it ends ─────────────
  function secretBlock(key: SecretKey, label: string, state: SecretState, what: string): HTMLElement {
    const box = h("div", { class: "s-field s-secret" });
    let changing = false;
    const m = flashed("secret:" + key);
    // The whole part is drawn again: with a token Lumina is ready, without one she is not.
    const after = async (text: string) => {
      try { host.setSettings(await api.settings()); } catch { /* the line below still says what happened */ }
      flash("secret:" + key, text, "ok");
      render();
    };
    const draw = () => {
      const kids: Node[] = [h("span", { class: "s-flabel", text: label })];
      if (state.source === "umgebung") kids.push(h("p", { class: "s-sec", text: tr(`Durch eine Umgebungsvariable gesetzt${state.hint ? `, endet auf ${state.hint}` : ""}.`, `Set by an environment variable${state.hint ? `, ends in ${state.hint}` : ""}.`) }));
      else if (state.set && !changing) kids.push(h("p", { class: "s-sec" }, h("i", { class: "s-led ok", "aria-hidden": "true" }), tr(`Gespeichert, endet auf ${state.hint}`, `Saved, ends in ${state.hint}`)),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => { changing = true; draw(); box.querySelector("input")?.focus(); } }, tr("Ändern", "Change")),
          btn(tr("Entfernen", "Remove"), async () => { try { await api.setSecret(key, ""); await after(tr(`${what} entfernt.`, `${what} removed.`)); } catch (e) { m.set(errText(e), "bad"); } }, "danger")));
      else {
        const inp = textInput("", { type: "password", placeholder: key === "anthropicToken" ? "sk-ant-…" : "Token", "aria-label": label });
        const store = btn(tr("Speichern", "Save"), async () => {
          if (!inp.value.trim()) { m.set(tr("Bitte zuerst das Token einfügen.", "Please paste the token first."), "bad"); return; }
          try { await api.setSecret(key, inp.value.trim()); await after(tr(`${what} gespeichert.`, `${what} saved.`)); } catch (e) { m.set(errText(e), "bad"); }
        }, "primary");
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") store.click(); });
        kids.push(h("div", { class: "s-inline" }, inp, store), ...(changing ? [h("button", { type: "button", class: "s-btn quiet", onclick: () => { changing = false; draw(); } }, tr("Abbrechen", "Cancel"))] : []),
          note(tr("Wird auf dem Server gespeichert, nicht in der Konfiguration, und nie wieder angezeigt.", "Is stored on the server, not in the configuration, and never shown again.")));
      }
      box.replaceChildren(...kids, m.el);
    };
    draw();
    return box;
  }

  // ───────────── Lumina ─────────────
  function lumina(s: Settings): Node[] {
    const ai = s.ai, locked = (k: string) => s.locked.includes("ai." + k), model = ai.models.find((x) => x.id === ai.model);
    const m = msgLine();
    const put = async (patch: Partial<Settings["ai"]>) => {
      try { host.setSettings(await api.saveSettings({ ai: patch })); render(); } catch (e) { m.set(errText(e), "bad"); }
    };
    const state = ai.ready ? tr(`Lumina beantwortet Fragen mit ${model ? model.name : ai.model}.`, `Lumina answers questions with ${model ? model.name : ai.model}.`) : !ai.enabled ? tr("Die KI ist aus. Lumina sucht in deiner Frage nach Stichwörtern.", "The AI is off. Lumina looks for keywords in your question.") : tr("Es fehlt ein API-Token. Bis dahin sucht Lumina nach Stichwörtern.", "An API token is missing. Until then Lumina looks for keywords.");
    const base = textInput(ai.baseURL, { placeholder: "https://api.anthropic.com", inputmode: "url", disabled: locked("baseURL") });
    const fBase = field(tr("Adresse (optional)", "Address (optional)"), base, locked("baseURL") ? tr("Durch eine Umgebungsvariable festgelegt.", "Set by an environment variable.") : tr("Nur nötig, wenn Anfragen über ein Firmen-Gateway laufen. Leer heisst direkt zu Anthropic.", "Only needed when requests go through a company gateway. Empty means straight to Anthropic."));
    const applyBase = () => { if (base.value.trim() !== ai.baseURL) void put({ baseURL: base.value.trim() }); };
    base.addEventListener("change", applyBase);
    const test = btn(tr("Verbindung testen", "Test the connection"), async () => {
      m.set(tr("Lumina fragt kurz bei Claude nach …", "Lumina is checking with Claude …"));
      try {
        const r = await api.testAI();
        const nm = ai.models.find((x) => x.id === r.model)?.name || r.model;
        m.set(r.ok ? tr(`Verbunden mit ${nm}, Antwort in ${thousands(r.ms)} ms.`, `Connected to ${nm}, answer in ${thousands(r.ms)} ms.`) : r.error || tr("Die Verbindung klappt nicht.", "The connection does not work."), r.ok ? "ok" : "bad");
      } catch (e) { m.set(errText(e), "bad"); }
    });
    if (!admin(s)) return [
      h("p", { class: "s-status", "data-tone": ai.ready ? "ok" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), state),
      note(tr("Lumina richten Administratoren ein.", "Administrators set up Lumina.")),
      h("p", { class: "s-privacy" }, tr("Lumina schickt deine Frage und die Kennzahlen dieses Monats an Anthropic. Keine Datenzeilen aus dem Goldlayer.", "Lumina sends your question and this month's key figures to Anthropic. No data rows from the gold layer.")),
    ];
    return [
      h("p", { class: "s-status", "data-tone": ai.ready ? "ok" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), state),
      group(tr("KI", "AI"), toggle(tr("KI verwenden", "Use AI"), ai.enabled, (v) => void put({ enabled: v }), locked("enabled")), locked("enabled") ? note(tr("Durch eine Umgebungsvariable festgelegt.", "Set by an environment variable.")) : null),
      group(tr("Modell", "Model"), choice(tr("Modell", "Model"), ai.models.map((x) => ({ v: x.id, name: x.name, note: x.note })), ai.model, (v) => void put({ model: v }), { stacked: true, disabled: locked("model") })),
      group(tr("Zugang", "Access"), secretBlock("anthropicToken", tr("API-Token", "API token"), ai.token, tr("Das API-Token", "The API token")), fBase.wrap, actions(test), m.el),
      h("p", { class: "s-privacy" }, tr("Lumina schickt deine Frage und die Kennzahlen dieses Monats an Anthropic. Keine Datenzeilen aus dem Goldlayer.", "Lumina sends your question and this month's key figures to Anthropic. No data rows from the gold layer.")),
    ];
  }

  // ───────────── Über ─────────────
  function about(s: Settings | null): Node[] {
    const room = host.room();
    const rows: [string, string][] = s ? [
      ["Version", s.version],
      host.kosmos() ? ["Kosmos", `${s.data.name || "ohne Namen"} · ${TYPES.find((t) => t.v === s.data.type)?.name || s.data.type}`] : ["Kosmen", String(s.kosmos.count)],
      ...(admin(s) ? [[tr("Konfiguration", "Configuration"), s.configPath + (s.configExists ? "" : tr(" (noch nicht angelegt, es gelten die Standardwerte)", " (not created yet, the defaults hold)"))] as [string, string]] : []),
      ...(host.kosmos() && admin(s) ? [[tr("Kennzahlen", "Key figures"), s.metrics || (s.kosmos.main ? tr("eingebaut (ALCO)", "built in (ALCO)") : tr("noch keine", "none yet"))] as [string, string]] : []),
    ] : [];
    const out: Node[] = [h("div", { class: "s-about" }, h("p", { class: "s-word" }, logo(26)), h("p", { class: "s-slogan", text: "Quiet until it matters." }))];
    if (rows.length) out.push(h("dl", { class: "s-facts" }, ...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])));
    else out.push(offline());
    const me = s?.me;
    if (me && me.login !== "none") out.push(group(tr("Angemeldet", "Signed in"),
      h("p", { class: "s-sec", text: `${me.name}${me.name !== me.id ? ` (${me.id})` : ""}` }),
      note([me.admin ? tr("Administrator", "Administrator") : "", me.groups.length ? tr(`Gruppen: ${me.groups.join(", ")}`, `Groups: ${me.groups.join(", ")}`) : tr("Ohne Gruppen", "No groups")].filter(Boolean).join(" · ")),
      me.logout ? actions(h("a", { class: "s-btn", href: me.logout }, tr("Abmelden", "Sign out"))) : null));
    if (admin(s)) out.push(group(tr("Firmen-Design", "Corporate design"), note(tr("Farben, Hausschrift und Logo stehen in der Konfiguration unter «brand». Mit einem eigenen Logo (brand.logo) steht eures oben links, und Lumantic zeichnet mit «powered by lumantic». Eine Vorlage mit dem Beispiel «Musterbank» liegt in config/lumantic.example.json, Logo und Schriftdateien kommen nach config/brand/.", "Colours, house font and logo go into the configuration under «brand». With a logo of your own (brand.logo) yours stands at the top left, and Lumantic signs with «powered by lumantic». A template with the example «Musterbank» is in config/lumantic.example.json; logo and font files go to config/brand/."))));
    if (room) {
      const m = msgLine();
      const reset = confirmReset
        ? actions(h("button", { type: "button", class: "s-btn danger", onclick: () => { confirmReset = false; room.resetAll(); m.set(tr("Zurückgesetzt.", "Reset."), "ok"); render(); } }, tr("Ja, zurücksetzen", "Yes, reset")),
          h("button", { type: "button", class: "s-btn quiet", onclick: () => { confirmReset = false; render(); } }, tr("Abbrechen", "Cancel")))
        : actions(h("button", { type: "button", class: "s-btn", onclick: () => { confirmReset = true; render(); } }, tr("Eigene Seiten zurücksetzen", "Reset your own pages")));
      out.push(group(tr("Zurücksetzen", "Reset"), note(confirmReset ? tr("Deine eigenen Seiten, Notizen und Antworten verschwinden. Luminas Seiten bleiben. Das lässt sich nicht rückgängig machen.", "Your own pages, notes and answers disappear. Lumina's pages stay. This cannot be undone.") : tr("Entfernt deine eigenen Seiten und Notizen. Luminas Seiten bleiben.", "Removes your own pages and notes. Lumina's pages stay.")), reset, m.el));
    }
    out.push(group(tr("Die Idee", "The idea"), actions(h("button", { type: "button", class: "s-btn quiet", onclick: () => { close(); $("btn-idee").click(); } }, tr("Die Idee und ihre Quellen", "The idea and its sources")))));
    return out;
  }

  // The first start: a kind of source was picked on the welcome page; its form opens with that kind.
  function setup(kind: DataSource["type"]) {
    const s = host.settings();
    if (!s) { open("daten"); return; }
    draft = { ...structuredClone(s.data), type: kind };
    tests.delete("src");
    open("daten");
  }

  return {
    open,
    setup,
    close,
    toggle: () => (el.hidden ? open() : close()),
    isOpen: () => !el.hidden,
    reopenAfterReload,
  };
}
