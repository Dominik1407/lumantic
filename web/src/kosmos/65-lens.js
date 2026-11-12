// ═════ Kosmos · the lens: a glass that shows another month (carried over from Raum) ═════
// Parked, it is a small closed coin in the corner and shows nothing. Picked up, it grows to full size, and every block
// it touches shows the lens' month. Dropped back on the corner, or with Esc, it parks and closes again.
const MDEG = 360 / 96; // one month on the rim; the whole history fits in one turn
const lens = { el: $("lens"), tapAt: 0, x: 0, y: 0, r: 150, vr: 48, rr: 0, k: 0, m: Math.max(0, N - 1 - HOST.lensBack()), alpha: 1, parked: true, size: 0, svg: null, coin: null, arc: null, bead: null, beadHit: null, month: null, rel: null };
const polar = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
// On a phone the page fills the width, so the coin is small and parks in the bottom row beside the places.
const coinR = () => (narrow() ? 19 : 48);
const parkPos = () => (narrow() ? [W - 37, H - 29] : [W - 114, H - 142]); // on a desk the label under the coin keeps the side gutter
const parkZone = () => (narrow() ? 64 : 120);
let diving = 0, lensDrag = null, lensGlide = null, lensGrow = null, lensSel = false, wheelAcc = 0;
// k = 0 is the coin, k = 1 the open glass. The glass touches things only while it is open.
function setK(k) {
  lens.k = k;
  if (!diving) { lens.vr = lerp(coinR(), lens.r, k); lens.rr = k > 0 ? lens.vr : 0; }
  invalidate();
}
function growLens(to, done) {
  if (lensGrow) lensGrow();
  lensGrow = null;
  const k0 = lens.k;
  if (k0 === to) { if (done) done(); return; }
  lensGrow = tween(300, (e) => setK(lerp(k0, to, e)), easeOut, () => { lensGrow = null; if (done) done(); });
}
function stopLensGlide() { if (lensGlide) { lensGlide(); lensGlide = null; } }
function glideLens(x, y, ms, done) {
  stopLensGlide();
  const x0 = lens.x, y0 = lens.y;
  lensGlide = tween(ms, (e) => { lens.x = lerp(x0, x, e); lens.y = lerp(y0, y, e); }, easeInOut, () => { lensGlide = null; if (done) done(); });
}
function parkLens() {
  lens.parked = true; lensSel = false;
  lens.el.classList.remove("is-open");
  lensClasses();
  glideLens(...parkPos(), 380);
  growLens(0);
}

function buildLens() {
  const r = lens.r, S = 2 * (r + 26), c = S / 2;
  lens.size = S;
  let ticks = "", years = "";
  for (let i = 0; i < 96; i++) {
    const [x0, y0] = polar(r + 2.5, i * MDEG), [x1, y1] = polar(r + (i % 12 ? 6 : 9), i * MDEG), seg = `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} `;
    if (i % 12) ticks += seg; else years += seg;
  }
  const arcOf = (rad, a0, a1) => { const [x0, y0] = polar(rad, a0), [x1, y1] = polar(rad, a1); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${rad},${rad} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  lens.arc = sv("path", { class: "rim-arc" });
  lens.bead = sv("circle", { class: "rim-bead", r: 5.5 });
  lens.beadHit = sv("circle", { class: "bead-hit", r: 16 });
  // The closed face of the coin: a dark disc with two clock hands.
  lens.coin = sv("g", { class: "coin" }, sv("circle", { r: r - 1, fill: "url(#lens-coin)" }),
    sv("path", { class: "coin-hand", d: `M0,0 L0,${(-r * 0.56).toFixed(0)} M0,0 L${(r * 0.36).toFixed(0)},${(r * 0.21).toFixed(0)}` }), sv("circle", { class: "coin-dot", r: r * 0.07 }));
  const rimHit = sv("circle", { class: "rim-hit", r: r + 3, "stroke-width": matchMedia("(pointer: coarse)").matches ? 40 : 26 }), coinHit = sv("circle", { class: "coin-hit", r: r + 14 });
  lens.svg = sv("svg", { width: S, height: S, viewBox: `${-c} ${-c} ${S} ${S}`, "aria-hidden": "true" },
    // The colours of rim, coin and glass come from the design (tokens --lens-*), so the lens belongs to every design.
    sv("defs", {}, sv("linearGradient", { id: "lens-rim", x1: 0, y1: 0, x2: 1, y2: 1 }, sv("stop", { offset: 0, style: "stop-color:var(--lens-rim-1)" }), sv("stop", { offset: 0.42, style: "stop-color:var(--lens-rim-2)" }), sv("stop", { offset: 1, style: "stop-color:var(--lens-rim-3)" })),
      sv("radialGradient", { id: "lens-coin", cx: 0.36, cy: 0.3, r: 0.85 }, sv("stop", { offset: 0, style: "stop-color:var(--coin-1)" }), sv("stop", { offset: 1, style: "stop-color:var(--coin-2)" })),
      sv("radialGradient", { id: "lens-glass" }, sv("stop", { offset: 0.6, style: "stop-color:var(--lens-glass);stop-opacity:0" }), sv("stop", { offset: 0.93, style: "stop-color:var(--lens-glass);stop-opacity:calc(.07 * var(--glass-a, 1))" }), sv("stop", { offset: 1, style: "stop-color:var(--lens-glass);stop-opacity:calc(.22 * var(--glass-a, 1))" }))),
    sv("circle", { r, fill: "url(#lens-glass)", "pointer-events": "none" }), lens.coin,
    sv("path", { class: "rim-shine", d: arcOf(r - 7, -62, -28), "stroke-width": 1.8, "stroke-opacity": 0.34 }),
    sv("path", { class: "rim-shine", d: arcOf(r - 7, 126, 146), "stroke-width": 1.2, "stroke-opacity": 0.14 }),
    sv("circle", { class: "rim-in", r: r - 2.4 }), sv("circle", { class: "rim-a", r }), sv("circle", { class: "rim-b", r: r + 10.5 }),
    sv("path", { class: "rim-t", d: ticks }), sv("path", { class: "rim-y", d: years }),
    sv("path", { class: "rim-index", d: `M0,${-(r + 13)} L-4,${-(r + 20)} L4,${-(r + 20)} Z` }),
    rimHit, lens.arc, lens.bead, lens.beadHit, coinHit);
  lens.month = h("b");
  lens.rel = h("span", { class: "l-rel" });
  const grip = h("div", { class: "l-date", title: tr("Ziehen bewegt die Linse", "Drag to move the lens") },
    h("button", { class: "l-step", type: "button", "data-lens": "prev", "aria-label": tr("Linse einen Monat zurück", "Lens one period back") }, "◂"), h("span", { class: "l-pre", text: tr("Zeitlinse ·", "Time lens ·") }), lens.month, lens.rel,
    h("button", { class: "l-step", type: "button", "data-lens": "next", "aria-label": tr("Linse einen Monat vor", "Lens one period on") }, "▸"));
  const more = h("div", { class: "l-more" },
    h("button", { type: "button", "data-lens": "p1", title: tr("Einen Monat vor dem Stand des Raums", "One month before the room") }, tr("1 M", "1 M")), h("button", { type: "button", "data-lens": "p3", title: tr("Ein Quartal davor", "One quarter before") }, "1 Q"),
    h("button", { type: "button", "data-lens": "p12", title: tr("Ein Jahr davor", "One year before") }, tr("1 J", "1 Y")), h("button", { class: "l-dive", type: "button", "data-lens": "dive", title: tr("Der ganze Raum reist in diesen Monat (Doppelklick auf den Rand)", "The whole room travels to this month (double-click the rim)") }, tr("Eintauchen", "Dive in")));
  lens.el.replaceChildren(lens.svg, h("div", { class: "l-tab" }, grip, more));

  // Coin, rim and date tab pick the lens up and move it. The inside of the open glass lets every click through.
  for (const el of [rimHit, coinHit, grip]) el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || diving || e.target.closest("button")) return;
    e.stopPropagation();
    e.preventDefault();
    lensDrag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, moved: 0, viaTab: el === grip };
    lensSel = true;
    lens.parked = false;
    userInput();
    closeMenu();
    stopLensGlide();
    growLens(1);
    lens.el.classList.add("is-drag");
    lensClasses();
  });
  // The bead: turn it back along the rim to look further into the past.
  let turn = null;
  const angleAt = (e) => (Math.atan2(e.clientX - off.left - lens.x, -(e.clientY - off.top - lens.y)) * 180) / Math.PI;
  lens.beadHit.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || diving) return;
    userInput();
    e.stopPropagation();
    lensSel = true;
    turn = { id: e.pointerId, a: angleAt(e), acc: (lens.m - T.base) * MDEG };
    lens.beadHit.setPointerCapture(e.pointerId);
  });
  lens.beadHit.addEventListener("pointermove", (e) => {
    if (!turn || turn.id !== e.pointerId) return;
    const a = angleAt(e);
    let d = a - turn.a;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    turn.a = a; turn.acc += d;
    setLensMonth(T.base + Math.round(turn.acc / MDEG));
  });
  const endTurn = (e) => { if (turn && turn.id === e.pointerId) turn = null; };
  lens.beadHit.addEventListener("pointerup", endTurn);
  lens.beadHit.addEventListener("pointercancel", endTurn);
  updateLens();
  setK(lens.k);
}
// Moving the lens is tracked on the document, so the drag survives the lens changing shape under the pointer.
document.addEventListener("pointermove", (e) => {
  if (!lensDrag || lensDrag.id !== e.pointerId) return;
  const dx = e.clientX - lensDrag.lx, dy = e.clientY - lensDrag.ly;
  lensDrag.lx = e.clientX; lensDrag.ly = e.clientY; lensDrag.moved += Math.abs(dx) + Math.abs(dy);
  lens.x = clamp(lens.x + dx, 0, W); lens.y = clamp(lens.y + dy, 0, H);
  invalidate();
});
function endLensDrag(e) {
  if (!lensDrag || lensDrag.id !== e.pointerId) return;
  const d = lensDrag, [px, py] = parkPos(), tap = d.moved < 5, now = performance.now(), twice = tap && !d.viaTab && now - lens.tapAt < 420;
  lensDrag = null;
  lens.tapAt = tap ? now : 0;
  lens.el.classList.remove("is-drag");
  if (Math.hypot(lens.x - px, lens.y - py) < parkZone() && !twice) parkLens(); // dropped back on the corner
  else if (tap && d.viaTab) lens.el.classList.toggle("is-open");
  if (twice) dive(lens.m); // a double click on rim or coin: Eintauchen
  invalidate();
}
document.addEventListener("pointerup", endLensDrag);
document.addEventListener("pointercancel", endLensDrag);
lens.el.addEventListener("click", (e) => {
  const b = e.target.closest("[data-lens]");
  if (!b || diving) return;
  userInput();
  lensSel = true;
  const act = b.dataset.lens;
  if (act === "prev") setLensMonth(shiftBy(lens.m, -1));
  else if (act === "next") setLensMonth(shiftBy(lens.m, 1));
  else if (act === "dive") dive(lens.m);
  else setLensMonth(T.base - Number(act.slice(1)));
});
// A new month in the glass: everything it touches is written again, quickly. In quarters or years the glass
// stands on the last month of a period, like the room.
function setLensMonth(m) {
  m = endOf(clamp(Math.round(m), 0, N - 1));
  if (m === lens.m || diving) return;
  lens.m = m;
  updateLens();
  for (const b of blocks.values()) if (b.under && b.t === null) refreshBlock(b, "scrub");
  for (const st of STARS.values()) if (st.under && st.type === "chip") refreshStar(st);
  invalidate();
}
// Label, arc and bead. The arc runs from the top (the room's month) back to the bead (the lens' month).
function updateLens() {
  if (!lens.month) return;
  const d = T.base - lens.m, deg = clamp(-d * MDEG, -356, 356), rad = lens.r + 3.5, [bx, by] = polar(rad, deg);
  lens.month.textContent = periodOf(lens.m).label;
  const a = atOf(T.base), b = atOf(lens.m), far = a >= 0 && b >= 0 ? lensRel(a - b, G) : lensRel(d, "monat");
  lens.rel.textContent = lens.m === N - 1 && d !== 0 ? tr("· heute", "· today") : "· " + far;
  lens.bead.setAttribute("cx", bx.toFixed(1)); lens.bead.setAttribute("cy", by.toFixed(1));
  lens.beadHit.setAttribute("cx", bx.toFixed(1)); lens.beadHit.setAttribute("cy", by.toFixed(1));
  lens.arc.setAttribute("d", Math.abs(deg) < 0.5 ? "" : `M0,${-rad} A${rad},${rad} 0 ${Math.abs(deg) > 180 ? 1 : 0} ${deg > 0 ? 1 : 0} ${bx.toFixed(1)},${by.toFixed(1)}`);
}
// How far the glass looks, in the room's raster: «vor einem Quartal», «zwei Jahre später».
function lensRel(d, g) {
  if (EN) {
    if (d === 0) return `the same ${GRAIN_NAME[g].toLowerCase()}`;
    if (g === "monat" && d === 12) return "a year ago";
    const n = Math.abs(d), word = n === 1 ? `a ${GRAIN_NAME[g].toLowerCase()}` : `${n} ${PLURAL[g]}`;
    return d > 0 ? `${word} ago` : `${word} later`;
  }
  const one = { tag: ["einem Tag", "ein Tag"], woche: ["einer Woche", "eine Woche"], monat: ["einem Monat", "ein Monat"], quartal: ["einem Quartal", "ein Quartal"], jahr: ["einem Jahr", "ein Jahr"] }[g], many = RUN_NOUN[g];
  if (d === 0) return { tag: "derselbe Tag", woche: "dieselbe Woche", monat: "derselbe Monat", quartal: "dasselbe Quartal", jahr: "dasselbe Jahr" }[g];
  if (g === "monat" && d === 12) return "vor einem Jahr";
  return d > 0 ? `vor ${d === 1 ? one[0] : d + " " + many}` : `${-d === 1 ? one[1] : -d + " " + PLURAL[g]} später`;
}
function lensClasses() {
  const coin = lens.k === 0 && !diving;
  lens.el.classList.toggle("is-diving", !!diving);
  lens.el.classList.toggle("is-coin", coin);
  lens.el.classList.toggle("is-home", lens.parked);
  lens.el.classList.toggle("is-sel", lensSel && !coin);
  return coin;
}
function placeLens() {
  if (!lens.svg) return;
  lensClasses();
  lens.el.style.transform = `translate(${(lens.x - lens.size / 2).toFixed(1)}px,${(lens.y - lens.size / 2).toFixed(1)}px)`;
  // Parked over a page, the coin steps back so the text under it stays readable.
  const c = coinR() + 10, over = !narrow() && lens.parked && lens.k === 0 && !diving && [...pages.values()].some((pg) => pg.open && lens.x + c > pg.ox && lens.x - c < pg.ox + PAGE_W * cam.z && lens.y + c + 30 > pg.oy && lens.y - c < pg.oy + pg.h * cam.z);
  lens.el.style.opacity = (lens.alpha * (over ? 0.32 : 1)).toFixed(2);
  lens.el.style.setProperty("--R", lens.vr.toFixed(1) + "px");
  lens.svg.style.transform = `scale(${Math.max(0.001, lens.vr / lens.r).toFixed(4)})`;
  lens.coin.style.opacity = diving === 1 ? "0" : (1 - lens.k).toFixed(2);
}

// Eintauchen: the circle grows across the screen, and every block switches as the rim reaches it. Then the whole room
// is at that month and the lens shows where you came from.
function dive(target) {
  target = endOf(clamp(Math.round(target), 0, N - 1));
  // In days and weeks the dive lands on the last one of the month.
  const at = fine(G) ? lastIn(target) : AT;
  if (diving || (target === T.base && at === AT)) return;
  closeMenu();
  stopPlay();
  if (lens.m !== target) { lens.m = target; updateLens(); }
  diving = 1;
  const from = T.base, r0 = lens.vr, r1 = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - lens.x, y - lens.y))) + 24;
  tween(820, (e) => { lens.vr = lens.rr = lerp(r0, r1, e); lens.alpha = 1 - e; }, easeInOut, () => {
    // Whatever the glass held is released first, so nothing keeps showing the lens' month by accident.
    for (const st of STARS.values()) st.under = false;
    for (const b of blocks.values()) b.under = false;
    if (fine(G)) { AT = at; T.base = PERIODS[G][at].mi; } else T.base = target;
    lens.m = from; lens.vr = lens.rr = 0; lens.alpha = 0;
    if (target < TODAY) T.memo = target;
    // The lens has done its work: it returns as the coin in its corner and keeps the month you came from.
    stopLensGlide();
    if (lensGrow) { lensGrow(); lensGrow = null; }
    lens.parked = true; lensSel = false; lens.k = 0;
    lens.el.classList.remove("is-open");
    [lens.x, lens.y] = parkPos();
    diving = 2;
    baseChanged("step");
    tween(460, (e) => { lens.vr = coinR() * e; lens.rr = 0; lens.alpha = e; }, easeOut, () => { diving = 0; setK(0); });
  });
}
