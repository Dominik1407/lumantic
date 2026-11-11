// ═════ Kosmos · the colours of what is drawn on canvas. CSS paints everything else from the same design tokens. ═════
// Read once per design (and again when the design changes); the canvas then mixes them with its own alphas.
const THEME = { grid: [190, 200, 255, 1], gridA: 1, thread: [185, 196, 255, 1], threadA: 1, tint: [128, 146, 255, 1], tintA: 1 };
const probe = document.createElement("canvas").getContext("2d");
// Any CSS colour as [r, g, b, a]. The canvas normalises what it accepts, so names and every notation work.
function rgbOf(str, fallback) {
  if (!str) return fallback;
  probe.fillStyle = "#010203";
  probe.fillStyle = str;
  const v = String(probe.fillStyle);
  if (v === "#010203") return fallback;
  if (v[0] === "#") return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return fallback;
  const p = m[1].split(",").map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a * c[3], 0, 1).toFixed(3)})`;
function readTheme() {
  const cs = getComputedStyle(document.documentElement), get = (n) => cs.getPropertyValue(n).trim();
  const num = (n, d) => { const v = parseFloat(get(n)); return Number.isFinite(v) ? v : d; };
  THEME.grid = rgbOf(get("--grid"), THEME.grid); THEME.gridA = num("--grid-a", 1);
  THEME.thread = rgbOf(get("--thread"), THEME.thread); THEME.threadA = num("--thread-a", 1);
  THEME.tint = rgbOf(get("--lens-tint"), THEME.tint); THEME.tintA = num("--lens-tint-a", 1);
}
readTheme();
