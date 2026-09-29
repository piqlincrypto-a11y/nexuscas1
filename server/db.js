import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
const DATA_DIR = process.env.NEXUS_DATA || join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.NEXUS_DB || join(DATA_DIR, "nexus.db"));

db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  referral_code TEXT UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  vip_wagered INTEGER NOT NULL DEFAULT 0,
  bets_count INTEGER NOT NULL DEFAULT 0,
  boost_bets_left INTEGER NOT NULL DEFAULT 0,
  streak_day INTEGER NOT NULL DEFAULT 0,
  streak_last INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT 'en',
  tg_id INTEGER,
  tg_username TEXT,
  tg_link_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  ban_reason TEXT,
  notes TEXT,
  self_exclusion_until INTEGER NOT NULL DEFAULT 0,
  daily_bet_limit INTEGER NOT NULL DEFAULT 0,
  daily_loss_limit INTEGER NOT NULL DEFAULT 0,
  session_limit_min INTEGER NOT NULL DEFAULT 0,
  today_bet INTEGER NOT NULL DEFAULT 0,
  today_loss INTEGER NOT NULL DEFAULT 0,
  today_key TEXT NOT NULL DEFAULT '',
  two_factor_secret TEXT,
  pf_server_seed TEXT,
  pf_server_hash TEXT,
  pf_client_seed TEXT,
  pf_nonce INTEGER NOT NULL DEFAULT 0,
  total_deposit INTEGER NOT NULL DEFAULT 0,
  total_withdraw INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  rate REAL,
  crypto TEXT,
  address TEXT,
  txid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reviewed_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  stake INTEGER NOT NULL,
  payout INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  pf TEXT,
  round_id INTEGER,
  boosted INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_game ON bets(game, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);

CREATE TABLE IF NOT EXISTS active_games (
  user_id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  bet_id INTEGER,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  phase TEXT,
  meta TEXT,
  pot INTEGER NOT NULL DEFAULT 0,
  admin_cut INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER,
  seed_hash TEXT,
  seed TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(game, status, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(created_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer INTEGER NOT NULL,
  invitee INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  deposits INTEGER NOT NULL DEFAULT 0,
  withdrawals INTEGER NOT NULL DEFAULT 0,
  staked INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO platform(id) VALUES(1);
`);

export function platformAdd(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ${k} + ?`).join(", ");
  db.prepare(`UPDATE platform SET ${sets}, updated_at = ? WHERE id = 1`).run(
    ...keys.map((k) => Math.trunc(fields[k] || 0)),
    now()
  );
}
export function platform() {
  const p = db.prepare("SELECT * FROM platform WHERE id = 1").get();
  const balance = p.deposits - p.withdrawals + p.staked - p.paid - p.commission - p.bonus;
  return { ...p, balance, ggr: p.staked - p.paid, revenue: p.staked - p.paid - p.commission - p.bonus };
}

/* ---------------------------------- settings --------------------------------- */

const DEFAULTS = {
  site_name: "NEXUS",
  site_tagline: "Crypto Casino",
  support_email: "support@nexus.example",
  currency: "USD",
  // money split: share of every lost stake credited to the admin account
  admin_commission_pct: "50",
  // house edge for single-player games (percent). Payouts = fair * (1 - edge)
  house_edge_pct: "5",
  // new-player boost: first N bets are played with 0 house edge
  boost_bets: "30",
  boost_enabled: "1",
  // promotions
  welcome_bonus_pct: "100",
  welcome_bonus_max: "50000",
  welcome_bonus_enabled: "1",
  daily_bonus_enabled: "1",
  daily_bonus_max_day7: "5000",
  cashback_pct: "10",
  cashback_enabled: "1",
  tournament_pool: "500000",
  tournament_enabled: "1",
  referral_enabled: "1",
  referral_bonus: "10000",
  referral_min_deposit: "5000",
  vip_enabled: "1",
  // crypto deposit rails (manual confirm + signed webhook)
  crypto_btc_address: "bc1qnexus00000000000000000000000000000",
  crypto_eth_address: "0x0000000000000000000000000000000000000000",
  crypto_usdt_address: "0x0000000000000000000000000000000000000000",
  crypto_ton_address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
  webhook_secret: "",
  min_deposit: "1000",
  min_withdraw: "2000",
  withdraw_enabled: "1",
  deposit_enabled: "1",
  // telegram
  tg_token: "",
  tg_enabled: "1",
  tg_channel: "",
  // gameplay limits
  min_bet: "100",
  max_bet: "100000000",
  registration_enabled: "1",
  maintenance: "0",
  maintenance_msg: "",
  promo_banner: "Weekly Tournament — $5,000 prize pool. Top 10 by profit share it.",
  afx_rtp_note: "RTP is shown on every game screen.",
};

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : DEFAULTS[key];
}
export function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare("SELECT key, value FROM settings").all()) out[r.key] = r.value;
  return out;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(key), String(value));
}
export { DEFAULTS };

const ins = db.prepare(
  "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)"
);
for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);

// migrate older databases in place (no-op when the column already exists)
for (const ddl of [
  "ALTER TABLE users ADD COLUMN ip TEXT",
  "ALTER TABLE users ADD COLUMN pf_server_seed TEXT",
  "ALTER TABLE users ADD COLUMN pf_server_hash TEXT",
  "ALTER TABLE users ADD COLUMN pf_client_seed TEXT",
  "ALTER TABLE users ADD COLUMN pf_nonce INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE bets ADD COLUMN closed INTEGER NOT NULL DEFAULT 0",
]) {
  try {
    db.exec(ddl);
  } catch {}
}

// repair rows written by older builds where the INSERT placeholders were shifted
// (status stored the note, note stored 'pending')
try {
  db.exec(
    `UPDATE transactions
        SET status = 'pending',
            note   = CASE WHEN note = 'pending' OR note IS NULL OR note = '' THEN status ELSE note END
      WHERE status NOT IN ('pending', 'completed', 'rejected')`
  );
} catch {}

/* ----------------------------------- helpers --------------------------------- */

export const now = () => Date.now();
export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(Number(id));
}
export function getUserByName(username) {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username));
}
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    balance: u.balance,
    currency: u.currency,
    vipWagered: u.vip_wagered,
    betsCount: u.bets_count,
    boostBetsLeft: u.boost_bets_left,
    streakDay: u.streak_day,
    lang: u.lang,
    referralCode: u.referral_code,
    tgBound: !!u.tg_id,
    status: u.status,
    selfExclusionUntil: u.self_exclusion_until,
    dailyBetLimit: u.daily_bet_limit,
    dailyLossLimit: u.daily_loss_limit,
    sessionLimitMin: u.session_limit_min,
    totalDeposit: u.total_deposit,
    totalWithdraw: u.total_withdraw,
    createdAt: u.created_at,
    twoFactor: !!u.two_factor_secret,
  };
}

/** All balance mutations go through here so the ledger always reconciles. */
export function credit(userId, amount, { type = "adjustment", note = "", crypto = "", address = "", txid = "", status = "completed", rate = null, currency = "USD" } = {}) {
  const u = getUser(userId);
  if (!u) throw new Error("user not found");
  amount = Math.trunc(amount);
  if (!Number.isFinite(amount)) throw new Error("bad amount");
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, u.id);
  db.prepare(
    `INSERT INTO transactions(user_id, type, amount, currency, rate, crypto, address, txid, status, note, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(u.id, type, amount, currency, rate, crypto, address, txid, status, note, now(), now());
  return getUser(u.id);
}

export function audit(adminId, action, detail = "", ip = "") {
  db.prepare("INSERT INTO audit(admin_id, action, detail, ip, created_at) VALUES(?,?,?,?,?)").run(
    adminId ?? null,
    String(action),
    typeof detail === "string" ? detail : JSON.stringify(detail),
    ip || "",
    now()
  );
}
