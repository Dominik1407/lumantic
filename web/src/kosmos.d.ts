// The Kosmos room, joined from src/kosmos/*.js by the plugin in vite.config.ts.
declare module "virtual:kosmos" {
  import type { AskReply, MetricsData } from "./api";

  export interface KosmosHost {
    reduced(): boolean;
    save(snapshot: unknown): void;
    stored(): unknown;
    onPlace(id: string): void;
    lensBack(): number;
    aiReady(): boolean;
    ask(question: string, month: string, facts: unknown): Promise<AskReply>;
    openSettings(): void;
    closeSettings(): boolean;
    settingsOpen(): boolean;
    prefs(): { hints: boolean; start: string; lastPage: string };
    leave(): void; // to the main menu, when there is more than one Kosmos
    openCatalog(kpi?: string): void; // the Sternkatalog, at a figure's entry if one is named
    closeCatalog(): boolean;
    catalogOpen(): boolean;
    arrived(): boolean; // true when this page was opened from the main menu
  }

  // What the main menu shows of a Kosmos: its line for the latest month and one star per figure.
  export interface KosmosSummary {
    title: string;
    month: string;
    headline: string;
    counts: { alert: number; watch: number; good: number };
    groups: { id: string; name: string }[];
    stars: { id: string; name: string; group: string; level: "alert" | "watch" | "notable" | "calm"; kind: string; gap: boolean }[];
  }

  export interface KosmosRoom {
    retheme(): void;
    setMotion(still: boolean): void;
    setLensBack(months: number): void;
    setHints(on: boolean): void;
    setSheet(px: number): void;
    resetAll(): void;
    home(kpi: string): void; // fly to a figure's place in the room
    debug: Record<string, unknown>;
  }

  export function bootKosmos(data: MetricsData, host: KosmosHost): KosmosRoom;
  export function readKosmos(data: MetricsData): KosmosSummary;
}
