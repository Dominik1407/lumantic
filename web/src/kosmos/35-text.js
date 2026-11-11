// ═════ Kosmos · what Lumina writes (carried over from Seite) ═════
// A sentence is a list of segments. Figures are their own segments, so they can roll in place while the words around them stand still:
//   ["t", text] · ["n", key, figure, prefix?] · ["v", key, figure] the value itself · ["s"] the word-sized chart ·
//   ["w", key, word] a word that may change · ["f", key, evidence, [segments]] a statement that shows its evidence on click.
const ORDINAL = ["", "erste", "zweite", "dritte", "vierte", "fünfte", "sechste", "siebte", "achte", "neunte", "zehnte", "elfte", "zwölfte"];
const LEVEL_RANK = { calm: 0, notable: 1, watch: 2, alert: 3 };
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Grammar of the part names in the demo data: f, n, or p for plural. Real data would carry this in the catalog.
const PART_GRAMMAR = { "HQLA": "p", "Nettomittelabflüsse": "p", "Sparkonten": "p", "Kontokorrente": "p", "Festgeld": "n", "Privatkunden": "p", "Vermögensverwaltung": "f", "Firmenkunden": "p", "KMU": "p", "Grossfirmen": "p", "Immobilien": "p" };
const TX = (s) => ["t", s], NUM = (key, s) => ["n", key, s], WORD = (key, s) => ["w", key, s], FACT = (key, evd, kids) => ["f", key, evd, kids];

// A distance in the figure's own unit: «7 Prozentpunkte», «92 Mio.», «1.2 Mrd.».
function distance(k, d) {
  const a = Math.abs(d);
  if (k.unit === "%") { const s = a.toFixed(k.dec); return s + (Number(s) === 1 ? " Prozentpunkt" : " Prozentpunkte"); }
  return amount(k, a);
}

// The part that moved most against the figure, named only when it clearly stands out (same rule as the engine).
function driverOf(k, m) {
  const r = shownOf(k, m);
  if (!k.parts || r.i < 1 || (r.level !== "alert" && r.level !== "watch")) return null;
  const names = Object.keys(k.parts), pair = (name) => partPair(k, r, name);
  if (names.some((nm) => !pair(nm))) return null;
  if (k.partsMode === "ratio") {
    const [num, den] = names, [n1, n0] = pair(num), [d1, d0] = pair(den), dn = n1 / n0 - 1, dd = d1 / d0 - 1;
    const top = [{ name: num, s: -dn * k.dir, d: dn }, { name: den, s: dd * k.dir, d: dd }].sort((a, b) => b.s - a.s)[0];
    return top.s > 0 ? { name: top.name, text: (top.d > 0 ? "+" : "−") + pct(top.d), evd: "drivers" } : null;
  }
  const ch = names.map((name) => { const [a, b] = pair(name), d = a - b; return { name, d, s: -d * (k.dir || 1) }; }).sort((a, b) => b.s - a.s);
  if (!ch.length || ch[0].s <= 0 || (ch[1] && ch[0].s < 1.5 * Math.max(0, ch[1].s))) return null;
  return { name: ch[0].name, text: (ch[0].d > 0 ? "+" : "−") + amount(k, ch[0].d), evd: "parts" };
}

function sentencesFor(k, m) {
  const r = shownOf(k, m), cur = r.cur, flow = k.kind === "flow", out = [], [prevDat, prevTo] = prevOf(r);
  if (r.gap) return [{ id: "gap", segs: [TX(`Für ${r.p.long} liegen keine Daten vor.`)] }];
  const V = ["v", "v", F(k, cur)], SP = ["s"];
  const tgtWord = targetWords(k, r.g).phrase, evTgt = flow ? "cum" : "trend";
  const side = (ref) => (cur < ref ? "unter" : "über");
  const hasTgt = r.tgt !== null && k.dir !== 0, hasLim = k.reg !== null && k.reg !== undefined && k.dir !== 0;
  const tgtFact = () => FACT("tgt", evTgt, [NUM("gap", distance(k, cur - r.tgt)), TX(` ${side(r.tgt)} ${tgtWord} von `), NUM("tgt", F(k, r.tgt))]);
  const limFact = () => FACT("lim", "trend", [NUM("room", distance(k, cur - k.reg)), TX(` ${side(k.reg)} ${limitWords(k).phrase}`)]);
  const tail = r.answer.replace(/^[^,]*, /, ""), extreme = /^(höchster|tiefster) Wert seit (.+)$/.exec(tail);
  const move = r.label === "Auffällige Bewegung" || r.label === "Gute Nachricht" || r.label === "Ungewöhnlich";
  let s1;
  if (r.breach) s1 = [V, SP, TX(" liegt "), FACT("lim", "trend", [NUM("room", distance(k, cur - k.reg)), TX(` ${k.dir > 0 ? "unter" : "über"} ${limitWords(k).phrase} von `), NUM("reg", F(k, k.reg))]), TX(". Das hat Vorrang.")];
  else if (r.special === "recover") s1 = [V, SP, TX(" liegt wieder "), FACT("tgt", evTgt, [TX(`${side(r.tgt)} ${tgtWord} von `), NUM("tgt", F(k, r.tgt))]), TX(", aber noch ohne Sicherheitsabstand.")];
  else if (move) s1 = extreme ? [V, SP, TX(" ist der "), FACT("ext", "trend", [TX(`${extreme[1].slice(0, -1)} Wert seit ${extreme[2]}`)]), TX(".")] : [V, SP, TX(" liegt "), FACT("ext", "trend", [TX(tail)]), TX(".")];
  else if (hasTgt) {
    const onTarget = parseFloat(distance(k, cur - r.tgt)) === 0;
    s1 = onTarget ? [V, SP, TX(` liegt genau auf ${tgtWord} von `), NUM("tgt", F(k, r.tgt)), TX(".")]
      : [V, SP, TX(r.special === "trend" ? " liegt noch " : " liegt "), tgtFact(), ...(hasLim ? [TX(" und "), limFact()] : []), TX(".")];
  } else if (r.prev === null) s1 = [V, SP, TX(" ist der erste Wert der Reihe.")];
  else if (k.unit === "%") {
    const d = cur - r.prev, s = Math.abs(d).toFixed(k.dec);
    s1 = Number(s) === 0 ? [V, SP, TX(` hat sich ${prevTo} nicht bewegt.`)] : [V, SP, TX(" liegt "), NUM("dm", s + (Number(s) === 1 ? " Prozentpunkt" : " Prozentpunkte")), TX(` ${d > 0 ? "über" : "unter"} ${prevDat}.`)];
  } else {
    const d = cur - r.prev, rel = d / Math.abs(r.prev);
    s1 = Math.abs(rel) < 0.0005 ? [V, SP, TX(` hat sich ${prevTo} kaum bewegt.`)] : [V, SP, TX(" liegt "), NUM("dm", pct(rel)), TX(` ${d > 0 ? "über" : "unter"} ${prevDat}.`)];
  }
  out.push({ id: "pos", segs: s1 });
  if (move && hasTgt && !r.breach && parseFloat(distance(k, cur - r.tgt)) !== 0) out.push({ id: "tgt2", segs: [TX("Das sind "), tgtFact(), TX(".")] });
  const d = driverOf(k, m);
  if (d) {
    const g = k.funnel ? "s" : PART_GRAMMAR[d.name];
    const lead = g === "p" ? "Bewegt haben sich vor allem die " : g === "f" ? "Bewegt hat sich vor allem die " : g === "n" ? "Bewegt hat sich vor allem das " : g === "s" ? "Bewegt hat sich vor allem die Stufe " : "Am stärksten bewegt hat sich: ";
    out.push({ id: "drv", segs: [TX(lead), FACT("drv", d.evd, [WORD("part", d.name)]), TX(" "), ["n", "drvd", d.text, "("], TX(` ${prevTo}).`)] });
  }
  if ((r.level === "alert" || r.level === "watch") && r.run >= 3) out.push({ id: "run", segs: [TX("Es ist der "), FACT("run", "run", [WORD("ord", ORDINAL[r.run] || r.run + "."), TX(k.dir > 0 ? " Rückgang in Folge" : " Anstieg in Folge")]), TX(".")] });
  return out;
}
const sigOf = (segs) => segs.map((s) => (s[0] === "t" ? "t" + s[1] : s[0] === "f" ? "f" + s[1] + s[2] + "(" + sigOf(s[3]) + ")" : s[0] + (s[1] || ""))).join("|");

// One mono line under a large figure: the distance to target and limit.
function gapLine(k, r) {
  if (r.gap) return `Keine Daten für ${THIS[r.g]}`;
  const out = [], dist = (d) => amount(k, d);
  if (r.tgt !== null && k.dir !== 0) out.push(`${dist(r.cur - r.tgt)} ${r.cur < r.tgt ? "unter" : "über"} ${targetWords(k, r.g).mark} ${F(k, r.tgt)}`);
  if (k.reg !== null && k.reg !== undefined && k.dir !== 0) out.push(`${dist(r.cur - k.reg)} ${r.cur < k.reg ? "unter" : "über"} ${limitWords(k).mark} ${F(k, k.reg)}`);
  if (!out.length && r.delta) out.push(r.delta);
  return out.join(" · ") || "Erster Wert der Reihe";
}

// Evidence: which views a figure has, and Lumina's reason for each.
function viewsFor(k) {
  const v = [{ kind: "trend", name: "Verlauf" }];
  if (k.partsMode === "ratio") v.push({ kind: "drivers", name: "Zähler und Nenner" });
  else if (k.parts) v.push({ kind: "parts", name: "Zusammensetzung" });
  if (k.kind === "flow" && k.target !== null) v.push({ kind: "cum", name: "Kumuliert" });
  if (k.parts && k.partsMode !== "ratio" && !k.funnel) v.push({ kind: "bridge", name: "Brücke" });
  if (COMPARE && COMPARE.includes(k.id)) v.push({ kind: "compare", name: "Vergleich" });
  if (k.daily && DAILY.n) v.push({ kind: "daily", name: "Tagesverlauf" });
  return v;
}
function whyFor(k, kind, m) {
  if (kind === "run") { const r = shownOf(k, m); return r.run >= 2 ? `Der markierte Abschnitt zeigt die ${r.run} ${PLURAL[r.g]}, in denen ${k.name} jeweils ${k.dir > 0 ? "tiefer" : "höher"} lag als ${AT_THE[r.g]} davor.` : `${k.name} hat sich zuletzt nicht mehrfach in dieselbe Richtung bewegt.`; }
  if (kind === "daily") return `Die Tageswerte bis ${DAILY.lastLong}. Der Monatswert ist der Stand am Monatsende, der Tagesverlauf zeigt den Weg dorthin.`;
  if (kind === "parts" && k.funnel) return "Was in der Pipeline steht, nach Stufe. Zeigt Volumen, keine Abschlusswahrscheinlichkeit.";
  const id = kind === "compare" ? "compare:lcr-dep" : kind + ":" + k.id, c = candidatesFor(k.group, m).find((x) => x.id === id);
  return c ? c.why.replace(/^Grund: /, "Am stärksten bewegt: ") : "";
}

// «Frag einfach»: keywords for figures, views and moments. No language model, only matching.
// Curated words for the demo figures; every figure also answers to its own names and the names of its parts.
const ASK_CURATED = { lcr: ["lcr", "liquiditat", "liquidity", "hqla", "mittelabfluss"], nsfr: ["nsfr", "refinanzierung", "funding"], cet1: ["cet1", "cet 1", "kernkapital", "eigenmittel", "kapitalquote"],
  lev: ["leverage", "verschuldung"], eve: ["eve", "δeve", "zinsrisiko", "barwert", "zinsschock"], nim: ["zinsmarge", "marge", "nim", "zinserfolg"], bal: ["bilanzsumme", "bilanz", "aktiven"],
  dep: ["einlagen", "kundeneinlagen", "sparkont", "festgeld", "kontokorrent"], mort: ["hypotheken", "hypothek"], nnm: ["neugeld", "netto-neugeld", "nettoneugeld", "zufluss", "vermogensverwaltung", "kundengelder"], pipe: ["pipeline", "offerte", "zusage", "anfrage"] };
const ASK_FIGURES = Object.fromEntries(KPIS.map((k) => [k.id, [...new Set([...(ASK_CURATED[k.id] || []), ...[k.name, k.short, k.long, k.id, ...Object.keys(k.parts || {})].map((s) => fold(String(s || "")).trim()).filter((s) => s.length >= 3)])]]));
const ASK_VIEWS = { parts: ["zusammensetzung", "teile", "anteil", "woraus", "segment", "aufteilung"], bridge: ["brucke", "veranderung", "uberleitung"], cum: ["kumul", "jahresziel", "aufgelaufen"], drivers: ["zahler", "nenner", "treiber"], compare: ["vergleich", " vs ", " gegen "], trend: ["verlauf", "entwicklung", "trend", "historie"] };
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
function understand(text, m) {
  const f = " " + fold(text).replace(/\s+/g, " ") + " ";
  const hits = [];
  for (const k of KPIS) {
    let at = -1;
    for (const w of ASK_FIGURES[k.id] || []) { const i = f.search(new RegExp("[^a-z0-9]" + w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at >= 0) hits.push({ k, at });
  }
  hits.sort((a, b) => a.at - b.at);
  let ks = hits.map((x) => x.k);
  if (K.pipe && ks.includes(K.pipe) && f.includes("pipeline")) ks = ks.filter((k) => k.id !== "mort");
  let view = null;
  for (const [kind, words] of Object.entries(ASK_VIEWS)) if (!view && words.some((w) => f.includes(w))) view = kind;
  let when = null, mt;
  if ((mt = /[^a-z](januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mar|apr|jun|jul|aug|sept|sep|okt|nov|dez)\.? (20\d\d)/.exec(f))) when = ym(Number(mt[2]), MONTH_KEYS.indexOf(mt[1].slice(0, 3)) + 1);
  else if ((mt = /q([1-4]) ?(20\d\d)/.exec(f))) when = ym(Number(mt[2]), Number(mt[1]) * 3);
  else if ((mt = /[^0-9](20[12]\d)[^0-9]/.exec(f))) when = ym(Number(mt[1]), 12);
  else if (/vor einem jahr|letztes jahr|im vorjahr/.test(f)) when = m - 12;
  else if (/ heute | aktuell | jetzt /.test(f)) when = TODAY;
  if (when !== null) when = clamp(when, 0, TODAY);
  const words = f.trim().split(" ").length;
  const question = /\?\s*$/.test(text) || /^ (zeig|wie|was|wo|wann|warum|wieso|weshalb|welche|vergleich)/.test(f) || (ks.length > 0 && words <= 4);
  return { ks, view, when, question };
}
