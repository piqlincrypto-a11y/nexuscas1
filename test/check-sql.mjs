// Static sanity check: every db.prepare(...) SQL string must have a matching
// number of `?` placeholders and .run(...) arguments (catches off-by-one binds).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "C:/fsociety/nexuscas/1/server";
let problems = 0;
let checked = 0;

function placeholders(sql) {
  let q = null,
    n = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") q = ch;
    else if (ch === "?") n++;
  }
  return n;
}

function splitTopArgs(s) {
  const out = [];
  let depth = 0,
    cur = "",
    q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") q = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const src = readFileSync(join(dir, f), "utf8");
  let idx = 0;
  while ((idx = src.indexOf(".prepare(", idx)) !== -1) {
    const open = idx + ".prepare(".length;
    const quote = src[open];
    if (!"'\"`".includes(quote)) {
      idx = open;
      continue;
    }
    // find matching close quote, honouring escapes and ${...} in template literals
    let i = open + 1,
      sql = "";
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") {
        sql += src[i + 1];
        i++;
        continue;
      }
      if (ch === quote) break;
      if (quote === "`" && ch === "$" && src[i + 1] === "{") {
        let d = 1,
          j = i + 2;
        while (j < src.length && d > 0) {
          if (src[j] === "{") d++;
          else if (src[j] === "}") d--;
          j++;
        }
        sql += "\u0000"; // placeholder for the interpolation, no '?' expected
        i = j - 1;
        continue;
      }
      sql += ch;
    }
    if (src[i] !== quote) {
      idx = open;
      continue;
    }
    // find the matching ')' of .prepare(  ->  the string is the only argument
    const line = src.slice(0, idx).split("\n").length;
    idx = i + 1;
    if (src[idx] !== ")") {
      // multi-arg prepare (unlikely) - skip
      continue;
    }
    const after = src.slice(idx + 1, idx + 400);
    const rm = after.match(/^\s*\.run\(/);
    if (sql.includes("\u0000")) {
      // dynamic SQL (interpolated) - skip, can't count statically
      idx = i + 1;
      continue;
    }
    if (rm) {
      checked++;
      const ph = placeholders(sql);
      const argOpen = idx + 1 + rm[0].length;
      // scan balanced parens of .run(
      let j = argOpen,
        depth = 1,
        q = null;
      for (; j < src.length && depth > 0; j++) {
        const ch = src[j];
        if (q) {
          if (ch === "\\") j++;
          else if (ch === q) q = null;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") q = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      const args = splitTopArgs(src.slice(argOpen, j - 1));
      if (args.length !== ph) {
        problems++;
        console.log(`PARAMS ${f}:${line} placeholders=${ph} runArgs=${args.length}`);
        console.log(`   sql: ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
  }
}
console.log(`\nchecked ${checked} prepared statements: ${problems ? problems + " problem(s)" : "all consistent"}`);
