#!/usr/bin/env node
// Runs the scenarios against a fresh mock server each: the app with one Kosmos (app.mjs) on a desktop, a phone and
// with reduced motion, then the main menu with three Kosmen (kosmen.mjs) on a desktop and a phone, and the room on a
// short window, where pages must keep clear of each other (layout.mjs), and the rasters (raster.mjs).
// Build first: cd web; npm run build. Screenshots land in scripts/ui-test/shots/.
//
//   node scripts/ui-test/run.mjs [desktop|phone|reduced|kosmen|kosmen-phone|short|raster …]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const RUNS = {
  desktop: { script: "app.mjs" },
  phone: { script: "app.mjs", browser: ["--phone"] },
  reduced: { script: "app.mjs", browser: ["--reduced"] },
  kosmen: { script: "kosmen.mjs", server: ["--kosmen"] },
  "kosmen-phone": { script: "kosmen.mjs", server: ["--kosmen"], browser: ["--phone"] },
  short: { script: "layout.mjs", browser: ["--w", "1026", "--h", "520"] },
  raster: { script: "raster.mjs" },
};
const pick = process.argv.slice(2).filter((a) => a in RUNS);
let failed = 0, port = 9451;

const run = (cmd, args, opts = {}) => spawn(cmd, args, { cwd: here, stdio: "inherit", ...opts });
for (const name of pick.length ? pick : Object.keys(RUNS)) {
  const r = RUNS[name];
  console.log(`\n── ${name}`);
  const mock = run(process.execPath, ["mock-api.mjs", "--port", "8098", ...(r.server || [])], { stdio: ["ignore", "ignore", "inherit"] });
  await new Promise((done) => setTimeout(done, 600));
  const code = await new Promise((done) => run(process.execPath, ["cdp.mjs", "--url", "http://127.0.0.1:8098/", "--script", r.script, "--out", `shots/${name}`, "--port", String(port++), "--h", "900", ...(r.browser || [])]).on("exit", done));
  mock.kill();
  if (code !== 0) failed++;
}
console.log(failed ? `\n${failed} run(s) failed` : "\nall runs passed");
process.exit(failed ? 1 : 0);
