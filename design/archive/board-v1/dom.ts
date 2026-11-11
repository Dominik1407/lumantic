// A very small DOM builder: h("div", {class: "x", onclick: fn}, child, "text").

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

function apply(el: Element, attrs: Attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** Animates elements with data-flip from their old to their new position. */
export function flip(root: HTMLElement, mutate: () => void) {
  const before = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => before.set(el.dataset.flip!, el.getBoundingClientRect()));
  mutate();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
    const old = before.get(el.dataset.flip!);
    const now = el.getBoundingClientRect();
    if (!old) {
      el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
      return;
    }
    const dx = old.left - now.left, dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}
