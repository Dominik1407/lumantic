// Lumantic: a calm surface over the gold layer. Quiet until it matters.
import "./lumen/designs.css";
import "./app.css";
import { api } from "./api";
import { h } from "./dom";
import { initModel } from "./model";
import { applyRoute } from "./nav";
import { buildShell, setDesign } from "./shell";
import type { Design } from "./time";
import { initOverlays } from "./ui";
import { W, loadWorkspace } from "./workspace";

async function boot() {
  const root = document.getElementById("app") as HTMLElement;
  root.replaceChildren(h("div", { class: "boot" }, h("span", { class: "mark", "aria-hidden": "true" }), h("span", { class: "label", text: "Lumantic liest den Goldlayer …" })));
  try {
    const [data] = await Promise.all([api.metrics(), loadWorkspace()]);
    initModel(data);
  } catch (e) {
    root.replaceChildren(h("div", { class: "boot boot--error" },
      h("span", { class: "label", text: "Lumantic" }),
      h("h1", { text: "Der Goldlayer antwortet gerade nicht." }),
      h("p", { text: (e as Error).message }),
      h("button", { class: "btn btn--accent", type: "button", onclick: () => boot() }, "Nochmals versuchen")));
    return;
  }
  if (["atlas", "zifferblatt", "messtisch"].includes(W.design)) setDesign(W.design as Design, false);
  initOverlays();
  buildShell(root);
  applyRoute(location.hash, true);
}

boot();
