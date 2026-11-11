// Lumina, rule-based: the sentence for a moment, and chart recommendations
// generated from the data, ranked by urgency and explanatory value.
import { h } from "./dom";
import { evaluate, headroom, streakStart, type Eval } from "./engine";
import { DAYS, K, KPIS, MONTH, N, PERIODS, scopeKpis, type Kpi } from "./model";
import { parseDay } from "./format";
import { W } from "./workspace";

export function briefParts(m: number, scope: string, onName: (k: Kpi) => void): (Node | string)[] {
  const ev = scopeKpis(scope).map((k) => evaluate(k, "monat", m)).sort((a, b) => b.score - a.score);
  const alerts = ev.filter((r) => r.level === "alert"), watches = ev.filter((r) => r.level === "watch"), goods = ev.filter((r) => r.kind === "good");
  const breach = alerts.filter((r) => r.breach);
  const name = (r: Eval) => h("button", { class: "name" + (r.level === "alert" ? " name--alert" : ""), type: "button", onclick: () => onName(r.k) }, r.k.name);
  const join = (rs: Eval[]) => rs.flatMap((r, n) => (n === 0 ? [name(r)] : [n === rs.length - 1 ? " und " : ", ", name(r)]));
  const words = ["", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs"];
  let p: (Node | string)[];
  if (breach.length) p = ["Regulatorische Grenze verletzt: ", ...join(breach), ". Das hat Vorrang."];
  else if (!alerts.length && !watches.length) p = ["Alles ruhig. ", ...(goods.length ? ["Gute Nachricht: ", ...join(goods), "."] : ["Nichts braucht dich."])];
  else if (!alerts.length) p = ["Fast alles ruhig. Behalte ", ...join(watches), " im Auge."];
  else if (alerts.length === 1 && !watches.length) p = ["Ruhige Lage. Nur eine Sache braucht dich: ", name(alerts[0]), "."];
  else if (alerts.length === 1) p = ["Eine Sache braucht dich: ", name(alerts[0]), ". Im Auge behalten: ", ...join(watches), "."];
  else p = [`${words[alerts.length] || alerts.length} Dinge brauchen dich: `, ...join(alerts), ".", ...(watches.length ? [" Im Auge behalten: ", ...join(watches), "."] : [])];
  if (!breach.length && (alerts.length || watches.length) && goods.length) p.push(" Gute Nachricht: ", ...join(goods), ".");
  return glue(p);
}

// A name button and the punctuation right after it stay on one line.
function glue(parts: (Node | string)[]) {
  const out: (Node | string)[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i], next = parts[i + 1];
    const m = typeof next === "string" ? /^[.,:;]+/.exec(next) : null;
    if (cur instanceof Node && m) {
      out.push(h("span", { class: "nowrap" }, cur, m[0]));
      const rest = (next as string).slice(m[0].length);
      if (rest) out.push(rest);
      i++;
    } else out.push(cur);
  }
  return out;
}

export type ChartKind = "trend" | "cum" | "parts" | "bridge" | "drivers" | "funnel" | "season" | "buffer" | "compare" | "daily";

export interface Candidate {
  id: string;
  kind: ChartKind;
  k?: string;
  ks?: string[];
  title: string;
  why: string;
  score: number;
  types: string[];
  ranges: string[];
  type?: string;
  range?: string;
}

const heat = (r: Eval) => (r.level === "alert" ? 3 : r.level === "watch" ? 2 : r.kind === "good" ? 1.6 : 1);

export function candidatesFor(scope: string, m: number): Candidate[] {
  const out: Candidate[] = [], ks = scopeKpis(scope);
  const ev = Object.fromEntries(KPIS.map((k) => [k.id, evaluate(k, "monat", m)]));
  for (const k of ks) {
    const r = ev[k.id], limits = k.limit !== null || k.target !== null;
    out.push({
      id: "trend:" + k.id, kind: "trend", k: k.id,
      title: `${k.name}: Verlauf${limits ? " gegen " + (k.limit !== null ? "Grenzen" : "Ziel") : ""}`,
      why: r.kind === "good" ? `${k.name}: ${r.label}, ${r.answer.replace(/^[^,]*, /, "")}. Der Verlauf zeigt, wie sich der Wert vom Ziel absetzt.`
        : r.level !== "calm" ? `${k.name}: ${r.label} seit ${PERIODS.monat[streakStart(k, m)].long}. Darum der Verlauf mit Grenzbändern; er zeigt, wann es kippte, nicht warum.`
        : k.limit !== null ? `${k.name} ist ruhig, ${headroom(k, r)} Puffer zum ${k.dir < 0 ? "Limit" : "Minimum"}. Der Verlauf zeigt, ob dieser Abstand schrumpft.`
        : k.target !== null ? `${k.name} ist ruhig und im Ziel. Der Verlauf zeigt, wie stabil das ist.` : `Für ${k.name} ist kein Ziel hinterlegt. Der Verlauf zeigt die Bewegung über die Zeit.`,
      score: 20 * heat(r) + (k.limit !== null ? 6 : 0),
      types: k.kind === "flow" ? ["balken", "linie"] : ["flaeche", "linie", "balken"], ranges: ["1J", "3J", "Alles"], range: "3J", type: k.kind === "flow" ? "balken" : "flaeche",
    });
    // Daily values exist only for the running month: offered while the cursor is on today.
    if (k.daily && m === N - 1 && DAYS.length) {
      const first = parseDay(DAYS[0]);
      out.push({ id: "daily:" + k.id, kind: "daily", k: k.id, title: `${k.name}: Tageswerte`,
        why: `Die Tageswerte seit ${MONTH[first.getUTCMonth()]} zeigen, wie der laufende Monat läuft. Sie sind vorläufig bis zum Monatsabschluss.`,
        score: 22 * heat(r), types: [], ranges: [] });
    }
    if (k.kind === "flow" && k.target !== null) out.push({ id: "cum:" + k.id, kind: "cum", k: k.id, title: `${k.name}: kumuliert im Jahr`, why: "Monatsflüsse schwanken. Kumuliert gegen das Jahresziel sieht man, ob das Jahr noch aufgeht.", score: 23 * heat(r), types: [], ranges: [] });
    if (k.parts && k.partsMode === "sum") {
      out.push({ id: "parts:" + k.id, kind: "parts", k: k.id, title: `${k.name}: Zusammensetzung`, why: `${r.why ? r.why + ". " : ""}Die Zusammensetzung zeigt, welcher Teil die Bewegung trägt, nicht die Ursache dahinter.`,
        score: (r.why ? 25 : 9) * heat(r), types: k.kind === "flow" ? ["balken"] : ["flaeche", "anteile"], ranges: ["1J", "3J", "Alles"], range: "3J", type: k.kind === "flow" ? "balken" : "flaeche" });
      out.push({ id: "bridge:" + k.id, kind: "bridge", k: k.id, title: `${k.name}: Brücke über zwölf Monate`, why: m >= 12 ? `Zerlegt die Veränderung seit ${PERIODS.monat[m - 12].long} in ihre Teile.` : "Zerlegt die Veränderung über zwölf Monate in ihre Teile.", score: (r.level !== "calm" ? 21 : 6) * heat(r), types: [], ranges: [] });
    }
    if (k.parts && k.partsMode === "ratio") out.push({ id: "drivers:" + k.id, kind: "drivers", k: k.id, title: `${k.name}: Zähler und Nenner`, why: `${k.name} ist ein Verhältnis. Getrennt sieht man, ob die Reserve sinkt oder die Abflüsse steigen.`, score: (r.level !== "calm" ? 24 : 8) * heat(r), types: [], ranges: ["1J", "3J", "Alles"], range: "3J" });
    if (k.parts && k.partsMode === "funnel") out.push({ id: "funnel:" + k.id, kind: "funnel", k: k.id, title: `${k.name}: nach Stufe`, why: "Was in der Pipeline steht, nach Stufe. Zeigt Volumen, keine Abschlusswahrscheinlichkeit.", score: 17 * heat(r), types: [], ranges: [] });
    if (k.season) out.push({ id: "season:" + k.id, kind: "season", k: k.id, title: `${k.name}: Saisonmuster`, why: "Jedes Jahr eine Zeile. So sieht man, ob ein Monat typisch ist oder heraussticht.", score: 9 * heat(r), types: [], ranges: [] });
  }
  const limitKs = ks.filter((k) => k.limit !== null && k.dir);
  if (limitKs.length) {
    const room = (k: Kpi) => ((ev[k.id].cur - (k.limit as number)) * k.dir) / Math.abs(k.limit as number);
    const tight = [...limitKs].sort((a, b) => room(a) - room(b))[0];
    out.push({ id: "buffer:" + scope, kind: "buffer", ks: limitKs.map((k) => k.id), title: "Puffer zu den Grenzen", why: `Abstand jeder Quote zu Minimum und Ziel. Am wenigsten Puffer hat gerade ${tight.name}.`, score: 26 + 12 * Math.max(...limitKs.map((k) => heat(ev[k.id]))), types: [], ranges: [] });
  }
  if (K.lcr && K.dep && ["all", K.lcr.group, K.dep.group].includes(scope)) out.push({ id: "compare:lcr-dep", kind: "compare", ks: ["lcr", "dep"], title: `${K.lcr.name} und ${K.dep.name}`, why: "Beide Reihen auf 100 indexiert. Gleichlauf zeigt einen Zusammenhang, keine Ursache.", score: ev.lcr.level !== "calm" ? 44 : 11, types: [], ranges: ["3J", "Alles"], range: "Alles" });
  return out.sort((a, b) => b.score - a.score);
}

const SIZES_BY_RANK = ["L", "S", "M", "M", "S", "S", "S", "M"];

// Lumina's preselection for a dashboard; the person can change all of it.
export function lumaSelect(scope: string, m: number) {
  const cands = candidatesFor(scope, m);
  const sel = cands.slice(0, scope === "all" ? 6 : 5).map((c) => c.id);
  const size: Record<string, string> = {};
  sel.forEach((id, i) => { size[id] = id.startsWith("buffer:") && scope === "all" ? "L" : SIZES_BY_RANK[i]; });
  W.dash[scope] = { sel, size, type: {}, range: {}, custom: false };
}
