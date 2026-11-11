// Navigation regression test: the dial must stay visible after every way of switching
// between Heute, Zeitreise and dashboards. Run against a running server:
//   node scripts/ui-test/cdp.mjs --url "http://127.0.0.1:8080/#/zeitreise/2024-06" --script scripts/ui-test/navigation.mjs --out scripts/ui-test/shots --h 800
export default async (t) => {
  const st = async (label, expectView, expectDial) => {
    const r = await t.eval(`(() => { const s = document.querySelector(".stage svg"), h = document.querySelector(".hub"); const view = document.querySelector(".today") ? "heute" : document.querySelector(".dash") ? "dash" : document.querySelector(".ov") ? "zeit" : "?"; const o = s ? Number(getComputedStyle(s).opacity) : -1, ho = h ? Number(getComputedStyle(h).opacity) : -1, tr = s ? getComputedStyle(s).transform : ""; return { hash: location.hash, view, o, ho, tr }; })()`);
    const dialOk = r.view !== "zeit" || (r.o === 1 && r.ho === 1 && (r.tr === "none" || r.tr === "matrix(1, 0, 0, 1, 0, 0)"));
    const ok = r.view === expectView && dialOk;
    t.log((ok ? "ok   " : "FAIL ") + label.padEnd(34), r.hash.padEnd(24), "view=" + r.view, r.view === "zeit" ? `rad sichtbar=${dialOk}` : "");
    if (!ok) t.errors.push("check failed: " + label + " " + JSON.stringify(r));
  };
  await t.wait(2500); await st("1 Start Zeitreise", "zeit");
  await t.clickSel(".st"); await t.wait(1500); await st("2 Stern -> Dashboard", "dash");
  await t.key("Escape"); await t.wait(1600); await st("3 Esc -> Zeitreise", "zeit"); await t.shot("3-nach-esc");
  await t.key("h"); await t.wait(600); await st("4 H", "heute");
  await t.key("z"); await t.wait(1500); await st("5 Z -> Zeitreise", "zeit");
  await t.key("z"); await t.wait(300); await st("6 Z -> Heute (nach 0.3 s)", "heute");
  await t.key("z"); await t.wait(250); await t.key("z"); await t.wait(250); await t.key("z"); await t.wait(1500); await st("7 Z x3 schnell -> Zeitreise", "zeit"); await t.shot("7-schnell");
  // Open a dashboard from the dial and press Z in the middle of the zoom.
  await t.clickSel(".d-cluster"); await t.wait(200); await t.key("z"); await t.wait(1500); await st("8 Z mitten im Zoom -> Heute", "heute");
  await t.key("z"); await t.wait(1500); await st("9 Z -> Zeitreise, Rad da", "zeit");
  await t.clickSel(".st"); await t.wait(1400); await st("10 Dashboard", "dash");
  await t.clickSel(".modes button[data-mode='zeit']"); await t.wait(1500); await st("11 Schalter Zeitreise", "zeit");
  await t.clickSel(".modes button[data-mode='heute']"); await t.wait(500); await st("12 Schalter Heute", "heute");
  await t.clickSel(".dcard"); await t.wait(900); await st("13 Karte -> Dashboard", "dash");
  await t.key("z"); await t.wait(1400); await t.key("z"); await t.wait(1400); await st("14 Z, Z im Dashboard", "dash");
  await t.eval("history.back()"); await t.wait(900); await st("15 Browser zurueck", "heute");
  await t.key("z"); await t.wait(1500); await st("16 Z -> Zeitreise", "zeit"); await t.shot("16-ende");
};
