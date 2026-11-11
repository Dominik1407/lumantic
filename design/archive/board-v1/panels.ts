// Side panels: what Lumina sees, the design studio, and the briefing.
import type { Catalog, Meta } from "./api";
import { h } from "./dom";
import {
  exportTheme, fontChoices, monoChoices, parseTheme, preloadPresetFonts, presets,
  type Mode, type Theme,
} from "./lumen/theme";

export function openDrawer(title: string, subtitle: string, body: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const closeBtn = h("button", { class: "lm-close", type: "button", "aria-label": "Schliessen" }, "×");
  const scrim = h("div", { class: "lm-scrim" });
  const panel = h("aside", { class: "lm-drawer", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "lm-drawer__head" }, h("div", {}, h("h2", { text: title }), subtitle && h("p", { text: subtitle })), closeBtn),
    h("div", { class: "lm-drawer__body" }, body),
  );
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  function close() {
    scrim.remove();
    panel.remove();
    document.removeEventListener("keydown", onKey);
    previous?.focus();
  }
  scrim.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(scrim, panel);
  const first = panel.querySelector<HTMLElement>(".lm-drawer__body input, .lm-drawer__body textarea, .lm-drawer__body button");
  (first ?? closeBtn).focus();
  return close;
}

const roleName = { time: "Zeit", dimension: "Kategorie", measure: "Kennzahl" } as const;

export function openCatalog(cat: Catalog, meta: Meta, refresh: () => Promise<Catalog>) {
  const list = h("div", { class: "tables" });
  const fill = (c: Catalog) => list.replaceChildren(...c.tables.map((t) =>
    h("section", { class: "tbl" },
      h("h3", { class: "tbl-name", text: t.name }),
      h("p", { class: "tbl-desc", text: t.desc || "Ohne Beschreibung" }),
      h("dl", { class: "cols" },
        ...t.columns.flatMap((c) => [
          h("dt", {}, h("code", { text: c.name }), h("span", { class: `role role--${c.role}`, text: roleName[c.role] })),
          h("dd", {},
            c.desc || "Ohne Beschreibung",
            c.unit && h("span", { class: "col-unit", text: ` · ${c.unit}` }),
            c.values?.length ? h("span", { class: "col-values", text: c.values.join(" · ") }) : null,
          ),
        ]),
      ),
    )));
  fill(cat);

  const status = h("p", { class: "panel-status", role: "status" });
  const reload = h("button", { class: "lm-btn lm-btn--ghost", type: "button" }, "Katalog neu laden");
  reload.addEventListener("click", async () => {
    reload.disabled = true;
    status.textContent = "Lade den Katalog …";
    try {
      fill(await refresh());
      status.textContent = "Katalog aktualisiert.";
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      reload.disabled = false;
    }
  });

  const lumina = meta.lumina.mode === "claude" ? `Claude (${meta.lumina.model})` : "Beispielmodus";
  openDrawer("Was Lumina sieht", cat.source, h("div", { class: "panel" },
    h("p", { class: "panel-lead", text: "Lumina kennt nur diese Struktur: Tabellen, Spalten, ihre Beschreibung und die Namen der Kategorien. Datenzeilen und Kundendaten sieht Lumina nie. Gerechnet wird direkt im Goldlayer." }),
    h("div", { class: "chips" },
      h("span", { class: "lm-chip", text: `Adapter: ${meta.adapter}` }),
      h("span", { class: "lm-chip", text: `SQL-Dialekt: ${meta.dialect}` }),
      h("span", { class: "lm-chip", text: `Lumina: ${lumina}` }),
    ),
    list,
    h("div", { class: "panel-actions" }, reload, status),
  ));
}

export function openDesign(current: Theme, mode: Mode, setTheme: (t: Theme) => void, setMode: (m: Mode) => void) {
  let theme = { ...current };
  const root = h("div", { class: "panel" });
  preloadPresetFonts();

  const update = (patch: Partial<Theme>) => {
    theme = { ...theme, ...patch, id: "custom", name: "Eigenes Design" };
    setTheme(theme);
    exportArea.value = exportTheme(theme);
    presetRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
  };

  // Replace the whole theme (preset or import) and bring every control in line.
  const replaceTheme = (t: Theme) => {
    theme = { ...t };
    setTheme(theme);
    presetRow.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === theme.id)));
    color.value = hex.value = theme.brand;
    ws.value = theme.workspace ?? "";
    for (const [sel, key] of selects) {
      if (![...sel.options].some((o) => o.value === theme[key])) sel.append(h("option", { value: theme[key], text: theme[key] }));
      sel.value = theme[key];
    }
    for (const [input, out, key, fmt] of ranges) {
      input.value = String(theme[key]);
      out.textContent = fmt(theme[key]);
    }
    exportArea.value = exportTheme(theme);
  };

  const presetRow = h("div", { class: "presets" }, ...presets.map((p) => {
    const btn = h("button", { class: "preset", type: "button", "data-id": p.id, "aria-pressed": String(p.id === theme.id) },
      h("span", { class: "preset-swatch", style: `background:${p.brand}` }),
      h("span", { class: "preset-name", text: p.name }),
      h("span", { class: "preset-sample", style: `font-family:"${p.display}"`, text: "Aa" }),
    );
    btn.addEventListener("click", () => replaceTheme(p));
    return btn;
  }));
  const selects: [HTMLSelectElement, "display" | "body" | "mono"][] = [];
  const ranges: [HTMLInputElement, HTMLOutputElement, "radius" | "density" | "tint", (v: number) => string][] = [];

  const modes: [Mode, string][] = [["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]];
  const modeRow = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Darstellung" }, ...modes.map(([m, label]) => {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(m === mode), text: label });
    b.addEventListener("click", () => {
      mode = m;
      setMode(m);
      modeRow.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    });
    return b;
  }));

  const color = h("input", { id: "lm-brand", type: "color", value: theme.brand, class: "color" });
  const hex = h("input", { id: "lm-brand-hex", class: "lm-input lm-num", value: theme.brand, maxlength: 7, "aria-label": "Markenfarbe als Hex" });
  color.addEventListener("input", () => { hex.value = color.value; update({ brand: color.value }); });
  hex.addEventListener("change", () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { color.value = hex.value; update({ brand: hex.value }); } });

  const fontSelect = (id: string, key: "display" | "body" | "mono", choices: string[]) => {
    const all = [...new Set([theme[key], ...choices])];
    const sel = h("select", { id, class: "lm-select" }, ...all.map((f) => h("option", { value: f, selected: f === theme[key], text: f })));
    sel.addEventListener("change", () => update({ [key]: sel.value }));
    selects.push([sel, key]);
    return sel;
  };

  const range = (id: string, key: "radius" | "density" | "tint", min: number, max: number, step: number, fmt: (v: number) => string) => {
    const out = h("output", { for: id, class: "lm-num", text: fmt(theme[key]) });
    const input = h("input", { id, type: "range", min, max, step, value: theme[key] });
    input.addEventListener("input", () => { const v = Number(input.value); out.textContent = fmt(v); update({ [key]: v }); });
    ranges.push([input, out, key, fmt]);
    return h("div", { class: "range" }, input, out);
  };

  const ws = h("input", { id: "lm-ws", class: "lm-input", value: theme.workspace ?? "", placeholder: "z. B. Musterbank" });
  ws.addEventListener("input", () => update({ workspace: ws.value || undefined }));

  const exportArea = h("textarea", { id: "lm-export", class: "lm-textarea code", readonly: true, rows: 9 });
  exportArea.value = exportTheme(theme);
  const copy = h("button", { class: "lm-btn lm-btn--ghost", type: "button" }, "Kopieren");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(exportArea.value); copy.textContent = "Kopiert"; } catch { exportArea.select(); }
    setTimeout(() => (copy.textContent = "Kopieren"), 1500);
  });
  const importArea = h("textarea", { id: "lm-import", class: "lm-textarea code", rows: 5, placeholder: '{ "brand": "#1f4fa3", "display": "IBM Plex Sans", … }' });
  const importMsg = h("p", { class: "panel-status", role: "status" });
  const apply = h("button", { class: "lm-btn", type: "button" }, "Design übernehmen");
  apply.addEventListener("click", () => {
    try {
      replaceTheme(parseTheme(importArea.value));
      importMsg.textContent = "Übernommen.";
    } catch (e) {
      importMsg.textContent = "Das passt noch nicht: " + (e as Error).message;
    }
  });

  const field = (label: string, id: string, control: HTMLElement) =>
    h("div", { class: "field" }, h("label", { for: id, text: label }), control);

  root.append(
    h("p", { class: "panel-lead", text: "Ein Corporate Design besteht in Lumen aus sieben Werten. Flächen, Linien, Schatten und der Dark Mode leiten sich daraus ab. Die Statusfarben bleiben fix, damit Rot überall dasselbe heisst." }),
    h("h3", { class: "lm-eyebrow", text: "Vorlagen" }), presetRow,
    h("h3", { class: "lm-eyebrow", text: "Darstellung" }), modeRow,
    h("h3", { class: "lm-eyebrow", text: "Eigene Werte" }),
    h("div", { class: "fields" },
      field("Markenfarbe", "lm-brand", h("div", { class: "color-row" }, color, hex)),
      field("Name neben dem Logo", "lm-ws", ws),
      field("Schrift für Überschriften", "lm-display", fontSelect("lm-display", "display", fontChoices)),
      field("Schrift für Text", "lm-body", fontSelect("lm-body", "body", fontChoices)),
      field("Schrift für Code", "lm-mono", fontSelect("lm-mono", "mono", monoChoices)),
      field("Ecken", "lm-radius", range("lm-radius", "radius", 0, 24, 1, (v) => `${v} px`)),
      field("Dichte", "lm-density", range("lm-density", "density", 0.85, 1.2, 0.05, (v) => `${Math.round(v * 100)} %`)),
      field("Markenton in den Grautönen", "lm-tint", range("lm-tint", "tint", 0, 10, 1, (v) => `${v} %`)),
    ),
    h("h3", { class: "lm-eyebrow", text: "Exportieren" }),
    exportArea, h("div", { class: "panel-actions" }, copy),
    h("h3", { class: "lm-eyebrow", text: "Importieren" }),
    importArea, h("div", { class: "panel-actions" }, apply, importMsg),
  );

  openDrawer("Design", "Corporate Design live anwenden", root);
}

export function openBrief(submit: (about: string, replace: boolean) => Promise<string>) {
  const text = h("textarea", {
    id: "brief-about", class: "lm-textarea", rows: 5,
    placeholder: "Ich leite die Filialen Zürich und Bern. Ich will wissen, ob wir genug Neukunden gewinnen, ob Kreditanträge liegen bleiben und ob die Kosten im Budget sind.",
  });
  const replace = h("input", { id: "brief-replace", type: "checkbox" });
  const status = h("p", { class: "panel-status", role: "status", "aria-live": "polite" });
  const go = h("button", { class: "lm-btn", type: "submit" }, "Board vorschlagen lassen");
  const form = h("form", { class: "panel" },
    h("p", { class: "panel-lead", text: "Erzähl Lumina in ein, zwei Sätzen, wer du bist und was du jede Woche wissen musst. Lumina schlägt dir daraus Karten vor, mit Regeln dafür, was gut ist." }),
    h("label", { for: "brief-about", class: "sr-only", text: "Deine Rolle und was dich interessiert" }),
    text,
    h("label", { class: "check", for: "brief-replace" }, replace, "Board neu beginnen und bestehende Karten entfernen"),
    h("div", { class: "panel-actions" }, go, status),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) { status.textContent = "Schreib kurz, wer du bist und was dich interessiert."; return; }
    go.disabled = true;
    status.replaceChildren(h("span", { class: "thinking", "aria-hidden": "true" }, h("i"), h("i"), h("i")), " Lumina stellt dein Board zusammen …");
    try {
      status.textContent = await submit(text.value.trim(), replace.checked);
      setTimeout(close, 900);
    } catch (err) {
      status.textContent = (err as Error).message;
    } finally {
      go.disabled = false;
    }
  });
  const close = openDrawer("Lumina briefen", "Briefen statt bauen", form);
}
