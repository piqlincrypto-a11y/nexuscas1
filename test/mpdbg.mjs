import WebSocket from "ws";

const BASE = "http://localhost:4000";
async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  });
  if (!r.ok) throw new Error(u + " " + (await r.text()));
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
function mk(cookie) {
  const ws = new WebSocket("ws://localhost:4000/ws", { headers: { cookie } });
  const log = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "crash") return;
    log.push(m);
    console.log("  <-", JSON.stringify(m).slice(0, 220));
  });
  return { ws, log, send: (o) => { console.log("  ->", JSON.stringify(o)); ws.send(JSON.stringify(o)); } };
}

const ca = await login("wstester1", "secret12345");
const cb = await login("wstester2", "secret12345");
const a = mk(ca);
const b = mk(cb);
await new Promise((r) => setTimeout(r, 1200));

a.send({ t: "mp:create", game: "mproulette", opts: { max: 5 } });
await new Promise((r) => setTimeout(r, 700));
const joined = a.log.find((m) => m.t === "mp:joined" && m.game === "mproulette");
console.log("room:", joined?.roomId);
b.send({ t: "mp:join", game: "mproulette", roomId: joined.roomId });
await new Promise((r) => setTimeout(r, 700));

a.send({ t: "sub", room: `mp:mproulette:${joined.roomId}` });
b.send({ t: "sub", room: `mp:mproulette:${joined.roomId}` });
await new Promise((r) => setTimeout(r, 500));

a.send({ t: "mp:bet", game: "mproulette", roomId: joined.roomId, amount: 200, type: "red" });
await new Promise((r) => setTimeout(r, 500));
b.send({ t: "mp:bet", game: "mproulette", roomId: joined.roomId, amount: 200, type: "black" });
await new Promise((r) => setTimeout(r, 45000));
console.log("settle messages:", b.log.filter((m) => m.t === "mp:state" && m.room?.phase === "settled").length);
process.exit(0);
