// Minimal flag parser: --flag value | --flag=value | --bool, positionals in _.

export interface Parsed {
  _: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out.flags[name] = next;
          i++;
        } else {
          out.flags[name] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function str(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function bool(p: Parsed, name: string): boolean {
  const v = p.flags[name];
  return v === true || v === "true";
}

export function num(p: Parsed, name: string): number | undefined {
  const v = str(p, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name}: expected a number, got "${v}"`);
  return n;
}
