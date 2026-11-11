// The settings: a sheet beside the room, in five parts. Darstellung and Start are personal and always work.
// Daten, Lumina and Über come from the server; when it cannot answer, the part says so in one sentence.
// «Daten» is about the Kosmos the page shows: its source and its key figures. In the main menu, where the page is in
// no Kosmos, the same place is «Kosmen»: the list of all, and the form for one more.
// Every change applies at once. New figures or a new source rebuild the room when the sheet closes.
import type { KosmosRoom } from "virtual:kosmos";
import { api, ApiError, type Catalog, type DataSource, type Grain, type KosmosInfo, type KpiDef, type KpiList, type SecretKey, type SecretState, type Settings, type SourceSecrets, type TestResult } from "./api";
import { $, h } from "./dom";
import { logo } from "./logo";
import { P, setPref, uiOnly, type Prefs } from "./prefs";
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

const TABS: [Tab, string][] = [["darstellung", "Darstellung"], ["start", "Start"], ["daten", "Daten"], ["lumina", "Lumina"], ["ueber", "Über"]];
const REOPEN = "lumantic.reopen";
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const TYPES = [
  { v: "duckdb", name: "DuckDB-Datei", note: "Eine .duckdb-Datei mit dem Goldlayer" },
  { v: "files", name: "Ordner mit Parquet- oder CSV-Dateien", note: "Jede Datei wird eine Tabelle" },
  { v: "snowflake", name: "Snowflake", note: "Über die SQL-API, mit Schlüsselpaar oder Token" },
  { v: "databricks", name: "Databricks", note: "Ein SQL-Warehouse, Tabellen aus dem Unity Catalog" },
  { v: "windmill", name: "Windmill", note: "Der Goldlayer über zwei Windmill-Skripte" },
] as const;
const SF_AUTH = [{ v: "keypair", name: "Schlüsselpaar", note: "Empfohlen: ein technischer Benutzer mit eigenem Schlüssel" }, { v: "token", name: "Token", note: "Ein Programmatic Access Token oder ein OAuth-Token" }] as const;
const DB_AUTH = [{ v: "oauth", name: "Service Principal", note: "Empfohlen: OAuth mit Client-ID und Secret" }, { v: "token", name: "Persönliches Token", note: "Zum Ausprobieren" }] as const;
const DIRS = [{ v: 1, name: "Höher ist besser" }, { v: -1, name: "Tiefer ist besser" }, { v: 0, name: "Neutral" }] as const;
const UNITS = [{ v: "%", name: "%" }, { v: "Mio", name: "Mio. CHF" }, { v: "Mrd", name: "Mrd. CHF" }, { v: "Tsd", name: "Tsd. CHF" },
  { v: "Stk", name: "Stück" }, { v: "Tage", name: "Tage" }, { v: "h", name: "Stunden" }, { v: "Zahl", name: "Zahl" }] as const;
const KINDS = [{ v: "stock", name: "Bestand am Monatsende" }, { v: "flow", name: "Summe im Monat" }, { v: "avg", name: "Durchschnitt der Monate" }] as const;

const monthLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return y && m ? `${MON[m - 1]} ${y}` : ym; };
const thousands = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’");
function ago(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return min === 1 ? "vor einer Minute" : `vor ${min} Minuten`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return hrs === 1 ? "vor einer Stunde" : `vor ${hrs} Stunden`;
  const d = new Date(t);
  return `am ${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Der Server antwortet nicht.");
// Without a login everyone may change everything; an older server says nothing about it either.
const admin = (s: Settings | null) => s?.me?.admin !== false;
// «1’250,5» or «1 250.5» → 1250.5 · empty → null · anything else → NaN
function parseNum(s: string): number | null {
  const t = s.replace(/[’'\s]/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
const showNum = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
// Amounts are kept in Mio. CHF, also for figures shown in Mrd.
const unitOf = (u: string) => ({ "%": "in %", Tsd: "in Tsd. CHF", Stk: "in Stück", Tage: "in Tagen", h: "in Stunden", Zahl: "als Zahl" } as Record<string, string>)[u] || "in Mio. CHF";

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
  const tablist = h("nav", { class: "s-tabs", role: "tablist", "aria-label": "Bereiche" }, ...tabs);
  tablist.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement), d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (i < 0 || !d) return;
    e.preventDefault();
    const j = (i + d + tabs.length) % tabs.length;
    tabs[j].focus();
    show(TABS[j][0]);
  });
  const body = h("div", { class: "s-body", id: "set-body", role: "tabpanel", tabindex: "-1" });
  el.append(h("header", { class: "s-head" }, h("h2", { id: "set-title", text: "Einstellungen" }),
    h("button", { type: "button", class: "s-x", "aria-label": "Einstellungen schliessen", title: "Schliessen (Esc)", onclick: () => close() }, "×")), tablist, body);

  function show(t: Tab) {
    if (t !== tab) { confirmReset = false; editing = ""; adding = false; }
    tab = t;
    tabs.forEach((b, i) => { const on = TABS[i][0] === t; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (TABS[i][0] === "daten") b.textContent = host.kosmos() ? "Daten" : "Kosmen"; });
    body.setAttribute("aria-labelledby", "st-" + t);
    render();
    body.scrollTop = 0;
  }
  function render() {
    const s = host.settings();
    const parts = tab === "darstellung" ? look(s) : tab === "start" ? start() : tab === "ueber" ? about(s) : !s ? [offline()] : tab === "daten" ? (host.kosmos() ? data(s) : kosmenPart(s)) : lumina(s);
    body.replaceChildren(...parts);
  }
  const offline = () => note("Die Einstellungen des Servers sind gerade nicht erreichbar. Darstellung und Start funktionieren trotzdem.");
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
    if (at && TABS.some(([id]) => id === at)) { flash("src", "Verbunden. Die Seiten zeigen jetzt die Zahlen dieser Quelle.", "ok"); open(at as Tab); }
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
    const fonts = choice("Schrift", FONTS.map((f) => ({ v: f.id, name: f.name, face: f.family || own })), P.font, (v) => { setPref("font", v); host.look("font"); }, { stacked: true });
    const def = d.accents[0], current = P.accent && P.accent.toLowerCase() !== def.toLowerCase() ? P.accent.toLowerCase() : "";
    const accents = choice("Akzent", d.accents.map((hex, i) => ({ v: i === 0 ? "" : hex.toLowerCase(), name: (ACCENT_NAMES[hex] || hex) + (i === 0 ? " (wie im Design)" : ""), swatch: hex })),
      current, (v) => { setPref("accent", v); host.look("accent"); }, { stacked: true });
    const motion = choice("Bewegung", [{ v: "voll", name: "Voll" }, { v: "ruhig", name: "Ruhig" }], P.motion, (v) => { setPref("motion", v as Prefs["motion"]); host.look("motion"); });
    const size = choice("Textgrösse", [{ v: "normal", name: "Normal" }, { v: "gross", name: "Gross" }], P.textSize, (v) => { setPref("textSize", v as Prefs["textSize"]); host.look("size"); });
    const systemStill = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const out: Node[] = [
      group("Design", designs, s && !s.brand.designs.length ? note("Ein Firmen-Design mit Hausfarben und Hausschrift trägst du in der Konfiguration unter «brand» ein. Es erscheint dann hier.") : null),
      group("Schrift", fonts),
      group("Akzent", accents, d.corporate ? note("Das Firmen-Design bringt seinen Akzent mit.") : null),
      group("Bewegung", motion, note(systemStill ? "Dein System wünscht wenig Bewegung. Lumantic hält sich daran." : "Ruhig zeigt jede Änderung sofort, ohne Flüge und Übergänge.")),
      group("Textgrösse", size),
    ];
    if (s && admin(s)) {
      const m = msgLine();
      out.push(h("div", { class: "s-foot" }, note("Was du hier wählst, gilt für dich. «Für alle speichern» macht es zum Standard für alle, die Lumantic neu öffnen."),
        btn("Für alle speichern", async () => {
          try { host.setSettings(await api.saveSettings({ ui: uiOnly() })); m.set("Gespeichert. Das ist jetzt der Standard für alle.", "ok"); } catch (e) { m.set(errText(e), "bad"); }
        }, "quiet"), m.el));
    }
    return out;
  }

  // ───────────── Start ─────────────
  function start(): Node[] {
    return [
      group("Beim Öffnen", choice("Beim Öffnen", [{ v: "heute", name: "Heute" }, { v: "ueberblick", name: "Überblick" }, { v: "zuletzt", name: "Wo ich war" }], P.start,
        (v) => setPref("start", v as Prefs["start"])), note("Gilt ab dem nächsten Öffnen.")),
      group("Zeitlinse zeigt", choice("Zeitlinse zeigt", [{ v: "1M", name: "1 Monat zurück" }, { v: "1Q", name: "1 Quartal zurück" }, { v: "1J", name: "1 Jahr zurück" }], P.lens,
        (v) => { setPref("lens", v as Prefs["lens"]); host.look("lens"); }), note("Welchen Monat die Linse zeigt, wenn du sie aufnimmst.")),
      group("Hinweise", toggle("Hinweise zu Gesten", P.hints, (v) => { setPref("hints", v); host.look("hints"); })),
    ];
  }

  // ───────────── Daten ─────────────
  function statusText(s: Settings) {
    const st = s.status;
    // Before the first save the source is only the built-in example; its error would talk about a file nobody chose.
    if (!st.ok && !s.configExists) return "Noch keine Datenquelle eingerichtet. Wähle die Art, trag die Verbindung ein und prüf sie.";
    if (!st.ok) return st.error || "Die Datenquelle antwortet nicht.";
    const figs = st.kpisLoaded < st.kpis ? `${st.kpisLoaded} von ${st.kpis} Kennzahlen` : `${st.kpis} Kennzahlen`;
    return [`${st.tables} Tabellen`, figs, st.first && st.last ? `${monthLabel(st.first)} bis ${monthLabel(st.last)}` : "", st.refreshedAt ? `Stand ${ago(st.refreshedAt)}` : ""].filter(Boolean).join(" · ");
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
      const f = field(label, inp, locked(name) ? "Durch eine Umgebungsvariable festgelegt." : hint);
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
      if (!tested.ok) { found.replaceChildren(); err(tested.error || "Die Verbindung klappt nicht."); return; }
      const n = tested.tables.length;
      msg.set(`Verbunden. ${n} ${n === 1 ? "Tabelle" : "Tabellen"} gefunden.`, "ok");
      found.replaceChildren(h("ul", { class: "s-tables" }, ...tested.tables.slice(0, 40).map((t) => h("li", {},
        h("span", { class: "s-tn", text: t.name }),
        h("span", { class: "s-tm", text: [t.rows >= 0 ? `${thousands(t.rows)} Zeilen` : "", t.time ? `Zeit: ${t.time}` : "ohne Zeitspalte", `${t.columns.length} Spalten`].filter(Boolean).join(" · ") })))),
        ...(n > 40 ? [note(`und ${n - 40} weitere`)] : []));
    };
    const nodes: Node[] = [
      txt("name", "Name des Kosmos", () => dr.name, (v) => (dr.name = v), { placeholder: "Firmenkunden" }, "So heisst er im Hauptmenü und oben links."),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Art der Datenquelle" }),
        choice("Art der Datenquelle", TYPES, dr.type, (v) => { dr.type = v; tests.delete(key); render(); }, { stacked: true, disabled: locked("type") })),
    ];
    if (dr.type === "duckdb") nodes.push(
      txt("path", "Datei", () => dr.path, (v) => (dr.path = v), { placeholder: "goldlayer/gold.duckdb" }, "Pfad zur .duckdb-Datei, absolut oder vom Programmordner aus."),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, "Lumantic zeigt nur Tabellen aus Schemas, die so beginnen."));
    if (dr.type === "files") nodes.push(
      txt("path", "Ordner", () => dr.path, (v) => (dr.path = v), { placeholder: "goldlayer/tabellen" }, "Jede .parquet- oder .csv-Datei wird eine Tabelle, ebenso jeder Unterordner mit Parquet-Dateien."),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, "Unter diesem Namen erscheinen die Tabellen, zum Beispiel gold.kredite."));
    const sf = dr.snowflake, db = dr.databricks;
    if (dr.type === "snowflake") nodes.push(
      txt("snowflake.account", "Konto", () => sf.account, (v) => (sf.account = v), { placeholder: "myorg-myaccount" }, "Der Teil vor .snowflakecomputing.com."),
      txt("snowflake.user", "Benutzer", () => sf.user, (v) => (sf.user = v), { placeholder: "LUMANTIC" }),
      txt("snowflake.warehouse", "Warehouse", () => sf.warehouse, (v) => (sf.warehouse = v), { placeholder: "LUMANTIC_XS" }, "So geschrieben, wie Snowflake es führt, meist in Grossbuchstaben. Jede Abfrage kostet Credits; ein kleines Warehouse mit Auto-Suspend reicht."),
      txt("snowflake.database", "Datenbank", () => sf.database, (v) => (sf.database = v), { placeholder: "ANALYTICS" }, "Auch sie so geschrieben, wie Snowflake sie führt."),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "GOLD" }, "Lumantic zeigt nur Tabellen aus Schemas, die so beginnen. Leer heisst alle."),
      txt("snowflake.role", "Rolle (optional)", () => sf.role, (v) => (sf.role = v), { placeholder: "LUMANTIC_READER" }, "Am besten eine Rolle, die nur lesen darf."),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Anmeldung" }),
        choice("Anmeldung bei Snowflake", SF_AUTH, sf.auth, (v) => { sf.auth = v; tests.delete(key); render(); }, { stacked: true })),
      sf.auth === "keypair"
        ? txt("snowflake.keyFile", "Schlüsseldatei", () => sf.keyFile, (v) => (sf.keyFile = v), { placeholder: "config/keys/lumantic.p8" }, "PEM-Datei mit dem privaten Schlüssel, unverschlüsselt (PKCS#8). Sie bleibt auf dem Server; schütze die Datei.")
        : secret("snowflakeToken", "Token", "Das Snowflake-Token"));
    if (dr.type === "databricks") nodes.push(
      txt("databricks.host", "Adresse des Workspace", () => db.host, (v) => (db.host = v), { placeholder: "https://adb-1234567890123456.7.azuredatabricks.net", inputmode: "url" }),
      txt("databricks.warehouse", "SQL-Warehouse", () => db.warehouse, (v) => (db.warehouse = v), { placeholder: "1a2b3c4d5e6f7a8b" }, "Die ID aus den Verbindungsdetails des Warehouse."),
      txt("databricks.catalog", "Katalog", () => db.catalog, (v) => (db.catalog = v), { placeholder: "main" }, "Der Katalog im Unity Catalog. Leer heisst der Standard des Warehouse."),
      txt("schema", "Schema", () => dr.schema, (v) => (dr.schema = v), { placeholder: "gold" }, "Lumantic zeigt nur Tabellen aus Schemas, die so beginnen. Leer heisst alle."),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Anmeldung" }),
        choice("Anmeldung bei Databricks", DB_AUTH, db.auth, (v) => { db.auth = v; tests.delete(key); render(); }, { stacked: true })),
      ...(db.auth === "oauth"
        ? [txt("databricks.clientId", "Client-ID", () => db.clientId, (v) => (db.clientId = v), { placeholder: "Application-ID des Service Principal" }), secret("databricksSecret", "Secret", "Das Secret des Service Principal")]
        : [secret("databricksToken", "Token", "Das Databricks-Token")]));
    if (dr.type === "windmill") nodes.push(
      txt("windmill.url", "Adresse", () => dr.windmill.url, (v) => (dr.windmill.url = v), { placeholder: "https://windmill.example.ch", inputmode: "url" }),
      txt("windmill.workspace", "Workspace", () => dr.windmill.workspace, (v) => (dr.windmill.workspace = v), { placeholder: "lumantic" }),
      secret("windmillToken", "Token", "Das Windmill-Token"),
      txt("windmill.describe", "Skript für die Struktur", () => dr.windmill.describe, (v) => (dr.windmill.describe = v), { placeholder: "f/lumantic/describe" }),
      txt("windmill.query", "Skript für Abfragen", () => dr.windmill.query, (v) => (dr.windmill.query = v), { placeholder: "f/lumantic/query" }));
    else if (dr.type === "duckdb" || dr.type === "files") nodes.push(h("details", { class: "s-more", open: locked("duckdb") || !!dr.duckdb }, h("summary", { text: "DuckDB-Programm" }),
      txt("duckdb", "Pfad zum DuckDB-Programm", () => dr.duckdb, (v) => (dr.duckdb = v), { placeholder: "duckdb" }, "Leer lassen, wenn DuckDB im Systempfad liegt.")));
    return { nodes, msg, found, clear, err, showTest };
  }
  const NO_TOKEN: SecretState = { set: false, hint: "", source: "" };
  const tryTest = (f: SourceForm, key: string, d: DataSource, given: SourceSecrets = {}) => btn("Verbindung prüfen", async () => {
    f.clear();
    f.msg.set("Lumantic prüft die Verbindung …");
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
    return field(label, inp, "Wird erst mit «Kosmos anlegen» auf dem Server gespeichert, nicht in der Konfiguration.").wrap;
  }

  function data(s: Settings): Node[] {
    // Only admins change a source and its schedule; the others see how it is doing and its key figures.
    if (!admin(s)) return [
      h("p", { class: "s-status", "data-tone": s.status.ok ? "ok" : "bad" }, h("i", { class: "s-led", "aria-hidden": "true" }), statusText(s)),
      note("Datenquelle und Aktualisierung richten Administratoren ein."),
      group("Kennzahlen", kpiPart(s)),
      ...(s.kosmos.count > 1 ? [group("Kosmos", actions(h("button", { type: "button", class: "s-btn", onclick: () => host.menu() }, "Alle Kosmen")))] : []),
    ];
    if (!draft) draft = structuredClone(s.data);
    const dr = draft, f = sourceForm(dr, "src", (k) => s.locked.includes("data." + k), (k, label, what) => secretBlock(k, label, stateOf(s, k), what));
    const save = btn("Speichern", async () => {
      f.clear();
      f.msg.set("Lumantic verbindet die Datenquelle …");
      let next: Settings;
      try { next = await api.saveSettings({ data: payload(dr) }); } catch (e) { f.err(errText(e)); return; }
      host.setSettings(next);
      draft = structuredClone(next.data);
      tests.delete("src");
      kpis = null;
      dataChanged = true;
      if (!host.room() && next.status.ok) { reloadNow("daten"); return; }
      flash("src", next.status.ok ? "Gespeichert. Die Seiten zeigen die neuen Zahlen, sobald du die Einstellungen schliesst." : next.status.error, next.status.ok ? "ok" : "bad");
      render();
    }, "primary");
    const refresh = btn("Neu laden", async () => {
      f.clear();
      f.msg.set("Lumantic liest die Datenquelle neu …");
      let st;
      try { st = await api.refresh(); } catch (e) { f.msg.set(errText(e), "bad"); return; }
      host.setSettings({ ...s, status: st });
      kpis = null;
      dataChanged = true;
      if (!host.room() && st.ok) { reloadNow("daten"); return; }
      flash("src", st.ok ? "Neu geladen." : st.error, st.ok ? "ok" : "bad");
      render();
    });
    if (tests.has("src")) queueMicrotask(f.showTest);
    return [
      h("p", { class: "s-status", "data-tone": s.status.ok ? "ok" : s.configExists ? "bad" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), statusText(s)),
      group("Datenquelle", ...f.nodes, actions(tryTest(f, "src", dr), save, refresh), f.msg.el, f.found),
      ...(s.refresh ? [refreshGroup(s)] : []),
      rasterGroup(s),
      group("Kennzahlen", kpiPart(s)),
      kosmosGroup(s),
    ];
  }

  // ───────────── Aktualisierung ─────────────
  // When the Kosmos is read again by itself, and the token a loading job sends to say there is new data.
  const BY: Record<string, string> = { start: "beim Start", hand: "von Hand", anstoss: "auf Anstoss", zeitplan: "nach Zeitplan", aenderung: "nach einer Änderung der Dateien" };
  const MODES = [
    { v: "zeiten", name: "Zu festen Zeiten", note: "Zum Beispiel täglich um 06:00, nach dem nächtlichen Laden" },
    { v: "dateien", name: "Wenn sich die Dateien ändern", note: "Lumantic schaut alle paar Minuten auf die Dateien, ohne die Datenbank zu fragen" },
    { v: "anstoss", name: "Nur auf Anstoss", note: "Ein Ladeprozess meldet neue Daten, mit dem Token unten" },
  ] as const;
  const EVERY = [{ v: 1, name: "jede Minute" }, { v: 5, name: "alle 5 Minuten" }, { v: 15, name: "alle 15 Minuten" }, { v: 60, name: "jede Stunde" }] as const;
  let freshToken = ""; // a token just made: shown this once
  const dayLabel = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return dd ? `${dd}. ${MON[m - 1]} ${y}` : monthLabel(d); };
  function whenNext(iso: string) {
    const t = new Date(iso);
    if (Number.isNaN(+t)) return "";
    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    const same = (d: Date) => d.toDateString() === t.toDateString();
    return same(new Date()) ? `heute um ${hm}` : same(new Date(Date.now() + 864e5)) ? `morgen um ${hm}` : `am ${t.getDate()}. ${MON[t.getMonth()]} um ${hm}`;
  }
  const copyBtn = (label: string, text: string) => h("button", { type: "button", class: "s-btn", onclick: (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    void navigator.clipboard?.writeText(text).then(() => { b.textContent = "Kopiert"; setTimeout(() => (b.textContent = label), 1600); }, () => {});
  } }, label);

  function refreshGroup(s: Settings): Node {
    const rf = s.refresh, st = s.status, m = flashed("refresh");
    const mode = rf.watch > 0 ? "dateien" : rf.daily.length ? "zeiten" : "anstoss";
    const put = async (refresh: { daily: string[]; watch: number } | null, text: string) => {
      try { host.setSettings(await api.saveSettings({ refresh })); flash("refresh", text, "ok"); } catch (e) { flash("refresh", errText(e), "bad"); }
      render();
    };
    const line = [st.until ? `Daten bis ${dayLabel(st.until)}` : "", st.refreshedAt ? `gelesen ${ago(st.refreshedAt)}${st.by && BY[st.by] ? " " + BY[st.by] : ""}` : "",
      st.refreshing ? "liest gerade neu" : st.next ? `nächstes Mal ${whenNext(st.next)}` : ""].filter(Boolean).join(" · ");
    const kids: Node[] = [note(line || "Noch nicht gelesen."),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Von selbst neu lesen" }),
        choice("Von selbst neu lesen", MODES.filter((o) => o.v !== "dateien" || rf.watchable), mode, (v) => void put(
          v === "zeiten" ? { daily: rf.daily.length ? rf.daily : ["06:00"], watch: 0 } : v === "dateien" ? { daily: [], watch: rf.watch || 5 } : { daily: [], watch: 0 },
          v === "zeiten" ? "Lumantic liest zu festen Zeiten neu." : v === "dateien" ? "Lumantic schaut auf die Dateien." : "Lumantic liest nur noch auf Anstoss und von Hand."), { stacked: true }))];
    if (mode === "zeiten") {
      const inp = textInput(rf.daily.join(", "), { placeholder: "06:00, 12:30", inputmode: "numeric" });
      const fld = field("Uhrzeiten", inp, "Mehrere mit Komma. Es gilt die Uhr des Servers.");
      inp.addEventListener("change", () => {
        const daily = inp.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
        if (!daily.length) { fld.err("Mindestens eine Uhrzeit, zum Beispiel 06:00."); return; }
        void put({ daily, watch: 0 }, "Gespeichert.");
      });
      kids.push(fld.wrap);
    }
    if (mode === "dateien") kids.push(h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Wie oft schauen" }),
      choice("Wie oft schauen", EVERY, rf.watch, (v) => void put({ daily: [], watch: v }, "Gespeichert."))));
    if (rf.own) kids.push(actions(h("button", { type: "button", class: "s-btn quiet", onclick: () => void put(null, "Wieder wie üblich für diese Datenquelle.") }, "Zurück zum Üblichen")));
    kids.push(m.el, h("h4", { class: "s-sub", text: "Anstoss durch einen Ladeprozess" }), ...tokenPart(s));
    return group("Aktualisierung", ...kids);
  }

  // ───────────── Raster ─────────────
  // The standard raster: «Heute» and the main menu judge in it. Everyone may still read the pages in another one.
  const RASTERS = [
    { v: "monat", name: "Monat", note: "Wie bisher: der Status gilt für den laufenden Monat" },
    { v: "quartal", name: "Quartal", note: "Für Gremien, die vierteljährlich berichten" },
    { v: "jahr", name: "Jahr", note: "Für Ziele, die erst am Jahresende zählen" },
  ] as const;
  function rasterGroup(s: Settings): Node {
    const m = flashed("grain");
    return group("Raster",
      note("Danach urteilen «Heute» und das Hauptmenü. Lesen kann jede Person jede Seite auch in einem anderen Raster, mit der Wahl neben dem Datum oder der Taste G."),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Standardraster" }),
        choice("Standardraster", RASTERS, s.grain || "monat", (v) => void (async () => {
          try { host.setSettings(await api.saveSettings({ grain: v as Grain })); dataChanged = true; flash("grain", "Gespeichert. Der Kosmos urteilt jetzt im neuen Raster, sobald du die Einstellungen schliesst.", "ok"); }
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
      await after("Token erzeugt. Er erscheint nur jetzt; kopier ihn.");
    };
    const out: Node[] = [note("Was den Goldlayer lädt, etwa ein Windmill-Flow, kann Lumantic nach jedem Lauf anstossen. Lumantic antwortet sofort und liest im Hintergrund neu.")];
    if (freshToken) {
      const call = `curl -X POST -H "Authorization: Bearer ${freshToken}" ${where}`;
      out.push(h("pre", { class: "s-code" }, freshToken), actions(copyBtn("Token kopieren", freshToken), copyBtn("Aufruf kopieren", call)),
        h("pre", { class: "s-code is-small" }, call),
        note("Leg den Token in Windmill als Secret ab. Eine Vorlage für den letzten Schritt eines Flows liegt in adapters/windmill/refresh.py."));
    } else if (tok.source === "umgebung") out.push(h("p", { class: "s-sec", text: `Durch die Umgebungsvariable LUMANTIC_REFRESH_TOKEN gesetzt${tok.hint ? `, endet auf ${tok.hint}` : ""}.` }));
    else if (tok.set) out.push(h("p", { class: "s-sec" }, h("i", { class: "s-led ok", "aria-hidden": "true" }), `Token gesetzt, endet auf ${tok.hint}`),
      actions(twice("Neu erzeugen", "Wirklich neu erzeugen", m, "Der alte Token gilt dann sofort nicht mehr. Nochmals klicken.", make),
        twice("Entfernen", "Wirklich entfernen", m, "Ohne Token kann kein Ladeprozess mehr anstossen. Nochmals klicken.", async () => {
          try { await api.removeRefreshToken(); } catch (e) { flash("token", errText(e), "bad"); render(); return; }
          await after("Token entfernt.");
        })));
    else out.push(actions(btn("Token erzeugen", make, "primary")));
    out.push(note(`Adresse: POST ${where}`), m.el);
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
  const removeKosmos = (id: string, name: string, m: Msg) => twice("Entfernen", "Wirklich entfernen", m,
    `«${name}» verschwindet aus dem Hauptmenü, mit den Seiten, die darin gebaut wurden. Datenquelle und Kennzahlen-Datei bleiben. Nochmals klicken zum Entfernen.`,
    async () => { try { await api.removeKosmos(id); } catch (e) { m.set(errText(e), "bad"); return; } el.hidden = true; host.menu(); });

  // Inside a Kosmos: where it stands among the others.
  function kosmosGroup(s: Settings): Node {
    const n = s.kosmos.count, m = flashed("kosmos"), name = s.data.name || "Dieser Kosmos";
    const acts: Node[] = [];
    if (n > 1) acts.push(h("button", { type: "button", class: "s-btn", onclick: () => host.menu() }, "Alle Kosmen"));
    acts.push(h("button", { type: "button", class: "s-btn", onclick: () => host.menu("neu") }, "Weiteren Kosmos anlegen"));
    if (!s.kosmos.main) acts.push(removeKosmos(s.kosmos.id, name, m));
    return group("Kosmos", note(n > 1 ? `«${name}» ist einer von ${n} Kosmen. Jeder hat seine eigene Datenquelle, seine Kennzahlen und seine Seiten.`
      : "Ein Kosmos ist ein Raum über einer Datenquelle. Hast du Zugriff auf weitere Goldlayer, bekommt jeder seinen eigenen Kosmos, und ein Hauptmenü führt zu allen."), actions(...acts), m.el);
  }

  // In the main menu: every Kosmos, and the form for one more.
  function kosmenPart(s: Settings): Node[] {
    const list = host.kosmen(), m = flashed("kosmen");
    const rows = list.map((k) => {
      const st = k.status, line = st.ok ? [`${st.kpisLoaded} ${st.kpisLoaded === 1 ? "Kennzahl" : "Kennzahlen"}`, st.last ? `bis ${monthLabel(st.last)}` : ""].filter(Boolean).join(" · ") : st.error;
      return h("li", { class: "s-krow" }, h("div", { class: "s-khead is-plain" },
        h("span", { class: "s-kn", text: k.name || k.id }),
        h("span", { class: "s-km", text: `${TYPES.find((t) => t.v === k.type)?.name || k.type} · ${line}` }),
        h("span", { class: "s-kst", "data-tone": st.ok ? "ok" : "bad", text: st.ok ? "bereit" : st.tables > 0 && st.kpis === 0 ? "ohne Kennzahlen" : "antwortet nicht" })),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => host.enter(k.id) }, "Öffnen"), k.main || !admin(s) ? null : removeKosmos(k.id, k.name, m)));
    });
    return [
      group("Kosmen", note("Jeder Kosmos ist ein Raum über einer Datenquelle, mit eigenen Kennzahlen und eigenen Seiten. Datenquelle und Kennzahlen eines Kosmos änderst du in seinen Einstellungen unter «Daten»."),
        h("ul", { class: "s-klist is-kosmen" }, ...rows), m.el),
      !admin(s) ? note("Weitere Kosmen legen Administratoren an.")
        : adding ? newKosmos(s) : actions(h("button", { type: "button", class: "s-btn primary", onclick: () => { adding = true; render(); body.querySelector(".is-new")?.scrollIntoView({ block: "nearest" }); } }, "Kosmos hinzufügen")),
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
    const create = btn("Kosmos anlegen", async () => {
      f.clear();
      if (!dr.name.trim()) { f.err("Der Kosmos braucht einen Namen."); return; }
      f.msg.set("Lumantic verbindet die Datenquelle …");
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
    return h("div", { class: "s-kedit is-new" }, h("h4", { text: "Neuer Kosmos" }), note("Verbinde einen weiteren Goldlayer. Seine Kennzahlen legst du danach im neuen Kosmos fest."),
      ...f.nodes, actions(tryTest(f, "new", dr, given), create, h("button", { type: "button", class: "s-btn quiet", onclick: () => { adding = false; render(); } }, "Abbrechen")), f.msg.el, f.found);
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
    if (!kpis) return note(kpisErr || "Lumantic liest die Kennzahlen …");
    const list = kpis, groups = new Map(list.groups.map((g) => [g.id, g.name])), mayEdit = s.me?.editor !== false;
    const m = flashed("kpi");
    const rows = list.kpis.map((k) => {
      const ok = k.status === "ok", open = editing === k.id;
      const row = h("li", { class: "s-krow" + (open ? " is-open" : "") },
        h("button", { type: "button", class: "s-khead", "aria-expanded": String(open), onclick: () => { editing = open ? "" : k.id; render(); } },
          h("span", { class: "s-kn", text: k.name }),
          h("span", { class: "s-km", text: `${groups.get(k.group) || k.group} · ${k.monthly.table}.${k.monthly.value}` }),
          h("span", { class: "s-kst", "data-tone": ok ? "ok" : "bad", text: ok ? (k.origin === "quelle" ? "Fachkatalog" : "bereit") : (k.status || "").replace(/^fehlt: /, "fehlt: ") })));
      // A figure of the company catalog is changed there; what it leaves open is added in the Sternkatalog.
      if (open && k.origin === "quelle") row.append(h("div", { class: "s-kedit" }, note("Diese Kennzahl kommt aus dem Fachkatalog in der Quelle. Was dort offen ist, ergänzt du im Sternkatalog."),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => { close(); host.catalog(k.id); } }, "Im Sternkatalog öffnen"))));
      else if (open) row.append(mayEdit ? kpiEdit(k) : note(k.desc || "Ohne Beschreibung."));
      return row;
    });
    return h("div", { class: "s-kpis" },
      note(list.builtIn ? "Das sind die eingebauten ALCO-Kennzahlen. Mit der ersten Änderung legt Lumantic eine eigene Datei an."
        : list.file ? `Gespeichert in ${list.file}.` : "Dieser Kosmos hat noch keine Kennzahlen. Mit der ersten legt Lumantic eine Datei für ihn an."),
      h("ul", { class: "s-klist" }, ...rows),
      !mayEdit ? note("Die Kennzahlen dieses Kosmos pflegen andere.")
        : editing === "new" ? kpiAdd(list, s) : actions(h("button", { type: "button", class: "s-btn", onclick: () => { editing = "new"; render(); } }, "Kennzahl hinzufügen")),
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
    const name = textInput(k.name), tgt = textInput(showNum(k.target), { inputmode: "decimal" }), lim = textInput(showNum(k.limit), { inputmode: "decimal" });
    let dir: number = k.dir;
    const fN = field("Name", name), fT = field(`Ziel ${unitOf(k.unit)}`, tgt, "Das interne Ziel. Leer lassen, wenn es keines gibt."),
      fL = field(`Limit ${unitOf(k.unit)}`, lim, "Die Grenze, die nicht verletzt werden darf, zum Beispiel ein regulatorisches Minimum.");
    const m = msgLine();
    let confirmDel = false;
    const del = btn("Entfernen", async () => {
      if (!confirmDel) { confirmDel = true; del.textContent = "Wirklich entfernen"; m.set(`${k.name} verschwindet aus allen Seiten. Nochmals klicken zum Entfernen.`); return; }
      try { await api.removeKpi(k.id); } catch (e) { m.set(errText(e), "bad"); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", `${k.name} ist entfernt.`, "ok");
      await loadKpis();
    }, "danger");
    const save = btn("Speichern", async () => {
      for (const f of [fN, fT, fL]) f.err("");
      const t = parseNum(tgt.value), l = parseNum(lim.value);
      if (!name.value.trim()) return fN.err("Die Kennzahl braucht einen Namen.");
      if (Number.isNaN(t)) return fT.err("Bitte eine Zahl eingeben, zum Beispiel 125 oder 1’200.");
      if (Number.isNaN(l)) return fL.err("Bitte eine Zahl eingeben, zum Beispiel 100.");
      try { await api.updateKpi(k.id, { name: name.value.trim(), target: t, limit: l, dir: dir as KpiDef["dir"] }); } catch (e) { routeKpiErr(errText(e), { name: fN }, m); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", `${name.value.trim()} ist gespeichert. Die Seiten zeigen es, sobald du die Einstellungen schliesst.`, "ok");
      await loadKpis();
    }, "primary");
    return h("div", { class: "s-kedit" }, fN.wrap, h("div", { class: "s-pair" }, fT.wrap, fL.wrap),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Richtung" }), choice("Richtung", DIRS, dir, (v) => (dir = v))),
      actions(save, h("button", { type: "button", class: "s-btn quiet", onclick: () => { editing = ""; render(); } }, "Abbrechen"), del), m.el);
  }
  function kpiAdd(list: KpiList, s: Settings): HTMLElement {
    const tables = (catalog?.tables || []).filter((t) => t.columns.some((c) => c.role === "time") && t.columns.some((c) => c.role === "measure"));
    const cancel = h("button", { type: "button", class: "s-btn quiet", onclick: () => { editing = ""; render(); } }, "Abbrechen");
    if (!tables.length) return h("div", { class: "s-kedit" }, note(s.status.ok ? "Die Datenquelle hat keine Tabelle mit einer Datumsspalte und Zahlen. Eine Kennzahl braucht beides." : "Zuerst muss die Datenquelle antworten."), actions(cancel));
    const tableSel = select(tables.map((t) => [t.name, t.name]), tables[0].name), valueSel = select([], "");
    const name = textInput("", { placeholder: "Kreditvolumen" }), tgt = textInput("", { inputmode: "decimal" }), lim = textInput("", { inputmode: "decimal" }), topicName = textInput("", { placeholder: "Neues Thema" });
    let unit: string = "Mio", kind: string = "stock", dir: number = 1;
    const unitBox = h("div", {});
    const drawUnit = () => unitBox.replaceChildren(choice("Einheit", UNITS, unit, (v) => (unit = v)));
    const fillValues = () => {
      const t = tables.find((x) => x.name === tableSel.value)!;
      valueSel.replaceChildren(...t.columns.filter((c) => c.role === "measure").map((c) => h("option", { value: c.name, text: c.name })));
      guessUnit();
    };
    // The column's name says its unit: lcr_pct is a percentage, kredite_mio an amount.
    const guessUnit = () => {
      const c = valueSel.value;
      unit = /_pct$|_quote$|_ratio$/i.test(c) ? "%" : /_stk$|_stueck$/i.test(c) ? "Stk" : /_tage$/i.test(c) ? "Tage" : /_h$|_std$/i.test(c) ? "h" : /_tsd$/i.test(c) ? "Tsd" : "Mio";
      drawUnit();
    };
    tableSel.addEventListener("change", fillValues);
    valueSel.addEventListener("change", guessUnit);
    fillValues();
    // Topic ids are slugs, so this value cannot be one of them.
    const NEW = "+neu";
    const topicSel = select([...list.groups.map((g) => [g.id, g.name] as [string, string]), [NEW, "Neues Thema …"]], list.groups[0]?.id || NEW);
    const topicWrap = h("div", { class: "s-newtopic", hidden: topicSel.value !== NEW }, topicName);
    topicSel.addEventListener("change", () => { topicWrap.hidden = topicSel.value !== NEW; if (!topicWrap.hidden) topicName.focus(); });
    const fTable = field("Tabelle", tableSel), fValue = field("Wertspalte", valueSel, "Spalten mit Zahlen aus dieser Tabelle."), fName = field("Name", name),
      fT = field("Ziel (optional)", tgt), fL = field("Limit (optional)", lim), fTopic = field("Thema", topicSel);
    fTopic.wrap.append(topicWrap);
    const m = msgLine();
    const add = btn("Hinzufügen", async () => {
      for (const f of [fTable, fValue, fName, fT, fL, fTopic]) f.err("");
      const t = parseNum(tgt.value), l = parseNum(lim.value), newTopic = topicSel.value === NEW;
      if (!name.value.trim()) return fName.err("Die Kennzahl braucht einen Namen.");
      if (Number.isNaN(t)) return fT.err("Bitte eine Zahl eingeben.");
      if (Number.isNaN(l)) return fL.err("Bitte eine Zahl eingeben.");
      if (newTopic && !topicName.value.trim()) return fTopic.err("Bitte das neue Thema benennen.");
      const def: KpiDef = { id: "", name: name.value.trim(), unit: unit as KpiDef["unit"], dec: unit === "%" ? 1 : 0, kind: kind as KpiDef["kind"], dir: dir as KpiDef["dir"],
        target: t, limit: l, group: newTopic ? "" : topicSel.value, groupName: newTopic ? topicName.value.trim() : "", monthly: { table: tableSel.value, value: valueSel.value } };
      let made: KpiDef;
      try { made = await api.addKpi(def); } catch (e) { routeKpiErr(errText(e), { name: fName, where: fValue, topic: fTopic }, m); return; }
      dataChanged = true;
      editing = "";
      flash("kpi", `${made.name} ist dazugekommen${made.status && made.status !== "ok" ? ", aber " + made.status : ""}. Die Seiten zeigen sie, sobald du die Einstellungen schliesst.`, made.status && made.status !== "ok" ? "bad" : "ok");
      await loadKpis();
    }, "primary");
    return h("div", { class: "s-kedit is-new" },
      h("h4", { text: "Neue Kennzahl" }), fTable.wrap, fValue.wrap, fName.wrap,
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Einheit" }), unitBox),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Art" }), choice("Art", KINDS, kind, (v) => (kind = v), { stacked: true })),
      h("div", { class: "s-field" }, h("span", { class: "s-flabel", text: "Richtung" }), choice("Richtung", DIRS, dir, (v) => (dir = v))),
      h("div", { class: "s-pair" }, fT.wrap, fL.wrap), note("Ziel und Limit in der Einheit der Wertspalte, Beträge in Mio. CHF."),
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
      if (state.source === "umgebung") kids.push(h("p", { class: "s-sec", text: `Durch eine Umgebungsvariable gesetzt${state.hint ? `, endet auf ${state.hint}` : ""}.` }));
      else if (state.set && !changing) kids.push(h("p", { class: "s-sec" }, h("i", { class: "s-led ok", "aria-hidden": "true" }), `Gespeichert, endet auf ${state.hint}`),
        actions(h("button", { type: "button", class: "s-btn", onclick: () => { changing = true; draw(); box.querySelector("input")?.focus(); } }, "Ändern"),
          btn("Entfernen", async () => { try { await api.setSecret(key, ""); await after(`${what} entfernt.`); } catch (e) { m.set(errText(e), "bad"); } }, "danger")));
      else {
        const inp = textInput("", { type: "password", placeholder: key === "anthropicToken" ? "sk-ant-…" : "Token", "aria-label": label });
        const store = btn("Speichern", async () => {
          if (!inp.value.trim()) { m.set("Bitte zuerst das Token einfügen.", "bad"); return; }
          try { await api.setSecret(key, inp.value.trim()); await after(`${what} gespeichert.`); } catch (e) { m.set(errText(e), "bad"); }
        }, "primary");
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") store.click(); });
        kids.push(h("div", { class: "s-inline" }, inp, store), ...(changing ? [h("button", { type: "button", class: "s-btn quiet", onclick: () => { changing = false; draw(); } }, "Abbrechen")] : []),
          note("Wird auf dem Server gespeichert, nicht in der Konfiguration, und nie wieder angezeigt."));
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
    const state = ai.ready ? `Lumina beantwortet Fragen mit ${model ? model.name : ai.model}.` : !ai.enabled ? "Die KI ist aus. Lumina sucht in deiner Frage nach Stichwörtern." : "Es fehlt ein API-Token. Bis dahin sucht Lumina nach Stichwörtern.";
    const base = textInput(ai.baseURL, { placeholder: "https://api.anthropic.com", inputmode: "url", disabled: locked("baseURL") });
    const fBase = field("Adresse (optional)", base, locked("baseURL") ? "Durch eine Umgebungsvariable festgelegt." : "Nur nötig, wenn Anfragen über ein Firmen-Gateway laufen. Leer heisst direkt zu Anthropic.");
    const applyBase = () => { if (base.value.trim() !== ai.baseURL) void put({ baseURL: base.value.trim() }); };
    base.addEventListener("change", applyBase);
    const test = btn("Verbindung testen", async () => {
      m.set("Lumina fragt kurz bei Claude nach …");
      try {
        const r = await api.testAI();
        const nm = ai.models.find((x) => x.id === r.model)?.name || r.model;
        m.set(r.ok ? `Verbunden mit ${nm}, Antwort in ${thousands(r.ms)} ms.` : r.error || "Die Verbindung klappt nicht.", r.ok ? "ok" : "bad");
      } catch (e) { m.set(errText(e), "bad"); }
    });
    if (!admin(s)) return [
      h("p", { class: "s-status", "data-tone": ai.ready ? "ok" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), state),
      note("Lumina richten Administratoren ein."),
      h("p", { class: "s-privacy" }, "Lumina schickt deine Frage und die Kennzahlen dieses Monats an Anthropic. Keine Datenzeilen aus dem Goldlayer."),
    ];
    return [
      h("p", { class: "s-status", "data-tone": ai.ready ? "ok" : "off" }, h("i", { class: "s-led", "aria-hidden": "true" }), state),
      group("KI", toggle("KI verwenden", ai.enabled, (v) => void put({ enabled: v }), locked("enabled")), locked("enabled") ? note("Durch eine Umgebungsvariable festgelegt.") : null),
      group("Modell", choice("Modell", ai.models.map((x) => ({ v: x.id, name: x.name, note: x.note })), ai.model, (v) => void put({ model: v }), { stacked: true, disabled: locked("model") })),
      group("Zugang", secretBlock("anthropicToken", "API-Token", ai.token, "Das API-Token"), fBase.wrap, actions(test), m.el),
      h("p", { class: "s-privacy" }, "Lumina schickt deine Frage und die Kennzahlen dieses Monats an Anthropic. Keine Datenzeilen aus dem Goldlayer."),
    ];
  }

  // ───────────── Über ─────────────
  function about(s: Settings | null): Node[] {
    const room = host.room();
    const rows: [string, string][] = s ? [
      ["Version", s.version],
      host.kosmos() ? ["Kosmos", `${s.data.name || "ohne Namen"} · ${TYPES.find((t) => t.v === s.data.type)?.name || s.data.type}`] : ["Kosmen", String(s.kosmos.count)],
      ...(admin(s) ? [["Konfiguration", s.configPath + (s.configExists ? "" : " (noch nicht angelegt, es gelten die Standardwerte)")] as [string, string]] : []),
      ...(host.kosmos() && admin(s) ? [["Kennzahlen", s.metrics || (s.kosmos.main ? "eingebaut (ALCO)" : "noch keine")] as [string, string]] : []),
    ] : [];
    const out: Node[] = [h("div", { class: "s-about" }, h("p", { class: "s-word" }, logo(26)), h("p", { class: "s-slogan", text: "Quiet until it matters." }))];
    if (rows.length) out.push(h("dl", { class: "s-facts" }, ...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])));
    else out.push(offline());
    const me = s?.me;
    if (me && me.login !== "none") out.push(group("Angemeldet",
      h("p", { class: "s-sec", text: `${me.name}${me.name !== me.id ? ` (${me.id})` : ""}` }),
      note([me.admin ? "Administrator" : "", me.groups.length ? `Gruppen: ${me.groups.join(", ")}` : "Ohne Gruppen"].filter(Boolean).join(" · ")),
      me.logout ? actions(h("a", { class: "s-btn", href: me.logout }, "Abmelden")) : null));
    if (admin(s)) out.push(group("Firmen-Design", note("Farben, Hausschrift und Logo stehen in der Konfiguration unter «brand». Mit einem eigenen Logo (brand.logo) steht eures oben links, und Lumantic zeichnet mit «powered by lumantic». Eine Vorlage mit dem Beispiel «Musterbank» liegt in config/lumantic.example.json, Logo und Schriftdateien kommen nach config/brand/.")));
    if (room) {
      const m = msgLine();
      const reset = confirmReset
        ? actions(h("button", { type: "button", class: "s-btn danger", onclick: () => { confirmReset = false; room.resetAll(); m.set("Zurückgesetzt.", "ok"); render(); } }, "Ja, zurücksetzen"),
          h("button", { type: "button", class: "s-btn quiet", onclick: () => { confirmReset = false; render(); } }, "Abbrechen"))
        : actions(h("button", { type: "button", class: "s-btn", onclick: () => { confirmReset = true; render(); } }, "Eigene Seiten zurücksetzen"));
      out.push(group("Zurücksetzen", note(confirmReset ? "Deine eigenen Seiten, Notizen und Antworten verschwinden. Luminas Seiten bleiben. Das lässt sich nicht rückgängig machen." : "Entfernt deine eigenen Seiten und Notizen. Luminas Seiten bleiben."), reset, m.el));
    }
    out.push(group("Die Idee", actions(h("button", { type: "button", class: "s-btn quiet", onclick: () => { close(); $("btn-idee").click(); } }, "Die Idee und ihre Quellen"))));
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
