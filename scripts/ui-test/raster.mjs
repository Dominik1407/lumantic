// The rasters: the pages read in quarters and years, the status keeps the Kosmos' own raster. The fixture runs
// from January 2019 to October 2026, so the last quarter and the last year are still running.
import { kit } from "./lib.mjs";

export default async (t) => {
  const { q, until, check, open, clickText, msgs, mock, booted, done } = kit(t);
  const when = () => q(`return document.querySelector('.page[data-id="heute"] .when').textContent`);
  const hl = () => q(`return document.querySelector('.page[data-id="heute"] .hl').getAttribute("aria-label")`);
  const chosen = () => q(`return [...document.querySelectorAll('.page[data-id="heute"] .gb')].filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent).join()`);
  const base = () => q(`return window.__kosmos.T.base`);

  check("the room opens", await booted(15000));
  await t.wait(4500);
  const h0 = await hl();
  check("it reads in months, beside the time word a choice of three", (await q(`return window.__kosmos.G`)) === "monat" && (await chosen()) === "Monat" && (await when()) === "Oktober 2026"
    && (await q(`return [...document.querySelectorAll('.page[data-id="heute"] .gb')].map((b) => b.textContent).join()`)) === "Tag,Woche,Monat,Quartal,Jahr", [await when(), await chosen()]);
  await t.shot("r1-monat");

  // ── quarters
  await q(`document.activeElement?.blur(); return 1`);
  await t.key("g");
  check("G reads the pages in quarters", await until(`return window.__kosmos.G === "quartal"`, 3000) && (await chosen()) === "Quartal");
  await t.wait(800);
  check("the time word names the running quarter", (await when()) === "Q4 2026 bis Oktober", await when());
  check("the status keeps the Kosmos' raster", (await hl()) === h0, [h0, await hl()]);
  check("topic pages name the quarter, also today", await q(`return [...document.querySelectorAll(".dl-when")].every((x) => x.textContent === "· Q4 2026 bis Oktober")`));
  const run = await q(`const d = window.__kosmos, r = d.shownOf(d.K.nnm, d.T.base), s = d.K.nnm.series; return { cur: r.cur === s[93], prev: r.prev === s[81], noun: r.prevNoun, tgt: r.tgt }`);
  check("a running quarter of a flow counts against the same months a year before, and against its target so far", run.cur && run.prev && run.noun === "Vorjahr, gleiche Monate" && run.tgt === 30, run);
  await t.key("ArrowLeft");
  await t.wait(800);
  check("← goes one quarter back", (await base()) === 92 && (await when()) === "Q3 2026", [await base(), await when()]);
  const q3 = await q(`const d = window.__kosmos, s = d.K.nnm.series, f = d.shownOf(d.K.nnm, 92), l = d.shownOf(d.K.lcr, 92), n = d.shownOf(d.K.nim, 92), a = d.K.nim.series;
    return { flow: Math.abs(f.cur - (s[90] + s[91] + s[92])) < 1e-6, before: Math.abs(f.prev - (s[87] + s[88] + s[89])) < 1e-6, noun: f.prevNoun, target: f.tgt === 90,
      stock: l.cur === d.K.lcr.series[92], avg: Math.abs(n.cur - (a[90] + a[91] + a[92]) / 3) < 1e-9 }`);
  check("a quarter sums a flow, keeps a balance's last month and averages an average", q3.flow && q3.before && q3.noun === "Vorquartal" && q3.target && q3.stock && q3.avg, q3);
  // A ratio adds numerator and denominator up by their own kind, then divides; the factor comes from the data.
  const ratio = await q(`const d = window.__kosmos, k = d.K.lcr, p = d.PERIODS.quartal.find((x) => x.to === 92), [a, b] = Object.values(k.parts);
    const flow = { ...k, kind: "ratio", partsKind: "flow" }, want = ((a[90] + a[91] + a[92]) / (b[90] + b[91] + b[92])) * 100;
    return { scale: k.scale, flow: Math.abs(d.valueAt(flow, p) - want) < 1e-9, stock: Math.abs(d.valueAt({ ...k, kind: "ratio" }, p) - (a[92] / b[92]) * 100) < 1e-9 }`);
  check("a ratio divides its summed or closing parts, in the scale of its data", ratio.scale === 100 && ratio.flow && ratio.stock, ratio);
  check("the sentences speak of the quarter before", await q(`return /Vorquartal/.test(document.getElementById("pages").textContent)`));
  // A chart labels its axis in quarters.
  await q(`const s = document.querySelector('.page[data-id="heute"] .spk'); s && s.click(); return 1`);
  await t.wait(1200);
  const axis = await q(`return [...document.querySelectorAll('.page[data-id="heute"] .chart .pl')].map((x) => x.textContent).filter((x) => /^Q[1-4] 20\\d\\d$/.test(x))`);
  check("a chart labels its axis in quarters", axis.length >= 2 && axis.includes("Q3 2026"), axis);
  const goal = await q(`return [...document.querySelectorAll('.page[data-id="heute"] .chart .pm')].map((x) => x.textContent).join(" | ")`);
  check("and its target line is the quarter's", goal.includes("Quartalsziel 90 Mio. CHF"), goal);
  await t.shot("r2-quartal");

  // ── years
  await q(`document.activeElement?.blur(); return 1`);
  await t.key("g");
  check("G again reads in years", await until(`return window.__kosmos.G === "jahr"`, 3000));
  await t.wait(800);
  check("the room stands on the running year", (await base()) === 93 && (await when()) === "2026 bis Oktober", [await base(), await when()]);
  await t.key("ArrowLeft", { shift: true });
  await t.wait(800);
  check("Shift ← goes a year back, to its last month", (await base()) === 83 && (await when()) === "2025", [await base(), await when()]);
  await t.wait(600);
  const ws = (await mock({})).kosmen[0].workspace;
  check("the raster is kept in the workspace", ws?.kosmos?.grain === "jahr", ws?.kosmos?.grain);
  await t.shot("r3-jahr");
  await t.clickSel('.page[data-id="heute"] .gb[data-grain="monat"]');
  check("a click on «Monat» goes back to months", await until(`return window.__kosmos.G === "monat"`, 3000));
  await t.wait(800);
  check("on the last month of that year", (await base()) === 83 && (await when()) === "Dezember 2025", [await base(), await when()]);
  await t.clickSel("#back");
  check("back to today", await until(`return window.__kosmos.T.base === 93`, 4000));
  await t.wait(1200);

  // ── weeks and days, from the daily tables (1 September to Monday, 9 November 2026)
  await t.clickSel('.page[data-id="heute"] .gb[data-grain="woche"]');
  check("«Woche» reads the pages in ISO weeks", await until(`return window.__kosmos.G === "woche"`, 3000));
  await t.wait(900);
  check("the running week ends on the last day there is", (await when()) === "KW 46 2026 bis Montag", await when());
  check("the status stays with the month", (await hl()) === h0, [h0, await hl()]);
  const wk = await q(`const d = window.__kosmos, r = d.shownOf(d.K.nnm, d.T.base), s = d.K.nnm.daily, days = d.DATA.days;
    return { cur: r.cur === s[days.indexOf("2026-11-09")], prev: Math.abs(r.prev - s[days.indexOf("2026-11-02")]) < 1e-9, noun: r.prevNoun, tgt: Math.abs(r.tgt - 30 / 21) < 1e-9, g: r.g }`);
  check("a running week of a flow counts against the same days of the week before, and its target so far", wk.cur && wk.prev && wk.noun === "Vorwoche, gleiche Tage" && wk.tgt && wk.g === "woche", wk);
  check("a figure without daily values stays in months and says so", await q(`const d = window.__kosmos; return d.shownOf(d.K.nsfr, d.T.base).g === "monat"`)
    && await q(`return [...document.querySelectorAll(".blk .stw")].some((x) => /nur monatlich erhoben/i.test(x.textContent))`));
  await q(`document.activeElement?.blur(); return 1`);
  await t.key("ArrowLeft");
  await t.wait(800);
  check("← goes one week back", (await when()) === "KW 45 2026" && (await q(`return window.__kosmos.AT`)) === (await q(`return window.__kosmos.PERIODS.woche.length`)) - 2, await when());
  const lcrW = await q(`const d = window.__kosmos; return d.shownOf(d.K.lcr, d.T.base).cur === d.K.lcr.daily[d.DATA.days.indexOf("2026-11-06")]`);
  check("a balance's week is its last day", lcrW);
  await q(`if (!document.querySelector('.page[data-id="heute"] .chart')) document.querySelector('.page[data-id="heute"] .spk')?.click(); return 1`);
  await t.wait(1200);
  const wAxis = await q(`return [...document.querySelectorAll('.page[data-id="heute"] .chart .pl')].map((x) => x.textContent).filter((x) => /^KW \\d+ 2026$/.test(x))`);
  check("a chart labels its axis in weeks", wAxis.length >= 2, wAxis);
  await t.shot("r4-woche");
  await t.clickSel('.page[data-id="heute"] .gb[data-grain="tag"]');
  check("«Tag» reads single days", await until(`return window.__kosmos.G === "tag"`, 3000));
  await t.wait(900);
  check("the room stands on the last day of the week it came from", (await when()) === "6. November 2026", await when());
  await t.key("ArrowLeft");
  await t.wait(700);
  const day = await q(`const d = window.__kosmos, r = d.shownOf(d.K.nnm, d.T.base); return { when: r.p.long, noun: r.prevNoun, cur: r.cur === d.K.nnm.daily[d.DATA.days.indexOf("2026-11-05")] }`);
  check("← goes one day back, compared with the day before", day.when === "5. November 2026" && day.noun === "Vortag" && day.cur, day);
  await t.shot("r5-tag");
  await t.clickSel('.page[data-id="heute"] .gb[data-grain="monat"]');
  check("and back to months", await until(`return window.__kosmos.G === "monat"`, 3000));
  await t.clickSel("#back");
  await until(`return window.__kosmos.T.base === 93`, 4000);
  await t.wait(1200);

  // ── the Kosmos' standard raster, in the settings
  await t.key(",");
  await t.wait(350);
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(900);
  check("Daten has the standard raster", await q(`return [...document.querySelectorAll("#settings .s-group h3")].some((x) => x.textContent === "Raster")`));
  await clickText("#settings [role=radio]", "Quartal");
  await t.wait(500);
  check("choosing it saves it", (await msgs()).includes("Gespeichert") && (await mock({})).kosmen[0].grain === "quartal", await msgs());
  await q(`window.__marker = 1; return 1`);
  await t.key("Escape");
  check("closing reads the Kosmos again", await until(`return window.__marker !== 1 && !!window.__kosmos && window.__kosmos.DATA.grain === "quartal"`, 9000));
  await t.wait(2500);
  const st = await q(`const d = window.__kosmos; return { status: d.stateOf(d.K.nnm, d.T.base).g, read: d.G }`);
  check("now the status is judged in quarters, while the person keeps reading in months", st.status === "quartal" && st.read === "monat", st);
  check("the sheet is closed", !(await open()));
  return done();
};
