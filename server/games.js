import crypto from "node:crypto";
import { db, getUser, now, getSetting } from "./db.js";
import { hmacFloat, seedHash, randHex, rateLimit, clientIp } from "./util.js";
import { openBet, closeBet, gameConfig, edgeFor } from "./settle.js";
import { requireAuth } from "./auth.js";

/* ----------------------------- provably fair core ---------------------------- */

export function ensurePf(user) {
  let u = getUser(user.id);
  if (!u.pf_server_seed) {
    const seed = randHex(32);
    db.prepare("UPDATE users SET pf_server_seed = ?, pf_server_hash = ?, pf_client_seed = COALESCE(pf_client_seed, ?) WHERE id = ?")
      .run(seed, seedHash(seed), "nexus-client", u.id);
    u = getUser(u.id);
  }
  return u;
}

/** Opens a provably-fair envelope: increments nonce, exposes derivation functions. */
export function pfEnv(user, tag) {
  const u = ensurePf(user);
  const nonce = u.pf_nonce + 1;
  db.prepare("UPDATE users SET pf_nonce = ? WHERE id = ?").run(nonce, u.id);
  const seed = u.pf_server_seed;
  const client = u.pf_client_seed || "nexus-client";
  const f = (sub = "") => hmacFloat(seed, client, nonce, `${tag}:${sub}`);
  const info = { serverSeedHash: u.pf_server_hash, clientSeed: client, nonce, algo: "HMAC-SHA256" };
  return { f, info, nonce, seed, client };
}

export function pfRoutes(app) {
  app.get("/api/games/pf", requireAuth, (req, res) => {
    const u = ensurePf(req.user);
    res.json({ serverSeedHash: u.pf_server_hash, clientSeed: u.pf_client_seed, nonce: u.pf_nonce });
  });
  app.post("/api/games/pf/client-seed", requireAuth, (req, res) => {
    const seed = String(req.body?.clientSeed || "").slice(0, 64) || "nexus-client";
    db.prepare("UPDATE users SET pf_client_seed = ?, pf_nonce = 0 WHERE id = ?").run(seed, req.user.id);
    res.json({ clientSeed: seed, nonce: 0 });
  });
  app.post("/api/games/pf/rotate", requireAuth, (req, res) => {
    const old = ensurePf(req.user);
    const next = randHex(32);
    db.prepare("UPDATE users SET pf_server_seed = ?, pf_server_hash = ?, pf_nonce = 0 WHERE id = ?")
      .run(next, seedHash(next), req.user.id);
    res.json({ revealed: old.pf_server_seed, serverSeedHash: seedHash(next), nonce: 0 });
  });
}

/* --------------------------------- helpers ---------------------------------- */

const C = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const scalePay = (stake, mul) => Math.max(0, Math.floor(stake * Math.max(0, mul)));

function assertBet(user, stake, cfg) {
  const st = Math.round(Number(stake));
  if (!Number.isFinite(st) || st < cfg.minBet) throw new Error("min_bet");
  if (st > cfg.maxBet) throw new Error("max_bet");
  if (user.balance < st) throw new Error("insufficient_balance");
  return st;
}

function run(user, game, stake, pfInfo, calc) {
  const cfg = gameConfig(game);
  const st = assertBet(user, stake, cfg);
  const { betId, boosted } = openBet(user, { game, stake: st, pf: pfInfo });
  const out = calc(st, edgeFor(user, cfg)) || { payout: 0, result: null };
  const settled = closeBet(user, betId, { payout: out.payout, result: out.result, pf: out.pf });
  return { ...settled, boosted, result: out.result, pf: pfInfo, rtp: out.rtp ?? null };
}

/* ---------------------------------- DICE ------------------------------------ */

function diceRoll(st, cfg, f) {
  const roll = Math.floor(f("dice") * 10000) / 100; // 0.00 - 99.99
  return roll;
}
export function dice(user, { stake, target, dir }) {
  const cfg = gameConfig("dice");
  const t = Number(target);
  if (!(t > 1 && t < 99)) throw new Error("bad_target");
  const direction = dir === "over" ? "over" : "under";
  const env = pfEnv(user, "dice");
  return run(user, "dice", stake, env.info, (st, edge) => {
    const roll = diceRoll(st, cfg, env.f);
    const win = direction === "under" ? roll < t : roll >= t;
    const fair = direction === "under" ? 100 / t : 100 / (100 - t);
    const mul = fair * (1 - edge);
    return {
      payout: win ? scalePay(st, mul) : 0,
      result: { roll, win, target: t, dir: direction, multiplier: Number(mul.toFixed(4)) },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}

/* --------------------------------- LIMBO ------------------------------------ */

export function limbo(user, { stake, target }) {
  const t = Number(target);
  if (!(t >= 1.01 && t <= 100000)) throw new Error("bad_target");
  const env = pfEnv(user, "limbo");
  return run(user, "limbo", stake, env.info, (st, edge) => {
    const r = env.f("limbo");
    const raw = (1 - edge) / Math.max(1e-9, 1 - r);
    const mult = Math.max(1, Math.floor(raw * 100) / 100);
    const win = mult >= t;
    return {
      payout: win ? scalePay(st, t) : 0,
      result: { multiplier: mult, win, target: t },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}

/* --------------------------------- SLOTS ------------------------------------ */

const SYMBOLS = ["cherry", "lemon", "grape", "bell", "bar", "seven", "gem", "wild"];
const REEL_WEIGHTS = [
  [30, 24, 18, 12, 8, 5, 3, 2],
  [32, 25, 17, 11, 8, 4, 2, 1],
  [34, 26, 16, 10, 7, 4, 2, 1],
];
const SLOT_PAYS = { cherry: 3, lemon: 5, grape: 8, bell: 12, bar: 25, seven: 100, gem: 50, wild: 250 };

function buildReel(w) {
  const arr = [];
  SYMBOLS.forEach((s, i) => {
    for (let k = 0; k < w[i]; k++) arr.push(s);
  });
  return arr;
}
const REELS = REEL_WEIGHTS.map(buildReel);
const REEL_P = REEL_WEIGHTS.map((w) => {
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
});

function lineWin(a, b, c) {
  const syms = [a, b, c];
  const nonWild = syms.filter((s) => s !== "wild");
  if (nonWild.length === 0) return { sym: "wild", n: 3 };
  const first = nonWild[0];
  if (!nonWild.every((s) => s === first)) return null;
  return { sym: first, n: 3 };
}
// exact payline RTP of the raw paytable
const SLOT_RTP = (() => {
  let ev = 0;
  for (let i = 0; i < SYMBOLS.length; i++)
    for (let j = 0; j < SYMBOLS.length; j++)
      for (let k = 0; k < SYMBOLS.length; k++) {
        const p = REEL_P[0][i] * REEL_P[1][j] * REEL_P[2][k];
        const w = lineWin(SYMBOLS[i], SYMBOLS[j], SYMBOLS[k]);
        if (w) ev += p * SLOT_PAYS[w.sym];
      }
  return ev;
})();

export function slots(user, { stake }) {
  const env = pfEnv(user, "slots");
  return run(user, "slots", stake, env.info, (st, edge) => {
    const cells = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let reel = 0; reel < 3; reel++) {
        const idx = Math.floor(env.f(`r${reel}x${r}`) * REELS[reel].length);
        row.push(REELS[reel][idx]);
      }
      cells.push(row);
    }
    const line = cells[1]; // center payline
    const w = lineWin(line[0], line[1], line[2]);
    const raw = w ? SLOT_PAYS[w.sym] : 0;
    const norm = raw > 0 ? raw / SLOT_RTP : 0;
    const mul = norm * (1 - edge);
    return {
      payout: scalePay(st, mul),
      result: { cells, line, win: !!w, symbol: w?.sym || null, multiplier: Number(mul.toFixed(3)) },
      rtp: Number((((1 - edge) / SLOT_RTP) * SLOT_RTP * 100).toFixed(2)),
    };
  });
}

/* -------------------------------- ROULETTE ---------------------------------- */

// European wheel order (0-36)
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const isRed = (n) => RED.has(n);

/** bets: [{type:'straight'|'split'|'street'|'corner'|'six'|'dozen'|'column'|'even'|'red'|'black'|'low'|'high', numbers:[..]}] */
const ROULETTE_PAYOUT = { straight: 35, split: 17, street: 11, corner: 8, six: 5, dozen: 2, column: 2, even: 2, odd: 2, red: 2, black: 2, low: 2, high: 2 };
export function roulette(user, { stake, bets }) {
  if (!Array.isArray(bets) || !bets.length || bets.length > 30) throw new Error("bad_bets");
  let total = 0;
  const chips = [];
  for (const b of bets) {
    const amt = Math.round(Number(b.amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("bad_bet");
    total += amt;
    const type = String(b.type);
    if (!ROULETTE_PAYOUT[type]) throw new Error("bad_bet");
    const nums = new Set(
      Array.isArray(b.numbers) ? b.numbers.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 36) : []
    );
    if (type === "red") {
      for (const n of RED) nums.add(n);
    } else if (type === "black") {
      for (const n of range(1, 36)) if (!RED.has(n)) nums.add(n);
    } else if (type === "low") {
      for (const n of range(1, 17)) nums.add(n);
    } else if (type === "high") {
      for (const n of range(19, 36)) nums.add(n);
    } else if (type === "even") {
      for (const n of range(2, 36, 2)) nums.add(n);
    } else if (type === "odd") {
      for (const n of range(1, 35, 2)) nums.add(n);
    }
    if (!nums.size) throw new Error("bad_bet");
    chips.push({ type, nums: [...nums], amount: amt, mul: ROULETTE_PAYOUT[type] });
  }
  if (total !== Math.round(Number(stake))) throw new Error("stake_mismatch");

  const env = pfEnv(user, "roulette");
  return run(user, "roulette", stake, env.info, (st, edge) => {
    const idx = Math.floor(env.f("wheel") * 37) % 37;
    const num = idx;
    let payoutRaw = 0;
    for (const c of chips) if (c.nums.includes(num)) payoutRaw += c.amount * c.mul;
    // winning chips keep the stake back, so add them
    let returned = 0;
    for (const c of chips) if (c.nums.includes(num)) returned += c.amount;
    const payout = scalePay(st, ((payoutRaw + returned) / st) * (1 - edge));
    return {
      payout,
      result: { number: num, color: num === 0 ? "green" : isRed(num) ? "red" : "black", win: payoutRaw + returned > 0 },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}
const range = (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

/* --------------------------------- PLINKO ----------------------------------- */

const PLINKO_RISK = {
  low: [16, 8, 4, 2, 1.2, 1, 0.8, 1, 1.2, 2, 4, 8, 16],
  medium: [30, 12, 6, 3, 1.5, 1, 0.6, 1, 1.5, 3, 6, 12, 30],
  high: [120, 40, 16, 6, 2.4, 1, 0.3, 1, 2.4, 6, 16, 40, 120],
};
const PLINKO_ROWS = 12;
function plinkoRtp(table) {
  const n = PLINKO_ROWS;
  let ev = 0;
  for (let k = 0; k <= n; k++) {
    const p = C(n, k) / Math.pow(2, n);
    ev += p * table[k];
  }
  return ev;
}
export function plinko(user, { stake, risk = "medium" }) {
  const table = PLINKO_RISK[risk] || PLINKO_RISK.medium;
  const env = pfEnv(user, "plinko");
  return run(user, "plinko", stake, env.info, (st, edge) => {
    let rights = 0;
    const path = [];
    for (let i = 0; i < PLINKO_ROWS; i++) {
      const bit = env.f(`p${i}`) < 0.5 ? 0 : 1;
      path.push(bit);
      rights += bit;
    }
    const raw = table[rights];
    const ev = plinkoRtp(table);
    const mul = (raw / ev) * (1 - edge);
    return {
      payout: scalePay(st, mul),
      result: { slot: rights, path, multiplier: Number(mul.toFixed(3)), risk, rows: PLINKO_ROWS },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}

/* ---------------------------------- WHEEL ----------------------------------- */

const WHEEL_SECTORS = [
  { label: "1.1x", mult: 1.1, w: 0.5 },
  { label: "1.5x", mult: 1.5, w: 0.25 },
  { label: "2x", mult: 2, w: 0.13 },
  { label: "3x", mult: 3, w: 0.06 },
  { label: "5x", mult: 5, w: 0.035 },
  { label: "10x", mult: 10, w: 0.015 },
  { label: "50x", mult: 50, w: 0.005 },
  { label: "0x", mult: 0, w: 0.005 },
];
const WHEEL_EV = WHEEL_SECTORS.reduce((a, s) => a + s.w * s.mult, 0);
export function wheel(user, { stake }) {
  const env = pfEnv(user, "wheel");
  return run(user, "wheel", stake, env.info, (st, edge) => {
    const r = env.f("wheel");
    let acc = 0;
    let sector = WHEEL_SECTORS[WHEEL_SECTORS.length - 1];
    for (const s of WHEEL_SECTORS) {
      acc += s.w;
      if (r < acc) {
        sector = s;
        break;
      }
    }
    const mul = (sector.mult / WHEEL_EV) * (1 - edge);
    return {
      payout: scalePay(st, mul),
      result: { sector: sector.label, multiplier: Number(mul.toFixed(3)), win: sector.mult > 0 },
      rtp: Number((((1 - edge) * 100)).toFixed(2)),
    };
  });
}

/* ---------------------------------- KENO ------------------------------------ */

export function keno(user, { stake, picks }) {
  const arr = [...new Set((picks || []).map(Number))];
  if (arr.length < 1 || arr.length > 10 || arr.some((n) => !Number.isInteger(n) || n < 1 || n > 40))
    throw new Error("bad_picks");
  const k = arr.length;
  const drawn = 10;
  const total = C(40, drawn);
  const pOf = (h) => (C(k, h) * C(40 - k, drawn - h)) / total;
  const tiers = [];
  for (let h = Math.max(1, Math.floor(k / 3)); h <= Math.min(k, drawn); h++) tiers.push(h);
  const c = 1 / tiers.length;
  const rawPay = {};
  for (const h of tiers) rawPay[h] = c / pOf(h);
  let ev = 0;
  for (const h of tiers) ev += pOf(h) * rawPay[h];

  const env = pfEnv(user, "keno");
  return run(user, "keno", stake, env.info, (st, edge) => {
    const set = new Set();
    for (let i = 0; i < drawn; i++) set.add(Math.floor(env.f(`d${i}`) * 40) + 1);
    const hits = arr.filter((n) => set.has(n));
    const h = hits.length;
    const raw = rawPay[h] || 0;
    const mul = raw > 0 ? (raw / ev) * (1 - edge) : 0;
    return {
      payout: scalePay(st, mul),
      result: { drawn: [...set], hits, hitCount: h, multiplier: Number(mul.toFixed(3)) },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}

/* ---------------------------------- HI-LO ----------------------------------- */

export function hilo(user, { stake, guess, current }) {
  const c = Number(current);
  if (!Number.isInteger(c) || c < 2 || c > 14) throw new Error("bad_card");
  const g = guess === "hi" ? "hi" : "lo";
  const winProb = g === "hi" ? (14 - c) / 13 : (c - 2) / 13;
  if (winProb <= 0) throw new Error("impossible_guess");
  const env = pfEnv(user, "hilo");
  return run(user, "hilo", stake, env.info, (st, edge) => {
    const card = Math.floor(env.f("card") * 13) + 2;
    const win = g === "hi" ? card > c : card < c;
    const fair = 1 / winProb;
    const mul = fair * (1 - edge);
    return {
      payout: win ? scalePay(st, mul) : 0,
      result: { card, prev: c, guess: g, win, multiplier: Number(mul.toFixed(3)) },
      rtp: Number(((1 - edge) * 100).toFixed(2)),
    };
  });
}

/* ------------------------ MINES (escrow, multi-step) ------------------------ */

function minesBoard(env, mines) {
  const cells = Array.from({ length: 25 }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(envOrShuffle(env, i) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  // deterministic shuffle uses per-step floats
  return cells;
}
function envOrShuffle(env, i) {
  return env.f(`shuffle${i}`);
}
function minesMult(mines, picks) {
  let p = 1;
  for (let i = 0; i < picks; i++) p *= (25 - mines - i) / (25 - i);
  return 1 / p;
}

export function minesRoutes(user, body, ip) {
  const action = String(body?.action || "");
  const cfg = gameConfig("mines");
  const active = db.prepare("SELECT * FROM active_games WHERE user_id = ? AND game='mines'").get(user.id);

  if (action === "start") {
    if (active) throw new Error("game_in_progress");
    const mines = Math.max(1, Math.min(24, Math.round(Number(body.mines) || 3)));
    const stake = assertBet(user, body.stake, cfg);
    const env = pfEnv(user, "mines");
    const board = minesBoard(env, mines);
    const mineSet = board.slice(0, mines);
    const st = { mineSet, picks: [], stake, mines, pf: env.info, started: now() };
    const { betId, boosted } = openBet(user, { game: "mines", stake, pf: env.info });
    db.prepare("INSERT INTO active_games(user_id, game, bet_id, state, created_at) VALUES(?,?,?,?,?)")
      .run(user.id, "mines", betId, JSON.stringify(st), now());
    return { ok: true, mines, stake, picks: [], boosted, balance: getUser(user.id).balance };
  }

  if (!active) throw new Error("no_active_game");
  const state = JSON.parse(active.state);

  if (action === "pick") {
    const cell = Math.round(Number(body.cell));
    if (!Number.isInteger(cell) || cell < 0 || cell > 24) throw new Error("bad_cell");
    if (state.picks.includes(cell)) throw new Error("already_picked");
    const hit = state.mineSet.includes(cell);
    state.picks.push(cell);
    const u = getUser(user.id);
    if (hit) {
      db.prepare("DELETE FROM active_games WHERE user_id = ?").run(user.id);
      const settled = closeBet(user, active.bet_id, {
        payout: 0,
        result: { boom: true, picks: state.picks, mines: state.mines, cell },
      });
      return { ...settled, boom: true, picks: state.picks, cell, balance: settled.balance };
    }
    const mult = minesMult(state.mines, state.picks.length) * (1 - edgeFor(u, cfg));
    const potential = Math.floor(state.stake * mult);
    db.prepare("UPDATE active_games SET state = ? WHERE user_id = ?").run(JSON.stringify(state), user.id);
    return {
      ok: true,
      boom: false,
      picks: state.picks,
      cell,
      multiplier: Number(mult.toFixed(4)),
      potential,
      balance: getUser(user.id).balance,
    };
  }

  if (action === "cashout") {
    if (!state.picks.length) throw new Error("nothing_to_cashout");
    const u = getUser(user.id);
    const mult = minesMult(state.mines, state.picks.length) * (1 - edgeFor(u, cfg));
    const payout = Math.floor(state.stake * mult);
    db.prepare("DELETE FROM active_games WHERE user_id = ?").run(user.id);
    const settled = closeBet(user, active.bet_id, {
      payout,
      result: { boom: false, picks: state.picks, mines: state.mines, multiplier: Number(mult.toFixed(4)) },
    });
    return { ...settled, cashed: true, picks: state.picks, multiplier: Number(mult.toFixed(4)), balance: settled.balance };
  }

  if (action === "state") {
    const s = JSON.parse(active.state);
    // never expose the mine layout to the client
    return { ok: true, mines: s.mines, stake: s.stake, picks: s.picks, pf: s.pf, balance: getUser(user.id).balance };
  }
  throw new Error("bad_action");
}

/* --------------------------------- ROUTES ----------------------------------- */

export const GAME_IDS = ["crash", "dice", "limbo", "mines", "roulette", "slots", "plinko", "wheel", "keno", "hilo", "mproulette", "poker"];

export function registerGameRoutes(app) {
  pfRoutes(app);

  app.get("/api/games", (req, res) => {
    const cfg = gameConfig("any");
    res.json({
      games: GAME_IDS,
      minBet: cfg.minBet,
      maxBet: cfg.maxBet,
      houseEdgePct: Number(getSetting("house_edge_pct")),
      rtp: Number((100 - Number(getSetting("house_edge_pct"))).toFixed(2)),
      adminCommissionPct: Number(getSetting("admin_commission_pct")),
    });
  });

  const play = (fn) => (req, res) => {
    try {
      if (getSetting("maintenance") === "1" && req.user?.role !== "admin")
        return res.status(503).json({ error: "maintenance" });
      const out = fn(req.user, req.body || {}, clientIp(req));
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };

  app.post("/api/games/dice", requireAuth, play(dice));
  app.post("/api/games/limbo", requireAuth, play(limbo));
  app.post("/api/games/slots", requireAuth, play(slots));
  app.post("/api/games/roulette", requireAuth, play(roulette));
  app.post("/api/games/plinko", requireAuth, play(plinko));
  app.post("/api/games/wheel", requireAuth, play(wheel));
  app.post("/api/games/keno", requireAuth, play(keno));
  app.post("/api/games/hilo", requireAuth, play(hilo));
  app.post("/api/games/mines", requireAuth, (req, res) => {
    try {
      const out = minesRoutes(req.user, req.body || {}, clientIp(req));
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
