import type { DatabaseSync } from "node:sqlite";
import { entriesForWeek } from "./budget.js";
import type { Entry } from "./db.js";
import { weekKey, weekRange, fmtUsd, dayLabel, round6 } from "./util.js";

export interface WeeklyData {
  week: string;
  startLabel: string;
  endLabel: string;
  total: number;
  entryCount: number;
  prevWeek: string;
  prevTotal: number;
  delta: number;
  byAgent: { key: string; entries: number; cost: number; pct: number }[];
  byProject: { key: string; entries: number; cost: number; pct: number }[];
  topEntries: Entry[];
}

function group(entries: Entry[], pick: (e: Entry) => string) {
  const map = new Map<string, { key: string; entries: number; cost: number; pct: number }>();
  let total = 0;
  for (const e of entries) {
    const k = pick(e) || "(none)";
    let row = map.get(k);
    if (!row) { row = { key: k, entries: 0, cost: 0, pct: 0 }; map.set(k, row); }
    row.entries += 1;
    row.cost += e.cost_usd;
    total += e.cost_usd;
  }
  const rows = [...map.values()].sort((a, b) => b.cost - a.cost);
  for (const r of rows) {
    r.cost = round6(r.cost);
    r.pct = total > 0 ? Math.round((r.cost / total) * 1000) / 10 : 0;
  }
  return rows;
}

export function buildWeekly(db: DatabaseSync, week?: string, now = new Date()): WeeklyData {
  const key = week ?? weekKey(now);
  const { start, end } = weekRange(key);
  const entries = entriesForWeek(db, key);
  const lastDay = new Date(end);
  lastDay.setDate(end.getDate() - 1); // Sunday of this week
  const prevSunday = new Date(start);
  prevSunday.setDate(start.getDate() - 1); // Sunday of previous week
  const prev = weekKey(prevSunday);
  const prevTotal = round6(entriesForWeek(db, prev).reduce((s, e) => s + e.cost_usd, 0));
  const total = round6(entries.reduce((s, e) => s + e.cost_usd, 0));
  return {
    week: key,
    startLabel: dayLabel(start),
    endLabel: dayLabel(lastDay),
    total,
    entryCount: entries.length,
    prevWeek: prev,
    prevTotal,
    delta: round6(total - prevTotal),
    byAgent: group(entries, (e) => e.agent),
    byProject: group(entries, (e) => e.project),
    topEntries: [...entries].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 5),
  };
}

export function renderWeeklyMd(w: WeeklyData): string {
  const arrow = w.delta > 0 ? "▲" : w.delta < 0 ? "▼" : "=";
  const lines: string[] = [
    `# Weekly AI coding spend — ${w.week} (${w.startLabel} – ${w.endLabel})`,
    "",
    `**Total: ${fmtUsd(w.total)}** across ${w.entryCount} entries — ${arrow} ${fmtUsd(Math.abs(w.delta))} vs ${w.prevWeek} (${fmtUsd(w.prevTotal)})`,
    "",
    "## By agent",
    "",
    "| Agent | Entries | Cost | Share |",
    "| --- | ---: | ---: | ---: |",
    ...w.byAgent.map((r) => `| ${r.key} | ${r.entries} | ${fmtUsd(r.cost)} | ${r.pct}% |`),
    "",
    "## By project",
    "",
    "| Project | Entries | Cost | Share |",
    "| --- | ---: | ---: | ---: |",
    ...w.byProject.map((r) => `| ${r.key} | ${r.entries} | ${fmtUsd(r.cost)} | ${r.pct}% |`),
    "",
    "## Top entries",
    "",
    "| When | Agent | Model | Project | Cost |",
    "| --- | --- | --- | --- | ---: |",
    ...w.topEntries.map((e) =>
      `| ${e.ts.slice(0, 16).replace("T", " ")} | ${e.agent} | ${e.model || "-"} | ${e.project || "-"} | ${fmtUsd(e.cost_usd)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function renderWeeklyText(w: WeeklyData): string {
  const lines: string[] = [
    `Weekly AI coding spend — ${w.week} (${w.startLabel} - ${w.endLabel})`,
    `Total: ${fmtUsd(w.total)} across ${w.entryCount} entries (vs ${w.prevWeek}: ${fmtUsd(w.prevTotal)}, delta ${fmtUsd(w.delta)})`,
    "",
    "By agent:",
    ...w.byAgent.map((r) => `  ${r.key}: ${fmtUsd(r.cost)} (${r.entries} entries, ${r.pct}%)`),
    "",
    "By project:",
    ...w.byProject.map((r) => `  ${r.key}: ${fmtUsd(r.cost)} (${r.entries} entries, ${r.pct}%)`),
  ];
  return lines.join("\n");
}
