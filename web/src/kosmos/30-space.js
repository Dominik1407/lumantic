// ═════════════ Kosmos: pages of blocks in a room. A page is a constellation seen from close. ═════════════
const $ = (id) => document.getElementById(id);
const stage = $("stage"), gridC = $("grid"), g2 = gridC.getContext("2d"), threadC = $("threads"), g3 = threadC.getContext("2d");
const STILL = location.hash === "#still"; // skips the opening flight
const TODAY = N - 1;
let W = 1, H = 1, DPR = 1, off = { left: 0, top: 0 };
let PAGE_W = 560, GUT = 30; // width of a page's text column and of the margin where its stars stand, in world px
const cam = { x: 0, y: 0, z: 0.3 };
const T = { base: TODAY, memo: null, playing: false };
// Below Z_FAR a page is a constellation, above Z_NEAR it is text. CY: how far below its top a page's constellation is centred.
// Z_OPEN: where a page rests after the zoom carried it open.
const ZMIN = 0.09, ZMAX = 1.8, Z_FAR = 0.5, Z_NEAR = 0.72, Z_OPEN = 0.8, CY = 140;
const M = { p: 0, e: 0, kz: 2, far: 1 }; // the morph of this frame: 0 constellation, 1 page
const SHORT = Object.fromEntries(KPIS.map((k) => [k.id, k.short || k.name]));
const narrow = () => W < 700;

// ───────────── One frame loop: animations first, then one draw ─────────────
const anims = new Set();
let rafId = 0;
function invalidate() { if (!rafId) rafId = requestAnimationFrame(tick); }
function tick(now) {
  rafId = 0;
  for (const a of [...anims]) if (a(now) === false) anims.delete(a);
  draw();
  if (anims.size) invalidate();
}
function tween(ms, fn, ease = easeInOut, done) {
  if (reduced || ms <= 0) { fn(1); if (done) done(); invalidate(); return () => {}; }
  let t0 = 0;
  const a = (now) => {
    if (!t0) t0 = now;
    const k = clamp((now - t0) / ms, 0, 1);
    fn(ease(k));
    if (k >= 1) { if (done) done(); return false; }
  };
  anims.add(a);
  invalidate();
  return () => anims.delete(a);
}

// ───────────── Camera ─────────────
const toScreen = (wx, wy) => [(wx - cam.x) * cam.z + W / 2, (wy - cam.y) * cam.z + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];
let flyStop = null, zoomAnim = null, glideAnim = null, detentTimer = 0, lastZoom = null, panGoal = null;
function stopCamera() {
  if (flyStop) flyStop();
  for (const a of [zoomAnim, glideAnim]) if (a) anims.delete(a);
  flyStop = zoomAnim = glideAnim = null;
  clearTimeout(detentTimer);
}
const halfWay = (z) => z > Z_FAR + 1e-4 && z < Z_NEAR - 1e-4;
// Wheel zoom: eased, and the point under the cursor stays under the cursor.
function zoomAt(sx, sy, factor, carried) {
  if (flyStop) { flyStop(); flyStop = null; }
  if (glideAnim) { anims.delete(glideAnim); glideAnim = null; }
  let target = clamp((zoomAnim ? zoomAnim.zt : cam.z) * factor, ZMIN, ZMAX);
  const [wx, wy] = toWorld(sx, sy), dir = factor >= 1 ? 1 : -1;
  const hold = () => { cam.x = wx - (sx - W / 2) / cam.z; cam.y = wy - (sy - H / 2) / cam.z; };
  lastZoom = { sx, sy, dir };
  clearTimeout(detentTimer);
  if (reduced) { if (halfWay(target)) target = dir > 0 ? Z_OPEN : Z_FAR; cam.z = target; hold(); invalidate(); return; }
  if (!carried) detentTimer = setTimeout(detent, 130);
  if (zoomAnim) anims.delete(zoomAnim);
  const a = () => {
    cam.z += (a.zt - cam.z) * 0.24;
    if (Math.abs(a.zt - cam.z) < a.zt * 0.002) cam.z = a.zt;
    hold();
    if (cam.z === a.zt) { zoomAnim = null; return false; }
  };
  a.zt = target;
  zoomAnim = a;
  anims.add(a);
  invalidate();
}
// The detent: when the hand stops between constellation and page, the zoom carries on to the end it was heading for,
// out to the constellation or in to the open page. The view never rests half-way. Any new input takes over.
function detent() {
  if (!lastZoom || flyStop) return;
  const zt = zoomAnim ? zoomAnim.zt : cam.z;
  if (halfWay(zt)) zoomAt(lastZoom.sx, lastZoom.sy, (lastZoom.dir > 0 ? Z_OPEN : Z_FAR) / zt, true);
}
// After a pan the canvas glides on a little.
function glide(vx, vy) {
  if (reduced || Math.hypot(vx, vy) < 0.05) return;
  let last = 0;
  const a = (now) => {
    const dt = last ? Math.min(40, now - last) : 16;
    last = now;
    cam.x += vx * dt; cam.y += vy * dt;
    const f = Math.pow(0.994, dt);
    vx *= f; vy *= f;
    if (Math.hypot(vx, vy) * cam.z < 0.012) { glideAnim = null; return false; }
  };
  glideAnim = a;
  anims.add(a);
  invalidate();
}
// Smooth and efficient zoom-and-pan (van Wijk & Nuij 2003): out, across, in. p = [x, y, visible width].
function zoomPath(p0, p1) {
  const rho = Math.SQRT2, [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1, dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  let S, at;
  if (d2 < 1e-9) {
    S = Math.log(w1 / w0) / rho;
    at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  } else {
    const d1 = Math.sqrt(d2), b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1), b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / rho;
    at = (t) => {
      const s = t * S, c0 = Math.cosh(r0), u = (w0 / (2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
    };
  }
  at.ms = Math.abs(S) * 1000;
  return at;
}
function flyTo(target, ms, done) {
  stopCamera();
  if (reduced) { Object.assign(cam, target); invalidate(); if (done) done(); return; }
  const path = zoomPath([cam.x, cam.y, W / cam.z], [target.x, target.y, W / target.z]);
  flyStop = tween(ms || clamp(path.ms * 0.62, 480, 1600), (e) => { const p = path(e); cam.x = p[0]; cam.y = p[1]; cam.z = W / p[2]; }, easeInOut, () => { flyStop = null; Object.assign(cam, target); if (done) done(); });
}
// A short straight move without a change of zoom, for small corrections.
function panTo(x, y, ms = 420) {
  stopCamera();
  if (reduced) { cam.x = x; cam.y = y; invalidate(); return; }
  const x0 = cam.x, y0 = cam.y;
  flyStop = tween(ms, (e) => { cam.x = lerp(x0, x, e); cam.y = lerp(y0, y, e); }, easeInOut, () => { flyStop = null; });
}
// Steps of the keyboard: several presses in a row add up while the camera is still on its way.
function panBy(dx, dy) {
  const from = panGoal && panGoal.stop === flyStop && flyStop ? panGoal : { x: cam.x, y: cam.y }, x = from.x + dx, y = from.y + dy;
  panTo(x, y, 260);
  panGoal = { x, y, stop: flyStop };
}
// The free area of the screen: what the wordmark, the «Rückblick» pill, the places and the lens leave over.
// On a wide screen the open settings sheet takes the right edge as well (sheetR, set by the host).
let sheetR = 0;
const PAD = () => (narrow() ? { t: 92, r: 16, b: 78, l: 16 } : { t: 96, r: 40 + sheetR, b: 84, l: 40 });
