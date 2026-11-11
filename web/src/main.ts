// Lumantic: the main menu of Kosmen, or one Kosmos: its room on the gold layer's figures. Both are dressed in the
// chosen design, with the settings beside them. Where the page is says its address:
//   /            the main menu when there is more than one Kosmos, else the only Kosmos
//   /?k=<id>     that Kosmos
//   /?kosmen     the main menu, also with a single Kosmos («?kosmen=neu» opens the form for a new one)
// The fonts ship with the app (latin subset, only the weights in use), so it also works in a network without Google.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-500.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/sora/latin-400.css";
import "@fontsource/sora/latin-500.css";
import "@fontsource/sora/latin-600.css";
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/martian-mono/latin-500.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./styles/themes.css";
import "./styles/kosmos.css";
import "./styles/app.css";
import "./styles/settings.css";
import "./styles/menu.css";
import "./styles/catalog.css";

import { bootKosmos, type KosmosRoom } from "virtual:kosmos";
import { api, ApiError, MAIN, setKosmos, type KosmosInfo, type MetricsData, type Settings } from "./api";
import { $, h } from "./dom";
import { brandLogo, companyLogo, poweredBy } from "./logo";
import { gear, showMenu } from "./menu";
import { P, flush, initPrefs, saveKosmos, setPref, storedKosmos } from "./prefs";
import { applyLook, designOf, installCorporate } from "./themes";
import { createSettings, TYPES } from "./settings";
import { createCatalog } from "./catalog";

const LENS_BACK = { "1M": 1, "1Q": 3, "1J": 12 } as const;
const systemStill = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => P.motion === "ruhig" || systemStill.matches;
const query = new URLSearchParams(location.search);

let room: KosmosRoom | null = null;
let settings: Settings | null = null;
let kosmen: KosmosInfo[] = [];
let here = ""; // the Kosmos this page shows; "" in the main menu

// The Sternkatalog: inside a Kosmos its own, in the main menu every Kosmos's. «Zeigen» flies to the figure, or goes
// into its Kosmos and flies there once the room stands.
const catalog = createCatalog({
  kosmos: () => here,
  kosmen: () => kosmen.map((k) => ({ id: k.id, name: k.name })),
  still: () => still(),
  show: (id, kpi) => {
    if (here === id && room) { room.home(kpi); return; }
    try { sessionStorage.setItem("lumantic.home", kpi); } catch { /* the room opens as usual */ }
    toKosmos(id);
  },
});

// ───────────── Getting around ─────────────
const path = location.pathname;
async function go(url: string) { await flush(); location.assign(url); }
const toKosmos = (id: string) => void go(`${path}?k=${encodeURIComponent(id)}`);
// The main menu. With a single Kosmos the plain address leads into it, so the menu has to be asked for.
const toMenu = (what = "") => void go(what ? `${path}?kosmen=${what}` : kosmen.length > 1 ? path : `${path}?kosmen`);
// Out of a Kosmos: the room dims, then the menu takes over.
function leave() {
  if (!here || kosmen.length < 2) return;
  if (still()) { toMenu(); return; }
  $("app").classList.add("is-away");
  setTimeout(() => toMenu(), 190);
}

const sheet = createSettings({
  settings: () => settings,
  setSettings: (s) => { settings = s; showBrand(); },
  room: () => room,
  look: (what) => {
    applyLook(P, systemStill.matches);
    if (what === "design") showBrand();
    if (!room) return;
    if (what === "motion") room.setMotion(still());
    else if (what === "lens") room.setLensBack(LENS_BACK[P.lens]);
    else if (what === "hints") room.setHints(P.hints);
    else room.retheme();
  },
  // New figures or a new source: the room is built from the figures, so it is built again.
  reload: async () => { await flush(); location.reload(); },
  kosmos: () => here,
  kosmen: () => kosmen,
  enter: toKosmos,
  catalog: (kpi) => void catalog.open(kpi || ""),
  menu: toMenu,
});

// The corner of the app: the logo (the company's, if the config names one), and inside one of several Kosmen its name.
function showBrand() {
  const dark = designOf(P.design).dark, b = settings?.brand, own = !!companyLogo(b, dark);
  const many = !!here && kosmen.length > 1;
  const home = many ? h("button", { type: "button", class: "brand-home", title: "Alle Kosmen (Taste K)", onclick: leave }) : h("span", { class: "brand-home" });
  home.append(brandLogo(b, dark));
  if (!own && b?.name) home.append(h("span", { class: "corp", text: b.name }));
  const name = kosmen.find((k) => k.id === here)?.name;
  if (many && name) home.append(h("span", { class: "kname", text: name }));
  $("brand").replaceChildren(home);
  $("powered").replaceChildren(...(own ? [poweredBy()] : []));
  $("powered").hidden = !own;
}

// The very first start, before there is a config: where the gold layer lives, as five cards. A card opens the form
// for that kind of source; testing, saving and the first key figure follow there.
function welcome(): HTMLElement {
  return h("div", { class: "empty-in welcome" },
    h("p", { class: "step", text: "Ersteinrichtung" }),
    h("h1", { text: "Wo liegt dein Goldlayer?" }),
    h("p", { text: "Lumantic liest nur. Es fragt die Datenbank nach Summen pro Monat, nie nach einzelnen Zeilen." }),
    h("div", { class: "kinds", role: "list" }, ...TYPES.map((t, i) => h("button", { type: "button", class: "kind", role: "listitem", style: `--i:${i}`, onclick: () => sheet.setup(t.v) },
      h("span", { class: "kind-n", text: t.name }), h("span", { class: "kind-note", text: t.note })))),
    h("p", { class: "why", text: "Alles lässt sich später in den Einstellungen ändern, auch weitere Kosmen über andere Datenbanken." }));
}

// New figures: the server reads a Kosmos again on a schedule, on a loading job's word or when its files change, and tells
// every open page. A page in the background takes them at once; a page being read offers them and waits.
interface Fresh { kosmos: string; ok: boolean; changed: boolean; at: string; by: string }
function listen() {
  if (typeof EventSource === "undefined") return;
  new EventSource("/api/events").addEventListener("refresh", (msg) => {
    let ev: Fresh;
    try { ev = JSON.parse((msg as MessageEvent).data); } catch { return; }
    // A read by hand comes from the settings, which rebuild the room themselves.
    if (!ev.ok || !ev.changed || ev.by === "hand" || (here && ev.kosmos !== here)) return;
    if (document.hidden) { resume(); return; }
    const at = new Date(ev.at), time = Number.isNaN(+at) ? "" : `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const name = !here ? kosmen.find((k) => k.id === ev.kosmos)?.name : "";
    const bar = $("fresh");
    bar.replaceChildren(h("span", { text: `Neue Zahlen${name ? ` in «${name}»` : ""}${time ? ` · Stand ${time}` : ""}` }),
      h("button", { type: "button", class: "fresh-go", onclick: resume }, "Zeigen"),
      h("button", { type: "button", class: "fresh-x", title: "Später", "aria-label": "Später", onclick: () => { bar.hidden = true; } }, "×"));
    bar.hidden = false;
  });
}
// Shows the new figures: the page loads again and opens where the person was.
function resume() {
  try { sessionStorage.setItem("lumantic.resume", here || "menu"); } catch { /* it opens as usual */ }
  location.reload();
}

// Without figures there is no room: one sentence, one way forward, and the settings stay reachable.
function showEmpty(err: unknown) {
  const msg = err instanceof ApiError ? err.message : "Der Server antwortet nicht.";
  const noData = err instanceof ApiError && err.status === 503, st = settings?.status;
  const noFigures = noData && !!st && st.tables > 0 && st.kpis === 0;
  const name = kosmen.find((k) => k.id === here)?.name || "Die Datenquelle";
  const first = noData && !noFigures && settings?.configExists === false && here === MAIN;
  // Signed in, but no Kosmos is open to this person: nothing to set up, someone has to grant it.
  const barred = err instanceof ApiError && err.status === 403;
  $("empty").replaceChildren(barred ? h("div", { class: "empty-in" },
    h("h1", { text: "Noch kein Kosmos für dich." }),
    h("p", { text: "Dir ist noch kein Kosmos freigegeben. Frag einen Administrator nach der Gruppe, die ihn sieht." }),
    h("p", { class: "why", text: msg })) : first ? welcome() : h("div", { class: "empty-in" },
    h("h1", { text: noFigures ? "Noch keine Kennzahlen." : noData ? "Noch keine Daten verbunden." : "Die Kennzahlen lassen sich gerade nicht laden." }),
    h("p", { text: noFigures ? `«${name}» ist verbunden. Sag Lumantic, welche Spalten Kennzahlen sind. Danach baut Lumina hier die Seiten.`
      : noData ? "Verbinde einen Goldlayer oder einen Ordner mit Tabellen. Danach baut Lumina hier die Seiten." : "Prüf die Datenquelle in den Einstellungen oder lade die Seite neu." }),
    h("button", { class: "btn", type: "button", onclick: () => sheet.open("daten", noFigures ? "kennzahl" : "") }, noFigures ? "Kennzahl hinzufügen" : "Datenquelle einrichten"),
    noFigures ? null : h("p", { class: "why", text: msg })));
  $("empty").hidden = false;
  $("places").replaceChildren(gear(() => sheet.toggle()));
  // The idea note belongs to the room; its place stays, so the gear sits where it always does.
  $("btn-idee").style.visibility = "hidden";
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") { sheet.close(); return; }
    if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey || sheet.isOpen()) return;
    if (e.key === ",") { e.preventDefault(); sheet.open(); }
    else if (e.key === "k" || e.key === "K") leave();
  });
}

// One Kosmos: its figures, its pages, its room.
async function bootRoom(id: string) {
  here = id;
  setKosmos(id);
  const [s, shared, own, m] = await Promise.allSettled([api.settings(), api.sharedWorkspace(), id === MAIN ? Promise.resolve(null) : api.workspace(), api.metrics()]);
  settings = s.status === "fulfilled" ? s.value : null;
  installCorporate(settings?.brand.designs);
  initPrefs(settings?.ui, shared.status === "fulfilled" ? shared.value : null, id, own.status === "fulfilled" ? own.value : null);
  applyLook(P, systemStill.matches);
  showBrand();
  if (m.status === "rejected") { showEmpty(m.reason); sheet.reopenAfterReload(); return; }
  const data: MetricsData = m.value;
  let arrived = false, resumed = false;
  try {
    arrived = sessionStorage.getItem("lumantic.arrive") === id;
    resumed = sessionStorage.getItem("lumantic.resume") === id;
    sessionStorage.removeItem("lumantic.arrive");
    sessionStorage.removeItem("lumantic.resume");
  } catch { /* the usual opening */ }
  room = bootKosmos(data, {
    reduced: still,
    save: saveKosmos,
    stored: storedKosmos,
    onPlace: (place) => { if (P.lastPage !== place) setPref("lastPage", place); },
    lensBack: () => LENS_BACK[P.lens],
    aiReady: () => !!settings?.ai.ready,
    ask: (question, month, facts) => api.ask(question, month, facts),
    openSettings: () => sheet.open(),
    closeSettings: () => sheet.close(),
    settingsOpen: () => sheet.isOpen(),
    // Back with new figures: the room opens on the page the person was reading, without the long opening.
    prefs: () => (resumed ? { ...P, start: "zuletzt" } : P),
    leave,
    openCatalog: (kpi) => void catalog.open(kpi || ""),
    closeCatalog: () => catalog.close(),
    catalogOpen: () => catalog.isOpen(),
    arrived: () => arrived || resumed,
  });
  // Coming from the Sternkatalog of the main menu: fly to the figure that was asked for.
  try {
    const kpi = sessionStorage.getItem("lumantic.home");
    sessionStorage.removeItem("lumantic.home");
    if (kpi && data.kpis.some((k) => k.id === kpi)) setTimeout(() => room?.home(kpi), still() ? 50 : 2600);
  } catch { /* nothing to fly to */ }
  // For the real-time tests (scripts/ui-test): a read-only window into the room.
  Object.defineProperty(window, "__kosmos", { value: room.debug });
  const fine = $("idee-fine");
  if (fine) fine.textContent = [data.source || settings?.data.name, data.months.length ? `${data.months.length} Monate` : ""].filter(Boolean).join(" · ");
  sheet.reopenAfterReload();
}

// The main menu: no room, every Kosmos as a small sky.
async function bootMenu(note: string) {
  try { sessionStorage.removeItem("lumantic.resume"); } catch { /* nothing to resume in the menu */ }
  const [s, shared] = await Promise.allSettled([api.settings(), api.sharedWorkspace()]);
  settings = s.status === "fulfilled" ? s.value : null;
  installCorporate(settings?.brand.designs);
  initPrefs(settings?.ui, shared.status === "fulfilled" ? shared.value : null, "");
  applyLook(P, systemStill.matches);
  showBrand();
  void showMenu(kosmen, { enter: toKosmos, settings: () => sheet.toggle(), add: () => sheet.open("daten", "kosmos"), settingsOpen: () => sheet.isOpen() || catalog.isOpen(),
    closeSettings: () => catalog.close() || sheet.close(), still, catalog: () => void catalog.open(), canAdd: () => settings?.me?.admin !== false }, note);
  Object.defineProperty(window, "__menu", { value: true });
  if (query.get("kosmen") === "neu") sheet.open("daten", "kosmos");
}

async function boot() {
  // An older server knows one Kosmos only; the app then shows that one.
  kosmen = await api.kosmen().catch(() => [{ id: MAIN, name: "", type: "duckdb", main: true, status: { ok: true, error: "", tables: 0, kpis: 0, kpisLoaded: 0, months: 0, first: "", last: "", refreshedAt: "" } }] as KosmosInfo[]);
  listen();
  const k = query.get("k");
  if (k && kosmen.some((x) => x.id === k)) return bootRoom(k);
  if (k) return bootMenu("Diesen Kosmos gibt es nicht mehr. Hier sind die, die es gibt.");
  if (query.has("kosmen") || kosmen.length > 1) return bootMenu("");
  return bootRoom(kosmen[0]?.id || MAIN);
}

systemStill.addEventListener("change", () => { applyLook(P, systemStill.matches); room?.setMotion(still()); });
// What the person built is saved before the tab closes, also when the last change is younger than the save delay.
addEventListener("pagehide", () => { void flush(); });
// Coming back with the browser's back button shows the page as it was left: undo the dimming of «leave».
addEventListener("pageshow", () => $("app").classList.remove("is-away"));
void boot();
