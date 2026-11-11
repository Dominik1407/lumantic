// Swiss number and date formatting: 1’250 Mio. CHF, 16.3 %, 9.11.2026.
import { MONTH, type Kpi } from "./model";

export const thousands = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’");
export const pct = (d: number) => {
  const p = Math.abs(d * 100);
  return (p < 10 ? String(Number(p.toFixed(1))) : String(Math.round(p))) + " %";
};
const minus = (v: number) => (v < 0 ? "−" : "");

export function split(k: Kpi, v: number): [string, string] {
  if (k.unit === "%") return [minus(v) + Math.abs(v).toFixed(k.dec), "%"];
  if (k.unit === "Mrd") return [minus(v) + (Math.abs(v) / 1000).toFixed(1), "Mrd. CHF"];
  return [minus(v) + thousands(Math.abs(v)), "Mio. CHF"];
}
export const F = (k: Kpi, v: number) => split(k, v).join(" ");
export const compact = (k: Kpi, v: number) =>
  k.unit === "%" ? v.toFixed(k.dec) + "%" : k.unit === "Mrd" ? (v / 1000).toFixed(1) + " Mrd" : minus(v) + thousands(Math.abs(v)) + " Mio";
export const arrow = (d: number) => (d > 0 ? "↑" : d < 0 ? "↓" : "→");

export function fdelta(k: Kpi, d: number, base: number) {
  if (k.unit === "%") {
    const p = Math.abs(d), min = Math.pow(10, -(k.dec || 0)) / 2;
    return p < min ? "unverändert" : `${arrow(d)} ${p.toFixed(k.dec)} Pp.`;
  }
  if (k.kind === "flow") return `${arrow(d)} ${thousands(Math.abs(d))} Mio. CHF`;
  const rel = d / Math.abs(base);
  return Math.abs(rel) < 0.0005 ? "unverändert" : `${arrow(d)} ${pct(rel)}`;
}

// Daily deltas need one more decimal: a day moves LCR by tenths, not points.
export function fdeltaDay(k: Kpi, d: number, base: number) {
  if (k.unit === "%") return Math.abs(d) < 0.05 ? "unverändert" : `${arrow(d)} ${Math.abs(d).toFixed(1)} Pp.`;
  if (k.kind === "flow") return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} Mio. CHF`;
  const rel = d / Math.abs(base);
  return Math.abs(rel) < 0.00005 ? "unverändert" : `${arrow(d)} ${(Math.abs(rel) * 100).toFixed(2)} %`;
}

const WEEKDAY = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const parseDay = (iso: string) => new Date(iso + "T00:00:00Z");
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const dayShort = (iso: string) => { const d = parseDay(iso); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
export const dayLong = (d: Date) => `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const dayMid = (iso: string) => { const d = parseDay(iso); return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTH[d.getUTCMonth()]}`; };

// Business days (Monday to Friday) of a calendar month; holidays are not modelled.
export function businessDaysIn(year: number, month0: number) {
  let n = 0;
  for (let d = new Date(Date.UTC(year, month0, 1)); d.getUTCMonth() === month0; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6 !== 0) n++;
  return n;
}
