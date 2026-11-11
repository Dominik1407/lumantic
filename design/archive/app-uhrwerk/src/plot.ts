// Shared plot frame: a 600 × 200 SVG with grid, zones, ghost and solid layers,
// a reveal clip and HTML labels positioned in percent.
import { h, sv } from "./dom";

let uidN = 0;
export const uid = () => "u" + ++uidN;
export const NSS = { "vector-effect": "non-scaling-stroke" };
export const PART_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)"];

export const pl = (plot: HTMLElement, cls = "plot-lab") => { const s = h("span", { class: cls }); plot.append(s); return s; };
export const lineD = (pts: [number, number][], X: (v: number) => number, Y: (v: number) => number) =>
  "M" + pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(2)}`).join(" L");

export interface Frame {
  id: string;
  svg: SVGElement;
  clip: SVGElement;
  grad: SVGElement;
  zones: SVGElement;
  ghosts: SVGElement;
  solid: SVGElement;
  over: SVGElement;
  hi: HTMLElement;
  lo: HTMLElement;
  x0: HTMLElement;
  x1: HTMLElement;
  dot: HTMLElement;
}

export function seriesFrame(plot: HTMLElement): Frame {
  const id = uid();
  const clip = sv("rect", { x: 0, y: -20, width: 0, height: 240 });
  const grad = sv("linearGradient", { id: id + "g", x1: 0, y1: 0, x2: 0, y2: 1 }, sv("stop", { offset: 0, "stop-opacity": 0.3 }), sv("stop", { offset: 1, "stop-opacity": 0 }));
  const svg = sv("svg", { viewBox: "0 0 600 200", preserveAspectRatio: "none", "aria-hidden": "true" }, sv("defs", {}, grad, sv("clipPath", { id: id + "c" }, clip)));
  const grid = sv("g"), zones = sv("g"), ghosts = sv("g"), solid = sv("g", { "clip-path": `url(#${id}c)` }), over = sv("g");
  svg.append(grid, zones, ghosts, solid, over);
  for (let n = 1; n <= 3; n++) grid.append(sv("line", { x1: 0, x2: 600, y1: 12 + n * 44, y2: 12 + n * 44, stroke: "var(--ink)", "stroke-opacity": 0.06, "stroke-dasharray": "var(--dash)", ...NSS }));
  grid.append(sv("line", { x1: 0, x2: 600, y1: 188, y2: 188, stroke: "var(--line-2)", ...NSS }));
  plot.replaceChildren(svg);
  const hi = pl(plot), lo = pl(plot), x0 = pl(plot), x1 = pl(plot), dot = pl(plot, "plot-dot");
  hi.style.left = lo.style.left = "0";
  hi.style.top = "2px";
  lo.style.bottom = "16px";
  x0.style.left = "0";
  x0.style.bottom = "-2px";
  x1.style.right = "0";
  x1.style.bottom = "-2px";
  return { id, svg, clip, grad, zones, ghosts, solid, over, hi, lo, x0, x1, dot };
}

export function setGrad(fr: Frame, color: string) {
  fr.grad.querySelectorAll("stop").forEach((s) => s.setAttribute("stop-color", color));
}

// Places a label at a y position of the 200-unit plot, right aligned.
export function placeRight(lab: HTMLElement, y: number, text: string, color: string) {
  lab.textContent = text;
  lab.style.right = "0";
  lab.style.top = `calc(${(y / 200) * 100}% - 13px)`;
  lab.style.color = color;
  lab.hidden = y < 0 || y > 200;
}
