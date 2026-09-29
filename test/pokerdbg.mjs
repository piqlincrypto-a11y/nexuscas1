import WebSocket from "ws";

const BASE = "http://localhost:4000";
const myId = { A: 3, B: 4 };

async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  });
  if (!r.ok) throw new Error(u + " " + (await r.text()));
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

function mk(cookie, name, onState) {
  const ws = new WebSocket("ws://localhost:4000/ws", { headers: { cookie } });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "crash" || m.t === "mp:list" || m.t === "feed" || m.t === "mp:state" || m.t === "welcome") {
      if (m.t === "mp:state" && m.game === "poker") onState(name, m.room, ws);
      return;
    }
    console.log(`[${name}]`, JSON.stringify(m));
  });
  return ws;
}

let settledSeen = false;
function onState(name, r, ws) {
  console.log(
    `[${name}] phase=${r.phase} toAct=${r.toAct} cur=${r.currentBet} hand=${r.handNo} pot=${r.pot} board=${JSON.stringify(r.board)}`
  );
  for (const p of r.players)
    console.log(`   - u${p.userId} in=${p.inHand} folded=${p.folded} rc=${p.roundCommitted} act=${p.lastAction} cards=${JSON.stringify(p.cards)}`);
  if (r.phase === "settled") {
    settledSeen = true;
    return;
  }
  if (!["preflop", "flop", "turn", "river"].includes(r.phase)) return;
  if (r.toAct == null) return;
  const me = r.players.find((p) => p.userId === myId[name]);
  if (!me || !me.inHand || me.folded) return;
  const key = `${r.handNo}:${r.toAct}:${r.phase}:${r.currentBet}`;
  if (onState[key + name]) return;
  onState[key + name] = true;
  const toCall = r.currentBet - me.roundCommitted;
  const action = name === "B" ? "fold" : toCall > 0 ? "call" : "check";
  console.log(`[${name}] >> ${action}`);
  ws.send(JSON.stringify({ t: "poker:action", roomId: r.id, action }));
}

const a = mk(await login("wstester1", "secret12345"), "A", onState);
const b = mk(await login("wstester2", "secret12345"), "B", onState);
await new Promise((r) => setTimeout(r, 1200));

const roomId = await new Promise((res) => {
  const h = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "mp:joined" && m.game === "poker") {
      a.off("message", h);
      res(m.roomId);
    }
  };
  a.on("message", h);
  a.send(JSON.stringify({ t: "mp:create", game: "poker", opts: { buyIn: 20000 } }));
});
console.log("room:", roomId);
b.send(JSON.stringify({ t: "mp:join", game: "poker", roomId }));

for (let i = 0; i < 30 && !settledSeen; i++) await new Promise((r) => setTimeout(r, 1000));
console.log(settledSeen ? "HAND SETTLED OK" : "HAND DID NOT SETTLE");
process.exit(settledSeen ? 0 : 1);
