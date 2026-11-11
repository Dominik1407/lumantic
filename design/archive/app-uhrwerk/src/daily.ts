// Daily values of the running month: the heart of the Tagesübersicht.
// Stocks (LCR, deposits) as a line across the last months, flows (net new
// money) as the month so far against the path to the monthly target.
import { sv } from "./dom";
import { kindOf } from "./engine";
import { F, businessDaysIn, dayShort, fdeltaDay, isoDay, parseDay } from "./format";
import { DAYS, MON, MONTH, N, sum, type Kpi } from "./model";
import { NSS, PART_COLORS, lineD, pl, placeRight, seriesFrame, setGrad } from "./plot";
import { animate, easeOut } from "./time";
import { kindVar } from "./ui";

const monthOfDay = (iso: string) => iso.slice(0, 7);

export interface DailyFacts {
  value: number;
  day: string; // ISO date of the latest value
  head: string; // "Tageswert 9.11." or "November bis 9.11."
  vsDay: string;
  vsMonth: string;
}

// The running month's days with data, and all its business days.
function runningMonth() {
  const last = DAYS[DAYS.length - 1], d = parseDay(last);
  const y = d.getUTCFullYear(), m0 = d.getUTCMonth();
  const all: string[] = [];
  for (let x = new Date(Date.UTC(y, m0, 1)); x.getUTCMonth() === m0; x.setUTCDate(x.getUTCDate() + 1)) if (x.getUTCDay() % 6 !== 0) all.push(isoDay(x));
  const done = DAYS.map((iso, i) => ({ iso, i })).filter((x) => monthOfDay(x.iso) === monthOfDay(last));
  return { y, m0, all, done, total: businessDaysIn(y, m0) };
}

export function dailyFacts(k: Kpi): DailyFacts | null {
  if (!k.daily || !DAYS.length) return null;
  const s = k.daily.series, n = s.length, last = DAYS[n - 1];
  if (k.kind === "flow") {
    const rm = runningMonth(), mtd = sum(rm.done.map((x) => s[x.i]));
    const pace = k.target !== null ? (k.target * rm.done.length) / rm.total : null;
    return {
      value: mtd, day: last, head: `${MONTH[rm.m0]} bis ${dayShort(last)}`,
      vsDay: `${fdeltaDay(k, s[n - 1], 0)} am ${dayShort(last)}`,
      vsMonth: pace !== null ? `Zielpfad bis heute ${pace >= 0 ? "+" : "−"}${Math.abs(pace).toFixed(1)} Mio. CHF (${rm.done.length} von ${rm.total} Geschäftstagen)` : "",
    };
  }
  // The last value of the previous month is its month-end figure.
  let me = n - 2;
  while (me > 0 && monthOfDay(DAYS[me]) === monthOfDay(last)) me--;
  const prevName = MONTH[parseDay(DAYS[me]).getUTCMonth()];
  return {
    value: s[n - 1], day: last, head: `Tageswert ${dayShort(last)}`,
    vsDay: `${fdeltaDay(k, s[n - 1] - s[n - 2], s[n - 2])} ggü. Vortag`,
    vsMonth: `${fdeltaDay(k, s[n - 1] - s[me], s[me])} seit Ende ${prevName}`,
  };
}

// Returns a draw function in the chart-card shape; the picture does not move with time.
export function dailyChart(k: Kpi, plot: HTMLElement, legend: HTMLElement): (mc: boolean, card: { first: boolean }) => boolean {
  return k.kind === "flow" ? dailyFlow(k, plot, legend) : dailyStock(k, plot, legend);
}

function reveal(clip: SVGElement, first: boolean) {
  if (!first) { clip.setAttribute("width", "601"); return; }
  animate(1000, (e) => clip.setAttribute("width", (e * 600 + 1).toFixed(1)), easeOut);
}

function dailyStock(k: Kpi, plot: HTMLElement, legend: HTMLElement) {
  const fr = seriesFrame(plot), s = k.daily!.series, n = s.length;
  const tLab = pl(plot), rLab = pl(plot);
  const monthLabs = new Map<string, HTMLElement>();
  fr.x0.hidden = fr.x1.hidden = true;
  return (_mc: boolean, card: { first: boolean }) => {
    const X = (i: number) => (i / Math.max(1, n - 1)) * 600;
    let lo = Math.min(...s), hi = Math.max(...s);
    const span = hi - lo || Math.abs(hi) * 0.05 || 1;
    for (const th of [k.limit, k.target]) if (th !== null && th > lo - span * 0.8 && th < hi + span * 0.8) { lo = Math.min(lo, th); hi = Math.max(hi, th); }
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad; hi += pad;
    const Y = (v: number) => 188 - ((v - lo) / (hi - lo)) * 176;
    const col = kindVar(kindOf(k, N - 1));
    setGrad(fr, col);
    fr.zones.replaceChildren();
    if (k.limit !== null) {
      const ry = Y(k.limit);
      fr.zones.append(k.dir > 0 ? sv("rect", { x: 0, y: ry, width: 600, height: Math.max(0, 188 - ry), fill: "var(--alert)", "fill-opacity": 0.09 }) : sv("rect", { x: 0, y: 0, width: 600, height: Math.max(0, ry), fill: "var(--alert)", "fill-opacity": 0.09 }),
        sv("line", { x1: 0, x2: 600, y1: ry, y2: ry, stroke: "var(--alert)", "stroke-width": 1.2, ...NSS }));
      placeRight(rLab, ry, `${k.dir < 0 ? "Limit" : "Min."} ${F(k, k.limit)}`, "var(--alert)");
    } else rLab.hidden = true;
    if (k.target !== null) {
      const ty = Y(k.target);
      fr.zones.append(sv("line", { x1: 0, x2: 600, y1: ty, y2: ty, stroke: "var(--accent)", "stroke-width": 1.2, "stroke-dasharray": "var(--dash)", ...NSS }));
      placeRight(tLab, ty, `Ziel ${F(k, k.target)}`, "var(--accent)");
    } else tLab.hidden = true;
    // Month boundaries, with the month name centred on its stretch.
    fr.ghosts.replaceChildren();
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && monthOfDay(DAYS[i]) === monthOfDay(DAYS[i - 1])) continue;
      if (i < n) fr.ghosts.append(sv("line", { x1: X(i - 0.5), x2: X(i - 0.5), y1: 0, y2: 188, stroke: "var(--ink)", "stroke-opacity": 0.12, "stroke-dasharray": "2 4", ...NSS }));
      const key = DAYS[start].slice(0, 7);
      const lab = monthLabs.get(key) || pl(plot);
      monthLabs.set(key, lab);
      const mi = parseDay(DAYS[start]).getUTCMonth();
      lab.textContent = i === n ? `${MON[mi]} bis ${dayShort(DAYS[n - 1])}` : MON[mi];
      lab.style.left = `${((X(start) + X(i - 1)) / 2 / 6).toFixed(2)}%`;
      lab.style.transform = "translateX(-50%)";
      lab.style.bottom = "-2px";
      start = i;
    }
    const pts = s.map((v, i) => [i, v] as [number, number]), d = lineD(pts, X, Y);
    fr.solid.replaceChildren(sv("path", { d: `${d} L600,188 L0,188 Z`, fill: `url(#${fr.id}g)` }), sv("path", { d, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", ...NSS }));
    fr.over.replaceChildren();
    fr.dot.hidden = false;
    fr.dot.style.left = "100%";
    fr.dot.style.top = (Y(s[n - 1]) / 2).toFixed(2) + "%";
    fr.dot.style.color = col;
    fr.hi.textContent = F(k, hi);
    fr.lo.textContent = F(k, lo);
    legend.innerHTML = `<span><i style="background:${col}"></i>${k.name} pro Geschäftstag</span>` +
      (k.target !== null && !tLab.hidden ? `<span><i style="background:var(--accent)"></i>${k.targetName}</span>` : "") +
      (k.limit !== null && !rLab.hidden ? `<span><i style="background:var(--alert)"></i>${k.limitName}</span>` : "");
    reveal(fr.clip, card.first);
    return false;
  };
}

function dailyFlow(k: Kpi, plot: HTMLElement, legend: HTMLElement) {
  const fr = seriesFrame(plot), s = k.daily!.series, parts = k.daily!.parts;
  const tLab = pl(plot);
  return (_mc: boolean, card: { first: boolean }) => {
    const rm = runningMonth(), nb = rm.all.length;
    const X = (i: number) => ((i + 0.5) / nb) * 600;
    const byDay = new Map(rm.done.map((x) => [x.iso, x.i]));
    const stacks = rm.all.map((iso) => { const i = byDay.get(iso); return i === undefined ? null : parts ? parts.map((p) => p.series[i]) : [s[i]]; });
    let acc = 0;
    const cum: [number, number][] = [[-0.5, 0]];
    rm.all.forEach((iso, j) => { const i = byDay.get(iso); if (i !== undefined) { acc += s[i]; cum.push([j, acc]); } });
    const target = k.target ?? 0;
    const vals = [0, target, ...cum.map((p) => p[1]), ...stacks.flatMap((st) => (st ? [sum(st.filter((v) => v > 0)), sum(st.filter((v) => v < 0))] : []))];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    const Y = (v: number) => 188 - ((v - lo) / (hi - lo)) * 176, y0 = Y(0);
    fr.zones.replaceChildren(sv("line", { x1: 0, y1: y0, x2: 600, y2: Y(target), stroke: "var(--accent)", "stroke-width": 1.2, "stroke-dasharray": "var(--dash)", ...NSS }));
    placeRight(tLab, Y(target), `Ziel ${F(k, target)}`, "var(--accent)");
    fr.ghosts.replaceChildren();
    fr.over.replaceChildren(sv("line", { x1: 0, x2: 600, y1: y0, y2: y0, stroke: "var(--ink)", "stroke-opacity": 0.3, ...NSS }));
    const w = Math.max(2, (600 / nb) * 0.56);
    stacks.forEach((st, j) => {
      if (!st) { fr.ghosts.append(sv("rect", { x: X(j) - w / 2, y: y0 - 1, width: w, height: 2, fill: "var(--ink)", "fill-opacity": 0.12 })); return; }
      let up = 0, down = 0;
      st.forEach((v, pi) => {
        const from = v >= 0 ? up : down, to = from + v;
        if (v >= 0) up = to; else down = to;
        fr.solid.append(sv("rect", { x: X(j) - w / 2, y: Math.min(Y(from), Y(to)), width: w, height: Math.max(0.6, Math.abs(Y(from) - Y(to))), fill: PART_COLORS[pi] || "var(--ink-2)", "fill-opacity": 0.75 }));
      });
    });
    const col = kindVar(kindOf(k, N - 1));
    fr.solid.append(sv("path", { d: lineD(cum, X, Y), fill: "none", stroke: col, "stroke-width": 2.2, "stroke-linejoin": "round", ...NSS }));
    const lastPt = cum[cum.length - 1];
    fr.dot.hidden = false;
    fr.dot.style.left = (X(lastPt[0]) / 6).toFixed(2) + "%";
    fr.dot.style.top = (Y(lastPt[1]) / 2).toFixed(2) + "%";
    fr.dot.style.color = col;
    fr.hi.textContent = F(k, hi);
    fr.lo.textContent = F(k, lo);
    fr.x0.textContent = dayShort(rm.all[0]);
    fr.x1.textContent = dayShort(rm.all[nb - 1]);
    const partSums = parts ? parts.map((p) => sum(rm.done.map((x) => p.series[x.i]))) : [];
    legend.innerHTML = `<span><i style="background:${col}"></i>Kumuliert ${F(k, acc)}</span><span><i style="background:var(--accent)"></i>Zielpfad</span>` +
      (parts ? parts.map((p, i) => `<span><i style="background:${PART_COLORS[i]}"></i>${p.name} ${partSums[i] >= 0 ? "+" : "−"}${Math.abs(partSums[i]).toFixed(1)}</span>`).join("") : "");
    reveal(fr.clip, card.first);
    return false;
  };
}
