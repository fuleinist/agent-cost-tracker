// Date/week helpers, money + table formatting. Zero dependencies.

export function isoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Move to Thursday of the current ISO week.
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: t.getFullYear(), week };
}

export function weekKey(d: Date): string {
  const { year, week } = isoWeekParts(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weekRange(key: string): { start: Date; end: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`invalid week key: ${key} (expected YYYY-Www)`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const mondayW1 = new Date(jan4);
  mondayW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(mondayW1);
  start.setDate(mondayW1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export function monthRange(d: Date): { start: Date; end: Date } {
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export type Cell = string | number;

export function renderTable(headers: string[], rows: Cell[][]): string {
  if (rows.length === 0) return renderTable(headers, [["(no data)", "", ""]].map((r) => r.slice(0, headers.length)));
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells: Cell[]) =>
    cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
}
