// App state and the time cursor. S.t is a fractional month; month N - 1 is today.
import { EVENTS, N, clamp, lerp, type Grain } from "./model";

export type View = "heute" | "zeit" | "dash";
export type Design = "atlas" | "zifferblatt" | "messtisch";

export const S = {
  view: "heute" as View,
  scope: null as string | null,
  focus: null as string | null,
  t: 0,
  playing: false,
  gliding: false,
  scrubbing: false,
  g: "monat" as Grain,
  edit: false,
  memo: null as number | null, // last historical month the person settled on: Z flips back to it
  design: "atlas" as Design,
};

export const month = () => clamp(Math.round(S.t), 0, N - 1);
export const isLive = () => month() === N - 1 && S.t > N - 1.5;

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function animate(dur: number, fn: (e: number) => void, ease = easeOut): () => void {
  if (reduced) { fn(1); return () => {}; }
  const t0 = performance.now();
  let stop = false;
  const step = () => {
    if (stop) return;
    const k = clamp((performance.now() - t0) / dur, 0, 1);
    fn(ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => { stop = true; };
}

// Hooks run on every time change; monthChanged is true when the whole month changed.
export const timeHooks = new Set<(monthChanged: boolean) => void>();
export const eventHooks = new Set<(e: (typeof EVENTS)[number]) => void>();
export const settleHooks = new Set<() => void>();
let lastMonth = -1;

export function setTime(t: number) {
  const before = lastMonth;
  S.t = clamp(t, 0, N - 1);
  const m = month();
  if (m !== before) {
    lastMonth = m;
    if (before >= 0) for (const e of EVENTS) if ((before < e.t && e.t <= m) || (m <= e.t && e.t < before)) for (const fn of eventHooks) fn(e);
  }
  for (const fn of timeHooks) fn(m !== before);
}

// Called when time comes to rest: remembers the moment for the Z toggle.
function settle() {
  if (month() < N - 1) S.memo = month();
  for (const fn of settleHooks) fn();
}

let glideStop: (() => void) | null = null;
export function glideTo(t: number, dur = 900, done?: () => void) {
  stopGlide();
  const from = S.t;
  if (Math.abs(from - t) < 1e-3 || reduced) { setTime(t); settle(); done?.(); return; }
  S.gliding = true;
  const stop = animate(dur, (e) => {
    setTime(lerp(from, t, e));
    if (e >= 1) { S.gliding = false; glideStop = null; settle(); done?.(); }
  }, easeInOut);
  glideStop = () => { stop(); S.gliding = false; glideStop = null; };
}
export const stopGlide = () => glideStop?.();

let playRaf = 0;
export function play() {
  if (S.playing) return;
  stopGlide();
  if (S.t >= N - 1.01) setTime(0);
  S.playing = true;
  syncPlay();
  let last = performance.now();
  const step = () => {
    if (!S.playing) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    setTime(S.t + dt * 7.5);
    if (S.t >= N - 1) { stopPlay(); return; }
    playRaf = requestAnimationFrame(step);
  };
  playRaf = requestAnimationFrame(step);
}

export function stopPlay() {
  if (!S.playing) return;
  S.playing = false;
  cancelAnimationFrame(playRaf);
  syncPlay();
  settle();
}
export const togglePlay = () => (S.playing ? stopPlay() : play());

export function syncPlay() {
  document.querySelectorAll<HTMLElement>("[data-play]").forEach((b) => {
    b.setAttribute("aria-pressed", String(S.playing));
    b.setAttribute("aria-label", S.playing ? "Anhalten" : "Geschichte abspielen");
    b.dataset.state = S.playing ? "pause" : "play";
  });
}

// Moves by whole months (or years) with a short glide.
export function step(months: number) {
  stopPlay();
  glideTo(clamp(month() + months, 0, N - 1), 320);
}
