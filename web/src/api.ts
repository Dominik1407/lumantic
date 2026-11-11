// The Go server's JSON API (internal/server). Numbers come straight from the gold layer.
// A Kosmos is one room over one data source. Everything about a Kosmos (figures, pages, source, key figures) is asked
// with ?k=<id>; setKosmos says once which one this page is in. Designs, Lumina and the brand are shared by all.

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

export interface UiPrefs {
  design: string;
  font: string;
  accent: string;
  motion: "voll" | "ruhig";
  textSize: "normal" | "gross";
  start: "heute" | "ueberblick" | "zuletzt";
  lens: "1M" | "1Q" | "1J";
  hints: boolean;
}

export interface SecretState { set: boolean; hint: string; source: "datei" | "umgebung" | "" }

export type SecretKey = "anthropicToken" | "windmillToken" | "snowflakeToken" | "databricksToken" | "databricksSecret";
// Secrets of a warehouse belong to one Kosmos; the others are shared.
export type SourceSecrets = Partial<Record<"snowflakeToken" | "databricksToken" | "databricksSecret", string>>;

export interface DataSource {
  type: "duckdb" | "files" | "snowflake" | "databricks" | "windmill";
  name: string;
  path: string;
  schema: string;
  duckdb: string;
  snowflake: { account: string; user: string; role: string; warehouse: string; database: string; auth: "keypair" | "token"; keyFile: string; token?: SecretState };
  databricks: { host: string; warehouse: string; catalog: string; auth: "oauth" | "token"; clientId: string; token?: SecretState; secret?: SecretState };
  windmill: { url: string; workspace: string; describe: string; query: string; token?: SecretState };
}

export interface SourceStatus {
  ok: boolean; error: string; tables: number; kpis: number; kpisLoaded: number; months: number; first: string; last: string; refreshedAt: string;
  until?: string; // the newest day (or month) with data
  by?: string; // what started the last read: start, hand, anstoss, zeitplan, aenderung
  ms?: number;
  refreshing?: boolean;
  next?: string; // the next time on the schedule
}

// When a Kosmos is read again by itself, and the token a loading job uses to say there is new data.
export interface RefreshPlan { daily: string[]; watch: number; own: boolean; watchable: boolean; token: SecretState }
// What the server says when it has read a Kosmos again (GET /api/events).
export interface RefreshEvent { kosmos: string; ok: boolean; changed: boolean; at: string; by: string }

export interface CorporateDesign {
  id: string;
  name: string;
  base: string;
  colors: Record<string, string>;
  fonts?: { text?: string; ui?: string; mono?: string };
  fontFiles?: { family: string; file: string; weight?: string; style?: string }[];
}

// One entry of the main menu.
export interface KosmosInfo { id: string; name: string; type: DataSource["type"]; main: boolean; status: SourceStatus }

export interface Settings {
  version: string;
  configPath: string;
  configExists: boolean;
  locked: string[];
  ui: Partial<UiPrefs>;
  kosmos: { id: string; main: boolean; count: number }; // the Kosmos data, metrics and status are about
  metrics: string; // the key figure file, "" for the built-in definitions
  data: DataSource;
  status: SourceStatus;
  refresh: RefreshPlan;
  ai: { enabled: boolean; provider: string; model: string; baseURL: string; token: SecretState; models: { id: string; name: string; note: string }[]; ready: boolean };
  brand: { name: string; logo: string; logoDark?: string; designs: CorporateDesign[] };
}

export interface TestResult {
  ok: boolean;
  error: string;
  tables: { name: string; time: string; rows: number; columns: { name: string; type: string; role: string }[] }[];
}

export interface KpiDef {
  id: string; name: string; long?: string; desc?: string; unit: "%" | "Mio" | "Mrd"; dec: number; kind: "stock" | "flow"; dir: -1 | 0 | 1;
  target: number | null; limit: number | null; targetName?: string; limitName?: string; group: string; groupName?: string;
  monthly: { table: string; value: string }; status?: string;
}

export interface KpiList { file: string; builtIn: boolean; groups: { id: string; name: string }[]; kpis: KpiDef[] }

export interface Catalog { source: string; dialect: string; tables: { name: string; desc: string; columns: { name: string; type: string; role: string }[] }[] }

export interface AskReply { answer: string; blocks: { figure: string; view: string; month: string }[]; model: string; ms: number }

// A failed request carries the HTTP status and the server's German sentence.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Der Server antwortet nicht.");
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// The Kosmos this page is in; "" is the first one (and the main menu, which is in none).
let here = "";
export const MAIN = "main";
export function setKosmos(id: string) { here = id === MAIN ? "" : id; }
const at = (path: string, id = here) => (id && id !== MAIN ? `${path}?k=${encodeURIComponent(id)}` : path);

export const api = {
  // All Kosmen
  kosmen: () => request<{ kosmen: KosmosInfo[] }>("GET", "/api/kosmen").then((r) => r.kosmen),
  addKosmos: (data: Partial<DataSource>, secrets: SourceSecrets = {}) => request<KosmosInfo>("POST", "/api/kosmen", { data, secrets }),
  removeKosmos: (id: string) => request<void>("DELETE", `/api/kosmen/${encodeURIComponent(id)}`),
  metricsOf: (id: string) => request<MetricsData>("GET", at("/api/metrics", id)),
  // This Kosmos
  metrics: () => request<MetricsData>("GET", at("/api/metrics")),
  workspace: () => request<Record<string, unknown>>("GET", at("/api/workspace")),
  saveWorkspace: (w: unknown) => request<void>("PUT", at("/api/workspace"), w),
  settings: () => request<Settings>("GET", at("/api/settings")),
  saveSettings: (patch: Partial<{ ui: Partial<UiPrefs>; data: Partial<DataSource>; ai: Partial<Settings["ai"]>; refresh: { daily: string[]; watch: number } | null }>) => request<Settings>("PUT", at("/api/settings"), patch),
  // Tokens typed in for the test go along as secrets; the server uses them once and keeps nothing.
  testData: (data: Partial<DataSource>, secrets: SourceSecrets = {}) => request<TestResult>("POST", at("/api/settings/data/test"), { ...data, secrets }),
  refresh: () => request<SourceStatus>("POST", at("/api/refresh"), {}),
  // A new token for loading jobs; the answer is the only time it is shown.
  refreshToken: () => request<{ token: string; state: SecretState }>("POST", at("/api/refresh/token"), {}),
  removeRefreshToken: () => request<void>("DELETE", at("/api/refresh/token")),
  kpis: () => request<KpiList>("GET", at("/api/kpis")),
  addKpi: (def: KpiDef) => request<KpiDef>("POST", at("/api/kpis"), def),
  // A partial merge on the server: only the fields sent change, null clears a target or limit.
  updateKpi: (id: string, patch: Partial<KpiDef>) => request<KpiDef>("PUT", at(`/api/kpis/${encodeURIComponent(id)}`), patch),
  removeKpi: (id: string) => request<void>("DELETE", at(`/api/kpis/${encodeURIComponent(id)}`)),
  catalog: () => request<Catalog>("GET", at("/api/catalog")),
  // Shared by all Kosmen. The first Kosmos's workspace document also carries the personal settings.
  sharedWorkspace: () => request<Record<string, unknown>>("GET", "/api/workspace"),
  saveSharedWorkspace: (w: unknown) => request<void>("PUT", "/api/workspace", w),
  setSecret: (key: SecretKey, value: string) => request<SecretState>("PUT", at("/api/settings/secret"), { key, value }),
  testAI: () => request<{ ok: boolean; model: string; ms: number; error: string }>("POST", "/api/settings/ai/test", {}),
  ask: (question: string, month: string, facts: unknown) => request<AskReply>("POST", "/api/lumina/ask", { question, month, facts }),
};
