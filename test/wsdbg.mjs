import WebSocket from "ws";
import { ADMIN_PASS } from "./creds.mjs";

const BASE = "http://localhost:4000";
const r = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: ADMIN_PASS }),
});
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
console.log("cookie:", cookie.slice(0, 30) + "...");

const ws = new WebSocket("ws://localhost:4000/ws", { headers: { cookie } });
ws.on("open", () => console.log("[open]"));
ws.on("unexpected-response", (_q, res) => console.log("[unexpected]", res.statusCode));
ws.on("error", (e) => console.log("[error]", e.message));
ws.on("close", (c, reason) => console.log("[close]", c, reason.toString()));
ws.on("message", (raw) => console.log("<-", raw.toString().slice(0, 200)));

await new Promise((res) => setTimeout(res, 1500));
console.log("readyState:", ws.readyState, "-> sending sub");
ws.send(JSON.stringify({ t: "sub", room: "crash" }));
await new Promise((res) => setTimeout(res, 1500));
console.log("readyState:", ws.readyState, "-> sending crash:join");
ws.send(JSON.stringify({ t: "crash:join", stake: 100 }));
await new Promise((res) => setTimeout(res, 3000));
ws.close();
process.exit(0);
