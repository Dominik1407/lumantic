// The language of the interface: German or English. The person's choice (Darstellung › Sprache), else the one the
// team saved for everyone, else the browser's. Texts stand where they are used, in both languages: tr("Heute", "Today").
//
// Some texts are made when the modules load, before the settings have arrived. So the browser keeps the language
// it showed last, and starts in it; when the settings then say otherwise, the page loads once more in the right one.
export type Lang = "de" | "en";

const KEY = "lumantic.lang";
const fromBrowser = (): Lang => ((navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en");
const kept = (): Lang | "" => { try { const v = localStorage.getItem(KEY); return v === "de" || v === "en" ? v : ""; } catch { return ""; } };
export let LANG: Lang = kept() || fromBrowser();
document.documentElement.lang = LANG === "de" ? "de-CH" : "en";

// The browser keeps the language, and tells the server in a cookie, so pages it opens itself (the login) speak it too.
function keep(want: Lang) {
  try { localStorage.setItem(KEY, want); } catch { /* fine */ }
  document.cookie = `lumantic_lang=${want}; path=/; max-age=31536000; SameSite=Lax`;
}

export const tr = (de: string, en: string) => (LANG === "en" ? en : de);
export const isEn = () => LANG === "en";

// The language a choice stands for: "de", "en", or "" for the browser's.
export const resolveLang = (pref: string | undefined): Lang => (pref === "de" || pref === "en" ? pref : fromBrowser());

// Once the settings are known: keep the language they ask for, and load the page again when it differs from the one
// it started in. Returns true when it reloads. Without browser storage it never reloads, it just stays.
export function settleLang(pref: string | undefined): boolean {
  const want = resolveLang(pref);
  keep(want);
  if (want === LANG) return false;
  try {
    if (localStorage.getItem(KEY) !== want || sessionStorage.getItem(KEY) === want) return false;
    sessionStorage.setItem(KEY, want);
  } catch { return false; }
  location.reload();
  return true;
}

// The person chose another language: keep it, and load the page again in it.
export function switchLang(pref: string) {
  const want = resolveLang(pref);
  keep(want);
  try { sessionStorage.removeItem(KEY); } catch { /* the next start asks the settings again */ }
  if (want !== LANG) location.reload();
}

// The page skeleton (index.html) speaks German; in English its texts come from data-en attributes.
export function translateStatic() {
  if (LANG !== "en") return;
  document.querySelectorAll<HTMLElement>("[data-en]").forEach((el) => { el.textContent = el.dataset.en || ""; });
  document.querySelectorAll<HTMLElement>("[data-en-html]").forEach((el) => { el.innerHTML = el.dataset.enHtml || ""; });
  for (const a of ["aria-label", "title", "content"]) document.querySelectorAll(`[data-en-${a}]`).forEach((el) => el.setAttribute(a, el.getAttribute(`data-en-${a}`) || ""));
  const app = document.getElementById("app");
  if (app) app.lang = "en";
}
