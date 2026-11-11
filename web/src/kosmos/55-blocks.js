// ═════ Kosmos · the blocks of a page. Every block is its own instance, with its own form, evidence and month. ═════
const shortWhy = (s) => (s.length < 112 ? s : s.split(". ").pop());
// A figure in few characters, for the quiet line: «117 %», «33.9 Mrd.», «1’150 Mio.».
const shortF = (k, v) => (k.unit === "%" ? v.toFixed(k.dec) + " %" : k.unit === "Mrd" ? (v / 1000).toFixed(1) + " Mrd." : (v < 0 ? "−" : "") + amount(k, v));
// After a block changed (form, evidence, month): redraw it, recolour its star, measure its page again.
function refreshBlock(b, mode) {
  const v = VIEWS.get(b.id), pg = pages.get(b.page);
  if (!v || !pg) return;
  v.update(effM(b), mode);
  for (const st of pg.stars) if (st.b === b) refreshStar(st);
  pg.dirty = true;
  invalidate();
}
// The small month tag: it shows while the lens touches the block, and stays when the month is held on the block.
function syncTag(v, m) {
  const b = v.b, held = b.t !== null, show = held || m !== T.base;
  v.tag.hidden = !show;
  if (!show) return;
  const text = periodOf(m).label + (held ? " ×" : "");
  if (v.tag.textContent !== text) v.tag.textContent = text;
  v.tag.dataset.pin = String(held);
  v.tag.title = held ? "Festgehalten. Ein Klick lässt den Baustein wieder mitlaufen." : `Ein Klick hält ${THIS[G]} auf dem Baustein fest.`;
}
const tagEl = () => h("button", { class: "tag", type: "button", "data-tag": "1", hidden: true });
function toolsEl(b) {
  const kids = b.kind === "kpi" ? FORMS.map((f) => h("button", { class: "fm", type: "button", "data-form": f, title: `Als ${FORM_NAME[f]} zeigen`, text: FORM_NAME[f] })) : [];
  if (!b.auto) kids.push(h("button", { class: "rm", type: "button", "data-rm": "1", "aria-label": "Baustein entfernen", title: "Entfernen (Entf)" }, "×"));
  return h("span", { class: "tools" }, ...kids);
}

// A figure as a block: sentences, one large number, or a chart.
function kpiView(b) {
  const k = K[b.k], away = b.page !== topicId(b.k);
  const stw = h("span", { class: "stw" }), tag = tagEl(), lroll = makeRoll(shortF(k, k.series[T.base]), "num"), lsp = sparkEl(k);
  // In the one-line form and above a chart the figure stands in the label line itself.
  const lv = h("span", { class: "lv", hidden: true }, factEl("trend", [lroll], "val"), sparkButton(lsp));
  const home = away ? h("button", { class: "home", type: "button", "data-home": k.id, title: `Zu ${k.name} auf der Seite ${GROUPS[k.group]} fliegen` }, "→ " + GROUPS[k.group]) : null;
  const main = h("div", { class: "main" }), evPad = h("div", { class: "ev-pad" }), evBox = h("div", { class: "ev", "data-open": "false" }, h("div", { class: "ev-in" }, evPad));
  const el = h("section", { class: "blk", "data-id": b.id, "aria-label": k.name }, h("div", { class: "lbl" }, h("span", { class: "nm", text: k.name }), stw, lv, tag, home, toolsEl(b)), main, evBox);
  const v = { b, k, el, main, evBox, evPad, tag, form: null, sents: new Map(), para: null, big: null, evKind: null, evFixed: false, chart: null, cap: null, fresh: true, m: T.base };
  v.update = (m, mode) => {
    v.m = m;
    const r = shownOf(k, m), form = FORMS.includes(b.form) ? b.form : "satz", inLabel = form === "zeile" || form === "diagramm";
    el.dataset.kind = r.kind;
    // In days and weeks a figure without daily values shows its month, and says so.
    swapText(stw, r.label + (fine(G) && r.g !== G ? (hasFine(k) ? " · Monat" : " · nur monatlich erhoben") : ""), mode);
    syncTag(v, m);
    if (v.form !== form) {
      v.form = form; v.sents.clear(); v.para = v.big = null;
      main.replaceChildren();
      el.dataset.form = form;
      el.querySelectorAll(".fm").forEach((f) => f.setAttribute("aria-pressed", String(f.dataset.form === form)));
    }
    lv.hidden = !inLabel;
    if (inLabel) { rollSet(lroll, shortF(k, r.cur), rollMode(mode)); sparkSet(lsp, m); }
    else if (form === "zahl") drawBig(v, r, mode);
    else drawPara(v, sentencesFor(k, m), mode);
    syncEvidence(v, form === "diagramm" ? b.open || "trend" : b.open || null, m, mode);
    el.querySelectorAll(".fact, .spk").forEach((f) => f.setAttribute("aria-expanded", String(!!v.evKind && (f.dataset.ev === v.evKind || (f.classList.contains("spk") && v.evKind === "trend")))));
  };
  return v;
}
function drawBig(v, r, mode) {
  if (!v.big) {
    const roll = makeRoll(F(v.k, r.cur), "num"), sp = sparkEl(v.k), sub = h("p", { class: "bigsub" });
    v.big = { roll, sp, sub };
    v.main.replaceChildren(h("div", { class: "big" }, factEl("trend", [roll], "val"), sparkButton(sp)), sub);
  }
  rollSet(v.big.roll, F(v.k, r.cur), rollMode(mode));
  sparkSet(v.big.sp, v.m);
  swapText(v.big.sub, gapLine(v.k, r), mode);
}
// Evidence under a block: chips for the views, Lumina's reason, the chart.
function syncEvidence(v, want, m, mode) {
  const k = v.k;
  if (!want) {
    if (v.evKind) { v.evBox.dataset.open = "false"; v.evKind = v.chart = null; setTimeout(() => { if (!v.evKind) v.evPad.replaceChildren(); }, 520); }
    return;
  }
  const fixed = v.form === "diagramm";
  if (v.evKind === want && v.evFixed === fixed) { v.cap.textContent = whyFor(k, want, m); v.chart.draw(m, false); return; }
  const wasOpen = v.evKind !== null, shown = want === "run" ? "trend" : want;
  v.evFixed = fixed;
  const chips = h("div", { class: "chips", role: "group", "aria-label": `Ansichten für ${k.name}` },
    ...viewsFor(k).map((vw) => h("button", { class: "chipb", type: "button", "data-view": vw.kind, "aria-pressed": String(vw.kind === shown) }, vw.name)),
    fixed ? null : h("button", { class: "evx", type: "button", "data-view": "", "aria-label": "Beleg schliessen", title: "Schliessen" }, "×"));
  v.cap = h("p", { class: "cap", text: whyFor(k, want, m) });
  v.chart = makeChart(want, k, want === "compare" ? { ks: COMPARE } : null);
  v.evKind = want;
  v.evPad.replaceChildren(chips, v.cap, v.chart.el);
  v.evBox.dataset.open = "true";
  const grows = !wasOpen && mode !== "init" && !reduced && growInto(v);
  v.chart.draw(m, mode !== "init" && !grows);
  if (grows) v.chart.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 280, easing: "ease-out", fill: "backwards" });
  else if (mode !== "init" && !reduced) v.chart.el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
}
// The word-sized chart grows into the full one.
function growInto(v) {
  const sp = v.el.querySelector(".main .sp") || v.el.querySelector(".lv:not([hidden]) .sp");
  if (!sp) return false;
  const a = sp.getBoundingClientRect(), b = v.chart.plot.getBoundingClientRect();
  if (!a.width || !b.width) return false;
  const g = sp.cloneNode(true);
  g.classList.add("grow");
  // The copy grows by its box, not by a transform, so its strokes stay as thin as they were.
  g.querySelectorAll("path").forEach((p) => p.setAttribute("vector-effect", "non-scaling-stroke"));
  g.querySelectorAll(".sd").forEach((c) => c.remove());
  const box = (r, dy, hh) => ({ left: r.left + "px", top: r.top + dy + "px", width: r.width + "px", height: hh + "px" });
  Object.assign(g.style, box(a, 0, a.height));
  document.body.append(g);
  g.animate([box(a, 0, a.height), box(b, b.height * 0.1, b.height * 0.8)], { duration: 560, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: 300, easing: "ease-in", fill: "forwards" }).onfinish = () => g.remove();
  return true;
}

// «Ruhig»: every calm figure of the page in one line. Each keeps a small star and lifts out on a click.
function quietView(b) {
  const pg = pages.get(b.page), count = h("span", { class: "stw" }), tag = tagEl(), line = h("p", { class: "qline" }), items = new Map();
  const el = h("section", { class: "blk quiet", "data-id": b.id, "aria-label": "Ruhige Kennzahlen" }, h("div", { class: "lbl" }, h("span", { class: "nm", text: "Ruhig" }), count, tag), line);
  const v = { b, el, tag, items, fresh: true, m: T.base };
  v.update = (m, mode) => {
    v.m = m;
    const ks = quietKpis(pg), live = mode !== "init" && mode !== "none" && !reduced && !v.fresh;
    count.textContent = ks.length === 1 ? "eine Kennzahl" : ks.length + " Kennzahlen";
    syncTag(v, m);
    const keep = new Set(ks.map((k) => k.id));
    for (const [kid, it] of items) if (!keep.has(kid)) { it.el.remove(); items.delete(kid); }
    let prev = null;
    for (const k of ks) {
      let it = items.get(k.id);
      if (!it) {
        const roll = makeRoll(shortF(k, k.series[m]), "num"), sp = sparkEl(k), mk = h("span", { class: "qmk", hidden: true });
        it = { el: h("button", { class: "qi", type: "button", "data-k": k.id, title: `${k.name} (${k.long}): als eigenen Baustein zeigen` }, h("span", { class: "qn", text: SHORT[k.id] + " " }), roll, sp, mk), roll, sp, mk, pos: [0, 0] };
        items.set(k.id, it);
        if (live) it.el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
      }
      const want = prev ? prev.nextSibling : line.firstChild;
      if (want !== it.el) line.insertBefore(it.el, want);
      const r = shownOf(k, m);
      it.mk.hidden = r.level === "calm";
      if (r.level !== "calm" && it.mk.textContent !== r.label) it.mk.textContent = r.label;
      rollSet(it.roll, shortF(k, r.cur), rollMode(mode));
      sparkSet(it.sp, m);
      prev = it.el;
    }
  };
  return v;
}

// A live figure inside a note: name, value and word-sized chart follow the month of the note.
function chipEl(k, m) {
  const roll = makeRoll(F(k, shownOf(k, m).cur), "num"), sp = sparkEl(k);
  sparkSet(sp, m);
  const c = h("span", { class: "chip", contenteditable: "false", "data-k": k.id, title: `${k.long}: zur Seite ${GROUPS[k.group]} fliegen` }, h("span", { class: "cn", text: k.name }), " ", roll, sp);
  c._roll = roll; c._sp = sp;
  return c;
}
function updateChips(root, m, mode) {
  root.querySelectorAll(".chip").forEach((c) => { if (c._roll) { const k = K[c.dataset.k]; rollSet(c._roll, F(k, shownOf(k, m).cur), rollMode(mode)); sparkSet(c._sp, m); } });
}
const fillNote = (p, segs, m) => p.replaceChildren(...segs.map((s) => (s.k ? chipEl(K[s.k], m) : s.t)));
function readNote(p) {
  const out = [];
  for (const n of p.childNodes) {
    if (n.nodeType === 1 && n.classList.contains("chip")) out.push({ k: n.dataset.k });
    else { const t = n.textContent; if (t) { const last = out[out.length - 1]; if (last && last.t !== undefined) last.t += t; else out.push({ t }); } }
  }
  return out;
}
function noteView(b) {
  const p = h("p", { class: "para ed", contenteditable: "true", spellcheck: "false", role: "textbox", "aria-label": "Notiz", "data-ph": "Leere Notiz. Schreib etwas, [[ fügt eine Kennzahl ein." }), tag = tagEl();
  const el = h("section", { class: "blk note", "data-id": b.id, "aria-label": "Notiz" }, h("div", { class: "lbl" }, h("span", { class: "nm", text: "Notiz" }), tag, toolsEl(b)), p);
  fillNote(p, b.segs || [], effM(b));
  wireEditor(p, {
    change: () => { if (blocks.has(b.id)) { b.segs = readNote(p); save(); } },
    enter: () => p.blur(),
    blur: () => { if (blocks.has(b.id) && !p.textContent.trim() && !p.querySelector(".chip")) removeBlock(b.id, true); },
  });
  const v = { b, el, p, tag, fresh: true, m: T.base };
  v.update = (m, mode) => { v.m = m; syncTag(v, m); updateChips(p, m, mode); };
  return v;
}
// Lumina's suggestion: a quiet line that becomes a chart on a click or with Tab.
function ghostView(b) {
  const text = h("span", { class: "gtext", "data-ghost": "yes", title: "Übernehmen" });
  const acts = h("span", { class: "gacts" }, h("button", { class: "gyes", type: "button", "data-ghost": "yes" }, "Übernehmen", h("kbd", { text: "Tab" })),
    h("button", { class: "gno", type: "button", "data-ghost": "no", "aria-label": "Vorschlag verwerfen", title: "Verwerfen" }, "×"));
  const el = h("section", { class: "blk ghost", "data-id": b.id, "aria-label": "Vorschlag von Lumina" }, h("p", { class: "gline" }, text, " ", acts));
  const v = { b, el, fresh: true, m: T.base, sig: "" };
  v.update = (m) => {
    v.m = m;
    const kind = b.cid.split(":")[0], k = K[b.k], sig = b.cid + "|" + m;
    if (v.sig === sig) return;
    v.sig = sig;
    text.replaceChildren(h("span", { class: "gst", "aria-hidden": "true", text: "✦" }), " Dazu passt: ", h("b", { text: `${VIEW_NAME[kind]} von ${k.name}` }), ". " + shortWhy(whyFor(k, kind, m)));
  };
  return v;
}
// Lumina's answer to a question: the question as its label, her answer as text. It stays until removed, like a note.
function answerView(b) {
  const el = h("section", { class: "blk answer", "data-id": b.id, "aria-label": "Antwort von Lumina" },
    h("div", { class: "lbl" }, h("span", { class: "nm" }, h("span", { class: "gst", "aria-hidden": "true", text: "✦ " }), "Antwort"), h("span", { class: "aq", text: b.q || "" }), toolsEl(b)),
    h("p", { class: "para", text: b.text || "" }));
  const v = { b, el, fresh: true, m: T.base };
  v.update = (m) => { v.m = m; };
  return v;
}
function viewOf(b) {
  let v = VIEWS.get(b.id);
  if (!v) { v = b.kind === "quiet" ? quietView(b) : b.kind === "note" ? noteView(b) : b.kind === "ghost" ? ghostView(b) : b.kind === "answer" ? answerView(b) : kpiView(b); VIEWS.set(b.id, v); }
  return v;
}

// ───────────── A page: head, blocks, the line where new blocks begin ─────────────
const INS_PH = ["/ Baustein · [[ Kennzahl · oder frag", "Notiz schreiben. Enter legt sie ab, [[ fügt eine Kennzahl ein."];
let RULER_CUR = null;
function buildPage(pg) {
  const head = h("header", { class: "phead" }), list = h("div", { class: "pblocks" });
  const ins = h("div", { class: "ins ed", contenteditable: "true", role: "textbox", "aria-multiline": "false", spellcheck: "false", "aria-label": "Neuer Baustein, Notiz oder Frage an Lumina", "data-ph": INS_PH[0] });
  const say = h("p", { class: "insay", "aria-live": "polite" }), mark = h("div", { class: "dropmark", hidden: true });
  pg.el = h("article", { class: "page", "data-id": pg.id }, head, list, h("div", { class: "insrow" }, ins, say), mark);
  Object.assign(pg, { head, list, ins, say, mark, insNote: false });
  if (pg.sys === "heute") {
    pg.tagEl = h("span", { class: "dl-tag", text: "Heute" });
    pg.when = h("button", { class: "when", type: "button", title: "Ziehen reist durch die Monate" });
    pg.play = h("button", { class: "play", type: "button", "aria-pressed": "false", "aria-label": "Geschichte abspielen", title: "Geschichte abspielen (Leertaste)" }, "▶");
    // The raster the pages are read in. The status of «Heute» and the main menu keeps the Kosmos' own.
    pg.grain = h("span", { class: "grain", role: "radiogroup", "aria-label": "Raster" },
      ...GRAINS.map((g) => h("button", { class: "gb", type: "button", role: "radio", "data-grain": g, "aria-checked": String(g === G), "aria-disabled": AVAILABLE.includes(g) ? null : "true",
        title: AVAILABLE.includes(g) ? `In ${RUN_NOUN[g]} lesen (G)` : "Keine Kennzahl dieses Kosmos hat Tageswerte" }, GRAIN_NAME[g])));
    pg.ruler = h("div", { class: "ruler", role: "slider", tabindex: "-1", "aria-label": "Zeitlineal: Monat wählen" });
    pg.rr = h("div", { class: "rr", "data-open": "false" }, h("div", {}, pg.ruler));
    pg.hl = h("h2", { class: "hl" });
    head.append(h("div", { class: "dl" }, pg.tagEl, pg.when, pg.play, pg.grain), pg.rr, pg.hl);
  } else if (pg.sys) {
    pg.tagEl = h("span", { class: "dl-tag", text: GROUPS[pg.sys.slice(2)] });
    pg.whenTxt = h("span", { class: "dl-when" });
    pg.hl = h("h2", { class: "hl" });
    head.append(h("div", { class: "dl" }, pg.tagEl, pg.whenTxt), pg.hl);
  } else {
    pg.titleEl = h("div", { class: "ptitle ed", contenteditable: "true", spellcheck: "false", role: "textbox", "aria-label": "Titel der Seite", "data-ph": "Titel" }, pg.title);
    pg.titleEl.addEventListener("input", () => {
      if (!pg.titleEl.textContent) pg.titleEl.replaceChildren();
      pg.title = pg.titleEl.textContent.replace(/\s+/g, " ").trim().slice(0, 60);
      updateLabel(pg); renderPlaces(); save();
    });
    pg.titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pg.titleEl.blur(); } });
    pg.titleEl.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " ")); });
    pg.titleEl.addEventListener("blur", () => leaveEmptyPage(pg));
    head.append(h("div", { class: "dl" }, pg.titleEl));
  }
  pg.el.inert = true;
  $("pages").append(pg.el);
  pg.lab = h("button", { class: "plabel", type: "button", "data-page": pg.id });
  $("labels").append(pg.lab);
  wireInsert(pg);
  pg.ro = new ResizeObserver(() => { pg.dirty = true; invalidate(); });
  pg.ro.observe(pg.el);
}
function updateHead(pg, mode) {
  const m = T.base, per = periodOf(m), past = !atToday();
  if (pg.sys === "heute") {
    pg.tagEl.textContent = past ? "Rückblick" : "Heute";
    swapText(pg.when, per.long, mode);
    pg.when.setAttribute("aria-label", `${per.long}. Ziehen oder Pfeiltasten wechseln ${ACC[G]}.`);
    if (RULER_CUR) {
      const pm = PERIODS.monat[m];
      RULER_CUR.style.left = (m / TODAY) * 100 + "%";
      RULER_CUR.dataset.edge = m < 5 ? "l" : m > TODAY - 5 ? "r" : "";
      RULER_CUR.firstChild.textContent = `Q${pm.q} ${pm.y}`;
      pg.ruler.setAttribute("aria-valuenow", m);
      pg.ruler.setAttribute("aria-valuetext", per.long);
    }
  } else if (pg.sys) pg.whenTxt.textContent = past || G !== "monat" ? "· " + per.long : ""; // a quarter says which one, also today
  const hl = pg.hl;
  if (!hl) return;
  const text = headlineFor(m, scopeOf(pg), pg.sys !== "heute");
  if (hl._t === text) return;
  if (hl._t && mode === "step" && !reduced) ghostOf(hl);
  const first = !hl._t;
  hl._t = text;
  hl.setAttribute("aria-label", text);
  hl.replaceChildren(...text.split(" ").flatMap((w, i) => (i ? [" ", h("span", { class: "hw", text: w })] : [h("span", { class: "hw", text: w })])));
  if (!reduced && !first && mode !== "init" && mode !== "none") [...hl.children].forEach((w, i) => w.animate([{ opacity: mode === "scrub" ? 0.35 : 0, transform: mode === "scrub" ? "none" : "translateY(.16em)" }, { opacity: 1, transform: "none" }],
    { duration: mode === "scrub" ? 150 : 440, delay: mode === "scrub" ? 0 : 90 + i * 60, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
}
// The name of a page far away: its title, and for Lumina's pages what the page says.
function updateLabel(pg) {
  let sub;
  if (pg.sys === "heute") sub = h("i", { text: headlineFor(T.base, "all") });
  else if (pg.sys) {
    const c = levelCounts(T.base, scopeOf(pg), true), kind = c.alert ? "alert" : c.watch ? "watch" : c.good ? "good" : "calm";
    sub = h("small", { "data-kind": kind, text: c.alert ? (c.alert === 1 ? "eine Sache braucht dich" : `${c.alert} Dinge brauchen dich`) : c.watch ? "im Auge behalten" : c.good ? "gute Nachricht" : "alles ruhig" });
  } else sub = h("small", { text: pg.blocks.length === 1 ? "ein Baustein" : pg.blocks.length + " Bausteine" });
  pg.lab.replaceChildren(pg.sys === "heute" && !atToday() ? "Rückblick" : pageName(pg), sub);
  pg.lab.setAttribute("aria-label", `Zur Seite ${pageName(pg)} fliegen`);
}
// A block that is new on its page fades in under its star.
function born(b) {
  const v = VIEWS.get(b.id), st = STARS.get("B:" + b.id);
  if (v) v.el.animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  if (st) { st.el.classList.remove("is-born"); void st.el.offsetWidth; st.el.classList.add("is-born"); }
}
// Blocks that changed places glide there, and their stars with them.
function flip(pg, old) {
  let any = false;
  for (const b of blocksOf(pg)) {
    const o = old.get(b.id);
    b.fy0 = b.fy = o === undefined ? 0 : o - b.top;
    if (o === undefined) born(b); else if (Math.abs(b.fy0) > 0.5) any = true;
  }
  if (pg.flipStop) { pg.flipStop(); pg.flipStop = null; }
  if (!any) { for (const b of blocksOf(pg)) b.fy = b.fy0 = 0; return; }
  pg.flipStop = tween(420, (e) => { for (const b of blocksOf(pg)) b.fy = b.fy0 * (1 - e); }, easeOut, () => { pg.flipStop = null; });
}
// Writes a page for the month of the room.
// mode: "init" first paint · "scrub" while dragging or playing · "step" one deliberate change of month · "edit" the person changed the page.
function renderPage(pg, mode) {
  const live = mode !== "init" && !reduced && M.p > 0.5 && pg.vis;
  if (pg.dirty) measure(pg);
  const old = new Map(blocksOf(pg).map((b) => [b.id, b.top + b.fy]));
  if (pg.sys) syncAuto(pg, mode !== "edit");
  updateHead(pg, mode);
  let ref = pg.list.firstElementChild;
  for (const b of blocksOf(pg)) {
    const v = viewOf(b);
    if (v.el === ref) ref = ref.nextElementSibling; else pg.list.insertBefore(v.el, ref);
    v.update(effM(b), v.fresh ? "init" : mode);
  }
  while (ref) { const next = ref.nextElementSibling; ref.remove(); ref = next; }
  updateLabel(pg);
  syncStars(pg);
  measure(pg);
  if (live) flip(pg, old); else for (const b of blocksOf(pg)) b.fy = b.fy0 = 0;
  for (const b of blocksOf(pg)) VIEWS.get(b.id).fresh = false;
  invalidate();
}
function renderAll(mode) {
  for (const pg of [...pages.values()]) renderPage(pg, mode);
  renderPlaces();
  syncBack();
}
