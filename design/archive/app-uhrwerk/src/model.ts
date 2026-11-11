// The data model: key figures on a shared monthly axis, periods and events.
// Everything is filled once from the API by initModel().
import type { MetricsData } from "./api";

export type Grain = "monat" | "quartal" | "jahr";

export interface Part {
  name: string;
  series: number[];
}

export interface Kpi {
  id: string;
  group: string;
  name: string;
  long: string;
  short: string;
  unit: "%" | "Mio" | "Mrd";
  dec: number;
  kind: "stock" | "flow";
  dir: -1 | 0 | 1;
  limit: number | null;
  target: number | null;
  limitName: string;
  targetName: string;
  desc: string;
  table: string;
  hidden: boolean;
  season: boolean;
  partsMode: "sum" | "ratio" | "funnel" | null;
  series: number[];
  parts: Part[] | null;
  daily: { series: number[]; parts: Part[] | null } | null;
}

export interface Period {
  g: Grain;
  i: number;
  y: number;
  q: number;
  from: number;
  to: number;
  partial: boolean;
  label: string;
  long: string;
}

export interface TimeEvent {
  t: number;
  title: string;
  text: string;
}

export const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const MONTH = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const NOUN: Record<Grain, string> = { jahr: "Vorjahr", quartal: "Vorquartal", monat: "Vormonat" };
export const G_NAME: Record<Grain, string> = { jahr: "Jahr", quartal: "Quartal", monat: "Monat" };

export let TITLE = "";
export let SOURCE = "";
export let N = 0; // months on the axis; month N - 1 is the latest
export let START_Y = 2019;
export let START_M = 0; // calendar month (0-11) of month 0
export let KPIS: Kpi[] = [];
export let K: Record<string, Kpi> = {};
export let GROUPS: { id: string; name: string }[] = [];
export let EVENTS: TimeEvent[] = [];
export let DAYS: string[] = []; // ISO dates with daily values
export let SCOPES: Record<string, string> = {};
export let SLUG: Record<string, string> = {};
export const PERIODS: Record<Grain, Period[]> = { jahr: [], quartal: [], monat: [] };

const num = (s: (number | null)[]) => s.map((v) => (v === null ? NaN : v));
export const slugify = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function initModel(d: MetricsData) {
  TITLE = d.title;
  SOURCE = d.source;
  N = d.months.length;
  const [y0, m0] = d.months[0].split("-").map(Number);
  START_Y = y0;
  START_M = m0 - 1;
  DAYS = d.days;
  GROUPS = d.groups;
  KPIS = d.kpis.map((k) => ({
    ...k,
    limit: k.limit ?? null,
    target: k.target ?? null,
    limitName: k.limitName || (k.dir < 0 ? "Limit" : "Regulatorisches Minimum"),
    targetName: k.targetName || "Internes Ziel",
    partsMode: k.partsMode ?? null,
    series: num(k.series),
    parts: k.parts ? k.parts.map((p) => ({ name: p.name, series: num(p.series) })) : null,
    daily: k.daily ? { series: num(k.daily.series), parts: k.daily.parts ? k.daily.parts.map((p) => ({ name: p.name, series: num(p.series) })) : null } : null,
  }));
  K = Object.fromEntries(KPIS.map((k) => [k.id, k]));
  EVENTS = d.events.map((e) => ({ t: e.month, title: e.title, text: e.text }));
  SCOPES = { all: `${TITLE} gesamt`, ...Object.fromEntries(GROUPS.map((g) => [g.id, g.name])) };
  SLUG = Object.fromEntries(Object.entries(SCOPES).map(([id, name]) => [id, slugify(name)]));
  buildPeriods();
}

export const yearOf = (t: number) => START_Y + Math.floor((t + START_M) / 12);
export const monthOf = (t: number) => (((t + START_M) % 12) + 12) % 12;
export const ym = (y: number, m: number) => (y - START_Y) * 12 + (m - 1) - START_M;
export const monthKey = (t: number) => `${yearOf(t)}-${String(monthOf(t) + 1).padStart(2, "0")}`;
export const monthFromKey = (key: string) => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key);
  return m ? ym(Number(m[1]), Number(m[2])) : NaN;
};

function buildPeriods() {
  for (const g of Object.keys(PERIODS) as Grain[]) PERIODS[g] = [];
  const yEnd = yearOf(N - 1);
  for (let y = START_Y; y <= yEnd; y++) {
    const from = Math.max(0, ym(y, 1)), to = Math.min(ym(y, 12), N - 1);
    const partial = to < ym(y, 12) || ym(y, 1) < 0;
    PERIODS.jahr.push({ g: "jahr", i: 0, y, q: 0, from, to, partial, label: String(y), long: partial ? `${y} bis ${MONTH[monthOf(to)]}` : `${y}` });
    for (let q = 1; q <= 4; q++) {
      const f = ym(y, 3 * q - 2), tt = Math.min(ym(y, 3 * q), N - 1);
      if (f > N - 1 || tt < 0) continue;
      const part = tt < ym(y, 3 * q) || f < 0;
      PERIODS.quartal.push({ g: "quartal", i: 0, y, q, from: Math.max(0, f), to: tt, partial: part, label: `Q${q} ${y}`, long: part ? `Q${q} ${y} bis ${MONTH[monthOf(tt)]}` : `Q${q} ${y}` });
    }
  }
  for (let t = 0; t < N; t++) {
    const m = monthOf(t), y = yearOf(t);
    PERIODS.monat.push({ g: "monat", i: 0, y, q: Math.floor(m / 3) + 1, from: t, to: t, partial: false, label: `${MON[m]} ${y}`, long: `${MONTH[m]} ${y}` });
  }
  for (const g of Object.keys(PERIODS) as Grain[]) PERIODS[g].forEach((p, i) => (p.i = i));
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export const indexOfMonth = (g: Grain, t: number) => PERIODS[g].findIndex((p) => p.from <= t && t <= p.to);
export const monthsIn = (p: { from: number; to: number }) => p.to - p.from + 1;
export const valueAt = (k: Kpi, p: { from: number; to: number }, s: number[] = k.series) => (k.kind === "flow" ? sum(s.slice(p.from, p.to + 1)) : s[p.to]);
export const targetAt = (k: Kpi, p: { from: number; to: number }) => (k.target === null ? null : k.kind === "flow" ? k.target * monthsIn(p) : k.target);
export const scopeKpis = (scope: string) => (scope === "all" ? KPIS : KPIS.filter((k) => k.group === scope));
export const scopeOrder = () => ["all", ...GROUPS.map((g) => g.id)];

// Value at a fractional month, for smooth motion between months.
export function valAt(k: Kpi, t: number, s: number[] = k.series) {
  const a = clamp(Math.floor(t), 0, N - 1), b = Math.min(N - 1, a + 1);
  return lerp(s[a], s[b], clamp(t - a, 0, 1));
}
