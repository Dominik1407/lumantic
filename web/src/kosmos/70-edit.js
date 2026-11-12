// ═════ Kosmos · changing pages: menus, what a block can do, the insert line ═════
// One floating list serves the star menu, the slash menu and the figure picker.
// items: { label, hint, sub, run, keep } · { head } · { node }
const MENU = { open: false, items: [], sel: -1, opener: null, editor: null };
let toastTimer = 0;
function openMenu(anchor, items, opts = {}) {
  const el = $("menu"), runs = items.filter((it) => it.run);
  closeMenu();
  Object.assign(MENU, { open: true, items: runs, sel: runs.length ? 0 : -1, opener: opts.opener || null, editor: opts.editor || null });
  let n = 0;
  el.replaceChildren(...items.map((it) => (it.head ? h("div", { class: "mh", text: it.head }) : it.node ? it.node
    : h("button", { class: "mi", type: "button", role: "option", "data-i": n, "aria-selected": String(n++ === 0) }, h("span", { text: it.label }), it.hint ? h("small", { text: it.hint }) : null, it.sub ? h("em", { text: it.sub }) : null))));
  el.hidden = false;
  off = stage.getBoundingClientRect();
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor, w = el.offsetWidth, ht = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + ht > off.top + H - 8 && r.top - ht - 6 > off.top + 8) top = r.top - ht - 6;
  el.style.left = clamp(r.left - off.left, 12, Math.max(12, W - w - 12)) + "px";
  el.style.top = clamp(top - off.top, 8, Math.max(8, H - ht - 8)) + "px";
  if (opts.focus) { const f = el.querySelector(".segb, .mi"); if (f) f.focus(); }
}
function closeMenu() {
  if (!MENU.open) return false;
  Object.assign(MENU, { open: false, items: [], sel: -1, opener: null, editor: null });
  $("menu").hidden = true;
  return true;
}
function menuSelect(i) {
  MENU.sel = i;
  $("menu").querySelectorAll(".mi").forEach((b) => { const on = Number(b.dataset.i) === i; b.setAttribute("aria-selected", String(on)); if (on) b.scrollIntoView({ block: "nearest" }); });
}
function menuRun(i) {
  const it = MENU.items[i];
  if (!it) return;
  if (!it.keep) closeMenu();
  it.run();
}
function menuKey(e) {
  if (!MENU.open) return false;
  const n = MENU.items.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (n) menuSelect((MENU.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n); return true; }
  if (e.key === "Enter" || e.key === "Tab") { if (MENU.sel < 0) return false; e.preventDefault(); menuRun(MENU.sel); return true; }
  if (e.key === "Escape") { e.preventDefault(); closeMenu(); return true; }
  return false;
}
function wireMenu() {
  const el = $("menu");
  el.addEventListener("pointerdown", (e) => e.preventDefault()); // the caret stays in the editor
  el.addEventListener("click", (e) => { const b = e.target.closest(".mi"); if (b) menuRun(Number(b.dataset.i)); });
  el.addEventListener("pointermove", (e) => { const b = e.target.closest(".mi"); if (b && Number(b.dataset.i) !== MENU.sel) menuSelect(Number(b.dataset.i)); });
  el.addEventListener("keydown", (e) => { if (menuKey(e)) e.stopPropagation(); });
  document.addEventListener("pointerdown", (e) => { if (MENU.open && !el.contains(e.target) && !(MENU.opener && MENU.opener.contains(e.target))) closeMenu(); });
}
function toast(msg, undo) {
  const t = $("toast");
  t.replaceChildren(msg, ...(undo ? [h("button", { type: "button", onclick: () => { t.hidden = true; undo(); } }, tr("Rückgängig", "Undo"))] : []));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6500 : 3400);
}

// ───────────── What a block can do ─────────────
function flash(b) {
  const v = VIEWS.get(b.id);
  if (!v) return;
  v.el.classList.remove("flash");
  void v.el.offsetWidth;
  v.el.classList.add("flash");
  setTimeout(() => v.el.classList.remove("flash"), 1600);
}
// Brings a stretch of a page (in its own px) into the free area of the screen if it lies outside, without changing the zoom.
function revealY(pg, top, bottom) {
  if (M.p < 0.9) return;
  const p = PAD(), z = cam.z, oy = (pg.y - cam.y) * z + H / 2, y0 = oy + top * z, y1 = oy + bottom * z;
  if (y1 > H - p.b) panTo(cam.x, cam.y + Math.min(y1 - (H - p.b) + 24, Math.max(0, y0 - p.t)) / z);
  else if (y0 < p.t) panTo(cam.x, cam.y - (p.t - y0 + 20) / z);
}
function reveal(b) {
  const pg = pages.get(b.page);
  if (!pg) return;
  if (pg.dirty) measure(pg);
  revealY(pg, b.top, b.top + Math.max(b.h, 60));
}
// After a page appeared, the camera makes room: the new page comes into view, together with the page it came from when both fit.
function makeRoom(pg, from) {
  if (M.p < 0.9) return;
  const p = PAD(), aw = W - p.l - p.r, span = (q) => [q.x - PAGE_W / 2 - GUT - 12, q.x + PAGE_W / 2 + 12];
  let [x0, x1] = span(pg), top = pg.y;
  if (from && from !== pg) { const [f0, f1] = span(from); if (aw / (Math.max(x1, f1) - Math.min(x0, f0)) >= 0.74) { x0 = Math.min(x0, f0); x1 = Math.max(x1, f1); top = Math.min(top, from.y); } }
  const z = Math.min(cam.z, aw / (x1 - x0)), same = z >= cam.z - 0.001, s0 = (x0 - cam.x) * cam.z + W / 2, s1 = (x1 - cam.x) * cam.z + W / 2, sy = (pg.y - cam.y) * cam.z + H / 2;
  const inY = sy >= p.t - 4 && sy <= H - p.b - 140;
  if (same && inY && s0 >= p.l - 2 && s1 <= W - p.r + 2) return; // already in view
  flyTo({ z, x: (x0 + x1) / 2 - (p.l - p.r) / 2 / z, y: same && inY ? cam.y : top + (H / 2 - p.t - 24) / z });
}
function setForm(b, form) {
  const pg = pages.get(b.page);
  b.form = form;
  if (b.auto) pg.forms[b.k] = form;
  refreshBlock(b, "edit");
  save();
}
function setOpen(b, kind) {
  b.open = kind || null;
  refreshBlock(b, "edit");
  if (b.open) setTimeout(() => { if (blocks.has(b.id)) reveal(b); }, 500);
  save();
}
// Holds the month a block is showing on the block itself, or lets it run with the room again.
function toggleHold(b) {
  b.t = b.t !== null ? null : effM(b);
  refreshBlock(b, "edit");
  save();
}
function moveBlock(b, d) {
  const pg = pages.get(b.page), i = pg.blocks.indexOf(b.id), j = i + d;
  if (i < 0 || j < 0 || j >= pg.blocks.length) return;
  pg.blocks.splice(i, 1);
  pg.blocks.splice(j, 0, b.id);
  renderPage(pg, "edit");
  save();
}
// An own page that has lost its last block and has no name is gone.
function leaveEmptyPage(pg) {
  setTimeout(() => {
    const a = document.activeElement;
    if (!pages.has(pg.id) || pg.sys || pg.blocks.length || pg.title || a === pg.ins || a === pg.titleEl || (MENU.open && MENU.editor === pg.ins)) return;
    removePage(pg);
    save();
  }, 200);
}
function removeBlock(id, silent) {
  const b = blocks.get(id), pg = b && pages.get(b.page);
  if (!b || !pg || b.auto) return;
  const at = pg.blocks.indexOf(id), kept = { id: b.id, kind: b.kind, k: b.k, form: b.form, open: b.open, segs: b.segs, q: b.q, text: b.text, t: b.t, lift: b.lift }, was = { id: pg.id, title: pg.title, x: pg.x, y: pg.y, user: pg.user };
  dropBlock(id);
  const gone = !pg.sys && !pg.blocks.length && !pg.title;
  if (gone) removePage(pg); else renderPage(pg, "edit");
  save();
  if (silent) return;
  toast(b.kind === "note" ? tr("Notiz entfernt.", "Note removed.") : b.kind === "answer" ? tr("Antwort entfernt.", "Answer removed.") : tr(`${K[b.k].name} entfernt.`, `${K[b.k].name} removed.`), () => {
    const back = pages.get(was.id) || addPage(was);
    insertBlock(back, kept, at);
    renderPage(back, "edit");
    renderPlaces();
    save();
  });
}
// Puts a figure on a page as a block of its own. On Lumina's pages a calm figure leaves the quiet line for it.
function addFigure(pg, kid, o = {}) {
  const plain = !o.form && !o.open && (o.t === undefined || o.t === null), lift = !!pg.sys && plain && quietKpis(pg).some((k) => k.id === kid), q = pg.blocks.indexOf("q:" + pg.id);
  const b = insertBlock(pg, { id: newId("b"), kind: "kpi", k: kid, form: o.form || defForm(pg, kid), open: o.open || null, t: o.t === undefined ? null : o.t, lift }, o.at !== undefined ? o.at : lift && q >= 0 ? q : undefined);
  renderPage(pg, "edit");
  updateLabel(pg);
  if (!o.quiet) { reveal(b); flash(b); }
  save();
  return b;
}
function addNote(pg, segs, at) {
  const b = insertBlock(pg, { id: newId("b"), kind: "note", segs }, at);
  renderPage(pg, "edit");
  reveal(b);
  save();
  return b;
}
function acceptGhost(pg) {
  const g = blocks.get("x:" + pg.id);
  if (!g) return false;
  const at = pg.blocks.indexOf(g.id), kind = g.cid.split(":")[0], kid = g.k;
  dropBlock(g.id);
  pg.ghostQuiet = true;
  addFigure(pg, kid, { form: "diagramm", open: kind, at });
  return true;
}
function dismissGhost(pg) {
  const g = blocks.get("x:" + pg.id);
  if (!g) return;
  dismissed.add(pg.id + "|" + g.cid);
  pg.ghostQuiet = true;
  dropBlock(g.id);
  renderPage(pg, "edit");
  save();
}
// Sends a block to another page: Lumina's own blocks go as a copy, the person's blocks move.
function sendBlock(b, to, at) {
  const from = pages.get(b.page), copy = b.auto;
  if (!from || !to) return null;
  let nb;
  if (copy) nb = insertBlock(to, copyOf(b), at);
  else {
    from.blocks = from.blocks.filter((x) => x !== b.id);
    b.page = to.id; b.lift = false; b.under = false;
    const v = VIEWS.get(b.id);
    if (v && b.kind === "kpi") { v.el.remove(); VIEWS.delete(b.id); } // the «→ home» link depends on the page, so the view is made again
    if (at === undefined || at === null || at < 0 || at > to.blocks.length) to.blocks.push(b.id); else to.blocks.splice(at, 0, b.id);
    nb = b;
  }
  renderPage(to, "edit");
  if (!copy) { if (!from.sys && !from.blocks.length && !from.title) removePage(from); else if (from !== to) renderPage(from, "edit"); }
  renderPlaces();
  save();
  return nb;
}
// A new page must not lie over another one: it steps sideways, away from the page it would cover, until it is free.
function freeSpot(x, y) {
  const w = PAGE_W + GUT + 56;
  for (let n = 0; n < 8; n++) {
    const hit = [...pages.values()].find((q) => Math.abs(q.x - x) < w && y < q.y + Math.max(q.h, 220) + 40 && y + 260 > q.y - 40);
    if (!hit) break;
    x = hit.x + (x < hit.x ? -w : w);
  }
  return [x, y];
}
function newPage(wx, wy) {
  [wx, wy] = freeSpot(wx, wy);
  const pg = addPage({ id: newId("p"), x: Math.round(wx), y: Math.round(wy), user: true });
  renderPage(pg, "init");
  return pg;
}
function flyHome(kid) {
  const pg = pages.get(topicId(kid));
  closeMenu();
  flyTo(framePage(pg), 0, () => { const st = homeStar(kid); if (st && st.type === "block") flash(st.b); else if (st) { const q = blocks.get("q:" + pg.id); if (q) flash(q); } });
}
function openBlockMenu(b, anchor, byKey) {
  const pg = pages.get(b.page), k = b.kind === "kpi" ? K[b.k] : null, i = pg.blocks.indexOf(b.id), st = STARS.get("B:" + b.id);
  const items = [{ head: k ? k.name : b.kind === "note" ? tr("Notiz", "Note") : b.kind === "answer" ? tr("Antwort von Lumina", "Answer from Lumina") : tr("Ruhig", "Calm") }];
  if (k) items.push({ node: h("div", { class: "seg", role: "group", "aria-label": tr("Form", "Form") }, ...FORMS.map((f) =>
    h("button", { class: "segb", type: "button", "aria-pressed": String(f === (b.form || "satz")), onclick: () => { closeMenu(); setForm(b, f); } }, FORM_NAME[f]))) });
  if (i > 0) items.push({ label: tr("Nach oben", "Move up"), run: () => moveBlock(b, -1) });
  if (i < pg.blocks.length - 1) items.push({ label: tr("Nach unten", "Move down"), run: () => moveBlock(b, 1) });
  if (b.kind !== "quiet") items.push({ label: b.auto ? tr("Kopie auf Seite …", "Copy to page …") : tr("Auf Seite …", "To page …"), keep: true, run: () => openPageMenu(b, anchor, byKey) });
  const holdWhat = fine(G) ? GRAIN_NAME.monat : GRAIN_NAME[G];
  if (b.kind !== "answer") items.push(b.t !== null ? { label: tr("Wieder mitlaufen", "Follow the room again"), hint: tr("folgt dem Raum", "follows the room"), run: () => toggleHold(b) }
    : { label: tr(`${holdWhat} festhalten`, `Hold this ${holdWhat.toLowerCase()}`), hint: periodOf(effM(b)).label, run: () => toggleHold(b) });
  if (k && b.page !== topicId(b.k)) items.push({ label: tr("Zur Heimat fliegen", "Fly home"), hint: GROUPS[k.group], run: () => flyHome(b.k) });
  if (k) items.push({ label: tr("Im Sternkatalog", "In the star catalogue"), hint: "C", run: () => HOST.openCatalog(b.k) });
  if (!b.auto) items.push({ label: tr("Entfernen", "Remove"), hint: tr("Entf", "Del"), run: () => removeBlock(b.id) });
  selId = b.id;
  openMenu(anchor, items, { opener: st ? st.el : null, focus: !!byKey });
  invalidate();
}
function openPageMenu(b, anchor, byKey) {
  const others = [...pages.values()].filter((pg) => pg.id !== b.page), opener = MENU.opener;
  openMenu(anchor, [{ head: b.auto ? tr("Kopie auf Seite", "Copy to page") : tr("Auf Seite", "To page") }, ...others.map((pg) => ({ label: pageName(pg), hint: pg.sys ? "" : tr("eigene Seite", "own page"),
    run: () => { const nb = sendBlock(b, pg); if (nb) toast(tr(`${b.kind === "note" ? "Notiz" : K[b.k].name} liegt jetzt auf «${pageName(pg)}».`, `${b.kind === "note" ? "The note" : K[b.k].name} is now on «${pageName(pg)}».`)); } })),
    { label: tr("Neue Seite daneben", "New page beside it"), hint: "", run: () => { const from = pages.get(b.page), pg = newPage(from.x + PAGE_W + GUT + 70, from.y); sendBlock(b, pg); makeRoom(pg, pages.get(from.id)); } }], { opener, focus: !!byKey });
}
function openLeadMenu(pg, anchor, byKey) {
  if (pg.sys) return;
  openMenu(anchor, [{ head: pageName(pg) }, { label: tr("Seite benennen", "Name the page"), run: () => setTimeout(() => pg.titleEl.focus(), 30) },
    { label: tr("Seite entfernen", "Remove the page"), hint: pg.blocks.length ? `${pg.blocks.length} ${tr("Bausteine", "blocks")}` : "", run: () => { removePage(pg); save(); toast(tr("Seite entfernt.", "Page removed.")); } }], { opener: pg.stars[0] ? pg.stars[0].el : null, focus: !!byKey });
}

// ───────────── Writing: notes, live figures, the insert line ─────────────
function caretQuery(p) {
  const sel = getSelection(), n = sel.anchorNode;
  if (!sel.rangeCount || !sel.isCollapsed || !n || n.nodeType !== 3 || !p.contains(n)) return null;
  const mt = /\[\[([^\[\]]*)$/.exec(n.data.slice(0, sel.anchorOffset));
  return mt ? { node: n, start: mt.index, end: sel.anchorOffset, q: mt[1] } : null;
}
// «[[» offers the figures; the chosen one becomes a live chip in the text.
function openChipMenu(p, q, changed) {
  const f = fold(q.q.trim()), list = KPIS.filter((k) => !f || fold(`${k.name} ${k.long} ${k.id}`).includes(f));
  if (!list.length) { closeMenu(); return; }
  const r = document.createRange();
  r.setStart(q.node, q.start); r.setEnd(q.node, q.end);
  const b = r.getBoundingClientRect();
  openMenu(b.width || b.height ? b : p, [{ head: tr("Kennzahl einfügen", "Add a figure") }, ...list.map((k) => ({ label: k.name, hint: F(k, k.series[T.base]), run: () => insertChip(p, k, changed) }))], { editor: p });
}
function insertChip(p, k, changed) {
  const q = caretQuery(p);
  if (!q) return;
  const r = document.createRange(), space = document.createTextNode(" ");
  r.setStart(q.node, q.start); r.setEnd(q.node, q.end);
  r.deleteContents();
  r.insertNode(space);
  r.insertNode(chipEl(k, T.base));
  getSelection().collapse(space, 1);
  if (changed) changed();
}
// An editable paragraph: plain text only, Enter does not break the line, «[[» opens the figures.
function wireEditor(p, on) {
  p.addEventListener("input", () => {
    if (!p.textContent && !p.querySelector(".chip")) p.replaceChildren();
    if (on.input && on.input()) return;
    const q = caretQuery(p);
    if (q) openChipMenu(p, q, on.change); else if (MENU.editor === p) closeMenu();
    if (on.change) on.change();
  });
  p.addEventListener("keydown", (e) => {
    if (MENU.open && menuKey(e)) { e.stopPropagation(); return; }
    if (e.key === "Enter") { e.preventDefault(); if (on.enter) on.enter(); }
  });
  p.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " ")); });
  p.addEventListener("blur", () => { if (MENU.editor === p) closeMenu(); if (on.blur) on.blur(); });
}
function insMode(pg, note) {
  pg.insNote = note;
  pg.ins.dataset.ph = INS_PH[note ? 1 : 0];
}
// Lumina answers under the line: what she understood, and a way to correct her.
// The second action is «Lieber als Notiz ablegen» unless another label is given.
function say(pg, text, asNote, label) {
  pg.say.replaceChildren("Lumina: " + text, ...(asNote ? [" ", h("button", { class: "lk", type: "button", onclick: () => { asNote(); if (!label) say(pg, tr("Als Notiz abgelegt.", "Kept as a note.")); } }, label || tr("Lieber als Notiz ablegen", "Keep it as a note instead"))] : []));
  if (!reduced) pg.say.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 });
  clearTimeout(pg.sayTimer);
  pg.sayTimer = setTimeout(() => { pg.say.replaceChildren(); }, 9000);
  // what Lumina answers must be in view, also when the new block above it is tall
  setTimeout(() => { if (pages.has(pg.id) && pg.say.firstChild) { measure(pg); revealY(pg, pg.h - 150, pg.h + 6); } }, 560);
}
// What Lumina would put on this page next: her best views that are not there yet.
const suggestionsFor = (pg) => candidatesFor(scopeOf(pg), T.base).filter((c) => c.k && c.kind !== "compare" && CHARTS[c.kind] && viewsFor(K[c.k]).some((v) => v.kind === c.kind) && !pageHasView(pg, c.k, c.kind));
function openSlashMenu(pg, q) {
  const ins = pg.ins, f = fold(q.trim()), hit = (s) => !f || fold(s).includes(f), done = () => { ins.replaceChildren(); closeMenu(); };
  const sugg = f ? [] : suggestionsFor(pg).slice(0, 3).map((c) => ({ label: "✦ " + c.title, sub: shortWhy(movedMost(c.why)), run: () => { done(); addFigure(pg, c.k, { form: "diagramm", open: c.kind }); say(pg, tr(`${VIEW_NAME[c.kind]} von ${K[c.k].name} liegt jetzt auf der Seite.`, `${VIEW_NAME[c.kind]} of ${K[c.k].name} is now on the page.`)); } }));
  const tools = [{ label: tr("Notiz", "Note"), hint: tr("freier Text mit [[Kennzahlen]]", "free text with [[figures]]"), run: () => { ins.replaceChildren(); insMode(pg, true); ins.focus(); } },
    { label: tr("Diagramm", "Chart"), hint: tr("eine Kennzahl als Diagramm", "a figure as a chart"), keep: true, run: () => openMenu(ins, [{ head: tr("Diagramm · Kennzahl wählen", "Chart · pick a figure") }, ...KPIS.map((k) => ({ label: k.name, hint: k.long,
      run: () => { done(); addFigure(pg, k.id, { form: "diagramm" }); say(pg, tr(`${k.name} liegt als Diagramm auf der Seite. Die Ansicht wechselst du über dem Diagramm.`, `${k.name} is on the page as a chart. Change the view above the chart.`)); } }))], { editor: ins }) }].filter((t) => hit(t.label));
  const figs = KPIS.filter((k) => hit(`${k.name} ${k.long} ${SHORT[k.id]}`)).map((k) => ({ label: k.name, hint: F(k, k.series[T.base]), run: () => { done(); addFigure(pg, k.id); say(pg, tr(`${k.name} steht jetzt als eigener Baustein auf der Seite.`, `${k.name} is now a block of its own on the page.`)); } }));
  openMenu(ins, [...(sugg.length ? [{ head: tr("Lumina schlägt vor", "Lumina suggests") }, ...sugg] : []), ...(tools.length ? [{ head: tr("Baustein", "Block") }, ...tools] : []), ...(figs.length ? [{ head: tr("Kennzahl", "Figure") }, ...figs] : []),
    ...(sugg.length || tools.length || figs.length ? [] : [{ head: tr("Kein Baustein mit diesem Namen", "No block by that name") }])], { editor: ins });
}
// Enter on the insert line: a note, or a question that Lumina matches to a figure, a view and a month.
function commitInsert(pg) {
  const ins = pg.ins, segs = readNote(ins).map((s) => (s.t !== undefined ? { t: s.t.replace(/ /g, " ") } : s));
  const text = segs.map((s) => (s.t !== undefined ? s.t : K[s.k].name)).join("").trim();
  if (!text) return;
  if (!pg.insNote && text.startsWith("/")) { say(pg, tr("Diesen Baustein kenne ich nicht. «/» allein zeigt, was es gibt.", "I don't know that block. «/» alone shows what there is.")); return; }
  const clear = () => { ins.replaceChildren(); insMode(pg, false); }, asNote = () => addNote(pg, [{ t: text }]);
  if (pg.insNote || segs.some((s) => s.k)) { clear(); addNote(pg, segs); say(pg, tr("Als Notiz abgelegt.", "Kept as a note.")); return; }
  const u = understand(text, T.base);
  clear();
  if (!u.question) {
    const nb = asNote();
    // With the AI on, a statement still stays a note; it goes to Lumina only when the person asks for that.
    if (HOST.aiReady()) say(pg, tr("Als Notiz abgelegt. Mit einem Fragezeichen fragst du Lumina.", "Kept as a note. With a question mark you ask Lumina."), () => { removeBlock(nb.id, true); askLumina(pg, text); }, tr("Lieber Lumina fragen", "Ask Lumina instead"));
    else say(pg, tr("Als Notiz abgelegt. Mit einem Fragezeichen suche ich die passende Kennzahl.", "Kept as a note. With a question mark I look for the matching figure."));
    return;
  }
  if (HOST.aiReady()) { askLumina(pg, text); return; }
  keywordAnswer(pg, text, u, asNote, "");
}
// Without the AI Lumina matches words: a figure, a view and a month. No language model.
function keywordAnswer(pg, text, u, asNote, lead) {
  const pre = lead ? lead + " " : "";
  if (!u.ks.length) { asNote(); say(pg, pre + tr("Dazu finde ich keine Kennzahl. Ich habe es als Notiz abgelegt.", "I find no figure for that. I kept it as a note.")); return; }
  const k = u.ks[0], views = viewsFor(k), view = u.view && views.some((x) => x.kind === u.view) ? u.view : "trend", held = u.when !== null && u.when !== T.base ? u.when : null;
  addFigure(pg, k.id, { form: "satz", open: view, t: held });
  say(pg, pre + tr(`Verstanden: ${k.name}, ${VIEW_NAME[view]}${held !== null ? ", festgehalten auf " + periodOf(held).long : ""}.`, `Got it: ${k.name}, ${VIEW_NAME[view]}${held !== null ? ", held on " + periodOf(held).long : ""}.`)
    + (u.view && u.view !== view ? tr(` «${VIEW_NAME[u.view]}» gibt es für diese Kennzahl nicht.`, ` This figure has no «${VIEW_NAME[u.view]}».`) : ""), asNote);
}

// ───────────── Lumina with the AI: the server asks Claude, with the figures of the month ─────────────
const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
// What Lumina may know: the evaluated figures of one period in the room's raster, their last thirteen months and
// their parts. No data rows.
function factsFor(m) {
  return { title: TITLE, month: periodOf(m).long, figures: KPIS.map((k) => {
    const r = shownOf(k, m), d = driverOf(k, m);
    return { id: k.id, name: k.name, unit: k.unit === "%" ? "%" : unitOf(k).full || tr("Zahl", "number"), value: r.gap ? null : r2(r.cur), prev: r2(r.prev), target: r2(r.tgt), limit: r2(k.reg),
      level: r.level, label: r.label, run: r.run, driver: d ? `${d.name} ${d.text}` : "", last13: k.series.slice(Math.max(0, m - 12), m + 1).map(r2),
      parts: k.parts ? Object.keys(k.parts).map((name) => { const pp = r.i > 0 ? partPair(k, r, name) : null; return { name, value: pp ? r2(pp[0]) : null, prev: pp ? r2(pp[1]) : null }; }) : [] };
  }) };
}
// A view Lumina names that this figure does not have becomes the nearest one it has.
function viewFor(k, view) {
  const has = new Set(viewsFor(k).map((v) => v.kind)), want = view === "funnel" ? "parts" : view === "season" || view === "buffer" ? "trend" : view;
  return has.has(want) ? want : "trend";
}
function askLumina(pg, text) {
  const m = T.base;
  clearTimeout(pg.sayTimer);
  pg.say.replaceChildren(tr("Lumina denkt …", "Lumina is thinking …"));
  HOST.ask(text, DATA.months[m], factsFor(m)).then((res) => {
    if (!pages.has(pg.id)) return;
    const ab = insertBlock(pg, { id: newId("b"), kind: "answer", q: `${text} · ${periodOf(m).label}`, text: String(res.answer || "").trim() || tr("Dazu habe ich nichts gefunden.", "I found nothing on that.") });
    let n = 0;
    for (const sb of Array.isArray(res.blocks) ? res.blocks.slice(0, 3) : []) {
      const k = sb && K[sb.figure];
      if (!k) continue;
      const view = viewFor(k, sb.view), t = sb.month ? DATA.months.indexOf(sb.month) : -1;
      insertBlock(pg, { id: newId("b"), kind: "kpi", k: k.id, form: "diagramm", open: view, t: t >= 0 && t !== m ? t : null });
      n++;
    }
    renderPage(pg, "edit");
    renderPlaces();
    save();
    reveal(ab);
    flash(ab);
    say(pg, n ? tr(`Geantwortet, dazu ${n === 1 ? "ein Baustein" : n + " Bausteine"}.`, `Answered, with ${n === 1 ? "one block" : n + " blocks"}.`) : tr("Geantwortet.", "Answered."));
  }).catch((err) => {
    if (!pages.has(pg.id)) return;
    const asNote = () => addNote(pg, [{ t: text }]);
    if (err && err.status === 422) { say(pg, err.message, asNote); return; }
    const lead = err && err.status === 409 ? tr("Lumina ist ohne KI eingestellt.", "Lumina is set up without AI.")
      : tr(`Lumina ist gerade nicht erreichbar (${(err && err.message) || "keine Antwort"}). Ich habe nach Stichwörtern gesucht.`, `Lumina cannot be reached right now (${(err && err.message) || "no answer"}). I searched by keywords.`);
    keywordAnswer(pg, text, understand(text, m), asNote, lead);
  });
}
function focusInsert(pg, text) {
  const ins = pg.ins;
  ins.focus({ preventScroll: true });
  revealY(pg, pg.h - 70, pg.h + 10);
  if (!text) return;
  ins.textContent = text;
  getSelection().selectAllChildren(ins);
  getSelection().collapseToEnd();
  ins.dispatchEvent(new Event("input"));
}
function wireInsert(pg) {
  const ins = pg.ins;
  wireEditor(ins, {
    input: () => { if (!pg.insNote && ins.textContent.startsWith("/") && !ins.querySelector(".chip")) { openSlashMenu(pg, ins.textContent.slice(1)); return true; } return false; },
    enter: () => commitInsert(pg),
    blur: () => { if (!ins.textContent.trim() && !ins.querySelector(".chip")) { insMode(pg, false); leaveEmptyPage(pg); } },
  });
  // Tab on the empty line takes Lumina's suggestion, the way an editor completes a line.
  ins.addEventListener("keydown", (e) => { if (e.key === "Tab" && !e.shiftKey && !e.defaultPrevented && !MENU.open && !ins.textContent && acceptGhost(pg)) e.preventDefault(); });
}
