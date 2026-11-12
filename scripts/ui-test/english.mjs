// English: the team's language is English (mock --en). The room, its sentences and numbers, the keys, the settings
// and the Sternkatalog speak English; the names come from the definitions' English words. Then the person switches
// to German in the settings, and the page opens again in German.
import { kit } from "./lib.mjs";

export default async (t) => {
  const { q, until, check, open, clickText, booted, done } = kit(t);
  const when = () => q(`return document.querySelector('.page[data-id="heute"] .when').textContent`);
  const hl = () => q(`return document.querySelector('.page[data-id="heute"] .hl').getAttribute("aria-label") || ""`);

  check("the room opens", await booted(15000));
  // The first start may load once more in the team's language.
  check("the page speaks English", await until(`return document.documentElement.lang === "en" && !!window.__kosmos`, 9000), await q(`return document.documentElement.lang`));
  await t.wait(4500);
  check("the headline is English", /calm\.$|needs? you\.$|breached\.$/.test(await hl()), await hl());
  check("the time word is English", (await when()) === "October 2026", await when());
  check("the rasters are named in English", (await q(`return [...document.querySelectorAll('.page[data-id="heute"] .gb')].map((b) => b.textContent).join()`)) === "Day,Week,Month,Quarter,Year");
  check("names come from the English words of the definitions", (await q(`const K = window.__kosmos.K; return [K.nim.name, K.dep.short, K.eve.regName].join("|")`)) === "Interest margin|Deposits|FINMA outlier test",
    await q(`const K = window.__kosmos.K; return [K.nim.name, K.dep.short, K.eve.regName].join("|")`));
  const text = await q(`return document.getElementById("stage").innerText`);
  check("money reads the international way", /CHF [\d,.]+(m|bn)\b/.test(text) && !/Mio\. CHF|Mrd\. CHF/.test(text), (text.match(/[^\n]*CHF[^\n]*/) || [""])[0]);
  check("no German word of the room is left on the page", !/\b(Heute|Überblick|Ziel|Grenze|braucht dich|ruhig)\b/.test(text), (text.match(/[^\n]*\b(Heute|Überblick|Ziel|Grenze|braucht dich|ruhig)\b[^\n]*/) || [""])[0]);
  await t.shot("e1-today");

  // ── the keys
  await q(`document.activeElement?.blur(); return 1`);
  await t.key("?");
  check("? opens the keys in English", await until(`return !document.getElementById("keys").hidden && document.querySelector("#keys h2")?.textContent === "Keys"`, 3000),
    await q(`return document.querySelector("#keys h2")?.textContent`));
  check("the rows read English", (await q(`return document.getElementById("keys").innerText`)).includes("Today"));
  await t.shot("e2-keys");
  await t.key("Escape");

  // ── the Sternkatalog
  await t.clickSel("#places [data-katalog]");
  check("the star catalogue opens", await until(`return !document.getElementById("katalog").hidden && document.querySelectorAll("#katalog .kt-list .kt-row").length >= 5`, 6000));
  const kt = await q(`return { eyebrow: document.querySelector("#katalog .kt-eyebrow")?.textContent || "", hl: document.querySelector("#katalog .kt-hl").textContent }`);
  check("it counts stars and topics in English", /^[A-Z][a-z]+ stars?, [a-z]+ topics?\.$/.test(kt.hl), kt);
  await clickText("#katalog .kt-row", "01");
  check("a star's facts read English", await until(`const t = document.querySelector("#katalog .kt-facts")?.textContent || ""; return t.includes("Unit") && t.includes("Direction")`, 3000));
  await t.shot("e3-catalogue");
  await t.key("Escape");
  await until(`return document.getElementById("katalog").hidden`, 3000);

  // ── the settings, and back to German
  await t.key(",");
  check("the settings open in English", await until(`return !document.getElementById("settings").hidden && [...document.querySelectorAll(".s-tabs [role=tab]")].map((b) => b.textContent).join() === "Look,Start,Data,Lumina,About"`, 3000),
    await q(`return [...document.querySelectorAll(".s-tabs [role=tab]")].map((b) => b.textContent).join()`));
  check("Look offers the language", await q(`return [...document.querySelectorAll("#settings .s-group h3, #settings .s-group legend, #settings .s-group > *:first-child")].some((x) => x.textContent.trim() === "Language")`));
  await t.shot("e4-settings");
  await clickText(".s-choice [role=radio]", "Deutsch");
  check("choosing German opens the page again in German", await until(`return document.documentElement.lang === "de-CH" && !!window.__kosmos`, 12000));
  await booted(15000);
  await t.wait(3000);
  check("the room speaks German again", (await when()) === "Oktober 2026", await when());
  check("and the settings reopen where they were", (await open()) && (await q(`return document.querySelector('.s-tabs [aria-selected="true"]')?.textContent`)) === "Darstellung",
    await q(`return document.querySelector('.s-tabs [aria-selected="true"]')?.textContent`));
  await t.shot("e5-deutsch");
  done();
};
