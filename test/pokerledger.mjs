import crypto from "node:crypto";
import { ADMIN_PASS } from "./creds.mjs";

const BASE = "http://localhost:4000";
const r = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: ADMIN_PASS }),
});
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
const h = { cookie };

const bets = await (await fetch(`${BASE}/api/admin/bets?game=poker&limit=50`, { headers: h })).json();
console.log("poker bets:", JSON.stringify(bets, null, 1).slice(0, 2500));

const rounds = await (await fetch(`${BASE}/api/admin/rounds?game=poker`, { headers: h })).json();
console.log("\npoker rounds:", JSON.stringify(rounds).slice(0, 1200));

const ov = await (await fetch(`${BASE}/api/admin/overview`, { headers: h })).json();
console.log("\noverview:", JSON.stringify(ov).slice(0, 1200));

void crypto;
