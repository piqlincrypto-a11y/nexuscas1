import { WebSocketServer } from "ws";
import { db, getUser, now, getSetting } from "./db.js";
import { verify, hmacFloat, seedHash, randHex, rateLimit } from "./util.js";
import { openBet, closeBet, gameConfig, hooks } from "./settle.js";
import { WHEEL_ORDER, isRed } from "./games.js";
import {
  pokerCreate,
  pokerJoin,
  pokerLeave,
  pokerAction as pokerDoAction,
  pokerPublic,
  pokerTick,
  bindRooms,
} from "./poker.js";
import { onWin } from "./feed.js";

export const MAX_PLAYERS = 5;

/* ------------------------------- connections -------------------------------- */

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // ws -> {user, rooms:Set}

export function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function sendToUser(userId, obj) {
  for (const [ws, ctx] of clients) if (ctx.user.id === userId) send(ws, obj);
}
export function refreshUser(userId) {
  const u = getUser(userId);
  if (u) sendToUser(userId, { t: "balance", balance: u.balance });
}
export function broadcast(room, obj) {
  const data = JSON.stringify(obj);
  for (const [ws, ctx] of clients) if (ctx.rooms.has(room) && ws.readyState === 1) ws.send(data);
}
export function broadcastAll(obj) {
  const data = JSON.stringify(obj);
  for (const [ws] of clients) if (ws.readyState === 1) ws.send(data);
}
function subscribers(room) {
  const out = [];
  for (const [ws, ctx] of clients) if (ctx.rooms.has(room)) out.push(ws);
  return out;
}

export function attachWs(server) {
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws") return socket.destroy();
    const m = String(req.headers.cookie || "").match(/(?:^|;\s*)nexus_token=([^;]+)/);
    const payload = verify(m?.[1]);
    const user = payload?.uid ? getUser(payload.uid) : null;
    if (!user || user.status === "banned" || user.self_exclusion_until > now()) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.set(ws, { user, rooms: new Set() });
      // ws does not emit 'connection' when a callback is passed to handleUpgrade,
      // so we must do it ourselves or no message handlers get attached
      wss.emit("connection", ws, req);
      send(ws, {
        t: "welcome",
        user: { id: user.id, username: user.username, balance: user.balance, role: user.role },
      });
      send(ws, { t: "crash", state: crashState() });
      send(ws, { t: "mp:list", game: "mproulette", rooms: roomList("mproulette") });
      send(ws, { t: "mp:list", game: "poker", rooms: roomList("poker") });
      send(ws, { t: "feed", wins: recentWins() });
    });
  });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const ctx = clients.get(ws);
      if (!ctx) return;
      try {
        handle(ws, ctx, msg);
      } catch (e) {
        send(ws, { t: "err", error: e.message || "error" });
      }
    });
    ws.on("close", () => {
      const ctx = clients.get(ws);
      clients.delete(ws);
      if (ctx) {
        for (const room of [...ctx.rooms]) if (room.startsWith("mp:")) leaveRoom(ctx, room);
      }
    });
  });

  hooks.onSettle = (bet) => {
    if (bet.payout > bet.stake) onWin(bet);
    refreshUser(bet.userId);
  };

  bindRooms(roomRegistry);
  setInterval(tick, 100);
}

function recentWins() {
  return db
    .prepare(
      `SELECT b.id, b.game, b.stake, b.payout, b.profit, b.created_at, u.username
       FROM bets b JOIN users u ON u.id=b.user_id
       WHERE b.closed=1 AND b.payout > b.stake ORDER BY b.id DESC LIMIT 20`
    )
    .all()
    .map((r) => ({ id: r.id, game: r.game, stake: r.stake, payout: r.payout, profit: r.profit, username: r.username, createdAt: r.created_at }));
}

/* --------------------------------- rooms ------------------------------------ */

const rooms = new Map(); // "game:id" -> room

const roomRegistry = {
  get: (key) => rooms.get(key),
  all: () => [...rooms.values()],
  has: (room) => {
    for (const r of rooms.values()) if (r === room) return true;
    return false;
  },
  delete: (key) => rooms.delete(key),
};

function rid() {
  return Math.random().toString(36).slice(2, 8);
}
function getRoom(game, id) {
  const r = rooms.get(`${game}:${id}`);
  return r && r.game === game ? r : null;
}
function roomList(game) {
  return [...rooms.values()]
    .filter((r) => r.game === game && r.phase !== "settled")
    .map((r) => ({
      id: r.id,
      game: r.game,
      owner: r.owner,
      phase: r.phase,
      deadline: r.deadline,
      players: r.players.size,
      max: r.max,
      buyIn: r.buyIn || 0,
    }));
}
function broadcastLists(game) {
  broadcastAll({ t: "mp:list", game, rooms: roomList(game) });
}

function publicRoom(r, viewerId) {
  if (r.game === "poker") return pokerPublic(r, viewerId);
  return {
    id: r.id,
    game: r.game,
    owner: r.owner,
    phase: r.phase,
    deadline: r.deadline,
    max: r.max,
    result: r.result,
    rake: r.rake,
    history: r.history || [],
    minBet: Number(getSetting("min_bet")),
    maxBet: Number(getSetting("max_bet")),
    players: [...r.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      bet: p.bet ? { type: p.bet.type, nums: p.bet.nums, amount: p.bet.amount, mul: p.bet.mul } : null,
      payout: p.payout ?? null,
      ready: !!p.bet,
    })),
  };
}
export function broadcastRoom(r) {
  if (r.game === "poker") {
    const room = `mp:poker:${r.id}`;
    for (const ws of subscribers(room)) {
      const ctx = clients.get(ws);
      send(ws, { t: "mp:state", game: "poker", room: pokerPublic(r, ctx?.user.id) });
    }
    return;
  }
  broadcast(`mp:${r.game}:${r.id}`, { t: "mp:state", game: r.game, room: publicRoom(r) });
}

/* ------------------------------- message router ----------------------------- */

function handle(ws, ctx, msg) {
  switch (msg.t) {
    case "sub": {
      if (typeof msg.room !== "string") return;
      ctx.rooms.add(msg.room);
      if (msg.room === "crash") send(ws, { t: "crash", state: crashState() });
      if (msg.room.startsWith("mp:")) {
        const [, game, id] = msg.room.split(":");
        const r = getRoom(game, id);
        if (r) send(ws, { t: "mp:state", game, room: publicRoom(r, ctx.user.id) });
      }
      break;
    }
    case "unsub":
      ctx.rooms.delete(msg.room);
      break;
    case "crash:join":
      crashJoin(ctx, Number(msg.stake), ws);
      break;
    case "crash:cashout":
      crashCashout(ctx, ws);
      break;
    case "mp:list":
      send(ws, { t: "mp:list", game: String(msg.game), rooms: roomList(String(msg.game)) });
      break;
    case "mp:create":
      createRoom(ctx, String(msg.game), msg.opts || {});
      break;
    case "mp:join":
      joinRoom(ctx, String(msg.game), String(msg.roomId));
      break;
    case "mp:quick":
      quickJoin(ctx, String(msg.game));
      break;
    case "mp:leave":
      leaveRoom(ctx, `mp:${String(msg.game)}:${String(msg.roomId)}`);
      break;
    case "mp:bet":
      roomBet(ctx, String(msg.game), String(msg.roomId), msg);
      break;
    case "poker:sit":
      pokerSit(ctx, String(msg.roomId));
      break;
    case "poker:action":
      pokerDoAction(ctx, String(msg.roomId), msg);
      broadcastRoom(getRoom("poker", String(msg.roomId)));
      break;
    default:
      throw new Error("unknown_message");
  }
}

function createRoom(ctx, game, opts) {
  if (!["mproulette", "poker"].includes(game)) throw new Error("bad_game");
  // release seats the player no longer occupies (socket dropped mid-hand, settled room, ...)
  for (const r of [...rooms.values()]) {
    if (!r.players.has?.(ctx.user.id)) continue;
    const p = r.players.get(ctx.user.id);
    const playing = r.hand && r.phase !== "settled" && p.inHand && !p.folded && !p.pendingLeave;
    if (playing) throw new Error("already_in_room");
    leaveRoom(ctx, `mp:${r.game || game}:${r.id}`);
  }
  const id = rid();
  const room = game === "poker" ? pokerCreate(id, ctx.user, opts) : {
    id,
    game,
    owner: ctx.user.id,
    max: Math.min(MAX_PLAYERS, Math.max(2, Number(opts.max) || MAX_PLAYERS)),
    phase: "betting",
    deadline: now() + 30000,
    players: new Map(),
    result: null,
    rake: 0,
    history: [],
  };
  rooms.set(`${game}:${id}`, room);
  joinRoom(ctx, game, id);
}

function quickJoin(ctx, game) {
  const open = [...rooms.values()].find(
    (r) =>
      r.game === game &&
      r.phase === "betting" &&
      r.players.size < r.max &&
      !r.players.has(ctx.user.id) &&
      r.deadline - now() > 5000
  );
  if (open) return joinRoom(ctx, game, open.id);
  createRoom(ctx, game, {});
}

function joinRoom(ctx, game, id) {
  const r = getRoom(game, id);
  if (!r) throw new Error("room_not_found");
  const user = getUser(ctx.user.id);
  if (!["betting", "waiting", "dealing"].includes(r.phase) && !(game === "poker" && ["waiting", "dealing"].includes(r.phase)))
    throw new Error("round_started");
  if (!r.players.has(user.id)) {
    if (r.players.size >= r.max) throw new Error("room_full");
    if (game === "poker") pokerJoin(r, user);
    else r.players.set(user.id, { userId: user.id, username: user.username });
  }
  const roomKey = `mp:${game}:${id}`;
  ctx.rooms.add(roomKey);
  send([...clients].find(([ws]) => ws === ctx.ws)?.[0], { t: "mp:joined", game, roomId: id });
  for (const ws of subscribers(roomKey)) {
    const c = clients.get(ws);
    send(ws, { t: "mp:joined", game, roomId: id });
  }
  broadcastRoom(r);
  broadcastLists(game);
}

function leaveRoom(ctx, roomKey) {
  const [, game, id] = roomKey.split(":");
  const r = getRoom(game, id);
  ctx.rooms.delete(roomKey);
  if (!r) return;
  if (r.players.has?.(ctx.user.id)) {
    if (game === "poker") {
      pokerLeave(r, ctx.user.id);
      if (!r.players.size) rooms.delete(roomKey);
    } else {
      const p = r.players.get(ctx.user.id);
      if (p?.betId) refundBet(ctx.user.id, p.betId);
      r.players.delete(ctx.user.id);
      if (!r.players.size) rooms.delete(roomKey);
    }
  }
  broadcastRoom(r);
  broadcastLists(game);
}

function pokerSit(ctx, roomId) {
  const r = getRoom("poker", roomId);
  if (!r) throw new Error("room_not_found");
  if (!r.players.has(ctx.user.id)) {
    if (r.players.size >= r.max) throw new Error("room_full");
    pokerJoin(r, getUser(ctx.user.id));
  }
  ctx.rooms.add(`mp:poker:${roomId}`);
  broadcastRoom(r);
  broadcastLists("poker");
}

function refundBet(userId, betId) {
  try {
    const bet = db.prepare("SELECT * FROM bets WHERE id=?").get(betId);
    if (bet && !bet.closed) closeBet(getUser(userId), betId, { payout: bet.stake, result: { refunded: true } });
  } catch {}
}

/* ------------------------------ CRASH engine -------------------------------- */

const LAMBDA = 11000;
const BETTING_MS = 12000;
const RESULT_MS = 4000;

const crash = {
  phase: "betting",
  round: 0,
  seed: "",
  seedHash: "",
  crashAt: 1,
  startTs: 0,
  deadline: now() + BETTING_MS,
  bets: new Map(),
  history: [],
};

function newCrashRound() {
  crash.round++;
  crash.seed = randHex(32);
  crash.seedHash = seedHash(crash.seed);
  const edge = gameConfig("crash").edge;
  const r = hmacFloat(crash.seed, "round", crash.round, "crash");
  const raw = (1 - edge) / Math.max(1e-9, 1 - r);
  crash.crashAt = Math.max(1, Math.floor(raw * 100) / 100);
  crash.phase = "betting";
  crash.deadline = now() + BETTING_MS;
  crash.bets = new Map();
}
newCrashRound();

export function crashMult(ts = now()) {
  if (crash.phase === "running") return Math.exp(Math.max(0, ts - crash.startTs) / LAMBDA);
  return crash.phase === "result" ? crash.crashAt : 1;
}

function crashState() {
  return {
    phase: crash.phase,
    round: crash.round,
    mult: Number(crashMult().toFixed(3)),
    crashAt: crash.phase === "betting" ? null : crash.crashAt,
    deadline: crash.deadline,
    startTs: crash.startTs,
    seedHash: crash.seedHash,
    players: [...crash.bets.values()].map((b) => ({
      username: b.username,
      stake: b.stake,
      cashedAt: b.cashedAt,
      payout: b.payout,
      profit: b.cashedAt ? b.payout - b.stake : null,
    })),
    history: crash.history.slice(0, 12),
    minBet: Number(getSetting("min_bet")),
    maxBet: Number(getSetting("max_bet")),
  };
}
function crashBroadcast() {
  broadcast("crash", { t: "crash", state: crashState() });
}

function crashJoin(ctx, stake, ws) {
  if (crash.phase !== "betting") throw new Error("round_closed");
  if (crash.bets.has(ctx.user.id)) throw new Error("already_joined");
  if (!rateLimit(`crash:${ctx.user.id}`, 30, 60000)) throw new Error("too_many");
  const cfg = gameConfig("crash");
  const st = Math.round(stake);
  if (!(st >= cfg.minBet && st <= cfg.maxBet)) throw new Error("min_bet");
  const user = getUser(ctx.user.id);
  const { betId, boosted } = openBet(user, {
    game: "crash",
    stake: st,
    pf: { serverSeedHash: crash.seedHash, round: crash.round, algo: "HMAC-SHA256" },
  });
  crash.bets.set(user.id, { betId, stake: st, username: user.username, userId: user.id, cashedAt: null, payout: 0, boosted });
  send(ws, { t: "crash:joined", stake: st, balance: getUser(user.id).balance });
  refreshUser(user.id);
  crashBroadcast();
}

function crashCashout(ctx, ws) {
  if (crash.phase !== "running") throw new Error("not_running");
  const b = crash.bets.get(ctx.user.id);
  if (!b || b.cashedAt) throw new Error("no_open_bet");
  const m = crashMult();
  const payout = Math.floor(b.stake * m);
  const out = closeBet(getUser(ctx.user.id), b.betId, {
    payout,
    result: { mult: Number(m.toFixed(3)), cashed: true },
  });
  b.cashedAt = Number(m.toFixed(3));
  b.payout = payout;
  send(ws, { t: "crash:cashout", mult: b.cashedAt, payout, profit: out.profit, balance: out.balance });
  crashBroadcast();
}

function crashSettle() {
  for (const b of crash.bets.values()) {
    if (b.cashedAt) continue;
    try {
      closeBet(getUser(b.userId), b.betId, { payout: 0, result: { mult: crash.crashAt, cashed: false } });
    } catch {}
  }
  crash.history.unshift(crash.crashAt);
  crash.history = crash.history.slice(0, 30);
  db.prepare(
    `INSERT INTO rounds(game,status,phase,seed_hash,seed,result,meta,created_at,ended_at)
     VALUES('crash','settled','done',?,?,?,?,?,?)`
  ).run(
    crash.seedHash,
    crash.seed,
    JSON.stringify({ crashAt: crash.crashAt }),
    JSON.stringify({ bets: crash.bets.size, round: crash.round }),
    now(),
    now()
  );
  crash.phase = "result";
  crash.deadline = now() + RESULT_MS;
}

/* --------------------------- multiplayer roulette --------------------------- */

const ROULETTE_PAYOUT = { straight: 35, split: 17, street: 11, corner: 8, six: 5, dozen: 2, column: 2, even: 2, red: 2, black: 2, low: 2, high: 2, odd: 2 };

function numbersFor(type, rawNums) {
  const s = new Set();
  const push = (from, to) => {
    for (let i = from; i <= to; i++) s.add(i);
  };
  if (type === "red") {
    for (let i = 1; i <= 36; i++) if (isRed(i)) s.add(i);
  } else if (type === "black") {
    for (let i = 1; i <= 36; i++) if (!isRed(i)) s.add(i);
  } else if (type === "low") {
    push(1, 17);
  } else if (type === "high") {
    push(19, 36);
  } else if (type === "even") {
    for (let i = 2; i <= 36; i += 2) s.add(i);
  } else if (type === "odd") {
    for (let i = 1; i <= 35; i += 2) s.add(i);
  } else {
    for (const n of rawNums || []) {
      const v = Number(n);
      if (Number.isInteger(v) && v >= 0 && v <= 36) s.add(v);
    }
  }
  return [...s];
}

function roomBet(ctx, game, roomId, msg) {
  const r = getRoom(game, roomId);
  if (!r) throw new Error("room_not_found");
  if (game !== "mproulette") throw new Error("bad_game");
  if (r.phase !== "betting") throw new Error("round_started");
  const user = getUser(ctx.user.id);
  const p = r.players.get(user.id);
  if (!p) throw new Error("not_in_room");
  const amount = Math.round(Number(msg.amount));
  const cfg = gameConfig("mproulette");
  if (!(amount >= cfg.minBet && amount <= cfg.maxBet)) throw new Error("min_bet");
  if (user.balance < amount) throw new Error("insufficient_balance");
  const type = String(msg.type);
  if (!ROULETTE_PAYOUT[type]) throw new Error("bad_bet");
  const nums = numbersFor(type, msg.numbers);
  if (!nums.length) throw new Error("bad_bet");
  if (p.betId) refundBet(user.id, p.betId);
  const { betId } = openBet(user, { game: "mproulette", stake: amount, pf: { room: r.id } });
  p.betId = betId;
  p.bet = { type, nums, amount, mul: ROULETTE_PAYOUT[type] };
  p.payout = null;
  r.deadline = Math.max(r.deadline, now() + 8000);
  sendToUser(user.id, { t: "mp:beted", roomId: r.id, bet: { type, amount } });
  broadcastRoom(r);
}

function spinRoulette(r) {
  const bettors = [...r.players.values()].filter((p) => p.bet);
  if (bettors.length < 2) {
    for (const p of bettors) refundBet(p.userId, p.betId);
    rooms.delete(`mproulette:${r.id}`);
    broadcastLists("mproulette");
    return;
  }
  const seed = randHex(32);
  const number = Math.floor(hmacFloat(seed, "wheel", r.history.length, "mproulette") * 37) % 37;
  const position = WHEEL_ORDER.indexOf(number);
  const total = bettors.reduce((a, p) => a + p.bet.amount, 0);
  const winners = bettors.filter((p) => p.bet.nums.includes(number));
  const losersL = bettors.filter((p) => !p.bet.nums.includes(number)).reduce((a, p) => a + p.bet.amount, 0);
  const adminPct = gameConfig("mproulette").adminPct;
  const rake = Math.floor(losersL * adminPct);
  const pool = total - rake;
  const weights = winners.map((p) => p.bet.amount * p.bet.mul);
  const wsum = weights.reduce((a, b) => a + b, 0);

  r.phase = "settled";
  r.result = { number, position: position < 0 ? 0 : position, color: number === 0 ? "green" : isRed(number) ? "red" : "black" };
  r.rake = rake;

  bettors.forEach((p) => {
    const w = p.bet.amount * p.bet.mul;
    const payout = winners.includes(p) && wsum > 0 ? Math.floor((pool * w) / wsum) : 0;
    p.payout = payout;
    try {
      closeBet(getUser(p.userId), p.betId, {
        payout,
        result: { ...r.result, bet: { type: p.bet.type, amount: p.bet.amount }, payout, room: r.id },
      });
    } catch (e) {
      console.error("mp settle", e.message);
    }
  });

  db.prepare(
    `INSERT INTO rounds(game,status,phase,seed,result,meta,pot,admin_cut,created_at,ended_at)
     VALUES('mproulette','settled','done',?,?,?,?,?,?,?)`
  ).run(seed, JSON.stringify(r.result), JSON.stringify({ players: bettors.length, rake }), total, rake, now(), now());

  r.history.unshift(r.result);
  r.history = r.history.slice(0, 20);
  broadcastRoom(r);
  broadcastLists("mproulette");
  setTimeout(() => {
    if (rooms.get(`mproulette:${r.id}`) === r) {
      rooms.delete(`mproulette:${r.id}`);
      broadcastLists("mproulette");
    }
  }, 10000);
}

/* --------------------------------- scheduler -------------------------------- */

let lastMult = 1;
function tick() {
  const t = now();
  try {
    if (crash.phase === "betting" && t >= crash.deadline) {
      crash.phase = "running";
      crash.startTs = t;
      crashBroadcast();
    } else if (crash.phase === "running") {
      const m = crashMult(t);
      if (m >= crash.crashAt) {
        crashSettle();
        crashBroadcast();
      } else if (Math.abs(m - lastMult) >= 0.02) {
        lastMult = m;
        crashBroadcast();
      }
    } else if (crash.phase === "result" && t >= crash.deadline) {
      newCrashRound();
      crashBroadcast();
    }

    for (const r of [...rooms.values()]) {
      if (r.game === "mproulette" && r.phase === "betting" && t >= r.deadline) spinRoulette(r);
    }
    pokerTick(t);
  } catch (e) {
    console.error("tick error", e);
  }
}
