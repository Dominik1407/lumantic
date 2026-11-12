// ═════ Kosmos · rolling figures and sentences (carried over from Seite) ═════
// ───────────── Rolling figures ─────────────
// The digits of a figure are separate cells, counted from the right, so a digit rolls on its own and the unit never moves.
const NUM_RE = /^([−+-]?[\d’.]+)(.*)$/;
const rollMode = (mode) => (mode === "scrub" ? "scrub" : mode === "step" || mode === "edit" ? "step" : "none");
function makeRoll(str, cls) {
  const el = h("span", { class: "roll" + (cls ? " " + cls : ""), role: "img" });
  el._cells = [];
  el._unit = h("span", { class: "ru" });
  el.append(el._unit);
  rollSet(el, str, "none");
  return el;
}
function rollSet(el, str, mode) {
  if (el._str === str) return;
  const mt = NUM_RE.exec(str), digits = mt ? [...mt[1]] : [], unit = mt ? mt[2] : str;
  const val = mt ? Number(mt[1].replace("−", "-").replace("+", "").replace(/’/g, "")) : NaN;
  const dir = Number.isFinite(val) && Number.isFinite(el._val) && val < el._val ? -1 : 1, live = mode !== "none" && !reduced;
  el._str = str; el._val = val;
  el.setAttribute("aria-label", str);
  if (el._unit.textContent !== unit) el._unit.textContent = unit;
  const old = el._cells, cells = [], n = digits.length;
  for (let p = 0; p < Math.max(n, old.length); p++) {
    const ch = p < n ? digits[n - 1 - p] : null, o = old[p];
    if (ch === null) { o.el.remove(); continue; }
    if (!o) {
      const cur = h("span", { class: "rcc", text: ch }), cell = { el: h("span", { class: "rc", "aria-hidden": "true" }, cur), cur, ch };
      el.insertBefore(cell.el, p > 0 ? cells[p - 1].el : el._unit);
      cells[p] = cell;
      if (live && old.length) slideIn(cur, dir, mode, p);
      continue;
    }
    if (o.ch !== ch) {
      o.el.querySelectorAll(".rg").forEach((g) => g.remove());
      if (live && mode === "step") {
        const g = h("span", { class: "rg", text: o.ch });
        o.el.append(g);
        g.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${-dir * 70}%)`, opacity: 0 }], { duration: 300, delay: Math.min(p, 6) * 26, easing: "ease-in", fill: "forwards" }).onfinish = () => g.remove();
      }
      o.cur.textContent = ch;
      o.ch = ch;
      if (live) slideIn(o.cur, dir, mode, p);
    }
    cells[p] = o;
  }
  el._cells = cells;
}
function slideIn(cur, dir, mode, p) {
  const quick = mode === "scrub";
  cur.getAnimations().forEach((a) => a.cancel());
  cur.animate([{ transform: `translateY(${dir * (quick ? 34 : 70)}%)`, opacity: quick ? 0.35 : 0 }, { transform: "none", opacity: 1 }],
    { duration: quick ? 150 : 460, delay: quick ? 0 : Math.min(p, 6) * 26, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
}
// A word or short text that changes: swap it, with a short fade so the eye catches it.
function swapText(el, text, mode) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (mode !== "init" && mode !== "none" && !reduced) el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: mode === "scrub" ? 140 : 280, easing: "ease-out" });
}
// The old state of an element fades out on top while the new one is already in place.
function ghostOf(el) {
  const host = el.offsetParent;
  if (!host) return;
  host.querySelectorAll(":scope > .ghost-fade").forEach((g) => g.remove());
  const g = el.cloneNode(true);
  g.removeAttribute("id");
  g.classList.add("ghost-fade");
  g.setAttribute("aria-hidden", "true");
  g.style.cssText = `left:${el.offsetLeft}px;top:${el.offsetTop}px;width:${el.offsetWidth}px`;
  host.append(g);
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" }).onfinish = () => g.remove();
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 340, delay: 60, easing: "ease-out", fill: "backwards" });
}

// ───────────── Sentences ─────────────
const factEl = (evd, kids, cls) => h("span", { class: "fact" + (cls ? " " + cls : ""), role: "button", tabindex: "0", "data-ev": evd, "aria-expanded": "false" }, ...kids);
const sparkButton = (sp) => h("span", { class: "spk", role: "button", tabindex: "0", "data-ev": "trend", "aria-label": tr("Verlauf zeigen", "Show the trend"), "aria-expanded": "false" }, sp);
function buildSegs(segs, slots, k, m) {
  const f = document.createDocumentFragment();
  for (const s of segs) {
    if (s[0] === "t") f.append(s[1]);
    else if (s[0] === "n" || s[0] === "v") {
      const r = makeRoll(s[2], "num");
      slots.set(s[1], r);
      f.append(s[0] === "v" ? factEl("trend", [r], "val") : s[3] ? h("span", { class: "nw" }, s[3], r) : r);
    } else if (s[0] === "s") {
      const sp = sparkEl(k);
      sparkSet(sp, m);
      slots.set("~spark", sp);
      f.append(sparkButton(sp));
    } else if (s[0] === "w") {
      const w = h("span", { class: "wd", text: s[2] });
      slots.set(s[1], w);
      f.append(w);
    } else if (s[0] === "f") f.append(factEl(s[2], [buildSegs(s[3], slots, k, m)]));
  }
  return f;
}
function updateSlots(segs, slots, mode, m) {
  for (const s of segs) {
    if (s[0] === "n" || s[0] === "v") rollSet(slots.get(s[1]), s[2], rollMode(mode));
    else if (s[0] === "s") sparkSet(slots.get("~spark"), m);
    else if (s[0] === "w") swapText(slots.get(s[1]), s[2], mode);
    else if (s[0] === "f") updateSlots(s[3], slots, mode, m);
  }
}
// Writes the sentences into a paragraph. A sentence whose wording is unchanged only rolls its figures;
// one whose wording changed is rewritten, with the old paragraph fading out over it.
function drawPara(v, sentences, mode) {
  if (!v.para) { v.para = h("p", { class: "para" }); v.main.replaceChildren(v.para); }
  const p = v.para, sigs = sentences.map((s) => sigOf(s.segs));
  const reworded = v.sents.size > 0 && (v.sents.size !== sentences.length || sentences.some((s, i) => !v.sents.get(s.id) || v.sents.get(s.id).sig !== sigs[i]));
  if (reworded && mode === "step" && !reduced) ghostOf(p);
  const keep = new Set(sentences.map((s) => s.id));
  for (const [sid, o] of v.sents) if (!keep.has(sid)) { o.el.remove(); v.sents.delete(sid); }
  let prev = null;
  sentences.forEach((s, i) => {
    let o = v.sents.get(s.id);
    if (!o) { o = { el: h("span", { class: "sn" }), sig: null, slots: null }; v.sents.set(s.id, o); }
    const want = prev ? prev.nextSibling : p.firstChild;
    if (want !== o.el) p.insertBefore(o.el, want);
    if (o.sig !== sigs[i]) {
      const fresh = o.sig === null;
      o.slots = new Map();
      o.el.replaceChildren(buildSegs(s.segs, o.slots, v.k, v.m));
      o.sig = sigs[i];
      if (!reduced && (mode === "scrub" || (mode === "step" && fresh))) o.el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: mode === "scrub" ? 150 : 320, easing: "ease-out" });
    } else updateSlots(s.segs, o.slots, mode, v.m);
    prev = o.el;
  });
}
