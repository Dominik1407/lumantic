// Navigation between the three places: Heute (today's overview), Zeitreise
// (the dial) and dashboards. Z flips between now and the last moment in the
// past, in whatever place you are. Every place has an address, so the
// browser's back button and shared links work.
import { N, PERIODS, SLUG, clamp, monthFromKey, monthKey } from "./model";
import { updateShell } from "./shell";
import { S, glideTo, isLive, month, reduced, setTime, settleHooks, stopGlide, stopPlay } from "./time";
import { hideTip, toast } from "./ui";
import { DB } from "./views/dashboard";
import { OV } from "./views/dial";
import { TODAY } from "./views/today";

const main = () => document.getElementById("view") as HTMLElement;
const ONE_YEAR_BACK = () => Math.max(0, N - 13);
// Every navigation gets a number. A transition that finishes after the person
// has already gone elsewhere finds a newer number and steps aside.
let navId = 0;
let opening = 0; // navId of a dashboard that is still zooming in from the dial
let dialSeen = false;

function after(push: boolean) {
  updateShell();
  writeRoute(push);
}

// Switching to today is instant: a toggle used many times a day must not wait for an animation.
export function showHeute(push = true) {
  stopPlay();
  stopGlide();
  hideTip();
  navId++;
  S.view = "heute";
  S.scope = null;
  setTime(N - 1);
  TODAY.mount(main());
  after(push);
  window.scrollTo({ top: 0 });
}

export function showZeit(opts: { t?: number; instant?: boolean; push?: boolean } = {}) {
  stopPlay();
  hideTip();
  navId++;
  const from = S.view, scope = S.scope, first = !dialSeen;
  dialSeen = true;
  const target = clamp(opts.t ?? S.memo ?? ONE_YEAR_BACK(), 0, N - 1);
  if (opts.instant) setTime(target);
  S.view = "zeit";
  S.scope = null;
  // The long spin-in plays once; after that the dial is simply there.
  OV.mount(main(), first && from === "heute");
  if (from === "dash" && scope && !reduced) {
    const c = OV.clusterScreen(scope);
    OV.svg.style.transformOrigin = c ? `${c.x}px ${c.y}px` : "50% 50%";
    OV.svg.animate([{ transform: "scale(2.1)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
    OV.hub.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 250, fill: "backwards" });
  }
  after(opts.push !== false);
  window.scrollTo({ top: 0 });
  if (!opts.instant && Math.abs(target - S.t) > 0.01) glideTo(target, from === "zeit" ? 900 : first ? 1300 : 550);
}

// The overview that belongs to the current moment: Heute for today, the dial for the past.
export function showOverview() {
  if (isLive()) showHeute();
  else showZeit({ t: month() });
}

export function openDashboard(scope: string, focusId?: string) {
  stopPlay();
  hideTip();
  if (S.view === "dash" && S.scope === scope) {
    if (focusId) DB.focusTile(focusId);
    return;
  }
  if (opening && opening === navId) return;
  const id = ++navId;
  const origins: Record<string, DOMRect> = {};
  const fromDial = S.view === "zeit" && OV.built && OV.el.isConnected;
  if (fromDial) for (const [id, st] of Object.entries(OV.stars)) origins[id] = st.core.getBoundingClientRect();
  if (S.view === "heute") Object.assign(origins, TODAY.originsFor(scope));
  // Navigation must happen exactly once, even if the transition is interrupted.
  let done = false;
  // The zoom holds its last frame until the dashboard is in place. It is then
  // cancelled by hand: left alone, it would keep the dial invisible for good.
  const zoom: Animation[] = [];
  const go = () => {
    if (done) return;
    done = true;
    if (opening === id) opening = 0;
    if (id === navId) {
      S.view = "dash";
      S.scope = scope;
      S.focus = focusId || null;
      DB.mount(main(), origins);
      after(true);
    }
    zoom.forEach((a) => a.cancel());
  };
  if (fromDial && !reduced) {
    opening = id;
    const c = OV.clusterScreen(scope);
    OV.svg.style.transformOrigin = c ? `${c.x}px ${c.y}px` : "50% 50%";
    zoom.push(OV.hub.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }),
      OV.svg.animate([{ transform: "none", opacity: 1, filter: "none" }, { transform: "scale(2.1)", opacity: 0, filter: "blur(2px)" }], { duration: 480, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" }));
    zoom[1].finished.then(go, go);
    setTimeout(go, 700);
  } else go();
}

// Z: now ↔ then. On Heute it opens the dial at the remembered moment, on the
// dial it returns to Heute, in a dashboard it flips the time in place.
export function toggleTime() {
  if (S.view === "heute") return showZeit();
  if (S.view === "zeit") return showHeute();
  stopPlay();
  if (isLive()) {
    const t = S.memo ?? ONE_YEAR_BACK();
    glideTo(t, 900);
    toast(`${PERIODS.monat[t].long}. Z bringt dich zurück zu heute.`);
  } else {
    S.memo = month();
    goLive();
  }
}

export function goLive() {
  stopPlay();
  if (S.view === "zeit" || S.view === "dash") glideTo(N - 1, 900);
}

// Jump to a month from anywhere; on Heute this means a trip in the dial.
export function jumpTo(t: number) {
  if (S.view === "heute") showZeit({ t });
  else { stopPlay(); glideTo(clamp(t, 0, N - 1), 900); }
}

function routeHash() {
  const t = isLive() ? "" : "/" + monthKey(month());
  if (S.view === "heute") return "#/heute";
  if (S.view === "zeit") return "#/zeitreise" + t;
  return "#/" + SLUG[S.scope || "all"] + t;
}

export function writeRoute(push: boolean) {
  const target = routeHash();
  if (location.hash === target) return;
  if (push) history.pushState(null, "", target);
  else history.replaceState(null, "", target);
}

// Opens the place an address names, without animation.
export function applyRoute(hash: string, intro = false) {
  const [place, when] = hash.replace(/^#\/?/, "").split("/");
  const t = when ? monthFromKey(when) : NaN;
  const tt = Number.isFinite(t) ? clamp(t, 0, N - 1) : N - 1;
  if (tt < N - 1) S.memo = tt;
  const scope = Object.keys(SLUG).find((s) => SLUG[s] === place);
  stopPlay();
  stopGlide();
  navId++;
  setTime(tt);
  if (place === "zeitreise") {
    S.view = "zeit";
    S.scope = null;
    OV.mount(main(), intro);
  } else if (scope) {
    S.view = "dash";
    S.scope = scope;
    S.focus = null;
    DB.mount(main(), {});
  } else {
    S.view = "heute";
    S.scope = null;
    setTime(N - 1);
    TODAY.mount(main());
  }
  updateShell();
  writeRoute(false);
}

settleHooks.add(() => { if (S.view !== "heute") writeRoute(false); });
window.addEventListener("popstate", () => applyRoute(location.hash));
