/**
 * HTTP API smoke test: promos, leaderboard, feed, admin surface, signed webhook.
 * Run:  node test/api.mjs   (server must be running on :4000)
 */
import { ADMIN_PASS, PLAYER_PASS } from "./creds.mjs";

const BASE = "http://localhost:4000";
const PASS = [];
const FAIL = [];
const ok = (c, label) => {
  (c ? PASS : FAIL).push(label);
  console.log(c ? "  PASS" : "  FAIL", label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = {};
async function api(path, { method = "GET", body, as = "player" } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie[as] ? { cookie: cookie[as] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}

async function login(username, password, as) {
  const r = await api("/api/auth/login", { method: "POST", body: { username, password }, as: "none" });
  if (r.status !== 200) throw new Error(`${username}: ${JSON.stringify(r.data)}`);
  // re-login to capture the cookie header
  const raw = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  cookie[as] = (raw.headers.get("set-cookie") || "").split(";")[0];
  return r.data.user;
}

async function main() {
  const player = await login("player1", PLAYER_PASS, "player");
  await login("admin", ADMIN_PASS, "admin");
  console.log(`player=${player.username}#${player.id}`);

  console.log("\n[promotions & feed]");
  const promos = await api("/api/promotions");
  ok(promos.status === 200 && !!promos.data.tournament, `GET /api/promotions keys=${Object.keys(promos.data).join(",")}`);
  ok(!!promos.data.settings, `promotions settings: ${Object.keys(promos.data.settings || {}).length} keys`);

  const daily = await api("/api/promotions/daily", { method: "POST" });
  ok(daily.status === 200 || daily.data?.error === "already_claimed" || daily.data?.error === "no_streak",
    `daily bonus: ${JSON.stringify(daily.data).slice(0, 120)}`);

  const lb = await api("/api/leaderboard");
  ok(lb.status === 200 && Array.isArray(lb.data.rows), `leaderboard rows=${lb.data.rows?.length} pool=${lb.data.pool}`);
  const feed = await api("/api/feed/live");
  ok(feed.status === 200 && Array.isArray(feed.data.wins), `live feed wins=${feed.data.wins?.length} top=${feed.data.top?.length}`);

  console.log("\n[account]");
  const limits = await api("/api/account/limits", { method: "POST", body: { dailyBetLimit: 0, dailyLossLimit: 0 } });
  ok(limits.status === 200, "responsible-gaming limits endpoint");
  const tgCode = await api("/api/account/telegram/code", { method: "POST" });
  ok(tgCode.status === 200 && typeof tgCode.data.code === "string", `telegram bind code: ${tgCode.data.code}`);

  console.log("\n[admin]");
  const ov = await api("/api/admin/overview", { as: "admin" });
  ok(ov.status === 200 && ov.data.today, `admin overview: bets=${ov.data.today.bets} commission=${ov.data.today.commission} ggr=${ov.data.today.ggr}`);
  const players = await api("/api/admin/players?q=wstester", { as: "admin" });
  ok(players.status === 200 && players.data.items.length >= 2, `admin players found=${players.data.items.length}`);
  const bets = await api("/api/admin/bets?game=poker", { as: "admin" });
  ok(bets.status === 200, `admin poker bets=${bets.data.total}`);
  const rounds = await api("/api/admin/rounds", { as: "admin" });
  ok(rounds.status === 200, `admin rounds=${rounds.data.total}`);
  const audit = await api("/api/admin/audit", { as: "admin" });
  ok(audit.status === 200 && audit.data.items.length > 0, `audit entries=${audit.data.items.length}`);
  const refs = await api("/api/admin/referrals", { as: "admin" });
  ok(refs.status === 200, `referrals=${refs.data.items.length}`);
  const settings = await api("/api/admin/settings", { as: "admin" });
  ok(settings.status === 200 && settings.data.settings, `settings keys=${Object.keys(settings.data.settings).length}`);

  const before = settings.data.settings.webhook_secret;
  const set = await api("/api/admin/settings", { method: "POST", body: { webhook_secret: "test_secret_123" }, as: "admin" });
  ok(set.status === 200 && set.data.changed.includes("webhook_secret"), "admin can set webhook_secret");
  void before;

  console.log("\n[webhook]");
  const payload = JSON.stringify({ user_id: player.id, amount_usd: 12.34, txid: `smoketx-${Date.now()}`, crypto: "btc" });
  const sig = (await import("node:crypto")).createHmac("sha256", "test_secret_123").update(payload).digest("hex");
  const wh = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexus-signature": sig },
    body: payload,
  });
  const whBody = await wh.json();
  ok(wh.status === 200 && whBody.ok === true && whBody.cents === 1234, `signed webhook credited: ${JSON.stringify(whBody)}`);

  const bad = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexus-signature": "deadbeef".repeat(8) },
    body: payload,
  });
  ok(bad.status === 401, `forged webhook rejected: ${bad.status}`);

  const dupe = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexus-signature": sig },
    body: payload,
  });
  const dupeBody = await dupe.json();
  ok(dupe.status === 200 && dupeBody.duplicate === true, "duplicate txid not credited twice");

  console.log("\n[security]");
  const noAuth = await fetch(`${BASE}/api/admin/overview`);
  ok(noAuth.status === 401 || noAuth.status === 403, `admin API without session -> ${noAuth.status}`);
  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrongpass" }),
  });
  ok(badLogin.status === 400 || badLogin.status === 401, `bad admin password -> ${badLogin.status}`);
  const hdr = await fetch(`${BASE}/`);
  const csp = hdr.headers.get("content-security-policy") || hdr.headers.get("x-frame-options");
  ok(!!csp, `security headers present (${hdr.headers.get("x-content-type-options")}, frame=${hdr.headers.get("x-frame-options")})`);

  const exportRes = await api("/api/admin/export?what=bets", { as: "admin" });
  ok(exportRes.status === 200, `admin export works (${typeof exportRes.data})`);

  console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
  if (FAIL.length) {
    console.log("failed:", FAIL.join(" | "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\nTEST ERROR:", e.message);
  process.exit(1);
});
