import { db, getUser, now, getSetting, setSetting, credit, platformAdd, audit, publicUser } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit, clientIp } from "./util.js";

export const VIP_TIERS = [
  { id: "bronze", name: "Bronze", from: 0, cashback: 0 },
  { id: "silver", name: "Silver", from: 100000, cashback: 1 },
  { id: "gold", name: "Gold", from: 1000000, cashback: 2 },
  { id: "platinum", name: "Platinum", from: 5000000, cashback: 3 },
  { id: "diamond", name: "Diamond", from: 25000000, cashback: 4 },
  { id: "elite", name: "Nexus Elite", from: 100000000, cashback: 5 },
];
export function vipTier(wagered) {
  let t = VIP_TIERS[0];
  for (const x of VIP_TIERS) if (wagered >= x.from) t = x;
  const next = VIP_TIERS[VIP_TIERS.indexOf(t) + 1] || null;
  return { ...t, next: next ? { name: next.name, from: next.from } : null };
}

const weekKey = (t = now()) => {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
};

export function tournamentStandings() {
  const start = new Date(weekKey() + "T00:00:00.000Z").getTime();
  return db
    .prepare(
      `SELECT u.id, u.username, SUM(b.profit) profit, SUM(b.stake) wagered, COUNT(b.id) bets
       FROM bets b JOIN users u ON u.id = b.user_id
       WHERE b.created_at >= ? AND u.role = 'user'
       GROUP BY u.id ORDER BY profit DESC LIMIT 50`
    )
    .all(start);
}

export function leaderboard(period = "week") {
  const since = period === "all" ? 0 : now() - 7 * 86400000;
  return db
    .prepare(
      `SELECT u.id, u.username, SUM(b.profit) profit, SUM(b.stake) wagered, COUNT(b.id) bets,
              SUM(CASE WHEN b.payout > 0 THEN 1 ELSE 0 END) wins
       FROM bets b JOIN users u ON u.id = b.user_id
       WHERE b.created_at >= ? AND u.role = 'user'
       GROUP BY u.id ORDER BY profit DESC LIMIT 100`
    )
    .all(since);
}

export function liveWins(limit = 24) {
  return db
    .prepare(
      `SELECT b.id, b.game, b.stake, b.payout, b.profit, b.result, b.created_at, u.username, u.id AS user_id
       FROM bets b JOIN users u ON u.id = b.user_id
       WHERE b.closed = 1 AND b.payout > b.stake
       ORDER BY b.id DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({
      id: r.id,
      game: r.game,
      stake: r.stake,
      payout: r.payout,
      profit: r.profit,
      result: r.result ? JSON.parse(r.result) : null,
      username: r.username,
      userId: r.user_id,
      createdAt: r.created_at,
    }));
}

export function topWinners(limit = 10) {
  return db
    .prepare(
      `SELECT u.username, SUM(b.profit) profit, COUNT(b.id) wins FROM bets b JOIN users u ON u.id = b.user_id
       WHERE b.created_at >= ? AND b.payout > b.stake GROUP BY u.id ORDER BY profit DESC LIMIT ?`
    )
    .all(now() - 7 * 86400000, limit);
}

export function mostPlayed() {
  return db
    .prepare(
      `SELECT game, COUNT(*) bets, COALESCE(SUM(stake),0) staked FROM bets
       WHERE created_at >= ? GROUP BY game ORDER BY staked DESC LIMIT 6`
    )
    .all(now() - 7 * 86400000);
}

/* --------------------------------- bonuses --------------------------------- */

function give(userId, amount, type, note) {
  if (amount <= 0) return 0;
  credit(userId, amount, { type, note });
  platformAdd({ bonus: amount });
  return amount;
}

export function onDeposit(userId, cents) {
  const out = [];
  const u = getUser(userId);
  if (getSetting("welcome_bonus_enabled") === "1" && u.total_deposit === cents) {
    // first deposit ever (total_deposit already updated by caller or here)
    const pct = Number(getSetting("welcome_bonus_pct")) || 0;
    const max = Number(getSetting("welcome_bonus_max")) || 0;
    const bonus = Math.min(Math.floor((cents * pct) / 100), max);
    if (bonus > 0) out.push({ type: "welcome", amount: give(userId, bonus, "bonus", "Welcome bonus") });
  }
  if (getSetting("referral_enabled") === "1" && u.referred_by) {
    const min = Number(getSetting("referral_min_deposit")) || 0;
    const already = db
      .prepare("SELECT COUNT(*) n FROM referrals WHERE invitee = ? AND status='paid'")
      .get(userId).n;
    const total = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id=? AND type='deposit' AND status='completed'").get(userId).s;
    if (!already && total >= min) {
      const bonus = Number(getSetting("referral_bonus")) || 0;
      db.prepare("INSERT INTO referrals(referrer, invitee, amount, status, created_at) VALUES(?,?,?,'paid',?)")
        .run(u.referred_by, userId, bonus, now());
      give(u.referred_by, bonus, "referral", `Referral reward from ${u.username}`);
      out.push({ type: "referral", amount: bonus });
    }
  }
  return out;
}

/* ---------------------------------- routes --------------------------------- */

export function registerPromoRoutes(app) {
  app.get("/api/leaderboard", (req, res) => {
    const period = req.query?.period === "all" ? "all" : "week";
    res.json({ period, rows: leaderboard(period), tournament: tournamentStandings(), pool: Number(getSetting("tournament_pool")) });
  });

  app.get("/api/feed/live", (req, res) => {
    res.json({ wins: liveWins(24), top: topWinners(10), mostPlayed: mostPlayed() });
  });

  app.get("/api/promotions", requireAuth, (req, res) => {
    const u = getUser(req.user.id);
    const last = new Date(u.streak_last).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const canDaily = getSetting("daily_bonus_enabled") === "1" && last !== today;
    const weekend = [0, 6].includes(new Date().getUTCDay());
    const weekStart = new Date(weekKey() + "T00:00:00.000Z").getTime();
    const losses = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN payout < stake THEN stake - payout ELSE 0 END),0) l,
                COALESCE(SUM(CASE WHEN payout < stake THEN stake - payout ELSE 0 END),0) lw
         FROM bets WHERE user_id = ? AND created_at >= ?`
      )
      .get(u.id, weekStart);
    const cashbackEligible = losses.l;
    const cashbackPct = Number(getSetting("cashback_pct")) + vipTier(u.vip_wagered).cashback;
    const alreadyCashback = db
      .prepare("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND type='cashback' AND created_at >= ?")
      .get(u.id, weekStart).n;

    res.json({
      settings: {
        welcomeBonusPct: Number(getSetting("welcome_bonus_pct")),
        welcomeBonusMax: Number(getSetting("welcome_bonus_max")),
        welcomeEnabled: getSetting("welcome_bonus_enabled") === "1",
        dailyEnabled: getSetting("daily_bonus_enabled") === "1",
        dailyMaxDay7: Number(getSetting("daily_bonus_max_day7")),
        cashbackEnabled: getSetting("cashback_enabled") === "1",
        cashbackPct,
        tournamentEnabled: getSetting("tournament_enabled") === "1",
        tournamentPool: Number(getSetting("tournament_pool")),
        referralEnabled: getSetting("referral_enabled") === "1",
        referralBonus: Number(getSetting("referral_bonus")),
        referralMinDeposit: Number(getSetting("referral_min_deposit")),
      },
      user: {
        streakDay: u.streak_day,
        canDaily,
        cashbackEligible,
        cashbackClaimed: alreadyCashback > 0,
        isWeekend: weekend,
        referralCode: u.referral_code,
        vip: vipTier(u.vip_wagered),
        referrals: db.prepare("SELECT COUNT(*) n FROM referrals WHERE referrer=?").get(u.id).n,
        referralEarned: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM referrals WHERE referrer=? AND status='paid'").get(u.id).s,
      },
      tournament: { standings: tournamentStandings().slice(0, 10), week: weekKey() },
    });
  });

  app.post("/api/promotions/daily", requireAuth, (req, res) => {
    try {
      if (getSetting("daily_bonus_enabled") !== "1") throw new Error("disabled");
      if (!rateLimit(`daily:${req.user.id}`, 5, 3600000)) throw new Error("too_many");
      const u = getUser(req.user.id);
      const last = u.streak_last ? new Date(u.streak_last).toISOString().slice(0, 10) : "";
      const today = new Date().toISOString().slice(0, 10);
      if (last === today) throw new Error("already_claimed");
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const day = last === yesterday ? Math.min(7, u.streak_day + 1) : 1;
      const maxDay = Number(getSetting("daily_bonus_max_day7")) || 5000;
      const amount = Math.round((maxDay / 7) * day);
      db.prepare("UPDATE users SET streak_day = ?, streak_last = ? WHERE id = ?").run(day, Date.now(), u.id);
      give(u.id, amount, "daily", `Daily bonus day ${day}`);
      audit(u.id, "promo.daily", `day=${day} amount=${amount}`, clientIp(req));
      res.json({ ok: true, day, amount, streakDay: day, balance: getUser(u.id).balance });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/promotions/cashback", requireAuth, (req, res) => {
    try {
      if (getSetting("cashback_enabled") !== "1") throw new Error("disabled");
      const u = getUser(req.user.id);
      const weekend = [0, 6].includes(new Date().getUTCDay());
      const monday = new Date().toISOString().slice(0, 10);
      const weekStart = new Date(weekKey() + "T00:00:00.000Z").getTime();
      const lastWeekStart = weekStart - 7 * 86400000;
      const losses = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN payout < stake THEN stake - payout ELSE 0 END),0) l
           FROM bets WHERE user_id = ? AND created_at >= ? AND created_at < ?`
        )
        .get(u.id, lastWeekStart, weekStart).l;
      const already = db
        .prepare("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND type='cashback' AND created_at >= ?")
        .get(u.id, weekStart).n;
      if (already) throw new Error("already_claimed");
      if (losses <= 0) throw new Error("no_losses");
      const pct = Number(getSetting("cashback_pct")) + vipTier(u.vip_wagered).cashback;
      const amount = Math.floor((losses * pct) / 100);
      give(u.id, amount, "cashback", `Weekend cashback ${pct}%`);
      audit(u.id, "promo.cashback", `amount=${amount}`, clientIp(req));
      res.json({ ok: true, amount, balance: getUser(u.id).balance });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/promotions/claim-win", requireAuth, (req, res) => {
    // tournament prize claim for the previous completed week
    try {
      if (getSetting("tournament_enabled") !== "1") throw new Error("disabled");
      const paidKey = getSetting("tournament_paid_week");
      const lastWeek = weekKey(now() - 7 * 86400000);
      if (paidKey && paidKey >= lastWeek) throw new Error("nothing_to_claim");
      res.json({ ok: false, error: "pending_payout" });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}

/** Weekly tournament payout: top 10 by profit share the pool. Runs from the scheduler. */
export function payTournament() {
  if (getSetting("tournament_enabled") !== "1") return;
  const thisWeek = weekKey();
  if (getSetting("tournament_paid_week") === thisWeek) return;
  const lastWeek = weekKey(now() - 7 * 86400000);
  if (getSetting("tournament_last_week_done") === lastWeek) return;
  const rows = db
    .prepare(
      `SELECT u.id, SUM(b.profit) p FROM bets b JOIN users u ON u.id=b.user_id
       WHERE b.created_at >= ? AND b.created_at < ? AND u.role='user'
       GROUP BY u.id HAVING p > 0 ORDER BY p DESC LIMIT 10`
    )
    .all(
      new Date(lastWeek + "T00:00:00.000Z").getTime(),
      new Date(thisWeek + "T00:00:00.000Z").getTime()
    );
  const pool = Number(getSetting("tournament_pool")) || 0;
  if (rows.length && pool > 0) {
    const weights = rows.reduce((a, r) => a + r.p, 0);
    let paid = 0;
    rows.forEach((r, i) => {
      const share = i === rows.length - 1 ? pool - paid : Math.floor((pool * r.p) / weights);
      paid += share;
      if (share > 0) give(r.id, share, "tournament", `Weekly tournament #${i + 1}`);
    });
    audit(null, "promo.tournament_payout", `${rows.length} winners pool=${pool}`);
  }
  setSetting("tournament_last_week_done", lastWeek);
  setSetting("tournament_paid_week", thisWeek);
}
