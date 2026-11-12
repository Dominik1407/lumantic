// The Go server's JSON API (internal/server). Numbers come straight from the gold layer.
// A Kosmos is one room over one data source. Everything about a Kosmos (figures, pages, source, key figures) is asked
// with ?k=<id>; setKosmos says once which one this page is in. Designs, Lumina and the brand are shared by all.
import { LANG, tr } from "./i18n";


type Series = (number | null)[];

export interface NamedSeries {
  name: string;
  series: Series;
}

// How a figure adds up to a quarter or a year: at its end, summed, averaged, or from numerator and denominator.
export type Kind = "stock" | "flow" | "avg" | "ratio";
// The rasters a Kosmos reads its figures in.
export type Grain = "monat" | "quartal" | "jahr";

export interface MetricKpi {
  id: string;
  group: string;
  name: string;
  long: string;
  short: string;
  unit: Unit;
  dec: number;
  kind: Kind;
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
  partsKind?: "stock" | "flow";
  targetPer?: "monat" | "jahr";
  dayRule?: "kalendertage";
  series: Series;
  parts?: NamedSeries[];
  daily?: { series: Series; parts?: NamedSeries[] };
  weekly?: { series: Series; parts?: NamedSeries[] };
}

export interface MetricsData {
  title: string;
  source: string;
  months: string[];
  days: string[];
  weeks?: { key: string; from: string; to: string }[]; // ISO weeks, from the daily data
  groups: { id: string; name: string }[];
  kpis: MetricKpi[];
  events: { month: number; title: string; text: string }[];
}

export interface UiPrefs {
  language: "" | "de" | "en"; // "" = the browser's
  design: string;
  font: string;
  accent: string;
  motion: "voll" | "ruhig";
  textSize: "normal" | "gross";
  start: "heute" | "ueberblick" | "zuletzt";
  lens: "1M" | "1Q" | "1J";
  hints: boolean;
}

// "%" and money in Mio. CHF (shown as Mrd. CHF with "Mrd"), or pieces, days, hours, thousands of CHF, plain numbers.
export type Unit = "%" | "Mio" | "Mrd" | "Tsd" | "Stk" | "Tage" | "h" | "Zahl";

export interface SecretState { set: boolean; hint: string; source: "datei" | "umgebung" | "" }

export type SecretKey = "anthropicToken" | "windmillToken" | "snowflakeToken" | "databricksToken" | "databricksSecret";
// Secrets of a warehouse belong to one Kosmos; the others are shared.
export type SourceSecrets = Partial<Record<"snowflakeToken" | "databricksToken" | "databricksSecret", string>>;

export interface DataSource {
  example?: boolean; // the examples Lumantic writes itself
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

// Who is signed in and what they may change. Without a login everyone is «Lokal» and may do it all.
export interface Me {
  id: string; name: string; email?: string; groups: string[];
  admin: boolean; // changes data sources, Lumina and Kosmen
  editor: boolean; // looks after the key figures of the Kosmos at hand
  login: "none" | "proxy" | "oidc";
  logout: string;
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
  duckdbBuiltIn?: boolean; // DuckDB is in the program; a path to the CLI is optional
  examplesOnly?: boolean; // open to others without a login, so only the examples
  locked: string[];
  ui: Partial<UiPrefs>;
  kosmos: { id: string; main: boolean; count: number }; // the Kosmos data, metrics and status are about
  metrics: string; // the key figure file, "" for the built-in definitions
  data: DataSource;
  status: SourceStatus;
  refresh: RefreshPlan;
  grain: Grain; // the standard raster: «Heute» and the main menu judge in it
  me?: Me;
  ai: { enabled: boolean; provider: string; model: string; baseURL: string; token: SecretState; models: { id: string; name: string; note: string }[]; ready: boolean };
  brand: { name: string; logo: string; logoDark?: string; designs: CorporateDesign[] };
}

export interface TestResult {
  ok: boolean;
  error: string;
  tables: { name: string; time: string; rows: number; columns: { name: string; type: string; role: string }[] }[];
}

export interface KpiDef {
  id: string; name: string; long?: string; desc?: string; unit: Unit; dec: number; kind: Kind; dir: -1 | 0 | 1;
  origin?: "quelle"; // from the company catalog in the source: changed there, added to in the Sternkatalog
  target: number | null; limit: number | null; targetName?: string; limitName?: string; group: string; groupName?: string;
  monthly: { table: string; value: string }; status?: string;
  en?: Record<string, string>; // the English words of the definition: name, short, long, desc …
}

export interface KpiList { file: string; builtIn: boolean; groups: { id: string; name: string; en?: Record<string, string> }[]; kpis: KpiDef[] }

export interface Catalog { source: string; dialect: string; tables: { name: string; desc: string; columns: { name: string; type: string; role: string }[] }[] }

// The Sternkatalog of a Kosmos (GET /api/katalog): each field with where it comes from.
export type Origin = "quelle" | "lumantic" | "vermutet";
export interface KatalogField { value: unknown; from: Origin }
export interface KatalogBound { kind: "ziel" | "grenze"; value: number; name?: string; from?: string; until?: string; per?: "monat" | "jahr"; origin?: string }
export interface KatalogEntry { id: string; name: string; topic: string; fields: Record<string, KatalogField>; bounds: KatalogBound[]; status: string; first: string; last: string }
export interface KatalogTerm { term: string; definition: string; synonyms?: string[]; kpi?: string; origin?: string; en?: { term?: string; definition?: string } }
export interface Katalog {
  kosmos: string; name: string; company: string; problems: string[]; editable: boolean;
  entries: KatalogEntry[]; topics: { id: string; name: string }[]; terms: KatalogTerm[];
  tables: { name: string; desc: string; columns: { name: string; type: string; role: string; desc?: string; values?: string[] }[] }[];
}

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
      // The server answers in the language of the interface: its messages, and Lumina.
      headers: body === undefined ? { "Accept-Language": LANG } : { "Content-Type": "application/json", "Accept-Language": LANG },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, tr("Der Server antwortet nicht.", "The server does not answer."));
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`, login = "";
    try { const b = await res.json(); msg = b.error || msg; login = b.login || ""; } catch { /* not JSON */ }
    // The login ran out: off to sign in again, and back to this page afterwards.
    if (res.status === 401 && login) {
      const u = new URL(login, location.href);
      u.searchParams.set("next", location.pathname + location.search);
      location.assign(u.toString());
    }
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
  saveSettings: (patch: Partial<{ ui: Partial<UiPrefs>; data: Partial<DataSource>; ai: Partial<Settings["ai"]>; refresh: { daily: string[]; watch: number } | null; grain: Grain }>) => request<Settings>("PUT", at("/api/settings"), patch),
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
  // The Sternkatalog of any Kosmos: the main menu searches them all.
  katalog: (id: string) => request<Katalog>("GET", at("/api/katalog", id)),
  saveKatalogEntry: (id: string, kpi: string, patch: Record<string, string | number | null>) => request<Katalog>("PUT", at(`/api/katalog/kennzahl/${encodeURIComponent(kpi)}`, id), patch),
  saveKatalogTerms: (id: string, terms: KatalogTerm[]) => request<Katalog>("PUT", at("/api/katalog/begriffe", id), { terms }),
  // Shared by all Kosmen. The first Kosmos's workspace document also carries the personal settings.
  sharedWorkspace: () => request<Record<string, unknown>>("GET", "/api/workspace"),
  saveSharedWorkspace: (w: unknown) => request<void>("PUT", "/api/workspace", w),
  setSecret: (key: SecretKey, value: string) => request<SecretState>("PUT", at("/api/settings/secret"), { key, value }),
  testAI: () => request<{ ok: boolean; model: string; ms: number; error: string }>("POST", "/api/settings/ai/test", {}),
  // The Kosmos goes along, so the server can add what its catalog says about the figures and words.
  ask: (question: string, month: string, facts: unknown) => request<AskReply>("POST", at("/api/lumina/ask"), { question, month, facts }),
};
