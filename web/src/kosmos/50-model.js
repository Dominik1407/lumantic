// ═════ Kosmos · pages and blocks ═════
// A page:  { id, title, x (centre of its column), y (its top), sys: "heute" | "g:<topic>" | null, blocks: [ids in reading order] }
// A block: { id, page, kind: "kpi" | "quiet" | "note" | "ghost" | "answer", k, form, open (evidence view), segs (note), q and text (Lumina's answer), t (month held on the block), auto }
// Lumina's pages hold auto blocks, written again for every month. Everything else belongs to the person.
const pages = new Map(), blocks = new Map(), VIEWS = new Map(), STARS = new Map(), dismissed = new Set();
const FORMS = ["zeile", "satz", "zahl", "diagramm"], FORM_NAME = { zeile: "Zeile", satz: "Satz", zahl: "Zahl", diagramm: "Diagramm" };
const VIEW_NAME = { trend: "Verlauf", run: "Verlauf", parts: "Zusammensetzung", bridge: "Brücke", cum: "Kumuliert", drivers: "Zähler und Nenner", compare: "Vergleich", daily: "Tagesverlauf" };
let seq = 0, activeId = null, hotStar = null, selId = null, seenHint = false;
const newId = (p) => p + (++seq).toString(36) + Math.floor(Math.random() * 1296).toString(36);
const scopeOf = (pg) => (pg.sys && pg.sys !== "heute" ? pg.sys.slice(2) : "all");
const topicId = (kid) => "g:" + K[kid].group;
const pageName = (pg) => (pg.sys === "heute" ? "Heute" : pg.sys ? GROUPS[pg.sys.slice(2)] : pg.title || "Eigene Seite");
// Lumina's form for a figure: on «Heute» a sentence for what needs you and one line for the rest, on a topic page the number.
const defForm = (pg, kid) => (pg.sys === "heute" ? (kid && stateOf(K[kid], T.base).level !== "alert" && stateOf(K[kid], T.base).level !== "calm" ? "zeile" : "satz") : pg.sys ? "zahl" : "satz");
const blocksOf = (pg) => pg.blocks.map((id) => blocks.get(id)).filter(Boolean);
// The month a block shows: the one held on it, else the lens' month while the glass touches it, else the month of the room.
const effM = (b) => (b.t !== null ? b.t : b.under ? lens.m : T.base);

function addPage(p) {
  const pg = { title: "", sys: null, blocks: [], forms: {}, stars: [], dirty: true, h: 0, lead: [0, 14], out: [0, 1], labAt: [0, 30], ghostQuiet: false, user: false, vis: null, open: null, ...p };
  pages.set(pg.id, pg);
  buildPage(pg);
  return pg;
}
function makeBlock(pg, b) {
  const blk = { kind: "kpi", k: null, form: null, open: null, segs: null, t: null, auto: false, lift: false, cid: null, under: false, top: 0, h: 0, fy: 0, fy0: 0, ...b, page: pg.id };
  blocks.set(blk.id, blk);
  return blk;
}
function insertBlock(pg, b, at) {
  const blk = makeBlock(pg, b);
  if (at === undefined || at === null || at < 0 || at > pg.blocks.length) pg.blocks.push(blk.id); else pg.blocks.splice(at, 0, blk.id);
  return blk;
}
// Forgets a block and its view. The page's order is the caller's business.
function forget(id) {
  const v = VIEWS.get(id);
  if (v) { v.el.remove(); VIEWS.delete(id); }
  blocks.delete(id);
  if (selId === id) selId = null;
}
function dropBlock(id) {
  const b = blocks.get(id), pg = b && pages.get(b.page);
  if (pg) pg.blocks = pg.blocks.filter((x) => x !== id);
  forget(id);
}
function removePage(pg) {
  for (const id of [...pg.blocks]) forget(id);
  for (const st of pg.stars) { st.el.remove(); STARS.delete(st.id); }
  pg.stars = [];
  if (pg.ro) pg.ro.disconnect();
  pg.lab.remove();
  pg.el.remove();
  pages.delete(pg.id);
  if (activeId === pg.id) activeId = null;
  renderPlaces();
  invalidate();
}

// ───────────── Lumina's pages: which blocks they have in this month ─────────────
// Calm figures of a page's scope stand in its quiet line, unless they have a block of their own there.
function quietKpis(pg) {
  const own = new Set(blocksOf(pg).filter((b) => b.kind === "kpi" && (b.auto || b.lift)).map((b) => b.k));
  return scopeKpis(scopeOf(pg)).filter((k) => !own.has(k.id));
}
const pageHasView = (pg, kid, kind) => blocksOf(pg).some((b) => b.kind === "kpi" && b.k === kid && ((b.form === "diagramm" && (b.open || "trend") === kind) || b.open === kind));
// Lumina's best view for a figure that is not on the page yet. The plain Verlauf is always one click away, so it is never suggested.
function ghostFor(pg, kid) {
  const k = K[kid], kinds = new Set(viewsFor(k).map((v) => v.kind));
  return candidatesFor(k.group, T.base).find((c) => c.k === kid && c.kind !== "trend" && kinds.has(c.kind) && CHARTS[c.kind] && !pageHasView(pg, kid, c.kind) && !dismissed.has(pg.id + "|" + c.id)) || null;
}
// Signals get a block each, in order of urgency. The person's own blocks stay where they put them. With resort
// (the month changed) Lumina's order returns; without it her blocks keep the order the person gave them.
function syncAuto(pg, resort) {
  const m = T.base, pre = "a:" + pg.id + ":", qid = "q:" + pg.id, xid = "x:" + pg.id;
  const lifted = new Set(blocksOf(pg).filter((b) => b.kind === "kpi" && b.lift).map((b) => b.k));
  // «Heute» lifts what the Kosmos' status says; a topic page what the raster the person reads in says.
  const judge = pg.sys === "heute" ? stateOf : shownOf;
  const sig = scopeKpis(scopeOf(pg)).map((k) => judge(k, m)).filter((r) => r.level !== "calm" && !lifted.has(r.k.id)).sort((a, b) => b.score - a.score).map((r) => pre + r.k.id);
  for (const id of sig) { const kid = id.slice(pre.length), form = pg.forms[kid] || defForm(pg, kid), b = blocks.get(id); if (b) b.form = form; else makeBlock(pg, { id, kind: "kpi", k: kid, form, auto: true }); }
  const out = [], kept = new Set();
  let last = -1, ai = 0;
  for (const id of pg.blocks) {
    if (id === xid) continue;
    if (!id.startsWith(pre)) { if (id === qid || blocks.has(id)) out.push(id); continue; }
    const next = resort ? (ai < sig.length ? sig[ai++] : null) : sig.includes(id) && !kept.has(id) ? id : null;
    if (next) { out.push(next); kept.add(next); last = out.length - 1; }
  }
  const rest = sig.filter((id) => !kept.has(id));
  out.splice(last + 1, 0, ...rest);
  for (const id of pg.blocks) if (id.startsWith(pre) && !sig.includes(id)) forget(id);
  pg.blocks = out;
  // the quiet line
  const quiet = quietKpis(pg).length > 0, qi = out.indexOf(qid);
  if (quiet && qi < 0) out.splice(last + 1 + rest.length, 0, qid);
  if (!quiet && qi >= 0) out.splice(qi, 1);
  if (quiet && !blocks.has(qid)) makeBlock(pg, { id: qid, kind: "quiet", auto: true });
  if (!quiet && blocks.has(qid)) forget(qid);
  // one suggestion at most, under the first signal that has one
  if (resort) pg.ghostQuiet = false;
  let g = null;
  if (!pg.ghostQuiet) for (const id of out) {
    const b = blocks.get(id);
    if (!b || !b.auto || b.kind !== "kpi") continue;
    const level = judge(K[b.k], m).level, c = level === "alert" || level === "watch" ? ghostFor(pg, b.k) : null;
    if (c) { g = { after: id, k: b.k, cid: c.id }; break; }
  }
  const old = blocks.get(xid);
  if (g) {
    if (old) { old.k = g.k; old.cid = g.cid; } else makeBlock(pg, { id: xid, kind: "ghost", k: g.k, cid: g.cid, auto: true });
    out.splice(out.indexOf(g.after) + 1, 0, xid);
  } else if (old) forget(xid);
}
// Where a figure lives: its block on its topic page, or its place in that page's quiet line.
function homeStar(kid) {
  const pid = topicId(kid), a = STARS.get("B:a:" + pid + ":" + kid);
  if (a) return a;
  const pg = pages.get(pid), lifted = pg && pg.stars.find((s) => s.type === "block" && s.b.kind === "kpi" && s.b.k === kid && s.b.lift);
  return lifted || STARS.get("C:" + pid + ":" + kid) || null;
}
// A copy of a block for another page. Taken from under the lens, it keeps the lens' month.
const copyOf = (b) => ({ id: newId("b"), kind: b.kind, k: b.k, form: b.kind === "kpi" ? b.form || "satz" : null, open: b.open, segs: b.segs ? JSON.parse(JSON.stringify(b.segs)) : null, q: b.q || null, text: b.text || null, t: b.t !== null ? b.t : b.under ? lens.m : null });

// ───────────── The room: «Heute» in the middle, the topics on a wide ring ─────────────
// The ring grows with the screen, so a neighbouring page never shows while one page is in view.
function ringFor() {
  if (narrow()) { const rx = Math.max(640, W * 0.85 + 330); return { rx, ry: rx * 2.75 }; }
  const rx = W * 1.5 + 600;
  return { rx, ry: clamp((rx * 1.05 * (H - 440)) / Math.max(200, W - 420), 640, rx * 1.2) };
}
const NARROW_ANGLES = [-90, -36, 50, 130, 216]; // five topics on a phone: one on top, two flanks, two below
// The direction of a topic seen from «Heute», in degrees. Any number of topics share the ring evenly.
const angleOf = (gi) => (narrow() && GROUP_ORDER.length === 5 ? NARROW_ANGLES[gi] : -90 + (gi * 360) / Math.max(1, GROUP_ORDER.length));
// The ring also keeps clear of the pages' own height: where a topic stands right above or below «Heute», the two are
// as far apart as the upper one is long, plus air. That distance only grows, so pages do not wander back and forth.
let ringMinY = 0;
function ringNeed() {
  const ring = ringFor(), mid = pages.get("heute");
  let need = 0;
  GROUP_ORDER.forEach((gid, gi) => {
    const pg = pages.get("g:" + gid), a = (angleOf(gi) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(s) < 0.05 || Math.abs(c) * ring.rx >= PAGE_W + GUT + 160) return; // side by side: no overlap
    const upper = s > 0 ? mid : pg;
    need = Math.max(need, ((upper.h || 0) + 240) / Math.abs(s));
  });
  return need;
}
function placeWorld() {
  const ring = ringFor(), mid = pages.get("heute");
  ringMinY = Math.max(ringMinY, ringNeed());
  const ry = Math.max(ring.ry, ringMinY);
  if (!mid.user) { mid.x = 0; mid.y = -CY; }
  GROUP_ORDER.forEach((gid, gi) => {
    const pg = pages.get("g:" + gid), a = (angleOf(gi) * Math.PI) / 180;
    if (!pg.user) { pg.x = Math.round(ring.rx * Math.cos(a)); pg.y = Math.round(ry * Math.sin(a)) - CY; }
  });
}
// After the pages were measured: when one grew into its neighbour's way, the ring widens. The page in view keeps its
// place on the screen, so nothing jumps while someone reads.
function keepRingClear() {
  // A flight or a pan sets the camera frame by frame; the ring waits until it has landed.
  if (flyStop || zoomAnim || scrollAnim || ringNeed() <= ringMinY + 1) return;
  const pg = pages.get(activeId), y0 = pg ? pg.y : 0;
  placeWorld();
  if (pg && pg.y !== y0 && M.p >= 0.9) cam.y += pg.y - y0;
}
function buildWorld() {
  addPage({ id: "heute", sys: "heute", x: 0, y: -CY });
  for (const gid of GROUP_ORDER) addPage({ id: "g:" + gid, sys: "g:" + gid, x: 0, y: 0 });
  placeWorld();
}

// ───────────── Remembering what the person built: the host keeps it in the workspace on the server ─────────────
let saveTimer = 0;
function snapshot() {
  const own = (b) => ({ id: b.id, kind: b.kind, k: b.k, form: b.form, open: b.open, segs: b.segs, q: b.q, text: b.text, t: b.t, lift: b.lift });
  return { v: 1, seq, seen: seenHint, grain: G, dismissed: [...dismissed], pages: [...pages.values()].map((pg) => ({ id: pg.id, sys: pg.sys, title: pg.title, x: Math.round(pg.x), y: Math.round(pg.y), user: pg.user, forms: pg.forms,
    order: pg.blocks.filter((id) => id[0] !== "x"), own: blocksOf(pg).filter((b) => !b.auto).map(own) })) };
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => HOST.save(snapshot()), 350);
}
function load() {
  let d = null;
  try { d = HOST.stored(); } catch (e) { /* start fresh */ }
  if (!d || d.v !== 1 || !Array.isArray(d.pages)) return;
  seq = Math.max(seq, Number(d.seq) || 0);
  seenHint = !!d.seen;
  if (AVAILABLE.includes(d.grain)) G = d.grain;
  for (const c of d.dismissed || []) if (typeof c === "string") dismissed.add(c);
  for (const s of d.pages) {
    if (!s || typeof s.id !== "string") continue;
    let pg = pages.get(s.id);
    if (!pg) {
      if (s.sys || !/^p/.test(s.id)) continue;
      pg = addPage({ id: s.id, title: String(s.title || "").slice(0, 60), x: Number(s.x) || 0, y: Number(s.y) || 0, user: true });
    } else if (s.user && Number.isFinite(s.x) && Number.isFinite(s.y)) { pg.x = s.x; pg.y = s.y; pg.user = true; }
    for (const [kid, f] of Object.entries(s.forms || {})) if (K[kid] && FORMS.includes(f)) pg.forms[kid] = f;
    const mine = new Set();
    for (const b of Array.isArray(s.own) ? s.own : []) {
      if (!b || typeof b.id !== "string" || !/^b/.test(b.id) || blocks.has(b.id) || !["kpi", "note", "answer"].includes(b.kind) || (b.kind === "kpi" && !K[b.k])) continue;
      makeBlock(pg, { id: b.id, kind: b.kind, k: b.kind === "kpi" ? b.k : null, form: b.kind === "kpi" ? (FORMS.includes(b.form) ? b.form : "satz") : null, open: VIEW_NAME[b.open] ? b.open : null,
        segs: Array.isArray(b.segs) ? b.segs.filter((x) => x && (typeof x.t === "string" || K[x.k])) : null, q: typeof b.q === "string" ? b.q.slice(0, 400) : null, text: typeof b.text === "string" ? b.text.slice(0, 2000) : null, t: Number.isInteger(b.t) && b.t >= 0 && b.t <= TODAY ? b.t : null, lift: !!b.lift });
      mine.add(b.id);
    }
    const order = (Array.isArray(s.order) ? s.order : []).filter((id) => mine.has(id) || (pg.sys && typeof id === "string" && (id.startsWith("a:" + pg.id + ":") || id === "q:" + pg.id)));
    pg.blocks = order.concat([...mine].filter((id) => !order.includes(id)));
  }
}
