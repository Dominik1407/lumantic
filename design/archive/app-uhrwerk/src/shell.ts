// The frame around every view: app bar (top), navigator (left), time bar
// (bottom) and, on phones, a tab bar. Time and place are always visible.
import { h, icon, sv } from "./dom";
import { levelCounts } from "./engine";
import { dayMid } from "./format";
import { DAYS, EVENTS, N, PERIODS, SCOPES, clamp, monthFromKey, monthKey, scopeOrder } from "./model";
import { goLive, jumpTo, openDashboard, showHeute, showOverview, showZeit, toggleTime } from "./nav";
import { openPalette, openShortcuts, paletteOpen } from "./palette";
import { openPrinciples } from "./principles";
import { S, isLive, month, play, setTime, step, stopGlide, stopPlay, glideTo, syncPlay, timeHooks, togglePlay, type Design } from "./time";
import { dots, hideTip, tipOn, toast } from "./ui";
import { scopeIcon } from "./views/today";
import { W, local, saveWorkspace } from "./workspace";

const el = {} as {
  modes: HTMLElement;
  crumbs: HTMLElement;
  rail: HTMLElement;
  railItems: Record<string, HTMLElement>;
  railDots: Record<string, HTMLElement>;
  moments: HTMLElement;
  track: HTMLElement;
  handle: HTMLElement;
  handleLab: HTMLElement;
  tbLabel: HTMLElement;
  live: HTMLElement;
  pin: HTMLElement;
  pins: HTMLElement;
  tabs: HTMLElement;
};

const DESIGNS: { id: Design; name: string; bg: string; ring: string }[] = [
  { id: "atlas", name: "Atlas", bg: "#0b1122", ring: "#d6b06a" },
  { id: "zifferblatt", name: "Zifferblatt", bg: "#ffffff", ring: "#2348b5" },
  { id: "messtisch", name: "Messtisch", bg: "#0b1f36", ring: "#7fd3f7" },
];
const DESIGN_NOTE: Record<Design, string> = { atlas: "Atlas: Nacht, Messing, Sternenlicht.", zifferblatt: "Zifferblatt: Porzellan, Kobalt, Schweizer Präzision.", messtisch: "Messtisch: Blaupause, Raster, Plotterlinien." };

export function setDesign(d: Design, announce = true) {
  const apply = () => {
    if (d === "atlas") document.documentElement.removeAttribute("data-design");
    else document.documentElement.setAttribute("data-design", d);
    S.design = d;
    document.querySelectorAll<HTMLElement>(".design-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.design === d)));
  };
  type Transition = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => Transition }).startViewTransition;
  if (announce && vt && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // A second switch skips the first transition; that is expected, not an error.
    const t = vt.call(document, apply);
    for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => {});
  } else apply();
  if (announce) {
    W.design = d;
    saveWorkspace();
    toast(DESIGN_NOTE[d]);
  }
}

function railItem(key: string, ic: string, label: string, kbd: string, on: () => void, extra?: Node) {
  const b = h("button", { class: "rail-item", type: "button", onclick: on, title: label }, icon(ic), h("span", { class: "rail-label", text: label }), extra || null, h("kbd", { text: kbd }));
  el.railItems[key] = b;
  return b;
}

function buildRail() {
  el.railItems = {};
  el.railDots = {};
  const dashes = scopeOrder().map((scope, i) => {
    const d = h("span", { class: "rail-dots" });
    el.railDots[scope] = d;
    return railItem("dash:" + scope, scopeIcon(scope), SCOPES[scope], String(i + 1), () => openDashboard(scope), d);
  });
  el.moments = h("div", { class: "rail-moments" });
  el.rail = h("nav", { class: "rail", "aria-label": "Navigation" },
    h("div", { class: "rail-sec" }, h("span", { class: "rail-head label", text: "Übersicht" }),
      railItem("heute", "heute", "Heute", "H", () => showHeute()),
      railItem("zeit", "zeit", "Zeitreise", "Z", () => (S.view === "zeit" ? undefined : showZeit()))),
    h("div", { class: "rail-sec" }, h("span", { class: "rail-head label", text: "Dashboards" }), dashes),
    h("div", { class: "rail-sec rail-sec--moments" }, h("span", { class: "rail-head label", text: "Zeitpunkte" }), el.moments),
    h("button", { class: "rail-collapse", type: "button", "aria-label": "Navigation ein- oder ausklappen", onclick: () => toggleRail() }, icon("chevron", 14)));
  renderMoments();
  return el.rail;
}

function toggleRail(force?: boolean) {
  const shell = document.querySelector(".shell")!;
  const slim = force ?? !shell.classList.contains("is-slim");
  shell.classList.toggle("is-slim", slim);
  local.set("rail", slim ? "slim" : "wide");
}

function renderMoments() {
  const pins = [...W.pins].map(monthFromKey).filter((t) => t >= 0 && t < N).sort((a, b) => b - a);
  const evs = [...EVENTS].sort((a, b) => b.t - a.t);
  el.moments.replaceChildren(
    ...pins.map((t) => h("div", { class: "moment moment--pin" },
      h("button", { type: "button", class: "moment-go", onclick: () => jumpTo(t) }, icon("pin", 13), h("span", { text: PERIODS.monat[t].long })),
      h("button", { type: "button", class: "moment-x", "aria-label": "Nicht mehr merken", onclick: () => togglePin(t) }, icon("close", 12)))),
    ...evs.map((e) => h("button", { type: "button", class: "moment", title: e.text, onclick: () => jumpTo(e.t) }, icon("event", 12), h("span", { text: e.title }), h("small", { text: PERIODS.monat[e.t].label }))));
  renderPins();
}

export function togglePin(t = month()) {
  if (t >= N - 1) { toast("Heute ist schon oben links. Merken lohnt sich für Momente in der Vergangenheit."); return; }
  const key = monthKey(t), had = W.pins.includes(key);
  W.pins = had ? W.pins.filter((p) => p !== key) : [...W.pins, key];
  saveWorkspace();
  renderMoments();
  updateTimebar();
  toast(had ? `${PERIODS.monat[t].long} nicht mehr gemerkt.` : `${PERIODS.monat[t].long} gemerkt. Du findest den Moment links unter Zeitpunkte.`);
}

function buildTimebar() {
  const svg = sv("svg", { viewBox: "0 0 1000 40", preserveAspectRatio: "none", "aria-hidden": "true" });
  for (let m = 0; m < N; m++) {
    const c = levelCounts(m), x = (m / N) * 1000, w = 1000 / N - 1.2, hgt = c.alert ? 9 + c.alert * 7 : c.watch ? 7 : 3;
    svg.append(sv("rect", { x: x.toFixed(1), y: 28 - hgt, width: w.toFixed(1), height: hgt, fill: c.alert ? "var(--alert)" : c.watch ? "var(--watch)" : "var(--ink)", "fill-opacity": c.alert ? 0.85 : c.watch ? 0.6 : 0.18 }));
  }
  svg.append(sv("line", { x1: 0, x2: 1000, y1: 28.5, y2: 28.5, stroke: "var(--line-2)", "vector-effect": "non-scaling-stroke" }));
  const years: HTMLElement[] = [];
  for (let m = 0; m < N; m++) if (PERIODS.monat[m].label.startsWith("Jan") || m === 0) years.push(h("span", { class: "tb-year", style: `left:${(m / N) * 100}%`, text: String(PERIODS.monat[m].y) }));
  const evs = EVENTS.map((e) => {
    const b = h("button", { class: "tb-event", type: "button", style: `left:${((e.t + 0.5) / N) * 100}%`, "aria-label": e.title, onclick: (ev: Event) => { ev.stopPropagation(); jumpTo(e.t); } });
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    tipOn(b, PERIODS.monat[e.t].long, `${e.title}. ${e.text}`);
    return b;
  });
  el.pins = h("div", { class: "tb-pins" });
  el.handleLab = h("span");
  el.handle = h("div", { class: "tb-handle" }, el.handleLab);
  el.track = h("div", { class: "tb-track", role: "slider", tabindex: "0", "aria-label": "Zeitpunkt wählen", "aria-valuemin": "0", "aria-valuemax": String(N - 1) }, svg, ...years, ...evs, el.pins, el.handle);
  el.tbLabel = h("span", { class: "tb-label num" });
  el.pin = h("button", { class: "tb-icon", type: "button", "aria-label": "Diesen Zeitpunkt merken", title: "Zeitpunkt merken (M)", onclick: () => togglePin() }, icon("pin"));
  el.live = h("button", { class: "tb-live", type: "button", onclick: () => (S.view === "heute" ? undefined : goLive()) });
  const ctrl = (ic: string, label: string, on: () => void, attrs: Record<string, string> = {}) => h("button", { class: "tb-icon", type: "button", "aria-label": label, title: label, onclick: on, ...attrs }, icon(ic));
  const bar = h("footer", { class: "timebar", "aria-label": "Zeitleiste" },
    h("div", { class: "tb-ctrl" },
      ctrl("first", "Zum Anfang", () => jumpTo(0)),
      h("button", { class: "tb-icon play-btn", type: "button", "data-play": "", title: "Abspielen (Leertaste)", onclick: () => playFromAnywhere() }, icon("play"), icon("pause")),
      ctrl("prev", "Ein Monat zurück (←)", () => stepFromAnywhere(-1)),
      ctrl("next", "Ein Monat vor (→)", () => stepFromAnywhere(1))),
    el.track,
    h("div", { class: "tb-now" }, el.tbLabel, el.pin, el.live));
  wireTrack();
  return bar;
}

function wireTrack() {
  let drag = false;
  const tAt = (e: PointerEvent) => { const b = el.track.getBoundingClientRect(); return clamp(((e.clientX - b.left) / b.width) * N - 0.5, 0, N - 1); };
  el.track.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    drag = true;
    stopPlay();
    stopGlide();
    // Grabbing the time on Heute is a trip: the dial takes over.
    if (S.view === "heute") showZeit({ t: tAt(e), instant: true });
    el.track.setPointerCapture(e.pointerId);
    S.scrubbing = true;
    setTime(tAt(e));
  });
  el.track.addEventListener("pointermove", (e) => {
    if (drag) setTime(tAt(e));
    else {
      const t = Math.round(tAt(e));
      el.track.title = PERIODS.monat[t].long;
    }
  });
  const end = () => { if (!drag) return; drag = false; S.scrubbing = false; glideTo(Math.round(S.t), 300); };
  el.track.addEventListener("pointerup", end);
  el.track.addEventListener("pointercancel", end);
  el.track.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Home") return jumpTo(0);
    if (e.key === "End") return goLive();
    stepFromAnywhere((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 12 : 1));
  });
}

function playFromAnywhere() {
  if (S.view === "heute") { showZeit({ t: 0, instant: true }); play(); }
  else togglePlay();
}

function stepFromAnywhere(d: number) {
  if (S.view === "heute") { if (d < 0) showZeit({ t: N - 1 + d }); return; }
  step(d);
}

function renderPins() {
  if (!el.pins) return;
  el.pins.replaceChildren(...W.pins.map(monthFromKey).filter((t) => t >= 0 && t < N).map((t) => h("span", { class: "tb-pin", style: `left:${((t + 0.5) / N) * 100}%` })));
}

function updateTimebar() {
  const m = month(), live = isLive(), pinned = W.pins.includes(monthKey(m));
  el.tbLabel.textContent = live ? (S.view === "heute" && DAYS.length ? `Heute · ${dayMid(DAYS[DAYS.length - 1]).replace(/^\w+, /, "")}` : `Heute · ${PERIODS.monat[m].label}`) : PERIODS.monat[m].long;
  el.live.dataset.live = String(live);
  el.live.replaceChildren(h("i"), live ? "Aktuell" : "Zurück zu heute");
  el.live.setAttribute("aria-label", live ? "Du siehst die aktuellen Werte" : "Zurück zu den aktuellen Werten");
  el.pin.setAttribute("aria-pressed", String(pinned));
  el.pin.hidden = live;
  el.handleLab.textContent = PERIODS.monat[m].label;
  el.track.setAttribute("aria-valuenow", String(m));
  el.track.setAttribute("aria-valuetext", PERIODS.monat[m].long);
  document.querySelector(".shell")?.classList.toggle("is-past", !live);
}

function updateRailDots() {
  const m = month();
  for (const [scope, d] of Object.entries(el.railDots)) d.replaceChildren(dots(levelCounts(m, scope)));
}

function buildTabs() {
  const tab = (key: string, ic: string, label: string, on: () => void) => h("button", { class: "tab", type: "button", "data-tab": key, onclick: on }, icon(ic, 18), h("span", { text: label }));
  el.tabs = h("nav", { class: "tabbar", "aria-label": "Hauptnavigation" },
    tab("heute", "heute", "Heute", () => showHeute()),
    tab("zeit", "zeit", "Zeitreise", () => (S.view === "zeit" ? undefined : showZeit())),
    tab("dash", "all", "Dashboards", () => openSheet()),
    tab("search", "search", "Suchen", () => openPalette()));
  return el.tabs;
}

// Phones: the dashboards as a bottom sheet.
function openSheet() {
  const m = month();
  const scrim = h("div", { class: "scrim" });
  const close = () => { scrim.remove(); sheet.remove(); };
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "Dashboards" },
    h("span", { class: "label", text: `Dashboards · ${isLive() ? "heute" : PERIODS.monat[m].long}` }),
    scopeOrder().map((scope) => h("button", { class: "rail-item", type: "button", onclick: () => { close(); openDashboard(scope); } },
      icon(scopeIcon(scope)), h("span", { class: "rail-label", text: SCOPES[scope] }), h("span", { class: "rail-dots" }, dots(levelCounts(m, scope))))));
  scrim.addEventListener("click", close);
  document.body.append(scrim, sheet);
}

export function updateShell() {
  const live = isLive(), m = month();
  const mode = S.view === "heute" || (S.view === "dash" && live) ? "heute" : "zeit";
  el.modes.dataset.mode = mode;
  el.modes.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  for (const [key, item] of Object.entries(el.railItems)) {
    const active = key === S.view || (S.view === "dash" && key === "dash:" + S.scope);
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
  }
  el.tabs.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === (S.view === "dash" ? "dash" : S.view)));
  const when = live ? "" : PERIODS.monat[m].long;
  const place = S.view === "heute" ? "Tagesübersicht" : S.view === "zeit" ? "Zeitreise" : SCOPES[S.scope || "all"];
  const kids: (Node | string)[] = [];
  if (S.view === "dash") kids.push(h("button", { type: "button", onclick: () => showOverview() }, live ? "Heute" : "Zeitreise"), h("span", { class: "sep", text: "›" }));
  kids.push(h("b", { text: place }));
  if (when) kids.push(h("span", { class: "when when--past", text: when }));
  el.crumbs.replaceChildren(...kids);
  document.title = `${place}${when ? " · " + when : ""} · Lumantic`;
  updateTimebar();
  updateRailDots();
  syncPlay();
}

export function buildShell(root: HTMLElement) {
  el.modes = h("div", { class: "modes", role: "group", "aria-label": "Heute oder Zeitreise" },
    h("span", { class: "modes-ind", "aria-hidden": "true" }),
    h("button", { type: "button", "data-mode": "heute", title: "Tagesübersicht (H)", onclick: () => showHeute() }, icon("heute"), h("span", { text: "Heute" })),
    h("button", { type: "button", "data-mode": "zeit", title: "Zeitreise (Z wechselt hin und her)", onclick: () => (S.view === "zeit" ? undefined : showZeit(S.view === "dash" && !isLive() ? { t: month() } : {})) }, icon("zeit"), h("span", { text: "Zeitreise" })));
  el.crumbs = h("nav", { class: "crumbs", "aria-label": "Ort" });
  const designs = h("div", { class: "designs", role: "group", "aria-label": "Designsprache" },
    DESIGNS.map((d) => h("button", { class: "design-btn", type: "button", "data-design": d.id, "aria-pressed": String(S.design === d.id), title: d.name, onclick: () => setDesign(d.id) },
      h("i", { style: `background:${d.bg};border-color:${d.ring}` }), h("span", { text: d.name }))));
  const appbar = h("header", { class: "appbar" },
    h("button", { class: "brand", type: "button", onclick: () => showHeute(), "aria-label": "Lumantic, zur Tagesübersicht" },
      h("span", { class: "mark", "aria-hidden": "true" }), h("span", { class: "word", text: "lumantic" }), h("span", { class: "slogan", text: "Quiet until it matters." })),
    el.modes, el.crumbs,
    h("button", { class: "search", type: "button", onclick: () => openPalette() }, icon("search"), h("span", { text: "Springe zu …" }), h("kbd", { text: navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K" })),
    designs,
    h("button", { class: "tb-icon", type: "button", title: "Tastenkürzel (?)", "aria-label": "Tastenkürzel", onclick: () => openShortcuts() }, icon("keys")),
    h("button", { class: "btn btn--why", type: "button", onclick: () => openPrinciples() }, "Warum so?"));
  const shell = h("div", { class: "shell" }, appbar, buildRail(), h("div", { class: "col" }, h("main", { id: "view", class: "main gutter" }), buildTimebar()));
  root.replaceChildren(shell, buildTabs());
  const pref = local.get("rail");
  if (pref === "slim" || (pref === null && innerWidth < 1180)) toggleRail(true);
  timeHooks.add((mc) => {
    el.handle.style.left = ((S.t + 0.5) / N) * 100 + "%";
    if (mc) updateShell();
  });
  wireKeys();
}

function wireKeys() {
  document.addEventListener("keydown", (e) => {
    if (paletteOpen() || document.querySelector(".drawer, .sheet, .keys")) return;
    const t = e.target as HTMLElement, tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t.getAttribute("role") === "slider" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    const key = e.key;
    if (key === "/") { e.preventDefault(); openPalette(); }
    else if (key === "?") { e.preventDefault(); openShortcuts(); }
    else if (key === "h" || key === "H") showHeute();
    else if (key === "z" || key === "Z") toggleTime();
    else if (key === "m" || key === "M") togglePin();
    else if (/^[1-9]$/.test(key) && scopeOrder()[Number(key) - 1]) openDashboard(scopeOrder()[Number(key) - 1]);
    else if (key === " " && tag !== "BUTTON") { e.preventDefault(); playFromAnywhere(); }
    else if (key === "ArrowLeft" || key === "ArrowRight") { e.preventDefault(); stepFromAnywhere((key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 12 : 1)); }
    else if (key === "Escape") { hideTip(); if (S.view === "dash") showOverview(); else if (S.view === "zeit") showHeute(); }
  });
}
