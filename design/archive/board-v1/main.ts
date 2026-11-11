import "./lumen/tokens.css";
import "./lumen/components.css";
import "./app.css";

import { api, type Board, type Meta, type Result, type Rule, type Spec } from "./api";
import { renderBoard, type Handlers, type View } from "./board";
import { h } from "./dom";
import { weekLabel } from "./format";
import { applyMode, applyTheme, loadMode, loadTheme, saveTheme, type Mode, type Theme } from "./lumen/theme";
import { openBrief, openCatalog, openDesign } from "./panels";

let theme: Theme = loadTheme();
let mode: Mode = loadMode();
applyTheme(theme);
applyMode(mode);

const state = { meta: null as Meta | null, board: null as Board | null, week: -1, busy: false };
const view: View = { open: new Set(), expanded: new Set(), stand: "" };

// ---- Layout ----
const workspace = h("span", { class: "ws", text: theme.workspace ?? "" });
const sourceName = h("span", { text: "Goldlayer" });
const sourceBtn = h("button", { class: "lm-pill", type: "button", title: "Was Lumina sieht" }, h("span", { class: "lm-dot src-dot" }), sourceName);
const prevBtn = h("button", { type: "button", "aria-label": "Vorherige Woche" }, "‹");
const nextBtn = h("button", { type: "button", "aria-label": "Nächste Woche" }, "›");
const weekText = h("span", { class: "wk lm-num" });
const stepper = h("div", { class: "stepper", role: "group", "aria-label": "Woche wählen" }, prevBtn, weekText, nextBtn);
const designBtn = h("button", { class: "lm-pill", type: "button" }, h("span", { class: "lm-dot design-dot" }), "Design");

const briefText = h("h1", { class: "brief-text lm-display" }, "Lumantic sammelt die Lage …");
const briefMeta = h("p", { class: "brief-meta" });

const askInput = h("input", {
  id: "ask", type: "text", autocomplete: "off", enterkeyhint: "send",
  placeholder: "Frag Lumina, z. B. «Sind die Marketingkosten im Budget?»", "aria-label": "Frage an Lumina",
});
const askBtn = h("button", { class: "lm-btn", type: "submit" }, "Fragen");
const askForm = h("form", { class: "ask" }, h("span", { class: "ask-glyph", "aria-hidden": "true" }, "✦"), askInput, askBtn);
const luminaState = h("span", { class: "lumina-state" });
const suggestions = h("div", { class: "suggestions" });
const briefBtn = h("button", { class: "lm-btn lm-btn--quiet", type: "button" }, "Lumina briefen");
const askMsg = h("p", { class: "ask-msg", role: "status", "aria-live": "polite" });

const boardEl = h("div", { class: "board" });
const empty = h("section", { class: "empty", hidden: true });
const footMeta = h("span", { class: "foot-meta" });
const resetBtn = h("button", { class: "lm-btn lm-btn--quiet", type: "button" }, "Demo zurücksetzen");

document.getElementById("app")!.replaceChildren(
  h("header", { class: "top" },
    h("div", { class: "brand" },
      h("span", { class: "mark", "aria-hidden": "true" }),
      h("span", { class: "word", text: "lumantic" }),
      workspace,
      h("span", { class: "slogan", text: "Quiet until it matters." }),
    ),
    h("nav", { class: "tools", "aria-label": "Werkzeuge" }, sourceBtn, stepper, designBtn),
  ),
  h("main", { class: "wrap" },
    h("section", { class: "brief" }, briefText, briefMeta),
    h("section", { class: "ask-zone", "aria-label": "Lumina fragen" },
      askForm,
      h("div", { class: "ask-meta" }, luminaState, suggestions, briefBtn),
      askMsg,
    ),
    empty,
    boardEl,
    h("footer", { class: "foot-note" }, footMeta, resetBtn),
  ),
);

// ---- Behaviour ----
const asOf = () => state.meta?.weeks[state.week];
const latest = () => state.meta ? state.week === state.meta.weeks.length - 1 : true;

function say(text: string, kind: "info" | "error" | "busy" = "info") {
  askMsg.className = "ask-msg ask-msg--" + kind;
  if (kind === "busy") askMsg.replaceChildren(h("span", { class: "thinking", "aria-hidden": "true" }, h("i"), h("i"), h("i")), text);
  else askMsg.textContent = text;
}

function setBusy(busy: boolean) {
  state.busy = busy;
  askBtn.disabled = busy;
  askInput.readOnly = busy;
}

const handlers: Handlers = {
  async remove(id) {
    await guard(() => api.remove(id));
    view.open.delete(id);
    view.expanded.delete(id);
    await load();
  },
  async setRule(r: Result, rule: Rule | null) {
    if (await guard(() => api.setRule(r.card.id, rule))) await load(r.card.id);
  },
  toggleHow(id) {
    view.open.has(id) ? view.open.delete(id) : view.open.add(id);
    draw();
  },
  toggleRow(id) {
    view.expanded.has(id) ? view.expanded.delete(id) : view.expanded.add(id);
    draw();
  },
};

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    say((e as Error).message, "error");
    return undefined;
  }
}

function draw(highlight?: string) {
  const b = state.board;
  if (!b) return;
  view.stand = b.stand;
  view.highlight = highlight;
  const isEmpty = b.cards.length === 0;
  empty.hidden = !isEmpty;
  if (isEmpty) {
    briefText.textContent = "Dein Board ist noch leer.";
  } else {
    briefText.replaceChildren(...b.brief.map((s) => (s.em ? h("em", { text: s.text }) : document.createTextNode(s.text))));
  }
  briefMeta.textContent = `${weekLabel(b.asOf)}${latest() ? "" : " (Rückblick)"} · Datenstand ${b.stand} · ${state.meta?.source ?? ""}`;
  weekText.textContent = weekLabel(b.asOf) + (latest() ? "" : " ·");
  prevBtn.disabled = state.week <= 0;
  nextBtn.disabled = latest();
  document.documentElement.classList.toggle("is-past", !latest());
  renderBoard(boardEl, b, view, handlers);
  view.highlight = undefined;
}

async function load(highlight?: string) {
  const b = await guard(() => api.board(asOf()));
  if (!b) return;
  state.board = b;
  draw(highlight);
  loadSuggestions();
}

async function loadSuggestions() {
  const specs = await api.suggestions().catch(() => [] as Spec[]);
  suggestions.replaceChildren(...specs.slice(0, 3).map((spec) => {
    const b = h("button", { class: "sugg", type: "button", text: spec.question });
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await guard(() => api.addCard(spec, asOf()));
      if (r) { say(`Neue Karte: «${r.card.spec.question}»`); await load(r.card.id); }
      b.disabled = false;
    });
    return b;
  }));
}

askForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = askInput.value.trim();
  if (!q || state.busy) return;
  setBusy(true);
  say("Lumina übersetzt deine Frage in eine Karte …", "busy");
  try {
    const r = await api.ask(q, asOf());
    askInput.value = "";
    say(`Neue Karte: «${r.card.spec.question}». ${r.label === "Ruhig" ? "Alles im Rahmen, sie reiht sich unten ein." : r.label + "."}`);
    await load(r.card.id);
  } catch (err) {
    say((err as Error).message, "error");
  } finally {
    setBusy(false);
  }
});

function step(delta: number) {
  if (!state.meta) return;
  const next = Math.min(state.meta.weeks.length - 1, Math.max(0, state.week + delta));
  if (next === state.week) return;
  state.week = next;
  load();
}
prevBtn.addEventListener("click", () => step(-1));
nextBtn.addEventListener("click", () => step(1));

sourceBtn.addEventListener("click", async () => {
  const cat = await guard(() => api.catalog());
  if (cat && state.meta) openCatalog(cat, state.meta, api.refreshCatalog);
});

designBtn.addEventListener("click", () =>
  openDesign(theme, mode,
    (t) => { theme = t; applyTheme(t); saveTheme(t); workspace.textContent = t.workspace ?? ""; },
    (m) => { mode = m; applyMode(m); },
  ));

const brief = () => openBrief(async (about, replace) => {
  const res = await api.brief(about, replace);
  await load();
  return res.added === 1 ? "Eine neue Karte ist auf deinem Board." : `${res.added} neue Karten sind auf deinem Board.`;
});
briefBtn.addEventListener("click", brief);

resetBtn.addEventListener("click", async () => {
  if (await guard(() => api.reset())) {
    view.open.clear();
    view.expanded.clear();
    say("Das Beispiel-Board ist wiederhergestellt.");
    await load();
  }
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, select");
  if (e.key === "/" && !typing) { e.preventDefault(); askInput.focus(); }
  if (!typing && state.meta && (e.key === "[" || e.key === "]")) step(e.key === "[" ? -1 : 1);
});

empty.append(
  h("h2", { class: "lm-display", text: "Briefen statt bauen." }),
  h("p", { text: "Erzähl Lumina, wer du bist und was du jede Woche wissen musst. Lumina schlägt dir die passenden Karten vor. Oder starte mit dem Beispiel aus dem Retail Banking." }),
  h("div", { class: "empty-actions" },
    h("button", { class: "lm-btn", type: "button", onclick: brief }, "Lumina briefen"),
    h("button", { class: "lm-btn lm-btn--ghost", type: "button", onclick: () => resetBtn.click() }, "Beispiel laden"),
  ),
);

async function init() {
  const meta = await guard(() => api.meta());
  if (!meta) {
    briefText.textContent = "Lumantic ist gerade nicht erreichbar.";
    briefMeta.textContent = "Läuft der Server? Im Projektordner: go run ./cmd/lumantic";
    return;
  }
  state.meta = meta;
  state.week = meta.weeks.length - 1;
  sourceName.textContent = meta.source;
  const claude = meta.lumina.mode === "claude";
  luminaState.className = "lumina-state" + (claude ? " lumina-state--on" : "");
  luminaState.replaceChildren(h("span", { class: "lm-dot" }), claude ? "Lumina mit Claude" : "Lumina im Beispielmodus");
  luminaState.title = claude ? `Modell ${meta.lumina.model}` : "Ohne Claude-Zugang versteht Lumina Fragen zu den Beispieldaten.";
  footMeta.textContent = `Adapter ${meta.adapter} · Dialekt ${meta.dialect} · ${claude ? meta.lumina.model : "Lumina im Beispielmodus"} · Beispieldaten`;
  await load();
}
init();
