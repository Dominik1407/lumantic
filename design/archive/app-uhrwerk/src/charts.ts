// Chart cards for dashboards. Every card follows the time cursor; during
// playback axes may only grow (Heer & Robertson 2007).
import { h, sv } from "./dom";
import { dailyChart } from "./daily";
import { kindOf } from "./engine";
import { F, compact, fdelta, pct } from "./format";
import type { Candidate } from "./lumina";
import { K, MON, N, PERIODS, START_M, clamp, lerp, monthOf, monthsIn, sum, targetAt, valAt, valueAt, yearOf } from "./model";
import { NSS, PART_COLORS, lineD, pl, placeRight, seriesFrame, setGrad } from "./plot";
import { S, animate, easeOut, month, reduced } from "./time";
import { kindVar, reg, toast } from "./ui";
import type { DashLayout } from "./workspace";

export interface Spec extends Candidate {
  size: string;
}

export interface Card {
  spec: Spec;
  el: HTMLElement;
  intro: boolean;
  first: boolean;
  update: (monthChanged: boolean) => boolean;
}

// What a card needs from its dashboard.
export interface ChartHost {
  layout(): DashLayout;
  cands: Candidate[];
  renderCharts(fresh: boolean, added?: string): void;
  changed(): void;
}

type Draw = (mc: boolean, card: Card) => boolean;
const TYPE_NAME: Record<string, string> = { flaeche: "Fläche", linie: "Linie", balken: "Balken", anteile: "Anteile" };

function windowFor(spec: Spec): [number, number] {
  const r = spec.range || "Alles";
  if (r === "Alles") return [0, N - 1];
  const w = r === "1J" ? 12 : 36, x1 = Math.max(S.t, w - 1);
  return [x1 - (w - 1), x1];
}

type Axis = { lo?: number; hi?: number; i0?: number };
function smooth(st: Axis, key: "lo" | "hi", target: number, first: boolean) {
  const cur = st[key];
  if (S.playing && cur !== undefined) target = key === "lo" ? Math.min(target, cur) : Math.max(target, cur);
  if (cur === undefined || first || reduced) { st[key] = target; return false; }
  const d = target - cur;
  st[key] = cur + d * 0.22;
  return Math.abs(d) > Math.max(Math.abs(target) * 0.002, 1e-6);
}

function introFactor(card: Card, st: Axis) {
  if (!card.intro || reduced) return 1;
  st.i0 = st.i0 || performance.now() + 180;
  const e = easeOut(clamp((performance.now() - st.i0) / 1100, 0, 1));
  if (e >= 1) card.intro = false;
  return e;
}

export function chartCard(spec: Spec, host: ChartHost): Card {
  const plot = h("div", { class: "plot" }), legend = h("div", { class: "legend" }), why = h("p", { class: "cc-why", text: spec.why });
  const d = host.layout();
  const set = (field: "type" | "range" | "size", v: string) => { d[field][spec.id] = v; host.changed(); host.renderCharts(false); };
  const tb = (label: string, pressed: boolean, on: () => void, title: string) => h("button", { type: "button", "aria-pressed": String(pressed), title, onclick: on }, label);
  const tools = h("div", { class: "cc-tools" },
    spec.types.map((t) => tb(TYPE_NAME[t], t === spec.type, () => set("type", t), "Darstellung")),
    spec.ranges.map((r) => tb(r, r === spec.range, () => set("range", r), "Zeitraum")),
    ["S", "M", "L", "XL"].map((s) => tb(s, s === spec.size, () => set("size", s), "Grösse")),
    tb("×", false, () => {
      d.sel = d.sel.filter((x) => x !== spec.id);
      host.changed();
      host.renderCharts(false);
      toast(`«${spec.title}» entfernt. Unten bei den Vorschlägen kommt es zurück.`);
    }, "Entfernen"));
  // One-click alternative on every card (HAX G9: efficient correction).
  const swap = () => {
    const free = host.cands.filter((c) => !d.sel.includes(c.id));
    const alt = free.find((c) => spec.k && (c.k === spec.k || (c.ks && c.ks.includes(spec.k)))) || free[0];
    if (!alt) { toast("Lumina hat keine weitere Ansicht für diese Karte."); return; }
    d.sel[d.sel.indexOf(spec.id)] = alt.id;
    d.size[alt.id] = d.size[spec.id] || "M";
    host.changed();
    host.renderCharts(false, alt.id);
    toast(`Lumina zeigt stattdessen «${alt.title}». Die vorherige Ansicht liegt bei den Vorschlägen.`);
  };
  const el = h("article", { class: `panel chart-card size-${spec.size}`, "data-id": spec.id }, reg(),
    h("div", { class: "cc-head" }, h("div", {}, h("h3", { class: "cc-title", text: spec.title }), why),
      h("div", { class: "cc-side" }, h("button", { class: "cc-swap", type: "button", title: "Lumina schlägt eine andere Ansicht vor", onclick: swap }, "↻ Andere Ansicht"), tools)),
    plot, legend);
  const card: Card = { spec, el, intro: false, first: true, update: () => false };
  const draw: Draw = spec.kind === "daily" ? dailyChart(K[spec.k!], plot, legend) : RENDERERS[spec.kind](spec, plot, legend);
  card.update = (mc) => {
    if (mc) { const c = host.cands.find((x) => x.id === spec.id); if (c) why.textContent = c.why; }
    const again = draw(mc, card);
    card.first = false;
    return again;
  };
  return card;
}

const RENDERERS: Record<string, (spec: Spec, plot: HTMLElement, legend: HTMLElement) => Draw> = {
  trend(spec, plot, legend) {
    const k = K[spec.k!], fr = seriesFrame(plot), st: Axis = {};
    const tLab = pl(plot), rLab = pl(plot);
    const keys = [`<i style="background:currentColor"></i>${k.name}`];
    if (k.target !== null) keys.push(`<i style="background:var(--accent)"></i>${k.targetName}`);
    if (k.limit !== null) keys.push(`<i style="background:var(--alert)"></i>${k.limitName}`);
    legend.innerHTML = keys.map((x) => `<span>${x}</span>`).join("");
    return (_mc, card) => {
      const [w0, w1] = windowFor(spec), t = S.t, flow = k.kind === "flow";
      const X = (m: number) => ((m - w0) / Math.max(1e-6, w1 - w0)) * 600;
      const a = Math.max(0, Math.floor(w0)), b = Math.min(N - 1, Math.ceil(w1));
      const bars = spec.type === "balken";
      const periods = PERIODS[S.g].filter((p) => p.to >= a && p.from <= b);
      const pts: [number, number][] = [];
      for (let m = a; m <= b; m++) pts.push([m, k.series[m]]);
      const vals = bars ? periods.map((p) => valueAt(k, p)) : pts.map((p) => p[1]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (flow || bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const span = hi - lo || Math.abs(hi) * 0.1 || 1;
      for (const th of [k.limit, flow && bars ? null : k.target]) if (th !== null && th > lo - span * 0.8 && th < hi + span * 0.8) { lo = Math.min(lo, th); hi = Math.max(hi, th); }
      const pad = (hi - lo) * 0.1 || 1;
      let again = smooth(st, "lo", lo - pad, card.first) || false;
      again = smooth(st, "hi", hi + pad, card.first) || again;
      const Y = (v: number) => 188 - ((v - st.lo!) / (st.hi! - st.lo!)) * 176;
      const col = kindVar(kindOf(k, month()));
      setGrad(fr, col);
      fr.zones.replaceChildren();
      if (k.limit !== null) {
        const ry = Y(k.limit);
        fr.zones.append(k.dir > 0 ? sv("rect", { x: 0, y: ry, width: 600, height: Math.max(0, 188 - ry), fill: "var(--alert)", "fill-opacity": 0.09 }) : sv("rect", { x: 0, y: 0, width: 600, height: Math.max(0, ry), fill: "var(--alert)", "fill-opacity": 0.09 }),
          sv("line", { x1: 0, x2: 600, y1: ry, y2: ry, stroke: "var(--alert)", "stroke-width": 1.2, ...NSS }));
        placeRight(rLab, ry, `${k.dir < 0 ? "Limit" : "Min."} ${F(k, k.limit)}`, "var(--alert)");
      } else rLab.hidden = true;
      if (k.target !== null && !(flow && bars && S.g !== "monat")) {
        const tv = flow ? k.target * (bars ? monthsIn(PERIODS[S.g][0]) : 1) : k.target, ty = Y(tv);
        fr.zones.append(sv("line", { x1: 0, x2: 600, y1: ty, y2: ty, stroke: "var(--accent)", "stroke-width": 1.2, "stroke-dasharray": "var(--dash)", ...NSS }));
        placeRight(tLab, ty, `Ziel ${F(k, tv)}`, "var(--accent)");
      } else tLab.hidden = true;
      fr.ghosts.replaceChildren(); fr.solid.replaceChildren(); fr.over.replaceChildren();
      if (bars) {
        const y0 = Y(0);
        periods.forEach((p, j) => {
          const xa = X(p.from - 0.5), xb = X(p.to + 0.5), gap = Math.min(5, (xb - xa) * 0.18), v = vals[j], y = Y(v);
          const done = p.to <= t + 0.001;
          const pt = flow ? targetAt(k, p) : null;
          // IBCS: the plan per period as an outline behind the actual.
          if (pt !== null) fr.over.append(sv("rect", { x: xa + gap * 0.6, y: Math.min(Y(pt), y0), width: Math.max(0.5, xb - xa - 1.2 * gap), height: Math.max(0.6, Math.abs(y0 - Y(pt))), fill: "none", stroke: "var(--ink)", "stroke-opacity": 0.45, "stroke-width": 1, ...NSS }));
          const short = v < 0 || (pt !== null ? v < pt : k.target !== null && k.dir !== 0 && (v - k.target) * k.dir < 0);
          fr.over.append(sv("rect", { x: xa + gap, y: Math.min(y, y0), width: Math.max(0.5, xb - xa - 2 * gap), height: Math.max(0.6, Math.abs(y0 - y)),
            fill: !done ? "var(--ink)" : short ? "var(--alert)" : "var(--ink-2)",
            "fill-opacity": !done ? 0.08 : p.from <= t && t <= p.to + 0.999 ? 1 : 0.55 }));
        });
        fr.over.append(sv("line", { x1: 0, x2: 600, y1: y0, y2: y0, stroke: "var(--ink)", "stroke-opacity": 0.3, ...NSS }));
      } else {
        const d = lineD(pts, X, Y);
        fr.ghosts.append(sv("path", { d, fill: "none", stroke: "var(--ink)", "stroke-opacity": 0.13, "stroke-width": 1.2, ...NSS }));
        if (spec.type === "flaeche") fr.solid.append(sv("path", { d: `${d} L${X(b).toFixed(1)},188 L${X(a).toFixed(1)},188 Z`, fill: `url(#${fr.id}g)` }));
        fr.solid.append(sv("path", { d, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", ...NSS }));
      }
      const e = introFactor(card, st);
      if (e < 1) again = true;
      fr.clip.setAttribute("width", Math.max(0, X(t) * e + 1).toFixed(1));
      const v = valAt(k, t);
      fr.dot.hidden = bars || e < 1;
      fr.dot.style.left = (X(t) / 6).toFixed(2) + "%";
      fr.dot.style.top = (Y(v) / 2).toFixed(2) + "%";
      fr.dot.style.color = col;
      fr.hi.textContent = F(k, st.hi!);
      fr.lo.textContent = F(k, st.lo!);
      fr.x0.textContent = PERIODS.monat[a].label;
      fr.x1.textContent = PERIODS.monat[b].label;
      return again;
    };
  },

  parts(spec, plot, legend) {
    const k = K[spec.k!], parts = k.parts!, fr = seriesFrame(plot), st: Axis = {};
    return (mc, card) => {
      const [w0, w1] = windowFor(spec), t = S.t, flow = k.kind === "flow", share = spec.type === "anteile";
      const X = (m: number) => ((m - w0) / Math.max(1e-6, w1 - w0)) * 600;
      const a = Math.max(0, Math.floor(w0)), b = Math.min(N - 1, Math.ceil(w1));
      fr.ghosts.replaceChildren(); fr.solid.replaceChildren(); fr.over.replaceChildren(); fr.zones.replaceChildren();
      let again = false;
      if (flow) {
        const periods = PERIODS[S.g].filter((p) => p.to >= a && p.from <= b);
        const stacks = periods.map((p) => parts.map((part) => valueAt(k, p, part.series)));
        const lo = Math.min(0, ...stacks.map((s) => sum(s.filter((v) => v < 0)))), hi = Math.max(0, ...stacks.map((s) => sum(s.filter((v) => v > 0))));
        again = smooth(st, "lo", lo * 1.1, card.first) || again;
        again = smooth(st, "hi", hi * 1.1 || 1, card.first) || again;
        const Y = (v: number) => 188 - ((v - st.lo!) / (st.hi! - st.lo!)) * 176, y0 = Y(0);
        periods.forEach((p, j) => {
          const xa = X(p.from - 0.5), xb = X(p.to + 0.5), gap = Math.min(5, (xb - xa) * 0.18), done = p.from <= t;
          let up = 0, down = 0;
          stacks[j].forEach((v, n) => {
            const from = v >= 0 ? up : down, to = from + v;
            if (v >= 0) up = to; else down = to;
            fr.solid.append(sv("rect", { x: xa + gap, y: Math.min(Y(from), Y(to)), width: Math.max(0.5, xb - xa - 2 * gap), height: Math.abs(Y(from) - Y(to)), fill: PART_COLORS[n], "fill-opacity": done ? 0.9 : 0.08 }));
          });
        });
        fr.over.append(sv("line", { x1: 0, x2: 600, y1: y0, y2: y0, stroke: "var(--ink)", "stroke-opacity": 0.3, ...NSS }));
        fr.hi.textContent = F(k, st.hi!);
        fr.lo.textContent = F(k, st.lo!);
      } else {
        const rows: [number, number[]][] = [];
        for (let m = a; m <= b; m++) { const vs = parts.map((p) => p.series[m]), tot = sum(vs); rows.push([m, share ? vs.map((v) => (v / tot) * 100) : vs]); }
        const hi = share ? 100 : Math.max(...rows.map((r) => sum(r[1])));
        again = smooth(st, "lo", 0, card.first) || again;
        again = smooth(st, "hi", hi * (share ? 1 : 1.08), card.first) || again;
        const Y = (v: number) => 188 - ((v - st.lo!) / (st.hi! - st.lo!)) * 176;
        let base = rows.map(() => 0);
        parts.forEach((_p, i) => {
          const top = rows.map((r, j) => base[j] + r[1][i]);
          const up = rows.map((r, j) => [r[0], top[j]] as [number, number]), dn = rows.map((r, j) => [r[0], base[j]] as [number, number]).reverse();
          fr.solid.append(sv("path", { d: lineD(up, X, Y) + " L" + dn.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(2)}`).join(" L") + " Z", fill: PART_COLORS[i], "fill-opacity": 0.55 }),
            sv("path", { d: lineD(up, X, Y), fill: "none", stroke: PART_COLORS[i], "stroke-width": 1.4, ...NSS }));
          fr.ghosts.append(sv("path", { d: lineD(up, X, Y), fill: "none", stroke: "var(--ink)", "stroke-opacity": 0.1, ...NSS }));
          base = top;
        });
        fr.hi.textContent = share ? "100 %" : F(k, st.hi!);
        fr.lo.textContent = share ? "0 %" : F(k, 0);
      }
      const e = introFactor(card, st);
      if (e < 1) again = true;
      fr.clip.setAttribute("width", Math.max(0, (flow ? 600 : X(t)) * e + 1).toFixed(1));
      fr.dot.hidden = true;
      fr.x0.textContent = PERIODS.monat[a].label;
      fr.x1.textContent = PERIODS.monat[b].label;
      if (mc || card.first) {
        const m = month(), vs = parts.map((p) => valAt(k, m, p.series)), tot = sum(vs.map(Math.abs)) || 1;
        legend.innerHTML = parts.map((p, i) => `<span><i style="background:${PART_COLORS[i]}"></i>${p.name} ${flow ? F(k, vs[i]) : Math.round((vs[i] / tot) * 100) + " %"}</span>`).join("");
      }
      return again;
    };
  },

  drivers(spec, plot, legend) {
    const k = K[spec.k!], parts = k.parts!;
    return indexed(spec, plot, legend, parts.map((p, i) => ({ name: p.name, arr: p.series, color: PART_COLORS[i] })), `${k.name} = ${parts[0].name} ÷ ${parts[1].name}`);
  },
  compare(spec, plot, legend) {
    return indexed(spec, plot, legend, spec.ks!.map((id, i) => ({ name: K[id].name, arr: K[id].series, color: PART_COLORS[i] })), "Beide Reihen = 100 am Anfang des Fensters");
  },

  cum(spec, plot, legend) {
    const k = K[spec.k!], fr = seriesFrame(plot), st: Axis = {}, tLab = pl(plot);
    return (_mc, card) => {
      const t = S.t, m = month(), y0m = Math.max(0, m - monthOf(m)), X = (mm: number) => ((mm - y0m + 0.5) / 12) * 600;
      const monthsDone: [number, number][] = [];
      for (let mm = y0m; mm <= Math.min(N - 1, m - monthOf(m) + 11); mm++) monthsDone.push([mm, k.series[mm]]);
      const cum: [number, number][] = [];
      let acc = 0;
      for (const [mm, v] of monthsDone) { acc += v; cum.push([mm, acc]); }
      const target = (k.target ?? 0) * 12;
      const lo = Math.min(0, ...monthsDone.map((p) => p[1]), ...cum.map((p) => p[1])), hi = Math.max(target, ...cum.map((p) => p[1]), ...monthsDone.map((p) => p[1]));
      let again = smooth(st, "lo", lo * 1.1, card.first) || false;
      again = smooth(st, "hi", hi * 1.08, card.first) || again;
      const Y = (v: number) => 188 - ((v - st.lo!) / (st.hi! - st.lo!)) * 176, yz = Y(0);
      fr.zones.replaceChildren(sv("line", { x1: X(y0m - 0.5), y1: Y(0), x2: X(y0m + 11.5), y2: Y(target), stroke: "var(--accent)", "stroke-width": 1.2, "stroke-dasharray": "var(--dash)", ...NSS }));
      fr.ghosts.replaceChildren(); fr.solid.replaceChildren(); fr.over.replaceChildren();
      const col = kindVar(kindOf(k, m));
      monthsDone.forEach(([mm, v]) => {
        const x = X(mm), y = Y(v), done = mm <= t + 0.001;
        fr.over.append(sv("rect", { x: x - 14, y: Math.min(y, yz), width: 28, height: Math.max(0.6, Math.abs(yz - y)), fill: v < 0 ? "var(--alert)" : col, "fill-opacity": done ? 0.55 : 0.07 }));
      });
      fr.over.append(sv("line", { x1: 0, x2: 600, y1: yz, y2: yz, stroke: "var(--ink)", "stroke-opacity": 0.3, ...NSS }));
      const shown = cum.filter((p) => p[0] <= t);
      const cv = shown.length ? shown[shown.length - 1][1] : 0;
      fr.solid.append(sv("path", { d: lineD([[y0m - 0.5, 0], ...cum], X, Y), fill: "none", stroke: "var(--c2)", "stroke-width": 2.2, ...NSS }));
      const e = introFactor(card, st);
      if (e < 1) again = true;
      fr.clip.setAttribute("width", (X(Math.min(t, y0m + 11)) * e + 1).toFixed(1));
      fr.dot.hidden = e < 1;
      fr.dot.style.color = "var(--c2)";
      fr.dot.style.left = (X(m) / 6).toFixed(2) + "%";
      fr.dot.style.top = (Y(cv) / 2).toFixed(2) + "%";
      placeRight(tLab, Y(target), `Ziel ${F(k, target)}`, "var(--accent)");
      const n = monthOf(m) + 1, tgtNow = (k.target ?? 0) * n;
      legend.innerHTML = `<span><i style="background:currentColor"></i>Monat</span><span><i style="background:var(--c2)"></i>Kumuliert</span><span><i style="background:var(--accent)"></i>Jahresziel</span><span style="color:${cv < tgtNow ? "var(--alert)" : "var(--good)"}">${yearOf(m)}: ${F(k, cv)} von ${F(k, tgtNow)} bis ${MON[monthOf(m)]}</span>`;
      fr.hi.textContent = F(k, st.hi!);
      fr.lo.textContent = "";
      fr.x0.textContent = "Jan " + yearOf(m);
      fr.x1.textContent = "Dez";
      return again;
    };
  },

  bridge(spec, plot, legend) {
    const k = K[spec.k!], parts = k.parts!, st: { prev: { from: number; to: number }[] | null } = { prev: null };
    const svg = sv("svg", { viewBox: "0 0 600 200", preserveAspectRatio: "none", "aria-hidden": "true" });
    plot.replaceChildren(svg);
    const slots = parts.length + 2, labs = Array.from({ length: slots }, () => pl(plot)), cats = Array.from({ length: slots }, () => pl(plot)), empty = pl(plot, "empty-note");
    legend.innerHTML = `<span><i style="background:var(--good)"></i>hilft</span><span><i style="background:var(--alert)"></i>belastet</span>`;
    legend.style.marginTop = "22px";
    const sumRange = (arr: number[], a: number, b: number) => sum(arr.slice(Math.max(0, a), b + 1));
    return (mc, card) => {
      if (!mc && !card.first) return false;
      const m = month();
      if (m < (k.kind === "flow" ? 23 : 12)) {
        svg.replaceChildren();
        labs.concat(cats).forEach((l) => (l.hidden = true));
        empty.hidden = false;
        empty.textContent = "Für die Brücke braucht es zwölf Monate Geschichte.";
        return false;
      }
      empty.hidden = true;
      const val = (arr: number[], at: number) => (k.kind === "flow" ? sumRange(arr, at - 11, at) : arr[at]);
      const start = val(k.series, m - 12), end = val(k.series, m);
      const deltas = parts.map((p) => val(p.series, m) - val(p.series, m - 12));
      const steps: { name: string; from: number; to: number; kind: string }[] = [{ name: k.kind === "flow" ? "12 Mt. davor" : PERIODS.monat[m - 12].label, from: 0, to: start, kind: "base" }];
      let acc = start;
      deltas.forEach((dl, i) => { steps.push({ name: parts[i].name, from: acc, to: acc + dl, kind: dl * (k.dir || 1) >= 0 ? "good" : "alert" }); acc += dl; });
      steps.push({ name: k.kind === "flow" ? "Letzte 12 Mt." : PERIODS.monat[m].label, from: 0, to: end, kind: "end" });
      const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to))), hi = Math.max(...steps.map((s) => Math.max(s.from, s.to)));
      const zoomLo = k.kind === "flow" ? lo : Math.max(0, Math.min(...steps.map((s) => Math.min(s.from || s.to, s.to))) * 0.92);
      const prev = st.prev, next = steps;
      st.prev = steps;
      const n = steps.length, slot = 600 / n;
      const render = (e: number) => {
        const Y = (v: number) => 188 - ((v - zoomLo) / (hi * 1.05 - zoomLo || 1)) * 170;
        const kids = [sv("line", { x1: 0, x2: 600, y1: 188, y2: 188, stroke: "var(--line-2)", ...NSS })];
        next.forEach((s, i) => {
          const p = prev && prev[i] ? prev[i] : { from: s.from, to: s.from };
          const from = lerp(p.from, s.from, e), to = lerp(p.to, s.to, e);
          const f2 = s.kind === "base" || s.kind === "end" ? zoomLo : from;
          const y1 = Y(Math.max(f2, to)), y2 = Y(Math.min(f2, to));
          kids.push(sv("rect", { x: i * slot + slot * 0.2, y: y1, width: slot * 0.6, height: Math.max(1, y2 - y1), fill: s.kind === "base" ? "var(--ink)" : s.kind === "end" ? kindVar(kindOf(k, m)) : `var(--${s.kind})`, "fill-opacity": s.kind === "base" ? 0.35 : 0.85 }));
          if (i < n - 1) kids.push(sv("line", { x1: i * slot + slot * 0.8, x2: (i + 1) * slot + slot * 0.2, y1: Y(to), y2: Y(to), stroke: "var(--ink)", "stroke-opacity": 0.35, "stroke-dasharray": "3 3", ...NSS }));
          const lab = labs[i], cat = cats[i];
          lab.hidden = false;
          lab.style.left = `${((i + 0.5) / n) * 100}%`;
          lab.style.transform = "translateX(-50%)";
          lab.style.top = `calc(${(y1 / 200) * 100}% - 14px)`;
          lab.style.color = "var(--ink)";
          lab.textContent = s.kind === "base" || s.kind === "end" ? compact(k, to) : (to - from >= 0 ? "+" : "−") + compact(k, Math.abs(to - from));
          cat.hidden = false;
          cat.className = "plot-lab plot-cat";
          cat.style.left = `${((i + 0.5) / n) * 100}%`;
          cat.style.width = `${100 / n}%`;
          cat.textContent = s.name;
        });
        svg.replaceChildren(...kids);
      };
      animate(card.first ? 900 : 600, render);
      return false;
    };
  },

  season(spec, plot, legend) {
    const k = K[spec.k!], flow = k.kind === "flow";
    const all = k.series, lo = Math.min(...all), hi = Math.max(...all), mx = Math.max(Math.abs(lo), Math.abs(hi));
    const y0 = yearOf(0), years = yearOf(N - 1) - y0 + 1, off = START_M;
    const cells: HTMLElement[] = [];
    const grid = h("div", { class: "season" },
      Array.from({ length: years }, (_, yi) => h("div", { class: "season-row" }, h("span", { text: String(y0 + yi) }),
        Array.from({ length: 12 }, (__, mi) => {
          const m = yi * 12 + mi - off;
          const c = h("span", { class: "cell", title: m >= 0 && m < N ? `${PERIODS.monat[m].long}: ${F(k, all[m])}` : "" });
          cells.push(c);
          c.dataset.m = String(m);
          return c;
        }))),
      h("div", { class: "season-axis" }, h("span"), MON.map((x) => h("span", { text: x[0] }))));
    plot.replaceChildren(grid);
    plot.style.height = "auto";
    legend.innerHTML = flow ? `<span><i style="background:var(--accent)"></i>Zufluss</span><span><i style="background:var(--alert)"></i>Abfluss</span>` : `<span><i style="background:var(--accent)"></i>heller heisst höher</span>`;
    return (mc, card) => {
      if (!mc && !card.first) return false;
      const m = month();
      for (const c of cells) {
        const i = Number(c.dataset.m);
        if (i < 0 || i >= N) { c.style.setProperty("--c", "transparent"); c.classList.add("is-future"); continue; }
        const v = all[i];
        const col = flow ? (v < 0 ? `color-mix(in srgb, var(--alert) ${Math.round(20 + (Math.abs(v) / mx) * 75)}%, transparent)` : `color-mix(in srgb, var(--accent) ${Math.round(12 + (v / mx) * 80)}%, transparent)`)
          : `color-mix(in srgb, var(--accent) ${Math.round(10 + ((v - lo) / (hi - lo || 1)) * 80)}%, transparent)`;
        c.style.setProperty("--c", col);
        c.classList.toggle("is-future", i > m);
        c.classList.toggle("is-now", i === m);
      }
      return false;
    };
  },

  buffer(spec, plot, legend) {
    const rows = spec.ks!.map((id) => {
      const k = K[id], bar = h("span", { class: "buf-bar" }), lim = h("span", { class: "buf-mark", style: "background:var(--alert)" }, h("span", { text: k.dir < 0 ? "Limit" : "Min", style: "color:var(--alert)" }));
      const tgt = h("span", { class: "buf-mark", style: "background:var(--accent)" }, h("span", { text: k.dir < 0 ? "Warn" : "Ziel", style: "color:var(--accent);top:auto;bottom:-13px" }));
      const note = h("small"), val = h("b", { class: "num" });
      const el = h("div", { class: "buf-row" }, h("div", { class: "buf-name" }, k.name, " ", val, note), h("div", { class: "buf-track" }, bar, lim, tgt));
      return { k, el, bar, lim, tgt, note, val };
    });
    plot.replaceChildren(h("div", { class: "buf" }, rows.map((r) => r.el)));
    plot.style.height = "auto";
    legend.innerHTML = `<span><i style="background:var(--alert)"></i>Regulatorisch</span><span><i style="background:var(--accent)"></i>Intern</span>`;
    return () => {
      for (const r of rows) {
        const k = r.k, limit = k.limit as number, v = valAt(k, S.t), max = Math.max(limit, k.target || 0, ...k.series) * 1.15;
        r.bar.style.width = `${clamp(v / max, 0, 1) * 100}%`;
        r.bar.style.setProperty("--c", kindVar(kindOf(k, month())));
        r.lim.style.left = `${(limit / max) * 100}%`;
        r.tgt.hidden = k.target === null;
        r.tgt.style.left = `${((k.target || 0) / max) * 100}%`;
        r.val.textContent = F(k, v);
        const buf = (v - limit) * k.dir;
        r.note.textContent = `${buf >= 0 ? "Puffer" : "Unterschreitung"} ${k.unit === "%" ? Math.abs(buf).toFixed(k.dec) + " Pp." : F(k, Math.abs(buf))} zum ${k.dir < 0 ? "Limit" : "Minimum"}`;
      }
      return false;
    };
  },

  funnel(spec, plot, legend) {
    const k = K[spec.k!], parts = k.parts!;
    const rows = parts.map((p, i) => { const bar = h("span", { class: "fun-bar", style: `--c:${PART_COLORS[i]}` }), v = h("b", { class: "num" }); return { bar, v, el: h("div", { class: "fun-row" }, h("span", { text: p.name }), bar, v) }; });
    const total = h("span", { class: "label" });
    plot.replaceChildren(h("div", { class: "fun" }, rows.map((r) => r.el), total));
    plot.style.height = "auto";
    legend.innerHTML = "";
    return () => {
      const t = S.t, vs = parts.map((p) => valAt(k, t, p.series)), max = Math.max(...vs), tot = sum(vs);
      rows.forEach((r, i) => { r.bar.style.width = `${(vs[i] / max) * 100}%`; r.v.textContent = F(k, vs[i]); });
      const m = month(), prev = m >= 12 ? k.series[m - 12] : null;
      total.textContent = `Total ${F(k, tot)} · ${parts[parts.length - 1].name} ${pct(vs[vs.length - 1] / tot)} des Volumens${prev !== null ? ` · ${fdelta(k, k.series[m] - prev, prev)} ggü. Vorjahr` : ""}`;
      return false;
    };
  },
};

function indexed(spec: Spec, plot: HTMLElement, legend: HTMLElement, series: { name: string; arr: number[]; color: string }[], caption: string): Draw {
  const fr = seriesFrame(plot), st: Axis = {}, base = pl(plot);
  return (_mc, card) => {
    const [w0, w1] = windowFor(spec), t = S.t, X = (m: number) => ((m - w0) / Math.max(1e-6, w1 - w0)) * 600;
    const a = Math.max(0, Math.floor(w0)), b = Math.min(N - 1, Math.ceil(w1));
    const lines = series.map((s) => { const b0 = s.arr[a]; const pts: [number, number][] = []; for (let m = a; m <= b; m++) pts.push([m, (s.arr[m] / b0) * 100]); return { ...s, pts }; });
    const vals = lines.flatMap((l) => l.pts.map((p) => p[1])).concat([100]);
    let again = smooth(st, "lo", Math.min(...vals) - 2, card.first) || false;
    again = smooth(st, "hi", Math.max(...vals) + 2, card.first) || again;
    const Y = (v: number) => 188 - ((v - st.lo!) / (st.hi! - st.lo!)) * 176;
    fr.zones.replaceChildren(sv("line", { x1: 0, x2: 600, y1: Y(100), y2: Y(100), stroke: "var(--ink)", "stroke-opacity": 0.35, "stroke-dasharray": "2 4", ...NSS }));
    fr.ghosts.replaceChildren(...lines.map((l) => sv("path", { d: lineD(l.pts, X, Y), fill: "none", stroke: "var(--ink)", "stroke-opacity": 0.12, ...NSS })));
    fr.solid.replaceChildren(...lines.map((l) => sv("path", { d: lineD(l.pts, X, Y), fill: "none", stroke: l.color, "stroke-width": 2, ...NSS })));
    const e = introFactor(card, st);
    if (e < 1) again = true;
    fr.clip.setAttribute("width", (X(t) * e + 1).toFixed(1));
    fr.dot.hidden = true;
    placeRight(base, Y(100), "100", "var(--dim)");
    fr.hi.textContent = String(Math.round(st.hi!));
    fr.lo.textContent = String(Math.round(st.lo!));
    fr.x0.textContent = PERIODS.monat[a].label;
    fr.x1.textContent = PERIODS.monat[b].label;
    const m = Math.min(b, month());
    legend.innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${l.name} ${Math.round(l.pts[clamp(m - a, 0, l.pts.length - 1)][1])}</span>`).join("") + `<span>${caption}</span>`;
    return again;
  };
}

