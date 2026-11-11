// A dashboard Lumina pre-built from the data. The person can change type,
// range and size of every card, reorder, remove and add; changes are saved.
import { chartCard, type Card, type ChartHost } from "../charts";
import { h, icon, sv } from "../dom";
import { evaluate, type Eval } from "../engine";
import { F, split } from "../format";
import { briefParts, candidatesFor, lumaSelect, type Candidate } from "../lumina";
import { PERIODS, SCOPES, indexOfMonth, scopeKpis, valAt, type Grain, type Kpi } from "../model";
import { goLive, openDashboard } from "../nav";
import { S, isLive, month, reduced, syncPlay, timeHooks } from "../time";
import { flip, kindVar, reg, toast } from "../ui";
import { W, saveWorkspace } from "../workspace";

interface Tile {
  k: Kpi;
  el: HTMLElement;
  val: HTMLElement;
  pill: HTMLElement;
  delta: HTMLElement;
  now: HTMLElement;
  line: SVGElement;
  area: SVGElement;
  i: number;
  r?: Eval;
}

export const DB = {
  el: null as HTMLElement | null,
  title: null as unknown as HTMLElement,
  sub: null as unknown as HTMLElement,
  banner: null as unknown as HTMLElement,
  editBtn: null as HTMLElement | null,
  seg: null as unknown as HTMLElement,
  tilesEl: null as unknown as HTMLElement,
  note: null as unknown as HTMLElement,
  chartsEl: null as unknown as HTMLElement,
  tray: null as unknown as HTMLElement,
  tiles: [] as Tile[],
  cards: [] as Card[],
  cands: [] as Candidate[],
  raf: 0,
  dragWired: false,

  host(): ChartHost {
    return {
      layout: () => W.dash[S.scope!],
      get cands() { return DB.cands; },
      renderCharts: (fresh, added) => DB.renderCharts(fresh, added),
      changed: () => DB.changed(),
    };
  },

  mount(app: HTMLElement, origins: Record<string, DOMRect>) {
    const scope = S.scope!;
    // Dashboards nobody has touched follow the month; adjusted ones stay as the person left them.
    if (!W.dash[scope] || !W.dash[scope].custom) lumaSelect(scope, month());
    this.title = h("h1", { class: "dash-title", text: SCOPES[scope] });
    this.sub = h("p", { class: "dash-sub" });
    this.editBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => this.toggleEdit() }, "Anpassen");
    const grains: [Grain, string][] = [["monat", "Monat"], ["quartal", "Quartal"], ["jahr", "Jahr"]];
    this.seg = h("div", { class: "seg", role: "group", "aria-label": "Auflösung" }, grains.map(([g, l]) =>
      h("button", { type: "button", "aria-pressed": String(S.g === g), onclick: () => {
        S.g = g;
        this.seg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(grains[i][0] === g)));
        this.refresh(true);
      } }, l)));
    this.banner = h("div", { class: "banner", role: "status" });
    this.tilesEl = h("div", { class: "tiles" });
    this.note = h("p");
    this.chartsEl = h("div", { class: "charts" });
    this.tray = h("div", { class: "panel tray" });
    this.dragWired = false;
    this.el = h("section", { class: "dash view", "aria-label": `Dashboard ${SCOPES[scope]}` },
      h("div", { class: "dash-head" },
        h("div", {}, h("span", { class: "label", text: "Dashboard · vorbereitet von Lumina" }), this.title, this.sub),
        h("div", { class: "dash-tools" }, this.seg, this.editBtn,
          h("button", { class: "btn btn--accent", type: "button", onclick: () => this.reselect() }, "✦ Lumina wählt neu"))),
      this.banner,
      this.tilesEl,
      h("div", { class: "note panel" }, reg(), this.note),
      this.chartsEl,
      this.tray);
    app.replaceChildren(this.el);
    S.edit = false;
    this.renderTiles(origins);
    this.renderCharts(true);
    this.monthUpdate();
    this.frame();
    if (S.focus) { const f = S.focus; setTimeout(() => this.focusTile(f), 650); }
    syncPlay();
    this.kick();
    window.scrollTo({ top: 0 });
  },

  reselect() {
    lumaSelect(S.scope!, month());
    saveWorkspace();
    this.renderCharts(true);
    toast(`Lumina hat die Diagramme für ${PERIODS.monat[month()].long} neu gewählt.`);
  },

  changed() {
    W.dash[S.scope!].custom = true;
    saveWorkspace();
  },

  toggleEdit() {
    if (!this.editBtn || !this.el?.isConnected) return;
    S.edit = !S.edit;
    this.editBtn.setAttribute("aria-pressed", String(S.edit));
    this.editBtn.textContent = S.edit ? "Fertig" : "Anpassen";
    this.chartsEl.classList.toggle("is-edit", S.edit);
    this.chartsEl.querySelectorAll<HTMLElement>(".chart-card").forEach((c) => (c.draggable = S.edit));
    this.renderNote();
    this.renderTray();
  },

  focusTile(id: string) {
    const t = this.tilesEl.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!t) return;
    t.classList.add("is-focus");
    t.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setTimeout(() => t.classList.remove("is-focus"), 2200);
  },

  renderTiles(origins: Record<string, DOMRect>) {
    this.tiles = scopeKpis(S.scope!).map((k, i) => {
      const val = h("span", { class: "tile-val" }), pill = h("span", { class: "pill" }), delta = h("span", { class: "tile-delta" }), now = h("span", { class: "tile-now" });
      const line = sv("path", { fill: "none", "stroke-width": 1.6, "vector-effect": "non-scaling-stroke" }), area = sv("path", { "fill-opacity": 0.12 });
      const spark = sv("svg", { viewBox: "0 0 100 30", preserveAspectRatio: "none", "aria-hidden": "true" }, area, line);
      const el = h("button", { class: "panel tile", type: "button", "data-id": k.id, onclick: () => this.highlight(k.id) }, reg(),
        h("span", { class: "tile-top" }, h("span", { class: "tile-name", text: k.name }), pill), val, delta, now, spark);
      return { k, el, val, pill, delta, now, line, area, i };
    });
    this.tilesEl.replaceChildren(...this.tiles.map((t) => t.el));
    if (reduced) return;
    this.tiles.forEach((t) => {
      const o = origins[t.k.id];
      if (o && o.width) {
        const b = t.el.getBoundingClientRect();
        t.el.animate([
          { transform: `translate(${o.left + o.width / 2 - (b.left + b.width / 2)}px, ${o.top + o.height / 2 - (b.top + b.height / 2)}px) scale(${Math.max(0.04, o.width / b.width)}, ${Math.max(0.04, o.height / b.height)})`, borderRadius: "50%", opacity: 0.4 },
          { transform: "none", borderRadius: getComputedStyle(t.el).borderRadius, opacity: 1 }],
          { duration: 650, delay: t.i * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
      } else {
        t.el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: t.i * 45, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
      }
    });
  },

  highlight(id: string) {
    const hit = [...this.chartsEl.querySelectorAll<HTMLElement>(".chart-card")].find((c) => (c.dataset.id || "").endsWith(":" + id));
    if (hit) {
      hit.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      hit.animate([{ boxShadow: "0 0 0 1px var(--accent), 0 0 40px -6px var(--accent)" }, { boxShadow: "none" }], { duration: 1600 });
      return;
    }
    const cand = this.cands.find((c) => c.k === id);
    if (cand) { this.addChart(cand.id); toast(`Lumina hat «${cand.title}» ergänzt.`); }
  },

  addChart(id: string) {
    const d = W.dash[S.scope!];
    if (d.sel.includes(id)) return;
    d.sel.push(id);
    d.size[id] = d.size[id] || "M";
    this.changed();
    this.renderCharts(false, id);
    const el = this.chartsEl.querySelector(`[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  },

  renderCharts(fresh: boolean, added?: string) {
    const d = W.dash[S.scope!];
    this.cands = candidatesFor(S.scope!, month());
    const byId = Object.fromEntries(this.cands.map((c) => [c.id, c]));
    // A card whose data is not there for this moment (daily values in the past) waits in the layout.
    this.cards = d.sel.filter((id) => byId[id]).map((id) => chartCard({ ...byId[id], type: d.type[id] || byId[id].type, range: d.range[id] || byId[id].range, size: d.size[id] || "M" }, this.host()));
    flip(this.chartsEl, ".chart-card", () => this.chartsEl.replaceChildren(...this.cards.map((c) => c.el)));
    this.cards.forEach((c, i) => {
      if (fresh || c.spec.id === added) { c.el.classList.add("enter"); c.el.style.animationDelay = fresh ? `${150 + i * 60}ms` : "0ms"; c.intro = true; }
      c.el.draggable = S.edit;
      c.update(true);
    });
    this.chartsEl.classList.toggle("is-edit", S.edit);
    this.renderNote();
    this.renderTray();
    if (!this.dragWired) this.wireDrag();
    this.kick();
  },

  renderNote() {
    const d = W.dash[S.scope!];
    this.note.replaceChildren(
      h("span", { class: "voice", text: d.custom ? "Von dir angepasst und gespeichert. Lumina schlägt Neues nur noch unten vor. " : `Lumina hat aus ${this.cands.length} möglichen Diagrammen ${this.cards.length} vorausgewählt, nach Dringlichkeit und Aussagekraft. ` }),
      h("span", { class: "label", text: S.edit ? "Ziehen ordnet neu · Typ, Zeitraum und Grösse oben rechts in jeder Karte" : "«Anpassen» öffnet alle Werkzeuge" }));
  },

  kick() {
    if (this.raf) return;
    const tick = () => { this.raf = 0; if (S.view === "dash" && this.el?.isConnected && this.frame()) this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  },

  renderTray() {
    const d = W.dash[S.scope!];
    const rest = this.cands.filter((c) => !d.sel.includes(c.id));
    const selScores = this.cands.filter((c) => d.sel.includes(c.id)).map((c) => c.score);
    const floor = selScores.length ? Math.min(...selScores) : -Infinity;
    // A better candidate than the weakest card is announced, never swapped in silently (HAX G14, G18).
    this.tray.replaceChildren(h("span", { class: "label", text: rest.length ? "Weitere Vorschläge von Lumina" : "Alle Vorschläge sind auf dem Dashboard" }),
      ...rest.slice(0, 8).map((c, i) => {
        const hot = i === 0 && c.score > floor;
        return h("button", { class: "chip" + (hot ? " chip--hot" : ""), type: "button", title: c.why, onclick: () => this.addChart(c.id) }, (hot ? "✦ Neu empfohlen: " : "+ ") + c.title);
      }));
  },

  wireDrag() {
    this.dragWired = true;
    let dragId: string | null = null, last = "";
    this.chartsEl.addEventListener("dragstart", (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>(".chart-card");
      if (!c || !S.edit || !e.dataTransfer) return;
      dragId = c.dataset.id || null;
      c.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId || "");
    });
    this.chartsEl.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      const tgt = (e.target as HTMLElement).closest<HTMLElement>(".chart-card");
      if (!tgt || tgt.dataset.id === dragId) return;
      const b = tgt.getBoundingClientRect(), after = e.clientX > b.left + b.width / 2, sig = tgt.dataset.id + String(after);
      if (sig === last) return;
      last = sig;
      const dragged = this.chartsEl.querySelector(`[data-id="${dragId}"]`), ref = after ? tgt.nextSibling : tgt;
      if (dragged && ref !== dragged && ref !== dragged.nextSibling) flip(this.chartsEl, ".chart-card", () => this.chartsEl.insertBefore(dragged, ref));
    });
    this.chartsEl.addEventListener("dragend", () => {
      if (!dragId) return;
      const d = W.dash[S.scope!];
      const shown = [...this.chartsEl.querySelectorAll<HTMLElement>(".chart-card")].map((c) => c.dataset.id || "");
      d.sel = [...shown, ...d.sel.filter((id) => !shown.includes(id))];
      this.changed();
      this.chartsEl.querySelector(`[data-id="${dragId}"]`)?.classList.remove("is-dragging");
      dragId = null;
      last = "";
    });
  },

  monthUpdate() {
    const m = month(), live = isLive();
    this.cands = candidatesFor(S.scope!, m);
    this.sub.replaceChildren(...briefParts(m, S.scope!, (k) => { if (k.group === S.scope || S.scope === "all") this.focusTile(k.id); else openDashboard(k.group, k.id); }));
    for (const t of this.tiles) {
      const p = PERIODS[S.g][indexOfMonth(S.g, m)], r = evaluate(t.k, S.g, p.i);
      t.el.setAttribute("data-level", r.kind);
      t.pill.setAttribute("data-level", r.kind);
      t.pill.replaceChildren(h("i"), r.label);
      t.delta.textContent = r.delta || "Erste Periode";
      t.now.hidden = live;
      if (!live) t.now.textContent = `heute ${F(t.k, evaluate(t.k, S.g, PERIODS[S.g].length - 1).cur)}`;
      t.r = r;
    }
    // In the past the mode must be unmistakable: old numbers must never pass for today's.
    this.banner.hidden = live;
    if (!live) {
      this.banner.replaceChildren(icon("zeit"), h("span", {}, h("b", { text: `Rückblick · ${PERIODS.monat[m].long}. ` }), "Du siehst die Werte von damals."),
        h("button", { class: "btn btn--accent", type: "button", onclick: () => goLive() }, "Zurück zu heute"), h("kbd", { text: "Z" }));
    }
    this.renderTray();
  },

  frame() {
    const t = S.t;
    for (const tl of this.tiles) {
      const k = tl.k;
      const v = S.g === "monat" ? valAt(k, t) : tl.r ? tl.r.cur : valAt(k, t);
      const [n, u] = split(k, v);
      tl.val.replaceChildren(n, h("small", { text: u }));
      const a = Math.max(0, t - 23), pts: [number, number][] = [];
      for (let m = Math.floor(a); m <= Math.floor(t); m++) pts.push([m, k.series[m]]);
      pts.push([t, valAt(k, t)]);
      const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs) || 1;
      const X = (m: number) => ((m - a) / Math.max(1, t - a)) * 100, Y = (v2: number) => 28 - ((v2 - lo) / (hi - lo || 1)) * 26;
      const d = "M" + pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" L");
      const col = kindVar(tl.r ? (tl.r.kind === "calm" ? "info" : tl.r.kind) : "info");
      tl.line.setAttribute("d", d);
      tl.line.setAttribute("stroke", col);
      tl.area.setAttribute("d", `${d} L100,30 L0,30 Z`);
      tl.area.setAttribute("fill", col);
    }
    let again = false;
    for (const c of this.cards) again = c.update(false) || again;
    return again;
  },

  refresh(monthChanged: boolean) {
    if (monthChanged) this.monthUpdate();
    for (const c of this.cards) c.update(true);
    this.frame();
  },

  onTime(mc: boolean) {
    if (S.view !== "dash" || !this.el || !this.el.isConnected) return;
    if (mc) {
      this.monthUpdate();
      // Cards appear or wait when their data comes and goes (daily values exist only today).
      const ids = W.dash[S.scope!].sel.filter((id) => this.cands.some((c) => c.id === id));
      if (ids.join() !== this.cards.map((c) => c.spec.id).join()) this.renderCharts(false);
      else for (const c of this.cards) c.update(true);
    }
    if (this.frame()) this.kick();
  },
};

timeHooks.add((mc) => DB.onTime(mc));
