// What the scenarios share: checks that count, and a few hands for the settings sheet.
export function kit(t) {
  const fails = [];
  let n = 0;
  const q = (js) => t.eval(`(() => { ${js} })()`);
  const until = async (js, ms = 9000) => { for (let w = 0; w < ms; w += 250) { if (await q(js)) return true; await t.wait(250); } return false; };
  return {
    q,
    until,
    check: (name, ok, got) => { n++; if (ok) console.log("  ok  ", name); else { fails.push(name); console.log("  FAIL", name, got === undefined ? "" : JSON.stringify(got)); } },
    open: () => q(`return !document.getElementById("settings").hidden`),
    // clicks the first element matching sel whose text starts with text
    clickText: (sel, text) => q(`const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true`),
    // fills the settings field with this label
    setField: (label, value) => q(`const l = [...document.querySelectorAll("#settings .s-field > label")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!l) return false;
      const i = document.getElementById(l.htmlFor); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event(i.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true`),
    msgs: () => q(`return [...document.querySelectorAll("#settings .s-msg, #settings .s-err")].map((m) => m.textContent).filter(Boolean).join(" | ")`),
    mock: (body) => q(`return fetch("/__mock", { method: "POST", headers: { "Content-Type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.json())`),
    // a room or its empty state is there
    booted: (ms) => until(`return !!window.__kosmos || !document.getElementById("empty").hidden`, ms),
    // The scenarios provoke a 422 (broken path), a 503 (no data, no figures) and a 409 (removing the first Kosmos)
    // on purpose; the browser logs them.
    done() {
      console.log(`  ${n - fails.length} of ${n} checks passed`);
      const errors = t.errors.filter((e) => !/status of (422|503) .*\/api\/(settings|metrics|kosmen)(\?k=[\w-]+)?$/.test(e) && !/status of 409 .*\/api\/kosmen\/main$/.test(e));
      if (errors.length) console.log("  unexpected page errors:\n    " + errors.join("\n    "));
      if (fails.length || errors.length) throw new Error(fails.length ? `${fails.length} checks failed: ${fails.join("; ")}` : "page errors");
    },
  };
}
