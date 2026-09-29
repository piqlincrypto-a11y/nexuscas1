// Static sanity check for INSERT statements:
//   1) number of column names == number of VALUES slots
//   2) number of `?` placeholders in the statement == number of .run(...) arguments
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "C:/fsociety/nexuscas/1/server";
let problems = 0;

function splitTop(s) {
  const out = [];
  let depth = 0,
    cur = "",
    q = false;
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (!q) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function placeholders(expr) {
  let q = false,
    n = 0;
  for (const ch of expr) {
    if (ch === "'") q = !q;
    else if (ch === "?" && !q) n++;
  }
  return n;
}

for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const src = readFileSync(join(dir, f), "utf8");
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    const cols = splitTop(m[2]).length;
    const line = src.slice(0, m.index).split("\n").length;

    // scan the balanced VALUES( ... )
    let i = re.lastIndex,
      depth = 1,
      q = false;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "'") q = !q;
      if (!q) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      i++;
    }
    const vals = splitTop(src.slice(re.lastIndex, i - 1));
    if (vals.length !== cols) {
      problems++;
      console.log(`MISMATCH ${f}:${line} table=${table} columns=${cols} values=${vals.length}`);
    }

    // statement runs until the .run(...) call
    const after = src.slice(i, i + 500);
    const rm = after.match(/\.run\(/);
    if (rm) {
      const stmtEnd = i + rm.index;
      const ph = placeholders(src.slice(m.index, stmtEnd));
      let j = i + rm.index + rm[0].length,
        d = 1,
        qq = false;
      const argStart = j;
      while (j < src.length && d > 0) {
        const ch = src[j];
        if (ch === "'") qq = !qq;
        if (!qq) {
          if (ch === "(") d++;
          else if (ch === ")") d--;
        }
        j++;
      }
      const args = splitTop(src.slice(argStart, j - 1)).length;
      if (ph !== args) {
        problems++;
        console.log(`PARAMS ${f}:${line} table=${table} placeholders=${ph} runArgs=${args}`);
      }
    }
  }
}
console.log(problems ? `\n${problems} problem(s) found` : "all INSERT statements look consistent");
