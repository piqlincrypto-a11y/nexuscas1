import crypto from "node:crypto";
import { db, getUser, now, getSetting, setSetting, credit, platformAdd, audit } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit, money, str, clientIp } from "./util.js";

export const CRYPTOS = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", setting: "crypto_btc_address", decimals: 8 },
  { id: "eth", name: "Ethereum", symbol: "ETH", setting: "crypto_eth_address", decimals: 6 },
  { id: "usdt", name: "Tether (TRC-20)", symbol: "USDT", setting: "crypto_usdt_address", decimals: 2 },
  { id: "ton", name: "Toncoin", symbol: "TON", setting: "crypto_ton_address", decimals: 2 },
];

// Admin-editable USD rates (auto-refresh may override them when network is available)
const RATE_KEYS = { btc: "rate_btc", eth: "rate_eth", usdt: "rate_usdt", ton: "rate_ton" };
const FALLBACK_RATES = { btc: 65000, eth: 3000, usdt: 1, ton: 5 };

function rateFor(id) {
  const key = RATE_KEYS[id];
  const v = key ? Number(getSetting(key)) : 0;
  return v > 0 ? v : FALLBACK_RATES[id] || 1;
}

export function refreshRates() {
  const ids = { btc: "bitcoin", eth: "ethereum", usdt: "tether", ton: "the-open-network" };
  const q = Object.values(ids).join(",");
  return fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd`,
    { signal: AbortSignal.timeout(8000) }
  )
    .then((r) => r.json())
    .then((j) => {
      for (const [id, cg] of Object.entries(ids)) {
        const p = j?.[cg]?.usd;
        if (p > 0) setSetting(RATE_KEYS[id], String(p));
      }
      return true;
    })
    .catch(() => false);
}

function history(userId, limit = 50) {
  return db
    .prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit)
    .map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      crypto: t.crypto,
      address: t.address,
      txid: t.txid,
      status: t.status,
      note: t.note,
      rate: t.rate,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));
}

export function registerWalletRoutes(app) {
  app.get("/api/wallet", requireAuth, (req, res) => {
    const s = getSetting;
    res.json({
      balance: req.user.balance,
      currency: s("currency"),
      depositEnabled: s("deposit_enabled") === "1",
      withdrawEnabled: s("withdraw_enabled") === "1",
      minDeposit: Number(s("min_deposit")),
      minWithdraw: Number(s("min_withdraw")),
      cryptos: CRYPTOS.map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        address: s(c.setting),
        rate: rateFor(c.id),
        decimals: c.decimals,
      })),
      history: history(req.user.id),
      totals: { deposit: req.user.total_deposit, withdraw: req.user.total_withdraw },
    });
  });

  app.post("/api/wallet/deposit", requireAuth, (req, res) => {
    try {
      if (getSetting("deposit_enabled") !== "1") return res.status(400).json({ error: "deposits_closed" });
      if (!rateLimit(`dep:${req.user.id}`, 20, 3600000)) return res.status(429).json({ error: "too_many" });
      const b = req.body || {};
      const coin = CRYPTOS.find((c) => c.id === b.crypto);
      if (!coin) return res.status(400).json({ error: "bad_crypto" });
      const amountCrypto = Number(b.amount);
      if (!Number.isFinite(amountCrypto) || amountCrypto <= 0) return res.status(400).json({ error: "bad_amount" });
      const rate = rateFor(coin.id);
      const usdCents = Math.round(amountCrypto * rate * 100);
      if (usdCents < Number(getSetting("min_deposit"))) return res.status(400).json({ error: "min_deposit" });

      db.prepare(
        `INSERT INTO transactions(user_id, type, amount, currency, rate, crypto, address, status, note, created_at, updated_at)
         VALUES(?,'deposit',?,'USD',?,?,?, 'pending', ?, ?, ?)`
      ).run(req.user.id, usdCents, rate, coin.id, getSetting(coin.setting), `manual ${amountCrypto} ${coin.symbol}`, now(), now());
      audit(req.user.id, "wallet.deposit_requested", `${amountCrypto} ${coin.id}`, clientIp(req));
      res.json({ ok: true, address: getSetting(coin.setting), amount: amountCrypto, usd: usdCents });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/wallet/withdraw", requireAuth, (req, res) => {
    try {
      if (getSetting("withdraw_enabled") !== "1") return res.status(400).json({ error: "withdrawals_closed" });
      if (!rateLimit(`wd:${req.user.id}`, 10, 3600000)) return res.status(429).json({ error: "too_many" });
      const b = req.body || {};
      const coin = CRYPTOS.find((c) => c.id === b.crypto);
      if (!coin) return res.status(400).json({ error: "bad_crypto" });
      const amount = money(b.amount);
      const address = str(b.address, 128).trim();
      if (amount < Number(getSetting("min_withdraw"))) return res.status(400).json({ error: "min_withdraw" });
      if (address.length < 10) return res.status(400).json({ error: "bad_address" });

      db.exec("BEGIN IMMEDIATE");
      const u = getUser(req.user.id);
      if (u.balance < amount) {
        db.exec("ROLLBACK");
        return res.status(400).json({ error: "insufficient_balance" });
      }
      db.prepare("UPDATE users SET balance = balance - ?, total_withdraw = total_withdraw + ? WHERE id = ?")
        .run(amount, amount, u.id);
      platformAdd({ withdrawals: amount });
      db.prepare(
        `INSERT INTO transactions(user_id, type, amount, currency, crypto, address, status, note, created_at, updated_at)
         VALUES(?,'withdraw',?,'USD',?,?,'pending',?,?,?)`
      ).run(u.id, -amount, coin.id, address, `payout in ${coin.symbol}`, now(), now());
      db.exec("COMMIT");
      audit(u.id, "wallet.withdraw_requested", `${amount} cents -> ${address}`, clientIp(req));
      res.json({ ok: true, usd: amount, crypto: (amount / 100 / rateFor(coin.id)).toFixed(coin.decimals) });
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      res.status(400).json({ error: e.message });
    }
  });

  /* ---- signed payment-processor webhook: confirms a pending deposit ---- */
  app.post("/api/payments/webhook", (req, res) => {
    try {
      const secret = getSetting("webhook_secret") || "";
      const sig = String(req.headers["x-nexus-signature"] || req.headers["x-signature"] || "");
      const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
      if (!secret) return res.status(503).json({ error: "webhook_not_configured" });
      const expect = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const ok =
        sig &&
        sig.length === expect.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
      if (!ok) {
        audit(null, "wallet.webhook_bad_signature", sig.slice(0, 32), clientIp(req));
        return res.status(401).json({ error: "bad_signature" });
      }
      const b = req.body || {};
      const txid = str(b.txid, 120);
      const amount = Number(b.amount_usd ?? b.amount);
      if (!txid || !Number.isFinite(amount)) return res.status(400).json({ error: "bad_payload" });
      const already = db.prepare("SELECT id FROM transactions WHERE txid = ?").get(txid);
      if (already) return res.json({ ok: true, duplicate: true });

      const userId = b.user_id ? Number(b.user_id) : 0;
      const cents = Math.round(Math.abs(amount) * (String(b.unit) === "cents" ? 1 : 100));
      if (userId > 0 && getUser(userId)) {
        credit(userId, cents, { type: "deposit", status: "completed", txid, crypto: b.crypto || "", note: "auto webhook" });
        db.prepare("UPDATE users SET total_deposit = total_deposit + ? WHERE id = ?").run(cents, userId);
        platformAdd({ deposits: cents });
        audit(null, "wallet.webhook_credit", `user=${userId} ${cents}`, clientIp(req));
        return res.json({ ok: true, user_id: userId, cents });
      }
      // no user id -> park it as a pending deposit for manual matching in admin
      db.prepare(
        `INSERT INTO transactions(user_id, type, amount, currency, crypto, txid, status, note, created_at, updated_at)
         VALUES(0,'deposit',?,'USD',?,?, 'pending', 'unmatched webhook', ?, ?)`
      ).run(cents, b.crypto || "", txid, now(), now());
      res.json({ ok: true, matched: false });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/wallet/rates", requireAuth, async (req, res) => {
    const ok = await refreshRates();
    res.json({ ok });
  });
}
