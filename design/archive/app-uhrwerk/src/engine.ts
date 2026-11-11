// The rules engine: status per figure and period, with regulatory limits,
// internal targets, the SPC trend rule and hysteresis. Pure and cached.
import { F, fdelta, pct, thousands } from "./format";
import { NOUN, PERIODS, mean, scopeKpis, sum, targetAt, valueAt, type Grain, type Kpi, type Period } from "./model";

export type Level = "alert" | "watch" | "notable" | "calm";
export type Kind = "alert" | "watch" | "good" | "info" | "calm";

export interface Eval {
  k: Kpi;
  g: Grain;
  i: number;
  p: Period;
  series: number[];
  cur: number;
  prev: number | null;
  yoy: number | null;
  tgt: number | null;
  lim: number | null;
  mT: number | null;
  mR: number | null;
  z: number;
  level: Level;
  label: string;
  tone: "bad" | "good" | "neutral";
  kind: Kind;
  score: number;
  mag: number;
  breach: boolean;
  ytd: boolean;
  prevNoun: string;
  run: number;
  special: "trend" | "recover" | null;
  delta: string;
  yoyText: string;
  answer: string;
  why: string;
}

export const RUN_NOUN: Record<Grain, string> = { monat: "Monaten", quartal: "Quartalen", jahr: "Jahren" };
const cache = new Map<string, Eval>();

export function evaluate(k: Kpi, g: Grain, i: number): Eval {
  const key = k.id + "|" + g + "|" + i;
  const hit = cache.get(key);
  if (hit) return hit;
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
  // A move counts only if it is material: at least 5 % away from the recent mean.
  if (past.length >= 4 && sd > 1e-9 && !(k.kind === "flow" && p.partial) && Math.abs(cur - mu) / Math.max(Math.abs(mu), 2 * sd) >= 0.05) z = (cur - mu) / sd;
  const tgt = targetAt(k, p), lim = k.limit;
  const mT = tgt !== null && k.dir ? ((cur - tgt) / Math.abs(tgt)) * k.dir : null;
  const mR = lim !== null && k.dir ? ((cur - lim) / Math.abs(lim)) * k.dir : null;
  let level: Level = "calm", label = "Ruhig", tone: Eval["tone"] = "neutral", move = false, breach = false;
  if (mR !== null && mR < 0) { level = "alert"; tone = "bad"; label = "Regulatorisch verletzt"; breach = true; }
  else if (mT !== null && mT < -0.03) { level = "alert"; tone = "bad"; label = k.dir > 0 ? "Unter internem Ziel" : "Über Frühwarnung"; }
  else if (mT !== null && mT < 0) { level = "watch"; tone = "bad"; label = "Knapp verfehlt"; }
  else if (Math.abs(z) >= 2 && k.dir && Math.sign(z) !== k.dir) { level = "watch"; tone = "bad"; label = "Auffällige Bewegung"; move = true; }
  else if (Math.abs(z) >= 2) { level = "notable"; move = true; tone = k.dir ? "good" : "neutral"; label = k.dir ? "Gute Nachricht" : "Ungewöhnlich"; }
  // SPC run rule: six or more consecutive adverse moves are a signal, even inside the limits.
  let run = 0, special: Eval["special"] = null;
  if (k.dir) for (let x = i; x > 0 && run < 36; x--) { if ((series[x] - series[x - 1]) * k.dir < 0) run++; else break; }
  if ((level === "calm" || (level === "notable" && tone !== "good")) && run >= 6) { level = "watch"; tone = "bad"; label = "Anhaltender Trend"; special = "trend"; move = false; }
  // Hysteresis: after an alert, the all-clear needs a 2 % recovery margin, so status does not flicker.
  if (level === "calm" && i > 0 && mT !== null && mT < 0.02 && evaluate(k, g, i - 1).level === "alert") { level = "watch"; tone = "bad"; label = "Erholung, noch knapp"; special = "recover"; }
  const kind: Kind = level === "notable" ? (tone === "good" ? "good" : "info") : level;
  const m = Math.abs(mR !== null && mR < 0 ? mR : mT || 0);
  const score = (breach ? 1600 : 0) + (level === "alert" ? 1000 + m * 100 : level === "watch" ? 600 + (m * 100 || Math.abs(z)) : level === "notable" ? 500 + Math.abs(z) : 100);
  const mag = level === "alert" ? Math.min(1, 0.86 + m * 0.3) : level === "watch" ? 0.6 : level === "notable" ? 0.52 : 0.2;
  const r: Eval = { k, g, i, p, series, cur, prev, yoy, tgt, lim, mT, mR, z, level, label, tone, kind, score: score + (special ? run : 0), mag, breach, ytd, prevNoun, run, special, delta: "", yoyText: "", answer: "", why: "" };
  r.delta = prev !== null ? `${fdelta(k, cur - prev, prev)} ggü. ${prevNoun}` : "";
  r.yoyText = yoy !== null ? `${fdelta(k, cur - yoy, yoy)} ggü. Vorjahr` : "";
  r.answer = answerFor(r, move);
  r.why = (level === "alert" || level === "watch") && i > 0 ? driverFor(r) : "";
  if ((level === "alert" || level === "watch") && run >= 4 && special !== "trend") r.why = (r.why ? r.why + ". " : "") + `Seit ${run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  cache.set(key, r);
  return r;
}

function answerFor(r: Eval, move: boolean) {
  const { k, cur, tgt, lim, level, g, i } = r, v = F(k, cur);
  if (r.special === "trend") return `${v}, seit ${r.run} ${RUN_NOUN[g]} in Folge ${k.dir > 0 ? "rückläufig" : "steigend"}`;
  if (r.special === "recover") return `${v}, wieder im Ziel, aber noch ohne Sicherheitsabstand`;
  if (r.breach && lim !== null) return k.dir > 0 ? `${v}, unter dem regulatorischen Minimum von ${F(k, lim)}` : `${v}, über dem Limit von ${F(k, lim)}`;
  if ((level === "alert" || level === "watch") && !move && tgt !== null) return k.dir > 0 ? `${v}, unter dem internen Ziel von ${F(k, tgt)}` : `${v}, über der Frühwarnschwelle von ${F(k, tgt)}`;
  if (move) {
    const before = r.series.slice(0, -1), up = r.z > 0;
    let j = -1;
    for (let x = before.length - 1; x >= 0; x--) if (up ? before[x] >= cur : before[x] <= cur) { j = x; break; }
    if (j < 0 && before.length >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit Beginn der Reihe ${PERIODS[g][0].y}`;
    if (j >= 0 && i - j >= 4) return `${v}, ${up ? "höchster" : "tiefster"} Wert seit ${PERIODS[g][j].long}`;
    return `${v}, deutlich ${up ? "höher" : "tiefer"} als üblich`;
  }
  if (tgt !== null) return k.dir > 0 ? `${v}, über dem Ziel von ${F(k, tgt)}` : `${v}, unter der Frühwarnschwelle von ${F(k, tgt)}`;
  return r.delta ? `${v}, ${r.delta}` : v;
}

// Names a part only when it clearly explains the deviation.
function driverFor(r: Eval) {
  const { k, g, i } = r;
  if (!k.parts) return "";
  const p = PERIODS[g][i], q = r.ytd ? { from: p.from - 12, to: p.to - 12 } : PERIODS[g][i - 1];
  if (k.partsMode === "ratio") {
    const [num, den] = k.parts;
    const dn = valueAt(k, p, num.series) / valueAt(k, q, num.series) - 1, dd = valueAt(k, p, den.series) / valueAt(k, q, den.series) - 1;
    const top = [{ name: num.name, s: -dn * k.dir, d: dn }, { name: den.name, s: dd * k.dir, d: dd }].sort((a, b) => b.s - a.s)[0];
    return top.s > 0 ? `Grund: ${top.name} ${top.d > 0 ? "+" : "−"}${pct(top.d)}` : "";
  }
  const ch = k.parts.map((part) => { const d = valueAt(k, p, part.series) - valueAt(k, q, part.series); return { name: part.name, d, s: -d * (k.dir || 1) }; }).sort((a, b) => b.s - a.s);
  if (!ch.length || ch[0].s <= 0 || (ch[1] && ch[0].s < 1.5 * Math.max(0, ch[1].s))) return "";
  return `Grund: ${ch[0].name} ${ch[0].d > 0 ? "+" : "−"}${thousands(Math.abs(ch[0].d))} Mio. CHF ggü. ${r.prevNoun}`;
}

export const evalAll = (g: Grain, i: number, scope = "all") => scopeKpis(scope).map((k) => evaluate(k, g, i)).sort((a, b) => b.score - a.score);

export function levelCounts(m: number, scope = "all") {
  const ev = scopeKpis(scope).map((k) => evaluate(k, "monat", m));
  return { alert: ev.filter((r) => r.level === "alert").length, watch: ev.filter((r) => r.level === "watch").length, good: ev.filter((r) => r.kind === "good").length };
}

// First month of the current non-calm streak.
export function streakStart(k: Kpi, m: number) {
  let x = m;
  while (x > 0 && evaluate(k, "monat", x - 1).level !== "calm") x--;
  return x;
}

export function headroom(k: Kpi, r: Eval) {
  if (k.limit === null) return "";
  const b = (r.cur - k.limit) * k.dir;
  return k.unit === "%" ? `${b.toFixed(k.dec)} Pp.` : F(k, b);
}

export const kindOf = (k: Kpi, m: number): Kind => { const r = evaluate(k, "monat", m); return r.kind === "calm" ? "info" : r.kind; };
