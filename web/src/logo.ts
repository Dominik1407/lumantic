// The Lumantic logo, in one place. The mark «Baustein»: two blocks and one lit star, because pages are built from
// blocks and one of them is the thing that matters. The wordmark is set in Sora 600 and kept as outlines, so it looks
// the same in every design and with every company font. Nothing else in the app draws the logo: to change it, change
// MARK and WORD here.
//
// A company's own logo comes from the config (brand.logo, brand.logoDark; files in config/brand/) and takes the place
// of this one. Lumantic then signs in a corner with «powered by lumantic».
import type { Settings } from "./api";

// The mark on a 64 × 64 grid. Blocks take the text colour, the star the accent of the design.
const MARK = `<rect x="6" y="6" width="23" height="23" rx="6" fill="currentColor"/><rect x="6" y="35" width="23" height="23" rx="6" fill="currentColor"/><circle cx="46.5" cy="46.5" r="11.5" fill="var(--accent)"/>`;
// «lumantic» in Sora 600, 1000 units per em, baseline at y = 0, tracking −22. The i-dot is the last shape.
const WORD = `<path fill="currentColor" d="M86 0V-626H18V-730H225V0Z M547 17Q453 17 402 -45Q350 -107 350 -229V-544H489V-217Q489 -167 517 -138Q545 -108 593 -108Q641 -108 672 -139Q702 -170 702 -223V-544H841V0H731V-126Q727 -109 721 -94Q700 -39 658 -11Q616 17 553 17Z M979 0V-543H1089V-411Q1093 -430 1100 -448Q1121 -503 1162 -532Q1204 -560 1266 -560H1272Q1335 -560 1376 -532Q1418 -503 1439 -448Q1440 -443 1442 -438Q1444 -443 1446 -448Q1467 -503 1508 -532Q1550 -560 1612 -560H1618Q1681 -560 1723 -532Q1765 -503 1786 -448Q1808 -392 1808 -310V0H1669V-323Q1669 -374 1643 -404Q1617 -435 1569 -435Q1521 -435 1492 -404Q1463 -372 1463 -319V0H1324V-323Q1324 -374 1298 -404Q1272 -435 1224 -435Q1176 -435 1147 -404Q1118 -372 1118 -319V0Z M2264 0V-104Q2257 -83 2248 -66Q2225 -27 2186 -6Q2146 14 2089 14Q2030 14 1986 -7Q1941 -28 1916 -67Q1892 -106 1892 -161Q1892 -221 1922 -259Q1951 -297 2004 -316Q2058 -335 2130 -335H2241V-340Q2241 -387 2218 -410Q2195 -433 2147 -433Q2122 -433 2087 -432Q2052 -431 2016 -430Q1981 -428 1953 -426V-544Q1976 -546 2005 -548Q2034 -550 2064 -550Q2095 -551 2122 -551Q2206 -551 2262 -529Q2317 -507 2346 -460Q2374 -413 2374 -337V0ZM2241 -252H2128Q2080 -252 2054 -228Q2029 -205 2029 -168Q2029 -131 2054 -108Q2080 -85 2128 -85Q2157 -85 2182 -96Q2206 -106 2222 -132Q2239 -157 2241 -201Z M2501 0V-543H2611V-409Q2616 -430 2623 -449Q2645 -504 2688 -532Q2732 -560 2797 -560H2803Q2900 -560 2950 -498Q3000 -435 3000 -311V0H2861V-323Q2861 -373 2832 -404Q2804 -435 2754 -435Q2703 -435 2672 -404Q2640 -372 2640 -319V0Z M3363 7Q3288 7 3240 -12Q3191 -32 3167 -78Q3143 -125 3143 -204V-441H3057V-543H3144V-696H3274V-543H3441V-441H3273V-195Q3273 -155 3294 -134Q3316 -112 3356 -112H3441V7Z M3562 0V-439H3486V-543H3701V0Z M4080 19Q4009 19 3958 -5Q3906 -29 3872 -69Q3837 -109 3820 -159Q3803 -209 3803 -261V-280Q3803 -335 3820 -386Q3838 -436 3873 -476Q3908 -515 3960 -538Q4011 -562 4079 -562Q4150 -562 4206 -534Q4262 -507 4296 -458Q4329 -409 4333 -344H4198Q4193 -386 4162 -414Q4132 -442 4079 -442Q4033 -442 4002 -420Q3972 -398 3957 -360Q3942 -321 3942 -271Q3942 -223 3956 -184Q3971 -145 4002 -123Q4032 -101 4080 -101Q4116 -101 4142 -114Q4168 -127 4184 -150Q4199 -173 4203 -202H4338Q4334 -136 4300 -86Q4265 -37 4208 -9Q4152 19 4080 19Z"/><circle fill="currentColor" cx="3612" cy="-684" r="80"/>`;
// The wordmark's box is centred on the x-height, so mark and word line up when both are centred.
const WORD_BOX = "0 -772 4370 1010";

function svg(markup: string, viewBox: string, height: number, cls: string, label?: string): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="${cls}" viewBox="${viewBox}" height="${height}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${markup}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
export const mark = (px: number) => svg(MARK, "0 0 64 64", px, "logo-mark");
export const word = (px: number) => svg(WORD, WORD_BOX, px, "logo-word", "lumantic");

// The logo as one piece: mark and wordmark side by side. px is the height of the mark.
export function logo(px = 20): HTMLElement {
  const el = document.createElement("span");
  el.className = "logo";
  el.style.gap = `${Math.round(px * 0.3)}px`;
  el.append(mark(px), word(Math.round(px * 0.84)));
  return el;
}

// The browser tab: the mark on a small tile, light or dark like the design.
export function favicon(accent: string, dark: boolean): string {
  const tile = dark ? "#0c1124" : "#ffffff", ink = dark ? "#e9edf8" : "#19203a";
  const s = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-8 -8 80 80'><rect x='-8' y='-8' width='80' height='80' rx='18' fill='${tile}'/>${MARK.replace(/"/g, "'").replace(/currentColor/g, ink).replace("var(--accent)", accent)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(s)}`;
}

const SAFE_IMAGE = /^[A-Za-z0-9_\-/.]+\.(svg|png|jpe?g)$/;
const safe = (f: string | undefined) => (f && SAFE_IMAGE.test(f) && !f.includes("..") ? f : "");
// The company's logo for this design, or "" when Lumantic's own is shown.
export function companyLogo(brand: Settings["brand"] | undefined, dark: boolean): string {
  const light = safe(brand?.logo), night = safe(brand?.logoDark);
  const file = dark ? night || light : light;
  return file ? "/brand/" + file : "";
}

// What stands in the corner of the app: the company's logo if the config names one, else Lumantic's.
export function brandLogo(brand: Settings["brand"] | undefined, dark: boolean): HTMLElement {
  const src = companyLogo(brand, dark);
  if (!src) return logo(20);
  const img = document.createElement("img");
  img.className = "logo-corp";
  img.src = src;
  img.alt = brand?.name || "Logo";
  return img;
}

// «powered by lumantic», shown wherever a company logo has taken the logo's place.
export function poweredBy(): HTMLElement {
  const el = document.createElement("span");
  el.className = "logo-by";
  el.append("powered by", logo(11));
  return el;
}
