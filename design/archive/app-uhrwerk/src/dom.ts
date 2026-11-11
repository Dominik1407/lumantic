// Tiny DOM builders. h() for HTML, sv() for SVG; falsy children are skipped.

export type Kid = Node | string | number | null | undefined | false | Kid[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "text") el.textContent = String(v);
    else if (k === "style") el.style.cssText = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, kids);
  return el;
}

function append(el: Element, kids: Kid[]) {
  for (const c of kids) {
    if (Array.isArray(c)) append(el, c);
    else if (c !== null && c !== undefined && c !== false && c !== "") el.append(c instanceof Node ? c : String(c));
  }
}

const SVGNS = "http://www.w3.org/2000/svg";

export function sv(tag: string, attrs: Record<string, string | number | null | undefined> = {}, ...kids: (Node | string | null | undefined | false)[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of kids) if (c) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

// Line icons, 16 × 16, drawn with currentColor.
const ICONS: Record<string, string> = {
  heute: "M8 4.2V2M8 14v-2.2M4.2 8H2M14 8h-2.2M5.3 5.3 3.8 3.8M12.2 12.2l-1.5-1.5M5.3 10.7l-1.5 1.5M12.2 3.8l-1.5 1.5M8 10.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z",
  zeit: "M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 4.5V8l2.4 1.6M8 1.8V3M14.2 8H13M8 13v1.2M3 8H1.8",
  all: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  liq: "M8 2.2c2.3 3 3.9 5.1 3.9 7.2a3.9 3.9 0 0 1-7.8 0C4.1 7.3 5.7 5.2 8 2.2Z",
  kap: "M2.5 13.5h11M3.5 6.5h9M8 2.2 13 5H3l5-2.8ZM4.8 6.5v6M8 6.5v6M11.2 6.5v6",
  zins: "M3 13 13 3M4.6 6.3a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4ZM11.4 13.1a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z",
  bil: "M8 2.5v11M4 13.5h8M2.5 5h11M2.5 5 1 9h3l-1.5-4ZM13.5 5 12 9h3l-1.5-4Z",
  wachs: "M2 12.5 6 8.5l2.6 2.6L14 5.7M10.4 5.7H14v3.6",
  search: "M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4ZM11 11l3.2 3.2",
  pin: "m8 2 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1-3-2.9 4.1-.5L8 2Z",
  event: "M8 2.5 13.5 8 8 13.5 2.5 8 8 2.5Z",
  chevron: "M10 3.5 5.5 8l4.5 4.5",
  back: "M13 8H3.5M7.5 4 3.5 8l4 4",
  close: "m4 4 8 8M12 4l-8 8",
  play: "M5 3.2v9.6L12.6 8 5 3.2Z",
  pause: "M5.2 3.2v9.6M10.8 3.2v9.6",
  first: "M4 3.5v9M12.5 3.5 6.5 8l6 4.5v-9Z",
  last: "M12 3.5v9M3.5 3.5l6 4.5-6 4.5v-9Z",
  prev: "M10 3.5 5.5 8l4.5 4.5",
  next: "M6 3.5 10.5 8 6 12.5",
  keys: "M2 4.5h12v7H2zM4.5 7h1M7.5 7h1M10.5 7h1M5 9.5h6",
  why: "M6 6.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4M8 12.1v.2M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4Z",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
};

export function icon(name: string, size = 16): SVGElement {
  return sv("svg", { class: "ic", width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": 1.35, "stroke-linecap": "round", "stroke-linejoin": "round" },
    sv("path", { d: ICONS[name] || ICONS.event }));
}
