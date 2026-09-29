import express from "express";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, getUser, now, getSetting, setSetting, audit, platform, publicUser, credit } from "./db.js";
import { hashPassword, rateLimit, clientIp, str } from "./util.js";
import { requireAuth, registerRoutes as registerAuthRoutes, currentUser } from "./auth.js";
import { registerWalletRoutes } from "./wallet.js";
import { registerGameRoutes } from "./games.js";
import { registerPromoRoutes, payTournament, liveWins } from "./promos.js";
import { registerAdminRoutes } from "./admin.js";
import { registerBotRoutes, startBot, restartBot, tgNotifyAdmin } from "./bot.js";
import { attachWs } from "./multi.js";
import { refreshRates } from "./wallet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = Number(process.env.PORT || 4000);
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; font-src 'self' data: https://fonts.gstatic.com;");
  if (req.headers.origin) {
    const ok = req.headers.origin.includes(`:${PORT}`) || req.headers.origin.includes("localhost") || process.env.ALLOW_ORIGIN === req.headers.origin;
    if (!ok) return res.status(403).json({ error: "bad_origin" });
  }
  next();
});

// raw body is kept for webhook signature verification
app.use(
  express.json({
    limit: "64kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// global API throttle (basic abuse protection)
app.use("/api", (req, res, next) => {
  const ip = clientIp(req);
  if (!rateLimit(`api:${ip}`, 600, 60000)) return res.status(429).json({ error: "rate_limited" });
  if (getSetting("maintenance") === "1" && !String(req.path).startsWith("/api/admin") && req.method !== "GET" && req.user?.role !== "admin")
    return res.status(503).json({ error: "maintenance" });
  next();
});

/* ---------------------------------- routes ---------------------------------- */

registerAuthRoutes(app);
registerWalletRoutes(app);
registerGameRoutes(app);
registerPromoRoutes(app);
registerAdminRoutes(app);
registerBotRoutes(app);

app.get("/api/health", (req, res) => res.json({ ok: true, ts: now() }));
app.get("/api/meta", (req, res) =>
  res.json({
    siteName: getSetting("site_name"),
    tagline: getSetting("site_tagline"),
    banner: getSetting("promo_banner"),
    support: getSetting("support_email"),
    maintenance: getSetting("maintenance") === "1",
    maintenanceMsg: getSetting("maintenance_msg"),
    registration: getSetting("registration_enabled") === "1",
    version: "1.0.0",
  })
);

app.get("/api/me", requireAuth, (req, res) => {
  const u = getUser(req.user.id);
  res.json({ user: publicUser(u), platform: null });
});

app.get("/api/me/bets", requireAuth, (req, res) => {
  const page = Math.max(0, Number(req.query?.page) || 0);
  const rows = db
    .prepare("SELECT * FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 25 OFFSET ?")
    .all(req.user.id, page * 25);
  const total = db.prepare("SELECT COUNT(*) n FROM bets WHERE user_id = ?").get(req.user.id).n;
  const agg = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(stake),0) staked, COALESCE(SUM(payout),0) paid, COALESCE(SUM(profit),0) profit
       FROM bets WHERE user_id = ?`
    )
    .get(req.user.id);
  res.json({
    total,
    page,
    stats: agg,
    items: rows.map((b) => ({
      id: b.id, game: b.game, stake: b.stake, payout: b.payout, profit: b.profit,
      commission: b.commission, boosted: b.boosted, result: b.result, pf: b.pf, createdAt: b.created_at, roundId: b.round_id,
    })),
  });
});

app.get("/api/feed", (req, res) => res.json({ wins: liveWins(24) }));

app.post("/api/admin/telegram/restart", requireAuth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  restartBot();
  res.json({ ok: true });
});

// convenience: settings changes that need side effects
const _origSettings = app.post.bind(app);

app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

/* ------------------------------ static frontend ----------------------------- */

const DIST = join(ROOT, "dist");
if (existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(DIST, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error("error", err.message);
  res.status(500).json({ error: "server_error" });
});

/* ---------------------------------- bootstrap -------------------------------- */

function bootstrapAdmin() {
  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n;
  if (admins > 0) return;
  const password = process.env.ADMIN_PASSWORD || Math.random().toString(36).slice(2, 10) + "Nx!9";
  const username = process.env.ADMIN_USERNAME || "admin";
  db.prepare(
    `INSERT INTO users(username, email, password_hash, role, referral_code, created_at, last_login_at, boost_bets_left)
     VALUES(?,?,?,'admin',?,?,?,0)`
  ).run(username, "admin@nexus.local", hashPassword(password), "NXADMIN1", now(), now());
  console.log("--------------------------------------------------");
  console.log("  ADMIN ACCOUNT CREATED");
  console.log(`  login: ${username}`);
  console.log(`  pass:  ${password}`);
  console.log("  (change it right after the first login)");
  console.log("--------------------------------------------------");
}

// stale rows from a previous run would block games
try {
  db.exec("DELETE FROM active_games WHERE game IN ('poker')");
} catch {}

bootstrapAdmin();
if (!getSetting("webhook_secret")) setSetting("webhook_secret", crypto.randomBytes(24).toString("hex"));

const server = createServer(app);
attachWs(server);

server.listen(PORT, () => {
  console.log(`Nexus casino API on http://localhost:${PORT}`);
  startBot();
});

/* --------------------------------- scheduler -------------------------------- */

setInterval(() => {
  try {
    payTournament();
  } catch (e) {
    console.error("tournament", e.message);
  }
}, 60 * 60 * 1000);

setInterval(() => {
  try {
    refreshRates();
  } catch {}
}, 15 * 60 * 1000);

setInterval(() => {
  try {
    db.prepare("DELETE FROM login_attempts WHERE until < ?").run(now());
  } catch {}
}, 30 * 60 * 1000);

setTimeout(() => refreshRates().catch(() => {}), 3000);

process.on("uncaughtException", (e) => console.error("uncaught", e));
process.on("unhandledRejection", (e) => console.error("unhandled", e));
