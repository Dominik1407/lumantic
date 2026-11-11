#!/usr/bin/env node
// Drives headless Edge in REAL time over the DevTools protocol: real mouse, wheel and
// key input, screenshots in the middle of animations, console errors collected.
//
//   node cdp.mjs --artifact page.html --script scenario.mjs --out shots [--port 9401]
//   node cdp.mjs --url http://127.0.0.1:8080/ --script scenario.mjs --out shots
//
// Options: --w 1440 --h 900 | --phone (390 x 844) | --scheme dark|light | --data-theme dark|light
//          --reduced (prefers-reduced-motion) | --port N (one port per parallel run)
//
// A scenario is an ES module: export default async (t) => { await t.wait(500); await t.shot("start"); }
// t.wait(ms) · t.eval(js) · t.shot(name) · t.click(x, y) · t.clickSel(css) · t.dblclickSel(css)
// t.hoverSel(css) · t.drag(x0, y0, x1, y1, {steps, ms}) · t.wheel(x, y, deltaY, {ctrl, shift})
// t.key("Escape") · t.type("text") · t.rect(css) · t.log(...) · t.errors (array) · t.fps()
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) opt[a.slice(2)] = true;
  else { opt[a.slice(2)] = next; i++; }
}
const port = Number(opt.port || 9401), out = resolve(opt.out || "shots");
const W = opt.phone ? 390 : Number(opt.w || 1440), H = opt.phone ? 844 : Number(opt.h || 900);
mkdirSync(out, { recursive: true });

const SKELETON = (body, theme) => `<!doctype html><html${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;

let url = opt.url;
if (opt.artifact) {
  const page = join(out, "page.html");
  writeFileSync(page, SKELETON(readFileSync(resolve(opt.artifact), "utf8"), opt["data-theme"]));
  url = pathToFileURL(page).href + (opt.hash ? "#" + opt.hash : "");
}
if (!url || !opt.script) { console.error("need --artifact or --url, and --script"); process.exit(2); }

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const profile = resolve(opt.profile || join(out, "..", `edge-cdp-${port}`));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--disable-gpu",
  `--window-size=${Math.max(W, 500)},${H}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let ws, nextId = 1;
const pending = new Map(), waiters = [];

async function connect() {
  for (let n = 0; n < 60; n++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((x) => x.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Edge did not start on port " + port);
}
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
function once(method, ms = 15000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("timeout waiting for " + method)), ms);
    waiters.push({ method, res: (p) => { clearTimeout(timer); res(p); } });
  });
}
const fmt = (o) => (o.value !== undefined ? String(o.value) : o.description || o.type);

const KEYS = { Escape: 27, Enter: 13, Backspace: 8, Tab: 9, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, " ": 32, "/": 191, "?": 191 };
const t = {
  errors,
  wait: sleep,
  log: (...a) => console.log("  ·", ...a),
  async eval(expression) {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) { const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text; errors.push("eval: " + msg); throw new Error(msg); }
    return r.result.value;
  },
  async shot(name) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  shot", name);
  },
  // Scrolls the element into view first when it is outside the viewport.
  rect: (css) => t.eval(`(() => { const e = document.querySelector(${JSON.stringify(css)}); if (!e) return null; let b = e.getBoundingClientRect(); if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth || b.top + b.height / 2 > innerHeight || b.top + b.height / 2 < 0) { e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); b = e.getBoundingClientRect(); } return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height }; })()`),
  mouse: (type, x, y, o = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: o.button || (type === "mouseMoved" && !o.down ? "none" : "left"), buttons: o.down || type === "mousePressed" ? 1 : 0, clickCount: o.clicks || (type === "mouseMoved" ? 0 : 1), modifiers: o.modifiers || 0, deltaX: o.deltaX || 0, deltaY: o.deltaY || 0 }),
  async click(x, y, clicks = 1) {
    await t.mouse("mouseMoved", x, y);
    for (let c = 1; c <= clicks; c++) { await t.mouse("mousePressed", x, y, { clicks: c }); await t.mouse("mouseReleased", x, y, { clicks: c }); }
  },
  async clickSel(css, clicks = 1) {
    const r = await t.rect(css);
    if (!r) { errors.push("missing element: " + css); console.log("  MISSING", css); return false; }
    await t.click(r.x, r.y, clicks);
    return true;
  },
  dblclickSel: (css) => t.clickSel(css, 2),
  async hoverSel(css) { const r = await t.rect(css); if (r) await t.mouse("mouseMoved", r.x, r.y); return !!r; },
  async drag(x0, y0, x1, y1, o = {}) {
    const steps = o.steps || 16, ms = o.ms || 400;
    await t.mouse("mouseMoved", x0, y0);
    await t.mouse("mousePressed", x0, y0);
    for (let i = 1; i <= steps; i++) { await t.mouse("mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { down: true }); await sleep(ms / steps); }
    if (!o.hold) await t.mouse("mouseReleased", x1, y1);
  },
  wheel: (x, y, deltaY, o = {}) => t.mouse("mouseWheel", x, y, { deltaY, deltaX: o.deltaX || 0, modifiers: (o.ctrl ? 2 : 0) | (o.shift ? 8 : 0) }),
  async key(key, o = {}) {
    const code = KEYS[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const text = key.length === 1 ? key : key === "Enter" ? "\r" : undefined;
    const base = { key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: (o.ctrl ? 2 : 0) | (o.shift ? 8 : 0) | (o.alt ? 1 : 0) };
    await send("Input.dispatchKeyEvent", { type: text && !o.ctrl ? "keyDown" : "rawKeyDown", text: o.ctrl ? undefined : text, ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  },
  type: (text) => send("Input.insertText", { text }),
  fps: () => t.eval(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(n); }; requestAnimationFrame(f); })`),
};

let code = 0;
try {
  ws = new WebSocket(await connect());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("websocket failed")); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.rej(new Error(p.method + ": " + m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map(fmt).join(" ");
      if (m.params.type === "error") errors.push("console.error: " + text);
      else if (text.startsWith("T>")) console.log("  " + text);
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].method === m.method) waiters.splice(i, 1)[0].res(m.params);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: Number(opt.dpr || 1), mobile: !!opt.phone });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opt.scheme || "light" }, { name: "prefers-reduced-motion", value: opt.reduced ? "reduce" : "no-preference" }] });
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  const scenario = (await import(pathToFileURL(resolve(opt.script)).href)).default;
  await scenario(t);
} catch (e) {
  console.log("FAILED:", e.message);
  code = 1;
}
console.log(errors.length ? `ERRORS (${errors.length}):\n  ` + [...new Set(errors)].join("\n  ") : "no page errors");
try { await Promise.race([send("Browser.close"), sleep(1500)]); } catch { /* closing */ }
edge.kill();
process.exit(code);
