import { db, getUser, now, getSetting, platformAdd } from "./db.js";
import { hmacFloat, randHex, seedHash, rateLimit } from "./util.js";
import { recordEscrowedBet, closeBet, gameConfig } from "./settle.js";
import { refreshUser, broadcastRoom } from "./multi.js";

const ACTION_MS = 20000;
const SHOWDOWN_MS = 6000;
const START_MS = 4000;

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ["s", "h", "d", "c"];

function makeDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push({ r, s });
  return d;
}
function shuffle(deck, seed, tag) {
  for (let i = deck.length - 1; i > 0; i--) {
    const f = hmacFloat(seed, tag, i, "deck");
    const j = Math.floor(f * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ------------------------------ hand evaluation ----------------------------- */

function evaluate7(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const flushSuit = suits.find((s) => suits.filter((x) => x === s).length >= 5);
  let straightHigh = 0;
  if (flushSuit) {
    const fr = [...new Set(cards.filter((c) => c.s === flushSuit).map((c) => c.r))].sort((a, b) => b - a);
    straightHigh = straightOf(fr);
  }
  const allStraight = straightOf([...new Set(ranks)]);
  const straightFlush = flushSuit && straightHigh ? straightHigh : 0;

  if (straightFlush) return [8, straightFlush];
  if (byCount[0][1] === 4) return [7, byCount[0][0], byCount[1][0]];
  if (byCount[0][1] === 3 && byCount[1][1] >= 2) return [6, byCount[0][0], byCount[1][0]];
  if (flushSuit) {
    const fr = cards.filter((c) => c.s === flushSuit).map((c) => c.r).sort((a, b) => b - a);
    return [5, ...fr.slice(0, 5)];
  }
  if (allStraight) return [4, allStraight];
  if (byCount[0][1] === 3) return [3, byCount[0][0], ...kickers(counts, [byCount[0][0]], 2)];
  const pairs = byCount.filter((x) => x[1] >= 2).map((x) => x[0]).sort((a, b) => b - a);
  if (pairs.length >= 2) return [2, pairs[0], pairs[1], kickers(counts, [pairs[0], pairs[1]], 1)[0]];
  if (pairs.length === 1) return [1, pairs[0], ...kickers(counts, [pairs[0]], 4)];
  return [0, ...ranks.slice(0, 5)];
}
function kickers(counts, used, n) {
  return [...counts.keys()]
    .filter((r) => !used.includes(r))
    .sort((a, b) => b - a)
    .slice(0, n);
}
function straightOf(ranks) {
  const s = [...new Set(ranks)].sort((a, b) => b - a);
  if (s.includes(14)) s.push(1);
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1] - s[i] === 1) {
      run++;
      if (run >= 5) return s[i] + 4;
    } else if (s[i - 1] !== s[i]) run = 1;
  }
  return 0;
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

/* --------------------------------- rooms ------------------------------------ */

export function pokerCreate(id, user, opts = {}) {
  const buyIn = Math.max(Number(getSetting("min_bet")) * 20, Math.min(100000000, Math.round(Number(opts.buyIn) || 20000)));
  return {
    id,
    game: "poker",
    owner: user.id,
    max: 5,
    buyIn,
    phase: "waiting",
    deadline: 0,
    players: new Map(),
    hand: null,
    handNo: 0,
    history: [],
  };
}

export function pokerJoin(room, user) {
  if (room.players.has(user.id)) return;
  if (user.balance < room.buyIn) throw new Error("insufficient_balance");
  room.players.set(user.id, {
    userId: user.id,
    username: user.username,
    ready: true,
    inHand: false,
    folded: false,
    allin: false,
    committed: 0,
    roundCommitted: 0,
    hasActed: false,
    cards: null,
    stack: user.balance,
    lastAction: null,
    satOut: false,
  });
  db.prepare("INSERT OR REPLACE INTO active_games(user_id, game, bet_id, state, created_at) VALUES(?,?,NULL,?,?)")
    .run(user.id, "poker", room.id, now());
}

export function pokerLeave(room, userId) {
  const p = room.players.get(userId);
  if (!p) return;
  if (p.inHand && room.hand) {
    // stay in the map until the hand is settled so the pot still reconciles
    p.folded = true;
    p.pendingLeave = true;
    p.lastAction = "fold";
    if (room.hand.toAct === userId) {
      room.hand.toAct = nextActor(room);
      room.hand.deadline = now() + 20000;
    }
  } else {
    room.players.delete(userId);
  }
  db.prepare("DELETE FROM active_games WHERE user_id = ? AND game = 'poker'").run(userId);
}

export function pokerSit(room, userId) {
  const p = room.players.get(userId);
  if (p) p.ready = true;
}
export function pokerReady(room, userId) {
  const p = room.players.get(userId);
  if (p) p.ready = true;
}

function seated(room) {
  return [...room.players.values()].filter((p) => !p.satOut);
}
function order(room) {
  const all = seated(room);
  const i = all.findIndex((p) => p.userId === room.hand.dealer);
  return [...all.slice(i + 1), ...all.slice(0, i + 1)];
}

function commit(room, p, amount) {
  const u = getUser(p.userId);
  const delta = Math.min(amount, u.balance);
  if (delta <= 0) return 0;
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(delta, u.id);
  platformAdd({ staked: delta });
  p.committed += delta;
  p.roundCommitted += delta;
  p.stack = u.balance - delta;
  if (p.stack <= 0) p.allin = true;
  refreshUser(u.id);
  return delta;
}

/* -------------------------------- hand flow --------------------------------- */

function startHand(room) {
  for (const [id, p] of [...room.players]) if (p.pendingLeave) room.players.delete(id);
  const players = seated(room).filter((p) => getUser(p.userId)?.balance >= Math.min(room.buyIn, bb(room) * 2));
  if (players.length < 2) {
    room.phase = "waiting";
    room.hand = null;
    return;
  }
  for (const p of room.players.values()) {
    p.inHand = players.includes(p);
    p.folded = false;
    p.allin = false;
    p.committed = 0;
    p.roundCommitted = 0;
    p.hasActed = false;
    p.cards = null;
    p.lastAction = null;
    p.stack = getUser(p.userId).balance;
    if (!p.inHand) p.satOut = false;
  }

  room.handNo++;
  const seed = randHex(32);
  const deck = shuffle(makeDeck(), seed, `hand${room.handNo}`);
  const handPlayers = players;
  const prevDealer = room.hand?.dealer;
  const idx = prevDealer ? handPlayers.findIndex((p) => p.userId === prevDealer) : -1;
  const dealer = handPlayers[(idx + 1) % handPlayers.length].userId;
  room.hand = {
    seed,
    seedHash: seedHash(seed),
    dealer,
    board: [],
    deck: deck.slice(5),
    phase: "preflop",
    currentBet: 0,
    minRaise: 0,
    toAct: null,
    deadline: now() + ACTION_MS,
    pot: 0,
    started: now(),
    handNo: room.handNo,
    revealed: false,
  };
  handPlayers.forEach((p, i) => {
    p.cards = [deck[i * 2], deck[i * 2 + 1]];
  });

  const sbAmt = Math.max(1, Math.floor(bb(room) / 2)); // small blind is half the big one
  const bbAmt = bb(room);
  const small = handPlayers[(idx + 2) % handPlayers.length];
  const big = handPlayers[(idx + 3) % handPlayers.length];
  commit(room, small, sbAmt);
  commit(room, big, bbAmt);
  room.hand.currentBet = bbAmt;
  room.hand.minRaise = bbAmt;

  const acts = order(room).filter((p) => p.inHand);
  room.hand.toAct = acts.find((p) => !p.allin && p.userId !== big.userId)?.userId || big.userId;
  room.phase = "preflop";
  room.deadline = room.hand.deadline;
  broadcastRoomState(room);
}
function bb(room) {
  return Math.max(1, Math.round(room.buyIn / 100));
}

function canAct(p) {
  return p.inHand && !p.folded && !p.allin;
}
function nextActor(room) {
  const h = room.hand;
  const list = order(room).filter(canAct);
  if (!list.length) return null;
  const startIdx = list.findIndex((p) => p.userId === h.toAct);
  for (let i = 1; i <= list.length; i++) {
    const p = list[(startIdx + i + list.length) % list.length];
    if (!p.hasActed || p.roundCommitted < h.currentBet) return p.userId;
  }
  const cur = list.find((p) => p.userId === h.toAct);
  if (cur && (!cur.hasActed || cur.roundCommitted < h.currentBet)) return cur.userId;
  return null;
}
function roundComplete(room) {
  const h = room.hand;
  const actors = seated(room).filter((p) => p.inHand && !p.folded);
  if (actors.filter((p) => !p.allin).length <= 1 && actors.every((p) => p.allin || p.roundCommitted === h.currentBet))
    return true;
  return actors.every((p) => p.allin || (p.hasActed && p.roundCommitted === h.currentBet));
}

function doAction(room, p, action, amount = 0) {
  const h = room.hand;
  if (!h) throw new Error("no_hand");
  if (h.toAct !== p.userId && action !== "fold_auto") throw new Error("not_your_turn");
  const toCall = h.currentBet - p.roundCommitted;

  if (action === "fold") {
    p.folded = true;
    p.hasActed = true;
    p.lastAction = "fold";
  } else if (action === "check") {
    if (toCall > 0) throw new Error("cannot_check");
    p.hasActed = true;
    p.lastAction = "check";
  } else if (action === "call") {
    if (toCall <= 0) return doAction(room, p, "check");
    const paid = commit(room, p, toCall);
    p.lastAction = p.allin ? "allin" : "call";
    p.hasActed = true;
    if (paid < toCall) p.allin = true;
  } else if (action === "raise") {
    const target = Math.round(Number(amount));
    const stackAvail = p.roundCommitted + (getUser(p.userId).balance);
    if (target <= h.currentBet && target < stackAvail) throw new Error("bad_raise");
    if (target < h.currentBet + h.minRaise && target < stackAvail) throw new Error("min_raise");
    const need = target - p.roundCommitted;
    const paid = commit(room, p, need);
    if (paid < need) {
      p.allin = true;
      p.lastAction = "allin";
    } else {
      const raised = target - h.currentBet;
      if (raised >= h.minRaise) h.minRaise = raised;
      h.currentBet = target;
      p.lastAction = h.currentBet > 0 ? "raise" : "bet";
      for (const q of seated(room)) if (q.userId !== p.userId && canAct(q)) q.hasActed = false;
    }
    p.hasActed = true;
  } else if (action === "allin") {
    const stack = getUser(p.userId).balance;
    const target = p.roundCommitted + stack;
    const need = target - p.roundCommitted;
    commit(room, p, need);
    p.allin = true;
    p.hasActed = true;
    p.lastAction = "allin";
    if (target > h.currentBet) {
      const raised = target - h.currentBet;
      if (raised >= h.minRaise) h.minRaise = raised;
      h.currentBet = target;
      for (const q of seated(room)) if (q.userId !== p.userId && canAct(q)) q.hasActed = false;
    }
  } else {
    throw new Error("bad_action");
  }

  h.toAct = nextActor(room);
  h.deadline = now() + ACTION_MS;
  room.deadline = h.deadline;

  const alive = seated(room).filter((q) => q.inHand && !q.folded);
  if (alive.length === 1) return finishHand(room, true);
  if (roundComplete(room)) return advanceStreet(room);
  broadcastRoomState(room);
}

function advanceStreet(room) {
  const h = room.hand;
  for (const p of seated(room)) {
    p.roundCommitted = 0;
    p.hasActed = false;
  }
  h.currentBet = 0;
  h.minRaise = bb(room) * 2;

  const deal = (n) => {
    for (let i = 0; i < n; i++) h.board.push(h.deck.shift());
  };
  if (h.phase === "preflop") {
    deal(3);
    h.phase = "flop";
  } else if (h.phase === "flop") {
    deal(1);
    h.phase = "turn";
  } else if (h.phase === "turn") {
    deal(1);
    h.phase = "river";
  } else {
    return finishHand(room, false);
  }
  const acts = order(room).filter(canAct);
  if (acts.length <= 1) {
    // no more betting possible -> deal remaining streets and showdown
    while (h.board.length < 5) h.board.push(h.deck.shift());
    return finishHand(room, false);
  }
  h.toAct = acts[0].userId;
  h.deadline = now() + ACTION_MS;
  room.deadline = h.deadline;
  room.phase = h.phase;
  broadcastRoomState(room);
}

function uncalled(room) {
  // refund the portion of the top bet nobody else called (based on total committed).
  // folded players still cover the bets they matched before folding, so they count too.
  const players = seated(room).filter((p) => p.inHand);
  if (!players.length) return new Map();
  const max = Math.max(...players.map((p) => p.committed));
  const top = players.filter((p) => p.committed === max);
  const second = Math.max(0, ...players.filter((p) => p.committed < max).map((p) => p.committed));
  const out = new Map();
  if (top.length === 1 && max > second) out.set(top[0].userId, max - second);
  return out;
}

function finishHand(room, everyoneFolded) {
  const h = room.hand;
  const players = seated(room).filter((p) => p.inHand);
  const refunds = uncalled(room);
  const risk = new Map();
  for (const p of players) {
    const r = refunds.get(p.userId) || 0;
    risk.set(p.userId, Math.max(0, p.committed - r));
    p.refund = r;
  }

  // side pots by contribution level (using at-risk amounts)
  const active = players.filter((p) => !p.folded);
  let winners = [];
  let shares = new Map(players.map((p) => [p.userId, 0]));
  if (everyoneFolded || active.length === 1) {
    const w = active[0];
    winners = w ? [w.userId] : [];
    if (w) shares.set(w.userId, [...risk.values()].reduce((a, b) => a + b, 0));
  } else {
    const evals = new Map();
    for (const p of active) evals.set(p.userId, evaluate7([...p.cards, ...h.board]));
    const levels = [...new Set(players.map((p) => risk.get(p.userId)))].sort((a, b) => a - b);
    let prev = 0;
    for (const lvl of levels) {
      const contributors = players.filter((p) => risk.get(p.userId) >= lvl);
      const amount = (lvl - prev) * contributors.length;
      prev = lvl;
      const eligible = contributors.filter((p) => !p.folded);
      if (!eligible.length || amount <= 0) continue;
      let best = null;
      let bestP = [];
      for (const p of eligible) {
        const ev = evals.get(p.userId);
        if (!best || cmp(ev, best) > 0) {
          best = ev;
          bestP = [p];
        } else if (cmp(ev, best) === 0) bestP.push(p);
      }
      const share = Math.floor(amount / bestP.length);
      let rest = amount - share * bestP.length;
      for (const p of bestP) {
        shares.set(p.userId, shares.get(p.userId) + share + (rest > 0 ? 1 : 0));
        if (rest > 0) rest--;
      }
      for (const p of bestP) if (!winners.includes(p.userId)) winners.push(p.userId);
    }
    h.revealed = true;
  }

  // rake = admin_commission_pct of every loser's net loss, taken from the winners' excess
  const pct = gameConfig("poker").adminPct;
  let deficit = 0;
  for (const p of players) {
    const a = risk.get(p.userId);
    const s = shares.get(p.userId) || 0;
    if (a > s) deficit += a - s;
  }
  let rake = 0;
  for (const p of players) {
    const a = risk.get(p.userId);
    const s = shares.get(p.userId) || 0;
    if (s > a) {
      const excess = s - a;
      const give = Math.floor(excess * pct);
      shares.set(p.userId, s - give);
      rake += give;
    }
  }
  void deficit;

  // snapshot what the UI needs to render the showdown
  h.finalPot = players.reduce((a, p) => a + p.committed, 0);
  h.payouts = Object.fromEntries([...shares].map(([id, v]) => [id, v]));
  h.risk = risk;
  h.refunds = refunds;

  // settle ledger
  const pf = { seedHash: h.seedHash, handNo: h.handNo, board: h.board, revealed: h.revealed };
  const results = [];
  for (const p of players) {
    const u = getUser(p.userId);
    const a = risk.get(p.userId);
    const s = shares.get(p.userId) || 0;
    if (p.refund > 0) {
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(p.refund, u.id);
      platformAdd({ paid: p.refund });
    }
    const betId = recordEscrowedBet(u, { game: "poker", stake: a, pf, roundId: h.handNo });
    const out = closeBet(u, betId, {
      payout: s,
      result: {
        handNo: h.handNo,
        board: h.board,
        cards: p.folded ? null : p.cards,
        folded: p.folded,
        won: s > a,
        share: s,
        risk: a,
        refund: p.refund,
        winners: winners.map((id) => room.players.get(id)?.username).filter(Boolean),
      },
      pf,
    });
    p.stack = getUser(p.userId).balance;
    p.inHand = false;
    p.cards = h.revealed ? p.cards : null;
    results.push({ username: p.username, userId: p.userId, risk: a, payout: s, folded: p.folded, cards: p.cards });
    refreshUser(p.userId);
  }

  db.prepare(
    `INSERT INTO rounds(game,status,phase,seed_hash,seed,result,meta,pot,admin_cut,created_at,ended_at)
     VALUES('poker','settled','showdown',?,?,?,?,?,?,?,?)`
  ).run(
    h.seedHash,
    h.seed,
    JSON.stringify({ board: h.board, winners, handNo: h.handNo }),
    JSON.stringify({ players: players.length, rake }),
    [...risk.values()].reduce((a, b) => a + b, 0),
    rake,
    now(),
    now()
  );

  room.history.unshift({ handNo: h.handNo, board: h.board, winners: winners.map((id) => room.players.get(id)?.username).filter(Boolean), rake, finalPot: h.finalPot, payouts: h.payouts });
  room.history = room.history.slice(0, 15);
  room.phase = "settled";
  room.deadline = now() + SHOWDOWN_MS;
  h.toAct = null;
  broadcastRoomState(room);

  setTimeout(() => {
    if (!rooms_has(room)) return;
    const left = seated(room).filter((p) => (getUser(p.userId)?.balance || 0) >= bb(room) * 2);
    if (left.length >= 2) {
      room.phase = "dealing";
      room.deadline = now() + START_MS;
      broadcastRoomState(room);
    } else {
      room.phase = "waiting";
      room.hand = null;
      broadcastRoomState(room);
    }
  }, SHOWDOWN_MS);
}

let roomsRef = { has: () => true };
function rooms_has(room) {
  return roomsRef.has(room);
}
export function bindRooms(ref) {
  roomsRef = ref;
}

function broadcastRoomState(room) {
  // personalized per viewer so each player only sees their own hole cards
  broadcastRoom(room);
}

export function pokerPublic(room, viewerId = 0) {
  const h = room.hand;
  const revealed = !!h?.revealed;
  return {
    id: room.id,
    game: "poker",
    owner: room.owner,
    phase: room.phase,
    deadline: room.deadline,
    max: room.max,
    buyIn: room.buyIn,
    handNo: room.handNo,
    board: h?.board || [],
    pot: h ? (h.finalPot ?? [...room.players.values()].filter((p) => p.inHand).reduce((a, p) => a + p.committed, 0)) : 0,
    currentBet: h?.currentBet || 0,
    minRaise: h?.minRaise || 0,
    toAct: h?.toAct || null,
    dealer: h?.dealer || null,
    seedHash: h?.seedHash || null,
    revealed,
    history: room.history,
    players: [...room.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      ready: p.ready,
      inHand: p.inHand,
      folded: p.folded,
      allin: p.allin,
      committed: p.committed,
      roundCommitted: p.roundCommitted,
      // hole cards: own cards while the hand runs, everyone's at showdown
      cards: revealed || (p.inHand && (p.userId === viewerId || p.folded)) ? p.cards : null,
      stack: p.stack,
      payout: h?.payouts ? h.payouts[p.userId] ?? 0 : null,
      risk: h?.risk?.get ? h.risk.get(p.userId) ?? null : null,
      refund: h?.refunds?.get ? h.refunds.get(p.userId) ?? 0 : null,
      lastAction: p.lastAction,
      pendingLeave: !!p.pendingLeave,
    })),
  };
}

export function pokerAction(ctx, roomId, msg) {
  const room = roomsRef.get(`poker:${roomId}`);
  if (!room) throw new Error("room_not_found");
  const p = room.players.get(ctx.user.id);
  if (!p) throw new Error("not_seated");
  if (!rateLimit(`poker:${ctx.user.id}`, 20, 5000)) throw new Error("too_many");
  doAction(room, p, String(msg.action), Number(msg.amount) || 0);
}
export function pokerSitRoute() {}

export function pokerTick(t) {
  for (const room of roomsRef.all()) {
    if (room.game !== "poker") continue;
    if (!room.players.size) {
      roomsRef.delete(`poker:${room.id}`); // nobody left -> drop the room
      continue;
    }
    if (room.phase === "waiting" && !room.hand && seated(room).length >= 2) {
      // a fresh room with enough players starts its first hand
      room.phase = "dealing";
      room.deadline = t + START_MS;
      broadcastRoomState(room);
    } else if (room.phase === "dealing" && t >= room.deadline) {
      try {
        startHand(room);
      } catch (e) {
        console.error("poker start", e);
        room.phase = "waiting";
      }
    } else if (room.hand && (room.phase === "preflop" || room.phase === "flop" || room.phase === "turn" || room.phase === "river")) {
      if (t >= room.hand.deadline) {
        try {
          const p = room.players.get(room.hand.toAct);
          if (p && canAct(p)) {
            const toCall = room.hand.currentBet - p.roundCommitted;
            doAction(room, p, toCall > 0 ? "fold" : "check");
          } else {
            room.hand.deadline = t + 5000;
          }
        } catch (e) {
          console.error("poker timeout", e);
          room.phase = "waiting";
          room.hand = null;
        }
      }
    }
  }
}
