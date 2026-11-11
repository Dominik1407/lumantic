// Zeitreise: a dial whose rim is history. The selected month sits under the
// fixed pointer; stars are the key figures, grouped into constellations.
import { h, icon, sv } from "../dom";
import { evalAll, evaluate, levelCounts } from "../engine";
import { F, compact, fdelta } from "../format";
import { briefParts } from "../lumina";
import { EVENTS, GROUPS, KPIS, MON, N, PERIODS, START_M, START_Y, clamp, lerp, valAt, type TimeEvent } from "../model";
import { openDashboard } from "../nav";
import { S, animate, easeOut, eventHooks, glideTo, isLive, month, reduced, setTime, stopGlide, stopPlay, syncPlay, timeHooks, togglePlay } from "../time";
import { hideTip, kindVar, reg, tipOn } from "../ui";

const SLOTS = () => Math.ceil((N + START_M) / 12) * 12;
const DEG = () => 360 / SLOTS();
const arcPath = (r0: number, r1: number, a0: number, a1: number) => {
  const p = (r: number, a: number) => [(r * Math.sin((a * Math.PI) / 180)).toFixed(2), (-r * Math.cos((a * Math.PI) / 180)).toFixed(2)];
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
};
const polar = (r: number, deg: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

interface Star {
  k: (typeof KPIS)[number];
  g: SVGElement;
  halo: SVGElement;
  pulse: SVGElement;
  prog: SVGElement;
  tick: SVGElement;
  core: SVGElement;
  val: SVGElement;
  trail: SVGElement;
  base: number[];
  out: number[];
  pts: number[][];
}

export const OV = {
  built: false,
  el: null as unknown as HTMLElement,
  svg: null as unknown as SVGElement,
  stage: null as unknown as HTMLElement,
  hub: null as unknown as HTMLElement,
  dial: null as unknown as SVGElement,
  map: null as unknown as SVGElement,
  hubMonth: null as unknown as HTMLElement,
  hubSub: null as unknown as HTMLElement,
  brief: null as unknown as HTMLElement,
  briefLabel: null as unknown as HTMLElement,
  sigs: null as unknown as HTMLElement,
  compare: null as unknown as HTMLElement,
  yearLabels: [] as { el: SVGElement; x: number; y: number; arc: SVGElement; year: number }[],
  monthLabels: [] as { el: SVGElement; x: number; y: number; m: number }[],
  stars: {} as Record<string, Star>,
  trailLayer: null as unknown as SVGElement,
  spin: 0,
  stopIntro: (() => {}) as () => void,
  raf: 0,
  scrubbing: false,

  build() {
    this.built = true;
    const kinds: Record<string, string> = { alert: "--alert", watch: "--watch", good: "--good", info: "--accent", calm: "--ink" };
    const defs = sv("defs", {}, ...Object.entries(kinds).map(([k, v]) => sv("radialGradient", { id: "halo-" + k },
      sv("stop", { offset: 0, "stop-color": `var(${v})`, "stop-opacity": k === "calm" ? 0.3 : 0.75 }),
      sv("stop", { offset: 0.35, "stop-color": `var(${v})`, "stop-opacity": k === "calm" ? 0.06 : 0.2 }),
      sv("stop", { offset: 1, "stop-color": `var(${v})`, "stop-opacity": 0 }))));
    this.dial = sv("g");
    this.map = sv("g");
    this.svg = sv("svg", { viewBox: "-540 -540 1080 1080", role: "group", "aria-label": "Zeitrad und Sternkarte der Kennzahlen" }, defs, this.dial, this.buildFixed(), this.map);
    this.buildDial();
    this.buildMap();
    this.hubMonth = h("div", { class: "hub-month num" });
    this.hubSub = h("div", { class: "hub-sub" });
    this.hub = h("div", { class: "hub" }, this.hubMonth, this.hubSub, h("div", { class: "hub-ctrl" },
      h("button", { type: "button", "aria-label": "Zum Anfang", onclick: () => { stopPlay(); glideTo(0, 1400); } }, icon("first", 14)),
      h("button", { type: "button", class: "play-btn", "data-play": "", onclick: togglePlay }, icon("play", 14), icon("pause", 14)),
      h("button", { type: "button", "aria-label": "Zur Gegenwart", onclick: () => { stopPlay(); glideTo(N - 1, 1400); } }, icon("last", 14))));
    this.stage = h("div", { class: "stage" }, this.svg, this.hub);
    this.brief = h("p", { class: "brief" });
    this.briefLabel = h("span", { class: "label" });
    this.sigs = h("div", { class: "sigs" });
    this.compare = h("div", { class: "cmp" });
    this.el = h("section", { class: "ov", "aria-label": "Zeitreise" }, this.stage,
      h("aside", { class: "side" },
        h("div", { class: "panel" }, reg(), this.briefLabel, this.brief),
        h("div", { class: "panel" }, h("span", { class: "label", text: "Signale" }), this.sigs),
        h("div", { class: "panel" }, h("span", { class: "label", text: "Damals und heute" }), this.compare),
        h("p", { class: "label hint", text: "Rad ziehen oder Mausrad: durch die Zeit · ▶ spielt die Geschichte ab · Z springt zwischen heute und diesem Moment" })));
    this.wire();
  },

  buildFixed() {
    const g = sv("g", { "aria-hidden": "true" });
    g.append(sv("circle", { class: "d-ring", r: 514, "stroke-opacity": 0.6 }), sv("circle", { class: "d-ring", r: 404, "stroke-opacity": 0.5 }),
      sv("line", { class: "d-pointer", x1: 0, x2: 0, y1: -512, y2: -398, "stroke-width": 1.4, style: "filter: drop-shadow(0 0 calc(var(--halo) * 6px) var(--accent))" }),
      sv("path", { class: "d-pointer", d: "M-9,-534 L9,-534 L0,-517 Z" }));
    for (let n = 0; n < 4; n++) { const [x, y] = polar(526, n * 90 + 45); g.append(sv("circle", { cx: x, cy: y, r: 2, class: "d-pointer", opacity: 0.5 })); }
    return g;
  },

  buildDial() {
    const kids: SVGElement[] = [], slots = SLOTS(), deg = DEG(), years = slots / 12, yDeg = 360 / years;
    this.yearLabels = [];
    for (let k = 0; k < years; k++) {
      const y = START_Y + k, a0 = k * yDeg + 0.6, a1 = (k + 1) * yDeg - 0.6;
      const arc = sv("path", { class: "d-year", d: arcPath(474, 504, a0, a1) });
      const lastOfYear = Math.min(N - 1, (k + 1) * 12 - 1 - START_M);
      arc.addEventListener("click", () => { stopPlay(); glideTo(lastOfYear, 1200); });
      tipOn(arc, String(y), `Klick: zum Jahresende ${y}`);
      const [lx, ly] = polar(489, k * yDeg + yDeg / 2);
      const label = sv("text", { class: "d-txt", x: lx.toFixed(1), y: (ly + 5).toFixed(1), "text-anchor": "middle", "font-size": 15, "letter-spacing": 1.5, "pointer-events": "none" }, String(y));
      this.yearLabels.push({ el: label, x: lx, y: ly + 5, arc, year: y });
      kids.push(arc, label);
    }
    this.monthLabels = [];
    for (let s = 0; s < slots; s++) {
      const m = s - START_M, a = s * deg, q = s % 3 === 0, outside = m < 0 || m > N - 1;
      const [x0, y0] = polar(q ? 446 : 454, a), [x1, y1] = polar(466, a);
      kids.push(sv("line", { class: "d-line", x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1), "stroke-opacity": outside ? 0.06 : q ? 0.42 : 0.2, "stroke-width": q ? 1.4 : 1 }));
      const [lx, ly] = polar(432, (s + 0.5) * deg);
      const lab = sv("text", { class: "d-month", x: lx.toFixed(1), y: (ly + 4).toFixed(1), "text-anchor": "middle", "font-size": 11, opacity: 0, "pointer-events": "none" }, MON[s % 12]);
      this.monthLabels.push({ el: lab, x: lx, y: ly + 4, m });
      kids.push(lab);
    }
    for (let s = 0; s < slots; s++) {
      const m = s - START_M, a0 = s * deg + 0.25, a1 = (s + 1) * deg - 0.25;
      if (m < 0 || m > N - 1) { kids.push(sv("path", { d: arcPath(408, 420, a0, a1), fill: "var(--ink)", "fill-opacity": 0.03 })); continue; }
      const c = levelCounts(m);
      const seg = sv("path", { d: arcPath(408, 420, a0, a1), fill: c.alert ? "var(--alert)" : c.watch ? "var(--watch)" : "var(--ink)", "fill-opacity": c.alert ? Math.min(0.85, 0.28 + c.alert * 0.22) : c.watch ? 0.35 : 0.08 });
      tipOn(seg, PERIODS.monat[m].long, c.alert || c.watch ? `${c.alert} brauchten Aufmerksamkeit, ${c.watch} im Auge behalten. Klick springt hin.` : "Ruhiger Monat. Klick springt hin.");
      seg.addEventListener("click", () => { stopPlay(); glideTo(m, 900); });
      seg.style.cursor = "pointer";
      kids.push(seg);
    }
    for (const e of EVENTS) {
      const [x, y] = polar(428, (e.t + START_M + 0.5) * deg);
      const d = sv("path", { class: "d-event", d: "M0,-6 L6,0 L0,6 L-6,0 Z", transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
      tipOn(d, PERIODS.monat[e.t].long, `${e.title}. ${e.text}`);
      d.addEventListener("click", () => { stopPlay(); glideTo(e.t, 1200); });
      kids.push(d);
    }
    this.dial.replaceChildren(...kids);
  },

  buildMap() {
    this.stars = {};
    const kids: SVGElement[] = [];
    this.trailLayer = sv("g");
    kids.push(this.trailLayer);
    const ng = GROUPS.length;
    GROUPS.forEach((grp, gi) => {
      const ang = ((-90 + gi * (360 / ng)) * Math.PI) / 180;
      const rv = [Math.cos(ang), Math.sin(ang)], tv = [-Math.sin(ang), Math.cos(ang)], c = [218 * rv[0], 218 * rv[1]];
      const members = KPIS.filter((k) => k.group === grp.id).slice(0, 3);
      const offs = members.length === 3 ? [[0, -30], [-80, 34], [80, 34]] : members.length === 2 ? [[-62, -8], [62, 12]] : [[0, 0]];
      const pts = members.map((_k, j) => { const [t, r] = offs[j]; return [c[0] + tv[0] * t + rv[0] * r, c[1] + tv[1] * t + rv[1] * r]; });
      kids.push(sv("line", { class: "d-con", x1: 0, y1: 0, x2: c[0].toFixed(1), y2: c[1].toFixed(1), "stroke-dasharray": "2 6" }));
      if (pts.length > 1) kids.push(sv("path", { class: "d-con", d: "M" + pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" L") + (pts.length > 2 ? " Z" : "") }));
      const lr = rv[1] > 0.3 ? 134 : 100;
      const label = sv("text", { class: "d-cluster", x: (c[0] + rv[0] * lr).toFixed(1), y: (c[1] + rv[1] * lr + 7).toFixed(1), "text-anchor": "middle", "font-size": 25, tabindex: "0", role: "button", "aria-label": `Dashboard ${grp.name} öffnen` }, grp.name);
      label.addEventListener("click", () => openDashboard(grp.id));
      label.addEventListener("keydown", (e) => { const ke = e as KeyboardEvent; if (ke.key === "Enter" || ke.key === " ") { ke.preventDefault(); openDashboard(grp.id); } });
      kids.push(label);
      members.forEach((k, j) => {
        const [x, y] = pts[j], dx = x - c[0], dy = y - c[1], len = Math.hypot(dx, dy) || 1;
        const out = len > 8 ? [dx / len, dy / len] : rv;
        const halo = sv("circle", { class: "halo", r: 20, fill: "url(#halo-calm)" });
        const pulse = sv("circle", { r: 20, fill: "none", stroke: "var(--alert)", "stroke-opacity": 0, visibility: "hidden" },
          ...(reduced ? [] : [sv("animate", { attributeName: "r", values: "22;48", dur: "2.4s", repeatCount: "indefinite" }), sv("animate", { attributeName: "stroke-opacity", values: "0.6;0", dur: "2.4s", repeatCount: "indefinite" })]));
        const track = sv("circle", { class: "track", r: 22, "stroke-width": 1.2 });
        const prog = sv("circle", { r: 22, fill: "none", "stroke-width": 2, "stroke-linecap": "round", pathLength: 100, "stroke-dasharray": "0 100", transform: "rotate(-90)" });
        const tick = sv("line", { x1: 0, y1: -17, x2: 0, y2: -30, stroke: "var(--accent)", "stroke-width": 1.5, visibility: "hidden" });
        const core = sv("circle", { class: "core", r: 3 });
        const cross = sv("path", { class: "cross", d: "M-32,0 h12 M20,0 h12 M0,-32 v12 M0,20 v6" });
        // Centred under the star: no label can run into a neighbour, the hub or the rings.
        const name = sv("text", { class: "lab", x: 0, y: 38, "text-anchor": "middle", "font-size": 10.5, "letter-spacing": 1.2 }, k.short.toUpperCase());
        const val = sv("text", { class: "val", x: 0, y: 53, "text-anchor": "middle", "font-size": 12.5 }, "");
        const g = sv("g", { class: "st", tabindex: "0", role: "button", "aria-label": `${k.long}: Dashboard ${grp.name} öffnen`, style: reduced ? "" : `animation: ignite .9s ${0.25 + (gi * 3 + j) * 0.07}s cubic-bezier(.2,.8,.2,1) backwards` }, halo, pulse, track, prog, tick, cross, core, name, val);
        g.addEventListener("click", () => openDashboard(grp.id, k.id));
        g.addEventListener("keydown", (e) => { const ke = e as KeyboardEvent; if (ke.key === "Enter" || ke.key === " ") { ke.preventDefault(); openDashboard(grp.id, k.id); } });
        tipOn(g, () => `${grp.name} · ${evaluate(k, "monat", month()).label}`, () => `${k.name}: ${evaluate(k, "monat", month()).answer}.`);
        const trail = sv("path", { class: "trail", "stroke-width": 1.6 });
        this.trailLayer.append(trail);
        this.stars[k.id] = { k, g, halo, pulse, prog, tick, core, val, trail, base: [x, y], out, pts: [] };
        kids.push(g);
      });
    });
    this.map.replaceChildren(...kids);
  },

  frame() {
    const t = S.t, m = month(), deg = DEG(), ang = -(t + START_M + 0.5) * deg + (this.spin || 0);
    this.dial.setAttribute("transform", `rotate(${ang.toFixed(3)})`);
    for (const L of this.yearLabels) L.el.setAttribute("transform", `rotate(${(-ang).toFixed(3)} ${L.x.toFixed(1)} ${L.y.toFixed(1)})`);
    for (const L of this.monthLabels) {
      const d = Math.abs(L.m - t);
      const o = L.m < 0 || L.m > N - 1 ? 0 : d < 0.5 ? 1 : d < 5 ? 0.75 - d * 0.14 : 0;
      L.el.setAttribute("opacity", o.toFixed(2));
      if (o > 0) { L.el.setAttribute("transform", `rotate(${(-ang).toFixed(3)} ${L.x.toFixed(1)} ${L.y.toFixed(1)})`); L.el.setAttribute("font-weight", d < 0.5 ? "600" : "400"); }
    }
    const yNow = PERIODS.monat[m].y;
    for (const L of this.yearLabels) L.arc.classList.toggle("is-now", L.year === yNow);
    let moving = false;
    for (const st of Object.values(this.stars)) {
      const k = st.k, a = Math.floor(t), b = Math.min(N - 1, a + 1), f = t - a;
      const ra = evaluate(k, "monat", a), rb = evaluate(k, "monat", b), r = evaluate(k, "monat", m);
      const mag = lerp(ra.mag, rb.mag, f), v = valAt(k, t);
      let dev = 0;
      // Distance from the goal pushes a star outward; calm stars settle toward their constellation.
      if (k.dir && (k.target !== null || k.limit !== null)) {
        const tgt = (k.target !== null ? k.target : k.limit) as number;
        dev = k.kind === "flow" ? clamp((tgt - v) / 120, -0.08, 0.35) : clamp((-(v - tgt) / Math.abs(tgt)) * k.dir, -0.08, 0.35);
      }
      const px = st.base[0] + st.out[0] * dev * 120, py = st.base[1] + st.out[1] * dev * 120;
      st.g.setAttribute("transform", `translate(${px.toFixed(1)},${py.toFixed(1)})`);
      st.halo.setAttribute("r", (16 + 60 * mag).toFixed(1));
      st.halo.setAttribute("fill", `url(#halo-${r.kind})`);
      st.core.setAttribute("r", (2.2 + 4 * mag).toFixed(2));
      st.pulse.setAttribute("visibility", r.level === "alert" ? "visible" : "hidden");
      const peak = Math.max(...k.series);
      const D = k.dir > 0 ? Math.max(Math.abs(v), r.tgt || 0, k.limit || 0) * 1.28 : k.dir < 0 ? (k.limit || v) * 1.3 : peak * 1.1;
      st.prog.setAttribute("stroke-dasharray", `${(clamp(v / D, 0, 1) * 100).toFixed(1)} 100`);
      st.prog.setAttribute("stroke", kindVar(r.kind === "calm" ? "info" : r.kind));
      st.tick.setAttribute("visibility", r.tgt !== null ? "visible" : "hidden");
      if (r.tgt !== null) st.tick.setAttribute("transform", `rotate(${((r.tgt / D) * 360).toFixed(1)})`);
      st.val.textContent = compact(k, v);
      const last = st.pts[st.pts.length - 1];
      if (S.playing || this.scrubbing || S.gliding) {
        if (!last || Math.hypot(last[0] - px, last[1] - py) > 0.6) st.pts.push([px, py]);
        if (st.pts.length > 40) st.pts.shift();
      } else if (st.pts.length) st.pts.shift();
      if (st.pts.length > 1) { moving = true; st.trail.setAttribute("d", "M" + st.pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L")); }
      else st.trail.setAttribute("d", "");
      st.trail.setAttribute("stroke", kindVar(r.kind === "calm" ? "info" : r.kind));
      st.trail.setAttribute("stroke-opacity", (0.25 + 0.35 * mag).toFixed(2));
    }
    this.hubMonth.textContent = PERIODS.monat[m].long;
    return moving;
  },

  loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      if (S.view !== "zeit") return;
      if (this.frame() || S.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  monthUpdate() {
    const m = month(), c = levelCounts(m);
    this.hubSub.textContent = c.alert || c.watch ? `${c.alert ? c.alert + " brauchen dich" : ""}${c.alert && c.watch ? " · " : ""}${c.watch ? c.watch + " im Auge" : ""}` : "Alles ruhig";
    this.briefLabel.textContent = `Lagebericht · ${PERIODS.monat[m].long}${isLive() ? " · aktuell" : ""}`;
    this.brief.replaceChildren(...briefParts(m, "all", (k) => openDashboard(k.group, k.id)));
    const ev = evalAll("monat", m).filter((r) => r.level !== "calm").slice(0, 5);
    this.sigs.replaceChildren(...(ev.length ? ev.map((r) => h("button", { class: "sig", type: "button", onclick: () => openDashboard(r.k.group, r.k.id) },
      h("i", { class: "dot", "data-level": r.kind }), h("b", { text: r.k.name }), h("span", { class: "num", text: F(r.k, r.cur) }), h("small", { text: r.answer + "." })))
      : [h("p", { class: "voice muted", text: "Keine Signale in diesem Monat." })]));
    // Then and now: the reason to travel in time is to compare.
    if (m === N - 1) {
      this.compare.replaceChildren(h("p", { class: "voice muted", text: "Du bist in der Gegenwart. Zieh am Rad oder drück ▶, dann steht hier, was sich seither verändert hat." }));
    } else {
      this.compare.replaceChildren(h("div", { class: "cmp-head" }, h("span", { text: PERIODS.monat[m].label }), h("span", { text: "heute" })),
        ...KPIS.filter((k) => !k.hidden).map((k) => {
          const then = evaluate(k, "monat", m), now = evaluate(k, "monat", N - 1);
          return h("button", { class: "cmp-row", type: "button", onclick: () => openDashboard(k.group, k.id), title: fdelta(k, now.cur - then.cur, then.cur) + " seither" },
            h("span", { class: "cmp-name", text: k.short }),
            h("span", { class: "num", "data-level": then.kind }, h("i", { class: "dot", "data-level": then.kind }), compact(k, then.cur)),
            h("span", { class: "num", "data-level": now.kind }, h("i", { class: "dot", "data-level": now.kind }), compact(k, now.cur)));
        }));
    }
  },

  onTime(monthChanged: boolean) {
    if (S.view !== "zeit" || !this.built) return;
    if (monthChanged) this.monthUpdate();
    this.frame();
    this.loop();
  },

  wire() {
    let drag: { a: number; moved: number; id: number; captured: boolean } | null = null;
    const center = () => { const b = this.svg.getBoundingClientRect(); return { b, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
    const angleAt = (e: PointerEvent) => { const { cx, cy } = center(); return (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI; };
    const radiusAt = (e: PointerEvent) => { const { b, cx, cy } = center(); return (Math.hypot(e.clientX - cx, e.clientY - cy) / b.width) * 1080; };
    this.svg.addEventListener("pointerdown", (e) => {
      if (radiusAt(e) < 400 || e.button > 0) return;
      drag = { a: angleAt(e), moved: 0, id: e.pointerId, captured: false };
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const a = angleAt(e);
      let d = a - drag.a;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      drag.a = a;
      drag.moved += Math.abs(d);
      if (drag.moved > 1.5) {
        if (!drag.captured) { drag.captured = true; this.svg.setPointerCapture(drag.id); stopPlay(); stopGlide(); this.scrubbing = true; S.scrubbing = true; }
        hideTip();
        setTime(S.t - d / DEG());
      }
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      this.scrubbing = false;
      S.scrubbing = false;
      if (moved > 1.5) glideTo(Math.round(S.t), 420);
      this.loop();
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
    this.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      stopPlay();
      glideTo(clamp(Math.round(S.t) + (e.deltaY > 0 ? 1 : -1) * (Math.abs(e.deltaY) > 80 ? 3 : 1), 0, N - 1), 380);
    }, { passive: false });
  },

  mount(app: HTMLElement, intro: boolean) {
    if (!this.built) this.build();
    this.stopIntro();
    app.replaceChildren(this.el);
    // Leftover transitions must go. The browser only lists an element's
    // animations while it is in the page, so this runs after attaching.
    for (const el of [this.svg, this.hub]) el.getAnimations().forEach((a) => a.cancel());
    this.svg.style.transform = "";
    this.el.classList.remove("view");
    void this.el.offsetWidth;
    this.el.classList.add("view");
    this.monthUpdate();
    if (intro && !reduced) {
      this.spin = 140;
      this.stopIntro = animate(1800, (e) => { this.spin = 140 * (1 - e); this.frame(); }, easeOut);
    } else { this.spin = 0; this.frame(); }
    syncPlay();
  },

  // Screen position of a constellation, for the zoom into its dashboard.
  clusterScreen(scope: string) {
    const gi = GROUPS.findIndex((g) => g.id === scope), b = this.svg.getBoundingClientRect();
    if (gi < 0 || !b.width) return null;
    const ang = ((-90 + gi * (360 / GROUPS.length)) * Math.PI) / 180;
    return { x: ((218 * Math.cos(ang) + 540) / 1080) * b.width, y: ((218 * Math.sin(ang) + 540) / 1080) * b.height };
  },
};

timeHooks.add((mc) => OV.onTime(mc));
eventHooks.add((e: TimeEvent) => {
  if (S.view !== "zeit" || !OV.built || !OV.el.isConnected) return;
  const f = h("div", { class: "flash" }, h("span", { text: PERIODS.monat[e.t].long }), h("b", { text: e.title }));
  OV.stage.append(f);
  setTimeout(() => f.remove(), 2700);
});

