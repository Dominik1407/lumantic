// ═════ Kosmos · what the host (settings, designs) may change while the room runs ═════
// A new design or font: the canvas reads its colours again, pages are measured again, every frame is drawn anew.
function retheme() {
  readTheme();
  for (const pg of pages.values()) pg.dirty = true;
  invalidate();
}
// «Bewegung: Ruhig» cuts every animation to its end state, like the system setting does.
function setMotion(still) { reduced = still; invalidate(); }
// The parked lens looks this many months back from the room's month.
function setLensBack(n) {
  if (!lens.parked || diving) return;
  lens.m = endOf(clamp(T.base - n, 0, N - 1));
  updateLens();
  invalidate();
}
function setHints(on) { if (!on) seenHint = true; invalidate(); }
// The settings sheet opens over the right edge: the room moves left by half its width, so a page stays whole
// while its design changes, and moves back when the sheet closes. A phone keeps the room where it is.
function setSheet(px) {
  const r = narrow() ? 0 : Math.max(0, Math.round(px));
  if (r === sheetR) return;
  const dx = (r - sheetR) / 2 / cam.z;
  sheetR = r;
  if (started) panBy(dx, 0);
}
// For the real-time tests: a read-only window into the room.
const debug = {
  get cam() { return cam; }, get M() { return M; }, get T() { return T; }, get lens() { return lens; }, get activeId() { return activeId; },
  get G() { return G; }, get AT() { return AT; }, get W() { return W; }, get H() { return H; }, get GUT() { return GUT; }, get PAGE_W() { return PAGE_W; }, get THEME() { return THEME; },
  pages, blocks, STARS, VIEWS, MENU, K, KPIS, DATA, framePage, frameAll, flyPlace, dive, setBase, setGrain, stateOf, shownOf, PERIODS, valueAt,
};
return { retheme, setMotion, setLensBack, setHints, setSheet, resetAll, home: (id) => { if (K[id]) flyHome(id); }, debug };
