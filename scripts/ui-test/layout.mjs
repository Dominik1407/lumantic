// The room on a short window: no page may lie on another. «Heute» can be long; the ring of topics has to keep clear
// of it, and of a topic page that grows when a block opens.
import { kit } from "./lib.mjs";

const OVERLAPS = `const d = window.__kosmos, w = d.PAGE_W + 2 * d.GUT, ps = [...d.pages.values()], out = [];
  for (const a of ps) for (const b of ps) if (a.id < b.id && Math.abs(a.x - b.x) < w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(a.id + " × " + b.id);
  return out;`;

export default async (t) => {
  const { q, check, booted, done } = kit(t);
  check("the room opens", await booted(15000));
  await t.wait(4500);
  check("no page lies on another", (await q(OVERLAPS)).length === 0, await q(OVERLAPS));
  // A topic page grows when its figures open as charts: the ring makes room, the page in view stays put.
  await q(`document.activeElement?.blur(); return 1`);
  await t.key("1");
  await t.wait(2600);
  const before = await q(`const d = window.__kosmos; return { off: d.cam.y - d.pages.get(d.activeId).y, y: d.pages.get(d.activeId).y }`);
  // The page grows by 900 px, as if several charts opened; a step down and back up makes the room draw again.
  await q(`const d = window.__kosmos, pg = d.pages.get(d.activeId), x = document.createElement("div"); x.style.height = "900px"; pg.el.append(x); pg.dirty = true; return 1`);
  await t.key("ArrowDown");
  await t.wait(600);
  await t.key("ArrowUp");
  await t.wait(900);
  check("still no page lies on another", (await q(OVERLAPS)).length === 0, await q(OVERLAPS));
  const after = await q(`const d = window.__kosmos; return { off: d.cam.y - d.pages.get(d.activeId).y, y: d.pages.get(d.activeId).y }`);
  check("the ring made room: the page above «Heute» moved up", after.y < before.y - 100, { before, after });
  check("the page in view keeps its place on the screen", Math.abs(after.off - before.off) < 1, { before, after });
  await t.shot("kurz");

  // A page longer than the screen scrolls under the wheel like text; beside it the wheel zooms again.
  await q(`window.__kosmos.flyPlace("heute"); return 1`);
  await t.wait(2600);
  const at = await q(`const d = window.__kosmos, pg = d.pages.get("heute"); return { x: Math.round(pg.ox + d.PAGE_W * d.cam.z / 2), y: Math.round(d.H / 2), z: d.cam.z, cy: d.cam.y }`);
  await t.wheel(at.x, at.y, 300);
  await t.wait(800);
  const down = await q(`const d = window.__kosmos; return { z: d.cam.z, cy: d.cam.y }`);
  check("the wheel over a long page scrolls it", Math.abs(down.z - at.z) < 1e-6 && down.cy > at.cy + 100, { at, down });
  await t.wheel(at.x, at.y, -3000);
  await t.wait(1000);
  const top = await q(`return Math.round(window.__kosmos.pages.get("heute").oy)`);
  check("and stops where the page begins", top >= 90 && top <= 100, top);
  await t.wait(400);
  await t.wheel(24, at.y, 300);
  await t.wait(900);
  const out = await q(`return window.__kosmos.cam.z`);
  check("beside the page the wheel zooms out", out < at.z - 0.05, { before: at.z, after: out });
  return done();
};
