import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

function act(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function freshEnv() {
  const dir = mkdtempSync(join(tmpdir(), "act-test-"));
  return { ACT_DB: join(dir, "db.sqlite"), dir };
}

test("init + add computes cost from price table (AC1)", () => {
  const env = freshEnv();
  try {
    let r = act(["init"], env);
    assert.equal(r.status, 0);
    r = act(["add", "--agent", "claude-code", "--model", "claude-sonnet-4-5", "--project", "demo", "--tokens-in", "1000000", "--tokens-out", "500000", "--format", "json"], env);
    assert.equal(r.status, 0);
    const entry = JSON.parse(r.stdout);
    // 1Mtok * $3 + 0.5Mtok * $15 = $10.50
    assert.equal(entry.costUsd, 10.5);
    assert.equal(entry.id, 1);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("add with explicit --cost and rejects empty add", () => {
  const env = freshEnv();
  try {
    let r = act(["add", "--agent", "copilot", "--project", "x", "--cost", "10", "--format", "json"], env);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).costUsd, 10);
    r = act(["add", "--agent", "copilot"], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--cost|--tokens-in/);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("unknown agent warns and records $0", () => {
  const env = freshEnv();
  try {
    const r = act(["add", "--agent", "mystery-ai", "--tokens-in", "1000"], env);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /no price known/);
    assert.match(r.stdout, /\$0\.00/);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("prices set overrides builtin pricing", () => {
  const env = freshEnv();
  try {
    act(["prices", "set", "--agent", "claude-code", "--model", "sonnet", "--in", "1", "--out", "2"], env);
    const r = act(["add", "--agent", "claude-code", "--model", "sonnet", "--tokens-in", "1000000", "--tokens-out", "1000000", "--format", "json"], env);
    assert.equal(JSON.parse(r.stdout).costUsd, 3); // 1*1 + 1*2
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("report groups by agent/project/model with correct totals (AC2)", () => {
  const env = freshEnv();
  try {
    act(["add", "--agent", "claude-code", "--model", "sonnet", "--project", "a", "--cost", "5"], env);
    act(["add", "--agent", "cursor", "--project", "a", "--cost", "3"], env);
    act(["add", "--agent", "cursor", "--project", "b", "--cost", "2"], env);

    let r = act(["report", "--all", "--by", "agent", "--format", "json"], env);
    let rep = JSON.parse(r.stdout);
    assert.equal(rep.total, 10);
    assert.equal(rep.rows[0].key, "claude-code");
    assert.equal(rep.rows[0].cost, 5);
    assert.equal(rep.rows[1].key, "cursor");
    assert.equal(rep.rows[1].entries, 2);

    r = act(["report", "--all", "--by", "project", "--format", "json"], env);
    rep = JSON.parse(r.stdout);
    assert.equal(rep.rows[0].key, "a");
    assert.equal(rep.rows[0].cost, 8);
    assert.equal(rep.rows[0].pct, 80);

    r = act(["report", "--all", "--by", "model", "--format", "csv"], env);
    assert.equal(r.status, 0);
    const lines = r.stdout.trim().split("\n");
    assert.match(lines[0], /^model,entries,tokens_in,tokens_out,cost,share$/);
    assert.equal(lines.length, 3); // header + 2 groups (claude-code/sonnet, cursor/(unknown model))
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("budget alerts: near at >=80%, over at >=100% (AC3)", () => {
  const env = freshEnv();
  try {
    act(["budget", "set", "--weekly", "10"], env);
    // $8.50 -> near
    let r = act(["add", "--agent", "claude-code", "--cost", "8.5"], env);
    assert.match(r.stderr, /nearly reached/);
    // +$2 -> over
    r = act(["add", "--agent", "claude-code", "--cost", "2"], env);
    assert.match(r.stderr, /BUDGET EXCEEDED/);
    // budget list shows over
    r = act(["budget", "list", "--format", "json"], env);
    const b = JSON.parse(r.stdout);
    assert.equal(b.budgets[0].status, "over");
    // project-scoped budget
    act(["budget", "set", "--weekly", "1", "--project", "side"], env);
    r = act(["add", "--agent", "codex", "--project", "side", "--cost", "1.5"], env);
    assert.match(r.stderr, /BUDGET EXCEEDED \[project:side\]/);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("import claude-code is idempotent (AC4)", () => {
  const env = freshEnv();
  try {
    const fixDir = join(env.dir, "transcripts", "proj-x");
    mkdirSync(fixDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: "assistant", uuid: "u1", timestamp: "2026-09-30T02:00:00.000Z", cwd: "C:\\dev\\proj-x", message: { id: "m1", role: "assistant", model: "claude-sonnet-4-5", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 } } }),
      JSON.stringify({ type: "assistant", uuid: "u2", timestamp: "2026-09-30T03:00:00.000Z", cwd: "C:\\dev\\proj-x", message: { id: "m2", role: "assistant", model: "claude-opus-4-5", usage: { input_tokens: 100, output_tokens: 50 } } }),
      JSON.stringify({ type: "user", uuid: "u3", message: { role: "user" } }),
      "not json at all",
    ];
    writeFileSync(join(fixDir, "sess.jsonl"), "\ufeff" + lines.join("\n"));

    let r = act(["import", "claude-code", "--dir", join(env.dir, "transcripts"), "--format", "json"], env);
    assert.equal(r.status, 0);
    let out = JSON.parse(r.stdout);
    assert.equal(out.added, 2);
    assert.equal(out.skipped, 0);
    assert.equal(out.malformed, 1);

    r = act(["import", "claude-code", "--dir", join(env.dir, "transcripts"), "--format", "json"], env);
    out = JSON.parse(r.stdout);
    assert.equal(out.added, 0);
    assert.equal(out.skipped, 2);

    // costs computed via alias matching: sonnet 3000in*3 + 500out*15 per Mtok
    r = act(["list", "--limit", "10", "--format", "json"], env);
    const entries = JSON.parse(r.stdout);
    const sonnet = entries.find((e) => e.model === "claude-sonnet-4-5");
    assert.equal(sonnet.tokens_in, 3000);
    assert.equal(sonnet.cost_usd, 0.0165);
    assert.equal(sonnet.project, "proj-x");
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("serve dashboard returns HTML and JSON summary (AC5)", async () => {
  const env = freshEnv();
  const { createServer } = await import("node:http");
  try {
    act(["add", "--agent", "claude-code", "--project", "srv", "--cost", "7.25"], env);
    // find a free port
    const probe = createServer();
    await new Promise((res) => probe.listen(0, res));
    const port = probe.address().port;
    probe.close();

    const { spawn } = await import("node:child_process");
    const srv = spawn(process.execPath, [CLI, "serve", "--port", String(port)], { env: { ...process.env, ...env }, stdio: "ignore" });
    try {
      // wait for server
      let ok = false;
      for (let i = 0; i < 50 && !ok; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/summary`);
          ok = res.ok;
        } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      assert.ok(ok, "server did not come up");
      const html = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(html.status, 200);
      assert.match(await html.text(), /agent-cost-tracker/);
      const sum = await (await fetch(`http://127.0.0.1:${port}/api/summary`)).json();
      assert.equal(sum.totalCost, 7.25);
      assert.equal(sum.totalEntries, 1);
      assert.equal(sum.byAgent[0].key, "claude-code");
      assert.ok(Array.isArray(sum.weeks) && sum.weeks.length > 0);
      const entries = await (await fetch(`http://127.0.0.1:${port}/api/entries?limit=10`)).json();
      assert.equal(entries.length, 1);
      const nf = await fetch(`http://127.0.0.1:${port}/api/nope`);
      assert.equal(nf.status, 404);
    } finally {
      srv.kill();
      await new Promise((r) => srv.on("exit", r));
    }
  } finally { rmSync(env.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test("weekly digest contains required sections (AC7)", () => {
  const env = freshEnv();
  try {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    act(["add", "--agent", "claude-code", "--project", "wk", "--cost", "3", "--date", monday.toISOString()], env);
    act(["add", "--agent", "cursor", "--project", "wk2", "--cost", "2", "--date", monday.toISOString()], env);
    const r = act(["weekly", "--format", "md"], env);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /# Weekly AI coding spend/);
    assert.match(r.stdout, /Total: \$5\.00/);
    assert.match(r.stdout, /## By agent/);
    assert.match(r.stdout, /## By project/);
    assert.match(r.stdout, /## Top entries/);
    const t = act(["weekly", "--format", "text"], env);
    assert.match(t.stdout, /By agent:/);
    const j = act(["weekly", "--format", "json"], env);
    const data = JSON.parse(j.stdout);
    assert.equal(data.total, 5);
    assert.equal(data.byAgent.length, 2);
    // explicit week key with no data
    const k = act(["weekly", "--week", "2020-W01", "--format", "json"], env);
    assert.equal(JSON.parse(k.stdout).total, 0);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("list/rm round-trip and formats", () => {
  const env = freshEnv();
  try {
    act(["add", "--agent", "gemini", "--cost", "1"], env);
    let r = act(["list", "--format", "json"], env);
    const entries = JSON.parse(r.stdout);
    assert.equal(entries.length, 1);
    r = act(["rm", String(entries[0].id)], env);
    assert.match(r.stdout, /deleted/);
    r = act(["list", "--format", "json"], env);
    assert.equal(JSON.parse(r.stdout).length, 0);
    r = act(["rm", "999"], env);
    assert.equal(r.status, 1);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});

test("help and version", () => {
  const env = freshEnv();
  try {
    let r = act(["--version"], env);
    assert.equal(r.stdout.trim(), "0.1.0");
    r = act(["help"], env);
    assert.match(r.stdout, /agent-cost-tracker \(act\)/);
    r = act(["bogus"], env);
    assert.equal(r.status, 1);
  } finally { rmSync(env.dir, { recursive: true, force: true }); }
});
