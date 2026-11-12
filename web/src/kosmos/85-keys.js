// ═════ Kosmos · the keys: a small legend of every key of the room. A key pressed while it is open lights up. ═════
const keysEl = $("keys"), keysBtn = $("btn-keys");
// Each row: what the hand does and what happens. id ties a pressed key to its row.
const KEY_ROWS = () => [
  [tr("Orte", "Places"), [
    ["h", ["H"], tr("Heute", "Today")],
    ["n", ["1", "–", "9"], tr("Eine Themen-Seite", "A topic page")],
    ["0", ["0"], tr("Alle Seiten im Überblick", "All pages at a glance")],
    ["c", ["C"], tr("Sternkatalog", "Star catalogue")],
    ...(HOST.many() ? [["k", ["K"], tr("Alle Kosmen", "All Kosmen")]] : []),
  ]],
  [tr("Zeit", "Time"), [
    ["lr", ["←", "→"], tr("Eine Periode zurück, vor", "One period back, on")],
    ["slr", ["Shift", "←", "→"], tr("Ein Jahr zurück, vor", "One year back, on")],
    ["g", ["G"], tr("Raster: Tag bis Jahr", "Raster: day to year")],
    ["z", ["Z"], tr("Heute und Rückblick", "Today and looking back")],
    ["space", [tr("Leertaste", "Space")], tr("Die Geschichte abspielen", "Play the story")],
  ]],
  [tr("Lesen und bauen", "Read and build"), [
    ["wheel", [tr("Mausrad", "Wheel")], tr("Seite lesen, daneben zoomen", "Read the page, zoom beside it")],
    ["ud", ["↑", "↓"], tr("Weiterlesen", "Read on")],
    ["slash", ["/"], tr("Baustein einfügen", "Add a block")],
    ["tab", ["Tab"], tr("Luminas Vorschlag übernehmen", "Accept Lumina's suggestion")],
    ["del", [tr("Entf", "Del")], tr("Gewählten Baustein entfernen", "Remove the chosen block")],
  ]],
  [tr("Überall", "Everywhere"), [
    ["comma", [","], tr("Einstellungen", "Settings")],
    ["i", ["I"], tr("Die Idee", "The idea")],
    ["q", ["?"], tr("Diese Tasten", "These keys")],
    ["esc", ["Esc"], tr("Schliessen, was offen ist", "Close what is open")],
  ]],
];
function buildKeys() {
  let i = 0;
  const col = (groups) => h("div", { class: "keys-col" }, ...groups.map(([title, rows]) => h("section", { class: "keys-group" },
    h("h3", { text: title }),
    ...rows.map(([id, caps, what]) => h("div", { class: "keys-row", "data-key": id, style: `--i:${i++}` },
      h("span", { class: "keys-caps" }, ...caps.map((c) => (c === "–" ? h("span", { class: "keys-to", text: tr("bis", "to") }) : h("kbd", { class: "kc" + (c.length > 2 ? " is-wide" : ""), text: c })))),
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
