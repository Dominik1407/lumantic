// Personal settings and what a person built. Both live on the server, in workspace documents:
//   the shared one (GET /api/workspace):  { v: 2, kosmos, ui }   ui = the personal settings, kosmos = the pages of the first Kosmos
//   one per further Kosmos (?k=<id>):     { v: 2, kosmos, lastPage }
// Any other stored shape (the old app's) is ignored. localStorage only steps in when the server cannot keep it.
import { api, MAIN, type UiPrefs } from "./api";

export interface Prefs extends UiPrefs { lastPage: string }

export const DEFAULTS: Prefs = { language: "", design: "nebel", font: "", accent: "", motion: "voll", textSize: "normal", start: "heute", lens: "1J", hints: true, lastPage: "" };
const CHOICES: Record<string, readonly unknown[]> = {
  language: ["", "de", "en"], motion: ["voll", "ruhig"], textSize: ["normal", "gross"], start: ["heute", "ueberblick", "zuletzt"], lens: ["1M", "1Q", "1J"], hints: [true, false],
};
const LOCAL = "lumantic.workspace.v2";

interface Shared { v: 2; kosmos: unknown; ui: Partial<Prefs> }
interface Own { v: 2; kosmos: unknown; lastPage: string }
let SHARED: Shared = { v: 2, kosmos: null, ui: {} };
let OWN: Own = { v: 2, kosmos: null, lastPage: "" };
// Where this page is: "" in the main menu, else the Kosmos. Only the first Kosmos keeps its pages in the shared document.
let where = "";
const first = () => where === MAIN;
export const P: Prefs = { ...DEFAULTS };

function clean(src: Partial<Prefs> | undefined): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    if (!(k in DEFAULTS)) continue;
    if (CHOICES[k] && !CHOICES[k].includes(v)) continue;
    if (!CHOICES[k] && typeof v !== "string") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
function stored(key: string): Record<string, unknown> | null {
  try { const d = JSON.parse(localStorage.getItem(key) || "null"); return d && d.v === 2 ? d : null; } catch { return null; }
}

// Order: built-in defaults, then the defaults the team saved in the config, then what this person chose.
// kosmos is the id of the Kosmos this page shows ("" for the main menu), own its document when it is not the first.
export function initPrefs(serverDefaults: Partial<UiPrefs> | undefined, shared: unknown, kosmos = MAIN, own?: unknown) {
  where = kosmos;
  const s = ((shared as Partial<Shared> | null)?.v === 2 ? shared : stored(LOCAL)) as Partial<Shared> | null;
  if (s) SHARED = { v: 2, kosmos: s.kosmos ?? null, ui: clean(s.ui) };
  const o = ((own as Partial<Own> | null)?.v === 2 ? own : stored(`${LOCAL}:${kosmos}`)) as Partial<Own> | null;
  if (o) OWN = { v: 2, kosmos: o.kosmos ?? null, lastPage: typeof o.lastPage === "string" ? o.lastPage : "" };
  Object.assign(P, DEFAULTS, clean(serverDefaults as Partial<Prefs>), SHARED.ui);
  if (!first()) P.lastPage = OWN.lastPage;
}

export const storedKosmos = () => (first() ? SHARED.kosmos : OWN.kosmos);
export function saveKosmos(snapshot: unknown) {
  if (first()) { SHARED.kosmos = snapshot; queue("shared"); } else { OWN.kosmos = snapshot; queue("own"); }
}
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  P[key] = value;
  // The page a person was on last belongs to the Kosmos, everything else to the person.
  if (key === "lastPage" && !first()) { OWN.lastPage = String(value); queue("own"); return; }
  SHARED.ui = { ...SHARED.ui, [key]: value };
  queue("shared");
}
// The personal settings without the bookkeeping, as defaults for everyone.
export const uiOnly = (): UiPrefs => { const { lastPage: _drop, ...ui } = P; void _drop; return ui; };

const timers: Record<string, number> = {};
export let saveState: "ok" | "local" = "ok";
function queue(doc: "shared" | "own") {
  clearTimeout(timers[doc]);
  timers[doc] = window.setTimeout(() => void push(doc), 600);
}
async function push(doc: "shared" | "own") {
  delete timers[doc];
  try {
    if (doc === "own") await api.saveWorkspace(OWN);
    else if (first()) await api.saveSharedWorkspace(SHARED);
    else {
      // Outside the first Kosmos only the settings are ours to write: its pages stay as the server has them.
      const cur = await api.sharedWorkspace().catch(() => null);
      await api.saveSharedWorkspace({ ...(cur && cur.v === 2 ? cur : { v: 2, kosmos: null }), ui: SHARED.ui });
    }
    saveState = "ok";
  } catch {
    saveState = "local";
    try { localStorage.setItem(doc === "own" ? `${LOCAL}:${where}` : LOCAL, JSON.stringify(doc === "own" ? OWN : SHARED)); } catch { /* storage is optional */ }
  }
}
// Saves at once what is still waiting, for example before the page reloads.
export async function flush() {
  const waiting = Object.keys(timers) as ("shared" | "own")[];
  for (const doc of waiting) clearTimeout(timers[doc]);
  await Promise.all(waiting.map(push));
}
