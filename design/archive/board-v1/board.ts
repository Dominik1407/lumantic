// The board: loud cards rise and lift, moving cards sit in a grid, calm ones
// collapse into rows. The order comes from the server; here it only takes form.
import type { Board, Result, Rule } from "./api";
import { flip, h } from "./dom";
import { vsName } from "./format";
import { bars, sparkline } from "./spark";

export interface View {
  open: Set<string>;     // cards with "Wie gerechnet?" open
  expanded: Set<string>; // calm rows opened
  highlight?: string;    // card just added
  stand: string;
}

export interface Handlers {
  remove(id: string): void;
  setRule(r: Result, rule: Rule | null): void;
  toggleHow(id: string): void;
  toggleRow(id: string): void;
}

export function renderBoard(root: HTMLElement, board: Board, view: View, on: Handlers) {
  const loud = board.cards.filter((c) => c.level === "alert");
  const moving = board.cards.filter((c) => c.level === "watch" || c.level === "notable" || c.level === "info");
  const calm = board.cards.filter((c) => c.level === "calm");

  const sections: HTMLElement[] = [];
  if (loud.length) sections.push(section("Braucht dich", loud.length, h("div", { class: "stack" }, ...loud.map((r) => bigCard(r, view, on)))));
  if (moving.length) sections.push(section("In Bewegung", moving.length, h("div", { class: "grid" }, ...moving.map((r) => midCard(r, view, on)))));
  if (calm.length) sections.push(section("Ruhig", calm.length, h("div", { class: "calm-list" }, ...calm.map((r) => calmRow(r, view, on)))));
  flip(root, () => root.replaceChildren(...sections));

  if (view.highlight) {
    const el = root.querySelector<HTMLElement>(`[data-id="${view.highlight}"]`);
    if (el) {
      el.classList.add("is-new");
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    }
  }
}

function section(label: string, count: number, body: HTMLElement) {
  return h("section", { class: "sec" },
    h("h2", { class: "sec-label lm-eyebrow" }, label, h("span", { class: "sec-count", text: count })),
    body,
  );
}

function statusEl(r: Result) {
  const kind = r.level === "notable" ? (r.tone === "good" ? "good" : "info") : r.level;
  return h("span", { class: `lm-status lm-status--${kind}` }, h("span", { class: "lm-dot" }), r.label);
}

function valueEl(r: Result, cls = "val") {
  return h("div", { class: cls }, r.valueText, r.unit && h("small", { text: r.unit }));
}

function removeBtn(r: Result, on: Handlers) {
  return h("button", { class: "lm-close", type: "button", title: "Karte entfernen", "aria-label": `Karte «${r.card.spec.short}» entfernen`, onclick: () => on.remove(r.card.id) }, "×");
}

function figure(r: Result, height: number) {
  if (r.error) return h("p", { class: "card-error", text: r.error });
  return r.card.spec.display === "bars" ? bars(r) : sparkline(r, height);
}

function bigCard(r: Result, view: View, on: Handlers) {
  const id = r.card.id;
  return h("article", { class: "lm-card lm-card--raised card card--big", "data-flip": id, "data-id": id },
    h("div", { class: "card-head" }, statusEl(r), removeBtn(r, on)),
    h("h3", { class: "q lm-display", text: r.card.spec.question }),
    h("div", { class: "big-body" },
      h("div", { class: "big-text" },
        h("p", { class: "answer", text: r.answer }),
        r.why && h("p", { class: "why", text: r.why }),
        r.delta && h("p", { class: "delta", text: r.delta }),
      ),
      h("div", { class: "big-figure" }, valueEl(r, "val val--hero"), figure(r, 76)),
    ),
    foot(r, view, on),
    view.open.has(id) && how(r, view),
  );
}

function midCard(r: Result, view: View, on: Handlers) {
  const id = r.card.id;
  return h("article", { class: "lm-card card", "data-flip": id, "data-id": id },
    h("div", { class: "card-head" }, statusEl(r), removeBtn(r, on)),
    h("h3", { class: "q", text: r.card.spec.question }),
    h("div", { class: "mid-figure" }, valueEl(r), r.delta && h("span", { class: "delta", text: r.delta })),
    h("p", { class: "answer answer--sm", text: r.answer }),
    r.why && h("p", { class: "why", text: r.why }),
    figure(r, 52),
    foot(r, view, on),
    view.open.has(id) && how(r, view),
  );
}

function calmRow(r: Result, view: View, on: Handlers) {
  const id = r.card.id;
  const open = view.expanded.has(id);
  return h("div", { class: "row" + (open ? " row--open" : ""), "data-flip": id, "data-id": id },
    h("button", { class: "row-main", type: "button", "aria-expanded": String(open), onclick: () => on.toggleRow(id) },
      h("span", { class: "row-q", text: r.card.spec.question }),
      h("span", { class: "row-answer", text: r.error ?? r.answer }),
      h("span", { class: "row-v lm-num" }, r.valueText, r.unit && h("small", { text: " " + r.unit })),
      r.error ? h("span") : sparkline(r, 22, false),
      h("span", { class: "chev", "aria-hidden": "true", text: "›" }),
    ),
    open && h("div", { class: "row-detail" },
      h("div", { class: "row-detail-text" },
        h("p", { class: "answer answer--sm", text: r.answer }),
        r.delta && h("p", { class: "delta", text: r.delta }),
      ),
      figure(r, 56),
      foot(r, view, on),
      view.open.has(id) && how(r, view),
      h("div", { class: "row-remove" }, h("button", { class: "lm-btn lm-btn--quiet", type: "button", onclick: () => on.remove(id) }, "Karte entfernen")),
    ),
  );
}

function foot(r: Result, view: View, on: Handlers) {
  const id = r.card.id;
  const open = view.open.has(id);
  return h("div", { class: "foot" },
    ruleEditor(r, on),
    h("button", { class: "howbtn", type: "button", "aria-expanded": String(open), onclick: () => on.toggleHow(id) },
      open ? "Berechnung ausblenden" : "Wie gerechnet?"),
  );
}

function ruleEditor(r: Result, on: Handlers) {
  const spec = r.card.spec;
  const g = spec.good ?? null;
  const vs = vsName(spec.vs);
  const unit = r.unit.replace(/^Mio\. /, "");
  const current = !g ? "none" : g.vs ? (g.op === "<=" ? "le-vs" : "ge-vs") : g.op === "<=" ? "le" : "ge";
  const options: [string, string][] = [["none", "keine Regel"], ["le", "höchstens"], ["ge", "mindestens"]];
  if (vs) options.push(["le-vs", `höchstens ${vs}`], ["ge-vs", `mindestens ${vs}`]);

  const select = h("select", { class: "lm-select rule-op", "aria-label": `Regel für «${spec.short}»` },
    ...options.map(([v, label]) => h("option", { value: v, selected: v === current, text: label })));
  const input = h("input", {
    class: "lm-input rule-val lm-num", type: "number", step: "any", inputmode: "decimal",
    "aria-label": "Zielwert", value: g?.value ?? Math.round(r.value * 10) / 10,
  });
  const unitEl = h("span", { class: "rule-unit", text: unit });
  const showValue = (v: string) => { input.hidden = unitEl.hidden = !(v === "le" || v === "ge"); };
  showValue(current);

  const commit = () => {
    const v = select.value;
    let rule: Rule | null = null;
    if (v === "le" || v === "ge") {
      const n = parseFloat(input.value);
      if (!isFinite(n)) return;
      rule = { op: v === "le" ? "<=" : ">=", value: n };
    } else if (v.endsWith("-vs")) {
      rule = { op: v.startsWith("le") ? "<=" : ">=", vs: true };
    }
    on.setRule(r, rule);
  };
  select.addEventListener("change", () => { showValue(select.value); commit(); });
  input.addEventListener("change", commit);

  return h("label", { class: "rule" }, h("span", { class: "rule-lead", text: "Gut ist, wenn" }), select, input, unitEl);
}

function how(r: Result, view: View) {
  const copy = h("button", { class: "lm-btn lm-btn--quiet copy", type: "button" }, "SQL kopieren");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(r.sql);
      copy.textContent = "Kopiert";
    } catch {
      copy.textContent = "Kopieren nicht möglich";
    }
    setTimeout(() => (copy.textContent = "SQL kopieren"), 1600);
  });
  return h("div", { class: "how" },
    h("p", { text: r.explain }),
    h("p", {}, h("b", { text: "Einstufung: " }), `${r.label}. ${r.reason}`),
    h("div", { class: "how-sql" },
      h("div", { class: "how-sql-head" }, h("span", { class: "lm-eyebrow", text: "Abfrage auf dem Goldlayer" }), copy),
      h("pre", {}, h("code", { text: r.sql })),
    ),
    h("p", { class: "how-meta", text: `Quelle ${r.source} · Stand ${view.stand}. Lumina hat nur die Struktur gesehen, keine Datenzeilen. Dieselben Daten ergeben immer dieselbe Zahl.` }),
  );
}
