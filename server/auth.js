import { db, getUser, getUserByName, now, publicUser, credit, audit, getSetting } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  sign,
  verify,
  rateLimit,
  clientIp,
  usernameOk,
  emailOk,
  str,
} from "./util.js";

const COOKIE = "nexus_token";

export function setSession(res, payload) {
  const token = sign(payload, 60 * 60 * 24 * 7);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`
  );
  return token;
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function readCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function currentUser(req) {
  const t = readCookie(req, COOKIE) || (req.headers.authorization || "").replace(/^Bearer /, "");
  const p = verify(t);
  if (!p || !p.uid) return null;
  const u = getUser(p.uid);
  if (!u || u.status === "banned") return null;
  if (u.self_exclusion_until > now()) return null;
  return u;
}

/** Express middleware: attaches req.user for authenticated routes. */
export function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "auth_required" });
  req.user = u;
  next();
}
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
  });
}

function bumpAttempt(key, limit, windowMs) {
  const row = db.prepare("SELECT * FROM login_attempts WHERE key = ?").get(key);
  const t = now();
  if (!row || row.until < t) {
    db.prepare(
      "INSERT INTO login_attempts(key, fails, until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET fails = 1, until = ?"
    ).run(key, 1, t + windowMs, t + windowMs);
    return 1;
  }
  const fails = row.fails + 1;
  db.prepare("UPDATE login_attempts SET fails = ?, until = ? WHERE key = ?").run(fails, row.until, key);
  return fails;
}

export function registerUser({ username, email, password, referral, lang }, ip) {
  if (getSetting("registration_enabled") !== "1") throw new Error("registration_closed");
  if (!usernameOk(username)) throw new Error("bad_username");
  if (String(password || "").length < 8) throw new Error("weak_password");
  if (!emailOk(email)) throw new Error("bad_email");
  if (getUserByName(username)) throw new Error("username_taken");
  if (email && db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email))
    throw new Error("email_taken");
  if (!rateLimit(`reg:${ip}`, 10, 60 * 60 * 1000)) throw new Error("too_many");

  const ref = referral
    ? db.prepare("SELECT id FROM users WHERE referral_code = ? ").get(String(referral))
    : null;

  const code = "NX" + Math.random().toString(36).slice(2, 9).toUpperCase();
  const boost = getSetting("boost_enabled") === "1" ? Number(getSetting("boost_bets") || 0) : 0;

  const r = db
    .prepare(
      `INSERT INTO users(username, email, password_hash, role, referral_code, referred_by, lang,
        boost_bets_left, created_at, last_login_at, last_seen_at, ip)
       VALUES(?,?,?,'user',?,?,?,?,?,?,?,?)`
    )
    .run(
      String(username),
      email || null,
      hashPassword(password),
      code,
      ref ? ref.id : null,
      lang === "ru" ? "ru" : "en",
      boost,
      now(),
      now(),
      now(),
      ip
    );
  audit(null, "user.register", `${username} ip=${ip}`, ip);
  return getUser(r.lastInsertRowid);
}

// ip column may not exist on older dbs -> ensure it
try {
  db.exec("ALTER TABLE users ADD COLUMN ip TEXT");
} catch {}

export function loginUser({ username, password }, ip) {
  if (!rateLimit(`login:${ip}`, 30, 10 * 60 * 1000)) throw new Error("too_many");
  const fails = bumpAttempt(`login:${ip}`, 15, 10 * 60 * 1000);
  const u = getUserByName(String(username || ""));
  if (!u || !verifyPassword(String(password || ""), u.password_hash)) {
    if (fails >= 10) audit(null, "auth.bruteforce", String(username), ip);
    throw new Error("invalid_credentials");
  }
  if (u.failed_logins >= 10 && u.locked_until > now()) throw new Error("account_locked");
  if (u.status === "banned") throw new Error("banned");
  if (u.self_exclusion_until > now()) throw new Error("self_excluded");

  db.prepare(
    "UPDATE users SET failed_logins = 0, locked_until = 0, last_login_at = ?, last_seen_at = ? WHERE id = ?"
  ).run(now(), now(), u.id);
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(`login:${ip}`);
  audit(u.id, "auth.login", u.username, ip);
  return getUser(u.id);
}

export function registerRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    try {
      const b = req.body || {};
      const ip = clientIp(req);
      const u = registerUser(
        { username: b.username, email: b.email, password: b.password, referral: b.referral, lang: b.lang },
        ip
      );
      setSession(res, { uid: u.id, role: u.role });
      res.json({ user: publicUser(u) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const b = req.body || {};
      const ip = clientIp(req);
      const u = loginUser({ username: b.username, password: b.password }, ip);
      setSession(res, { uid: u.id, role: u.role });
      res.json({ user: publicUser(u) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/session", (req, res) => {
    const u = currentUser(req);
    if (!u) return res.json({ user: null });
    db.prepare("UPDATE users SET last_seen_at = ?, ip = ? WHERE id = ?").run(now(), clientIp(req), u.id);
    res.json({ user: publicUser(u) });
  });

  app.post("/api/auth/password", requireAuth, (req, res) => {
    const b = req.body || {};
    if (!verifyPassword(String(b.current || ""), req.user.password_hash))
      return res.status(400).json({ error: "invalid_credentials" });
    if (String(b.next || "").length < 8) return res.status(400).json({ error: "weak_password" });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.next), req.user.id);
    audit(req.user.id, "auth.password_change", req.user.username, clientIp(req));
    res.json({ ok: true });
  });

  app.post("/api/auth/language", requireAuth, (req, res) => {
    const lang = req.body?.lang === "ru" ? "ru" : "en";
    db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(lang, req.user.id);
    res.json({ ok: true });
  });

  /* --------------------------- responsible gaming -------------------------- */
  app.post("/api/account/limits", requireAuth, (req, res) => {
    const b = req.body || {};
    const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    db.prepare(
      "UPDATE users SET daily_bet_limit = ?, daily_loss_limit = ?, session_limit_min = ? WHERE id = ?"
    ).run(
      clamp(b.bet, 10_000_000),
      clamp(b.loss, 10_000_000),
      clamp(b.session, 24 * 60),
      req.user.id
    );
    res.json({ ok: true });
  });

  app.post("/api/account/self-exclude", requireAuth, (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.body?.days) || 7));
    db.prepare("UPDATE users SET self_exclusion_until = ? WHERE id = ?").run(
      now() + days * 86400000,
      req.user.id
    );
    audit(req.user.id, "account.self_exclude", `${days}d`, clientIp(req));
    res.json({ ok: true });
  });
}

export { COOKIE };
