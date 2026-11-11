import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath, type Plugin } from "vite";

// Kosmos lives in numbered plain-JS part files (src/kosmos/00-core.js … 90-host.js) that share one scope, the way the
// study was written. This plugin joins them in file name order into the body of one function and serves it as the
// module "virtual:kosmos":
//
//   export function bootKosmos(DATA, HOST) { …00-core.js… …90-host.js… }
//
// DATA is the answer of GET /api/metrics, HOST what the TypeScript side offers (src/main.ts). The last part returns
// what the host may change while the room runs. Editing a part reloads the page in development.
//
// The main menu shows every Kosmos without building its room. For that the module has a second export, made from
// the core part and summary.js alone:
//
//   export function readKosmos(DATA) { …00-core.js… …summary.js… }
const KOSMOS_DIR = normalizePath(fileURLToPath(new URL("./src/kosmos", import.meta.url)));
const VIRTUAL = "virtual:kosmos";

function kosmos(): Plugin {
  const parts = () => readdirSync(KOSMOS_DIR).filter((f) => /^\d\d-[a-z0-9-]+\.js$/.test(f)).sort();
  return {
    name: "lumantic-kosmos",
    resolveId: (id) => (id === VIRTUAL ? "\0" + VIRTUAL : null),
    load(id) {
      if (id !== "\0" + VIRTUAL) return null;
      const read = (f: string) => {
        this.addWatchFile(resolve(KOSMOS_DIR, f));
        return `// ── ${f} ──\n${readFileSync(resolve(KOSMOS_DIR, f), "utf8")}`;
      };
      const all = parts();
      return `export function bootKosmos(DATA, HOST) {\n${all.map(read).join("\n")}\n}\n` +
        `export function readKosmos(DATA) {\nconst HOST = { reduced: () => true };\n${read(all[0])}\n${read("summary.js")}\n}\n`;
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(KOSMOS_DIR)) {
        server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

// In development the Go server answers /api and /brand; in production it serves dist/.
export default defineConfig({
  plugins: [kosmos()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8080", "/brand": "http://127.0.0.1:8080" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
