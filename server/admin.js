import { db, getUser, now, getSetting, setSetting, credit, platformAdd, platform, audit, publicUser } from "./db.js";
import { requireAdmin } from "./auth.js";
import { str, clientIp, hashPassword } from "./util.js";
import { statsOverview, gameStats, dailySeries } from "./settle.js";
import { onDeposit } from "./promos.js";

const ADMIN_MUTATIONS = new Set([
  "site_name", "site_tagline", "support_email", "promo_banner", "maintenance", "maintenance_msg",
  "house_edge_pct", "admin_commission_pct", "boost_enabled", "boost_bets",
  "welcome_bonus_enabled", "welcome_bonus_pct", "welcome_bonus_max",
  "daily_bonus_enabled", "daily_bonus_max_day7", "cashback_enabled", "cashback_pct",
  "tournament_enabled", "tournament_pool", "referral_enabled", "referral_bonus", "referral_min_deposit",
  "vip_enabled", "crypto_btc_address", "crypto_eth_address", "crypto_usdt_address", "crypto_ton_address",
  "rate_btc", "rate_eth", "rate_usdt", "rate_ton", "webhook_secret", "min_deposit", "min_withdraw",
  "deposit_enabled", "withdraw_enabled", "tg_token", "tg_enabled", "tg_channel",
  "min_bet", "max_bet", "registration_enabled",
]);

export function registerAdminRoutes(app) {
  app.get("/api/admin/overview", requireAdmin, (req, res) => {
    const day = now() - 86400000;
    const week = now() - 7 * 86400000;
    res.json({
      today: statsOverview(day),
      week: statsOverview(week),
      all: statsOverview(0),
      platform: platform(),
      games: gameStats(),
      series: dailySeries(30),
      settings: { ...getSettingSafe() },
      newPlayers: db.prepare("SELECT COUNT(*) n FROM users WHERE created_at >= ?").get(day).n,
      topPlayers: db
        .prepare(
          `SELECT u.username, u.balance, u.vip_wagered, SUM(b.profit) profit, COUNT(b.id) bets
           FROM users u LEFT JOIN bets b ON b.user_id = u.id AND b.created_at >= ?
           WHERE u.role='user' GROUP BY u.id ORDER BY profit DESC LIMIT 10`
        )
        .all(day),
    });
  });

  app.get("/api/admin/players", requireAdmin, (req, res) => {
    const q = str(req.query?.q, 60);
    const page = Math.max(0, Number(req.query?.page) || 0);
    const size = 25;
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM bets b WHERE b.user_id=u.id) bets,
                (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.user_id=u.id AND t.type='deposit' AND t.status='completed') dep
         FROM users u
         WHERE u.username LIKE ? OR u.email LIKE ? OR CAST(u.id AS TEXT) = ?
         ORDER BY u.id DESC LIMIT ? OFFSET ?`
      )
      .all(like, like, q, size, page * size);
    const total = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE ? OR email LIKE ? OR CAST(id AS TEXT) = ?").get(like, like, q).n;
    res.json({ total, page, items: rows.map((u) => ({ ...publicUser(u), bets: u.bets, deposited: u.dep, createdAt: u.created_at, banReason: u.ban_reason, notes: u.notes, ip: u.ip, tgUsername: u.tg_username, lastSeen: u.last_seen_at })) });
  });

  app.post("/api/admin/players/:id", requireAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const u = getUser(id);
      if (!u) return res.status(404).json({ error: "not_found" });
      const b = req.body || {};
      const changes = [];

      if (b.adjust !== undefined && b.adjust !== null && Number(b.adjust) !== 0) {
        const amt = Math.round(Number(b.adjust));
        if (!Number.isFinite(amt) || Math.abs(amt) > 100000000) throw new Error("bad_amount");
        credit(id, amt, { type: "adjustment", note: str(b.note, 200) || "admin adjustment" });
        if (amt > 0) platformAdd({ bonus: amt });
        else platformAdd({ bonus: amt }); // negative bonus restores treasury
        changes.push(`balance ${amt > 0 ? "+" : ""}${amt}`);
      }
      if (b.ban !== undefined) {
        const banned = !!b.ban;
        db.prepare("UPDATE users SET status = ?, ban_reason = ? WHERE id = ?").run(banned ? "banned" : "active", banned ? str(b.reason, 200) : null, id);
        changes.push(banned ? "banned" : "unbanned");
      }
      if (b.role && ["user", "admin"].includes(b.role) && b.role !== u.role) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(b.role, id);
        changes.push(`role=${b.role}`);
      }
      if (b.password) {
        if (String(b.password).length < 8) throw new Error("weak_password");
        db.prepare("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?").run(hashPassword(b.password), id);
        changes.push("password reset");
      }
      if (b.notes !== undefined) {
        db.prepare("UPDATE users SET notes = ? WHERE id = ?").run(str(b.notes, 500), id);
        changes.push("notes");
      }
      if (b.vipWagered !== undefined) {
        db.prepare("UPDATE users SET vip_wagered = ? WHERE id = ?").run(Math.max(0, Math.round(Number(b.vipWagered) || 0)), id);
        changes.push("vip");
      }
      if (b.boostBets !== undefined) {
        db.prepare("UPDATE users SET boost_bets_left = ? WHERE id = ?").run(Math.max(0, Math.round(Number(b.boostBets) || 0)), id);
        changes.push("boost");
      }
      if (b.selfExclusion !== undefined) {
        db.prepare("UPDATE users SET self_exclusion_until = ? WHERE id = ?").run(Number(b.selfExclusion) || 0, id);
        changes.push("self-exclusion cleared");
      }
      if (b.tgUnlink) {
        db.prepare("UPDATE users SET tg_id = NULL, tg_username = NULL WHERE id = ?").run(id);
        changes.push("tg unlinked");
      }
      audit(req.user.id, "admin.player", `#${id} ${u.username}: ${changes.join(", ")}`, clientIp(req));
      res.json({ ok: true, user: publicUser(getUser(id)), changes });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/admin/transactions", requireAdmin, (req, res) => {
    const status = str(req.query?.status, 20);
    const type = str(req.query?.type, 20);
    const page = Math.max(0, Number(req.query?.page) || 0);
    const where = [];
    const args = [];
    if (status) { where.push("t.status = ?"); args.push(status); }
    if (type) { where.push("t.type = ?"); args.push(type); }
    const sql = `SELECT t.*, u.username FROM transactions t LEFT JOIN users u ON u.id = t.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.id DESC LIMIT 25 OFFSET ?`;
    const rows = db.prepare(sql).all(...args, page * 25);
    const total = db.prepare(`SELECT COUNT(*) n FROM transactions t ${where.length ? "WHERE " + where.join(" AND ") : ""}`).get(...args).n;
    res.json({
      total,
      page,
      items: rows.map((t) => ({
        id: t.id, userId: t.user_id, username: t.username, type: t.type, amount: t.amount, status: t.status,
        crypto: t.crypto, address: t.address, txid: t.txid, note: t.note, rate: t.rate, createdAt: t.created_at, updatedAt: t.updated_at,
      })),
    });
  });

  app.post("/api/admin/transactions/:id", requireAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const t = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
      if (!t) return res.status(404).json({ error: "not_found" });
      if (t.status !== "pending") throw new Error("already_processed");
      const action = String(req.body?.action || "");
      const note = str(req.body?.note, 200);

      if (action === "approve") {
        if (t.type === "deposit") {
          if (t.user_id > 0) {
            credit(t.user_id, t.amount, { type: "deposit", status: "completed", crypto: t.crypto, address: t.address, txid: t.txid, note: note || t.note });
            db.prepare("UPDATE users SET total_deposit = total_deposit + ? WHERE id = ?").run(t.amount, t.user_id);
            platformAdd({ deposits: t.amount });
            try {
              onDeposit(t.user_id, t.amount);
            } catch (e) {
              console.error("onDeposit", e.message);
            }
          } else if (Number(req.body?.assignTo)) {
            const target = getUser(Number(req.body.assignTo));
            if (!target) throw new Error("user_not_found");
            credit(target.id, t.amount, { type: "deposit", status: "completed", crypto: t.crypto, txid: t.txid, note: note || "matched deposit" });
            db.prepare("UPDATE users SET total_deposit = total_deposit + ? WHERE id = ?").run(t.amount, target.id);
            platformAdd({ deposits: t.amount });
            db.prepare("UPDATE transactions SET user_id = ?, status='completed', updated_at=? WHERE id = ?").run(target.id, now(), id);
            audit(req.user.id, "admin.deposit_matched", `tx#${id} -> #${target.id}`, clientIp(req));
            return res.json({ ok: true, assigned: true });
          } else throw new Error("no_user");
        } else if (t.type === "withdraw") {
          db.prepare("UPDATE transactions SET status='completed', updated_at=?, note=? WHERE id = ?").run(now(), note || t.note, id);
        } else {
          db.prepare("UPDATE transactions SET status='completed', updated_at=? WHERE id = ?").run(now(), id);
        }
        db.prepare("UPDATE transactions SET status='completed', updated_at=? WHERE id = ?").run(now(), id);
      } else if (action === "reject") {
        if (t.type === "withdraw" && t.user_id > 0) {
          credit(t.user_id, -t.amount, { type: "withdraw_refund", status: "completed", note: note || "withdraw rejected" });
          platformAdd({ withdrawals: -t.amount });
        }
        db.prepare("UPDATE transactions SET status='rejected', updated_at=?, note=? WHERE id = ?").run(now(), note || t.note, id);
      } else throw new Error("bad_action");

      audit(req.user.id, "admin.transaction", `tx#${id} ${action}`, clientIp(req));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/admin/bets", requireAdmin, (req, res) => {
    const page = Math.max(0, Number(req.query?.page) || 0);
    const game = str(req.query?.game, 30);
    const q = str(req.query?.q, 60);
    const where = [];
    const args = [];
    if (game) { where.push("b.game = ?"); args.push(game); }
    if (q) { where.push("u.username LIKE ?"); args.push(`%${q}%`); }
    const rows = db
      .prepare(
        `SELECT b.*, u.username FROM bets b JOIN users u ON u.id=b.user_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY b.id DESC LIMIT 30 OFFSET ?`
      )
      .all(...args, page * 30);
    const total = db.prepare(`SELECT COUNT(*) n FROM bets b JOIN users u ON u.id=b.user_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`).get(...args).n;
    res.json({
      total,
      page,
      items: rows.map((b) => ({
        id: b.id, userId: b.user_id, username: b.username, game: b.game, stake: b.stake, payout: b.payout,
        profit: b.profit, commission: b.commission, boosted: b.boosted, result: b.result, roundId: b.round_id, createdAt: b.created_at,
      })),
    });
  });

  app.get("/api/admin/rounds", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM rounds ORDER BY id DESC LIMIT 50").all();
    res.json({
      total: rows.length,
      items: rows.map((r) => ({
        id: r.id, game: r.game, status: r.status, result: r.result, meta: r.meta, pot: r.pot,
        adminCut: r.admin_cut, seedHash: r.seed_hash, seed: r.seed, createdAt: r.created_at, endedAt: r.ended_at,
      })),
    });
  });

  app.get("/api/admin/settings", requireAdmin, (req, res) => {
    res.json({ settings: getSettingSafe() });
  });

  app.post("/api/admin/settings", requireAdmin, (req, res) => {
    try {
      const b = req.body || {};
      const changed = [];
      for (const [k, v] of Object.entries(b)) {
        if (!ADMIN_MUTATIONS.has(k)) continue;
        setSetting(k, String(v).slice(0, 500));
        changed.push(k);
      }
      audit(req.user.id, "admin.settings", changed.join(","), clientIp(req));
      res.json({ ok: true, changed });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/admin/audit", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 100").all();
    res.json({ items: rows.map((a) => ({ id: a.id, admin: a.username || "system", action: a.action, detail: a.detail, ip: a.ip, createdAt: a.created_at })) });
  });

  app.get("/api/admin/referrals", requireAdmin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, f.username referrer, i.username invitee FROM referrals r
         JOIN users f ON f.id=r.referrer LEFT JOIN users i ON i.id=r.invitee
         ORDER BY r.id DESC LIMIT 100`
      )
      .all();
    res.json({ items: rows.map((r) => ({ id: r.id, referrer: r.referrer, invitee: r.invitee, amount: r.amount, status: r.status, createdAt: r.created_at })) });
  });

  app.get("/api/admin/export", requireAdmin, (req, res) => {
    const dump = {
      generatedAt: now(),
      users: db.prepare("SELECT * FROM users").all(),
      transactions: db.prepare("SELECT * FROM transactions").all(),
      bets: db.prepare("SELECT * FROM bets ORDER BY id DESC LIMIT 200000").all(),
      rounds: db.prepare("SELECT * FROM rounds").all(),
      settings: db.prepare("SELECT * FROM settings").all(),
      platform: platform(),
    };
    audit(req.user.id, "admin.export", `${dump.users.length} users`, clientIp(req));
    res.setHeader("Content-Disposition", `attachment; filename=nexus-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(dump);
  });
}

function getSettingSafe() {
  const keys = [...ADMIN_MUTATIONS];
  const out = {};
  for (const k of keys) out[k] = getSetting(k);
  return out;
}
