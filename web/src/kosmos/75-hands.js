// ═════ Kosmos · hands: pan, pinch, wheel, grabbing stars, keys, places, time ═════
const ptrs = new Map();
let drag = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 }, starDrag = null, introTimers = [], started = false, panEnd = 0;
let untouched = true;
function userInput() { untouched = false; if (introTimers.length) { introTimers.forEach(clearTimeout); introTimers = []; } }

// ───────────── The canvas: drag empty space or text to pan, two fingers to zoom, double-click for a new page ─────────────
stage.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || e.target.closest("#lens")) return;
  userInput();
  lensSel = false;
  off = stage.getBoundingClientRect();
  const star = e.target.closest(".star");
  if (star) { starDown(e, STARS.get(star.dataset.star)); return; }
  if (e.target.closest("[contenteditable='true'], .when, .ruler, .play")) return;
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], [wx, wy] = toWorld((a[0] + b[0]) / 2 - off.left, (a[1] + b[1]) / 2 - off.top);
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: cam.z, wx, wy, mx: (a[0] + b[0]) / 2 - off.left, my: (a[1] + b[1]) / 2 - off.top, dir: 0 };
    clearTimeout(detentTimer);
    drag = null;
    stopCamera();
    stage.classList.remove("is-pan");
    return;
  }
  closeIdee();
  closeKeys();
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  drag = { pid: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, vx: 0, vy: 0, vt: performance.now(),
    onPage: !!e.target.closest(".page, .plabel"), inter: !!e.target.closest("button, a, [role='button']") };
});
stage.addEventListener("pointermove", (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], mx = (a[0] + b[0]) / 2 - off.left, my = (a[1] + b[1]) / 2 - off.top;
    const z1 = clamp((pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.d, ZMIN, ZMAX);
    if (Math.abs(z1 - cam.z) > cam.z * 0.004) pinch.dir = z1 > cam.z ? 1 : -1;
    pinch.mx = mx; pinch.my = my;
    cam.z = z1;
    cam.x = pinch.wx - (mx - W / 2) / cam.z; cam.y = pinch.wy - (my - H / 2) / cam.z;
    invalidate();
    return;
  }
  if (!drag || drag.pid !== e.pointerId) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    stopCamera();
    closeMenu();
    stage.classList.add("is-pan");
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ }
  }
  const dx = (e.clientX - drag.lx) / cam.z, dy = (e.clientY - drag.ly) / cam.z, now = performance.now(), dt = Math.max(1, now - drag.vt);
  drag.lx = e.clientX; drag.ly = e.clientY;
  cam.x -= dx; cam.y -= dy;
  drag.vx = lerp(drag.vx, -dx / dt, 0.5); drag.vy = lerp(drag.vy, -dy / dt, 0.5); drag.vt = now;
  invalidate();
});
function release(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2 && pinch) {
    // two fingers let go between constellation and page: the zoom carries on the way they were heading
    const pz = pinch;
    pinch = null;
    if (halfWay(cam.z)) { lastZoom = { sx: pz.mx, sy: pz.my, dir: pz.dir || (cam.z >= pz.z ? 1 : -1) }; detent(); }
  }
  if (!drag || drag.pid !== e.pointerId) return;
  const d = drag;
  drag = null;
  stage.classList.remove("is-pan");
  if (d.moved) { panEnd = performance.now(); if (panEnd - d.vt < 70) glide(d.vx, d.vy); return; }
  if (e.type === "pointercancel" || d.inter) return;
  const now = performance.now(), dbl = now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 14;
  lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY };
  if (d.onPage) return;
  if (dbl) startPage(e.clientX - off.left, e.clientY - off.top);
  else if (selId) { selId = null; invalidate(); }
}
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
// A pan that began on a statement or a button must not end as a click on it.
stage.addEventListener("click", (e) => { if (performance.now() - panEnd < 120) { e.stopPropagation(); e.preventDefault(); } }, true);
// A new page begins where the person double-clicked, with the caret in its insert line.
function startPage(sx, sy) {
  const [wx, wy] = toWorld(sx, sy), close = M.p >= 0.9;
  const pg = close ? newPage(wx + PAGE_W / 2, wy - 16) : newPage(wx, wy - CY);
  const focus = () => setTimeout(() => { if (pages.has(pg.id)) pg.ins.focus({ preventScroll: true }); }, 90);
  if (close) { makeRoom(pg, pages.get(activeId) || null); focus(); } else flyTo(framePage(pg), 0, focus);
}
// The open page under a point of the screen, with the margin where its stars stand.
function pageUnder(sx, sy) {
  if (cam.z < Z_NEAR) return null;
  const z = cam.z;
  for (const pg of pages.values()) if (pg.open && sx >= pg.ox - (GUT + 12) * z && sx <= pg.ox + (PAGE_W + 12) * z && sy >= pg.oy && sy <= pg.oy + pg.h * z) return pg;
  return null;
}
// The wheel zooms at the cursor. Over an open page that is longer than the screen it scrolls the page; beside the
// page it zooms again. A gesture that began as a zoom or a scroll stays one until the hand rests. Over the lens it
// turns the lens' month instead.
let wheelWas = { kind: "", t: 0 };
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  userInput();
  const sx = e.clientX - off.left, sy = e.clientY - off.top, d = e.deltaY || e.deltaX, now = performance.now();
  if (lens.k > 0.5 && !diving && Math.hypot(sx - lens.x, sy - lens.y) <= lens.vr + 18) {
    wheelAcc += d;
    const steps = Math.trunc(wheelAcc / 100);
    if (steps) { wheelAcc -= steps * 100; setLensMonth(e.shiftKey ? lens.m - 12 * steps : shiftBy(lens.m, -steps)); }
    return;
  }
  closeMenu();
  flashKey({ key: "wheel" });
  const going = now - wheelWas.t < 220 ? wheelWas.kind : "", pg = !e.ctrlKey && going !== "zoom" ? pageUnder(sx, sy) || (going === "scroll" ? pages.get(activeId) : null) : null;
  const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
  if (pg && scrollPage(pg, e.deltaY * px)) { wheelWas = { kind: "scroll", t: now }; return; }
  wheelWas = { kind: "zoom", t: now };
  zoomAt(sx, sy, Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0016)));
}, { passive: false });

// ───────────── Stars: grab one and you hold its block ─────────────
function starDown(e, st) {
  if (!st) return;
  e.preventDefault();
  starDrag = { st, pid: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mode: null, copy: false, only: null, target: null, px: st.pg.x, py: st.pg.y };
  try { st.el.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ }
}
function beginStarDrag(d) {
  const st = d.st, b = st.b;
  closeMenu();
  if (st.type === "lead") { d.mode = "page"; stopCamera(); return; }
  if (b.kind === "ghost") return;
  d.mode = "block";
  d.only = st.type === "block" && b.kind === "quiet" ? st.pg : null; // the quiet line stays on its page
  d.copy = !d.only && (st.type === "chip" || b.auto);
  const k = st.type === "chip" ? K[st.k] : b.kind === "kpi" ? K[b.k] : null, m = st.type === "chip" && st.under ? lens.m : effM(b);
  $("carry").replaceChildren(k ? `${SHORT[k.id]} ${compact(k, k.series[m])}` : b.kind === "note" ? tr("Notiz", "Note") : tr("Ruhig", "Calm"), ...(d.copy ? [h("small", { text: tr("Kopie", "Copy") })] : []));
  $("carry").hidden = false;
  st.el.classList.add("is-drag");
  if (!seenHint) { seenHint = true; save(); }
}
function hideMarks() { for (const pg of pages.values()) if (!pg.mark.hidden) pg.mark.hidden = true; }
// Which page would take the block, and where in it.
function dropTarget(sx, sy, d) {
  const z = cam.z, st = d.st;
  if (M.p < 0.5) {
    // far away: the nearest constellation takes the block at its end
    let best = null, bd = narrow() ? 74 : 124;
    for (const pg of pages.values()) { const lead = pg.stars[0], dist = lead ? Math.hypot(lead.x - sx, lead.y - sy) : Infinity; if (dist < bd && (!d.only || d.only === pg)) { bd = dist; best = pg; } }
    return best ? { pg: best, at: best.blocks.length, y: null } : null;
  }
  for (const pg of pages.values()) {
    if (!pg.vis || (d.only && d.only !== pg)) continue;
    const lx = (sx - pg.ox) / z, ly = (sy - pg.oy) / z;
    if (lx < -GUT - 44 || lx > PAGE_W + 40 || ly < -36 || ly > pg.h + 30) continue;
    const list = blocksOf(pg).filter((b) => st.type === "chip" || b !== st.b);
    let at = list.length, y = list.length ? list[list.length - 1].top + list[list.length - 1].h + 15 : pg.head.offsetHeight - 6;
    for (let i = 0; i < list.length; i++) if (ly < list[i].top + list[i].h / 2) { at = i; y = list[i].top - 15; break; }
    return { pg, at, y };
  }
  return null;
}
function cancelStarDrag(d) {
  d.st.el.classList.remove("is-drag");
  $("carry").hidden = true;
  hideMarks();
  if (d.mode === "page") { d.st.pg.x = d.px; d.st.pg.y = d.py; for (const p of pages.values()) seats(p); invalidate(); }
}
function endStarDrag(d, sx, sy) {
  const st = d.st, src = st.pg, b = st.b, t = d.target;
  st.el.classList.remove("is-drag");
  $("carry").hidden = true;
  hideMarks();
  if (d.mode === "page") { src.user = true; save(); return; }
  if (d.mode !== "block" || (d.only && !t) || (t && t.y === null && t.pg === src)) return; // far away, a star dropped on its own constellation stays
  let to, at, fresh = false;
  if (t) { to = t.pg; at = t.at; }
  else {
    fresh = true;
    // empty space: the block starts a page of its own, with its star where it was dropped
    const [wx, wy] = toWorld(sx, sy);
    to = M.p < 0.5 ? newPage(wx, wy - CY) : newPage(wx + GUT + PAGE_W / 2, wy - 67);
    at = 0;
  }
  if (st.type === "chip") {
    if (to === src) addFigure(src, st.k, { at });
    else { const calm = stateOf(K[st.k], T.base).level === "calm"; insertBlock(to, { id: newId("b"), kind: "kpi", k: st.k, form: calm ? "zahl" : "satz", t: st.under ? lens.m : null }, at); renderPage(to, "edit"); }
  } else if (to === src) {
    src.blocks = src.blocks.filter((id) => id !== b.id);
    src.blocks.splice(Math.min(at, src.blocks.length), 0, b.id);
    renderPage(src, "edit");
  } else sendBlock(b, to, at);
  if (fresh && pages.has(to.id)) makeRoom(to, pages.get(src.id));
  renderPlaces();
  save();
}
function starClick(st, byKey) {
  const pg = st.pg;
  if (MENU.open && MENU.opener === st.el) { closeMenu(); return; }
  if (M.p < 0.5) { flyTo(framePage(pg), 0, () => { if (st.type === "block" && blocks.has(st.b.id) && st.b.kind !== "ghost") flash(st.b); }); return; }
  const anchor = { left: st.x + off.left - 8, right: st.x + off.left + 8, top: st.y + off.top - 9, bottom: st.y + off.top + 9 };
  if (st.type === "lead") openLeadMenu(pg, anchor, byKey);
  else if (st.type === "chip") addFigure(pg, st.k);
  else if (st.b.kind === "ghost") acceptGhost(pg);
  else openBlockMenu(st.b, anchor, byKey);
}
const starsEl = $("stars");
starsEl.addEventListener("pointermove", (e) => {
  const d = starDrag;
  if (!d || d.pid !== e.pointerId) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.moved = true;
    beginStarDrag(d);
  }
  const sx = e.clientX - off.left, sy = e.clientY - off.top;
  if (d.mode === "page") {
    const pg = d.st.pg;
    pg.x += (e.clientX - d.lx) / cam.z; pg.y += (e.clientY - d.ly) / cam.z;
    d.lx = e.clientX; d.ly = e.clientY;
    for (const p of pages.values()) seats(p);
    invalidate();
  } else if (d.mode === "block") {
    const c = $("carry");
    c.style.transform = `translate(${Math.min(sx + 14, W - c.offsetWidth - 8).toFixed(0)}px,${(sy + 12).toFixed(0)}px)`;
    d.target = dropTarget(sx, sy, d);
    hideMarks();
    if (d.target && d.target.y !== null) { d.target.pg.mark.style.top = d.target.y.toFixed(0) + "px"; d.target.pg.mark.hidden = false; }
  }
});
function starUp(e) {
  const d = starDrag;
  if (!d || d.pid !== e.pointerId) return;
  starDrag = null;
  if (e.type === "pointercancel") { cancelStarDrag(d); return; }
  if (!d.moved) starClick(d.st, false); else endStarDrag(d, e.clientX - off.left, e.clientY - off.top);
}
starsEl.addEventListener("pointerup", starUp);
starsEl.addEventListener("pointercancel", starUp);
starsEl.addEventListener("click", (e) => { const s = e.target.closest(".star"), st = s && STARS.get(s.dataset.star); if (st && e.detail === 0) { off = stage.getBoundingClientRect(); starClick(st, true); } });
starsEl.addEventListener("pointerover", (e) => { const s = e.target.closest(".star"); if (s && hotStar !== s.dataset.star) { hotStar = s.dataset.star; invalidate(); } });
starsEl.addEventListener("pointerout", () => { if (hotStar) { hotStar = null; invalidate(); } });

// ───────────── Clicks inside pages, on far names and on places ─────────────
$("pages").addEventListener("click", (e) => {
  const t = e.target, blkEl = t.closest(".blk"), b = blkEl ? blocks.get(blkEl.dataset.id) : null, pgEl = t.closest(".page"), pg = pgEl ? pages.get(pgEl.dataset.id) : null;
  if (!pg) return;
  const fact = t.closest(".fact, .spk"), view = t.closest("[data-view]"), form = t.closest(".fm"), ghost = t.closest("[data-ghost]"), qi = t.closest(".qi"), chip = t.closest(".chip"), home = t.closest("[data-home]");
  if (fact && b && b.kind === "kpi") setOpen(b, b.open === fact.dataset.ev && b.form !== "diagramm" ? null : fact.dataset.ev);
  else if (view && b) setOpen(b, view.dataset.view);
  else if (form && b) setForm(b, form.dataset.form);
  else if (t.closest("[data-rm]") && b) removeBlock(b.id);
  else if (t.closest("[data-tag]") && b) toggleHold(b);
  else if (home) flyHome(home.dataset.home);
  else if (ghost) { if (ghost.dataset.ghost === "yes") acceptGhost(pg); else dismissGhost(pg); }
  else if (qi) addFigure(pg, qi.dataset.k);
  else if (chip && K[chip.dataset.k]) flyHome(chip.dataset.k);
});
$("labels").addEventListener("click", (e) => { const l = e.target.closest(".plabel"), pg = l && pages.get(l.dataset.page); if (pg) { userInput(); flyTo(framePage(pg)); } });
function flyPlace(id) {
  closeMenu();
  const pg = pages.get(id);
  flyTo(id === "all" || !pg ? frameAll() : framePage(pg));
}
function renderPlaces() {
  const mk = (id, name, key) => {
    const pg = pages.get(id), c = pg && pg.sys && pg.sys !== "heute" ? levelCounts(T.base, scopeOf(pg), true) : null;
    return h("button", { type: "button", "data-place": id, "aria-current": String(id === activeId), title: key ? tr(`${name} (Taste ${key})`, `${name} (key ${key})`) : name }, c && c.alert ? h("i", { class: "pl-al", title: tr("braucht dich", "needs you") }) : null, name);
  };
  // The last item is not a place: the settings. A gear and the word, on a phone the gear alone.
  const gear = h("button", { type: "button", class: "pl-set", "data-settings": "1", "aria-label": tr("Einstellungen", "Settings"), title: tr("Einstellungen (Taste ,)", "Settings (key ,)"), "aria-expanded": String(HOST.settingsOpen()) },
    sv("svg", { class: "gear", viewBox: "-8 -8 16 16", "aria-hidden": "true" }, sv("path", { d: GEAR_D }), sv("circle", { r: 2.2 })), h("span", { class: "pl-word", text: tr("Einstellungen", "Settings") }));
  // Before the gear: the Sternkatalog, where every star of the room has its entry.
  const kat = h("button", { type: "button", class: "pl-set pl-kat", "data-katalog": "1", "aria-label": tr("Sternkatalog", "Star catalogue"), title: tr("Sternkatalog (Taste C)", "Star catalogue (key C)") },
    sv("svg", { class: "gear", viewBox: "-8 -8 16 16", "aria-hidden": "true" }, sv("path", { d: "M0,-6.5 L1.6,-1.6 L6.5,0 L1.6,1.6 L0,6.5 L-1.6,1.6 L-6.5,0 L-1.6,-1.6 Z" })), h("span", { class: "pl-word", text: tr("Katalog", "Catalogue") }));
  $("places").replaceChildren(mk("heute", tr("Heute", "Today"), "H"), ...GROUP_ORDER.map((g, i) => mk("g:" + g, GROUPS[g], i < 9 ? String(i + 1) : "")), ...[...pages.values()].filter((pg) => !pg.sys && pg.title).map((pg) => mk(pg.id, pg.title, "")), mk("all", tr("Überblick", "Overview"), "0"), kat, gear);
}
// A gear of eight teeth, drawn once: an outer ring of teeth around a hole.
const GEAR_D = (() => {
  let d = "";
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, r = i % 2 ? 4.6 : 6.4, a1 = a - 0.2, a2 = a + 0.2; d += `${i ? "L" : "M"}${(r * Math.cos(a1)).toFixed(2)},${(r * Math.sin(a1)).toFixed(2)} L${(r * Math.cos(a2)).toFixed(2)},${(r * Math.sin(a2)).toFixed(2)} `; }
  return d + "Z";
})();
$("places").addEventListener("click", (e) => {
  if (e.target.closest("[data-settings]")) { userInput(); closeMenu(); if (!HOST.closeSettings()) HOST.openSettings(); return; }
  if (e.target.closest("[data-katalog]")) { userInput(); closeMenu(); HOST.closeSettings(); HOST.openCatalog(); return; }
  const b = e.target.closest("[data-place]");
  if (b) { userInput(); flyPlace(b.dataset.place); }
});

// ───────────── Time: the month of the room ─────────────
const STEP_PX = 8; // pixels of drag per month on the month word; a quarter takes twice as far, a year four times
const DRAG = { tag: 1, woche: 1, monat: 1, quartal: 2, jahr: 4 };
// Today: the last month, or in days and weeks the last one there is.
const atToday = () => (fine(G) ? AT >= PERIODS[G].length - 1 : T.base === TODAY);
let memoTimer = 0, playTimer = 0, rulerTimer = 0, rulerPinned = false, scrub = false;
function syncBack() {
  const back = $("back");
  back.hidden = atToday();
  if (!back.hidden) back.replaceChildren(`${tr("Rückblick", "Looking back")} · ${periodOf(T.base)[narrow() ? "label" : "long"]}`, h("span", { text: tr("Zurück zu heute", "Back to today") }));
}
function baseChanged(mode) {
  renderAll(mode);
  updateLens();
}
function setBase(m, mode) {
  m = clamp(Math.round(m), 0, TODAY);
  if (fine(G)) return setAt(lastIn(m), mode);
  m = endOf(m);
  if (m === T.base || diving) return;
  T.base = m;
  clearTimeout(memoTimer);
  if (m < TODAY) memoTimer = setTimeout(() => { T.memo = m; }, 450);
  baseChanged(mode);
}
// In days and weeks the room stands on one of them; its month follows, and with it the status.
function setAt(i, mode) {
  const P = PERIODS[G];
  i = clamp(Math.round(i), 0, P.length - 1);
  if (diving || (i === AT && P[i].mi === T.base)) return;
  AT = i;
  T.base = P[i].mi;
  clearTimeout(memoTimer);
  if (!atToday()) memoTimer = setTimeout(() => { T.memo = T.base; T.memoAt = AT; }, 450);
  baseChanged(mode);
}
// One period in the room's raster, or with Shift one year, as always.
function step(d, year) {
  stopPlay();
  if (fine(G)) setAt(AT + (year ? d * (G === "woche" ? 52 : DAYS.length) : d), "step");
  else setBase(year ? T.base + 12 * d : shiftBy(T.base, d), "step");
  showRuler(2200);
}
// The raster the pages are read in: Monat, Quartal, Jahr. The room then stands on the last month of its period.
function setGrain(g) {
  if (!AVAILABLE.includes(g) || g === G || diving) return;
  stopPlay();
  // From a week to its last day and back to the week of a day; from months to the last day or week of the month.
  const from = fine(G) && AT >= 0 ? PERIODS[G][AT] : null;
  G = g;
  if (fine(g)) { AT = from ? atDate(g, from.end || from.to) : lastIn(T.base); T.base = PERIODS[g][AT].mi; } else { AT = -1; T.base = endOf(T.base); }
  if (T.memo !== null) T.memo = endOf(T.memo);
  lens.m = endOf(lens.m);
  syncGrain();
  save();
  baseChanged("step");
}
function syncGrain() {
  const pg = pages.get("heute");
  pg.grain.querySelectorAll("[data-grain]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.grain === G)));
  pg.grain.dataset.fine = String(fine(G));
  pg.when.title = tr(`Ziehen reist durch die ${PLURAL[G]}`, `Drag to travel through the ${PLURAL[G]}`);
}
// Z: today ↔ the last moment visited, with the lens' circle sweeping the room.
function toggleZ() {
  stopPlay();
  if (fine(G)) {
    const last = PERIODS[G].length - 1;
    if (!atToday()) { T.memoAt = AT; setAt(last, "step"); } else setAt(T.memoAt !== undefined && T.memoAt < last ? T.memoAt : Math.max(0, last - 5), "step");
    return;
  }
  if (T.base !== TODAY) { T.memo = T.base; dive(TODAY); }
  else dive(T.memo !== null && T.memo !== TODAY ? T.memo : lens.m !== TODAY ? lens.m : Math.max(0, TODAY - 12));
}
function play() {
  if (T.playing || diving) return;
  if (atToday()) { if (fine(G)) setAt(0, "step"); else setBase(0, "step"); }
  T.playing = true;
  syncPlay();
  showRuler();
  playTimer = setInterval(() => { if (atToday()) stopPlay(); else if (fine(G)) setAt(AT + 1, "scrub"); else setBase(shiftBy(T.base, 1), "scrub"); }, 280);
}
function stopPlay() {
  if (!T.playing) return;
  T.playing = false;
  clearInterval(playTimer);
  if (!atToday()) T.memo = T.base;
  syncPlay();
  showRuler(2200);
}
function syncPlay() {
  const b = pages.get("heute").play;
  b.setAttribute("aria-pressed", String(T.playing));
  b.setAttribute("aria-label", T.playing ? tr("Anhalten", "Pause") : tr("Geschichte abspielen", "Play the story"));
  b.textContent = T.playing ? "II" : "▶";
}
function showRuler(ms) {
  const pg = pages.get("heute");
  pg.rr.dataset.open = "true";
  clearTimeout(rulerTimer);
  if (ms) rulerTimer = setTimeout(hideRuler, ms);
}
function hideRuler() {
  const pg = pages.get("heute");
  if (rulerPinned || scrub || T.playing || pg.when.matches(":hover") || pg.rr.matches(":hover")) { rulerTimer = setTimeout(hideRuler, 900); return; }
  pg.rr.dataset.open = "false";
}
function showTip(anchor, head, text) {
  const tip = $("tip"), r = anchor.getBoundingClientRect();
  tip.replaceChildren(h("b", { text: head }), text);
  tip.hidden = false;
  tip.style.left = clamp(r.left - off.left + r.width / 2 - tip.offsetWidth / 2, 12, Math.max(12, W - tip.offsetWidth - 12)) + "px";
  tip.style.top = r.bottom - off.top + 10 + "px";
}
const hideTip = () => { $("tip").hidden = true; };
const scrubbing = (on) => { scrub = on; stage.classList.toggle("scrubbing", on); if (!on && !atToday()) T.memo = T.base; };
// The ruler under the dateline of «Heute»: years, quarters, the months that needed attention, events.
function buildRuler() {
  const pg = pages.get("heute"), r = pg.ruler, kids = [h("div", { class: "base" })];
  for (let t = 0; t <= TODAY; t++) {
    const p = PERIODS.monat[t], x = (t / TODAY) * 100, c = levelCounts(t);
    if (p.m % 3 === 0) kids.push(h("i", { class: "tk" + (p.m === 0 ? " y" : ""), style: `left:${x}%` }));
    if (p.m === 0) kids.push(h("span", { class: "yl", style: `left:${x}%`, text: String(p.y) }));
    if (c.alert) kids.push(h("i", { class: "ht", style: `left:${x}%;height:${4 + c.alert * 4}px` }));
    else if (c.watch) kids.push(h("i", { class: "ht w", style: `left:${x}%` }));
  }
  for (const ev of EVENTS) {
    const b = h("button", { class: "evd", type: "button", style: `left:${(ev.t / TODAY) * 100}%`, "aria-label": `${ev.title}, ${PERIODS.monat[ev.t].long}` });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", () => { stopPlay(); setBase(ev.t, "step"); showRuler(2600); });
    b.addEventListener("pointerenter", () => showTip(b, `${PERIODS.monat[ev.t].long} · ${ev.title}`, ev.text));
    b.addEventListener("pointerleave", hideTip);
    kids.push(b);
  }
  RULER_CUR = h("div", { class: "cur" }, h("span"));
  kids.push(RULER_CUR);
  r.replaceChildren(...kids);
  r.setAttribute("aria-valuemin", 0);
  r.setAttribute("aria-valuemax", TODAY);
  r.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.stopPropagation();
    stopPlay();
    r.setPointerCapture(e.pointerId);
    scrubbing(true);
    showRuler();
    const at = (ev) => { const b = r.getBoundingClientRect(); setBase(((ev.clientX - b.left) / b.width) * TODAY, "scrub"); };
    const up = () => { r.removeEventListener("pointermove", at); r.removeEventListener("pointerup", up); r.removeEventListener("pointercancel", up); scrubbing(false); showRuler(2600); };
    at(e);
    r.addEventListener("pointermove", at); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
  });
}
// The month in the dateline of «Heute» is a word you drag.
function wireTime() {
  const pg = pages.get("heute"), w = pg.when, pin = () => { rulerPinned = !rulerPinned; showRuler(rulerPinned ? 0 : 700); };
  w.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.stopPropagation();
    userInput();
    stopPlay();
    const x0 = e.clientX, m0 = T.base, at0 = AT;
    let moved = false;
    w.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; scrubbing(true); showRuler(); }
      if (fine(G)) setAt(at0 + Math.round(dx / STEP_PX), "scrub");
      else setBase(shiftBy(m0, Math.round(dx / (STEP_PX * DRAG[G]))), "scrub");
    };
    const up = () => {
      w.removeEventListener("pointermove", move); w.removeEventListener("pointerup", up); w.removeEventListener("pointercancel", up);
      if (moved) { scrubbing(false); showRuler(2200); } else pin();
      w.blur();
    };
    w.addEventListener("pointermove", move); w.addEventListener("pointerup", up); w.addEventListener("pointercancel", up);
  });
  w.addEventListener("click", (e) => { if (e.detail === 0) pin(); });
  w.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); step(e.key === "ArrowRight" ? 1 : -1, e.shiftKey); } });
  w.addEventListener("pointerenter", () => showRuler(1600));
  pg.rr.addEventListener("pointerenter", () => showRuler(1600));
  pg.play.addEventListener("pointerdown", (e) => e.stopPropagation());
  pg.play.addEventListener("click", () => (T.playing ? stopPlay() : play()));
  pg.grain.addEventListener("pointerdown", (e) => e.stopPropagation());
  pg.grain.addEventListener("click", (e) => { const b = e.target.closest("[data-grain]"); if (b && b.getAttribute("aria-disabled") !== "true") { userInput(); setGrain(b.dataset.grain); } });
  syncGrain();
  $("back").addEventListener("click", () => { userInput(); stopPlay(); T.memo = T.base; dive(TODAY); });
}

// ───────────── Keys ─────────────
// Esc closes what is open, one thing at a time.
function escapeKey() {
  if (HOST.closeCatalog()) return true;
  if (HOST.closeSettings()) return true;
  if (starDrag && starDrag.moved) { const d = starDrag; starDrag = null; cancelStarDrag(d); return true; }
  if (closeMenu()) return true;
  if (closeKeys()) return true;
  if (closeIdee()) return true;
  const a = document.activeElement;
  if (a && a.isContentEditable) { a.blur(); return true; }
  if (T.playing) { stopPlay(); return true; }
  if (rulerPinned) { rulerPinned = false; showRuler(300); return true; }
  if (!lens.parked) { parkLens(); return true; }
  if (selId) { selId = null; invalidate(); return true; }
  return false;
}
document.addEventListener("keydown", (e) => {
  const t = e.target, k = e.key, typing = t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA";
  if (k === "Escape") { if (escapeKey()) e.preventDefault(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  // While the settings or the Sternkatalog are open, the room does not move under them.
  if (HOST.settingsOpen() || HOST.catalogOpen()) return;
  if (MENU.open && menuKey(e)) return;
  flashKey(e);
  userInput();
  const onButton = t.tagName === "BUTTON" || (t.getAttribute && t.getAttribute("role") === "button"), pg = pages.get(activeId);
  if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); step(k === "ArrowRight" ? 1 : -1, e.shiftKey); }
  else if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); panBy(0, ((k === "ArrowDown" ? 1 : -1) * 120) / cam.z); }
  else if (k === "PageUp" || k === "PageDown") { e.preventDefault(); panBy(0, ((k === "PageDown" ? 1 : -1) * 0.7 * H) / cam.z); }
  else if (k === "z" || k === "Z") toggleZ();
  else if (k === "g" || k === "G") setGrain(AVAILABLE[(AVAILABLE.indexOf(G) + 1) % AVAILABLE.length]);
  else if (k === " " && !onButton) { e.preventDefault(); if (T.playing) stopPlay(); else play(); }
  else if (k === "?") toggleKeys();
  else if (k === "i" || k === "I") toggleIdee();
  else if (k === "/" && pg) { e.preventDefault(); focusInsert(pg, "/"); }
  else if (k === "h" || k === "H") flyPlace("heute");
  else if (k === "0") flyPlace("all");
  else if (/^[1-9]$/.test(k) && GROUP_ORDER[k - 1]) flyPlace("g:" + GROUP_ORDER[k - 1]);
  else if (k === ",") { e.preventDefault(); closeMenu(); HOST.openSettings(); }
  else if (k === "k" || k === "K") HOST.leave();
  else if (k === "c" || k === "C") { closeMenu(); HOST.openCatalog(); }
  else if ((k === "Delete" || k === "Backspace") && selId && blocks.has(selId)) removeBlock(selId);
  else if (k === "Tab" && !e.shiftKey && (t === document.body || t === stage) && pg && acceptGhost(pg)) e.preventDefault();
  else if ((k === "Enter" || k === " ") && t.matches && t.matches(".fact, .spk")) { e.preventDefault(); t.click(); }
});
// After a click with the pointer, focus leaves the button, so Space and the letter keys reach the room again.
document.addEventListener("click", (e) => { if (e.detail > 0 && e.target.closest) { const b = e.target.closest("button, [role='button']"); if (b && b === document.activeElement) b.blur(); } });

// The one hint: beside the first star of «Heute», until a star has been dragged once.
function placeHint() {
  const el = $("hint"), pg = pages.get("heute"), st = pg && pg.stars.find((s) => s.type === "block");
  const show = !seenHint && HOST.prefs().hints !== false && started && !introTimers.length && !flyStop && M.p >= 1 && activeId === "heute" && !!st && !narrow() && st.x > 290 && !starDrag && lens.parked;
  if (el.hidden === show) el.hidden = !show;
  if (show) el.style.transform = `translate(${(st.x - 20).toFixed(0)}px,${st.y.toFixed(0)}px)`;
}
