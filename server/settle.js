import { db, getUser, now, getSetting, platformAdd, dayKey, audit } from "./db.js";
import { pct, money } from "./util.js";

/**
 * Settlement core (two-phase):
 *   openBet()  - validates + escrows the stake, opens a bet row
 *   closeBet() - credits the payout, splits house net win:
 *                admin_commission_pct% of the net win -> admin balance,
 *                the rest stays in the platform treasury
 * Instant games call both back to back via settleBet().
 */

export function gameConfig(game) {
  return {
    game,
    edge: pct(getSetting("house_edge_pct")),
    adminPct: pct(getSetting("admin_commission_pct")),
    minBet: Number(getSetting("min_bet") || 100),
    maxBet: Number(getSetting("max_bet") || 100000000),
    boostEnabled: getSetting("boost_enabled") === "1",
  };
}

export function adminUser() {
  return db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
}

function rollDay(u) {
  const key = dayKey();
  if (u.today_key !== key) {
    db.prepare("UPDATE users SET today_key = ?, today_bet = 0, today_loss = 0 WHERE id = ?").run(key, u.id);
    return { ...u, today_key: key, today_bet: 0, today_loss: 0 };
  }
  return u;
}

export function checkResponsibleGaming(u, stake) {
  const fresh = rollDay(getUser(u.id));
  if (fresh.status === "banned") throw new Error("banned");
  if (fresh.self_exclusion_until > now()) throw new Error("self_excluded");
  if (fresh.daily_bet_limit > 0 && fresh.today_bet + stake > fresh.daily_bet_limit)
    throw new Error("daily_bet_limit");
  if (fresh.daily_loss_limit > 0 && fresh.today_loss >= fresh.daily_loss_limit)
    throw new Error("daily_loss_limit");
  return fresh;
}

/** Optional hook fired after every settled bet (used by the live feed). */
export const hooks = { onSettle: null };

/** Escrow the stake and open a bet row. Returns betId. */
export function openBet(user, { game, stake, pf = null, roundId = null }) {
  const cfg = gameConfig(game);
  const st = money(stake);
  if (!Number.isFinite(st) || st < cfg.minBet) throw new Error("min_bet");
  if (st > cfg.maxBet) throw new Error("max_bet");

  db.exec("BEGIN IMMEDIATE");
  try {
    const u = getUser(user.id);
    if (!u) throw new Error("auth_required");
    if (u.balance < st) throw new Error("insufficient_balance");
    const fresh = checkResponsibleGaming(u, st);
    const boosted = cfg.boostEnabled && u.boost_bets_left > 0;

    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(st, u.id);
    platformAdd({ staked: st });
    db.prepare(
      `UPDATE users SET bets_count = bets_count + 1, vip_wagered = vip_wagered + ?,
         boost_bets_left = CASE WHEN boost_bets_left > 0 THEN boost_bets_left - 1 ELSE 0 END,
         today_bet = today_bet + ? WHERE id = ?`
    ).run(st, st, u.id);

    const r = db
      .prepare(
        `INSERT INTO bets(user_id, game, stake, payout, profit, commission, pf, round_id, boosted, closed, created_at)
         VALUES(?,?,?,0,?,?,?,?,?,0,?)`
      )
      .run(u.id, game, st, -st, 0, pf ? JSON.stringify(pf) : null, roundId ?? null, boosted ? 1 : 0, now());

    db.exec("COMMIT");
    return { betId: Number(r.lastInsertRowid), stake: st, boosted, boostLeft: getUser(u.id).boost_bets_left };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Credit the payout, pay the admin commission, close the bet row. */
export function closeBet(user, betId, { payout = 0, result = null, pf = null } = {}) {
  const pay = Math.max(0, Math.trunc(payout));
  db.exec("BEGIN IMMEDIATE");
  try {
    const bet = db.prepare("SELECT * FROM bets WHERE id = ?").get(Number(betId));
    if (!bet || bet.user_id !== user.id) throw new Error("bet_not_found");
    if (bet.closed) throw new Error("bet_closed");
    const u = getUser(user.id);
    const cfg = gameConfig(bet.game);
    const net = bet.stake - pay;
    let commission = 0;

    if (pay > 0) {
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(pay, u.id);
      platformAdd({ paid: pay });
    }
    if (net > 0) {
      commission = Math.floor(net * cfg.adminPct);
      const adm = adminUser();
      if (adm && adm.id !== u.id && commission > 0) {
        db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(commission, adm.id);
        db.prepare(
          `INSERT INTO transactions(user_id, type, amount, currency, status, note, created_at, updated_at)
           VALUES(?,?,?,?,'completed',?,?,?)`
        ).run(adm.id, "commission", commission, "USD", `house commission · ${bet.game} · bet #${bet.id}`, now(), now());
        platformAdd({ commission });
      } else {
        commission = 0;
      }
    }
    db.prepare("UPDATE users SET today_loss = today_loss + ? WHERE id = ?").run(Math.max(0, net), u.id);
    db.prepare(
      `UPDATE bets SET payout = ?, profit = ?, commission = ?, result = ?,
         pf = COALESCE(?, pf), closed = 1 WHERE id = ?`
    ).run(pay, pay - bet.stake, commission, result ? JSON.stringify(result) : null, pf ? JSON.stringify(pf) : null, bet.id);
    db.exec("COMMIT");
    const after = getUser(u.id);
    const out = {
      betId: bet.id,
      game: bet.game,
      stake: bet.stake,
      payout: pay,
      profit: pay - bet.stake,
      commission,
      balance: after.balance,
      boostLeft: after.boost_bets_left,
      vipWagered: after.vip_wagered,
    };
    try {
      hooks.onSettle?.({ ...out, userId: u.id, username: u.username, result });
    } catch {}
    return out;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Instant bet: open + close in one call. */
export function settleBet(user, opts) {
  const { betId, boosted } = openBet(user, opts);
  const out = closeBet(user, betId, { payout: opts.payout ?? 0, result: opts.result, pf: opts.pf });
  return { ...out, boosted };
}

/**
 * Record a bet whose stake is already held in escrow (poker hand contributions).
 * No debit happens here - the money was locked when the player took the seat.
 */
export function recordEscrowedBet(user, { game, stake, pf = null, roundId = null }) {
  const st = Math.trunc(stake);
  const r = db
    .prepare(
      `INSERT INTO bets(user_id, game, stake, payout, profit, commission, pf, round_id, closed, created_at)
       VALUES(?,?,?,0,?,?,?,?,0,?)`
    )
    .run(user.id, game, st, -st, 0, pf ? JSON.stringify(pf) : null, roundId ?? null, now());
  db.prepare("UPDATE users SET bets_count = bets_count + 1, vip_wagered = vip_wagered + ? WHERE id = ?").run(st, user.id);
  return Number(r.lastInsertRowid);
}

/** House edge actually applied to this user (new-player boost). */
export function edgeFor(user, cfg) {
  if (cfg.boostEnabled && user.boost_bets_left > 0) return 0;
  return cfg.edge;
}

/* ------------------------------ stats helpers ------------------------------ */

export function statsOverview(since = 0) {
  const b = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(stake),0) staked, COALESCE(SUM(payout),0) paid,
              COALESCE(SUM(commission),0) comm FROM bets WHERE created_at >= ?`
    )
    .get(since);
  const players = db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n;
  const active = db.prepare("SELECT COUNT(DISTINCT user_id) n FROM bets WHERE created_at >= ?").get(since).n;
  const dep = db
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='deposit' AND status='completed' AND created_at >= ?")
    .get(since).s;
  const wd = db
    .prepare("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='withdraw' AND status='completed' AND created_at >= ?")
    .get(since).s;
  const pendingTx = db.prepare("SELECT COUNT(*) n FROM transactions WHERE status='pending'").get().n;
  const pendingWd = db
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='withdraw' AND status='pending'")
    .get().s;
  return {
    bets: b.n,
    staked: b.staked,
    paid: b.paid,
    ggr: b.staked - b.paid,
    commission: b.comm,
    ngr: b.staked - b.paid - b.comm,
    players,
    active,
    deposits: dep,
    withdrawals: wd,
    pendingTx,
    pendingWithdrawals: pendingWd,
  };
}

export function gameStats() {
  return db
    .prepare(
      `SELECT game, COUNT(*) bets, COALESCE(SUM(stake),0) staked, COALESCE(SUM(payout),0) paid,
              COALESCE(SUM(payout - stake),0) profit, COUNT(DISTINCT user_id) players
       FROM bets GROUP BY game ORDER BY staked DESC`
    )
    .all();
}

export function dailySeries(days = 30) {
  const since = now() - days * 86400000;
  return db
    .prepare(
      `SELECT date(created_at/1000,'unixepoch') d, COUNT(*) bets, COALESCE(SUM(stake),0) staked,
              COALESCE(SUM(payout),0) paid, COUNT(DISTINCT user_id) players
       FROM bets WHERE created_at >= ? GROUP BY d ORDER BY d`
    )
    .all(since);
}

export { audit };
