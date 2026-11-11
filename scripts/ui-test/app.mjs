// The app in real time against the mock server (mock-api.mjs): boot, the five designs, the settings by mouse and keys,
// font and accent, data test and save, a new key figure, Lumina with a token, the answer block, the empty state.
// On a phone (--phone) and with reduced motion (--reduced) it runs a shorter path. Several Kosmen: kosmen.mjs.
// Run them all with run.mjs.
import { kit } from "./lib.mjs";

export default async (t) => {
  const { q, until, check, open, clickText, setField, msgs, mock, booted, done } = kit(t);
  const phone = await q(`return innerWidth < 700`), still = await q(`return matchMedia("(prefers-reduced-motion: reduce)").matches`);

  check("boot", await booted());
  await t.wait(still ? 600 : 4200);
  const places = await q(`return [...document.querySelectorAll("#places button")].map((b) => b.textContent)`);
  check("places end with the settings", places.at(-1) === "Einstellungen" && places.includes("Heute"), places);
  check("pages built from the figures", (await q(`return document.querySelectorAll(".page").length`)) >= 2);
  check("design from the server defaults", (await q(`return document.documentElement.dataset.design`)) === "nebel");

  if (phone) {
    await t.shot("p1-heute");
    await t.clickSel("[data-settings]");
    await t.wait(500);
    check("phone: gear opens the settings", await open());
    const r = await t.rect("#settings");
    check("phone: sheet comes from below, edge to edge", r && r.left === 0 && Math.round(r.w) === 390 && r.top > 80, r);
    await t.shot("p2-einstellungen");
    await clickText(".s-tabs [role=tab]", "Daten");
    await t.wait(700);
    await t.shot("p3-daten");
    await t.key("Escape");
    await t.wait(300);
    check("phone: Esc closes", !(await open()));
    return done();
  }
  if (still) {
    check("reduced motion: the room is still", await q(`return document.documentElement.classList.contains("still")`));
    await t.key(",");
    await t.wait(200);
    check("reduced motion: sheet without animation", (await q(`return getComputedStyle(document.getElementById("settings")).animationName`)) === "none");
    await t.shot("r1-einstellungen");
    await t.key("Escape");
    await t.shot("r2-heute");
    return done();
  }

  await t.shot("01-heute-nebel");
  // ── open and close, by mouse and by keys
  await t.clickSel("[data-settings]");
  await t.wait(450);
  check("gear opens", await open());
  check("gear says it is open", (await q(`return document.querySelector("[data-settings]").getAttribute("aria-expanded")`)) === "true");
  await t.clickSel(".s-x");
  await t.wait(200);
  check("× closes", !(await open()));
  await t.key(",");
  await t.wait(300);
  check(", opens", await open());
  await t.key("Escape");
  await t.wait(200);
  check("Esc closes", !(await open()));

  // ── the five designs
  for (const id of ["nacht", "kreide", "stein", "daemmerung", "nebel"]) {
    await t.key(",");
    await t.wait(250);
    await t.clickSel(`.s-dcard[data-id="${id}"]`);
    await t.wait(150);
    const d = await q(`return { design: document.documentElement.dataset.design, bg: getComputedStyle(document.body).backgroundColor, grid: window.__kosmos.THEME.grid.join(",") }`);
    check(`design ${id}`, d.design === id, d);
    await t.key("Escape");
    await t.wait(700);
    await t.shot(`02-heute-${id}`);
  }
  // ── overview, a topic page, the lens over a block
  await t.key("0");
  await t.wait(2600);
  await t.shot("03-ueberblick");
  await t.key("1");
  await t.wait(2800);
  await t.shot("04-liquiditaet");
  const lens = await q(`const l = window.__kosmos.lens; return { x: l.x, y: l.y }`);
  await t.drag(lens.x, lens.y, 760, 360, { steps: 24, ms: 700 });
  await t.wait(700);
  check("lens picked up", !(await q(`return window.__kosmos.lens.parked`)));
  await t.shot("05-linse");
  await t.key("Escape");
  await t.wait(500);
  await t.key("h");
  await t.wait(2400);

  // ── Darstellung: font, accent, motion, «für alle»
  await t.key(",");
  await t.wait(300);
  await clickText(".s-choice [role=radio]", "Geist");
  check("font Geist", (await q(`return document.documentElement.dataset.font`)) === "geist");
  await clickText(".s-choice [role=radio]", "Petrol");
  check("accent Petrol", (await q(`return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()`)) === "#0f6670");
  await t.wait(300);
  await t.shot("06-schrift-akzent");
  await clickText(".s-choice [role=radio]", "Ruhig");
  check("motion Ruhig", await q(`return document.documentElement.classList.contains("still")`));
  await clickText(".s-choice [role=radio]", "Voll");
  await clickText(".s-choice [role=radio]", "Wie im Design");
  await clickText(".s-choice [role=radio]", "Indigo");
  await clickText(".s-btn", "Für alle speichern");
  await t.wait(400);
  const saved = await mock({});
  check("für alle saved into the config", saved.config.ui.design === "nebel" && saved.saves >= 1, saved.config.ui);
  // ── Start: the lens looks one quarter back
  await clickText(".s-tabs [role=tab]", "Start");
  await t.wait(200);
  await clickText(".s-choice [role=radio]", "1 Quartal");
  check("lens one quarter back", await q(`const k = window.__kosmos; return k.lens.m === k.T.base - 3`));

  // ── Daten: test, a broken path, save
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(900);
  await t.shot("07-daten");
  await clickText(".s-btn", "Verbindung prüfen");
  await t.wait(500);
  check("test lists the tables", (await q(`return document.querySelectorAll("#settings .s-tables li").length`)) >= 5, await msgs());
  await setField("Datei", "gibtsnicht.duckdb");
  await clickText(".s-btn", "Speichern");
  await t.wait(500);
  check("broken path: error under the field", (await q(`const e = [...document.querySelectorAll("#settings .s-err")].find((x) => !x.hidden); return e ? e.textContent : ""`)).includes("gibt es nicht"), await msgs());
  await setField("Datei", "goldlayer/gold.duckdb");
  await clickText(".s-btn", "Speichern");
  await t.wait(500);
  check("source saved", (await msgs()).includes("Gespeichert"), await msgs());

  // ── Kennzahlen: add one, change a target
  await t.wait(400);
  await clickText(".s-btn", "Kennzahl hinzufügen");
  await t.wait(200);
  await setField("Tabelle", "gold_alco.kunden_monat");
  await setField("Wertspalte", "kredite_mio");
  await setField("Name", "Kreditvolumen");
  await setField("Thema", "+neu");
  await q(`const i = document.querySelector("#settings .s-newtopic input"); i.value = "Kunden"; i.dispatchEvent(new Event("input")); return true`);
  await t.shot("08-neue-kennzahl");
  await clickText(".s-btn", "Hinzufügen");
  await t.wait(700);
  check("new figure in the list", (await q(`return [...document.querySelectorAll("#settings .s-kn")].map((x) => x.textContent)`)).includes("Kreditvolumen"), await msgs());
  await clickText("#settings .s-khead", "LCR");
  await t.wait(200);
  await setField("Ziel in %", "130");
  await clickText(".s-kedit .s-btn", "Speichern");
  await t.wait(700);
  const lcr = await q(`return fetch("/api/kpis").then((r) => r.json()).then((d) => d.kpis.find((k) => k.id === "lcr").target)`);
  check("LCR target changed", lcr === 130, lcr);
  await t.shot("09-kennzahlen");

  // ── Lumina: token, test
  await clickText(".s-tabs [role=tab]", "Lumina");
  await t.wait(300);
  await t.shot("10-lumina-ohne-token");
  await t.clickSel("#settings .s-secret input");
  await t.type("sk-ant-test-4f2a");
  await clickText("#settings .s-secret .s-btn", "Speichern");
  await t.wait(600);
  check("token stored, hint shown", (await q(`return document.querySelector("#settings .s-secret").textContent`)).includes("endet auf 4f2a"));
  check("Lumina ready", (await q(`return document.querySelector("#settings .s-status").textContent`)).includes("beantwortet Fragen"));
  check("token never in the page", !(await q(`return document.documentElement.innerHTML.includes("sk-ant-test")`)));
  await clickText(".s-btn", "Verbindung testen");
  await t.wait(400);
  check("AI test", (await msgs()).includes("Verbunden mit Claude Opus 5.5"), await msgs());
  await t.shot("11-lumina");
  // ── Über, with the reset step
  await clickText(".s-tabs [role=tab]", "Über");
  await t.wait(200);
  await clickText(".s-btn", "Eigene Seiten zurücksetzen");
  check("reset asks first", await clickText(".s-btn", "Abbrechen"));
  await t.shot("12-ueber");

  // ── closing after data changes rebuilds the room
  await q(`window.__marker = 1; return true`);
  await t.key("Escape");
  await t.wait(1200);
  check("room rebuilt after data changes", await booted() && !(await q(`return window.__marker === 1`)));
  await t.wait(4200);

  // ── Lumina answers in the room
  await t.clickSel('.page[data-id="heute"] .ins');
  await t.type("Warum sinkt die LCR?");
  await t.key("Enter");
  await t.wait(1600);
  const answer = await q(`const a = document.querySelector('.page[data-id="heute"] .answer'); return a ? a.textContent : ""`);
  check("answer block on the page", answer.includes("LCR liegt"), answer);
  const st = await mock({});
  check("the question went to the server with the facts", st.asked.length === 1 && st.asked[0].figures >= 5, st.asked);
  await t.wait(800);
  await t.shot("13-antwort");
  const ws = await q(`return fetch("/api/workspace").then((r) => r.json())`);
  check("workspace saved as v2", ws.v === 2 && ws.kosmos && Array.isArray(ws.kosmos.pages) && ws.ui.lens === "1Q", { v: ws.v, ui: ws.ui });

  // ── new figures: when Lumantic reads again by itself, the token for a loading job, and the line that offers them
  if (await open()) { await t.key("Escape"); await t.wait(400); }
  // The question to Lumina left the focus in the page; a comma there would be typed, not open the sheet.
  await q(`document.activeElement?.blur(); return 1`);
  await t.key(",");
  await t.wait(300);
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(900);
  const plan = await q(`const g = [...document.querySelectorAll("#settings .s-group")].find((x) => x.querySelector("h3")?.textContent === "Aktualisierung"); return g ? g.textContent : ""`);
  check("the Daten part says when the Kosmos is read again", plan.includes("Wenn sich die Dateien ändern") && plan.includes("Anstoss durch einen Ladeprozess"), plan.slice(0, 160));
  await clickText("#settings [role=radio]", "Zu festen Zeiten");
  await t.wait(500);
  check("fixed times start at six", (await mock({})).kosmen?.[0]?.plan?.daily?.join() === "06:00", await msgs());
  await setField("Uhrzeiten", "6:00, 12:30");
  await q(`const l = [...document.querySelectorAll("#settings .s-field > label")].find((x) => x.textContent === "Uhrzeiten"); document.getElementById(l.htmlFor).dispatchEvent(new Event("change")); return 1`);
  await t.wait(500);
  check("two times are kept", (await q(`const l = [...document.querySelectorAll("#settings .s-field > label")].find((x) => x.textContent === "Uhrzeiten"); return l ? document.getElementById(l.htmlFor).value : ""`)) === "06:00, 12:30");
  await clickText("#settings .s-btn", "Token erzeugen");
  await t.wait(500);
  const shown = await q(`return [...document.querySelectorAll("#settings .s-code")].map((x) => x.textContent)`);
  check("a new token is shown once, with the call", shown.length === 2 && shown[0].startsWith("lmt_") && shown[1].includes("Authorization: Bearer lmt_") && shown[1].includes("/api/refresh"), shown);
  await q(`[...document.querySelectorAll("#settings .s-group")].find((x) => x.querySelector("h3")?.textContent === "Aktualisierung").scrollIntoView({ block: "start" }); return 1`);
  await t.wait(200);
  await t.shot("14-aktualisierung");
  await t.key("Escape");
  await t.wait(400);
  check("Esc closes the sheet with the token", !(await open()), await q(`return document.activeElement?.outerHTML.slice(0, 120)`));
  await t.key(",");
  await t.wait(300);
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(700);
  const reopened = await q(`return { codes: document.querySelectorAll("#settings .s-code").length, open: !document.getElementById("settings").hidden, tab: document.querySelector(".s-tabs [aria-selected=true]")?.textContent, text: [...document.querySelectorAll("#settings .s-group")].find((x) => x.querySelector("h3")?.textContent === "Aktualisierung")?.textContent.slice(-220) }`);
  check("after closing only its end is shown", reopened.codes === 0 && (reopened.text || "").includes("Token gesetzt, endet auf"), reopened);
  await t.key("Escape");
  await t.wait(400);
  await mock({ event: { by: "anstoss" } });
  check("new figures are offered, not forced", await until(`const f = document.getElementById("fresh"); return !f.hidden && f.textContent.includes("Neue Zahlen")`, 4000));
  await t.wait(700);
  await t.shot("14b-neue-zahlen");
  await mock({ event: { by: "zeitplan", changed: false } });
  await q(`window.__marker = 1; return 1`);
  await t.clickSel("#fresh .fresh-go");
  check("«Zeigen» loads them and comes back to the same place", await until(`return window.__marker !== 1 && !!window.__kosmos`, 9000));
  await t.wait(1500);

  // ── without data: one sentence and the way to the source
  await mock({ empty: true });
  await q(`location.reload(); return true`);
  await t.wait(1500);
  check("empty state", (await q(`return document.getElementById("empty").hidden ? "" : document.getElementById("empty").textContent`)).includes("Noch keine Daten verbunden."));
  await t.shot("14-leer");
  await t.clickSel("#empty .btn");
  await t.wait(400);
  check("empty state opens Daten", (await q(`return document.querySelector(".s-tabs [aria-selected=true]").textContent`)) === "Daten");
  await clickText(".s-btn", "Speichern");
  await t.wait(1500);
  check("saved source shows the room", await booted() && !!(await q(`return window.__kosmos`)));
  check("settings reopen at Daten after connecting", (await open()) && (await msgs()).includes("Verbunden"), await msgs());
  await t.wait(1200);
  await t.shot("15-verbunden");

  // ── the very first start: where the gold layer lives, five kinds, one tap into the right form
  await mock({ empty: true, fresh: true });
  await q(`location.reload(); return true`);
  await t.wait(1800);
  const kinds = await q(`return [...document.querySelectorAll("#empty .kind .kind-n")].map((x) => x.textContent)`);
  check("the first start asks where the gold layer lives", (await q(`return document.querySelector("#empty h1")?.textContent`)) === "Wo liegt dein Goldlayer?"
    && kinds.join() === "DuckDB-Datei,Ordner mit Parquet- oder CSV-Dateien,Snowflake,Databricks,Windmill", kinds);
  await t.shot("16-ersteinrichtung");
  await clickText("#empty .kind", "Snowflake");
  await t.wait(500);
  const sf = await q(`return [...document.querySelectorAll("#settings .s-field > label")].map((x) => x.textContent)`);
  check("a card opens the form for that kind", (await open()) && sf.includes("Konto") && sf.includes("Schlüsseldatei")
    && (await q(`return document.querySelector('#settings [role=radio][aria-checked=true] .s-cn')?.textContent`)) === "Snowflake", sf);
  await t.shot("17-snowflake");
  return done();
};
