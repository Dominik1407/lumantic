// Typed client for the Lumantic API (see internal/server).

export type Level = "alert" | "watch" | "notable" | "info" | "calm";

export interface Rule { op: "<=" | ">="; value?: number; vs?: boolean }

export interface Spec {
  question: string;
  short: string;
  table: string;
  measure: string;
  agg: "sum" | "avg";
  filter?: Record<string, string>;
  vs?: string;
  good?: Rule | null;
  breakdown?: string;
  display: "trend" | "bars";
}

export interface Card { id: string; spec: Spec; origin: string; created: string }
export interface Point { t: string; v: number; c?: number }
export interface Group { name: string; v: number; prev?: number; c?: number }

export interface Result {
  card: Card;
  level: Level;
  tone: "good" | "bad" | "neutral";
  label: string;
  value: number;
  valueText: string;
  unit: string;
  answer: string;
  delta?: string;
  why?: string;
  ruleText?: string;
  series: Point[];
  groups?: Group[];
  explain: string;
  reason: string;
  sql: string;
  source: string;
  score: number;
  error?: string;
}

export interface Board {
  asOf: string;
  week: number;
  stand: string;
  brief: { text: string; em?: boolean }[];
  cards: Result[];
}

export interface Meta {
  product: string;
  slogan: string;
  adapter: string;
  dialect: string;
  source: string;
  lumina: { mode: "claude" | "beispiel"; model: string };
  weeks: string[];
}

export interface Column { name: string; type: string; role: "time" | "dimension" | "measure"; unit?: string; desc: string; values?: string[] }
export interface Table { name: string; desc: string; columns: Column[] }
export interface Catalog { source: string; dialect: string; tables: Table[] }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Lumantic ist nicht erreichbar. Läuft der Server?");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Fehler ${res.status}`);
  return data as T;
}

export const api = {
  meta: () => call<Meta>("GET", "/api/meta"),
  catalog: () => call<Catalog>("GET", "/api/catalog"),
  refreshCatalog: () => call<Catalog>("POST", "/api/catalog/refresh"),
  board: (asOf?: string) => call<Board>("GET", "/api/board" + (asOf ? `?asOf=${asOf}` : "")),
  suggestions: () => call<Spec[]>("GET", "/api/suggestions"),
  ask: (question: string, asOf?: string) => call<Result>("POST", "/api/ask", { question, asOf }),
  brief: (about: string, replace: boolean) => call<{ added: number; skipped: string[] | null }>("POST", "/api/brief", { about, replace }),
  addCard: (spec: Spec, asOf?: string) => call<Result>("POST", "/api/cards", { spec, asOf }),
  setRule: (id: string, good: Rule | null) => call<Card>("PATCH", `/api/cards/${id}`, { good }),
  remove: (id: string) => call<void>("DELETE", `/api/cards/${id}`),
  reset: () => call<Card[]>("POST", "/api/reset"),
};
