#!/usr/bin/env node
// Scrub credentials from recorded specs BEFORE they become a skill.
// Codegen embeds typed text as plaintext, so a password can end up in a
// .spec.ts even if you tried to pause the recorder. This replaces any typed
// secret with an env-var reference (e.g. process.env.EVICORE_PW).
//
// Usage:
//   node scripts/scrub-credentials.mjs <file-or-dir> [--portal evicore] [--write]
//
// Without --write it runs in dry-run mode and only reports what it WOULD change.
// With --write it rewrites the files in place.
//
// Heuristics (conservative — reports, never silently drops data):
//   - .fill('<selector>', '<value>')  where the selector looks like a password
//     field  -> value replaced with process.env.<PORTAL>_PW
//   - .fill(...) into a field whose name/id/placeholder looks like username /
//     email / user -> value replaced with process.env.<PORTAL>_USER
//   - any .fill value that matches a known-secret regex (long high-entropy
//     token) -> flagged for manual review (NOT auto-replaced)

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const portalFlagIdx = args.indexOf("--portal");
const portalOverride = portalFlagIdx >= 0 ? args[portalFlagIdx + 1] : null;
const target = args.find((a) => !a.startsWith("--") && a !== portalOverride);

if (!target) {
  console.error(
    "usage: scrub-credentials.mjs <file-or-dir> [--portal <name>] [--write]",
  );
  process.exit(1);
}

const PASSWORD_HINT = /pass(word)?|pwd|secret/i;
const USER_HINT = /user(name)?|email|login|account/i;
// Long, high-entropy-looking literal that isn't an obvious selector value.
const TOKEN_HINT = /^[A-Za-z0-9._~+/-]{24,}={0,2}$/;

function portalFor(file) {
  if (portalOverride) return portalOverride.toUpperCase();
  // evicore_case01.spec.ts -> EVICORE
  const m = basename(file).match(/^([a-z0-9]+)_/i);
  return (m ? m[1] : "PORTAL").toUpperCase();
}

// Matches page.fill / getBy...().fill / locator.fill with two string args, and
// the single-arg .fill('value') form that follows a getByLabel/getByPlaceholder.
const FILL_RE =
  /\.fill\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*(?:,\s*(['"`])((?:\\.|(?!\3).)*)\3\s*)?\)/g;

function classify(fullLineContext, selectorArg, valueArg) {
  // Two-arg form: selectorArg is the target, valueArg is the typed value.
  // One-arg form: valueArg undefined; the selector context comes from the
  // preceding getBy... on the same statement (fullLineContext).
  const haystack = `${fullLineContext} ${selectorArg ?? ""}`;
  const value = valueArg ?? selectorArg;
  if (PASSWORD_HINT.test(haystack)) return { kind: "password", value };
  if (USER_HINT.test(haystack)) return { kind: "username", value };
  if (typeof value === "string" && TOKEN_HINT.test(value))
    return { kind: "token", value };
  return null;
}

function scrubFile(file) {
  const portal = portalFor(file);
  let src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const findings = [];

  const newLines = lines.map((line) => {
    return line.replace(FILL_RE, (match, q1, a1, q2, a2) => {
      const hit = classify(line, a1, a2);
      if (!hit) return match;

      if (hit.kind === "token") {
        findings.push({ line, kind: "token (manual review)", value: hit.value });
        return match; // do not auto-replace unknown tokens
      }

      const envVar =
        hit.kind === "password"
          ? `process.env.${portal}_PW`
          : `process.env.${portal}_USER`;
      findings.push({ line, kind: hit.kind, value: hit.value, envVar });

      // Rebuild the .fill(...) call with the value replaced by the env ref.
      if (a2 !== undefined) {
        // two-arg: keep selector, swap value
        return `.fill(${q1}${a1}${q1}, ${envVar})`;
      }
      // one-arg: swap the single value
      return `.fill(${envVar})`;
    });
  });

  if (findings.length === 0) {
    console.log(`  ${file}: clean`);
    return;
  }

  console.log(`  ${file}: ${findings.length} finding(s) [portal ${portal}]`);
  for (const f of findings) {
    const shown = f.kind.startsWith("token")
      ? "***"
      : f.value.length > 4
        ? f.value.slice(0, 2) + "***"
        : "***";
    console.log(
      `    - ${f.kind}: "${shown}"` + (f.envVar ? ` -> ${f.envVar}` : ""),
    );
  }

  if (write) {
    writeFileSync(file, newLines.join("\n"));
    console.log(`    written.`);
  } else {
    console.log(`    (dry run — pass --write to apply)`);
  }
}

function walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name.endsWith(".spec.ts") || name.endsWith(".ts"))
        scrubFile(join(path, name));
    }
  } else {
    scrubFile(path);
  }
}

console.log(`Scrubbing ${target}${write ? " (writing)" : " (dry run)"}...`);
walk(target);
