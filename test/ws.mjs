/**
 * WebSocket integration test: crash, multiplayer roulette (shared pool), poker.
 * Run:  node test/ws.mjs   (server must be running on :4000)
 */
import WebSocket from "ws";
import { ADMIN_PASS } from "./creds.mjs";

const BASE = "http://localhost:4000";
const PASS = [];
const FAIL = [];
const ok = (cond, label) => (cond ? PASS : FAIL).push(label) !== undefined && (cond ? console.log("  PASS", label) : console.log("  FAIL", label));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = "GET", body, cookie } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}

async function ensureUser(username, password, adminCookie) {
  let r = await api("/api/auth/register", {
    method: "POST",
    body: { username, password, email: `${username}@nexus.test`, lang: "en" },
  });
  if (r.status !== 200) r = await api("/api/auth/login", { method: "POST", body: { username, password } });
  if (r.status !== 200) throw new Error(`auth ${username}: ${JSON.stringify(r.data)}`);
  const id = r.data.user.id;
  await api(`/api/admin/players/${id}`, { method: "POST", cookie: adminCookie, body: { adjust: 500000, note: "ws test bankroll" } });
  return { ...r, id, username };
}

/* ------------------------------- ws client ------------------------------- */

function makeClient(cookie) {
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws`, { headers: { cookie } });
  const msgs = [];
  const waiters = [];
  const listeners = [];
  const listenerErrors = [];
  const acted = new Set();

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    msgs.push(m);
    if (msgs.length > 500) msgs.shift();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.tm);
        w.res(m);
      }
    }
    for (const fn of [...listeners]) {
      try {
        fn(m);
      } catch (e) {
        listenerErrors.push(e.message);
        console.log("  listener error:", e.message);
      }
    }
  });

  const open = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
    ws.once("unexpected-response", (_req, r) => rej(new Error(`upgrade ${r.statusCode}`)));
    setTimeout(() => rej(new Error("connect timeout")), 8000);
  });

  return {
    ws,
    msgs,
    acted,
    open,
    send: (o) => ws.send(JSON.stringify(o)),
    onMsg: (fn) => listeners.push(fn),
    wait(pred, ms = 40000, label = "message") {
      const hit = msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((res, rej) => {
        const w = { pred, res };
        w.tm = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          const tail = msgs.slice(-6).map((m) => m.t).join(",");
          rej(new Error(`timeout waiting for ${label} (recent: ${tail})`));
        }, ms);
        waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
}

/* --------------------------------- tests --------------------------------- */

async function testCrash(a) {
  console.log("\n[crash]");
  a.send({ t: "sub", room: "crash" });
  const betting = await a.wait(
    (m) => m.t === "crash" && m.state?.phase === "betting" && m.state.deadline - Date.now() > 5000,
    40000,
    "fresh crash betting phase"
  );
  const round = betting.state.round;
  ok(!!betting.state.seedHash, "crash round exposes seed hash (provably fair)");
  a.send({ t: "crash:join", stake: 100 });
  const joinResp = await a.wait((m) => m.t === "crash:joined" || m.t === "err", 8000, "crash:joined");
  const joined = joinResp.t === "crash:joined";
  ok(joined, `player joined the crash round${joined ? "" : ` (${joinResp.error})`}`);

  const settled = await a.wait(
    (m) => m.t === "crash" && m.state?.phase === "result" && m.state.round === round,
    60000,
    "crash result"
  );
  ok(settled.state.crashAt >= 1, `crash point computed: ${settled.state.crashAt}x`);
  const listed = settled.state.players.some((p) => p.stake === 100);
  if (!listed) console.log("  debug players:", JSON.stringify(settled.state.players));
  ok(listed, "player listed in the round");
  ok(settled.state.history.length > 0 || settled.state.crashAt > 0, "round history available");
}

async function testMpRoulette(a, b, ids) {
  console.log("\n[mproulette]");
  a.send({ t: "mp:create", game: "mproulette", opts: { max: 5 } });
  const joinedA = await a.wait((m) => m.t === "mp:joined" && m.game === "mproulette", 8000, "A room created");
  const roomId = joinedA.roomId;
  ok(!!roomId, `room created: ${roomId}`);

  b.send({ t: "mp:join", game: "mproulette", roomId });
  await b.wait((m) => m.t === "mp:joined" && m.game === "mproulette", 8000, "B joined room");

  a.send({ t: "sub", room: `mp:mproulette:${roomId}` });
  b.send({ t: "sub", room: `mp:mproulette:${roomId}` });

  a.send({ t: "mp:bet", game: "mproulette", roomId, amount: 200, type: "red" });
  b.send({ t: "mp:bet", game: "mproulette", roomId, amount: 200, type: "black" });
  const betA = await a.wait((m) => m.t === "mp:beted" || m.t === "err", 8000, "A bet accepted");
  const betB = await b.wait((m) => m.t === "mp:beted" || m.t === "err", 8000, "B bet accepted");
  ok(betA.t === "mp:beted", "A bet accepted into shared pool");
  if (betB.t !== "mp:beted") console.log("  debug B response:", JSON.stringify(betB));
  ok(betB.t === "mp:beted", "B bet accepted into shared pool");

  const settled = await a.wait(
    (m) => m.t === "mp:state" && m.game === "mproulette" && m.room?.phase === "settled",
    60000,
    "mproulette settled"
  );
  ok(typeof settled.room.result?.number === "number", `wheel result: ${settled.room.result.number} (${settled.room.result.color})`);
  const payouts = settled.room.players.map((p) => ({ u: p.username, payout: p.payout }));
  ok(payouts.every((p) => p.payout !== null && p.payout !== undefined), `both players settled: ${JSON.stringify(payouts)}`);
  ok(settled.room.rake >= 0, `house cut from losing half: ${settled.room.rake}`);
}

async function testPoker(a, b, ids) {
  console.log("\n[poker]");
  a.send({ t: "mp:create", game: "poker", opts: { buyIn: 20000 } });
  const joined = await a.wait((m) => m.t === "mp:joined" && m.game === "poker", 8000, "poker room created");
  const roomId = joined.roomId;
  ok(!!roomId, `poker room created: ${roomId}`);

  b.send({ t: "mp:join", game: "poker", roomId });
  await b.wait((m) => m.t === "mp:joined" && m.game === "poker", 8000, "B seated");

  a.send({ t: "sub", room: `mp:poker:${roomId}` });
  b.send({ t: "sub", room: `mp:poker:${roomId}` });

  // auto-play: both players call/check so the hand runs all the way to a showdown
  const auto = (c, mode) =>
    c.onMsg((m) => {
      if (m.t !== "mp:state" || m.game !== "poker") return;
      const r = m.room;
      if (r.phase !== "preflop" && r.phase !== "flop" && r.phase !== "turn" && r.phase !== "river") return;
      if (r.toAct == null) return;
      const myId = ids[c === a ? "A" : "B"];
      if (r.toAct !== myId) return; // only act when it's our turn
      const me = r.players.find((p) => p.userId === myId);
      if (!me || !me.inHand || me.folded) return;
      const key = `${r.handNo}:${r.toAct}:${r.phase}:${r.currentBet}`;
      if (c.acted.has(key)) return;
      c.acted.add(key);
      const toCall = r.currentBet - me.roundCommitted;
      const action = mode === "fold" ? "fold" : toCall > 0 ? "call" : "check";
      c.send({ t: "poker:action", roomId: r.id, action });
    });
  auto(a, "play");
  auto(b, "play");

  const dealt = await a.wait((m) => m.t === "mp:state" && m.game === "poker" && m.room?.phase === "preflop", 30000, "poker preflop");
  const myCards = dealt.room.players.find((p) => p.userId === ids.A)?.cards;
  const oppCards = dealt.room.players.find((p) => p.userId === ids.B)?.cards;
  ok(Array.isArray(myCards) && myCards.length === 2, "A receives 2 hole cards");
  ok(oppCards === null, "B hole cards hidden from A (privacy)");
  ok(typeof dealt.room.seedHash === "string", "hand seed hash published before reveal");

  const settled = await a.wait(
    (m) => m.t === "mp:state" && m.game === "poker" && m.room?.phase === "settled",
    60000,
    "hand settled"
  );
  ok(settled.room.history.length > 0, `hand recorded: ${JSON.stringify(settled.room.history[0])}`);
  const winner = settled.room.history[0]?.winners?.[0];
  ok(!!winner, `winner: ${winner}`);
  ok(settled.room.revealed === true, "hole cards revealed at showdown");
  const cardsOk = settled.room.players.every((p) => Array.isArray(p.cards) && p.cards.length === 2);
  ok(cardsOk, "both players' cards visible after showdown");
  ok(settled.room.pot > 0, `final pot exposed: ${settled.room.pot}`);
  const payouts = settled.room.players.reduce((s, p) => s + (p.payout || 0), 0);
  const refunds = settled.room.players.reduce((s, p) => s + (p.refund || 0), 0);
  const rake = settled.room.history[0]?.rake || 0;
  ok(
    payouts + refunds + rake === settled.room.pot,
    `pot reconciles: payouts ${payouts} + refunds ${refunds} + rake ${rake} = ${settled.room.pot}`
  );
}

async function main() {
  const adm = await api("/api/auth/login", { method: "POST", body: { username: "admin", password: ADMIN_PASS } });
  if (adm.status !== 200) throw new Error("admin login failed");
  const adminCookie = adm.cookie;

  const A = await ensureUser("wstester1", "secret12345", adminCookie);
  const B = await ensureUser("wstester2", "secret12345", adminCookie);
  const ids = { A: A.id, B: B.id };
  console.log(`players: A=${A.id} B=${B.id}`);

  const a = makeClient(A.cookie);
  const b = makeClient(B.cookie);
  await Promise.all([a.open, b.open]);
  await a.wait((m) => m.t === "welcome", 5000, "welcome A");
  await b.wait((m) => m.t === "welcome", 5000, "welcome B");
  ok(true, "both sockets authenticated via session cookie");

  await testCrash(a);
  await testMpRoulette(a, b, ids);
  await testPoker(a, b, ids);

  const errs = [...a.msgs, ...b.msgs].filter((m) => m.t === "err");
  ok(errs.length === 0, `no protocol errors (${errs.map((e) => e.error).join(", ") || "clean"})`);

  a.close();
  b.close();

  console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
  if (FAIL.length) {
    console.log("failed:", FAIL.join(" | "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\nTEST ERROR:", e.message);
  process.exit(1);
});
