import { createServer, type Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { queryEntries } from "./db.js";
import { currentBudgetReports } from "./budget.js";
import { weekKey, weekRange, round6 } from "./util.js";

export interface Summary {
  generatedAt: string;
  totalCost: number;
  totalEntries: number;
  byAgent: { key: string; entries: number; cost: number }[];
  byProject: { key: string; entries: number; cost: number }[];
  weeks: { week: string; cost: number }[];
  budgets: { scope: string; weeklyUsd: number; spend: number; status: string }[];
}

export function buildSummary(db: DatabaseSync, now = new Date()): Summary {
  const entries = queryEntries(db);
  const totalCost = round6(entries.reduce((s, e) => s + e.cost_usd, 0));
  const group = (pick: (e: (typeof entries)[number]) => string) => {
    const m = new Map<string, { key: string; entries: number; cost: number }>();
    for (const e of entries) {
      const k = pick(e) || "(none)";
      let row = m.get(k);
      if (!row) { row = { key: k, entries: 0, cost: 0 }; m.set(k, row); }
      row.entries += 1;
      row.cost += e.cost_usd;
    }
    return [...m.values()].map((r) => ({ ...r, cost: round6(r.cost) })).sort((a, b) => b.cost - a.cost);
  };
  // Last 12 ISO weeks.
  const weeks: { week: string; cost: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86400000);
    // snap to Monday of that week
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = weekKey(d);
    if (weeks.some((w) => w.week === key)) continue;
    const { start, end } = weekRange(key);
    const cost = round6(
      entries
        .filter((e) => e.ts >= start.toISOString() && e.ts < end.toISOString())
        .reduce((s, e) => s + e.cost_usd, 0),
    );
    weeks.push({ week: key, cost });
  }
  return {
    generatedAt: now.toISOString(),
    totalCost,
    totalEntries: entries.length,
    byAgent: group((e) => e.agent),
    byProject: group((e) => e.project),
    weeks,
    budgets: currentBudgetReports(db, now).map((b) => ({
      scope: b.scope,
      weeklyUsd: b.weeklyUsd,
      spend: round6(b.spend),
      status: b.status,
    })),
  };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-cost-tracker</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --card:#181b22; --fg:#e6e6e6; --mut:#8a93a5; --acc:#6ea8fe; --ok:#3ddc84; --near:#ffc857; --over:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .mut { color: var(--mut); }
  .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin:20px 0; }
  .card { background:var(--card); border-radius:10px; padding:14px 16px; }
  .card .v { font-size:22px; font-weight:600; }
  .card .l { color:var(--mut); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #262a33; }
  td.n, th.n { text-align:right; font-variant-numeric: tabular-nums; }
  .pill { padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; }
  .pill.ok { background:#12331f; color:var(--ok); }
  .pill.near { background:#3a2f10; color:var(--near); }
  .pill.over { background:#3d1418; color:var(--over); }
  svg text { fill: var(--mut); font-size: 10px; }
  section { background:var(--card); border-radius:10px; padding:16px; margin-bottom:16px; }
  h2 { font-size:14px; margin:0 0 10px; color:var(--mut); text-transform:uppercase; letter-spacing:.05em; }
</style>
</head>
<body>
<div class="wrap">
  <h1>agent-cost-tracker</h1>
  <div class="mut">Cross-agent AI coding spend · <span id="gen"></span></div>
  <div class="cards" id="cards"></div>
  <section><h2>Last 12 weeks</h2><div id="chart"></div></section>
  <section><h2>Budgets (current week)</h2><div id="budgets"></div></section>
  <section><h2>By agent</h2><div id="agents"></div></section>
  <section><h2>By project</h2><div id="projects"></div></section>
</div>
<script>
const usd = n => "$" + Number(n).toFixed(2);
function table(el, headers, rows) {
  let h = "<table><thead><tr>" + headers.map((x,i) => "<th"+(i?' class="n"':'')+">"+x+"</th>").join("") + "</tr></thead><tbody>";
  for (const r of rows) h += "<tr>" + r.map((c,i) => "<td"+(i?' class="n"':'')+">"+c+"</td>").join("") + "</tr>";
  document.getElementById(el).innerHTML = h + "</tbody></table>";
}
function chart(weeks) {
  const W = 900, H = 180, P = 24;
  const max = Math.max(...weeks.map(w => w.cost), 0.01);
  const bw = (W - P*2) / weeks.length;
  let s = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%">'+
    '<line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="#262a33"/>';
  weeks.forEach((w, i) => {
    const h = Math.max(2, (w.cost / max) * (H - P*2 - 14));
    const x = P + i*bw + bw*0.15, y = H - P - h;
    s += '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.7).toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="#6ea8fe"><title>'+w.week+': '+usd(w.cost)+'</title></rect>';
    s += '<text x="'+(x+bw*0.35).toFixed(1)+'" y="'+(H-P+12)+'" text-anchor="middle">'+w.week.slice(5)+'</text>';
  });
  document.getElementById("chart").innerHTML = s + "</svg>";
}
fetch("api/summary").then(r => r.json()).then(d => {
  document.getElementById("gen").textContent = "generated " + d.generatedAt.slice(0,16).replace("T"," ") + " UTC";
  document.getElementById("cards").innerHTML = [
    ["Total spend", usd(d.totalCost)],
    ["Entries", d.totalEntries],
    ["This week", usd((d.weeks[d.weeks.length-1]||{cost:0}).cost)],
    ["Agents", d.byAgent.length],
  ].map(([l,v]) => '<div class="card"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>').join("");
  chart(d.weeks);
  table("agents", ["Agent","Entries","Cost"], d.byAgent.map(r => [r.key, r.entries, usd(r.cost)]));
  table("projects", ["Project","Entries","Cost"], d.byProject.map(r => [r.key, r.entries, usd(r.cost)]));
  const b = d.budgets;
  document.getElementById("budgets").innerHTML = b.length
    ? '<table><thead><tr><th>Scope</th><th class="n">Spent</th><th class="n">Weekly limit</th><th>Status</th></tr></thead><tbody>' +
      b.map(x => '<tr><td>'+x.scope+'</td><td class="n">'+usd(x.spend)+'</td><td class="n">'+usd(x.weeklyUsd)+'</td><td><span class="pill '+x.status+'">'+x.status+'</span></td></tr>').join("") + "</tbody></table>"
    : '<span class="mut">No budgets set. Use <code>act budget set --weekly 50</code>.</span>';
});
</script>
</body>
</html>`;

export function startServer(db: DatabaseSync, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/" || path === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
      }
      if (path === "/api/summary") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(buildSummary(db)));
        return;
      }
      if (path === "/api/entries") {
        const limit = Number(url.searchParams.get("limit") ?? "200");
        const entries = queryEntries(db, { limit: Number.isFinite(limit) ? limit : 200 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(entries));
        return;
      }
      if (path === "/api/budgets") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(currentBudgetReports(db)));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}
