/**
 * Checks that every t("key") / useErr("key") used by the React client exists
 * in the i18n dictionary, and reports unused keys.
 * Run:  node test/i18n-keys.mjs
 */
import fs from "node:fs";
import path from "node:path";

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(f)) out.push(p);
  }
  return out;
}

const files = walk("client/src");
const used = new Map(); // key -> first file
for (const f of files) {
  const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) if (!used.has(m[1])) used.set(m[1], f);
  for (const m of src.matchAll(/\buseErr\(\s*"([^"]+)"/g)) if (!used.has(m[1])) used.set(m[1], f);
}

const dictSrc = fs.readFileSync("client/src/lib/i18n.jsx", "utf8");
// keys defined per locale block: find `const en = { ... }` and `const ru = { ... }`
function keysOf(name) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = dictSrc.match(re);
  if (!m) return null;
  const keys = new Set();
  for (const km of m[1].matchAll(/^\s*"?([\w:.-]+)"?\s*:/gm)) keys.add(km[1]);
  return keys;
}
const en = keysOf("en");
const ru = keysOf("ru");
if (!en || !ru) {
  console.error("could not parse en/ru dictionaries from i18n.jsx");
  process.exit(1);
}

const missingEn = [...used.keys()].filter((k) => !en.has(k));
const missingRu = [...used.keys()].filter((k) => !ru.has(k));
const onlyEn = [...en].filter((k) => !ru.has(k));
const onlyRu = [...ru].filter((k) => !en.has(k));

console.log(`t()/useErr() keys used: ${used.size}`);
console.log(`en keys: ${en.size}, ru keys: ${ru.size}`);
let bad = 0;
if (missingEn.length) { bad++; console.log("MISSING in en:", missingEn.map((k) => `${k} (${used.get(k)})`)); }
if (missingRu.length) { bad++; console.log("MISSING in ru:", missingRu.map((k) => `${k} (${used.get(k)})`)); }
if (onlyEn.length) { console.log("en-only (no ru):", onlyEn); }
if (onlyRu.length) { console.log("ru-only (no en):", onlyRu); }

// hardcoded English UI leftovers in JSX (rough heuristic): string literals in JSX text nodes
const hardcoded = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/>[^<>{}\n]*\b([A-Z][a-z]{3,}\s+[a-z]{2,})[^<>{}\n]*</g)) hardcoded.push(`${f}: ${m[1]}`);
}
if (hardcoded.length) console.log("possible hardcoded JSX text:", hardcoded.slice(0, 20));

console.log(bad ? "FAIL" : "OK: all i18n keys present");
process.exit(bad ? 1 : 0);
