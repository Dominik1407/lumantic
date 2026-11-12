// Designs: the five built in (tokens in styles/themes.css) and corporate ones from the config.
// A corporate design is a built-in base plus its own colours and faces, written as inline tokens on <html>.
import type { CorporateDesign, UiPrefs } from "./api";
import { tr } from "./i18n";
import { favicon } from "./logo";

export interface Swatch { bg: string; ink: string; accent: string; alert: string; watch: string; good: string; sheet?: string }
export interface DesignInfo { id: string; name: string; note: string; dark: boolean; serif: boolean; swatch: Swatch; accents: string[]; corporate?: CorporateDesign }

export const DESIGNS: DesignInfo[] = [
  { id: "nacht", name: tr("Nacht", "Night"), note: tr("Der Nachthimmel von Kosmos", "The night sky of Kosmos"), dark: true, serif: true,
    swatch: { bg: "#070a16", ink: "#e9edf8", accent: "#b9c3ff", alert: "#ff7059", watch: "#f2b84b", good: "#62d6a2" }, accents: ["#b9c3ff", "#8fd3e6", "#f0c9a0", "#d4b8ff"] },
  { id: "kreide", name: tr("Kreide", "Chalk"), note: tr("Hell und neutral", "Light and neutral"), dark: false, serif: false,
    swatch: { bg: "#f5f6f8", ink: "#161b26", accent: "#2446c9", alert: "#b42318", watch: "#b77400", good: "#13804f" }, accents: ["#2446c9", "#0f6670", "#6a3fc4", "#1d5fa8"] },
  { id: "nebel", name: tr("Nebel", "Mist"), note: tr("Blaugrau mit weissen Blättern", "Blue grey with white sheets"), dark: false, serif: false,
    swatch: { bg: "#e4e9f1", ink: "#19203a", accent: "#4a4ec2", alert: "#b0271c", watch: "#b07000", good: "#12805a", sheet: "#fbfcfe" }, accents: ["#4a4ec2", "#2446c9", "#0f6670", "#7a3fae"] },
  { id: "stein", name: tr("Stein", "Stone"), note: tr("Warmes Grau, Graphit, Pflaume", "Warm grey, graphite, plum"), dark: false, serif: false,
    swatch: { bg: "#ebe8e2", ink: "#23211e", accent: "#6b3a78", alert: "#a82a1a", watch: "#ad6f00", good: "#12805a" }, accents: ["#6b3a78", "#2446c9", "#0f6670", "#7a4a1d"] },
  { id: "daemmerung", name: tr("Dämmerung", "Dusk"), note: tr("Schieferblau statt Nacht", "Slate blue instead of night"), dark: true, serif: false,
    swatch: { bg: "#313a57", ink: "#f2f4fa", accent: "#b9c1ff", alert: "#e6553f", watch: "#c69a2e", good: "#27a877" }, accents: ["#b9c1ff", "#8fd3e6", "#f0c9a0", "#d4b8ff"] },
];

export const ACCENT_NAMES: Record<string, string> = {
  "#b9c3ff": tr("Mondlicht", "Moonlight"), "#b9c1ff": tr("Mondlicht", "Moonlight"), "#8fd3e6": tr("Eisblau", "Ice blue"), "#f0c9a0": "Sand", "#d4b8ff": tr("Flieder", "Lilac"),
  "#2446c9": tr("Tintenblau", "Ink blue"), "#0f6670": "Petrol", "#6a3fc4": tr("Violett", "Violet"), "#1d5fa8": tr("Stahlblau", "Steel blue"),
  "#4a4ec2": "Indigo", "#7a3fae": tr("Lila", "Purple"), "#6b3a78": tr("Pflaume", "Plum"), "#7a4a1d": tr("Umbra", "Umber"),
};

export const FONTS = [
  { id: "", name: tr("Wie im Design", "As in the design"), family: "" },
  { id: "plex", name: "IBM Plex Sans", family: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif" },
  { id: "source", name: "Source Sans 3", family: "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif" },
  { id: "geist", name: "Geist", family: "'Geist', 'Helvetica Neue', Arial, sans-serif" },
];

// Token names of a corporate design's colours (config keys in camelCase) and the CSS token each one sets.
const TOKEN: Record<string, string> = {
  bg: "--bg", bg2: "--bg-2", sheet: "--sheet", sheetLine: "--sheet-line", ink: "--ink", ink2: "--ink-2", dim: "--dim", calm: "--calm",
  line: "--line", line2: "--line-2", grid: "--grid", accent: "--accent", accentInk: "--accent-ink", accentSoft: "--accent-soft",
  alert: "--alert", watch: "--watch", good: "--good", c1: "--c1", c2: "--c2", c3: "--c3", chip: "--chip", menu: "--menu",
};
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\([0-9., %]+\)$|^transparent$/;
const FONT_RE = /^[A-Za-z0-9 \-]{1,40}$/;

let corporate: DesignInfo[] = [];
let fontStyle: HTMLStyleElement | null = null;

// The config's corporate designs become designs of their own, listed after the built-in ones.
export function installCorporate(list: CorporateDesign[] | undefined) {
  corporate = [];
  const faces: string[] = [];
  for (const c of list || []) {
    if (!c || typeof c.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(c.id) || DESIGNS.some((d) => d.id === c.id)) continue;
    const base = DESIGNS.find((d) => d.id === c.base) || DESIGNS[1];
    const col = (k: string) => (c.colors && COLOR_RE.test(c.colors[k] || "") ? c.colors[k] : "");
    corporate.push({ id: c.id, name: c.name || c.id, note: tr(`Firmen-Design auf Basis von ${base.name}`, `Corporate design based on ${base.name}`), dark: base.dark, serif: false, corporate: c,
      swatch: { bg: col("bg") || base.swatch.bg, ink: col("ink") || base.swatch.ink, accent: col("accent") || base.swatch.accent, alert: col("alert") || base.swatch.alert, watch: col("watch") || base.swatch.watch, good: col("good") || base.swatch.good, sheet: col("sheet") || base.swatch.sheet },
      accents: [col("accent") || base.swatch.accent] });
    for (const f of c.fontFiles || []) {
      if (!f || !FONT_RE.test(f.family || "") || !/^[A-Za-z0-9_\-/.]+\.(woff2|woff|ttf|otf)$/.test(f.file || "") || f.file.includes("..")) continue;
      const fmt = f.file.endsWith(".woff2") ? "woff2" : f.file.endsWith(".woff") ? "woff" : f.file.endsWith(".otf") ? "opentype" : "truetype";
      faces.push(`@font-face{font-family:"${f.family}";src:url("/brand/${f.file}") format("${fmt}");font-weight:${/^\d{3}$/.test(f.weight || "") ? f.weight : "400"};font-style:${f.style === "italic" ? "italic" : "normal"};font-display:swap}`);
    }
  }
  if (!fontStyle) { fontStyle = document.createElement("style"); document.head.append(fontStyle); }
  fontStyle.textContent = faces.join("\n");
}

export const allDesigns = () => [...DESIGNS, ...corporate];
export const designOf = (id: string) => allDesigns().find((d) => d.id === id) || DESIGNS.find((d) => d.id === "nebel")!;

const lum = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const soft = (hex: string, a: number) => { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return ""; const n = parseInt(m[1], 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const quoteFont = (f: string | undefined, fallback: string) => (f && FONT_RE.test(f) ? `"${f}", ${fallback}` : "");

// Puts a look on <html>: design, face, accent, size and motion. Inline tokens are only ever the corporate ones and the accent.
export function applyLook(p: UiPrefs, systemStill: boolean) {
  const root = document.documentElement, st = root.style, d = designOf(p.design), base = d.corporate ? designOf(d.corporate.base) : d;
  for (const name of [...Object.values(TOKEN), "--sky-glow", "--ground", "--thread", "--lens-glass", "--lens-tint", "--lens-rim-2", "--f-design-text", "--f-design-ui", "--f-design-mono"]) st.removeProperty(name);
  root.dataset.design = base.id;
  if (d.corporate) {
    const c = d.corporate, col = (k: string) => (c.colors && COLOR_RE.test(c.colors[k] || "") ? c.colors[k] : "");
    for (const [k, token] of Object.entries(TOKEN)) if (col(k)) st.setProperty(token, col(k));
    if (col("bg")) { st.setProperty("--sky-glow", col("bg2") || col("bg")); if (!col("bg2")) st.setProperty("--bg-2", col("bg")); }
    if (col("bg") || col("sheet")) st.setProperty("--ground", col("sheet") && col("sheet") !== "transparent" ? col("sheet") : col("bg2") || col("bg"));
    if (col("ink2") || col("ink")) st.setProperty("--thread", col("ink2") || col("ink"));
    if (col("accent")) for (const t of ["--lens-glass", "--lens-tint", "--lens-rim-2"]) st.setProperty(t, col("accent"));
    // A company accent without its own soft tint gets one, else the base design's tint shows a foreign hue.
    if (col("accent") && !col("accentSoft") && soft(col("accent"), 1)) st.setProperty("--accent-soft", soft(col("accent"), base.dark ? 0.15 : 0.1));
    const sans = "'Helvetica Neue', Arial, sans-serif", mono = "ui-monospace, Consolas, monospace";
    if (c.fonts) {
      const tx = quoteFont(c.fonts.text, sans), ui = quoteFont(c.fonts.ui, sans), mo = quoteFont(c.fonts.mono, mono);
      if (tx) st.setProperty("--f-design-text", tx);
      if (ui) st.setProperty("--f-design-ui", ui);
      if (mo) st.setProperty("--f-design-mono", mo);
    }
  }
  const font = FONTS.some((f) => f.id === p.font) ? p.font : "";
  if (font) root.dataset.font = font; else delete root.dataset.font;
  root.dataset.face = !font && d.serif ? "serif" : "sans";
  const accent = /^#[0-9a-f]{6}$/i.test(p.accent || "") ? p.accent.toLowerCase() : "";
  if (accent && accent !== d.swatch.accent.toLowerCase()) {
    st.setProperty("--accent", accent);
    st.setProperty("--accent-soft", soft(accent, d.dark ? 0.15 : 0.1));
    st.setProperty("--accent-ink", lum(accent) > 0.35 ? "#10152b" : "#ffffff");
    for (const t of ["--lens-glass", "--lens-tint", "--lens-rim-2"]) st.setProperty(t, accent);
  }
  root.dataset.size = p.textSize === "gross" ? "gross" : "normal";
  root.classList.toggle("still", p.motion === "ruhig" || systemStill);
  const meta = document.querySelector('link[rel="icon"]');
  if (meta) meta.setAttribute("href", favicon(accent || d.swatch.accent, d.dark));
}
