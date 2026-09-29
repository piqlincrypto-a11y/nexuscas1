/**
 * Local credentials for tests. Never commit real passwords.
 * Resolution order: environment variable -> test/.creds.json -> fallback.
 */
import fs from "node:fs";

let file = {};
try {
  file = JSON.parse(fs.readFileSync(new URL("./.creds.json", import.meta.url), "utf8"));
} catch {}

export const ADMIN_PASS = process.env.ADMIN_PASS || file.adminPass || "";
export const PLAYER_PASS = process.env.PLAYER_PASS || file.playerPass || "secret12345";

if (!ADMIN_PASS) {
  console.warn("[creds] admin password not set: export ADMIN_PASS or create test/.creds.json ({\"adminPass\": \"...\"})");
}
