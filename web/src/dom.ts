// Small DOM builders for the TypeScript side (settings, empty state). The Kosmos parts have their own copy in 00-core.js.
type Kid = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Kid | Kid[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "text") el.textContent = String(v);
    else if (k === "style") el.style.cssText = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false && c !== "") el.append(c instanceof Node ? c : String(c));
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function sv(tag: string, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | null)[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c) el.append(c);
  return el;
}

export const $ = (id: string) => document.getElementById(id) as HTMLElement;
