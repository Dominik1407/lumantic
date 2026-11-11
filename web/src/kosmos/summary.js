// ═════ Kosmos · what the main menu shows of a Kosmos ═════
// Not a part of the room: the build joins this file after 00-core.js alone (see vite.config.ts), so the menu speaks
// with the same rules as the pages, without building any of them.
const m = N - 1;
return {
  title: TITLE,
  month: periodOf(m, STD).long,
  headline: headlineFor(m, "all"),
  counts: levelCounts(m),
  groups: GROUP_ORDER.map((id) => ({ id, name: GROUPS[id] })),
  stars: KPIS.map((k) => { const r = stateOf(k, m); return { id: k.id, name: k.short, group: k.group, level: r.level, kind: r.kind, gap: !!r.gap }; }),
};
