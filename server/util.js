import crypto from "node:crypto";
import { db, getSetting, now } from "./db.js";

/* --------------------------------- passwords -------------------------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  try {
    const [algo, N, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const calc = crypto.scryptSync(String(password), salt, 64, { N: Number(N), r: 8, p: 1 });
    const exp = Buffer.from(hash, "hex");
    return calc.length === exp.length && crypto.timingSafeEqual(calc, exp);
  } catch {
    return false;
  }
}

/* ---------------------------------- tokens ---------------------------------- */

let SECRET = process.env.NEXUS_SECRET || "";
if (!SECRET) {
  try {
    const path = new URL("./.secret", import.meta.url);
    SECRET = (await import("node:fs")).readFileSync(path, "utf8").trim();
  } catch {
    SECRET = crypto.randomBytes(48).toString("hex");
    try {
      (await import("node:fs")).writeFileSync(new URL("./.secret", import.meta.url), SECRET, { mode: 0o600 });
    } catch {}
  }
}
export const secret = SECRET;

export function sign(payload, ttlSec = 60 * 60 * 24 * 7) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now(), exp: now() + ttlSec * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verify(token) {
  if (!token || typeof token !== "string") return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------- rate limiting ------------------------------ */

const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const k = `${key}`;
  const t = now();
  let b = buckets.get(k);
  if (!b || b.reset < t) {
    b = { n: 0, reset: t + windowMs };
    buckets.set(k, b);
  }
  b.n++;
  if (b.n > limit) return false;
  if (buckets.size > 50000) {
    for (const [kk, vv] of buckets) if (vv.reset < t) buckets.delete(kk);
  }
  return true;
}
export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

/* ------------------------------ input validation ---------------------------- */

export const str = (v, max = 200) => String(v ?? "").slice(0, max);
export function usernameOk(v) {
  const s = String(v || "");
  return /^[a-zA-Z0-9_]{3,20}$/.test(s);
}
export function emailOk(v) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v)) && String(v).length <= 160;
}
export function money(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new Error("bad amount");
  return n;
}

/* ------------------------------- provably fair ------------------------------ */

export function newServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}
export function seedHash(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}
/** hex hmac result -> float in [0,1) */
export function hmacFloat(serverSeed, clientSeed, nonce, tag = "") {
  const h = crypto
    .createHmac("sha256", String(serverSeed))
    .update(`${String(clientSeed)}:${nonce}:${tag}`)
    .digest("hex");
  return parseInt(h.slice(0, 13), 16) / Math.pow(16, 13);
}
export function verifyHmac(serverSeed, clientSeed, nonce, tag = "") {
  return crypto
    .createHmac("sha256", String(serverSeed))
    .update(`${String(clientSeed)}:${nonce}:${tag}`)
    .digest("hex");
}
export function hashChain(prev, round) {
  return crypto.createHash("sha256").update(`${prev}:${round}`).digest("hex");
}

export function randHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/* --------------------------------- misc ------------------------------------- */

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
export function pct(x) {
  return Math.max(0, Math.min(100, Number(x) || 0)) / 100;
}
export function json(v) {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
export const PUBLIC_ROUTES = new Set(["/api/auth/login", "/api/auth/register", "/api/auth/session"]);
export { getSetting };
