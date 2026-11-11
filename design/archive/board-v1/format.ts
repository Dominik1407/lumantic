// Number and date formatting, matching the server (internal/engine/text.go).

function thousands(v: number): string {
  const s = Math.abs(Math.round(v)).toString();
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return v < 0 && Math.round(v) !== 0 ? "−" + grouped : grouped;
}

function decimal(v: number, prec: number): string {
  return Number(v.toFixed(prec)).toString();
}

export function fmtValue(v: number, unit: string): string {
  switch (unit) {
    case "CHF":
    case "EUR":
      return Math.abs(v) >= 1e6 ? `${decimal(v / 1e6, 1)} Mio. ${unit}` : `${thousands(v)} ${unit}`;
    case "Mio. CHF":
    case "Mio. EUR":
      return `${decimal(v / 1e6, 1)} ${unit}`;
    case "von 10":
    case "Min.":
      return `${v.toFixed(1)} ${unit}`;
  }
  return Number.isInteger(v) || Math.abs(v) >= 100 ? thousands(v) : decimal(v, 1);
}

/** ISO week number of a YYYY-MM-DD date. */
export function isoWeek(date: string): number {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 864e5 + 1) / 7);
}

export const weekLabel = (date: string) => `KW ${isoWeek(date)}`;

/** budget_chf -> Budget */
export function vsName(col?: string): string {
  if (!col) return "";
  const base = col.split("_")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}
