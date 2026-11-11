#!/usr/bin/env node
// A stand-in for the Go server, for the real-time UI tests: serves web/dist and answers the API in memory, following
// the server's contract (internal/server). Figures come from fixtures/metrics.json, captured once from a real run.
//
//   node scripts/ui-test/mock-api.mjs [--port 8098] [--empty] [--kosmen]
//
// --empty starts without data (GET /api/metrics answers 503). --kosmen starts with three Kosmen instead of one, so
// the app opens in its main menu. POST /__mock with {"empty": true|false}, {"fresh": true} or {"brand": {...}} changes the state,
// GET /__mock shows it: what was saved, asked and stored.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf("--port") + 1]) || 8098;
const dist = resolve(here, "../../web/dist");
const metrics = JSON.parse(readFileSync(join(here, "fixtures/metrics.json"), "utf8"));

const MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "am gründlichsten" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "schnell und gründlich" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "am schnellsten" },
];
const DUCKDB = "C:/tools/duckdb.exe"; // fixed by an environment variable, as scripts/run.ps1 does
const windmill = () => ({ url: "", workspace: "lumantic", describe: "f/lumantic/describe", query: "f/lumantic/query" });
const snowflake = () => ({ account: "", user: "", role: "", warehouse: "", database: "", auth: "keypair", keyFile: "" });
const databricks = () => ({ host: "", warehouse: "", catalog: "", auth: "oauth", clientId: "" });
// Tokens of a warehouse belong to one Kosmos: "key@id" (the first Kosmos uses the plain key), as on the server.
const PER_KOSMOS = ["snowflakeToken", "databricksToken", "databricksSecret"];
const keyOf = (key, id) => (PER_KOSMOS.includes(key) && id && id !== "main" ? `${key}@${id}` : key);

// The tables every mock source has: one per figure table, a month column and one value column per figure.
const tables = new Map();
for (const k of metrics.kpis) {
  if (!tables.has(k.table)) tables.set(k.table, { name: k.table, desc: "", columns: [{ name: "monat", type: "DATE", role: "time", desc: "" }] });
  tables.get(k.table).columns.push({ name: `${k.id}_wert`, type: "DOUBLE", role: "measure", desc: "" });
}
tables.set("gold_alco.kunden_monat", { name: "gold_alco.kunden_monat", desc: "", columns: [
  { name: "monat", type: "DATE", role: "time", desc: "" }, { name: "segment", type: "VARCHAR", role: "dimension", desc: "" },
  { name: "kunden_anzahl", type: "BIGINT", role: "measure", desc: "" }, { name: "kredite_mio", type: "DOUBLE", role: "measure", desc: "" }] });

// A Kosmos of the mock: a source, definitions and the figures it shows. ids picks figures from the fixture;
// none means a Kosmos that is connected but has no key figures yet.
function kosmos(id, name, ids, path = "goldlayer/gold.duckdb") {
  const ks = metrics.kpis.filter((k) => !ids || ids.includes(k.id));
  return {
    id, empty: false, workspace: {}, metrics: "", builtIn: id === "main", plan: null, token: "",
    data: { type: "duckdb", name, path, schema: "gold", duckdb: DUCKDB, snowflake: snowflake(), databricks: databricks(), windmill: windmill() },
    groups: metrics.groups.filter((g) => ks.some((k) => k.group === g.id)).map((g) => ({ ...g })),
    defs: ks.map((k) => ({ id: k.id, group: k.group, name: k.name, long: k.long, short: k.short, unit: k.unit, dec: k.dec, kind: k.kind, dir: k.dir,
      limit: k.limit, target: k.target, desc: k.desc, monthly: { table: k.table, value: `${k.id}_wert` } })),
  };
}
// What a Kosmos shows: every definition whose value column is one of the fixture's (lcr_wert is the fixture's lcr),
// with the name, topic, target and limit of the definition.
const loaded = (k) => k.defs.flatMap((d) => {
  const fx = metrics.kpis.find((x) => `${x.id}_wert` === d.monthly?.value && x.table === d.monthly?.table);
  return fx ? [{ ...fx, id: d.id, name: d.name, short: d.short || d.name, group: d.group, target: d.target ?? null, limit: d.limit ?? null }] : [];
});
const state = {
  kosmen: argv.includes("--kosmen")
    ? [kosmos("main", "ALCO"), kosmos("firmenkunden", "Firmenkunden", ["lcr", "nsfr", "eve", "nnm"], "goldlayer/firmenkunden"), kosmos("privatkunden", "Privatkunden", ["cet1", "lev", "bal", "mort"], "goldlayer/privatkunden")]
    : [kosmos("main", "Goldlayer ALCO")],
  config: {
    ui: { design: "nebel", font: "", accent: "", motion: "voll", textSize: "normal", start: "heute", lens: "1J", hints: true },
    ai: { enabled: true, provider: "anthropic", model: "claude-opus-5-5", baseURL: "" },
    brand: { name: "", logo: "", logoDark: "", designs: [] },
  },
  secrets: { anthropicToken: "", windmillToken: "" }, // plus "key@id" entries for warehouse tokens
  asked: [],
  saves: 0,
};
state.kosmen[0].empty = argv.includes("--empty");

const secret = (key, id) => (state.secrets[keyOf(key, id)] ? { set: true, hint: state.secrets[keyOf(key, id)].slice(-4), source: "datei" } : { set: false, hint: "", source: "" });
// What a warehouse source lacks before it can answer, as the server says it; "" when it is complete.
function lacking(d, id, given = {}) {
  const has = (key) => !!(given[key] || state.secrets[keyOf(key, id)]);
  if (d.type === "snowflake") {
    const sf = d.snowflake || {};
    if (!sf.account) return "Für Snowflake braucht es das Konto, z. B. myorg-myaccount.";
    if (!sf.user) return "Für Snowflake braucht es den Benutzer.";
    if (!sf.warehouse) return "Für Snowflake braucht es das Warehouse, auf dem Lumantic rechnet.";
    if (!sf.database) return "Für Snowflake braucht es die Datenbank.";
    if (sf.auth === "token" ? !has("snowflakeToken") : !sf.keyFile) return sf.auth === "token" ? "Für Snowflake fehlt der Token." : "Für die Anmeldung mit Schlüsselpaar braucht es die Schlüsseldatei.";
  }
  if (d.type === "databricks") {
    const db = d.databricks || {};
    if (!/^https?:\/\/./.test(db.host || "")) return "Für Databricks braucht es die Adresse des Workspace, z. B. https://adb-123.4.azuredatabricks.net.";
    if (!db.warehouse) return "Für Databricks braucht es die ID des SQL-Warehouse.";
    if (db.auth === "oauth" && !db.clientId) return "Für OAuth braucht es die Client-ID des Service Principal.";
    if (db.auth === "oauth" ? !has("databricksSecret") : !has("databricksToken")) return db.auth === "oauth" ? "Für Databricks fehlt das Secret des Service Principal." : "Für Databricks fehlt das persönliche Token.";
  }
  return "";
}
const isWarehouse = (d) => d.type === "snowflake" || d.type === "databricks";
// When a Kosmos is read again by itself: the one written down, else the usual for its source (as on the server).
const watchable = (d) => d.type === "duckdb" || d.type === "files";
const planOf = (k) => k.plan ? { ...k.plan, watch: watchable(k.data) ? k.plan.watch : 0 } : watchable(k.data) ? { daily: [], watch: 5 } : { daily: ["06:00"], watch: 0 };
// Open pages listening for new figures (GET /api/events); POST /__mock {"event": {...}} speaks to them.
const listeners = new Set();
const tell = (ev) => { for (const res of listeners) res.write(`event: refresh\ndata: ${JSON.stringify(ev)}\n\n`); };
const figuresOf = (k) => ({ ...metrics, title: k.data.name, kpis: loaded(k), groups: k.groups });
function status(k) {
  const base = { ok: false, error: "", tables: 0, kpis: k.defs.length, kpisLoaded: 0, months: 0, first: "", last: "", refreshedAt: new Date(Date.now() - 120000).toISOString() };
  if (k.empty) return { ...base, error: `Die Datei ${k.data.path} gibt es nicht.` };
  if (!loaded(k).length) return { ...base, tables: tables.size, error: "Für diesen Kosmos sind noch keine Kennzahlen definiert." };
  return { ...base, ok: true, tables: tables.size, kpisLoaded: loaded(k).length, months: metrics.months.length, first: metrics.months[0], last: metrics.months.at(-1) };
}
const info = (k) => ({ id: k.id, name: k.data.name, type: k.data.type, main: k.id === "main", status: status(k) });
function settings(k) {
  const c = state.config, tok = secret("anthropicToken");
  return { version: "0.6.0", configPath: "config/lumantic.json", configExists: state.saves > 0, locked: ["data.duckdb"], ui: c.ui,
    kosmos: { id: k.id, main: k.id === "main", count: state.kosmen.length },
    data: { ...k.data, windmill: { ...k.data.windmill, token: secret("windmillToken") },
      snowflake: { ...snowflake(), ...k.data.snowflake, token: secret("snowflakeToken", k.id) },
      databricks: { ...databricks(), ...k.data.databricks, token: secret("databricksToken", k.id), secret: secret("databricksSecret", k.id) } },
    metrics: k.metrics, status: status(k),
    refresh: { ...planOf(k), own: !!k.plan, watchable: watchable(k.data), token: k.token ? { set: true, hint: k.token.slice(-4), source: "datei" } : { set: false, hint: "", source: "" } },
    ai: { ...c.ai, token: tok, models: MODELS, ready: c.ai.enabled && tok.set }, brand: c.brand };
}
const missing = (d) => {
  const t = tables.get(d.monthly?.table);
  if (!t) return [d.monthly?.table || "?"];
  return t.columns.some((c) => c.name === d.monthly.value) ? [] : [`${t.name}.${d.monthly.value}`];
};
const view = (d) => ({ ...d, status: missing(d).length ? "fehlt: " + missing(d).join(", ") : "ok" });
const slug = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// The first change of a Kosmos's figures gives it a definitions file of its own.
function wrote(k) { if (!k.metrics) { k.builtIn = false; k.metrics = k.id === "main" ? "config/kennzahlen.json" : `config/kennzahlen-${k.id}.json`; } }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
function send(res, code, body) {
  if (code === 204) { res.writeHead(204); res.end(); return; }
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
const fail = (res, code, msg) => send(res, code, { error: msg });
const merge = (into, patch) => { for (const [k, v] of Object.entries(patch || {})) if (v && typeof v === "object" && !Array.isArray(v) && into[k] && typeof into[k] === "object") merge(into[k], v); else if (k in into) into[k] = v; };
const broken = (d) => String(d?.path || "").includes("gibtsnicht");

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function api(req, res, url) {
  const m = req.method, path = url.pathname;
  // the server's guard: a body must be JSON
  if (m !== "GET" && m !== "DELETE" && Number(req.headers["content-length"] || 0) > 0 && !String(req.headers["content-type"] || "").startsWith("application/json")) return fail(res, 415, "Bitte als JSON senden.");
  const b = m === "GET" || m === "DELETE" ? {} : await body(req);

  // All Kosmen
  if (m === "GET" && path === "/api/kosmen") return send(res, 200, { kosmen: state.kosmen.map(info) });
  if (m === "GET" && path === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.write("retry: 5000\n\n");
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
    return;
  }
  if (m === "POST" && path === "/api/kosmen") {
    const d = { type: "duckdb", name: "", path: "", schema: "gold", duckdb: DUCKDB, snowflake: snowflake(), databricks: databricks(), windmill: windmill(), ...b.data };
    if (!String(d.name).trim()) return fail(res, 422, "Der Kosmos braucht einen Namen.");
    if (!String(d.path).trim() && (d.type === "duckdb" || d.type === "files")) return fail(res, 422, "Für eine DuckDB-Datei braucht es den Pfad zur Datei.");
    if (broken(d)) return fail(res, 422, `Die Datei ${d.path} gibt es nicht.`);
    let id = slug(d.name) || "kosmos";
    for (let n = 2; state.kosmen.some((k) => k.id === id); n++) id = `${slug(d.name)}-${n}`;
    const why = lacking(d, id, b.secrets || {});
    if (why) return fail(res, 422, why);
    for (const [key, v] of Object.entries(b.secrets || {})) if (PER_KOSMOS.includes(key) && String(v).trim()) state.secrets[keyOf(key, id)] = String(v).trim();
    const k = kosmos(id, d.name.trim(), []);
    k.data = d;
    state.kosmen.push(k);
    state.saves++;
    return send(res, 201, info(k));
  }
  const del = /^\/api\/kosmen\/([^/]+)$/.exec(path);
  if (m === "DELETE" && del) {
    if (del[1] === "main") return fail(res, 409, "Der erste Kosmos lässt sich nicht entfernen. Du kannst ihm eine andere Datenquelle geben.");
    const i = state.kosmen.findIndex((k) => k.id === decodeURIComponent(del[1]));
    if (i < 0) return fail(res, 404, "Diesen Kosmos gibt es nicht.");
    state.kosmen.splice(i, 1);
    state.saves++;
    return send(res, 204);
  }

  // One Kosmos: ?k=<id>, none means the first
  const k = state.kosmen.find((x) => x.id === (url.searchParams.get("k") || "main"));
  if (!k && !/^\/api\/(settings\/(secret|ai\/test)|lumina\/ask)$/.test(path)) return fail(res, 404, "Diesen Kosmos gibt es nicht.");
  if (m === "GET" && path === "/api/metrics") {
    if (k.empty) return fail(res, 503, `Die Kennzahlen sind nicht verfügbar: Die Datei ${k.data.path} gibt es nicht.`);
    if (!loaded(k).length) return fail(res, 503, "Die Kennzahlen sind nicht verfügbar: Keine Kennzahlen definiert.");
    return send(res, 200, figuresOf(k));
  }
  if (m === "GET" && path === "/api/workspace") return send(res, 200, k.workspace);
  if (m === "PUT" && path === "/api/workspace") { k.workspace = b; return send(res, 204); }
  if (m === "GET" && path === "/api/catalog") return send(res, 200, k.empty ? null : { source: k.data.name, dialect: "duckdb", tables: [...tables.values()] });
  if (m === "GET" && path === "/api/settings") return send(res, 200, settings(k));
  if (m === "PUT" && path === "/api/settings") {
    if (b.data) {
      if (b.data.duckdb !== undefined && b.data.duckdb !== k.data.duckdb) return fail(res, 409, "Die Einstellung data.duckdb ist durch die Umgebungsvariable LUMANTIC_DUCKDB festgelegt.");
      if (broken(b.data)) return fail(res, 422, `Die Datei ${b.data.path} gibt es nicht.`);
      const why = isWarehouse(b.data) ? lacking({ ...k.data, ...b.data }, k.id) : "";
      if (why) return fail(res, 422, why);
      k.empty = false;
      merge(k.data, b.data);
    }
    if ("refresh" in b) {
      if (b.refresh && (b.refresh.daily || []).some((t) => !/^\d{1,2}:\d{2}$/.test(t))) return fail(res, 422, `«${b.refresh.daily.find((t) => !/^\d{1,2}:\d{2}$/.test(t))}» ist keine Uhrzeit. Zeiten im Format 06:30.`);
      k.plan = b.refresh ? { daily: (b.refresh.daily || []).map((t) => t.padStart(5, "0")).sort(), watch: b.refresh.watch || 0 } : null;
    }
    const { data: _d, refresh: _r, ...rest } = b;
    merge(state.config, rest);
    state.saves++;
    return send(res, 200, settings(k));
  }
  if (m === "POST" && path === "/api/settings/data/test") {
    const d = b.data || b;
    if (broken(d)) return send(res, 200, { ok: false, error: `Die Datei ${d.path} gibt es nicht.`, tables: [] });
    const why = isWarehouse(d) ? lacking(d, k.id, b.secrets || {}) : "";
    if (why) return send(res, 200, { ok: false, error: why, tables: [] });
    return send(res, 200, { ok: true, error: "", tables: [...tables.values()].map((t) => ({ name: t.name, time: "monat", rows: 94, columns: t.columns })) });
  }
  if (m === "PUT" && path === "/api/settings/secret") {
    if (!(b.key in state.secrets) && !PER_KOSMOS.includes(b.key)) return fail(res, 400, "Unbekannter Schlüssel.");
    const id = url.searchParams.get("k") || "main";
    state.secrets[keyOf(b.key, id)] = String(b.value || "");
    return send(res, 200, secret(b.key, id));
  }
  if (m === "POST" && path === "/api/settings/ai/test") {
    return send(res, 200, state.secrets.anthropicToken ? { ok: true, model: state.config.ai.model, ms: 812, error: "" } : { ok: false, model: state.config.ai.model, ms: 0, error: "Es ist kein API-Token gesetzt." });
  }
  if (m === "POST" && path === "/api/refresh") return send(res, 200, status(k));
  if (m === "POST" && path === "/api/refresh/token") {
    k.token = "lmt_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "mock";
    return send(res, 201, { token: k.token, state: { set: true, hint: k.token.slice(-4), source: "datei" } });
  }
  if (m === "DELETE" && path === "/api/refresh/token") { k.token = ""; return send(res, 204); }
  if (m === "GET" && path === "/api/kpis") return send(res, 200, { file: k.metrics, builtIn: k.builtIn, groups: k.groups, kpis: k.defs.map(view) });
  if (m === "POST" && path === "/api/kpis") {
    if (!String(b.name || "").trim()) return fail(res, 422, "Die Kennzahl braucht einen Namen.");
    const id = b.id || slug(b.name);
    if (k.defs.some((d) => d.id === id)) return fail(res, 409, `Die Kennzahl ${id} gibt es schon.`);
    if (missing(b).length) return fail(res, 422, "Im Goldlayer fehlt: " + missing(b).join(", "));
    let group = b.group;
    if (!k.groups.some((g) => g.id === group)) {
      if (!String(b.groupName || "").trim()) return fail(res, 422, "Bitte ein Thema wählen oder ein neues benennen.");
      group = slug(b.groupName);
      k.groups.push({ id: group, name: b.groupName.trim() });
    }
    const { groupName: _g, status: _s, ...def } = b;
    const d = { ...def, id, group, short: b.name, long: b.name, desc: "" };
    k.defs.push(d);
    wrote(k);
    return send(res, 201, view(d));
  }
  const one = /^\/api\/kpis\/([^/]+)$/.exec(path);
  if (one) {
    const i = k.defs.findIndex((d) => d.id === decodeURIComponent(one[1]));
    if (i < 0) return fail(res, 404, `Die Kennzahl ${one[1]} gibt es nicht.`);
    if (m === "PUT") { const { id: _i, status: _s, ...patch } = b; k.defs[i] = { ...k.defs[i], ...patch }; wrote(k); return send(res, 200, view(k.defs[i])); }
    if (m === "DELETE") { k.defs.splice(i, 1); wrote(k); return send(res, 204); }
  }
  if (m === "POST" && path === "/api/lumina/ask") {
    if (!(state.config.ai.enabled && state.secrets.anthropicToken)) return fail(res, 409, "Für Lumina ist kein API-Token gesetzt.");
    if (!String(b.question || "").trim()) return fail(res, 400, "Bitte stell eine Frage.");
    state.asked.push({ question: b.question, month: b.month, figures: (b.facts?.figures || []).length });
    const f = (b.facts?.figures || []).find((x) => x.id === "lcr") || b.facts?.figures?.[0];
    if (!f) return fail(res, 422, "Dazu stehen keine Kennzahlen in den Fakten.");
    return send(res, 200, { answer: `${f.name} liegt im ${b.facts.month} bei ${f.value} ${f.unit}${f.driver ? `. Am stärksten bewegt hat sich ${f.driver}` : ""}.`,
      blocks: [{ figure: f.id, view: f.parts?.length ? "drivers" : "trend", month: "" }], model: state.config.ai.model, ms: 640 });
  }
  return fail(res, 404, "Unbekannter Pfad.");
}

// A company logo for the tests, whatever file the brand names.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect x="2" y="4" width="32" height="32" rx="8" fill="#00539f"/><rect x="44" y="14" width="72" height="12" rx="3" fill="#0b1f3a"/></svg>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), path = decodeURIComponent(url.pathname);
  try {
    if (path === "/__mock") {
      if (req.method === "POST") {
        const b = await body(req);
        if ("empty" in b) state.kosmen[0].empty = !!b.empty;
        if (b.fresh) state.saves = 0; // as before the first start: no config file yet
        if (b.event) tell({ kosmos: "main", ok: true, changed: true, at: new Date().toISOString(), by: "zeitplan", ...b.event });
        if (b.brand) Object.assign(state.config.brand, b.brand);
      }
      return send(res, 200, { ...state, empty: state.kosmen[0].empty, workspace: state.kosmen[0].workspace, config: { ...state.config, data: state.kosmen[0].data } });
    }
    if (path.startsWith("/api/")) return await api(req, res, url);
    if (path.startsWith("/brand/") && path.endsWith(".svg")) { res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(LOGO); return; }
    let file = normalize(join(dist, path === "/" ? "index.html" : path));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    fail(res, 500, String(e && e.message));
  }
}).listen(port, "127.0.0.1", () => console.log(`mock api on http://127.0.0.1:${port}${state.kosmen[0].empty ? " (ohne Daten)" : ""}${state.kosmen.length > 1 ? ` (${state.kosmen.length} Kosmen)` : ""}`));
