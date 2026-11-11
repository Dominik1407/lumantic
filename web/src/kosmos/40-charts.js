// ═════ Kosmos · word-sized charts and evidence (carried over from Seite) ═════
let uidN = 0;
const NSS = { "vector-effect": "non-scaling-stroke" };
const PART_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)"];
// Evidence shows up to 36 months and ends at the chosen month whenever history allows.
const win = (m) => { const w1 = Math.max(m, Math.min(TODAY, 35)); return [Math.max(0, w1 - 35), w1]; };
const lineD = (pts, X, Y) => "M" + pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(2)}`).join(" L");
// The same line, broken where a month has no data of its own.
const lineGaps = (pts, X, Y, gap) => { let out = "", pen = false; for (const p of pts) { if (gap(p[0])) { pen = false; continue; } out += (pen ? " L" : (out ? " M" : "M")) + `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(2)}`; pen = true; } return out || "M0,0"; };
const key = (swatch, text) => h("span", {}, swatch, text);
const box = (color) => h("i", { class: "box", style: `background:${color}` });
const dash = (color) => h("i", { style: `background:repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` });

// Word-sized chart: the last 24 months up to m. Lines for balances, bars for flows.
function sparkEl(k) {
  const svg = sv("svg", { class: "sp", viewBox: "0 0 64 18", preserveAspectRatio: "none", "aria-hidden": "true" });
  svg._k = k;
  return svg;
}
function sparkSet(svg, m) {
  if (svg._m === m) return;
  if (svg._m !== undefined) svg.classList.remove("draw");
  svg._m = m;
  const k = svg._k, a = Math.max(0, m - 23), vals = k.series.slice(a, m + 1), n = vals.length, off = 24 - n, kids = [];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (k.kind === "flow") {
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    const Y = (v) => 16.5 - ((v - lo) / (hi - lo || 1)) * 15, y0 = Y(0), w = 64 / 24;
    vals.forEach((v, i) => kids.push(sv("rect", { class: "sb" + (i === n - 1 ? " now" : "") + (v < 0 ? " neg" : ""), x: ((i + off) * w + 0.45).toFixed(2), y: Math.min(Y(v), y0).toFixed(2), width: (w - 0.9).toFixed(2), height: Math.max(0.7, Math.abs(y0 - Y(v))).toFixed(2) })));
  } else {
    const Y = (v) => (hi === lo ? 9 : 16 - ((v - lo) / (hi - lo)) * 14), X = (i) => 1.5 + ((i + off) / 23) * 60.5;
    if (n > 1) { const d = "M" + vals.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" L"); kids.push(sv("path", { class: "sg", d }), sv("path", { class: "sl", d, pathLength: 1 })); }
    kids.push(sv("circle", { class: "sd", cx: X(n - 1).toFixed(1), cy: Y(vals[n - 1]).toFixed(1), r: 1.9 }));
  }
  svg.replaceChildren(...kids);
}

// Shared frame: a 600 × 200 drawing that stretches, labels as HTML so type stays crisp.
function chartFrame() {
  const id = "cl" + ++uidN, clip = sv("rect", { x: 0, y: -20, width: 600, height: 240 });
  const svg = sv("svg", { viewBox: "0 0 600 200", preserveAspectRatio: "none", "aria-hidden": "true" }, sv("defs", {}, sv("clipPath", { id }, clip)));
  const grid = sv("g"), zones = sv("g"), ghost = sv("g"), solid = sv("g", { "clip-path": `url(#${id})` }), over = sv("g");
  for (const y of [12, 70.7, 129.3]) grid.append(sv("line", { class: "gr", x1: 0, x2: 600, y1: y, y2: y, ...NSS }));
  grid.append(sv("line", { class: "ax", x1: 0, x2: 600, y1: 188, y2: 188, ...NSS }));
  svg.append(grid, zones, ghost, solid, over);
  const plot = h("div", { class: "plot" }, svg);
  const lab = (cls) => { const s = h("span", { class: "pl" + (cls ? " " + cls : "") }); plot.append(s); return s; };
  const fr = { plot, clip, zones, ghost, solid, over, lab, hv: null, hi: lab(), lo: lab(), x0: lab(), x1: lab() };
  fr.hi.style.cssText = "left:0;top:3px";
  fr.lo.style.cssText = "left:0;bottom:calc(6% + 4px)";
  fr.x0.style.cssText = "left:0;top:calc(94% + 5px)";
  fr.x1.style.cssText = "right:0;top:calc(94% + 5px)";
  const hair = h("div", { class: "hair", hidden: true }), tip = lab("ptip");
  tip.hidden = true;
  plot.append(hair);
  plot.addEventListener("pointermove", (e) => {
    const hv = fr.hv;
    if (!hv) return;
    const b = plot.getBoundingClientRect(), t = hv.at(clamp((e.clientX - b.left) / b.width, 0, 1));
    hair.hidden = tip.hidden = false;
    hair.style.left = hv.x(t) + "%";
    tip.textContent = hv.text(t);
    tip.style.left = clamp(hv.x(t), 14, 86) + "%";
  });
  plot.addEventListener("pointerleave", () => { hair.hidden = tip.hidden = true; });
  fr.clear = () => { zones.replaceChildren(); ghost.replaceChildren(); solid.replaceChildren(); over.replaceChildren(); };
  return fr;
}
// Limit and target are named on their line. Two lines that lie close get their names side by side.
function placeMarks(marks) {
  marks.sort((a, b) => a[1] - b[1]);
  marks.forEach(([lab, y, text, color], i) => {
    lab.hidden = false;
    lab.replaceChildren(h("i", { style: `background:${color}` }), text);
    lab.style.top = `calc(${(y / 200) * 100}% - 7px)`;
    lab.style.left = i > 0 && y - marks[i - 1][1] < 15 ? "11.5rem" : "3.3rem";
  });
}

const CHARTS = {
  // Verlauf: the figure over time against limit and target. Flows as bars with the plan as an outline.
  trend(k, fr, legend, opt) {
    const flow = k.kind === "flow", tLab = fr.lab("pm"), rLab = fr.lab("pm"), runLab = fr.lab("prun"), dot = fr.lab("dot");
    return (m) => {
      const [w0, w1] = win(m), n = w1 - w0 + 1, slot = 600 / n, r = stateOf(k, m), vals = k.series.slice(w0, w1 + 1);
      const X = flow ? (t) => (t - w0 + 0.5) * slot : (t) => ((t - w0) / (w1 - w0)) * 592;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (flow) { lo = Math.min(lo, 0); hi = Math.max(hi, 0, k.target || 0); }
      const span = hi - lo || Math.abs(hi) * 0.1 || 1;
      for (const th of [k.reg, flow ? null : k.target]) if (th !== null && th !== undefined && th > lo - span * 0.8 && th < hi + span * 0.8) { lo = Math.min(lo, th); hi = Math.max(hi, th); }
      const pad = (hi - lo) * 0.12 || 1;
      lo -= pad; hi += pad;
      const Y = (v) => 188 - ((v - lo) / (hi - lo)) * 176, inside = (v) => v !== null && v !== undefined && Y(v) > 2 && Y(v) < 187;
      fr.clear();
      const marks = [];
      if (inside(k.reg)) {
        const y = Y(k.reg);
        fr.zones.append(sv("rect", { class: "c-limband", x: 0, width: 600, y: k.dir > 0 ? y : 0, height: k.dir > 0 ? 188 - y : y }), sv("line", { class: "c-lim", x1: 0, x2: 600, y1: y, y2: y, ...NSS }));
        marks.push([rLab, y, `${k.dir < 0 ? "Limit" : "Minimum"} ${F(k, k.reg)}`, "var(--alert)"]);
      } else rLab.hidden = true;
      if (inside(k.target)) {
        const y = Y(k.target);
        fr.zones.append(sv("line", { class: "c-tgt", x1: 0, x2: 600, y1: y, y2: y, ...NSS }));
        marks.push([tLab, y, `${flow ? "Monatsziel" : k.dir < 0 ? "Frühwarnung" : "Ziel"} ${F(k, k.target)}`, "var(--accent)"]);
      } else tLab.hidden = true;
      placeMarks(marks);
      fr.hi.hidden = marks.some((mk) => mk[1] < 22);
      fr.lo.hidden = marks.some((mk) => mk[1] > 166);
      if (opt.run && r.run >= 2) {
        const a = Math.max(w0, m - r.run), xa = flow ? X(a) - slot / 2 : X(a), xb = flow ? X(m) + slot / 2 : X(m);
        fr.zones.append(sv("rect", { class: "c-run", x: xa, width: Math.max(2, xb - xa), y: 0, height: 188 }));
        runLab.hidden = false;
        runLab.textContent = `${r.run} ${k.dir > 0 ? "Rückgänge" : "Anstiege"} in Folge`;
        runLab.style.top = "4px";
        runLab.style.left = xa < 330 ? `calc(${(xa / 6).toFixed(2)}% + 6px)` : "auto";
        runLab.style.right = xa < 330 ? "auto" : `calc(${(100 - xb / 6).toFixed(2)}% + 6px)`;
      } else runLab.hidden = true;
      let to = 600;
      if (flow) {
        const y0 = Y(0), gap = Math.min(4, slot * 0.2);
        vals.forEach((v, i) => {
          const t = w0 + i, x = i * slot, short = v < 0 || (k.target !== null && v < k.target);
          if (noData(k, t)) return;
          if (k.target !== null) fr.over.append(sv("rect", { class: "c-plan", x: x + gap * 0.5, y: Math.min(Y(k.target), y0), width: slot - gap, height: Math.abs(y0 - Y(k.target)), ...NSS }));
          fr.solid.append(sv("rect", { class: "c-bar" + (t > m ? " later" : short ? " short" : "") + (t === m ? " now" : ""), x: x + gap, y: Math.min(Y(v), y0), width: Math.max(0.5, slot - 2 * gap), height: Math.max(0.6, Math.abs(y0 - Y(v))) }));
        });
        fr.over.append(sv("line", { class: "c-zero", x1: 0, x2: 600, y1: y0, y2: y0, ...NSS }));
        dot.hidden = true;
        legend.replaceChildren(key(box("var(--ink-2)"), "Monatswert"), key(h("i", { class: "out" }), "Monatsziel als Umriss"), key(box("var(--alert)"), "unter dem Ziel"));
      } else {
        const pts = vals.map((v, i) => [w0 + i, v]), holes = pts.some((p) => noData(k, p[0])), d = holes ? lineGaps(pts, X, Y, (t) => noData(k, t)) : lineD(pts, X, Y);
        fr.ghost.append(sv("path", { class: "c-ghost", d, ...NSS }));
        if (!holes) fr.solid.append(sv("path", { class: "c-area", d: `${d} L592,188 L0,188 Z` }));
        fr.solid.append(sv("path", { class: "c-line", d, ...NSS }));
        dot.hidden = false;
        dot.style.left = (X(m) / 6).toFixed(2) + "%";
        dot.style.top = (Y(k.series[m]) / 2).toFixed(2) + "%";
        to = X(m) + 1;
        legend.replaceChildren(...(m < w1 ? [key(h("i", { style: "background:var(--ink);opacity:.25" }), `blass: der weitere Verlauf bis ${PERIODS.monat[w1].label}`)] : []));
      }
      fr.hv = { at: (f) => (flow ? Math.min(w1, w0 + Math.floor(f * n)) : Math.round(w0 + Math.min(1, (f * 600) / 592) * (w1 - w0))), x: (t) => X(t) / 6, text: (t) => `${PERIODS.monat[t].label} · ${F(k, k.series[t])}` };
      fr.hi.textContent = F(k, hi); fr.lo.textContent = F(k, lo);
      fr.x0.textContent = PERIODS.monat[w0].label; fr.x1.textContent = PERIODS.monat[w1].label;
      return to;
    };
  },

  // Zusammensetzung: which part carries the figure. Stacked areas for balances, stacked bars for flows.
  parts(k, fr, legend) {
    const names = Object.keys(k.parts), flow = k.kind === "flow";
    return (m) => {
      const [w0, w1] = win(m), n = w1 - w0 + 1, slot = 600 / n;
      fr.clear();
      let to = 600;
      if (flow) {
        const stacks = [];
        for (let t = w0; t <= w1; t++) stacks.push(names.map((nm) => k.parts[nm][t]));
        let lo = Math.min(0, ...stacks.map((s) => sum(s.filter((v) => v < 0)))), hi = Math.max(0, ...stacks.map((s) => sum(s.filter((v) => v > 0))));
        const pad = (hi - lo) * 0.1 || 1;
        if (lo < 0) lo -= pad;
        hi += pad;
        const Y = (v) => 188 - ((v - lo) / (hi - lo)) * 176, y0 = Y(0), gap = Math.min(4, slot * 0.2);
        stacks.forEach((s, i) => {
          let up = 0, down = 0;
          s.forEach((v, j) => {
            const from = v >= 0 ? up : down, till = from + v;
            if (v >= 0) up = till; else down = till;
            fr.solid.append(sv("rect", { x: i * slot + gap, y: Math.min(Y(from), Y(till)), width: Math.max(0.5, slot - 2 * gap), height: Math.max(0.4, Math.abs(Y(from) - Y(till))), fill: PART_COLORS[j], "fill-opacity": w0 + i > m ? 0.12 : w0 + i === m ? 1 : 0.6 }));
          });
        });
        fr.over.append(sv("line", { class: "c-zero", x1: 0, x2: 600, y1: y0, y2: y0, ...NSS }));
        fr.hi.textContent = F(k, hi); fr.lo.textContent = lo < 0 ? F(k, lo) : "";
        fr.hv = { at: (f) => Math.min(w1, w0 + Math.floor(f * n)), x: (t) => ((t - w0 + 0.5) * slot) / 6, text: (t) => `${PERIODS.monat[t].label} · ${F(k, k.series[t])}` };
      } else {
        const X = (t) => ((t - w0) / (w1 - w0)) * 600, rows = [];
        for (let t = w0; t <= w1; t++) rows.push(names.map((nm) => k.parts[nm][t]));
        const hi = Math.max(...rows.map((rw) => sum(rw))) * 1.08, Y = (v) => 188 - (v / hi) * 176;
        let base = rows.map(() => 0);
        names.forEach((nm, j) => {
          const top = rows.map((rw, i) => base[i] + rw[j]), up = top.map((v, i) => [w0 + i, v]), dn = base.map((v, i) => [w0 + i, v]).reverse(), d = lineD(up, X, Y);
          fr.solid.append(sv("path", { d: d + " L" + dn.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(2)}`).join(" L") + " Z", fill: PART_COLORS[j], "fill-opacity": 0.5 }), sv("path", { d, fill: "none", stroke: PART_COLORS[j], "stroke-width": 1.4, ...NSS }));
          fr.ghost.append(sv("path", { class: "c-ghost", d, ...NSS }));
          base = top;
        });
        to = X(m) + 1;
        fr.hi.textContent = F(k, hi); fr.lo.textContent = F(k, 0);
        fr.hv = { at: (f) => Math.round(w0 + f * (w1 - w0)), x: (t) => X(t) / 6, text: (t) => `${PERIODS.monat[t].label} · ${F(k, k.series[t])}` };
      }
      const now = names.map((nm) => k.parts[nm][m]), tot = sum(now.map(Math.abs)) || 1;
      legend.replaceChildren(...names.map((nm, j) => key(box(PART_COLORS[j]), `${nm} ${flow ? (now[j] < 0 ? "−" : "+") + thousands(Math.abs(now[j])) + " Mio." : Math.round((now[j] / tot) * 100) + " %"}`)), ...(flow ? [] : [h("span", { text: "von unten nach oben gestapelt" })]));
      fr.x0.textContent = PERIODS.monat[w0].label; fr.x1.textContent = PERIODS.monat[w1].label;
      return to;
    };
  },
  drivers(k, fr, legend) {
    const names = Object.keys(k.parts);
    return indexed(fr, legend, names.map((nm, j) => ({ name: nm, arr: k.parts[nm], color: PART_COLORS[j] })), () => `${k.name} = ${names[0]} ÷ ${names[1]}`);
  },
  compare(k, fr, legend, opt) {
    return indexed(fr, legend, opt.ks.map((id, j) => ({ name: K[id].name, arr: K[id].series, color: PART_COLORS[j] })), (w0) => `beide = 100 im ${PERIODS.monat[w0].label}`);
  },

  // Kumuliert: the months of the year, their running total and the path to the annual target.
  cum(k, fr, legend) {
    const tLab = fr.lab("pm"), dot = fr.lab("dot");
    return (m) => {
      const y0m = m - (m % 12), X = (t) => ((t - y0m + 0.5) / 12) * 600, months = [];
      for (let t = y0m; t <= Math.min(TODAY, y0m + 11); t++) months.push([t, k.series[t]]);
      let acc = 0;
      const cum = months.map(([t, v]) => [t, (acc += v)]), target = k.target * 12;
      const lo0 = Math.min(0, ...months.map((p) => p[1]), ...cum.map((p) => p[1])), hi0 = Math.max(target, ...cum.map((p) => p[1]), ...months.map((p) => p[1]));
      const lo = lo0 < 0 ? lo0 - (hi0 - lo0) * 0.06 : 0, hi = hi0 + (hi0 - lo0) * 0.09, Y = (v) => 188 - ((v - lo) / (hi - lo)) * 176, yz = Y(0);
      fr.clear();
      fr.zones.append(sv("line", { class: "c-tgt", x1: 0, y1: yz, x2: 600, y2: Y(target), ...NSS }));
      for (const [t, v] of months) fr.over.append(sv("rect", { class: "c-bar" + (t > m ? " later" : v < 0 || v < k.target ? " short" : "") + (t === m ? " now" : ""), x: X(t) - 13, y: Math.min(Y(v), yz), width: 26, height: Math.max(0.6, Math.abs(yz - Y(v))) }));
      fr.over.append(sv("line", { class: "c-zero", x1: 0, x2: 600, y1: yz, y2: yz, ...NSS }));
      fr.solid.append(sv("path", { d: lineD([[y0m - 0.5, 0], ...cum], X, Y), fill: "none", stroke: "var(--c1)", "stroke-width": 2.1, "stroke-linejoin": "round", ...NSS }));
      const cv = cum[m - y0m][1], path = k.target * (m - y0m + 1);
      dot.hidden = false;
      dot.style.left = (X(m) / 6).toFixed(2) + "%";
      dot.style.top = (Y(cv) / 2).toFixed(2) + "%";
      tLab.replaceChildren(h("i", { style: "background:var(--accent)" }), `Jahresziel ${F(k, target)}`);
      tLab.style.cssText = `right:0;top:max(0px, calc(${(Y(target) / 2).toFixed(1)}% - 17px))`;
      legend.replaceChildren(key(box("var(--ink-2)"), "Monat"), key(h("i", { style: "background:var(--c1)" }), "kumuliert"), key(dash("var(--accent)"), "Zielpfad"),
        h("span", { text: `${PERIODS.monat[m].y} bis ${MON[m % 12]}: ${F(k, cv)}, ${thousands(Math.abs(cv - path))} Mio. ${cv < path ? "unter" : "über"} dem Zielpfad` }));
      fr.hi.textContent = F(k, hi); fr.lo.textContent = lo < 0 ? F(k, lo) : "";
      fr.x0.textContent = "Jan " + PERIODS.monat[m].y; fr.x1.textContent = "Dez";
      fr.hv = null;
      return ((m - y0m + 1) / 12) * 600;
    };
  },

  // Brücke: the change over twelve months, split into its parts.
  bridge(k, fr, legend) {
    const names = Object.keys(k.parts), flow = k.kind === "flow", count = names.length + 2;
    const labs = Array.from({ length: count }, () => fr.lab("pv")), cats = Array.from({ length: count }, () => fr.lab("pcat")), empty = fr.lab("pempty");
    return (m) => {
      fr.clear();
      fr.hv = null;
      fr.hi.textContent = fr.lo.textContent = fr.x0.textContent = fr.x1.textContent = "";
      if (m < (flow ? 23 : 12)) {
        labs.concat(cats).forEach((l) => (l.hidden = true));
        empty.hidden = false;
        empty.textContent = "Für die Brücke braucht es zwölf Monate Geschichte.";
        legend.replaceChildren();
        return 600;
      }
      empty.hidden = true;
      const val = (arr, t) => (flow ? sum(arr.slice(Math.max(0, t - 11), t + 1)) : arr[t]);
      const start = val(k.series, m - 12), end = val(k.series, m), steps = [{ name: flow ? "12 Monate davor" : PERIODS.monat[m - 12].label, from: 0, to: start, kind: "base" }];
      let acc = start;
      names.forEach((nm) => { const d = val(k.parts[nm], m) - val(k.parts[nm], m - 12); steps.push({ name: nm, from: acc, to: acc + d, kind: d * (k.dir || 1) >= 0 ? "good" : "alert" }); acc += d; });
      steps.push({ name: flow ? "letzte 12 Monate" : PERIODS.monat[m].label, from: 0, to: end, kind: "end" });
      const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to))), hi = Math.max(...steps.map((s) => Math.max(s.from, s.to)));
      const zl = flow ? lo : Math.max(0, Math.min(...steps.map((s) => Math.min(s.from || s.to, s.to))) * 0.92), top = hi + (hi - zl) * 0.06;
      const Y = (v) => 188 - ((v - zl) / (top - zl || 1)) * 164, slot = 600 / count;
      steps.forEach((s, i) => {
        const ends = s.kind === "base" || s.kind === "end", f2 = ends ? zl : s.from, y1 = Y(Math.max(f2, s.to)), y2 = Y(Math.min(f2, s.to)), d = s.to - s.from;
        fr.solid.append(sv("rect", { x: i * slot + slot * 0.2, y: y1, width: slot * 0.6, height: Math.max(1, y2 - y1), fill: s.kind === "base" ? "var(--ink-2)" : s.kind === "end" ? "var(--ink)" : `var(--${s.kind})`, "fill-opacity": s.kind === "base" ? 0.45 : 0.85 }));
        if (i < count - 1) fr.over.append(sv("line", { class: "c-link", x1: i * slot + slot * 0.8, x2: (i + 1) * slot + slot * 0.2, y1: Y(s.to), y2: Y(s.to), ...NSS }));
        labs[i].hidden = cats[i].hidden = false;
        labs[i].textContent = ends ? compact(k, s.to) : (d >= 0 ? "+" : "−") + compact(k, Math.abs(d));
        labs[i].style.left = cats[i].style.left = `${((i + 0.5) / count) * 100}%`;
        labs[i].style.top = `calc(${(y1 / 200) * 100}% - 15px)`;
        cats[i].style.width = `${100 / count}%`;
        cats[i].textContent = s.name;
      });
      legend.replaceChildren(key(box("var(--good)"), "hilft"), key(box("var(--alert)"), "belastet"));
      return 600;
    };
  },

  // Tagesverlauf: the last days the gold layer has, whatever month the room shows. Balances as a line, flows as bars.
  daily(k, fr, legend) {
    const flow = k.kind === "flow", dot = fr.lab("dot"), mLab = fr.lab("prun"), empty = fr.lab("pempty");
    return () => {
      const a = DAILY.a, days = DAYS.slice(a), vals = k.daily.slice(a).map((v) => (v === null || v === undefined ? NaN : v)), n = vals.length, ok = vals.filter(Number.isFinite);
      fr.clear();
      fr.hv = null;
      if (!ok.length) { dot.hidden = mLab.hidden = true; empty.hidden = false; empty.textContent = "Für diese Kennzahl gibt es keine Tageswerte."; legend.replaceChildren(); fr.hi.textContent = fr.lo.textContent = fr.x0.textContent = fr.x1.textContent = ""; return 600; }
      empty.hidden = true;
      let lo = Math.min(...ok), hi = Math.max(...ok);
      if (flow) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
      lo -= pad; hi += pad;
      const Y = (v) => 188 - ((v - lo) / (hi - lo)) * 176, slot = 600 / n, X = flow ? (i) => (i + 0.5) * slot : (i) => (n > 1 ? (i / (n - 1)) * 592 : 296);
      const first = days.findIndex((d, i) => i > 0 && d.endsWith("-01"));
      if (first > 0) {
        const x = flow ? first * slot : (X(first - 1) + X(first)) / 2;
        fr.zones.append(sv("line", { class: "c-base", x1: x, x2: x, y1: 0, y2: 188, ...NSS }));
        mLab.hidden = false; mLab.textContent = MONTH[Number(days[first].slice(5, 7)) - 1]; mLab.style.top = "4px"; mLab.style.left = `calc(${(x / 6).toFixed(2)}% + 6px)`; mLab.style.right = "auto";
      } else mLab.hidden = true;
      if (flow) {
        const y0 = Y(0), gap = Math.min(3, slot * 0.2);
        vals.forEach((v, i) => { if (Number.isFinite(v)) fr.solid.append(sv("rect", { class: "c-bar" + (v < 0 ? " short" : "") + (i === n - 1 ? " now" : ""), x: i * slot + gap, y: Math.min(Y(v), y0), width: Math.max(0.5, slot - 2 * gap), height: Math.max(0.6, Math.abs(y0 - Y(v))) })); });
        fr.over.append(sv("line", { class: "c-zero", x1: 0, x2: 600, y1: y0, y2: y0, ...NSS }));
        dot.hidden = true;
      } else {
        const d = lineGaps(vals.map((v, i) => [i, v]), X, Y, (i) => !Number.isFinite(vals[i]));
        fr.solid.append(sv("path", { class: "c-line", d, ...NSS }));
        const li = vals.map(Number.isFinite).lastIndexOf(true);
        dot.hidden = li < 0;
        if (li >= 0) { dot.style.left = (X(li) / 6).toFixed(2) + "%"; dot.style.top = (Y(vals[li]) / 2).toFixed(2) + "%"; }
      }
      legend.replaceChildren(h("span", { text: `${flow ? "Tageswerte" : "Stand an jedem Tag"} · ${dayLabel(days[0])} bis ${dayLabel(days[n - 1])}` }));
      fr.hi.textContent = F(k, hi); fr.lo.textContent = F(k, lo);
      fr.x0.textContent = dayLabel(days[0]); fr.x1.textContent = dayLabel(days[n - 1]);
      fr.hv = { at: (f) => clamp(flow ? Math.floor(f * n) : Math.round(f * (n - 1)), 0, n - 1), x: (i) => X(i) / 6, text: (i) => `${dayLabel(days[i])} · ${Number.isFinite(vals[i]) ? F(k, vals[i]) : "keine Daten"}` };
      return 600;
    };
  },
};
// Two or more series on one scale: each starts at 100 at the left edge. The second line is dashed, so colour is not the only cue.
function indexed(fr, legend, series, caption) {
  return (m) => {
    const [w0, w1] = win(m), X = (t) => ((t - w0) / (w1 - w0)) * 600;
    const lines = series.map((s) => ({ ...s, pts: s.arr.slice(w0, w1 + 1).map((v, i) => [w0 + i, (v / s.arr[w0]) * 100]) }));
    const all = lines.flatMap((l) => l.pts.map((p) => p[1])).concat([100]), lo = Math.min(...all) - 2, hi = Math.max(...all) + 2, Y = (v) => 188 - ((v - lo) / (hi - lo)) * 176;
    fr.clear();
    fr.zones.append(sv("line", { class: "c-base", x1: 0, x2: 600, y1: Y(100), y2: Y(100), ...NSS }));
    lines.forEach((l, j) => {
      const d = lineD(l.pts, X, Y);
      fr.ghost.append(sv("path", { class: "c-ghost", d, ...NSS }));
      fr.solid.append(sv("path", { d, fill: "none", stroke: l.color, "stroke-width": 1.9, "stroke-linejoin": "round", "stroke-dasharray": j ? "7 4" : null, ...NSS }));
    });
    legend.replaceChildren(...lines.map((l, j) => key(j ? dash(l.color) : h("i", { style: `background:${l.color}` }), `${l.name} ${Math.round(l.pts[m - w0][1])}`)), h("span", { text: caption(w0) }));
    fr.hi.textContent = String(Math.round(hi)); fr.lo.textContent = String(Math.round(lo));
    fr.x0.textContent = PERIODS.monat[w0].label; fr.x1.textContent = PERIODS.monat[w1].label;
    fr.hv = { at: (f) => Math.round(w0 + f * (w1 - w0)), x: (t) => X(t) / 6, text: (t) => `${PERIODS.monat[t].label} · ` + lines.map((l) => `${l.name} ${Math.round(l.pts[t - w0][1])}`).join(" · ") };
    return X(m) + 1;
  };
}
// A chart for one figure. draw(m, first) redraws for a month; the first draw reveals it from the left.
function makeChart(kind, k, extra) {
  const fr = chartFrame(), legend = h("div", { class: "lg" }), base = kind === "run" ? "trend" : kind;
  const el = h("figure", { class: "chart", "data-kind": base }, fr.plot, legend), draw = CHARTS[base](k, fr, legend, { ...(extra || {}), run: kind === "run" });
  let stop = null;
  return {
    el, kind, plot: fr.plot,
    draw(m, first) {
      const to = draw(m);
      if (stop) { stop(); stop = null; }
      if (first && !reduced) { fr.clip.setAttribute("width", 0); stop = animate(900, (e) => fr.clip.setAttribute("width", (to * e).toFixed(1)), easeOut); }
      else fr.clip.setAttribute("width", to.toFixed(1));
    },
  };
}
