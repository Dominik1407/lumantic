// The Go server's JSON API. Numbers come straight from the gold layer.

type Series = (number | null)[];

export interface NamedSeries {
  name: string;
  series: Series;
}

export interface MetricKpi {
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
  limitName?: string;
  targetName?: string;
  desc: string;
  table: string;
  hidden: boolean;
  season: boolean;
  partsMode?: "sum" | "ratio" | "funnel";
  series: Series;
  parts?: NamedSeries[];
  daily?: { series: Series; parts?: NamedSeries[] };
}

export interface MetricsData {
  title: string;
  source: string;
  months: string[];
  days: string[];
  groups: { id: string; name: string }[];
  kpis: MetricKpi[];
  events: { month: number; title: string; text: string }[];
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  metrics: () => request<MetricsData>("GET", "/api/metrics"),
  workspace: () => request<Record<string, unknown>>("GET", "/api/workspace"),
  saveWorkspace: (w: unknown) => request<void>("PUT", "/api/workspace", w),
};
