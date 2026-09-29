/**
 * Frontend contract test: exercises every endpoint the React client calls and
 * checks the payload shape the UI depends on.
 * Run:  node test/client.mjs   (server must be running on :4000)
 */
import { ADMIN_PASS, PLAYER_PASS } from "./creds.mjs";

const BASE = "http://localhost:4000";
const PASS = [];
const FAIL = [];
const ok = (cond, label) => ((cond ? PASS : FAIL).push(label), console.log(cond ? "  PASS" : "  FAIL", label));

let cookie = "";
async function call(path, { method = "GET", body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}
const has = (res, keys, label) => {
  const obj = res && typeof res === "object" && "data" in res && "status" in res ? res.data : res;
  return ok(keys.every((k) => obj && k in obj), `${label}: ${keys.join(",")}`);
};

async function main() {
  /* ------------------------------ static shell ----------------------------- */
  const home = await fetch(BASE + "/");
  const html = await home.text();
  ok(home.status === 200 && html.includes("<div id=\"root\">"), "SPA index.html served");
  const asset = (html.match(/\/assets\/index-[\w-]+\.js/) || [])[0];
  const css = (html.match(/\/assets\/index-[\w-]+\.css/) || [])[0];
  ok(!!asset, `bundle referenced (${asset})`);
  if (asset) ok((await fetch(BASE + asset)).status === 200, "JS bundle loads");
  if (css) ok((await fetch(BASE + css)).status === 200, "CSS bundle loads");
  ok(!/hercules/i.test(html) && !/demo.?credit/i.test(html), "no Hercules branding / demo credits in shell");
  const spa = await fetch(BASE + "/casino/crash");
  ok(spa.status === 200 && (await spa.text()).includes("<div id=\"root\">"), "deep link falls back to SPA");

  /* --------------------------------- meta ---------------------------------- */
  has(await call("/api/meta"), ["siteName", "tagline", "maintenance", "registration", "version"], "meta");
  has(await call("/api/games"), ["games", "minBet", "maxBet", "houseEdgePct", "rtp", "adminCommissionPct"], "games");
  has(await call("/api/feed/live"), ["wins", "top", "mostPlayed"], "feed/live");
  has(await call("/api/leaderboard?period=week"), ["period", "rows", "tournament", "pool"], "leaderboard");
  ok((await call("/api/feed")).data.wins !== undefined, "feed (home ticker)");

  /* --------------------------------- auth ---------------------------------- */
  const anon = await call("/api/auth/session");
  ok(anon.data.user === null, "anonymous session -> user null");
  const login = await call("/api/auth/login", { method: "POST", body: { username: "player1", password: PLAYER_PASS } });
  ok(login.status === 200 && !!login.data.user, "login by username");
  has(login.data.user, ["id", "username", "role", "balance", "vipWagered", "betsCount", "boostBetsLeft", "lang", "referralCode"], "publicUser");
  const me = await call("/api/auth/session");
  ok(me.data.user?.username === "player1", "session cookie works");
  has(await call("/api/me"), ["user"], "/me");

  /* --------------------------------- wallet -------------------------------- */
  has(await call("/api/wallet"), ["balance", "depositEnabled", "withdrawEnabled", "minDeposit", "minWithdraw", "cryptos", "history", "totals"], "wallet");
  const w = (await call("/api/wallet")).data;
  ok(w.cryptos.length === 4 && w.cryptos.every((c) => c.symbol && c.rate > 0), "wallet exposes 4 coins with rates");
  has(await call("/api/me/bets"), ["total", "page", "stats", "items"], "me/bets");

  /* --------------------------------- games --------------------------------- */
  const games = [
    ["dice", { stake: 100, target: 50, dir: "over" }],
    ["limbo", { stake: 100, target: 2 }],
    ["slots", { stake: 100 }],
    ["plinko", { stake: 100, risk: "medium" }],
    ["wheel", { stake: 100 }],
    ["keno", { stake: 100, picks: [1, 2, 3] }],
    ["hilo", { stake: 100, guess: "hi", current: 9 }],
    ["roulette", { stake: 200, bets: [{ type: "red", amount: 200 }] }],
    ["roulette", { stake: 200, bets: [{ type: "odd", amount: 200 }] }],
    ["roulette", { stake: 400, bets: [{ type: "straight", numbers: [7], amount: 200 }, { type: "dozen", numbers: [1,2,3,4,5,6,7,8,9,10,11,12], amount: 200 }] }],
  ];
  for (const [game, body] of games) {
    const r = await call(`/api/games/${game}`, { method: "POST", body });
    ok(
      r.status === 200 && "payout" in r.data && "balance" in r.data && "result" in r.data && "pf" in r.data,
      `game ${game} (${body.type || body.dir || body.guess || body.risk || "default"}) -> payout/balance/result/pf`
    );
  }

  /* ------------------------------- mines flow ------------------------------ */
  const started = await call("/api/games/mines", { method: "POST", body: { action: "start", stake: 500, mines: 3 } });
  ok(started.status === 200 && started.data.ok && !("mineSet" in started.data), "mines start (mine layout not exposed)");
  const st = await call("/api/games/mines", { method: "POST", body: { action: "state" } });
  ok(st.status === 200 && !("mineSet" in st.data) && Array.isArray(st.data.picks), "mines state hides mine layout");
  const pick = await call("/api/games/mines", { method: "POST", body: { action: "pick", cell: 24 } });
  ok(
    pick.status === 200 && (typeof pick.data.boom === "boolean" || !!pick.data.error),
    `mines pick -> ${pick.data.boom === true ? "boom" : pick.data.boom === false ? "safe" : pick.data.error}`
  );
  if (pick.data.boom !== true) {
    const out = await call("/api/games/mines", { method: "POST", body: { action: "cashout" } });
    ok(out.status === 200 && "payout" in out.data, "mines cashout settles");
  } else {
    await call("/api/games/mines", { method: "POST", body: { action: "state" } }).catch(() => {});
  }

  /* ------------------------------- provably fair --------------------------- */
  has(await call("/api/games/pf"), ["serverSeedHash", "clientSeed", "nonce"], "pf");
  const pf = await call("/api/games/pf/client-seed", { method: "POST", body: { clientSeed: "ui-test" } });
  ok(pf.data.clientSeed === "ui-test", "pf client seed update");

  /* -------------------------------- promos --------------------------------- */
  const promos = await call("/api/promotions");
  has(promos.data, ["settings", "user", "tournament"], "promotions");
  has(promos.data.user, ["streakDay", "canDaily", "cashbackEligible", "referralCode", "vip", "referrals"], "promotions.user");
  ok(typeof promos.data.user.vip.name === "string" && "next" in promos.data.user.vip, "vip tier with next tier");

  /* ------------------------------- telegram -------------------------------- */
  has(await call("/api/account/telegram/code", { method: "POST", body: {} }), ["code", "enabled"], "tg code");
  has(await call("/api/account/telegram"), ["enabled", "bound", "username"], "tg status");

  /* --------------------------------- admin --------------------------------- */
  cookie = "";
  await call("/api/auth/login", { method: "POST", body: { username: "admin", password: ADMIN_PASS } });
  const ov = await call("/api/admin/overview");
  has(ov.data, ["today", "week", "all", "platform", "games", "series", "settings", "newPlayers", "topPlayers"], "admin overview");
  has(ov.data.today, ["bets", "staked", "paid", "ggr", "commission", "players", "deposits", "withdrawals"], "overview.today");
  const players = await call("/api/admin/players?q=player");
  ok(Array.isArray(players.data.items) && typeof players.data.total === "number", "admin players -> items/total");
  const tx = await call("/api/admin/transactions");
  ok(Array.isArray(tx.data.items), "admin transactions -> items");
  const bets = await call("/api/admin/bets");
  ok(Array.isArray(bets.data.items), "admin bets -> items");
  const rounds = await call("/api/admin/rounds");
  ok(Array.isArray(rounds.data.items), "admin rounds -> items");
  const settings = await call("/api/admin/settings");
  ok(settings.data.settings.house_edge_pct !== undefined && settings.data.settings.webhook_secret !== undefined, "admin settings keys");
  const audit = await call("/api/admin/audit");
  ok(Array.isArray(audit.data.items), "admin audit -> items");
  const refs = await call("/api/admin/referrals");
  ok(Array.isArray(refs.data.items), "admin referrals -> items");
  const exp = await call("/api/admin/export");
  ok(exp.status === 200 && exp.data.users && exp.data.bets && exp.data.settings, "admin export dump");
  ok(ov.status === 200, "admin overview ok");

  console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
  if (FAIL.length) {
    console.log("failed:");
    FAIL.forEach((f) => console.log(" -", f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
