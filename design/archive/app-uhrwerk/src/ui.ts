// Small shared UI pieces: tooltip, toast, FLIP reordering, status dots.
import { h } from "./dom";
import type { Kind } from "./engine";
import { clamp } from "./model";
import { reduced } from "./time";

const KIND_VAR: Record<Kind, string> = { alert: "--alert", watch: "--watch", good: "--good", info: "--accent", calm: "--ink-2" };
export const kindVar = (kind: Kind) => `var(${KIND_VAR[kind] || "--ink-2"})`;

let tipEl: HTMLElement, toastEl: HTMLElement;
export function initOverlays() {
  tipEl = h("div", { class: "tip", hidden: true });
  toastEl = h("p", { class: "toast", role: "status", hidden: true });
  document.body.append(tipEl, toastEl);
}

export function showTip(head: string, body: string | Node, x: number, y: number) {
  tipEl.replaceChildren(h("small", { text: head }), body);
  tipEl.hidden = false;
  tipEl.style.left = clamp(x + 16, 8, innerWidth - tipEl.offsetWidth - 8) + "px";
  tipEl.style.top = clamp(y + 16, 8, innerHeight - tipEl.offsetHeight - 8) + "px";
}
export const hideTip = () => { if (tipEl) tipEl.hidden = true; };

// Wires a hover tooltip to any element.
export function tipOn(el: Element, head: string | (() => string), body: string | (() => string)) {
  el.addEventListener("pointerenter", (e) => {
    const ev = e as PointerEvent;
    showTip(typeof head === "function" ? head() : head, typeof body === "function" ? body() : body, ev.clientX, ev.clientY);
  });
  el.addEventListener("pointerleave", hideTip);
}

let toastTimer = 0;
export function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.style.animation = "none";
  void toastEl.offsetWidth;
  toastEl.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4200);
}

// Animates elements from their old to their new position after a DOM change.
export function flip(container: Element, selector: string, mutate: () => void) {
  const before = new Map<string, DOMRect>();
  container.querySelectorAll<HTMLElement>(selector).forEach((el) => before.set(el.dataset.id || "", el.getBoundingClientRect()));
  mutate();
  if (reduced) return;
  container.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const b = before.get(el.dataset.id || "");
    if (!b) return;
    const a = el.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}

export function dots(c: { alert: number; watch: number; good: number }) {
  const d = (level: string, n: number) => Array.from({ length: n }, () => h("i", { class: "dot", "data-level": level }));
  return h("span", { class: "dots" }, d("alert", c.alert), d("watch", c.watch), d("good", c.good));
}

export const reg = () => [h("span", { class: "reg tl" }), h("span", { class: "reg br" })];
