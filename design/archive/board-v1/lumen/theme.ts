// Lumen themes: a corporate design is seven values. Everything else in the
// UI derives from them (see tokens.css), including dark mode.

export interface Theme {
  id: string;
  name: string;
  brand: string;     // one colour; surfaces, ink tints and glows derive from it
  display: string;   // Google Fonts family for headings
  body: string;      // Google Fonts family for text
  mono: string;      // Google Fonts family for SQL and code
  radius: number;    // px, 0 to 24
  density: number;   // spacing factor, 0.85 to 1.2
  tint: number;      // % of brand mixed into neutrals, 0 to 10
  workspace?: string; // optional label next to the wordmark, e.g. "Musterbank"
}

export const presets: Theme[] = [
  { id: "lumantic", name: "Lumantic", brand: "#c9971c", display: "Bricolage Grotesque", body: "Geist", mono: "Geist Mono", radius: 16, density: 1, tint: 2 },
  { id: "musterbank", name: "Musterbank", brand: "#1f4fa3", display: "IBM Plex Sans", body: "IBM Plex Sans", mono: "IBM Plex Mono", radius: 4, density: 0.95, tint: 3, workspace: "Musterbank" },
  { id: "alpin", name: "Alpin", brand: "#0f766e", display: "Fraunces", body: "Instrument Sans", mono: "JetBrains Mono", radius: 12, density: 1.05, tint: 5, workspace: "Alpin Versicherung" },
  { id: "rubin", name: "Rubin", brand: "#b0123a", display: "Archivo", body: "Archivo", mono: "Space Mono", radius: 8, density: 1, tint: 3, workspace: "Rubin Energie" },
];

export const fontChoices = [
  "Bricolage Grotesque", "Geist", "IBM Plex Sans", "Instrument Sans", "Fraunces", "Archivo",
  "Manrope", "Source Serif 4", "Work Sans", "DM Sans", "Libre Franklin", "Figtree",
];
export const monoChoices = ["Geist Mono", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "Fira Code"];

const KEY = "lumantic.theme";
const MODE_KEY = "lumantic.mode";

function stack(family: string, fallback: string): string {
  return `"${family}", ${fallback}`;
}

function loadFonts(t: Theme) {
  const families = [...new Set([t.display, t.body, t.mono])]
    .map((f) => "family=" + f.trim().replace(/ /g, "+") + (/(Mono|Code)$/.test(f) ? ":wght@400;500" : ":wght@400..700"))
    .join("&");
  let link = document.getElementById("lm-fonts") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "lm-fonts";
    link.rel = "stylesheet";
    document.head.append(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/** Loads the heading font of every preset, so the design panel can preview them. */
export function preloadPresetFonts() {
  if (document.getElementById("lm-preset-fonts")) return;
  const families = [...new Set(presets.map((p) => p.display))].map((f) => "family=" + f.replace(/ /g, "+")).join("&");
  document.head.append(Object.assign(document.createElement("link"), {
    id: "lm-preset-fonts", rel: "stylesheet", href: `https://fonts.googleapis.com/css2?${families}&display=swap`,
  }));
}

export function applyTheme(t: Theme) {
  const s = document.documentElement.style;
  s.setProperty("--lm-brand", t.brand);
  s.setProperty("--lm-font-display", stack(t.display, "ui-sans-serif, system-ui, sans-serif"));
  s.setProperty("--lm-font-body", stack(t.body, "system-ui, -apple-system, 'Segoe UI', sans-serif"));
  s.setProperty("--lm-font-mono", stack(t.mono, "ui-monospace, Consolas, monospace"));
  s.setProperty("--lm-radius", `${t.radius}px`);
  s.setProperty("--lm-density", String(t.density));
  s.setProperty("--lm-tint", `${t.tint}%`);
  loadFonts(t);
}

export function loadTheme(): Theme {
  // ?theme=musterbank previews a preset without saving it (handy for demos).
  const preview = new URLSearchParams(location.search).get("theme");
  const preset = presets.find((p) => p.id === preview);
  if (preset) return preset;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...presets[0], ...JSON.parse(raw) };
  } catch { /* storage unavailable: use the default */ }
  return presets[0];
}

export function saveTheme(t: Theme) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

export type Mode = "system" | "light" | "dark";

export function applyMode(m: Mode) {
  if (m === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", m);
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
}

export function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "light" || m === "dark") return m;
  } catch { /* ignore */ }
  return "system";
}

/** Parses an exported theme; unknown keys are dropped, missing ones defaulted. */
export function parseTheme(json: string): Theme {
  const v = JSON.parse(json);
  const base = presets[0];
  const num = (x: unknown, d: number) => (typeof x === "number" && isFinite(x) ? x : d);
  const str = (x: unknown, d: string) => (typeof x === "string" && x.trim() ? x.trim() : d);
  if (!/^#[0-9a-f]{6}$/i.test(str(v.brand, ""))) throw new Error("brand muss eine Farbe wie #1f4fa3 sein");
  return {
    id: "custom", name: str(v.name, "Eigenes Design"), brand: v.brand,
    display: str(v.display, base.display), body: str(v.body, base.body), mono: str(v.mono, base.mono),
    radius: Math.min(24, Math.max(0, num(v.radius, base.radius))),
    density: Math.min(1.2, Math.max(0.85, num(v.density, base.density))),
    tint: Math.min(10, Math.max(0, num(v.tint, base.tint))),
    workspace: typeof v.workspace === "string" ? v.workspace : undefined,
  };
}

export function exportTheme(t: Theme): string {
  const { id: _id, ...rest } = t;
  return JSON.stringify(rest, null, 2);
}
