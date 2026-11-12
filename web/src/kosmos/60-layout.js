// ═════ Kosmos · stars, seats and the one draw of a frame ═════
// Every star has two places in its page: its seat in the constellation and the bullet beside its block.
// The zoom moves it from one to the other, and the block travels with it.

// Where the blocks of a page lie, in the page's own px. Read once after a change, never during a frame's writes.
function measure(pg) {
  pg.dirty = false;
  pg.labSize = null; // the names far away are read again too: the fonts or their size may have changed
  for (const st of pg.stars) st.labSize = null;
  const dl = pg.head.firstElementChild, headTop = pg.head.offsetTop;
  pg.lead = [-GUT, headTop + dl.offsetTop + Math.min(15, dl.offsetHeight / 2)];
  pg.head.style.transformOrigin = `${-GUT}px ${(pg.lead[1] - headTop).toFixed(1)}px`;
  for (const b of blocksOf(pg)) {
    const v = VIEWS.get(b.id);
    if (!v) continue;
    b.top = v.el.offsetTop; b.h = v.el.offsetHeight;
    if (b.kind === "quiet") for (const it of v.items.values()) it.pos = [it.el.offsetLeft + 4, b.top + it.el.offsetTop + it.el.offsetHeight / 2 + 1];
  }
  pg.h = pg.el.offsetHeight;
}

// ───────────── Seats: where the stars of a page stand when it is a constellation ─────────────
// Seats are in screen px around the page's centre and keep that size at every far zoom, like the labels. The name of a
// page stands at labAt: x and y go with the seats, the third part keeps its px like the names beside the stars.
function seats(pg) {
  const s = narrow() ? 0.7 : 1, set = (st, x, y) => { st.seat = [x * s, y * s]; };
  seatsOf(pg, s, set);
  pg.lab.style.translate = `${(-50 + 50 * pg.out[0]).toFixed(0)}% ${(-50 + 50 * pg.out[1]).toFixed(0)}%`;
  // The name of a star stands on the side away from the lead star, so the thread to it never runs through the name.
  for (const st of pg.stars) {
    // On a narrow screen there is no room beside a star: every name stands below its star, and the stars hang below their lead.
    const d = Math.hypot(st.seat[0], st.seat[1]), wide = d > 6 && !narrow(), lx = wide ? st.seat[0] / d : 0, ly = wide ? st.seat[1] / d : 1, side = lx.toFixed(2) + " " + ly.toFixed(2);
    st.dir = [lx, ly];
    if (st.side !== side) { st.side = side; st.el.style.setProperty("--lx", lx.toFixed(2)); st.el.style.setProperty("--ly", ly.toFixed(2)); }
  }
}
function seatsOf(pg, s, set) {
  const stars = pg.stars, bs = stars.filter((st) => st.type === "block"), chips = stars.filter((st) => st.type === "chip");
  if (!stars.length) return;
  set(stars[0], 0, 0);
  const mid = pages.get("heute"), inner = [-50, -130, 15, 165, -90, 90, -10, -170];
  let extra = 0;
  if (pg.sys === "heute") {
    // Signals stand towards their home topic, so their tethers radiate without crossing.
    pg.out = [0, 1]; pg.labAt = [0, 128 * s, 0];
    const byTopic = new Map();
    for (const st of bs) {
      const b = st.b;
      if (b.kind === "kpi" && b.auto) { const t = topicId(b.k); if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t).push(st); }
      else if (b.kind === "quiet") set(st, 0, 78);
      else { const a = (inner[extra % 8] * Math.PI) / 180, r = 60 + 16 * Math.floor(extra / 8); extra++; set(st, r * Math.cos(a), r * Math.sin(a)); }
    }
    const sig = [];
    for (const [t, list] of byTopic) {
      // On a narrow screen the ring is tall and the true directions crowd together; there the nominal ones are used.
      const tp = pages.get(t), a0 = narrow() ? (angleOf(GROUP_ORDER.indexOf(t.slice(2))) * Math.PI) / 180 : Math.atan2(tp.y - pg.y, tp.x - pg.x);
      list.forEach((st, i) => sig.push({ st, a: a0 + (i - (list.length - 1) / 2) * 0.84 }));
    }
    // No two of them stand closer than about 26 px, at any screen size.
    const minA = 2 * Math.asin(Math.min(0.9, 13.5 / (106 * s)));
    sig.sort((x, y) => x.a - y.a);
    for (let n = 0; n < 8 && sig.length > 1; n++) for (let i = 0; i < sig.length; i++) {
      const x = sig[i], y = sig[(i + 1) % sig.length], gap = i + 1 < sig.length ? y.a - x.a : y.a + 2 * Math.PI - x.a;
      if (gap < minA) { x.a -= (minA - gap) / 2; y.a += (minA - gap) / 2; }
    }
    // One that points almost straight down stands beyond the calm figures of the quiet line.
    for (const { st, a } of sig) { const r = Math.sin(a) > 0.9 ? 126 : 106; set(st, r * Math.cos(a), r * Math.sin(a)); }
    chips.forEach((st, i) => { const a = ((chips.length > 1 ? 18 + (144 * i) / (chips.length - 1) : 90) * Math.PI) / 180, r = i % 2 ? 27 : 20; set(st, r * Math.cos(a), 78 + r * Math.sin(a)); });
    // The name of the page stands below a star that points straight down, and below that star's name.
    const down = Math.max(0, ...bs.filter((st) => st.seat[1] > 0 && Math.abs(st.seat[0]) < 120 * s).map((st) => st.seat[1]));
    if (down + 46 * s > 128 * s) pg.labAt = [0, down, 46 * s];
  } else if (pg.sys) {
    // A topic: its figures keep fixed seats across the direction away from the middle, whatever their state.
    // On a narrow screen there is no room for that: there the figures hang below the lead star, side by side.
    const dx = pg.x - mid.x, dy = pg.y - mid.y, d = Math.hypot(dx, dy) || 1, rv = [dx / d, dy / d], tv = [-rv[1], rv[0]], slim = narrow();
    const members = scopeKpis(scopeOf(pg)).map((k) => k.id), n = members.length, three = n === 3;
    // Two and three figures have hand-set seats; any other number stands on a small ring (on a phone in rows of three).
    const ring = members.map((_, i) => { const a = -Math.PI / 2 + (i / Math.max(1, n)) * 2 * Math.PI; return [Math.round(Math.cos(a) * 86), Math.round(Math.sin(a) * 58)]; });
    const rows = members.map((_, i) => [((i % 3) - 1) * 64, 4 + Math.floor(i / 3) * 58]);
    const offs = slim ? (three ? [[0, 66], [-64, 4], [64, 4]] : n === 2 ? [[-48, 0], [48, 52]] : rows) : three ? [[0, -64], [-88, 44], [88, 44]] : n === 2 ? [[-72, -8], [72, 14]] : ring;
    const seatOf = (kid) => { const [t, r] = offs[members.indexOf(kid)] || [0, 0]; return slim ? [t, r] : [tv[0] * t + rv[0] * r, tv[1] * t + rv[1] * r]; };
    const top = members.reduce((best, kid) => (seatOf(kid)[1] < seatOf(best)[1] ? kid : best), members[0]), lit = !slim && seatOf(top)[1] < -6 && stateOf(K[top], T.base).level !== "calm";
    pg.out = [0, -1];
    pg.labAt = [0, -Math.max(0, -seatOf(top)[1]) * s, -24 * s - (lit ? 36 : 0)];
    const back = Math.atan2(-rv[1], -rv[0]);
    for (const st of bs) {
      const b = st.b;
      if (b.kind === "kpi" && (b.auto || b.lift)) set(st, ...seatOf(b.k));
      else if (b.kind === "quiet") set(st, 0, 0);
      else if (slim) { const side = extra % 2 ? -1 : 1, r = 60 + 22 * Math.floor(extra / 2); extra++; set(st, side * r, -6); }
      else { const a = back + (extra % 2 ? 1 : -1) * Math.ceil((extra + 1) / 2) * 0.55; extra++; set(st, 50 * Math.cos(a), 50 * Math.sin(a)); }
    }
    for (const st of chips) set(st, ...seatOf(st.k));
  } else {
    // An own page: its blocks fan out above the lead star, in reading order from left to right.
    const n = bs.length, step = Math.min(40, 150 / Math.max(1, n));
    pg.out = [0, -1]; pg.labAt = [0, (n > 1 ? -72 : n ? -60 : -20) * s, 0];
    bs.forEach((st, i) => { const a = ((-90 + (i - (n - 1) / 2) * step) * Math.PI) / 180, r = 38 + (i % 2 ? 14 : 0); set(st, r * Math.cos(a), r * Math.sin(a)); });
  }
}

// ───────────── Stars ─────────────
const starEl = (id, type) => h("button", { class: "star", type: "button", "data-star": id, "data-type": type }, h("i", { class: "st-halo" }), h("i", { class: "st-core" }), h("span", { class: "st-lab" }));
// Shape and colour of a star, and its small name for the far view.
function refreshStar(st) {
  let kind = "lead", name = "", value = "", say = "";
  if (st.type === "lead") say = tr(`Seite ${pageName(st.pg)}`, `Page ${pageName(st.pg)}`) + (st.pg.sys ? "" : tr(": ziehen verschiebt die Seite", ": drag to move the page"));
  else if (st.type === "chip") {
    const k = K[st.k], m = st.under ? lens.m : effM(st.b), r = shownOf(k, m);
    kind = r.level === "calm" ? "calm" : r.kind; name = SHORT[k.id]; value = compact(k, r.cur);
    say = tr(`${k.name}, ${r.label}: ziehen nimmt eine Kopie mit, Klick macht einen eigenen Baustein`, `${k.name}, ${r.label}: drag to take a copy, click for a block of its own`);
  } else {
    const b = st.b;
    if (b.kind === "kpi") {
      const k = K[b.k], r = shownOf(k, effM(b));
      kind = r.level !== "calm" ? r.kind : b.form === "diagramm" ? "chart" : "calm"; name = SHORT[k.id]; value = compact(k, r.cur);
      say = tr(`${k.name}, ${r.label}: ziehen bewegt den Baustein, Klick öffnet sein Menü`, `${k.name}, ${r.label}: drag to move the block, click for its menu`);
    } else { kind = b.kind; name = b.kind === "note" ? tr("Notiz", "Note") : b.kind === "answer" ? tr("Antwort", "Answer") : "";
      say = b.kind === "note" ? tr("Notiz: ziehen bewegt sie, Klick öffnet ihr Menü", "Note: drag to move it, click for its menu") : b.kind === "answer" ? tr("Antwort von Lumina: ziehen bewegt sie, Klick öffnet ihr Menü", "Answer from Lumina: drag to move it, click for its menu")
        : b.kind === "ghost" ? tr("Vorschlag von Lumina: Klick übernimmt ihn", "Suggestion from Lumina: click to accept it") : tr("Ruhige Kennzahlen", "Calm figures"); }
  }
  const sig = kind + "|" + name + "|" + value + "|" + say;
  if (st.sig === sig) return;
  st.sig = sig; st.labSize = null;
  st.el.dataset.kind = kind;
  st.el.setAttribute("aria-label", say);
  st.el.lastChild.replaceChildren(...(name ? [name, h("b", { text: value })] : []));
}
// One star for the page, one for each block, one for each figure in a quiet line.
function syncStars(pg) {
  const want = [{ id: "L:" + pg.id, type: "lead", b: null, k: null }];
  for (const b of blocksOf(pg)) {
    want.push({ id: "B:" + b.id, type: "block", b, k: null });
    if (b.kind === "quiet") for (const kid of VIEWS.get(b.id).items.keys()) want.push({ id: "C:" + pg.id + ":" + kid, type: "chip", b, k: kid });
  }
  const ids = new Set(want.map((w) => w.id));
  for (const st of pg.stars) if (!ids.has(st.id) || st.pg !== pg) { if (STARS.get(st.id) === st) { st.el.remove(); STARS.delete(st.id); } }
  pg.stars = want.map((w) => {
    let st = STARS.get(w.id);
    if (st && st.pg !== pg) { st.el.remove(); st = null; } // a block that moved to this page gets a fresh star here
    if (!st) { st = { ...w, pg, el: starEl(w.id, w.type), seat: [0, 0], dir: [0, 1], x: -99, y: -99, lx: 0, ly: 0, sx: 0, sy: 0, bx: 0, by: 0, under: false, sig: "", tf: "" }; STARS.set(w.id, st); $("stars").append(st.el); }
    st.b = w.b; st.k = w.k;
    st.el.dataset.sys = pg.sys || "";
    refreshStar(st);
    return st;
  });
  seats(pg);
}

// Far away the seats keep their size on screen; below 0.16 they shrink with the sky.
const kzOf = (z) => 1 / clamp(z, 0.16, Z_FAR);
const SEEN = /^(alert|watch|good|info)$/; // the stars whose names show far away (kosmos.css shows the others' on hover)
// The size of a name: read once it shows and kept until its text changes. Before it ever showed, a guess.
function labSize(o, el, shown, guess) {
  if (!o.labSize && shown) o.labSize = [el.offsetWidth, el.offsetHeight];
  return o.labSize || guess;
}
// What a constellation takes on screen around its lead star, at the scale c of its seats: its stars, the names
// beside them and its own name.
function boxOf(pg, c) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y, w, h) => { b[0] = Math.min(b[0], x - w / 2); b[1] = Math.min(b[1], y - h / 2); b[2] = Math.max(b[2], x + w / 2); b[3] = Math.max(b[3], y + h / 2); };
  for (const st of pg.stars) {
    const x = c * st.seat[0], y = c * st.seat[1];
    add(x, y, 18, 18);
    if (!pg.sys || !SEEN.test(st.el.dataset.kind)) continue;
    const [w, h] = labSize(st, st.el.lastChild, !st.el.hidden, [96, 26]);
    add(x + st.dir[0] * (w / 2 + 16), y + st.dir[1] * (h / 2 + 14), w, h);
  }
  const [w, h] = labSize(pg, pg.lab, !pg.lab.hidden, [150, 36]);
  add(c * pg.labAt[0] + (pg.out[0] * w) / 2, c * pg.labAt[1] + pg.labAt[2] + (pg.out[1] * h) / 2, w, h);
  return b;
}
// Constellations keep their size, so where pages lie close one would cover another. There a topic steps aside from
// «Heute», an own page from both, and two of a kind go half the way each. The step is part of their stars' seats,
// so it fades out as a page unfolds.
const rank = (pg) => (pg.sys === "heute" ? 0 : pg.sys ? 1 : 2);
function spread(z) {
  const all = [...pages.values()], GAP = 14;
  for (const pg of all) { pg.fx = 0; pg.fy = 0; }
  if (z >= Z_NEAR) return;
  const c = z * kzOf(z), cx = (pg) => pg.x * z + pg.fx, cy = (pg) => (pg.y + CY) * z + pg.fy;
  for (const pg of all) pg.box = boxOf(pg, c);
  // How far a page moves along u until it clears the other one on one axis.
  const clear = (u, a0, a1, b0, b1) => (Math.abs(u) < 1e-3 ? Infinity : (u > 0 ? b1 + GAP - a0 : a1 + GAP - b0) / Math.abs(u));
  for (let n = 0; n < 3; n++) for (const a of all) for (const b of all) {
    if (a === b || !rank(a) || rank(b) > rank(a)) continue;
    const A = a.box, B = b.box, ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b);
    if (ax + A[0] >= bx + B[2] + GAP || bx + B[0] >= ax + A[2] + GAP || ay + A[1] >= by + B[3] + GAP || by + B[1] >= ay + A[3] + GAP) continue;
    let dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy);
    if (d < 1) { dx = 1; dy = 0; d = 1; }
    const ux = dx / d, uy = dy / d, t = Math.min(clear(ux, ax + A[0], ax + A[2], bx + B[0], bx + B[2]), clear(uy, ay + A[1], ay + A[3], by + B[1], by + B[3])) * (rank(b) < rank(a) ? 1 : 0.5);
    a.fx += ux * t; a.fy += uy * t;
  }
}

// ───────────── Camera frames ─────────────
function framePage(pg) {
  const p = PAD(), hh = pg.h || 460, ah = H - p.t - p.b, z = clamp(ah / hh, narrow() ? 1 : 0.82, 1), top = hh * z <= ah ? p.t + (ah - hh * z) * 0.36 : p.t;
  return { z, x: pg.x - GUT / 2 - (p.l - p.r) / 2 / z, y: pg.y + (H / 2 - top) / z };
}
// The whole sky: every constellation with room around it. They step aside from each other, so the frame holds what
// they take then; where the screen is too small for that, it goes further out, where they shrink. Not on a phone: there
// the names stand below their stars and would run into each other.
function frameAll() {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const pg of pages.values()) { b.x0 = Math.min(b.x0, pg.x); b.x1 = Math.max(b.x1, pg.x); b.y0 = Math.min(b.y0, pg.y + CY); b.y1 = Math.max(b.y1, pg.y + CY); }
  const p = PAD(), mx = narrow() ? 84 : 170, my = narrow() ? 84 : 130, aw = Math.max(60, W - p.l - p.r - 2 * mx), ah = Math.max(60, H - p.t - p.b - 2 * my);
  const z0 = clamp(Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0)), ZMIN, 0.46), low = narrow() ? z0 : ZMIN;
  for (let z = z0; ; z = Math.max(low, z * 0.9)) {
    spread(z);
    const s = [Infinity, Infinity, -Infinity, -Infinity];
    for (const pg of pages.values()) {
      const x = pg.x * z + pg.fx, y = (pg.y + CY) * z + pg.fy;
      s[0] = Math.min(s[0], x + pg.box[0]); s[1] = Math.min(s[1], y + pg.box[1]); s[2] = Math.max(s[2], x + pg.box[2]); s[3] = Math.max(s[3], y + pg.box[3]);
    }
    if (z <= low || (s[2] - s[0] <= W - p.l - p.r - 32 && s[3] - s[1] <= H - p.t - p.b - 16)) return { z, x: ((s[0] + s[2]) / 2 - (p.l - p.r) / 2) / z, y: ((s[1] + s[3]) / 2 - (p.t - p.b) / 2) / z };
  }
}

// ───────────── The lens rule: what the glass touches shows the lens' month, block by block ─────────────
function lensRule() {
  const on = lens.rr > 1, r2 = lens.rr * lens.rr, z = cam.z, open = M.p > 0.5;
  for (const st of STARS.values()) {
    if (st.type === "lead") continue;
    const b = st.b;
    let u = false;
    if (on) {
      u = (st.x - lens.x) ** 2 + (st.y - lens.y) ** 2 < r2;
      // A block under the glass may get shorter or taller. It stays under it as long as the lens is over the taller of the two.
      if (!u && st.type === "block" && open) { const x0 = st.pg.ox - GUT * z, y0 = st.pg.oy + (b.top + b.fy) * z, hh = st.under ? Math.max(b.h, b.uh || 0) : b.h; u = lens.x > x0 && lens.x < st.pg.ox + PAGE_W * z && lens.y > y0 - 4 && lens.y < y0 + hh * z + 4; }
      if (!u && st.type === "chip") u = b.under;
    }
    if (u === st.under) continue;
    st.under = u;
    if (st.type === "block" && b.under !== u) { b.under = u; if (u) b.uh = b.h; if (b.t === null) refreshBlock(b, "step"); }
    else refreshStar(st);
  }
}

// ───────────── The ground: dot grid, the threads of the pages, tethers, the tint inside the lens ─────────────
// Where a line from a to b leaves the text of a page (Liang-Barsky). 0 if it never runs through it.
function exitT(pg, ax, ay, bx, by) {
  const z = cam.z, x0 = pg.ox - 4, x1 = pg.ox + PAGE_W * z + 12, y0 = pg.oy - 8, y1 = pg.oy + pg.h * z + 8, dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return 0; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return 0; if (r > t0) t0 = r; } else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return t1 < 1 ? t1 : 0;
}
function drawSky() {
  const z = cam.z, e = M.e, TH = THEME;
  for (const g of [g2, g3]) { g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H); }
  // Below the pages: the dot grid and the tint inside the lens.
  const dots = (step, alpha, size) => {
    const s = step * z;
    if (alpha < 0.012 || s < 10) return;
    g2.fillStyle = rgba(TH.grid, alpha * TH.gridA);
    const x0 = (((W / 2 - cam.x * z) % s) + s) % s, y0 = (((H / 2 - cam.y * z) % s) + s) % s;
    for (let x = x0; x < W; x += s) for (let y = y0; y < H; y += s) g2.fillRect(x - size / 2, y - size / 2, size, size);
  };
  dots(48, clamp((z - 0.4) / 0.6, 0, 1) * 0.2, 1.1);
  dots(240, 0.34, z < 0.5 ? 1.5 : 1.9);
  dots(1200, z < 0.3 ? 0.5 : 0, 2);
  if (lens.rr > 1 && lens.alpha > 0.01) {
    const gr = g2.createRadialGradient(lens.x, lens.y, lens.rr * 0.25, lens.x, lens.y, lens.rr);
    gr.addColorStop(0, rgba(TH.tint, 0.04 * lens.alpha * TH.tintA));
    gr.addColorStop(1, rgba(TH.tint, 0.12 * lens.alpha * TH.tintA));
    g2.fillStyle = gr;
    g2.beginPath(); g2.arc(lens.x, lens.y, lens.rr, 0, 6.2832); g2.fill();
  }
  // Above the pages (so a page that is a sheet does not hide them): threads, the lens' parking ring, tethers.
  g3.lineWidth = 1;
  if (lensDrag && lens.k > 0) {
    const [px, py] = parkPos(), near = Math.hypot(lens.x - px, lens.y - py) < parkZone();
    g3.strokeStyle = rgba(TH.thread, (near ? 0.85 : 0.35) * TH.threadA);
    g3.setLineDash([3, 5]);
    g3.beginPath(); g3.arc(px, py, coinR(), 0, 6.2832); g3.stroke();
    g3.setLineDash([]);
  }
  // The thread of each page: a spoke from its lead star to each of its blocks. Far away the spokes draw the constellation;
  // close up they all fall onto the margin, where one stroke of the whole path makes them a single thread.
  g3.strokeStyle = rgba(TH.thread, lerp(0.4, 0.13, e) * TH.threadA);
  g3.beginPath();
  for (const pg of pages.values()) {
    const lead = pg.stars[0];
    if (lead) for (const st of pg.stars) if (st.type === "block") { g3.moveTo(lead.x, lead.y); g3.lineTo(st.x, st.y); }
  }
  g3.stroke();
  // Calm figures hang on the quiet line's star. Close up they stand in the line itself and need no thread.
  if (e < 0.97) {
    g3.strokeStyle = rgba(TH.thread, 0.26 * (1 - e) * TH.threadA);
    g3.beginPath();
    for (const st of STARS.values()) { if (st.type !== "chip") continue; const q = STARS.get("B:" + st.b.id); if (q) { g3.moveTo(q.x, q.y); g3.lineTo(st.x, st.y); } }
    g3.stroke();
  }
  // Tethers: from a figure's block on another page to the place where the figure lives.
  for (const st of STARS.values()) {
    if (st.type !== "block" || st.b.kind !== "kpi" || st.pg.id === topicId(st.b.k)) continue;
    const hs = homeStar(st.b.k);
    if (!hs) continue;
    const hot = hotStar === st.id || selId === st.b.id, a = (hot ? 0.66 : lerp(0.36, 0.14, e)) * TH.threadA;
    let x0 = st.x, y0 = st.y;
    // Close up the thread starts where it leaves the page, so it never runs through the text.
    if (e > 0) { const t = exitT(st.pg, st.x, st.y, hs.x, hs.y) * e; x0 = lerp(st.x, hs.x, t); y0 = lerp(st.y, hs.y, t); }
    if (Math.hypot(hs.x - x0, hs.y - y0) < 8) continue;
    const gr = g3.createLinearGradient(x0, y0, hs.x, hs.y);
    gr.addColorStop(0, rgba(TH.thread, a)); gr.addColorStop(1, rgba(TH.thread, a * 0.3));
    g3.strokeStyle = gr;
    g3.setLineDash([2, 6]);
    g3.beginPath(); g3.moveTo(x0, y0); g3.lineTo(hs.x, hs.y); g3.stroke();
    g3.setLineDash([]);
  }
}

// ───────────── One frame ─────────────
function travel(el, st, e) {
  const fy = st.b ? st.b.fy : 0;
  const tf = e >= 0.999 && !fy ? "" : `translate(${((1 - e) * (st.sx - st.bx)).toFixed(1)}px,${((1 - e) * (st.sy - st.by) + fy).toFixed(1)}px) scale(${(0.82 + 0.18 * e).toFixed(3)})`;
  if (el._tf !== tf) { el._tf = tf; el.style.transform = tf; }
}
function setActive(id) {
  if (activeId === id) return;
  const a = pages.get(activeId), b = pages.get(id);
  if (a) a.el.classList.remove("is-active");
  if (b) b.el.classList.add("is-active");
  activeId = id;
  for (const btn of $("places").children) if (btn.dataset.place) btn.setAttribute("aria-current", String(btn.dataset.place === id));
  if (id) HOST.onPlace(id);
}
function draw() {
  const z = cam.z, p = clamp((z - Z_FAR) / (Z_NEAR - Z_FAR), 0, 1), e = p * p * (3 - 2 * p);
  M.p = p; M.e = e; M.kz = kzOf(z);
  const far = clamp(1 - p / 0.5, 0, 1); // the far names are gone before any text shows
  if (far !== M.far) { M.far = far; stage.style.setProperty("--far", far.toFixed(3)); stage.classList.toggle("is-far", far > 0.5); }
  // 1 · read the layout where it changed, and keep the pages clear of each other
  for (const pg of pages.values()) if (pg.dirty) measure(pg);
  keepRingClear();
  // 2 · where every star stands in this frame
  for (const pg of pages.values()) { const [ox, oy] = toScreen(pg.x - PAGE_W / 2, pg.y); pg.ox = ox; pg.oy = oy; }
  spread(z);
  for (const pg of pages.values()) {
    const ox = pg.ox, oy = pg.oy;
    for (const st of pg.stars) {
      const b = st.b;
      let bx = -GUT, by;
      if (st.type === "lead") by = pg.lead[1];
      else if (st.type === "chip") { const v = VIEWS.get(b.id), it = v && v.items.get(st.k); if (it) { bx = it.pos[0]; by = it.pos[1] + b.fy; } else by = b.top + 9 + b.fy; }
      else by = b.top + 9 + b.fy;
      st.sx = PAGE_W / 2 + st.seat[0] * M.kz + pg.fx / z; st.sy = CY + st.seat[1] * M.kz + pg.fy / z; st.bx = bx; st.by = by;
      st.lx = lerp(st.sx, bx, e); st.ly = lerp(st.sy, by, e);
      st.x = ox + z * st.lx; st.y = oy + z * st.ly;
    }
  }
  // 3 · the lens, then the ground
  lensRule();
  drawSky();
  // 4 · write: pages and their blocks, stars, names, the lens
  const op = p >= 1 ? 1 : clamp((p - 0.8) / 0.2, 0, 1), opening = p >= 0.9, snap = Math.abs(z - 1) < 0.002;
  let best = null, bestD = Infinity;
  for (const pg of pages.values()) {
    const x0 = pg.ox - (GUT + 12) * z, w = (PAGE_W + GUT + 12) * z, hh = Math.max(60, pg.h) * z;
    const vis = op > 0 && x0 < W + 80 && x0 + w > -80 && pg.oy < H + 80 && pg.oy + hh > -80;
    if (vis !== pg.vis) { pg.vis = vis; pg.el.style.visibility = vis ? "" : "hidden"; }
    const open = vis && opening;
    if (open !== pg.open) { pg.open = open; pg.el.classList.toggle("is-open", open); pg.el.inert = !open; }
    if (!vis) continue;
    const tf = `translate(${snap ? Math.round(pg.ox) : pg.ox.toFixed(2)}px,${snap ? Math.round(pg.oy) : pg.oy.toFixed(2)}px) scale(${z.toFixed(4)})`;
    if (pg.tf !== tf) { pg.tf = tf; pg.el.style.transform = tf; }
    if (pg.op !== op) { pg.op = op; pg.el.style.opacity = op >= 1 ? "" : op.toFixed(3); }
    for (const st of pg.stars) {
      if (st.type === "lead") travel(pg.head, st, e);
      else if (st.type === "block") { const v = VIEWS.get(st.b.id); if (v) travel(v.el, st, e); }
    }
    if (open) {
      const cx = clamp(W / 2, x0, x0 + w), cy = clamp(H / 2, pg.oy, pg.oy + hh), d = Math.hypot(cx - W / 2, cy - H / 2);
      if (d < bestD) { bestD = d; best = pg; }
    }
  }
  setActive(best && bestD < Math.min(W, H) * 0.42 ? best.id : null);
  for (const st of STARS.values()) {
    const vis = st.x > -30 && st.x < W + 30 && st.y > -30 && st.y < H + 30;
    if (st.el.hidden === vis) st.el.hidden = !vis;
    if (!vis) continue;
    const tf = `translate(${st.x.toFixed(1)}px,${st.y.toFixed(1)}px)`;
    if (st.tf !== tf) { st.tf = tf; st.el.style.transform = tf; }
  }
  const labels = far > 0.02;
  for (const pg of pages.values()) {
    const x = pg.ox + z * (PAGE_W / 2 + pg.labAt[0] * M.kz) + pg.fx * (1 - e), y = pg.oy + z * (CY + pg.labAt[1] * M.kz) + pg.labAt[2] + pg.fy * (1 - e), vis = labels && x > -120 && x < W + 120 && y > -40 && y < H + 40;
    if (pg.lab.hidden === vis) pg.lab.hidden = !vis;
    if (vis) pg.lab.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  }
  placeLens();
  placeHint();
}
