// ═════ Kosmos · the keys: a small legend of every key of the room. A key pressed while it is open lights up. ═════
const keysEl = $("keys"), keysBtn = $("btn-keys");
// Each row: what the hand does and what happens. id ties a pressed key to its row.
const KEY_ROWS = () => [
  ["Orte", [
    ["h", ["H"], "Heute"],
    ["n", ["1", "–", "9"], "Eine Themen-Seite"],
    ["0", ["0"], "Alle Seiten im Überblick"],
    ["c", ["C"], "Sternkatalog"],
    ...(HOST.many() ? [["k", ["K"], "Alle Kosmen"]] : []),
  ]],
  ["Zeit", [
    ["lr", ["←", "→"], "Eine Periode zurück, vor"],
    ["slr", ["Shift", "←", "→"], "Ein Jahr zurück, vor"],
    ["g", ["G"], "Raster: Tag bis Jahr"],
    ["z", ["Z"], "Heute und Rückblick"],
    ["space", ["Leertaste"], "Die Geschichte abspielen"],
  ]],
  ["Lesen und bauen", [
    ["wheel", ["Mausrad"], "Seite lesen, daneben zoomen"],
    ["ud", ["↑", "↓"], "Weiterlesen"],
    ["slash", ["/"], "Baustein einfügen"],
    ["tab", ["Tab"], "Luminas Vorschlag übernehmen"],
    ["del", ["Entf"], "Gewählten Baustein entfernen"],
  ]],
  ["Überall", [
    ["comma", [","], "Einstellungen"],
    ["i", ["I"], "Die Idee"],
    ["q", ["?"], "Diese Tasten"],
    ["esc", ["Esc"], "Schliessen, was offen ist"],
  ]],
];
function buildKeys() {
  let i = 0;
  const col = (groups) => h("div", { class: "keys-col" }, ...groups.map(([title, rows]) => h("section", { class: "keys-group" },
    h("h3", { text: title }),
    ...rows.map(([id, caps, what]) => h("div", { class: "keys-row", "data-key": id, style: `--i:${i++}` },
      h("span", { class: "keys-caps" }, ...caps.map((c) => (c === "–" ? h("span", { class: "keys-to", text: "bis" }) : h("kbd", { class: "kc" + (c.length > 2 ? " is-wide" : ""), text: c })))),
      h("span", { class: "keys-what", text: what }))))));
  const rows = KEY_ROWS();
  $("keys-grid").replaceChildren(col(rows.slice(0, 2)), col(rows.slice(2)));
}
function toggleKeys(force) {
  const open = force === undefined ? keysEl.hidden : force;
  if (open) { closeIdee(); buildKeys(); }
  keysEl.hidden = !open;
  keysBtn.setAttribute("aria-expanded", String(open));
}
const closeKeys = () => (keysEl.hidden ? false : (toggleKeys(false), true));
// Which row a pressed key belongs to.
function keyRow(e) {
  const k = e.key;
  if (/^[1-9]$/.test(k)) return "n";
  if (k === "ArrowLeft" || k === "ArrowRight") return e.shiftKey ? "slr" : "lr";
  if (k === "ArrowUp" || k === "ArrowDown" || k === "PageUp" || k === "PageDown") return "ud";
  return { " ": "space", "/": "slash", Tab: "tab", Delete: "del", Backspace: "del", ",": "comma", "?": "q" }[k] || k.toLowerCase();
}
// The key lights up in the legend, the way a key gives under the finger.
function flashKey(e) {
  if (keysEl.hidden) return;
  const row = keysEl.querySelector(`.keys-row[data-key="${CSS.escape(keyRow(e))}"]`);
  if (!row) return;
  row.classList.remove("is-hit");
  void row.offsetWidth;
  row.classList.add("is-hit");
  clearTimeout(row._t);
  row._t = setTimeout(() => row.classList.remove("is-hit"), 650);
}
keysBtn.addEventListener("click", () => { userInput(); toggleKeys(); });
$("keys-x").addEventListener("click", () => toggleKeys(false));
