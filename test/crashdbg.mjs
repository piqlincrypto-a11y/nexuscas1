import WebSocket from "ws";

const r = await fetch("http://localhost:4000/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "wstester1", password: "secret12345" }),
});
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
const ws = new WebSocket("ws://localhost:4000/ws", { headers: { cookie } });
let last = "";
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t !== "crash") return;
  const s = m.state;
  const key = `${s.round}:${s.phase}`;
  if (key !== last) {
    last = key;
    console.log(new Date().toISOString().slice(11, 23), `round=${s.round} phase=${s.phase} mult=${s.mult} crashAt=${s.crashAt} players=${s.players.length} deadlineIn=${s.deadline - Date.now()}ms`);
  }
});
ws.on("open", () => ws.send(JSON.stringify({ t: "sub", room: "crash" })));
setTimeout(() => process.exit(0), 45000);
