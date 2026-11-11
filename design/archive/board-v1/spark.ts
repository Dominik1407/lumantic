// Sparklines and bars. Lines live in an SVG that stretches with the card;
// dots, crosshair and tooltip are HTML so they never distort.
import type { Result } from "./api";
import { h, s } from "./dom";
import { fmtValue, vsName, weekLabel } from "./format";

const endColor: Record<string, string> = {
  alert: "var(--lm-crit)",
  watch: "var(--lm-warn)",
  good: "var(--lm-good)",
  notable: "var(--lm-accent)",
  calm: "var(--lm-spark)",
  info: "var(--lm-spark)",
};

export function sparkline(r: Result, height: number, interactive = true): HTMLElement {
  const pts = r.series;
  const wrap = h("div", { class: "spark", style: `height:${height}px`, role: "img", "aria-label": ariaText(r) });
  if (pts.length < 2) return wrap;

  const values = pts.flatMap((p) => (p.c === undefined ? [p.v] : [p.v, p.c]));
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const W = 100, H = height;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" },
    s("path", { d: `${line} L${W},${H} L0,${H} Z`, fill: "var(--lm-spark-wash)" }),
    pts.some((p) => p.c !== undefined) && s("path", {
      d: pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.c ?? p.v).toFixed(2)}`).join(" "),
      fill: "none", stroke: "var(--lm-ref)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
    }),
    s("path", { d: line, fill: "none", stroke: "var(--lm-spark)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }),
  );
  wrap.append(svg);

  const last = pts[pts.length - 1];
  const tone = r.level === "notable" && r.tone === "good" ? "good" : r.level;
  wrap.append(h("span", { class: "spark-dot", style: `left:100%;top:${y(last.v)}px;background:${endColor[tone]}` }));

  if (interactive) {
    const cross = h("span", { class: "spark-cross", hidden: true });
    const hover = h("span", { class: "spark-dot spark-dot--hover", hidden: true });
    const tip = h("span", { class: "spark-tip", hidden: true });
    wrap.append(cross, hover, tip);
    const vs = vsName(r.card.spec.vs);
    wrap.addEventListener("pointermove", (e) => {
      const box = wrap.getBoundingClientRect();
      const i = Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (pts.length - 1));
      const p = pts[i];
      const left = `${x(i)}%`;
      cross.style.left = hover.style.left = tip.style.left = left;
      hover.style.top = `${y(p.v)}px`;
      tip.textContent = `${weekLabel(p.t)}: ${fmtValue(p.v, rawUnit(r.unit))}` +
        (p.c !== undefined ? ` · ${vs} ${fmtValue(p.c, rawUnit(r.unit))}` : "");
      tip.classList.toggle("spark-tip--end", i > pts.length * 0.7);
      tip.classList.toggle("spark-tip--start", i < pts.length * 0.3);
      cross.hidden = hover.hidden = tip.hidden = false;
    });
    wrap.addEventListener("pointerleave", () => { cross.hidden = hover.hidden = tip.hidden = true; });
  }
  return wrap;
}

/** The server may pre-scale ("Mio. CHF"); tooltips format raw values from the base unit. */
function rawUnit(unit: string): string {
  return unit.startsWith("Mio. ") ? unit.slice(5) : unit;
}

function ariaText(r: Result): string {
  const pts = r.series;
  if (!pts.length) return "Keine Daten";
  return `Verlauf über ${pts.length} Wochen, aktuell ${r.valueText} ${r.unit}`.trim();
}

export function bars(r: Result): HTMLElement {
  const groups = r.groups ?? [];
  const max = Math.max(...groups.map((g) => g.v), 1);
  return h("div", { class: "bars" },
    ...groups.map((g, i) =>
      h("div", { class: "bar-row" },
        h("span", { class: "bar-label", text: g.name }),
        h("span", { class: "bar-track" },
          h("span", { class: "bar-area" },
            h("span", { class: "bar" + (i === 0 ? " bar--top" : ""), style: `width:${Math.max(1, (g.v / max) * 100)}%` }),
          ),
          h("span", { class: "bar-value lm-num", text: fmtValue(g.v, rawUnit(r.unit)) }),
        ),
      ),
    ),
  );
}
