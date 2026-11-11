// Heute: the overview for this morning. What needs you, the daily values of
// the running month, and every dashboard as it stands today.
import { dailyChart, dailyFacts } from "../daily";
import { h, icon, sv } from "../dom";
import { evalAll, evaluate, levelCounts, streakStart, type Eval } from "../engine";
import { F, dayLong, dayMid, isoDay, parseDay, split } from "../format";
import { briefParts } from "../lumina";
import { DAYS, EVENTS, GROUPS, KPIS, N, PERIODS, SCOPES, SOURCE, scopeKpis, scopeOrder, type Kpi } from "../model";
import { openDashboard, showZeit } from "../nav";
import { NSS } from "../plot";
import { S, play, reduced, syncPlay } from "../time";
import { dots, kindVar, reg } from "../ui";

// Data arrives a business day later (T+1): today is the next business day after the last value.
export function todayDate() {
  const d = parseDay(DAYS.length ? DAYS[DAYS.length - 1] : isoDay(new Date()));
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() % 6 === 0);
  return d;
}

const SCOPE_ICON = (scope: string) => (["all", "liq", "kap", "zins", "bil", "wachs"].includes(scope) ? scope : "all");
export const scopeIcon = SCOPE_ICON;

// A small 24-month picture with limit and target, for the signal cards.
function miniTrend(k: Kpi, r: Eval) {
  const m = N - 1, a = Math.max(0, m - 23), vals = k.series.slice(a, m + 1), flow = k.kind === "flow";
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (flow) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const span = hi - lo || 1;
  for (const th of [k.limit, k.target]) if (th !== null && th > lo - span * 0.8 && th < hi + span * 0.8) { lo = Math.min(lo, th); hi = Math.max(hi, th); }
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;
  const W = 240, H = 64, X = (i: number) => (i / Math.max(1, vals.length - 1)) * W, Y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  const col = kindVar(r.kind === "calm" ? "info" : r.kind);
  const kids: SVGElement[] = [], labs: HTMLElement[] = [];
  const inside = (v: number) => Y(v) >= 0 && Y(v) <= H;
  const mark = (v: number, text: string, color: string) => {
    const y = (Y(v) / H) * 100;
    labs.push(h("span", { class: "plot-lab sc-mark" + (y < 30 ? " sc-mark--below" : ""), style: `top:${y.toFixed(1)}%;color:${color}`, text }));
  };
  if (k.limit !== null && inside(k.limit)) {
    kids.push(sv("line", { x1: 0, x2: W, y1: Y(k.limit), y2: Y(k.limit), stroke: "var(--alert)", "stroke-width": 1, ...NSS }));
    mark(k.limit, `${k.dir < 0 ? "Limit" : "Min."} ${F(k, k.limit)}`, "var(--alert)");
  }
  if (k.target !== null && inside(k.target)) {
    kids.push(sv("line", { x1: 0, x2: W, y1: Y(k.target), y2: Y(k.target), stroke: "var(--accent)", "stroke-width": 1, "stroke-dasharray": "4 3", ...NSS }));
    mark(k.target, `${k.dir < 0 ? "Warnung" : "Ziel"} ${F(k, k.target)}`, "var(--accent)");
  }
  if (flow) {
    const bw = (W / vals.length) * 0.6;
    vals.forEach((v, i) => kids.push(sv("rect", { x: X(i) * (vals.length - 1) / vals.length + (W / vals.length - bw) / 2, y: Math.min(Y(v), Y(0)), width: bw, height: Math.max(0.8, Math.abs(Y(0) - Y(v))),
      fill: v < 0 || (k.target !== null && v < k.target) ? "var(--alert)" : "var(--ink-2)", "fill-opacity": i === vals.length - 1 ? 1 : 0.5 })));
  } else {
    const d = "M" + vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" L");
    kids.push(sv("path", { d: `${d} L${W},${H} L0,${H} Z`, fill: col, "fill-opacity": 0.1 }), sv("path", { d, fill: "none", stroke: col, "stroke-width": 1.8, "stroke-linejoin": "round", ...NSS }),
      sv("circle", { cx: X(vals.length - 1), cy: Y(vals[vals.length - 1]), r: 3, fill: col }));
  }
  return h("div", { class: "sc-chart" }, sv("svg", { class: "sc-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" }, ...kids), labs);
}

function signalCard(r: Eval, i: number) {
  const k = r.k, [n, u] = split(k, r.cur), since = streakStart(k, N - 1);
  const group = GROUPS.find((g) => g.id === k.group)?.name || "";
  const el = h("article", { class: "panel sigcard", "data-level": r.kind, style: reduced ? "" : `animation-delay:${120 + i * 70}ms` }, reg(),
    h("div", { class: "sc-top" }, h("span", { class: "label", text: group }), h("span", { class: "pill", "data-level": r.kind }, h("i"), r.label)),
    h("h3", { class: "sc-name", text: k.name }),
    h("div", { class: "sc-val" }, n, h("small", { text: u })),
    h("div", { class: "sc-delta", text: [r.delta, r.yoyText].filter(Boolean).join(" · ") }),
    miniTrend(k, r),
    h("p", { class: "sc-why", text: r.answer + "." + (r.why ? " " + r.why + "." : "") }),
    h("div", { class: "sc-actions" },
      h("button", { class: "btn btn--accent", type: "button", onclick: () => openDashboard(k.group, k.id) }, `${group} öffnen`),
      r.kind !== "good" && since < N - 1
        ? h("button", { class: "btn", type: "button", title: "In der Zeitreise ansehen, wann es kippte", onclick: () => showZeit({ t: since }) }, icon("zeit", 14), ` Seit ${PERIODS.monat[since].label}`)
        : h("button", { class: "btn", type: "button", onclick: () => showZeit({ t: Math.max(0, N - 13) }) }, icon("zeit", 14), " Vor einem Jahr")));
  return el;
}

// Daily values get one decimal more than month-end figures.
function dayValue(k: Kpi, v: number): [string, string] {
  if (k.unit === "%") return [v.toFixed(1), "%"];
  if (k.unit === "Mrd") return [(v / 1000).toFixed(2), "Mrd. CHF"];
  return [(v < 0 ? "−" : "+") + Math.abs(v).toFixed(1), "Mio. CHF"];
}

function dailyCard(k: Kpi, i: number) {
  const f = dailyFacts(k)!;
  const [n, u] = dayValue(k, f.value);
  const plot = h("div", { class: "plot" }), legend = h("div", { class: "legend" });
  const r = evaluate(k, "monat", N - 1);
  const el = h("article", { class: "panel daycard", style: reduced ? "" : `animation-delay:${200 + i * 80}ms` }, reg(),
    h("div", { class: "sc-top" }, h("span", { class: "label", text: `${k.name} · ${f.head}` }), h("span", { class: "pill pill--quiet", title: "Tageswerte gelten bis zum Monatsabschluss als vorläufig" }, "vorläufig")),
    h("div", { class: "sc-val" }, n, h("small", { text: u })),
    h("div", { class: "sc-delta", text: [f.vsDay, f.vsMonth].filter(Boolean).join(" · ") }),
    plot, legend,
    h("button", { class: "linkish", type: "button", onclick: () => openDashboard(k.group, k.id) }, `Monatswert ${PERIODS.monat[N - 1].label}: ${F(k, r.cur)} · ${r.label} →`));
  return { el, draw: dailyChart(k, plot, legend) };
}

export const TODAY = {
  el: null as HTMLElement | null,
  rows: {} as Record<string, Record<string, HTMLElement>>,

  mount(app: HTMLElement) {
    const m = N - 1, today = todayDate(), c = levelCounts(m);
    const lastDay = DAYS[DAYS.length - 1];
    const signals = evalAll("monat", m).filter((r) => r.level === "alert" || r.level === "watch" || r.kind === "good");
    const memo = S.memo;
    const stat = (n: number, text: string, level: string) => (n ? h("span", { class: "pill", "data-level": level }, h("i"), `${n} ${text}`) : null);
    const hero = h("section", { class: "panel hero" }, reg(),
      h("div", { class: "hero-main" },
        h("span", { class: "label", text: `Tagesübersicht · ${dayLong(today)}` }),
        h("h1", { class: "hero-brief" }, ...briefParts(m, "all", (k) => openDashboard(k.group, k.id))),
        h("p", { class: "hero-meta" }, lastDay ? `Tageswerte per ${dayMid(lastDay)} · ` : "", `Monatswerte per ${PERIODS.monat[m].long} · ${SOURCE}`)),
      h("div", { class: "hero-side" },
        h("div", { class: "hero-stats" }, stat(c.alert, c.alert === 1 ? "braucht dich" : "brauchen dich", "alert"), stat(c.watch, "im Auge", "watch"), stat(c.good, c.good === 1 ? "gute Nachricht" : "gute Nachrichten", "good"),
          !c.alert && !c.watch ? h("span", { class: "pill" }, h("i"), "Alles ruhig") : null),
        h("div", { class: "hero-actions" },
          h("button", { class: "btn btn--accent btn--big", type: "button", onclick: () => showZeit() }, icon("zeit"),
            memo !== null ? ` Zeitreise fortsetzen: ${PERIODS.monat[memo].label}` : " Zeitreise: vor einem Jahr", h("kbd", { text: "Z" })),
          h("button", { class: "btn btn--big", type: "button", onclick: () => { showZeit({ t: 0, instant: true }); play(); } }, icon("play"), " Die Geschichte abspielen"))));

    const sections: HTMLElement[] = [hero];
    if (signals.length) sections.push(h("section", { class: "tsec" },
      h("div", { class: "tsec-head" }, h("h2", { text: "Signale" }), h("span", { class: "label", text: `Monatsabschluss ${PERIODS.monat[m].long}` })),
      h("div", { class: "sigcards" }, signals.map((r, i) => signalCard(r, i)))));

    const daily = KPIS.filter((k) => k.daily && DAYS.length > 1);
    const draws: ((mc: boolean, card: { first: boolean }) => boolean)[] = [];
    if (daily.length) {
      const cards = daily.map((k, i) => { const d = dailyCard(k, i); draws.push(d.draw); return d.el; });
      sections.push(h("section", { class: "tsec" },
        h("div", { class: "tsec-head" }, h("h2", { text: "Tageswerte" }), h("span", { class: "label", text: `Laufender Monat bis ${dayMid(lastDay)} · vorläufig` })),
        h("div", { class: "daycards" }, cards)));
    }

    this.rows = {};
    const dcards = scopeOrder().map((scope, i) => {
      const ks = scopeKpis(scope);
      this.rows[scope] = {};
      const rows = ks.map((k) => {
        const r = evaluate(k, "monat", m);
        const row = h("li", { "data-id": k.id }, h("i", { class: "dot", "data-level": r.kind === "calm" ? "calm" : r.kind }), h("span", { class: "dc-name", text: k.short }),
          h("span", { class: "num", text: F(k, r.cur) }), h("span", { class: "dc-delta", text: r.delta.replace(/ ggü\. .*$/, "") }));
        this.rows[scope][k.id] = row;
        return row;
      });
      return h("button", { class: "panel dcard" + (scope === "all" ? " dcard--all" : ""), type: "button", "data-scope": scope, style: reduced ? "" : `animation-delay:${260 + i * 50}ms`, onclick: () => openDashboard(scope) }, reg(),
        h("span", { class: "dc-head" }, h("span", { class: "dc-icon" }, icon(SCOPE_ICON(scope))), h("b", { text: SCOPES[scope] }), dots(levelCounts(m, scope)), h("kbd", { text: String(i + 1) })),
        h("ul", { class: "dc-rows" }, rows),
        h("span", { class: "dc-go label" }, "Öffnen →"));
    });
    sections.push(h("section", { class: "tsec" },
      h("div", { class: "tsec-head" }, h("h2", { text: "Dashboards" }), h("span", { class: "label", text: "Stand heute · Klick öffnet, Tasten 1 bis " + scopeOrder().length })),
      h("div", { class: "dcards" }, dcards)));

    const recent = [...EVENTS].sort((a, b) => b.t - a.t).slice(0, 3);
    if (recent.length) sections.push(h("section", { class: "tsec tsec--events" },
      h("span", { class: "label", text: "Zuletzt passiert" }),
      recent.map((e) => h("button", { class: "chip", type: "button", title: e.text, onclick: () => showZeit({ t: e.t }) }, icon("event", 12), ` ${e.title} · ${PERIODS.monat[e.t].label}`))));

    this.el = h("section", { class: "today view", "aria-label": "Tagesübersicht" }, sections);
    app.replaceChildren(this.el);
    draws.forEach((d) => d(true, { first: true }));
    syncPlay();
  },

  // Where each figure sits on its dashboard card, for the morph into tiles.
  originsFor(scope: string): Record<string, DOMRect> {
    const out: Record<string, DOMRect> = {};
    for (const [id, row] of Object.entries(this.rows[scope] || {})) out[id] = row.getBoundingClientRect();
    return out;
  },
};
