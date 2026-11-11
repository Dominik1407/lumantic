// The workspace the server keeps: design, pinned moments and the dashboards a
// person has adjusted. Dashboards Lumina manages alone are not stored; they
// are chosen fresh for whatever month is on screen.
import { api } from "./api";
import { toast } from "./ui";

export interface DashLayout {
  sel: string[];
  size: Record<string, string>;
  type: Record<string, string>;
  range: Record<string, string>;
  custom: boolean; // true once the person changed something
}

export const W = {
  design: "atlas",
  pins: [] as string[], // YYYY-MM
  dash: {} as Record<string, DashLayout>,
};

export async function loadWorkspace() {
  try {
    const raw = await api.workspace();
    if (typeof raw.design === "string") W.design = raw.design;
    if (Array.isArray(raw.pins)) W.pins = raw.pins.filter((p): p is string => typeof p === "string");
    if (raw.dash && typeof raw.dash === "object") {
      for (const [scope, d] of Object.entries(raw.dash as Record<string, DashLayout>)) {
        if (Array.isArray(d.sel)) W.dash[scope] = { sel: d.sel, size: d.size || {}, type: d.type || {}, range: d.range || {}, custom: true };
      }
    }
  } catch {
    // Without a stored workspace Lumantic starts with Lumina's choices.
  }
}

let timer = 0;
export function saveWorkspace() {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const dash = Object.fromEntries(Object.entries(W.dash).filter(([, d]) => d.custom).map(([s, d]) => [s, { sel: d.sel, size: d.size, type: d.type, range: d.range }]));
    try {
      await api.saveWorkspace({ design: W.design, pins: W.pins, dash });
    } catch (e) {
      toast(`Nicht gespeichert: ${(e as Error).message}`);
    }
  }, 500);
}

// Per-device conveniences that do not belong on the server.
export const local = {
  get(key: string): string | null {
    try { return localStorage.getItem("lumantic." + key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem("lumantic." + key, value); } catch { /* private mode */ }
  },
};
