// The main menu: every Kosmos a person can see, each as a small sky of its own. From here you fly into one.
// A Kosmos is drawn the way its room looks from far away: one star per key figure, gathered by topic, and only what
// needs you is lit. The line under it is the one Lumina writes on top of «Heute» in that room.
import { readKosmos, type KosmosSummary } from "virtual:kosmos";
import { api, type KosmosInfo } from "./api";
import { $, h, sv } from "./dom";

export interface MenuHost {
  enter(id: string): void; // go into a Kosmos
  settings(): void; // open the settings
  add(): void; // open the form for a new Kosmos
  settingsOpen(): boolean;
  closeSettings(): boolean;
  still(): boolean;
  catalog(): void; // the Sternkatalog of every Kosmos
  canAdd(): boolean; // may connect a further Kosmos (admins)
}

const NUM = ["Kein", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
const TYPE: Record<string, string> = { duckdb: "DuckDB-Datei", files: "Ordner mit Dateien", snowflake: "Snowflake", databricks: "Databricks", windmill: "Windmill" };
const rad = (deg: number) => (deg * Math.PI) / 180;
// A small steady number from a name, so a sky looks the same every time without looking ruled.
const hash = (s: string) => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 9973; return x; };

// One star, in the shape its status has in the room: diamond needs you, triangle to watch, ringed dot good news.
function star(x: number, y: number, s: KosmosSummary["stars"][number], i: number): SVGElement {
  const g = sv("g", { class: "km-star", style: `--i:${i}` });
  if (s.gap) g.append(sv("circle", { class: "km-none", r: 2.2 }));
  else if (s.level === "alert") g.append(sv("circle", { class: "km-halo", r: 11 }), sv("path", { class: "km-al", d: "M0-6.2 6.2 0 0 6.2-6.2 0Z" }));
  else if (s.level === "watch") g.append(sv("path", { class: "km-wa", d: "M0-5.6 5.4 4-5.4 4Z" }));
  else if (s.kind === "good") g.append(sv("circle", { class: "km-go-ring", r: 4.6 }), sv("circle", { class: "km-go", r: 2 }));
  else g.append(sv("circle", { class: "km-calm", r: 2.3 }));
  const t = sv("title");
  t.textContent = s.name;
  g.append(t);
  // The outer group puts the star in its place, the inner one may grow and pulse around its own middle.
  return sv("g", { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, g);
}

// The sky of one Kosmos: topics around the middle, each with its figures fanned outwards.
function sky(sum: KosmosSummary): SVGElement {
  const el = sv("svg", { class: "km-sky", viewBox: "0 0 240 200", "aria-hidden": "true" });
  const lines = sv("g", { class: "km-lines" }), stars = sv("g");
  const groups = sum.groups.map((g) => ({ ...g, stars: sum.stars.filter((s) => s.group === g.id) })).filter((g) => g.stars.length);
  const cx = 120, cy = 100, n = groups.length;
  let i = 0;
  groups.forEach((g, gi) => {
    const a = n === 1 ? -90 : (n === 2 ? 180 : -90) + (gi * 360) / n;
    const hx = n === 1 ? cx : cx + 70 * Math.cos(rad(a)), hy = n === 1 ? cy : cy + 54 * Math.sin(rad(a));
    if (n > 1) lines.append(sv("line", { class: "km-far", x1: cx, y1: cy, x2: hx.toFixed(1), y2: hy.toFixed(1) }));
    const k = g.stars.length, step = n === 1 ? 360 / k : Math.min(48, 190 / k);
    g.stars.forEach((s, j) => {
      const b = a + (j - (k - 1) / 2) * step, d = 25 + (hash(s.id) % 10);
      const x = hx + d * Math.cos(rad(b)), y = hy + d * 0.86 * Math.sin(rad(b));
      lines.append(sv("line", { x1: hx.toFixed(1), y1: hy.toFixed(1), x2: x.toFixed(1), y2: y.toFixed(1) }));
      stars.append(star(x, y, s, i++));
    });
    if (n > 1) stars.append(sv("circle", { class: "km-hub", cx: hx.toFixed(1), cy: hy.toFixed(1), r: 3 }));
  });
  stars.append(sv("circle", { class: "km-home-ring", cx, cy, r: 5.5 }), sv("circle", { class: "km-home", cx, cy, r: 2 }));
  el.append(lines, stars);
  return el;
}
// A Kosmos that cannot be drawn yet: an empty orbit.
function noSky(): SVGElement {
  const el = sv("svg", { class: "km-sky is-empty", viewBox: "0 0 240 200", "aria-hidden": "true" });
  el.append(sv("ellipse", { class: "km-orbit", cx: 120, cy: 100, rx: 70, ry: 54 }), sv("circle", { class: "km-home-ring", cx: 120, cy: 100, r: 5.5 }), sv("circle", { class: "km-home", cx: 120, cy: 100, r: 2 }));
  return el;
}

interface Item { info: KosmosInfo; sum: KosmosSummary | null; el: HTMLButtonElement }

export async function showMenu(list: KosmosInfo[], host: MenuHost, note = "") {
  const root = $("kmenu"), items: Item[] = [];
  const hl = h("h1", { class: "km-hl", text: list.length === 1 ? "Ein Kosmos." : `${NUM[list.length] || list.length} Kosmen.` });
  const ol = h("ol", { class: "km-list" });
  let leaving = false;

  // Into a Kosmos: its sky grows towards you while the others fall away, then its room opens.
  function enter(it: Item) {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem("lumantic.arrive", it.info.id); } catch { /* the room then opens at its usual pace */ }
    if (host.still()) { host.enter(it.info.id); return; }
    const b = it.el.querySelector(".km-sky")!.getBoundingClientRect(), o = ol.getBoundingClientRect();
    ol.style.transformOrigin = `${b.left + b.width / 2 - o.left}px ${b.top + b.height / 2 - o.top}px`;
    root.classList.add("is-leaving");
    it.el.classList.add("is-chosen");
    setTimeout(() => host.enter(it.info.id), 460);
  }

  function draw(it: Item) {
    const { info, sum } = it, st = info.status;
    const tone = sum ? (sum.counts.alert ? "alert" : sum.counts.watch ? "watch" : "calm") : st.ok ? "calm" : "off";
    const say = sum ? sum.headline : st.ok ? "Lumantic liest …" : st.tables > 0 && st.kpis === 0 ? "Noch keine Kennzahlen." : "Antwortet nicht.";
    const meta = sum ? `${sum.stars.length} ${sum.stars.length === 1 ? "Kennzahl" : "Kennzahlen"} · ${sum.month}` : st.ok ? TYPE[info.type] || info.type : st.error;
    it.el.dataset.tone = tone;
    it.el.replaceChildren(sum ? sky(sum) : noSky(), h("span", { class: "km-name", text: info.name || sum?.title || info.id }), h("span", { class: "km-say", text: say }), h("span", { class: "km-meta", text: meta }));
  }

  list.forEach((info, i) => {
    const el = h("button", { type: "button", class: "km-k", "data-id": info.id, style: `--n:${i}`, title: i < 9 ? `${info.name} öffnen (Taste ${i + 1})` : `${info.name} öffnen` });
    const it: Item = { info, sum: null, el };
    el.addEventListener("click", () => enter(it));
    items.push(it);
    draw(it);
    ol.append(h("li", {}, el));
  });
  const add = h("button", { type: "button", class: "km-k km-new", style: `--n:${list.length}`, title: "Einen weiteren Goldlayer verbinden (Taste N)", onclick: () => host.add() },
    (() => { const s = noSky(); s.append(sv("path", { class: "km-plus", d: "M120 91v18M111 100h18" })); return s; })(),
    h("span", { class: "km-name", text: "Kosmos hinzufügen" }), h("span", { class: "km-meta", text: "einen weiteren Goldlayer verbinden" }));
  if (host.canAdd()) ol.append(h("li", {}, add));

  root.replaceChildren(h("div", { class: "km-in" }, h("header", { class: "km-head" }, h("p", { class: "km-eye", text: "Deine Kosmen" }), hl, note ? h("p", { class: "km-note", role: "status", text: note }) : null), ol));
  root.hidden = false;

  // The places row lists the Kosmen, as it lists the pages inside one.
  const places = () => $("places").replaceChildren(
    ...items.map((it, i) => h("button", { type: "button", title: i < 9 ? `${it.info.name} (Taste ${i + 1})` : it.info.name, onclick: () => enter(it) },
      it.sum?.counts.alert ? h("i", { class: "pl-al", title: "braucht dich" }) : null, it.info.name)),
    katalogButton(() => host.catalog()), gear(() => host.settings()));
  places();
  $("btn-idee").style.visibility = "hidden";
  $("btn-keys").style.visibility = "hidden";

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") { host.closeSettings(); return; }
    if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey || host.settingsOpen()) return;
    const at = items.findIndex((it) => it.el === document.activeElement);
    if (/^[1-9]$/.test(e.key) && items[+e.key - 1]) enter(items[+e.key - 1]);
    else if (e.key === ",") { e.preventDefault(); host.settings(); }
    else if ((e.key === "n" || e.key === "N" || e.key === "+") && host.canAdd()) host.add();
    else if (e.key === "c" || e.key === "C") host.catalog();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); (items[(at + 1) % items.length] || items[0]).el.focus(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); (items[(at - 1 + items.length) % items.length] || items[0]).el.focus(); }
  });

  // Each Kosmos is read on its own, so a slow or broken one does not hold the others back.
  await Promise.all(items.filter((it) => it.info.status.ok).map(async (it) => {
    try { it.sum = readKosmos(await api.metricsOf(it.info.id)); } catch { it.info = { ...it.info, status: { ...it.info.status, ok: false, error: "Die Kennzahlen lassen sich gerade nicht laden." } }; }
    draw(it);
  }));
  const need = items.filter((it) => it.sum && it.sum.counts.alert > 0).length, watch = items.some((it) => it.sum && it.sum.counts.watch > 0), down = items.filter((it) => !it.sum).length;
  const first = list.length === 1 ? "Ein Kosmos." : `${NUM[list.length] || list.length} Kosmen.`;
  const second = need === 1 ? (list.length === 1 ? "Er braucht dich." : "Einer braucht dich.") : need > 1 ? `${NUM[need] || need} brauchen dich.` : down === items.length ? "" : watch ? "Fast alles ruhig." : "Alles ruhig.";
  hl.textContent = [first, second].filter(Boolean).join(" ");
  places();
}

// The Sternkatalog's place in the row: a small star and the word, on a phone the star alone. The room draws the same.
export function katalogButton(onclick: () => void): HTMLElement {
  return h("button", { type: "button", class: "pl-set pl-kat", "data-katalog": "1", "aria-label": "Sternkatalog", title: "Sternkatalog (Taste C)", onclick },
    sv("svg", { class: "gear", viewBox: "-8 -8 16 16", "aria-hidden": "true" }, sv("path", { d: STAR_D })), h("span", { class: "pl-word", text: "Katalog" }));
}
// A four-pointed star, the catalog's sign.
const STAR_D = "M0,-6.5 L1.6,-1.6 L6.5,0 L1.6,1.6 L0,6.5 L-1.6,1.6 L-6.5,0 L-1.6,-1.6 Z";

// The same gear the room draws at the end of its places row (kosmos/75-hands.js).
const GEAR_D = (() => {
  let d = "";
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, r = i % 2 ? 4.6 : 6.4, a1 = a - 0.2, a2 = a + 0.2; d += `${i ? "L" : "M"}${(r * Math.cos(a1)).toFixed(2)},${(r * Math.sin(a1)).toFixed(2)} L${(r * Math.cos(a2)).toFixed(2)},${(r * Math.sin(a2)).toFixed(2)} `; }
  return d + "Z";
})();
export function gear(onclick: () => void): HTMLElement {
  return h("button", { type: "button", class: "pl-set", "data-settings": "1", "aria-label": "Einstellungen", title: "Einstellungen (Taste ,)", "aria-expanded": "false", onclick },
    sv("svg", { class: "gear", viewBox: "-8 -8 16 16", "aria-hidden": "true" }, sv("path", { d: GEAR_D }), sv("circle", { r: 2.2 })), h("span", { class: "pl-word", text: "Einstellungen" }));
}
