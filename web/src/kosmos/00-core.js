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
// and gap[t] says that this month has no data of its own. Such a month is never a signal. Days and weeks use the
// same, except that a flow's missing day counts nothing (zero).
function fillGaps(raw, n = N, zero = false) {
  const out = new Array(n), gap = new Array(n).fill(false);
  let last = null;
  for (let t = 0; t < n; t++) { const v = raw[t]; if (v === null || v === undefined || !Number.isFinite(v)) { gap[t] = true; out[t] = zero ? 0 : last; } else { out[t] = v; last = v; } }
  const first = out.findIndex((v) => v !== null);
  for (let t = 0; t < n; t++) if (out[t] === null) out[t] = first >= 0 ? out[first] : 0;
  return [out, gap];
}
// Days and weeks of a figure that has a daily table: values, gaps and parts, like the months.
function fineOf(d) {
  const out = { dayS: null, dayGap: null, dayParts: null, weekS: null, weekGap: null, weekParts: null }, flow = d.kind === "flow";
  for (const [src, n, s, gap, parts] of [[d.daily, (DATA.days || []).length, "dayS", "dayGap", "dayParts"], [d.weekly, (DATA.weeks || []).length, "weekS", "weekGap", "weekParts"]]) {
    if (!src || !Array.isArray(src.series) || !n) continue;
    [out[s], out[gap]] = fillGaps(src.series, n, flow);
    if (src.parts && src.parts.length) out[parts] = Object.fromEntries(src.parts.map((p) => [p.name, fillGaps(p.series, n, flow || d.partsKind === "flow")[0]]));
  }
  return out;
}
const GROUPS = Object.fromEntries(DATA.groups.map((g) => [g.id, g.name]));
const KPIS = DATA.kpis.map((d) => {
  const [series, gap] = fillGaps(d.series), parts = d.parts && d.parts.length ? Object.fromEntries(d.parts.map((p) => [p.name, fillGaps(p.series)[0]])) : null;
  return { id: d.id, group: d.group, name: d.name, long: d.long || d.name, short: d.short || d.name, unit: d.unit, dec: d.dec || 0, kind: d.kind, dir: d.dir,
    reg: d.limit ?? null, regName: d.limitName || "", target: d.target ?? null, targetName: d.targetName || "", desc: d.desc || "", table: d.table || "",
    // Targets and limits that change over time (a catalog's «gültig ab»): one value per month, null where none applies.
    targets: Array.isArray(d.targets) ? d.targets : null, limits: Array.isArray(d.limits) ? d.limits : null,
    hidden: !!d.hidden, season: !!d.season, series, gap, parts, partsMode: parts ? d.partsMode || "sum" : null, funnel: d.partsMode === "funnel",
    // How the numerator and denominator of a ratio add up over time: balances at the period's end, flows summed.
    partsKind: d.partsKind === "flow" || d.partsKind === "stock" ? d.partsKind : d.kind === "flow" ? "flow" : "stock",
    // An annual budget («jahr»), and whether a flow's target counts every day or Monday to Friday.
    targetPer: d.targetPer || "", dayRule: d.dayRule || "",
    daily: d.daily && Array.isArray(d.daily.series) ? d.daily.series : null, ...fineOf(d) };
});
for (const k of KPIS) k.scale = scaleOf(k);
const K = Object.fromEntries(KPIS.map((k) => [k.id, k]));
// A ratio in its own scale: the LCR in percent is HQLA ÷ outflows × 100. The data says which factor, as the
// median of value ÷ (numerator ÷ denominator), taken as a power of ten when it is close to one.
function scaleOf(k) {
  if (k.partsMode !== "ratio") return 1;
  const [a, b] = Object.values(k.parts), xs = [];
  for (let t = 0; t < N; t++) if (!k.gap[t] && a[t] && b[t]) xs.push(k.series[t] / (a[t] / b[t]));
  if (!xs.length) return 1;
  xs.sort((x, y) => x - y);
  const med = xs[xs.length >> 1], ten = Math.pow(10, Math.round(Math.log10(Math.abs(med) || 1)));
  return Math.abs(med / ten - 1) < 0.02 ? ten : med;
}
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
// Days and weeks: ISO dates, ISO weeks from Monday (2026-W46), the last day the gold layer has.
const WEEKDAY = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEKS = Array.isArray(DATA.weeks) ? DATA.weeks : [];
const LAST_DAY = DAYS.length ? DAYS[DAYS.length - 1] : "";
const isoDay = (iso) => new Date(iso + "T00:00:00Z");
const isoOf = (d) => d.toISOString().slice(0, 10);
const monthIndex = (iso) => clamp(ym(+iso.slice(0, 4), +iso.slice(5, 7)), 0, N - 1);
const longDay = (iso) => { const d = isoDay(iso); return `${d.getUTCDate()}. ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// ───────────── Periods ─────────────
const PERIODS = { jahr: [], quartal: [], monat: [], woche: [], tag: [] };
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
// A day or a week knows its month (mi), so the room's status can follow it. A running week ends on the last day there is.
for (const d of DAYS) PERIODS.tag.push({ g: "tag", from: d, to: d, mi: monthIndex(d), partial: false, label: `${dayLabel(d)} ${d.slice(0, 4)}`, short: dayLabel(d), long: longDay(d) });
for (const w of WEEKS) {
  const n = +w.key.slice(6), y = +w.key.slice(0, 4), partial = w.to > LAST_DAY, end = partial ? LAST_DAY : w.to;
  PERIODS.woche.push({ g: "woche", from: w.from, to: w.to, end, mi: monthIndex(end), partial, label: `KW ${n} ${y}`, short: `KW ${n}`, long: partial ? `KW ${n} ${y} bis ${WEEKDAY[isoDay(end).getUTCDay()]}` : `KW ${n} ${y}` });
}
for (const g of Object.keys(PERIODS)) PERIODS[g].forEach((p, i) => { p.i = i; if (p.mi === undefined) p.mi = p.to; });
const NOUN = { jahr: "Vorjahr", quartal: "Vorquartal", monat: "Vormonat", woche: "Vorwoche", tag: "Vortag" };
const indexOfMonth = (g, t) => PERIODS[g].findIndex((p) => p.from <= t && t <= p.to);
const monthsIn = (p) => p.to - p.from + 1;
// The rasters of the room. A Kosmos judges in its standard raster (DATA.grain, Monat unless set); the person
// may read its pages in another one (G). In months, quarters and years the room's month T.base stands on the last
// month of a period. Days and weeks come from the daily tables only; there the room stands on one of them (AT),
// and T.base is its month. Figures without daily values stay in months and say so.
const GRAINS = ["tag", "woche", "monat", "quartal", "jahr"];
const GRAIN_NAME = { tag: "Tag", woche: "Woche", monat: "Monat", quartal: "Quartal", jahr: "Jahr" };
const fine = (g) => g === "tag" || g === "woche";
const STD = GRAINS.includes(DATA.grain) && !fine(DATA.grain) ? DATA.grain : "monat";
let G = STD, AT = -1;
const IDX = Object.fromEntries(["monat", "quartal", "jahr"].map((g) => [g, Array.from({ length: N }, (_, t) => indexOfMonth(g, t))]));
// The last day or week of month m (the first there is when m lies before them).
function lastIn(m, g = G) { const P = PERIODS[g]; let j = 0; for (let x = 0; x < P.length && P[x].mi <= m; x++) j = x; return j; }
// The last day (or the week) at or before an ISO date.
function atDate(g, iso) { const P = PERIODS[g]; let j = 0; for (let x = 0; x < P.length && P[x].from <= iso; x++) j = x; return j; }
// The period of raster g around month m: in days and weeks the room's own one when m is its month, otherwise the
// last of month m; -1 when m lies before the daily data.
function atOf(m, g = G) {
  if (!fine(g)) return IDX[g][m];
  const P = PERIODS[g];
  if (!P.length || m < P[0].mi) return -1;
  return g === G && AT >= 0 && P[AT] && P[AT].mi === m ? AT : lastIn(m, g);
}
const periodOf = (m, g = G) => (fine(g) ? PERIODS[g][atOf(m, g)] || PERIODS.monat[m] : PERIODS[g][IDX[g][m]]);
// The last month of the period around m (or the last month there is, while it runs). Days and weeks keep their month.
const endOf = (m, g = G) => (fine(g) ? m : periodOf(m, g).to);
// The period d steps away from the one around m, as the month the room then stands on (in days and weeks: d months).
const shiftBy = (m, d, g = G) => (fine(g) ? clamp(m + d, 0, N - 1) : PERIODS[g][clamp(IDX[g][m] + d, 0, PERIODS[g].length - 1)].to);
// The rasters a figure of this Kosmos gives: days and weeks only with daily values.
const hasFine = (k, g = G) => (g === "tag" ? !!k.dayS : g === "woche" ? !!k.weekS : true);
const AVAILABLE = GRAINS.filter((g) => !fine(g) || (PERIODS[g].length > 0 && KPIS.some((k) => hasFine(k, g))));
// Words for the rasters: «diesen Monat», «die drei Quartale», «über dem Vorquartal», «zur Vorwoche».
const THIS = { tag: "diesen Tag", woche: "diese Woche", monat: "diesen Monat", quartal: "dieses Quartal", jahr: "dieses Jahr" };
const PLURAL = { tag: "Tage", woche: "Wochen", monat: "Monate", quartal: "Quartale", jahr: "Jahre" };
const PER_WORD = { tag: "Tages", woche: "Wochen", monat: "Monats", quartal: "Quartals", jahr: "Jahres" };
const ACC = { tag: "den Tag", woche: "die Woche", monat: "den Monat", quartal: "das Quartal", jahr: "das Jahr" };
const AT_THE = { tag: "am Tag", woche: "in der Woche", monat: "im Monat", quartal: "im Quartal", jahr: "im Jahr" };
const PREV = { tag: ["dem Vortag", "zum Vortag"], woche: ["der Vorwoche", "zur Vorwoche"], monat: ["dem Vormonat", "zum Vormonat"], quartal: ["dem Vorquartal", "zum Vorquartal"], jahr: ["dem Vorjahr", "zum Vorjahr"],
  ytd: ["den gleichen Monaten des Vorjahrs", "zu den gleichen Monaten des Vorjahrs"], wtd: ["den gleichen Tagen der Vorwoche", "zu den gleichen Tagen der Vorwoche"] };
const prevOf = (r) => PREV[r.ytd ? (r.g === "woche" ? "wtd" : "ytd") : r.g];
// A period's value by the figure's kind: a balance at its last month, a flow summed, an average over the months
// that have data, a ratio from its numerator and denominator added up by their own kind. Percentages are never averaged.
const span = (s, p) => s.slice(p.from, p.to + 1);
const agg = (kind, s, p) => (kind === "flow" ? sum(span(s, p)) : kind === "avg" ? mean(span(s, p)) : s[p.to]);
function valueAt(k, p) {
  if (p.from === p.to) return k.series[p.to];
  if (k.kind === "ratio" && k.partsMode === "ratio") {
    const [a, b] = Object.values(k.parts), d = agg(k.partsKind, b, p);
    return d ? (agg(k.partsKind, a, p) / d) * k.scale : k.series[p.to];
  }
  if (k.kind === "avg" || k.kind === "ratio") { const own = span(k.series, p).filter((_, j) => !noData(k, p.from + j)); return own.length ? mean(own) : k.series[p.to]; }
  return agg(k.kind, k.series, p);
}
// A part in a period: the parts of a ratio by their own kind, other parts like their figure.
const partAt = (k, p, name) => agg(k.partsMode === "ratio" ? k.partsKind : k.kind === "ratio" ? "avg" : k.kind, k.parts[name], p);
// A period without one month (day, week) of data of its own is a gap.
const gapOf = (k, p) => {
  if (fine(p.g)) return !hasFine(k, p.g) || (p.g === "tag" ? k.dayGap : k.weekGap)[p.i];
  for (let t = p.from; t <= p.to; t++) if (!noData(k, t)) return false;
  return true;
};
// The same days of the week before a running week, and a daily series summed over them.
const weekBefore = (p) => { const a = isoDay(p.from), b = isoDay(p.end); a.setUTCDate(a.getUTCDate() - 7); b.setUTCDate(b.getUTCDate() - 7); return [isoOf(a), isoOf(b)]; };
const sumDays = (s, [a, b]) => (s ? DAYS.reduce((t, d, j) => (d >= a && d <= b ? t + s[j] : t), 0) : null);
// A figure (or one of its parts) as one value per period of a raster.
const SERIES = new Map();
function seriesOf(k, g = G, part = null) {
  if (fine(g)) { const tag = g === "tag"; return part === null ? (tag ? k.dayS : k.weekS) : ((tag ? k.dayParts : k.weekParts) || {})[part] || null; }
  const key = k.id + "|" + g + "|" + (part === null ? "" : part);
  if (!SERIES.has(key)) SERIES.set(key, g === "monat" ? (part === null ? k.series : k.parts[part]) : PERIODS[g].map((p) => (part === null ? valueAt(k, p) : partAt(k, p, part))));
  return SERIES.get(key);
}
// A flow's target for one day: its month's target spread evenly over the month's working days, Monday to
// Friday (the standard), or over all its days. Holidays follow later.
const WORKDAYS = new Map();
function dayTarget(k, iso) {
  const d = isoDay(iso), w = d.getUTCDay(), cal = k.dayRule === "kalendertage";
  if (!cal && (w === 0 || w === 6)) return 0;
  const mt = k.targets ? k.targets[monthIndex(iso)] : k.target;
  if (mt == null) return null;
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), key = y * 12 + mo;
  if (!WORKDAYS.has(key)) { let n = 0; for (let x = 1; x <= len; x++) { const wd = new Date(Date.UTC(y, mo, x)).getUTCDay(); if (wd > 0 && wd < 6) n++; } WORKDAYS.set(key, n); }
  return mt / (cal ? len : WORKDAYS.get(key));
}
function targetAt(k, p) {
  if (fine(p.g)) {
    if (k.kind !== "flow") return k.targets ? k.targets[p.mi] ?? null : k.target;
    // A day's or week's target is the sum of its days, up to the last day there is.
    let s = 0, any = false;
    for (const d = isoDay(p.from), last = p.end || p.to; isoOf(d) <= last; d.setUTCDate(d.getUTCDate() + 1)) { const v = dayTarget(k, isoOf(d)); if (v != null) { s += v; any = true; } }
    return any ? s : null;
  }
  if (k.targets) {
    if (k.kind !== "flow") return k.targets[p.to] ?? null;
    const ts = k.targets.slice(p.from, p.to + 1);
    return ts.every((t) => t == null) ? null : sum(ts.map((t) => t ?? 0));
  }
  return k.target == null ? null : k.kind === "flow" ? k.target * monthsIn(p) : k.target;
}
const regAt = (k, p) => (k.limits ? k.limits[p.mi] ?? null : k.reg);

// ───────────── Format (Swiss) ─────────────
const thousands = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’");
const pct = (d) => { const p = Math.abs(d * 100); return (p < 10 ? String(Number(p.toFixed(1))) : String(Math.round(p))) + " %"; };
// Units: money is kept in Mio. CHF (Mrd only changes how it reads); pieces, days, hours and plain numbers stay as they are.
const UNITS = {
  "%": { full: "%", short: "%" }, Mio: { full: "Mio. CHF", short: "Mio." }, Mrd: { full: "Mrd. CHF", short: "Mrd." }, Tsd: { full: "Tsd. CHF", short: "Tsd." },
  Stk: { full: "Stk.", short: "Stk." }, Tage: { full: "Tage", short: "Tage" }, h: { full: "h", short: "h" }, Zahl: { full: "", short: "" },
};
const unitOf = (k) => UNITS[k.unit] || UNITS.Mio;
// A number with Swiss thousands and the figure's decimals: «1’150», «34.5».
const fixed = (v, dec) => { const [i, f] = Math.abs(v).toFixed(dec || 0).split("."); return thousands(Number(i)) + (f ? "." + f : ""); };
// One day is a «Tag».
const unitWord = (k, v, word) => (k.unit === "Tage" && Math.abs(v) === 1 ? "Tag" : word);
function split(k, v) {
  if (k.unit === "%") return [v.toFixed(k.dec), "%"];
  if (k.unit === "Mrd") return [(v / 1000).toFixed(1), "Mrd. CHF"];
  if (k.unit === "Mio" || !UNITS[k.unit]) return [(v < 0 ? "−" : "") + thousands(Math.abs(v)), "Mio. CHF"];
  return [(v < 0 ? "−" : "") + fixed(v, k.dec), unitWord(k, Number(fixed(v, k.dec).replace(/’/g, "")), unitOf(k).full)];
}
const F = (k, v) => split(k, v).join(" ").trim();
const compact = (k, v) => (k.unit === "%" ? v.toFixed(k.dec) + "%" : k.unit === "Mrd" ? (v / 1000).toFixed(1) + " Mrd" : k.unit === "Mio" || !UNITS[k.unit] ? thousands(v) + " Mio" : (fixed(v, k.dec) + " " + unitOf(k).short).trim());
// A size in the figure's unit, without sign, for distances and moves: «7 Pp.», «92 Mio.», «1.2 Mrd.», «340 Stk.».
function amount(k, a) {
  a = Math.abs(a);
  if (k.unit === "%") return a.toFixed(k.dec) + " Pp.";
  if (k.unit === "Mio" || k.unit === "Mrd" || !UNITS[k.unit]) return a >= 1000 ? (a / 1000).toFixed(1) + " Mrd." : thousands(a) + " Mio.";
  return (fixed(a, k.dec) + " " + unitWord(k, Number(fixed(a, k.dec).replace(/’/g, "")), unitOf(k).short)).trim();
}

// What a figure's target and limit are called: the name its definitions give (Mindestwert, Budget 2026, Risikolimit),
// otherwise the words of an ALCO (internes Ziel, Frühwarnschwelle, regulatorisches Minimum, Limit).
const article = (name) => (/(e|ung|heit|keit|schaft)$/i.test(name) ? "der" : "dem");
const named = (name) => `${article(name)} ${name}`;
function limitWords(k) {
  if (k.regName) return { label: `${k.regName} verletzt`, mark: k.regName, phrase: named(k.regName) };
  return k.dir < 0 ? { label: "Regulatorisch verletzt", mark: "Limit", phrase: "dem Limit" } : { label: "Regulatorisch verletzt", mark: "Minimum", phrase: "dem regulatorischen Minimum" };
}
// A flow's target grows with the raster: «Monatsplan» reads «Quartalsplan» when the room shows quarters.
function targetWords(k, g = G) {
  let name = k.targetName;
  // An annual budget («Budget 2026») is named in years only; a month or a week has its share of it, «Monatsziel».
  if (name && k.kind === "flow" && k.targetPer === "jahr" && g !== "jahr") name = "";
  if (name && k.kind === "flow" && g !== "monat" && name.startsWith("Monats")) name = PER_WORD[g] + name.slice(6);
  if (name) return { label: `${k.dir > 0 ? "Unter" : "Über"} ${name}`, mark: name, phrase: named(name) };
  if (k.kind === "flow") return { label: k.dir > 0 ? "Unter internem Ziel" : "Über Frühwarnung", mark: PER_WORD[g] + "ziel", phrase: `dem ${PER_WORD[g]}ziel` };
  return k.dir < 0 ? { label: "Über Frühwarnung", mark: "Frühwarnung", phrase: "der Frühwarnschwelle" } : { label: "Unter internem Ziel", mark: "Ziel", phrase: "dem internen Ziel" };
}
const arrow = (d) => (d > 0 ? "↑" : d < 0 ? "↓" : "→");
function fdelta(k, d, base) {
  if (k.unit === "%") {
    const p = Math.abs(d), min = Math.pow(10, -(k.dec || 0)) / 2;
    return p < min ? "unverändert" : `${arrow(d)} ${p.toFixed(k.dec)} Pp.`;
  }
  if (k.kind === "flow") return `${arrow(d)} ${F(k, Math.abs(d))}`;
  const rel = d / Math.abs(base);
  return Math.abs(rel) < 0.0005 ? "unverändert" : `${arrow(d)} ${pct(rel)}`;
}

// ───────────── Engine: same rules as the Go server, plus regulatory minimums ─────────────
const evalCache = new Map();
function evaluate(k, g, i) {
  const key = k.id + "|" + g + "|" + i;
  if (evalCache.has(key)) return evalCache.get(key);
  const P = PERIODS[g], p = P[i];
  const series = seriesOf(k, g).slice(0, i + 1);
  const cur = series[i];
  let prev = i > 0 ? series[i - 1] : null, prevNoun = NOUN[g];
  const yi = g === "quartal" ? i - 4 : g === "monat" ? i - 12 : g === "woche" ? i - 52 : -1;
  let yoy = yi >= 0 ? series[yi] : null;
  // A period still running is compared with the same months a year earlier, a running week with the same days of the week before.
  const ytd = k.kind === "flow" && p.partial && (g === "woche" ? i > 0 : p.from >= 12);
  if (ytd && g === "woche") { prev = sumDays(k.dayS, weekBefore(p)); prevNoun = "Vorwoche, gleiche Tage"; }
  else if (ytd) { prev = sum(k.series.slice(p.from - 12, p.to - 11)); prevNoun = "Vorjahr, gleiche Monate"; yoy = null; }
  const past = series.slice(Math.max(0, i - 8), i);
  const mu = mean(past), sd = Math.sqrt(mean(past.map((x) => (x - mu) ** 2)));
  let z = 0;
  if (past.length >= 4 && sd > 1e-9 && !(k.kind === "flow" && p.partial) && Math.abs(cur - mu) / Math.max(Math.abs(mu), 2 * sd) >= 0.05) z = (cur - mu) / sd;
  const tgt = targetAt(k, p), reg = regAt(k, p);
  const mT = tgt != null && k.dir ? ((cur - tgt) / Math.abs(tgt)) * k.dir : null;
  const mR = reg != null && k.dir ? ((cur - reg) / Math.abs(reg)) * k.dir : null;
  let level = "calm", label = "Ruhig", tone = "neutral", move = false, breach = false;
  const gap = gapOf(k, p);
  if (gap) label = "Keine Daten";
  else if (mR !== null && mR < 0) { level = "alert"; tone = "bad"; label = limitWords(k).label; breach = true; }
  else if (mT !== null && mT < -0.03) { level = "alert"; tone = "bad"; label = targetWords(k, g).label; }
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
  r.answer = gap ? `keine Daten für ${THIS[g]}` : answerFor(r, move);
  r.why = (level === "alert" || level === "watch") && i > 0 ? driverFor(r) : "";
  if ((level === "alert" || level === "watch") && run >= 4 && special !== "trend") r.why = (r.why ? r.why + ". " : "") + `Seit ${run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  evalCache.set(key, r);
  return r;
}
const RUN_NOUN = { tag: "Tagen", woche: "Wochen", monat: "Monaten", quartal: "Quartalen", jahr: "Jahren" };
function answerFor(r, move) {
  const { k, cur, tgt, reg, level, g, i } = r, v = F(k, cur);
  if (r.special === "trend") return `${v}, seit ${r.run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  if (r.special === "recover") return `${v}, wieder im Ziel, aber noch ohne Sicherheitsabstand`;
  if (r.breach) return `${v}, ${k.dir > 0 ? "unter" : "über"} ${limitWords(k).phrase} von ${F(k, reg)}`;
  if ((level === "alert" || level === "watch") && !move) return `${v}, ${k.dir > 0 ? "unter" : "über"} ${targetWords(k, g).phrase} von ${F(k, tgt)}`;
  if (move) {
    const before = r.series.slice(0, -1), up = r.z > 0;
    let j = -1;
    for (let x = before.length - 1; x >= 0; x--) if (up ? before[x] >= cur : before[x] <= cur) { j = x; break; }
    if (j < 0 && before.length >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit Beginn der Reihe ${fine(g) ? "am " + PERIODS[g][0].long : START_Y}`;
    if (j >= 0 && i - j >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit ${PERIODS[g][j].long}`;
    return `${v}, deutlich ${up ? "höher" : "tiefer"} als üblich`;
  }
  if (tgt != null) return `${v}, ${k.dir > 0 ? "über" : "unter"} ${targetWords(k, g).phrase} von ${F(k, tgt)}`;
  return r.delta ? `${v}, ${r.delta}` : v;
}
// A part in the period and in the one it is compared with; null where the raster has no parts.
function partPair(k, r, name) {
  const { g, i, p } = r;
  if (fine(g)) { const s = seriesOf(k, g, name); return s ? [s[i], r.ytd ? sumDays((k.dayParts || {})[name], weekBefore(p)) : s[i - 1]] : null; }
  const q = r.ytd ? { from: p.from - 12, to: p.to - 12 } : PERIODS[g][i - 1];
  return [partAt(k, p, name), partAt(k, q, name)];
}
// Names a part only when it clearly explains the deviation.
function driverFor(r) {
  const { k } = r;
  if (!k.parts || Object.keys(k.parts).some((nm) => !partPair(k, r, nm))) return "";
  if (k.partsMode === "ratio") {
    const [num, den] = Object.keys(k.parts), [n1, n0] = partPair(k, r, num), [d1, d0] = partPair(k, r, den);
    const dn = n1 / n0 - 1, dd = d1 / d0 - 1;
    const top = [{ name: num, s: -dn * k.dir, d: dn }, { name: den, s: dd * k.dir, d: dd }].sort((a, b) => b.s - a.s)[0];
    return top.s > 0 ? `Grund: ${top.name} ${top.d > 0 ? "+" : "−"}${pct(top.d)}` : "";
  }
  const ch = Object.keys(k.parts).map((name) => { const [a, b] = partPair(k, r, name), d = a - b; return { name, d, s: -d * (k.dir || 1) }; }).sort((a, b) => b.s - a.s);
  if (!ch.length || ch[0].s <= 0 || (ch[1] && ch[0].s < 1.5 * Math.max(0, ch[1].s))) return "";
  return `Grund: ${ch[0].name} ${ch[0].d > 0 ? "+" : "−"}${F(k, Math.abs(ch[0].d))} ggü. ${r.prevNoun}`;
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
// read: judged in the raster the person reads in (topic pages), not in the Kosmos' standard raster («Heute», menu).
const levelCounts = (m, scope = "all", read = false) => {
  const ev = scopeKpis(scope).map((k) => (read ? shownOf(k, m) : stateOf(k, m)));
  return { alert: ev.filter((r) => r.level === "alert").length, watch: ev.filter((r) => r.level === "watch").length, good: ev.filter((r) => r.kind === "good").length };
};
// The comparison of liquidity with deposits exists only when both figures are in the gold layer.
const COMPARE = K.lcr && K.dep ? ["lcr", "dep"] : null;

// ───────────── Lumina's chart recommendations ─────────────
// Every candidate is generated from the data; the score ranks urgency and explanatory value.
function candidatesFor(scope, m) {
  const out = [], ks = scopeKpis(scope);
  const ev = Object.fromEntries(KPIS.map((k) => [k.id, shownOf(k, m)]));
  const heat = (r) => (r.level === "alert" ? 3 : r.level === "watch" ? 2 : r.kind === "good" ? 1.6 : 1);
  for (const k of ks) {
    const r = ev[k.id];
    out.push({ id: "trend:" + k.id, kind: "trend", k: k.id, title: `${k.name}: Verlauf${k.reg !== null || k.target !== null ? " gegen " + (k.reg !== null ? "Grenzen" : "Ziel") : ""}`,
      why: r.kind === "good" ? `${k.name}: ${r.label}, ${r.answer.replace(/^[^,]*, /, "")}. Der Verlauf zeigt, wie sich der Wert vom Ziel absetzt.`
        : r.level !== "calm" ? `${k.name}: ${r.label} seit ${since(streakStart(k, m))}. Darum der Verlauf mit Grenzbändern; er zeigt, wann es kippte, nicht warum.`
        : k.reg !== null ? `${k.name} ist ruhig, ${headroom(k, r)} Puffer ${article(limitWords(k).mark) === "der" ? "zur" : "zum"} ${limitWords(k).mark}. Der Verlauf zeigt, ob dieser Abstand schrumpft.`
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
const since = (p) => (p.partial ? p.label : p.long);
function streakStart(k, m) { const [g, i] = placeOf(k, m); let x = i; while (x > 0 && evaluate(k, g, x - 1).level !== "calm") x--; return PERIODS[g][x]; }
function headroom(k, r) { const b = (r.cur - k.reg) * k.dir; return k.unit === "%" ? `${b.toFixed(k.dec)} Pp.` : F(k, b); }

// ───────────── What a month needs from you, in one line (pages and the main menu both say it) ─────────────
const NUMWORD = ["Keine", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
// The status of a figure is judged in the Kosmos' standard raster, so it does not change when someone reads in
// another one; what a block says follows the raster the person chose.
const stateOf = (k, m) => evaluate(k, STD, IDX[STD][m]);
// Where a block reads figure k at month m: the raster and the period in it. A figure without daily values, or a
// month before them, stays in months.
function placeOf(k, m) {
  if (!fine(G)) return [G, IDX[G][m]];
  const i = hasFine(k) ? atOf(m) : -1;
  return i < 0 ? ["monat", m] : [G, i];
}
const shownOf = (k, m) => { const [g, i] = placeOf(k, m); return evaluate(k, g, i); };
function headlineFor(m, scope, read = false) {
  const rs = scopeKpis(scope).map((k) => (read ? shownOf(k, m) : stateOf(k, m))), b = rs.filter((r) => r.breach).length, a = rs.filter((r) => r.level === "alert").length, w = rs.filter((r) => r.level === "watch").length;
  if (b) return b === 1 ? "Eine Grenze ist verletzt." : "Mehrere Grenzen sind verletzt.";
  if (a === 1) return "Eine Sache braucht dich.";
  if (a > 1) return `${NUMWORD[a] || a} Dinge brauchen dich.`;
  return w ? "Fast alles ruhig." : "Alles ruhig.";
}
