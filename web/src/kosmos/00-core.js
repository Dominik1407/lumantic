// ═════ Kosmos · core: the figures from the gold layer, the rules engine, Lumina's ideas, small helpers ═════
// Everything here is filled from DATA (the answer of GET /api/metrics), never invented.
// ───────────── Helpers ─────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

// ───────────── Time: the monthly axis of the gold layer ─────────────
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTH = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const N = DATA.months.length;
const [START_Y, START_M] = (() => { const [y, m] = DATA.months[0].split("-").map(Number); return [y, m - 1]; })();
const yearOf = (t) => START_Y + Math.floor((t + START_M) / 12);
const mOf = (t) => (((t + START_M) % 12) + 12) % 12;
const ym = (y, m) => (y - START_Y) * 12 + (m - 1) - START_M;
const TITLE = DATA.title || "Kennzahlen", SOURCE = DATA.source || "";

// ───────────── The figures ─────────────
// A value missing in the gold layer is a gap: the series carries the last known value so the arithmetic holds,
// and gap[t] says that this month has no data of its own. Such a month is never a signal.
function fillGaps(raw) {
  const out = new Array(N), gap = new Array(N).fill(false);
  let last = null;
  for (let t = 0; t < N; t++) { const v = raw[t]; if (v === null || v === undefined || !Number.isFinite(v)) { gap[t] = true; out[t] = last; } else { out[t] = v; last = v; } }
  const first = out.findIndex((v) => v !== null);
  for (let t = 0; t < N; t++) if (out[t] === null) out[t] = first >= 0 ? out[first] : 0;
  return [out, gap];
}
const GROUPS = Object.fromEntries(DATA.groups.map((g) => [g.id, g.name]));
const KPIS = DATA.kpis.map((d) => {
  const [series, gap] = fillGaps(d.series), parts = d.parts && d.parts.length ? Object.fromEntries(d.parts.map((p) => [p.name, fillGaps(p.series)[0]])) : null;
  return { id: d.id, group: d.group, name: d.name, long: d.long || d.name, short: d.short || d.name, unit: d.unit, dec: d.dec || 0, kind: d.kind, dir: d.dir,
    reg: d.limit ?? null, regName: d.limitName || "", target: d.target ?? null, targetName: d.targetName || "", desc: d.desc || "", table: d.table || "",
    hidden: !!d.hidden, season: !!d.season, series, gap, parts, partsMode: parts ? d.partsMode || "sum" : null, funnel: d.partsMode === "funnel",
    daily: d.daily && Array.isArray(d.daily.series) ? d.daily.series : null };
});
const K = Object.fromEntries(KPIS.map((k) => [k.id, k]));
const DAYS = Array.isArray(DATA.days) ? DATA.days : [];
const EVENTS = (DATA.events || []).filter((e) => e.month >= 0 && e.month < N).map((e) => ({ t: e.month, title: e.title, text: e.text }));
const noData = (k, t) => !!(k.gap && k.gap[t]);
// Daily values: the last 31 days the gold layer holds, for figures that have a daily table.
const DAILY = (() => {
  const n = DAYS.length;
  if (!n) return { n: 0, a: 0, lastLong: "" };
  const last = new Date(DAYS[n - 1] + "T00:00:00Z");
  return { n, a: Math.max(0, n - 31), lastLong: `${last.getUTCDate()}. ${MONTH[last.getUTCMonth()]} ${last.getUTCFullYear()}` };
})();
const dayLabel = (iso) => { const d = new Date(iso + "T00:00:00Z"); return `${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`; };

// ───────────── Periods ─────────────
const PERIODS = { jahr: [], quartal: [], monat: [] };
for (let y = START_Y; y <= yearOf(N - 1); y++) {
  const from = Math.max(0, ym(y, 1)), to = Math.min(ym(y, 12), N - 1), partial = to < ym(y, 12) || ym(y, 1) < 0;
  PERIODS.jahr.push({ g: "jahr", y, from, to, partial, label: String(y), long: partial ? `${y} bis ${MONTH[mOf(to)]}` : `${y}` });
  for (let q = 1; q <= 4; q++) {
    const f = ym(y, 3 * q - 2), tt = Math.min(ym(y, 3 * q), N - 1);
    if (f > N - 1 || tt < 0) continue;
    const part = tt < ym(y, 3 * q) || f < 0;
    PERIODS.quartal.push({ g: "quartal", y, q, from: Math.max(0, f), to: tt, partial: part, label: `Q${q} ${y}`, short: `Q${q}`, long: part ? `Q${q} ${y} bis ${MONTH[mOf(tt)]}` : `Q${q} ${y}` });
  }
}
for (let t = 0; t < N; t++) {
  const y = yearOf(t), m = mOf(t);
  PERIODS.monat.push({ g: "monat", y, m, q: Math.floor(m / 3) + 1, from: t, to: t, partial: false, label: `${MON[m]} ${y}`, short: MON[m], long: `${MONTH[m]} ${y}` });
}
for (const g of Object.keys(PERIODS)) PERIODS[g].forEach((p, i) => (p.i = i));
const NOUN = { jahr: "Vorjahr", quartal: "Vorquartal", monat: "Vormonat" };
const indexOfMonth = (g, t) => PERIODS[g].findIndex((p) => p.from <= t && t <= p.to);
const monthsIn = (p) => p.to - p.from + 1;
const valueAt = (k, p, s = k.series) => (k.kind === "flow" ? sum(s.slice(p.from, p.to + 1)) : s[p.to]);
const targetAt = (k, p) => (k.target == null ? null : k.kind === "flow" ? k.target * monthsIn(p) : k.target);

// ───────────── Format (Swiss) ─────────────
const thousands = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’");
const pct = (d) => { const p = Math.abs(d * 100); return (p < 10 ? String(Number(p.toFixed(1))) : String(Math.round(p))) + " %"; };
function split(k, v) {
  if (k.unit === "%") return [v.toFixed(k.dec), "%"];
  if (k.unit === "Mrd") return [(v / 1000).toFixed(1), "Mrd. CHF"];
  return [(v < 0 ? "−" : "") + thousands(Math.abs(v)), "Mio. CHF"];
}
const F = (k, v) => split(k, v).join(" ");
const compact = (k, v) => (k.unit === "%" ? v.toFixed(k.dec) + "%" : k.unit === "Mrd" ? (v / 1000).toFixed(1) + " Mrd" : thousands(v) + " Mio");
const arrow = (d) => (d > 0 ? "↑" : d < 0 ? "↓" : "→");
function fdelta(k, d, base) {
  if (k.unit === "%") {
    const p = Math.abs(d), min = Math.pow(10, -(k.dec || 0)) / 2;
    return p < min ? "unverändert" : `${arrow(d)} ${p.toFixed(k.dec)} Pp.`;
  }
  if (k.kind === "flow") return `${arrow(d)} ${thousands(Math.abs(d))} Mio. CHF`;
  const rel = d / Math.abs(base);
  return Math.abs(rel) < 0.0005 ? "unverändert" : `${arrow(d)} ${pct(rel)}`;
}

// ───────────── Engine: same rules as the Go server, plus regulatory minimums ─────────────
const evalCache = new Map();
function evaluate(k, g, i) {
  const key = k.id + "|" + g + "|" + i;
  if (evalCache.has(key)) return evalCache.get(key);
  const P = PERIODS[g], p = P[i];
  const series = P.slice(0, i + 1).map((pp) => valueAt(k, pp));
  const cur = series[i];
  let prev = i > 0 ? series[i - 1] : null, prevNoun = NOUN[g];
  const yi = g === "quartal" ? i - 4 : g === "monat" ? i - 12 : -1;
  let yoy = yi >= 0 ? series[yi] : null;
  // A period still running is compared with the same months a year earlier.
  const ytd = k.kind === "flow" && p.partial && p.from >= 12;
  if (ytd) { prev = sum(k.series.slice(p.from - 12, p.to - 11)); prevNoun = "Vorjahr, gleiche Monate"; yoy = null; }
  const past = series.slice(Math.max(0, i - 8), i);
  const mu = mean(past), sd = Math.sqrt(mean(past.map((x) => (x - mu) ** 2)));
  let z = 0;
  if (past.length >= 4 && sd > 1e-9 && !(k.kind === "flow" && p.partial) && Math.abs(cur - mu) / Math.max(Math.abs(mu), 2 * sd) >= 0.05) z = (cur - mu) / sd;
  const tgt = targetAt(k, p), reg = k.reg;
  const mT = tgt != null && k.dir ? ((cur - tgt) / Math.abs(tgt)) * k.dir : null;
  const mR = reg != null && k.dir ? ((cur - reg) / Math.abs(reg)) * k.dir : null;
  let level = "calm", label = "Ruhig", tone = "neutral", move = false, breach = false;
  const gap = g === "monat" && noData(k, i);
  if (gap) label = "Keine Daten";
  else if (mR !== null && mR < 0) { level = "alert"; tone = "bad"; label = "Regulatorisch verletzt"; breach = true; }
  else if (mT !== null && mT < -0.03) { level = "alert"; tone = "bad"; label = k.dir > 0 ? "Unter internem Ziel" : "Über Frühwarnung"; }
  else if (mT !== null && mT < 0) { level = "watch"; tone = "bad"; label = "Knapp verfehlt"; }
  else if (Math.abs(z) >= 2 && k.dir && Math.sign(z) !== k.dir) { level = "watch"; tone = "bad"; label = "Auffällige Bewegung"; move = true; }
  else if (Math.abs(z) >= 2) { level = "notable"; move = true; tone = k.dir ? "good" : "neutral"; label = k.dir ? "Gute Nachricht" : "Ungewöhnlich"; }
  // SPC run rule: six or more consecutive moves in the adverse direction are a signal, even inside the limits.
  let run = 0, special = null;
  if (k.dir && !gap) for (let x = i; x > 0 && run < 36; x--) { if ((series[x] - series[x - 1]) * k.dir < 0) run++; else break; }
  if (!gap && (level === "calm" || (level === "notable" && tone !== "good")) && run >= 6) { level = "watch"; tone = "bad"; label = "Anhaltender Trend"; special = "trend"; move = false; }
  // Hysteresis: after an alert, the all-clear needs a 2 % recovery margin, so status does not flicker.
  if (!gap && level === "calm" && i > 0 && mT !== null && mT < 0.02 && evaluate(k, g, i - 1).level === "alert") { level = "watch"; tone = "bad"; label = "Erholung, noch knapp"; special = "recover"; }
  const kind = level === "notable" ? (tone === "good" ? "good" : "info") : level;
  const m = Math.abs(mR !== null && mR < 0 ? mR : mT || 0);
  const score = (breach ? 1600 : 0) + (level === "alert" ? 1000 + m * 100 : level === "watch" ? 600 + (m * 100 || Math.abs(z)) : level === "notable" ? 500 + Math.abs(z) : gap ? 0 : 100);
  const mag = level === "alert" ? Math.min(1, 0.86 + m * 0.3) : level === "watch" ? 0.6 : level === "notable" ? 0.52 : 0.2;
  const r = { k, g, i, p, series, cur, prev, yoy, tgt, reg, mT, mR, z, level, label, tone, kind, score: score + (special ? run : 0), mag, breach, ytd, prevNoun, run, special, gap };
  r.delta = prev !== null && !gap ? `${fdelta(k, cur - prev, prev)} ggü. ${prevNoun}` : "";
  r.yoyText = yoy !== null && !gap ? `${fdelta(k, cur - yoy, yoy)} ggü. Vorjahr` : "";
  r.answer = gap ? "keine Daten für diesen Monat" : answerFor(r, move);
  r.why = (level === "alert" || level === "watch") && i > 0 ? driverFor(r) : "";
  if ((level === "alert" || level === "watch") && run >= 4 && special !== "trend") r.why = (r.why ? r.why + ". " : "") + `Seit ${run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  evalCache.set(key, r);
  return r;
}
const RUN_NOUN = { monat: "Monaten", quartal: "Quartalen", jahr: "Jahren" };
function answerFor(r, move) {
  const { k, cur, tgt, reg, level, g, i } = r, v = F(k, cur);
  if (r.special === "trend") return `${v}, seit ${r.run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  if (r.special === "recover") return `${v}, wieder im Ziel, aber noch ohne Sicherheitsabstand`;
  if (r.breach) return k.dir > 0 ? `${v}, unter dem regulatorischen Minimum von ${F(k, reg)}` : `${v}, über dem Limit von ${F(k, reg)}`;
  if ((level === "alert" || level === "watch") && !move) return k.dir > 0 ? `${v}, unter dem internen Ziel von ${F(k, tgt)}` : `${v}, über der Frühwarnschwelle von ${F(k, tgt)}`;
  if (move) {
    const before = r.series.slice(0, -1), up = r.z > 0;
    let j = -1;
    for (let x = before.length - 1; x >= 0; x--) if (up ? before[x] >= cur : before[x] <= cur) { j = x; break; }
    if (j < 0 && before.length >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit Beginn der Reihe ${START_Y}`;
    if (j >= 0 && i - j >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit ${PERIODS[g][j].long}`;
    return `${v}, deutlich ${up ? "höher" : "tiefer"} als üblich`;
  }
  if (tgt != null) return k.dir > 0 ? `${v}, über dem Ziel von ${F(k, tgt)}` : `${v}, unter der Frühwarnschwelle von ${F(k, tgt)}`;
  return r.delta ? `${v}, ${r.delta}` : v;
}
// Names a part only when it clearly explains the deviation.
function driverFor(r) {
  const { k, g, i } = r;
  if (!k.parts) return "";
  const p = PERIODS[g][i], q = r.ytd ? { from: p.from - 12, to: p.to - 12 } : PERIODS[g][i - 1];
  if (k.partsMode === "ratio") {
    const [num, den] = Object.keys(k.parts);
    const dn = valueAt(k, p, k.parts[num]) / valueAt(k, q, k.parts[num]) - 1, dd = valueAt(k, p, k.parts[den]) / valueAt(k, q, k.parts[den]) - 1;
    const top = [{ name: num, s: -dn * k.dir, d: dn }, { name: den, s: dd * k.dir, d: dd }].sort((a, b) => b.s - a.s)[0];
    return top.s > 0 ? `Grund: ${top.name} ${top.d > 0 ? "+" : "−"}${pct(top.d)}` : "";
  }
  const ch = Object.entries(k.parts).map(([name, s]) => { const d = valueAt(k, p, s) - valueAt(k, q, s); return { name, d, s: -d * (k.dir || 1) }; }).sort((a, b) => b.s - a.s);
  if (!ch.length || ch[0].s <= 0 || (ch[1] && ch[0].s < 1.5 * Math.max(0, ch[1].s))) return "";
  return `Grund: ${ch[0].name} ${ch[0].d > 0 ? "+" : "−"}${thousands(Math.abs(ch[0].d))} Mio. CHF ggü. ${r.prevNoun}`;
}

// ───────────── DOM helpers ─────────────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false && c !== "") el.append(c instanceof Node ? c : String(c));
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of kids) if (c) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
// Motion: the system setting, or «Bewegung: Ruhig» in the settings. The host can change it while the app runs.
let reduced = HOST.reduced();
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function animate(dur, fn, ease = easeOut) {
  if (reduced) { fn(1); return () => {}; }
  const t0 = performance.now();
  let stop = false;
  const step = () => { if (stop) return; const k = clamp((performance.now() - t0) / dur, 0, 1); fn(ease(k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  return () => { stop = true; };
}

// ───────────── Scopes and Lumina ─────────────
const GROUP_ORDER = DATA.groups.map((g) => g.id).filter((id) => KPIS.some((k) => k.group === id));
const SCOPES = { all: `${TITLE} gesamt`, ...GROUPS };
const scopeKpis = (scope) => (scope === "all" ? KPIS : KPIS.filter((k) => k.group === scope));
const levelCounts = (m, scope = "all") => {
  const ev = scopeKpis(scope).map((k) => evaluate(k, "monat", m));
  return { alert: ev.filter((r) => r.level === "alert").length, watch: ev.filter((r) => r.level === "watch").length, good: ev.filter((r) => r.kind === "good").length };
};
// The comparison of liquidity with deposits exists only when both figures are in the gold layer.
const COMPARE = K.lcr && K.dep ? ["lcr", "dep"] : null;

// ───────────── Lumina's chart recommendations ─────────────
// Every candidate is generated from the data; the score ranks urgency and explanatory value.
function candidatesFor(scope, m) {
  const out = [], ks = scopeKpis(scope);
  const ev = Object.fromEntries(KPIS.map((k) => [k.id, evaluate(k, "monat", m)]));
  const heat = (r) => (r.level === "alert" ? 3 : r.level === "watch" ? 2 : r.kind === "good" ? 1.6 : 1);
  for (const k of ks) {
    const r = ev[k.id];
    out.push({ id: "trend:" + k.id, kind: "trend", k: k.id, title: `${k.name}: Verlauf${k.reg !== null || k.target !== null ? " gegen " + (k.reg !== null ? "Grenzen" : "Ziel") : ""}`,
      why: r.kind === "good" ? `${k.name}: ${r.label}, ${r.answer.replace(/^[^,]*, /, "")}. Der Verlauf zeigt, wie sich der Wert vom Ziel absetzt.`
        : r.level !== "calm" ? `${k.name}: ${r.label} seit ${PERIODS.monat[streakStart(k, m)].long}. Darum der Verlauf mit Grenzbändern; er zeigt, wann es kippte, nicht warum.`
        : k.reg !== null ? `${k.name} ist ruhig, ${headroom(k, r)} Puffer zum Minimum. Der Verlauf zeigt, ob dieser Abstand schrumpft.`
        : k.target !== null ? `${k.name} ist ruhig und im Ziel. Der Verlauf zeigt, wie stabil das ist.` : `Für ${k.name} ist kein Ziel hinterlegt. Der Verlauf zeigt die Bewegung über die Zeit.`,
      score: 20 * heat(r) + (k.reg !== null ? 6 : 0) });
    if (k.kind === "flow" && k.target !== null) out.push({ id: "cum:" + k.id, kind: "cum", k: k.id, title: `${k.name}: kumuliert im Jahr`, why: "Monatsflüsse schwanken. Kumuliert gegen das Jahresziel sieht man, ob das Jahr noch aufgeht.", score: 23 * heat(r) });
    if (k.parts && !k.funnel && k.partsMode !== "ratio") {
      out.push({ id: "parts:" + k.id, kind: "parts", k: k.id, title: `${k.name}: Zusammensetzung`, why: `${r.why ? r.why + ". " : ""}Die Zusammensetzung zeigt, welcher Teil die Bewegung trägt, nicht die Ursache dahinter.`, score: (r.why ? 25 : 9) * heat(r) });
      out.push({ id: "bridge:" + k.id, kind: "bridge", k: k.id, title: `${k.name}: Brücke über zwölf Monate`, why: m >= 12 ? `Zerlegt die Veränderung seit ${PERIODS.monat[m - 12].long} in ihre Teile.` : "Zerlegt die Veränderung über zwölf Monate in ihre Teile.", score: (r.level !== "calm" ? 21 : 6) * heat(r) });
    }
    if (k.partsMode === "ratio") out.push({ id: "drivers:" + k.id, kind: "drivers", k: k.id, title: `${k.name}: Zähler und Nenner`, why: `${k.name} ist ein Verhältnis. Getrennt sieht man, ob die Reserve sinkt oder die Abflüsse steigen.`, score: (r.level !== "calm" ? 24 : 8) * heat(r) });
    if (k.funnel) out.push({ id: "parts:" + k.id, kind: "parts", k: k.id, title: `${k.name}: nach Stufe`, why: "Was in der Pipeline steht, nach Stufe. Zeigt Volumen, keine Abschlusswahrscheinlichkeit.", score: 17 * heat(r) });
  }
  if (COMPARE && ["all", K.lcr.group, K.dep.group].includes(scope)) out.push({ id: "compare:lcr-dep", kind: "compare", ks: COMPARE, title: `${K.lcr.name} und ${K.dep.name}`, why: "Beide Reihen auf 100 indexiert. Gleichlauf zeigt einen Zusammenhang, keine Ursache.", score: ev.lcr.level !== "calm" ? 44 : 11 });
  return out.sort((a, b) => b.score - a.score);
}
function streakStart(k, m) { let x = m; while (x > 0 && evaluate(k, "monat", x - 1).level !== "calm") x--; return x; }
function headroom(k, r) { const b = (r.cur - k.reg) * k.dir; return k.unit === "%" ? `${b.toFixed(k.dec)} Pp.` : F(k, b); }

// ───────────── What a month needs from you, in one line (pages and the main menu both say it) ─────────────
const NUMWORD = ["Keine", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
const stateOf = (k, m) => evaluate(k, "monat", m);
function headlineFor(m, scope) {
  const rs = scopeKpis(scope).map((k) => stateOf(k, m)), b = rs.filter((r) => r.breach).length, a = rs.filter((r) => r.level === "alert").length, w = rs.filter((r) => r.level === "watch").length;
  if (b) return b === 1 ? "Eine Grenze ist verletzt." : "Mehrere Grenzen sind verletzt.";
  if (a === 1) return "Eine Sache braucht dich.";
  if (a > 1) return `${NUMWORD[a] || a} Dinge brauchen dich.`;
  return w ? "Fast alles ruhig." : "Alles ruhig.";
}
