// Several Kosmen, in real time against the mock server started with --kosmen: the main menu, into a Kosmos and back,
// the settings in both places, a new Kosmos from its form to its first key figure, removing it, and a company logo
// with «powered by lumantic». With --phone it only checks that the menu and the way in work on a small screen.
import { kit } from "./lib.mjs";

export default async (t) => {
  const { q, until, check, open, clickText, setField, msgs, mock, booted, done } = kit(t);
  const menu = (ms) => until(`return !!window.__menu && document.querySelectorAll(".km-k .km-sky:not(.is-empty)").length >= 3`, ms);
  const names = () => q(`return [...document.querySelectorAll(".km-k:not(.km-new) .km-name")].map((x) => x.textContent)`);
  const phone = await q(`return innerWidth < 700`);

  check("the main menu opens", await menu());
  await t.wait(1600);
  check("three Kosmen and the way to one more", (await names()).join() === "ALCO,Firmenkunden,Privatkunden" && await q(`return !!document.querySelector(".km-new")`), await names());
  const hl = await q(`return document.querySelector(".km-hl").textContent`);
  check("the headline counts them and says who needs you", /^Drei Kosmen\. (Einer braucht|\S+ brauchen) dich\.$/.test(hl), hl);
  check("each says what Lumina says inside", (await q(`return [...document.querySelectorAll(".km-k:not(.km-new) .km-say")].map((x) => x.textContent)`)).every((s) => /ruhig|brauch|verletzt/.test(s)));
  check("one star per key figure", (await q(`return document.querySelector('.km-k[data-id="firmenkunden"]').querySelectorAll(".km-star").length`)) === 4);

  if (phone) {
    await t.shot("kp1-menu");
    const r = await t.rect('.km-k[data-id="firmenkunden"]');
    check("phone: Kosmen as a list", r && r.w > 300, r);
    await t.clickSel('.km-k[data-id="privatkunden"]');
    check("phone: into a Kosmos", await until(`return location.search === "?k=privatkunden" && !!window.__kosmos`));
    await t.wait(2600);
    await t.shot("kp2-kosmos");
    return done();
  }

  const places = await q(`return [...document.querySelectorAll("#places button")].map((b) => b.textContent)`);
  check("places list the Kosmen and end with the settings", places.join() === "ALCO,Firmenkunden,Privatkunden,Einstellungen", places);
  await t.shot("k01-hauptmenue");

  // ── the settings of the main menu: «Kosmen» instead of «Daten»
  await t.key(",");
  await t.wait(350);
  const tabs = await q(`return [...document.querySelectorAll(".s-tabs [role=tab]")].map((b) => b.textContent)`);
  check("menu settings have «Kosmen»", (await open()) && tabs.includes("Kosmen") && !tabs.includes("Daten"), tabs);
  await clickText(".s-tabs [role=tab]", "Kosmen");
  await t.wait(250);
  check("the list of Kosmen", (await q(`return document.querySelectorAll("#settings .is-kosmen .s-krow").length`)) === 3);
  await t.shot("k02-kosmen-einstellungen");
  await clickText('.s-dcard', "Nacht") || await clickText(".s-tabs [role=tab]", "Darstellung");
  await t.wait(200);
  await t.clickSel('.s-dcard[data-id="nacht"]');
  await t.wait(500);
  check("the menu takes the design", (await q(`return document.documentElement.dataset.design`)) === "nacht");
  await t.key("Escape");
  await t.wait(700);
  await t.shot("k03-hauptmenue-nacht");
  await t.key(",");
  await t.wait(250);
  await t.clickSel('.s-dcard[data-id="nebel"]');
  await t.key("Escape");
  await t.wait(700);

  // ── into a Kosmos by key, and back
  await t.key("2");
  check("key 2 flies into the second Kosmos", await until(`return location.search === "?k=firmenkunden" && !!window.__kosmos`));
  await t.wait(3200);
  check("the design came along", (await q(`return document.documentElement.dataset.design`)) === "nebel");
  check("the corner names the Kosmos", (await q(`return document.querySelector("#brand .kname")?.textContent`)) === "Firmenkunden");
  check("its pages are its own figures", (await q(`return window.__kosmos.KPIS.length`)) === 4);
  await t.shot("k04-firmenkunden");
  await t.key(",");
  await t.wait(350);
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(900);
  check("its settings are about its source", (await q(`const l = [...document.querySelectorAll("#settings .s-field > label")].find((x) => x.textContent === "Ordner" || x.textContent === "Datei"); return document.getElementById(l.htmlFor).value`)) === "goldlayer/firmenkunden");
  check("a further Kosmos can be removed, and leads to the others", await q(`const g = [...document.querySelectorAll("#settings .s-group")].find((x) => x.querySelector("h3")?.textContent === "Kosmos"); return !!g && ["Alle Kosmen", "Weiteren Kosmos anlegen", "Entfernen"].every((w) => [...g.querySelectorAll(".s-btn")].some((b) => b.textContent === w))`));
  await q(`document.getElementById("set-body").scrollTop = 99999; return 1`);
  await t.shot("k05-daten-eines-kosmos");
  await t.key("Escape");
  await t.wait(400);
  await t.key("k");
  check("K leads back to the main menu", await menu());

  // ── a new Kosmos: the form, a broken path, the way to its first key figure
  await t.wait(900);
  await t.clickSel(".km-new");
  await t.wait(400);
  check("the form for a new Kosmos", (await open()) && await q(`return !!document.querySelector("#settings .s-kedit.is-new")`));
  await clickText(".s-btn", "Kosmos anlegen");
  await t.wait(200);
  check("a Kosmos needs a name", (await msgs()).includes("braucht einen Namen"), await msgs());
  // A warehouse asks for its own fields; its secret waits in the form until the Kosmos exists.
  await clickText("#settings [role=radio]", "Databricks");
  await t.wait(300);
  const labels = await q(`return [...document.querySelectorAll("#settings .s-kedit.is-new .s-field > label")].map((x) => x.textContent)`);
  check("Databricks asks for workspace, warehouse and service principal", ["Adresse des Workspace", "SQL-Warehouse", "Katalog", "Schema", "Client-ID", "Secret"].every((l) => labels.includes(l)) && !labels.includes("Datei"), labels);
  await setField("Name des Kosmos", "Risiko");
  await setField("Adresse des Workspace", "https://adb-1.2.azuredatabricks.net");
  await setField("SQL-Warehouse", "1a2b3c4d");
  await setField("Client-ID", "sp-lumantic");
  await clickText(".s-btn", "Verbindung prüfen");
  await t.wait(500);
  check("a missing secret is named", (await msgs()).includes("Secret des Service Principal"), await msgs());
  await setField("Secret", "dose-geheim-1234");
  await clickText(".s-btn", "Verbindung prüfen");
  await t.wait(500);
  check("with the secret the test finds tables", (await q(`return document.querySelectorAll("#settings .s-tables li").length`)) >= 5, await msgs());
  await q(`document.getElementById("set-body").scrollTop = 99999; return 1`);
  await t.shot("k05-databricks");
  await clickText("#settings [role=radio]", "Snowflake");
  await t.wait(300);
  const sfLabels = await q(`return [...document.querySelectorAll("#settings .s-kedit.is-new .s-field > label")].map((x) => x.textContent)`);
  check("Snowflake asks for account, warehouse and a key file", ["Konto", "Benutzer", "Warehouse", "Datenbank", "Rolle (optional)", "Schlüsseldatei"].every((l) => sfLabels.includes(l)), sfLabels);
  await clickText("#settings [role=radio]", "DuckDB-Datei");
  await t.wait(300);
  await setField("Name des Kosmos", "Vertrieb");
  await setField("Datei", "gibtsnicht.duckdb");
  await clickText(".s-btn", "Kosmos anlegen");
  await t.wait(500);
  check("a source that fails is not added", (await msgs()).includes("gibt es nicht") && (await mock({})).kosmen.length === 3, await msgs());
  await setField("Datei", "goldlayer/vertrieb.duckdb");
  await clickText(".s-btn", "Verbindung prüfen");
  await t.wait(500);
  check("the test lists its tables", (await q(`return document.querySelectorAll("#settings .s-tables li").length`)) >= 5);
  await q(`document.getElementById("set-body").scrollTop = 99999; return 1`);
  await t.shot("k06-neuer-kosmos");
  await clickText(".s-btn", "Kosmos anlegen");
  check("the new Kosmos opens", await until(`return location.search === "?k=vertrieb" && !document.getElementById("empty").hidden`));
  check("it says what is missing", (await q(`return document.getElementById("empty").textContent`)).includes("Noch keine Kennzahlen."));
  await t.wait(500);
  await t.shot("k07-ohne-kennzahlen");
  await t.clickSel("#empty .btn");
  await t.wait(1200);
  check("the way forward is the form for a key figure", await q(`return [...document.querySelectorAll("#settings .s-kedit.is-new h4")].some((x) => x.textContent === "Neue Kennzahl")`));
  await setField("Tabelle", "gold_alco.liquiditaet_monat");
  await setField("Wertspalte", "lcr_wert");
  await setField("Name", "LCR");
  await q(`const i = document.querySelector("#settings .s-newtopic input"); i.value = "Liquidität"; i.dispatchEvent(new Event("input")); return true`);
  await clickText(".s-btn", "Hinzufügen");
  await t.wait(800);
  check("the figure is saved", (await msgs()).includes("dazugekommen"), await msgs());
  await q(`window.__marker = 1; return true`);
  await t.key("Escape");
  check("with its first figure the room opens", await until(`return window.__marker !== 1 && !!window.__kosmos`));
  await t.wait(3600);
  check("the room has the new topic", (await q(`return [...document.querySelectorAll("#places button")].map((b) => b.textContent)`)).includes("Liquidität"));
  await t.shot("k08-vertrieb");

  // ── removing it asks twice and ends in the main menu
  await t.key(",");
  await t.wait(300);
  await clickText(".s-tabs [role=tab]", "Daten");
  await t.wait(900);
  const remove = `const g = [...document.querySelectorAll("#settings .s-group")].find((x) => x.querySelector("h3")?.textContent === "Kosmos"); const b = g && [...g.querySelectorAll(".s-btn.danger")][0]; if (!b) return ""; b.click(); return b.textContent`;
  await q(remove);
  await t.wait(200);
  check("removing asks once more", (await mock({})).kosmen.length === 4 && (await msgs()).includes("Nochmals klicken"), await msgs());
  await q(remove);
  check("then the Kosmos is gone", await menu() && (await names()).join() === "ALCO,Firmenkunden,Privatkunden", await names());
  check("the first Kosmos cannot be removed", (await q(`return fetch("/api/kosmen/main", { method: "DELETE" }).then((r) => r.status)`)) === 409);

  // ── a company logo takes the logo's place, and Lumantic signs
  check("without a company logo there is no «powered by»", await q(`return document.getElementById("powered").hidden && !!document.querySelector("#brand .logo")`));
  await mock({ brand: { name: "Musterbank", logo: "musterbank.svg" } });
  await q(`location.reload(); return true`);
  await t.wait(600);
  check("the company logo stands in the corner", await menu() && await q(`const i = document.querySelector("#brand .logo-corp"); return !!i && i.getAttribute("src") === "/brand/musterbank.svg" && !document.querySelector("#brand .logo")`));
  check("Lumantic signs with «powered by»", await q(`const p = document.getElementById("powered"); return !p.hidden && p.textContent.includes("powered by") && !!p.querySelector(".logo")`));
  await t.wait(1500);
  await t.shot("k09-firmenlogo");
  await mock({ brand: { name: "", logo: "" } });
  return done();
};
