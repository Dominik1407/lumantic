// ═════ Kosmos · the note about the idea, resetting, the opening, what the host may change ═════
const ideeEl = $("idee"), ideeBtn = $("btn-idee");
function toggleIdee(force) { const open = force === undefined ? ideeEl.hidden : force; if (open) closeKeys(); ideeEl.hidden = !open; ideeBtn.setAttribute("aria-expanded", String(open)); }
const closeIdee = () => (ideeEl.hidden ? false : (toggleIdee(false), true));
ideeBtn.addEventListener("click", () => { userInput(); toggleIdee(); });
$("idee-x").addEventListener("click", () => toggleIdee(false));
// Back to the room as Lumina keeps it: her pages only, every block in her form, today.
function resetAll() {
  clearTimeout(saveTimer);
  stopPlay();
  closeMenu();
  for (const pg of [...pages.values()]) {
    if (!pg.sys) { removePage(pg); continue; }
    for (const id of [...pg.blocks]) forget(id);
    pg.blocks = []; pg.forms = {}; pg.user = false; pg.ghostQuiet = false;
    pg.say.replaceChildren();
  }
  dismissed.clear();
  seenHint = false;
  T.base = TODAY; T.memo = null;
  placeWorld();
  parkLens();
  renderAll("init");
  updateLens();
  toggleIdee(false);
  HOST.save(snapshot());
  flyTo(framePage(pages.get("heute")));
  toast("Der Raum ist wieder so, wie Lumina ihn hält.");
}

function resize() {
  const b = stage.getBoundingClientRect(), changed = started && (Math.abs(b.width - W) > 0.5 || Math.abs(b.height - H) > 0.5);
  W = Math.max(1, b.width); H = Math.max(1, b.height); off = b; DPR = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [gridC, threadC]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  GUT = narrow() ? 22 : 30;
  PAGE_W = narrow() ? clamp(Math.floor(W - 32 - GUT), 250, 560) : 560;
  $("app").style.setProperty("--pw", PAGE_W + "px");
  $("app").style.setProperty("--gut", GUT + "px");
  const r = narrow() ? 104 : 150;
  if (r !== lens.r) { lens.r = r; if (lens.size) buildLens(); }
  if (lens.parked && !lensDrag) [lens.x, lens.y] = parkPos();
  lens.x = clamp(lens.x, 0, W); lens.y = clamp(lens.y, 0, H);
  if (started) {
    placeWorld();
    for (const pg of pages.values()) { pg.dirty = true; seats(pg); }
    syncBack();
    // The ring follows the size of the screen, so the camera keeps what it was showing: the open page, or the whole sky.
    if (changed && !flyStop) {
      const pg = pages.get(activeId);
      if (pg && M.p >= 0.9) { measure(pg); Object.assign(cam, framePage(pg)); } else if (M.p === 0 && !introTimers.length) Object.assign(cam, frameAll());
    }
  }
  invalidate();
}
// Focus on an element outside the screen makes the browser scroll even a clipped box. The room has a camera for that.
for (const box of [stage, $("app")]) box.addEventListener("scroll", () => { if (box.scrollTop || box.scrollLeft) { box.scrollTop = 0; box.scrollLeft = 0; } });
function start() {
  resize();
  wireMenu();
  buildWorld();
  load();
  if (fine(G)) { AT = PERIODS[G].length - 1; T.base = PERIODS[G][AT].mi; }
  lens.m = endOf(lens.m);
  if (HOST.prefs().hints === false) seenHint = true;
  buildLens();
  buildRuler();
  wireTime();
  for (const pg of pages.values()) renderPage(pg, "init");
  renderPlaces();
  syncBack();
  [lens.x, lens.y] = parkPos();
  started = true;
  new ResizeObserver(resize).observe(stage);
  // Where the room opens: «Heute», the whole sky, or the page the person was on last time.
  const pref = HOST.prefs().start, last = pages.get(HOST.prefs().lastPage || "");
  const home = pref === "zuletzt" && last ? last : pages.get("heute"), sky = pref === "ueberblick";
  const goal = () => (sky ? frameAll() : framePage(home));
  // When the fonts arrive, pages get another height. As long as nobody has touched anything, the page is framed again.
  const settle = () => {
    if (sky || !untouched || introTimers.length || flyStop || M.p < 0.9) return;
    measure(home);
    const to = framePage(home);
    if (Math.abs(to.z - cam.z) < 0.004 && Math.abs(to.y - cam.y) < 3) return;
    if (reduced || STILL) { Object.assign(cam, to); invalidate(); } else flyTo(to, 420);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const pg of pages.values()) pg.dirty = true; invalidate(); setTimeout(settle, 60); });
  if (reduced || STILL || sky) { Object.assign(cam, goal()); invalidate(); return; }
  // The opening: the whole sky first, then one flight into the page while its stars unfold into the letter.
  Object.assign(cam, frameAll());
  invalidate();
  // As the letter appears, its figures roll in once.
  const roll = () => { if (!untouched) return; home.el.querySelectorAll(".rcc").forEach((c, j) => c.animate([{ transform: "translateY(45%)", opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 620, delay: (j % 11) * 36, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" })); };
  // Coming from the main menu the flight has already begun there: no pause over the sky, and a shorter way in.
  const quick = HOST.arrived();
  introTimers = [setTimeout(() => { introTimers = []; flyTo(framePage(home), quick ? 1500 : 2400, () => setTimeout(settle, 60)); setTimeout(roll, quick ? 700 : 1300); }, quick ? 80 : 1000)];
}
start();
