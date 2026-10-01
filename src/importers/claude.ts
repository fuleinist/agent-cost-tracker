import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { insertEntry } from "../db.js";
import { computeCost, lookupPrice } from "../prices.js";
import { round6 } from "../util.js";

export interface ImportResult {
  files: number;
  added: number;
  skipped: number;
  malformed: number;
}

function* walk(dir: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith(".jsonl")) yield p;
  }
}

interface TranscriptLine {
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  type?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

/**
 * Import Claude Code transcripts (~/.claude/projects/**\/*.jsonl).
 * Each assistant message with usage becomes one entry. Cache tokens are
 * counted as input tokens (approximation — see README). Idempotent via
 * dedupe key cc:<uuid|message.id>.
 */
export function importClaudeCode(db: DatabaseSync, dir?: string, dryRun = false): ImportResult {
  const root = dir ?? join(homedir(), ".claude", "projects");
  const res: ImportResult = { files: 0, added: 0, skipped: 0, malformed: 0 };
  for (const file of walk(root)) {
    res.files += 1;
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { res.malformed += 1; continue; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj: TranscriptLine;
      try { obj = JSON.parse(line) as TranscriptLine; } catch { res.malformed += 1; continue; }
      const usage = obj.message?.usage;
      const isAssistant = obj.type === "assistant" || obj.message?.role === "assistant";
      if (!isAssistant || !usage) continue;
      const tokensIn =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      const tokensOut = usage.output_tokens ?? 0;
      if (tokensIn === 0 && tokensOut === 0) continue;
      const dedupe = `cc:${obj.uuid ?? obj.message?.id ?? `${file}:${line.length}:${tokensIn}:${tokensOut}`}`;
      const model = obj.message?.model ?? "";
      const price = lookupPrice(db, "claude-code", model);
      const cost = computeCost(tokensIn, tokensOut, price);
      const ts = obj.timestamp ?? new Date(statSync(file).mtimeMs).toISOString();
      const project = obj.cwd ? basename(obj.cwd) : basename(file, ".jsonl").slice(0, 20);
      if (dryRun) { res.added += 1; continue; }
      const { inserted } = insertEntry(db, {
        ts,
        agent: "claude-code",
        model,
        project,
        tokensIn,
        tokensOut,
        costUsd: round6(cost),
        note: `imported from ${basename(file)}`,
        dedupeKey: dedupe,
      });
      if (inserted) res.added += 1;
      else res.skipped += 1;
    }
  }
  return res;
}
