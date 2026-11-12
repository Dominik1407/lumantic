/* lumantic.dev: what moves. One flight, driven by the scroll, from the overview into a page (the idea of Kosmos), and
   three small rooms to try: time, building, design. Plain JS, no library, no build.
   The figures are invented and follow the example «Industrie» (cmd/seed/industrie.go). The rules are a short version
   of the app's (README, «Lumina, die Regeln dahinter»): a figure is judged against its target, nothing more. */
(() => {
  "use strict";
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const span = (v, a, b) => clamp((v - a) / (b - a));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OUT = "cubic-bezier(.2, .8, .2, 1)";
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const sv = (tag, attrs = {}) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  // ═════ The figures: 24 months of an invented maker of drives. Month 0 is November 2024, the last is October 2026. ═════
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const N = 24, NOW = N - 1;
  const ym = (m) => [2024 + Math.floor((10 + m) / 12), (10 + m) % 12];
  const short = (m) => MON[ym(m)[1]] + " " + ym(m)[0], long = (m) => MONTHS[ym(m)[1]] + " " + ym(m)[0];
  // dir: 1 more is better, -1 less is better, 0 neutral. tol: how far past the target still counts as narrowly missed.
  const FIGS = [
    { id: "otd", name: "On-time delivery", home: "Logistics", unit: "%", dec: 1, dir: 1, target: 95, tol: 1.5,
      s: [95.8, 96.1, 95.6, 95.9, 96.3, 95.7, 96.0, 96.4, 95.9, 95.5, 96.2, 96.0, 95.8, 96.3, 95.9, 96.1, 95.6, 96.0, 96.2, 95.8, 95.4, 93.9, 91.2, 88.6],
      drv: { 22: ["Suzhou", "−6.1 points"], 23: ["Suzhou", "−5.4 points"] } },
    { id: "range", name: "Stock range", home: "Logistics", unit: "days", dec: 0, dir: -1, target: 45, tol: 2,
      s: [40, 41, 41, 40, 41, 42, 42, 41, 41, 42, 42, 41, 42, 42, 43, 42, 43, 43, 44, 43, 44, 44, 45, 45] },
    { id: "stock", name: "Stock value", home: "Logistics", unit: "m", dec: 0, dir: 0,
      s: [58, 58, 59, 58, 59, 60, 60, 59, 59, 60, 60, 59, 60, 60, 61, 60, 61, 61, 62, 61, 62, 62, 63, 63] },
    { id: "oee", name: "OEE", home: "Production", unit: "%", dec: 1, dir: 1, target: 80, tol: 1.5,
      s: [78.9, 79.2, 79.0, 79.6, 79.3, 78.8, 79.4, 80.1, 80.4, 80.2, 80.9, 81.3, 81.0, 81.6, 81.9, 82.2, 82.0, 82.6, 83.0, 82.8, 83.3, 83.6, 83.9, 84.1] },
    { id: "good", name: "Good parts", home: "Production", unit: "k", dec: 0, dir: 0,
      s: [187, 183, 189, 190, 192, 186, 184, 191, 188, 179, 190, 193, 191, 185, 190, 192, 194, 191, 193, 195, 189, 184, 192, 194] },
    { id: "scrap", name: "Scrap rate", home: "Production", unit: "%", dec: 1, dir: -1, target: 2.5, tol: 0.2,
      s: [2.3, 2.4, 2.2, 2.4, 2.6, 3.1, 2.9, 2.6, 2.4, 2.3, 2.2, 2.3, 2.4, 2.2, 2.3, 2.1, 2.2, 2.3, 2.2, 2.1, 2.2, 2.3, 2.2, 2.3],
      drv: { 5: ["Brno", "+1.4 points"] } },
    { id: "rev", name: "Revenue", home: "Finance", unit: "m", dec: 1, dir: 0,
      s: [39.8, 43.1, 38.9, 39.6, 40.8, 40.2, 40.5, 41.0, 38.2, 37.6, 40.9, 41.4, 40.7, 44.0, 39.9, 40.4, 41.6, 41.0, 41.3, 41.9, 39.0, 38.4, 41.5, 41.2] },
    { id: "ebit", name: "EBIT margin", home: "Finance", unit: "%", dec: 1, dir: 1, target: 8.5, tol: 0.3,
      s: [8.7, 8.9, 8.6, 8.8, 8.7, 8.4, 8.3, 8.6, 8.8, 8.7, 8.9, 9.0, 8.8, 9.1, 8.7, 8.8, 8.9, 8.6, 8.8, 8.7, 8.9, 8.8, 8.7, 8.6] },
    { id: "orders", name: "Order intake", home: "Sales", unit: "m", dec: 1, dir: 0,
      s: [41.0, 42.2, 40.1, 40.8, 41.9, 41.2, 41.6, 42.3, 40.0, 39.4, 42.0, 42.6, 41.8, 43.1, 41.2, 41.7, 42.4, 42.0, 42.2, 42.8, 41.6, 41.1, 40.7, 40.4] },
  ];
  const FIG = Object.fromEntries(FIGS.map((k) => [k.id, k]));
  const RANK = { alert: 0, watch: 1, good: 2, calm: 3 };

  function evaluate(k, m) {
    const v = k.s[m], prev = m > 0 ? k.s[m - 1] : null;
    let level = "calm", label = "Calm";
    if (k.target != null && k.dir) {
      const miss = k.dir * (k.target - v);
      if (miss > k.tol + 1e-9) { level = "alert"; label = k.dir > 0 ? "Below target" : "Above target"; }
      else if (miss > 1e-9) { level = "watch"; label = "Narrowly missed"; }
      else if (prev !== null && k.dir * (k.target - prev) > 1e-9) { level = "good"; label = "Good news"; }
    }
    let run = 0; // moves in the wrong direction, one after the other
    for (let i = m; i > 0 && k.dir && k.dir * (k.s[i] - k.s[i - 1]) < 0; i--) run++;
    return { v, prev, level, label, run };
  }
  const NUMWORD = ["No", "One", "Two", "Three", "Four", "Five"], ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
  function headlineOf(figs, m) {
    const rs = figs.map((k) => evaluate(k, m)), a = rs.filter((r) => r.level === "alert").length, w = rs.filter((r) => r.level === "watch").length;
    return a === 1 ? "One thing needs you." : a > 1 ? `${NUMWORD[a] || a} things need you.` : w ? "Almost all calm." : "All calm.";
  }

  const digits = (k, v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(k.dec);
  const fmt = (k, v) => (k.unit === "%" ? digits(k, v) + "%" : k.unit === "m" ? "CHF " + digits(k, v) + "m" : k.unit === "k" ? digits(k, v) + "k" : digits(k, v) + " " + k.unit);
  const fmtT = (k) => fmt({ ...k, dec: Number.isInteger(k.target) ? 0 : k.dec }, k.target);
  const B = (s) => `<b class="num">${s}</b>`;
  function distance(k, d) {
    const a = Math.abs(d);
    if (k.unit === "%") { const s = a.toFixed(k.dec); return s + (Number(s) === 1 ? " percentage point" : " percentage points"); }
    return fmt(k, a);
  }
  // The word-sized chart beside a figure: up to 24 months ending at m. It reaches back before the first month shown
  // (the first year, mirrored and damped), so that it has a shape from the start.
  const past = (k) => k.past || (k.past = k.s.slice(1, 12).reverse().map((v) => k.s[0] - (v - k.s[0]) * 0.5));
  function spark(k, m) {
    const hist = past(k).concat(k.s), e = m + 11, vals = hist.slice(Math.max(0, e - 23), e + 1), n = vals.length, lo = Math.min(...vals), hi = Math.max(...vals);
    const Y = (v) => (hi === lo ? 9 : 16 - ((v - lo) / (hi - lo)) * 14), X = (i) => 1.5 + (i / (n - 1)) * 60.5;
    const d = `<path class="sl" d="M${vals.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" L")}"/>`;
    return `<svg class="sp" viewBox="0 0 64 18" preserveAspectRatio="none" aria-hidden="true">${d}<circle class="sd" cx="${X(n - 1).toFixed(1)}" cy="${Y(vals[n - 1]).toFixed(1)}" r="1.9"/></svg>`;
  }
  // What Lumina writes about a figure. Statements that can show their evidence are «facts».
  function sentence(k, m) {
    const r = evaluate(k, m), out = [], fact = (s) => `<span class="fact">${s}</span>`;
    if (k.target != null && k.dir) {
      const d = r.v - k.target, zero = Number(Math.abs(d).toFixed(k.dec)) === 0;
      out.push(zero ? `${B(fmt(k, r.v))}${spark(k, m)} is exactly on the target of ${B(fmtT(k))}.`
        : `${B(fmt(k, r.v))}${spark(k, m)} is ${fact(`${B(distance(k, d))} ${d < 0 ? "below" : "above"} the target of ${B(fmtT(k))}`)}.`);
    } else if (r.prev === null) out.push(`${B(fmt(k, r.v))}${spark(k, m)} is the first value of the series.`);
    else {
      const d = r.v - r.prev, rel = Math.abs(d / r.prev) * 100;
      out.push(rel < 0.05 ? `${B(fmt(k, r.v))}${spark(k, m)} has barely moved from ${long(m - 1)}.`
        : `${B(fmt(k, r.v))}${spark(k, m)} is ${fact(`${B(rel.toFixed(1) + "%")} ${d > 0 ? "above" : "below"} ${long(m - 1)}`)}.`);
    }
    const drv = k.drv && k.drv[m];
    if (drv) out.push(`Most of the move came from ${fact(drv[0])} (${B(drv[1])} from the previous month).`);
    if ((r.level === "alert" || r.level === "watch") && r.run >= 3) out.push(`It is the ${fact(`${ORDINAL[r.run] || r.run + "th"} ${k.dir > 0 ? "decline" : "rise"} in a row`)}.`);
    return out.join(" ");
  }
  function gapLine(k, m) {
    const r = evaluate(k, m);
    if (k.target != null && k.dir) { const d = r.v - k.target; return `${distance(k, d).replace(" percentage", "")} ${d < 0 ? "below" : "above"} target ${fmtT(k)}`; }
    if (r.prev === null) return "First value of the series";
    const d = r.v - r.prev;
    return `${d < 0 ? "−" : "+"}${fmt(k, Math.abs(d)).replace("CHF ", "")} from ${short(m - 1)}`;
  }
  // The trend against the target, a 600 × 200 drawing that stretches; labels are HTML so the type stays crisp.
  function chartHTML(k, m) {
    const a = Math.max(0, m - 23), vals = k.s.slice(a, m + 1), n = vals.length, r = evaluate(k, m), has = k.target != null && k.dir;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (has) { lo = Math.min(lo, k.target); hi = Math.max(hi, k.target); }
    const pad = (hi - lo || 1) * 0.14; lo -= pad; hi += pad;
    const X = (i) => (n > 1 ? (i / (n - 1)) * 600 : 300), Y = (v) => (1 - (v - lo) / (hi - lo)) * 200;
    const d = "M" + vals.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" L");
    const runX = r.run >= 2 ? X(Math.max(0, n - 1 - r.run)) : -1, ty = has ? Y(k.target) : 0;
    return `<figure class="chart"><div class="plot"><svg viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">`
      + [50, 100, 150].map((y) => `<line class="gr" x1="0" x2="600" y1="${y}" y2="${y}"/>`).join("")
      + (runX >= 0 ? `<rect class="c-run" x="${runX.toFixed(1)}" y="0" width="${(600 - runX).toFixed(1)}" height="200"/>` : "")
      + (has ? `<line class="c-tgt" x1="0" x2="600" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"/>` : "")
      + `<line class="ax" x1="0" x2="600" y1="200" y2="200"/></svg><svg class="ln" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true"><path class="c-line" d="${d}"/></svg>`
      + (has ? `<span class="pl tgt" style="top:${(ty / 2).toFixed(1)}%;translate:0 ${vals[0] >= k.target ? "55%" : "-155%"}">Target ${fmtT(k)}</span>` : "")
      + `<i class="dot" style="left:100%;top:${(Y(vals[n - 1]) / 2).toFixed(1)}%"></i></div><div class="axis"><span>${short(a)}</span><span>${short(m)}</span></div></figure>`;
  }
  const WHY = { otd: "The trend against the target shows since when it has been below, and how fast it is falling." };
  const whyOf = (k) => WHY[k.id] || (k.target != null && k.dir ? "The trend against the target shows how much room there is." : "The trend over two years shows whether this month is unusual.");

  const starHTML = (kind, tag = "span", more = "") => `<${tag} class="star" data-kind="${kind}"${more}><i class="st-halo"></i><i class="st-core"></i></${tag}>`;
  const FORMS = [["line", "Line"], ["sentence", "Sentence"], ["number", "Number"], ["chart", "Chart"]];
  // One block of a page. o.star: what stands in the margin ("" leaves the marker empty, the flight brings its own stars).
  function blockHTML(k, m, form, o = {}) {
    const r = evaluate(k, m), kind = form === "chart" ? "chart" : r.level;
    const star = o.star === "button" ? starHTML(kind, "button", ` type="button" aria-label="Move ${k.name}. Enter carries it to the other page."`) : o.star ? starHTML(kind) : "";
    const tools = o.tools ? `<span class="tools">${FORMS.map(([f, name]) => `<button class="fm" type="button" data-form="${f}" aria-pressed="${f === form}">${name}</button>`).join("")}</span>` : "";
    const value = form === "line" ? `<span class="lv">${B(fmt(k, r.v))}${spark(k, m)}</span>` : form === "chart" ? `<span class="lv">${B(fmt(k, r.v))}</span>` : "";
    const lbl = `<div class="lbl"><span class="nm">${k.name}</span><span class="stw">${r.label}</span>${value}${o.home === false ? "" : `<span class="home">→ ${k.home}</span>`}${tools}</div>`;
    const big = k.unit === "m" ? ["CHF " + digits(k, r.v), "m"] : k.unit === "%" || k.unit === "k" ? [digits(k, r.v), k.unit] : [digits(k, r.v), " " + k.unit];
    const body = form === "sentence" ? `<p class="para">${sentence(k, m)}</p>${o.after || ""}`
      : form === "number" ? `<div class="big"><span>${B(big[0])}<span class="ru">${big[1]}</span></span>${spark(k, m)}</div><p class="bigsub">${gapLine(k, m)}</p>`
      : form === "chart" ? `<p class="cap">${whyOf(k)}</p>${chartHTML(k, m)}` : "";
    return `<div class="blk" data-id="${k.id}" data-key="${k.id}:${form}:${r.level}" data-kind="${r.level}" data-form="${form}"><i class="mk" data-star="${k.id}">${star}</i>${lbl}${body}</div>`;
  }
  // Everything calm shares one line; each figure keeps its small star.
  function quietHTML(figs, m, stars) {
    const items = figs.map((k) => `<span class="qi" data-id="${k.id}"><i class="mk" data-star="c-${k.id}">${stars ? starHTML("chip") : ""}</i>${k.name} ${B(fmt(k, k.s[m]))}${spark(k, m)}</span>`).join("");
    return `<div class="blk quiet" data-id="quiet" data-key="quiet" data-kind="calm"><i class="mk" data-star="quiet">${stars ? starHTML("quiet") : ""}</i><div class="lbl"><span class="nm">Calm</span><span>${figs.length === 1 ? "one figure" : figs.length + " figures"}</span></div><p class="qline">${items}</p></div>`;
  }
  // The thread down the margin, from the first star of a page to its last.
  function spineOf(sheet) {
    const line = $(".spine", sheet), marks = $$(".phead > .mk, .blk > .mk", sheet);
    if (!line) return;
    if (marks.length < 2) { line.style.height = "0px"; return; }
    const top = sheet.getBoundingClientRect().top + sheet.clientTop, y = (n) => n.getBoundingClientRect().top - top;
    line.style.top = y(marks[0]) + "px";
    line.style.height = y(marks[marks.length - 1]) - y(marks[0]) + "px";
  }
  // Blocks that stay glide from where they were to where they are now.
  function glide(nodes, before, key = "id") {
    if (STILL) return;
    for (const n of nodes) {
      const a = before.get(n.dataset[key]), b = n.getBoundingClientRect();
      if (!a || (Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5)) continue;
      n.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: 480, easing: OUT });
    }
  }

  // ═════ The flight ═════
  // The stage shows «Today» of this Kosmos in four states, and the scroll moves between them: 0 the overview (the
  // hero), 1 the constellation, 2 the page, 3 the page with its evidence open.
  const flight = $("#flight"), stage = $("#stage"), threadsEl = $("#threads"), starsEl = $("#fstars"), labelsEl = $("#plabels"), fsheet = $("#fsheet"), hero = $("#hero"), hstate = $("#hstate"), say = $("#say"), steps = $$(".step");
  const CALM = FIGS.filter((k) => evaluate(k, NOW).level === "calm");
  // Scroll, in heights of the stage, against the state: the flight rests a little in every state.
  const KEYS = [[0, 0], [1, 1], [1.28, 1], [2.2, 2], [2.5, 2], [3.25, 3], [3.7, 3]];
  // The home constellations around «Today»: where they stand (wide, narrow), where their name stands, their stars.
  const HOMES = [
    { id: "Logistics", at: [0.8, 0.3], nat: [0.8, 0.118], lab: [0, -64], nlab: [8, 88], figs: [["otd", -72, 12], ["range", 22, 46], ["stock", 70, -18]] },
    { id: "Production", at: [0.165, 0.33], nat: null, lab: [0, 108], figs: [["oee", -6, -74], ["good", 48, -20], ["scrap", 0, 72]] },
    { id: "Finance", at: [0.2, 0.8], nat: [0.15, 0.88], lab: [0, 40], figs: [["rev", -80, -46], ["ebit", 56, -34]] },
    { id: "Sales", at: [0.835, 0.775], nat: [0.86, 0.87], lab: [0, 38], figs: [["orders", -24, -66]] },
  ];

  fsheet.innerHTML = `<div class="phead"><i class="mk" data-star="lead"></i><div class="dl"><span class="dl-tag">Today</span><span class="when">${long(NOW)}</span></div><h3 class="hl">${headlineOf(FIGS, NOW)}</h3></div><div class="pblocks">`
    + blockHTML(FIG.otd, NOW, "sentence", { after: `<div class="ev"><div class="ev-in"><div class="ev-pad"><div class="chips"><span class="on">Trend</span><span>By plant</span><span>Days</span></div><p class="cap">${whyOf(FIG.otd)}</p>${chartHTML(FIG.otd, NOW)}</div></div></div>` })
    + `<div class="blk ghost"><i class="mk" data-star="ghost"></i><p class="gline"><span class="gst">✦</span> This fits: <b>On-time delivery by plant</b>. It shows which plant carries the move, not the cause behind it. <span class="gacts">Accept <kbd>Tab</kbd><i>×</i></span></p></div>`
    + quietHTML(CALM, NOW, false) + `</div>`;
  const ev = $(".ev", fsheet), evIn = $(".ev-in", fsheet), evFact = $(".fact", fsheet), evLine = $(".ln", fsheet), evDot = $(".dot", fsheet), evTgt = $(".pl.tgt", fsheet);
  const parts = [$(".phead", fsheet), ...$$(".blk", fsheet)];

  const S = {}, T = [], L = [];
  function addStar(id, kind, o = {}) {
    const e = el(starHTML(kind));
    if (o.lab) e.append(el(`<span class="st-lab" style="--lx:${o.lab[2]};--ly:${o.lab[3]};opacity:0">${o.lab[0]}<b>${o.lab[1]}</b></span>`));
    starsEl.append(e);
    return (S[id] = { el: e, lab: e.children[2] || null, kind, w: [0, 0], x: 0, y: 0, px: 0, py: 0, gone: false, mk: $(`[data-star="${id}"]`, fsheet), home: !!o.home, lag: o.lag || 0 });
  }
  const thread = (a, b, kind) => { const e = sv("line", kind === "dotted" ? { class: "dotted" } : {}); threadsEl.append(e); T.push({ el: e, a: S[a], b: S[b], kind, id: b }); };
  // A star comes into the sky, after a moment of its own if it is one of many.
  function born(s, delay = 0, how = "is-born") {
    s.el.classList.remove("is-off", "is-born", "is-wake");
    if (STILL) return;
    void s.el.offsetWidth; s.el.children[1].style.animationDelay = delay + "ms"; s.el.classList.add(how);
  }
  function setKind(s, kind, how) {
    if (s.kind === kind) return;
    s.kind = kind; s.el.dataset.kind = kind;
    born(s, 0, how);
  }

  addStar("lead", "lead");
  addStar("otd", "alert", { lab: [FIG.otd.name, fmt(FIG.otd, FIG.otd.s[NOW]), 1, 0], lag: 0.04 });
  addStar("ghost", "ghost", { lag: 0.09 });
  addStar("quiet", "quiet", { lag: 0.14 });
  CALM.forEach((k, i) => addStar("c-" + k.id, "chip", { lag: 0.16 + i * 0.012 }));
  for (const h of HOMES) {
    addStar("h-" + h.id, "lead", { home: true });
    for (const [id] of h.figs) addStar("h-" + id, "calm", { home: true, lab: id === "otd" ? [FIG.otd.name, fmt(FIG.otd, FIG.otd.s[NOW]), 0, 1] : null });
    L.push({ h, el: labelsEl.appendChild(el(`<p class="plabel">${h.id}<small>all calm</small></p>`)), w: [0, 0] });
  }
  const hubLabel = labelsEl.appendChild(el(`<p class="plabel">Today<i>${headlineOf(FIGS, NOW)}</i></p>`));
  thread("lead", "otd", "alarm"); thread("lead", "ghost", "ghost"); thread("lead", "quiet", "spoke");
  CALM.forEach((k) => thread("quiet", "c-" + k.id, "fan"));
  for (const h of HOMES) for (const [id] of h.figs) thread("h-" + h.id, "h-" + id, "home");
  thread("otd", "h-otd", "dotted");

  // The opening. Quiet first: an empty sky, one calm star seen from close up, and what it says. Then it matters: the
  // star lights up and says so. Then the camera pulls back until the star is one of many on «Today», and the page
  // stands. star and go run from 0 to 1, by the clock; big is how much larger than life the star is seen at first.
  const T_STAR = [350, 1700], T_SAY = 900, T_HOT = 3200, T_GO = [5300, 7500];
  const I = { on: false, t0: 0, step: 0, star: 1, go: 1, at: [0, 0], big: 1 };
  let W = 0, H = 0, U = 1, UH = 1, HK = 1, NARROW = false, hub = [0, 0], T1 = [0, 0], Z1 = 1.75, evH = 0, fit0 = 1, fit1 = 1;
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight; NARROW = W <= 900;
    U = clamp(Math.min(W / 1440, H / 900) * 1.05, NARROW ? 0.6 : 0.72, 1.2);
    // «Today» and the words under it share the height between the logo and the places. Where that is too little,
    // first the constellation and then the words are set smaller, so that nothing ends up under the places.
    const room = H - 64 - 72, words = hero.offsetHeight, CLUSTER = 174;
    UH = U; HK = 1;
    if (CLUSTER * U + words > room) { UH = U * clamp(room / (CLUSTER * U + words), 0.7, 1); HK = clamp((room - CLUSTER * UH) / words, 0.5, 1); }
    hub = [W * 0.5, 64 + Math.max(0, room - CLUSTER * UH - words * HK) * 0.46 + 50 * UH];
    hero.style.top = hub[1] + 124 * UH + "px";
    // The opening's composition: the star, and under it its sentence, together in the middle of the screen.
    I.big = clamp(Math.min(W, H) / 150, 3.6, 6.4);
    const fs = parseFloat(getComputedStyle(say).fontSize), r = 7.5 * I.big, gap = fs * 0.6;
    I.at = [W / 2, H * 0.47 - (2 * r + gap + fs) / 2 + r];
    say.style.left = I.at[0] + "px"; say.style.top = I.at[1] + r + gap + "px";
    S.otd.lab.style.setProperty("--lx", NARROW ? 0 : 1); S.otd.lab.style.setProperty("--ly", NARROW ? 1 : 0);
    S.lead.w = hub; S.otd.w = [hub[0] + 88 * UH, hub[1] + 34 * UH]; S.ghost.w = [hub[0] - 58 * UH, hub[1] - 42 * UH]; S.quiet.w = [hub[0] - 4 * UH, hub[1] + 80 * UH];
    CALM.forEach((k, i) => {
      const ang = ((90 + (i - (CALM.length - 1) / 2) * 19) * Math.PI) / 180, r = (27 + (i % 2) * 9) * UH;
      S["c-" + k.id].w = [S.quiet.w[0] + Math.cos(ang) * r, S.quiet.w[1] + Math.sin(ang) * r];
    });
    for (const l of L) {
      const h = l.h, at = NARROW ? h.nat : h.at, lab = (NARROW && h.nlab) || h.lab, c = at ? [W * at[0], H * at[1]] : [-999, -999];
      h.off = !at;
      S["h-" + h.id].w = c;
      for (const [id, dx, dy] of h.figs) S["h-" + id].w = [c[0] + dx * U, c[1] + dy * U];
      l.w = [c[0] + lab[0] * U, c[1] + lab[1] * U];
    }
    // The page must fit the stage, also with its evidence open; where it does not, the sheet steps back a little.
    const wrap = fsheet.parentElement, sr = stage.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    ev.style.height = "0px"; fit0 = Math.min(1, wr.height / fsheet.offsetHeight, wr.width / fsheet.offsetWidth);
    ev.style.height = "auto"; evH = evIn.offsetHeight; fit1 = Math.min(fit0, wr.height / fsheet.offsetHeight);
    ev.style.height = "0px";
    T1 = NARROW ? [W / 2, wr.top - sr.top + wr.height * 0.44] : [wr.left - sr.left + wr.width / 2, H * 0.5 - 30 * U];
    Z1 = NARROW ? 2 : 1.75;
  }

  let P = 0, PT = 0, mx = 0, my = 0, pmx = 0, pmy = 0;
  const others = () => Object.keys(S).filter((id) => id !== "otd" && id !== "ghost").map((id) => S[id]);
  // What follows from how far the sky has assembled: the suggestion appears, and last the star at home lights up too.
  function sync() {
    S.ghost.el.classList.toggle("is-off", I.go < 0.82);
    const home = I.go > 0.9, small = L[0].el.lastElementChild;
    setKind(S["h-otd"], home ? "alert" : "calm");
    if (small.dataset.kind !== (home ? "alert" : "")) { small.dataset.kind = home ? "alert" : ""; small.textContent = home ? "one thing needs you" : "all calm"; }
  }
  // The star's sentence, word by word.
  const write = (text) => { say.innerHTML = text.split(" ").map((w, i) => `<span class="w" style="--n:${i}">${w}</span>`).join(" "); };
  function beginIntro() {
    I.on = true; I.step = 0; I.star = I.go = 0;
    S.otd.kind = S.otd.el.dataset.kind = "calm";
    S.otd.el.style.willChange = "auto"; // drawn anew at every size, so the large star stays sharp
    for (const s of others()) s.el.classList.add("is-off");
    hstate.style.visibility = "hidden";
    sync();
    // The clock starts once the type is there, so the first words do not change their face while they appear.
    Promise.race([document.fonts ? document.fonts.ready : 0, new Promise((r) => setTimeout(r, 1200))]).then(() => { if (I.on) { layout(); I.t0 = performance.now(); kick(); } });
  }
  function intro(now) {
    const t = now - I.t0;
    I.star = span(t, T_STAR[0], T_STAR[1]); I.go = span(t, T_GO[0], T_GO[1]);
    if (I.step < 1 && t >= T_SAY) { I.step = 1; write("All calm."); }
    if (I.step < 2 && t >= T_HOT) {
      I.step = 2;
      setKind(S.otd, "alert", "is-wake");
      const d = Math.round(Math.min(W, H) * 0.95);
      for (let i = 0; i < 3; i++) starsEl.append(el(`<i class="ripple" style="left:${I.at[0]}px;top:${I.at[1]}px;width:${d}px;height:${d}px;margin:${-d / 2}px 0 0 ${-d / 2}px;animation-delay:${i * 320}ms"></i>`));
      say.classList.add("out");
      setTimeout(() => { if (I.on && I.step === 2) { say.classList.remove("out"); write("One thing needs you."); } }, 430);
    }
    if (I.step < 3 && t >= T_GO[0]) {
      I.step = 3;
      root.classList.add("arrive"); root.classList.remove("intro");
      for (const s of others()) s.el.classList.remove("is-off");
      // What the star said shrinks into the line above the headline, where the same words stand small.
      const a = say.getBoundingClientRect(), b = hstate.getBoundingClientRect(), ms = (T_GO[1] - T_GO[0]) * 0.62;
      const to = `translate(${(b.left + b.width / 2 - a.left - a.width / 2).toFixed(1)}px, ${(b.top + b.height / 2 - a.top - a.height / 2).toFixed(1)}px) scale(${clamp(b.width / a.width, 0.08, 0.6).toFixed(4)})`;
      say.animate([{ transform: "none", opacity: 1 }, { opacity: 0, offset: 0.74 }, { transform: to, opacity: 0 }], { duration: ms, easing: "cubic-bezier(.6, 0, .2, 1)", fill: "forwards" }).finished.then(() => { say.hidden = true; }, () => {});
      hstate.style.visibility = "";
      hstate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 650, delay: (T_GO[1] - T_GO[0]) * 0.58, easing: "ease-out", fill: "backwards" });
    }
    if (I.step === 3) sync();
    if (t >= T_GO[1]) endIntro();
  }
  // The end of the opening, also when there was none or a scroll cut it short: everything stands where it belongs.
  function endIntro() {
    if (!I.on) return;
    I.on = false; I.star = I.go = 1;
    root.classList.remove("intro");
    setTimeout(() => root.classList.remove("arrive"), 3200);
    S.otd.kind = S.otd.el.dataset.kind = "alert"; S.otd.el.style.willChange = ""; S.otd.el.style.removeProperty("--rim");
    for (const s of others()) s.el.classList.remove("is-off");
    for (const r of $$(".ripple", starsEl)) r.remove();
    for (const a of hstate.getAnimations()) a.cancel();
    hstate.style.visibility = ""; say.hidden = true;
    sync();
  }

  function readScroll() {
    const v = (window.scrollY - flight.offsetTop) / (H || 1);
    let p = 3;
    for (let i = 1; i < KEYS.length; i++) if (v <= KEYS[i][0]) { p = lerp(KEYS[i - 1][1], KEYS[i][1], span(v, KEYS[i - 1][0], KEYS[i][0])); break; }
    PT = STILL ? Math.round(p) : p;
    if (I.on && PT > 0.03) endIntro();
    return v;
  }

  function draw() {
    const p = P, t = ease(span(p, 0, 1)), q = span(p, 1, 2), z = Math.exp(Math.log(Z1) * t);
    const fx = lerp(W / 2, hub[0], t), fy = lerp(H / 2, hub[1], t), tx = lerp(W / 2, T1[0], t), ty = lerp(H / 2, T1[1], t);
    const drift = 1 - t, homeO = 1 - span(p, 0.06, 0.5), e = ease(span(p, 2.05, 2.72)), fit = lerp(fit0, fit1, e);
    // The sheet first, its evidence as far open as the scroll says; then where the stars land on it: beside their blocks.
    fsheet.style.visibility = q > 0.01 ? "visible" : "hidden";
    fsheet.style.transform = fit < 1 ? `scale(${fit.toFixed(4)})` : "";
    ev.style.height = (e * evH).toFixed(1) + "px";
    if (q > 0) {
      const sr = stage.getBoundingClientRect();
      for (const id in S) { const s = S[id]; if (!s.mk) continue; const r = s.mk.getBoundingClientRect(); s.gone = !s.mk.getClientRects().length; s.px = r.left - sr.left; s.py = r.top - sr.top; }
    }
    // The opening is a camera that stands close on one star and then pulls back: everything is seen `zoom` times
    // larger around that star, which itself moves from the middle of the screen to its place on «Today».
    const solo = I.go < 1, pull = ease(span(I.go, 0, 0.8)), zoom = solo ? Math.exp(Math.log(I.big) * (1 - pull)) : 1;
    const o0 = [(S.otd.w[0] - fx) * z + tx, (S.otd.w[1] - fy) * z + ty], oa = [lerp(I.at[0], o0[0], pull), lerp(I.at[1], o0[1], pull)];
    for (const id in S) {
      const s = S[id], deep = s.home ? 1.9 : 1;
      let x = (s.w[0] - fx) * z + tx - pmx * 12 * deep * drift, y = (s.w[1] - fy) * z + ty - pmy * 9 * deep * drift, op = s.home ? homeO : 1, big = 1;
      if (solo) {
        x = oa[0] + (x - o0[0]) * zoom; y = oa[1] + (y - o0[1]) * zoom; big = zoom;
        if (s === S.otd) { op = span(I.star, 0, 0.45); big = zoom * (0.4 + 0.6 * (1 - Math.pow(1 - I.star, 3))); s.el.style.setProperty("--rim", (2 / Math.sqrt(zoom)).toFixed(2) + "px"); }
        else op *= span(I.go, 0.05, 0.45);
      }
      if (s.mk && q > 0) {
        if (s.gone) op = 1 - span(q, 0, 0.3);
        else { const k = ease(span(q, s.lag, s.lag + 0.6)); x = lerp(x, s.px, k); y = lerp(y, s.py, k); }
      }
      s.x = x; s.y = y;
      s.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` + (big !== 1 ? ` scale(${big.toFixed(3)})` : "");
      s.el.style.opacity = op;
    }
    S.otd.lab.style.opacity = I.go >= 1 ? span(p, 0.42, 0.8) * (1 - span(q, 0, 0.22)) : 0;
    S["h-otd"].lab.style.opacity = I.go > 0.93 && !NARROW ? 1 : 0;
    starsEl.style.setProperty("--far", (1 - q).toFixed(3));
    for (const th of T) {
      let a = th.a, x1 = a.x, y1 = a.y, x2 = th.b.x, y2 = th.b.y, op = 1;
      if (th.kind === "home") op = homeO;
      else if (th.kind === "fan") op = 1 - span(q, 0, 0.3);
      else if (th.kind === "alarm") op = span(I.go, 0.45, 0.8);
      else if (th.kind === "ghost") op = span(I.go, 0.82, 1) * (th.b.gone ? 1 - span(q, 0, 0.3) : 1);
      else if (th.kind === "dotted") { const k = ease(span(I.go, 0.5, 0.92)); x2 = lerp(x1, x2, k); y2 = lerp(y1, y2, k); op = (I.go > 0.5 ? 0.85 : 0) * homeO; }
      th.el.setAttribute("x1", x1.toFixed(1)); th.el.setAttribute("y1", y1.toFixed(1)); th.el.setAttribute("x2", x2.toFixed(1)); th.el.setAttribute("y2", y2.toFixed(1));
      th.el.style.opacity = op;
    }
    for (const l of L) {
      let x = (l.w[0] - fx) * z + tx - pmx * 23 * drift, y = (l.w[1] - fy) * z + ty - pmy * 17 * drift;
      if (solo) { x = oa[0] + (x - o0[0]) * zoom; y = oa[1] + (y - o0[1]) * zoom; }
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      l.el.style.opacity = l.h.off ? 0 : homeO * (solo ? span(I.go, 0.6, 0.95) : 1);
    }
    hubLabel.style.transform = `translate3d(${((hub[0] - fx) * z + tx).toFixed(1)}px, ${((hub[1] + 146 * UH - fy) * z + ty).toFixed(1)}px, 0) translate(-50%, -50%)`;
    hubLabel.style.opacity = span(p, 0.6, 0.95) * (1 - span(q, 0, 0.2));
    // The hero leaves upward as the flight begins; the three texts come and go beside the stage.
    const ho = 1 - span(p, 0.03, 0.3);
    hero.style.opacity = ho; hero.style.transform = `translate3d(0, ${(-70 * span(p, 0, 0.35)).toFixed(1)}px, 0)` + (HK < 1 ? ` scale(${HK.toFixed(4)})` : ""); hero.style.visibility = ho > 0 ? "visible" : "hidden";
    steps.forEach((st, i) => {
      const k = i + 1, a = span(p, k - 0.42, k - 0.1), b = i < 2 ? span(p, k + 0.16, k + 0.4) : 0, op = a * (1 - b);
      st.style.opacity = op; st.style.transform = `translate3d(0, ${((1 - a) * 26 - b * 26).toFixed(1)}px, 0)`; st.style.visibility = op > 0.001 ? "visible" : "hidden";
    });
    // The sheet's blocks one after the other, and at the end the evidence under the sentence.
    fsheet.style.opacity = span(q, 0.1, 0.5);
    parts.forEach((n, i) => n.style.setProperty("--r", ease(span(q, 0.46 + i * 0.08, 0.72 + i * 0.08)).toFixed(3)));
    evFact.classList.toggle("is-open", p > 2.03);
    evLine.style.clipPath = `inset(-12px ${(100 - span(p, 2.3, 2.94) * 101).toFixed(2)}% -12px -12px)`;
    evDot.style.opacity = evTgt.style.opacity = span(p, 2.86, 2.98);
  }

  let raf = 0, last = 0, placeNow = "";
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  function loop(now) {
    raf = 0;
    const dt = Math.min(64, last ? now - last : 16); last = now;
    const v = readScroll(), k = STILL ? 1 : 1 - Math.exp(-dt / 95);
    P = Math.abs(PT - P) < 0.0004 ? PT : P + (PT - P) * k;
    pmx = Math.abs(mx - pmx) < 0.001 ? mx : pmx + (mx - pmx) * k * 0.5; pmy = Math.abs(my - pmy) < 0.001 ? my : pmy + (my - pmy) * k * 0.5;
    let more = P !== PT || pmx !== mx || pmy !== my;
    if (I.on && I.t0) { intro(now); more = true; }
    if (v < KEYS[KEYS.length - 1][0] + 1.05) draw();
    sky(); place();
    if (more) kick(); else last = 0;
  }

  // ═════ Sky and places ═════
  const dust = $$(".sky i"), placeLinks = $$(".places a"), rooms = ["time", "build", "design", "data", "start"].map((id) => $("#" + id));
  function sky() {
    const y = window.scrollY;
    if (STILL) return;
    dust[0].style.transform = `translate3d(0, ${(-(y * 0.1) % 240).toFixed(1)}px, 0)`;
    dust[1].style.transform = `translate3d(0, ${(-(y * 0.17) % 240).toFixed(1)}px, 0)`;
  }
  function place() {
    const y = window.scrollY, mid = y + innerHeight * 0.45;
    let cur = y < flight.offsetTop + H * 0.55 ? "top" : "idea";
    for (const r of rooms) if (r.offsetTop <= mid) cur = r.id;
    if (cur === placeNow) return;
    placeNow = cur;
    for (const a of placeLinks) {
      const on = a.dataset.go === cur;
      if (on) { a.setAttribute("aria-current", "true"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); } else a.removeAttribute("aria-current");
    }
  }
  function go(id) {
    const top = id === "top" ? 0 : id === "idea" ? flight.offsetTop + 1.14 * H : $("#" + id).getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top, behavior: STILL ? "auto" : "smooth" });
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-go]");
    if (a) { e.preventDefault(); go(a.dataset.go); }
    else if (e.target.closest(".logo")) { e.preventDefault(); go("top"); }
  });

  // ═════ Time: the page of every month ═════
  const tsheet = $("#tsheet");
  let TM = -1, tDir = 1, tLast = 0, playing = 0, touched = false;
  const levels = (m) => FIGS.map((k) => evaluate(k, m).level);
  const eventful = (m) => m > 0 && levels(m).join() !== levels(m - 1).join();
  tsheet.innerHTML = `<i class="spine"></i><div class="phead"><i class="mk">${starHTML("lead")}</i><div class="dl"><span class="dl-tag">Today</span><button class="when" type="button" title="Pull to change the month"></button><button class="play" type="button" aria-label="Play the history" aria-pressed="false">▶</button></div><h3 class="hl" aria-live="polite"></h3>`
    + `<div class="ruler" role="slider" tabindex="0" aria-label="Month" aria-valuemin="0" aria-valuemax="${NOW}"><div class="base"></div>`
    + Array.from({ length: N }, (_, m) => {
      const x = ((m / NOW) * 100).toFixed(2), jan = ym(m)[1] === 0, lv = levels(m);
      return `<i class="tk${jan ? " y" : ""}" style="left:${x}%"></i>${jan ? `<span class="yl" style="left:${x}%">${ym(m)[0]}</span>` : ""}${lv.includes("alert") ? `<i class="ht" style="left:${x}%"></i>` : lv.includes("watch") ? `<i class="ht w" style="left:${x}%"></i>` : ""}`;
    }).join("") + `<div class="cur"><span></span></div></div></div><div class="pblocks"></div>`;
  const tWhen = $(".when", tsheet), tPlay = $(".play", tsheet), tHl = $(".hl", tsheet), tRuler = $(".ruler", tsheet), tCur = $(".cur", tsheet), tBox = $(".pblocks", tsheet);

  function setMonth(m) {
    m = clamp(Math.round(m), 0, NOW);
    if (m === TM) return;
    // Months that follow each other at a walking pace move; pulled through quickly they simply stand there, or the
    // page would tumble over itself.
    const now = performance.now(), calmly = TM >= 0 && now - tLast > 200;
    tLast = now; tDir = m > TM ? 1 : -1; TM = m;
    tWhen.textContent = long(m);
    // The headline changes word by word; words that stay stand still.
    const words = headlineOf(FIGS, m).split(" "), old = $$(".hw", tHl).map((w) => w.textContent);
    if (words.join(" ") !== old.join(" ")) tHl.innerHTML = words.map((w, i) => `<span class="hw${calmly && old[i] !== w ? " tick" : ""}" style="--dy:${tDir}">${w}</span>`).join(" ");
    // What needs someone is a sentence, what is narrowly missed or good news a line, the rest shares the calm line.
    const rs = FIGS.map((k) => [k, evaluate(k, m)]).sort((a, b) => RANK[a[1].level] - RANK[b[1].level]);
    const calm = rs.filter(([, r]) => r.level === "calm").map(([k]) => k);
    const html = rs.filter(([, r]) => r.level !== "calm").map(([k, r]) => blockHTML(k, m, r.level === "alert" ? "sentence" : "line", { star: true }));
    if (calm.length) html.push(quietHTML(calm, m, true));
    const before = new Map(), was = new Map();
    for (const b of tBox.children) { before.set(b.dataset.key, b.getBoundingClientRect()); was.set(b.dataset.key, $$(".num", b).map((n) => n.textContent)); }
    tBox.innerHTML = html.join("");
    if (calmly) {
      for (const b of tBox.children) {
        const nums = was.get(b.dataset.key);
        if (!nums) { b.classList.add("is-new"); continue; }
        $$(".num", b).forEach((n, i) => { if (nums[i] !== n.textContent) { n.classList.add("tick"); n.style.setProperty("--dy", tDir); } });
      }
      glide(tBox.children, before, "key");
    }
    tCur.style.left = (m / NOW) * 100 + "%";
    tCur.dataset.edge = m < 2 ? "l" : m > NOW - 2 ? "r" : "";
    tCur.firstElementChild.textContent = short(m);
    tRuler.setAttribute("aria-valuenow", m); tRuler.setAttribute("aria-valuetext", `${long(m)}: ${words.join(" ")}`);
    spineOf(tsheet);
  }
  // The history plays at two paces: calm months pass quickly, a month in which something changes stays a while.
  function play(on) {
    clearTimeout(playing); playing = 0;
    tPlay.setAttribute("aria-pressed", on); tPlay.textContent = on ? "❚❚" : "▶";
    if (!on) return;
    if (TM >= NOW) setMonth(0);
    const next = () => { setMonth(TM + 1); if (TM >= NOW) play(false); else playing = setTimeout(next, eventful(TM) ? 650 : 220); };
    playing = setTimeout(next, 600);
  }
  const hands = () => { touched = true; play(false); };
  tPlay.addEventListener("click", () => { touched = true; play(!playing); });
  function scrub(node, at) {
    node.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      hands(); node.setPointerCapture(e.pointerId); root.classList.add("scrubbing");
      const start = { x: e.clientX, m: TM };
      const move = (ev) => setMonth(at(ev, start)), up = () => { root.classList.remove("scrubbing"); node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", up); node.removeEventListener("pointercancel", up); };
      node.addEventListener("pointermove", move); node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up);
      move(e);
    });
  }
  scrub(tWhen, (e, s) => s.m + (e.clientX - s.x) / 15);
  scrub(tRuler, (e) => { const r = tRuler.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * NOW; });
  for (const n of [tWhen, tRuler]) n.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12, Home: -N, End: N }[e.key];
    if (step) { e.preventDefault(); hands(); setMonth(TM + step); } else if (e.key === " " && n === tRuler) { e.preventDefault(); touched = true; play(!playing); }
  });
  // The room waits at the start of its history and, the first time it comes into view, plays it once up to today.
  // Where nothing may move by itself, it stands at today.
  if (!STILL && "IntersectionObserver" in window) {
    setMonth(0);
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      setTimeout(() => { if (!touched) play(true); }, 500);
    }, { threshold: 0.6 });
    io.observe(tsheet);
  } else setMonth(NOW);

  // ═════ Build: grab a star, the block comes with it ═════
  const bench = $("#bench"), bthreads = $("#bthreads"), sheets = { home: $("#bhome"), own: $("#bown") };
  const PAGES = { home: [{ id: "oee", form: "number" }, { id: "scrap", form: "line" }, { id: "good", form: "sentence" }], own: [] };
  let ownTitle = "", drag = null;
  function renderBench(flash) {
    const before = new Map($$(".blk", bench).map((b) => [b.dataset.id, b.getBoundingClientRect()]));
    const blocks = (page) => `<div class="pblocks">${PAGES[page].map((b) => blockHTML(FIG[b.id], NOW, b.form, { star: "button", tools: true, home: false })).join("")}</div><p class="ins">/ block · [[ figure · or ask</p>`;
    sheets.home.innerHTML = `<i class="spine"></i><div class="phead"><i class="mk">${starHTML("lead")}</i><div class="dl"><span class="dl-tag">Production</span><span>${short(NOW)}</span></div><h3 class="hl">${headlineOf(PAGES.home.map((b) => FIG[b.id]), NOW)}</h3></div>${blocks("home")}`;
    const empty = !PAGES.own.length;
    sheets.own.classList.toggle("is-empty", empty);
    sheets.own.innerHTML = empty ? `<div class="own-empty"><i>+</i><span>Drop a star here.<br>It starts a page of your own.</span><small>or press Enter on a star</small></div>`
      : `<i class="spine"></i><div class="phead"><i class="mk">${starHTML("quiet")}</i><div class="dl"><span class="dl-tag">Your page</span><span>${short(NOW)}</span></div><div class="ptitle" contenteditable="true" spellcheck="false" role="textbox" aria-label="Name of your page" data-ph="Give it a name"></div></div>${blocks("own")}`;
    if (!empty) { const t = $(".ptitle", sheets.own); t.textContent = ownTitle; t.addEventListener("input", () => { ownTitle = t.textContent.trim(); if (!ownTitle) t.textContent = ""; }); t.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); t.blur(); } }); }
    spineOf(sheets.home); spineOf(sheets.own); benchThreads();
    glide($$(".blk", bench), before);
    if (!flash) return;
    $(`.blk[data-id="${flash}"]`, bench)?.classList.add("flash");
    if (!STILL) bthreads.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: 900 });
  }
  // A figure that lives on your page stays tied to its home, as in the app.
  function benchThreads() {
    const br = bench.getBoundingClientRect(), lead = $(".phead .star", sheets.home).getBoundingClientRect();
    bthreads.replaceChildren(...$$(".blk > .mk > .star", sheets.own).map((st) => { const r = st.getBoundingClientRect(); return sv("line", { class: "dotted", x1: lead.left - br.left, y1: lead.top - br.top, x2: r.left - br.left, y2: r.top - br.top, style: "opacity:.8" }); }));
  }
  function moveBlock(id, to, idx) {
    const from = PAGES.home.some((b) => b.id === id) ? "home" : "own", i = PAGES[from].findIndex((b) => b.id === id), [b] = PAGES[from].splice(i, 1);
    if (from === to && i < idx) idx--;
    PAGES[to].splice(clamp(idx, 0, PAGES[to].length), 0, b);
    renderBench(id);
  }
  // Where a carried block would land: the page under the pointer and the gap between its blocks.
  function landing(x, y) {
    for (const page of ["home", "own"]) {
      const sh = sheets[page], r = sh.getBoundingClientRect();
      if (x < r.left - 24 || x > r.right + 24 || y < r.top - 24 || y > r.bottom + 40) continue;
      const blks = $$(".blk", sh);
      let idx = blks.length;
      for (let i = 0; i < blks.length; i++) { const b = blks[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { idx = i; break; } }
      return { page, idx, sh, blks };
    }
    return null;
  }
  function endDrag(drop) {
    const d = drag; drag = null;
    if (!d) return;
    d.carry?.remove(); d.mark?.remove(); d.blk.classList.remove("is-drag"); root.classList.remove("dragging");
    for (const s of Object.values(sheets)) s.classList.remove("is-over");
    if (drop && d.to) moveBlock(d.id, d.to.page, d.to.idx);
  }
  bench.addEventListener("pointerdown", (e) => {
    const st = e.target.closest(".blk .star");
    if (!st || e.button) return;
    e.preventDefault(); st.focus({ preventScroll: true }); st.setPointerCapture(e.pointerId);
    const blk = st.closest(".blk"), k = FIG[blk.dataset.id];
    drag = { id: k.id, k, blk, x: e.clientX, y: e.clientY, carry: null, mark: null, to: null };
  });
  bench.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d) return;
    if (!d.carry) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.carry = document.body.appendChild(el(`<div class="carry"><small>${d.k.name}</small>${fmt(d.k, d.k.s[NOW])}</div>`));
      d.mark = el(`<div class="dropmark"></div>`);
      d.blk.classList.add("is-drag"); root.classList.add("dragging");
    }
    d.carry.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    const to = (d.to = landing(e.clientX, e.clientY));
    for (const page in sheets) sheets[page].classList.toggle("is-over", !!to && to.page === page);
    if (!to || !to.blks.length) return d.mark.remove();
    const box = $(".pblocks", to.sh), at = to.idx < to.blks.length ? to.blks[to.idx].offsetTop - 13 : to.blks[to.blks.length - 1].offsetTop + to.blks[to.blks.length - 1].offsetHeight + 13;
    box.append(d.mark); d.mark.style.top = at + "px";
  });
  bench.addEventListener("pointerup", () => endDrag(true));
  bench.addEventListener("pointercancel", () => endDrag(false));
  bench.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return endDrag(false);
    const st = e.target.closest(".blk .star");
    if (!st || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    const id = st.closest(".blk").dataset.id, to = PAGES.home.some((b) => b.id === id) ? "own" : "home";
    moveBlock(id, to, PAGES[to].length);
    $(`.blk[data-id="${id}"] .star`, bench)?.focus({ preventScroll: true });
  });
  bench.addEventListener("click", (e) => {
    const fm = e.target.closest(".fm");
    if (!fm) return;
    const id = fm.closest(".blk").dataset.id, b = [...PAGES.home, ...PAGES.own].find((x) => x.id === id);
    if (b.form === fm.dataset.form) return;
    b.form = fm.dataset.form;
    renderBench();
    $(`.blk[data-id="${id}"] .fm[data-form="${b.form}"]`, bench)?.focus({ preventScroll: true });
    if (!STILL) $$(`.blk[data-id="${id}"] > :not(.mk):not(.lbl)`, bench).forEach((n) => n.animate([{ opacity: 0, transform: "translateX(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: OUT }));
  });
  renderBench();

  // ═════ Design: the page changes its design the way the app does ═════
  const dzb = $$(".dzb"), corpBtn = $("#corpbtn"), themeMeta = document.head.appendChild(el(`<meta name="theme-color">`));
  function syncDesign() {
    const id = root.dataset.design || "nebel";
    for (const b of dzb) { const on = b.dataset.design === id; b.setAttribute("aria-checked", on); b.tabIndex = on || (id === "musterbank" && b.dataset.design === "nebel") ? 0 : -1; }
    const corp = id === "musterbank";
    corpBtn.textContent = corp ? "Back to Lumantic’s own" : "Put «Musterbank» on this page";
    corpBtn.dataset.design = corp ? "nebel" : "musterbank";
    themeMeta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
    relayout();
  }
  function setDesign(id, x, y) {
    if ((root.dataset.design || "nebel") === id) return;
    const apply = () => { root.dataset.design = id; try { localStorage.setItem("lumantic-design", id); } catch { /* private window */ } syncDesign(); };
    if (STILL || !document.startViewTransition) return apply();
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 950, easing: "cubic-bezier(.3, .7, .2, 1)", pseudoElement: "::view-transition-new(root)" })).catch(() => {});
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-design]");
    if (!b) return;
    const r = b.getBoundingClientRect();
    setDesign(b.dataset.design, e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
  });
  $(".dz").addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, dzb.findIndex((b) => b.getAttribute("aria-checked") === "true")), next = dzb[(i + step + dzb.length) % dzb.length], r = next.getBoundingClientRect();
    next.focus(); setDesign(next.dataset.design, r.left + r.width / 2, r.top + r.height / 2);
  });

  // ═════ Things that come into view, and the start ═════
  if (STILL || !("IntersectionObserver" in window)) $$(".rv").forEach((n) => n.classList.add("in"));
  else {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    $$(".rv").forEach((n) => io.observe(n));
  }
  let relayoutQueued = false;
  function relayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(() => { relayoutQueued = false; layout(); spineOf(tsheet); spineOf(sheets.home); spineOf(sheets.own); benchThreads(); draw(); kick(); });
  }
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", relayout);
  addEventListener("pointermove", (e) => { if (STILL || I.on || e.pointerType === "touch" || P > 1) return; mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; kick(); }, { passive: true });
  // A click or a key during the opening means: show me the page.
  for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => { if (I.on) { endIntro(); kick(); } });
  document.fonts?.addEventListener?.("loadingdone", relayout);
  root.dataset.live = "1";
  layout(); readScroll(); P = PT;
  // Quiet first. Then, once, something matters. Not for someone who arrives further down or wants nothing to move.
  if (!STILL && root.classList.contains("intro") && window.scrollY < 4) beginIntro(); else { I.on = true; endIntro(); }
  syncDesign(); draw(); sky(); place();
})();
